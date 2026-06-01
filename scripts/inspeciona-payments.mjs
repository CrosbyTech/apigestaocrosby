import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
// usa a mesma config do supabaseFiscal
import supabaseFiscal from '../config/supabaseFiscal.js';

// Pega algumas NFs Output da filial 99 no período e mostra a estrutura de payments
const { data, error } = await supabaseFiscal
  .from('notas_fiscais')
  .select('invoice_code, branch_code, operation_code, total_value, payments, dealer_code')
  .eq('operation_type', 'Output')
  .eq('branch_code', 99)
  .gte('issue_date', '2026-05-01')
  .lte('issue_date', '2026-05-28')
  .limit(50);

if (error) { console.log('ERRO:', error.message); process.exit(1); }
console.log('NFs retornadas:', (data || []).length);
let comPayments = 0, comCredev = 0;
const tiposVistos = new Set();
for (const nf of data || []) {
  const pays = Array.isArray(nf.payments) ? nf.payments : [];
  if (pays.length) comPayments++;
  for (const p of pays) {
    // coleta todas as chaves e valores de "tipo"
    Object.keys(p).forEach((k) => tiposVistos.add(k));
    const tipo = p.documentType ?? p.document_type ?? p.type ?? p.paymentType ?? p.payment_type;
    if (tipo) tiposVistos.add('VAL:' + tipo);
    if (String(tipo).toLowerCase().includes('credev')) comCredev++;
  }
}
console.log('NFs com payments:', comPayments, '| com credev:', comCredev);
console.log('\nChaves/valores vistos em payments:', [...tiposVistos].join(' | '));
// amostra de um payments não-vazio
const amostra = (data || []).find((nf) => Array.isArray(nf.payments) && nf.payments.length);
if (amostra) {
  console.log('\nAmostra payments (NF', amostra.invoice_code, '):');
  console.log(JSON.stringify(amostra.payments, null, 2).slice(0, 600));
}
