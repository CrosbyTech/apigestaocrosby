/**
 * Job: concilia os APROVADOS do dia anterior com o extrato bancário.
 * Horário: todo dia às 09:50 (America/Sao_Paulo), depois da rodada do bot Stone
 * das 09:30 (que importa os extratos do dia). Marca como PAGO os títulos
 * APROVADO cuja saída (Stone/Sicredi) foi identificada ONTEM.
 *
 * Desligar: CONCILIACAO_APROVADOS_ENABLED=false · Horário: CONCILIACAO_APROVADOS_CRON
 */
import cron from 'node-cron';
import { conciliarAprovados, resumoTexto } from '../services/conciliacaoAprovados.js';

let rodando = false;
let ultimo = { em: null, pagos: null, total: null, erro: null };

export function statusConciliacaoAprovados() {
  return { ultimo };
}

const ontemBr = () => {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export async function rodarConciliacaoAprovados({ dataSaida, dryRun = false } = {}) {
  if (rodando) return { pulado: true };
  rodando = true;
  try {
    const dia = dataSaida || ontemBr();
    const r = await conciliarAprovados({ dataSaida: dia, dryRun, usuario: 'Conciliação de aprovados (job diário)' });
    if (!dryRun) ultimo = { em: new Date().toISOString(), dia, pagos: r.pagos, total: r.total, erro: null };
    if (r.pagos) console.log(`[conciliacao-aprovados] ${resumoTexto(r)}`);
    else console.log(`[conciliacao-aprovados] ${dia}: nenhum aprovado casou com saída do dia.`);
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
