/**
 * Job: saldo + extrato das contas Pagar.me → Liberação de Pagamento / Extrato Bancário
 * Horário: todo dia às 07:20 (America/Sao_Paulo) — antes do bot Stone (07:30),
 * que também dispara a mesma rotina no fim da execução dele (com log junto).
 * Desligar: PAGARME_SALDO_JOB_ENABLED=false. Horário: PAGARME_SALDO_CRON.
 */
import cron from 'node-cron';
import { executarPagarme } from '../services/pagarmeConta.js';

let rodando = false;

export async function rodarPagarmeSaldo(opts = {}) {
  if (rodando) return { pulado: true };
  rodando = true;
  try {
    return await executarPagarme(opts);
  } finally {
    rodando = false;
  }
}

export function iniciarJobPagarmeSaldo() {
  if (String(process.env.PAGARME_SALDO_JOB_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[pagarme-saldo] job desligado (PAGARME_SALDO_JOB_ENABLED=false)');
    return;
  }
  // 3x ao dia, 10 min antes do bot Stone (09:30 / 14:00 / 18:00) — várias expressões separadas por ";"
  const exprs = String(process.env.PAGARME_SALDO_CRON || '20 9 * * *;50 13 * * *;50 17 * * *')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const expr of exprs) {
    cron.schedule(
      expr,
      () => {
        rodarPagarmeSaldo().catch((e) => console.error('[pagarme-saldo] erro:', e.message));
      },
      { timezone: 'America/Sao_Paulo' },
    );
  }
  console.log(`[pagarme-saldo] agendado (${exprs.join(' | ')} America/Sao_Paulo)`);
}
