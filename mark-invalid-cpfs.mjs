import 'dotenv/config';
import supabase from './config/supabase.js';

const invalidLeads = [
  { id: 3, cpf: '79130191453' },
  { id: 32, cpf: '00449757370' },
];

for (const { id, cpf } of invalidLeads) {
  const { error } = await supabase
    .from('bluecard_leads')
    .update({
      totvs_sync_error: `CPF ${cpf} inválido — corrigir manualmente e reenviar (TOTVS rejeitou dígito verificador)`,
      totvs_synced_at: new Date().toISOString(),
    })
    .eq('id', id);
  console.log(`Lead ${id}: ${error ? '❌ ' + error.message : '✓ marcado'}`);
}
process.exit(0);
