import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data, error } = await supabase.from('stone_conciliacao_arquivos').select('stonecode,data_ref,qtd_transacoes,qtd_pagamentos,baixado_em,gerado_em').gte('baixado_em', '2026-11-03T00:00:00Z').order('baixado_em');
console.log(error?.message, (data||[]).length);
for (const r of data || []) console.log(r.stonecode, r.data_ref, r.qtd_transacoes, r.qtd_pagamentos, r.baixado_em, r.gerado_em);
process.exit(0);
