import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data } = await supabase.from('fluxo_caixa_conciliacoes').select('id,lancamento_id,data,valor,origem,referencia->id,chave').eq('data', '2026-10-26').lte('valor', -23862).gte('valor', -23863);
console.log(data);
const { data: l } = await supabase.from('pagamentos_liberacao').select('id,nm_fornecedor,status,vl_real,vl_duplicata,dt_pagamento').ilike('nm_fornecedor', '%JJI%').limit(5);
console.log(l);
process.exit(0);
