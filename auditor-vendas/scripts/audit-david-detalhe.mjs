// AUDITORIA DETALHADA: David (dealer 26) — listagem NF a NF com credev
import 'dotenv/config';
import axios from 'axios';
import https from 'node:https';

const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const DATEMIN = process.argv[2] || '2026-05-01';
const DATEMAX = process.argv[3] || new Date().toISOString().slice(0, 10);

console.log(`🔬 DAVID (dealer 26) — NF a NF`);
console.log(`Período: ${DATEMIN} → ${DATEMAX}\n`);

async function getToken() {
  const r = await axios.post(
    process.env.TOTVS_AUTH_ENDPOINT,
    new URLSearchParams({
      grant_type: 'password',
      client_id: process.env.TOTVS_CLIENT_ID,
      client_secret: process.env.TOTVS_CLIENT_SECRET,
      username: process.env.TOTVS_USERNAME,
      password: process.env.TOTVS_PASSWORD,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpsAgent },
  );
  return r.data.access_token;
}
let token = await getToken();

const BRANCHS = [99, 2, 95, 87, 88, 90, 94, 97];
const OPS = [7235, 7241, 9127, 200];

const fetchPage = async (page, expand = 'items,payments', retries = 2) => {
  try {
    const r = await axios.post(
      `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
      {
        filter: {
          branchCodeList: BRANCHS,
          operationCodeList: OPS,
          operationType: 'Output',
          startIssueDate: `${DATEMIN}T00:00:00`,
          endIssueDate: `${DATEMAX}T23:59:59`,
        },
        expand,
        page,
        pageSize: 100,
      },
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 },
    );
    return r.data;
  } catch (err) {
    if (err.response?.status === 401 && retries > 0) {
      token = await getToken();
      return fetchPage(page, expand, retries - 1);
    }
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 2000));
      return fetchPage(page, expand, retries - 1);
    }
    return { items: [], totalPages: 0 };
  }
};

console.log('Puxando NFs...');
const first = await fetchPage(1);
const all = [...(first?.items || [])];
const totalPages = first?.totalPages || 1;
if (totalPages > 1) {
  const rem = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  for (let i = 0; i < rem.length; i += 3) {
    const results = await Promise.all(rem.slice(i, i + 3).map((p) => fetchPage(p)));
    for (const pd of results) all.push(...(pd?.items || []));
  }
}
console.log(`Total NFs no canal: ${all.length}\n`);

function dominantDealer(nf) {
  const netByDealer = {};
  for (const it of nf.items || []) {
    for (const p of it.products || []) {
      if (p.dealerCode) {
        const dc = Number(p.dealerCode);
        netByDealer[dc] = (netByDealer[dc] || 0) + Number(p.netValue || 0);
      }
    }
  }
  const entries = Object.entries(netByDealer);
  return entries.length > 0 ? Number(entries.sort((a, b) => b[1] - a[1])[0][0]) : null;
}

function credevFromPayments(nf) {
  // Credev em payments — paymentTypeCode 6 ou 7 (depende cliente). Soma valor negativo
  // ou identifica via paymentTypeName contendo 'credev'/'devol'
  let credev = 0;
  for (const p of nf.payments || []) {
    const name = String(p.paymentTypeName || '').toLowerCase();
    if (/credev|devol/.test(name)) {
      credev += Math.abs(Number(p.paymentValue || 0));
    }
  }
  return credev;
}

const davidNFs = all.filter((nf) => {
  const isCanc = nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted';
  if (isCanc) return false;
  return dominantDealer(nf) === 26;
});

davidNFs.sort((a, b) => (a.issueDate || '').localeCompare(b.issueDate || ''));

console.log(`David — ${davidNFs.length} NFs emitidas:\n`);
console.log(
  `  ${'Data'.padEnd(11)} ${'NF'.padStart(7)} ${'Branch'.padStart(6)} ${'OP'.padStart(5)}  ${'PersonCode'.padStart(8)} ${'Cliente'.padEnd(32)} ${'Bruto'.padStart(11)} ${'Credev'.padStart(10)} ${'Líquido'.padStart(11)} ${'NItem'.padStart(5)}`,
);
console.log('  ' + '─'.repeat(120));

let totGross = 0,
  totCredev = 0,
  totLiq = 0;
const semanas = {};

for (const nf of davidNFs) {
  const bruto = Number(nf.totalValue || 0);
  const credev = credevFromPayments(nf);
  const liq = Math.max(0, bruto - credev);
  totGross += bruto;
  totCredev += credev;
  totLiq += liq;
  const itensCount = (nf.items || []).reduce(
    (s, it) => s + (it.products?.length || 0),
    0,
  );
  // Semana ISO
  const d = new Date(nf.issueDate);
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((tmp - ys) / 86400000 + 1) / 7);
  const wKey = `${tmp.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
  semanas[wKey] = semanas[wKey] || { gross: 0, credev: 0, liq: 0, nfs: 0 };
  semanas[wKey].gross += bruto;
  semanas[wKey].credev += credev;
  semanas[wKey].liq += liq;
  semanas[wKey].nfs += 1;

  console.log(
    `  ${(nf.issueDate || '').slice(0, 10).padEnd(11)} ${String(nf.transactionCode).padStart(7)} ${String(nf.branchCode).padStart(6)} ${String(nf.operationCode).padStart(5)}  ${String(nf.personCode).padStart(8)} ${String(nf.personName || '').slice(0, 32).padEnd(32)} ${bruto.toFixed(2).padStart(11)} ${credev.toFixed(2).padStart(10)} ${liq.toFixed(2).padStart(11)} ${String(itensCount).padStart(5)}`,
  );
}

console.log('  ' + '─'.repeat(120));
console.log(
  `  TOTAL                                                                       ${totGross.toFixed(2).padStart(11)} ${totCredev.toFixed(2).padStart(10)} ${totLiq.toFixed(2).padStart(11)}`,
);

console.log('\n=== RESUMO POR SEMANA ISO ===');
for (const [w, v] of Object.entries(semanas).sort()) {
  console.log(
    `  ${w}: ${v.nfs} NFs  |  Bruto R$ ${v.gross.toFixed(2)}  |  Credev R$ ${v.credev.toFixed(2)}  |  Líquido R$ ${v.liq.toFixed(2)}`,
  );
}

// Top clientes
console.log('\n=== TOP CLIENTES ===');
const porCliente = new Map();
for (const nf of davidNFs) {
  const pc = nf.personCode;
  const cur = porCliente.get(pc) || {
    name: nf.personName,
    nfs: 0,
    gross: 0,
    credev: 0,
  };
  cur.nfs++;
  cur.gross += Number(nf.totalValue || 0);
  cur.credev += credevFromPayments(nf);
  porCliente.set(pc, cur);
}
const topClientes = [...porCliente.entries()]
  .map(([pc, v]) => ({ pc, ...v, liq: v.gross - v.credev }))
  .sort((a, b) => b.liq - a.liq);
for (const c of topClientes.slice(0, 10)) {
  console.log(
    `  ${c.pc.toString().padStart(7)} ${(c.name || '').slice(0, 35).padEnd(35)}  ${c.nfs} NFs  bruto=R$ ${c.gross.toFixed(2).padStart(10)}  credev=R$ ${c.credev.toFixed(2).padStart(8)}  liq=R$ ${c.liq.toFixed(2).padStart(10)}`,
  );
}
