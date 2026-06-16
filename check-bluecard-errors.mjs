// Verifica erros TOTVS sync nos leads BlueCard
import 'dotenv/config';
import supabase from './config/supabase.js';

const { data } = await supabase
  .from('bluecard_leads')
  .select('id, nome, cpf, status, totvs_person_code, totvs_sync_error, totvs_synced_at, criado_em')
  .order('criado_em', { ascending: false })
  .limit(50);

console.log(`Total leads: ${data?.length || 0}\n`);

const comErro = data.filter(l => l.totvs_sync_error);
const sincronizados = data.filter(l => l.totvs_person_code);
const pendentes = data.filter(l => !l.totvs_person_code && !l.totvs_sync_error);

console.log(`✅ Sincronizados: ${sincronizados.length}`);
console.log(`❌ Com erro: ${comErro.length}`);
console.log(`⏳ Pendentes: ${pendentes.length}`);

if (comErro.length > 0) {
  console.log('\n=== ERROS TOTVS ===');
  for (const l of comErro.slice(0, 10)) {
    console.log(`Lead ${l.id} — ${l.nome} (CPF ${l.cpf}, status=${l.status})`);
    console.log(`  Erro: ${l.totvs_sync_error?.slice(0, 200)}`);
    console.log();
  }
}
process.exit(0);
