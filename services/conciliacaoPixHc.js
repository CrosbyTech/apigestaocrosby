// ============================================================
// Vendas em Pix do PDV Crosby (contas a receber do HeadCoach, hc_cr_titulos)
// como candidatas da Conciliação bancária, e a marca de "conciliado" no título.
// Regra e pontuação: utils/conciliacaoPixHc.js.
// ============================================================
import supabase from '../config/supabase.js';
import { candidatoDoTitulo, feitaPeloExtrato, idsHcCrDaConciliacao, marcaDaConciliacao, textoConciliadoPor } from '../utils/conciliacaoPixHc.js';

const COLUNAS = 'id, empresa, fatura, parcela, venda_id, origem, cliente_nome, cliente_cpf_cnpj, vendedor_nome, nf_modelo, nf_numero, emissao, vencimento, valor, situacao, conciliado_em, conciliado_por, criado_em';
const PAGINA = 1000;
const cache = new Map(); // empresas|de|ate → { itens, em }
const VALIDADE_MS = 2 * 60 * 1000;

const addDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const limparCacheHcCr = () => cache.clear();

/**
 * Títulos Pix das empresas emitidos na janela, prontos para pontuar. Ficam de
 * fora os cancelados e os que já foram conciliados na tela do contas a receber
 * (conciliação D+1); os conciliados pelo extrato continuam na lista porque o
 * controle de uso é o da própria Conciliação.
 */
export async function fonteHcCr(empresas, { de, ate }) {
  const codigos = [...new Set((empresas || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!codigos.length) return [];
  const key = `${codigos.join(',')}|${de}|${ate}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.em < VALIDADE_MS) return hit.itens;
  const rows = [];
  for (let i = 0; ; i += PAGINA) {
    const { data, error } = await supabase
      .from('hc_cr_titulos')
      .select(COLUNAS)
      .in('empresa', codigos)
      .eq('forma', 'pix')
      .is('cancelado_em', null)
      .gte('emissao', addDias(de, -2))
      .lte('emissao', addDias(ate, 2))
      .order('id')
      .range(i, i + PAGINA - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGINA) break;
  }
  const itens = rows.filter((t) => !t.conciliado_em || feitaPeloExtrato(t.conciliado_por)).map(candidatoDoTitulo);
  cache.set(key, { itens, em: Date.now() });
  return itens;
}

/**
 * Depois de gravar a conciliação: marca os títulos usados como conciliados e
 * solta os que essa mesma conciliação marcava antes e deixou de usar (linha
 * regravada com outra origem).
 */
export async function marcarTitulosHcCr(conc) {
  if (!conc?.id) return { marcados: 0 };
  const ids = idsHcCrDaConciliacao(conc);
  const marca = marcaDaConciliacao(conc.id);
  const { data: antigos } = await supabase.from('hc_cr_titulos').select('id').like('conciliado_por', `%${marca}`);
  const soltar = (antigos || []).map((t) => t.id).filter((id) => !ids.includes(Number(id)));
  if (soltar.length) await supabase.from('hc_cr_titulos').update({ conciliado_em: null, conciliado_por: null }).in('id', soltar);
  if (!ids.length) return { marcados: 0, soltos: soltar.length };
  const { data, error } = await supabase
    .from('hc_cr_titulos')
    .update({ conciliado_em: new Date().toISOString(), conciliado_por: textoConciliadoPor(conc.usuario, conc.id) })
    .in('id', ids)
    .is('conciliado_em', null)
    .select('id');
  if (error) throw new Error(error.message);
  limparCacheHcCr();
  return { marcados: (data || []).length, soltos: soltar.length };
}

/** Conciliação desfeita: o título volta a "a conciliar". */
export async function desmarcarTitulosHcCr(conciliacaoId) {
  if (!conciliacaoId) return { soltos: 0 };
  const { data, error } = await supabase
    .from('hc_cr_titulos')
    .update({ conciliado_em: null, conciliado_por: null })
    .like('conciliado_por', `%${marcaDaConciliacao(conciliacaoId)}`)
    .select('id');
  if (error) throw new Error(error.message);
  limparCacheHcCr();
  return { soltos: (data || []).length };
}
