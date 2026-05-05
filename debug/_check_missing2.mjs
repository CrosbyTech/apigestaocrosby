import supabaseFiscal from './config/supabaseFiscal.js';

// 6 person_codes que estão no Excel dia 20/04 mas não no Supabase
const missing = [117556, 10179, 25555, 31917, 12687, 12924];

console.log('=== Verificando se NFs existem em qualquer data de abril ===\n');
for (const pc of missing) {
  const { data } = await supabaseFiscal
    .from('notas_fiscais')
    .select('invoice_code,issue_date,total_value,operation_code,operation_type,invoice_status')
    .eq('person_code', pc)
    .gte('issue_date', '2026-04-01')
    .lte('issue_date', '2026-04-30');
  
  if (!data || data.length === 0) {
    console.log(`person_code=${pc} — *** NAO TEM NF NENHUMA em abril 2026 ***`);
  } else {
    console.log(`person_code=${pc}:`);
    for (const nf of data) {
      console.log(`  NF=${nf.invoice_code} date=${nf.issue_date} val=${nf.total_value} ops=${nf.operation_code} type=${nf.operation_type} status=${nf.invoice_status}`);
    }
  }
}

// Também verificar person_code=6557 (aparece no Excel como Saída de R$90.29 mas só há Input no banco)
console.log('\n=== person_code=6557 (CLEYTON F - Excel R$90.29 Output) ===');
const { data: d6557 } = await supabaseFiscal
  .from('notas_fiscais')
  .select('invoice_code,issue_date,total_value,operation_code,operation_type,invoice_status')
  .eq('person_code', 6557)
  .gte('issue_date', '2026-04-01')
  .lte('issue_date', '2026-04-30');
for (const nf of d6557 || []) {
  console.log(`  NF=${nf.invoice_code} date=${nf.issue_date} val=${nf.total_value} ops=${nf.operation_code} type=${nf.operation_type} status=${nf.invoice_status}`);
}

// Verificar person_code=65969 (Excel R$150.84 vs Supabase R$551.10)
console.log('\n=== person_code=65969 (Excel R$150.84 vs Supabase R$551.10 NF27726) ===');
const { data: d65969 } = await supabaseFiscal
  .from('notas_fiscais')
  .select('invoice_code,issue_date,total_value,operation_code,operation_type,invoice_status')
  .eq('person_code', 65969)
  .gte('issue_date', '2026-04-01')
  .lte('issue_date', '2026-04-30');
for (const nf of d65969 || []) {
  console.log(`  NF=${nf.invoice_code} date=${nf.issue_date} val=${nf.total_value} ops=${nf.operation_code} type=${nf.operation_type} status=${nf.invoice_status}`);
}
