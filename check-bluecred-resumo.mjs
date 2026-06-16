// Inspeciona os 2 leads que ainda falharam
import 'dotenv/config';
import supabase from './config/supabase.js';
import axios from 'axios';
import { getToken } from './utils/totvsTokenManager.js';

const TOTVS_BASE_URL = process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';

const { data: leads } = await supabase
  .from('bluecard_leads')
  .select('*')
  .in('id', [3, 32]);

const tk = await getToken();
for (const l of leads) {
  console.log(`\n=== Lead ${l.id}: ${l.nome} (CPF ${l.cpf}) ===`);
  console.log(`  Email: ${l.email}`);
  console.log(`  WhatsApp: ${l.whatsapp}`);
  console.log(`  CEP: ${l.cep}`);
  console.log(`  Endereço: ${l.endereco}, ${l.numero} ${l.complemento || ''}`);
  console.log(`  Status atual: ${l.status} | sync error: ${(l.totvs_sync_error || '').slice(0, 100)}`);

  const phone = String(l.whatsapp || '').replace(/\D/g, '');
  const payload = {
    branchInsertCode: 1,
    insertDate: new Date().toISOString(),
    name: l.nome,
    cpf: String(l.cpf).replace(/\D/g, ''),
    emails: l.email ? [{ typeCode: 1, email: l.email, isDefault: true }] : undefined,
    phones: phone ? [{ typeCode: 1, number: phone, isDefault: true }] : undefined,
    addresses: l.cep && l.endereco ? [{
      addressType: 'Residential',
      sequence: 1,
      cep: String(l.cep || '').replace(/\D/g, ''),
      address: l.endereco,
      number: Number(String(l.numero || '').replace(/\D/g, '')) || undefined,
      complement: l.complemento || undefined,
    }] : undefined,
  };
  const strip = (o) => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(o)) { if (v === undefined || v === null) continue; out[k] = strip(v); }
      return out;
    }
    return o;
  };
  const clean = strip(payload);
  console.log('  PAYLOAD:', JSON.stringify(clean));

  try {
    const r = await axios.post(`${TOTVS_BASE_URL}/person/v2/individual-customers`, clean, {
      headers: { Authorization: `Bearer ${tk.access_token}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    console.log('  ✅ OK', r.data);
  } catch (e) {
    console.log(`  ❌ HTTP ${e.response?.status}:`, JSON.stringify(e.response?.data).slice(0, 600));
  }
}
process.exit(0);
