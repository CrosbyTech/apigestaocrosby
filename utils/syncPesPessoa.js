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
        throw error;
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
  logger.info(`👤 [${label}] Buscando PF com expand: ${EXPAND_FIELDS}...`);
  const pfItems = await fetchAllPages(
    PF_ENDPOINT,
    filter,
    `${label}-PF`,
    EXPAND_FIELDS,
  );
  const pfRows = pfItems.map((item) => mapPersonToRow(item, 'PF'));

  logger.info(`🏢 [${label}] Buscando PJ com expand: ${EXPAND_FIELDS}...`);
  const pjItems = await fetchAllPages(
    PJ_ENDPOINT,
    filter,
    `${label}-PJ`,
    EXPAND_FIELDS,
  );
  const pjRows = pjItems.map((item) => mapPersonToRow(item, 'PJ'));

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
// CRON DIÁRIO - 03:00 da manhã
// ==========================================

let syncCronJob = null;

export function startPesPessoaScheduler() {
  if (syncCronJob) {
    logger.info('⚠️ Scheduler pes_pessoa já está rodando');
    return;
  }
  syncCronJob = cron.schedule('0 3 * * *', async () => {
    logger.info('⏰ Cron pes_pessoa disparado (03:00)');
    await syncIncrementalPesPessoa();
  });
  logger.info('✅ Scheduler pes_pessoa agendado: todo dia às 03:00');
}

export function stopPesPessoaScheduler() {
  if (syncCronJob) {
    syncCronJob.stop();
    syncCronJob = null;
    logger.info('🛑 Scheduler pes_pessoa parado');
  }
}
