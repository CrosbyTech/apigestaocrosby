import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data } = await supabase.from('contas_pagar_pagos_conciliacao').select('conciliacao_id,cd_empresa,nr_duplicata,nr_parcela,cd_fornecedor,dt_pagamento,vl_pago,banco').in('conciliacao_id', [1976, 1977, 1978]);
console.log(JSON.stringify(data));
process.exit(0);
