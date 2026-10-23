// Duplicatas de contas a pagar "abatidas": títulos agrupados que foram baixados
// por desconto/ajuste (liquidação sem dinheiro). No TOTVS elas ficam com data de
// liquidação preenchida e valor pago ZERO. Por decisão do financeiro (10/2026),
// esses títulos nunca devem aparecer em nenhuma tela de contas a pagar.
//
// Aceita tanto o item cru da API TOTVS (DuplicateOutModel: settlementDate /
// paidValue) quanto a linha já mapeada do HeadCoach (dt_liq / vl_pago) e a linha
// do espelho ERP (settlement_date / paid_value).

const temValor = (v) => v !== null && v !== undefined && v !== '';

export function isDuplicataAbatida(item) {
  if (!item) return false;
  const liq = item.settlementDate ?? item.dt_liq ?? item.settlement_date;
  const pago = item.paidValue ?? item.vl_pago ?? item.paid_value;
  return temValor(liq) && Number(pago || 0) === 0;
}

/** Remove as abatidas de uma lista; devolve a lista filtrada e quantas saíram. */
export function removerAbatidas(itens) {
  const lista = Array.isArray(itens) ? itens : [];
  const mantidas = lista.filter((it) => !isDuplicataAbatida(it));
  return { itens: mantidas, removidas: lista.length - mantidas.length };
}

/**
 * Filtro equivalente para consultas no espelho ERP (Supabase/PostgREST):
 * mantém só quem NÃO tem liquidação ou tem valor pago > 0.
 */
export const FILTRO_ABATIDAS_POSTGREST = 'settlement_date.is.null,paid_value.gt.0';
