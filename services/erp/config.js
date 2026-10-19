// Modo por módulo/empresa (erp_config): 'totvs' | 'dual' | 'headcoach'.
// Linha com empresa NULL é o padrão global; linha por empresa sobrepõe.
import { supabase, agora } from './db.js';

export const MODULOS = ['vendas', 'receber', 'pagar', 'estoque', 'pessoas', 'produtos', 'fiscal'];
export const MODOS = ['totvs', 'dual', 'headcoach'];

let cache = { em: 0, linhas: [] };
const TTL = 60 * 1000;

export async function listarConfig({ forcar = false } = {}) {
  if (!forcar && Date.now() - cache.em < TTL) return cache.linhas;
  const { data, error } = await supabase.from('erp_config').select('*').order('modulo').order('empresa', { nullsFirst: true });
  if (error) throw new Error(`erp_config: ${error.message}`);
  cache = { em: Date.now(), linhas: data || [] };
  return cache.linhas;
}

/** Modo efetivo para (modulo, empresa). Sem linha: 'totvs'. */
export async function getModo(modulo, empresa = null) {
  const linhas = await listarConfig();
  const esp = empresa != null ? linhas.find((l) => l.modulo === modulo && Number(l.empresa) === Number(empresa)) : null;
  if (esp) return esp.modo;
  const glob = linhas.find((l) => l.modulo === modulo && l.empresa == null);
  return glob?.modo || 'totvs';
}

export const gravaNoTotvs = async (modulo, empresa) => ['totvs', 'dual'].includes(await getModo(modulo, empresa));
export const gravaNoHeadcoach = async (modulo, empresa) => ['dual', 'headcoach'].includes(await getModo(modulo, empresa));

export async function salvarConfig({ modulo, empresa = null, modo, observacao = null, atualizadoPor = null }) {
  if (!MODULOS.includes(modulo)) throw new Error(`módulo inválido: ${modulo}`);
  if (!MODOS.includes(modo)) throw new Error(`modo inválido: ${modo}`);
  const emp = empresa == null || empresa === '' ? null : Number(empresa);
  // unique index é por COALESCE(empresa,0) + modulo → procurar antes de inserir
  let q = supabase.from('erp_config').select('id').eq('modulo', modulo);
  q = emp == null ? q.is('empresa', null) : q.eq('empresa', emp);
  const { data: existente } = await q.maybeSingle();
  const row = { modulo, empresa: emp, modo, observacao, atualizado_por: atualizadoPor, atualizado_em: agora() };
  const res = existente
    ? await supabase.from('erp_config').update(row).eq('id', existente.id).select().single()
    : await supabase.from('erp_config').insert(row).select().single();
  if (res.error) throw new Error(`erp_config: ${res.error.message}`);
  cache.em = 0;
  return res.data;
}

export async function removerConfig(id) {
  const { error } = await supabase.from('erp_config').delete().eq('id', id).not('empresa', 'is', null);
  if (error) throw new Error(`erp_config: ${error.message}`);
  cache.em = 0;
}
