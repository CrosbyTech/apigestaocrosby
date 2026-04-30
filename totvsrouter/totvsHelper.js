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
        }))
        .filter((b) => !isNaN(b.code) && b.code > 0);
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
