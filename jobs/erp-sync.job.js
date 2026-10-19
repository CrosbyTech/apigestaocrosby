/**
 * Job: sync TOTVS → HeadCoach dos cadastros mestres (ERP fase 0).
 *
 *   * a cada hora (minuto 35)  — delta das entidades que têm filtro de alteração
 *                                 (pessoas PF/PJ, produtos, preços, despesas/centros)
 *   * 04:30 diário              — full das dimensões pequenas (empresas, cores, grades,
 *                                 unidades, classificações, tabelas, operações,
 *                                 condições, portadores, representantes, vendedores)
 *   * domingo 05:00             — full de custos (e preços de tabela, se configurado)
 *   * :05 e :35                 — contas a pagar (accounts_payable_duplicates), fase 1
 *   * :10 :25 :40 :55           — contas a receber (accounts_receivable_documents), fase 1
 *   * :00 :15 :30 :45           — transações das 290 empresas + saldo de bônus de quem movimentou
 *   * :50                       — vouchers (lista inteira)
 *
 * Desliga com ERP_SYNC_ENABLED=false. A carga inicial completa é manual:
 *   node scripts/erp-carga-inicial.mjs   ou   POST /api/erp/sync/run-all {modo:'full'}
 */
import cron from 'node-cron';
import { executarVarios, ENTIDADES_DELTA, ENTIDADES_PEQUENAS } from '../services/erp/sync/runner.js';

const TZ = 'America/Sao_Paulo';
const enabled = () => String(process.env.ERP_SYNC_ENABLED ?? 'true').toLowerCase() !== 'false';

export function iniciarJobErpSync() {
  if (!enabled()) {
    console.log('⏸️ [erp-sync] desativado (ERP_SYNC_ENABLED=false)');
    return;
  }
  cron.schedule('35 * * * *', () => executarVarios(ENTIDADES_DELTA, 'delta', { disparadoPor: 'cron-delta' }).catch((e) => console.error('[erp-sync delta]', e.message)), { timezone: TZ });
  cron.schedule('30 4 * * *', () => executarVarios(ENTIDADES_PEQUENAS, 'full', { disparadoPor: 'cron-full-dimensoes' }).catch((e) => console.error('[erp-sync full]', e.message)), { timezone: TZ });
  cron.schedule('0 5 * * 0', () => executarVarios(['custos', 'precos_tabela'], 'full', { disparadoPor: 'cron-full-semanal' }).catch((e) => console.error('[erp-sync semanal]', e.message)), { timezone: TZ });
  // Contas a pagar (fase 1, marco 0 = 17/10/2026): incremental a cada 30 min
  // (alterações + janela de emissão + janela de liquidação — ver services/erp/contasPagar.js)
  cron.schedule('5,35 * * * *', () => executarVarios(['contas_pagar'], 'delta', { disparadoPor: 'cron-contas-pagar' }).catch((e) => console.error('[erp-sync contas_pagar]', e.message)), { timezone: TZ });
  // Contas a receber (fase 1, marco 0 = 17/10/2026): incremental a cada 15 min
  cron.schedule('10,25,40,55 * * * *', () => executarVarios(['contas_receber'], 'delta', { disparadoPor: 'cron-contas-receber' }).catch((e) => console.error('[erp-sync contas_receber]', e.message)), { timezone: TZ });
  // Vendas (fase 1): transações das 290 empresas e, em seguida, o saldo de bônus de quem movimentou
  cron.schedule('0,15,30,45 * * * *', () => executarVarios(['transacoes', 'bonus_saldo'], 'delta', { disparadoPor: 'cron-vendas' }).catch((e) => console.error('[erp-sync vendas]', e.message)), { timezone: TZ });
  // Vouchers: lista inteira a cada hora (a API não filtra por alteração)
  cron.schedule('50 * * * *', () => executarVarios(['vouchers'], 'full', { disparadoPor: 'cron-vouchers' }).catch((e) => console.error('[erp-sync vouchers]', e.message)), { timezone: TZ });
  console.log('⏰ [erp-sync] delta :35/h · dimensões 04:30 · custos dom 05:00 · contas a pagar :05/:35 · contas a receber e vendas a cada 15 min · vouchers :50');
}
