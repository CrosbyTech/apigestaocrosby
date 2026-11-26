// ============================================================================
// BLUECARD NO PDV CROSBY — o PDV pede a compra, o cliente aprova no app e a
// venda destrava (desenho do Yago + contrato do Felipe, 25/11/2026):
//   1. cliente identificado no PDV → mostra o LIMITE dele no BlueCard
//      (POST /api/v1/bluecard/elegibilidade { cpf, valor_cents? });
//   2. pagamento em BlueCard → o PDV cria a compra (POST /api/v1/compras): ela
//      nasce pendente e o cliente tem 10 minutos para aprovar no app;
//   3. o PDV acompanha (GET /api/v1/compras/{id}) até `pode_fechar_venda`;
//      recusada, cancelada ou expirada → não fatura (nova tentativa = outro documento);
//   4. a venda só é gravada com a compra APROVADA, do mesmo CPF, no mesmo valor e
//      nas mesmas parcelas — conferido de novo aqui no servidor, direto no BlueCard;
//   5. nota autorizada → PATCH /api/v1/compras/{id}/fiscal (vale como a confirmação
//      da venda no BlueCard).
// A compra fica amarrada à transação em pdv_vendas.pedido_info.bluecard, com os
// vencimentos que o cliente aceitou — é com eles que o contas a receber nasce.
// Nada disto passa pelo TOTVS.
// ============================================================================
import supabase from '../config/supabase.js';
import { consultarElegibilidade, criarCompra, consultarCompra, enviarFiscal } from './bluecardClient.js';

export class BluecardPdvError extends Error {
  constructor(message, code = 'BLUECARD_ERROR', status = 400, detalhe = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.detalhe = detalhe;
  }
}

export const BLUECARD_MAX_PARCELAS = 4;
const digitos = (v) => String(v || '').replace(/\D/g, '');
const cents = (v) => Math.round(Number(v || 0) * 100);
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// erro da API do BlueCard → erro do PDV com a mensagem deles (já vem em português)
function doBluecard(e, padrao) {
  if (e instanceof BluecardPdvError) return e;
  const codigo = e?.codigo || null;
  const msg = codigo ? String(e.message).replace(/^\[bluecard [^\]]+\]\s*/, '') : padrao;
  const fora = !codigo; // sem código = a API não respondeu (rede, tempo esgotado, 5xx)
  return new BluecardPdvError(fora ? `${padrao} (o BlueCard não respondeu: ${String(e?.message || e).slice(0, 120)})` : msg, codigo ? `BLUECARD_${String(codigo).toUpperCase()}` : 'BLUECARD_FORA', fora ? 503 : e.status || 409, e?.detalhe ?? null);
}

/** Limite do cliente no BlueCard. `valor` (R$) opcional: diz se aquela venda cabe e em quantas parcelas. */
export async function limiteDoCliente({ cpf, valor = null }) {
  const doc = digitos(cpf);
  if (doc.length !== 11) throw new BluecardPdvError('O BlueCard é por CPF: identifique o cliente com o CPF', 'BLUECARD_SEM_CPF');
  try {
    const r = await consultarElegibilidade(doc, valor ? cents(valor) : null);
    return {
      pode: r?.pode === true,
      codigo: r?.codigo || null,
      motivo: r?.motivo || null,
      disponivel: Number(r?.disponivel_cents || 0) / 100,
      parcelasPossiveis: (Array.isArray(r?.parcelas_possiveis) ? r.parcelas_possiveis : []).map(Number).filter((n) => n >= 1 && n <= BLUECARD_MAX_PARCELAS),
      parcelaMinima: r?.parcela_minima_cents != null ? Number(r.parcela_minima_cents) / 100 : null,
      nome: r?.cliente?.nome || null,
    };
  } catch (e) {
    throw doBluecard(e, 'Não consegui consultar o limite do BlueCard');
  }
}

// vencimentos da compra no formato guardado na venda: [{ numero, vencimento, valor_cents }]
const vencimentosDe = (compra) =>
  (Array.isArray(compra?.parcelas) ? compra.parcelas : [])
    .filter((p) => /^\d{4}-\d{2}-\d{2}/.test(String(p?.vencimento || '')) && Number(p?.valor_cents) > 0)
    .map((p) => ({ numero: Number(p.numero), vencimento: String(p.vencimento).slice(0, 10), valor_cents: Number(p.valor_cents) }))
    .sort((a, b) => a.numero - b.numero);

function resumoDaCompra(c) {
  const bruto = String(c?.status || '').toLowerCase();
  const status = c?.pode_fechar_venda === true || bruto === 'aprovada' ? 'aprovada' : /recus/.test(bruto) ? 'recusada' : /cancel/.test(bruto) ? 'cancelada' : /expir/.test(bruto) ? 'expirada' : 'pendente';
  return {
    compraId: c?.id || null,
    status,
    podeFechar: c?.pode_fechar_venda === true,
    expiraEm: c?.expira_em || null,
    aprovadaEm: c?.aprovada_em || null,
    valor: Number(c?.valor_cents || 0) / 100,
    valorCents: Number(c?.valor_cents || 0),
    parcelas: Number(c?.parcelas_total ?? c?.parcelas?.length ?? c?.parcelas ?? 0) || null,
    documento: c?.documento || null,
    cpf: digitos(c?.cliente?.cpf),
    vencimentos: vencimentosDe(c),
  };
}

/**
 * Pede a compra ao BlueCard (o cliente recebe o pedido no app e tem 10 minutos para aprovar).
 * itens: [{ productCode, nome, quantidade, valorUnit }]. Devolve { compraId, status, expiraEm, documento }.
 */
export async function solicitarAprovacao({ empresa, empresaNome = null, cpf, valor, parcelas, vendedorCode = null, vendedorNome = null, itens = [] }) {
  const doc = digitos(cpf);
  const emp = parseInt(empresa, 10);
  const n = parseInt(parcelas, 10);
  const valorCents = cents(valor);
  if (!emp) throw new BluecardPdvError('Informe a loja', 'BLUECARD_SEM_LOJA');
  if (doc.length !== 11) throw new BluecardPdvError('O BlueCard é por CPF: identifique o cliente com o CPF', 'BLUECARD_SEM_CPF');
  if (!(valorCents > 0)) throw new BluecardPdvError('Informe o valor em BlueCard', 'BLUECARD_VALOR');
  if (!(n >= 1 && n <= BLUECARD_MAX_PARCELAS)) throw new BluecardPdvError(`BlueCard: de 1 a ${BLUECARD_MAX_PARCELAS} parcelas`, 'BLUECARD_PARCELAS');
  let loja = empresaNome;
  if (!loja) {
    const { data } = await supabase.from('erp_empresas').select('fantasia, descricao').eq('code', emp).maybeSingle();
    loja = data?.fantasia || data?.descricao || `Loja ${emp}`;
  }
  // referência única desta tentativa (uma nova tentativa precisa de outro documento)
  const documento = `HC${emp}-${Date.now().toString(36).toUpperCase()}`;
  const corpo = {
    cpf: doc,
    valor_cents: valorCents,
    parcelas: n,
    loja: semAcento(loja),
    vendedor_ref: vendedorCode ? String(vendedorCode) : null,
    documento,
    descricao: `Venda no PDV Crosby${vendedorNome ? ` · ${semAcento(vendedorNome)}` : ''}`.slice(0, 120),
    itens: (itens || [])
      .filter((i) => Number(i?.quantidade) > 0)
      .map((i) => ({ codigo: String(i.productCode ?? i.codigo ?? ''), descricao: semAcento(i.nome || i.descricao || `Produto ${i.productCode}`).slice(0, 120), quantidade: Number(i.quantidade), valor_cents: cents(i.valorUnit ?? i.valor ?? 0) })),
  };
  try {
    const r = await criarCompra(corpo, `compra:${documento}`);
    if (!r?.id) throw new BluecardPdvError('O BlueCard não devolveu o número da compra', 'BLUECARD_SEM_ID', 502);
    console.log(`💳 [bluecard-pdv] compra pedida: loja ${emp} · R$ ${(valorCents / 100).toFixed(2)} em ${n}x · compra ${r.id} · ${documento}`);
    return { compraId: r.id, status: 'pendente', expiraEm: r.expira_em || null, documento, valor: valorCents / 100, parcelas: n };
  } catch (e) {
    throw doBluecard(e, 'Não consegui pedir a aprovação no BlueCard');
  }
}

/** Situação da compra no BlueCard: pendente | aprovada | recusada | cancelada | expirada. */
export async function situacaoDaCompra(compraId) {
  if (!compraId) throw new BluecardPdvError('Compra não informada', 'BLUECARD_SEM_ID');
  try {
    const r = resumoDaCompra(await consultarCompra(String(compraId)));
    // pendente que já passou do prazo: o app ainda não marcou, mas não dá mais para aprovar
    if (r.status === 'pendente' && r.expiraEm && new Date(r.expiraEm).getTime() < Date.now()) r.status = 'expirada';
    return r;
  } catch (e) {
    throw doBluecard(e, 'Não consegui consultar a compra no BlueCard');
  }
}

/**
 * Antes de gravar a venda: a compra precisa estar APROVADA no BlueCard, ser do CPF do cliente, no
 * valor pago em BlueCard e nas mesmas parcelas, e não ter sido usada por outra transação.
 * Devolve o que fica guardado em pdv_vendas.pedido_info.bluecard.
 */
export async function conferirCompraParaVenda({ compraId, cpf, valorBluecard, parcelas }) {
  const c = await situacaoDaCompra(compraId);
  if (!c.podeFechar) {
    const txt = { pendente: 'o cliente ainda não aprovou no app', recusada: 'o cliente recusou no app', cancelada: 'a compra foi cancelada', expirada: 'o prazo de aprovação acabou' }[c.status] || c.status;
    throw new BluecardPdvError(`BlueCard: ${txt}. A venda não pode ser fechada no BlueCard.`, 'BLUECARD_NAO_APROVADA', 409);
  }
  if (c.cpf && digitos(cpf) && c.cpf !== digitos(cpf)) throw new BluecardPdvError('BlueCard: a compra aprovada é de outro cliente', 'BLUECARD_OUTRO_CLIENTE', 409);
  if (Math.abs(c.valorCents - cents(valorBluecard)) > 1) {
    throw new BluecardPdvError(`BlueCard: o cliente aprovou R$ ${(c.valorCents / 100).toFixed(2).replace('.', ',')} e a venda tem R$ ${Number(valorBluecard).toFixed(2).replace('.', ',')} em BlueCard. Peça uma nova aprovação.`, 'BLUECARD_VALOR_DIFERENTE', 409);
  }
  if (c.parcelas && Number(parcelas) && Number(c.parcelas) !== Number(parcelas)) throw new BluecardPdvError(`BlueCard: o cliente aprovou em ${c.parcelas}x e a venda está em ${parcelas}x`, 'BLUECARD_PARCELAS_DIFERENTES', 409);
  const { data: usada } = await supabase.from('pdv_vendas').select('id').eq('pedido_info->bluecard->>compraId', String(compraId)).neq('status', 'cancelada').limit(1);
  if (usada?.[0]) throw new BluecardPdvError(`BlueCard: esta aprovação já foi usada na transação nº ${usada[0].id}`, 'BLUECARD_JA_USADA', 409);
  return { compraId: c.compraId, documento: c.documento, valorCents: c.valorCents, parcelas: c.parcelas || Number(parcelas) || c.vencimentos.length || 1, vencimentos: c.vencimentos, aprovadaEm: c.aprovadaEm, conferidaEm: new Date().toISOString(), por: 'PDV Crosby' };
}

/**
 * Nota autorizada → manda a nota e os itens ao BlueCard (lá isso confirma a venda). Pode ser chamada
 * de novo: só envia uma vez (marca pedido_info.bluecard.fiscalEnviadoEm). Nunca lança erro.
 */
export async function avisarFiscalDaVenda(vendaId) {
  try {
    const { data: v } = await supabase
      .from('pdv_vendas')
      .select('id, status, pedido_info, pdv_venda_itens(product_code, nome, quantidade, valor_unit, desconto_unit), pdv_notas_fiscais(numero, serie, chave, status, dh_autorizacao, dh_emissao)')
      .eq('id', Number(vendaId))
      .maybeSingle();
    const b = v?.pedido_info?.bluecard;
    if (!b?.compraId || b.fiscalEnviadoEm) return { enviado: false, motivo: !b?.compraId ? 'venda sem compra do BlueCard' : 'já enviado' };
    const nota = (v.pdv_notas_fiscais || []).find((n) => n.status === 'autorizada');
    if (!nota) return { enviado: false, motivo: 'nota ainda não autorizada' };
    await enviarFiscal(b.compraId, {
      itens: (v.pdv_venda_itens || []).map((i) => ({ codigo: String(i.product_code), descricao: semAcento(i.nome).slice(0, 120), quantidade: Number(i.quantidade), valor_cents: cents(Number(i.valor_unit) - Number(i.desconto_unit || 0)) })),
      nf_numero: String(nota.numero),
      nf_serie: String(nota.serie),
      nf_chave: nota.chave || null,
      nf_emitida_em: nota.dh_autorizacao || nota.dh_emissao || new Date().toISOString(),
    });
    await supabase.from('pdv_vendas').update({ pedido_info: { ...v.pedido_info, bluecard: { ...b, fiscalEnviadoEm: new Date().toISOString() } } }).eq('id', v.id);
    console.log(`💳 [bluecard-pdv] nota ${nota.numero}/${nota.serie} da transação ${v.id} enviada ao BlueCard (compra ${b.compraId})`);
    return { enviado: true };
  } catch (e) {
    console.warn(`⚠️ [bluecard-pdv] transação ${vendaId}: não consegui mandar a nota ao BlueCard agora (${e.message}) — o vigia tenta de novo`);
    return { enviado: false, erro: e.message };
  }
}
