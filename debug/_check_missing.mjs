import supabaseFiscal from './config/supabaseFiscal.js';

const missing = [117556, 10179, 25555, 31917, 12687, 6557, 12924];

for (const pc of missing) {
  const { data } = await supabaseFiscal
    .from('notas_fiscais')
    .select('invoice_code,issue_date,total_value,operation_code,operation_type,invoice_status')
    .eq('person_code', pc)
    .gte('issue_date', '2026-04-18')
    .lte('issue_date', '2026-04-23');
  
  if (!data || data.length === 0) {
    console.log(`person_code=${pc} — NAO ENCONTRADO no banco (18-23/04)`);
  } else {
    for (const nf of data) {
      console.log(`person_code=${pc} — NF=${nf.invoice_code} date=${nf.issue_date} val=${nf.total_value} ops=${nf.operation_code} type=${nf.operation_type} status=${nf.invoice_status}`);
    }
  }
}
