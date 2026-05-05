// Investiga como identificar REVENDEDOR vs FRANQUIA no Supabase
import { createClient } from '@supabase/supabase-js';
import { loadDebugEnv } from './_debugEnv.mjs';
loadDebugEnv();
const sb = createClient('https://wnjapaczjcvhumfikwwe.supabase.co',process.env.SUPABASE_FISCAL_KEY);

// Pega NFs de clientes conhecidos: DANILLA (70078) = B2L, SHAYANNE (12097) = B2L
// e um cliente normal de Jucelino = B2R
const { data } = await sb.from('notas_fiscais')
  .select('invoice_code,person_code,person_name,operation_code,person,items')
  .in('person_code',[70078,12097,48353,40409])
  .gte('issue_date','2026-04-01')
  .lte('issue_date','2026-04-22')
  .limit(8);

for (const nf of data||[]) {
  console.log(`\nNF ${nf.invoice_code} | Op ${nf.operation_code} | ${nf.person_name} (${nf.person_code})`);
  console.log('  person field keys:', Object.keys(nf.person||{}).join(', '));
  console.log('  person:', JSON.stringify(nf.person));
  // Analisa items[0].products[0] para ver campos adicionais
  const firstProd = (nf.items||[])[0]?.products?.[0];
  if (firstProd) {
    console.log('  product keys:', Object.keys(firstProd).join(', '));
    const { dealerCode, netValue, ...rest } = firstProd;
    console.log('  product extra:', JSON.stringify(rest));
  }
}

// Verifica campos do person que poderiam indicar tipo cliente
console.log('\n=== Campos interessantes no person ===');
const { data: nfs2 } = await sb.from('notas_fiscais')
  .select('person_code,person_name,person,operation_code')
  .in('person_code',[70078,12097,48353,40409,54259])
  .gte('issue_date','2026-04-01')
  .lte('issue_date','2026-04-22')
  .not('invoice_status','eq','Canceled');

for (const nf of nfs2||[]) {
  const p = nf.person||{};
  console.log(`${nf.person_code} ${nf.person_name} | personType=${p.personType||'-'} | personGroup=${p.personGroup||'-'} | personKind=${p.personKind||'-'} | op=${nf.operation_code}`);
}

// Busca mais campos potenciais em NFs B2L do Excel
// DANILLA = franquia, SHAYANNE = franquia
// Verifica se personCpfCnpj pode ser um indicador (CNPJ = empresa, CPF = pessoa física)
const { data: nfs3 } = await sb.from('notas_fiscais')
  .select('person_code,person_name,person_cpf_cnpj,operation_code')
  .in('person_code',[70078,12097,48353,40409])
  .gte('issue_date','2026-04-01')
  .lte('issue_date','2026-04-22')
  .not('invoice_status','eq','Canceled');

console.log('\n=== CPF/CNPJ ===');
for (const nf of nfs3||[]) {
  const cpfCnpj = nf.person_cpf_cnpj||'';
  const isEmpresa = cpfCnpj.replace(/\D/g,'').length === 14;
  const isPessoa = cpfCnpj.replace(/\D/g,'').length === 11;
  console.log(`${nf.person_code} ${nf.person_name} | cpf_cnpj=${cpfCnpj} | ${isEmpresa?'CNPJ(empresa)':isPessoa?'CPF(pessoa)':'sem doc'} | op=${nf.operation_code}`);
}
