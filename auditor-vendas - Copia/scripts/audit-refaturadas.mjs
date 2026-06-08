// Para cada NF cancelada de David/Arthur, identifica:
//   - Houve NF válida com o mesmo cliente DEPOIS do cancelamento?
//   - Quantos dias entre cancelar e refaturar?
//   - Valor "similar" (±20%) → provável retrabalho/re-emissão do mesmo pedido
//   - Valor "diferente" → venda nova, não tem a ver
//   - Sem refaturamento → cliente fantasma
import 'dotenv/config';
import axios from 'axios';
import https from 'node:https';

const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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
const token = await getToken();

const DATEMIN = '2026-01-01';
const DATEMAX = new Date().toISOString().slice(0, 10);
const MULTI_BRANCHS = [99, 2, 95, 87, 88, 90, 94, 97];
const MULTI_OPS = [7235, 7241, 9127, 200];

const fetchInvPage = (page) =>
  axios
    .post(
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
    )
    .then((r) => r.data)
    .catch(() => ({ items: [] }));

console.log(`Puxando NFs multimarcas ${DATEMIN} → ${DATEMAX}...`);
const first = await fetchInvPage(1);
const allNFs = [...(first.items || [])];
const totalPages = first.totalPages || 1;
if (totalPages > 1) {
  const rem = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  for (let i = 0; i < rem.length; i += 3) {
    const r = await Promise.all(rem.slice(i, i + 3).map(fetchInvPage));
    for (const pd of r) allNFs.push(...(pd?.items || []));
  }
}
console.log(`Total NFs: ${allNFs.length}\n`);

function dominantDealer(nf) {
  const m = {};
  for (const it of nf.items || [])
    for (const p of it.products || [])
      if (p.dealerCode) m[p.dealerCode] = (m[p.dealerCode] || 0) + Number(p.netValue || 0);
  const e = Object.entries(m);
  return e.length ? Number(e.sort((a, b) => b[1] - a[1])[0][0]) : null;
}

const SUSPEITOS = { 26: 'David', 259: 'Arthur' };

// Indexa NFs válidas por personCode + ordena por data
const validasPorCliente = new Map();
for (const nf of allNFs) {
  if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
  const pc = nf.personCode;
  if (!validasPorCliente.has(pc)) validasPorCliente.set(pc, []);
  validasPorCliente.get(pc).push({
    tx: nf.transactionCode,
    issueDate: nf.issueDate,
    valor: Number(nf.totalValue || 0),
    op: nf.operationCode,
    dealer: dominantDealer(nf),
  });
}
for (const arr of validasPorCliente.values()) {
  arr.sort((a, b) => (a.issueDate < b.issueDate ? -1 : 1));
}

function daysBetween(d1, d2) {
  return Math.round(
    (new Date(d2.slice(0, 10)) - new Date(d1.slice(0, 10))) / (1000 * 60 * 60 * 24),
  );
}

// Filtra canceladas do David/Arthur
const canceladasFraud = allNFs
  .filter(
    (nf) =>
      (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') &&
      SUSPEITOS[dominantDealer(nf)],
  )
  .map((nf) => ({
    tx: nf.transactionCode,
    issueDate: nf.issueDate,
    cancelDate: nf.lastchangeDate?.slice(0, 10) || nf.issueDate,
    status: nf.invoiceStatus,
    valor: Number(nf.totalValue || 0),
    personCode: nf.personCode,
    personName: nf.personName,
    vendor: SUSPEITOS[dominantDealer(nf)],
    dealer: dominantDealer(nf),
  }))
  .sort((a, b) => (a.cancelDate < b.cancelDate ? -1 : 1));

console.log('═'.repeat(110));
console.log('REFATURAMENTO DAS NFs CANCELADAS — David & Arthur');
console.log('═'.repeat(110));

const categorias = {
  refatExato: [], // valor ≈ igual (refaturada mesma operação)
  refatDiferente: [], // refaturou mas valor muito diferente
  semRefat: [], // não refaturou
  refatPorOutroVendedor: [], // refaturado mas por outro dealer
};

for (const c of canceladasFraud) {
  const validas = validasPorCliente.get(c.personCode) || [];
  // Filtra apenas NFs APÓS o cancelamento
  const posterior = validas.filter((v) => v.issueDate > c.cancelDate);

  let categoria = 'semRefat';
  let match = null;

  if (posterior.length > 0) {
    // procura uma NF similar em valor (±20%) dentro de 60 dias
    const similar = posterior.find((v) => {
      const dDias = daysBetween(c.cancelDate, v.issueDate);
      const diff = Math.abs(v.valor - c.valor) / c.valor;
      return diff <= 0.2 && dDias <= 60;
    });
    if (similar) {
      categoria = similar.dealer === c.dealer ? 'refatExato' : 'refatPorOutroVendedor';
      match = similar;
    } else {
      // Tem NF posterior mas valor bem diferente — venda nova, não refaturamento
      categoria = 'refatDiferente';
      match = posterior[0];
    }
  }

  const entry = { ...c, posterior, match, categoria };
  categorias[categoria].push(entry);
}

// ─── RELATÓRIO ───────────────────────────────────────────────────────
console.log(`\n📊 RESUMO GERAL (13 NFs canceladas David+Arthur):\n`);
console.log(
  `  ✅ Refaturadas (valor similar ±20%, mesmo vendedor): ${categorias.refatExato.length}`,
);
console.log(
  `  ⚠️ Refaturadas por OUTRO vendedor:                     ${categorias.refatPorOutroVendedor.length}`,
);
console.log(
  `  📦 Cliente teve outras vendas (valores diferentes):    ${categorias.refatDiferente.length}`,
);
console.log(
  `  🚩 NÃO refaturadas (cliente sumiu):                    ${categorias.semRefat.length}`,
);
console.log('');

// Detalhe por categoria
function printGroup(title, items, includeMatch = true) {
  if (items.length === 0) return;
  console.log(`\n── ${title} (${items.length}) ──`);
  for (const c of items) {
    console.log(
      `  📄 NF ${c.tx} | ${c.vendor} | ${c.issueDate} | R$ ${c.valor.toFixed(2)} | ${c.personName}`,
    );
    if (includeMatch && c.match) {
      const dDias = daysBetween(c.cancelDate, c.match.issueDate);
      console.log(
        `     ↳ Refaturada por NF ${c.match.tx} em ${c.match.issueDate}  (${dDias} dias depois)  R$ ${c.match.valor.toFixed(2)}  dealer=${c.match.dealer}`,
      );
    } else if (c.posterior?.length > 0) {
      console.log(
        `     ↳ Cliente teve ${c.posterior.length} outras NFs depois (a 1ª em ${c.posterior[0].issueDate}, R$ ${c.posterior[0].valor.toFixed(2)})`,
      );
    } else {
      console.log(`     ↳ Nenhuma NF válida posterior — cliente NÃO voltou a comprar`);
    }
  }
}

printGroup('🚩 NÃO REFATURADAS — cliente fantasma', categorias.semRefat);
printGroup(
  '✅ REFATURADAS (valor similar, mesmo vendedor) — provável retrabalho legítimo',
  categorias.refatExato,
);
printGroup(
  '⚠️ Refaturadas por OUTRO vendedor',
  categorias.refatPorOutroVendedor,
);
printGroup(
  '📦 Cliente teve outras vendas — mas com valor diferente (não foi refaturamento da mesma NF)',
  categorias.refatDiferente,
);

// Por vendedor
console.log(`\n${'═'.repeat(110)}\n📊 POR VENDEDOR:\n`);
for (const v of ['David', 'Arthur']) {
  const exato = categorias.refatExato.filter((c) => c.vendor === v).length;
  const outro = categorias.refatPorOutroVendedor.filter((c) => c.vendor === v).length;
  const diff = categorias.refatDiferente.filter((c) => c.vendor === v).length;
  const sem = categorias.semRefat.filter((c) => c.vendor === v).length;
  const total = exato + outro + diff + sem;
  console.log(`  ${v}: ${total} NFs canceladas`);
  console.log(`    ✅ Refaturadas similar:        ${exato}`);
  console.log(`    ⚠️ Refaturadas outro vendedor: ${outro}`);
  console.log(`    📦 Cliente teve outras vendas: ${diff}`);
  console.log(`    🚩 Cliente sumiu:               ${sem}`);
}
