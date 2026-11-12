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
// Portadores do cartão Pagar.me (vendas do site / expedição)
export const PORTADORES_PAGARME = { credito: 9902, debito: 9901 };

// forma do HeadCoach → tipo de documento do recebimento TOTVS
// credito_loja = CREDEV (20) e adiantamento (10): consomem o saldo do cliente
// tamanho máximo de cada linha de observação que o TOTVS aceita na transação
const OBS_MAX = 60;
const TIPO_DOC_TOTVS = { dinheiro: 3, pix: 26, credito: 4, debito: 5, credito_loja: 20, adiantamento: 10, boleto: 1 };

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
// ─── Cartão: cadastro FCXFL002 do TOTVS (payment-cards) ─────────────────────
// A API do recebimento NÃO aceita portador nem a "Seq." do relacionamento: ela
// acha a linha por tipo doc + OPERADORA + BANDEIRA + nº de parcelas, comparando
// o TEXTO das colunas Operadora/Bandeira do relacionamento (ex.: "PAGARME" /
// "OUTROS"). Mandar código (27448 / 99) ou deixar a linha sem operadora dá
// "42306 - Histórico auxiliar não cadastrado". Por isso lemos o cadastro do
// portador da venda e mandamos exatamente o texto que está lá.
const cacheCartoes = { em: 0, lista: null };
export async function cartoesTotvs() {
  // a leitura completa leva ~20 s (dezenas de páginas): guarda por 15 min
  if (cacheCartoes.lista && Date.now() - cacheCartoes.em < 15 * 60 * 1000) return cacheCartoes.lista;
  const todos = [];
  for (let page = 1; page <= 40; page++) {
    const r = await callTotvs('get', `${TOTVS_BASE_URL}/accounts-receivable/v2/payment-cards`, { params: { IsInactive: false, Page: page, PageSize: 100 }, timeout: 60000 });
    todos.push(...(r.data?.items || []));
    if (!r.data?.hasNext) break;
  }
  cacheCartoes.em = Date.now();
  cacheCartoes.lista = todos;
  return todos;
}
// portadores: { credito, debito } → devolve { operadora, bandeira } (texto do cadastro)
async function resolverCartaoNoCadastro(forma, parcelas, portadores) {
  const portador = Number(forma === 'debito' ? portadores.debito : portadores.credito);
  const n = forma === 'debito' ? 1 : Math.max(1, Number(parcelas) || 1);
  const lista = await cartoesTotvs();
  const doPortador = lista.filter((c) => Number(c.bearerNumber) === portador);
  const linha = doPortador.find((c) => Number(c.installmentNumber) === n);
  const onde = `cartão de ${forma === 'debito' ? 'débito' : 'crédito'} · portador ${portador} · ${n}x`;
  if (!linha) {
    throw new EspelhoError(`O TOTVS não tem o relacionamento de ${onde} (FCXFL002). Cadastre a linha de ${n} parcela(s) no portador ${portador} e tente de novo.`, 'CARTAO_SEM_CADASTRO');
  }
  if (!linha.operatorName || !linha.brandName) {
    throw new EspelhoError(
      `No TOTVS, o relacionamento "${linha.description}" (seq. ${linha.sequenceNumber}, ${onde}) está sem Operadora/Bandeira. A API só acha o cartão por esses dois campos — preencha as colunas Operadora e Bandeira dessa linha e tente de novo.`,
      'CARTAO_SEM_OPERADORA',
    );
  }
  const iguais = lista.filter(
    (c) =>
      Number(c.documentType) === Number(linha.documentType) &&
      Number(c.installmentNumber) === n &&
      String(c.operatorName || '').toUpperCase() === String(linha.operatorName).toUpperCase() &&
      String(c.brandName || '').toUpperCase() === String(linha.brandName).toUpperCase(),
  );
  if (iguais.length > 1) {
    throw new EspelhoError(
      `No TOTVS a combinação ${linha.operatorName}/${linha.brandName} ${n}x existe em mais de um portador (${[...new Set(iguais.map((c) => c.bearerNumber))].join(', ')}) — a API não sabe qual usar. Deixe essa combinação só no portador ${portador}.`,
      'CARTAO_AMBIGUO',
    );
  }
  return { operadora: String(linha.operatorName).slice(0, 60), bandeira: String(linha.brandName).slice(0, 60), seq: linha.sequenceNumber };
}

// comoFatura: todas as formas viram FATURA (documentType 1) — título a prazo no
// contas a receber, sem movimento de caixa. Cartão em N vezes vira N faturas a
// cada 30 dias; as demais formas, 1 fatura com vencimento na data da transação.
const maisDias = (iso, dias) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
// Saldo bônus não existe no TOTVS. O dinheiro dele entrou no pagamento do pedido
// que gerou o crédito (naquele dia a transação ficou só com as peças que
// existiam). Então, quando o bônus é usado, o TOTVS recebe cada pedaço na MESMA
// forma daquele pagamento (Pix, cartão…): fecha com o que entrou no banco.
// Pix e dinheiro somam na linha da mesma forma, se a venda já tiver uma.
function expandirSaldoBonus(pagamentos, venda) {
  if (!pagamentos.some((p) => p.forma === 'saldo_bonus')) return pagamentos;
  const usos = Array.isArray(venda.pedido_info?.bonusUso) ? venda.pedido_info.bonusUso : [];
  const saida = pagamentos.filter((p) => p.forma !== 'saldo_bonus').map((p) => ({ ...p }));
  const totalBonus = round2(pagamentos.filter((p) => p.forma === 'saldo_bonus').reduce((s, p) => s + Number(p.valor || 0), 0));
  const totalUsos = round2(usos.reduce((s, u) => s + Number(u.valor || 0), 0));
  if (!usos.length || Math.abs(totalBonus - totalUsos) > 0.01) {
    throw new EspelhoError(`Venda com saldo bônus (R$ ${totalBonus.toFixed(2)}) sem o registro dos créditos de origem (R$ ${totalUsos.toFixed(2)})`, 'BONUS_SEM_ORIGEM');
  }
  for (const u of usos) {
    const forma = u.origem?.forma || 'pix';
    const mesma = forma === 'pix' || forma === 'dinheiro' ? saida.find((p) => p.forma === forma) : null;
    if (mesma) {
      mesma.valor = round2(Number(mesma.valor) + Number(u.valor));
      continue;
    }
    saida.push({
      venda_id: venda.id,
      forma,
      valor: round2(u.valor),
      troco: 0,
      parcelas: Number(u.origem?.parcelas) || 1,
      cartao_totvs: u.origem?.cartao_totvs || null,
      bandeira: null,
      nsu: null,
      autorizacao: u.origem?.autorizacao || null,
      bonusDoCredito: u.creditoId,
    });
  }
  return saida;
}

function montarRecebimentos(pagamentos, transactionCode, data, { parcelasBoleto = [], documento = null, comoFatura = false, cartaoTotvs = null, pixId = null } = {}) {
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
            // Operadora + bandeira no cadastro do TOTVS: é por elas que ele acha
            // o PORTADOR do título (99: 27448 Pagar.me + 99 OUTROS → 9902 crédito /
            // 9901 débito). Sem operadora o recebimento falha no TOMAS sem mensagem.
            ...(p.cartaoCadastro ? { cardOperator: p.cartaoCadastro.operadora } : {}),
            cardBrand: p.cartaoCadastro ? p.cartaoCadastro.bandeira : p.bandeira || undefined,
            authorizationCode: p.autorizacao || undefined,
            nsuNumber: p.nsu ? String(p.nsu) : undefined,
          }
        : {}),
      // Pix = "carteira digital" no TOTVS. Sem estes campos o recebimento volta
      // "40452 - Parâmetro de entrada TP_CARTEIRADIGITAL não informado"; só com o
      // tipo ele devolve "-35 Error returned by 4GL". O conjunto abaixo foi o que
      // atendeu a transação 990/903458 em 10/11/2026 (título tipo 26 PIX em aberto,
      // portador 1020). O id é o E2E do Pix quando o pedido traz; senão, a venda.
      ...(p.forma === 'pix'
        ? (() => {
            const id = String(pixId || p.nsu || `HEADCOACH-${p.venda_id || transactionCode}`).slice(0, 100);
            return { digitalWalletType: '1', transactionId: id, nsuNumber: id, processorTransactionId: id, paymentStatus: 1, receiptStatus: 1 };
          })()
        : {}),
    };
    const parcelas = p.forma === 'credito' ? Math.max(1, Number(p.parcelas) || 1) : 1;
    if (parcelas === 1) {
      receipts.push({ ...base, documentAmount: liquido, ...(cartao ? { installmentNumber: 1 } : {}) });
    } else if (p.cartaoCadastro) {
      // Com operadora informada o TOTVS trata installmentNumber como a QUANTIDADE
      // de parcelas do cartão (acha o histórico auxiliar por tipo + operadora +
      // bandeira + nº de parcelas e ele mesmo divide). Duas linhas "parcela 1" e
      // "parcela 2" viravam dois cartões de 1x — erro 42306 (10/11/2026).
      receipts.push({ ...base, installmentNumber: parcelas, documentAmount: liquido });
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
  const { venda, itens, pagamentos: pagamentosDaVenda, notas, cfg } = await carregar(vendaId);
  const pagamentos = expandirSaldoBonus(pagamentosDaVenda, venda);
  if (venda.status === 'cancelada') throw new EspelhoError('Venda cancelada não é espelhada', 'VENDA_CANCELADA');
  if (venda.tipo_venda === 'troca') return { ignorado: true, motivo: 'Troca não é espelhada como documento interno' };
  // Transferência com nota pelo HeadCoach fica registrada SÓ no HeadCoach (Yago,
  // 11/11/2026): a API do TOTVS não finaliza transferência — o único serviço que
  // atende transação exige forma de recebimento ("Empty field Receipts").
  if (venda.pedido_info?.transferencia) return { ignorado: true, motivo: 'Transferência fica registrada só no HeadCoach (sem transação no TOTVS)' };
  if (cfg && cfg.espelhar_totvs === false && !forcar) return { ignorado: true, motivo: 'Espelho no TOTVS desligado para esta empresa' };
  if (venda.totvs_status === 4 && venda.totvs_transacao_code) {
    return { transactionCode: venda.totvs_transacao_code, transactionDate: venda.totvs_transacao_date, status: 4, docInternoSeq: venda.totvs_doc_interno_seq, jaEstava: true };
  }

  // Empresa do TOTVS que recebe o documento interno. No faturamento da
  // expedição a NF-e sai pela 99 e a transação vai para a 990, onde o
  // transaction-receiving da API funciona (pedido_info.empresaTotvs).
  const empresaTotvs = Number(venda.pedido_info?.empresaTotvs) || venda.empresa;
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
    // SUFRAMA: o ICMS desonerado saiu do total da NF-e; no documento interno vai como desconto da linha
    const desonPorSeq = venda.pedido_info?.suframa?.porItem || {};
    const linhas = itens.map((i) => ({
      productCode: Number(i.product_code),
      quantity: Number(i.quantidade),
      value: round2(i.valor_unit),
      descUnit: round2(i.desconto_unit || 0),
      desconSuframa: round2(desonPorSeq[i.seq] || 0),
      cfop: Number(i.cfop) || DOC_INTERNO_PADRAO.cfop,
    }));
    // Expedição: o documento interno não tem campo de frete e o recebimento
    // exige total = total da transação. O frete entra no valor de UMA peça
    // (separada em linha própria de 1 unidade) para o contas a receber bater
    // com o total da NF-e (produtos + frete).
    const frete = round2(venda.frete || 0);
    if (frete > 0 && linhas.length) {
      const k = linhas.reduce((m, it, idx) => (it.quantity * it.value > linhas[m].quantity * linhas[m].value ? idx : m), 0);
      const alvo = linhas[k];
      if (alvo.quantity > 1) {
        linhas.splice(k, 1, { ...alvo, quantity: alvo.quantity - 1 }, { ...alvo, quantity: 1, value: round2(alvo.value + frete) });
      } else {
        linhas[k] = { ...alvo, value: round2(alvo.value + frete) };
      }
    }
    // discountValue do TOTVS é o desconto DA LINHA (ele abate uma vez só), não o
    // de cada unidade: com 2+ peças iguais vai multiplicado pela quantidade.
    // Mandando o unitário, o TOTVS somava um total maior e recusava a transação
    // ("totalAmountCalculated different of TotalAmountTransaction" — FR1281, 11/11/2026).
    const items = linhas.map(({ descUnit, desconSuframa, ...it }) => {
      const desc = round2(descUnit * it.quantity + desconSuframa);
      return { ...it, ...(desc > 0 ? { discountValue: desc } : {}) };
    });
    const total = Number(items.reduce((s, it) => s + it.quantity * it.value - (it.discountValue || 0), 0).toFixed(3));
    const nota = notas.find((n) => n.status === 'autorizada') || notas[0];
    // "Transação com data diferente": a data real da venda vai em linha própria,
    // sempre no mesmo formato, para os relatórios acharem (VENDA DO DIA dd/mm/aaaa)
    const dv = String(venda.pedido_info?.dataVenda || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const observations = [
      ...(dv ? [{ observation: `VENDA DO DIA ${dv[3]}/${dv[2]}/${dv[1]}` }] : []),
      ...((venda.pedido_info?.transacoesAnteriores || []).length
        ? [{ observation: `SUBSTITUI A TRANSACAO ${venda.pedido_info.transacoesAnteriores.map((t) => t.code).join(', ')} (CANCELAR)`.slice(0, 80) }]
        : []),
      ...(venda.pedido_info?.transferencia
        ? [
            {
              observation: `TRANSF${venda.pedido_info.transferencia.ref ? ` ${venda.pedido_info.transferencia.ref}` : ''} ${venda.empresa}>${
                venda.pedido_info.transferencia.destinoCode ?? ''
              } ${venda.pedido_info.transferencia.destinoNome || ''}`
                .toUpperCase()
                .slice(0, OBS_MAX),
            },
            { observation: `TRANSF HEADCOACH #${venda.id} - DOC INTERNO (NF PELO HEADCOACH)`.slice(0, OBS_MAX) },
          ]
        : [
            ...(venda.numero_site ? [{ observation: `PEDIDO ${venda.numero_site} - FATURAMENTO EXPEDICAO HEADCOACH`.slice(0, 80) }] : []),
            { observation: `VENDA HEADCOACH #${venda.id} - DOC INTERNO (NF PELO HEADCOACH)`.slice(0, 80) },
          ]),
      ...(venda.pedido_info?.trocas || []).slice(0, 4).map((t) => ({
        observation: `TROCA NO FATURAMENTO: ${t.quantidade}X ${t.de} -> ${t.para} (MESMO VALOR)`.slice(0, 80),
      })),
      ...(Number(venda.pedido_info?.descontoFaturamento?.pct) > 0
        ? [
            {
              observation: `DESCONTO ${String(venda.pedido_info.descontoFaturamento.pct).replace('.', ',')}% NO FATURAMENTO${
                venda.pedido_info.descontoFaturamento.liberadoPor ? ` - LIBERADO POR ${venda.pedido_info.descontoFaturamento.liberadoPor}` : ''
              }`
                .toUpperCase()
                .slice(0, 80),
            },
          ]
        : []),
      ...((venda.pedido_info?.bonusUso || []).length
        ? [
            {
              observation: `SALDO BONUS HEADCOACH R$ ${round2(venda.pedido_info.bonusUso.reduce((s, u) => s + Number(u.valor || 0), 0)).toFixed(2)} (CREDITO DA VENDA ${[
                ...new Set(venda.pedido_info.bonusUso.map((u) => `#${u.vendaOrigem}`)),
              ].join(' ')})`.slice(0, 80),
            },
          ]
        : []),
      ...(venda.pedido_info?.creditoFalta?.valor > 0
        ? [{ observation: `PECA EM FALTA: R$ ${round2(venda.pedido_info.creditoFalta.valor).toFixed(2)} VIROU SALDO BONUS DO CLIENTE`.slice(0, 80) }]
        : []),
      ...(round2(venda.frete || 0) > 0 ? [{ observation: `FRETE R$ ${round2(venda.frete).toFixed(2)} INCLUSO NO VALOR DOS ITENS`.slice(0, 80) }] : []),
      ...(nota ? [{ observation: `${Number(nota.modelo) === 65 ? 'NFC-E' : 'NF-E'} ${nota.numero}/${nota.serie} ${nota.status.toUpperCase()}`.slice(0, 80) }] : []),
      ...(nota?.chave ? [{ observation: `CHAVE ${nota.chave}`.slice(0, 80) }] : []),
    ];
    // O TOTVS recusa linha de observação com mais de 60 caracteres, embora a
    // mensagem dele fale em 80 ("exceed the limit size of 80 characters"): em
    // 11/11/2026 as transferências 51 (linhas de 60 e 61) e 53 (63 e 61) voltaram
    // com 1 e 2 erros desse, enquanto as vendas (até 53) sempre passaram.
    for (const o of observations) o.observation = String(o.observation).slice(0, OBS_MAX);
    const payload = {
      branchCode: empresaTotvs,
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
      console.log(`🪞 [Espelho TOTVS] venda ${venda.id} → transação ${empresaTotvs}/${transactionCode} (op ${operacao}, doc interno)`);
    } catch (err) {
      const t = traduzirErroTotvs(err);
      await gravar(vendaId, { totvs_erro: `transação: ${t.message}` });
      throw new EspelhoError(`TOTVS recusou a transação: ${t.message}`, t.code, err.response?.status || 502, err.response?.data);
    }
  }

  // A transação pode ter sido encerrada/recebida na mão no TOTVS (TRAFP005):
  // nesse caso não há o que receber, só registrar que está ATENDIDA.
  if (venda.totvs_transacao_code) {
    try {
      const r = await callTotvs('get', `${TOTVS_BASE_URL}/general/v2/transactions/search`, {
        params: { BranchCodeList: empresaTotvs, TransactionCodeList: transactionCode, TransactionDate: transactionDate, Page: 1, PageSize: 1 },
        timeout: 60000,
      });
      const st = r.data?.items?.[0]?.status;
      if (st === 4) {
        const seq = await buscarDocInterno(empresaTotvs, transactionCode, transactionDate);
        await gravar(vendaId, { totvs_status: 4, totvs_doc_interno_seq: seq, totvs_espelhado_em: new Date().toISOString(), totvs_erro: null });
        console.log(`✅ [Espelho TOTVS] venda ${venda.id}: transação ${transactionCode} já estava ATENDIDA no TOTVS (fechada por lá)`);
        return { transactionCode, transactionDate, status: 4, docInternoSeq: seq, jaEstava: true, fechadaNoTotvs: true };
      }
      if (st === 6) {
        await gravar(vendaId, { totvs_status: 6, totvs_erro: 'transação cancelada no TOTVS' });
        throw new EspelhoError(`A transação ${transactionCode} foi cancelada no TOTVS — troque a operação no "Tentar de novo" para abrir outra`, 'TRANSACAO_CANCELADA');
      }
    } catch (err) {
      if (err instanceof EspelhoError) throw err;
      /* consulta falhou: segue para o recebimento */
    }
  }

  // 2) Recebimento → ATENDIDA (exige caixa aberto no terminal)
  const notaOk = notas.find((n) => n.status === 'autorizada');
  // Vendas com portador de cartão definido (expedição = Pagar.me): operadora e
  // bandeira saem do cadastro do TOTVS, no texto exato
  const portadoresCartao = venda.pedido_info?.cartaoTotvs?.portadores || (venda.pedido_info?.cartaoTotvs ? PORTADORES_PAGARME : null);
  if (!venda.pedido_info?.receberComoFatura) {
    for (const p of pagamentos) {
      if (p.forma !== 'credito' && p.forma !== 'debito') continue;
      // escolhido na tela (Operadora + Parcelamento do cadastro do TOTVS)
      if (p.cartao_totvs?.operadora && p.cartao_totvs?.bandeira) {
        p.cartaoCadastro = { operadora: String(p.cartao_totvs.operadora), bandeira: String(p.cartao_totvs.bandeira), seq: p.cartao_totvs.seq };
        continue;
      }
      if (!portadoresCartao) continue;
      try {
        p.cartaoCadastro = await resolverCartaoNoCadastro(p.forma, p.parcelas, portadoresCartao);
      } catch (err) {
        await gravar(vendaId, { totvs_erro: `recebimento: ${err.message}` });
        throw err;
      }
    }
  }
  const receipts = montarRecebimentos(pagamentos, transactionCode, transactionDate, {
    parcelasBoleto: venda.cobranca?.parcelas || [],
    documento: notaOk?.numero || null,
    comoFatura: !!venda.pedido_info?.receberComoFatura,
    cartaoTotvs: venda.pedido_info?.cartaoTotvs || null,
    pixId: venda.pedido_info?.pix || null,
  });
  const totalAmount = round2(receipts.reduce((s, r) => s + r.documentAmount, 0));
  try {
    await callTotvs('post', `${TOTVS_BASE_URL}/general/v2/transaction-receiving`, {
      data: { branchCode: empresaTotvs, transactionCode, transactionDate, totalAmount, terminalCode: terminal, receipts },
      timeout: 180000,
    });
  } catch (err) {
    const t = traduzirErroTotvs(err);
    await gravar(vendaId, { totvs_erro: `recebimento: ${t.message}` });
    throw new EspelhoError(t.message, t.code, err.response?.status || 502, err.response?.data);
  }
  const docInternoSeq = await buscarDocInterno(empresaTotvs, transactionCode, transactionDate);
  await gravar(vendaId, { totvs_status: 4, totvs_doc_interno_seq: docInternoSeq, totvs_espelhado_em: new Date().toISOString(), totvs_erro: null });
  console.log(`✅ [Espelho TOTVS] venda ${venda.id} recebida no TOTVS: transação ${transactionCode} ATENDIDA, doc interno ${docInternoSeq ?? '?'}, R$ ${totalAmount.toFixed(2)}`);
  return { transactionCode, transactionDate, status: 4, docInternoSeq, totalAmount };
}
