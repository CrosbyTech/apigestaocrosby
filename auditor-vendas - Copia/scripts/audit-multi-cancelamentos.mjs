// AUDITORIA: Cancelamentos de Multimarcas por Vendedor
// Cruza com faturamento pra calcular taxa de cancelamento + red flags.
import 'dotenv/config';
import axios from 'axios';
import https from 'node:https';
import fs from 'node:fs';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const DATEMIN = process.argv[2] || '2026-01-01';
const DATEMAX = process.argv[3] || new Date().toISOString().slice(0, 10);

console.log(`🔍 AUDITORIA DE CANCELAMENTOS — MULTIMARCAS`);
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

// Multimarcas config
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
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 },
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
    console.warn(`  pg ${page}: ${err.message}`);
    return { items: [], totalPages: 0 };
  }
};

console.log('Buscando NFs (página 1)...');
const first = await fetchPage(1);
const all = [...(first?.items || [])];
const totalPages = first?.totalPages || 1;
console.log(`Total páginas: ${totalPages}`);

if (totalPages > 1) {
  const rem = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  const CONC = 3;
  let done = 1;
  for (let i = 0; i < rem.length; i += CONC) {
    const batch = rem.slice(i, i + CONC);
    const results = await Promise.all(batch.map(fetchPage));
    for (const pd of results) all.push(...(pd?.items || []));
    done += batch.length;
    if (done % 6 === 0 || done === totalPages) {
      console.log(`  ${done}/${totalPages} páginas`);
    }
  }
}
console.log(`Total NFs multimarcas: ${all.length}\n`);

// ─── DEALER MAP (nomes manuais) ───────────────────────────────────────
const dealerNameMap = {
  15: 'Heyridan',
  21: 'Rafael',
  25: 'Anderson',
  26: 'David',
  40: 'GERAL/Franquia',
  50: 'GERAL',
  65: 'Renato',
  69: 'Thalis',
  94: 'Enri PB',
  131: 'Agenor',
  161: 'Cleiton',
  165: 'Michel',
  177: 'Walter',
  241: 'Yago',
  251: 'Felipe PB',
  259: 'Arthur',
  288: 'Jucelino',
  779: 'Aldo',
  1924: 'Matheus Closer',
  7044: 'Luiz',
};

// ─── Extrai dealer dominante + dados úteis ────────────────────────────
function processNF(nf) {
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
  const dominantDealer =
    entries.length > 0
      ? Number(entries.sort((a, b) => b[1] - a[1])[0][0])
      : 0;
  return {
    tx: nf.transactionCode,
    br: Number(nf.branchCode),
    op: Number(nf.operationCode),
    status: nf.invoiceStatus,
    valor: Number(nf.totalValue || 0),
    dealer: dominantDealer,
    issueDate: nf.issueDate?.slice(0, 10) || null,
    personCode: nf.personCode,
    personName: nf.personName || '',
    sellerCpf: nf.sellerCpf || null,
  };
}

const processados = all.map(processNF);

// ─── AGREGAÇÃO POR VENDEDOR ───────────────────────────────────────────
const porVendedor = new Map();

function ensure(dealer) {
  if (!porVendedor.has(dealer)) {
    porVendedor.set(dealer, {
      dealer,
      name: dealerNameMap[dealer] || `dealer ${dealer}`,
      // Total
      totalNFs: 0,
      totalValor: 0,
      // Emitidas (não-cancelada)
      emitidasNFs: 0,
      emitidasValor: 0,
      // Canceladas
      cancNFs: 0,
      cancValor: 0,
      // Por mês
      porMes: {}, // 'YYYY-MM' -> { emitidas, canceladas, valorEmitido, valorCancelado }
      // Clientes que tiveram cancelamento
      clientesCancelados: new Map(), // personCode -> { name, count, valor }
      // Lista de canceladas
      listaCanceladas: [],
    });
  }
  return porVendedor.get(dealer);
}

for (const p of processados) {
  if (!p.dealer) continue;
  const v = ensure(p.dealer);
  const isCanceled = p.status === 'Canceled';
  const mes = (p.issueDate || '').slice(0, 7);

  v.totalNFs++;
  v.totalValor += p.valor;

  if (!v.porMes[mes]) {
    v.porMes[mes] = { emitidas: 0, canceladas: 0, valorEmitido: 0, valorCancelado: 0 };
  }

  if (isCanceled) {
    v.cancNFs++;
    v.cancValor += p.valor;
    v.porMes[mes].canceladas++;
    v.porMes[mes].valorCancelado += p.valor;
    v.listaCanceladas.push(p);
    if (p.personCode) {
      const pc = String(p.personCode);
      if (!v.clientesCancelados.has(pc)) {
        v.clientesCancelados.set(pc, { name: p.personName, count: 0, valor: 0 });
      }
      const cl = v.clientesCancelados.get(pc);
      cl.count++;
      cl.valor += p.valor;
    }
  } else if (p.status !== 'Deleted') {
    v.emitidasNFs++;
    v.emitidasValor += p.valor;
    v.porMes[mes].emitidas++;
    v.porMes[mes].valorEmitido += p.valor;
  }
}

// ─── RELATÓRIO ────────────────────────────────────────────────────────
const totalNFs = processados.length;
const totalCanceladas = processados.filter((p) => p.status === 'Canceled').length;
const totalEmitidas = totalNFs - totalCanceladas;
const totalValorEmitido = processados
  .filter((p) => p.status !== 'Canceled' && p.status !== 'Deleted')
  .reduce((s, p) => s + p.valor, 0);
const totalValorCancelado = processados
  .filter((p) => p.status === 'Canceled')
  .reduce((s, p) => s + p.valor, 0);

console.log('═══ RESUMO GERAL ═══');
console.log(`Total NFs:        ${totalNFs}`);
console.log(`Emitidas válidas: ${totalEmitidas}  (R$ ${totalValorEmitido.toFixed(2)})`);
console.log(`Canceladas:       ${totalCanceladas}  (R$ ${totalValorCancelado.toFixed(2)})`);
console.log(
  `Taxa global:      ${((totalCanceladas / totalNFs) * 100).toFixed(2)}% por qtd, ${((totalValorCancelado / (totalValorEmitido + totalValorCancelado)) * 100).toFixed(2)}% por valor`,
);
console.log('');

console.log('═══ POR VENDEDOR (ordem: mais cancelamentos) ═══');
console.log(
  `${'Vendedor'.padEnd(18)} ${'NFs Emit'.padStart(9)} ${'Valor Emit'.padStart(13)} ${'NFs Canc'.padStart(9)} ${'Valor Canc'.padStart(13)} ${'% Qtd'.padStart(7)} ${'% Valor'.padStart(8)}`,
);
console.log('-'.repeat(85));
const sorted = [...porVendedor.values()].sort((a, b) => b.cancNFs - a.cancNFs);
for (const v of sorted) {
  const pctQtd = v.totalNFs > 0 ? (v.cancNFs / v.totalNFs) * 100 : 0;
  const pctVal =
    v.emitidasValor + v.cancValor > 0
      ? (v.cancValor / (v.emitidasValor + v.cancValor)) * 100
      : 0;
  const flag = pctQtd > 10 ? ' 🚩' : pctQtd > 5 ? ' ⚠️ ' : '';
  console.log(
    `${v.name.padEnd(18)} ${String(v.emitidasNFs).padStart(9)} R$ ${v.emitidasValor.toFixed(2).padStart(11)} ${String(v.cancNFs).padStart(9)} R$ ${v.cancValor.toFixed(2).padStart(11)} ${pctQtd.toFixed(1).padStart(6)}% ${pctVal.toFixed(1).padStart(7)}%${flag}`,
  );
}

console.log('');
console.log('═══ RED FLAGS (vendedores com > 0 cancelamentos) ═══\n');
const comCancelamento = sorted.filter((v) => v.cancNFs > 0);
for (const v of comCancelamento) {
  console.log(`▼ ${v.name} (dealer ${v.dealer})`);
  const pctQtd = v.totalNFs > 0 ? (v.cancNFs / v.totalNFs) * 100 : 0;
  console.log(
    `  ${v.cancNFs} canceladas de ${v.totalNFs} (${pctQtd.toFixed(1)}%) | R$ ${v.cancValor.toFixed(2)} cancelados`,
  );

  // Por mês
  const meses = Object.keys(v.porMes).sort();
  if (meses.length > 1) {
    console.log(`  Por mês:`);
    for (const m of meses) {
      const pm = v.porMes[m];
      if (pm.canceladas > 0) {
        const taxaM = pm.canceladas + pm.emitidas > 0
          ? (pm.canceladas / (pm.canceladas + pm.emitidas)) * 100
          : 0;
        console.log(
          `    ${m}: ${pm.canceladas} canc de ${pm.canceladas + pm.emitidas} NFs (${taxaM.toFixed(1)}%)  R$ ${pm.valorCancelado.toFixed(2)} cancelados`,
        );
      }
    }
  }

  // Top clientes cancelados (red flag se mesmo cliente repete muito)
  const topClientes = [...v.clientesCancelados.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  if (topClientes.length > 0) {
    console.log(`  Clientes com cancelamento:`);
    for (const cl of topClientes) {
      const repeat = cl.count > 2 ? ' 🚩 REPETIDO!' : '';
      console.log(
        `    ${cl.count}x  R$ ${cl.valor.toFixed(2).padStart(10)}  ${cl.name.slice(0, 40)}${repeat}`,
      );
    }
  }
  console.log('');
}

// ─── EXPORTA CSV ───────────────────────────────────────────────────────
console.log('═══ EXPORTANDO CSV ═══');
const csvLines = [
  'data,nf_tx,filial,operacao,status,vendedor_code,vendedor_nome,valor,cliente_code,cliente_nome',
];
for (const p of processados) {
  if (p.status === 'Canceled' || p.status === 'Deleted') {
    const name = (dealerNameMap[p.dealer] || `dealer_${p.dealer}`).replace(
      /,/g,
      ' ',
    );
    const clientName = String(p.personName).replace(/[",;]/g, ' ').slice(0, 60);
    csvLines.push(
      [
        p.issueDate,
        p.tx,
        p.br,
        p.op,
        p.status,
        p.dealer,
        name,
        p.valor.toFixed(2),
        p.personCode,
        clientName,
      ].join(','),
    );
  }
}
const csvPath = `/tmp/audit-multimarcas-cancelamentos-${DATEMIN}_${DATEMAX}.csv`;
fs.writeFileSync(csvPath, csvLines.join('\n'));
console.log(`CSV: ${csvPath} (${csvLines.length - 1} linhas)`);
