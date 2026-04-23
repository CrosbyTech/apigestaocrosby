import cron from 'node-cron';
import axios from 'axios';
import https from 'https';
import supabase from '../config/supabase.js';
import { getToken } from './totvsTokenManager.js';
import { logger } from './errorHandler.js';

// ==========================================
// SYNC PES_PESSOA v2 - TOTVS → Supabase
// Busca PF (individuals) e PJ (legal-entities)
// com phones, emails, addresses expandidos
// Armazena TODOS os campos do schema 200
// ==========================================

const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';

const PF_ENDPOINT = `${TOTVS_BASE_URL}/person/v2/individuals/search`;
const PJ_ENDPOINT = `${TOTVS_BASE_URL}/person/v2/legal-entities/search`;

const EXPAND_FIELDS = 'phones,emails,addresses';

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  rejectUnauthorized: false,
});

// ==========================================
// HELPERS
// ==========================================

function extractPrimaryPhone(phones) {
  if (!Array.isArray(phones) || phones.length === 0) return null;
  const p = phones.find((x) => x.isDefault) || phones[0];
  const ddd = p.ddd ? `(${p.ddd}) ` : '';
  return `${ddd}${p.number || p.phoneNumber || ''}`.trim() || null;
}

function extractPrimaryEmail(emails) {
  if (!Array.isArray(emails) || emails.length === 0) return null;
  const e = emails.find((x) => x.isDefault) || emails[0];
  return e.email || e.address || null;
}

function safeDate(val) {
  if (!val) return null;
  return typeof val === 'string' ? val.substring(0, 10) : null;
}

// ==========================================
// MAPEAMENTO COMPLETO: TOTVS → pes_pessoa
// Função única para PF e PJ
// ==========================================

export function mapPersonToRow(item, tipoPessoa) {
  const isPJ = tipoPessoa === 'PJ';

  return {
    // Chave primária
    code: item.code,
    cd_empresacad:
      item.branchInsertCode ??
      item.registrationBranchCode ??
      item.branchCode ??
      1,
    tipo_pessoa: tipoPessoa,

    // Dados gerais
    nm_pessoa: item.name || null,
    fantasy_name: item.fantasyName || null,
    uf: item.uf || null,
    branch_insert_code: item.branchInsertCode ?? null,
    insert_date: item.insertDate || null,
    max_change_filter_date: item.maxChangeFilterDate || null,

    // Documento principal
    cpf: isPJ ? item.cnpj || null : item.cpf || null,
    rg: isPJ
      ? item.numberStateRegistration || item.stateRegistration || null
      : item.rg || null,
    rg_federal_agency: item.rgFederalAgency || item.issuingAgency || null,

    // Dados PF
    dt_nascimento: isPJ
      ? safeDate(item.dateFoundation)
      : safeDate(item.birthDate),
    gender: item.gender || item.sex || null,
    marital_status: item.maritalStatus || null,
    nationality: item.nationality || null,
    mother_name: item.motherName || null,
    father_name: item.fatherName || null,
    occupation: isPJ
      ? item.codeActivity || item.mainActivity || null
      : item.occupation || null,
    monthly_income: item.monthlyIncome ?? null,
    hire_date: safeDate(item.hireDate),
    ctps: item.ctps || null,
    ctps_serial: item.ctpsSerial || null,

    // Status
    is_inactive: item.isInactive ?? false,
    is_customer: item.isCustomer ?? null,
    is_supplier: item.isSupplier ?? null,
    is_representative: item.isRepresentative ?? null,
    is_purchasing_guide: item.isPurchasingGuide ?? null,
    is_shipping_company: item.isShippingCompany ?? null,
    customer_status: item.customerStatus || null,
    person_status: item.status || null,

    // Dados PJ específicos
    suframa_code: item.suframaCode || null,
    home_page: item.homePage || null,
    code_activity: item.codeActivity || null,
    code_activity_cnae: item.codeActivityCnae ?? null,
    code_activity_cnae2: item.codeActivityCnae2 ?? null,
    number_employees: item.numberEmployees ?? null,
    monthly_invoicing: item.monthlyInvoicing ?? null,
    share_capital: item.shareCapital ?? null,
    type_tax_regime: item.typeTaxRegime || null,
    type_sub_tributary: item.typeSubTributary || null,
    type_description_suframa: item.typeDescriptionSuFrama || null,
    registration_municipal: item.registrationMunicipal || null,
    description_junta_cial: item.descriptionJuntaCial || null,
    date_reg_junta_cial: safeDate(item.dateRegJuntaCial),
    code_main_related: item.codeMainRelated ?? null,
    cpf_cnpj_main_related: item.cpfCnpjMainRelated || null,
    name_main_related: item.nameMainRelated || null,

    // Contato principal extraído
    telefone: extractPrimaryPhone(item.phones),
    email: extractPrimaryEmail(item.emails),

    // JSONB - dados aninhados completos
    phones: item.phones || null,
    emails: item.emails || null,
    addresses: item.addresses || null,
    observations: item.observations || null,
    customer_observations: item.customerObservations || null,
    additional_fields: item.additionalFields || null,
    classifications: item.classifications || null,
    person_references: item.references || null,
    relateds: item.relateds || null,
    partners: item.partners || null,
    shipping_company: item.shippingCompany || null,
    contacts: item.contacts || null,
    statistics: item.statistics || null,
    preferences: item.preferences || null,
    payment_methods: item.paymentMethods || null,
    social_networks: item.socialNetworks || null,
    representatives: item.representatives || null,

    updated_at: new Date().toISOString(),
  };
}

// ==========================================
// BUSCA PAGINADA COM EXPAND
// ==========================================

/**
 * Busca TODAS as páginas de um endpoint TOTVS
 * @param {string} endpoint - URL do endpoint
 * @param {object} filter - Filtro da busca
 * @param {string} type - Label para log ('PF', 'PJ', etc.)
 * @param {string} expand - Campos para expandir (ex: 'phones,emails,addresses')
 * @returns {Promise<Array>} Lista de itens
 */
export async function fetchAllPages(
  endpoint,
  filter = {},
  type = '',
  expand = '',
) {
  let token = (await getToken()).access_token;
  let allItems = [];
  let currentPage = 1;
  let hasMore = true;
  const PAGE_SIZE = 100;

  const makeRequest = async (accessToken, page) => {
    const payload = {
      filter,
      page,
      pageSize: PAGE_SIZE,
    };
    if (expand) payload.expand = expand;

    return axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 60000,
      httpsAgent,
    });
  };

  while (hasMore) {
    let response;
    try {
      response = await makeRequest(token, currentPage);
    } catch (error) {
      if (error.response?.status === 401) {
        logger.info(
          `🔄 [${type}] Token inválido na pág ${currentPage}. Renovando...`,
        );
        const newTokenData = await getToken(true);
        token = newTokenData.access_token;
        response = await makeRequest(token, currentPage);
      } else {
        // Erro HTTP da API TOTVS (ex: 400, 404, 500) — relança com contexto
        const status = error.response?.status;
        const detail =
          error.response?.data?.message ||
          error.response?.data?.error ||
          error.message;
        throw new Error(
          `[${type}] HTTP ${status ?? 'sem resposta'} na página ${currentPage}: ${detail}`,
        );
      }
    }

    const items = response.data?.items || [];
    allItems = allItems.concat(items);
    hasMore = response.data?.hasNext ?? false;

    if (currentPage % 10 === 0 || !hasMore) {
      logger.info(
        `📄 [${type}] Página ${currentPage}: +${items.length} itens (total: ${allItems.length})`,
      );
    }

    currentPage++;
    if (currentPage > 5000) {
      logger.warn(`⚠️ [${type}] Limite de 5000 páginas atingido.`);
      break;
    }
  }

  logger.info(
    `✅ [${type}] Busca finalizada: ${allItems.length} registros em ${currentPage - 1} páginas`,
  );
  return allItems;
}

// ==========================================
// BUSCA PF + PJ COM MAPEAMENTO
// ==========================================

/**
 * Busca PF e PJ do TOTVS, mapeia e retorna rows prontas para upsert
 * @param {object} filter - Filtro da busca
 * @param {string} label - Label para log
 * @returns {Promise<{pfRows: Array, pjRows: Array, allRows: Array}>}
 */
export async function fetchAndMapPersons(filter = {}, label = '') {
  // Busca PF — erros não interrompem a busca PJ
  let pfRows = [];
  try {
    logger.info(`👤 [${label}] Buscando PF com expand: ${EXPAND_FIELDS}...`);
    const pfItems = await fetchAllPages(
      PF_ENDPOINT,
      filter,
      `${label}-PF`,
      EXPAND_FIELDS,
    );
    pfRows = pfItems.map((item) => mapPersonToRow(item, 'PF'));
  } catch (err) {
    logger.warn(
      `⚠️ [${label}] Falha ao buscar PF (continuando com PJ): ${err.response?.status ?? ''} ${err.message}`,
    );
  }

  // Busca PJ — erros não interrompem o retorno
  let pjRows = [];
  try {
    logger.info(`🏢 [${label}] Buscando PJ com expand: ${EXPAND_FIELDS}...`);
    const pjItems = await fetchAllPages(
      PJ_ENDPOINT,
      filter,
      `${label}-PJ`,
      EXPAND_FIELDS,
    );
    pjRows = pjItems.map((item) => mapPersonToRow(item, 'PJ'));
  } catch (err) {
    logger.warn(
      `⚠️ [${label}] Falha ao buscar PJ: ${err.response?.status ?? ''} ${err.message}`,
    );
  }

  const allRows = [...pfRows, ...pjRows];
  logger.info(
    `📊 [${label}] Total: ${allRows.length} (PF: ${pfRows.length}, PJ: ${pjRows.length})`,
  );

  return { pfRows, pjRows, allRows };
}

// ==========================================
// UPSERT NO SUPABASE (em batches)
// ==========================================

export async function upsertBatch(rows) {
  // Deduplicar por chave (cd_empresacad, code)
  const uniqueMap = new Map();
  for (const row of rows) {
    const key = `${row.cd_empresacad}_${row.code}`;
    uniqueMap.set(key, row);
  }
  const uniqueRows = Array.from(uniqueMap.values());

  if (uniqueRows.length < rows.length) {
    logger.info(
      `🔄 Deduplicados: ${rows.length} → ${uniqueRows.length} (${rows.length - uniqueRows.length} removidas)`,
    );
  }

  const BATCH_SIZE = 500;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < uniqueRows.length; i += BATCH_SIZE) {
    const batch = uniqueRows.slice(i, i + BATCH_SIZE);

    const { error } = await supabase.from('pes_pessoa').upsert(batch, {
      onConflict: 'cd_empresacad,code',
      ignoreDuplicates: false,
    });

    if (error) {
      logger.error(
        `❌ Erro batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`,
      );
      errors += batch.length;
    } else {
      inserted += batch.length;
    }
  }

  return { inserted, errors };
}

// ==========================================
// SYNC FULL (carga inicial)
// ==========================================

export async function syncFullPesPessoa() {
  const startTime = Date.now();
  logger.info('🚀 ========================================');
  logger.info('🚀 SYNC FULL pes_pessoa v2 - Início');
  logger.info('🚀 ========================================');

  try {
    const { pfRows, pjRows, allRows } = await fetchAndMapPersons({}, 'FULL');

    const result = await upsertBatch(allRows);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    logger.info(
      `📊 SYNC FULL concluído em ${duration}s — ${result.inserted} upserts, ${result.errors} erros`,
    );

    return {
      success: true,
      duration: `${duration}s`,
      totalPF: pfRows.length,
      totalPJ: pjRows.length,
      total: allRows.length,
      inserted: result.inserted,
      errors: result.errors,
    };
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.error(`❌ SYNC FULL falhou após ${duration}s: ${error.message}`);
    return { success: false, duration: `${duration}s`, error: error.message };
  }
}

// ==========================================
// SYNC INCREMENTAL (diário)
// ==========================================

export async function syncIncrementalPesPessoa() {
  const startTime = Date.now();
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const sd = yesterday.toISOString();
  const ed = now.toISOString();

  logger.info('🔄 ========================================');
  logger.info(`🔄 SYNC INCREMENTAL: ${sd} → ${ed}`);
  logger.info('🔄 ========================================');

  const changeFilter = {
    change: {
      startDate: sd,
      endDate: ed,
      inPerson: true,
      inCustomer: true,
      inEmployee: true,
    },
  };

  try {
    const { pfRows, pjRows, allRows } = await fetchAndMapPersons(
      changeFilter,
      'INC',
    );

    if (allRows.length === 0) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`✅ SYNC INCREMENTAL: Nenhuma alteração (${duration}s)`);
      return {
        success: true,
        duration: `${duration}s`,
        total: 0,
        inserted: 0,
        errors: 0,
      };
    }

    const result = await upsertBatch(allRows);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    logger.info(
      `📊 SYNC INCREMENTAL concluído em ${duration}s — ${result.inserted} upserts, ${result.errors} erros`,
    );

    return {
      success: true,
      duration: `${duration}s`,
      totalPF: pfRows.length,
      totalPJ: pjRows.length,
      total: allRows.length,
      inserted: result.inserted,
      errors: result.errors,
    };
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.error(
      `❌ SYNC INCREMENTAL falhou após ${duration}s: ${error.message}`,
    );
    return { success: false, duration: `${duration}s`, error: error.message };
  }
}

// ==========================================
// INSERT SKIP EXISTING
// - Verifica quais já existem no Supabase antes de inserir
// - Retorna listas de inseridos, ignorados (já existem) e erros
// ==========================================

export async function insertSkipExisting(rows) {
  // Deduplicar entrada
  const uniqueMap = new Map();
  for (const row of rows) {
    const key = `${row.cd_empresacad}_${row.code}`;
    uniqueMap.set(key, row);
  }
  const unique = Array.from(uniqueMap.values());

  const skipped = [];
  const errors = [];
  let inserted = 0;

  if (unique.length === 0) {
    return { inserted, skipped, errors, total: 0 };
  }

  // Buscar existentes (lookup por code + cd_empresacad)
  const codes = [...new Set(unique.map((r) => r.code))];
  const CHUNK = 500;
  const existingSet = new Set();

  for (let i = 0; i < codes.length; i += CHUNK) {
    const slice = codes.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('pes_pessoa')
      .select('code, cd_empresacad')
      .in('code', slice);

    if (error) {
      logger.warn(`⚠️ Erro ao checar existentes: ${error.message}`);
      continue;
    }
    for (const row of data || []) {
      existingSet.add(`${row.cd_empresacad}_${row.code}`);
    }
  }

  const newRows = [];
  for (const row of unique) {
    const key = `${row.cd_empresacad}_${row.code}`;
    if (existingSet.has(key)) {
      skipped.push({
        code: row.code,
        cd_empresacad: row.cd_empresacad,
        nm_pessoa: row.nm_pessoa,
        tipo_pessoa: row.tipo_pessoa,
        reason: 'já existe no Supabase',
      });
    } else {
      newRows.push(row);
    }
  }

  // Inserir novos em batches; fallback por linha se batch falhar
  const BATCH_SIZE = 500;
  for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
    const batch = newRows.slice(i, i + BATCH_SIZE);

    const { error } = await supabase.from('pes_pessoa').insert(batch);

    if (error) {
      // Fallback: inserir um a um para capturar duplicatas
      for (const row of batch) {
        try {
          const { error: e2 } = await supabase.from('pes_pessoa').insert(row);
          if (e2) {
            const msg = e2.message || '';
            if (
              e2.code === '23505' ||
              msg.toLowerCase().includes('duplicate key')
            ) {
              skipped.push({
                code: row.code,
                cd_empresacad: row.cd_empresacad,
                nm_pessoa: row.nm_pessoa,
                tipo_pessoa: row.tipo_pessoa,
                reason: 'já existe no Supabase',
              });
            } else {
              errors.push({
                code: row.code,
                cd_empresacad: row.cd_empresacad,
                nm_pessoa: row.nm_pessoa,
                tipo_pessoa: row.tipo_pessoa,
                error: msg,
              });
            }
          } else {
            inserted++;
          }
        } catch (err) {
          errors.push({
            code: row.code,
            cd_empresacad: row.cd_empresacad,
            nm_pessoa: row.nm_pessoa,
            tipo_pessoa: row.tipo_pessoa,
            error: err.message,
          });
        }
      }
    } else {
      inserted += batch.length;
    }
  }

  return { inserted, skipped, errors, total: unique.length };
}

// ==========================================
// CRON DIÁRIO - 02:00 da manhã
// Busca pessoas alteradas/criadas nas últimas 24h
// ==========================================

let syncCronJob = null;

export function startPesPessoaScheduler() {
  if (syncCronJob) {
    logger.info('⚠️ Scheduler pes_pessoa já está rodando');
    return;
  }
  syncCronJob = cron.schedule(
    '0 2 * * *',
    async () => {
      logger.info('⏰ Cron pes_pessoa disparado (02:00) - sync incremental');
      try {
        const result = await syncIncrementalPesPessoa();
        logger.info(`✅ Cron pes_pessoa finalizado: ${JSON.stringify(result)}`);
      } catch (err) {
        logger.error(`❌ Cron pes_pessoa falhou: ${err.message}`);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  logger.info('✅ Scheduler pes_pessoa agendado: todo dia às 02:00 (BRT)');
}

export function stopPesPessoaScheduler() {
  if (syncCronJob) {
    syncCronJob.stop();
    syncCronJob = null;
    logger.info('🛑 Scheduler pes_pessoa parado');
  }
}
