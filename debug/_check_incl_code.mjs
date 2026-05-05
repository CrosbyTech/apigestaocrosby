// Investiga inclusionComponentCode de NFs B2R vs B2L para Jucelino/Felipe (branch 2)
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// NFs de Jucelino e Felipe no Supabase: B2R esperado (LUCIVANIA 48353, ADRIANO 40409)
// e B2L (DANILLA 70078, SHAYANNE 12097)
const { data: nfs } = await sb.from('notas_fiscais')
  .select('invoice_code,person_code,person_name,operation_code,branch_code,raw_data,items')
  .in('person_code',[48353,40409,70078,12097,70125,86008])
  .gte('issue_date','2026-04-01')
  .lte('issue_date','2026-04-22')
  .not('invoice_status','eq','Canceled')
  .in('operation_code',[7236,9122,5102,7242]);

for (const nf of nfs||[]) {
  const rd = nf.raw_data||{};
  const dealerCodes = new Set();
  for (const it of nf.items||[]) for (const p of it.products||[]) dealerCodes.add(parseInt(p.dealerCode));
  const hasJucelino = dealerCodes.has(288);
  const hasFelipe = dealerCodes.has(251);
  const sellerMark = hasJucelino?'[Jucelino]':hasFelipe?'[Felipe]':'';
  
  console.log(`NF ${nf.invoice_code} | ${nf.person_name} (${nf.person_code}) | Op ${nf.operation_code} | Branch ${nf.branch_code} | incl=${rd.inclusionComponentCode||'-'} ${sellerMark}`);
}

// Agora: pega uma amostra maior de NFs branch 2 com Jucelino e analisa inclusionComponentCode
console.log('\n=== Distribuição de inclusionComponentCode para NFs de Jucelino (branch 2) ===');
const { data: jNFs } = await sb.from('notas_fiscais')
  .select('invoice_code,person_code,person_name,operation_code,raw_data,total_value,items')
  .eq('branch_code',2)
  .gte('issue_date','2026-04-01')
  .lte('issue_date','2026-04-22')
  .not('invoice_status','eq','Canceled')
  .in('operation_code',[7236,9122,5102,7242])
  .limit(200);

const inclComp = {};
const inclCompPersonList = {};
for (const nf of jNFs||[]) {
  const rd = nf.raw_data||{};
  const hasJ = (nf.items||[]).some(it=>(it.products||[]).some(p=>parseInt(p.dealerCode)===288));
  if (!hasJ) continue;
  const incl = rd.inclusionComponentCode||'null';
  if (!inclComp[incl]) inclComp[incl] = { count:0, total:0, persons:[] };
  inclComp[incl].count++;
  inclComp[incl].total += parseFloat(nf.total_value)||0;
  if (inclComp[incl].persons.length < 5) inclComp[incl].persons.push(`${nf.person_code}(${nf.person_name.slice(0,20)})`);
}

for (const [incl, info] of Object.entries(inclComp)) {
  console.log(`  ${incl}: ${info.count} NFs, R$${info.total.toFixed(2)}`);
  console.log(`    ex: ${info.persons.join(', ')}`);
}

// Verifica a propriedade userCode também - DANILLA estava associada a userCode=288 (Jucelino)
console.log('\n=== Diferença por inclusionComponentCode ===');
// TRAFM060 = direto TOTVS (B2L/franquia)
// PDVFM001 = PDV (B2R)
const trafTotal = {}, pdvTotal = {};
for (const nf of jNFs||[]) {
  const rd = nf.raw_data||{};
  const incl = rd.inclusionComponentCode||'null';
  const sellerNV = {};
  for (const it of nf.items||[]) for (const p of it.products||[]) {
    const dc = parseInt(p.dealerCode);
    if (!sellerNV[dc]) sellerNV[dc] = 0;
    sellerNV[dc] += parseFloat(p.netValue)||0;
  }
  if (!sellerNV[288]) continue;
  if (incl==='TRAFM060') {
    if (!trafTotal[288]) trafTotal[288] = 0;
    trafTotal[288] += sellerNV[288];
  } else if (incl==='PDVFM001') {
    if (!pdvTotal[288]) pdvTotal[288] = 0;
    pdvTotal[288] += sellerNV[288];
  }
}
console.log(`Jucelino - TRAFM060 (B2L?): R$${(trafTotal[288]||0).toFixed(2)}`);
console.log(`Jucelino - PDVFM001 (B2R?): R$${(pdvTotal[288]||0).toFixed(2)}`);
