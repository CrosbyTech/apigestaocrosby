// ============================================================================
// TRANSAÇÕES DO HEADCOACH — consulta no estilo do TRAFL016 do TOTVS
// (Yago, 12/11/2026: etapa 1 da saída do TOTVS — primeiro enxergar tudo o que
// o HeadCoach emite, depois o contas a receber próprio em cima disso).
//
// Junta num formato único o que hoje está em duas fontes:
//   • pdv_vendas (+ itens, pagamentos, notas): PDV Crosby (NFC-e/NF-e/troca),
//     Faturamento da expedição (pedidos do Dryland, Brejinho e avulso) e
//     Transferências saindo da 99 — o nº da transação é o id da venda;
//   • devolucoes_transacoes: devoluções recebidas pela tela de Devoluções
//     (entrada) — nº "D" + id do registro.
// Só leitura. Nomes de operação e de empresa vêm das cópias locais do cadastro
// (erp_operacoes, erp_empresas), sem chamar o TOTVS.
//
// Situação (igual ao TRAFL016):
//   EM ANDAMENTO = ainda não terminou (nota não autorizada / devolução aberta)
//   ATENDIDA     = nota autorizada (venda) ou devolução atendida
//   CANCELADA    = nota/venda cancelada
// Data de encerramento = quando ficou ATENDIDA (autorização da nota) ou
// CANCELADA (cancelamento).
// ============================================================================
import supabase from '../config/supabase.js';

export class HcTransacaoError extends Error {
  constructor(message, code = 'HC_TRANSACAO', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const diaBrasil = (iso) => (iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date(iso)) : null);
const ehData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const semAcento = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();

export const SITUACOES = { andamento: 'EM ANDAMENTO', atendida: 'ATENDIDA', cancelada: 'CANCELADA' };
export const ORIGENS = {
  pdv: 'PDV Crosby',
  troca: 'Troca (PDV)',
  faturamento: 'Faturamento',
  brejinho: 'Faturamento Brejinho',
  avulso: 'Faturamento avulso',
  transferencia: 'Transferência',
  devolucao: 'Devolução',
};
export const FORMAS = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  boleto: 'Boleto',
  credito_loja: 'Credev',
  adiantamento: 'Adiantamento',
  vale_troca: 'Vale-troca',
  saldo_bonus: 'Saldo bônus',
};
const TOTVS_SITUACAO = { 1: 'em andamento', 2: 'encerrada', 3: 'processo externo', 4: 'atendida', 6: 'cancelada' };

// ─── cadastros locais (cache curto) ──────────────────────────────────────────
const cache = new Map();
async function comCache(chave, ttlMs, fn) {
  const c = cache.get(chave);
  if (c && c.ate > Date.now()) return c.valor;
  const valor = await fn();
  cache.set(chave, { valor, ate: Date.now() + ttlMs });
  return valor;
}
async function operacoesPor(codes) {
  const lista = [...new Set(codes.filter((c) => Number(c) > 0).map(Number))].sort((a, b) => a - b);
  if (!lista.length) return new Map();
  return comCache(`op:${lista.join(',')}`, 10 * 60 * 1000, async () => {
    const { data } = await supabase.from('erp_operacoes').select('code, descricao, tipo, financeira, modelo_documento').in('code', lista);
    return new Map((data || []).map((o) => [Number(o.code), o]));
  });
}
async function empresasPor(codes) {
  const lista = [...new Set(codes.filter((c) => Number(c) > 0).map(Number))].sort((a, b) => a - b);
  if (!lista.length) return new Map();
  return comCache(`emp:${lista.join(',')}`, 10 * 60 * 1000, async () => {
    const { data } = await supabase.from('erp_empresas').select('code, descricao, fantasia, cnpj, uf').in('code', lista);
    return new Map((data || []).map((e) => [Number(e.code), e]));
  });
}
// tira o "7234 - " do começo da descrição do TOTVS
const nomeOperacao = (code, op) => {
  const d = String(op?.descricao || '').trim();
  if (!d) return code ? `Operação ${code}` : '—';
  return d.replace(/^\s*\d+\s*[-–]\s*(\d+\s*[-–]\s*)?/, '').trim() || d;
};

// ─── leitura das fontes ──────────────────────────────────────────────────────
const COLS_VENDA =
  'id, empresa, empresa_cnpj, empresa_nome, tipo_venda, operacao, operacao_doc_interno, cliente_code, cliente_nome, cliente_cpf_cnpj, vendedor_code, vendedor_nome, qtd_pecas, subtotal, desconto, cashback_usado, cashback_gerado, frete, total, status, nf_referenciada, observacao, criado_por, criado_em, atualizado_em, origem, canal, pedido_chave, numero_site, data_caixa, pedido_info, cobranca, totvs_transacao_code, totvs_transacao_date, totvs_status, totvs_erro, ' +
  'pdv_notas_fiscais(id, modelo, serie, numero, chave, status, dh_emissao, dh_autorizacao, cancel_em), pdv_venda_pagamentos(forma, valor, parcelas)';
const COLS_DEV =
  'id, devolucao_id, empresa, transacao_code, transacao_date, transacao_status, operacao, cfop, total, atendida_em, cliente_code, cliente_nome, vendedor_code, vendedor_nome, nf_numero, nf_serie, nf_data, nf_empresa, nf_chave, nf_total, nf_qtd_pecas, qtd_recebida, qtd_faltando, qtd_sobrando, valor_faltando, criado_por, criado_em, atualizado_em, origem';

async function lerTudo(montar) {
  const out = [];
  for (let de = 0; de < 50000; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw new HcTransacaoError(error.message, 'DB_ERROR', 500);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function origemDaVenda(v) {
  if (v.origem === 'pdv' || !v.origem) return v.tipo_venda === 'troca' ? 'troca' : 'pdv';
  if (v.canal === 'transferencia' || v.pedido_info?.transferencia) return 'transferencia';
  if (String(v.pedido_chave || '').startsWith('BRJ:')) return 'brejinho';
  if (v.pedido_info?.avulso || String(v.pedido_chave || '').startsWith('AVULSO:')) return 'avulso';
  return 'faturamento';
}
// operação "da transação": a da nota (a do documento interno da 990 fica no detalhe)
function operacaoDaVenda(v) {
  if (Number(v.operacao) > 0) return Number(v.operacao);
  const t = v.pedido_info?.transferencia;
  if (t?.operacaoNota) return Number(t.operacaoNota);
  return Number(v.operacao_doc_interno) || null;
}

function situacaoDaVenda(v, nota) {
  if (v.status === 'cancelada' || nota?.status === 'cancelada') return { situacao: 'cancelada', encerradaEm: nota?.cancel_em || v.atualizado_em };
  if (v.status === 'autorizada' || nota?.status === 'autorizada') return { situacao: 'atendida', encerradaEm: nota?.dh_autorizacao || nota?.dh_emissao || v.atualizado_em };
  return { situacao: 'andamento', encerradaEm: null };
}
function situacaoDaDevolucao(d) {
  if (Number(d.transacao_status) === 6) return { situacao: 'cancelada', encerradaEm: d.atualizado_em };
  if (Number(d.transacao_status) === 4) return { situacao: 'atendida', encerradaEm: d.atendida_em || d.atualizado_em };
  return { situacao: 'andamento', encerradaEm: null };
}

// linha da lista (formato único)
function linhaDaVenda(v) {
  const notas = (v.pdv_notas_fiscais || []).slice().sort((a, b) => b.id - a.id);
  const nota = notas.find((n) => n.status === 'autorizada') || notas.find((n) => n.status === 'cancelada') || notas[0] || null;
  const { situacao, encerradaEm } = situacaoDaVenda(v, nota);
  const origem = origemDaVenda(v);
  const pags = v.pdv_venda_pagamentos || [];
  return {
    id: `V${v.id}`,
    fonte: 'venda',
    numero: String(v.id),
    origem,
    origemNome: ORIGENS[origem],
    empresa: Number(v.empresa),
    empresaNome: v.empresa_nome || null,
    data: v.criado_em,
    encerradaEm,
    situacao,
    operacao: operacaoDaVenda(v),
    tipoOperacao: v.tipo_venda === 'troca' ? 'E' : 'S',
    cliente: { code: v.cliente_code, nome: v.cliente_nome, doc: v.cliente_cpf_cnpj || null },
    vendedor: { code: v.vendedor_code, nome: v.vendedor_nome },
    qtdPecas: Number(v.qtd_pecas) || 0,
    valorBruto: round2(v.subtotal),
    desconto: round2(Number(v.desconto || 0)),
    frete: round2(v.frete || 0),
    valor: round2(v.total),
    formas: [...new Set(pags.map((p) => p.forma))].map((f) => FORMAS[f] || f).join(' + ') || null,
    nf: nota ? { id: nota.id, modelo: nota.modelo, serie: nota.serie, numero: nota.numero, status: nota.status, chave: nota.chave } : null,
    ref: v.numero_site || null,
    canal: v.canal || null,
    criadoPor: v.criado_por || null,
    totvs: v.totvs_transacao_code ? { empresa: Number(v.pedido_info?.empresaTotvs) || Number(v.empresa), transacao: v.totvs_transacao_code, status: v.totvs_status ?? null } : null,
  };
}
function linhaDaDevolucao(d) {
  const { situacao, encerradaEm } = situacaoDaDevolucao(d);
  return {
    id: `D${d.id}`,
    fonte: 'devolucao',
    numero: `D${d.id}`,
    origem: 'devolucao',
    origemNome: ORIGENS.devolucao,
    empresa: Number(d.empresa),
    empresaNome: null,
    data: d.criado_em,
    encerradaEm,
    situacao,
    operacao: Number(d.operacao) || null,
    tipoOperacao: 'E',
    cliente: { code: d.cliente_code, nome: d.cliente_nome, doc: null },
    vendedor: { code: d.vendedor_code, nome: d.vendedor_nome },
    qtdPecas: Number(d.qtd_recebida) || 0,
    valorBruto: round2(d.total),
    desconto: 0,
    frete: 0,
    valor: round2(d.total),
    formas: null,
    nf: d.nf_numero ? { id: null, modelo: 55, serie: d.nf_serie, numero: d.nf_numero, status: 'do cliente', chave: d.nf_chave || null } : null,
    ref: d.devolucao_id ? `DEV-${d.devolucao_id}` : null,
    canal: null,
    criadoPor: d.criado_por || null,
    totvs: d.transacao_code ? { empresa: Number(d.empresa), transacao: d.transacao_code, status: d.transacao_status ?? null } : null,
  };
}

async function completarNomes(linhas) {
  const [ops, emps] = await Promise.all([operacoesPor(linhas.map((l) => l.operacao)), empresasPor(linhas.map((l) => l.empresa))]);
  for (const l of linhas) {
    const op = ops.get(Number(l.operacao));
    l.operacaoNome = nomeOperacao(l.operacao, op);
    // entrada/saída: o cadastro da operação manda; sem cadastro, o que a origem diz
    if (op?.tipo === 'E' || op?.tipo === 'S') l.tipoOperacao = op.tipo;
    const e = emps.get(Number(l.empresa));
    // nome da empresa como no cadastro ("02-CROSBY JOAO PESSOA" → "CROSBY JOAO PESSOA")
    l.empresaNome = String(e?.descricao || '').replace(/^\s*\d+\s*-\s*/, '').trim() || e?.fantasia || l.empresaNome || `Empresa ${l.empresa}`;
  }
  return linhas;
}

// ─── filtros ─────────────────────────────────────────────────────────────────
const numeros = (v) =>
  String(v ?? '')
    .split(/[,;\s]+/)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x > 0);
const valorBR = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function normalizarFiltros(q = {}) {
  const ate = ehData(q.ate) ? q.ate : hojeBrasil();
  let de = ehData(q.de) ? q.de : null;
  if (!de) {
    const d = new Date(`${ate}T12:00:00-03:00`);
    d.setDate(d.getDate() - 30);
    de = diaBrasil(d.toISOString());
  }
  if (de > ate) throw new HcTransacaoError('A data inicial é depois da final');
  const sit = String(q.situacao || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => SITUACOES[s]);
  return {
    de,
    ate,
    empresas: numeros(q.empresa),
    numero: String(q.numero || '').trim().toUpperCase(),
    cliente: String(q.cliente || '').trim(),
    vendedor: String(q.vendedor || '').trim(),
    operacoes: numeros(q.operacao),
    valorMin: valorBR(q.valorMin),
    valorMax: valorBR(q.valorMax),
    descontoMin: valorBR(q.descontoMin),
    descontoMax: valorBR(q.descontoMax),
    encerramentoDe: ehData(q.encerramentoDe) ? q.encerramentoDe : null,
    encerramentoAte: ehData(q.encerramentoAte) ? q.encerramentoAte : null,
    tipo: ['E', 'S'].includes(String(q.tipo || '').toUpperCase()) ? String(q.tipo).toUpperCase() : null,
    situacoes: sit,
    origens: String(q.origem || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => ORIGENS[s]),
    nf: numeros(q.nf),
    pagina: Math.max(1, parseInt(q.pagina, 10) || 1),
    porPagina: Math.min(500, Math.max(10, parseInt(q.porPagina, 10) || 100)),
  };
}

function passa(l, f) {
  if (f.numero) {
    const n = f.numero.replace(/^NO?\.?\s*/, '');
    const alvos = [String(l.numero).toUpperCase(), l.id.toUpperCase(), String(l.totvs?.transacao || ''), String(l.ref || '').toUpperCase()];
    if (!alvos.some((a) => a && a === n)) return false;
  }
  if (f.cliente) {
    const c = f.cliente;
    if (/^\d+$/.test(c)) {
      const doc = String(l.cliente.doc || '').replace(/\D/g, '');
      if (String(l.cliente.code) !== c && !(c.length >= 11 && doc === c)) return false;
    } else if (!semAcento(l.cliente.nome).includes(semAcento(c))) return false;
  }
  if (f.vendedor) {
    const s = f.vendedor;
    if (/^\d+$/.test(s) ? String(l.vendedor.code) !== s : !semAcento(l.vendedor.nome).includes(semAcento(s))) return false;
  }
  if (f.operacoes.length && !f.operacoes.includes(Number(l.operacao))) return false;
  if (f.valorMin != null && l.valor < f.valorMin - 0.001) return false;
  if (f.valorMax != null && l.valor > f.valorMax + 0.001) return false;
  if (f.descontoMin != null && l.desconto < f.descontoMin - 0.001) return false;
  if (f.descontoMax != null && l.desconto > f.descontoMax + 0.001) return false;
  if (f.encerramentoDe || f.encerramentoAte) {
    const dia = diaBrasil(l.encerradaEm);
    if (!dia) return false;
    if (f.encerramentoDe && dia < f.encerramentoDe) return false;
    if (f.encerramentoAte && dia > f.encerramentoAte) return false;
  }
  if (f.tipo && l.tipoOperacao !== f.tipo) return false;
  if (f.situacoes.length && !f.situacoes.includes(l.situacao)) return false;
  if (f.origens.length && !f.origens.includes(l.origem)) return false;
  if (f.nf.length && !f.nf.includes(Number(l.nf?.numero))) return false;
  return true;
}

/** Lista as transações do HeadCoach com os filtros do TRAFL016. */
export async function listarTransacoes(query = {}) {
  const f = normalizarFiltros(query);
  const ini = `${f.de}T00:00:00-03:00`;
  const fim = `${f.ate}T23:59:59.999-03:00`;
  const soDevolucao = f.origens.length > 0 && f.origens.every((o) => o === 'devolucao');
  const semDevolucao = (f.origens.length > 0 && !f.origens.includes('devolucao')) || f.tipo === 'S';
  const [vendas, devs] = await Promise.all([
    soDevolucao
      ? []
      : lerTudo(() => {
          let q = supabase.from('pdv_vendas').select(COLS_VENDA).gte('criado_em', ini).lte('criado_em', fim).order('id', { ascending: false });
          if (f.empresas.length) q = q.in('empresa', f.empresas);
          return q;
        }),
    semDevolucao
      ? []
      : lerTudo(() => {
          let q = supabase.from('devolucoes_transacoes').select(COLS_DEV).gte('criado_em', ini).lte('criado_em', fim).order('id', { ascending: false });
          if (f.empresas.length) q = q.in('empresa', f.empresas);
          return q;
        }),
  ]);
  const todas = await completarNomes([...vendas.map(linhaDaVenda), ...devs.map(linhaDaDevolucao)]);
  const filtradas = todas.filter((l) => passa(l, f)).sort((a, b) => String(b.data).localeCompare(String(a.data)));

  // resumo do que passou no filtro (o valor só conta o que não foi cancelado)
  const resumo = { transacoes: filtradas.length, pecas: 0, valor: 0, desconto: 0, porSituacao: { andamento: 0, atendida: 0, cancelada: 0 }, entradas: 0, saidas: 0 };
  for (const l of filtradas) {
    resumo.porSituacao[l.situacao] += 1;
    if (l.tipoOperacao === 'E') resumo.entradas += 1;
    else resumo.saidas += 1;
    // valor, peças e desconto: só as saídas que não foram canceladas
    if (l.situacao === 'cancelada' || l.tipoOperacao === 'E') continue;
    resumo.pecas += l.qtdPecas;
    resumo.valor += l.valor;
    resumo.desconto += l.desconto;
  }
  resumo.valor = round2(resumo.valor);
  resumo.desconto = round2(resumo.desconto);

  // listas para os campos de escolha da tela (do período, antes dos demais filtros)
  const opcoes = {
    empresas: [...new Map(todas.map((l) => [l.empresa, { code: l.empresa, nome: l.empresaNome }])).values()].sort((a, b) => a.code - b.code),
    operacoes: [...new Map(todas.filter((l) => l.operacao).map((l) => [l.operacao, { code: l.operacao, nome: l.operacaoNome, tipo: l.tipoOperacao }])).values()].sort((a, b) => a.code - b.code),
    vendedores: [...new Map(todas.filter((l) => l.vendedor.code).map((l) => [l.vendedor.code, { code: l.vendedor.code, nome: l.vendedor.nome }])).values()].sort((a, b) =>
      String(a.nome || '').localeCompare(String(b.nome || '')),
    ),
  };
  const inicio = (f.pagina - 1) * f.porPagina;
  return {
    filtros: f,
    resumo,
    opcoes,
    items: filtradas.slice(inicio, inicio + f.porPagina),
    pagina: f.pagina,
    porPagina: f.porPagina,
    paginas: Math.max(1, Math.ceil(filtradas.length / f.porPagina)),
  };
}

// ─── detalhe ─────────────────────────────────────────────────────────────────
async function detalheDaVenda(id) {
  const { data: v, error } = await supabase.from('pdv_vendas').select(COLS_VENDA.replace(/, pdv_notas_fiscais\(.*$/, '')).eq('id', id).maybeSingle();
  if (error) throw new HcTransacaoError(error.message, 'DB_ERROR', 500);
  if (!v) throw new HcTransacaoError('Transação não encontrada', 'NOT_FOUND', 404);
  const [{ data: itens }, { data: pags }, { data: notas }, { data: movs }, { data: fat }] = await Promise.all([
    supabase.from('pdv_venda_itens').select('id, seq, product_code, sku, nome, referencia, ncm, quantidade, valor_unit, desconto_unit, total, epcs, tipo_fiscal, cfop').eq('venda_id', id).order('seq'),
    supabase.from('pdv_venda_pagamentos').select('*').eq('venda_id', id).order('id'),
    supabase
      .from('pdv_notas_fiscais')
      .select('id, modelo, serie, numero, chave, ambiente, status, cstat, xmotivo, protocolo, dh_emissao, dh_autorizacao, cancel_protocolo, cancel_justificativa, cancel_em, erro, criado_em')
      .eq('venda_id', id)
      .order('id'),
    supabase.from('pdv_epc_movimentos').select('epc, tipo, product_code, ocorrido_em').eq('venda_id', id).order('id'),
    supabase.from('pedidos_venda_faturamentos').select('id, chave, numero_site, qtd_pedido, qtd_conferida, qtd_faltando, qtd_sobrando, faltando, sobrando, criado_por, criado_em').eq('venda_id', id).maybeSingle(),
  ]);
  const base = linhaDaVenda({ ...v, pdv_notas_fiscais: notas || [], pdv_venda_pagamentos: pags || [] });
  const [linha] = await completarNomes([base]);
  const docInterno = Number(v.operacao_doc_interno) || null;
  const opsExtra = await operacoesPor([docInterno]);
  const info = v.pedido_info || {};
  return {
    ...linha,
    observacao: v.observacao || null,
    cashbackUsado: round2(v.cashback_usado || 0),
    cashbackGerado: round2(v.cashback_gerado || 0),
    dataCaixa: v.data_caixa || null,
    atualizadoEm: v.atualizado_em,
    nfReferenciada: v.nf_referenciada || null,
    pedido: {
      chave: v.pedido_chave || null,
      ref: v.numero_site || null,
      canal: v.canal || null,
      formaNoPedido: info.forma || null,
      trocas: info.trocas || [],
      descontoFaturamento: info.descontoFaturamento || null,
      precosAlterados: info.precosAlterados || [],
      creditoFalta: info.creditoFalta || null,
      dataVenda: info.dataVenda || null,
      transferencia: info.transferencia || null,
      conferencia: fat
        ? { qtdPedido: fat.qtd_pedido, qtdConferida: fat.qtd_conferida, qtdFaltando: fat.qtd_faltando, qtdSobrando: fat.qtd_sobrando, faltando: fat.faltando || [], sobrando: fat.sobrando || [] }
        : null,
    },
    itens: (itens || []).map((i) => ({
      seq: i.seq,
      productCode: i.product_code,
      sku: i.sku,
      nome: i.nome,
      referencia: i.referencia,
      ncm: i.ncm,
      cfop: i.cfop,
      tipoFiscal: i.tipo_fiscal,
      quantidade: Number(i.quantidade),
      valorUnit: round2(i.valor_unit),
      descontoUnit: round2(i.desconto_unit || 0),
      total: round2(i.total),
      epcs: Array.isArray(i.epcs) ? i.epcs : [],
    })),
    pagamentos: (pags || []).map((p) => ({
      forma: p.forma,
      formaNome: FORMAS[p.forma] || p.forma,
      valor: round2(p.valor),
      parcelas: p.parcelas,
      bandeira: p.bandeira || null,
      nsu: p.nsu || null,
      autorizacao: p.autorizacao || null,
      troco: round2(p.troco || 0),
      cartao: p.cartao_totvs || null,
    })),
    cobranca: v.cobranca?.parcelas || [],
    notas: (notas || []).map((n) => ({ ...n })),
    etiquetas: (movs || []).map((m) => ({ epc: m.epc, tipo: m.tipo, productCode: m.product_code, em: m.ocorrido_em })),
    comprovantes: Array.isArray(v.comprovantes) ? v.comprovantes : [],
    transporte: v.transporte || null,
    totvsEspelho: v.totvs_transacao_code || v.totvs_erro || docInterno
      ? {
          empresa: Number(info.empresaTotvs) || Number(v.empresa),
          transacao: v.totvs_transacao_code || null,
          data: v.totvs_transacao_date || null,
          status: v.totvs_status ?? null,
          statusNome: TOTVS_SITUACAO[v.totvs_status] || null,
          operacaoDocInterno: docInterno,
          operacaoDocInternoNome: docInterno ? nomeOperacao(docInterno, opsExtra.get(docInterno)) : null,
          erro: v.totvs_erro || null,
        }
      : null,
  };
}

async function detalheDaDevolucao(id) {
  const { data: d, error } = await supabase.from('devolucoes_transacoes').select('*').eq('id', id).maybeSingle();
  if (error) throw new HcTransacaoError(error.message, 'DB_ERROR', 500);
  if (!d) throw new HcTransacaoError('Transação não encontrada', 'NOT_FOUND', 404);
  const { data: sol } = d.devolucao_id
    ? await supabase.from('devolucoes_mercadoria').select('id, tipo, status, origem, observacao, cliente_cpf_cnpj, chamado_dryland_numero').eq('id', d.devolucao_id).maybeSingle()
    : { data: null };
  const [linha] = await completarNomes([linhaDaDevolucao(d)]);
  if (sol?.cliente_cpf_cnpj) linha.cliente.doc = sol.cliente_cpf_cnpj;
  const item = (x, i) => ({
    seq: i + 1,
    productCode: x.productCode,
    sku: x.sku || null,
    nome: x.name || x.nome || `Produto ${x.productCode}`,
    referencia: x.referencia || null,
    ncm: null,
    cfop: d.cfop || null,
    tipoFiscal: null,
    quantidade: Number(x.quantidade ?? x.lido ?? 0),
    valorUnit: round2(x.unit || 0),
    descontoUnit: 0,
    total: round2(x.total ?? (Number(x.unit) || 0) * Number(x.quantidade ?? 0)),
    epcs: Array.isArray(x.epcs) ? x.epcs : [],
  });
  return {
    ...linha,
    observacao: sol?.observacao || null,
    cashbackUsado: 0,
    cashbackGerado: 0,
    dataCaixa: null,
    atualizadoEm: d.atualizado_em,
    nfReferenciada: d.nf_chave || null,
    pedido: null,
    devolucao: {
      solicitacao: d.devolucao_id || null,
      tipo: sol?.tipo || null,
      solicitacaoStatus: sol?.status || null,
      chamadoDryland: sol?.chamado_dryland_numero || null,
      nfCliente: d.nf_numero ? { numero: d.nf_numero, serie: d.nf_serie, data: d.nf_data, empresa: d.nf_empresa, chave: d.nf_chave, total: round2(d.nf_total || 0), pecas: d.nf_qtd_pecas } : null,
      qtdRecebida: d.qtd_recebida,
      qtdFaltando: d.qtd_faltando,
      qtdSobrando: d.qtd_sobrando,
      valorFaltando: round2(d.valor_faltando || 0),
      faltando: (d.faltando || []).map(item),
      sobrando: (d.sobrando || []).map(item),
    },
    itens: (d.recebidos || []).map(item),
    pagamentos: [],
    cobranca: [],
    notas: [],
    etiquetas: (d.recebidos || []).flatMap((x) => (Array.isArray(x.epcs) ? x.epcs : []).map((epc) => ({ epc, tipo: 'devolucao', productCode: x.productCode, em: d.criado_em }))),
    comprovantes: [],
    transporte: null,
    totvsEspelho: d.transacao_code
      ? { empresa: Number(d.empresa), transacao: d.transacao_code, data: d.transacao_date, status: d.transacao_status, statusNome: TOTVS_SITUACAO[d.transacao_status] || null, operacaoDocInterno: null, operacaoDocInternoNome: null, erro: null }
      : null,
  };
}

/** Detalhe de uma transação: "V45" / "45" (venda) ou "D28" (devolução). */
export async function detalheTransacao(idTexto) {
  const s = String(idTexto || '').trim().toUpperCase();
  const m = s.match(/^([VD])?(\d+)$/);
  if (!m) throw new HcTransacaoError('Número de transação inválido', 'ID_INVALIDO');
  return m[1] === 'D' ? detalheDaDevolucao(Number(m[2])) : detalheDaVenda(Number(m[2]));
}
