// Procura RECIFE MALL no TOTVS via persons/v2/customers/search
import 'dotenv/config';
import axios from 'axios';
import { getToken } from '../utils/totvsTokenManager.js';

const TOTVS = process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';
const tk = await getToken();
if (!tk?.access_token) { console.log('sem token'); process.exit(1); }

// Pega NFs reais da semana, junta com persons via TOTVS personsCode lookup
const codes = [84715, 54845, 29424, 44108, 17821, 60290, 22263, 70500, 7955, 44748, 35907, 20649, 29541];
console.log('Buscando nomes via /person/v2/legal-entities/search (PJ):');
try {
  const r = await axios.post(
    `${TOTVS}/person/v2/legal-entities/search`,
    {
      filter: { personCodeList: codes },
      page: 1, pageSize: 100,
    },
    { headers: { Authorization: `Bearer ${tk.access_token}` }, timeout: 60000 },
  );
  const items = r.data?.items || [];
  for (const p of items) {
    const recife = (p.name || '').toUpperCase().includes('RECIFE');
    console.log(`  code=${String(p.code).padStart(7)}  ${(p.name||'').slice(0,55)}${recife?'  ← RECIFE!':''}`);
  }
  if (!items.length) console.log('  (vazio na PJ)');
} catch (e) {
  console.log('  erro legal-entities:', e.response?.data?.message || e.message);
}

// 2) Busca direta por nome
console.log('\nBusca por nome RECIFE em legal-entities:');
try {
  const r = await axios.post(
    `${TOTVS}/person/v2/legal-entities/search`,
    {
      filter: { name: 'RECIFE' },
      page: 1, pageSize: 50,
    },
    { headers: { Authorization: `Bearer ${tk.access_token}` }, timeout: 60000 },
  );
  for (const p of r.data?.items || []) {
    console.log(`  code=${p.code}  ${p.name}`);
  }
  if (!(r.data?.items || []).length) console.log('  nenhum');
} catch (e) {
  console.log('  erro busca por nome:', e.response?.data?.message || e.message);
}
