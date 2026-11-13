// ============================================================================
// CRÉDITO DE PEÇA EM FALTA NO FATURAMENTO DA EXPEDIÇÃO (Yago, 11/11/2026)
// O pedido tem 6 peças, na hora de bipar só existem 5 e o cliente preferiu
// ficar com o crédito da que faltou. O faturamento fecha assim mesmo:
//   • a peça que faltou NÃO entra na NF-e nem na transação do TOTVS;
//   • o valor dela vira SALDO BÔNUS do cliente no HeadCoach (services/
//     saldoBonus.js), para usar como pagamento em outro faturamento;
//   • abre um chamado no Dryland, para o FINANCEIRO, com cliente, transação e
//     valor.
// Por que saldo bônus e não adiantamento no TOTVS: a API do TOTVS não tem
// "incluir adiantamento" (o caixa grava um título de tipo de faturamento 6 já
// recebido; título desse tipo em aberto não vira saldo — conferido por leitura
// em 11/11/2026). Decisão do Yago: sem conseguir gerar o crédito lá, gera o
// saldo bônus aqui.
// O crédito fica em pdv_vendas.pedido_info.creditoFalta:
//   { valor, pecas[{ productCode, nome, quantidade, valor }], formas[], origem,
//     status: pendente | gerado | erro, bonus: { id }, chamado: { id, numero,
//     abertoEm }, erro }
// Só roda com a NF-e autorizada E a transação fechada: desde 13/11/2026 a do
// HeadCoach (contas a receber gerado em HeadCoach › Contas a Receber); antes,
// a do TOTVS.
// ============================================================================
import supabase from '../config/supabase.js';
import { drylandRpc } from '../routes/drylandChamados.routes.js';
import { creditarBonus, origemDoCredito, saldoBonusDoCliente } from './saldoBonus.js';

export class CreditoError extends Error {
  constructor(message, code = 'CREDITO_ERROR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const SETOR_CHAMADO = 'financeiro';
// a expedição (empresa 99) não é uma das lojas fixas do Dryland: vai com o nome
const LOJA_CHAMADO = { cd: 99, nome: 'Expedição Brejinho (empresa 99)' };

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const dataHora = (d) => new Date(d || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Recife', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const FORMAS = { pix: 'Pix', credito: 'Cartão de crédito', debito: 'Cartão de débito', dinheiro: 'Dinheiro', credito_loja: 'Credev', adiantamento: 'Adiantamento', boleto: 'Boleto', saldo_bonus: 'Saldo bônus' };

/** Confere e normaliza o crédito pedido pela tela (chamado no faturar, antes de gravar a venda). */
export function normalizarCreditoFalta(entrada, { pagamentos = [], por = null } = {}) {
  if (!entrada || !(Number(entrada.valor) > 0)) return null;
  const pecas = (Array.isArray(entrada.pecas) ? entrada.pecas : [])
    .map((p) => ({ productCode: String(p.productCode ?? ''), nome: String(p.nome || p.name || '').slice(0, 200), quantidade: Number(p.quantidade) || 0, valor: round2(p.valor) }))
    .filter((p) => p.productCode && p.quantidade > 0 && p.valor > 0);
  if (!pecas.length) throw new CreditoError('O crédito de peça em falta precisa das peças que faltaram, com o valor de cada uma', 'CREDITO_SEM_PECAS');
  const valor = round2(entrada.valor);
  const somaPecas = round2(pecas.reduce((s, p) => s + p.valor, 0));
  if (valor > somaPecas + 0.01) throw new CreditoError(`O crédito (${brl(valor)}) não pode passar do valor das peças que faltaram (${brl(somaPecas)})`, 'CREDITO_MAIOR_QUE_FALTA');
  // crédito é devolução do que o cliente JÁ pagou: boleto ainda não foi pago
  if (pagamentos.some((p) => p.forma === 'boleto')) {
    throw new CreditoError('Crédito de peça em falta só vale para pedido já pago. Com boleto, basta faturar o valor das peças que existem.', 'CREDITO_COM_BOLETO');
  }
  const origem = origemDoCredito(pagamentos);
  if (!origem) {
    throw new CreditoError('Crédito de peça em falta só vale quando o pedido foi pago em Pix, cartão ou dinheiro. Em Credev, adiantamento ou saldo bônus, o que não foi usado continua com o cliente.', 'CREDITO_SEM_PAGAMENTO');
  }
  return { valor, pecas, formas: [...new Set(pagamentos.map((p) => p.forma))], origem, status: 'pendente', pedidoEm: new Date().toISOString(), por };
}

// read-modify-write só do pedaço creditoFalta (o resto do pedido_info pode mudar em paralelo)
async function gravar(vendaId, patch) {
  const { data } = await supabase.from('pdv_vendas').select('pedido_info').eq('id', vendaId).maybeSingle();
  const info = { ...(data?.pedido_info || {}) };
  info.creditoFalta = { ...(info.creditoFalta || {}), ...patch, atualizadoEm: new Date().toISOString() };
  const { error } = await supabase.from('pdv_vendas').update({ pedido_info: info }).eq('id', vendaId);
  if (error) throw new CreditoError(error.message, 'DB_ERROR', 500);
  return info.creditoFalta;
}

function textoDoChamado({ venda, nota, credito, saldo }) {
  const empTotvs = Number(venda.pedido_info?.empresaTotvs) || venda.empresa;
  const doc = String(venda.cliente_cpf_cnpj || '').replace(/\D/g, '');
  const forma = FORMAS[credito.origem?.forma] || credito.origem?.forma || '—';
  return [
    'Faturamento da expedição com PEÇA EM FALTA: o cliente optou por ficar com o crédito.',
    '',
    `Cliente: ${venda.cliente_code} — ${venda.cliente_nome || ''}${doc ? ` (${doc.length > 11 ? 'CNPJ' : 'CPF'} ${doc})` : ''}`,
    `Pedido: ${venda.numero_site || '—'}`,
    `NF-e: ${nota.numero}/${nota.serie} (empresa ${venda.empresa})`,
    `Transação HeadCoach: nº ${venda.id}`,
    venda.totvs_transacao_code
      ? `Transação TOTVS: ${empTotvs}/${venda.totvs_transacao_code} (${String(venda.totvs_transacao_date || '').slice(0, 10).split('-').reverse().join('/')})`
      : `Contas a receber HeadCoach: fatura ${9000000000 + Number(venda.id)} (sem transação no TOTVS)`,
    `VALOR DO CRÉDITO GERADO: ${brl(credito.valor)}`,
    `Pagamento do pedido: ${(credito.formas || []).map((f) => FORMAS[f] || f).join(' + ') || '—'}`,
    `Total da nota (só as peças que existiam): ${brl(venda.total)}`,
    '',
    'Peças que faltaram (ficaram fora da nota):',
    ...credito.pecas.map((p) => ` • ${p.quantidade}x ${p.productCode} ${p.nome} — ${brl(p.valor)}`),
    '',
    `O crédito foi gerado como SALDO BÔNUS do cliente no HeadCoach${saldo != null ? ` (saldo bônus atual do cliente: ${brl(saldo)})` : ''}. Não é adiantamento no TOTVS: a transação acima ficou só com as peças que existiam.`,
    `O valor entrou no pagamento deste pedido (${forma}). Quando o cliente usar o saldo bônus em outro faturamento, a transação daquela venda recebe esse valor em ${forma}.`,
    '',
    `Faturado por ${venda.criado_por || '—'} em ${dataHora(venda.criado_em)}.`,
  ].join('\n');
}

async function abrirChamado({ venda, nota, credito, saldo, por }) {
  const assunto = `Crédito de ${brl(credito.valor)} (saldo bônus) — ${String(venda.cliente_nome || `cliente ${venda.cliente_code}`).slice(0, 60)} — peça em falta no faturamento${venda.numero_site ? ` ${venda.numero_site}` : ''}`;
  const r = await drylandRpc('chamado_abrir', {
    p_loja_cd: LOJA_CHAMADO.cd,
    p_loja_nome: LOJA_CHAMADO.nome,
    p_assunto: assunto,
    p_texto: textoDoChamado({ venda, nota, credito, saldo }),
    p_aberto_por: `HeadCoach${por ? ` (${por})` : ''}`,
    p_direcao: 'adm',
    p_setor: SETOR_CHAMADO,
  });
  const id = r?.id ?? r?.chamado?.id ?? null;
  if (!id) throw new CreditoError(`O Dryland não abriu o chamado (${JSON.stringify(r || {}).slice(0, 160)})`, 'CHAMADO_RECUSADO', 502);
  // chamado_abrir devolve só o id; o número que o Financeiro enxerga vem do chamado_get
  let numero = r?.numero ?? null;
  if (!numero) {
    try {
      const g = await drylandRpc('chamado_get', { p_id: id });
      numero = g?.chamado?.numero ?? g?.numero ?? null;
    } catch {
      /* segue só com o id */
    }
  }
  return { id, numero, assunto, abertoEm: new Date().toISOString() };
}

const emAndamento = new Set();

/**
 * Gera o crédito da venda: saldo bônus do cliente + chamado no Dryland para o
 * Financeiro. Pode ser chamado de novo: cada etapa só roda se ainda não foi
 * feita (o bônus é um por venda; o chamado fica guardado na venda).
 */
export async function gerarCreditoFalta(vendaId, { por = null } = {}) {
  if (emAndamento.has(vendaId)) return { emAndamento: true };
  emAndamento.add(vendaId);
  try {
    const { data: venda } = await supabase.from('pdv_vendas').select('*').eq('id', vendaId).maybeSingle();
    if (!venda) throw new CreditoError('Venda não encontrada', 'NOT_FOUND', 404);
    let credito = venda.pedido_info?.creditoFalta || null;
    if (!credito || !(Number(credito.valor) > 0)) return { naoSeAplica: true };
    if (venda.status === 'cancelada') throw new CreditoError('Venda cancelada: o crédito não é gerado', 'VENDA_CANCELADA');
    const { data: notas } = await supabase.from('pdv_notas_fiscais').select('id, numero, serie, chave, status').eq('venda_id', vendaId).order('id', { ascending: false });
    const nota = (notas || []).find((n) => n.status === 'autorizada');
    if (!nota) throw new CreditoError('A NF-e desta venda não está autorizada: o crédito só sai depois da nota', 'SEM_NOTA');
    const fechadaTotvs = venda.totvs_status === 4 && !!venda.totvs_transacao_code;
    if (!fechadaTotvs) {
      // desde 13/11/2026 a transação é só do HeadCoach: basta o contas a receber gerado
      const { data: tits } = await supabase.from('hc_cr_titulos').select('id').eq('venda_id', vendaId).neq('situacao', 'cancelado').limit(1);
      if (!tits?.length) throw new CreditoError('O contas a receber desta venda ainda não foi gerado: o crédito sai assim que for', 'SEM_TRANSACAO');
    }
    const quem = por || venda.criado_por || null;

    // 1) saldo bônus do cliente
    if (!credito.bonus?.id) {
      try {
        const b = await creditarBonus({
          venda,
          valor: credito.valor,
          motivo: `Peça em falta no faturamento${venda.numero_site ? ` ${venda.numero_site}` : ''} (NF-e ${nota.numero})`,
          origem: credito.origem || null,
          por: quem,
        });
        credito = await gravar(vendaId, { bonus: { id: b.id, lancadoEm: b.criado_em || new Date().toISOString() } });
      } catch (e) {
        credito = await gravar(vendaId, { status: 'erro', erro: `Saldo bônus: ${e.message}` });
        console.warn(`⚠️ [crédito] venda ${vendaId}: não lancei o saldo bônus: ${e.message}`);
        return { ok: false, credito };
      }
    }

    // 2) chamado para o Financeiro
    let chamado = credito.chamado || null;
    if (!chamado?.id) {
      try {
        const saldo = await saldoBonusDoCliente(venda.cliente_code).then((s) => s.total).catch(() => null);
        chamado = await abrirChamado({ venda, nota, credito, saldo, por: quem });
      } catch (e) {
        credito = await gravar(vendaId, { status: 'erro', erro: `Saldo bônus lançado, mas o chamado no Dryland não abriu: ${e.message}` });
        console.warn(`⚠️ [crédito] venda ${vendaId}: não abri o chamado no Dryland: ${e.message}`);
        return { ok: false, credito };
      }
    }
    credito = await gravar(vendaId, { chamado, status: 'gerado', erro: null, geradoEm: credito.geradoEm || new Date().toISOString() });
    console.log(`💳 [crédito] venda ${vendaId} (${venda.numero_site || '—'}): ${brl(credito.valor)} de saldo bônus para o cliente ${venda.cliente_code} · chamado ${chamado.numero ? `#${chamado.numero}` : chamado.id}`);
    return { ok: true, credito };
  } finally {
    emAndamento.delete(vendaId);
  }
}
