import 'dotenv/config';
import supabase from '../../config/supabase.js';
for (const cd of [118389, 96981, 127948]) {
  const { data } = await supabase.from('solicitacoes_baixa').select('id,created_at,status,origem,nm_cliente,nr_fat,nr_parcela,vl_fatura,dt_pagamento,ref_externa').eq('cd_cliente', cd).order('created_at',{ascending:false}).limit(6);
  console.log('\ncd ' + cd + ': ' + (data?.length||0) + ' solicitacao(oes)');
  for (const r of data||[]) console.log('  ' + r.created_at.slice(0,16) + ' ' + r.status + ' ' + r.origem + ' ' + String(r.nm_cliente||'').slice(0,20) + ' ' + r.nr_fat + '/' + r.nr_parcela + ' vl ' + r.vl_fatura + ' pg ' + String(r.dt_pagamento||'').slice(0,10) + ' | ref ' + r.ref_externa);
}
process.exit(0);
