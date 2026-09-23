/**
 * Fechamento mensal do faturamento por vendedor.
 *
 * Roda todo dia de madrugada e grava em `faturamento_vendedor_mensal` todo
 * mês que já fechou (terminou há mais de 10 dias) e ainda não está no banco.
 * Na primeira execução isso faz o backfill do ano inteiro; depois é uma
 * gravação por mês, no dia 11.
 *
 * Mês fechado não muda mais, então a página lê o histórico do banco em
 * milissegundos em vez dos 50-110 s por mês que a rota do TOTVS custa.
 *
 * CONFIG
 *   FAT_VEND_MENSAL_CRON    default '0 3 * * *'
 *   FAT_VEND_MENSAL_DESDE   default '2025-01'
 *   FAT_VEND_DIAS_CARENCIA  default 10
 */
import cron from 'node-cron';
import { fecharMesesPendentes } from '../services/faturamentoVendedorMensal.js';

const CRON_EXPR = process.env.FAT_VEND_MENSAL_CRON || '0 3 * * *';
const DESDE = process.env.FAT_VEND_MENSAL_DESDE || '2025-01';
const TZ = 'America/Sao_Paulo';

let RODANDO = false;

export function iniciarJobFaturamentoVendedorMensal() {
  cron.schedule(
    CRON_EXPR,
    async () => {
      if (RODANDO) {
        console.warn('⏭️ [fat-vend-mensal] ciclo anterior ainda rodando');
        return;
      }
      RODANDO = true;
      try {
        const r = await fecharMesesPendentes(DESDE);
        if (r.gravados.length > 0 || r.falhas.length > 0) {
          console.log(
            `💾 [fat-vend-mensal] ${r.gravados.length} mes(es) gravado(s), ` +
              `${r.falhas.length} falha(s) de ${r.pendentes} pendente(s)`,
          );
        }
      } catch (e) {
        console.error('❌ [fat-vend-mensal] ciclo falhou:', e.message);
      } finally {
        RODANDO = false;
      }
    },
    { timezone: TZ },
  );
  console.log(
    `⏰ [fat-vend-mensal] fechamento agendado (${CRON_EXPR} ${TZ}, desde ${DESDE})`,
  );
}
