import axios from 'axios';
import https from 'https';
import { getToken } from './utils/totvsTokenManager.js';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const tk = await getToken();
const token = tk.access_token;

async function fetchPage(page) {
  return axios.post('https://www30.bhan.com.br:9443/api/totvsmoda/fiscal/v2/invoices/search', {
    filter: {
      branchCodeList: [99],
      operationType: 'Output',
      startIssueDate: '2026-04-01T00:00:00',
      endIssueDate: '2026-04-30T23:59:59',
    },
    expand: 'items',
    page,
    pageSize: 100,
  }, { headers: { Authorization: 'Bearer ' + token }, httpsAgent, timeout: 60000 });
}

const first = await fetchPage(1);
const all = [...(first.data.items || [])];
const totalPages = first.data.totalPages || 1;
console.log(`Total: ${first.data.totalItems} NFs em ${totalPages} páginas`);
for (let p = 2; p <= totalPages; p++) {
  const r2 = await fetchPage(p);
  all.push(...(r2.data.items || []));
}
const rafaelNfs = all.filter(nf => {
  if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') return false;
  const netByDealer = {};
  for (const it of nf.items || []) {
    for (const p of it.products || []) {
      const dc = Number(p.dealerCode);
      if (!dc) continue;
      netByDealer[dc] = (netByDealer[dc] || 0) + (parseFloat(p.netValue) || 0);
    }
  }
  const top = Object.entries(netByDealer).sort((a,b)=>b[1]-a[1])[0];
  return top && Number(top[0]) === 21;
});

console.log(`Total NFs branch 99 (todas ops B2M+Revenda): ${all.length}`);
console.log(`NFs onde Rafael (dealer 21) é dominante: ${rafaelNfs.length}\n`);
let total = 0;
for (const nf of rafaelNfs) {
  total += parseFloat(nf.totalValue) || 0;
  console.log(`  invoice ${nf.invoiceCode} | issue ${nf.issueDate?.slice(0,10)} | op ${nf.operationCode} | total R$ ${parseFloat(nf.totalValue).toFixed(2)} | person ${nf.personCode} (${nf.personName?.slice(0,40)})`);
}
console.log(`\n💰 TOTAL Rafael Abril/2026: R$ ${total.toFixed(2)}`);
