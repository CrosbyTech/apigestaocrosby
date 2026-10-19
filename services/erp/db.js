// Helpers de gravação em lote no Supabase para o sync do ERP.
import supabase from '../../config/supabase.js';

export { supabase };

const CHUNK = Math.max(50, parseInt(process.env.ERP_UPSERT_CHUNK || '500', 10));

/** Upsert em lotes. `onConflict` = colunas da chave natural ("code" / "produto_code,empresa"). */
export async function upsertLote(tabela, rows, onConflict, { chunk = CHUNK } = {}) {
  let gravados = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const fatia = rows.slice(i, i + chunk);
    const { error } = await supabase.from(tabela).upsert(fatia, { onConflict, ignoreDuplicates: false });
    if (error) throw new Error(`upsert ${tabela} (${fatia.length} linhas): ${error.message}`);
    gravados += fatia.length;
  }
  return gravados;
}

/** Remove duplicatas por chave (último vence) antes de um upsert — o TOTVS às vezes repete itens entre páginas. */
export function dedupe(rows, chave) {
  const m = new Map();
  for (const r of rows) m.set(chave(r), r);
  return [...m.values()];
}

export async function contar(tabela, filtro = null) {
  let q = supabase.from(tabela).select('*', { count: 'exact', head: true });
  if (filtro) q = filtro(q);
  const { count, error } = await q;
  if (error) throw new Error(`count ${tabela}: ${error.message}`);
  return count ?? 0;
}

export const agora = () => new Date().toISOString();
export const dataOuNull = (v) => (v ? new Date(v).toISOString() : null);
export const diaOuNull = (v) => (v ? String(v).slice(0, 10) : null);
export const digits = (v) => (v == null ? null : String(v).replace(/\D/g, '') || null);
