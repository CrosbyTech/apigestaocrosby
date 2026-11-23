// Regras puras (sem rede) da importação dos títulos PAGOS do contas a pagar do
// TOTVS para o HEADCOACH › CONTAS A PAGAR, com a marca "TOTVS" (origem = 'totvs').
//
// "Pago" é o mesmo da tela Contas a Pagar › Consulta: baixado no TOTVS, conciliado
// no extrato (PAGO VIA CONCILIAÇÃO) ou PAGO na Liberação de Pagamento — e só entra
// o que tem data de liquidação e valor pago maior que zero.

const dia = (v) => (v ? String(v).slice(0, 10) : null);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// ─── o que a Consulta esconde: faturas de banco (mesma regra da tela) ────────
export const OCULTAR_BANCO_EMISSAO_ANTES = '2026-10-20';
const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const BANCO_TERMOS = ['emprestimo', 'financiamento', 'cartao de credito', 'cartao credito', 'juros financeir', 'consorcio', 'capital de giro', 'banco', 'itau', 'santander', 'bradesco', 'sicredi', 'banco do nordeste', 'caixa economica'];
const BANCO_PALAVRAS = /\b(bb|bnb|fgi)\b/;
const EMPRESTIMO_TERMOS = ['emprestimo', 'financiamento', 'consorcio'];
const textoDoItem = (item) => normalizar(`${item?.nm_fornecedor || ''} ${item?.ds_despesaitem || ''} ${item?.nm_razaosocial_fornecedor || ''}`);

export const ehEmprestimo = (item) => EMPRESTIMO_TERMOS.some((t) => textoDoItem(item).includes(t));
export const ehFaturaDeBanco = (item) => {
  const texto = textoDoItem(item);
  if (!texto.trim()) return false;
  return BANCO_PALAVRAS.test(texto) || BANCO_TERMOS.some((t) => texto.includes(t));
};
/** A Consulta não mostra: empréstimo/financiamento/consórcio (sempre) e fatura de banco emitida antes de 20/10/2026. */
export function ocultoNaConsulta(item) {
  if (ehEmprestimo(item)) return true;
  if (!ehFaturaDeBanco(item)) return false;
  const emissao = dia(item?.dt_emissao);
  return Boolean(emissao) && emissao < OCULTAR_BANCO_EMISSAO_ANTES;
}

// ─── de onde vem o pagamento ─────────────────────────────────────────────────
const igual = (a, b) => (a == null || b == null || a === '' || b === '' ? null : Number(a) === Number(b));

/** Linhas de contas_pagar_pagos_conciliacao que são deste título (parcela diferente nunca casa). */
export function conciliacoesDoTitulo(item, linhas) {
  return (linhas || []).filter((p) => {
    if (String(p.nr_duplicata) !== String(item.nr_duplicata)) return false;
    if (igual(item.cd_empresa, p.cd_empresa) === false) return false;
    const parc = igual(item.nr_parcela, p.nr_parcela);
    const forn = igual(item.cd_fornecedor, p.cd_fornecedor);
    if (parc === false || forn === false) return false;
    return parc === true || forn === true;
  });
}

/** Linha PAGO da Liberação de Pagamento que é deste título. */
export function liberacaoDoTitulo(item, linhas) {
  return (
    (linhas || []).find((p) => {
      if (String(p.nr_duplicata) !== String(item.nr_duplicata)) return false;
      if (igual(item.cd_empresa, p.cd_empresa) === false) return false;
      const forn = igual(item.cd_fornecedor, p.cd_fornecedor);
      const parc = igual(item.nr_parcela, p.nr_parcela);
      if (forn === false || parc === false) return false;
      if (forn === true || parc === true) return true;
      return Math.abs(Number(item.vl_duplicata || 0) - Number(p.vl_duplicata || 0)) < 0.005;
    }) || null
  );
}

/**
 * Como o título foi pago, na ordem da tela: baixa do TOTVS → conciliação → Liberação.
 * @returns {{ via: 'TOTVS'|'CONCILIACAO'|'LIBERACAO', data, valorPago, conta }|null} null = em aberto
 */
export function pagamentoDoTitulo(item, { conciliacoes = [], liberacoes = [] } = {}) {
  if (dia(item.dt_liq)) return { via: 'TOTVS', data: dia(item.dt_liq), valorPago: round2(item.vl_pago || 0), conta: null };
  const conc = conciliacoesDoTitulo(item, conciliacoes);
  if (conc.length) {
    const partes = conc
      .map((p) => ({ data: dia(p.dt_pagamento), valor: round2(p.vl_pago || 0), conta: p.banco || null }))
      .filter((p) => p.data && p.valor > 0)
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    return {
      via: 'CONCILIACAO',
      data: conc.map((p) => dia(p.dt_pagamento)).sort().pop(),
      valorPago: round2(conc.reduce((s, p) => s + Number(p.vl_pago || 0), 0)),
      conta: (partes.at(-1) || conc[0]).conta || conc[0].banco || null,
      ...(partes.length > 1 ? { partes } : {}), // saiu em mais de um pagamento: uma baixa por pagamento
    };
  }
  const lib = liberacaoDoTitulo(item, liberacoes);
  if (lib) {
    // a Liberação não tem "valor pago" próprio: vale o valor real informado ou o da duplicata
    const valor = num(lib.vl_real) > 0 ? num(lib.vl_real) : Number(lib.vl_duplicata || item.vl_duplicata || 0);
    return { via: 'LIBERACAO', data: dia(lib.dt_pagamento) || dia(lib.pago_em), valorPago: round2(valor), conta: lib.banco_pagamento || null, forma: lib.forma_pagamento || null };
  }
  return null;
}

/** Entra na importação: pago, com data de liquidação e valor pago maior que zero. */
export const pagoParaImportar = (pg) => Boolean(pg && pg.data && pg.valorPago > 0);

// ─── do título do TOTVS para a linha do HeadCoach ────────────────────────────
export const chaveTotvs = (item) => `${item.cd_empresa}|${item.cd_fornecedor}|${item.nr_duplicata}|${item.nr_parcela ?? ''}`;
const FORMAS = { PIX: 'pix', BOLETO: 'boleto', TRANSFERENCIA: 'transferencia', TED: 'transferencia', DINHEIRO: 'dinheiro', CARTAO: 'cartao', 'DEBITO AUTOMATICO': 'debito_automatico' };
const VIA = { TOTVS: 'baixa no TOTVS', CONCILIACAO: 'conciliação do extrato', LIBERACAO: 'Liberação de Pagamento' };
export const rotuloDaVia = (via) => VIA[via] || via;

/**
 * Rateio do HeadCoach a partir das despesas do título no TOTVS. A última linha
 * leva a diferença de centavos; sem percentual informado, divide pelo valor.
 * @param despesas [{ expenseCode, expenseName, costCenterCode, proratedPercentage, proratedValue }]
 * @param nomes { despesa: Map(code → nome), centro: Map(code → nome) }
 */
export function rateioDoTotvs(despesas, valor, nomes = {}) {
  const linhas = (despesas || []).filter((d) => Number(d?.expenseCode) > 0);
  if (!linhas.length) return [];
  const somaPerc = linhas.reduce((s, d) => s + Number(d.proratedPercentage || 0), 0);
  const somaValor = linhas.reduce((s, d) => s + Number(d.proratedValue || 0), 0);
  let resto = round2(valor);
  return linhas.map((d, i) => {
    const perc = linhas.length === 1 ? 100 : somaPerc > 99.5 && somaPerc < 100.5 ? Number(d.proratedPercentage) : somaValor > 0 ? (Number(d.proratedValue || 0) / somaValor) * 100 : 100 / linhas.length;
    const v = i === linhas.length - 1 ? resto : round2((valor * perc) / 100);
    resto = round2(resto - v);
    const despesa = Number(d.expenseCode);
    const centro = Number(d.costCenterCode) > 0 ? Number(d.costCenterCode) : null;
    return {
      despesa_code: despesa,
      despesa_nome: nomes.despesa?.get(despesa) || d.expenseName || null,
      centro_custo_code: centro,
      centro_custo_nome: centro ? nomes.centro?.get(centro) || d.costCenterName || null : null,
      percentual: Math.round(perc * 10000) / 10000,
      valor: v,
    };
  });
}

/** Quanto do valor do título o pagamento NÃO cobriu (juros fora, desconto dentro). */
export const faltaDoTotvs = (item, pg) => Math.max(0, round2(Number(item.vl_duplicata || 0) - (Number(pg.valorPago || 0) - Number(item.vl_juros || 0) + Number(item.vl_desconto || 0))));

/**
 * Linhas de hc_cp_baixas do título importado: uma por pagamento (a conciliação pode
 * ter mais de um), cada uma com o que estava em aberto antes dela. Juros e desconto
 * do título ficam na última.
 */
export function baixasDoTituloTotvs(linha, pg) {
  const partes = pg.partes?.length ? pg.partes : [{ data: pg.data, valor: pg.valorPago, conta: pg.conta }];
  let emAberto = round2(linha.valor);
  return partes.map((p, i) => {
    const ultima = i === partes.length - 1;
    const juros = ultima ? round2(linha.juros || 0) : 0;
    const desconto = ultima ? round2(linha.desconto || 0) : 0;
    const antes = emAberto;
    emAberto = Math.max(0, round2(emAberto - (p.valor - juros + desconto)));
    return { data_pagamento: p.data, valor_titulo: antes, juros, multa: 0, desconto, valor_pago: round2(p.valor), forma_pagamento: linha.forma_pagamento || null, conta: p.conta ? String(p.conta).slice(0, 120) : null, observacao: `Importado do TOTVS (${linha.baixado_por})`, por: 'Importação TOTVS' };
  });
}

/**
 * Linha de hc_cp_titulos para um título pago do TOTVS (sem o número da duplicata
 * do HeadCoach e sem o lote, que dependem do que já existe no banco).
 * @returns {object|null} null quando o título não tem como entrar (sem valor ou sem vencimento)
 */
export function linhaDoTituloTotvs(item, pg, nomes = {}, { parcial = false } = {}) {
  const valor = round2(item.vl_duplicata || 0);
  // pago parcial: saiu menos que o valor e o resto ainda vai ser pago → entra EM ABERTO pelo que falta
  const emParte = parcial && faltaDoTotvs(item, pg) > 0.005;
  const vencimento = dia(item.dt_vencimento);
  if (!(valor > 0) || !vencimento || !(Number(item.cd_empresa) > 0) || !(Number(item.cd_fornecedor) > 0)) return null;
  const emissao = dia(item.dt_emissao) || vencimento;
  const rateio = rateioDoTotvs(item.despesas, valor, nomes);
  const principal = rateio.length ? rateio.reduce((a, b) => (b.percentual > a.percentual ? b : a)) : null;
  const portador = Number(item.nr_portador) > 0 ? Number(item.nr_portador) : null;
  return {
    empresa: Number(item.cd_empresa),
    fornecedor_code: Number(item.cd_fornecedor),
    fornecedor_nome: String(item.nm_razaosocial_fornecedor || item.nm_fornecedor || `Fornecedor ${item.cd_fornecedor}`).slice(0, 200),
    fornecedor_cpf_cnpj: String(item.nr_cpfcnpj_fornecedor || '').replace(/\D/g, '') || null,
    documento_fiscal: String(item.nr_duplicata),
    parcela: Number(item.nr_parcela) >= 1 ? Number(item.nr_parcela) : 1,
    tipo_documento: 'duplicata',
    portador_code: portador,
    portador_nome: portador ? nomes.portador?.get(portador) || null : null,
    forma_pagamento: FORMAS[String(pg.forma || '').toUpperCase()] || null,
    despesa_code: principal?.despesa_code ?? null,
    despesa_nome: principal?.despesa_nome ?? null,
    centro_custo_code: principal?.centro_custo_code ?? null,
    centro_custo_nome: principal?.centro_custo_nome ?? null,
    rateio: rateio.length ? rateio : null,
    previsao: item.tp_previsaoreal === 'P' ? 'previsao' : 'real',
    emissao,
    entrada: dia(item.dt_entrada) || emissao,
    vencimento,
    valor,
    situacao: emParte ? 'aberto' : 'pago',
    data_pagamento: pg.data,
    juros: round2(item.vl_juros || 0),
    multa: 0,
    desconto: round2(item.vl_desconto || 0),
    valor_pago: pg.valorPago,
    conta_pagamento: pg.conta ? String(pg.conta).slice(0, 120) : null,
    observacao: `Importado do TOTVS · duplicata ${item.nr_duplicata}${item.nr_parcela ? ` parcela ${item.nr_parcela}` : ''} · ${emParte ? 'pago em parte' : 'pago'} via ${rotuloDaVia(pg.via)}`,
    origem: 'totvs',
    origem_ref: chaveTotvs(item),
    criado_por: 'Importação TOTVS',
    atualizado_por: 'Importação TOTVS',
    baixado_por: rotuloDaVia(pg.via),
  };
}

/**
 * Dá o número da duplicata do HeadCoach a cada linha nova: uma por empresa +
 * fornecedor + duplicata do TOTVS (as parcelas ficam na mesma), continuando da
 * maior que a empresa já tem com o fornecedor. Duplicata do TOTVS que já foi
 * importada antes mantém o número.
 * @param existentes [{ empresa, fornecedor_code, duplicata, parcela, documento_fiscal, origem, situacao }]
 * @returns {{ linhas, conflitos }} conflitos = parcela que já existe naquela duplicata
 */
export function numerarDuplicatas(novas, existentes) {
  const k = (l) => `${l.empresa}|${l.fornecedor_code}`;
  const maior = new Map();
  const jaImportada = new Map(); // empresa|fornecedor|duplicata do TOTVS → número no HeadCoach
  const ocupadas = new Set();
  for (const e of existentes || []) {
    maior.set(k(e), Math.max(maior.get(k(e)) || 0, Number(e.duplicata) || 0));
    if (e.situacao !== 'cancelado') ocupadas.add(`${k(e)}|${e.duplicata}|${e.parcela}`);
    if (e.origem === 'totvs' && e.documento_fiscal) jaImportada.set(`${k(e)}|${e.documento_fiscal}`, Number(e.duplicata));
  }
  const linhas = [];
  const conflitos = [];
  const ordenadas = [...novas].sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : a.parcela - b.parcela));
  for (const l of ordenadas) {
    const grupo = `${k(l)}|${l.documento_fiscal}`;
    if (!jaImportada.has(grupo)) {
      maior.set(k(l), (maior.get(k(l)) || 0) + 1);
      jaImportada.set(grupo, maior.get(k(l)));
    }
    const duplicata = jaImportada.get(grupo);
    const vaga = `${k(l)}|${duplicata}|${l.parcela}`;
    if (ocupadas.has(vaga)) conflitos.push(l);
    else {
      ocupadas.add(vaga);
      linhas.push({ ...l, duplicata });
    }
  }
  return { linhas, conflitos };
}
