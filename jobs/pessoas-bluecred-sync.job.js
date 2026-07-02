/**
 * Job: sincroniza clientes classificados como "BLUE CRED" no TOTVS
 * para a tabela local `pessoas_bluecred`.
 *
 * Critério (definido pelo gestor):
 *   classifications contém { typeCode: 55, code: "8" } → "BLUE CRED"
 *
 * Como NÃO compromete o TOTVS:
 *   - 1 execução por dia (cron 03:00 BRT)
 *   - Paginação de 1000 em 1000 com gap de 200ms entre páginas
 *   - Estratégia: pagina geral e filtra in-memory (TOTVS não tem filtro por
 *     classifications nativo). Pra ~200k clientes vão ser ~200 páginas =
 *     ~1 min total. Aceitável.
 *
 * Cron: 03:00 BRT (depois dos outros jobs pesados)
 */
import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent } from '../totvsrouter/totvsHelper.js';

const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';

const BLUECRED_TYPE_CODE = 55;
const BLUECRED_CODE = '8';

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

function isBluecred(person) {
  const cls = Array.isArray(person?.classifications) ? person.classifications : [];
  return cls.some(
    (c) => Number(c?.typeCode) === BLUECRED_TYPE_CODE && String(c?.code) === BLUECRED_CODE,
  );
}

async function fetchPagePF({ token, page, pageSize }) {
  const r = await axios.post(
    `${TOTVS_BASE_URL}/person/v2/individuals/search`,
    { filter: {}, page, pageSize, expand: 'classifications' },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 },
  );
  return r.data;
}
async function fetchPagePJ({ token, page, pageSize }) {
  const r = await axios.post(
    `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
    { filter: {}, page, pageSize, expand: 'classifications' },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 },
  );
  return r.data;
}

export async function executarSyncBluecred() {
  console.log('\n📥 [pessoas-bluecred-sync] iniciado');
  const t0 = Date.now();
  const tk = await getToken();
  if (!tk?.access_token) {
    console.error('[pessoas-bluecred-sync] sem token TOTVS');
    return { ok: false, erro: 'sem token' };
  }
  const token = tk.access_token;

  const found = []; // todos os BlueCred encontrados (PF + PJ)
  const PAGE_SIZE = 200; // TOTVS limita
  const MAX_PAGES = 2500;

  for (const [label, fetcher] of [
    ['PF', fetchPagePF],
    ['PJ', fetchPagePJ],
  ]) {
    let totalLidos = 0;
    let paginasPuladas = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      let data = null;
      // Retry com backoff: 3 tentativas antes de PULAR a página (não abortar).
      // Antes o código dava `break` no 1º erro — perdia milhares de clientes
      // porque falha transiente TOTVS matava o loop inteiro.
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
          data = await fetcher({ token, page, pageSize: PAGE_SIZE });
          break;
        } catch (e) {
          if (tentativa === 3) {
            console.warn(`[pessoas-bluecred-sync ${label}] página ${page} FALHOU após 3 tentativas: ${e.message}. Pulando.`);
            paginasPuladas++;
            data = null;
          } else {
            await SLEEP(2000 * tentativa); // backoff 2s, 4s
          }
        }
      }
      if (!data) continue; // pula página e vai pra próxima em vez de abortar
      const items = data?.items || [];
      if (items.length === 0) break;
      totalLidos += items.length;
      for (const p of items) {
        if (isBluecred(p)) {
          const cls = p.classifications.find(
            (c) => Number(c.typeCode) === BLUECRED_TYPE_CODE && String(c.code) === BLUECRED_CODE,
          );
          found.push({
            person_code: Number(p.code),
            person_name: p.name || p.fantasyName || null,
            cpf: p.cpf || p.cnpj || null,
            tipo_pessoa: label,
            classified_at: p.insertDate || p.maxChangeFilterDate || null,
            synced_at: new Date().toISOString(),
          });
        }
      }
      if (page % 20 === 0) {
        console.log(`[pessoas-bluecred-sync ${label}] página ${page}: lidos=${totalLidos}, bluecred=${found.length}`);
      }
      if (items.length < PAGE_SIZE) break;
      await SLEEP(200); // anti-rate-limit
    }
    console.log(`[pessoas-bluecred-sync ${label}] OK: ${totalLidos} clientes lidos (${paginasPuladas} páginas puladas)`);
  }

  // Upsert no Supabase
  let salvos = 0;
  if (found.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < found.length; i += CHUNK) {
      const chunk = found.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('pessoas_bluecred')
        .upsert(chunk, { onConflict: 'person_code' });
      if (error) { console.error('upsert falhou:', error.message); break; }
      salvos += chunk.length;
    }
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`✅ [pessoas-bluecred-sync] concluído em ${sec}s: ${found.length} BlueCred encontrados, ${salvos} salvos`);
  return { ok: true, encontrados: found.length, salvos, duracao_s: Number(sec) };
}

let agendado = false;
export function iniciarPessoasBluecredSync() {
  if (agendado) return;
  agendado = true;
  // 03:00 BRT — fora dos horários dos outros jobs pesados
  cron.schedule(
    '0 3 * * *',
    async () => {
      try { await executarSyncBluecred(); }
      catch (e) { console.error('[pessoas-bluecred-sync] cron falhou:', e.message); }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log('[pessoas-bluecred-sync] cron agendado: diário 03:00 BRT');
}
