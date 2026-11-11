// ============================================================================
// SALDO BÔNUS DO CLIENTE — crédito guardado no HeadCoach (Yago, 11/11/2026)
// Nasce quando um pedido é faturado com PEÇA EM FALTA e o cliente fica com o
// crédito (services/faturamentoCredito.js); é gasto como forma de pagamento
// "Saldo bônus" em outro faturamento da expedição. Não existe no TOTVS: a API
// de lá não inclui adiantamento.
// Tabela faturamento_saldo_bonus (livro-razão):
//   credito       +valor   (uma por venda que gerou)
//   uso           −valor   (venda que gastou, apontando o crédito)
//   estorno       +valor   (o uso voltou: venda refeita ou nota cancelada)
//   cancelamento  −valor   (a venda que gerou o crédito foi cancelada)
// O uso sai do crédito mais antigo primeiro. Cada crédito guarda o pagamento
// de origem (Pix, cartão…): é nessa forma que o TOTVS recebe o valor quando o
// bônus é usado, porque o dinheiro entrou naquele pagamento.
// ============================================================================
import supabase from '../config/supabase.js';

export class BonusError extends Error {
  constructor(message, code = 'BONUS_ERROR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const TABELA = 'faturamento_saldo_bonus';
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// só gera crédito o que o cliente pagou de fato (boleto ainda não foi pago;
// Credev, adiantamento e o próprio bônus só consomem o que a nota usa)
export const FORMAS_QUE_GERAM_CREDITO = ['pix', 'credito', 'debito', 'dinheiro'];

function erroDb(error) {
  if (/does not exist|schema cache/i.test(error?.message || '')) return new BonusError('Tabela do saldo bônus não existe — rode migrations/faturamento_saldo_bonus.sql', 'MIGRATION_PENDING', 503);
  return new BonusError(error?.message || 'Erro no saldo bônus', 'DB_ERROR', 500);
}

// créditos com o que já saiu de cada um
function calcular(linhas) {
  const creditos = linhas.filter((l) => l.tipo === 'credito').map((c) => ({ ...c, valor: Number(c.valor), usado: 0, cancelado: 0 }));
  const por = new Map(creditos.map((c) => [c.id, c]));
  for (const l of linhas) {
    const c = por.get(l.credito_id);
    if (!c) continue;
    if (l.tipo === 'uso') c.usado += Number(l.valor);
    else if (l.tipo === 'estorno') c.usado -= Number(l.valor);
    else if (l.tipo === 'cancelamento') c.cancelado += Number(l.valor);
  }
  for (const c of creditos) {
    c.usado = round2(c.usado);
    c.cancelado = round2(c.cancelado);
    c.disponivel = Math.max(0, round2(c.valor - c.usado - c.cancelado));
  }
  creditos.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em) || a.id - b.id);
  return creditos;
}

async function linhasDoCliente(clienteCode) {
  const { data, error } = await supabase.from(TABELA).select('*').eq('cliente_code', Number(clienteCode)).order('id');
  if (error) throw erroDb(error);
  return data || [];
}

/** Saldo bônus do cliente: total disponível, os créditos e os últimos movimentos. */
export async function saldoBonusDoCliente(clienteCode) {
  if (!(Number(clienteCode) > 0)) throw new BonusError('Informe o cliente');
  const linhas = await linhasDoCliente(clienteCode);
  const creditos = calcular(linhas);
  return {
    clienteCode: Number(clienteCode),
    total: round2(creditos.reduce((s, c) => s + c.disponivel, 0)),
    creditos: creditos.map((c) => ({ id: c.id, valor: c.valor, usado: c.usado, cancelado: c.cancelado, disponivel: c.disponivel, venda_id: c.venda_id, numero_site: c.numero_site, motivo: c.motivo, forma_origem: c.origem?.forma || null, criado_em: c.criado_em })),
    movimentos: linhas
      .slice(-30)
      .reverse()
      .map((l) => ({ id: l.id, tipo: l.tipo, valor: Number(l.valor), venda_id: l.venda_id, numero_site: l.numero_site, motivo: l.motivo, criado_por: l.criado_por, criado_em: l.criado_em })),
  };
}

/** Pagamento de origem do crédito: a maior forma efetivamente paga da venda. */
export function origemDoCredito(pagamentos = []) {
  const p = pagamentos.filter((x) => FORMAS_QUE_GERAM_CREDITO.includes(x.forma) && Number(x.valor) > 0).sort((a, b) => Number(b.valor) - Number(a.valor))[0];
  if (!p) return null;
  return { forma: p.forma, parcelas: Number(p.parcelas) || 1, cartao_totvs: p.cartao_totvs || null, autorizacao: p.autorizacao || null };
}

/** Lança o crédito de uma venda (uma vez só por venda). */
export async function creditarBonus({ venda, valor, motivo, origem = null, por = null }) {
  const v = round2(valor);
  if (!(v > 0)) throw new BonusError('Valor do crédito inválido');
  const achar = async () => (await supabase.from(TABELA).select('*').eq('venda_id', venda.id).eq('tipo', 'credito').maybeSingle()).data;
  const ja = await achar();
  if (ja) return { ...ja, jaExistia: true };
  const { data, error } = await supabase
    .from(TABELA)
    .insert({
      cliente_code: Number(venda.cliente_code),
      cliente_nome: venda.cliente_nome || null,
      cliente_cpf_cnpj: venda.cliente_cpf_cnpj || null,
      tipo: 'credito',
      valor: v,
      venda_id: venda.id,
      numero_site: venda.numero_site || null,
      motivo: motivo || null,
      origem,
      criado_por: por,
    })
    .select()
    .single();
  if (error) {
    // índice único por venda: outra chamada lançou no mesmo instante
    if (/duplicate key/i.test(error.message)) return { ...(await achar()), jaExistia: true };
    throw erroDb(error);
  }
  console.log(`🎁 [saldo bônus] +${brl(v)} para o cliente ${venda.cliente_code} (venda ${venda.id}${venda.numero_site ? ` · ${venda.numero_site}` : ''})`);
  return data;
}

/** Gasta o saldo do cliente numa venda (do crédito mais antigo para o mais novo). */
export async function usarBonus({ clienteCode, valor, venda, por = null }) {
  const v = round2(valor);
  if (!(v > 0)) return [];
  const creditos = calcular(await linhasDoCliente(clienteCode)).filter((c) => c.disponivel > 0);
  const total = round2(creditos.reduce((s, c) => s + c.disponivel, 0));
  if (v > total + 0.005) throw new BonusError(`Saldo bônus do cliente (${brl(total)}) não cobre o valor usado (${brl(v)})`, 'BONUS_INSUFICIENTE', 409);
  let resta = v;
  const consumo = [];
  for (const c of creditos) {
    if (resta <= 0.005) break;
    const pega = round2(Math.min(c.disponivel, resta));
    consumo.push({ creditoId: c.id, valor: pega, vendaOrigem: c.venda_id, pedidoOrigem: c.numero_site, origem: c.origem || null });
    resta = round2(resta - pega);
  }
  const { error } = await supabase.from(TABELA).insert(
    consumo.map((u) => ({
      cliente_code: Number(clienteCode),
      cliente_nome: venda.cliente_nome || null,
      cliente_cpf_cnpj: venda.cliente_cpf_cnpj || null,
      tipo: 'uso',
      valor: u.valor,
      credito_id: u.creditoId,
      venda_id: venda.id,
      numero_site: venda.numero_site || null,
      motivo: 'Usado como pagamento no faturamento',
      criado_por: por,
    })),
  );
  if (error) throw erroDb(error);
  console.log(`🎁 [saldo bônus] −${brl(v)} do cliente ${clienteCode} (venda ${venda.id}${venda.numero_site ? ` · ${venda.numero_site}` : ''})`);
  return consumo;
}

/** Devolve ao cliente o que estas vendas tinham gasto (venda refeita, nota cancelada). */
export async function estornarUsoDasVendas(vendaIds, motivo, por = null) {
  const ids = [...new Set((vendaIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return 0;
  const { data, error } = await supabase.from(TABELA).select('*').in('venda_id', ids).in('tipo', ['uso', 'estorno']);
  if (error) throw erroDb(error);
  const liquido = new Map(); // venda|crédito → o que ainda está gasto
  for (const l of data || []) {
    const k = `${l.venda_id}|${l.credito_id}`;
    const a = liquido.get(k) || { linha: l, valor: 0 };
    a.valor += l.tipo === 'uso' ? Number(l.valor) : -Number(l.valor);
    liquido.set(k, a);
  }
  const estornos = [...liquido.values()]
    .filter((a) => round2(a.valor) > 0)
    .map((a) => ({
      cliente_code: a.linha.cliente_code,
      cliente_nome: a.linha.cliente_nome,
      cliente_cpf_cnpj: a.linha.cliente_cpf_cnpj,
      tipo: 'estorno',
      valor: round2(a.valor),
      credito_id: a.linha.credito_id,
      venda_id: a.linha.venda_id,
      numero_site: a.linha.numero_site,
      motivo: motivo || 'Uso desfeito',
      criado_por: por,
    }));
  if (!estornos.length) return 0;
  const { error: e2 } = await supabase.from(TABELA).insert(estornos);
  if (e2) throw erroDb(e2);
  const total = round2(estornos.reduce((s, x) => s + x.valor, 0));
  console.log(`🎁 [saldo bônus] estorno de ${brl(total)} (venda(s) ${ids.join(', ')}): ${motivo || ''}`);
  return total;
}

/**
 * Nota da venda cancelada: o bônus que ela gastou volta para o cliente e o
 * crédito que ela gerou é cancelado (só o que ainda não foi usado; se já foi
 * gasto em outra venda, fica o aviso no retorno).
 */
export async function aoCancelarVenda(vendaId, por = null) {
  const devolvido = await estornarUsoDasVendas([vendaId], 'Nota fiscal da venda cancelada', por);
  const { data: cred } = await supabase.from(TABELA).select('*').eq('venda_id', vendaId).eq('tipo', 'credito').maybeSingle();
  if (!cred) return { devolvido, cancelado: 0, jaGasto: 0 };
  const c = calcular(await linhasDoCliente(cred.cliente_code)).find((x) => x.id === cred.id);
  let cancelado = 0;
  if (c && c.disponivel > 0) {
    const { error } = await supabase.from(TABELA).insert({
      cliente_code: cred.cliente_code,
      cliente_nome: cred.cliente_nome,
      cliente_cpf_cnpj: cred.cliente_cpf_cnpj,
      tipo: 'cancelamento',
      valor: c.disponivel,
      credito_id: cred.id,
      venda_id: vendaId,
      numero_site: cred.numero_site,
      motivo: 'Nota fiscal da venda que gerou o crédito foi cancelada',
      criado_por: por,
    });
    if (error) throw erroDb(error);
    cancelado = c.disponivel;
  }
  const jaGasto = c ? c.usado : 0;
  if (cancelado || jaGasto) console.log(`🎁 [saldo bônus] venda ${vendaId} cancelada: crédito cancelado ${brl(cancelado)}${jaGasto ? ` · ${brl(jaGasto)} já tinham sido usados` : ''}`);
  return { devolvido, cancelado, jaGasto };
}
