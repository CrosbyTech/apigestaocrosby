/**
 * Alerta de vencimento de contrato de aluguel (Despesa Filial).
 *
 * Roda 1x por dia e varre `despesas_fixas_filial` (tipo_despesa = 'ALUGUEL')
 * procurando contratos que vencem dentro da janela de alerta — por padrão
 * 30 dias, ou seja, "falta 1 mês". Para cada um cria uma notificação em
 * `notificacoes_sistema` endereçada a Financeiro, Admin e Owner.
 *
 * Papéis: no AuthContext do front o papel `user` é rotulado "Financeiro"
 * (ver src/components/AuthContext.jsx e src/utils/notificacoesAcesso.js).
 *
 * Dedupe: a coluna `contrato_alerta_vencimento` guarda a data de vencimento
 * já notificada. Enquanto ela for igual a `contrato_vencimento` o contrato é
 * ignorado — então avisa uma vez só. Renovou o contrato (data nova) → o front
 * zera a coluna e o alerta volta a valer no próximo ciclo.
 *
 * O front lê os mesmos dados para piscar o pontinho vermelho no card da filial
 * (src/pages/DespesaFilial.jsx).
 */
import cron from 'node-cron';
import supabase from '../config/supabase.js';
import { criarNotificacaoSistema } from '../services/notificacoesSistema.js';

const CRON_EXPR = process.env.CONTRATO_ALUGUEL_CRON || '0 8 * * *';
const TZ = 'America/Sao_Paulo';
const DIAS_ALERTA = Number(process.env.CONTRATO_ALUGUEL_DIAS_ALERTA || 30);
// owner + admin + user (=Financeiro)
const ROLES_NOTIFICACAO = ['owner', 'admin', 'user'];

let JOB_EM_EXECUCAO = false;

// 'YYYY-MM-DD' no fuso de São Paulo (en-CA já formata assim)
function hojeISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

function somarDias(iso, dias) {
  const [y, m, d] = iso.split('-').map(Number);
  const data = new Date(Date.UTC(y, m - 1, d));
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function diffDias(isoA, isoB) {
  const t = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(isoA) - t(isoB)) / 86400000);
}

function fmtBR(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun] Não notifica nem marca — só loga o que faria.
 */
export async function executarContratoAluguelVencimento({ dryRun = false } = {}) {
  const hoje = hojeISO();
  const limite = somarDias(hoje, DIAS_ALERTA);
  const resultado = {
    janela: `${fmtBR(hoje)} → ${fmtBR(limite)}`,
    encontrados: 0,
    notificados: 0,
    jaNotificados: 0,
    falhas: 0,
    dryRun,
  };

  const { data, error } = await supabase
    .from('despesas_fixas_filial')
    .select(
      'id, cd_filial, nm_fornecedor, cd_fornecedor, contrato_vencimento, contrato_alerta_vencimento, contrato_nome',
    )
    .eq('tipo_despesa', 'ALUGUEL')
    .not('contrato_vencimento', 'is', null)
    .lte('contrato_vencimento', limite)
    .order('contrato_vencimento');

  if (error) throw new Error(`consulta falhou: ${error.message}`);

  const contratos = data || [];
  resultado.encontrados = contratos.length;

  for (const c of contratos) {
    const vencimento = String(c.contrato_vencimento).slice(0, 10);
    const jaAvisado =
      c.contrato_alerta_vencimento &&
      String(c.contrato_alerta_vencimento).slice(0, 10) === vencimento;
    if (jaAvisado) {
      resultado.jaNotificados++;
      continue;
    }

    const dias = diffDias(vencimento, hoje);
    const vencido = dias < 0;
    const titulo = vencido
      ? `🚨 Contrato de aluguel VENCIDO — Filial ${c.cd_filial}`
      : `⚠️ Contrato de aluguel vence em ${dias} dia(s) — Filial ${c.cd_filial}`;
    const mensagem = vencido
      ? `O contrato de aluguel da filial ${c.cd_filial} (${c.nm_fornecedor}) ` +
        `venceu em ${fmtBR(vencimento)}, há ${Math.abs(dias)} dia(s). ` +
        `Verifique a renovação em Despesa Filial → Aluguel.`
      : `O contrato de aluguel da filial ${c.cd_filial} (${c.nm_fornecedor}) ` +
        `vence em ${fmtBR(vencimento)} — faltam ${dias} dia(s). ` +
        `Providencie a renovação em Despesa Filial → Aluguel.`;

    if (dryRun) {
      console.log(`🔎 [contrato-aluguel] (dry-run) notificaria: ${titulo}`);
      resultado.notificados++;
      continue;
    }

    const ok = await criarNotificacaoSistema({
      tipo: 'CONTRATO_ALUGUEL_VENCIMENTO',
      nivel: vencido ? 'error' : 'warning',
      titulo,
      mensagem,
      roles: ROLES_NOTIFICACAO,
      dados: {
        despesa_id: c.id,
        cd_filial: c.cd_filial,
        fornecedor: c.nm_fornecedor,
        cd_fornecedor: c.cd_fornecedor,
        contrato_vencimento: vencimento,
        contrato_nome: c.contrato_nome,
        dias_restantes: dias,
        rota: '/despesa-filial',
      },
    });

    if (!ok) {
      resultado.falhas++;
      continue;
    }

    // Marca o dedupe só depois da notificação ter entrado
    const { error: upErr } = await supabase
      .from('despesas_fixas_filial')
      .update({ contrato_alerta_vencimento: vencimento })
      .eq('id', c.id);
    if (upErr) {
      // Notificou mas não marcou → repetiria amanhã. Loga alto.
      console.error(
        `⚠️ [contrato-aluguel] notificou mas não marcou o dedupe (id=${c.id}): ${upErr.message}`,
      );
    }
    resultado.notificados++;
    console.log(
      `📄 [contrato-aluguel] alerta enviado: filial=${c.cd_filial} ` +
        `fornecedor=${c.nm_fornecedor} vencimento=${fmtBR(vencimento)} (${dias}d)`,
    );
  }

  if (resultado.notificados > 0 || resultado.falhas > 0) {
    console.log(
      `🏠 [contrato-aluguel] ciclo: ${resultado.notificados} notificado(s), ` +
        `${resultado.jaNotificados} já avisado(s), ${resultado.falhas} falha(s) ` +
        `de ${resultado.encontrados} contrato(s) na janela ${resultado.janela}`,
    );
  }

  return resultado;
}

export function iniciarJobContratoAluguelVencimento() {
  cron.schedule(
    CRON_EXPR,
    async () => {
      if (JOB_EM_EXECUCAO) {
        console.warn('⏭️ [contrato-aluguel] ciclo anterior ainda rodando');
        return;
      }
      JOB_EM_EXECUCAO = true;
      try {
        await executarContratoAluguelVencimento();
      } catch (e) {
        console.error('❌ [contrato-aluguel] ciclo falhou:', e.message);
      } finally {
        JOB_EM_EXECUCAO = false;
      }
    },
    { timezone: TZ },
  );
  console.log(
    `⏰ [contrato-aluguel] alerta de vencimento agendado (${CRON_EXPR} ${TZ}, janela ${DIAS_ALERTA}d)`,
  );
}
