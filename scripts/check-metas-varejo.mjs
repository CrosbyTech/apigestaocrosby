// Verifica TODAS as tabelas de metas usadas pelo MetasVarejo.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://dorztqiunewggydvkjnf.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvcnp0cWl1bmV3Z2d5ZHZram5mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzA3MTI4OCwiZXhwIjoyMDYyNjQ3Mjg4fQ.sk6z1v-MKAjiQK-IfIvPvxI-GdRyH_Biaj5a-8_Ksy8',
);

for (const tabela of ['metas_varejo', 'metas_semanais_varejo', 'metas_mensais_calculadas']) {
  console.log(`\n===== ${tabela} =====`);
  const { data, error } = await supabase.from(tabela).select('*').limit(5);
  if (error) { console.log('ERR:', error.message); continue; }
  console.log(`  registros (amostra ${data?.length}/total):`);
  for (const r of data || []) console.log('  ', JSON.stringify(r));
  // contagem total
  const { count } = await supabase.from(tabela).select('*', { count: 'exact', head: true });
  console.log(`  COUNT total: ${count}`);
}
