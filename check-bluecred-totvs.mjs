// Tenta diferentes formatos de filtro classification no TOTVS individuals/legal-entities
import 'dotenv/config';
import axios from 'axios';
import { getToken } from './utils/totvsTokenManager.js';
import { httpsAgent } from './totvsrouter/totvsHelper.js';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';
const tk = await getToken();
const token = tk.access_token;

const tries = [
  { name: 'PF filter.classification', body: { filter: { classification: { typeCode: 55, code: '8' } }, expand: 'classifications', page: 1, pageSize: 50 } },
  { name: 'PF filter.classifications', body: { filter: { classifications: [{ typeCode: 55, code: '8' }] }, expand: 'classifications', page: 1, pageSize: 50 } },
  { name: 'PF filter.classificationTypeCode', body: { filter: { classificationTypeCode: 55, classificationCode: '8' }, expand: 'classifications', page: 1, pageSize: 50 } },
  { name: 'PF filter.classificationsTypeCodeList', body: { filter: { classificationTypeCodeList: [55] }, expand: 'classifications', page: 1, pageSize: 50 } },
];

for (const t of tries) {
  try {
    const r = await axios.post(
      `${TOTVS_BASE_URL}/person/v2/individuals/search`,
      t.body,
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 }
    );
    const items = r.data?.items || [];
    console.log(`${t.name}: ${items.length} items (totalItems=${r.data?.totalItems})`);
    if (items.length > 0 && items.length < 5) {
      for (const it of items) {
        const cls = it.classifications?.filter(c => Number(c.typeCode) === 55) || [];
        console.log(`  pc=${it.code} ${it.name?.slice(0,30)} classifs55=[${cls.map(c=>c.code).join(',')}]`);
      }
    }
  } catch (e) {
    console.log(`${t.name}: ERR ${e.response?.status} ${e.response?.data?.message || e.message}`);
  }
}

// Tenta o "Crosby" pra ver se acha
console.log('\n--- Como funciona o que TEMOS no banco ---');
const { default: supabase } = await import('./config/supabase.js');
const { data } = await supabase.from('pessoas_bluecred').select('*').limit(10);
console.log(`Total no banco: ${data?.length}`);
for (const r of data || []) console.log(' ', r);
process.exit(0);
