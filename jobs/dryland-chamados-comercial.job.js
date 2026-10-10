/**
 * Job: roteia os chamados COMERCIAIS que caem no Financeiro do Dryland
 * Frequência: a cada 10 minutos
 *
 * Problema que resolve:
 *  O Dryland abre automaticamente um chamado no setor FINANCEIRO toda vez que
 *  um pedido precisa de conferência antes de faturar, ou quando a NF trava na
 *  SEFAZ. Isso é trabalho do time comercial, não do financeiro — e em set/2026
 *  o Dryland criou três setores próprios pra isso. Este job move cada chamado
 *  desses para o setor do canal certo.
 *
 * Canal (lido do assunto + texto do chamado):
 *    MTM / multimarcas  → comercial-mtm
 *    FRANQUIA           → comercial-franquia
 *    REVENDA            → comercial-revenda
 *    nenhum reconhecido → comercial-mtm (padrão definido pelo Yago)
 *
 * O QUE NÃO É TOCADO (fica no financeiro):
 *  - NOTA FISCAL ... pendente de ESCRITURAÇÃO  → regra explícita do Yago
 *  - Pedido de TRANSFERÊNCIA entre lojas — o próprio assunto diz "não é venda"
 *  - TEF, rede e afins — é chamado de tecnologia parado no financeiro
 *  - Depósito, divergência de caixa, venda sem lançamento, crédito,
 *    cancelamento/duplicidade de NF — financeiro de verdade
 *  - Qualquer chamado já concluído ou cancelado
 */

import cron from 'node-cron';
import axios from 'axios';
import { criarNotificacaoSistema } from '../services/notificacoesSistema.js';

const DRYLAND_URL =
  process.env.DRYLAND_SUPABASE_URL || 'https://umhczriycvtagjqjnrzm.supabase.co';
const DRYLAND_KEY =
  process.env.DRYLAND_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaGN6cml5Y3Z0YWdqcWpucnptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTAyOTEsImV4cCI6MjA5MzIyNjI5MX0.SVWG6_7DZNv-Tz4AgRwQ1791lAEWgpcEv15k9rERlwI';

const SETOR_ORIGEM = 'financeiro';
const PADRAO = 'comercial-mtm';
const AUTOR = 'HeadCoach (automático)';

// teto por ciclo: se algo der errado na regra, não reorganiza a fila inteira
const MAX_POR_CICLO = 20;

const ROLES_NOTIFICACAO = ['user', 'admin', 'owner'];

const semAcento = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

// ─── Quem NÃO sai do financeiro ───────────────────────────────
// Ordem importa: o primeiro que casar decide, e o motivo vai no relatório.
const EXCLUSOES = [
  { motivo: 'pendente de escrituração', quando: (t) => /escritura/.test(t) },
  {
    motivo: 'transferência entre lojas (não é venda)',
    quando: (t) => /transferencia/.test(t) || /nao e venda/.test(t),
  },
  { motivo: 'chamado de TEF/rede', quando: (t) => /\btef\b|acesso da rede/.test(t) },
  { motivo: 'depósito', quando: (t) => /deposito/.test(t) },
  { motivo: 'caixa', quando: (t) => /caixa/.test(t) },
  { motivo: 'venda sem lançamento', quando: (t) => /venda[s]? sem lancamento/.test(t) },
  { motivo: 'lançamento de crédito', quando: (t) => /credito/.test(t) },
  {
    motivo: 'cancelamento/duplicidade de NF',
    quando: (t) => /cancelamento da nf|duplicidade de nf|cancelar.*\bnf\b/.test(t),
  },
];

// ─── Quem é assunto comercial ─────────────────────────────────
// Só estes saem do financeiro. Qualquer coisa fora disso fica onde está —
// é mais seguro deixar um chamado comercial parado do que mandar um chamado
// do financeiro pro time errado.
// Lista FECHADA (definida pelo Yago em 10/10): só estas três famílias saem
// do financeiro. Qualquer outro assunto fica onde está, mesmo começando com
// "Pedido" — transferência entre lojas, por exemplo, não é venda.
const PADROES_COMERCIAIS = [
  { nome: 'conferir antes de faturar', quando: (t) => /conferir antes de faturar/.test(t) },
  { nome: 'NF travada na SEFAZ', quando: (t) => /travada na sefaz/.test(t) },
  { nome: 'IE irregular na SEFAZ', quando: (t) => /irregular na sefaz/.test(t) },
];

const CANAIS = [
  { setor: 'comercial-franquia', quando: (t) => /franquia/.test(t) },
  { setor: 'comercial-revenda', quando: (t) => /revenda/.test(t) },
  { setor: 'comercial-mtm', quando: (t) => /\bmtm\b|multimarca/.test(t) },
];

/**
 * Prazo novo = 3 dias ÚTEIS a partir de hoje, às 18h de Brasília (mesma
 * convenção do Dryland). O cálculo parte do "hoje" em São Paulo, não do fuso
 * do servidor — o Render roda em UTC e viraria o dia antes da hora.
 * Considera só sábado/domingo; feriado não entra (o Dryland também não trata).
 */
export function prazoEm3DiasUteis(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(agora)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});

  const d = new Date(
    Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day)),
  );
  let uteis = 0;
  while (uteis < 3) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) uteis++;
  }
  return `${d.toISOString().slice(0, 10)}T18:00:00-03:00`;
}

/**
 * Classifica um chamado. Devolve { rotear, setor, canal, motivo }.
 * Exportado porque o endpoint de simulação usa a MESMA função — a prévia que
 * o usuário aprova é exatamente o que o job vai fazer.
 */
export function classificar(chamado) {
  // De propósito só o ASSUNTO decide se roteia: ele é gerado pelo robô do
  // Dryland e tem formato previsível. O texto é livre — uma palavra solta
  // ("caixa", "crédito") no corpo de um pedido legítimo o excluiria por engano.
  const assunto = semAcento(chamado.assunto);
  // O corpo entra só para achar o canal, quando o assunto não revela.
  const corpo = semAcento(chamado.texto);

  for (const ex of EXCLUSOES) {
    if (ex.quando(assunto)) return { rotear: false, motivo: ex.motivo };
  }

  const padrao = PADROES_COMERCIAIS.find((p) => p.quando(assunto));
  if (!padrao) return { rotear: false, motivo: 'não é assunto comercial' };

  const canal =
    CANAIS.find((c) => c.quando(assunto)) || CANAIS.find((c) => c.quando(corpo));
  return {
    rotear: true,
    setor: canal ? canal.setor : PADRAO,
    canal: canal ? canal.setor.replace('comercial-', '') : 'não identificado → mtm',
    motivo: padrao.nome,
    // vencido ganha fôlego de 3 dias úteis; quem está no prazo não é mexido
    renovaPrazo: !!chamado.atrasado,
  };
}

async function rpc(fn, args = {}) {
  const { data } = await axios.post(`${DRYLAND_URL}/rest/v1/rpc/${fn}`, args, {
    headers: {
      'Content-Type': 'application/json',
      apikey: DRYLAND_KEY,
      Authorization: `Bearer ${DRYLAND_KEY}`,
    },
    timeout: 30000,
  });
  return data;
}

/**
 * @param {Object} opts
 * @param {boolean} opts.simular  true = só devolve o que faria, não grava
 */
export async function rotearComerciais({ simular = true } = {}) {
  const lista = await rpc('chamado_listar', {});
  if (!Array.isArray(lista)) throw new Error('chamado_listar não devolveu lista');

  const abertos = lista.filter(
    (c) =>
      c.setor === SETOR_ORIGEM &&
      c.status !== 'concluido' &&
      c.status !== 'cancelado',
  );

  const mover = [];
  const ficam = [];
  for (const c of abertos) {
    const r = classificar(c);
    (r.rotear ? mover : ficam).push({ chamado: c, ...r });
  }

  const alvos = mover.slice(0, MAX_POR_CICLO);
  const cortados = mover.length - alvos.length;

  if (simular) {
    return {
      simulacao: true,
      total: mover.length,
      mover: alvos,
      ficam,
      cortados,
      novoPrazo: prazoEm3DiasUteis(),
    };
  }

  const novoPrazo = prazoEm3DiasUteis();
  const aplicados = [];
  const falhas = [];
  for (const m of alvos) {
    try {
      const r = await rpc('chamado_atualizar', {
        p_id: m.chamado.id,
        p_patch: (() => {
          const patch = {
            setor: m.setor,
            comentario: `Encaminhado automaticamente do Financeiro para ${m.setor} (canal: ${m.canal}).`,
          };
          if (m.renovaPrazo) {
            patch.prazo = novoPrazo;
            // sem justificativa a RPC do Dryland devolve ok:true e IGNORA o prazo
            patch.prazo_justificativa =
              'Chamado vencido ao ser encaminhado do Financeiro para o Comercial — prazo renovado em 3 dias úteis.';
          }
          return patch;
        })(),
        p_por: AUTOR,
      });
      if (r && r.ok)
        aplicados.push({
          numero: m.chamado.numero,
          setor: m.setor,
          prazo_renovado: m.renovaPrazo ? novoPrazo.slice(0, 10) : null,
        });
      else falhas.push({ numero: m.chamado.numero, erro: (r && (r.mensagem || r.erro)) || 'recusado' });
    } catch (e) {
      falhas.push({ numero: m.chamado.numero, erro: e.message });
    }
  }

  if (aplicados.length > 0) {
    const porSetor = aplicados.reduce((acc, a) => {
      acc[a.setor] = (acc[a.setor] || 0) + 1;
      return acc;
    }, {});
    await criarNotificacaoSistema({
      tipo: 'DRYLAND_CHAMADO_ROTEADO',
      nivel: 'info',
      titulo: `${aplicados.length} chamado(s) do Financeiro encaminhados ao Comercial`,
      mensagem: Object.entries(porSetor)
        .map(([s, n]) => `${n} para ${s}`)
        .join(' · '),
      roles: ROLES_NOTIFICACAO,
      dados: { aplicados, falhas, por_setor: porSetor },
    });
  }

  return { simulacao: false, total: mover.length, aplicados, falhas, cortados };
}

let EM_EXECUCAO = false;
async function rodar() {
  if (EM_EXECUCAO) {
    console.log('[dryland-comercial] ciclo anterior ainda rodando — pulando.');
    return;
  }
  EM_EXECUCAO = true;
  try {
    const r = await rotearComerciais({ simular: false });
    if (r.aplicados.length || r.falhas.length) {
      console.log(
        `⏰ [dryland-comercial] ${r.aplicados.length} encaminhado(s)` +
          (r.falhas.length ? `, ${r.falhas.length} falha(s)` : ''),
      );
    }
  } catch (e) {
    // um ciclo perdido não derruba nada: o próximo tenta de novo
    console.error('[dryland-comercial] falha no ciclo:', e.message);
  } finally {
    EM_EXECUCAO = false;
  }
}

export function iniciarJobDrylandComercial() {
  cron.schedule('*/10 * * * *', rodar, { timezone: 'America/Sao_Paulo' });
  console.log(
    '⏰ [dryland-comercial] Agendado a cada 10min · financeiro → comercial-{mtm,revenda,franquia}',
  );
}
