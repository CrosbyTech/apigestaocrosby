import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();

const sb = createClient(
  'https://wnjapaczjcvhumfikwwe.supabase.co',
  process.env.SUPABASE_FISCAL_KEY
);

// Busca as NFs específicas para ver todos os campos disponíveis
const { data, error } = await sb.from('notas_fiscais')
  .select('*')
  .in('invoice_code', ['4101', '27656', '27554'])
  .eq('operation_type', 'Output')
  .limit(3);

if (error) { console.error(error); process.exit(1); }

console.log(`NFs encontradas: ${data.length}\n`);
for (const nf of data) {
  console.log('=== NF', nf.invoice_code, '===');
  // Mostra todos os campos exceto items (muito grande)
  const { items, ...resto } = nf;
  console.log(JSON.stringify(resto, null, 2));
  // Mostra estrutura dos items brevemente
  if (items && items.length > 0) {
    console.log('items[0] keys:', Object.keys(items[0]));
    if (items[0].products?.length > 0) {
      console.log('items[0].products[0] keys:', Object.keys(items[0].products[0]));
    }
    // Verifica se há campo de financeiro/pagamento dentro dos items
    const sample = JSON.stringify(items[0]).substring(0, 500);
    console.log('items[0] sample:', sample);
  }
  console.log('');
}
