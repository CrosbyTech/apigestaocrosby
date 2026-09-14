// Job: aquece o cache de clientes REVENDA (GET /api/totvs/reseller-clients).
//
// POR QUE EXISTE
//   A lista de revenda vem de 4 varreduras paginadas no TOTVS (PJ+PF, dois
//   tipos de classificação) e a frio passa de 3 minutos. A rota guarda em
//   cache no processo, mas quem paga o custo da primeira chamada é a tela que
//   abriu primeiro — e o Dashboard/Metas de Inadimplência desistem de incluir
//   o canal REVENDA se a lista não chegar em ~20s. Este job chama a rota no
//   boot (após 2 min, para não competir com a subida) e de 6 em 6 horas, para
//   o cache estar sempre quente quando alguém abrir o painel.
//
// CONFIG
//   RESELLER_WARM_ENABLED = 'false' desliga (default 'true')
//   RESELLER_WARM_CRON    = expressão cron (default: minuto 15, de 6 em 6 horas)
//   INTERNAL_API_BASE_URL = base interna (default http://localhost:PORT)
//
// (Cabeçalho em // de propósito: a expressão cron contém "*/", que fecharia
// um comentário de bloco.)
import cron from 'node-cron';
import axios from 'axios';

const ENABLED =
  String(process.env.RESELLER_WARM_ENABLED || 'true').toLowerCase() === 'true';
const CRON_EXPR = process.env.RESELLER_WARM_CRON || '15 */6 * * *';
const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE_URL ||
  `http://localhost:${process.env.PORT || 4100}`;

let rodando = false;

export async function aquecerResellerCache({ refresh = false } = {}) {
  if (rodando) return { pulado: true };
  rodando = true;
  const t0 = Date.now();
  try {
    const url = `${INTERNAL_API_BASE}/api/totvs/reseller-clients${refresh ? '?refresh=true' : ''}`;
    const r = await axios.get(url, { timeout: 15 * 60 * 1000 });
    const qtd = Array.isArray(r.data?.data) ? r.data.data.length : '?';
    console.log(
      `🔥 [reseller-warm] cache de revenda pronto: ${qtd} clientes em ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
    return { ok: true, qtd };
  } catch (e) {
    console.warn(`⚠️ [reseller-warm] falhou: ${e.message}`);
    return { ok: false, erro: e.message };
  } finally {
    rodando = false;
  }
}

export function iniciarResellerCacheWarm() {
  if (!ENABLED) {
    console.log('⏸️ [reseller-warm] desativado (RESELLER_WARM_ENABLED=false)');
    return;
  }
  // Boot: espera 2 min para o servidor terminar de subir (WhatsApp, Chrome…)
  setTimeout(() => {
    aquecerResellerCache().catch(() => null);
  }, 2 * 60 * 1000);
  // Renova periodicamente (refresh=true força releitura no TOTVS)
  cron.schedule(CRON_EXPR, () => aquecerResellerCache({ refresh: true }).catch(() => null), {
    timezone: 'America/Sao_Paulo',
  });
  console.log(`⏰ [reseller-warm] agendado (boot +2min e "${CRON_EXPR}")`);
}
