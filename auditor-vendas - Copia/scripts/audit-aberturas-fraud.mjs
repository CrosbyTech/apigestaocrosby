// AUDITORIA DE FRAUDE EM META DE ABERTURA + FATURAMENTO
// Para cada NF cancelada do David e Arthur:
//   - Quando o cliente foi cadastrado? (insertDate)
//   - Cadastro foi RECENTE em relação à NF? (< 30 dias = abertura recente)
//   - Cliente tem outras NFs VÁLIDAS? (se não, foi "cliente fantasma" só pra meta)
//   - Em que filial foi cadastrado?
//
// Se um cliente: foi cadastrado dias antes + única NF cancelada + nenhuma
// outra compra → padrão claríssimo de fraude (burla meta de abertura + fat).
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

// ─── 1) Puxa NFs canceladas dos 2 vendedores ────────────────────────────
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

// Filtra: NFs canceladas/deletadas de David (26) e Arthur (259)
const SUSPEITOS = { 26: 'David', 259: 'Arthur' };
const canceladasInv = allNFs
  .filter(
    (nf) =>
      (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') &&
      SUSPEITOS[dominantDealer(nf)],
  )
  .map((nf) => ({
    tx: nf.transactionCode,
    issueDate: nf.issueDate,
    lastchangeDate: nf.lastchangeDate,
    status: nf.invoiceStatus,
    valor: Number(nf.totalValue || 0),
    personCode: nf.personCode,
    personName: nf.personName,
    branch: nf.branchCode,
    dealer: dominantDealer(nf),
    vendor: SUSPEITOS[dominantDealer(nf)],
    userCode: nf.userCode,
  }));

console.log(`NFs canceladas David+Arthur: ${canceladasInv.length}\n`);

// ─── 2) Para cada personCode envolvido, busca insertDate ────────────────
const allPersonCodes = [...new Set(canceladasInv.map((c) => c.personCode))];
console.log(`Buscando dados de ${allPersonCodes.length} clientes...`);

async function fetchPersons(codes) {
  const out = new Map();
  // PJ
  try {
    const r = await axios.post(
      `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
      {
        filter: { personCodeList: codes },
        expand: 'classifications',
        page: 1,
        pageSize: 200,
      },
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
    );
    for (const p of r.data?.items || []) {
      out.set(p.code, { ...p, _kind: 'PJ' });
    }
  } catch {}
  // PF
  try {
    const r = await axios.post(
      `${TOTVS_BASE_URL}/person/v2/individuals/search`,
      {
        filter: { personCodeList: codes },
        expand: 'classifications',
        page: 1,
        pageSize: 200,
      },
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
    );
    for (const p of r.data?.items || []) {
      if (!out.has(p.code)) out.set(p.code, { ...p, _kind: 'PF' });
    }
  } catch {}
  return out;
}

const personMap = await fetchPersons(allPersonCodes);
console.log(`Clientes encontrados: ${personMap.size}\n`);

// ─── 3) Cruza tudo + analisa "compras válidas" do mesmo cliente ─────────
// allNFs já tem todas as NFs (válidas + canceladas) — vamos contar por cliente
const validasPorCliente = new Map();
for (const nf of allNFs) {
  if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
  const pc = nf.personCode;
  if (!validasPorCliente.has(pc)) {
    validasPorCliente.set(pc, { count: 0, valor: 0, dates: [] });
  }
  const e = validasPorCliente.get(pc);
  e.count++;
  e.valor += Number(nf.totalValue || 0);
  e.dates.push(nf.issueDate);
}

// ─── 4) RELATÓRIO ───────────────────────────────────────────────────────
function daysDiff(d1, d2) {
  if (!d1 || !d2) return null;
  const a = new Date(d1.slice(0, 10));
  const b = new Date(d2.slice(0, 10));
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

console.log('═'.repeat(110));
console.log('CRUZAMENTO: NFs CANCELADAS × CADASTRO DO CLIENTE × COMPRAS VÁLIDAS');
console.log('═'.repeat(110));

// Agrupa por vendedor
for (const [dc, name] of Object.entries(SUSPEITOS)) {
  const nfsV = canceladasInv.filter((c) => c.dealer === Number(dc));
  if (nfsV.length === 0) continue;
  console.log(`\n▼ ${name} (dealer ${dc}) — ${nfsV.length} NFs canceladas\n`);

  const flags = [];
  for (const nf of nfsV.sort((a, b) => (a.issueDate < b.issueDate ? -1 : 1))) {
    const p = personMap.get(nf.personCode);
    const insertDate = p?.insertDate || p?.startDate || null;
    const branchInsert = p?.branchInsertCode || '?';
    const insertTipo = p?._kind || '?';
    const diasCadAteCanc = daysDiff(insertDate, nf.issueDate);
    const valido = validasPorCliente.get(nf.personCode);
    const temValidas = valido && valido.count > 0;

    // Red flags
    const tags = [];
    if (insertDate && diasCadAteCanc != null && diasCadAteCanc <= 30) {
      tags.push(`🚩 CADASTRO RECENTE (${diasCadAteCanc}d antes)`);
    }
    if (insertDate && diasCadAteCanc != null && diasCadAteCanc <= 7) {
      tags.push(`🚩🚩 CADASTRO MUITO RECENTE`);
    }
    if (!temValidas) tags.push(`🚩 CLIENTE NUNCA TEVE NF VÁLIDA`);
    else if (valido.count === 1) tags.push(`⚠️ Cliente teve só 1 NF válida`);

    flags.push({ ...nf, p, diasCadAteCanc, valido, insertDate, branchInsert, insertTipo, tags });
  }

  // Mostra tabela
  for (const f of flags) {
    console.log(
      `  📄 NF ${f.tx} (${f.issueDate}, R$ ${f.valor.toFixed(2)}, ${f.status})`,
    );
    console.log(`     Cliente: ${f.personName} (PC ${f.personCode})`);
    if (f.p) {
      console.log(
        `     Cadastro:  ${f.insertDate?.slice(0, 10) || '?'}  |  Filial cadastro: ${f.branchInsert}  |  Tipo: ${f.insertTipo}  |  Status: ${f.p.customerStatus || f.p.status}`,
      );
      if (f.diasCadAteCanc != null) {
        console.log(
          `     Tempo cadastro → NF: ${f.diasCadAteCanc} dia(s)`,
        );
      }
    } else {
      console.log(`     ⚠️ Cliente NÃO encontrado no TOTVS persons`);
    }
    if (f.valido) {
      console.log(
        `     Outras NFs válidas (mesmo cliente): ${f.valido.count}  (R$ ${f.valido.valor.toFixed(2)})`,
      );
    } else {
      console.log(`     Outras NFs válidas (mesmo cliente): NENHUMA`);
    }
    if (f.tags.length > 0) {
      console.log(`     ${f.tags.join('  ')}`);
    }
    console.log('');
  }

  // Sumário
  const cadRecente = flags.filter(
    (f) => f.diasCadAteCanc != null && f.diasCadAteCanc <= 30,
  );
  const semValidas = flags.filter((f) => !f.valido);
  const ambos = flags.filter(
    (f) => f.diasCadAteCanc != null && f.diasCadAteCanc <= 30 && !f.valido,
  );
  console.log(`  📊 SUMÁRIO ${name}:`);
  console.log(`     Total NFs canceladas: ${flags.length}`);
  console.log(`     Cliente cadastrado < 30 dias antes da NF: ${cadRecente.length}`);
  console.log(`     Cliente sem outras NFs válidas: ${semValidas.length}`);
  console.log(
    `     ⚡ AMBOS (cadastro recente + zero NF válida): ${ambos.length} 🚩🚩🚩`,
  );
  if (ambos.length > 0) {
    console.log(`        ► Esses ${ambos.length} casos são FORTE indício de burla das 2 metas (abertura + faturamento)`);
  }
}
