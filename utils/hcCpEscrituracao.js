// Regras puras (sem rede) da marca de ESCRITURAÇÃO da duplicata no
// HEADCOACH › CONTAS A PAGAR (Yago, 25/11/2026).
//
// A solicitação com nota fiscal vai para o contas a pagar mesmo antes de a nota
// ser escriturada; a duplicata nasce marcada e o financeiro troca o status na tela.

export const ESCRITURACOES = { pendente: 'Não escriturada', escriturada: 'Escriturada' };

/** Marca com que nasce a duplicata de uma solicitação (null = solicitação sem nota fiscal). */
export const escrituracaoDaSolicitacao = (sol) => (sol?.tem_nota_fiscal === true ? (sol.nf_escriturado_em ? 'escriturada' : 'pendente') : null);

/**
 * O que a tela pediu: 'pendente', 'escriturada' ou null (tirar a marca).
 * @throws Error quando não é nenhum dos três
 */
export function escrituracaoPedida(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'nenhuma' || s === 'sem') return null;
  if (ESCRITURACOES[s]) return s;
  throw new Error('Status de escrituração inválido: use "pendente", "escriturada" ou deixe em branco para tirar a marca');
}

/**
 * Das duplicatas escolhidas, quais mudam e quais ficam de fora.
 * @param titulos [{ id, empresa, situacao, escrituracao, fornecedor_nome, duplicata, parcela }]
 * @param permitidas Set com as empresas do usuário
 */
export function separarParaEscrituracao(titulos, permitidas, novo) {
  const mudam = [];
  const ignoradas = [];
  for (const t of titulos || []) {
    const rotulo = `${String(t.fornecedor_nome || '').slice(0, 40)} ${t.duplicata}/${t.parcela}`.trim();
    if (!permitidas.has(Number(t.empresa))) ignoradas.push({ id: t.id, rotulo, motivo: `você não tem acesso à empresa ${t.empresa}` });
    else if (t.situacao === 'cancelado') ignoradas.push({ id: t.id, rotulo, motivo: 'a duplicata está cancelada' });
    else if ((t.escrituracao || null) === novo) ignoradas.push({ id: t.id, rotulo, motivo: novo ? `já está como ${ESCRITURACOES[novo].toLowerCase()}` : 'já está sem marca de escrituração' });
    else mudam.push(t);
  }
  return { mudam, ignoradas };
}
