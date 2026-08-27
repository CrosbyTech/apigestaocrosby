// Cron: sincroniza os documentos fiscais destinados aos CNPJs próprios
// via SEFAZ Distribuição DFe, de hora em hora (regra anti-abuso da SEFAZ).
import cron from 'node-cron';
import { sincronizarTodos } from '../services/sefazDfe.js';

let agendado = false;
let executando = false;

export async function executarSyncSefazDfe() {
  if (executando) {
    console.warn('[sefaz-dfe] já executando — pulando');
    return { ok: false, erro: 'já em execução' };
  }
  executando = true;
  try {
    return await sincronizarTodos();
  } catch (e) {
    console.error('[sefaz-dfe] falhou:', e.message);
    return { ok: false, erro: e.message };
  } finally {
    executando = false;
  }
}

export function iniciarCronSefazDfe() {
  if (agendado) return;
  agendado = true;
  // A cada hora, no minuto 7 (evita colidir com outros jobs de hora cheia)
  cron.schedule(
    '7 * * * *',
    async () => {
      try {
        await executarSyncSefazDfe();
      } catch (e) {
        console.error('[sefaz-dfe cron] falhou:', e.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log('[sefaz-dfe] cron agendado: a cada hora (min 7, BRT)');

  // Primeira sincronização 30s após o boot (carga inicial de até 90 dias)
  setTimeout(() => {
    executarSyncSefazDfe().catch((e) =>
      console.error('[sefaz-dfe boot] falhou:', e.message),
    );
  }, 30000);
}
