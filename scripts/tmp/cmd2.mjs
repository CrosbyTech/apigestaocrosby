import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data } = await supabase.from('accounts_receivable_commands').select('id,command,branch_code,customer_code,receivable_code,sucesso,http_status,erro,resposta,criado_em').gte('criado_em', '2026-11-04T23:50:00Z').order('id');
for (const r of data || []) console.log(r.id, r.command, r.branch_code, r.customer_code, r.receivable_code, r.sucesso, r.http_status, (r.erro || '').slice(0, 100), r.sucesso ? '' : JSON.stringify(r.resposta).slice(0, 300));
process.exit(0);
