/**
 * Job: concilia os APROVADOS com o extrato bancário e marca PAGO o que já saiu.
 * Horário: todo dia às 09:50 (America/Sao_Paulo), depois da rodada do bot Stone
 * das 09:30 (que importa os extratos do dia).
 *
 * Varre uma JANELA LARGA de saídas (padrão: últimos 45 dias), não só o dia
 * anterior — assim não perde pagamento feito dias antes da aprovação nem
 * extrato importado com atraso. É idempotente: o que já está PAGO/conciliado
 * não é reprocessado.
 *
 * Env: CONCILIACAO_APROVADOS_ENABLED=false (desliga) · _CRON (horário) ·
 *      _DIAS (dias de janela para trás, padrão 45)
 */
import cron from 'node-cron';
import { conciliarAprovados, resumoTexto } from '../services/conciliacaoAprovados.js';

let rodando = false;
let ultimo = { em: null, pagos: null, total: null, erro: null };

export function statusConciliacaoAprovados() {
  return { ultimo };
}

const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const diasAtras = (n) => {
  const d = new Date(`${hojeBr()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

export async function rodarConciliacaoAprovados({ saidaDe, saidaAte, dataSaida, dryRun = false } = {}) {
  if (rodando) return { pulado: true };
  rodando = true;
  try {
    const janelaDias = Number(process.env.CONCILIACAO_APROVADOS_DIAS) || 45;
    // dataSaida ainda é aceito (um dia só); por padrão varre a janela larga
    const de = dataSaida || saidaDe || diasAtras(janelaDias);
    const ate = dataSaida || saidaAte || hojeBr();
    const r = await conciliarAprovados({ saidaDe: de, saidaAte: ate, dryRun, usuario: 'Conciliação de aprovados (job diário)' });
    if (!dryRun) ultimo = { em: new Date().toISOString(), periodo: { de, ate }, pagos: r.pagos, total: r.total, erro: null };
    if (r.pagos) console.log(`[conciliacao-aprovados] ${resumoTexto(r)}`);
    else console.log(`[conciliacao-aprovados] ${de} a ${ate}: nenhum aprovado novo casou com saída.`);
    return r;
  } catch (e) {
    ultimo = { em: new Date().toISOString(), erro: e.message };
    console.error('[conciliacao-aprovados] erro:', e.message);
    throw e;
  } finally {
    rodando = false;
  }
}

export function iniciarJobConciliacaoAprovados() {
  if (String(process.env.CONCILIACAO_APROVADOS_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[conciliacao-aprovados] job desligado (CONCILIACAO_APROVADOS_ENABLED=false)');
    return;
  }
  const expr = process.env.CONCILIACAO_APROVADOS_CRON || '50 9 * * *';
  cron.schedule(expr, () => { rodarConciliacaoAprovados().catch(() => {}); }, { timezone: 'America/Sao_Paulo' });
  console.log(`[conciliacao-aprovados] agendado (${expr} America/Sao_Paulo) — concilia os aprovados do dia anterior`);
}
