// Busca TODO o histórico de NFs de J SILVA DOS REIS (PC 116809)
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

const PC = 116809;

// 1) Dados de cadastro
console.log('═══ DADOS DE CADASTRO ═══');
const pj = await axios
  .post(
    `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
    {
      filter: { personCodeList: [PC] },
      expand: 'phones,addresses,classifications',
      page: 1,
      pageSize: 5,
    },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
  )
  .then((r) => r.data?.items?.[0])
  .catch(() => null);

if (pj) {
  console.log(`  Nome:         ${pj.name}`);
  console.log(`  CNPJ:         ${pj.cnpj}`);
  console.log(`  Fantasia:     ${pj.fantasyName}`);
  console.log(`  IE:           ${pj.numberStateRegistration}`);
  console.log(`  UF:           ${pj.uf}`);
  console.log(`  Inserido:     ${pj.insertDate}`);
  console.log(`  Filial cad.:  ${pj.branchInsertCode}`);
  console.log(`  Status:       ${pj.customerStatus} (isActive: ${!pj.isInactive})`);
  console.log(`  É cliente:    ${pj.isCustomer}`);
  console.log(`  É fornecedor: ${pj.isSupplier}`);
  console.log(`  É represent.: ${pj.isRepresentative}`);
  console.log(`  É transp.:    ${pj.isShippingCompany}`);
  if (pj.classifications) {
    console.log(`  Classificações:`);
    for (const c of pj.classifications) {
      console.log(`    - ${c.typeCode}/${c.typeName}: ${c.code}/${c.name}`);
    }
  }
  if (pj.addresses) {
    console.log(`  Endereços:`);
    for (const a of pj.addresses) {
      console.log(
        `    - ${a.addressType}: ${a.publicPlace || ''} ${a.number || ''}, ${a.neighborhood || ''}, ${a.city || ''}-${a.uf || ''} ${a.cep || ''}`,
      );
    }
  }
  if (pj.phones) {
    console.log(`  Telefones:`);
    for (const p of pj.phones) {
      console.log(`    - ${p.typeName}: ${p.number}`);
    }
  }
}

// 2) TODAS as NFs desse cliente (qualquer data, qualquer filial)
console.log('\n═══ TODAS AS NFs (qualquer data/filial/op) ═══');
const fetchInv = async (page, kind) => {
  const variants = {
    A: { personCodeList: [PC] },
    B: { personCode: PC },
    C: { customerCodeList: [PC] },
  };
  try {
    const r = await axios.post(
      `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
      {
        filter: {
          ...variants[kind],
          operationType: 'Output',
          startIssueDate: '2020-01-01T00:00:00',
          endIssueDate: '2026-12-31T23:59:59',
        },
        expand: 'items',
        page,
        pageSize: 100,
      },
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 },
    );
    return r.data;
  } catch (err) {
    return null;
  }
};

// Testa qual variante funciona
let workingKind = null;
for (const k of ['A', 'B', 'C']) {
  const r = await fetchInv(1, k);
  if (r) {
    workingKind = k;
    break;
  }
}
console.log(`Variante de filtro usada: ${workingKind || 'NENHUMA — fazendo busca ampla'}`);

if (!workingKind) {
  // Fallback: busca SÓ multimarcas (config conhecida) em janela ampla 2024-2026
  console.log('Buscando em todas as branches multimarcas, 2024-2026, e filtrando localmente...');
  const BROAD_BRANCHS = [99, 2, 95, 87, 88, 90, 94, 97];
  const BROAD_OPS = [7235, 7241, 9127, 200];
  // Janelas mensais SEM expand (mais leve)
  const fetchBroad = async (page, dateMin, dateMax) => {
    try {
      const r = await axios.post(
        `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
        {
          filter: {
            branchCodeList: BROAD_BRANCHS,
            operationCodeList: BROAD_OPS,
            operationType: 'Output',
            startIssueDate: `${dateMin}T00:00:00`,
            endIssueDate: `${dateMax}T23:59:59`,
          },
          page,
          pageSize: 100,
        },
        { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
      );
      return r.data;
    } catch (err) {
      console.warn(`pg ${page} ${dateMin}: ${err.response?.status}`);
      return { items: [] };
    }
  };
  let allBroad = [];
  // Janelas mensais 2024-01 → 2026-05
  for (let ano = 2024; ano <= 2026; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      if (ano === 2026 && mes > 5) break;
      const mm = String(mes).padStart(2, '0');
      const lastDay = new Date(ano, mes, 0).getDate();
      const dateMin = `${ano}-${mm}-01`;
      const dateMax = `${ano}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const f1 = await fetchBroad(1, dateMin, dateMax);
      const totalP = f1?.totalPages || 0;
      const items = [...(f1?.items || [])];
      const rem = Array.from({ length: totalP - 1 }, (_, i) => i + 2);
      for (let i = 0; i < rem.length; i += 3) {
        const rs = await Promise.all(
          rem.slice(i, i + 3).map((p) => fetchBroad(p, dateMin, dateMax)),
        );
        for (const r of rs) items.push(...(r?.items || []));
      }
      const match = items.filter((nf) => Number(nf.personCode) === PC);
      if (match.length > 0) {
        console.log(
          `  ${ano}-${mm}: ${items.length} NFs varridas, ${match.length} match J Silva`,
        );
      }
      allBroad.push(...match);
    }
  }
  console.log(`  Total Match J Silva 2024-2026: ${allBroad.length}`);
  globalThis.__nfs = allBroad;
}

let all = [];
if (workingKind) {
  const first = await fetchInv(1, workingKind);
  all = [...(first?.items || [])];
  const totalPages = first?.totalPages || 1;
  if (totalPages > 1) {
    for (let p = 2; p <= Math.min(totalPages, 20); p++) {
      const r = await fetchInv(p, workingKind);
      all.push(...(r?.items || []));
    }
  }
} else {
  all = globalThis.__nfs || [];
}

console.log(`Total NFs encontradas: ${all.length}\n`);

function dominantDealer(nf) {
  const m = {};
  for (const it of nf.items || [])
    for (const p of it.products || [])
      if (p.dealerCode) m[p.dealerCode] = (m[p.dealerCode] || 0) + Number(p.netValue || 0);
  const e = Object.entries(m);
  return e.length ? Number(e.sort((a, b) => b[1] - a[1])[0][0]) : null;
}

console.log(
  '  Data       | Tx       | Status   | Br | Op   | Dealer | Valor       | Hora Emit | Hora Canc',
);
console.log('  ' + '-'.repeat(105));
let totalValido = 0;
let totalCanc = 0;
let qtdValido = 0;
let qtdCanc = 0;
for (const nf of all.sort((a, b) => (a.issueDate < b.issueDate ? -1 : 1))) {
  const dealer = dominantDealer(nf);
  const isCanc = nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted';
  if (isCanc) {
    totalCanc += Number(nf.totalValue || 0);
    qtdCanc++;
  } else {
    totalValido += Number(nf.totalValue || 0);
    qtdValido++;
  }
  console.log(
    `  ${nf.issueDate?.slice(0, 10) || '?'} | ${String(nf.transactionCode).padEnd(8)} | ${(nf.invoiceStatus || '').padEnd(8)} | ${String(nf.branchCode).padStart(2)} | ${String(nf.operationCode).padEnd(4)} | ${String(dealer || '').padStart(6)} | R$ ${Number(nf.totalValue || 0).toFixed(2).padStart(10)} | ${(nf.exitTime || '').padEnd(9)} | ${nf.lastchangeDate?.slice(11, 19) || ''}`,
  );
}
console.log('  ' + '-'.repeat(105));
console.log(`\n  📊 RESUMO:`);
console.log(`    NFs válidas:    ${qtdValido}  (R$ ${totalValido.toFixed(2)})`);
console.log(`    NFs canc/del:   ${qtdCanc}  (R$ ${totalCanc.toFixed(2)})`);
console.log(
  `    Total emitidas: ${all.length}  (R$ ${(totalValido + totalCanc).toFixed(2)})`,
);
