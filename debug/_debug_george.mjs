import axios from 'axios';
import https from 'https';
import { getToken } from './utils/totvsTokenManager.js';
import { getBranchCodes } from './totvsrouter/totvsHelper.js';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const tk = await getToken();
const token = tk.access_token;

// Busca TODAS as NFs Output de Abril/2026 cuja personCode é 115295 (GEORGE)
// em qualquer branch / qualquer op
const allBranches = await getBranchCodes(token);
console.log(`Buscando em ${allBranches.length} branches...`);

async function fetchPage(page, brs) {
  return axios.post('https://www30.bhan.com.br:9443/api/totvsmoda/fiscal/v2/invoices/search', {
    filter: {
      branchCodeList: brs,
      operationType: 'Output',
      startIssueDate: '2026-04-01T00:00:00',
      endIssueDate: '2026-04-30T23:59:59',
    },
    expand: 'items',
    page,
    pageSize: 100,
  }, { headers: { Authorization: 'Bearer ' + token }, httpsAgent, timeout: 60000 });
}

// Lista NFs com personCode 115295 em todas branches
const all = [];
const first = await fetchPage(1, allBranches);
all.push(...(first.data.items || []));
console.log(`Total NFs Output Abr/2026 (todas branches): ${first.data.totalItems}`);

const totalPages = first.data.totalPages || 1;
for (let p = 2; p <= Math.min(totalPages, 50); p++) {
  const r = await fetchPage(p, allBranches);
  all.push(...(r.data.items || []));
}

const georgeNfs = all.filter(nf => Number(nf.personCode) === 115295);
console.log(`\n📋 NFs do GEORGE MACHADO (person 115295) em abril:`);
for (const nf of georgeNfs) {
  console.log(`  branch ${nf.branchCode} | invoice ${nf.invoiceCode} | issue ${nf.issueDate?.slice(0,10)} | op ${nf.operationCode} | total R$ ${parseFloat(nf.totalValue).toFixed(2)} | status ${nf.invoiceStatus}`);
  // Mostra dealers dos products
  const dealers = new Set();
  for (const it of nf.items || []) {
    for (const p of it.products || []) {
      if (p.dealerCode) dealers.add(p.dealerCode);
    }
  }
  console.log(`    dealers: ${[...dealers].join(', ')}`);
}
