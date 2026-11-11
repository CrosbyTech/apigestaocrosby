import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data, error } = await supabase.from('pagamentos_liberacao').select('*').eq('id', 'b1c6e3a1-43cc-4938-83d2-f04ab11d5d7d').maybeSingle();
console.log(error?.message, data && JSON.stringify({ status: data.status, dt_pagamento: data.dt_pagamento, banco: data.banco, fornecedor: data.nm_fornecedor || data.fornecedor }));
setTimeout(()=>process.exit(0),100);
