// ============================================================================
// HEADCOACH › CONTAS A RECEBER (Yago, 12/11/2026) — títulos próprios, sem o
// TOTVS e sem nada em paralelo com ele. Tabelas: migrations/hc_contas_receber.sql.
//
// Geração (gerarTitulosDaVenda / gerarTitulosPendentes): venda do HeadCoach
// com nota AUTORIZADA vira títulos, um por forma de pagamento (boleto: um por
// parcela). Fatura = 9.000.000.000 + nº da transação; parcela 1, 2…
//   • dinheiro ............ pago na emissão (liquida no dia)
//   • Pix, crédito, débito  pagos na emissão, liquidação D+N (config, padrão D+1),
//                           taxa da maquininha da config; ficam "a conciliar"
//   • credev, adiantamento, saldo bônus: pagos (compensação de crédito)
//   • boleto/fatura ....... em aberto até a baixa (juros, multa, desconto)
//   • vale-troca .......... não vira título (crédito da própria troca)
// Transferências e devoluções não geram contas a receber. Venda/nota cancelada
// → títulos cancelados. Sem estorno de baixa (pedido do Yago).
//
// Conciliação D+1: vendeu hoje, concilia amanhã. Os títulos de cartão/Pix com
// liquidação até hoje aparecem agrupados por empresa + data + forma + portador;
// informando o que caiu, a diferença vira a taxa real (rateada nos títulos).
// ============================================================================
import supabase from '../config/supabase.js';
import { verificarSenhaAutorizador, AutorizacaoError } from './autorizacaoSenha.js';
import { empresasDoUsuario } from './hcCaixa.js';

export class CrError extends Error {
  constructor(message, code = 'HC_CR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const BASE_FATURA = 9000000000;
const PERFIS_FINANCEIRO = ['owner', 'admin', 'user']; // user = financeiro

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const diaBrasil = (iso) => (iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date(iso)) : null);
const maisDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const ehData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const quem = (user) => user?.name || user?.email || null;

export const FORMAS = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  boleto: 'Boleto / fatura',
  credito_loja: 'Credev',
  adiantamento: 'Adiantamento',
  saldo_bonus: 'Saldo bônus',
};
// código do tipo de documento no TOTVS (mesmas informações do CR do TOTVS)
const TIPO_DOCUMENTO = { dinheiro: 3, credito: 4, debito: 5, pix: 26, boleto: 1, credito_loja: 20, adiantamento: 10, saldo_bonus: null };
const CONCILIA = new Set(['pix', 'credito', 'debito']);
// adquirente pelo CNPJ (PDV) quando o pagamento não traz a operadora
const ADQUIRENTES = {
  16501555000157: 'STONE',
  1425787000104: 'REDE',
  1027058000191: 'CIELO',
  8561701000101: 'PAGSEGURO',
  10440482000154: 'GETNET',
  18727053000174: 'PAGAR.ME',
};

function falhaDb(error) {
  if (/relation .* does not exist|could not find the table|schema cache|column .* does not exist/i.test(String(error?.message || ''))) {
    return new CrError('O contas a receber ainda não está liberado: faltam as tabelas no banco. Rode "node scripts/migrar-hc-contas-receber.mjs" na pasta da API.', 'MIGRATION_PENDING', 503);
  }
  return new CrError(error?.message || 'Erro no banco', 'DB_ERROR', 500);
}
async function q(promessa) {
  const { data, error } = await promessa;
  if (error) throw falhaDb(error);
  return data;
}
// busca tudo (o Supabase devolve no máximo 1000 por vez)
async function todas(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const lote = await q(montar().range(de, de + 999));
    out.push(...(lote || []));
    if (!lote || lote.length < 1000) break;
  }
  return out;
}
async function conferirSenha(email, senha, perfis) {
  try {
    return await verificarSenhaAutorizador(email, senha, perfis);
  } catch (e) {
    if (e instanceof AutorizacaoError) throw new CrError(e.message, e.code, e.status);
    throw e;
  }
}
function exigirFinanceiro(user) {
  if (!PERFIS_FINANCEIRO.includes(user?.role)) throw new CrError('Só owner, admin ou financeiro faz isso no contas a receber', 'SEM_PERMISSAO', 403);
}
async function empresasPermitidas(user, empresa) {
  const lista = await empresasDoUsuario(user);
  if (empresa) {
    const n = Number(empresa);
    if (!lista.some((e) => e.code === n)) throw new CrError(`Você não tem acesso à empresa ${n}`, 'SEM_ACESSO_EMPRESA', 403);
    return { lista, codes: [n] };
  }
  return { lista, codes: lista.map((e) => e.code) };
}

// ─── configuração ────────────────────────────────────────────────────────────
const CONFIG_PADRAO = {
  juros_mes_pct: 1,
  multa_pct: 2,
  taxa_credito_pct: 0,
  taxa_credito_parc_pct: 0,
  taxa_debito_pct: 0,
  taxa_pix_pct: 0,
  dias_liq_credito: 1,
  dias_liq_debito: 1,
  dias_liq_pix: 1,
};
export async function lerConfig() {
  const row = await q(supabase.from('hc_cr_config').select('*').eq('id', 1).maybeSingle());
  const c = { ...CONFIG_PADRAO };
  for (const k of Object.keys(CONFIG_PADRAO)) if (row && row[k] !== null && row[k] !== undefined) c[k] = Number(row[k]);
  return { ...c, atualizado_por: row?.atualizado_por || null, atualizado_em: row?.atualizado_em || null };
}
export async function salvarConfig(user, b = {}) {
  exigirFinanceiro(user);
  const patch = {};
  for (const k of Object.keys(CONFIG_PADRAO)) {
    if (b[k] === undefined) continue;
    const v = num(b[k]);
    if (!Number.isFinite(v) || v < 0) throw new CrError(`Valor inválido em ${k}`);
    if (k.startsWith('dias_')) {
      if (!Number.isInteger(v) || v > 60) throw new CrError('Dias de liquidação: número inteiro de 0 a 60');
    } else if (v > 100) throw new CrError('Percentual acima de 100%');
    patch[k] = v;
  }
  await q(supabase.from('hc_cr_config').upsert({ id: 1, ...patch, atualizado_por: quem(user), atualizado_em: new Date().toISOString() }, { onConflict: 'id' }));
  return lerConfig();
}

// juros e multa de um título em aberto vencido (juros simples pro rata dia)
export function valoresAtualizados(t, cfg, hoje = hojeBrasil()) {
  const valor = round2(t.valor);
  if (t.situacao !== 'aberto' || !t.vencimento || String(t.vencimento) >= hoje) return { diasAtraso: 0, juros: 0, multa: 0, total: valor };
  const dias = diasEntre(String(t.vencimento).slice(0, 10), hoje);
  const multa = round2((valor * cfg.multa_pct) / 100);
  const juros = round2((((valor * cfg.juros_mes_pct) / 100) / 30) * dias);
  return { diasAtraso: dias, juros, multa, total: round2(valor + juros + multa) };
}

// ─── geração dos títulos de uma venda ────────────────────────────────────────
function portadorDo(p) {
  if (p.forma === 'pix') return 'PIX';
  if (p.forma === 'credito' || p.forma === 'debito') {
    const op = p.cartao_totvs?.operadora;
    if (op) return String(op).toUpperCase();
    const cnpj = Number(String(p.adquirente_cnpj || '').replace(/\D/g, '')) || 0;
    return ADQUIRENTES[cnpj] || 'MAQUININHA';
  }
  if (p.forma === 'boleto') return 'CARTEIRA';
  return null;
}

/** Monta as linhas de título de uma venda autorizada (sem gravar). */
export function montarTitulos(venda, cfg, extra = {}) {
  const fatura = BASE_FATURA + Number(venda.id);
  const nota = (venda.pdv_notas_fiscais || []).find((n) => n.status === 'autorizada') || null;
  const emissao = diaBrasil(nota?.dh_autorizacao || nota?.criado_em || venda.criado_em) || hojeBrasil();
  const base = {
    empresa: Number(venda.empresa),
    fatura,
    venda_id: Number(venda.id),
    origem: venda.origem || 'pdv',
    canal: venda.canal || null,
    operacao: venda.operacao ?? null,
    cliente_code: venda.cliente_code ?? null,
    cliente_nome: venda.cliente_nome || null,
    cliente_cpf_cnpj: venda.cliente_cpf_cnpj || null,
    vendedor_code: venda.vendedor_code ?? null,
    vendedor_nome: venda.vendedor_nome || null,
    nf_modelo: nota?.modelo ?? null,
    nf_serie: nota?.serie ?? null,
    nf_numero: nota?.numero ?? null,
    nf_chave: nota?.chave || null,
    caixa_id: venda.caixa_id ?? null,
    data_caixa: extra.dataCaixa || null,
    emissao,
  };
  const linhas = [];
  let parcela = 0;
  const pagamentos = [...(venda.pdv_venda_pagamentos || [])].sort((a, b) => Number(a.id) - Number(b.id));
  for (const p of pagamentos) {
    const forma = String(p.forma || '');
    if (forma === 'vale_troca') continue; // crédito da própria troca
    const valor = round2(forma === 'dinheiro' ? Number(p.valor || 0) - Number(p.troco || 0) : Number(p.valor || 0));
    if (!(valor > 0)) continue;
    const comum = {
      ...base,
      pagamento_id: p.id ?? null,
      forma,
      tipo_documento: TIPO_DOCUMENTO[forma] ?? null,
      portador: portadorDo(p),
      bandeira: p.bandeira || p.cartao_totvs?.bandeira || null,
      nsu: p.nsu || null,
      autorizacao: p.autorizacao || null,
      parcelas_cartao: forma === 'credito' ? Math.max(1, Number(p.parcelas || p.cartao_totvs?.parcelas || 1)) : null,
    };
    if (forma === 'boleto') {
      // parcelas do pedido (cobranca.parcelas); sem elas, parcelas iguais a cada 30 dias
      let parcs = Array.isArray(venda.cobranca?.parcelas) && venda.cobranca.parcelas.length ? venda.cobranca.parcelas : null;
      if (!parcs) {
        const n = Math.max(1, Number(p.parcelas) || 1);
        const v1 = round2(valor / n);
        parcs = Array.from({ length: n }, (_, i) => ({ vencimento: maisDias(emissao, 30 * (i + 1)), valor: i === n - 1 ? round2(valor - v1 * (n - 1)) : v1 }));
      }
      for (const x of parcs) {
        parcela += 1;
        const v = round2(x.valor);
        linhas.push({
          ...comum,
          parcela,
          vencimento: ehData(String(x.vencimento || '').slice(0, 10)) ? String(x.vencimento).slice(0, 10) : maisDias(emissao, 30),
          valor: v,
          valor_liquido: v,
          situacao: 'aberto',
          precisa_conciliar: false,
        });
      }
      continue;
    }
    parcela += 1;
    let taxaPct = 0;
    let dias = 0;
    if (forma === 'credito') {
      taxaPct = comum.parcelas_cartao > 1 ? cfg.taxa_credito_parc_pct : cfg.taxa_credito_pct;
      dias = cfg.dias_liq_credito;
    } else if (forma === 'debito') {
      taxaPct = cfg.taxa_debito_pct;
      dias = cfg.dias_liq_debito;
    } else if (forma === 'pix') {
      taxaPct = cfg.taxa_pix_pct;
      dias = cfg.dias_liq_pix;
    }
    const taxa = round2((valor * taxaPct) / 100);
    linhas.push({
      ...comum,
      parcela,
      vencimento: emissao,
      valor,
      taxa_pct: taxaPct,
      taxa_valor: taxa,
      valor_liquido: round2(valor - taxa),
      situacao: 'pago',
      data_pagamento: emissao,
      data_liquidacao: maisDias(emissao, dias),
      valor_pago: valor,
      precisa_conciliar: CONCILIA.has(forma),
      baixado_por: 'automático (na emissão)',
      baixado_em: new Date().toISOString(),
    });
  }
  return linhas;
}

const SELECT_VENDA =
  'id, empresa, origem, canal, tipo_venda, operacao, status, cliente_code, cliente_nome, cliente_cpf_cnpj, vendedor_code, vendedor_nome, total, criado_em, caixa_id, cobranca, pdv_venda_pagamentos(*), pdv_notas_fiscais(modelo, serie, numero, chave, status, dh_autorizacao, criado_em)';

/**
 * Gera (ou acerta) os títulos de uma venda. Idempotente: venda autorizada sem
 * títulos → cria; venda cancelada com títulos ativos → cancela. Devolve o que fez.
 */
export async function gerarTitulosDaVenda(vendaId, { cfg } = {}) {
  const venda = await q(supabase.from('pdv_vendas').select(SELECT_VENDA).eq('id', Number(vendaId)).maybeSingle());
  if (!venda) return { acao: 'nada', motivo: 'venda não encontrada' };
  if (venda.canal === 'transferencia') return { acao: 'nada', motivo: 'transferência não gera contas a receber' };
  const existentes = await q(supabase.from('hc_cr_titulos').select('id, situacao').eq('venda_id', venda.id));
  if (venda.status === 'cancelada') {
    const ativos = (existentes || []).filter((t) => t.situacao !== 'cancelado');
    if (!ativos.length) return { acao: 'nada' };
    await q(
      supabase
        .from('hc_cr_titulos')
        .update({ situacao: 'cancelado', cancelado_em: new Date().toISOString(), cancelado_motivo: 'Venda/nota cancelada' })
        .eq('venda_id', venda.id)
        .neq('situacao', 'cancelado'),
    );
    console.log(`📕 [contas a receber] venda ${venda.id} cancelada: ${ativos.length} título(s) cancelado(s)`);
    return { acao: 'cancelados', qtd: ativos.length };
  }
  if (venda.status !== 'autorizada') return { acao: 'nada', motivo: `venda ${venda.status}` };
  if ((existentes || []).length) return { acao: 'nada', motivo: 'já tem títulos' };
  const config = cfg || (await lerConfig());
  let dataCaixa = null;
  if (venda.caixa_id) {
    const cx = await q(supabase.from('hc_caixas').select('data_caixa').eq('id', venda.caixa_id).maybeSingle()).catch(() => null);
    dataCaixa = cx?.data_caixa ? String(cx.data_caixa).slice(0, 10) : null;
  }
  const linhas = montarTitulos(venda, config, { dataCaixa });
  if (!linhas.length) return { acao: 'nada', motivo: 'sem pagamento que gere título' };
  const { error } = await supabase.from('hc_cr_titulos').insert(linhas);
  if (error) {
    if (/duplicate key|hc_cr_titulos_fatura_parcela/i.test(error.message)) return { acao: 'nada', motivo: 'já tem títulos' };
    throw falhaDb(error);
  }
  console.log(`📗 [contas a receber] venda ${venda.id}: ${linhas.length} título(s) · fatura ${BASE_FATURA + Number(venda.id)}`);
  return { acao: 'criados', qtd: linhas.length };
}

/** Para chamar depois de autorizar/cancelar uma nota: nunca lança erro. */
export function sincronizarVendaEmSegundoPlano(vendaId) {
  gerarTitulosDaVenda(vendaId).catch((e) => console.error(`[contas a receber] venda ${vendaId}:`, e.message));
}

/**
 * Varre as vendas: autorizadas sem títulos → gera; canceladas com títulos
 * ativos → cancela. `todas` = desde o começo; senão, os últimos `dias` dias.
 */
export async function gerarTitulosPendentes({ todas: tudo = false, dias = 45 } = {}) {
  const desde = tudo ? null : maisDias(hojeBrasil(), -dias);
  const vendas = await todas(() => {
    let qy = supabase.from('pdv_vendas').select('id, status, canal').in('status', ['autorizada', 'cancelada']).order('id');
    if (desde) qy = qy.gte('criado_em', `${desde}T00:00:00-03:00`);
    return qy;
  });
  const alvo = vendas.filter((v) => v.canal !== 'transferencia');
  const comTitulo = new Map(); // venda_id → tem título ativo?
  for (let i = 0; i < alvo.length; i += 200) {
    const ids = alvo.slice(i, i + 200).map((v) => v.id);
    const ts = await q(supabase.from('hc_cr_titulos').select('venda_id, situacao').in('venda_id', ids));
    for (const t of ts || []) comTitulo.set(Number(t.venda_id), comTitulo.get(Number(t.venda_id)) || t.situacao !== 'cancelado');
  }
  const cfg = await lerConfig();
  const r = { vendas: alvo.length, vendasComTitulos: 0, titulosCriados: 0, vendasCanceladas: 0, erros: [] };
  for (const v of alvo) {
    const tem = comTitulo.has(Number(v.id));
    const precisa = (v.status === 'autorizada' && !tem) || (v.status === 'cancelada' && comTitulo.get(Number(v.id)) === true);
    if (!precisa) continue;
    try {
      const x = await gerarTitulosDaVenda(v.id, { cfg });
      if (x.acao === 'criados') {
        r.vendasComTitulos += 1;
        r.titulosCriados += x.qtd;
      } else if (x.acao === 'cancelados') r.vendasCanceladas += 1;
    } catch (e) {
      r.erros.push({ venda: v.id, erro: e.message });
    }
  }
  return r;
}

// ─── consulta ────────────────────────────────────────────────────────────────
const CAMPOS_DATA = { emissao: 'emissao', vencimento: 'vencimento', pagamento: 'data_pagamento', liquidacao: 'data_liquidacao' };

export async function listarTitulos(user, f = {}) {
  const { lista, codes } = await empresasPermitidas(user, f.empresa);
  if (!codes.length) return { titulos: [], totais: {}, empresas: lista };
  const campo = CAMPOS_DATA[f.campoData] || 'emissao';
  const hoje = hojeBrasil();
  const cfg = await lerConfig();
  const busca = String(f.cliente || '').trim();
  const rows = await todas(() => {
    let qy = supabase.from('hc_cr_titulos').select('*').in('empresa', codes);
    if (ehData(f.de)) qy = qy.gte(campo, f.de);
    if (ehData(f.ate)) qy = qy.lte(campo, f.ate);
    if (f.situacao === 'vencido') qy = qy.eq('situacao', 'aberto').lt('vencimento', hoje);
    else if (['aberto', 'pago', 'cancelado'].includes(f.situacao)) qy = qy.eq('situacao', f.situacao);
    if (f.forma && FORMAS[f.forma]) qy = qy.eq('forma', f.forma);
    if (f.portador) qy = qy.eq('portador', String(f.portador).toUpperCase());
    if (f.conciliacao === 'pendente') qy = qy.eq('precisa_conciliar', true).is('conciliado_em', null).eq('situacao', 'pago');
    else if (f.conciliacao === 'conciliado') qy = qy.not('conciliado_em', 'is', null);
    const fat = String(f.fatura || '').replace(/\D/g, '');
    if (fat) qy = Number(fat) < BASE_FATURA ? qy.eq('venda_id', Number(fat)) : qy.eq('fatura', Number(fat));
    if (busca) {
      const dig = busca.replace(/\D/g, '');
      if (/^\d+$/.test(busca) && dig.length <= 9) qy = qy.eq('cliente_code', Number(dig));
      else if (dig.length >= 11 && dig.length === busca.replace(/[\s.\-/]/g, '').length) qy = qy.eq('cliente_cpf_cnpj', dig);
      else qy = qy.ilike('cliente_nome', `%${busca.replace(/[%_,()]/g, ' ')}%`);
    }
    return qy.order(campo, { ascending: false }).order('fatura', { ascending: false }).order('parcela');
  });
  const totais = { qtd: 0, valor: 0, aberto: 0, abertoAtualizado: 0, vencido: 0, pago: 0, recebido: 0, taxa: 0, liquido: 0, aConciliar: 0, cancelado: 0 };
  const titulos = rows.map((t) => {
    const at = valoresAtualizados(t, cfg, hoje);
    const v = round2(t.valor);
    totais.qtd += 1;
    if (t.situacao === 'cancelado') totais.cancelado = round2(totais.cancelado + v);
    else {
      totais.valor = round2(totais.valor + v);
      if (t.situacao === 'aberto') {
        totais.aberto = round2(totais.aberto + v);
        totais.abertoAtualizado = round2(totais.abertoAtualizado + at.total);
        if (at.diasAtraso > 0) totais.vencido = round2(totais.vencido + v);
      } else {
        totais.pago = round2(totais.pago + v);
        totais.recebido = round2(totais.recebido + Number(t.valor_pago || 0));
        totais.taxa = round2(totais.taxa + Number(t.taxa_valor || 0));
        totais.liquido = round2(totais.liquido + Number(t.valor_liquido ?? t.valor_pago ?? 0));
        if (t.precisa_conciliar && !t.conciliado_em) totais.aConciliar = round2(totais.aConciliar + v);
      }
    }
    return { ...t, atualizado: at };
  });
  return { titulos, totais, empresas: lista, config: cfg, hoje };
}

export async function detalheTitulo(user, id) {
  const t = await q(supabase.from('hc_cr_titulos').select('*').eq('id', Number(id)).maybeSingle());
  if (!t) throw new CrError('Título não encontrado', 'NOT_FOUND', 404);
  await empresasPermitidas(user, t.empresa);
  const [baixas, irmaos, conc, cfg] = await Promise.all([
    q(supabase.from('hc_cr_baixas').select('*').eq('titulo_id', t.id).order('id')),
    q(supabase.from('hc_cr_titulos').select('id, parcela, forma, valor, vencimento, situacao, data_pagamento').eq('fatura', t.fatura).order('parcela')),
    t.conciliacao_id ? q(supabase.from('hc_cr_conciliacoes').select('*').eq('id', t.conciliacao_id).maybeSingle()) : null,
    lerConfig(),
  ]);
  return { titulo: { ...t, atualizado: valoresAtualizados(t, cfg) }, baixas: baixas || [], parcelas: irmaos || [], conciliacao: conc || null, config: cfg };
}

// ─── baixa (título em aberto) — sem estorno ──────────────────────────────────
export async function baixarTitulo(user, id, b = {}) {
  exigirFinanceiro(user);
  const t = await q(supabase.from('hc_cr_titulos').select('*').eq('id', Number(id)).maybeSingle());
  if (!t) throw new CrError('Título não encontrado', 'NOT_FOUND', 404);
  await empresasPermitidas(user, t.empresa);
  if (t.situacao !== 'aberto') throw new CrError(`Este título já está ${t.situacao}`, 'JA_BAIXADO', 409);
  const data = ehData(b.dataPagamento) ? b.dataPagamento : hojeBrasil();
  if (data > hojeBrasil()) throw new CrError('A data do pagamento não pode ser no futuro');
  if (data < String(t.emissao).slice(0, 10)) throw new CrError('A data do pagamento não pode ser antes da emissão');
  const cfg = await lerConfig();
  const calc = valoresAtualizados(t, cfg, data);
  const juros = b.juros === undefined || b.juros === '' ? calc.juros : round2(num(b.juros));
  const multa = b.multa === undefined || b.multa === '' ? calc.multa : round2(num(b.multa));
  const desconto = round2(num(b.desconto));
  for (const [n, v] of [['juros', juros], ['multa', multa], ['desconto', desconto]]) {
    if (!Number.isFinite(v) || v < 0) throw new CrError(`Valor inválido em ${n}`);
  }
  const valor = round2(t.valor);
  if (desconto > valor + juros + multa) throw new CrError('O desconto é maior que o valor a receber');
  const recebido = round2(valor + juros + multa - desconto);
  await conferirSenha(user?.email, b.senha, PERFIS_FINANCEIRO);
  const agora = new Date().toISOString();
  const { data: atual, error } = await supabase
    .from('hc_cr_titulos')
    .update({
      situacao: 'pago',
      data_pagamento: data,
      data_liquidacao: data,
      valor_pago: recebido,
      valor_liquido: recebido,
      juros,
      multa,
      desconto,
      baixado_por: quem(user),
      baixado_em: agora,
    })
    .eq('id', t.id)
    .eq('situacao', 'aberto')
    .select()
    .maybeSingle();
  if (error) throw falhaDb(error);
  if (!atual) throw new CrError('Este título acabou de ser baixado por outra pessoa', 'JA_BAIXADO', 409);
  await q(
    supabase.from('hc_cr_baixas').insert({
      titulo_id: t.id,
      data_pagamento: data,
      valor_titulo: valor,
      juros,
      multa,
      desconto,
      valor_recebido: recebido,
      forma_recebimento: String(b.formaRecebimento || '').trim() || null,
      conta: String(b.conta || '').trim() || null,
      observacao: String(b.observacao || '').trim() || null,
      por_id: user?.id || null,
      por: quem(user),
    }),
  );
  console.log(`💵 [contas a receber] baixa fatura ${t.fatura}/${t.parcela} R$ ${recebido.toFixed(2)} (juros ${juros} multa ${multa} desc ${desconto}) · ${quem(user)}`);
  return atual;
}

// ─── conciliação D+1 (cartão e Pix) ──────────────────────────────────────────
const chaveGrupo = (t) => `${t.empresa}|${String(t.data_liquidacao).slice(0, 10)}|${t.forma}|${t.portador || ''}`;

export async function pendentesConciliacao(user, f = {}) {
  const { codes } = await empresasPermitidas(user, f.empresa);
  if (!codes.length) return { grupos: [] };
  const hoje = hojeBrasil();
  const ate = ehData(f.ate) && f.ate < hoje ? f.ate : hoje; // vendeu hoje, concilia amanhã
  const rows = await todas(() =>
    supabase
      .from('hc_cr_titulos')
      .select('id, empresa, fatura, parcela, venda_id, forma, portador, bandeira, nsu, autorizacao, parcelas_cartao, cliente_nome, emissao, data_liquidacao, valor, taxa_valor, valor_liquido')
      .in('empresa', codes)
      .eq('precisa_conciliar', true)
      .eq('situacao', 'pago')
      .is('conciliado_em', null)
      .lte('data_liquidacao', ate)
      .order('data_liquidacao')
      .order('id'),
  );
  const grupos = new Map();
  for (const t of rows) {
    const k = chaveGrupo(t);
    if (!grupos.has(k)) grupos.set(k, { chave: k, empresa: t.empresa, dataLiquidacao: String(t.data_liquidacao).slice(0, 10), forma: t.forma, portador: t.portador || null, qtd: 0, bruto: 0, taxaPrevista: 0, liquidoPrevisto: 0, titulos: [] });
    const g = grupos.get(k);
    g.qtd += 1;
    g.bruto = round2(g.bruto + Number(t.valor));
    g.taxaPrevista = round2(g.taxaPrevista + Number(t.taxa_valor || 0));
    g.liquidoPrevisto = round2(g.liquidoPrevisto + Number(t.valor_liquido ?? t.valor));
    g.titulos.push(t);
  }
  const recentes = await q(supabase.from('hc_cr_conciliacoes').select('*').in('empresa', codes).order('id', { ascending: false }).limit(30));
  return { hoje, ate, grupos: [...grupos.values()], recentes: recentes || [] };
}

export async function conciliar(user, b = {}) {
  exigirFinanceiro(user);
  const empresa = Number(b.empresa);
  await empresasPermitidas(user, empresa);
  const data = String(b.dataLiquidacao || '');
  if (!ehData(data)) throw new CrError('Informe a data de liquidação');
  if (data > hojeBrasil()) throw new CrError('Ainda não chegou a data de liquidação');
  const forma = String(b.forma || '');
  if (!CONCILIA.has(forma)) throw new CrError('Só cartão e Pix são conciliados');
  const recebido = round2(num(b.valorRecebido));
  if (!Number.isFinite(recebido) || recebido < 0) throw new CrError('Informe o valor que caiu na conta');
  let qy = supabase
    .from('hc_cr_titulos')
    .select('id, valor')
    .eq('empresa', empresa)
    .eq('data_liquidacao', data)
    .eq('forma', forma)
    .eq('precisa_conciliar', true)
    .eq('situacao', 'pago')
    .is('conciliado_em', null)
    .order('id');
  qy = b.portador ? qy.eq('portador', b.portador) : qy.is('portador', null);
  const titulos = await q(qy);
  if (!titulos?.length) throw new CrError('Não há títulos a conciliar nesse grupo (alguém pode ter conciliado agora)', 'NADA_A_CONCILIAR', 409);
  const bruto = round2(titulos.reduce((s, t) => s + Number(t.valor), 0));
  const taxa = round2(bruto - recebido);
  if (taxa < 0) throw new CrError(`Caiu mais (R$ ${recebido.toFixed(2).replace('.', ',')}) do que as vendas do grupo (R$ ${bruto.toFixed(2).replace('.', ',')}): confira o valor`);
  const conc = await q(
    supabase
      .from('hc_cr_conciliacoes')
      .insert({ empresa, data_liquidacao: data, forma, portador: b.portador || null, qtd_titulos: titulos.length, valor_bruto: bruto, valor_recebido: recebido, taxa, observacao: String(b.observacao || '').trim() || null, por_id: user?.id || null, por: quem(user) })
      .select()
      .single(),
  );
  // a taxa real é rateada pelos títulos (o último fica com o arredondamento)
  const agora = new Date().toISOString();
  let rateada = 0;
  for (let i = 0; i < titulos.length; i += 1) {
    const t = titulos[i];
    const tx = i === titulos.length - 1 ? round2(taxa - rateada) : round2((taxa * Number(t.valor)) / bruto);
    rateada = round2(rateada + tx);
    await q(
      supabase
        .from('hc_cr_titulos')
        .update({ taxa_valor: tx, taxa_pct: Number(t.valor) > 0 ? round2((tx / Number(t.valor)) * 10000) / 100 : 0, valor_liquido: round2(Number(t.valor) - tx), conciliado_em: agora, conciliado_por: quem(user), conciliacao_id: conc.id })
        .eq('id', t.id)
        .is('conciliado_em', null),
    );
  }
  console.log(`🔗 [contas a receber] conciliação #${conc.id} empresa ${empresa} ${forma} ${b.portador || ''} ${data}: bruto ${bruto} recebido ${recebido} taxa ${taxa} · ${quem(user)}`);
  return conc;
}

export async function empresas(user) {
  return empresasDoUsuario(user);
}
