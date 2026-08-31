// Remove da tabela as vendas ao consumidor (destinatario = CPF) que entraram
// pelo fluxo <autXML>: um CNPJ do grupo esta autorizado a baixar o XML e a
// SEFAZ entrega a nota na Distribuicao DFe dele, mas a nota nao e "emitida
// para mim" — e uma venda da propria loja para cliente final.
import supabase from '../config/supabase.js';

let todas = [];
for (let off = 0; off < 200000; off += 1000) {
  const { data, error } = await supabase
    .from('sefaz_dfe_notas')
    .select('id, chave_acesso, empresa_codigo, xml_completo, xml')
    .eq('xml_completo', true)
    .order('id', { ascending: true })
    .range(off, off + 999);
  if (error) throw new Error(error.message);
  if (!data?.length) break;
  todas = todas.concat(data);
  if (data.length < 1000) break;
}
console.log(`${todas.length} notas com XML completo`);

const cpfDest = todas.filter((n) => {
  const dest = /<dest>([\s\S]*?)<\/dest>/.exec(n.xml || '');
  if (!dest) return false;
  return (
    /<CPF>\d{11}<\/CPF>/.test(dest[1]) && !/<CNPJ>\d{14}<\/CNPJ>/.test(dest[1])
  );
});
console.log(`vendas ao consumidor (dest = CPF): ${cpfDest.length}`);

let removidas = 0;
for (let i = 0; i < cpfDest.length; i += 100) {
  const ids = cpfDest.slice(i, i + 100).map((n) => n.id);
  const { error } = await supabase.from('sefaz_dfe_notas').delete().in('id', ids);
  if (error) {
    console.error(`ERRO no lote ${i}: ${error.message}`);
    process.exit(1);
  }
  removidas += ids.length;
}
console.log(`✅ removidas: ${removidas}`);
process.exit(0);
