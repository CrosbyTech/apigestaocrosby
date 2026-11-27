// Regras puras (sem banco) das SAÍDAS DO BANCO SEM BAIXA, mostradas na aba Incluídos da
// Liberação de Pagamento do HeadCoach (Yago, 27/11/2026): para cada saída do extrato que não
// tem baixa nem inclusão, quais duplicatas EM ABERTO do contas a pagar podem ser o pagamento.
//
// A ordem das candidatas (a primeira é a sugerida):
//   1) mesmo fornecedor (CPF/CNPJ igual, ou o nome batendo) e valor igual ao que falta;
//   2) mesmo fornecedor e a saída um pouco MAIOR (paga com juros e multa, até 10%);
//   3) mesmo fornecedor e a duplicata é PREVISÃO (o valor ainda é marcação: vale o da saída);
//   4) mesmo fornecedor e a saída MENOR que o que falta (pagamento parcial);
//   5) outro nome, mas valor igual centavo a centavo (pista: sócio, pessoa física do MEI…).
// Valor diferente para outro nome nunca é sugerido — mas o usuário pode buscar qualquer
// duplicata em aberto e casar por conta própria.

export const ACRESCIMO_MAX = 0.1;
export const NOME_MIN = 0.6;
export const DIAS_DA_PREVISAO = 15; // a previsão é sugerida para saída até 15 dias antes ou depois do vencimento dela

const dig = (v) => String(v ?? '').replace(/\D+/g, '');
const centavos = (v) => Math.round(Math.abs(Number(v) || 0) * 100);

/** Quanto falta pagar da duplicata, em centavos (o que já foi abatido sai). */
export function faltaEmCentavos(t) {
  const abatido = Math.max(0, centavos(t?.valor_pago) - centavos(t?.juros) - centavos(t?.multa) + centavos(t?.desconto));
  return Math.max(0, centavos(t?.valor) - abatido);
}

/** Como a saída se compara com a duplicata: 'igual' | 'acrescimo' | 'previsao' | 'parcial' | null (não combina). */
export function tipoDoValor(saidaValor, t) {
  const S = centavos(saidaValor);
  const F = faltaEmCentavos(t);
  if (!(S > 0) || !(F > 0)) return null;
  if (S === F) return 'igual';
  if (t?.previsao === 'previsao') {
    // previsão de R$ 0,01 é só a marcação do vencimento: qualquer valor serve. Previsão com valor de
    // verdade (aluguel, internet copiados do mês anterior) só é sugerida se a saída ficar perto dele.
    if (F <= 1) return 'previsao';
    return Math.abs(S - F) <= Math.floor(F * ACRESCIMO_MAX) ? 'previsao' : null;
  }
  if (S > F) return S <= Math.floor(F * (1 + ACRESCIMO_MAX)) ? 'acrescimo' : null;
  return 'parcial';
}

const ORDEM = { igual: 0, acrescimo: 1, previsao: 2, parcial: 3 };

/**
 * Duplicatas em aberto que podem ser o pagamento desta saída, da mais provável para a menos.
 * @param saida   { valor, contraparte, contraparteDoc, memo }
 * @param titulos [{ id, fornecedor_nome, fornecedor_cpf_cnpj, valor, valor_pago, juros, multa, desconto, previsao, vencimento }] em aberto
 * @param pontuar (nomeFornecedor, textoDoExtrato) → 0..1
 * @returns [{ titulo, tipo, pontos, acrescimo, falta }]
 */
export function candidatasDaSaida(saida, titulos, pontuar) {
  const docSaida = dig(saida?.contraparteDoc);
  const textos = [saida?.contraparte, saida?.memo].filter((x) => String(x || '').trim());
  const out = [];
  for (const t of titulos || []) {
    const tipo = tipoDoValor(saida?.valor, t);
    if (!tipo) continue;
    const doc = dig(t.fornecedor_cpf_cnpj);
    const pontos = doc.length >= 11 && doc === docSaida ? 2 : Math.max(0, ...textos.map((x) => Number(pontuar(t.fornecedor_nome || '', x)) || 0));
    const mesmoFornecedor = pontos >= NOME_MIN;
    if (!mesmoFornecedor && tipo !== 'igual') continue; // outro nome só entra com valor igual
    // previsão só é sugerida para saída perto do vencimento dela (a de dezembro não é o pagamento de novembro)
    if (tipo === 'previsao' && saida?.data && t.vencimento && Math.abs((new Date(`${String(saida.data).slice(0, 10)}T12:00:00Z`) - new Date(`${String(t.vencimento).slice(0, 10)}T12:00:00Z`)) / 86400000) > DIAS_DA_PREVISAO) continue;
    const falta = faltaEmCentavos(t) / 100;
    out.push({ titulo: t, tipo, pontos, mesmoFornecedor, falta, acrescimo: tipo === 'acrescimo' ? (centavos(saida.valor) - faltaEmCentavos(t)) / 100 : 0 });
  }
  return out.sort((a, b) => Number(b.mesmoFornecedor) - Number(a.mesmoFornecedor) || ORDEM[a.tipo] - ORDEM[b.tipo] || b.pontos - a.pontos || String(a.titulo.vencimento || '').localeCompare(String(b.titulo.vencimento || '')) || a.titulo.id - b.titulo.id);
}

/**
 * O que acontece ao casar a saída com a duplicata escolhida (o usuário pode escolher qualquer
 * duplicata em aberto, não só as sugeridas).
 * @returns {{ tipo: 'igual'|'acrescimo'|'previsao'|'parcial', pago, juros, resta, trocaValor }} ou { erro }
 */
export function planoDeCasamento(saidaValor, t) {
  const S = centavos(saidaValor);
  if (!(S > 0)) return { erro: 'a saída não tem valor' };
  if (!t || t.situacao !== 'aberto') return { erro: t ? `a duplicata já está ${t.situacao === 'pago' ? 'paga' : t.situacao === 'cancelado' ? 'cancelada' : t.situacao}` : 'duplicata não encontrada' };
  const F = faltaEmCentavos(t);
  if (!(F > 0)) return { erro: 'a duplicata não tem valor em aberto' };
  // previsão que ainda não teve pagamento: o valor da duplicata passa a ser o da saída
  if (t.previsao === 'previsao' && !(centavos(t.valor_pago) > 0) && S !== F) return { tipo: 'previsao', pago: S / 100, juros: 0, resta: 0, trocaValor: S / 100 };
  if (S === F) return { tipo: 'igual', pago: S / 100, juros: 0, resta: 0, trocaValor: null };
  if (S > F) return { tipo: 'acrescimo', pago: S / 100, juros: (S - F) / 100, resta: 0, trocaValor: null };
  return { tipo: 'parcial', pago: S / 100, juros: 0, resta: (F - S) / 100, trocaValor: null };
}
