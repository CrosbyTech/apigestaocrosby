import 'dotenv/config';
import axios from 'axios';
import { getToken } from '../../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent } from '../../totvsrouter/totvsHelper.js';
const auth = (await getToken()).access_token;
const r = await axios.post(`${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`, { filter: { branchCodeList: [99], startIssueDate: '2026-10-01T00:00:00', endIssueDate: '2026-11-03T23:59:59', documentTypeList: [1,4] }, page: 1, pageSize: 100 }, { headers: { Authorization: `Bearer ${auth}` }, httpsAgent });
const it = r.data.items || [];
console.log('n', it.length, Object.keys(it[0]||{}).join(','));
const seen = new Set();
for (const x of it) { const k = [x.documentType,x.billingType,x.chargeType,x.bearerCode].join('|'); if (seen.has(k)) continue; seen.add(k); console.log(k, x.bearerName, x.receivableCode, x.customerCode, x.installmentValue, x.paidValue, x.status, x.settlementDate||x.paymentDate); }
process.exit(0);
