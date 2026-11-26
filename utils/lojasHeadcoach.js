// ============================================================================
// LOJAS QUE VENDEM SÓ PELO HEADCOACH (PDV Crosby) — não lançam mais venda no TOTVS.
// Midway (95) e Cidade Jardim (87) desde 17–18/11/2026; Ayrton Senna (90) e
// Parnamirim (55) desde 25/11/2026 (Yago: "100% no HeadCoach"); Canguaretama (65)
// desde 26/11/2026.
//
// Para estas lojas nada da integração BlueCard passa pelo TOTVS: a venda, os
// títulos e as baixas estão em pdv_vendas / hc_cr_titulos. Quando outra loja
// sair do TOTVS, acrescente o código aqui (ou em LOJAS_SO_HEADCOACH no ambiente,
// ex.: "55,65,87,90,95,2" — a variável, quando definida, substitui a lista).
// ============================================================================
const PADRAO = [55, 65, 87, 90, 95];

export function lojasSoHeadcoach() {
  const env = String(process.env.LOJAS_SO_HEADCOACH || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return env.length ? env : PADRAO;
}

/** A loja (código da empresa) vende só pelo HeadCoach? */
export const ehSoHeadcoach = (code) => lojasSoHeadcoach().includes(Number(code));

/** Todas as lojas da lista vendem só pelo HeadCoach? (lista vazia = não) */
export const todasSoHeadcoach = (codes) => {
  const l = (Array.isArray(codes) ? codes : [codes]).map(Number).filter((n) => n > 0);
  return l.length > 0 && l.every(ehSoHeadcoach);
};

/**
 * Loja de uma compra do BlueCard que é do HeadCoach (sem TOTVS no meio), ou null.
 *  - compra pedida pelo PDV Crosby: o `documento` é a referência "HC<loja>-…" — vale para QUALQUER loja,
 *    porque quem pediu foi o PDV Crosby (o aviso do app pode vir sem o código da loja);
 *  - compra iniciada no app: pela `filial`, se a loja vende só pelo HeadCoach.
 */
export function lojaDaCompraHeadcoach(compra) {
  const m = /^HC(\d+)-/.exec(String(compra?.documento || ''));
  if (m) return Number(m[1]);
  return ehSoHeadcoach(compra?.filial) ? Number(compra.filial) : null;
}
