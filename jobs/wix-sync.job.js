// Cron: sincroniza pedidos do Wix de hora em hora (incremental).
// Pega só pedidos criados desde o último sync — barato.
import cron from 'node-cron';
import { syncPedidosWix, ultimaDataSyncada } from '../services/wix.js';

let agendado = false;
let executando = false;

export async function executarSyncWix({ full = false } = {}) {
  if (executando) {
    console.warn('[wix-sync] já executando — pulando');
    return { ok: false, erro: 'já em execução' };
  }
  executando = true;
  try {
    let desdeData = null;
    if (!full) {
      const ultima = await ultimaDataSyncada();
      if (ultima) {
        // Pega 1 dia antes do último pra cobrir possíveis atualizações
        const d = new Date(ultima);
        d.setUTCDate(d.getUTCDate() - 1);
        desdeData = d.toISOString();
      }
    }
    return await syncPedidosWix({ desdeData });
  } catch (e) {
    console.error('[wix-sync] falhou:', e.message);
    return { ok: false, erro: e.message };
  } finally {
    executando = false;
  }
}

export function iniciarCronWixSync() {
  if (agendado) return;
  agendado = true;
  // A cada 15 minutos
  cron.schedule(
    '*/15 * * * *',
    async () => {
      try {
        await executarSyncWix();
      } catch (e) {
        console.error('[wix-sync cron] falhou:', e.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log('[wix-sync] cron agendado: a cada 15 min (BRT)');
}
