// ============================================================================
// EXPEDIÇÃO BREJINHO — peças gravadas NO CARD do Dryland (27/11/2026)
//
// Até aqui as peças da remessa vinham só da transação do TOTVS (campo
// `transacao` do card). Os cards novos do showroom não têm transação: o Dryland
// grava as peças no próprio card, em `raw.itens`, e o HeadCoach lê dali.
//
// Formato combinado com o Dryland (uma linha por produto + cor + tamanho):
//   raw.itens = [{ codigo, qtd, unit, produto, cor, tam, referencia }]
//     codigo     código do produto (o mesmo do cadastro: é o que o portal RFID
//                devolve ao ler a etiqueta) — OBRIGATÓRIO
//     qtd        quantidade de peças, inteiro maior que zero — OBRIGATÓRIO
//     unit       preço unitário da peça no pedido — OBRIGATÓRIO (é o da nota)
//     produto    nome da peça            (só para mostrar)
//     cor, tam   cor e tamanho           (só para mostrar)
//     referencia referência do modelo    (só para mostrar)
// Linha sem código ou sem quantidade fica de fora e é avisada na tela.
//
// Só contas (sem banco, sem rede).
// ============================================================================

const texto = (v) => (v == null || v === '' ? null : String(v).trim() || null);
const numero = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // "1.234,56" ou "67,00" → 1234.56 / 67
  const s = String(v).trim().replace(/[^\d,.-]/g, '');
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
};
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/**
 * Peças do card do Brejinho no formato da tela Faturamento
 * ({ cod, descricao, cor, tam, qtd, preco }). Devolve { itens, ignoradas }.
 */
export function itensDoCardBrejinho(raw) {
  const linhas = Array.isArray(raw?.itens) ? raw.itens : [];
  const itens = [];
  const ignoradas = [];
  const porChave = new Map();
  linhas.forEach((l, i) => {
    const codigo = parseInt(String(l?.codigo ?? l?.cod ?? '').replace(/\D/g, ''), 10) || null;
    const qtd = Math.trunc(numero(l?.qtd ?? l?.quantidade) || 0);
    const unit = numero(l?.unit ?? l?.preco);
    const nome = texto(l?.produto ?? l?.descricao);
    if (!codigo || qtd <= 0 || unit == null || unit < 0) {
      const falta = !codigo ? 'sem código do produto' : qtd <= 0 ? 'sem quantidade' : 'sem preço unitário';
      ignoradas.push({ linha: i + 1, motivo: falta, descricao: [nome, texto(l?.cor), texto(l?.tam ?? l?.tamanho)].filter(Boolean).join(' ') || null });
      return;
    }
    const preco = round2(unit);
    // a mesma peça repetida no card com o mesmo preço vira uma linha só
    const chave = `${codigo}|${preco}`;
    const ja = porChave.get(chave);
    if (ja) {
      ja.qtd += qtd;
      return;
    }
    const item = {
      cod: String(codigo),
      descricao: nome || `Produto ${codigo}`,
      cor: texto(l?.cor),
      tam: texto(l?.tam ?? l?.tamanho),
      referencia: texto(l?.referencia),
      qtd,
      preco,
    };
    porChave.set(chave, item);
    itens.push(item);
  });
  return { itens, ignoradas };
}

/**
 * Vendedor gravado no card (27/11/2026): raw.vendedor_cd = código do vendedor
 * (o mesmo do cadastro de vendedores) e raw.vendedor = nome.
 * Devolve { code, nome } ou null quando o card não traz o código.
 */
export function vendedorDoCardBrejinho(raw) {
  const code = parseInt(String(raw?.vendedor_cd ?? '').replace(/\D/g, ''), 10) || null;
  if (!code) return null;
  return { code, nome: texto(raw?.vendedor) };
}

/** Totais das peças do card (para conferir com qtd_pecas e valor do card). */
export function totaisDosItens(itens) {
  return {
    pecas: (itens || []).reduce((s, i) => s + Number(i.qtd || 0), 0),
    valor: round2((itens || []).reduce((s, i) => s + Number(i.qtd || 0) * Number(i.preco || 0), 0)),
  };
}
