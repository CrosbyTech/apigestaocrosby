// ============================================================================
// PRONTO PRA FATURAR (Yago, 26/11/2026)
//
// Regra: o pedido do site só entra no Faturamento do HeadCoach quando o
// vendedor confirma a separação no Dryland (botão "Pronto pra faturar" da tela
// /separar). Antes disso o vendedor ainda troca peça, e faturar cedo dá nota
// errada.
//
// O que o Dryland mostra (só leitura):
//  • lv_sep_aguardando — os pedidos pagos que AINDA ESPERAM a confirmação
//    (ref, card_id, canal, pecas, separadas, nao_achadas…). Pedido nessa lista
//    NÃO pode ser faturado.
//  • o card da fila — quando o vendedor confirma, o card ganha no log
//    "separação confirmada (botão Pronto pra faturar)…" com quem e quando; se o
//    Dryland passar a gravar dados.pronto_faturar_em / _por, vale esse campo.
//
// Aqui ficam só as contas (sem banco, sem rede); quem lê o Dryland e grava é
// services/pedidosVendaDryland.js.
// ============================================================================

const texto = (v) => (v == null || v === '' ? null : String(v).trim() || null);
export const refDoPedido = (v) => (texto(v) ? String(v).trim().toUpperCase() : null);

const CONFIRMOU = /separa[çc][ãa]o confirmada/i;
const VOLTOU_A_ESPERAR = /aguardando a separa[çc][ãa]o confirmar/i;

/**
 * Quem marcou "Pronto pra faturar" e quando, pelo card da fila do Dryland.
 * Devolve { em, por } ou null (nunca confirmado, ou voltou a esperar depois).
 */
const dataIso = (v) => {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// último evento do log do card que fala da confirmação da separação
function ultimoEventoDoLog(card) {
  return (
    (Array.isArray(card?.log) ? card.log : [])
      .filter((l) => l && dataIso(l.em) && (CONFIRMOU.test(l.obs || '') || VOLTOU_A_ESPERAR.test(l.obs || '')))
      .sort((a, b) => Date.parse(b.em) - Date.parse(a.em))[0] || null
  );
}

export function prontoDoCard(card) {
  const d = card?.dados || {};
  if (dataIso(d.pronto_faturar_em)) return { em: dataIso(d.pronto_faturar_em), por: texto(d.pronto_faturar_por) };
  const ultimo = ultimoEventoDoLog(card);
  if (!ultimo || !CONFIRMOU.test(ultimo.obs || '')) return null;
  return { em: dataIso(ultimo.em), por: texto(ultimo.por) };
}

/**
 * O card VOLTOU a esperar a confirmação (o último evento do log diz isso)?
 * Diferente de "não achei a confirmação": o Dryland só devolve os últimos
 * eventos do log, então a confirmação antiga some de lá sem o pedido ter voltado.
 */
export function cardVoltouAEsperar(card) {
  if (dataIso(card?.dados?.pronto_faturar_em)) return false;
  const ultimo = ultimoEventoDoLog(card);
  return !!ultimo && !CONFIRMOU.test(ultimo.obs || '');
}

/** Lista do lv_sep_aguardando → Map(REF → linha) e Map(card_id → linha). */
export function mapaAguardando(lista) {
  const porRef = new Map();
  const porCard = new Map();
  for (const a of Array.isArray(lista) ? lista : []) {
    const ref = refDoPedido(a?.ref);
    if (!ref) continue;
    const linha = {
      ref,
      cardId: texto(a.card_id),
      canal: texto(a.canal),
      cliente: texto(a.cliente),
      pecas: Number(a.pecas) || 0,
      separadas: Number(a.separadas) || 0,
      naoAchadas: Number(a.nao_achadas) || 0,
      criadoEm: a.criado_em || null,
    };
    porRef.set(ref, linha);
    if (linha.cardId) porCard.set(linha.cardId, linha);
  }
  return { porRef, porCard };
}

/** A linha do pedido na lista de espera (pela chave do card ou pela ref), ou null. */
export function acharAguardando(mapa, { chave = null, ref = null } = {}) {
  if (!mapa) return null;
  const r = refDoPedido(ref) || (String(chave || '').startsWith('SEP:') ? refDoPedido(String(chave).slice(4)) : null);
  return (r && mapa.porRef.get(r)) || (chave && mapa.porCard.get(String(chave))) || null;
}

/** Texto do bloqueio que a tela mostra. */
export function textoAguardando(a) {
  const quanto = a?.pecas ? ` (${a.separadas || 0} de ${a.pecas} peças separadas${a.naoAchadas ? `, ${a.naoAchadas} não achada(s)` : ''})` : '';
  return `O vendedor ainda não marcou PRONTO PRA FATURAR no Dryland para o pedido ${a?.ref || ''}${quanto}. O pedido entra no Faturamento quando ele confirmar a separação.`.replace(/\s+/g, ' ');
}

/**
 * O que mudou na lista de espera desde a última cópia.
 * antes = refs marcadas no HeadCoach; agora = refs que o Dryland devolveu.
 */
export function mudancasAguardando(antes, agora) {
  const a = new Set([...(antes || [])].map(refDoPedido).filter(Boolean));
  const b = new Set([...(agora || [])].map(refDoPedido).filter(Boolean));
  return { entraram: [...b].filter((r) => !a.has(r)), sairam: [...a].filter((r) => !b.has(r)) };
}
