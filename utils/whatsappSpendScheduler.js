import cron from 'node-cron';
import { logger } from './errorHandler.js';
import { syncWhatsappSpend } from '../routes/meta.routes.js';

/**
 * Scheduler de sincronização diária de gastos WhatsApp (pricing_analytics).
 * Roda às 03:00 America/Sao_Paulo e re-sincroniza os últimos 3 dias
 * (janela de segurança caso a Meta atualize valores retroativos).
 */
export const startWhatsappSpendScheduler = () => {
  const cronExpression = '0 3 * * *';

  const task = cron.schedule(
    cronExpression,
    async () => {
      const end = new Date();
      const start = new Date(end.getTime() - 3 * 86400000);
      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);

      logger.info('💬 ========================================');
      logger.info(`💬 Sync gastos WhatsApp: ${startStr} a ${endStr}`);

      try {
        const result = await syncWhatsappSpend(startStr, endStr);
        logger.info(`💬 Sync OK: ${result.totalRows} linhas`);
        for (const a of result.accounts) {
          if (a.error) logger.warn(`💬   [${a.id}] ${a.name}: ${a.error}`);
          else          logger.info(`💬   [${a.id}] ${a.name}: ${a.rows} linhas`);
        }
      } catch (err) {
        logger.error(`💬 Sync FALHOU: ${err.message}`);
      }
      logger.info('💬 ========================================');
    },
    { scheduled: true, timezone: 'America/Sao_Paulo' },
  );

  task.start();
  logger.info('💬 Scheduler de gastos WhatsApp INICIADO (03:00 America/Sao_Paulo)');
  return task;
};
