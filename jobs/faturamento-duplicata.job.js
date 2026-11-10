/**
 * Job: assinatura das duplicatas do faturamento da expedição
 * Frequência: a cada 10 minutos
 *
 * Confere no Autentique as duplicatas enviadas pelo HeadCoach e ainda sem
 * assinatura. Quando o cliente assina, grava aqui e no card do Dryland
 * (duplicata_assinada_em), que é o que libera a expedição do pedido.
 */
import cron from 'node-cron';
import { conferirAssinaturas } from '../services/faturamentoDuplicata.js';

let rodando = false;
async function rodar() {
  if (rodando) return;
  rodando = true;
  try {
    const r = await conferirAssinaturas();
    if (r.assinadas) console.log(`✍️ [faturamento-duplicata] ${r.assinadas} duplicata(s) assinada(s) de ${r.conferidas} conferida(s)`);
  } catch (e) {
    console.error('[faturamento-duplicata]', e.message);
  } finally {
    rodando = false;
  }
}

export function iniciarJobFaturamentoDuplicata() {
  console.log('⏰ [faturamento-duplicata] agendado: a cada 10 minutos');
  cron.schedule('*/10 * * * *', rodar, { timezone: 'America/Sao_Paulo' });
  setTimeout(rodar, 90 * 1000);
}
