// A DFe entrega o documento tambem para quem esta em <autXML> (autorizado a
// baixar o XML), entao o CNPJ consultado nao e garantidamente o destinatario.
// Onde temos o XML completo, o <dest> e a fonte da verdade.
import supabase from '../config/supabase.js';
import { filialPorCnpj } from '../config/sefazFiliais.js';

let linhas = [];
for (let off = 0; off < 100000; off += 1000) {
  const { data, error } = await supabase
    .from('sefaz_dfe_notas')
    .select('id, chave_acesso, cnpj_destinatario, empresa_codigo, xml')
    .eq('xml_completo', true)
    .order('id')
    .range(off, off + 999);
  if (error) throw new Error(error.message);
  if (!data?.length) break;
  linhas = linhas.concat(data);
  if (data.length < 1000) break;
}
console.log(`${linhas.length} notas com XML completo`);

// Quem ja ocupa cada (cnpj, chave), para nao colidir ao mover
const ocupado = new Map();
for (let off = 0; off < 100000; off += 1000) {
  const { data } = await supabase
    .from('sefaz_dfe_notas')
    .select('id, cnpj_destinatario, chave_acesso')
    .order('id')
    .range(off, off + 999);
  if (!data?.length) break;
  for (const l of data) ocupado.set(`${l.cnpj_destinatario}|${l.chave_acesso}`, l.id);
  if (data.length < 1000) break;
}

let corrigidas = 0, removidas = 0, semDono = 0;
for (const l of linhas) {
  const m = /<dest>[\s\S]*?<CNPJ>(\d{14})<\/CNPJ>/.exec(l.xml || '');
  if (!m) continue;
  const real = m[1];
  if (real === l.cnpj_destinatario) continue;

  const filial = filialPorCnpj(real);
  const chaveAlvo = `${real}|${l.chave_acesso}`;
  const jaExiste = ocupado.get(chaveAlvo);

  if (jaExiste && jaExiste !== l.id) {
    // A nota ja esta gravada sob o destinatario correto — esta linha e a
    // copia que chegou pelo fluxo do autorizado; some com ela.
    const { error } = await supabase.from('sefaz_dfe_notas').delete().eq('id', l.id);
    if (!error) { removidas++; ocupado.delete(`${l.cnpj_destinatario}|${l.chave_acesso}`); }
    continue;
  }

  const { error } = await supabase
    .from('sefaz_dfe_notas')
    .update({
      cnpj_destinatario: real,
      empresa_codigo: filial ? filial.codigo : null,
      empresa_nome: filial ? filial.nome : null,
    })
    .eq('id', l.id);
  if (error) { console.error(`  id ${l.id}: ${error.message}`); continue; }
  ocupado.delete(`${l.cnpj_destinatario}|${l.chave_acesso}`);
  ocupado.set(chaveAlvo, l.id);
  corrigidas++;
  if (!filial) semDono++;
}

console.log(`destinatario corrigido pelo XML: ${corrigidas}`);
console.log(`copias do fluxo autXML removidas: ${removidas}`);
if (semDono) console.log(`destinatario fora do grupo (sem filial): ${semDono}`);
process.exit(0);
