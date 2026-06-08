// INVESTIGAÇÃO PROFUNDA: David (26) e Arthur (259) — padrão fraude
// "fatura, espera, cancela alegando documento não assinado"
//
// Métricas-chave:
//   - tempo entre emissão (exitTime/issueDate) e deleção (lastchangeDate)
//   - dia/horário do cancelamento
//   - userCode (quem fez a operação)
//   - cliente foi re-faturado depois? (sinal de retrabalho legítimo OU
//     sinal de "ressubmissão" pra retrabalhar comissão)
//   - histórico do cliente: faturamento total + qtd cancelamentos
import 'dotenv/config';
import axios from 'axios';
import https from 'node:https';
import fs from 'node:fs';

const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const DATEMIN = process.argv[2] || '2026-01-01';
const DATEMAX = process.argv[3] || new Date().toISOString().slice(0, 10);

console.log(`🔬 INVESTIGAÇÃO: Arthur (259) & David (26)`);
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
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent,
    },
  );
  return r.data.access_token;
}
let token = await getToken();

const MULTI_BRANCHS = [99, 2, 95, 87, 88, 90, 94, 97];
const MULTI_OPS = [7235, 7241, 9127, 200];

const fetchPage = async (page, retries = 2) => {
  try {
    const r = await axios.post(
      `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
      {
        filter: {
          branchCodeList: MULTI_BRANCHS,
          operationCodeList: MULTI_OPS,
          operationType: 'Output',
          startIssueDate: `${DATEMIN}T00:00:00`,
          endIssueDate: `${DATEMAX}T23:59:59`,
        },
        expand: 'items',
        page,
        pageSize: 100,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
        httpsAgent,
        timeout: 120000,
      },
    );
    return r.data;
  } catch (err) {
    if (err.response?.status === 401 && retries > 0) {
      token = await getToken();
      return fetchPage(page, retries - 1);
    }
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 2000));
      return fetchPage(page, retries - 1);
    }
    return { items: [], totalPages: 0 };
  }
};

console.log('Puxando NFs do TOTVS...');
const first = await fetchPage(1);
const all = [...(first?.items || [])];
const totalPages = first?.totalPages || 1;
if (totalPages > 1) {
  const rem = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  const CONC = 3;
  for (let i = 0; i < rem.length; i += CONC) {
    const results = await Promise.all(rem.slice(i, i + CONC).map(fetchPage));
    for (const pd of results) all.push(...(pd?.items || []));
  }
}
console.log(`Total NFs: ${all.length}\n`);

// Helper: dealer dominante (decide a quem a NF pertence)
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
  return entries.length > 0
    ? Number(entries.sort((a, b) => b[1] - a[1])[0][0])
    : null;
}

// Helper: tempo entre emissão e cancelamento
function deltaCancel(nf) {
  if (!nf.lastchangeDate || !nf.issueDate) return null;
  // Emissão = issueDate + exitTime (se houver)
  const emissaoStr = nf.exitTime
    ? `${nf.issueDate}T${nf.exitTime}`
    : `${nf.issueDate}T00:00:00`;
  const emissao = new Date(emissaoStr);
  const cancel = new Date(nf.lastchangeDate);
  const diffMs = cancel - emissao;
  if (isNaN(diffMs) || diffMs < 0) return null;
  return diffMs / 1000 / 60; // minutos
}

function fmtDelta(min) {
  if (min == null) return 'n/a';
  if (min < 60) return `${min.toFixed(0)} min`;
  if (min < 60 * 24) return `${(min / 60).toFixed(1)} h`;
  return `${(min / 60 / 24).toFixed(1)} dias`;
}

// Separa por vendedor
const VENDEDORES_INVESTIGADOS = {
  259: 'Arthur',
  26: 'David',
};

const porVendedor = new Map();
for (const dc of Object.keys(VENDEDORES_INVESTIGADOS)) {
  porVendedor.set(Number(dc), {
    code: Number(dc),
    name: VENDEDORES_INVESTIGADOS[dc],
    emitidas: [], // status 'Authorized' / vazio
    canceladas: [], // status Canceled/Deleted
    clientes: new Map(), // personCode -> { name, emit, canc, valor_emit, valor_canc }
  });
}

// Classifica e popula
for (const nf of all) {
  const dealer = dominantDealer(nf);
  if (!dealer || !VENDEDORES_INVESTIGADOS[dealer]) continue;
  const v = porVendedor.get(dealer);
  const isCanc =
    nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted';
  const pc = nf.personCode;
  const valor = Number(nf.totalValue || 0);

  if (!v.clientes.has(pc)) {
    v.clientes.set(pc, {
      personCode: pc,
      name: nf.personName,
      emit: 0,
      canc: 0,
      valor_emit: 0,
      valor_canc: 0,
      nfs: [],
    });
  }
  const cl = v.clientes.get(pc);
  cl.nfs.push({
    tx: nf.transactionCode,
    op: nf.operationCode,
    issueDate: nf.issueDate,
    exitTime: nf.exitTime,
    lastchangeDate: nf.lastchangeDate,
    status: nf.invoiceStatus,
    valor,
    userCode: nf.userCode,
    delta_min: deltaCancel(nf),
  });

  if (isCanc) {
    v.canceladas.push(nf);
    cl.canc++;
    cl.valor_canc += valor;
  } else {
    v.emitidas.push(nf);
    cl.emit++;
    cl.valor_emit += valor;
  }
}

// ─── RELATÓRIO ────────────────────────────────────────────────────────
for (const v of porVendedor.values()) {
  console.log('═'.repeat(80));
  console.log(`▼ ${v.name} (dealer ${v.code})`);
  console.log('═'.repeat(80));
  console.log(
    `  NFs emitidas: ${v.emitidas.length}  |  NFs canc/del: ${v.canceladas.length}`,
  );
  const valorEmit = v.emitidas.reduce(
    (s, n) => s + Number(n.totalValue || 0),
    0,
  );
  const valorCanc = v.canceladas.reduce(
    (s, n) => s + Number(n.totalValue || 0),
    0,
  );
  console.log(
    `  Valor emitido: R$ ${valorEmit.toFixed(2)}  |  Valor cancelado: R$ ${valorCanc.toFixed(2)}`,
  );
  const taxa =
    v.emitidas.length + v.canceladas.length > 0
      ? (v.canceladas.length /
          (v.emitidas.length + v.canceladas.length)) *
        100
      : 0;
  console.log(`  Taxa de cancelamento: ${taxa.toFixed(1)}%`);
  console.log('');

  // Stats de tempo entre emissão e cancelamento
  const deltas = v.canceladas
    .map(deltaCancel)
    .filter((d) => d != null);
  if (deltas.length > 0) {
    const sorted = [...deltas].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted[Math.floor(sorted.length / 2)];
    const avg = sorted.reduce((s, x) => s + x, 0) / sorted.length;
    console.log(`  ⏱ TEMPO ENTRE EMISSÃO E CANCELAMENTO:`);
    console.log(`     Mediana: ${fmtDelta(median)}`);
    console.log(`     Média:   ${fmtDelta(avg)}`);
    console.log(`     Mínimo:  ${fmtDelta(min)}`);
    console.log(`     Máximo:  ${fmtDelta(max)}`);
    const sub10min = deltas.filter((d) => d < 10).length;
    const sub1h = deltas.filter((d) => d < 60).length;
    const sub1dia = deltas.filter((d) => d < 60 * 24).length;
    console.log(
      `     < 10 min: ${sub10min}  |  < 1h: ${sub1h}  |  < 24h: ${sub1dia}`,
    );
  }
  console.log('');

  // Detalhe de cada NF cancelada
  console.log(`  📋 DETALHE DAS ${v.canceladas.length} NFs CANCELADAS/DELETADAS:`);
  console.log(
    `  ${'Data'.padEnd(11)} ${'Hora Emit'.padEnd(10)} ${'Hora Canc'.padEnd(17)} ${'Delta'.padEnd(8)} ${'Status'.padEnd(9)} ${'tx'.padEnd(7)} ${'user'.padEnd(5)} ${'Valor'.padStart(11)} Cliente`,
  );
  const cancSorted = [...v.canceladas].sort(
    (a, b) =>
      new Date(a.issueDate || 0).getTime() -
      new Date(b.issueDate || 0).getTime(),
  );
  for (const nf of cancSorted) {
    const delta = deltaCancel(nf);
    const cancelaTime = nf.lastchangeDate?.slice(11, 19) || '?';
    const cancelaDate = nf.lastchangeDate?.slice(0, 10) || '?';
    const mesmoDia = cancelaDate === nf.issueDate ? '' : ` (cancelou em ${cancelaDate})`;
    console.log(
      `  ${(nf.issueDate || '').padEnd(11)} ${(nf.exitTime || '').padEnd(10)} ${cancelaTime.padEnd(17)} ${fmtDelta(delta).padEnd(8)} ${(nf.invoiceStatus || '').padEnd(9)} ${String(nf.transactionCode).padEnd(7)} ${String(nf.userCode || '?').padEnd(5)} R$ ${Number(nf.totalValue || 0).toFixed(2).padStart(9)} ${(nf.personName || '').slice(0, 35)}${mesmoDia}`,
    );
  }
  console.log('');

  // Clientes com cancelamentos — distingue:
  //  A) cliente que SÓ tem cancelamento (suspeito — nunca recebeu de fato)
  //  B) cliente que tem cancelamento + outras NFs emitidas válidas (retrabalho?)
  console.log(`  👥 CLIENTES IMPACTADOS:`);
  const clientesComCanc = [...v.clientes.values()]
    .filter((c) => c.canc > 0)
    .sort((a, b) => b.valor_canc - a.valor_canc);
  console.log(
    `  ${'PC'.padEnd(7)} ${'Cliente'.padEnd(40)} ${'Emit'.padStart(4)} ${'Canc'.padStart(4)} ${'V.Emit'.padStart(11)} ${'V.Canc'.padStart(11)} Caso`,
  );
  for (const cl of clientesComCanc) {
    let caso = '';
    if (cl.emit === 0 && cl.canc > 0) caso = '🚩 SÓ CANCELAMENTO';
    else if (cl.canc > cl.emit) caso = '⚠️ + canc que emit';
    else if (cl.canc > 1) caso = 'cliente com várias canc';
    else caso = '1 canc isolada';
    console.log(
      `  ${String(cl.personCode).padEnd(7)} ${(cl.name || '').slice(0, 40).padEnd(40)} ${String(cl.emit).padStart(4)} ${String(cl.canc).padStart(4)} R$ ${cl.valor_emit.toFixed(2).padStart(9)} R$ ${cl.valor_canc.toFixed(2).padStart(9)} ${caso}`,
    );
  }
  console.log('');
}

// ─── userCode summary ─────────────────────────────────────────────────
console.log('═══ userCode (quem efetuou a operação) ═══');
const userCodes = new Set();
for (const v of porVendedor.values()) {
  for (const nf of v.canceladas) {
    if (nf.userCode) userCodes.add(nf.userCode);
  }
}
console.log(`userCodes únicos nas NFs canceladas: ${[...userCodes].join(', ')}`);
console.log('(precisa cruzar com cadastro do TOTVS pra saber quem é cada user)');
