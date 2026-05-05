import supabaseFiscal from './config/supabaseFiscal.js';

const TXS = [821088, 826052, 828581];

const { data } = await supabaseFiscal.from('notas_fiscais')
  .select('transaction_code, invoice_code, serial_code, operation_code, operation_name, operation_type, invoice_status, total_value, discount_value, raw_data, items')
  .in('transaction_code', TXS);

for (const n of data || []) {
  console.log('\n=== TX:', n.transaction_code, '===');
  console.log(' invoice_code:', n.invoice_code, '| serial:', n.serial_code);
  console.log(' operation:', n.operation_code, n.operation_name, '| type:', n.operation_type);
  console.log(' status:', n.invoice_status, '| total:', n.total_value, '| desconto:', n.discount_value);

  // Verifica campos do raw_data que possam indicar Credev
  const raw = n.raw_data || {};
  const camposInteressantes = [
    'creditNoteCode', 'creditNote', 'creditNoteValue', 'creditDebit',
    'returnNoteCode', 'returnCode', 'referenceCode', 'referenceNoteCode',
    'originalInvoice', 'originalInvoiceCode', 'relatedDocument',
    'transactionReference', 'financialDocument', 'financialValue',
    'netValue', 'grossValue', 'returnValue', 'devolutionValue',
    'complementaryValue', 'complementaryCode',
    'situation', 'situationCode',
  ];
  const encontrados = {};
  for (const c of camposInteressantes) {
    if (raw[c] !== undefined && raw[c] !== null && raw[c] !== '') {
      encontrados[c] = raw[c];
    }
  }
  if (Object.keys(encontrados).length) {
    console.log(' Campos raw relevantes:', JSON.stringify(encontrados));
  } else {
    console.log(' (nenhum campo Credev encontrado nos suspeitos)');
  }

  // Mostra todas as chaves de raw_data para inspeção
  console.log(' Todas as chaves do raw_data:', Object.keys(raw).join(', '));

  // Verifica items → products para referência de devolução
  const prods = (n.items || []).flatMap(it => it.products || []);
  const camposProd = ['creditNoteCode','returnCode','originalInvoice','referenceCode','dealerCode','netValue','grossValue','returnValue'];
  if (prods.length > 0) {
    const prodSample = prods[0];
    console.log(' Chaves do 1º produto:', Object.keys(prodSample).join(', '));
    const prodRelevante = {};
    for (const c of camposProd) {
      if (prodSample[c] !== undefined) prodRelevante[c] = prodSample[c];
    }
    if (Object.keys(prodRelevante).length) console.log(' Produto[0] campos relevantes:', JSON.stringify(prodRelevante));
  }
}
