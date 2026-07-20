/**
 * Job: Provisão automática de Contas a Pagar → Liberação de Pagamento
 * Horário: Todo dia às 07:00 (America/Sao_Paulo)
 *
 * Regra de negócio:
 *  - Busca no Contas a Pagar (TOTVS) os títulos NORMAIS e EM ABERTO cujo
 *    VENCIMENTO cai entre hoje e hoje+3 dias (ou seja, ~3 dias antes de vencer).
 *  - Considera apenas as despesas monitoradas (salários, energia, água,
 *    telefone, internet, vale alimentação/transporte, férias, rescisão).
 *  - Insere os títulos novos em `pagamentos_liberacao` com status PROVISAO.
 *  - Nunca duplica: pula títulos que já existem na Liberação de Pagamento
 *    (mesma duplicata/empresa/fornecedor/parcela/vencimento, exceto CANCELADO).
 *  - Marca cada linha incluída com dados_completos.incluido_por_ia = true,
 *    para exibir a tag "Incluído por IA" na tela.
 */

import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { getBranchesWithNames } from '../totvsrouter/totvsHelper.js';
import { criarNotificacaoSistema } from '../services/notificacoesSistema.js';

// Papéis que recebem a notificação do job (Administrador + Proprietário)
const ROLES_NOTIFICACAO = ['owner', 'admin'];

// ─── Despesas monitoradas (cd_despesaitem) ──────────────────────────────────
// Ver src/config/despesas.json
const EXPENSE_CODES = [
  6010, // ENERGIA ELETRICA
  6011, // AGUA E ESGOTO
  6012, // TELEFONE
  6028, // INTERNET
  3003, // VALE ALIMENTACAO E REFEICAO
  3008, // SALARIOS E ORDENADOS
  3012, // FERIAS
  3022, // RESCISAO CONTRATO DE TRABALHO
  3036, // VALE TRANSPORTE
];

// Duplicatas específicas de RENEGOCIAÇÃO (identificadas por fornecedor + número).
// Diferente das despesas: entram independentemente do código de despesa e da
// janela de 3 dias — são provisionadas enquanto estiverem em aberto.
const RENEGOCIACOES = [
  { cd_fornecedor: 67813, nr_duplicata: '598', nome: 'ELIAN INDUSTRIA TEXTIL LTDA' },
  { cd_fornecedor: 67813, nr_duplicata: '599', nome: 'ELIAN INDUSTRIA TEXTIL LTDA' },
  { cd_fornecedor: 32136, nr_duplicata: '6516', nome: 'RENAUXVIEW' },
  { cd_fornecedor: 30061, nr_duplicata: '414154', nome: 'SUL AMERICA COMPANHIA DE SEGURO SAUDE' },
  { cd_fornecedor: 5520, nr_duplicata: '2', nome: 'EXCIM IMPORTACAO E EXPORTACAO SA' },
  { cd_fornecedor: 30037, nr_duplicata: '651', nome: 'PASSAMANARIA DO NORDESTE S A' },
  { cd_fornecedor: 20950, nr_duplicata: '55', nome: 'ARTECA INDUSTRIAL TEXTIL' },
  { cd_fornecedor: 12839, nr_duplicata: '69', nome: 'TEXILFIO' },
  { cd_fornecedor: 20417, nr_duplicata: '176370690', nome: 'CAIXA ECONOMICA FEDERAL' },
];

// Janela de antecedência (dias). hoje .. hoje+DIAS_ANTECEDENCIA
const DIAS_ANTECEDENCIA = 3;

// As renegociações são pesquisadas no MÊS CORRENTE inteiro (1º ao último dia),
// por vencimento — tanto para trás quanto para frente dentro do mês.

const PORT = process.env.PORT || 4100;
const SELF_BASE_URL = `http://127.0.0.1:${PORT}`;

// ─── Helpers de data ────────────────────────────────────────────────────────
// Data "hoje" no fuso America/Sao_Paulo (en-CA => YYYY-MM-DD)
function hojeSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Primeiro e último dia do mês corrente (fuso America/Sao_Paulo), 'YYYY-MM-DD'.
function limitesMesSaoPaulo() {
  const [y, m] = hojeSaoPaulo().split('-').map(Number); // m = 1..12
  const mm = String(m).padStart(2, '0');
  const ultimoDia = new Date(y, m, 0).getDate(); // dia 0 do mês seguinte = último dia do mês
  return {
    inicio: `${y}-${mm}-01`,
    fim: `${y}-${mm}-${String(ultimoDia).padStart(2, '0')}`,
  };
}

const toDate = (d) => {
  if (!d) return null;
  const s = String(d).split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// ─── Filiais (mesma regra do botão "Filial" do FiltroEmpresa) ───────────────
// code < 5999 e não é marcador de franquia (98, 980)
const FRANQUIA_CODES = [98, 980];
async function obterFiliais() {
  const tokenData = await getToken();
  const branches = await getBranchesWithNames(tokenData?.access_token); // [{ code, name }, ...]
  const filiais = (branches || []).filter((b) => {
    const code = parseInt(b.code, 10);
    return (
      !Number.isNaN(code) && code < 5999 && !FRANQUIA_CODES.includes(code)
    );
  });
  return filiais;
}

// ─── Busca no Contas a Pagar reutilizando o endpoint existente ──────────────
async function buscarContasPagar(branchCodes, dtInicio, dtFim) {
  const payload = {
    dt_inicio: dtInicio,
    dt_fim: dtFim,
    branches: branchCodes,
    modo: 'vencimento',
    situacao: 'N', // Normal
    previsao: 'TODOS',
    filtroPagamento: 'ABERTO',
    expenseCodeList: EXPENSE_CODES,
  };
  const { data } = await axios.post(
    `${SELF_BASE_URL}/api/totvs/accounts-payable/search`,
    payload,
    { headers: { 'Content-Type': 'application/json' }, timeout: 180000 },
  );
  // successResponse => { success, message, data: { ..., data: mappedItems } }
  return data?.data?.data || [];
}

// Busca as duplicatas específicas de renegociação (por fornecedor + número),
// sem filtro de despesa e com janela ampla de vencimento.
async function buscarRenegociacoes(branchCodes) {
  if (RENEGOCIACOES.length === 0) return [];

  const supplierCodeList = [
    ...new Set(RENEGOCIACOES.map((r) => r.cd_fornecedor)),
  ];
  const duplicateCodeList = [
    ...new Set(
      RENEGOCIACOES.map((r) => parseInt(r.nr_duplicata, 10)).filter(
        (n) => !Number.isNaN(n),
      ),
    ),
  ];

  const { inicio, fim } = limitesMesSaoPaulo();
  const payload = {
    dt_inicio: inicio,
    dt_fim: fim,
    branches: branchCodes,
    modo: 'vencimento',
    situacao: 'N',
    previsao: 'TODOS',
    filtroPagamento: 'ABERTO',
    supplierCodeList,
    duplicateCodeList,
  };

  const { data } = await axios.post(
    `${SELF_BASE_URL}/api/totvs/accounts-payable/search`,
    payload,
    { headers: { 'Content-Type': 'application/json' }, timeout: 180000 },
  );
  const itens = data?.data?.data || [];

  // Filtra para os pares EXATOS (fornecedor, duplicata) — o TOTVS pode
  // devolver combinações cruzadas dos dois filtros.
  const alvo = new Set(
    RENEGOCIACOES.map((r) => `${r.cd_fornecedor}|${String(r.nr_duplicata)}`),
  );
  return itens.filter((it) =>
    alvo.has(`${it.cd_fornecedor}|${String(it.nr_duplicata)}`),
  );
}

// ─── Deduplicação contra pagamentos_liberacao ───────────────────────────────
// Mesma chave usada no botão "Enviar para pagamento" (ContasAPagar.jsx):
// nr_duplicata + cd_fornecedor + cd_empresa + nr_parcela + dt_vencimento
function chaveDedup(r) {
  return [
    r.nr_duplicata ?? '',
    r.cd_fornecedor ?? '',
    r.cd_empresa ?? '',
    r.nr_parcela ?? '',
    r.dt_vencimento ?? '',
  ].join('|');
}

async function filtrarNaoDuplicados(registros) {
  const comChave = registros.filter((r) => r.nr_duplicata && r.cd_empresa);
  if (comChave.length === 0) return [];

  const numeros = [...new Set(comChave.map((r) => r.nr_duplicata))];
  const { data: existentes, error } = await supabase
    .from('pagamentos_liberacao')
    .select('nr_duplicata, cd_empresa, nr_parcela, cd_fornecedor, dt_vencimento, status')
    .in('nr_duplicata', numeros)
    .not('status', 'eq', 'CANCELADO');

  if (error) {
    console.error('❌ [provisao-liberacao] Erro ao checar duplicatas:', error.message);
    // Em caso de erro na checagem, aborta para não arriscar duplicar.
    throw error;
  }

  const existentesSet = new Set(
    (existentes || []).map((ex) =>
      chaveDedup({
        nr_duplicata: ex.nr_duplicata,
        cd_fornecedor: ex.cd_fornecedor,
        cd_empresa: ex.cd_empresa,
        nr_parcela: ex.nr_parcela,
        dt_vencimento: ex.dt_vencimento
          ? String(ex.dt_vencimento).split('T')[0]
          : null,
      }),
    ),
  );

  return registros.filter((r) => !existentesSet.has(chaveDedup(r)));
}

// ─── Monta a linha de pagamentos_liberacao a partir do item do TOTVS ────────
function montarRegistro(item, nomeEmpresaMap, nowIso, origem = 'despesa') {
  const cdEmpresa = item.cd_empresa ? parseInt(item.cd_empresa, 10) : null;
  return {
    cd_empresa: cdEmpresa,
    nm_empresa:
      (cdEmpresa != null ? nomeEmpresaMap.get(cdEmpresa) : null) || null,
    nr_duplicata: item.nr_duplicata ? String(item.nr_duplicata) : null,
    nr_parcela: item.nr_parcela ? String(item.nr_parcela) : null,
    nr_portador: item.nr_portador ? String(item.nr_portador) : null,
    cd_fornecedor: item.cd_fornecedor ? String(item.cd_fornecedor) : null,
    nm_fornecedor: item.nm_fornecedor || null,
    cd_despesaitem: item.cd_despesaitem ? String(item.cd_despesaitem) : null,
    ds_despesaitem: item.ds_despesaitem || null,
    cd_ccusto: item.cd_ccusto ? String(item.cd_ccusto) : null,
    dt_emissao: toDate(item.dt_emissao),
    dt_vencimento: toDate(item.dt_vencimento),
    vl_duplicata: parseFloat(item.vl_duplicata || 0),
    status: 'PROVISAO',
    enviado_por: 'IA (provisão automática)',
    enviado_em: nowIso,
    dados_completos: {
      ...item,
      incluido_por_ia: true,
      provisao_automatica: true,
      origem_provisao: origem, // 'despesa' | 'renegociacao'
    },
  };
}

// ─── Lógica principal ───────────────────────────────────────────────────────
// opts.dryRun => não insere, apenas loga o que faria.
// Retorna: { ok, janela, encontrados, novos, jaExistentes, inseridos }
export async function executarProvisaoLiberacao(opts = {}) {
  const dryRun = !!opts.dryRun;
  const dtInicio = opts.dtInicio || hojeSaoPaulo();
  const dtFim = opts.dtFim || addDays(dtInicio, DIAS_ANTECEDENCIA);
  const janela = `${dtInicio} → ${dtFim}`;

  const result = {
    ok: false,
    janela,
    encontrados: 0,
    novos: 0,
    jaExistentes: 0,
    inseridos: 0,
  };

  console.log(
    `\n🕐 [provisao-liberacao] Iniciando${dryRun ? ' (DRY-RUN)' : ''} — vencimento ${janela}`,
  );

  let erroMsg = null;
  let provisionadas = []; // duplicatas efetivamente incluídas nesta execução

  try {
    // 1. Filiais
    const filiais = await obterFiliais();
    const branchCodes = filiais.map((f) => parseInt(f.code, 10));
    const nomeEmpresaMap = new Map(
      filiais.map((f) => [parseInt(f.code, 10), f.name || null]),
    );
    if (branchCodes.length === 0) {
      throw new Error('Nenhuma filial encontrada para consultar.');
    }
    console.log(`🏢 [provisao-liberacao] ${branchCodes.length} filiais consideradas`);

    // 2. Buscar títulos: despesas monitoradas (janela 3 dias) +
    //    renegociações específicas (por fornecedor/duplicata, janela ampla).
    const [itensDespesas, itensReneg] = await Promise.all([
      buscarContasPagar(branchCodes, dtInicio, dtFim),
      buscarRenegociacoes(branchCodes),
    ]);
    result.encontrados = itensDespesas.length + itensReneg.length;
    console.log(
      `📄 [provisao-liberacao] ${itensDespesas.length} despesa(s) + ${itensReneg.length} renegociação(ões)`,
    );

    if (result.encontrados > 0) {
      // 3. Montar registros (marcando a origem) e deduplicar DENTRO da execução
      const nowIso = new Date().toISOString();
      const registrosBrutos = [
        ...itensDespesas.map((it) =>
          montarRegistro(it, nomeEmpresaMap, nowIso, 'despesa'),
        ),
        ...itensReneg.map((it) =>
          montarRegistro(it, nomeEmpresaMap, nowIso, 'renegociacao'),
        ),
      ];
      const vistos = new Set();
      const registros = registrosBrutos.filter((r) => {
        const k = chaveDedup(r);
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      });

      // 4. Deduplicar contra o que já existe na Liberação de Pagamento
      const novos = await filtrarNaoDuplicados(registros);
      result.novos = novos.length;
      result.jaExistentes = registros.length - novos.length;
      console.log(
        `🔍 [provisao-liberacao] ${novos.length} novo(s) · ${result.jaExistentes} já existente(s)`,
      );

      if (dryRun) {
        console.log(
          '🧪 [provisao-liberacao] DRY-RUN — não inserindo. Amostra:',
          novos.slice(0, 5).map((r) => resumoDuplicata(r)),
        );
        provisionadas = novos.map(resumoDuplicata);
        result.ok = true;
      } else if (novos.length > 0) {
        // 5. Inserir em PROVISAO
        const { data: inseridos, error } = await supabase
          .from('pagamentos_liberacao')
          .insert(novos)
          .select('id');
        if (error) {
          throw new Error(`Falha ao inserir em PROVISÃO: ${error.message}`);
        }
        result.inseridos = inseridos?.length || novos.length;
        provisionadas = novos.map(resumoDuplicata);
        result.ok = true;
        console.log(
          `✅ [provisao-liberacao] ${result.inseridos} título(s) incluído(s) em PROVISÃO\n`,
        );
      } else {
        result.ok = true; // nada novo a provisionar
      }
    } else {
      result.ok = true; // nenhum título no período
    }
  } catch (err) {
    erroMsg = err.message;
    console.error('❌ [provisao-liberacao] Erro:', err.message);
  }

  // Notifica Administrador + Proprietário a cada execução REAL (sucesso ou erro).
  // No dry-run apenas logamos, sem gerar notificação.
  if (!dryRun) {
    await notificarResultado(result, provisionadas, erroMsg);
  }

  return result;
}

// Resumo compacto de uma duplicata para exibição/notificação
function resumoDuplicata(r) {
  return {
    empresa: r.cd_empresa,
    nm_empresa: r.nm_empresa || null,
    fornecedor: r.nm_fornecedor || `Cód. ${r.cd_fornecedor || '—'}`,
    duplicata: r.nr_duplicata
      ? `${r.nr_duplicata}${r.nr_parcela ? `/${r.nr_parcela}` : ''}`
      : '—',
    despesa: r.ds_despesaitem || null,
    origem: r.dados_completos?.origem_provisao || 'despesa',
    vencimento: r.dt_vencimento || null,
    valor: parseFloat(r.vl_duplicata || 0),
  };
}

const fmtBRL = (v) =>
  parseFloat(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

// Monta e envia a notificação de sistema (Administrador + Proprietário)
async function notificarResultado(result, provisionadas, erroMsg) {
  const MAX_LISTA = 200; // evita payload gigante no jsonb
  const total = provisionadas.reduce((s, d) => s + (d.valor || 0), 0);

  let nivel;
  let titulo;
  let mensagem;

  if (erroMsg) {
    nivel = 'error';
    titulo = '❌ Provisão automática falhou';
    mensagem = `A rotina de provisão (vencimento ${result.janela}) falhou: ${erroMsg}`;
  } else if (result.inseridos > 0) {
    nivel = 'success';
    titulo = `✅ Provisão automática — ${result.inseridos} título(s)`;
    mensagem =
      `${result.inseridos} título(s) provisionado(s) (${fmtBRL(total)}) ` +
      `com vencimento em ${result.janela}. ` +
      `${result.jaExistentes} já existia(m).`;
  } else {
    nivel = 'info';
    titulo = 'ℹ️ Provisão automática — nenhum título novo';
    mensagem =
      `Rotina executada (vencimento ${result.janela}). ` +
      `${result.encontrados} encontrado(s), nenhum novo para provisionar ` +
      `(${result.jaExistentes} já existia(m)).`;
  }

  await criarNotificacaoSistema({
    tipo: 'PROVISAO_LIBERACAO',
    nivel,
    titulo,
    mensagem,
    roles: ROLES_NOTIFICACAO,
    dados: {
      janela: result.janela,
      encontrados: result.encontrados,
      novos: result.novos,
      jaExistentes: result.jaExistentes,
      inseridos: result.inseridos,
      valorTotal: total,
      erro: erroMsg || null,
      duplicatas: provisionadas.slice(0, MAX_LISTA),
      duplicatasTruncadas: provisionadas.length > MAX_LISTA,
    },
  });
}

// ─── Agendamento ────────────────────────────────────────────────────────────
let JOB_EM_EXECUCAO = false;
async function rodar(label, opts) {
  if (JOB_EM_EXECUCAO) {
    console.log(`⏭️  [provisao-liberacao ${label}] PULADO — execução anterior em andamento`);
    return;
  }
  JOB_EM_EXECUCAO = true;
  try {
    await executarProvisaoLiberacao(opts);
  } catch (e) {
    console.warn(`[provisao-liberacao ${label}] erro: ${e.message}`);
  } finally {
    JOB_EM_EXECUCAO = false;
  }
}

export function iniciarJobProvisaoLiberacao() {
  // Todo dia às 07:00 BRT
  cron.schedule(
    '0 7 * * *',
    () => rodar('diário', {}),
    { timezone: 'America/Sao_Paulo' },
  );
  console.log('⏰ [provisao-liberacao] Agendado para 07:00 BRT (vencimento hoje..+3d)');
}
