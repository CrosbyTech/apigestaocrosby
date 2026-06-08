// Acha personCode da SAMARCOS pra excluir do canal franquia
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

const r = await axios.post(
  `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
  {
    filter: {
      branchCodeList: [99],
      operationCodeList: [7234, 7240, 7802, 9124, 7259],
      operationType: 'Output',
      startIssueDate: '2026-05-01T00:00:00',
      endIssueDate: '2026-05-11T23:59:59',
    },
    page: 1,
    pageSize: 100,
  },
  { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 },
);

const nfs = r.data?.items || [];
const samarcos = nfs.filter((nf) =>
  String(nf.personName || '').toUpperCase().includes('SAMARCOS'),
);
console.log('NFs SAMARCOS:');
for (const nf of samarcos) {
  console.log(`  tx=${nf.transactionCode}  personCode=${nf.personCode}  cnpj=${nf.personCpfCnpj || '?'}  R$ ${nf.totalValue}  ${nf.personName}`);
}
console.log(`\npersonCode único(s): ${[...new Set(samarcos.map((n) => n.personCode))].join(', ')}`);
console.log(`CNPJ único(s): ${[...new Set(samarcos.map((n) => n.personCpfCnpj))].filter(Boolean).join(', ')}`);
