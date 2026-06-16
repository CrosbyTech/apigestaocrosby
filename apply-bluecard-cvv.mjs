// Verifica se a coluna cvv já existe em bluecard_leads
import 'dotenv/config';
import supabase from './config/supabase.js';

const { data, error } = await supabase
  .from('bluecard_leads')
  .select('id, cvv')
  .limit(1);

if (error) {
  if (error.message.includes('cvv')) {
    console.log('❌ Coluna cvv NÃO existe.');
    console.log('Rodar manualmente no SQL Editor do Supabase:');
    console.log('  alter table bluecard_leads add column if not exists cvv text;');
    console.log('  create index if not exists idx_bluecard_leads_cvv on bluecard_leads (cvv) where cvv is not null;');
  } else {
    console.log('❌ Erro:', error.message);
  }
} else {
  console.log('✅ Coluna cvv existe!');
  if (data?.[0]) console.log('Sample:', data[0]);
}
process.exit(0);
