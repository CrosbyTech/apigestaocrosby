// Cruza devoluções (SaleReturns) com TODOS os clientes do David nos últimos 12 meses
import 'dotenv/config';
import axios from 'axios';
import https from 'node:https';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const HOJE = new Date().toISOString().slice(0, 10);
// Chunks de 3 meses pra evitar TOTVS engasgar com queries gigantes
const HISTORICO_CHUNKS = [
  ['2025-09-01', '2025-11-30'],
  ['2025-12-01', '2026-02-28'],
  ['2026-03-01', '2026-05-26'],
];
const W21_INI = '2026-05-18';
const W21_FIM = '2026-05-24';
const BRANCHS = [99, 2, 95, 87, 88, 90, 94, 97];
const OPS_VENDA = [7235, 7241, 9127, 200];
const DEVOL_OPS = new Set([1202, 1204, 1411, 1410, 2202, 2411, 1950, 21, 7245, 7244, 7240, 7790, 1214, 20]);

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

// === 1) Pega TODOS os personCodes que o David (dealer 26) atendeu ===
console.log(`📋 Buscando histórico de clientes do David em chunks...`);

const fetchInvChunk = async (di, df, page, retries = 2) => {
  try {
    const r = await axios.post(
      `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
      {
        filter: {
          branchCodeList: BRANCHS,
          operationCodeList: OPS_VENDA,
          operationType: 'Output',
          startIssueDate: `${di}T00:00:00`,
          endIssueDate: `${df}T23:59:59`,
        },
        expand: 'items',
        page,
        pageSize: 100,
      },
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 180000 },
    );
    return r.data;
  } catch (err) {
    if (err.response?.status === 401 && retries > 0) {
      token = await getToken();
      return fetchInvChunk(di, df, page, retries - 1);
    }
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 3000));
      return fetchInvChunk(di, df, page, retries - 1);
    }
    return { items: [], totalPages: 0 };
  }
};

const allNFs = [];
for (const [di, df] of HISTORICO_CHUNKS) {
  console.log(`  chunk ${di} → ${df}...`);
  const f1 = await fetchInvChunk(di, df, 1);
  const chunkNFs = [...(f1?.items || [])];
  const tp = f1?.totalPages || 1;
  for (let p = 2; p <= tp; p++) {
    const d = await fetchInvChunk(di, df, p);
    chunkNFs.push(...(d?.items || []));
  }
  console.log(`     +${chunkNFs.length} NFs`);
  allNFs.push(...chunkNFs);
}
console.log(`  TOTAL: ${allNFs.length} NFs do canal Inbound`);

// Clientes do David (dealer 26)
const davidClientes = new Map();
for (const nf of allNFs) {
  if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
  if (dominantDealer(nf) !== 26) continue;
  const pc = nf.personCode;
  if (!davidClientes.has(pc)) {
    davidClientes.set(pc, { name: nf.personName, nfs: 0, totalEmitido: 0 });
  }
  const c = davidClientes.get(pc);
  c.nfs++;
  c.totalEmitido += Number(nf.totalValue || 0);
}
console.log(`  Clientes únicos do David: ${davidClientes.size}\n`);

// === 2) Pega SaleReturns de W21 (pode expandir) ===
console.log(`📋 Buscando SaleReturns (devoluções) W21 (${W21_INI} → ${W21_FIM})...`);
const fetchFm = async (page, retries = 2) => {
  try {
    const r = await axios.post(
      `${TOTVS_BASE_URL}/analytics/v2/fiscal-movement/search`,
      {
        filter: {
          branchCodeList: BRANCHS,
          startMovementDate: `${W21_INI}T00:00:00`,
          endMovementDate: `${W21_FIM}T23:59:59`,
        },
        page,
        pageSize: 1000,
      },
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 },
    );
    return r.data;
  } catch (err) {
    if (err.response?.status === 401 && retries > 0) {
      token = await getToken();
      return fetchFm(page, retries - 1);
    }
    return { items: [] };
  }
};
const fm1 = await fetchFm(1);
const fms = [...(fm1?.items || [])];
const fmtp = fm1?.totalPages || 1;
for (let p = 2; p <= fmtp; p++) {
  const d = await fetchFm(p);
  fms.push(...(d?.items || []));
}
const returns = fms.filter((m) => m.operationModel === 'SaleReturns' && DEVOL_OPS.has(parseInt(m.operationCode)));
console.log(`  SaleReturns W21: ${returns.length}\n`);

// === 3) Cruza ===
console.log(`🔍 CRUZAMENTO: Clientes do David QUE devolveram em W21\n`);
const devolucoesPorClienteDoDavid = new Map();
for (const m of returns) {
  const pc = parseInt(m.personCode);
  if (!davidClientes.has(pc)) continue;
  const v = parseFloat(m.netValue || m.grossValue || 0);
  if (v <= 0) continue;
  const cur = devolucoesPorClienteDoDavid.get(pc) || { count: 0, total: 0, items: [] };
  cur.count++;
  cur.total += v;
  cur.items.push({
    date: m.movementDate?.slice(0, 10),
    op: m.operationCode,
    val: v,
    seller: m.sellerCode,
  });
  devolucoesPorClienteDoDavid.set(pc, cur);
}

if (devolucoesPorClienteDoDavid.size === 0) {
  console.log('  ❌ NENHUM cliente do David teve devolução em W21.');
  console.log('  (As 69 devoluções W21 do canal Inbound foram de clientes que NUNCA foram atendidos pelo David)\n');
} else {
  console.log(`  ✅ ${devolucoesPorClienteDoDavid.size} cliente(s) do David tiveram devolução em W21:\n`);
  for (const [pc, v] of [...devolucoesPorClienteDoDavid.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const cli = davidClientes.get(pc);
    console.log(`  ✦ pc=${pc} ${cli.name}`);
    console.log(`      Histórico com David: ${cli.nfs} NFs · R$ ${cli.totalEmitido.toFixed(2)} emitidos`);
    console.log(`      Devoluções W21: ${v.count} mov · R$ ${v.total.toFixed(2)}`);
    for (const it of v.items) {
      console.log(`          ${it.date} op=${it.op} seller=${it.seller} R$ ${it.val.toFixed(2)}`);
    }
    console.log();
  }
}

// === 4) Sample dos top clientes que devolveram (não-David) ===
console.log('\n=== Top 10 clientes com devolução em W21 (mesmo NÃO sendo do David) ===');
const porClienteAll = new Map();
for (const m of returns) {
  const pc = parseInt(m.personCode);
  const v = parseFloat(m.netValue || m.grossValue || 0);
  if (v <= 0) continue;
  const cur = porClienteAll.get(pc) || { count: 0, total: 0, name: m.personName };
  cur.count++;
  cur.total += v;
  porClienteAll.set(pc, cur);
}
const top = [...porClienteAll.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
for (const [pc, v] of top) {
  const ehDoDavid = davidClientes.has(pc) ? '⭐ CLIENTE DO DAVID' : '';
  console.log(`  pc=${pc.toString().padEnd(7)} ${(v.name || '').slice(0, 30).padEnd(30)}  ${v.count} mov · R$ ${v.total.toFixed(2).padStart(10)}  ${ehDoDavid}`);
}
