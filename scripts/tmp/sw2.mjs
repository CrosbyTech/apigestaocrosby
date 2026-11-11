import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import { TOTVS_BASE_URL, httpsAgent } from '../../totvsrouter/totvsHelper.js';
const base = TOTVS_BASE_URL.replace(/\/$/, '');
for (const u of [`${base}/accounts-payable/v2/swagger/v2/swagger.json`, `${base}/accounts-payable/v2/swagger/docs/v2`, `${base}/accounts-payable/v2/swagger/v1/swagger.json`]) {
  try { const r = await axios.get(u, { httpsAgent, timeout: 30000 }); fs.writeFileSync(process.argv[2], JSON.stringify(r.data)); console.log('ok', u, Object.keys(r.data.paths||{}).join('\n')); break; } catch (e) { console.log('x', u, e.response?.status || e.message); }
}
process.exit(0);
