import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();

const sb = createClient(
  'https://wnjapaczjcvhumfikwwe.supabase.co',
  process.env.SUPABASE_FISCAL_KEY
);

// Busca as NFs da op 5912 (mostruário Jucelino) e pega o raw_data para ver campos disponíveis
const { data, error } = await sb.from('notas_fiscais')
  .select('invoice_code, operation_code, operation_name, total_value, raw_data')
  .in('invoice_code', ['27656', '27554', '4101'])
  .limit(5);

if (error) { console.error(error); process.exit(1); }

for (const nf of data) {
  console.log(`\n=== NF ${nf.invoice_code} [op ${nf.operation_code}] R$${nf.total_value} ===`);
  if (!nf.raw_data) {
    console.log('  raw_data: NULL');
    continue;
  }
  // Top-level keys do raw_data
  console.log('  raw_data keys:', Object.keys(nf.raw_data));
  
  // Procura especificamente por campos de pagamento
  const raw = nf.raw_data;
  const searchTerms = ['payment', 'financ', 'pagament', 'forma', 'credev', 'antecip', 'boleto', 'pix', 'dinheiro'];
  const rawStr = JSON.stringify(raw).toLowerCase();
  searchTerms.forEach(term => {
    if (rawStr.includes(term)) console.log(`  ✅ Encontrou "${term}" no raw_data`);
  });
  
  // Mostra os primeiros 1000 chars do raw_data pra ver estrutura
  console.log('  raw_data (primeiros 800 chars):');
  console.log(JSON.stringify(raw).substring(0, 800));
}
