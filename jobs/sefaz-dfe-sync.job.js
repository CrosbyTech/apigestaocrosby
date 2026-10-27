// Cron: sincroniza os documentos fiscais destinados aos CNPJs próprios
// via SEFAZ Distribuição DFe.
//
// Janela noturna (Niziany, 27/10/2026): o FISFP153 do TOTVS consome a mesma
// cota da Distribuição DFe; duas consultas do mesmo CNPJ em menos de 1 h
// geram "Consumo Indevido" (656) para a segunda. Por isso o automático roda
// só às 05:07 e 21:07 BRT (SEFAZ_SYNC_CRON para mudar) e, de dia, só o
// botão "Sincronizar SEFAZ" da tela.
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
  // Producao e o ambiente local compartilham o mesmo banco e os mesmos CNPJs.
  // Duas instancias consultando a SEFAZ em paralelo dobram as chamadas e
  // levam a 656, entao o ambiente que nao deve sincronizar seta
  // SEFAZ_SYNC_ENABLED=false.
  if (process.env.SEFAZ_SYNC_ENABLED === 'false') {
    console.log('[sefaz-dfe] cron desabilitado (SEFAZ_SYNC_ENABLED=false)');
    return;
  }
  agendado = true;
  // Minuto 7 evita colidir com outros jobs de hora cheia
  const expressao = process.env.SEFAZ_SYNC_CRON || '7 5,21 * * *';
  cron.schedule(
    expressao,
    async () => {
      try {
        await executarSyncSefazDfe();
      } catch (e) {
        console.error('[sefaz-dfe cron] falhou:', e.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log(`[sefaz-dfe] cron agendado: "${expressao}" (BRT) — janela noturna para não disputar a cota DFe com o TOTVS`);

  // Sincronização 30s após o boot só dentro da janela noturna (21h-06h BRT):
  // deploy durante o dia não pode consultar a SEFAZ e derrubar o TOTVS.
  const horaBrt = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()),
  );
  if (horaBrt >= 21 || horaBrt < 6) {
    setTimeout(() => {
      executarSyncSefazDfe().catch((e) =>
        console.error('[sefaz-dfe boot] falhou:', e.message),
      );
    }, 30000);
  } else {
    console.log(`[sefaz-dfe] boot às ${horaBrt}h BRT: sync inicial pulada (fora da janela noturna)`);
  }
}
