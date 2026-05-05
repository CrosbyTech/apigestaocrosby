import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

console.log('--- Diagnóstico Supabase ---\n');

// Main Supabase
const mainUrl = process.env.SUPABASE_URL || 'https://dorztqiunewggydvkjnf.supabase.co';
const mainKey = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvcnp0cWl1bmV3Z2d5ZHZram5mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzA3MTI4OCwiZXhwIjoyMDYyNjQ3Mjg4fQ.sk6z1v-MKAjiQK-IfIvPvxI-GdRyH_Biaj5a-8_Ksy8';
const fiscalUrl = process.env.SUPABASE_FISCAL_URL;
const fiscalKey = process.env.SUPABASE_FISCAL_KEY;

console.log('SUPABASE_URL:', mainUrl);
console.log('SUPABASE_SERVICE_KEY (trunc):', mainKey?.substring(0, 30) + '...');
console.log('SUPABASE_FISCAL_URL:', fiscalUrl);
console.log('SUPABASE_FISCAL_KEY:', fiscalKey);
console.log();

// Test main
try {
  const sb = createClient(mainUrl, mainKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await sb.from('whatsapp_accounts').select('id, name').limit(2);
  if (error) {
    console.error('❌ Main Supabase (whatsapp_accounts):', error.message, error.code);
  } else {
    console.log('✅ Main Supabase (whatsapp_accounts): OK -', data.length, 'registros');
  }

  const { data: d2, error: e2 } = await sb.from('meta_ad_accounts').select('id, name').limit(2);
  if (e2) {
    console.error('❌ Main Supabase (meta_ad_accounts):', e2.message, e2.code);
  } else {
    console.log('✅ Main Supabase (meta_ad_accounts): OK -', d2.length, 'registros');
  }
} catch (e) {
  console.error('❌ Exceção ao criar cliente Supabase main:', e.message);
}

// Test fiscal via supabase-js
try {
  if (!fiscalKey) { console.error('❌ SUPABASE_FISCAL_KEY não definida!'); }
  else {
    const sbf = createClient(fiscalUrl, fiscalKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await sbf.from('notas_fiscais').select('id').limit(2);
    if (error) {
      console.error('❌ Fiscal Supabase via supabase-js:', error.message, error.code);
    } else {
      console.log('✅ Fiscal Supabase via supabase-js: OK -', data.length, 'registros');
    }
  }
} catch (e) {
  console.error('❌ Exceção supabase-js fiscal:', e.message);
}

// Test fiscal via raw HTTP (bypass supabase-js client-side validation)
console.log('\n--- Teste via HTTP raw ---');
try {
  const resp = await fetch(`${fiscalUrl}/rest/v1/notas_fiscais?select=id&limit=2`, {
    headers: {
      'apikey': fiscalKey,
      'Authorization': `Bearer ${fiscalKey}`,
    },
  });
  const json = await resp.json();
  if (!resp.ok) {
    console.error(`❌ Fiscal HTTP raw (${resp.status}):`, JSON.stringify(json));
  } else {
    console.log('✅ Fiscal HTTP raw: OK -', Array.isArray(json) ? json.length : JSON.stringify(json), 'registros');
  }
} catch (e) {
  console.error('❌ Exceção HTTP raw fiscal:', e.message);
}
