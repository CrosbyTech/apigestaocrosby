import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Clientes com sellerCode=180 no ERP cache aparecem com person codes CRM.
// Buscamos pelas NFs pelo nome: MARIA LETICIA SILVA DE LIMA (person 28320 no CRM)
// e VENDEDOR PATRIMONIO em geral
// Primeiro: busca por todos os person_code/names que aparecem no erp_cache com vendedor PATRIMONIO
// Usando os cods: 28320, 31385, 31446, 31446 etc. como person_code no Supabase
const persons = [28320, 31385, 31446, 4319, 4239, 4449, 7841, 7649, 6928, 6746, 5550, 5538, 5538, 4102, 3749, 3573, 1965, 1801, 1541, 754];

const { data } = await sb.from('notas_fiscais')
  .select('branch_code, operation_code, operation_name, total_value, dealer_code, user_code, person_code, person_name, issue_date, items')
  .in('person_code', persons)
  .eq('operation_type','Output')
  .not('invoice_status','eq','Canceled')
  .gte('issue_date','2025-01-01')
  .limit(500);

console.log('NFs com person_codes de clientes PATRIMONIO:', (data||[]).length);

const agg = {};
for (const nf of data||[]) {
  const dealers = new Set();
  for (const it of nf.items||[]) for (const p of (it.products||[])) dealers.add(p.dealerCode);
  const k = 'branch='+nf.branch_code+' op='+nf.operation_code+' ('+nf.operation_name.slice(0,30)+') dealer_nf='+nf.dealer_code+' user='+nf.user_code+' items_dealers='+([...dealers].join(','));
  if (!agg[k]) agg[k] = {count:0, total:0};
  agg[k].count++;
  agg[k].total += parseFloat(nf.total_value)||0;
}
console.log('Distribuicao:');
for (const [k,v] of Object.entries(agg).sort((a,b)=>b[1].total-a[1].total)) {
  console.log('  '+k+': '+v.count+' NFs R$'+v.total.toFixed(2));
}
