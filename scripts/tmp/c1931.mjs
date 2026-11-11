import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data } = await supabase.from('fluxo_caixa_conciliacoes').select('id,data,valor,origem,referencia,justificativa').eq('id', 1931).single();
console.log(data.data, data.valor, data.origem, data.justificativa, JSON.stringify((data.referencia?.itens||[data.referencia]).map(i=>[i.origem,i.id,i.valorUsado??i.valor])));
const { data: p } = await supabase.from('contas_pagar_pagos_conciliacao').select('*').eq('conciliacao_id', 1931);
console.log(JSON.stringify(p));
process.exit(0);
