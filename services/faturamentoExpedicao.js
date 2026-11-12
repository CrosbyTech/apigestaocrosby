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
//      (services/pdvEspelhoTotvs.js; exige caixa aberto no terminal na data).
//      A transação do TOTVS vai para a EMPRESA 990, não para a 99: nas empresas
//      que emitem nota (99, 95, 55) o transaction-receiving da API devolve
//      "GeneralMessage ." (TOMAS); na 990 a mesma chamada fecha a transação
//      (testado em 10/11/2026 com a venda real do RV1325 no cartão 2x). A NF-e
//      continua saindo pela 99.
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
import { espelharVendaNoTotvs, cartoesTotvs } from './pdvEspelhoTotvs.js';
import { emitirVendaPdv, registrarEpcs, carregarVenda } from '../routes/pdvCrosby.routes.js';
import { enviarDuplicata, gravarNotaNoCard, temBoleto } from './faturamentoDuplicata.js';
import { logisticaDosFaturamentos } from './faturamentoLogistica.js';
import { normalizarCreditoFalta, gerarCreditoFalta, CreditoError } from './faturamentoCredito.js';
import { saldoBonusDoCliente, usarBonus, estornarUsoDasVendas, BonusError } from './saldoBonus.js';
import { COMPROVANTE_URL } from './pedidosVendaDryland.js';

import { cardBrejinho } from './brejinhoDryland.js';
export const EMPRESA_FATURAMENTO = 99;
// Troca de peça NA TELA de faturamento (a que falta sai, a que sobra entra pelo
// mesmo valor): liberada até 13/11/2026 (era 10/11, depois 11/11; em 12/11 o Yago
// pediu mais 2 dias), para os pedidos cuja separação se perdeu nas 72 h do Dryland
// e tiveram peça trocada.
export const TROCA_NO_FATURAMENTO_ATE = '2026-11-13';
// Empresa do TOTVS que recebe o documento interno + contas a receber (ver topo)
export const EMPRESA_DOC_INTERNO = 990;
// desconto de ajuste que o operador pode dar no faturamento dos pedidos do site
export const DESCONTO_OPERADOR_MAXIMO = 15;

// Documento interno no TOTVS (saída, financeira, modelo 35) por canal
export const OPERACAO_DOC_INTERNO = { varejo: 511, franquias: 7807, mtm: 7808, revenda: 7809 };
// Operação "oficial" de referência (só informativa na venda do HeadCoach)
const OPERACAO_VENDA = { varejo: 545, franquias: 7234, mtm: 7235, revenda: 7236 };

// Cartão das vendas do site/expedição no TOTVS = Pagar.me: portador 9902
// (crédito) e 9901 (débito). A operadora e a bandeira que a API exige são lidas
// do cadastro desses portadores (FCXFL002), no texto exato — ver
// resolverCartaoNoCadastro em pdvEspelhoTotvs.js.
export const CARTAO_TOTVS_EXPEDICAO = { portadores: { credito: 9902, debito: 9901 } };

// Cartões que a API consegue receber: linhas do cadastro do TOTVS (FCXFL002)
// com Operadora e Bandeira preenchidas, agrupadas como na tela FGRFM003
// (Operadora → Parcelamento). payment-cards: tipo 4 = crédito, 5 = débito.
export async function listarCartoes() {
  const lista = (await cartoesTotvs()).filter((c) => c.operatorName && c.brandName);
  const grupos = { credito: new Map(), debito: new Map() };
  for (const c of lista) {
    const tipo = Number(c.documentType) === 5 ? 'debito' : Number(c.documentType) === 4 ? 'credito' : null;
    if (!tipo) continue;
    const chave = `${c.operatorName}|${c.brandName}|${c.bearerNumber}`;
    if (!grupos[tipo].has(chave)) grupos[tipo].set(chave, { chave, operadora: c.operatorName, bandeira: c.brandName, portador: c.bearerNumber, opcoes: [] });
    grupos[tipo].get(chave).opcoes.push({ seq: c.sequenceNumber, descricao: c.description, parcelas: Number(c.installmentNumber) || 1 });
  }
  const arr = (m) => [...m.values()].map((g) => ({ ...g, opcoes: g.opcoes.sort((a, b) => a.parcelas - b.parcelas) })).sort((a, b) => a.operadora.localeCompare(b.operadora) || a.bandeira.localeCompare(b.bandeira));
  const credito = arr(grupos.credito);
  const debito = arr(grupos.debito);
  const pc = CARTAO_TOTVS_EXPEDICAO.portadores;
  return {
    credito,
    debito,
    // padrão da expedição: Pagar.me
    padrao: { credito: credito.find((g) => g.portador === pc.credito)?.chave || null, debito: debito.find((g) => g.portador === pc.debito)?.chave || null },
  };
}

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

export async function acertarNumeracao(empresa) {
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

// ─── Pedido FATURADO ─────────────────────────────────────────────────────────
// Regra do Yago (10/11/2026), para o Faturamento e o Faturamento Brejinho: nota
// emitida = pedido FATURADO, e não se fatura de novo. Só volta a liberar quando
// a NF-e for cancelada E a transação do TOTVS daquela venda estiver cancelada
// (ou nunca tiver sido aberta). Devolve { motivo, texto, … } ou null.
export async function bloqueioDeFaturamento(chave, ref = null) {
  let q = supabase.from('pedidos_venda_faturamentos').select('id, chave, numero_site, venda_id, criado_em').not('venda_id', 'is', null).order('id', { ascending: false }).limit(50);
  const r = ref ? String(ref).replace(/[,()]/g, '') : null;
  q = r ? q.or(`chave.eq.${chave},numero_site.eq.${r}`) : q.eq('chave', chave);
  const { data: fats, error } = await q;
  if (error || !(fats || []).length) return null;
  const ids = fats.map((f) => f.venda_id);
  const [{ data: vendas }, { data: notas }] = await Promise.all([
    supabase.from('pdv_vendas').select('id, status, empresa, totvs_status, totvs_transacao_code, totvs_transacao_date, pedido_info').in('id', ids),
    supabase.from('pdv_notas_fiscais').select('venda_id, numero, serie, status').in('venda_id', ids),
  ]);
  const vPor = new Map((vendas || []).map((v) => [v.id, v]));
  // 1) alguma nota autorizada → faturado
  for (const f of fats) {
    const n = (notas || []).find((x) => x.venda_id === f.venda_id && x.status === 'autorizada');
    const v = vPor.get(f.venda_id);
    if (n && v && v.status !== 'cancelada') {
      return {
        motivo: 'faturado',
        vendaId: f.venda_id,
        faturamentoId: f.id,
        nf: n.numero,
        serie: n.serie,
        texto: `Pedido já FATURADO: NF-e ${n.numero}/${n.serie} (transação HeadCoach nº ${f.venda_id}). Para faturar de novo é preciso cancelar a NF-e e a transação do TOTVS.`,
      };
    }
  }
  // 2) nota cancelada: a transação do TOTVS daquela venda também tem que estar cancelada
  for (const f of fats) {
    const v = vPor.get(f.venda_id);
    if (!v?.totvs_transacao_code || v.totvs_status === 6) continue;
    const empresaTotvs = Number(v.pedido_info?.empresaTotvs) || v.empresa;
    let st = v.totvs_status;
    try {
      const t = await callTotvs('get', `${TOTVS_BASE_URL}/general/v2/transactions/search`, {
        params: { BranchCodeList: empresaTotvs, TransactionCodeList: v.totvs_transacao_code, TransactionDate: String(v.totvs_transacao_date || '').slice(0, 10), Page: 1, PageSize: 1 },
        timeout: 60000,
      });
      st = t.data?.items?.[0]?.status ?? st;
      if (st === 6) {
        await supabase.from('pdv_vendas').update({ totvs_status: 6 }).eq('id', v.id);
        await supabase.from('pedidos_venda_faturamentos').update({ transacao_status: 6 }).eq('id', f.id);
        continue;
      }
    } catch {
      /* TOTVS fora: fica com a situação guardada */
    }
    return {
      motivo: 'transacao_aberta',
      vendaId: f.venda_id,
      faturamentoId: f.id,
      transacao: v.totvs_transacao_code,
      empresaTotvs,
      texto: `A NF-e deste pedido foi cancelada, mas a transação ${empresaTotvs}/${v.totvs_transacao_code} do TOTVS ainda está ${st === 4 ? 'atendida' : 'em andamento'}. Cancele-a no TOTVS para liberar o pedido para novo faturamento.`,
    };
  }
  return null;
}

// FATURAMENTO AVULSO (Yago, 12/11/2026): cliente que compra presencialmente na
// matriz, sem pedido no Dryland. A tela abre vazia (chave "AVULSO:<id>"): o
// operador escolhe cliente, operação e pagamento, bipa as peças (preço pela
// tabela do cliente, como na Devolução) e o resto é o faturamento normal — NF-e
// pela 99 e documento interno + contas a receber na 990.
export const ehAvulso = (chave) => /^AVULSO:/i.test(String(chave || ''));
export const refAvulso = (chave) => `AV-${String(chave).slice(7).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-8) || 'SEM-ID'}`;
async function prepararAvulso(chave) {
  const emit = await buscarEmitente(EMPRESA_FATURAMENTO);
  let numeracao = null;
  try {
    const cfg = await buscarConfig(EMPRESA_FATURAMENTO);
    numeracao = { serie: cfg.serie_nfe, proximo: cfg.prox_num_nfe, ambiente: cfg.ambiente };
  } catch (e) {
    numeracao = { erro: e.message };
  }
  const ref = refAvulso(chave);
  return {
    chave,
    ref,
    avulso: true,
    canal: null,
    empresa: EMPRESA_FATURAMENTO,
    emitente: { uf: emit.uf, cnpj: emit.cnpj, nome: emit.xNome },
    cliente: null,
    cenario: null,
    difalConferido: ICMS_DIFAL_UF_CONFERIDA,
    vendedorCode: null,
    operacaoDocInterno: null,
    operacoesDocInterno: OPERACAO_DOC_INTERNO,
    transporte: { id: 'RETIRADA', code: null, servico: null, frete: 0, pesoB: 0, volumes: 0, modFrete: 0 },
    transportadoras: TRANSPORTADORAS,
    pagamento: { formas: [], formaTexto: null, parcelas: 1, vencimentos: [], nsu: null, autorizacao: null, bandeira: null, pix: null, credev: null },
    comprovantes: [],
    // o mesmo avulso não emite duas notas
    bloqueio: await bloqueioDeFaturamento(chave, ref).catch(() => null),
    jaNoTotvs: [],
    numeracao,
  };
}

export async function prepararFaturamento(chave) {
  if (ehAvulso(chave)) return prepararAvulso(String(chave));
  let card = null;
  let ref = null;
  if (/^BRJ:/i.test(String(chave))) {
    // Expedição Brejinho: card do Dryland /brejinho + peças da transação TOTVS
    ({ card } = await cardBrejinho(chave));
  } else if (String(chave).startsWith('SEP:')) ref = String(chave).slice(4).toUpperCase();
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
    // pedido já faturado pelo HeadCoach: a tela trava o FATURAR
    bloqueio: await bloqueioDeFaturamento(chave, ref).catch(() => null),
    jaNoTotvs: [
      d.transacao && `transação ${d.transacao}`,
      d.pedido_totvs && `pedido ${d.pedido_totvs}`,
      // card que já tem nota emitida fora do HeadCoach: o pedido já foi faturado no TOTVS
      d.nf_numero && !d.nf_headcoach && `NF ${d.nf_numero} JÁ EMITIDA para este pedido (card "${card?.status || ''}")`,
    ].filter(Boolean),
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
//   consumidorFinal, dataVenda, terminal, itens:[{ productCode, quantidade, valorUnit, epcs[] }],
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
  const bloqueio = await bloqueioDeFaturamento(b.chave, b.numeroSite || null);
  if (bloqueio) throw new FaturamentoError(bloqueio.texto, 'PEDIDO_JA_FATURADO', 409);
  // Desconto do operador (ajuste) nos pedidos do site: no máximo 15% (Yago, 11/11/2026).
  // No Brejinho e no faturamento AVULSO (venda presencial, sem valor de pedido a
  // seguir) vale a regra de lá: 25% livre, acima com senha de owner/admin/financeiro.
  const avulso = ehAvulso(b.chave);
  if (!String(b.chave).startsWith('BRJ:') && !avulso && Number(b.descontoFaturamento?.pct) > DESCONTO_OPERADOR_MAXIMO + 0.001) {
    throw new FaturamentoError(`O desconto do operador é de no máximo ${DESCONTO_OPERADOR_MAXIMO}%`, 'DESCONTO_ACIMA_DO_LIMITE');
  }
  const trocas = (Array.isArray(b.trocas) ? b.trocas : [])
    .filter((t) => t && t.de && t.para)
    .map((t) => ({ de: String(t.de), deNome: t.deNome || null, para: String(t.para), paraNome: t.paraNome || null, quantidade: Number(t.quantidade) || 1 }));
  if (trocas.length && hojeBrasil() > TROCA_NO_FATURAMENTO_ATE) {
    throw new FaturamentoError(`A troca de peças no faturamento só foi liberada até ${TROCA_NO_FATURAMENTO_ATE.split('-').reverse().join('/')}`, 'TROCA_FORA_DO_PRAZO');
  }
  // operação do documento interno: a escolhida na tela ou a do canal
  const operacaoDocInterno = Object.values(OPERACAO_DOC_INTERNO).includes(Number(b.operacaoDocInterno)) ? Number(b.operacaoDocInterno) : OPERACAO_DOC_INTERNO[b.canal] || 511;
  // canal da venda: o do pedido; no avulso, o da operação escolhida na tela
  const canalVenda = b.canal || Object.keys(OPERACAO_DOC_INTERNO).find((k) => OPERACAO_DOC_INTERNO[k] === operacaoDocInterno) || null;
  if (avulso && !Object.values(OPERACAO_DOC_INTERNO).includes(Number(b.operacaoDocInterno))) throw new FaturamentoError('Escolha a operação do documento interno');

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
    if (!['dinheiro', 'pix', 'credito', 'debito', 'credito_loja', 'adiantamento', 'boleto', 'saldo_bonus'].includes(forma)) throw new FaturamentoError(`Forma de pagamento inválida: ${p.forma}`);
    if (!(valor > 0)) continue;
    pagamentos.push({
      forma,
      valor,
      parcelas:
        forma === 'credito' && Number(p.cartao?.parcelas) > 0
          ? Number(p.cartao.parcelas)
          : forma === 'credito' || forma === 'boleto'
            ? Math.max(1, parseInt(p.parcelas, 10) || 1)
            : 1,
      // Operadora + Parcelamento escolhidos na tela (linha do cadastro do TOTVS)
      cartao_totvs:
        (forma === 'credito' || forma === 'debito') && p.cartao?.operadora && p.cartao?.bandeira
          ? { seq: p.cartao.seq ?? null, descricao: p.cartao.descricao || null, portador: p.cartao.portador ?? null, operadora: String(p.cartao.operadora), bandeira: String(p.cartao.bandeira), parcelas: Number(p.cartao.parcelas) || 1 }
          : null,
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
  // Saldo bônus do cliente (crédito de peça em falta de outro faturamento):
  // confere o saldo antes de gravar a venda. O que uma tentativa anterior deste
  // mesmo pedido tinha gasto volta primeiro — se chegou aqui, ela não virou nota
  // (pedido com nota autorizada é barrado lá em cima).
  const usoBonus = round2(pagamentos.filter((p) => p.forma === 'saldo_bonus').reduce((s, p) => s + p.valor, 0));
  if (usoBonus > 0) {
    try {
      const { data: anteriores } = await supabase.from('pdv_vendas').select('id').eq('pedido_chave', b.chave).eq('origem', 'expedicao');
      await estornarUsoDasVendas((anteriores || []).map((v) => v.id), 'Pedido faturado de novo: a tentativa anterior não virou nota', b.por || null);
      const sb = await saldoBonusDoCliente(cliente.code);
      if (usoBonus > sb.total + 0.005) {
        throw new FaturamentoError(`Saldo bônus usado (R$ ${usoBonus.toFixed(2)}) é maior que o saldo do cliente (R$ ${sb.total.toFixed(2)})`, 'BONUS_INSUFICIENTE');
      }
    } catch (e) {
      if (e instanceof BonusError) throw new FaturamentoError(e.message, e.code, e.status);
      throw e;
    }
  }
  // Peça em falta com o cliente ficando com o crédito: a peça já está fora dos
  // itens (e da nota); o valor dela vira crédito de adiantamento depois da nota
  // e da transação do TOTVS (services/faturamentoCredito.js)
  let creditoFalta = null;
  try {
    creditoFalta = normalizarCreditoFalta(b.creditoFalta, { pagamentos, por: b.por || null });
  } catch (e) {
    if (e instanceof CreditoError) throw new FaturamentoError(e.message, e.code);
    throw e;
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
    operacao: OPERACAO_VENDA[canalVenda] || null,
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
    canal: canalVenda,
    pedido_chave: b.chave,
    numero_site: b.numeroSite || (avulso ? refAvulso(b.chave) : null),
    data_caixa: dataCaixa,
    operacao_doc_interno: operacaoDocInterno,
    frete,
    transporte,
    cobranca,
    comprovantes: Array.isArray(b.comprovantes) ? b.comprovantes : [],
    pedido_info: {
      ...(b.pedidoInfo || {}),
      consumidorFinal: !!b.consumidorFinal,
      ...(avulso ? { avulso: true } : {}),
      ...(b.pedidoInfo?.pix ? { pix: String(b.pedidoInfo.pix).slice(0, 100) } : {}),
      ...(creditoFalta ? { creditoFalta } : {}),
      // peças trocadas na tela (entra a que foi lida, pelo valor da que estava no pedido)
      ...(trocas.length ? { trocas } : {}),
      // desconto dado na tela de faturamento (já está no valor de cada peça):
      // Brejinho: até 25% livre; acima, liberado por owner/admin/financeiro. Pedidos do site: até 15%
      ...(Number(b.descontoFaturamento?.pct) > 0
        ? { descontoFaturamento: { pct: round2(b.descontoFaturamento.pct), liberadoPor: b.descontoFaturamento.liberadoPor || null } }
        : {}),
      terminal: Number(b.terminal) > 0 ? Number(b.terminal) : null,
      receberComoFatura: !!b.receberComoFatura,
      dataVenda,
      cartaoTotvs: CARTAO_TOTVS_EXPEDICAO,
      empresaTotvs: EMPRESA_DOC_INTERNO,
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
  // Saldo bônus: sai do cliente já (ninguém gasta o mesmo saldo duas vezes).
  // Volta sozinho se este pedido for faturado de novo ou se a nota for cancelada.
  // O consumo guarda a forma do pagamento de origem: é nela que o TOTVS recebe.
  if (usoBonus > 0) {
    try {
      const consumo = await usarBonus({ clienteCode: cliente.code, valor: usoBonus, venda, por: b.por || null });
      venda.pedido_info = { ...(venda.pedido_info || {}), bonusUso: consumo };
      await supabase.from('pdv_vendas').update({ pedido_info: venda.pedido_info }).eq('id', venda.id);
    } catch (e) {
      await estornarUsoDasVendas([venda.id], 'Falha ao gravar a venda', b.por || null).catch(() => {});
      await supabase.from('pdv_vendas').delete().eq('id', venda.id);
      throw new FaturamentoError(e.message, e.code || 'BONUS_ERROR', e.status || 400);
    }
  }
  await registrarEpcs({ venda, itens: itensGravados || [], tipo: 'venda' });

  // Registro do faturamento (aba Transações) — atualizado a cada etapa
  const { data: fat } = await supabase
    .from('pedidos_venda_faturamentos')
    .insert({
      chave: b.chave,
      numero_site: b.numeroSite || (avulso ? refAvulso(b.chave) : null),
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
  // Abre OUTRA transação (data de hoje) para a mesma venda quando:
  //  • a operação do documento interno foi trocada (a API não altera a operação
  //    de uma transação existente), ou
  //  • a venda ainda está presa numa transação da 99 (anterior à mudança para a
  //    990) — "Tentar de novo" leva o documento interno para a 990.
  // A anterior fica "em andamento" no TOTVS, anotada para ser cancelada.
  {
    const { data: v0 } = await supabase.from('pdv_vendas').select('origem, operacao_doc_interno, totvs_transacao_code, totvs_status, pedido_info').eq('id', vendaId).maybeSingle();
    if (v0 && v0.origem === 'expedicao' && v0.totvs_status !== 4) {
      const opPedida = Number(opcoes.operacaoDocInterno);
      const opNova = Object.values(OPERACAO_DOC_INTERNO).includes(opPedida) ? opPedida : null;
      const empresaAtual = Number(v0.pedido_info?.empresaTotvs) || EMPRESA_FATURAMENTO;
      const trocaOperacao = !!opNova && Number(v0.operacao_doc_interno) !== opNova;
      const trocaEmpresa = empresaAtual !== EMPRESA_DOC_INTERNO;
      if (trocaOperacao || trocaEmpresa) {
        const info = { ...(v0.pedido_info || {}), empresaTotvs: EMPRESA_DOC_INTERNO };
        if (v0.totvs_transacao_code) info.transacoesAnteriores = [...(info.transacoesAnteriores || []), { code: v0.totvs_transacao_code, operacao: v0.operacao_doc_interno, empresa: empresaAtual }];
        const operacao = opNova || Number(v0.operacao_doc_interno) || 511;
        await supabase
          .from('pdv_vendas')
          .update({ operacao_doc_interno: operacao, totvs_transacao_code: null, totvs_transacao_date: null, totvs_status: null, totvs_erro: null, data_caixa: hojeBrasil(), pedido_info: info })
          .eq('id', vendaId);
        if (fatId) await supabase.from('pedidos_venda_faturamentos').update({ operacao, transacao_code: null, transacao_date: null, transacao_status: 1 }).eq('id', fatId);
        console.log(`🔁 [Faturamento] venda ${vendaId}: nova transação no TOTVS (empresa ${empresaAtual} → ${EMPRESA_DOC_INTERNO}, operação ${v0.operacao_doc_interno ?? '—'} → ${operacao}; anterior ${v0.totvs_transacao_code ?? '—'})`);
      }
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

  // 2) Documento interno + contas a receber no TOTVS (empresa 990)
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

  // 3) Dryland: a nota vai para o card da fila (é dela que os robôs de minuta
  //    precisam) e, se a venda tem boleto, sai a duplicata para o cliente
  //    assinar. A duplicata roda em segundo plano (gera PDF, Autentique e
  //    WhatsApp) para não segurar a resposta do faturamento; o andamento
  //    aparece na aba Transações. Falha aqui não desfaz nota nem TOTVS.
  let duplicata = null;
  const notaOk = venda.notas.find((n) => n.status === 'autorizada');
  if (notaOk && venda.status !== 'cancelada') {
    if (temBoleto(venda, venda.pagamentos)) {
      duplicata = { emAndamento: true };
      setImmediate(() => {
        enviarDuplicata(vendaId, { por: venda.criado_por || null }).catch((e) => console.warn(`⚠️ [duplicata] venda ${vendaId}: ${e.message}`));
      });
    } else {
      gravarNotaNoCard({ venda, nota: notaOk, fat: { chave: venda.pedido_chave } }, {}, `HeadCoach${venda.criado_por ? ` (${venda.criado_por})` : ''}`).catch((e) =>
        console.warn(`⚠️ [faturamento] venda ${vendaId}: não gravei a nota no card do Dryland: ${e.message}`),
      );
    }
  }
  // 4) Peça em falta: crédito de adiantamento do cliente + chamado para o
  //    Financeiro no Dryland. Só com a nota autorizada e a transação atendida.
  let credito = null;
  const cred = venda.pedido_info?.creditoFalta;
  if (cred && Number(cred.valor) > 0 && notaOk && venda.status !== 'cancelada') {
    if (cred.chamado?.id && cred.status !== 'erro') credito = { ...cred };
    else if (venda.totvs_status === 4) {
      credito = { ...cred, emAndamento: true };
      setImmediate(() => {
        gerarCreditoFalta(vendaId, { por: venda.criado_por || null }).catch((e) => console.warn(`⚠️ [crédito] venda ${vendaId}: ${e.message}`));
      });
    } else credito = { ...cred, aguardandoTotvs: true };
  }
  return { vendaId, faturamentoId: fatId, venda, nota, fiscal, totvs, duplicata, credito };
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
  // minuta (lida do card do Dryland) e duplicata de cada faturamento
  return logisticaDosFaturamentos(lista);
}

export async function detalheTransacao(faturamentoId) {
  const { data: fat } = await supabase.from('pedidos_venda_faturamentos').select('*').eq('id', faturamentoId).maybeSingle();
  if (!fat) throw new FaturamentoError('Transação não encontrada', 'NOT_FOUND', 404);
  const venda = fat.venda_id ? await carregarVenda(fat.venda_id) : null;
  const { data: kardex } = fat.venda_id
    ? await supabase.from('pdv_epc_movimentos').select('epc, tipo, product_code, produto_nome, valor_unit, ocorrido_em').eq('venda_id', fat.venda_id).order('product_code')
    : { data: [] };
  const [logistica] = await logisticaDosFaturamentos([fat]);
  return { faturamento: fat, venda, kardex: kardex || [], minuta: logistica?.minuta || null, duplicata: logistica?.duplicata || null, temCard: !!logistica?.temCard };
}
