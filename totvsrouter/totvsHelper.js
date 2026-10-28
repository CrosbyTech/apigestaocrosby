import https from 'https';
import http from 'http';
import axios from 'axios';

export const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 60000,
  rejectUnauthorized: false,
});

export const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 60000,
});

export const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';

export const TOTVS_AUTH_ENDPOINT =
  process.env.TOTVS_AUTH_ENDPOINT ||
  'https://www30.bhan.com.br:9443/api/totvsmoda/authorization/v2/token';

export const API_BASE_URL =
  process.env.API_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'http://localhost:4001';

// Grupo empresarial (razão social dona da filial) pela raiz do CNPJ da filial.
// Regra do Yago (28/10/2026): separar o contas a receber por
// CROSBY / FABIO / IRMAOS VAREJO / IRMAOS CROSBY. Filiais de teste, setores
// internos e Serviços Integrados ficam em OUTROS.
export const GRUPO_EMPRESA_POR_RAIZ = {
  17177680: 'CROSBY', // FERREIRA COMERCIO / CROSBY CR VESTUARIO / CROSBY DISTRIBUICAO
  27728810: 'FABIO', // FA MODA & VAREJO / FABIO FERREIRA DE LIMA AZEVEDO
  17757554: 'FABIO', // CROSBY FORTALEZA (filial 31) — razão FABIO FERREIRA DE LIMA AZEVEDO
  53661116: 'IRMAOS VAREJO', // IRMAOS VAREJO COMERCIAL / FLAVIO FERREIRA DE LIMA AZEVEDO
  33592092: 'IRMAOS CROSBY', // IRMAOS CR VESTUARIO / AZ VESTUARIO
};
export const GRUPO_EMPRESA_OUTROS = 'OUTROS';
// Exceções por código de filial (vence a raiz do CNPJ e a regra dos pares).
export const GRUPO_EMPRESA_POR_FILIAL = { 101: 'CROSBY' }; // FINANCEIRO CROSBY — regra do Yago

// Regra dos pares (Yago, 28/10/2026): as empresas do TOTVS vêm em pares
// matriz ↔ filial — a menor é a matriz e a maior a filial (5 ↔ 500, 55 ↔ 550,
// 75 ↔ 750, 1 ↔ 100, 99 ↔ 990…). A filial fica no MESMO grupo da matriz.
// Regra geral: tirar os zeros à direita do código da filial dá a matriz.
// Pares que fogem da regra geral:
export const MATRIZ_DA_FILIAL = {
  1000: 10, // CROSBY AGENCIA MARKETING
  5000: 50, // CROSBY FABRICA
  111: 11, // CROSBY NATAL
  311: 31, // CROSBY FORTALEZA
  411: 41, // CROSBY DEFEITOS
  890: 90, // CROSBY AYRTON SENNA (razão "TESTE CROSBY AYRTON SENNA")
  891: 89, // CROSBY SHOPPING TACARUNA
};

export function matrizDaFilial(branchCode, existe = () => true) {
  const c = parseInt(branchCode);
  if (MATRIZ_DA_FILIAL[c]) return MATRIZ_DA_FILIAL[c];
  if (!(c >= 100)) return null;
  let m = c;
  while (m >= 10 && m % 10 === 0) m /= 10;
  return m !== c && existe(m) ? m : null;
}

export function grupoEmpresaPorCnpj(cnpj, branchCode) {
  const porFilial = GRUPO_EMPRESA_POR_FILIAL[parseInt(branchCode)];
  if (porFilial) return porFilial;
  const raiz = String(cnpj || '').replace(/\D/g, '').slice(0, 8);
  return GRUPO_EMPRESA_POR_RAIZ[raiz] || GRUPO_EMPRESA_OUTROS;
}

// Aplica a regra dos pares: filial em OUTROS herda o grupo da matriz
// (segue a cadeia 1000 → 10 → …, no máximo 3 saltos).
function aplicarGrupoDaMatriz(branches) {
  const porCodigo = new Map(branches.map((b) => [b.code, b]));
  for (const b of branches) {
    if (b.grupoEmpresa !== GRUPO_EMPRESA_OUTROS) continue;
    let code = b.code;
    for (let i = 0; i < 3; i++) {
      const m = matrizDaFilial(code, (c) => porCodigo.has(c));
      if (!m) break;
      const matriz = porCodigo.get(m);
      b.matriz = b.matriz ?? m;
      if (matriz.grupoEmpresa !== GRUPO_EMPRESA_OUTROS) {
        b.grupoEmpresa = matriz.grupoEmpresa;
        break;
      }
      code = m;
    }
  }
  return branches;
}

// { branchCode: 'CROSBY' | 'FABIO' | 'IRMAOS VAREJO' | 'IRMAOS CROSBY' | 'OUTROS' }
export async function getGrupoEmpresaPorBranch(token) {
  const branches = await getBranchesWithNames(token);
  return Object.fromEntries(
    (branches || []).map((b) => [b.code, b.grupoEmpresa || GRUPO_EMPRESA_OUTROS]),
  );
}

// Cache de branchCodes em memória (recarrega a cada 30 min)
let cachedBranchCodes = null;
let cachedBranchesWithNames = null;
let branchCacheTimestamp = 0;
const BRANCH_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

async function fetchBranchesList(token) {
  const now = Date.now();
  if (
    cachedBranchesWithNames &&
    now - branchCacheTimestamp < BRANCH_CACHE_TTL
  ) {
    return cachedBranchesWithNames;
  }
  try {
    const branchesUrl = `${TOTVS_BASE_URL}/person/v2/branchesList?BranchCodePool=1&Page=1&PageSize=1000`;
    const resp = await axios.get(branchesUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      timeout: 10000,
    });
    if (resp.data?.items?.length > 0) {
      cachedBranchesWithNames = resp.data.items
        .map((b) => ({
          code: parseInt(b.code),
          name:
            b.branchGroupName ||
            b.fantasyName ||
            b.description ||
            `Filial ${b.code}`,
          groupName: b.branchGroupName || null,
          cnpj: String(b.cnpj || '').replace(/\D/g, '') || null,
          grupoEmpresa: grupoEmpresaPorCnpj(b.cnpj, b.code),
        }))
        .filter((b) => !isNaN(b.code) && b.code > 0);
      aplicarGrupoDaMatriz(cachedBranchesWithNames);
      cachedBranchCodes = cachedBranchesWithNames.map((b) => b.code);
      branchCacheTimestamp = now;
      return cachedBranchesWithNames;
    }
  } catch (err) {
    console.log('⚠️ Erro ao buscar branches, usando cache/fallback');
  }
  return cachedBranchesWithNames || null;
}

export async function getBranchCodes(token) {
  const branches = await fetchBranchesList(token);
  if (branches) return branches.map((b) => b.code);
  return (
    cachedBranchCodes || [
      1, 2, 5, 6, 11, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96,
      97, 98, 99, 100, 101, 870, 880, 890, 900, 910, 920, 930, 940, 950, 960,
      970, 980, 990,
    ]
  );
}

export async function getBranchesWithNames(token) {
  const branches = await fetchBranchesList(token);
  if (branches) return branches;
  const codes = await getBranchCodes(token);
  return codes.map((c) => ({ code: c, name: `Filial ${c}` }));
}

// Filiais próprias na regra do Ranking de Faturamento tipo FILIAL: nome contém
// CROSBY, não é FRANQUIA, exclui 98/980. É a lista onde o limite de crédito
// precisa ser gravado para o PDV de QUALQUER loja enxergar o limite — usada
// pelo crediário BlueCard e pela Análise de Crédito Multimarcas.
const EXCLUIR_FILIAL_LIMITE = new Set([98, 980]);

export async function getFilialBranchCodes(token) {
  const branches = await getBranchesWithNames(token);
  const filiais = (branches || [])
    .filter((b) => {
      const nome = String(b.name || '').toUpperCase();
      if (!nome.includes('CROSBY') || nome.includes('FRANQUIA')) return false;
      return !EXCLUIR_FILIAL_LIMITE.has(Number(b.code));
    })
    .map((b) => Number(b.code));
  if (filiais.length === 0) {
    // Cache de branches falhou (nomes viram "Filial N") — melhor abortar do que
    // gravar limite em lugar nenhum e o PDV continuar travado.
    throw new Error(
      'nenhuma branch FILIAL encontrada (cache de branches indisponível?)',
    );
  }
  return filiais;
}

// Filiais que recebem filtro de operações específico (CASCAVEL, JOÃO PESSOA,
// BREJINHO, TACARUNÁ etc.) — alinhado com o Ranking de Faturamento.
export const SPECIAL_BRANCH_CODES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 31, 41, 45, 50, 55,
  65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
  105, 106, 107, 108, 109, 111, 200, 300, 311, 351, 400, 411, 450, 500, 550,
  551, 600, 650, 700, 750, 800, 850, 870, 880, 890, 891, 900, 910, 920, 930,
  940, 950, 960, 970, 980, 990,
];

export const SPECIAL_OPERATIONS = [
  1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
  9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
  1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067,
  5919, // adicionada em 2026-06 a pedido do gestor — entra no Ranking de Faturamento
];

// Chama TOTVS /sale-panel/v2/totals-branch/search para um conjunto de filiais
// aplicando o filtro de operações especiais quando aplicável. Faz duas
// chamadas em paralelo (especiais x demais) e mescla os datasets.
// Refresh automático de token em 401.
export async function fetchBranchTotalsFromTotvs({
  initialToken,
  branchs,
  datemin,
  datemax,
  refreshToken,
  logTag = 'BranchTotals',
  operations, // se fornecido, sobrescreve SPECIAL_OPERATIONS para TODAS as filiais
}) {
  if (!Array.isArray(branchs) || branchs.length === 0) {
    return {
      dataRow: [],
      dataRowLastYear: [],
      total: null,
      totalLastYear: null,
    };
  }

  // Modo override: usa operations fornecidas pra todas as filiais (sem split special/other)
  const overrideOps =
    Array.isArray(operations) && operations.length > 0 ? operations : null;
  const specialSet = new Set(SPECIAL_BRANCH_CODES);
  const specialBranchs = overrideOps
    ? branchs
    : branchs.filter((b) => specialSet.has(b));
  const otherBranchs = overrideOps
    ? []
    : branchs.filter((b) => !specialSet.has(b));

  const endpoint = `${TOTVS_BASE_URL}/sale-panel/v2/totals-branch/search`;
  let token = initialToken;

  console.log(
    `🏪 [${logTag}] ${endpoint}`,
    JSON.stringify({
      datemin,
      datemax,
      specialBranchs: specialBranchs.length,
      otherBranchs: otherBranchs.length,
    }),
  );

  const callTotvs = (accessToken, body) =>
    axios.post(endpoint, body, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      httpsAgent,
      timeout: 60000,
    });

  const safeCall = async (body) => {
    try {
      return await callTotvs(token, body);
    } catch (error) {
      if (error.response?.status === 401 && typeof refreshToken === 'function') {
        console.log(`🔄 [${logTag}] Token expirado, renovando...`);
        token = await refreshToken();
        return callTotvs(token, body);
      }
      // Log do payload + resposta TOTVS pra diagnosticar 400
      if (error.response?.status === 400) {
        console.error(
          `❌ [${logTag}] TOTVS 400 — body enviado: ${JSON.stringify(body).slice(0, 500)}`,
        );
        console.error(
          `❌ [${logTag}] TOTVS 400 — resposta: ${JSON.stringify(error.response?.data).slice(0, 800)}`,
        );
      }
      throw error;
    }
  };

  const callPromises = [];
  if (specialBranchs.length > 0) {
    callPromises.push(
      safeCall({
        branchs: specialBranchs,
        datemin,
        datemax,
        operations: overrideOps || SPECIAL_OPERATIONS,
      }),
    );
  }
  if (otherBranchs.length > 0) {
    callPromises.push(
      safeCall({ branchs: otherBranchs, datemin, datemax }),
    );
  }

  const responses = await Promise.all(callPromises);
  const datasets = responses.map((r) => r.data);

  const mergedDataRow = datasets.flatMap((d) => d.dataRow || []);
  const mergedDataRowLastYear = datasets.flatMap(
    (d) => d.dataRowLastYear || [],
  );

  const sumTotals = (totalsArr) => {
    const valid = totalsArr.filter(Boolean);
    if (valid.length === 0) return null;
    const summed = valid.reduce(
      (acc, t) => ({
        invoice_qty: acc.invoice_qty + (t.invoice_qty || 0),
        invoice_value: acc.invoice_value + (t.invoice_value || 0),
        itens_qty: acc.itens_qty + (t.itens_qty || 0),
      }),
      { invoice_qty: 0, invoice_value: 0, itens_qty: 0 },
    );
    summed.tm =
      summed.invoice_qty > 0 ? summed.invoice_value / summed.invoice_qty : 0;
    summed.pa =
      summed.invoice_qty > 0 ? summed.itens_qty / summed.invoice_qty : 0;
    summed.pmpv =
      summed.itens_qty > 0 ? summed.invoice_value / summed.itens_qty : 0;
    return summed;
  };

  return {
    dataRow: mergedDataRow,
    dataRowLastYear: mergedDataRowLastYear,
    total: sumTotals(datasets.map((d) => d.total)),
    totalLastYear: sumTotals(datasets.map((d) => d.totalLastYear)),
  };
}
