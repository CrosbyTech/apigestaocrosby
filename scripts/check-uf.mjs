import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const s = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);

// Listar tabelas com potencial pra UF (testando algumas comuns)
for (const t of ['pes_pessoa', 'persons', 'pessoa_uf', 'pessoas']) {
  try {
    const r = await s.from(t).select('*', { count: 'exact', head: true });
    console.log(`${t.padEnd(15)} → count: ${r.count || 'err'} ${r.error?.message?.slice(0, 60) || ''}`);
  } catch (e) {
    console.log(t, 'erro:', e.message?.slice(0, 80));
  }
}

// Tenta notas_fiscais com UF embedded
const nf = await s.from('notas_fiscais').select('*').limit(1);
console.log('\nColunas notas_fiscais:', Object.keys(nf.data?.[0] || {}));

// Tenta erp_pessoas e variações
for (const t of ['erp_pessoas', 'erp_clientes', 'erp_persons', 'pes_pessoa_complemento', 'cidades']) {
  const r = await s.from(t).select('*', { count: 'exact', head: true });
  console.log(`${t.padEnd(30)} → count: ${r.count} ${r.error?.message?.slice(0,60)||''}`);
}

// Lista schemas via RPC se disponível
console.log('\nTentando RPC pg_tables...');
const sr = await s.rpc('exec_sql', { sql: "SELECT table_schema, table_name FROM information_schema.tables WHERE table_name ILIKE '%pess%' OR table_name ILIKE '%cliente%' OR column_name ILIKE '%uf%' LIMIT 20" });
console.log('rpc:', sr.error?.message?.slice(0,100) || JSON.stringify(sr.data).slice(0,300));
