// Simula a query massiva do seller-openings e verifica se a NF 837686 vem com items
import 'dotenv/config';
import axios from 'axios';
import https from 'node:https';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
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

// Mesma config do seller-openings
const branches = [
  1, 2, 5, 6, 11, 50, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94,
  95, 96, 97, 98, 99, 100, 101, 111, 200, 600, 750, 850, 950, 960,
];
const ops = [
  510, 511, 521, 522, 545, 546, 548, 9009, 9017, 9027, 9033,
  7236, 9122, 5102, 7242, 9061, 9001, 9121,
  7234, 7240, 7802, 9124, 7259,
  7235, 7241,
  887,
  9400, 9401, 9420, 9067, 9404,
  7254, 7007,
  7255,
  7237, 7269, 7279, 7277,
];

const fetchPage = async (page) => {
  const r = await axios.post(
    `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
    {
      filter: {
        branchCodeList: branches,
        operationCodeList: ops,
        operationType: 'Output',
        startIssueDate: '2026-05-01T00:00:00',
        endIssueDate: '2026-05-26T23:59:59',
      },
      expand: 'items',
      page,
      pageSize: 100,
    },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 180000 },
  );
  return r.data;
};

console.log('Buscando página 1...');
const f1 = await fetchPage(1);
const total = f1?.totalItems || 0;
const totalPages = f1?.totalPages || Math.ceil(total / 100);
console.log(`Total NFs: ${total}, totalPages: ${totalPages}`);

// Procura LETICIA (pc 120381) ou NF 837686 em todas as páginas
const found = [];
const allItems = [...(f1.items || [])];
const failedPages = [];

for (let p = 2; p <= totalPages; p++) {
  try {
    const d = await fetchPage(p);
    if (Array.isArray(d?.items)) {
      allItems.push(...d.items);
    } else {
      failedPages.push(p);
    }
    if (p % 5 === 0) process.stdout.write(`pg${p}.`);
  } catch (err) {
    failedPages.push(p);
    process.stdout.write(`pg${p}!`);
  }
}
console.log();
console.log(`Total NFs processadas: ${allItems.length} (esperado ${total}, faltam ${total - allItems.length})`);
console.log(`Páginas que falharam: ${failedPages.length > 0 ? failedPages.join(',') : 'nenhuma'}`);

const leticiaNFs = allItems.filter((n) => Number(n.personCode) === 120381);
const targetNF = allItems.filter((n) => Number(n.transactionCode) === 837686);
console.log();
console.log(`NFs de personCode=120381 (LETICIA): ${leticiaNFs.length}`);
console.log(`NFs de transactionCode=837686:     ${targetNF.length}`);

if (leticiaNFs.length > 0) {
  for (const nf of leticiaNFs) {
    console.log();
    console.log(`  NF tx=${nf.transactionCode} branch=${nf.branchCode} op=${nf.operationCode} status=${nf.invoiceStatus}`);
    console.log(`    items: ${nf.items?.length ?? 'undefined/null'}`);
    if (Array.isArray(nf.items) && nf.items.length > 0) {
      const dealers = new Set();
      for (const it of nf.items) {
        for (const p of it.products || []) {
          if (p.dealerCode) dealers.add(p.dealerCode);
        }
      }
      console.log(`    dealers: ${[...dealers].join(',')}`);
    }
  }
}
