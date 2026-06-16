// Scan completo PF + PJ contando quantos têm classificação 55+8
import 'dotenv/config';
import axios from 'axios';
import { getToken } from './utils/totvsTokenManager.js';
import { httpsAgent } from './totvsrouter/totvsHelper.js';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';
const tk = await getToken();
const token = tk.access_token;
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

const isBC = (p) => (p?.classifications || []).some(c => Number(c?.typeCode) === 55 && String(c?.code) === '8');

async function scan(kind, url) {
  let lidos = 0, found = [];
  const t0 = Date.now();
  for (let page = 1; page <= 3000; page++) {
    let resp;
    try {
      resp = await axios.post(url, { filter: {}, page, pageSize: 500, expand: 'classifications' }, { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 });
    } catch (e) {
      console.log(`[${kind}] página ${page} ERR ${e.response?.status} ${e.message}`);
      // tenta menor
      await SLEEP(2000);
      try {
        resp = await axios.post(url, { filter: {}, page, pageSize: 200, expand: 'classifications' }, { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 });
      } catch (e2) {
        console.log(`[${kind}] página ${page} retry ERR: ${e2.message}`);
        break;
      }
    }
    const items = resp.data?.items || [];
    if (items.length === 0) break;
    lidos += items.length;
    for (const p of items) if (isBC(p)) found.push({ code: p.code, name: (p.name || p.fantasyName || '').slice(0, 40) });
    if (page % 10 === 0) console.log(`[${kind}] página ${page}: lidos=${lidos} bluecred=${found.length} (${Math.round((Date.now()-t0)/1000)}s)`);
    if (items.length < 200) break;
    await SLEEP(150);
  }
  console.log(`\n[${kind}] FINAL: lidos=${lidos} bluecred=${found.length} em ${Math.round((Date.now()-t0)/1000)}s`);
  for (const f of found) console.log(`  pc=${f.code} ${f.name}`);
  return found;
}

const pf = await scan('PF', `${TOTVS_BASE_URL}/person/v2/individuals/search`);
const pj = await scan('PJ', `${TOTVS_BASE_URL}/person/v2/legal-entities/search`);
console.log(`\n=== TOTAL BlueCred (typeCode=55, code=8): PF=${pf.length} + PJ=${pj.length} = ${pf.length + pj.length} ===`);
process.exit(0);
