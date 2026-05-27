// Verifica uma NF específica no TOTVS — útil pra debug
// Uso: node scripts/check-nf.mjs <transactionCode> [branchCode]
import 'dotenv/config';
import axios from 'axios';
import https from 'node:https';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const TX = parseInt(process.argv[2] || '837686');
const BRANCH = parseInt(process.argv[3] || '99');

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

console.log(`🔍 NF transactionCode=${TX} branch=${BRANCH}\n`);

try {
  // Busca todas as NFs do dia 14/05/2026 branch 99 e filtra TX localmente
  const r = await axios.post(
    `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
    {
      filter: {
        branchCodeList: [BRANCH],
        startIssueDate: `2026-05-14T00:00:00`,
        endIssueDate: `2026-05-14T23:59:59`,
      },
      expand: 'items,payments',
      page: 1,
      pageSize: 100,
    },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 90000 },
  );
  const allDay = r.data?.items || [];
  console.log(`Total NFs no dia 14/05/2026 branch ${BRANCH}: ${allDay.length}`);
  const target = allDay.filter((n) => Number(n.transactionCode) === TX);
  console.log(`NFs com tx=${TX}: ${target.length}`);
  r.data.items = target;

  const nfs = r.data?.items || [];
  console.log(`NFs encontradas: ${nfs.length}\n`);

  if (nfs.length === 0) {
    console.log('Tentando sem filtro transactionCodeList...');
    const r2 = await axios.post(
      `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
      {
        filter: {
          branchCodeList: [BRANCH],
          startIssueDate: `2026-05-14T00:00:00`,
          endIssueDate: `2026-05-14T23:59:59`,
        },
        expand: 'items',
        page: 1,
        pageSize: 100,
      },
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
    );
    const all = r2.data?.items || [];
    const found = all.filter((n) => n.transactionCode == TX);
    console.log(`Tentativa 2: ${all.length} NFs do dia 14/05 branch ${BRANCH}, ${found.length} com tx=${TX}`);
    if (found.length > 0) nfs.push(...found);
  }

  for (const nf of nfs) {
    console.log('═'.repeat(70));
    console.log(`NF transactionCode: ${nf.transactionCode}`);
    console.log(`branchCode: ${nf.branchCode}`);
    console.log(`operationCode: ${nf.operationCode}`);
    console.log(`operationType: ${nf.operationType}`);
    console.log(`issueDate: ${nf.issueDate}`);
    console.log(`invoiceStatus: ${nf.invoiceStatus}`);
    console.log(`invoiceType: ${nf.invoiceType || '—'}`);
    console.log(`personCode: ${nf.personCode}`);
    console.log(`personName: ${nf.personName}`);
    console.log(`totalValue: ${nf.totalValue}`);
    console.log();
    console.log(`items: ${nf.items?.length ?? 'undefined/null'}`);
    if (Array.isArray(nf.items)) {
      for (const it of nf.items) {
        console.log(`  - item productCode=${it.productCode} qty=${it.quantity}`);
        console.log(`    products: ${it.products?.length ?? 'undefined'}`);
        for (const p of it.products || []) {
          console.log(
            `      • dealerCode=${p.dealerCode} netValue=${p.netValue} quantity=${p.quantity}`,
          );
        }
      }
    }
    console.log();
    console.log(`payments: ${nf.payments?.length ?? '—'}`);
    for (const p of nf.payments || []) {
      console.log(`  - paymentType=${p.paymentTypeName} doc=${p.documentType} value=${p.paymentValue}`);
    }
  }
} catch (err) {
  console.log('Erro:', err.response?.status, err.message);
  if (err.response?.data) {
    console.log('Detalhes:', JSON.stringify(err.response.data).slice(0, 500));
  }
}
