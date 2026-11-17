/**
 * Job: CASHBACK dos clientes no saldo do HeadCoach
 * Frequência: todo dia às 05:10 (America/Sao_Paulo)
 *
 * Copia para hc_cliente_saldos (tipo "cashback") o saldo bônus que o TOTVS tem
 * para quem comprou nas lojas ativas nos últimos 90 dias, e acerta quem já
 * tinha cashback guardado (services/hcCashback.js). Só lê o TOTVS. Fica ligado
 * até o TOTVS ser desligado e o cashback passar a nascer no HeadCoach.
 */
import cron from 'node-cron';
import { sincronizarCashback } from '../services/hcCashback.js';

let rodando = false;
export async function rodarCashback() {
  if (rodando) return null;
  rodando = true;
  try {
    const r = await sincronizarCashback({ log: (m) => console.log(`💰 [hc-cashback] ${m}`) });
    console.log(
      `💰 [hc-cashback] ${r.consultados} CPF(s) em ${r.segundos} s · ${r.comSaldo} com cashback · R$ ${r.totalTotvs.toFixed(2)} no TOTVS · ${r.movimentos} acerto(s) · ${r.erros.length} erro(s)`,
    );
    return r;
  } catch (e) {
    console.error(`[hc-cashback] ${e.message}`);
    return null;
  } finally {
    rodando = false;
  }
}

export function iniciarJobHcCashback() {
  console.log('⏰ [hc-cashback] agendado: todo dia às 05:10');
  cron.schedule('10 5 * * *', rodarCashback, { timezone: 'America/Sao_Paulo' });
}
