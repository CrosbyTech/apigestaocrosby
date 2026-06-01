// Testa diretamente a query do calcularExclusaoNF pra Recife Mall (29541)
// em franquia (ops 7234,7240,7802,9124,7259) na semana 25-31/05/2026.
import 'dotenv/config';
import axios from 'axios';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent, getBranchCodes } from '../totvsrouter/totvsHelper.js';

const PC = 29541;
const OPS = [7234, 7240, 7802, 9124, 7259];
const DMIN = '2026-05-25';
const DMAX = '2026-05-31';

const tk = await getToken();
const branchCodeList = await getBranchCodes(tk.access_token);
console.log(`Branches: ${branchCodeList.length} (${branchCodeList.slice(0, 10).join(',')}...)`);

let total = 0, totalNfs = 0, totalRecife = 0;
const recifeNfs = [];
for (let page = 1; page <= 40; page++) {
  const resp = await axios.post(
    `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
    {
      filter: {
        branchCodeList,
        operationCodeList: OPS,
        operationType: 'Output',
        startIssueDate: `${DMIN}T00:00:00`,
        endIssueDate: `${DMAX}T23:59:59`,
      },
      expand: '',
      page, pageSize: 100,
    },
    { headers: { Authorization: `Bearer ${tk.access_token}` }, httpsAgent, timeout: 60000 },
  );
  const items = resp.data?.items || [];
  if (items.length === 0) break;
  for (const nf of items) {
    if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
    totalNfs++;
    total += parseFloat(nf.totalValue || 0);
    if (parseInt(nf.personCode) === PC) {
      totalRecife += parseFloat(nf.totalValue || 0);
      recifeNfs.push({ branch: nf.branchCode, code: nf.invoiceCode, op: nf.operationCode, date: nf.issueDate, val: nf.totalValue, person: nf.personCode });
    }
  }
  console.log(`  pg ${page}: ${items.length} NFs (acum ${totalNfs}), Recife acum R$${totalRecife.toFixed(2)}`);
  if (items.length < 100) break;
}
console.log(`\nTotal franquia (todos personCodes): ${totalNfs} NFs / R$${total.toFixed(2)}`);
console.log(`Recife Mall (PC=${PC}): ${recifeNfs.length} NFs / R$${totalRecife.toFixed(2)}`);
for (const nf of recifeNfs.slice(0, 10)) {
  console.log(`  br=${nf.branch} op=${nf.op} ${nf.date?.slice(0,10)} R$${Number(nf.val).toFixed(2)}`);
}
