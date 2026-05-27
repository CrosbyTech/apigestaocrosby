// Rastreia o credev de R$ 2.001,74 que apareceu em inbound_david W21
// 1. Procura em payments das NFs do canal (todos dealers)
// 2. Procura em fiscal-movement (SaleReturns) das NFs do canal
import 'dotenv/config';
import axios from 'axios';
import https from 'node:https';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const DATEMIN = '2026-05-18';
const DATEMAX = '2026-05-24';
const BRANCHS = [99, 2, 95, 87, 88, 90, 94, 97];
const OPS = [7235, 7241, 9127, 200];
const INBOUND_DAVID_DEALERS = new Set([26, 69]); // David + Thalis

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

console.log(`🔬 RASTREANDO credev inbound_david W21 (${DATEMIN}~${DATEMAX})\n`);

// === PASSO 1: NFs do canal com items+payments ===
const fetchInv = async (page) => {
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
      expand: 'items,payments',
      page,
      pageSize: 100,
    },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 },
  );
  return r.data;
};

const f1 = await fetchInv(1);
const nfs = [...(f1?.items || [])];
const tp = f1?.totalPages || 1;
for (let p = 2; p <= tp; p++) {
  const d = await fetchInv(p);
  nfs.push(...(d?.items || []));
}
console.log(`NFs no canal W21: ${nfs.length}\n`);

function dominantDealer(nf) {
  const m = {};
  for (const it of nf.items || []) {
    for (const p of it.products || []) {
      if (p.dealerCode) m[p.dealerCode] = (m[p.dealerCode] || 0) + Number(p.netValue || 0);
    }
  }
  const e = Object.entries(m).sort((a, b) => b[1] - a[1]);
  return e[0] ? Number(e[0][0]) : null;
}

console.log('=== PASSO 1: Credev em PAYMENTS das NFs do canal ===');
let totalCredevPayments = 0;
for (const nf of nfs) {
  if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
  const dealer = dominantDealer(nf);
  if (!INBOUND_DAVID_DEALERS.has(dealer)) continue;
  let credevNF = 0;
  for (const p of nf.payments || []) {
    const name = String(p.paymentTypeName || '').toLowerCase();
    if (/credev|devol/.test(name)) {
      credevNF += Math.abs(Number(p.paymentValue || 0));
    }
  }
  if (credevNF > 0) {
    console.log(`  NF ${nf.transactionCode} dealer=${dealer} ${nf.personName?.slice(0, 30)} credev=R$ ${credevNF.toFixed(2)}`);
    totalCredevPayments += credevNF;
  }
}
console.log(`  Soma credev em payments: R$ ${totalCredevPayments.toFixed(2)}\n`);

// === PASSO 2: SaleReturns via fiscal-movement ===
console.log('=== PASSO 2: SaleReturns (devoluções) via fiscal-movement ===');
// Ops de devolução TOTVS (mesma constante do crm.routes.js)
const DEVOL_OPS = new Set([1202, 1204, 1411, 1410, 2202, 2411, 1950, 21, 7245, 7244, 7240, 7790, 1214, 20]);

const fetchMovement = async (page) => {
  const r = await axios.post(
    `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`,
    {
      filter: {
        branchCodeList: BRANCHS,
        startMovementDate: `${DATEMIN}T00:00:00`,
        endMovementDate: `${DATEMAX}T23:59:59`,
      },
      page,
      pageSize: 1000,
    },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 },
  );
  return r.data;
};

const m1 = await fetchMovement(1);
const movs = [...(m1?.items || [])];
const mtp = m1?.totalPages || 1;
for (let p = 2; p <= mtp; p++) {
  const d = await fetchMovement(p);
  movs.push(...(d?.items || []));
}
console.log(`Total movimentos fiscais: ${movs.length}`);

// Filtra SaleReturn (devolução de cliente) com ops de devolução TOTVS
const returns = movs.filter((m) => {
  if (m.operationModel !== 'SaleReturns') return false;
  const op = parseInt(m.operationCode);
  return DEVOL_OPS.has(op);
});
console.log(`SaleReturns válidos (ops devolução): ${returns.length}`);

let totalReturnsValue = 0;
const returnsBySeller = {};
for (const m of returns) {
  const val = parseFloat(m.netValue || m.grossValue || 0);
  if (val <= 0) continue;
  totalReturnsValue += val;
  const sc = String(m.sellerCode || '?');
  if (!returnsBySeller[sc]) returnsBySeller[sc] = { total: 0, count: 0, items: [] };
  returnsBySeller[sc].total += val;
  returnsBySeller[sc].count++;
  returnsBySeller[sc].items.push({
    date: m.movementDate || m.transactionDate,
    pc: m.personCode,
    pn: m.personName,
    op: m.operationCode,
    val,
  });
}
console.log(`  Total SaleReturns no canal: R$ ${totalReturnsValue.toFixed(2)}\n`);

console.log('Por sellerCode (devoluções):');
for (const [sc, v] of Object.entries(returnsBySeller).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  seller_code=${sc}: ${v.count} devs · R$ ${v.total.toFixed(2)}`);
  for (const it of v.items) {
    console.log(`     ${it.date?.slice(0,10)} op=${it.op} pc=${it.pc} ${(it.pn || '').slice(0,30)} R$ ${it.val.toFixed(2)}`);
  }
}

// === PASSO 3: per_seller do canal-totals para ver o líquido oficial ===
console.log('=== TOTAL ESPERADO ===');
console.log(`Credev em payments: R$ ${totalCredevPayments.toFixed(2)}`);
console.log(`SaleReturns:        R$ ${totalReturnsValue.toFixed(2)}`);
console.log(`Total credev W21:   R$ ${(totalCredevPayments + totalReturnsValue).toFixed(2)}`);
