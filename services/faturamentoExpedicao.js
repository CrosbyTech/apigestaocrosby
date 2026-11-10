// ============================================================================
// FATURAMENTO DA EXPEDIÇÃO — NF-e pelo HeadCoach + documento interno no TOTVS
// Tela: Expedição → Faturamento (/expedicao/faturamento?chave=).
//
// O pedido separado (Dryland) vira uma venda do PDV Crosby (pdv_vendas,
// origem 'expedicao', empresa 99) com as peças conferidas no portal RFID:
//   1) grava a venda, as peças e os EPCs (kardex pdv_epc_movimentos)
//   2) confere a numeração da série com a última NF-e do TOTVS (mesma série 3)
//   3) emite a NF-e (services/pdvFiscal.js, gabarito copiado das notas do TOTVS)
//   4) espelha no TOTVS como DOCUMENTO INTERNO (511/7807/7808/7809, modelo 35)
//      + recebimento → contas a receber com as parcelas do pedido
//      (services/pdvEspelhoTotvs.js; exige caixa aberto no terminal na data)
//   5) registra tudo em pedidos_venda_faturamentos (aba Transações)
// ============================================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, httpAgent, TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';
import {
  FiscalError,
  buscarConfig,
  buscarEmitente,
  buscarClienteFiscal,
  buscarProdutoFiscal,
  buscarTransportadora,
  tiposFiscais,
  cenarioExpedicao,
  cfopExpedicao,
  ICMS_DIFAL_UF_CONFERIDA,
} from './pdvFiscal.js';
import { espelharVendaNoTotvs } from './pdvEspelhoTotvs.js';
import { emitirVendaPdv, registrarEpcs, carregarVenda } from '../routes/pdvCrosby.routes.js';
import { COMPROVANTE_URL } from './pedidosVendaDryland.js';

export const EMPRESA_FATURAMENTO = 99;

// Documento interno no TOTVS (saída, financeira, modelo 35) por canal
export const OPERACAO_DOC_INTERNO = { varejo: 511, franquias: 7807, mtm: 7808, revenda: 7809 };
// Operação "oficial" de referência (só informativa na venda do HeadCoach)
const OPERACAO_VENDA = { varejo: 545, franquias: 7234, mtm: 7235, revenda: 7236 };

// Transportadoras (código da pessoa no TOTVS, conferido nas NF-e da 99)
export const TRANSPORTADORAS = [
  { id: 'CORREIOS', code: 6568, label: 'Correios' },
  { id: 'LATAM', code: 5786, label: 'LATAM' },
  { id: 'AZUL', code: 20171, label: 'Azul' },
  { id: 'BEE', code: 15926, label: 'BEE Tecnologia' }, // 15926 conferido no cadastro (5926 é outra pessoa)
  { id: 'BARAUNAS', code: 27773, label: 'Baraúnas Entregas' },
  { id: 'TANCREDO', code: 71042, label: 'Taxista Tancredo Lucio' },
  { id: 'JACKSON', code: 33861, label: 'Taxista Jackson Luis' },
  { id: 'TAXISTA', code: null, label: 'Outro (pesquisar no TOTVS)' },
  { id: 'RETIRADA', code: null, label: 'Retirada (sem transportadora)' },
];

export class FaturamentoError extends Error {
  constructor(message, code = 'FATURAMENTO', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const texto = (v) => (v == null || String(v).trim() === '' || /^0+$/.test(String(v).trim()) ? null : String(v).trim());

async function callTotvs(method, url, { data, params, timeout } = {}) {
  const tk = await getToken();
  const go = (token) =>
    axios({ method, url, data, params, httpsAgent, httpAgent, timeout: timeout ?? 60000, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
  try {
    return await go(tk.access_token);
  } catch (err) {
    if (err.response?.status === 401) return go((await getToken(true)).access_token);
    throw err;
  }
}

// ─── Numeração: a série é a mesma do TOTVS, então o próximo número tem que
// passar da última NF-e que o TOTVS emitiu nela ─────────────────────────────
export async function ultimaNotaTotvs(empresa, serie) {
  const fim = new Date();
  const ini = new Date(fim.getTime() - 20 * 864e5);
  const iso = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(d);
  let max = 0;
  for (let page = 1; page <= 20; page++) {
    const r = await callTotvs('post', `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`, {
      data: { filter: { branchCodeList: [Number(empresa)], change: { startDate: `${iso(ini)}T00:00:00`, endDate: `${iso(fim)}T23:59:59` } }, page, pageSize: 100 },
      timeout: 120000,
    });
    for (const n of r.data?.items || []) {
      if (Number(n.documentType) === 55 && String(n.serialCode) === String(serie) && n.origin === 'Own') max = Math.max(max, Number(n.invoiceCode) || 0);
    }
    if (!r.data?.hasNext) break;
  }
  return max;
}

async function acertarNumeracao(empresa) {
  const cfg = await buscarConfig(empresa);
  const ultTotvs = await ultimaNotaTotvs(empresa, cfg.serie_nfe);
  if (ultTotvs >= Number(cfg.prox_num_nfe)) {
    await supabase.from('pdv_fiscal_config').update({ prox_num_nfe: ultTotvs + 1 }).eq('empresa', empresa);
    console.log(`🔢 [Faturamento] empresa ${empresa} série ${cfg.serie_nfe}: TOTVS já usou até ${ultTotvs} → próximo HeadCoach ${ultTotvs + 1}`);
    return { proximo: ultTotvs + 1, ultimaTotvs: ultTotvs, ajustado: true };
  }
  return { proximo: Number(cfg.prox_num_nfe), ultimaTotvs: ultTotvs, ajustado: false };
}

// ─── Pedido do Dryland → sugestões para a tela ───────────────────────────────
function mapearTransportadora(d) {
  const t = String(d.transportadora || d.frete_opcao?.transportadora || d.forma_envio || '').toUpperCase();
  if (/RETIRADA/.test(t) || !t) return 'RETIRADA';
  for (const x of TRANSPORTADORAS) if (t.includes(x.id)) return x.id;
  if (/TAXI/.test(t)) return 'TAXISTA';
  if (/SEDEX|PAC|CORREIO/.test(t)) return 'CORREIOS';
  return 'RETIRADA';
}

// forma do card (texto livre) → formas do HeadCoach
function mapearFormas(forma) {
  const f = String(forma || '').toUpperCase();
  const out = [];
  if (/BOLETO/.test(f)) out.push('boleto');
  if (/CREDEV|CREDITO_LV/.test(f)) out.push('credito_loja');
  if (/PIX/.test(f)) out.push('pix');
  if (/DEBITO|DÉBITO/.test(f)) out.push('debito');
  else if (/CART/.test(f)) out.push('credito');
  if (/DINHEIRO/.test(f)) out.push('dinheiro');
  return out;
}

export function parcelasIguais(total, n, vencimentos) {
  const qtd = Math.max(1, Number(n) || vencimentos.length || 1);
  const parc = round2(total / qtd);
  return Array.from({ length: qtd }, (_, i) => ({
    n: i + 1,
    vencimento: vencimentos[i] || null,
    valor: i === qtd - 1 ? round2(total - parc * (qtd - 1)) : parc,
  }));
}

export async function prepararFaturamento(chave) {
  let card = null;
  let ref = null;
  if (String(chave).startsWith('SEP:')) ref = String(chave).slice(4).toUpperCase();
  else {
    const { data } = await supabase.from('pedidos_venda_fila').select('*').eq('id', chave).maybeSingle();
    if (!data) throw new FaturamentoError('Pedido não encontrado', 'NOT_FOUND', 404);
    card = data;
    ref = data.numero_site;
  }
  const { data: sep } = ref ? await supabase.from('pedidos_venda_dryland').select('*').eq('ref', ref).maybeSingle() : { data: null };
  const d = card?.dados || {};
  const canalSep = { revenda: 'revenda', varejo: 'varejo', multimarca: 'mtm', franquia: 'franquias' }[sep?.canal];
  const canal = card?.canal || canalSep || 'revenda';

  const clienteCode = parseInt(d.codigo_cliente, 10) || null;
  let cliente = null;
  let clienteErro = null;
  if (clienteCode) {
    try {
      cliente = await buscarClienteFiscal(clienteCode);
    } catch (e) {
      clienteErro = e.message;
    }
  }
  const emit = await buscarEmitente(EMPRESA_FATURAMENTO);
  const cenario = cliente ? cenarioExpedicao({ emitUf: emit.uf, cliente }) : null;

  // transporte
  const transpId = mapearTransportadora(d);
  const fo = d.frete_opcao || {};
  const frete = round2(Number(String(d.valor_frete ?? fo.total ?? 0).replace(',', '.')) || 0);

  // pagamento
  const formas = mapearFormas(d.forma_pagamento || sep?.pagamento);
  const bol = d.boleto_faturado && typeof d.boleto_faturado === 'object' ? d.boleto_faturado : null;
  const nParc = parseInt(String(d.parcelamento || bol?.parcelas || '').replace(/\D/g, ''), 10) || (bol?.vencimentos?.length ?? 1);

  let numeracao = null;
  try {
    const cfg = await buscarConfig(EMPRESA_FATURAMENTO);
    numeracao = { serie: cfg.serie_nfe, proximo: cfg.prox_num_nfe, ambiente: cfg.ambiente };
  } catch (e) {
    numeracao = { erro: e.message };
  }

  return {
    chave,
    ref,
    canal,
    empresa: EMPRESA_FATURAMENTO,
    emitente: { uf: emit.uf, cnpj: emit.cnpj, nome: emit.xNome },
    cliente: cliente
      ? { code: cliente.code, nome: cliente.nome, cpf: cliente.cpf, cnpj: cliente.cnpj, ie: cliente.ie, uf: cliente.endereco?.UF, cidade: cliente.endereco?.xMun, temEndereco: !!cliente.endereco?.cMun }
      : clienteCode
        ? { code: clienteCode, nome: d.nome_cliente || sep?.cliente, erro: clienteErro || 'cliente não encontrado no TOTVS' }
        : null,
    cenario,
    difalConferido: ICMS_DIFAL_UF_CONFERIDA,
    vendedorCode: sep?.vendedor_code || parseInt(d.cod_vendedor, 10) || null,
    operacaoDocInterno: OPERACAO_DOC_INTERNO[canal] || 511,
    operacoesDocInterno: OPERACAO_DOC_INTERNO,
    transporte: {
      id: transpId,
      code: TRANSPORTADORAS.find((t) => t.id === transpId)?.code || null,
      servico: d.envio_correios || fo.servico || null,
      frete,
      pesoB: Number(fo.caixa?.peso) || 0,
      volumes: transpId === 'RETIRADA' ? 0 : 1,
      modFrete: frete > 0 ? 1 : 0,
    },
    transportadoras: TRANSPORTADORAS,
    pagamento: {
      formas,
      formaTexto: d.forma_pagamento || sep?.pagamento || null,
      parcelas: nParc,
      vencimentos: bol?.vencimentos || [],
      nsu: texto(d.cartao_nsu) || texto(sep?.pagamento_info?.nsu),
      autorizacao: texto(d.cartao_autorizacao) || texto(sep?.pagamento_info?.autorizacao),
      bandeira: texto(d.cartao_bandeira) || texto(sep?.pagamento_info?.bandeira),
      pix: texto(d.pix_e2e) || texto(sep?.pagamento_info?.end_to_end_id),
      credev: texto(d.credev) && !/^n(ã|a)o$/i.test(d.credev) ? d.credev : null,
    },
    comprovantes: (card?.comprovantes || []).map((p) => ({ path: p, url: COMPROVANTE_URL(p) })),
    jaNoTotvs: [d.transacao && `transação ${d.transacao}`, d.pedido_totvs && `pedido ${d.pedido_totvs}`].filter(Boolean),
    numeracao,
  };
}

// CFOP de cada item para a tela (antes de emitir)
export async function previaFiscal({ clienteCode, consumidorFinal = false, itens }) {
  const emit = await buscarEmitente(EMPRESA_FATURAMENTO);
  const cliente = clienteCode ? await buscarClienteFiscal(clienteCode) : null;
  if (!cliente) throw new FaturamentoError('Cliente não encontrado no TOTVS', 'CLIENTE');
  const cen = cenarioExpedicao({ emitUf: emit.uf, cliente, consumidorFinal });
  const tipos = await tiposFiscais(EMPRESA_FATURAMENTO, (itens || []).map((i) => ({ product_code: i.productCode, referencia: i.referencia })));
  return {
    cenario: cen,
    cliente: { code: cliente.code, nome: cliente.nome, cpf: cliente.cpf, cnpj: cliente.cnpj, ie: cliente.ie, uf: cliente.endereco?.UF, cidade: cliente.endereco?.xMun, temEndereco: !!cliente.endereco?.cMun },
    difalOk: !cen.difal || ICMS_DIFAL_UF_CONFERIDA[cen.destUf] != null,
    aliqDifal: cen.difal ? ICMS_DIFAL_UF_CONFERIDA[cen.destUf] ?? null : null,
    itens: (itens || []).map((i) => {
      const tipo = tipos.get(Number(i.productCode)) || 'producao';
      return { productCode: i.productCode, tipo, cfop: cfopExpedicao(cen.chave, tipo) };
    }),
  };
}

// ─── FATURAR ─────────────────────────────────────────────────────────────────
// body: { chave, numeroSite, canal, clienteCode, vendedorCode, operacaoDocInterno,
//   consumidorFinal, dataCaixa, itens:[{ productCode, quantidade, valorUnit, epcs[] }],
//   transporte:{ code, servico, frete, modFrete, volumes, pesoB, pesoL },
//   pagamentos:[{ forma, valor, parcelas, nsu, autorizacao, bandeira }],
//   vencimentos:[…] (boleto), comprovantes:[{url,path}], pedidoInfo:{…},
//   faltando:[…], sobrando:[…], qtdPedido, por }
export async function faturar(body) {
  const empresa = EMPRESA_FATURAMENTO;
  const b = body || {};
  if (!b.chave) throw new FaturamentoError('Pedido sem chave');
  if (!b.clienteCode) throw new FaturamentoError('Escolha o cliente');
  if (!b.vendedorCode) throw new FaturamentoError('Escolha o vendedor');
  if (!Array.isArray(b.itens) || !b.itens.length) throw new FaturamentoError('Nenhuma peça conferida');
  const operacaoDocInterno = Number(b.operacaoDocInterno);
  if (!Object.values(OPERACAO_DOC_INTERNO).includes(operacaoDocInterno)) throw new FaturamentoError('Operação de documento interno inválida');

  // Itens + dados fiscais + produção/adquirido
  const emit = await buscarEmitente(empresa);
  const cliente = await buscarClienteFiscal(b.clienteCode);
  if (!cliente) throw new FaturamentoError(`Cliente ${b.clienteCode} não encontrado no TOTVS`, 'CLIENTE');
  const cen = cenarioExpedicao({ emitUf: emit.uf, cliente, consumidorFinal: !!b.consumidorFinal });
  const itens = [];
  let seq = 1;
  for (const it of b.itens) {
    const q = Number(it.quantidade);
    const vUn = round2(it.valorUnit);
    // desconto por unidade (rateio do desconto do pedido / Pix); a tela agrupa
    // as unidades por (preço, desconto), então q × desconto é exato
    const dUn = round2(it.descontoUnit || 0);
    if (!(q > 0) || !(vUn > 0)) throw new FaturamentoError(`Item ${it.productCode}: quantidade/valor inválidos`);
    if (dUn < 0 || dUn >= vUn) throw new FaturamentoError(`Item ${it.productCode}: desconto inválido`);
    const pf = await buscarProdutoFiscal(it.productCode, empresa);
    itens.push({
      seq: seq++,
      product_code: Number(it.productCode),
      sku: pf.sku,
      nome: String(pf.nome || it.nome || `Produto ${it.productCode}`).slice(0, 200),
      referencia: pf.referencia,
      ncm: pf.ncm,
      cest: pf.cest,
      origem: pf.origem,
      unidade: pf.unidade,
      quantidade: q,
      valor_unit: vUn,
      desconto_unit: dUn,
      total: round2(q * (vUn - dUn)),
      epcs: Array.isArray(it.epcs) ? it.epcs : [],
    });
  }
  const tipos = await tiposFiscais(empresa, itens);
  for (const it of itens) {
    it.tipo_fiscal = tipos.get(it.product_code) || 'producao';
    it.cfop = cfopExpedicao(cen.chave, it.tipo_fiscal);
  }
  const subtotal = round2(itens.reduce((s, i) => s + i.quantidade * i.valor_unit, 0));
  const descontoTotal = round2(itens.reduce((s, i) => s + i.quantidade * i.desconto_unit, 0));
  const liquido = round2(subtotal - descontoTotal);
  const qtd = itens.reduce((s, i) => s + i.quantidade, 0);

  // Transporte
  const t = b.transporte || {};
  const frete = round2(t.frete || 0);
  let transporte = null;
  if (t.code) {
    const tr = await buscarTransportadora(t.code);
    transporte = {
      code: tr.code,
      nome: tr.nome,
      cnpj: tr.cnpj,
      cpf: tr.cpf,
      ie: tr.ie,
      xEnder: tr.xEnder,
      xMun: tr.xMun,
      uf: tr.uf,
      servico: t.servico || null,
      modFrete: [0, 1, 2].includes(Number(t.modFrete)) ? Number(t.modFrete) : frete > 0 ? 1 : 0,
      volumes: Number(t.volumes) >= 0 ? Number(t.volumes) : 1,
      pesoB: Number(t.pesoB) || 0,
      pesoL: Number(t.pesoL) || 0,
    };
  } else if (frete > 0) {
    throw new FaturamentoError('Frete informado sem transportadora');
  }
  const total = round2(liquido + frete);

  // Pagamentos (fecham com produtos + frete)
  const pagamentos = [];
  for (const p of b.pagamentos || []) {
    const forma = String(p.forma || '').toLowerCase();
    const valor = round2(p.valor);
    if (!['dinheiro', 'pix', 'credito', 'debito', 'credito_loja', 'boleto'].includes(forma)) throw new FaturamentoError(`Forma de pagamento inválida: ${p.forma}`);
    if (!(valor > 0)) continue;
    pagamentos.push({
      forma,
      valor,
      parcelas: forma === 'credito' || forma === 'boleto' ? Math.max(1, parseInt(p.parcelas, 10) || 1) : 1,
      bandeira: p.bandeira ? String(p.bandeira).toLowerCase() : null,
      nsu: texto(p.nsu),
      autorizacao: texto(p.autorizacao),
      adquirente_cnpj: null,
      troco: 0,
    });
  }
  if (!pagamentos.length) throw new FaturamentoError('Informe o pagamento');
  const somaPag = round2(pagamentos.reduce((s, p) => s + p.valor, 0));
  if (Math.abs(somaPag - total) > 0.01) {
    throw new FaturamentoError(
      `Pagamentos (R$ ${somaPag.toFixed(2)}) não fecham com o total (R$ ${total.toFixed(2)} = produtos ${subtotal.toFixed(2)} − desconto ${descontoTotal.toFixed(2)} + frete ${frete.toFixed(2)})`,
      'PAYMENT_MISMATCH',
    );
  }
  let cobranca = null;
  const pBol = pagamentos.find((p) => p.forma === 'boleto');
  if (pBol) {
    const venc = (b.vencimentos || []).map((v) => String(v || '').slice(0, 10));
    const parcelas = parcelasIguais(pBol.valor, pBol.parcelas, venc);
    if (parcelas.some((x) => !/^\d{4}-\d{2}-\d{2}$/.test(String(x.vencimento || '')))) throw new FaturamentoError('Informe o vencimento de cada parcela do boleto');
    cobranca = { parcelas };
  }

  // Venda do HeadCoach
  // A transação do TOTVS sai SEMPRE com a data de hoje: a API só recebe com
  // caixa aberto na data corrente. Venda de outro dia ("transação com data
  // diferente") leva a data real só na observação: VENDA DO DIA dd/mm/aaaa.
  const dataCaixa = hojeBrasil();
  const dataVenda = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dataVenda || '')) && b.dataVenda !== dataCaixa ? b.dataVenda : null;
  const cabecalho = {
    empresa,
    empresa_cnpj: emit.cnpj,
    empresa_nome: emit.xNome,
    tipo_venda: 'nfe',
    operacao: OPERACAO_VENDA[b.canal] || null,
    cliente_code: cliente.code,
    cliente_nome: cliente.nome,
    cliente_cpf_cnpj: cliente.cnpj || cliente.cpf,
    vendedor_code: Number(b.vendedorCode),
    vendedor_nome: b.vendedorNome || null,
    qtd_pecas: qtd,
    subtotal,
    desconto: descontoTotal,
    cashback_usado: 0,
    total,
    status: 'registrada',
    observacao: b.observacao || null,
    criado_por: b.por || null,
    origem: 'expedicao',
    canal: b.canal || null,
    pedido_chave: b.chave,
    numero_site: b.numeroSite || null,
    data_caixa: dataCaixa,
    operacao_doc_interno: operacaoDocInterno,
    frete,
    transporte,
    cobranca,
    comprovantes: Array.isArray(b.comprovantes) ? b.comprovantes : [],
    pedido_info: {
      ...(b.pedidoInfo || {}),
      consumidorFinal: !!b.consumidorFinal,
      terminal: Number(b.terminal) > 0 ? Number(b.terminal) : null,
      receberComoFatura: !!b.receberComoFatura,
      dataVenda,
    },
  };
  const { data: venda, error } = await supabase.from('pdv_vendas').insert(cabecalho).select().single();
  if (error) throw new FaturamentoError(error.message, 'DB_ERROR', 500);
  const { data: itensGravados, error: e1 } = await supabase.from('pdv_venda_itens').insert(itens.map((i) => ({ ...i, venda_id: venda.id }))).select();
  const { error: e2 } = await supabase.from('pdv_venda_pagamentos').insert(pagamentos.map((p) => ({ ...p, venda_id: venda.id })));
  if (e1 || e2) {
    await supabase.from('pdv_vendas').delete().eq('id', venda.id);
    throw new FaturamentoError((e1 || e2).message, 'DB_ERROR', 500);
  }
  await registrarEpcs({ venda, itens: itensGravados || [], tipo: 'venda' });

  // Registro do faturamento (aba Transações) — atualizado a cada etapa
  const { data: fat } = await supabase
    .from('pedidos_venda_faturamentos')
    .insert({
      chave: b.chave,
      numero_site: b.numeroSite || null,
      empresa,
      venda_id: venda.id,
      operacao: operacaoDocInterno,
      cfop: itens[0]?.cfop || null,
      total,
      frete,
      forma_pagamento: pagamentos.map((p) => p.forma).join(' + '),
      cliente_code: cliente.code,
      cliente_nome: cliente.nome,
      vendedor_code: Number(b.vendedorCode),
      qtd_pedido: Number(b.qtdPedido) || qtd,
      qtd_conferida: qtd,
      qtd_faltando: (b.faltando || []).reduce((s, x) => s + (Number(x.quantidade) || 0), 0),
      qtd_sobrando: (b.sobrando || []).reduce((s, x) => s + (Number(x.quantidade) || 0), 0),
      conferidos: itens.map((i) => ({ productCode: i.product_code, name: i.nome, quantidade: i.quantidade, unit: i.valor_unit, desconto: i.desconto_unit, total: i.total, cfop: i.cfop, epcs: i.epcs })),
      faltando: b.faltando || [],
      sobrando: b.sobrando || [],
      criado_por: b.por || null,
      nf_status: 'registrada',
    })
    .select('id')
    .single();

  return processarFaturamento(venda.id, fat?.id);
}

// Emite (se ainda não autorizada) e espelha no TOTVS (se ainda não espelhado).
// Também serve para "tentar de novo" depois de rejeição ou caixa fechado.
// opcoes.terminal: troca o terminal do recebimento antes de tentar de novo
export async function processarFaturamento(vendaId, faturamentoId = null, opcoes = {}) {
  if (Number(opcoes.terminal) > 0 || typeof opcoes.comoFatura === 'boolean') {
    const { data: atual } = await supabase.from('pdv_vendas').select('pedido_info').eq('id', vendaId).maybeSingle();
    const info = { ...(atual?.pedido_info || {}) };
    if (Number(opcoes.terminal) > 0) info.terminal = Number(opcoes.terminal);
    if (typeof opcoes.comoFatura === 'boolean') info.receberComoFatura = opcoes.comoFatura;
    await supabase.from('pdv_vendas').update({ pedido_info: info }).eq('id', vendaId);
  }
  let fatId = faturamentoId;
  if (!fatId) {
    const { data } = await supabase.from('pedidos_venda_faturamentos').select('id').eq('venda_id', vendaId).maybeSingle();
    fatId = data?.id || null;
  }
  // Trocar a operação do documento interno: a API não altera a operação de uma
  // transação existente, então abre OUTRA transação (data de hoje) para a mesma
  // venda. A anterior fica "em andamento" no TOTVS, anotada para ser cancelada.
  const opNova = Number(opcoes.operacaoDocInterno);
  if (opNova && Object.values(OPERACAO_DOC_INTERNO).includes(opNova)) {
    const { data: v0 } = await supabase.from('pdv_vendas').select('operacao_doc_interno, totvs_transacao_code, totvs_status, pedido_info').eq('id', vendaId).maybeSingle();
    if (v0 && v0.totvs_status !== 4 && Number(v0.operacao_doc_interno) !== opNova) {
      const info = { ...(v0.pedido_info || {}) };
      if (v0.totvs_transacao_code) info.transacoesAnteriores = [...(info.transacoesAnteriores || []), { code: v0.totvs_transacao_code, operacao: v0.operacao_doc_interno }];
      await supabase
        .from('pdv_vendas')
        .update({ operacao_doc_interno: opNova, totvs_transacao_code: null, totvs_transacao_date: null, totvs_status: null, totvs_erro: null, data_caixa: hojeBrasil(), pedido_info: info })
        .eq('id', vendaId);
      if (fatId) await supabase.from('pedidos_venda_faturamentos').update({ operacao: opNova, transacao_code: null, transacao_date: null, transacao_status: 1 }).eq('id', fatId);
      console.log(`🔁 [Faturamento] venda ${vendaId}: operação do documento interno ${v0.operacao_doc_interno} → ${opNova} (nova transação; anterior ${v0.totvs_transacao_code ?? '—'})`);
    }
  }
  const atualizar = async (patch) => {
    if (fatId) await supabase.from('pedidos_venda_faturamentos').update({ ...patch, atualizado_em: new Date().toISOString() }).eq('id', fatId);
  };

  // 1) NF-e
  let venda = await carregarVenda(vendaId);
  if (!venda) throw new FaturamentoError('Venda não encontrada', 'NOT_FOUND', 404);
  let nota = venda.notas.find((n) => n.status === 'autorizada') || null;
  let fiscal = { ok: !!nota };
  if (!nota) {
    try {
      const num = await acertarNumeracao(venda.empresa);
      const r = await emitirVendaPdv(vendaId);
      nota = r.dados?.nota || null;
      fiscal = { ok: r.status === 200, mensagem: r.mensagem, numeracao: num };
    } catch (err) {
      fiscal = { ok: false, mensagem: err.message, code: err.code };
    }
    venda = await carregarVenda(vendaId);
    nota = venda.notas.find((n) => n.status === 'autorizada') || venda.notas[0] || nota;
  }
  await atualizar({ nf_numero: nota?.numero ?? null, nf_serie: nota?.serie ?? null, nf_chave: nota?.chave ?? null, nf_status: nota?.status || (fiscal.ok ? 'autorizada' : 'erro') });
  if (!fiscal.ok && nota?.status !== 'autorizada') {
    return { vendaId, faturamentoId: fatId, venda, nota, fiscal, totvs: { ok: false, mensagem: 'aguardando a NF-e ser autorizada' } };
  }

  // 2) Documento interno + contas a receber no TOTVS
  let totvs;
  try {
    const r = await espelharVendaNoTotvs(vendaId, { forcar: true });
    totvs = { ok: true, ...r };
    await atualizar({ transacao_code: r.transactionCode, transacao_date: r.transactionDate, transacao_status: r.status || 4, totvs_erro: null, ...(r.status === 4 ? { atendida_em: new Date().toISOString() } : {}) });
  } catch (err) {
    totvs = { ok: false, mensagem: err.message, code: err.code };
    const v = await carregarVenda(vendaId);
    await atualizar({ totvs_erro: err.message, ...(v?.totvs_transacao_code ? { transacao_code: v.totvs_transacao_code, transacao_date: v.totvs_transacao_date, transacao_status: v.totvs_status || 1 } : {}) });
  }
  venda = await carregarVenda(vendaId);
  return { vendaId, faturamentoId: fatId, venda, nota, fiscal, totvs };
}

// ─── Aba Transações ─────────────────────────────────────────────────────────
export async function listarTransacoes({ de, ate, busca, limite = 300 } = {}) {
  let q = supabase.from('pedidos_venda_faturamentos').select('*').not('venda_id', 'is', null).order('criado_em', { ascending: false }).limit(Math.min(Number(limite) || 300, 1000));
  if (de) q = q.gte('criado_em', `${String(de).slice(0, 10)}T00:00:00-03:00`);
  if (ate) q = q.lte('criado_em', `${String(ate).slice(0, 10)}T23:59:59-03:00`);
  const { data, error } = await q;
  if (error) throw new FaturamentoError(error.message, 'DB_ERROR', 500);
  let lista = data || [];
  const ids = lista.map((f) => f.venda_id);
  if (ids.length) {
    const [{ data: vendas }, { data: notas }] = await Promise.all([
      supabase.from('pdv_vendas').select('id, status, data_caixa, canal, transporte, frete, comprovantes, totvs_status, totvs_transacao_code, totvs_erro, vendedor_nome, criado_por, numero_site, pedido_info').in('id', ids),
      supabase.from('pdv_notas_fiscais').select('id, venda_id, numero, serie, chave, status, protocolo, dh_autorizacao, xmotivo, cstat').in('venda_id', ids).order('id', { ascending: false }),
    ]);
    const vPor = new Map((vendas || []).map((v) => [v.id, v]));
    const nPor = new Map();
    for (const n of notas || []) if (!nPor.has(n.venda_id) || n.status === 'autorizada') nPor.set(n.venda_id, n);
    lista = lista.map((f) => ({ ...f, venda: vPor.get(f.venda_id) || null, nota: nPor.get(f.venda_id) || null }));
  }
  const t = String(busca || '').trim().toUpperCase();
  if (t) {
    lista = lista.filter((f) =>
      [f.numero_site, f.cliente_nome, f.nf_numero, f.nf_chave, f.transacao_code, f.criado_por, f.forma_pagamento].filter(Boolean).some((v) => String(v).toUpperCase().includes(t)),
    );
  }
  return lista;
}

export async function detalheTransacao(faturamentoId) {
  const { data: fat } = await supabase.from('pedidos_venda_faturamentos').select('*').eq('id', faturamentoId).maybeSingle();
  if (!fat) throw new FaturamentoError('Transação não encontrada', 'NOT_FOUND', 404);
  const venda = fat.venda_id ? await carregarVenda(fat.venda_id) : null;
  const { data: kardex } = fat.venda_id
    ? await supabase.from('pdv_epc_movimentos').select('epc, tipo, product_code, produto_nome, valor_unit, ocorrido_em').eq('venda_id', fat.venda_id).order('product_code')
    : { data: [] };
  return { faturamento: fat, venda, kardex: kardex || [] };
}
