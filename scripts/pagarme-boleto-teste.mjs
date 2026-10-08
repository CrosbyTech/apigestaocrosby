/**
 * Teste: gera um boleto na Pagar.me (banco Stone) para um cliente do TOTVS.
 *
 *   node scripts/pagarme-boleto-teste.mjs <cpf> <centavos>            → só mostra o payload
 *   node scripts/pagarme-boleto-teste.mjs <cpf> <centavos> --enviar   → cria o boleto (REAL)
 *   node scripts/pagarme-boleto-teste.mjs --pedido <or_xxx>           → consulta o pedido
 */
import 'dotenv/config';
import { postTotvs } from '../services/bluecardLimite.js';

const SK = process.env.PAGARME_SECRET_KEY || '';
const auth = 'Basic ' + Buffer.from(`${SK}:`).toString('base64');
const args = process.argv.slice(2);

async function pagarme(method, path, body) {
  const r = await fetch(`https://api.pagar.me/core/v5${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, data: j };
}

if (args[0] === '--pedido') {
  const r = await pagarme('GET', `/orders/${args[1]}`);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

const cpf = String(args[0] || '').replace(/\D/g, '');
const centavos = parseInt(args[1], 10);
const enviar = args.includes('--enviar');
if (!cpf || !centavos) {
  console.error('uso: node scripts/pagarme-boleto-teste.mjs <cpf> <centavos> [--enviar]');
  process.exit(1);
}

const resp = await postTotvs('/person/v2/individuals/search', {
  filter: { cpfList: [cpf] },
  expand: 'addresses,phones,emails',
  page: 1,
  pageSize: 1,
});
const p = resp.data?.items?.[0];
if (!p) {
  console.error('cliente não encontrado no TOTVS');
  process.exit(1);
}

const end = (p.addresses || []).find((a) => a.cep) || (p.addresses || [])[0] || {};
const tel = (p.phones || []).find((t) => t.isDefault) || (p.phones || [])[0] || {};
const email = ((p.emails || []).find((e) => e.isDefault) || (p.emails || [])[0] || {}).email;
const fone = String(tel.number || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');

const venc = new Date(Date.now() + 3 * 86400000);
venc.setUTCHours(23, 59, 59, 0);
const ref = `TESTE-${Date.now().toString().slice(-8)}`;

const payload = {
  code: ref,
  items: [{ code: ref, amount: centavos, description: 'Fatura teste HeadCoach', quantity: 1 }],
  customer: {
    name: String(p.name || '').slice(0, 64),
    email: email || undefined,
    document: cpf,
    document_type: 'CPF',
    type: 'individual',
    address: {
      line_1: [end.addressNumber || 'S/N', end.address, end.neighborhood].filter(Boolean).join(', '),
      line_2: end.complement || undefined,
      zip_code: String(end.cep || '').replace(/\D/g, ''),
      city: end.cityName,
      state: end.stateAbbreviation,
      country: 'BR',
    },
    phones: fone
      ? { mobile_phone: { country_code: '55', area_code: fone.slice(0, 2), number: fone.slice(2) } }
      : undefined,
  },
  payments: [
    {
      payment_method: 'boleto',
      boleto: {
        bank: '197',
        instructions: 'Fatura teste HeadCoach x Pagar.me. Apos o vencimento: multa de 2% e juros de 1% a.m.',
        due_at: venc.toISOString(),
        document_number: ref.slice(0, 16),
        type: 'DM',
        interest: { days: 1, type: 'percentage', amount: 1 },
        fine: { days: 1, type: 'percentage', amount: 2 },
      },
    },
  ],
  metadata: { origem: 'headcoach_teste', cd_cliente: String(p.code) },
};

console.log('── cliente TOTVS:', p.code, p.name);
console.log('── payload:', JSON.stringify(payload, null, 2));
if (!enviar) {
  console.log('\n(dry-run — acrescente --enviar para criar o boleto)');
  process.exit(0);
}

const r = await pagarme('POST', '/orders', payload);
console.log('── resposta', r.status, JSON.stringify(r.data, null, 2));
process.exit(r.ok ? 0 : 1);
