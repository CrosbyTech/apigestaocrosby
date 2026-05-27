// Verifica histórico de NF e dados de uma pessoa no TOTVS
// Uso: node scripts/check-cliente.mjs <personCode>
import 'dotenv/config';
import axios from 'axios';
import https from 'node:https';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const PC = parseInt(process.argv[2] || '120381');

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
console.log(`🔍 Cliente personCode=${PC}\n`);

// 1) Dados da pessoa
try {
  const r = await axios.post(
    `${TOTVS_BASE_URL}/person/v2/persons/search`,
    {
      filter: { personCodeList: [PC], isCustomer: true },
      expand: 'classifications,phones,emails',
      page: 1,
      pageSize: 10,
    },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
  );
  const p = r.data?.items?.[0];
  if (p) {
    console.log(`Nome: ${p.name}`);
    console.log(`Fantasia: ${p.fantasyName || '—'}`);
    console.log(`CPF/CNPJ: ${p.cgc || p.cpf || '—'}`);
    console.log(`Cadastrado em: ${p.insertDate}`);
    console.log(`Operador cadastro: ${p.insertOperatorCode || p.insertUserCode || '—'}`);
    console.log(`Atualizado em: ${p.lastChangeDate || '—'}`);
    console.log(`Classificações:`, p.classifications?.map(c => `tipo=${c.type}`).join(', ') || '—');
  } else {
    console.log('Pessoa NÃO encontrada com isCustomer=true; tentando sem filtro...');
    const r2 = await axios.post(
      `${TOTVS_BASE_URL}/person/v2/persons/search`,
      { filter: { personCodeList: [PC] }, page: 1, pageSize: 10 },
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
    );
    const p2 = r2.data?.items?.[0];
    if (p2) {
      console.log(JSON.stringify(p2, null, 2).slice(0, 1500));
    } else {
      console.log('Não encontrada nem sem filtro. items=', r2.data?.items?.length);
    }
  }
  console.log();
} catch (err) {
  console.log('Erro person:', err.message);
  console.log('Detalhes:', err.response?.data ? JSON.stringify(err.response.data).slice(0,300) : '');
}

// 2) NFs dessa pessoa nos últimos 12 meses
const HOJE = new Date().toISOString().slice(0, 10);
const ONE_YEAR = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const BRANCHS = [99, 2, 95, 87, 88, 90, 94, 97, 91, 92, 93, 96, 100, 101, 111, 200];

try {
  const r = await axios.post(
    `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
    {
      filter: {
        branchCodeList: BRANCHS,
        operationType: 'Output',
        startIssueDate: `${ONE_YEAR}T00:00:00`,
        endIssueDate: `${HOJE}T23:59:59`,
        customerCodeList: [PC],
      },
      expand: 'items',
      page: 1,
      pageSize: 100,
    },
    { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 120000 },
  );
  const nfs = (r.data?.items || []).filter(
    (n) => n.invoiceStatus !== 'Canceled' && n.invoiceStatus !== 'Deleted',
  );
  console.log(`NFs nos últimos 12 meses: ${nfs.length}\n`);

  nfs.sort((a, b) => (a.issueDate || '').localeCompare(b.issueDate || ''));

  for (const nf of nfs) {
    const dealers = new Map();
    for (const it of nf.items || []) {
      for (const p of it.products || []) {
        if (p.dealerCode) {
          const dc = Number(p.dealerCode);
          dealers.set(dc, (dealers.get(dc) || 0) + Number(p.netValue || 0));
        }
      }
    }
    const sortedDealers = [...dealers.entries()].sort((a, b) => b[1] - a[1]);
    const dom = sortedDealers[0];
    console.log(
      `  ${nf.issueDate?.slice(0, 10)} NF=${nf.transactionCode} branch=${nf.branchCode} op=${nf.operationCode} valor=R$ ${Number(nf.totalValue || 0).toFixed(2)}`,
    );
    console.log(
      `    dealers: ${sortedDealers.map(([dc, v]) => `${dc} (R$${v.toFixed(2)})`).join(', ') || '—'}`,
    );
    console.log(`    dominante: ${dom ? dom[0] : 'sem dealer'}`);
  }
} catch (err) {
  console.log('Erro invoices:', err.message);
}
