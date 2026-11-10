// ============================================================================
// PDV CROSBY — espelho da venda HEADCOACH no TOTVS como DOCUMENTO INTERNO
//
// No modo HEADCOACH a venda (itens, pagamento, EPCs) e a nota fiscal ficam no
// HeadCoach. Para o TOTVS continuar sendo a fonte do estoque e do contas a
// receber, a mesma venda é duplicada lá:
//   1) POST general/v2/transactions com a operação de DOCUMENTO INTERNO da
//      empresa (padrão 511 "VENDA VAREJO *", modelo 35 — não emite NF)
//   2) POST general/v2/transaction-receiving com as formas de pagamento da
//      venda → transação ATENDIDA, financeiro lançado, documento modelo 35
//
// Regras do TOTVS (validadas em 22/10/2026 na empresa 990):
//   • o terminal precisa estar cadastrado e com o CAIXA ABERTO na data
//     (CashOutClosed / TerminalInvalid) — a abertura é feita no TOTVS desktop
//   • formas aceitas: 1 fatura, 3 dinheiro, 4 crédito, 5 débito, 10 adiant.,
//     14 promissória, 20 credev, 26 pix
// Idempotente: se a transação já existe só repete o recebimento; se já está
// recebida não faz nada.
// ============================================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, httpAgent, TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';

export const DOC_INTERNO_PADRAO = { operacao: 511, terminal: 1, cfop: 5102, paymentConditionCode: 1 };

// forma do HeadCoach → tipo de documento do recebimento TOTVS
const TIPO_DOC_TOTVS = { dinheiro: 3, pix: 26, credito: 4, debito: 5, credito_loja: 20, boleto: 1 };

export class EspelhoError extends Error {
  constructor(message, code = 'ESPELHO_TOTVS', status = 400, details = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

async function callTotvs(method, url, { data, params, timeout } = {}) {
  const doCall = async (token) =>
    axios({ method, url, data, params, httpsAgent, httpAgent, timeout: timeout ?? 60000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` } });
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new EspelhoError('Não foi possível obter token TOTVS', 'TOKEN_UNAVAILABLE', 503);
  try {
    return await doCall(tokenData.access_token);
  } catch (err) {
    if (err.response?.status === 401) {
      const refreshed = await getToken(true);
      return doCall(refreshed.access_token);
    }
    throw err;
  }
}

// Mensagem legível a partir do erro do TOTVS
function traduzirErroTotvs(err) {
  const d = err.response?.data;
  const lista = Array.isArray(d) ? d : d ? [d] : [];
  const codes = lista.map((x) => x.code).filter(Boolean);
  const msgs = lista.map((x) => x.message || x.detailedMessage).filter(Boolean);
  // texto original do TOTVS junto: sem ele não dá para saber o que a validação conferiu
  const original = lista.map((x) => [x.code, x.message, x.detailedMessage].filter(Boolean).join(' — ')).filter(Boolean).join(' | ');
  if (codes.includes('CashOutClosed')) {
    return { code: 'CAIXA_FECHADO', message: `O TOTVS recusou o recebimento: caixa não aberto para o terminal/data da transação. Resposta do TOTVS: ${original}` };
  }
  if (codes.includes('TerminalInvalid')) {
    return { code: 'TERMINAL_INVALIDO', message: 'Terminal não cadastrado no TOTVS para esta empresa — ajuste o "terminal" na configuração fiscal.' };
  }
  // Qualquer outro erro: código + mensagem + detalhe; se o TOTVS não mandou
  // nada legível (já veio só "."), a resposta crua, para dar para diagnosticar
  const legivel = msgs.join('; ').replace(/[.\s]/g, '').length > 3;
  let cru = '';
  try {
    cru = typeof d === 'string' ? d : JSON.stringify(d);
  } catch {
    cru = String(d);
  }
  const detalhe = original && original.replace(/[.\s—|]/g, '').length > 3 ? original : `HTTP ${err.response?.status ?? '?'} ${String(cru || err.message).slice(0, 600)}`;
  return { code: codes[0] || 'TOTVS_ERROR', message: legivel ? `${msgs.join('; ')} (${detalhe})` : detalhe };
}

async function carregar(vendaId) {
  const { data: venda, error } = await supabase.from('pdv_vendas').select('*').eq('id', vendaId).maybeSingle();
  if (error) throw new EspelhoError(error.message, 'DB_ERROR', 500);
  if (!venda) throw new EspelhoError('Venda não encontrada', 'NOT_FOUND', 404);
  const [{ data: itens }, { data: pagamentos }, { data: notas }, { data: cfg }] = await Promise.all([
    supabase.from('pdv_venda_itens').select('*').eq('venda_id', vendaId).order('seq'),
    supabase.from('pdv_venda_pagamentos').select('*').eq('venda_id', vendaId).order('id'),
    supabase.from('pdv_notas_fiscais').select('modelo, serie, numero, chave, status').eq('venda_id', vendaId).order('id', { ascending: false }),
    supabase.from('pdv_fiscal_config').select('espelhar_totvs, operacao_doc_interno, terminal_totvs, cliente_balcao_totvs').eq('empresa', venda.empresa).maybeSingle(),
  ]);
  return { venda, itens: itens || [], pagamentos: pagamentos || [], notas: notas || [], cfg: cfg || null };
}

async function gravar(vendaId, patch) {
  const { error } = await supabase.from('pdv_vendas').update(patch).eq('id', vendaId);
  if (error) console.warn(`⚠️ [Espelho TOTVS] não gravei o resultado na venda ${vendaId}: ${error.message}`);
}

// Recebimentos do TOTVS a partir dos pagamentos da venda
// comoFatura: todas as formas viram FATURA (documentType 1) — título a prazo no
// contas a receber, sem movimento de caixa. Cartão em N vezes vira N faturas a
// cada 30 dias; as demais formas, 1 fatura com vencimento na data da transação.
const maisDias = (iso, dias) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
function montarRecebimentos(pagamentos, transactionCode, data, { parcelasBoleto = [], documento = null, comoFatura = false } = {}) {
  const receipts = [];
  for (const p of pagamentos) {
    if (comoFatura && p.forma !== 'boleto') {
      const liq = round2(Number(p.valor) - Number(p.troco || 0));
      if (liq <= 0) continue;
      const n = p.forma === 'credito' ? Math.max(1, Number(p.parcelas) || 1) : 1;
      const parc = round2(liq / n);
      for (let i = 0; i < n; i++) {
        receipts.push({
          documentType: TIPO_DOC_TOTVS.boleto,
          documentNumber: Number(documento) || transactionCode,
          installmentNumber: receipts.length + 1,
          dueDate: p.forma === 'credito' ? maisDias(data, 30 * (i + 1)) : String(data).slice(0, 10),
          documentAmount: i === n - 1 ? round2(liq - parc * (n - 1)) : parc,
        });
      }
      continue;
    }
    if (p.forma === 'boleto') {
      if (!parcelasBoleto.length) throw new EspelhoError('Boleto sem parcelas/vencimentos', 'BOLETO_SEM_PARCELAS');
      parcelasBoleto.forEach((d, i) =>
        receipts.push({
          documentType: TIPO_DOC_TOTVS.boleto,
          documentNumber: Number(documento) || transactionCode,
          installmentNumber: i + 1,
          dueDate: String(d.vencimento).slice(0, 10),
          documentAmount: round2(d.valor),
        }),
      );
      continue;
    }
    const tipo = TIPO_DOC_TOTVS[p.forma];
    if (!tipo) throw new EspelhoError(`Forma de pagamento "${p.forma}" não tem equivalente no recebimento do TOTVS`, 'FORMA_SEM_EQUIVALENTE');
    const liquido = round2(Number(p.valor) - Number(p.troco || 0));
    if (liquido <= 0) continue;
    const cartao = p.forma === 'credito' || p.forma === 'debito';
    // documentNumber é Int32 no TOTVS: NSU maior que 2.147.483.647 (ex.: Pagar.me
    // 4645872422) quebra o recebimento — nesse caso vai o número da transação e
    // o NSU segue só em nsuNumber
    const nsuInt = p.nsu && /^\d+$/.test(String(p.nsu)) ? Number(p.nsu) : null;
    const nsuNumerico = nsuInt && nsuInt <= 2147483647 ? nsuInt : null;
    const base = {
      documentType: tipo,
      documentNumber: nsuNumerico || transactionCode,
      dueDate: data,
      ...(cartao
        ? {
            cardBrand: p.bandeira || undefined,
            authorizationCode: p.autorizacao || undefined,
            nsuNumber: p.nsu ? String(p.nsu) : undefined,
          }
        : {}),
    };
    const parcelas = p.forma === 'credito' ? Math.max(1, Number(p.parcelas) || 1) : 1;
    if (parcelas === 1) {
      receipts.push({ ...base, documentAmount: liquido, ...(cartao ? { installmentNumber: 1 } : {}) });
    } else {
      // parcelas iguais, diferença de centavos na última
      const parcela = round2(liquido / parcelas);
      let acumulado = 0;
      for (let n = 1; n <= parcelas; n++) {
        const valor = n === parcelas ? round2(liquido - acumulado) : parcela;
        acumulado = round2(acumulado + valor);
        receipts.push({ ...base, installmentNumber: n, documentAmount: valor });
      }
    }
  }
  if (!receipts.length) throw new EspelhoError('Venda sem pagamentos para receber no TOTVS', 'SEM_PAGAMENTOS');
  return receipts;
}

// Fatura/sequência do documento modelo 35 gerado pelo recebimento (informativo)
async function buscarDocInterno(empresa, transactionCode, data) {
  try {
    const r = await callTotvs('post', `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`, {
      data: { filter: { branchCodeList: [empresa], transactionBranchCode: empresa, transactionCode, transactionDate: `${data}T00:00:00.000Z` }, page: 1, pageSize: 3 },
      timeout: 60000,
    });
    const n = (r.data?.items || []).find((x) => x.invoiceStatus !== 'Canceled');
    return n?.invoiceSequence ?? null;
  } catch {
    return null;
  }
}

/**
 * Espelha a venda HEADCOACH no TOTVS (documento interno + recebimento).
 * @param {number} vendaId
 * @param {{ forcar?: boolean }} opts  forcar = ignora espelhar_totvs=false
 * @returns {{ ignorado?: boolean, motivo?: string, transactionCode, transactionDate, status, docInternoSeq }}
 */
export async function espelharVendaNoTotvs(vendaId, { forcar = false } = {}) {
  const { venda, itens, pagamentos, notas, cfg } = await carregar(vendaId);
  if (venda.status === 'cancelada') throw new EspelhoError('Venda cancelada não é espelhada', 'VENDA_CANCELADA');
  if (venda.tipo_venda === 'troca') return { ignorado: true, motivo: 'Troca não é espelhada como documento interno' };
  if (cfg && cfg.espelhar_totvs === false && !forcar) return { ignorado: true, motivo: 'Espelho no TOTVS desligado para esta empresa' };
  if (venda.totvs_status === 4 && venda.totvs_transacao_code) {
    return { transactionCode: venda.totvs_transacao_code, transactionDate: venda.totvs_transacao_date, status: 4, docInternoSeq: venda.totvs_doc_interno_seq, jaEstava: true };
  }

  const operacao = venda.operacao_doc_interno || cfg?.operacao_doc_interno || DOC_INTERNO_PADRAO.operacao;
  const terminal = Number(venda.pedido_info?.terminal) || cfg?.terminal_totvs || DOC_INTERNO_PADRAO.terminal;
  const customerCode = venda.cliente_code || cfg?.cliente_balcao_totvs || null;
  if (!customerCode) {
    const e = new EspelhoError('Venda sem cliente e empresa sem "cliente balcão" configurado (Fiscal PDV)', 'CLIENTE_BALCAO_NAO_CONFIGURADO');
    await gravar(vendaId, { totvs_erro: e.message });
    throw e;
  }

  let transactionCode = venda.totvs_transacao_code;
  let transactionDate = venda.totvs_transacao_date;

  // 1) Transação em andamento (documento interno)
  if (!transactionCode) {
    const items = itens.map((i) => {
      const desconto = round2(i.desconto_unit || 0);
      return {
        productCode: Number(i.product_code),
        quantity: Number(i.quantidade),
        value: round2(i.valor_unit),
        ...(desconto > 0 ? { discountValue: desconto } : {}),
        cfop: Number(i.cfop) || DOC_INTERNO_PADRAO.cfop,
      };
    });
    // Expedição: o documento interno não tem campo de frete e o recebimento
    // exige total = total da transação. O frete entra no valor de UMA peça
    // (separada em linha própria de 1 unidade) para o contas a receber bater
    // com o total da NF-e (produtos + frete).
    const frete = round2(venda.frete || 0);
    if (frete > 0 && items.length) {
      const k = items.reduce((m, it, idx) => (it.quantity * it.value > items[m].quantity * items[m].value ? idx : m), 0);
      const alvo = items[k];
      if (alvo.quantity > 1) {
        items.splice(k, 1, { ...alvo, quantity: alvo.quantity - 1 }, { ...alvo, quantity: 1, value: round2(alvo.value + frete) });
      } else {
        items[k] = { ...alvo, value: round2(alvo.value + frete) };
      }
    }
    const total = Number(items.reduce((s, it) => s + it.quantity * (it.value - (it.discountValue || 0)), 0).toFixed(3));
    const nota = notas.find((n) => n.status === 'autorizada') || notas[0];
    // "Transação com data diferente": a data real da venda vai em linha própria,
    // sempre no mesmo formato, para os relatórios acharem (VENDA DO DIA dd/mm/aaaa)
    const dv = String(venda.pedido_info?.dataVenda || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const observations = [
      ...(dv ? [{ observation: `VENDA DO DIA ${dv[3]}/${dv[2]}/${dv[1]}` }] : []),
      ...(venda.numero_site ? [{ observation: `PEDIDO ${venda.numero_site} - FATURAMENTO EXPEDICAO HEADCOACH`.slice(0, 80) }] : []),
      { observation: `VENDA HEADCOACH #${venda.id} - DOC INTERNO (NF PELO HEADCOACH)`.slice(0, 80) },
      ...(round2(venda.frete || 0) > 0 ? [{ observation: `FRETE R$ ${round2(venda.frete).toFixed(2)} INCLUSO NO VALOR DOS ITENS`.slice(0, 80) }] : []),
      ...(nota ? [{ observation: `${Number(nota.modelo) === 65 ? 'NFC-E' : 'NF-E'} ${nota.numero}/${nota.serie} ${nota.status.toUpperCase()}`.slice(0, 80) }] : []),
      ...(nota?.chave ? [{ observation: `CHAVE ${nota.chave}`.slice(0, 80) }] : []),
    ];
    const payload = {
      branchCode: venda.empresa,
      ...(venda.data_caixa ? { transactionDate: String(venda.data_caixa).slice(0, 10) } : {}),
      customerCode: Number(customerCode),
      sellerCode: Number(venda.vendedor_code),
      operationCode: Number(operacao),
      paymentConditionCode: DOC_INTERNO_PADRAO.paymentConditionCode,
      isPreSale: false,
      status: 1,
      totalAmountTransaction: total,
      items,
      observations,
    };
    try {
      const r = await callTotvs('post', `${TOTVS_BASE_URL}/general/v2/transactions`, { data: payload, timeout: 90000 });
      transactionCode = r.data?.transactionCode;
      transactionDate = String(r.data?.transactionDate || '').slice(0, 10);
      if (!transactionCode) throw new Error('TOTVS não devolveu o número da transação');
      await gravar(vendaId, { totvs_transacao_code: transactionCode, totvs_transacao_date: transactionDate, totvs_status: 1, totvs_erro: null });
      console.log(`🪞 [Espelho TOTVS] venda ${venda.id} → transação ${venda.empresa}/${transactionCode} (op ${operacao}, doc interno)`);
    } catch (err) {
      const t = traduzirErroTotvs(err);
      await gravar(vendaId, { totvs_erro: `transação: ${t.message}` });
      throw new EspelhoError(`TOTVS recusou a transação: ${t.message}`, t.code, err.response?.status || 502, err.response?.data);
    }
  }

  // 2) Recebimento → ATENDIDA (exige caixa aberto no terminal)
  const notaOk = notas.find((n) => n.status === 'autorizada');
  const receipts = montarRecebimentos(pagamentos, transactionCode, transactionDate, {
    parcelasBoleto: venda.cobranca?.parcelas || [],
    documento: notaOk?.numero || null,
    comoFatura: !!venda.pedido_info?.receberComoFatura,
  });
  const totalAmount = round2(receipts.reduce((s, r) => s + r.documentAmount, 0));
  try {
    await callTotvs('post', `${TOTVS_BASE_URL}/general/v2/transaction-receiving`, {
      data: { branchCode: venda.empresa, transactionCode, transactionDate, totalAmount, terminalCode: terminal, receipts },
      timeout: 180000,
    });
  } catch (err) {
    const t = traduzirErroTotvs(err);
    await gravar(vendaId, { totvs_erro: `recebimento: ${t.message}` });
    throw new EspelhoError(t.message, t.code, err.response?.status || 502, err.response?.data);
  }
  const docInternoSeq = await buscarDocInterno(venda.empresa, transactionCode, transactionDate);
  await gravar(vendaId, { totvs_status: 4, totvs_doc_interno_seq: docInternoSeq, totvs_espelhado_em: new Date().toISOString(), totvs_erro: null });
  console.log(`✅ [Espelho TOTVS] venda ${venda.id} recebida no TOTVS: transação ${transactionCode} ATENDIDA, doc interno ${docInternoSeq ?? '?'}, R$ ${totalAmount.toFixed(2)}`);
  return { transactionCode, transactionDate, status: 4, docInternoSeq, totalAmount };
}
