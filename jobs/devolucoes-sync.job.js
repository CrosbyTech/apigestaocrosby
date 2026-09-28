/**
 * Job: Devoluções de mercadoria × chamados do Dryland
 * Frequência: a cada 5 minutos
 *
 * Solicitação de devolução POR DEFEITO abre um chamado para a Produção no
 * Dryland. Quando a Produção conclui o chamado, a solicitação passa para
 * "aguardando_devolucao" e aparece na fila da Devolução RFID; se o chamado é
 * cancelado, a solicitação é cancelada. A mesma sincronização roda ao abrir a
 * página /devolucoes-mercadoria — este job garante que aconteça mesmo com a
 * página fechada (e dispara a notificação no sino).
 */
import cron from 'node-cron';
import { sincronizarChamados } from '../services/devolucoesMercadoria.js';

let EM_EXECUCAO = false;

async function rodar() {
  if (EM_EXECUCAO) return;
  EM_EXECUCAO = true;
  try {
    const r = await sincronizarChamados();
    if (r.verificadas > 0) {
      console.log(`🔄 [devolucoes-sync] ${r.verificadas} pendente(s) · ${r.liberadas.length} liberada(s) · ${r.canceladas.length} cancelada(s)`);
    }
  } catch (e) {
    // Tabela ainda não criada ou Dryland fora: só loga, tenta no próximo ciclo
    console.error('[devolucoes-sync]', e.message);
  } finally {
    EM_EXECUCAO = false;
  }
}

export function iniciarJobDevolucoesSync() {
  console.log('⏰ [devolucoes-sync] agendado: a cada 5 minutos');
  cron.schedule('*/5 * * * *', rodar, { timezone: 'America/Sao_Paulo' });
  setTimeout(rodar, 45 * 1000);
}
