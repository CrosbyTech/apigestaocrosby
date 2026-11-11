import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data } = await supabase.from('solicitacoes_crosby').select('setor,status,forma_pagamento,solicitante').limit(3000);
const c = (k) => { const m = {}; for (const r of data) m[r[k]] = (m[r[k]] || 0) + 1; return m; };
console.log('setor', c('setor')); console.log('status', c('status')); console.log('forma', c('forma_pagamento'));
process.exit(0);
