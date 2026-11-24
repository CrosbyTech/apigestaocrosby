// Regras puras (sem banco nem rede) da TRANSFERÊNCIA ENTRE CONTAS da Stone.
// Pedido do Yago em 24/11/2026: escolher a conta de origem e a de destino, clicar em
// TRANSFERIR, o bot inclui o Pix (para a chave aleatória da conta de destino) e o
// Fábio aprova no app. Dá para mandar o saldo de várias contas para uma só.
//
// Travas que moram aqui:
//   • o destino é SEMPRE uma conta do grupo já cadastrada, com a chave guardada;
//   • origem e destino não podem ser a mesma conta;
//   • valor em centavos inteiros, maior que zero — ou "todo o saldo".

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Chave Pix aleatória (UUID). Devolve em minúsculas ou null se não tiver esse formato. */
export function chaveAleatoria(valor) {
  const bruto = String(valor ?? '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bruto) ? bruto : null;
}

/** A chave aparece na tela só pelo começo e pelo fim. */
export const chaveMascarada = (chave) => (chave ? `${String(chave).slice(0, 8)}…${String(chave).slice(-4)}` : null);

/** "0549": os 4 últimos dígitos do CNPJ, como a Liberação chama a conta Stone. */
export const finalDoCnpj = (cnpj) => {
  const d = soDigitos(cnpj);
  return d.length >= 4 ? d.slice(-4) : null;
};

export const emCentavos = (valor) => Math.round((Number(valor) + Number.EPSILON) * 100);

/**
 * Por que uma transferência não pode ser pedida (null = pode).
 * origem/destino: linhas de stone_contas (com saldoCentavos na origem quando conhecido).
 */
export function motivoDeNaoTransferir({ origem, destino, tudo = false, valorCentavos = null } = {}) {
  if (!origem) return 'conta de origem não encontrada';
  if (!destino) return 'conta de destino não encontrada';
  if (origem.stone_account_id === destino.stone_account_id) return 'a origem e o destino são a mesma conta';
  if (origem.ativa === false) return `a conta ${origem.conta_final} está desativada`;
  if (destino.ativa === false) return `a conta ${destino.conta_final} está desativada`;
  if (!chaveAleatoria(destino.chave_pix_aleatoria)) return `a conta de destino ${destino.conta_final} está sem a chave Pix aleatória`;
  if (soDigitos(destino.titular_cnpj).length !== 14) return `a conta de destino ${destino.conta_final} está sem o CNPJ`;
  if (tudo) {
    if (origem.saldoCentavos != null && !(origem.saldoCentavos > 0)) return `a conta ${origem.conta_final} está sem saldo`;
    return null;
  }
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) return 'informe o valor da transferência';
  if (origem.saldoCentavos != null && valorCentavos > origem.saldoCentavos) return `a conta ${origem.conta_final} só tem ${fmt(origem.saldoCentavos / 100)}`;
  return null;
}

/**
 * Transferência já incluída e ainda não aprovada pelo Fábio: o dinheiro continua
 * aparecendo no saldo da conta. Pedir "todo o saldo" de novo (ou um valor que não
 * cabe no que sobra) criaria um segundo Pix do mesmo dinheiro — não deixa.
 * @returns motivo (string) ou null quando pode
 */
export function motivoPorPendente({ tudo = false, valorCentavos = null, saldoCentavos = null, pendenteCentavos = 0 } = {}) {
  if (!(pendenteCentavos > 0)) return null;
  const aguardando = `já tem ${fmt(pendenteCentavos / 100)} aguardando a aprovação do Fábio (esse dinheiro ainda aparece no saldo)`;
  if (tudo) return aguardando;
  if (saldoCentavos != null && Number(valorCentavos) > saldoCentavos - pendenteCentavos) return `${aguardando}; sobram ${fmt(Math.max(0, saldoCentavos - pendenteCentavos) / 100)} livres`;
  return null;
}

/** Descrição que vai no Pix (a Stone limita o tamanho). */
export const descricaoDaTransferencia = (origemFinal, destinoFinal) => `Entre contas ${origemFinal} > ${destinoFinal}`.slice(0, 60);

/** Aviso para o grupo: o que o Fábio tem para aprovar, conta a conta. */
export function textoAvisoTransferencias(itens, { mencionar, assinatura = '— Veveto' } = {}) {
  const marca = mencionar ? `@${mencionar}` : 'Fábio';
  const contas = [...new Set(itens.map((i) => i.origem_final))].sort();
  const linhas = [`${marca}, tem *transferência entre contas* para aprovar na Stone.`, '', '*Contas para aprovar:*', ...contas, '', '*Resumo:*'];
  for (const i of [...itens].sort((a, b) => String(a.origem_final).localeCompare(String(b.origem_final)))) {
    linhas.push(`${i.origem_final} → ${i.destino_final} — ${fmt((i.valor_incluido_centavos ?? i.valor_centavos ?? 0) / 100)}`);
  }
  const total = itens.reduce((s, i) => s + Number(i.valor_incluido_centavos ?? i.valor_centavos ?? 0), 0) / 100;
  linhas.push('', `Total: *${fmt(total)}*`, '', assinatura);
  return linhas.join('\n');
}

/** Rótulo de cada situação, para a tela. */
export const SITUACOES = {
  fila: 'Na fila do bot',
  processando: 'O bot está incluindo',
  incluido: 'Incluída — aguardando o Fábio aprovar',
  efetivada: 'Feita (apareceu no extrato)',
  erro: 'Não incluída',
  bloqueado: 'Bloqueada pela Stone',
  verificar: 'Conferir na Stone antes de repetir',
  cancelada: 'Cancelada',
};
