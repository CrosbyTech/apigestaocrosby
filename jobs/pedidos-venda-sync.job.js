/**
 * Job: Pedidos de venda do Dryland → HeadCoach
 * Frequência: a cada 5 minutos
 *
 * Copia os pedidos do Dryland (lv_sep_listar: o que o vendedor separa e
 * confirma em dryland-missao-separacao/separar) para pedidos_venda_dryland.
 * Rodar sempre garante o histórico mesmo quando o Dryland tira o pedido da
 * tela. A página /expedicao/pedidos-venda também pode disparar na hora.
 */
import cron from 'node-cron';
import { sincronizarComTrava } from '../routes/pedidosVenda.routes.js';

async function rodar() {
  try {
    const r = await sincronizarComTrava();
    if (r && !r.emAndamento && (r.sumiram || r.itensSumiram)) {
      console.log(`🔄 [pedidos-venda-sync] ${r.pedidos} pedido(s) · ${r.sumiram} saíram do Dryland`);
    }
  } catch (e) {
    console.error('[pedidos-venda-sync]', e.message);
  }
}

export function iniciarJobPedidosVendaSync() {
  console.log('⏰ [pedidos-venda-sync] agendado: a cada 5 minutos');
  cron.schedule('*/5 * * * *', rodar, { timezone: 'America/Sao_Paulo' });
  setTimeout(rodar, 60 * 1000);
}
