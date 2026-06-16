// Aplica classificação BlueCard (typeCode=55, code='1') nos leads já cadastrados.
// Tenta via POST /person/v2/individual-customers/{code}/classifications.
// Se essa rota não existir, faz fallback pra PATCH no próprio individual-customers.
import 'dotenv/config';
import axios from 'axios';
import supabase from './config/supabase.js';
import { getToken } from './utils/totvsTokenManager.js';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';
const TYPE_CODE = Number(process.env.BLUECARD_CLASSIFICATION_TYPE_CODE || 55);
const CODE = String(process.env.BLUECARD_CLASSIFICATION_CODE || '1');

const tk = await getToken();
const accessToken = tk.access_token;

const { data: leads } = await supabase
  .from('bluecard_leads')
  .select('id, nome, cpf, totvs_person_code')
  .not('totvs_person_code', 'is', null)
  .order('id');

console.log(`📋 ${leads?.length || 0} leads pra classificar`);
console.log(`   classificationTypeCode=${TYPE_CODE}, classificationCode='${CODE}'\n`);

let sucesso = 0, jaTinha = 0, falha = 0;
for (const l of leads || []) {
  const pc = l.totvs_person_code;
  process.stdout.write(`Lead ${l.id} (${l.nome.slice(0,25).padEnd(25)}) pc=${pc} `);

  // 1) Busca o cliente pra ver se já tem a classificação
  let temClassif = false;
  try {
    const r = await axios.post(
      `${TOTVS_BASE_URL}/person/v2/individuals/search`,
      { filter: { codeList: [pc] }, expand: 'classifications', page: 1, pageSize: 1 },
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30000 },
    );
    const person = r.data?.items?.[0];
    const cls = person?.classifications || [];
    temClassif = cls.some(c => Number(c.typeCode) === TYPE_CODE && String(c.code) === CODE);
  } catch (e) {
    console.log(`⚠ search falhou: ${e.message}`);
  }

  if (temClassif) {
    console.log('✓ já classificado');
    jaTinha++;
    await new Promise(r => setTimeout(r, 300));
    continue;
  }

  // 2) Tenta vias de aplicar classificação — múltiplas alternativas porque a rota
  // exata do TOTVS pra ADICIONAR classificação não está documentada localmente.
  const tentativas = [
    {
      label: 'POST /individuals/{code}/classifications',
      method: 'post',
      url: `${TOTVS_BASE_URL}/person/v2/individuals/${pc}/classifications`,
      body: { classificationTypeCode: TYPE_CODE, classificationCode: CODE },
    },
    {
      label: 'POST /individual-customers/{code}/classifications',
      method: 'post',
      url: `${TOTVS_BASE_URL}/person/v2/individual-customers/${pc}/classifications`,
      body: { classificationTypeCode: TYPE_CODE, classificationCode: CODE },
    },
    {
      label: 'PUT /individuals/{code}',
      method: 'put',
      url: `${TOTVS_BASE_URL}/person/v2/individuals/${pc}`,
      body: { classifications: [{ classificationTypeCode: TYPE_CODE, classificationCode: CODE }] },
    },
    {
      label: 'PATCH /individual-customers/{code}',
      method: 'patch',
      url: `${TOTVS_BASE_URL}/person/v2/individual-customers/${pc}`,
      body: { classifications: [{ classificationTypeCode: TYPE_CODE, classificationCode: CODE }] },
    },
  ];

  let ok = false, ultimoErr = '';
  for (const t of tentativas) {
    try {
      await axios({
        method: t.method,
        url: t.url,
        data: t.body,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      });
      console.log(`✅ via ${t.label}`);
      ok = true;
      sucesso++;
      break;
    } catch (e) {
      const status = e.response?.status;
      ultimoErr = `${t.label} → HTTP ${status} ${(e.response?.data?.message || e.message).slice(0,80)}`;
      // 404/405 = rota não existe — tenta próxima. 401 = token (skip retry).
      if (status === 401 || status === 403) break;
    }
  }

  if (!ok) {
    console.log(`❌ todas tentativas falharam: ${ultimoErr}`);
    falha++;
  }
  await new Promise(r => setTimeout(r, 500));
}

console.log(`\n=== RESULTADO ===`);
console.log(`✅ Aplicado agora: ${sucesso}`);
console.log(`✓  Já classificado: ${jaTinha}`);
console.log(`❌ Falhas: ${falha}`);
process.exit(0);
