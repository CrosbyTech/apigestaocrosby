import supabaseFiscal from './config/supabaseFiscal.js';

const TXS = [821088, 826052, 828581];

const { data } = await supabaseFiscal.from('notas_fiscais')
  .select('transaction_code, invoice_code, total_value, raw_data, items')
  .in('transaction_code', TXS);

for (const n of data || []) {
  console.log('\n=== TX:', n.transaction_code, '| NF:', n.invoice_code, '| Total: R$' + n.total_value, '===');

  // referencedTaxInvoice no nível da NF
  const raw = n.raw_data || {};
  console.log(' referencedTaxInvoice:', JSON.stringify(raw.referencedTaxInvoice ?? 'null'));

  // referencedInvoices em cada produto
  const prods = (n.items || []).flatMap(it => it.products || []);
  prods.forEach((p, i) => {
    console.log(` produto[${i}] dealer:${p.dealerCode} net:${p.netValue} gross:${p.grossValue}`);
    if (p.referencedInvoices && p.referencedInvoices.length > 0) {
      console.log(`   referencedInvoices:`, JSON.stringify(p.referencedInvoices));
    } else {
      console.log(`   referencedInvoices: (vazio)`);
    }
  });
}
