/**
 * Job: Sync de pes_pessoa (PJ) — busca da TOTVS classifications, telefone,
 * email, endereço pra todos os PJ que já estão no Supabase + novos que
 * aparecerem em NFs recentes.
 *
 * Crons:
 *   1) 03:00 BRT diário — atualiza PJs com NF nas últimas 48h (delta)
 *   2) Domingo 04:00 BRT — refresh completo de TODOS PJs (full)
 *
 * Endpoint de execução manual: POST /api/forecast/sync-pes-pessoa
 */
import cron from 'node-cron';
import axios from 'axios';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';
import supabase from '../config/supabase.js';
import supabaseFiscal from '../config/supabaseFiscal.js';

const BATCH_SIZE = 50; // TOTVS API limit
const UPSERT_BATCH = 200;

let SYNC_IN_PROGRESS = false;

// ─── Helper: batch-lookup PJ na TOTVS ────────────────────────────────────
async function fetchPJBatch(personCodes, accessToken) {
  const endpoint = `${TOTVS_BASE_URL}/person/v2/legal-entities/search`;
  const payload = {
    filter: { personCodeList: personCodes },
    expand: 'classifications,phones,emails,addresses',
    page: 1,
    pageSize: personCodes.length,
  };
  const r = await axios.post(endpoint, payload, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 60000,
  });
  return r.data?.items || [];
}

// ─── Mapeia resposta TOTVS pra row do pes_pessoa (schema real do Supabase) ─
function mapTotvsToRow(p) {
  const phones = Array.isArray(p.phones) ? p.phones : [];
  const emails = Array.isArray(p.emails) ? p.emails : [];
  const addresses = Array.isArray(p.addresses) ? p.addresses : [];
  const classifications = Array.isArray(p.classifications) ? p.classifications : [];
  const firstPhone = phones[0]?.number || null;
  const firstEmail = emails[0]?.email || null;
  const firstAddr = addresses[0] || {};
  return {
    code: Number(p.code),
    fantasy_name: p.fantasyName || p.fantasy_name || null,
    nm_pessoa: p.legalName || p.name || null,
    cpf: p.cpfCnpj || p.cnpj || p.cpf || null,
    tipo_pessoa: 'PJ',
    telefone: firstPhone,
    email: firstEmail,
    uf: firstAddr.stateAbbreviation || firstAddr.uf || null,
    phones,
    emails,
    addresses,
    classifications,
    max_change_filter_date: p.lastChangeDate || null,
    updated_at: new Date().toISOString(),
  };
}

// ─── Sync de um conjunto de codes ───────────────────────────────────────
async function syncCodes(codes, label = 'sync') {
  if (!codes.length) {
    console.log(`ℹ️ [pes-pessoa ${label}] nenhum code pra sincronizar`);
    return { ok: true, totalRequested: 0, totalUpserted: 0 };
  }
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('Token TOTVS indisponível');
  let token = tokenData.access_token;

  console.log(`🏢 [pes-pessoa ${label}] iniciando sync de ${codes.length} PJs`);
  const t0 = Date.now();

  const allItems = [];
  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    const batch = codes.slice(i, i + BATCH_SIZE);
    try {
      const items = await fetchPJBatch(batch, token);
      allItems.push(...items);
    } catch (err) {
      if (err.response?.status === 401) {
        // renova token e refaz só esse batch
        const fresh = await getToken(true);
        token = fresh.access_token;
        try {
          const items = await fetchPJBatch(batch, token);
          allItems.push(...items);
        } catch (e2) {
          console.warn(`⚠️ [pes-pessoa ${label}] batch ${i / BATCH_SIZE + 1} falhou: ${e2.message}`);
        }
      } else {
        console.warn(`⚠️ [pes-pessoa ${label}] batch ${i / BATCH_SIZE + 1} falhou: ${err.message}`);
      }
    }
    // Pequeno delay anti-bloqueio TOTVS
    if (i + BATCH_SIZE < codes.length) await new Promise((r) => setTimeout(r, 200));
  }

  const rows = allItems.map(mapTotvsToRow).filter((r) => r.code && Number.isFinite(r.code));
  // Sem unique constraint em pes_pessoa.code, usa UPDATE por code (1 query por row)
  // Roda em paralelo controlado pra não estourar conexões Supabase.
  let totalUpdated = 0;
  let totalErros = 0;
  const PARALLEL = 10;
  for (let i = 0; i < rows.length; i += PARALLEL) {
    const slice = rows.slice(i, i + PARALLEL);
    const results = await Promise.all(slice.map(async (row) => {
      const code = row.code;
      const update = { ...row };
      delete update.code; // não atualiza a PK
      const { error, count } = await supabase
        .from('pes_pessoa')
        .update(update, { count: 'exact' })
        .eq('code', code);
      return { error, count };
    }));
    for (const r of results) {
      if (r.error) {
        if (totalErros < 3) console.error(`❌ [pes-pessoa ${label}] update falhou: ${r.error.message}`);
        totalErros++;
      } else {
        totalUpdated += r.count ?? 1;
      }
    }
  }
  const totalUpserted = totalUpdated;
  if (totalErros > 0) console.warn(`⚠️ [pes-pessoa ${label}] ${totalErros} updates falharam`);
  const dur = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`✅ [pes-pessoa ${label}] ${totalUpserted}/${codes.length} sincronizados em ${dur}s`);
  return { ok: true, totalRequested: codes.length, totalFound: allItems.length, totalUpserted };
}

// ─── Sync delta: só PJs com NF nas últimas N horas ──────────────────────
export async function syncPesPessoaDelta(hoursBack = 48) {
  if (SYNC_IN_PROGRESS) { console.log('⏭️ [pes-pessoa delta] PULADO — sync em andamento'); return { ok: false, skipped: true }; }
  SYNC_IN_PROGRESS = true;
  try {
    const dateLimit = new Date(Date.now() - hoursBack * 3600000).toISOString().slice(0, 10);
    console.log(`🔄 [pes-pessoa delta] codes com NF desde ${dateLimit}`);
    // pega person_codes únicos das NFs recentes
    const codesSet = new Set();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseFiscal
        .from('notas_fiscais')
        .select('person_code')
        .gte('issue_date', dateLimit)
        .range(from, from + PAGE - 1);
      if (error || !data?.length) break;
      for (const r of data) if (r.person_code != null) codesSet.add(Number(r.person_code));
      if (data.length < PAGE) break;
    }
    return await syncCodes([...codesSet], 'delta');
  } finally {
    SYNC_IN_PROGRESS = false;
  }
}

// ─── Sync full: TODOS os PJs do Supabase ────────────────────────────────
export async function syncPesPessoaFull() {
  if (SYNC_IN_PROGRESS) { console.log('⏭️ [pes-pessoa full] PULADO — sync em andamento'); return { ok: false, skipped: true }; }
  SYNC_IN_PROGRESS = true;
  try {
    console.log('🌐 [pes-pessoa full] carregando todos PJ codes do Supabase');
    const codes = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('pes_pessoa')
        .select('code')
        .eq('tipo_pessoa', 'PJ')
        .range(from, from + PAGE - 1);
      if (error || !data?.length) break;
      for (const r of data) if (r.code != null) codes.push(Number(r.code));
      if (data.length < PAGE) break;
    }
    return await syncCodes(codes, 'full');
  } finally {
    SYNC_IN_PROGRESS = false;
  }
}

// ─── Agendamento ─────────────────────────────────────────────────────────
export function iniciarJobPesPessoaSync() {
  // Delta diário: 03:00 BRT — só PJs com movimentação recente (rápido)
  cron.schedule('0 3 * * *', () => syncPesPessoaDelta(48), {
    timezone: 'America/Sao_Paulo',
  });
  console.log('⏰ [pes-pessoa] Delta diário (48h NFs) agendado 03:00 BRT');

  // Full semanal: domingo 04:00 BRT — refresh completo
  cron.schedule('0 4 * * 0', () => syncPesPessoaFull(), {
    timezone: 'America/Sao_Paulo',
  });
  console.log('⏰ [pes-pessoa] Full semanal (domingo) agendado 04:00 BRT');
}
