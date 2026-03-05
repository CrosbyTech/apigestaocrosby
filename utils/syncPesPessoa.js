import cron from 'node-cron';
import axios from 'axios';
import https from 'https';
import supabase from '../config/supabase.js';
import { getToken } from './totvsTokenManager.js';
import { logger } from './errorHandler.js';

// ==========================================
// SYNC PES_PESSOA - TOTVS → Supabase
// Busca pessoas físicas (individuals) e jurídicas (legal-entities)
// via API TOTVS e salva/atualiza na tabela pes_pessoa
// ==========================================

const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  rejectUnauthorized: false,
});

// Cache de empresas em memória
let cachedBranchCodes = null;
let branchCacheTimestamp = 0;
const BRANCH_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

/**
 * Busca TODAS as empresas disponíveis na API TOTVS
 * Usa cache em memória (30 min)
 */
export async function getAllBranchCodes() {
  const now = Date.now();
  if (cachedBranchCodes && now - branchCacheTimestamp < BRANCH_CACHE_TTL) {
    return cachedBranchCodes;
  }
  try {
    const token = (await getToken()).access_token;
    const url = `${TOTVS_BASE_URL}/person/v2/branchesList?BranchCodePool=1&Page=1&PageSize=1000`;
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      timeout: 10000,
      httpsAgent,
    });
    if (resp.data?.items?.length > 0) {
      cachedBranchCodes = resp.data.items
        .map((b) => parseInt(b.code))
        .filter((c) => !isNaN(c) && c > 0);
      branchCacheTimestamp = now;
      logger.info(
        `🏢 ${cachedBranchCodes.length} empresas carregadas: [${cachedBranchCodes.join(', ')}]`,
      );
      return cachedBranchCodes;
    }
  } catch (err) {
    logger.warn('⚠️ Erro ao buscar empresas, usando fallback');
  }
  return (
    cachedBranchCodes || [
      1, 2, 5, 6, 11, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96,
      97, 98, 99, 100, 101, 870, 880, 890, 900, 910, 920, 930, 940, 950, 960,
      970, 980, 990,
    ]
  );
}

// ==========================================
// MAPEAMENTO DE CAMPOS: TOTVS → pes_pessoa
// ==========================================

/**
 * Mapeia um registro de pessoa FÍSICA (individual) do TOTVS para o schema pes_pessoa
 */
export function mapIndividualToRow(item) {
  return {
    code: item.code,
    cd_empresacad: item.registrationBranchCode ?? item.branchCode ?? 1,
    nm_pessoa: item.name || null,
    dt_nascimento: item.birthDate ? item.birthDate.substring(0, 10) : null,
    cpf: item.cpf || null,
    rg: item.rg || null,
    rg_federal_agency: item.rgFederalAgency || item.issuingAgency || null,
    gender: item.gender || item.sex || null,
    marital_status: item.maritalStatus || null,
    nationality: item.nationality || null,
    mother_name: item.motherName || null,
    father_name: item.fatherName || null,
    occupation: item.occupation || null,
    monthly_income: item.monthlyIncome ?? null,
    hire_date: item.hireDate ? item.hireDate.substring(0, 10) : null,
    ctps: item.ctps || null,
    ctps_serial: item.ctpsSerial || null,
    is_inactive: item.isInactive ?? false,
    suframa_code: item.suframaCode || null,
  };
}

/**
 * Mapeia um registro de pessoa JURÍDICA (legal-entity) do TOTVS para o schema pes_pessoa
 * Campos exclusivos de PF ficam null
 */
export function mapLegalEntityToRow(item) {
  return {
    code: item.code,
    cd_empresacad: item.registrationBranchCode ?? item.branchCode ?? 1,
    nm_pessoa: item.name || item.fantasyName || null,
    dt_nascimento: item.foundationDate
      ? item.foundationDate.substring(0, 10)
      : null,
    cpf: item.cnpj || null, // PJ: armazena CNPJ no campo cpf
    rg: item.stateRegistration || null,
    rg_federal_agency: null,
    gender: null,
    marital_status: null,
    nationality: null,
    mother_name: null,
    father_name: null,
    occupation: item.mainActivity || null,
    monthly_income: null,
    hire_date: null,
    ctps: null,
    ctps_serial: null,
    is_inactive: item.isInactive ?? false,
    suframa_code: item.suframaCode || null,
  };
}

// ==========================================
// FUNÇÕES DE BUSCA PAGINADA NA API TOTVS
// ==========================================

/**
 * Busca TODAS as páginas de um endpoint TOTVS (individuals ou legal-entities)
 * @param {string} endpoint - URL completa do endpoint
 * @param {object} filter - Filtro (change para incremental, vazio para full)
 * @param {string} type - 'PF' ou 'PJ' (para log)
 * @returns {Promise<Array>} Lista de itens
 */
export async function fetchAllPages(endpoint, filter = {}, type = '') {
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
      // Retry com token renovado se 401
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
        `📄 [${type}] Página ${currentPage}: +${items.length} itens (total acumulado: ${allItems.length})`,
      );
    }

    currentPage++;

    // Safety: limite máximo de páginas
    if (currentPage > 5000) {
      logger.warn(`⚠️ [${type}] Limite de 5000 páginas atingido. Parando.`);
      break;
    }
  }

  logger.info(
    `✅ [${type}] Busca finalizada: ${allItems.length} registros em ${currentPage - 1} páginas`,
  );
  return allItems;
}

// ==========================================
// UPSERT NO SUPABASE (em batches)
// ==========================================

/**
 * Faz upsert em batch na tabela pes_pessoa
 * @param {Array} rows - Registros mapeados
 * @returns {Promise<{inserted: number, errors: number}>}
 */
export async function upsertBatch(rows) {
  // Deduplicar por chave (cd_empresacad, code) — mantém o último registro
  const uniqueMap = new Map();
  for (const row of rows) {
    const key = `${row.cd_empresacad}_${row.code}`;
    uniqueMap.set(key, row);
  }
  const uniqueRows = Array.from(uniqueMap.values());

  if (uniqueRows.length < rows.length) {
    logger.info(
      `🔄 Deduplicados: ${rows.length} → ${uniqueRows.length} (${rows.length - uniqueRows.length} duplicatas removidas)`,
    );
  }

  const BATCH_SIZE = 500;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < uniqueRows.length; i += BATCH_SIZE) {
    const batch = uniqueRows.slice(i, i + BATCH_SIZE);

    const { error } = await supabase.from('pes_pessoa').upsert(batch, {
      onConflict: 'cd_empresacad,code',
      ignoreDuplicates: false, // atualiza se já existe
    });

    if (error) {
      logger.error(
        `❌ Erro ao inserir batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`,
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

/**
 * Faz a carga completa de TODAS as pessoas do TOTVS
 * Deve ser chamado uma vez para popular a tabela
 */
export async function syncFullPesPessoa() {
  const startTime = Date.now();
  logger.info('🚀 ========================================');
  logger.info('🚀 SYNC FULL pes_pessoa - Início');
  logger.info('🚀 ========================================');

  try {
    // 0) Buscar todas as empresas
    const branchCodes = await getAllBranchCodes();
    const filter = { branchCodeList: branchCodes };
    logger.info(`🏢 Buscando clientes de ${branchCodes.length} empresas`);

    // 1) Buscar todas PF
    logger.info('👤 Buscando TODAS as pessoas FÍSICAS...');
    const pfEndpoint = `${TOTVS_BASE_URL}/person/v2/individuals/search`;
    const pfItems = await fetchAllPages(pfEndpoint, filter, 'PF');
    const pfRows = pfItems.map(mapIndividualToRow);

    // 2) Buscar todas PJ
    logger.info('🏢 Buscando TODAS as pessoas JURÍDICAS...');
    const pjEndpoint = `${TOTVS_BASE_URL}/person/v2/legal-entities/search`;
    const pjItems = await fetchAllPages(pjEndpoint, filter, 'PJ');
    const pjRows = pjItems.map(mapLegalEntityToRow);

    // 3) Unir e fazer upsert
    const allRows = [...pfRows, ...pjRows];
    logger.info(
      `📊 Total para upsert: ${allRows.length} (PF: ${pfRows.length}, PJ: ${pjRows.length})`,
    );

    const result = await upsertBatch(allRows);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info('📊 ========================================');
    logger.info(`📊 SYNC FULL concluído em ${duration}s`);
    logger.info(`📊 Inseridos/Atualizados: ${result.inserted}`);
    logger.info(`📊 Erros: ${result.errors}`);
    logger.info('📊 ========================================');

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
    return {
      success: false,
      duration: `${duration}s`,
      error: error.message,
    };
  }
}

// ==========================================
// SYNC INCREMENTAL (diário)
// ==========================================

/**
 * Busca apenas pessoas alteradas/criadas desde ontem
 * Usa o filtro change.startDate/endDate da API TOTVS
 */
export async function syncIncrementalPesPessoa() {
  const startTime = Date.now();

  // Período: ontem 00:00 até agora
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const startDate = yesterday.toISOString();
  const endDate = now.toISOString();

  logger.info('🔄 ========================================');
  logger.info('🔄 SYNC INCREMENTAL pes_pessoa - Início');
  logger.info(`🔄 Período: ${startDate} → ${endDate}`);
  logger.info('🔄 ========================================');

  // Buscar todas as empresas
  const branchCodes = await getAllBranchCodes();
  logger.info(`🏢 Buscando alterações de ${branchCodes.length} empresas`);

  const changeFilter = {
    branchCodeList: branchCodes,
    change: {
      startDate,
      endDate,
      inPerson: true,
      inCustomer: true,
      inEmployee: true,
    },
  };

  try {
    // 1) PF incrementais
    logger.info('👤 Buscando pessoas FÍSICAS alteradas...');
    const pfEndpoint = `${TOTVS_BASE_URL}/person/v2/individuals/search`;
    const pfItems = await fetchAllPages(pfEndpoint, changeFilter, 'PF-INC');
    const pfRows = pfItems.map(mapIndividualToRow);

    // 2) PJ incrementais
    logger.info('🏢 Buscando pessoas JURÍDICAS alteradas...');
    const pjEndpoint = `${TOTVS_BASE_URL}/person/v2/legal-entities/search`;
    const pjItems = await fetchAllPages(pjEndpoint, changeFilter, 'PJ-INC');
    const pjRows = pjItems.map(mapLegalEntityToRow);

    // 3) Upsert
    const allRows = [...pfRows, ...pjRows];

    if (allRows.length === 0) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(
        `✅ SYNC INCREMENTAL: Nenhuma alteração encontrada (${duration}s)`,
      );
      return {
        success: true,
        duration: `${duration}s`,
        totalPF: 0,
        totalPJ: 0,
        total: 0,
        inserted: 0,
        errors: 0,
        message: 'Nenhuma alteração encontrada no período',
      };
    }

    logger.info(
      `📊 Total para upsert: ${allRows.length} (PF: ${pfRows.length}, PJ: ${pjRows.length})`,
    );

    const result = await upsertBatch(allRows);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info('📊 ========================================');
    logger.info(`📊 SYNC INCREMENTAL concluído em ${duration}s`);
    logger.info(`📊 Inseridos/Atualizados: ${result.inserted}`);
    logger.info(`📊 Erros: ${result.errors}`);
    logger.info('📊 ========================================');

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
    return {
      success: false,
      duration: `${duration}s`,
      error: error.message,
    };
  }
}

// ==========================================
// CRON DIÁRIO - 03:00 da manhã
// ==========================================

let syncCronJob = null;

/**
 * Inicia o agendamento diário de sync incremental
 * Roda todo dia às 03:00 (horário do servidor)
 */
export function startPesPessoaScheduler() {
  if (syncCronJob) {
    logger.info('⚠️ Scheduler pes_pessoa já está rodando');
    return;
  }

  // Todo dia às 03:00
  syncCronJob = cron.schedule('0 3 * * *', async () => {
    logger.info('⏰ Cron pes_pessoa disparado (03:00)');
    await syncIncrementalPesPessoa();
  });

  logger.info('✅ Scheduler pes_pessoa agendado: todo dia às 03:00');
}

/**
 * Para o agendamento diário
 */
export function stopPesPessoaScheduler() {
  if (syncCronJob) {
    syncCronJob.stop();
    syncCronJob = null;
    logger.info('🛑 Scheduler pes_pessoa parado');
  }
}
