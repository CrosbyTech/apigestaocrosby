// Ajusta as notas ja gravadas para o novo modelo, em que o destinatario e a
// FILIAL (CNPJ de 14 digitos) e nao a matriz do certificado.
// As linhas vindas do CSV do TOTVS ja tinham o codigo da empresa correto —
// aqui so corrigimos o CNPJ e preenchemos o nome da filial.
import supabase from '../config/supabase.js';
import { FILIAIS, filialPorCodigo } from '../config/sefazFiliais.js';

const paginar = async (montar) => {
  let todas = [];
  for (let off = 0; off < 100000; off += 1000) {
    const { data, error } = await montar().range(off, off + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    todas = todas.concat(data);
    if (data.length < 1000) break;
  }
  return todas;
};

const linhas = await paginar(() =>
  supabase
    .from('sefaz_dfe_notas')
    .select('id, chave_acesso, cnpj_destinatario, empresa_codigo, schema_origem')
    .order('id'),
);
console.log(`${linhas.length} linhas na tabela`);

// Indice do que ja existe, para nao criar conflito de (cnpj_destinatario, chave)
const existentes = new Set(
  linhas.map((l) => `${l.cnpj_destinatario}|${l.chave_acesso}`),
);

let corrigidas = 0, nomeados = 0, conflitos = 0, semFilial = 0;

for (const l of linhas) {
  const filial = filialPorCodigo(l.empresa_codigo);
  if (!filial) { semFilial++; continue; }

  const precisaCnpj = l.cnpj_destinatario !== filial.cnpj;
  const patch = { empresa_nome: filial.nome };

  if (precisaCnpj) {
    const alvo = `${filial.cnpj}|${l.chave_acesso}`;
    if (existentes.has(alvo)) { conflitos++; continue; }
    patch.cnpj_destinatario = filial.cnpj;
    existentes.delete(`${l.cnpj_destinatario}|${l.chave_acesso}`);
    existentes.add(alvo);
  }

  const { error } = await supabase
    .from('sefaz_dfe_notas')
    .update(patch)
    .eq('id', l.id);
  if (error) { console.error(`  id ${l.id}: ${error.message}`); continue; }

  if (precisaCnpj) corrigidas++;
  nomeados++;
}

console.log(`CNPJ do destinatario corrigido para a filial: ${corrigidas}`);
console.log(`nome da filial preenchido: ${nomeados}`);
if (conflitos) console.log(`conflitos (ja existia a mesma chave na filial): ${conflitos}`);
if (semFilial) console.log(`sem filial mapeada (mantidas como estavam): ${semFilial}`);

const resumo = {};
for (const f of FILIAIS) {
  const { count } = await supabase
    .from('sefaz_dfe_notas')
    .select('*', { count: 'exact', head: true })
    .eq('empresa_codigo', f.codigo);
  if (count) resumo[`${f.codigo} - ${f.nome}`] = count;
}
console.log('\nNotas por filial:');
for (const [k, v] of Object.entries(resumo)) console.log(`  ${k.padEnd(36)} ${v}`);
process.exit(0);
