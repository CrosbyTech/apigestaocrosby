// Verifica se Recife Mall (personCode 29541) tem NFs em junho/2026 com ops franquia
import 'dotenv/config';
import axios from 'axios';
import { getToken } from './utils/totvsTokenManager.js';
import { httpsAgent } from './totvsrouter/totvsHelper.js';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';
const tk = await getToken();
if (!tk?.access_token) { console.error('sem token'); process.exit(1); }

const branchCodeList = [1, 2, 5, 6, 11, 50, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 111, 200];
const ops = [7234, 7240, 7802, 9124, 7259, 7279]; // CANAL_OPS franquia

const found = [];
let total = 0;
for (let page = 1; page <= 20; page++) {
  let resp;
  try {
    resp = await axios.post(
      `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
      {
        filter: {
          branchCodeList,
          operationCodeList: ops,
          operationType: 'Output',
          startIssueDate: '2026-06-01T00:00:00',
          endIssueDate: '2026-06-15T23:59:59',
        },
        expand: '',
        page,
        pageSize: 100,
      },
      { headers: { Authorization: `Bearer ${tk.access_token}` }, httpsAgent, timeout: 60000 },
    );
  } catch (e) { console.error('falhou', e.message); break; }
  const items = resp.data?.items || [];
  if (items.length === 0) break;
  for (const nf of items) {
    if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
    const pc = parseInt(nf.personCode);
    if (pc === 29541) {
      const v = parseFloat(nf.totalValue || 0);
      total += v;
      found.push({ inv: nf.invoiceCode, op: nf.operationCode, branch: nf.branchCode, person: nf.personName?.slice(0, 40), val: v, date: nf.issueDate?.slice(0,10) });
    }
  }
  if (items.length < 100) break;
}
console.log(`Recife Mall (pc=29541) em junho — ${found.length} NFs, total R$ ${total.toFixed(2)}`);
for (const r of found) console.log(' ', r);

// Verifica também outros personCodes que tenham "RECIFE" no nome
const recifeNames = [];
for (let page = 1; page <= 20; page++) {
  let resp;
  try {
    resp = await axios.post(
      `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
      {
        filter: { branchCodeList, operationCodeList: ops, operationType: 'Output', startIssueDate: '2026-06-01T00:00:00', endIssueDate: '2026-06-15T23:59:59' },
        expand: '', page, pageSize: 100,
      },
      { headers: { Authorization: `Bearer ${tk.access_token}` }, httpsAgent, timeout: 60000 },
    );
  } catch (e) { break; }
  const items = resp.data?.items || [];
  if (items.length === 0) break;
  for (const nf of items) {
    if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
    if (/RECIFE/i.test(nf.personName || '')) {
      recifeNames.push({ pc: nf.personCode, person: nf.personName?.slice(0,50), op: nf.operationCode, val: parseFloat(nf.totalValue||0), date: nf.issueDate?.slice(0,10) });
    }
  }
  if (items.length < 100) break;
}
console.log(`\nNomes com "RECIFE" nas NFs:`);
const byPerson = {};
for (const r of recifeNames) {
  if (!byPerson[r.pc]) byPerson[r.pc] = { person: r.person, count: 0, total: 0 };
  byPerson[r.pc].count++;
  byPerson[r.pc].total += r.val;
}
for (const [pc, v] of Object.entries(byPerson)) {
  console.log(`  pc=${pc} ${v.person.padEnd(50)} ${v.count} NFs R$ ${v.total.toFixed(2)}`);
}
process.exit(0);
