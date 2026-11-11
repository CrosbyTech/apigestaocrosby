import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data } = await supabase.from('solicitacoes_crosby').select('*').eq('tipo_solicitacao', 'pagamento').not('despesa_code', 'is', null).order('created_at', { ascending: false }).limit(1);
const r = data?.[0] || {};
for (const [k, v] of Object.entries(r)) console.log(k, '=', JSON.stringify(v)?.slice(0, 160));
const { data: cc } = await supabase.from('solicitacoes_crosby').select('cd_empresa,despesa_code,despesa_nome,cost_center_code').in('despesa_code', [7008, 9005, 7013]).limit(20);
console.log('tarifas', cc);
process.exit(0);
