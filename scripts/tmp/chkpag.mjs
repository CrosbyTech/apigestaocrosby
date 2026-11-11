import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { count, error } = await supabase.from('contas_pagar_pagos_conciliacao').select('id', { count: 'exact', head: true });
console.log('linhas', error?.message || count);
const { data } = await supabase.from('contas_pagar_pagos_conciliacao').select('cd_empresa,nr_duplicata,nr_parcela,dt_pagamento,vl_pago,banco,origem').order('dt_pagamento', { ascending: false }).limit(5);
console.log(data);
const { data: o } = await supabase.from('contas_pagar_pagos_conciliacao').select('origem').limit(5000);
const c = {}; for (const r of o || []) c[r.origem] = (c[r.origem] || 0) + 1; console.log(c);
process.exit(0);
