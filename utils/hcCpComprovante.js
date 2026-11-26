// Regras puras (sem rede): comprovante de pagamento da Solicitação Crosby paga pelo
// HEADCOACH (Contas a Pagar / Liberação de Pagamento) — Yago, 26/11/2026.

/**
 * Duplicatas do Contas a Pagar HeadCoach citadas numa conciliação do extrato:
 *   • origem HC_CP (a saída conciliada direto com a duplicata);
 *   • itens HC_CP de uma conciliação com várias duplicatas;
 *   • baixa automática da Liberação de Pagamento (origem MANUAL com
 *     referencia.destino = 'contas-pagar-headcoach' e a lista de liberações).
 * @returns {number[]} ids das duplicatas (hc_cp_titulos)
 */
export function titulosHcDaConciliacao(conc) {
  const ref = conc?.referencia && typeof conc.referencia === 'object' ? conc.referencia : {};
  const ids = new Set();
  if (conc?.origem === 'HC_CP' && ref.id != null) ids.add(Number(ref.id));
  for (const it of Array.isArray(ref.itens) ? ref.itens : []) if (it?.origem === 'HC_CP' && it.id != null) ids.add(Number(it.id));
  if (ref.destino === 'contas-pagar-headcoach') for (const l of Array.isArray(ref.liberacoes) ? ref.liberacoes : []) if (l?.tituloId != null) ids.add(Number(l.tituloId));
  return [...ids].filter((n) => Number.isInteger(n) && n > 0);
}

/** O arquivo é um recibo de pagamento posto pelo sistema (PDF da Stone), e não o anexo que veio no pedido? */
export const ehReciboDaStone = (url) => /\/stone-\d{4}-\d{2}-\d{2}-\d+\.pdf(\?|$)/i.test(String(url || ''));

/**
 * O que a tela mostra de anexos de pagamento da solicitação.
 * @returns {{ pagamento: string|null, pedido: string|null }}
 */
export function comprovantesDaSolicitacao(sol) {
  const antigo = sol?.comprovante_url || null;
  const pagamento = sol?.comprovante_pagamento_url || (ehReciboDaStone(antigo) ? antigo : null);
  const pedido = antigo && antigo !== pagamento && !ehReciboDaStone(antigo) ? antigo : null;
  return { pagamento, pedido };
}
