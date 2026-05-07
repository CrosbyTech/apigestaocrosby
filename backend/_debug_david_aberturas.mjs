import axios from 'axios';
import https from 'https';
import { getToken } from './utils/totvsTokenManager.js';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const tk = await getToken();
const token = tk.access_token;

// Branchs onde David (26) opera (multimarcas branchs)
const branchs = [99, 2, 95, 87, 88, 90, 94, 97];

async function fetchPg(page) {
  return axios.post(
    'https://www30.bhan.com.br:9443/api/totvsmoda/fiscal/v2/invoices/search',
    {
      filter: {
        branchCodeList: branchs,
        operationType: 'Output',
        operationCodeList: [7235, 7241, 9127],
        startIssueDate: '2026-04-01T00:00:00',
        endIssueDate: '2026-04-30T23:59:59',
      },
      expand: 'items',
      page,
      pageSize: 100,
    },
    { headers: { Authorization: 'Bearer ' + token }, httpsAgent, timeout: 60000 },
  );
}

const first = await fetchPg(1);
const all = [...(first.data.items || [])];
const totalPages = first.data.totalPages || 1;
console.log(`Total: ${first.data.totalItems} NFs em ${totalPages} pgs`);
for (let p = 2; p <= totalPages; p++) {
  const r = await fetchPg(p);
  all.push(...(r.data.items || []));
}

// Filtra NFs onde dealer 26 (David) é dominante
const davidPersonsMap = new Map(); // personCode -> {name, firstDate}
for (const nf of all) {
  if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
  const pc = parseInt(nf.personCode);
  if (!pc) continue;
  // dealer dominante
  const netByDealer = {};
  for (const it of nf.items || []) {
    for (const p of it.products || []) {
      const dc = Number(p.dealerCode);
      if (!dc) continue;
      netByDealer[dc] = (netByDealer[dc] || 0) + (parseFloat(p.netValue) || 0);
    }
  }
  const top = Object.entries(netByDealer).sort((a,b) => b[1]-a[1])[0];
  if (!top || Number(top[0]) !== 26) continue;
  // É David
  const date = nf.issueDate?.slice(0, 10);
  const ex = davidPersonsMap.get(pc);
  if (!ex || date < ex.firstDate) {
    davidPersonsMap.set(pc, { name: nf.personName, firstDate: date, totalValue: parseFloat(nf.totalValue) });
  }
}

console.log(`\nClientes David (26) em Abril/2026: ${davidPersonsMap.size}`);
for (const [pc, info] of [...davidPersonsMap.entries()].sort((a,b) => a[1].firstDate.localeCompare(b[1].firstDate))) {
  console.log(`  ${pc} | ${info.firstDate} | R$ ${info.totalValue.toFixed(2)} | ${info.name?.slice(0, 50)}`);
}

// Lista alvos
const alvos = ['VASCONCELOS', 'HOT EXPRESS', 'TAINARA CAMPOS', 'YAGO BRUNNO', 'ALEXANDRE GOMES'];
console.log('\n--- Procurando alvos ---');
for (const alvo of alvos) {
  const found = [...davidPersonsMap.values()].find(x => (x.name || '').toUpperCase().includes(alvo));
  console.log(`  ${alvo}: ${found ? `✓ ${found.firstDate} R$ ${found.totalValue.toFixed(2)}` : '❌ NÃO ENCONTRADO em David/Abril'}`);
}
