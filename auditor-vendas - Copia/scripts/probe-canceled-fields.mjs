// Inspeciona TODOS os campos de uma NF cancelada pra ver o que o TOTVS expõe
// (data de cancelamento, quem cancelou, observações, etc).
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

// Tenta com vários expands pra pegar todos os campos
const expands = [
  'items',
  'items,payments,observations',
  'items,payments,observations,trackings',
  'observations',
  'tracking',
];

// NF do David - J Silva dos Reis em 20/03
console.log('Buscando NF tx=815629 (David, J SILVA DOS REIS, deletada 20/03)...\n');
for (const expand of expands) {
  console.log(`══ expand=${expand} ══`);
  try {
    const r = await axios.post(
      `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
      {
        filter: {
          branchCodeList: [99],
          startIssueDate: '2026-03-20T00:00:00',
          endIssueDate: '2026-03-20T23:59:59',
        },
        expand,
        page: 1,
        pageSize: 100,
      },
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
    );
    const found = (r.data?.items || []).find(
      (n) => Number(n.transactionCode) === 815629,
    );
    if (found) {
      console.log('Campos da NF:');
      const keys = Object.keys(found).sort();
      for (const k of keys) {
        const v = found[k];
        if (v === null || v === undefined) continue;
        if (Array.isArray(v)) {
          console.log(`  ${k}: [Array com ${v.length} items]`);
          if (v.length > 0) {
            const item0 = v[0];
            if (typeof item0 === 'object') {
              const itemKeys = Object.keys(item0).slice(0, 15);
              console.log(`    item[0] keys: ${itemKeys.join(', ')}`);
            }
          }
        } else if (typeof v === 'object') {
          console.log(`  ${k}: {${Object.keys(v).join(', ')}}`);
        } else {
          const sv = String(v).slice(0, 100);
          console.log(`  ${k}: ${sv}`);
        }
      }
      break; // achou, não precisa testar outros expands
    }
  } catch (err) {
    console.warn(`  ERR: ${err.response?.status} ${err.message}`);
  }
}
