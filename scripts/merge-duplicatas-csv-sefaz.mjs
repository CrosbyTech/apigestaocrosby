// Antes de o destinatario passar a ser a filial, as notas do CSV foram
// gravadas sob o CNPJ da matriz. Quando a SEFAZ trouxe a mesma nota sob o
// CNPJ correto da filial, sobrou um par. A linha da SEFAZ e a boa (CNPJ
// certo, XML); dela so falta a manifestacao, que veio no CSV.
import supabase from '../config/supabase.js';

let todas = [];
for (let off = 0; off < 100000; off += 1000) {
  const { data, error } = await supabase
    .from('sefaz_dfe_notas')
    .select('id, chave_acesso, empresa_codigo, schema_origem, manifestacao, manifestacao_descricao, situacao')
    .order('id')
    .range(off, off + 999);
  if (error) throw new Error(error.message);
  if (!data?.length) break;
  todas = todas.concat(data);
  if (data.length < 1000) break;
}

const porChave = {};
for (const l of todas) (porChave[l.chave_acesso] = porChave[l.chave_acesso] || []).push(l);

let mesclados = 0, manifCopiada = 0, ignorados = 0;
for (const [, v] of Object.entries(porChave)) {
  if (v.length !== 2) { if (v.length > 1) ignorados++; continue; }
  const csv = v.find((x) => x.schema_origem === 'csv-fisfp153');
  const sef = v.find((x) => x.schema_origem !== 'csv-fisfp153');
  if (!csv || !sef) { ignorados++; continue; }
  // So mescla o que é claramente a mesma nota da mesma filial
  if (csv.empresa_codigo !== sef.empresa_codigo) { ignorados++; continue; }

  if (csv.manifestacao && !sef.manifestacao) {
    const { error } = await supabase
      .from('sefaz_dfe_notas')
      .update({
        manifestacao: csv.manifestacao,
        manifestacao_descricao: csv.manifestacao_descricao,
      })
      .eq('id', sef.id);
    if (!error) manifCopiada++;
  }

  const { error } = await supabase.from('sefaz_dfe_notas').delete().eq('id', csv.id);
  if (!error) mesclados++;
}

console.log(`pares mesclados: ${mesclados}`);
console.log(`manifestacao trazida do CSV: ${manifCopiada}`);
if (ignorados) console.log(`ignorados (nao eram par simples): ${ignorados}`);
process.exit(0);
