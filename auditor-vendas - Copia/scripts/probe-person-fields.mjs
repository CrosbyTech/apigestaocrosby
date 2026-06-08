// Inspeciona campos de PESSOA (cliente) no TOTVS pra detectar:
//   - data de cadastro
//   - primeira compra
//   - quem cadastrou (assignedSeller?)
//   - status (ativo/bloqueado)
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

// Clientes das NFs canceladas que queremos investigar
const PERSONS = [
  { code: 116809, name: 'J SILVA DOS REIS', vendor: 'David' },
  { code: 114231, name: 'REGINALDO ARCANJO', vendor: 'David' },
  { code: 116753, name: 'MARCOS AURELIO', vendor: 'David' },
  { code: 20518, name: 'JHONNATAN GOMES', vendor: 'David' },
  { code: 118389, name: 'THAYLAN DOS SANTOS', vendor: 'Arthur' },
  { code: 115832, name: 'ADRIANA DOS SANTOS', vendor: 'Arthur' },
  { code: 117551, name: 'ERIKA DE MORAIS', vendor: 'Arthur' },
];

// Tenta endpoints corretos do TOTVS (achados em totvsrouter/clientes.js)
const codes = PERSONS.map((p) => p.code);
const tries = [
  {
    label: '/person/v2/individuals/search (PF)',
    body: { filter: { personCodeList: codes }, expand: 'phones,addresses,classifications', page: 1, pageSize: 50 },
    url: '/person/v2/individuals/search',
  },
  {
    label: '/person/v2/legal-entities/search (PJ)',
    body: { filter: { personCodeList: codes }, expand: 'phones,addresses,classifications', page: 1, pageSize: 50 },
    url: '/person/v2/legal-entities/search',
  },
];

for (const t of tries) {
  console.log(`══ ${t.label} ══`);
  console.log(`POST ${t.url}`);
  try {
    const r = await axios.post(`${TOTVS_BASE_URL}${t.url}`, t.body, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent,
      timeout: 60000,
    });
    const items = r.data?.items || r.data?.dataRow || [];
    console.log(`✓ ${items.length} itens`);
    if (false) { // never break early — quero ver ambos endpoints
    }
    if (items[0]) {
      console.log('Campos disponíveis (1º item):');
      const keys = Object.keys(items[0]).sort();
      for (const k of keys) {
        const v = items[0][k];
        if (v == null) continue;
        if (Array.isArray(v))
          console.log(`  ${k}: [${v.length}] ${v[0] ? JSON.stringify(v[0]).slice(0, 80) : ''}`);
        else if (typeof v === 'object')
          console.log(`  ${k}: {${Object.keys(v).join(', ')}}`);
        else console.log(`  ${k}: ${String(v).slice(0, 80)}`);
      }
      console.log('');
      console.log('Resumo dos clientes encontrados:');
      for (const p of items) {
        console.log(
          `  ${p.code || p.personCode}: ${p.name || p.fantasyName}  reg=${p.registerDate || p.registrationDate || p.startDate || p.creationDate || '?'}  status=${p.status || '?'}`,
        );
      }
    }
    console.log('');
  } catch (err) {
    console.log(`  ❌ ${err.response?.status} ${err.message}`);
    if (err.response?.data)
      console.log(`     ${JSON.stringify(err.response.data).slice(0, 200)}`);
  }
}
