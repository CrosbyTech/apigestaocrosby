/**
 * Job: worker do outbox HeadCoach → TOTVS. Roda a cada minuto e envia até
 * ERP_OUTBOX_LOTE itens (padrão 20) cuja proxima_tentativa já passou.
 * Desliga com ERP_OUTBOX_ENABLED=false.
 */
import cron from 'node-cron';
import { processarPendentes } from '../services/erp/outbox.js';

const enabled = () => String(process.env.ERP_OUTBOX_ENABLED ?? 'true').toLowerCase() !== 'false';

export function iniciarJobIntegracaoOutbox() {
  if (!enabled()) {
    console.log('⏸️ [outbox] desativado (ERP_OUTBOX_ENABLED=false)');
    return;
  }
  const limite = parseInt(process.env.ERP_OUTBOX_LOTE || '20', 10);
  cron.schedule(
    '* * * * *',
    async () => {
      try {
        const r = await processarPendentes({ limite });
        if (r?.total) console.log(`[outbox] ${JSON.stringify(r)}`);
      } catch (e) {
        console.error('[outbox] erro:', e.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log(`⏰ [outbox] worker a cada minuto (lote ${limite})`);
}
