import 'dotenv/config';
import axios from 'axios';
import { getToken } from '../../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent } from '../../totvsrouter/totvsHelper.js';
const tk = await getToken(); const auth = tk.access_token;
const lista = [];
for (let page = 1; page <= 20; page++) {
  const r = await axios.get(`${TOTVS_BASE_URL}/accounts-receivable/v2/payment-cards`, { params: { Page: page, PageSize: 100, IsInactive: false }, headers: { Authorization: `Bearer ${auth}` }, httpsAgent });
  lista.push(...(r.data.items||[])); if (!r.data.hasNext) break;
}
console.log('total', lista.length, 'keys', Object.keys(lista[0]).join(','));
for (const c of lista.filter(c => (c.bearerNumber>=6000 && c.bearerNumber<=6008 && c.operatorName) || /ELO/i.test(c.brandName||""))) console.log(c.documentType,c.sequenceNumber,c.description,c.bearerNumber,c.operatorName,c.brandName,c.installmentNumber);
process.exit(0);
