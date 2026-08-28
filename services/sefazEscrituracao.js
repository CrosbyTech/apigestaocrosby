// Concilia o export de manifestacoes do TOTVS com as notas ja capturadas.
// No TOTVS, a nota escriturada e a que tem fatura vinculada — quem esta em
// manifestacoes sem fatura ainda nao foi escriturada.
import supabase from '../config/supabase.js';
import { parseCsvManifestacoes } from '../utils/manifestacaoCsv.js';

const nfDaChave = (chave) =>
  chave && chave.length === 44 ? parseInt(chave.slice(25, 34), 10) : null;
const serieDaChave = (chave) =>
  chave && chave.length === 44 ? parseInt(chave.slice(22, 25), 10) : null;

async function carregarNotas() {
  let todas = [];
  for (let off = 0; off < 200000; off += 1000) {
    const { data, error } = await supabase
      .from('sefaz_dfe_notas')
      .select('id, empresa_codigo, nsu, chave_acesso, escriturada, nr_fatura')
      .order('id', { ascending: true })
      .range(off, off + 999);
    if (error) throw new Error(`Supabase: ${error.message}`);
    if (!data?.length) break;
    todas = todas.concat(data);
    if (data.length < 1000) break;
  }
  return todas;
}

export async function importarEscrituradas(textoCsv) {
  const { registros, ignoradas } = parseCsvManifestacoes(textoCsv);
  if (registros.length === 0) {
    return { ok: false, erro: 'Nenhuma linha valida no arquivo' };
  }

  const notas = await carregarNotas();

  // Dois indices: NSU e (NF + serie). O NSU e o mais confiavel; o numero da
  // NF cobre as linhas em que o NSU nao veio no export.
  const porNsu = new Map();
  const porNf = new Map();
  for (const n of notas) {
    if (n.nsu != null) porNsu.set(`${n.empresa_codigo}|${n.nsu}`, n);
    const nf = nfDaChave(n.chave_acesso);
    const se = serieDaChave(n.chave_acesso);
    if (nf != null) porNf.set(`${n.empresa_codigo}|${nf}|${se}`, n);
  }

  const aAtualizar = new Map(); // id -> patch (evita gravar a mesma nota 2x)
  let escrituradas = 0;
  let pendentes = 0;
  let naoEncontradas = 0;

  for (const r of registros) {
    const nota =
      (r.nsu != null && porNsu.get(`${r.empresa}|${r.nsu}`)) ||
      (r.nf != null && porNf.get(`${r.empresa}|${r.nf}|${r.serie}`)) ||
      null;

    if (!nota) {
      naoEncontradas++;
      continue;
    }
    if (r.escriturada) escrituradas++;
    else pendentes++;

    aAtualizar.set(nota.id, {
      escriturada: r.escriturada,
      nr_fatura: r.nrFatura,
      dt_fatura: r.dtFatura,
    });
  }

  let gravadas = 0;
  for (const [id, patch] of aAtualizar) {
    const { error } = await supabase
      .from('sefaz_dfe_notas')
      .update(patch)
      .eq('id', id);
    if (error) {
      console.error(`❌ [Escrituracao] id ${id}: ${error.message}`);
      continue;
    }
    gravadas++;
  }

  const resumo = {
    linhasNoArquivo: registros.length,
    linhasIgnoradas: ignoradas.length,
    escrituradas,
    pendentes,
    naoEncontradas,
    notasAtualizadas: gravadas,
  };
  console.log('📘 [Escrituracao]', JSON.stringify(resumo));
  return { ok: true, resumo };
}

export default { importarEscrituradas };
