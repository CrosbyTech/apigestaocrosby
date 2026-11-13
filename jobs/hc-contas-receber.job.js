/**
 * Job: títulos do contas a receber do HeadCoach
 * Frequência: a cada 5 minutos
 *
 * Garante que toda venda do HeadCoach com nota autorizada tenha os títulos
 * (a emissão já gera na hora; isto cobre o que escapou) e que venda cancelada
 * tenha os títulos cancelados. Olha os últimos 45 dias.
 */
import cron from 'node-cron';
import { gerarTitulosPendentes } from '../services/hcContasReceber.js';

let rodando = false;
async function rodar() {
  if (rodando) return;
  rodando = true;
  try {
    const r = await gerarTitulosPendentes({ dias: 45 });
    if (r.titulosCriados || r.vendasCanceladas || r.erros.length) {
      console.log(`📗 [hc-contas-receber] ${r.titulosCriados} título(s) em ${r.vendasComTitulos} venda(s) · ${r.vendasCanceladas} cancelada(s) · ${r.erros.length} erro(s)`);
    }
  } catch (e) {
    if (e.code !== 'MIGRATION_PENDING') console.error('[hc-contas-receber]', e.message);
  } finally {
    rodando = false;
  }
}

export function iniciarJobHcContasReceber() {
  console.log('⏰ [hc-contas-receber] agendado: a cada 5 minutos');
  cron.schedule('*/5 * * * *', rodar, { timezone: 'America/Sao_Paulo' });
  setTimeout(rodar, 120 * 1000);
}
