import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { count } = await supabase.from('contas_pagar_pagos_conciliacao').select('id', { count: 'exact', head: true });
const { data } = await supabase.from('contas_pagar_pagos_conciliacao').select('conciliacao_id,criado_em').order('criado_em', { ascending: false }).limit(1);
console.log(count, JSON.stringify(data), new Date().toISOString());
process.exit(0);
