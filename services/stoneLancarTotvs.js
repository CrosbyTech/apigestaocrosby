// ============================================================
// CONCILIAÇÃO STONE — lançar no TOTVS as vendas "Só na Stone"
// (pedido do João / Recuperação de Créditos, 04/11/2026)
//
// Para cada venda de cartão que existe na Stone e não tem título no TOTVS:
//   1) cria uma FATURA em aberto no cliente informado
//      (POST accounts-receivable/v2/invoices — InsertInvoiceCommand),
//      tipo de documento 1 (Fatura), portador 1020 TITULO EM CARTEIRA,
//      emissão = vencimento = data da venda, valor = bruto da Stone;
//   2) baixa essa fatura no cartão (POST invoices-payment):
//        Crédito e Pré-pago → paidType 1 (cartão de crédito, doc 4)
//        Débito             → paidType 2 (cartão de débito,  doc 5)
//      com NSU, autorização, bandeira/operadora e parcelas. O TOTVS gera
//      o título do cartão no portador STONE - <BANDEIRA> e a venda passa a
//      bater na conciliação pelo NSU/AUT.
//   (Pix não vem no arquivo de conciliação da Stone — só cartão — então
//    não aparece em "Só na Stone". Baixa de Pix = paidType 4 conta corrente.)
//
// Os dados da venda (valor, NSU, AUT, bandeira, parcelas, data) são lidos do
// arquivo da Stone no servidor; da tela vêm só stonecode + NSU + cliente.
//
// Cartão no TOTVS (cadastro FCXFL002 / payment-cards): a API localiza o
// cartão por TIPO DOC + OPERADORA + BANDEIRA + PARCELAS (texto), e só acha
// cadastros com operadora e bandeira preenchidas. Escolhemos o cadastro do
// portador STONE da bandeira e mandamos a operadora/bandeira dele; se a
// combinação existir em mais de um portador (ex.: MASTER/MASTER débito em
// 1610 e 6001) ou não existir, o item falha com a explicação — corrigir o
// cadastro no TOTVS.
// ============================================================
import axios from 'axios';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent } from '../totvsrouter/totvsHelper.js';
import { postTotvs } from './bluecardLimite.js';

const BEARER_FATURA = Number(process.env.STONE_LANCAR_BEARER_FATURA || 1020); // TITULO EM CARTEIRA
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

// Portadores STONE no TOTVS por bandeira: [crédito, débito]
const PORTADOR_STONE = {
  Mastercard: [6000, 6001],
  Visa: [6003, 6002],
  Elo: [6004, 6005],
  Hipercard: [6006, 6007],
  Hiper: [6006, 6007],
  Amex: [6008, null],
};

// Crédito e Pré-pago → crédito (João, 04/11/2026); Débito → débito.
export function modalidadeDaVenda(s) {
  const t = String(s?.tipoConta || '').toLowerCase();
  if (t.startsWith('déb') || t.startsWith('deb')) return 'debito';
  if (t.startsWith('cré') || t.startsWith('cre') || t.startsWith('pré') || t.startsWith('pre')) return 'credito';
  return null;
}

// ─── cadastro de cartões (cache 5 min) ──────────────────────
const cacheCartoes = { em: 0, lista: null };
async function cartoesTotvs() {
  if (cacheCartoes.lista && Date.now() - cacheCartoes.em < 5 * 60 * 1000) return cacheCartoes.lista;
  const tk = await getToken();
  const lista = [];
  for (let page = 1; page <= 30; page++) {
    const r = await axios.get(`${TOTVS_BASE_URL}/accounts-receivable/v2/payment-cards`, {
      params: { Page: page, PageSize: 100, IsInactive: false },
      headers: { Authorization: `Bearer ${tk.access_token}` },
      httpsAgent,
      timeout: 30000,
    });
    const it = r.data?.items || [];
    lista.push(...it);
    if (!r.data?.hasNext || !it.length) break;
  }
  cacheCartoes.lista = lista;
  cacheCartoes.em = Date.now();
  return lista;
}

/** Escolhe o cartão do TOTVS para a venda. Retorna { card, cadastro } ou { erro }. */
export async function escolherCartao(venda) {
  const modalidade = modalidadeDaVenda(venda);
  if (!modalidade) return { erro: `Tipo de cartão "${venda.tipoConta || '?'}" não reconhecido.` };
  const docType = modalidade === 'credito' ? 4 : 5;
  const portadores = PORTADOR_STONE[venda.bandeira];
  const portador = portadores ? portadores[modalidade === 'credito' ? 0 : 1] : null;
  if (!portador) return { erro: `Sem portador STONE para ${venda.bandeira || 'bandeira ?'} ${modalidade}.` };
  const parcelas = Number(venda.parcelas) || 1;

  const lista = await cartoesTotvs();
  const doPortador = lista.filter(
    (c) => Number(c.documentType) === docType && Number(c.bearerNumber) === portador && c.isInactive !== 'T',
  );
  const util = doPortador.filter(
    (c) => c.operatorName && c.brandName && Number(c.installmentNumber) === parcelas,
  );
  if (!util.length) {
    const nomes = doPortador.map((c) => c.description).slice(0, 4).join(', ');
    return {
      erro:
        `Cartão STONE ${venda.bandeira} ${modalidade === 'credito' ? 'crédito' : 'débito'} ${parcelas}x (portador ${portador}) ` +
        `sem operadora/bandeira no cadastro de cartões do TOTVS (FCXFL002)${nomes ? ` — cadastros: ${nomes}` : ''}. ` +
        'A API só acha o cartão com operadora e bandeira preenchidas.',
    };
  }
  // prefere o cadastro com operadora STONE (único por bandeira depois do ajuste do FCXFL002)
  util.sort((a, b) => (/^STONE$/i.test(b.operatorName) ? 1 : 0) - (/^STONE$/i.test(a.operatorName) ? 1 : 0));
  const reg = util[0];
  // A API procura por tipo + operadora + bandeira + parcelas: a combinação não
  // pode apontar para outro portador, senão o título nasce no portador errado.
  const mesmos = lista.filter(
    (c) =>
      Number(c.documentType) === docType &&
      String(c.operatorName || '').toUpperCase() === String(reg.operatorName).toUpperCase() &&
      String(c.brandName || '').toUpperCase() === String(reg.brandName).toUpperCase() &&
      Number(c.installmentNumber) === parcelas,
  );
  const outros = [...new Set(mesmos.map((c) => Number(c.bearerNumber)))].filter((b) => b !== portador);
  if (outros.length) {
    return {
      erro:
        `No cadastro de cartões do TOTVS a combinação ${reg.operatorName}/${reg.brandName} ${parcelas}x ` +
        `(${modalidade}) existe nos portadores ${[portador, ...outros].join(' e ')} — o TOTVS pode lançar no portador errado. ` +
        'Deixe a operadora/bandeira única para o portador STONE no FCXFL002.',
    };
  }
  return {
    modalidade,
    paidType: modalidade === 'credito' ? 1 : 2,
    portador,
    cadastro: reg.description,
    card: {
      nsu: Number(soDigitos(venda.nsu).slice(-18)) || 0,
      autorization: String(venda.codAutorizacao || '').slice(0, 20),
      cardBrand: String(reg.brandName).slice(0, 60),
      cardOperator: String(reg.operatorName).slice(0, 60),
      installmentQuantity: parcelas,
    },
  };
}

// ─── cliente ────────────────────────────────────────────────
export async function buscarClientePorCodigo(code) {
  const c = Number(code);
  for (const [path, campo] of [
    ['/person/v2/individuals/search', 'cpf'],
    ['/person/v2/legal-entities/search', 'cnpj'],
  ]) {
    const r = await postTotvs(path, { filter: { personCodeList: [c] }, page: 1, pageSize: 1 });
    const it = r.data?.items?.[0];
    if (it) {
      return { code: Number(it.code), nome: it.name || it.fantasyName || null, cpfCnpj: soDigitos(it[campo] || it.cpfCnpj) };
    }
  }
  return null;
}

// ─── títulos ────────────────────────────────────────────────
async function buscarFatura({ customerCode, receivableCode }) {
  const r = await postTotvs('/accounts-receivable/v2/documents/search', {
    filter: { customerCodeList: [Number(customerCode)], receivableCodeList: [Number(receivableCode)] },
    page: 1,
    pageSize: 50,
  });
  return r.data?.items || [];
}

// Nº da fatura = últimos 10 dígitos do NSU da Stone (o TOTVS aceita até 10).
export const numeroFatura = (nsu) => Number(soDigitos(nsu).slice(-10)) || null;

const dataMeioDia = (iso) => `${String(iso).slice(0, 10)}T12:00:00`;

const mensagemTotvs = (e) => {
  const d = e?.response?.data;
  if (Array.isArray(d)) return d.map((x) => x.message || x.detailedMessage).filter(Boolean).join(' | ');
  if (d?.message) return d.message;
  if (d && typeof d === 'object') return JSON.stringify(d).slice(0, 400);
  return e?.message || String(e);
};

/**
 * Lança UMA venda da Stone no TOTVS.
 * @param venda   transação Stone (parseTransacao) — fonte da verdade
 * @param loja    { cnpj, filiais, nome }
 * @param cliente código do cliente TOTVS
 * @param simular true = só valida e devolve os payloads, sem gravar
 */
export async function lancarVendaStone({ venda, loja, cliente, simular = false, usuario = null }) {
  const passos = [];
  if (venda.cancelada) return { ok: false, erro: 'Venda cancelada na Stone — não se lança.' };
  const valor = round2(venda.valorBruto);
  if (!(valor > 0)) return { ok: false, erro: 'Venda sem valor.' };
  const dataVenda = venda.dataVenda || String(venda.dataCaptura || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataVenda)) return { ok: false, erro: 'Venda sem data.' };
  const receivableCode = numeroFatura(venda.nsu);
  if (!receivableCode) return { ok: false, erro: 'Venda sem NSU.' };

  const cli = await buscarClientePorCodigo(cliente);
  if (!cli) return { ok: false, erro: `Cliente ${cliente} não encontrado no TOTVS.` };
  if (!cli.cpfCnpj) return { ok: false, erro: `Cliente ${cliente} sem CPF/CNPJ no TOTVS.` };

  const cartao = await escolherCartao(venda);
  if (cartao.erro) return { ok: false, erro: cartao.erro, cliente: cli };

  const branchCnpj = soDigitos(loja.cnpj);
  const filiais = (loja.filiais || []).map(Number);

  const obs = `STONE NSU ${venda.nsu} AUT ${venda.codAutorizacao || '-'} - HeadCoach Conciliacao Stone`.slice(0, 80);
  const payloadFatura = {
    branchCnpj,
    customerCpfCnpj: cli.cpfCnpj,
    receivableCode,
    installments: [
      {
        installmentCode: 1,
        documentType: 1, // Fatura
        billingType: 2, // como as faturas de venda das lojas
        chargeType: 0, // não está em cobrança (carteira)
        bearerCode: BEARER_FATURA,
        issueDate: dataMeioDia(dataVenda),
        expiredDate: dataMeioDia(dataVenda),
        installmentValue: valor,
        observations: [{ observation: obs }],
      },
    ],
  };

  // já existe? (lançamento repetido / segunda tentativa depois de erro na baixa)
  let existentes = await buscarFatura({ customerCode: cli.code, receivableCode });
  const daLoja = existentes.filter((x) => !filiais.length || filiais.includes(Number(x.branchCode)));
  const jaBaixada = daLoja.find((x) => Number(x.installmentCode) === 1 && (Number(x.paidValue) > 0 || x.settlementDate));
  if (jaBaixada) {
    return {
      ok: true,
      jaExistia: true,
      mensagem: `Fatura ${jaBaixada.branchCode}/${receivableCode} já existe e está baixada.`,
      fatura: { filial: jaBaixada.branchCode, numero: receivableCode, cliente: cli.code },
      cliente: cli,
      cartao: { modalidade: cartao.modalidade, portador: cartao.portador, cadastro: cartao.cadastro },
    };
  }
  let aberta = daLoja.find((x) => Number(x.installmentCode) === 1);
  if (aberta && round2(aberta.installmentValue) !== valor) {
    return {
      ok: false,
      erro: `Já existe a fatura ${aberta.branchCode}/${receivableCode} do cliente ${cli.code} com outro valor (${aberta.installmentValue}).`,
    };
  }

  const montarBaixa = (branchCode) => ({
    branchCode,
    settlementDate: dataMeioDia(dataVenda),
    invoices: [{ branchCode, customerCode: cli.code, receivableCode, installmentCode: 1, paidValue: valor }],
    payments: [
      { value: valor, paidType: cartao.paidType, movementDate: dataMeioDia(dataVenda), card: cartao.card },
    ],
  });

  if (simular) {
    return {
      ok: true,
      simulado: true,
      cliente: cli,
      cartao: { modalidade: cartao.modalidade, portador: cartao.portador, cadastro: cartao.cadastro },
      payloadFatura: aberta ? null : payloadFatura,
      payloadBaixa: montarBaixa(aberta ? Number(aberta.branchCode) : filiais[0]),
    };
  }

  // 1) cria a fatura
  if (!aberta) {
    try {
      await postTotvs('/accounts-receivable/v2/invoices', payloadFatura);
      passos.push('fatura criada');
    } catch (e) {
      return { ok: false, erro: `TOTVS recusou a fatura: ${mensagemTotvs(e)}`, cliente: cli };
    }
    existentes = await buscarFatura({ customerCode: cli.code, receivableCode });
    aberta =
      existentes.find((x) => Number(x.installmentCode) === 1 && (!filiais.length || filiais.includes(Number(x.branchCode)))) ||
      existentes.find((x) => Number(x.installmentCode) === 1);
    if (!aberta) return { ok: false, erro: 'Fatura criada, mas não a encontrei no TOTVS para baixar — tente de novo em instantes.', cliente: cli, passos };
  } else {
    passos.push('fatura já existia em aberto');
  }

  // 2) baixa no cartão
  const branchCode = Number(aberta.branchCode);
  const payloadBaixa = montarBaixa(branchCode);
  try {
    await postTotvs('/accounts-receivable/v2/invoices-payment', payloadBaixa);
    passos.push(`baixada no cartão ${cartao.modalidade}`);
  } catch (e) {
    return {
      ok: false,
      erro: `Fatura ${branchCode}/${receivableCode} criada, mas a baixa falhou: ${mensagemTotvs(e)}`,
      fatura: { filial: branchCode, numero: receivableCode, cliente: cli.code },
      cliente: cli,
      passos,
    };
  }
  console.log(`[stone-lancar] ${usuario || '?'}: NSU ${venda.nsu} → fatura ${branchCode}/${receivableCode} cliente ${cli.code} baixada (${cartao.modalidade}, portador ${cartao.portador})`);
  return {
    ok: true,
    mensagem: `Fatura ${branchCode}/${receivableCode} criada e baixada no cartão de ${cartao.modalidade === 'credito' ? 'crédito' : 'débito'}.`,
    fatura: { filial: branchCode, numero: receivableCode, cliente: cli.code },
    cliente: cli,
    cartao: { modalidade: cartao.modalidade, portador: cartao.portador, cadastro: cartao.cadastro },
    passos,
  };
}
