// Verifica NFs faltando no Supabase - incluindo canceladas/deletadas e datas diferentes
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
import fs from 'fs';

const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);
const cache = JSON.parse(fs.readFileSync('.erp_cache.json','utf8'));
const clientes = cache.data?.clientes || [];

const datemin = '2026-04-01', datemax = '2026-04-22';

// Clientes sem NF nos 4 ops: 20133 (Heyridan), 16024 (Michel), 9100 (Yago), 70125 (Jucelino)  
// + cliente 16388 (Anderson) com op 7245
const MISSING_CLIENTS = [20133, 16024, 9100, 70125, 16388];
const SELLERS = {20133: 'Heyridan(15)', 16024: 'Michel(165)', 9100: 'Yago(241)', 70125: 'Jucelino(288)', 16388: 'Anderson(25)'};

console.log('=== Verificação NFs faltando (incluindo canceladas/deletadas) ===\n');

for (const clientCode of MISSING_CLIENTS) {
  console.log(`=== Cliente ${clientCode} (${SELLERS[clientCode]}) ===`);
  
  // ERP cache: transações desse cliente
  const erpCl = clientes.find(c=>String(c.cod)===String(clientCode));
  const erpTx = (erpCl?.transacoes||[]).filter(t=>(t.dtStr||'')>=datemin&&(t.dtStr||'')<=datemax&&t.canal!=='varejo');
  const erpTotal = erpTx.reduce((s,t)=>s+(t.vlFat||0),0);
  const erpDates = [...new Set(erpTx.map(t=>(t.dtStr||'').slice(0,10)))].sort();
  console.log(`  ERP: ${erpTx.length} tx, R$${erpTotal.toFixed(2)}, datas: ${erpDates.join(', ')}`);
  
  // Supabase: NFs de abril (sem filtro de status)
  const { data: nfsTudo } = await sb.from('notas_fiscais')
    .select('invoice_code,total_value,operation_code,issue_date,invoice_status,person_name')
    .eq('person_code', clientCode)
    .gte('issue_date','2026-04-01')
    .lte('issue_date','2026-04-30'); // extende um pouco
  
  if (!nfsTudo?.length) {
    console.log('  Supabase: NENHUMA NF em abril (qualquer status)');
  } else {
    nfsTudo.forEach(n=>console.log(`  Supabase NF ${n.invoice_code} | ${n.issue_date} | Op ${n.operation_code} | Status: ${n.invoice_status} | R$${parseFloat(n.total_value).toFixed(2)} | ${n.person_name}`));
  }
  
  // Verifica se existe NF com invoice_code próximo às datas de ERP
  // (possível NF com person_code diferente - ex: diferença CNPJ/CPF)
  if (erpDates.length > 0) {
    for (const dt of erpDates) {
      const { data: sameDay } = await sb.from('notas_fiscais')
        .select('invoice_code,total_value,operation_code,invoice_status,person_code,person_name')
        .eq('issue_date', dt)
        .in('operation_code',[7236,9122,5102,7242,7245])
        .gte('total_value', erpTotal * 0.9)
        .lte('total_value', erpTotal * 1.1);
      if (sameDay?.length) {
        console.log(`  NFs similares no dia ${dt} (±10% do valor R$${erpTotal.toFixed(2)}):`);
        sameDay.forEach(n=>console.log(`    NF ${n.invoice_code} | Op ${n.operation_code} | ${n.invoice_status} | R$${parseFloat(n.total_value).toFixed(2)} | ${n.person_code} (${n.person_name})`));
      }
    }
  }
  console.log();
}

// Verifica op 7245 - é uma op de revenda?
console.log('\n=== Verificação op 7245 ===');
const { data: op7245NFs } = await sb.from('notas_fiscais')
  .select('invoice_code,total_value,operation_code,issue_date,person_code,person_name,items')
  .eq('operation_code', 7245)
  .gte('issue_date', datemin)
  .lte('issue_date', datemax)
  .not('invoice_status','eq','Canceled')
  .not('invoice_status','eq','Deleted');

console.log(`NFs op 7245 no período: ${op7245NFs?.length}`);
for (const nf of (op7245NFs||[]).slice(0,5)) {
  const dcs = new Set();
  for (const it of nf.items||[]) for (const p of it.products||[]) dcs.add(parseInt(p.dealerCode));
  console.log(`  NF ${nf.invoice_code} | ${nf.issue_date} | R$${parseFloat(nf.total_value).toFixed(2)} | ${nf.person_name} | dealers: ${[...dcs].join(',')}`);
}
