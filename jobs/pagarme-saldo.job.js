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
  const expr = process.env.PAGARME_SALDO_CRON || '20 7 * * *';
  cron.schedule(
    expr,
    () => {
      rodarPagarmeSaldo().catch((e) => console.error('[pagarme-saldo] erro:', e.message));
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log(`[pagarme-saldo] agendado (${expr} America/Sao_Paulo)`);
}
