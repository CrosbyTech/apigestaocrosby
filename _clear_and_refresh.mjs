import supabase from './config/supabase.js';
import { executarCacheCanalTotals } from './jobs/canal-totals-cache.job.js';

// Limpa cache atual pra forçar canais-totals-all chamar TOTVS (não retornar valor stale)
console.log('🗑  Limpando canal_totals_cache (mes-atual + mes-passado + ano-atual)...');
const { error } = await supabase
  .from('canal_totals_cache')
  .delete()
  .in('cache_key', ['mes-atual', 'mes-passado', 'ano-atual']);
if (error) console.error('Erro ao limpar:', error.message);
else console.log('✅ Cache limpo');

console.log('\n🔄 Refresh canal_totals_cache (TOTVS direto)...');
await executarCacheCanalTotals();
process.exit(0);
