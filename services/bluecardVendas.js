/**
 * Vendas do cliente no PDV, com as formas de pagamento — para o BlueCard medir
 * a "venda extra" (o que o cliente compra além do limite do cartão e paga em
 * Pix, cartão ou dinheiro).
 *
 * Fonte: POST /fiscal/v2/invoices/search com expand=payments. Cada nota traz
 * os pagamentos com tipo (CreditCard, DebitCard, Pix, Money, Invoice…), valor,
 * parcela, portador e o `documentNumber` = número do TÍTULO que aquele
 * pagamento gerou no contas a receber. O título BlueCard é o pagamento do tipo
 * Invoice (fatura/crediário): o número dele vem no próprio pagamento — não é
 * preciso cruzar com o contas a receber.
 *
 * ── TRÊS COISAS DO TOTVS QUE A ROTA ESCONDE DO PARCEIRO ──
 *  1. A busca só aceita janelas de 6 meses: `desde` antigo vira vários blocos.
 *  2. Exige lista de filiais: usamos as filiais próprias (tipo FILIAL), as
 *     mesmas do resto da integração. Franquia não entra no crediário.
 *  3. Vêm notas de operação interna (transferência, ajuste) sem pagamento
 *     nenhum. Só nota COM pagamento é venda para esta rota.
 *
 * Cache em memória de 5 min por (cpf, desde): a tela do app abre e reabre.
 */
import { postTotvs, listarBranchesLimite, buscarClientePorCpf } from './bluecardLimite.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

const cents = (v) => Math.round(Number(v || 0) * 100);
const so = (s) => String(s || '').replace(/\D/g, '');

const FORMAS = {
  Invoice: 'BLUECARD', // fatura / crediário — o cartão BlueCard
  Pix: 'PIX',
  Money: 'DINHEIRO',
  CreditCard: 'CARTAO_CREDITO',
  DebitCard: 'CARTAO_DEBITO',
  Check: 'CHEQUE',
  RefundCredit: 'CREDEV',
  Advance: 'ADIANTAMENTO',
};

/** Quebra [desde, hoje] em janelas de até 6 meses (limite do TOTVS). */
function janelas(desde) {
  const out = [];
  let ini = new Date(`${desde}T00:00:00Z`);
  const fim = new Date();
  while (ini <= fim) {
    const prox = new Date(ini);
    prox.setUTCMonth(prox.getUTCMonth() + 6);
    prox.setUTCDate(prox.getUTCDate() - 1);
    const ate = prox < fim ? prox : fim;
    out.push({ ini: ini.toISOString().slice(0, 10), fim: ate.toISOString().slice(0, 10) });
    ini = new Date(ate);
    ini.setUTCDate(ini.getUTCDate() + 1);
  }
  return out;
}

async function buscarNotas(personCode, branches, desde) {
  // Janelas em paralelo: cada chamada ao TOTVS leva ~20 s com 63 filiais, e
  // um "desde" de um ano são 3 janelas — em série passava de 1 minuto.
  const porJanela = await Promise.all(janelas(desde).map((j) => buscarJanela(personCode, branches, j)));
  return porJanela.flat();
}

async function buscarJanela(personCode, branches, j) {
  const notas = [];
  {
    for (let page = 1; page <= 20; page++) {
      const resp = await postTotvs('/fiscal/v2/invoices/search', {
        filter: {
          branchCodeList: branches,
          personCodeList: [Number(personCode)],
          operationType: 'Output',
          startIssueDate: `${j.ini}T00:00:00`,
          endIssueDate: `${j.fim}T23:59:59`,
        },
        expand: 'payments',
        page,
        pageSize: 100,
      });
      notas.push(...(resp.data?.items || []));
      if (page >= (resp.data?.totalPages || 1)) break;
    }
  }
  return notas;
}

function mapearVenda(nf) {
  // Parcelas do cartão viram UMA linha por forma+título (6x no crédito = 1 linha, 6 parcelas)
  const porForma = new Map();
  for (const p of nf.payments || []) {
    const forma = FORMAS[p.documentType] || String(p.documentType || 'OUTROS').toUpperCase();
    const titulo = p.documentNumber != null ? String(p.documentNumber) : null;
    const k = `${forma}|${titulo ?? ''}`;
    const cur = porForma.get(k) || {
      forma,
      valor_cents: 0,
      parcelas: 0,
      titulo,
      portador: p.bearerName || null,
      bandeira: p.cardInformation?.cardFlag || null,
    };
    cur.valor_cents += cents(p.paymentValue);
    cur.parcelas += 1;
    porForma.set(k, cur);
  }
  const pagamentos = [...porForma.values()];
  const bluecard = pagamentos.filter((p) => p.forma === 'BLUECARD');
  const valorBluecard = bluecard.reduce((s, p) => s + p.valor_cents, 0);
  const totalPago = pagamentos.reduce((s, p) => s + p.valor_cents, 0);
  const total = cents(nf.totalValue) || totalPago;

  const hora = nf.exitTime ? String(nf.exitTime).slice(0, 8) : null;
  return {
    documento: String(nf.invoiceCode),
    sequencia: nf.invoiceSequence ?? null,
    data: String(nf.issueDate || nf.invoiceDate || '').slice(0, 10),
    hora,
    filial: Number(nf.branchCode),
    operacao: nf.operationCode ?? null,
    condicao_pagamento: nf.paymentConditionName || null,
    valor_total_cents: total,
    pagamentos,
    titulo_bluecard: bluecard[0]?.titulo ?? null,
    titulos_bluecard: bluecard.map((p) => p.titulo).filter(Boolean),
    valor_bluecard_cents: valorBluecard,
    // O que ele quer medir: tudo que não foi no cartão BlueCard.
    valor_extra_cents: Math.max(0, totalPago - valorBluecard),
    usou_bluecard: valorBluecard > 0,
  };
}

/**
 * Vendas (notas de saída COM pagamento) do CPF desde a data.
 * Retorna null se o CPF não existe no TOTVS; [] se existe e não comprou.
 */
export async function listarVendasCliente(cpf, desde, { refresh = false } = {}) {
  const doc = so(cpf);
  const chave = `${doc}|${desde}`;
  const em = cache.get(chave);
  if (!refresh && em && Date.now() - em.at < CACHE_TTL_MS) return em.dados;

  const cliente = await buscarClientePorCpf(doc);
  if (!cliente) return null;

  const branches = (await listarBranchesLimite()).map(Number);
  const notas = await buscarNotas(cliente.code, branches, desde);

  const vendas = notas
    .filter((nf) => Array.isArray(nf.payments) && nf.payments.length > 0)
    .map(mapearVenda)
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));

  const dados = {
    cliente: { codigo_totvs: cliente.code, nome: cliente.name, cpf: doc },
    desde,
    resumo: {
      vendas: vendas.length,
      vendas_com_bluecard: vendas.filter((v) => v.usou_bluecard).length,
      total_cents: vendas.reduce((s, v) => s + v.valor_total_cents, 0),
      bluecard_cents: vendas.reduce((s, v) => s + v.valor_bluecard_cents, 0),
      extra_cents: vendas.reduce((s, v) => s + v.valor_extra_cents, 0),
      // venda extra SÓ nas vendas em que o BlueCard entrou (a "compra além do limite")
      extra_em_vendas_bluecard_cents: vendas
        .filter((v) => v.usou_bluecard)
        .reduce((s, v) => s + v.valor_extra_cents, 0),
    },
    vendas,
  };
  cache.set(chave, { at: Date.now(), dados });
  return dados;
}
