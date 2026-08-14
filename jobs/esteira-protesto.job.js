/**
 * Esteira de Protesto — varredura automática dos inadimplentes Multimarcas.
 *
 * Roda todo dia à meia-noite, aplica as MESMAS regras do botão "Protestar"
 * da tela de Inadimplência Multimarcas e joga os títulos elegíveis na
 * tabela `esteira_protesto`. O operador abre a Esteira de Protesto de
 * manhã com a fila já montada.
 *
 * REGRAS (espelham src/pages/InadimplentesMultimarcas.jsx no front)
 *   - cliente na base MULTIMARCAS (rota /totvs/multibrand-clients)
 *   - apenas tp_documento = 1 (FATURA)
 *   - apenas cd_portador = 748 (SICREDI)
 *   - vencido há MAIS de 29 dias (ou seja, a partir de 30 dias de atraso)
 *   - título ainda em aberto (sem dt_liq e sem vl_pago)
 *
 * DEDUPE
 *   A unique (cd_empresa, nr_fat, nr_parcela) da tabela é a fonte da
 *   verdade. O job lê o que já está lá e só insere o que falta, então
 *   rodar duas vezes no mesmo dia não duplica nem ressuscita o que o
 *   operador removeu da esteira no mesmo ciclo (volta no dia seguinte —
 *   é o comportamento esperado enquanto o título seguir elegível).
 *
 * NOTIFICAÇÃO
 *   Uma notificação em `notificacoes_sistema` para owner, admin e user
 *   (o papel `user` é rotulado "Financeiro" no front), com a relação de
 *   clientes e o total a protestar. Só notifica se entrou alguém novo.
 *
 * CONFIG
 *   ESTEIRA_PROTESTO_CRON        default '0 0 * * *' (meia-noite)
 *   ESTEIRA_PROTESTO_ENABLED     'false' desliga (default ligado)
 *   ESTEIRA_PROTESTO_PORTADOR    default 748
 *   ESTEIRA_PROTESTO_DIAS_MIN    default 29 (atraso precisa ser MAIOR que isso)
 *   ESTEIRA_PROTESTO_DT_INICIO   default '2024-04-01' (início da varredura)
 *   INTERNAL_API_BASE_URL        base interna do backend
 */
import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { criarNotificacaoSistema } from '../services/notificacoesSistema.js';

const CRON_EXPR = process.env.ESTEIRA_PROTESTO_CRON || '0 0 * * *';
const TZ = 'America/Sao_Paulo';
const HABILITADO = (process.env.ESTEIRA_PROTESTO_ENABLED || 'true') !== 'false';
const PORTADOR = Number(process.env.ESTEIRA_PROTESTO_PORTADOR || 748);
const DIAS_MIN = Number(process.env.ESTEIRA_PROTESTO_DIAS_MIN || 29);
const DT_INICIO = process.env.ESTEIRA_PROTESTO_DT_INICIO || '2024-04-01';
const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE_URL ||
  `http://localhost:${process.env.PORT || 4100}`;

// owner + admin + user (=Financeiro no front)
const ROLES_NOTIFICACAO = ['owner', 'admin', 'user'];

let JOB_EM_EXECUCAO = false;

// ─── Helpers ────────────────────────────────────────────────────────────────
function hojeISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

function diasAtraso(dtVencimento, hoje = hojeISO()) {
  if (!dtVencimento) return 0;
  const t = (s) => {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(hoje) - t(dtVencimento)) / 86400000);
}

function fmtMoeda(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

const chaveTitulo = (cdEmpresa, nrFat, nrParcela) =>
  `${Number(cdEmpresa)}-${Number(nrFat)}-${Number(nrParcela || 1)}`;

// Em aberto = sem liquidação e sem valor pago
const emAberto = (item) =>
  !item.dt_liq && !(Number(item.vl_pago) > 0);

// ─── Chamadas internas ──────────────────────────────────────────────────────
async function buscarClientesMultimarcas() {
  const resp = await axios.get(
    `${INTERNAL_API_BASE}/api/totvs/multibrand-clients`,
    { timeout: 120_000 },
  );
  return resp.data?.data || [];
}

async function buscarTitulosVencidos(codigos) {
  const resp = await axios.get(
    `${INTERNAL_API_BASE}/api/totvs/accounts-receivable/filter`,
    {
      params: {
        dt_inicio: DT_INICIO,
        dt_fim: hojeISO(),
        modo: 'vencimento',
        situacao: '1',
        status: 'Vencido',
        tp_documento: '1',
        cd_cliente: codigos.join(','),
      },
      timeout: 300_000,
    },
  );
  return resp.data?.data?.items || [];
}

async function buscarNomes(codigos) {
  if (!codigos.length) return {};
  const resp = await axios.post(
    `${INTERNAL_API_BASE}/api/totvs/persons/batch-lookup`,
    { personCodes: codigos },
    { timeout: 120_000 },
  );
  return resp.data?.data || {};
}

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun] Não grava nem notifica — só loga o que faria.
 */
export async function executarEsteiraProtesto({ dryRun = false } = {}) {
  const hoje = hojeISO();
  const resultado = {
    data: hoje,
    titulosAnalisados: 0,
    elegiveis: 0,
    jaNaEsteira: 0,
    inseridos: 0,
    clientes: 0,
    valorTotal: 0,
    falhas: 0,
    dryRun,
  };

  // 1. Base de clientes multimarcas
  const multimarcas = await buscarClientesMultimarcas();
  if (multimarcas.length === 0) {
    console.warn('⚠️ [esteira-protesto] nenhum cliente multimarcas — abortando');
    return resultado;
  }
  const codigos = multimarcas.map((m) => m.code).filter(Boolean);

  // 2. Títulos vencidos desses clientes
  const titulos = await buscarTitulosVencidos(codigos);
  resultado.titulosAnalisados = titulos.length;

  // 3. Aplica as regras do botão "Protestar"
  const elegiveis = titulos.filter(
    (t) =>
      (t.tp_documento === 1 || t.tp_documento === '1') &&
      Number(t.cd_portador) === PORTADOR &&
      emAberto(t) &&
      diasAtraso(t.dt_vencimento, hoje) > DIAS_MIN,
  );
  resultado.elegiveis = elegiveis.length;

  if (elegiveis.length === 0) {
    console.log('✅ [esteira-protesto] nenhum título elegível hoje');
    return resultado;
  }

  // 4. Tira o que já está na esteira (a unique do banco é a rede de
  //    segurança, mas filtrar antes evita insert que só geraria conflito)
  const { data: jaExistentes, error: errExist } = await supabase
    .from('esteira_protesto')
    .select('cd_empresa, nr_fat, nr_parcela');
  if (errExist) throw new Error(`leitura da esteira falhou: ${errExist.message}`);

  const existentes = new Set(
    (jaExistentes || []).map((e) =>
      chaveTitulo(e.cd_empresa, e.nr_fat, e.nr_parcela),
    ),
  );

  const novos = elegiveis.filter(
    (t) =>
      !existentes.has(
        chaveTitulo(t.cd_empresa, t.nr_fat || t.nr_fatura, t.nr_parcela),
      ),
  );
  resultado.jaNaEsteira = elegiveis.length - novos.length;

  if (novos.length === 0) {
    console.log(
      `✅ [esteira-protesto] ${elegiveis.length} elegível(is), todos já na esteira`,
    );
    return resultado;
  }

  // 5. Nome do cliente (a rota de contas a receber devolve só o CNPJ)
  const codigosNovos = [...new Set(novos.map((t) => t.cd_cliente))];
  let pessoas = {};
  try {
    pessoas = await buscarNomes(codigosNovos);
  } catch (e) {
    console.warn(`⚠️ [esteira-protesto] batch-lookup falhou: ${e.message}`);
  }
  const nomeDe = (cd) =>
    pessoas[String(cd).trim()]?.name || `Cliente ${cd}`;

  const linhas = novos.map((t) => ({
    cd_empresa: t.cd_empresa,
    cd_cliente: String(t.cd_cliente),
    nm_cliente: nomeDe(t.cd_cliente),
    nr_cpfcnpj: t.nr_cpfcnpj || null,
    nr_fat: t.nr_fat || t.nr_fatura,
    nr_parcela: t.nr_parcela || 1,
    nosso_numero: t.nosso_numero || null,
    vl_fatura: Number(t.vl_fatura) || 0,
    vl_juros: Number(t.vl_juros) || 0,
    dt_emissao: t.dt_emissao ? String(t.dt_emissao).slice(0, 10) : null,
    dt_vencimento: t.dt_vencimento ? String(t.dt_vencimento).slice(0, 10) : null,
    cd_portador: t.cd_portador != null ? String(t.cd_portador) : null,
    nm_portador: t.nm_portador || null,
    status: 'pendente',
    user_nome: 'Job automático',
    user_email: 'sistema@crosby',
  }));

  if (dryRun) {
    console.log(
      `🔎 [esteira-protesto] (dry-run) inseriria ${linhas.length} título(s) de ` +
        `${new Set(linhas.map((l) => l.cd_cliente)).size} cliente(s)`,
    );
    resultado.inseridos = linhas.length;
    resultado.clientes = new Set(linhas.map((l) => l.cd_cliente)).size;
    resultado.valorTotal = linhas.reduce((a, l) => a + l.vl_fatura, 0);
    return resultado;
  }

  // 6. Grava. ignoreDuplicates cobre a corrida com um envio manual
  //    acontecendo no mesmo instante.
  const { data: inseridos, error: errIns } = await supabase
    .from('esteira_protesto')
    .upsert(linhas, {
      onConflict: 'cd_empresa,nr_fat,nr_parcela',
      ignoreDuplicates: true,
    })
    .select('cd_cliente, nm_cliente, nr_fat, nr_parcela, vl_fatura');

  if (errIns) throw new Error(`insert na esteira falhou: ${errIns.message}`);

  const gravados = inseridos || [];
  resultado.inseridos = gravados.length;

  if (gravados.length === 0) {
    console.log('✅ [esteira-protesto] nada novo para gravar');
    return resultado;
  }

  // 7. Agrupa por cliente para a notificação
  const porCliente = {};
  gravados.forEach((l) => {
    const k = String(l.cd_cliente);
    if (!porCliente[k]) {
      porCliente[k] = {
        cd_cliente: k,
        nm_cliente: l.nm_cliente,
        titulos: 0,
        valor: 0,
      };
    }
    porCliente[k].titulos += 1;
    porCliente[k].valor += Number(l.vl_fatura) || 0;
  });

  const clientes = Object.values(porCliente).sort((a, b) => b.valor - a.valor);
  resultado.clientes = clientes.length;
  resultado.valorTotal = clientes.reduce((a, c) => a + c.valor, 0);

  // 8. Notifica Financeiro, Admin e Owner
  const topLista = clientes
    .slice(0, 10)
    .map(
      (c) => `• ${c.nm_cliente} — ${c.titulos} título(s), ${fmtMoeda(c.valor)}`,
    )
    .join('\n');
  const resto =
    clientes.length > 10 ? `\n… e mais ${clientes.length - 10} cliente(s).` : '';

  const ok = await criarNotificacaoSistema({
    tipo: 'ESTEIRA_PROTESTO',
    nivel: 'warning',
    titulo: `⚖️ ${clientes.length} cliente(s) para protestar — ${fmtMoeda(resultado.valorTotal)}`,
    mensagem:
      `A varredura da madrugada encontrou ${gravados.length} título(s) elegível(is) ` +
      `a protesto (portador SICREDI ${PORTADOR}, vencidos há mais de ${DIAS_MIN} dias) ` +
      `e já os colocou na Esteira de Protesto.\n\n${topLista}${resto}`,
    roles: ROLES_NOTIFICACAO,
    dados: {
      data: hoje,
      qtd_clientes: clientes.length,
      qtd_titulos: gravados.length,
      valor_total: resultado.valorTotal,
      portador: PORTADOR,
      dias_minimos: DIAS_MIN,
      clientes,
      rota: '/esteira-protesto',
    },
  });
  if (!ok) resultado.falhas++;

  console.log(
    `⚖️ [esteira-protesto] ${gravados.length} título(s) de ${clientes.length} ` +
      `cliente(s) — ${fmtMoeda(resultado.valorTotal)} ` +
      `(analisados ${resultado.titulosAnalisados}, elegíveis ${resultado.elegiveis}, ` +
      `já na esteira ${resultado.jaNaEsteira})`,
  );

  return resultado;
}

export function iniciarJobEsteiraProtesto() {
  if (!HABILITADO) {
    console.log('⏸️ [esteira-protesto] desabilitado por ESTEIRA_PROTESTO_ENABLED');
    return;
  }
  cron.schedule(
    CRON_EXPR,
    async () => {
      if (JOB_EM_EXECUCAO) {
        console.warn('⏭️ [esteira-protesto] ciclo anterior ainda rodando');
        return;
      }
      JOB_EM_EXECUCAO = true;
      try {
        await executarEsteiraProtesto();
      } catch (e) {
        console.error('❌ [esteira-protesto] ciclo falhou:', e.message);
      } finally {
        JOB_EM_EXECUCAO = false;
      }
    },
    { timezone: TZ },
  );
  console.log(
    `⏰ [esteira-protesto] varredura agendada (${CRON_EXPR} ${TZ}, ` +
      `portador ${PORTADOR}, atraso > ${DIAS_MIN}d)`,
  );
}
