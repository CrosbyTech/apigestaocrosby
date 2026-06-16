// Tenta classificar via re-POST /individual-customers (upsert) ou /persons.
import 'dotenv/config';
import axios from 'axios';
import supabase from './config/supabase.js';
import { getToken } from './utils/totvsTokenManager.js';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';
const TYPE_CODE = 55;
const CODE = '1';

const tk = await getToken();
const accessToken = tk.access_token;

// Pega lead 5 (Wilson Filho, pc=98488) como cobaia — já existe há tempo no TOTVS
const { data: leads } = await supabase
  .from('bluecard_leads')
  .select('*')
  .eq('id', 5);
const lead = leads?.[0];
if (!lead) { console.error('lead não achado'); process.exit(1); }

console.log(`Cobaia: Lead ${lead.id} (${lead.nome}) pc=${lead.totvs_person_code}`);

// Busca dados atuais
const r0 = await axios.post(
  `${TOTVS_BASE_URL}/person/v2/individuals/search`,
  { filter: { codeList: [lead.totvs_person_code] }, expand: 'classifications,emails,phones,addresses', page: 1, pageSize: 1 },
  { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30000 },
);
const current = r0.data?.items?.[0];
console.log('Classificações atuais:', JSON.stringify(current?.classifications));

const tentativas = [
  {
    label: 'POST /persons/{code}/classifications',
    method: 'post',
    url: `${TOTVS_BASE_URL}/person/v2/persons/${lead.totvs_person_code}/classifications`,
    body: { classificationTypeCode: TYPE_CODE, classificationCode: CODE },
  },
  {
    label: 'PUT /persons/{code}/classifications',
    method: 'put',
    url: `${TOTVS_BASE_URL}/person/v2/persons/${lead.totvs_person_code}/classifications`,
    body: [{ classificationTypeCode: TYPE_CODE, classificationCode: CODE }],
  },
  {
    label: 'POST /classification',
    method: 'post',
    url: `${TOTVS_BASE_URL}/person/v2/classification`,
    body: { personCode: lead.totvs_person_code, classificationTypeCode: TYPE_CODE, classificationCode: CODE },
  },
  {
    label: 'POST /classifications',
    method: 'post',
    url: `${TOTVS_BASE_URL}/person/v2/classifications`,
    body: { personCode: lead.totvs_person_code, classificationTypeCode: TYPE_CODE, classificationCode: CODE },
  },
  {
    label: 'POST /person/classifications',
    method: 'post',
    url: `${TOTVS_BASE_URL}/person/v2/person-classifications`,
    body: { personCode: lead.totvs_person_code, classificationTypeCode: TYPE_CODE, classificationCode: CODE },
  },
  {
    label: 're-POST /individual-customers (upsert)',
    method: 'post',
    url: `${TOTVS_BASE_URL}/person/v2/individual-customers`,
    body: {
      branchInsertCode: 1,
      insertDate: new Date().toISOString(),
      name: lead.nome,
      cpf: String(lead.cpf).replace(/\D/g, ''),
      classifications: [{ classificationTypeCode: TYPE_CODE, classificationCode: CODE }],
    },
  },
];

for (const t of tentativas) {
  try {
    const r = await axios({
      method: t.method,
      url: t.url,
      data: t.body,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    console.log(`✅ ${t.label} → HTTP ${r.status}`);
    console.log('   response:', JSON.stringify(r.data).slice(0,300));
    break;
  } catch (e) {
    console.log(`❌ ${t.label} → HTTP ${e.response?.status}: ${(e.response?.data?.message || JSON.stringify(e.response?.data) || e.message).slice(0,200)}`);
  }
  await new Promise(r => setTimeout(r, 300));
}
process.exit(0);
