// Retry sync TOTVS pros leads BlueCard com erro
import 'dotenv/config';
import supabase from './config/supabase.js';

const PORT = process.env.PORT || 4100;
const BASE = `http://localhost:${PORT}`;

const { data: leadsComErro } = await supabase
  .from('bluecard_leads')
  .select('id, nome, cpf, totvs_sync_error')
  .is('totvs_person_code', null)
  .not('totvs_sync_error', 'is', null)
  .order('id');

console.log(`📋 ${leadsComErro?.length || 0} leads com erro pra retry\n`);

let sucesso = 0, falha = 0;
for (const l of leadsComErro || []) {
  process.stdout.write(`Lead ${l.id} (${l.nome.slice(0, 30).padEnd(30)}) `);
  try {
    const r = await fetch(`${BASE}/api/bluecard/leads/${l.id}/sync-totvs`, {
      method: 'POST',
    });
    const j = await r.json();
    if (j.ok || j.totvs?.ok) {
      console.log(`✅ personCode=${j.totvs?.personCode || j.lead?.totvs_person_code}`);
      sucesso++;
    } else {
      console.log(`❌ ${(j.totvs?.error || j.error || 'sem erro').slice(0, 100)}`);
      falha++;
    }
  } catch (e) {
    console.log(`❌ fetch falhou: ${e.message}`);
    falha++;
  }
  // Anti-rate-limit
  await new Promise((r) => setTimeout(r, 500));
}

console.log(`\n=== RESULTADO ===`);
console.log(`✅ ${sucesso} sucessos`);
console.log(`❌ ${falha} falhas`);
process.exit(0);
