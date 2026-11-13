/**
 * Job: CREDEV das devoluções no saldo do HeadCoach
 * Frequência: a cada 10 minutos
 *
 * Devolução atendida depois da carga inicial soma ao CREDEV do cliente na
 * empresa dela; devolução cancelada depois de creditada sai de novo. A tela de
 * Devoluções já faz isso na hora; o job cobre o que escapar.
 */
import cron from 'node-cron';
import { sincronizarDevolucoes } from '../services/hcSaldosClientes.js';

let rodando = false;
async function rodar() {
  if (rodando) return;
  rodando = true;
  try {
    const r = await sincronizarDevolucoes();
    if (r.creditadas || r.descreditadas || r.erros?.length) {
      console.log(`💳 [hc-saldos-clientes] ${r.creditadas} devolução(ões) creditada(s), ${r.descreditadas} desfeita(s), ${r.erros?.length || 0} erro(s)`);
    }
  } catch (e) {
    if (e.code !== 'MIGRATION_PENDING') console.error('[hc-saldos-clientes]', e.message);
  } finally {
    rodando = false;
  }
}

export function iniciarJobHcSaldosClientes() {
  console.log('⏰ [hc-saldos-clientes] agendado: a cada 10 minutos');
  cron.schedule('*/10 * * * *', rodar, { timezone: 'America/Sao_Paulo' });
  setTimeout(rodar, 150 * 1000);
}
