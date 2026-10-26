// ============================================================================
// Contas a Receber — tela "Hoje" (pedido do João, Recuperação de Créditos,
// 21/10/2026, inspirada na tela Hoje do Dryland /cobranca).
//
//   GET /api/contas-receber/hoje?refresh=1
//
// O que entrou, o que vai entrar e o que precisa de ação, com dados que o
// HeadCoach já tem: TOTVS (baixas, vencimentos), pagarme_boletos,
// solicitacoes_baixa, esteira_protesto e a lista consolidada de devedores
// (/api/cobranca/inadimplentes). Resultado em cache por HOJE_CACHE_MIN (5 min);
// a lista de devedores tem o cache próprio de 10 min e, na primeira carga do
// dia, pode levar mais de um minuto (revenda) — por isso tem teto de tempo e,
// se estourar, vem null com aviso (a tela mostra "carregando").
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import supabase from '../config/supabase.js';
import { postTotvs } from '../services/bluecardLimite.js';
import { PORTADORES_REMESSA, boletosAtivosPorTitulo, recebiveisPorCredito, contasInfo, conferirTitulosTotvs } from '../services/pagarmeBoletos.js';
import { obter as obterInadimplentes, CANAIS, DT_INICIO_PADRAO } from './cobranca.routes.js';
import { resumir } from '../utils/cobrancaInadimplentes.js';

const router = express.Router();

const TZ = 'America/Fortaleza';
const TP_FATURA = 1;
const TP_BAIXA_RENEGOCIACAO = 9;
const CACHE_MS = Number(process.env.HOJE_CACHE_MIN || 5) * 60 * 1000;
const TETO_DEVEDORES_MS = Number(process.env.HOJE_DEVEDORES_TIMEOUT_S || 90) * 1000;
const META_MES_PCT = Number(process.env.HOJE_META_MES_PCT || 80);
const META_SEMANA_PCT = Number(process.env.HOJE_META_SEMANA_PCT || 20);
const PAGE_SIZE = 1000;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ymd = (v) => (v ? String(v).slice(0, 10) : null);
const hojeLoja = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const inicioSemana = (iso) => {
  // segunda-feira da semana de `iso`
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = segunda
  return somarDias(iso, -dow);
};
const fimDoMes = (iso) => {
  const [a, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

// ─── TOTVS ──────────────────────────────────────────────────────────────────
async function buscarTitulos(filter, { maxPaginas = 60 } = {}) {
  const pagina = (page) =>
    postTotvs('/accounts-receivable/v2/documents/search', { filter, page, pageSize: PAGE_SIZE, order: 'expiredDate' });
  const primeira = await pagina(1);
  const totalPages = Math.min(primeira.data?.totalPages || 1, maxPaginas);
  let itens = [...(primeira.data?.items || [])];
  for (let ini = 2; ini <= totalPages; ini += 5) {
    const lote = [];
    for (let p = ini; p <= Math.min(ini + 4, totalPages); p++) lote.push(pagina(p));
    for (const r of await Promise.all(lote)) itens = itens.concat(r.data?.items || []);
  }
  return { itens, truncado: (primeira.data?.totalPages || 1) > maxPaginas };
}

const ehFatura = (t) => Number(t.documentType ?? TP_FATURA) === TP_FATURA;
const ehRenegociacao = (t) => Number(t.dischargeType) === TP_BAIXA_RENEGOCIACAO;
const estaAberto = (t) => t.status === 1 && !t.paymentDate && !t.settlementDate;
const valorPago = (t) => Number(t.paidValue ?? t.netValue ?? t.installmentValue ?? 0);
const valorTitulo = (t) => Number(t.installmentValue ?? t.netValue ?? 0);
const chave = (t) => `${t.branchCode}-${t.receivableCode}-${t.installmentCode ?? 1}`;

function somar(lista, f) {
  return r2(lista.reduce((a, x) => a + (f(x) || 0), 0));
}

// ─── blocos ─────────────────────────────────────────────────────────────────
async function recebidoNoMes(hoje) {
  const mesIni = `${hoje.slice(0, 7)}-01`;
  const { itens } = await buscarTitulos({
    documentTypeList: [TP_FATURA],
    startPaymentDate: `${mesIni}T00:00:00`,
    endPaymentDate: `${hoje}T23:59:59`,
  });
  const pagos = itens.filter((t) => ehFatura(t) && t.paymentDate && !ehRenegociacao(t));
  const semIni = inicioSemana(hoje);
  const doDia = (d) => pagos.filter((t) => ymd(t.paymentDate) === d);
  const desde = (d) => pagos.filter((t) => ymd(t.paymentDate) >= d);
  const bloco = (l) => ({ valor: somar(l, valorPago), n: l.length, clientes: new Set(l.map((t) => t.customerCode)).size });
  const h = doDia(hoje);
  return {
    recebido: { hoje: bloco(h), semana: bloco(desde(semIni)), mes: bloco(pagos), semanaInicio: semIni, mesInicio: mesIni },
    pagosMes: pagos,
    recebidoHojeItens: h
      .sort((a, b) => valorPago(b) - valorPago(a))
      .slice(0, 50)
      .map((t) => ({ cd_empresa: t.branchCode, cd_cliente: t.customerCode, nome: t.customerName || '', nr_fatura: t.receivableCode, nr_parcela: t.installmentCode ?? 1, valor: r2(valorPago(t)), vencimento: ymd(t.expiredDate), portador: t.bearerCode ?? null })),
  };
}

async function vencimentos(hoje) {
  const ate7 = somarDias(hoje, 7);
  const { itens } = await buscarTitulos({
    statusList: [1],
    documentTypeList: [TP_FATURA],
    hasOpenInvoices: true,
    dischargeTypeList: [0],
    startExpiredDate: `${hoje}T00:00:00`,
    endExpiredDate: `${ate7}T23:59:59`,
  });
  const abertos = itens.filter((t) => ehFatura(t) && estaAberto(t));
  const vHoje = abertos.filter((t) => ymd(t.expiredDate) === hoje);
  const prox = abertos.filter((t) => ymd(t.expiredDate) > hoje);
  // elegíveis para remessa (portador em carteira) sem boleto Pagar.me vivo
  const elegiveis = prox.filter((t) => PORTADORES_REMESSA.includes(Number(t.bearerCode)));
  let semBoleto = [];
  if (elegiveis.length) {
    const ativos = await boletosAtivosPorTitulo(elegiveis.map((t) => t.receivableCode));
    semBoleto = elegiveis.filter((t) => !ativos.mapa?.[chave(t)]);
  }
  const porDia = {};
  for (const t of prox) {
    const d = ymd(t.expiredDate);
    porDia[d] ||= { dia: d, valor: 0, n: 0 };
    porDia[d].valor = r2(porDia[d].valor + valorTitulo(t));
    porDia[d].n++;
  }
  return {
    venceHoje: { valor: somar(vHoje, valorTitulo), n: vHoje.length, clientes: new Set(vHoje.map((t) => t.customerCode)).size },
    proximos7: {
      valor: somar(prox, valorTitulo),
      n: prox.length,
      porDia: Object.values(porDia).sort((a, b) => (a.dia < b.dia ? -1 : 1)),
      semBoletoPagarme: { valor: somar(semBoleto, valorTitulo), n: semBoleto.length, clientes: new Set(semBoleto.map((t) => t.customerCode)).size },
    },
  };
}

async function metaDoMes(hoje, pagosMes) {
  const mesIni = `${hoje.slice(0, 7)}-01`;
  const mesFim = fimDoMes(hoje);
  const { itens } = await buscarTitulos({
    documentTypeList: [TP_FATURA],
    startExpiredDate: `${mesIni}T00:00:00`,
    endExpiredDate: `${mesFim}T23:59:59`,
  });
  const vencem = itens.filter((t) => ehFatura(t) && !ehRenegociacao(t));
  const base = somar(vencem, valorTitulo);
  const pago = somar(pagosMes, valorPago);
  const vencidoAteHoje = somar(vencem.filter((t) => ymd(t.expiredDate) < hoje && estaAberto(t)), valorTitulo);
  const semanas = [];
  for (let n = 1, ini = mesIni; ini <= mesFim; n++, ini = somarDias(ini, 7)) {
    const fim = n === 5 || somarDias(ini, 6) > mesFim ? mesFim : somarDias(ini, 6);
    const p = somar(pagosMes.filter((t) => ymd(t.paymentDate) >= ini && ymd(t.paymentDate) <= fim), valorPago);
    semanas.push({ n, ini, fim, pago: p, pct: base ? r2((p / base) * 100) : 0, atual: hoje >= ini && hoje <= fim, futura: ini > hoje });
    if (fim === mesFim) break;
  }
  const semanaAtual = semanas.find((s) => s.atual)?.n || semanas.length;
  const metaAte = Math.min(META_MES_PCT, META_SEMANA_PCT * semanaAtual);
  return {
    mes: hoje.slice(0, 7),
    base,
    pago,
    pct: base ? r2((pago / base) * 100) : 0,
    vencidoAteHoje,
    aVencer: r2(Math.max(base - vencidoAteHoje - pago, 0)),
    metaMesPct: META_MES_PCT,
    metaSemanaPct: META_SEMANA_PCT,
    semanaAtual,
    metaAteSemanaPct: metaAte,
    faltaSemana: r2(Math.max((metaAte / 100) * base - pago, 0)),
    faltaMes: r2(Math.max((META_MES_PCT / 100) * base - pago, 0)),
    semanas,
  };
}

async function pagarmeHoje(hoje) {
  const todos = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from('pagarme_boletos')
      .select('id, cd_empresa, cd_cliente, nm_cliente, nr_fatura, nr_parcela, dt_vencimento, vl_fatura, vl_pago, dt_pagamento, status, baixa_status, charge_id, totvs_conferido_em')
      .in('status', ['pending', 'paid'])
      .order('id', { ascending: true })
      .range(de, de + 999);
    if (error) throw new Error(`pagarme_boletos: ${error.message}`);
    todos.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const pend = todos.filter((b) => b.status === 'pending');
  const pagosHoje = todos.filter((b) => b.status === 'paid' && b.dt_pagamento && new Date(b.dt_pagamento).toLocaleDateString('sv-SE', { timeZone: TZ }) === hoje);
  const vencidos = pend.filter((b) => b.dt_vencimento && b.dt_vencimento < hoje);
  const aVencer7 = pend.filter((b) => b.dt_vencimento && b.dt_vencimento >= hoje && b.dt_vencimento <= somarDias(hoje, 7));
  const bloco = (l, f = (b) => Number(b.vl_fatura || 0)) => ({ valor: somar(l, f), n: l.length, clientes: new Set(l.map((b) => b.cd_cliente)).size });
  return {
    pagarme: {
      pagosHoje: bloco(pagosHoje, (b) => Number(b.vl_pago ?? b.vl_fatura ?? 0)),
      aguardandoBaixa: bloco(todos.filter((b) => b.status === 'paid' && b.baixa_status !== 'processada')),
      pendentes: bloco(pend),
      vencidos: bloco(vencidos),
      aVencer7: bloco(aVencer7),
    },
    pendentes: pend,
    pagosHojeItens: pagosHoje.map((b) => ({ cd_empresa: b.cd_empresa, cd_cliente: b.cd_cliente, nome: b.nm_cliente, nr_fatura: b.nr_fatura, nr_parcela: b.nr_parcela, valor: Number(b.vl_pago ?? b.vl_fatura ?? 0), baixa: b.baixa_status })),
  };
}

/** Boletos Pagar.me pendentes cujo título já está pago/renegociado/cancelado no TOTVS — cancelar na Pagar.me. */
async function boletosParaCancelar(pendentes) {
  // o retorno (job 30 min / botão) grava totvs_situacao; aqui só confere quem nunca foi conferido
  const nunca = pendentes.filter((b) => !b.totvs_conferido_em);
  if (nunca.length) await conferirTitulosTotvs(nunca);
  const { data } = await supabase
    .from('pagarme_boletos')
    .select('id, conta, cd_empresa, cd_cliente, nm_cliente, nr_fatura, nr_parcela, dt_vencimento, vl_fatura, totvs_situacao, totvs_baixa_em')
    .eq('status', 'pending')
    .not('totvs_situacao', 'in', '(aberto,nao_encontrado)')
    .not('totvs_situacao', 'is', null)
    .limit(2000);
  return (data || [])
    .map((b) => ({
      id: b.id,
      conta: b.conta,
      cd_empresa: b.cd_empresa,
      cd_cliente: b.cd_cliente,
      nome: b.nm_cliente,
      nr_fatura: b.nr_fatura,
      nr_parcela: b.nr_parcela,
      dt_vencimento: b.dt_vencimento,
      valor: Number(b.vl_fatura || 0),
      motivo: `${b.totvs_situacao} no TOTVS`,
      baixa_em: b.totvs_baixa_em,
    }))
    .sort((a, b) => String(b.baixa_em || '').localeCompare(String(a.baixa_em || '')));
}

/** Recebíveis Pagar.me por data de crédito: o que caiu na conta hoje e o que cai nos próximos dias. */
async function recebiveisPagarme(hoje) {
  const de = somarDias(hoje, -1);
  const ate = somarDias(hoje, 10);
  const { itens, avisos } = await recebiveisPorCredito({ de, ate });
  // cliente/fatura de cada recebível pelo charge_id (quando for boleto do HeadCoach)
  const ids = [...new Set(itens.map((i) => i.charge_id).filter(Boolean))];
  const porCharge = {};
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase
      .from('pagarme_boletos')
      .select('charge_id, cd_empresa, cd_cliente, nm_cliente, nr_fatura, nr_parcela, vl_fatura, dt_pagamento, baixa_status')
      .in('charge_id', ids.slice(i, i + 300));
    for (const b of data || []) porCharge[b.charge_id] = b;
  }
  const enriquecer = (i) => {
    const b = porCharge[i.charge_id];
    return b
      ? { ...i, cd_empresa: b.cd_empresa, cd_cliente: b.cd_cliente, nome: b.nm_cliente, nr_fatura: b.nr_fatura, nr_parcela: b.nr_parcela, vl_fatura: Number(b.vl_fatura || 0), pago_em: b.dt_pagamento, baixa: b.baixa_status }
      : { ...i, nome: i.metodo === 'boleto' ? '(boleto fora do HeadCoach)' : i.metodo === 'credit_card' ? '(cartão)' : i.metodo === 'pix' ? '(Pix)' : '(outro)' };
  };
  const bloco = (lista, dia) => {
    const porMetodo = {};
    for (const i of lista) {
      const m = (porMetodo[i.metodo] ||= { n: 0, bruto: 0, tarifa: 0, liquido: 0 });
      m.n++;
      m.bruto = r2(m.bruto + i.bruto);
      m.tarifa = r2(m.tarifa + i.tarifa);
      m.liquido = r2(m.liquido + i.liquido);
    }
    const porConta = {};
    for (const i of lista) porConta[i.conta] = r2((porConta[i.conta] || 0) + i.liquido);
    const boletos = lista.filter((i) => i.metodo === 'boleto');
    return {
      dia,
      n: lista.length,
      bruto: somar(lista, (i) => i.bruto),
      tarifa: somar(lista, (i) => i.tarifa),
      liquido: somar(lista, (i) => i.liquido),
      boletos: { n: boletos.length, bruto: somar(boletos, (i) => i.bruto), liquido: somar(boletos, (i) => i.liquido) },
      creditado: lista.every((i) => i.status === 'paid'),
      porMetodo,
      porConta,
      itens: lista.map(enriquecer).sort((a, b) => b.liquido - a.liquido),
    };
  };
  const dias = [...new Set(itens.map((i) => i.dia))].sort();
  const amanhaDia = somarDias(hoje, 1);
  const proximoDia = dias.find((d) => d > hoje) || amanhaDia;
  return {
    contas: contasInfo().contas,
    periodo: { de, ate },
    ontem: bloco(itens.filter((i) => i.dia === somarDias(hoje, -1)), somarDias(hoje, -1)),
    hoje: bloco(itens.filter((i) => i.dia === hoje), hoje),
    amanha: bloco(itens.filter((i) => i.dia === proximoDia), proximoDia),
    proximos: dias.filter((d) => d > hoje).map((d) => {
      const l = itens.filter((i) => i.dia === d);
      return { dia: d, n: l.length, bruto: somar(l, (i) => i.bruto), liquido: somar(l, (i) => i.liquido), boletos: l.filter((i) => i.metodo === 'boleto').length };
    }),
    avisos,
  };
}

async function pendenciasHeadCoach() {
  const [bx, ep] = await Promise.all([
    supabase.from('solicitacoes_baixa').select('id, cd_cliente, nm_cliente, nr_fat, nr_parcela, vl_fatura, created_at, origem').eq('status', 'pendente').order('created_at', { ascending: true }).limit(1000),
    supabase.from('esteira_protesto').select('id, cd_cliente, nm_cliente, nr_fat, nr_parcela, vl_fatura, dt_vencimento').eq('status', 'pendente').limit(1000),
  ]);
  if (bx.error) throw new Error(`solicitacoes_baixa: ${bx.error.message}`);
  if (ep.error) throw new Error(`esteira_protesto: ${ep.error.message}`);
  const baixas = bx.data || [];
  const protesto = ep.data || [];
  // João (23/10/2026): separar o que precisa baixar por origem — Pix (BlueCard)
  // e boleto Pagar.me recebido — e mostrar também os boletos pagos que ainda
  // não creditaram (não dá pra baixar antes do recebimento).
  const pix = baixas.filter((x) => x.origem === 'bluecard_pagarme' || x.origem === 'pix_pagarme_tadeu');
  const boletoRecebido = baixas.filter((x) => x.origem === 'pagarme_boleto');
  let boletosAguardandoCredito = { n: 0, valor: 0 };
  try {
    const { data: ag } = await supabase
      .from('pagarme_boletos')
      .select('vl_fatura')
      .eq('status', 'paid')
      .in('baixa_status', ['pendente', 'aguardando_credito'])
      .limit(1000);
    boletosAguardandoCredito = { n: (ag || []).length, valor: somar(ag || [], (x) => Number(x.vl_fatura || 0)) };
  } catch {
    /* sem a tabela, ignora */
  }
  const resumo = (lista) => ({
    n: lista.length,
    valor: somar(lista, (x) => Number(x.vl_fatura || 0)),
    itens: lista.slice(0, 30).map((x) => ({ cd_cliente: x.cd_cliente, nome: x.nm_cliente, nr_fatura: x.nr_fat, nr_parcela: x.nr_parcela, valor: Number(x.vl_fatura || 0), em: x.created_at, origem: x.origem })),
  });
  return {
    pixParaBaixar: resumo(pix),
    boletoRecebidoParaBaixar: resumo(boletoRecebido),
    boletosAguardandoCredito,
    baixasPendentes: {
      n: baixas.length,
      valor: somar(baixas, (x) => Number(x.vl_fatura || 0)),
      maisAntiga: baixas[0]?.created_at || null,
      itens: baixas.slice(0, 30).map((x) => ({ cd_cliente: x.cd_cliente, nome: x.nm_cliente, nr_fatura: x.nr_fat, nr_parcela: x.nr_parcela, valor: Number(x.vl_fatura || 0), em: x.created_at, origem: x.origem })),
    },
    protestoPendente: { n: protesto.length, valor: somar(protesto, (x) => Number(x.vl_fatura || 0)), clientes: new Set(protesto.map((x) => String(x.cd_cliente))).size },
  };
}

async function devedores(avisos) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), TETO_DEVEDORES_MS));
  const dados = await Promise.race([obterInadimplentes(CANAIS, DT_INICIO_PADRAO, false).catch((e) => ({ erro: e.message })), timeout]);
  if (!dados) {
    avisos.push('Vencido total ainda carregando (lista de devedores demora na primeira carga do dia) — atualize em instantes.');
    return null;
  }
  if (dados.erro) {
    avisos.push(`Vencido total indisponível: ${dados.erro}`);
    return null;
  }
  if (!dados.clientes_nos_canais) {
    avisos.push('Vencido total indisponível: as listas de clientes dos canais vieram vazias (TOTVS/cache) — atualize em instantes.');
    return null;
  }
  const r = resumir(dados.clientes || []);
  const inad = (dados.clientes || []).filter((c) => c.maior_atraso_dias > dados.dias_inadimplente);
  return {
    valor: r.valor_vencido,
    valorCorrigido: r.valor_corrigido,
    n: r.titulos,
    clientes: r.clientes,
    porCanal: r.por_canal,
    inadimplentes60: { clientes: inad.length, valor: somar(inad, (c) => c.valor_vencido) },
    geradoEm: dados.gerado_em,
    cached: dados.cached,
  };
}

// ─── montagem ───────────────────────────────────────────────────────────────
async function montar() {
  const t0 = Date.now();
  const hoje = hojeLoja();
  const avisos = [];
  const seguro = (p, nome, vazio) =>
    p.catch((e) => {
      avisos.push(`${nome}: ${e.message}`);
      return vazio;
    });

  const [rec, venc, pm, pend, dev, receb] = await Promise.all([
    seguro(recebidoNoMes(hoje), 'recebido (TOTVS)', { recebido: null, pagosMes: [], recebidoHojeItens: [] }),
    seguro(vencimentos(hoje), 'vencimentos (TOTVS)', { venceHoje: null, proximos7: null }),
    seguro(pagarmeHoje(hoje), 'Pagar.me', { pagarme: null, pendentes: [], pagosHojeItens: [] }),
    seguro(pendenciasHeadCoach(), 'pendências HeadCoach', { baixasPendentes: null, protestoPendente: null }),
    seguro(devedores(avisos), 'devedores', null),
    seguro(recebiveisPagarme(hoje), 'recebíveis Pagar.me', null),
  ]);
  if (receb?.avisos?.length) avisos.push(...receb.avisos.map((a) => `recebíveis Pagar.me: ${a}`));
  const [meta, cancelar] = await Promise.all([
    seguro(metaDoMes(hoje, rec.pagosMes), 'meta do mês (TOTVS)', null),
    seguro(boletosParaCancelar(pm.pendentes), 'boletos p/ cancelar', []),
  ]);

  // ─── demandas: o que precisa de ação ───
  const demandas = [];
  if (cancelar.length) {
    demandas.push({
      chave: 'boleto_cancelar',
      titulo: 'Boleto Pagar.me ativo de título já pago/renegociado',
      descricao: `${cancelar.length} boleto(s), R$ ${somar(cancelar, (x) => x.valor).toFixed(2)} — o cliente pode pagar duas vezes.`,
      oQueFazer: 'Abra Retorno Boleto → Baixa em massa na Pagar.me, cole as faturas abaixo (ou marque na tabela), confira e confirme.',
      qtd: cancelar.length,
      valor: somar(cancelar, (x) => x.valor),
      urgente: true,
      rota: '/retorno-boleto',
      itens: cancelar,
    });
  }
  if (pend.baixasPendentes?.n) {
    demandas.push({
      chave: 'baixas',
      titulo: 'Solicitações de baixa pendentes',
      descricao: `${pend.baixasPendentes.n} solicitação(ões), R$ ${pend.baixasPendentes.valor.toFixed(2)}.`,
      oQueFazer: 'Abra Solicitação de Baixa, confira o comprovante e baixe no TOTVS.',
      qtd: pend.baixasPendentes.n,
      valor: pend.baixasPendentes.valor,
      urgente: false,
      rota: '/solicitacao-baixa',
      itens: pend.baixasPendentes.itens,
    });
  }
  if (pend?.pixParaBaixar?.n) {
    demandas.push({
      chave: 'pix_baixar',
      titulo: 'Pix recebidos (BlueCard + Pix do Tadeu) a baixar',
      descricao: `${pend.pixParaBaixar.n} pagamento(s) via Pix, R$ ${pend.pixParaBaixar.valor.toFixed(2)} — baixar como cartão débito PAGARME na data do pagamento.`,
      oQueFazer: 'Solicitações de Baixa → caixa "Pix a baixar" → marcar → Processar → Cartão de Débito → Confirmar (cada uma sai na sua data).',
      qtd: pend.pixParaBaixar.n,
      valor: pend.pixParaBaixar.valor,
      urgente: false,
      rota: '/solicitacao-baixa',
      itens: pend.pixParaBaixar.itens,
    });
  }
  if (pend?.boletoRecebidoParaBaixar?.n || pend?.boletosAguardandoCredito?.n) {
    const br = pend.boletoRecebidoParaBaixar || { n: 0, valor: 0, itens: [] };
    const ag = pend.boletosAguardandoCredito || { n: 0, valor: 0 };
    demandas.push({
      chave: 'boleto_recebido_baixar',
      titulo: 'Boletos Pagar.me recebidos a baixar',
      descricao: `${br.n} recebido(s), R$ ${Number(br.valor || 0).toFixed(2)} — baixar como cartão débito PAGARME na data do recebimento.${ag.n ? ` Mais ${ag.n} pago(s) (R$ ${Number(ag.valor || 0).toFixed(2)}) ainda sem crédito na Pagar.me — entram quando cair.` : ''}`,
      oQueFazer: 'Solicitações de Baixa → caixa "Boleto recebido a baixar" → marcar → Processar → Cartão de Débito → Confirmar.',
      qtd: br.n,
      valor: Number(br.valor || 0),
      urgente: false,
      rota: '/solicitacao-baixa',
      itens: br.itens || [],
    });
  }
  if (pm.pagarme?.aguardandoBaixa?.n) {
    demandas.push({
      chave: 'pagarme_baixa',
      titulo: 'Boleto Pagar.me pago aguardando baixa no TOTVS',
      descricao: `${pm.pagarme.aguardandoBaixa.n} boleto(s), R$ ${pm.pagarme.aguardandoBaixa.valor.toFixed(2)}.`,
      oQueFazer: 'Abra Retorno Boleto e clique em Atualizar retorno; se der erro de baixa, baixe manualmente no TOTVS.',
      qtd: pm.pagarme.aguardandoBaixa.n,
      valor: pm.pagarme.aguardandoBaixa.valor,
      urgente: false,
      rota: '/retorno-boleto',
    });
  }
  if (venc.proximos7?.semBoletoPagarme?.n) {
    demandas.push({
      chave: 'remessa',
      titulo: 'Faturas vencendo em 7 dias sem boleto Pagar.me',
      descricao: `${venc.proximos7.semBoletoPagarme.n} fatura(s) de ${venc.proximos7.semBoletoPagarme.clientes} cliente(s), R$ ${venc.proximos7.semBoletoPagarme.valor.toFixed(2)} (portadores ${PORTADORES_REMESSA.join(', ')}).`,
      oQueFazer: 'Abra Envio de Remessa, busque o período e gere a remessa.',
      qtd: venc.proximos7.semBoletoPagarme.n,
      valor: venc.proximos7.semBoletoPagarme.valor,
      urgente: false,
      rota: '/remessa-boletos',
    });
  }
  if (pend.protestoPendente?.n) {
    demandas.push({
      chave: 'protesto',
      titulo: 'Esteira de protesto com títulos pendentes',
      descricao: `${pend.protestoPendente.n} título(s) de ${pend.protestoPendente.clientes} cliente(s), R$ ${pend.protestoPendente.valor.toFixed(2)}.`,
      oQueFazer: 'Abra Esteira de Protesto e gere a remessa de protesto.',
      qtd: pend.protestoPendente.n,
      valor: pend.protestoPendente.valor,
      urgente: false,
      rota: '/esteira-protesto',
    });
  }
  if (pm.pagarme?.vencidos?.n) {
    demandas.push({
      chave: 'pagarme_vencidos',
      titulo: 'Boletos Pagar.me vencidos e não pagos',
      descricao: `${pm.pagarme.vencidos.n} boleto(s) de ${pm.pagarme.vencidos.clientes} cliente(s), R$ ${pm.pagarme.vencidos.valor.toFixed(2)}.`,
      oQueFazer: 'Cobrar pelo Call Center / WhatsApp; se o cliente pagou por outro meio, baixar o boleto na Pagar.me.',
      qtd: pm.pagarme.vencidos.n,
      valor: pm.pagarme.vencidos.valor,
      urgente: false,
      rota: '/retorno-boleto',
    });
  }
  demandas.sort((a, b) => Number(b.urgente) - Number(a.urgente));

  return {
    dia: hoje,
    geradoEm: new Date().toISOString(),
    tempoMs: Date.now() - t0,
    avisos,
    recebido: rec.recebido,
    recebidoHojeItens: rec.recebidoHojeItens,
    pagarme: pm.pagarme,
    pagarmePagosHojeItens: pm.pagosHojeItens,
    recebiveis: receb,
    venceHoje: venc.venceHoje,
    proximos7: venc.proximos7,
    vencidoTotal: dev,
    meta,
    demandas,
  };
}

// ─── snapshot persistido + geração em segundo plano ─────────────────────────
// A carga completa leva de 30 s a 2 min (TOTVS + devedores + Pagar.me) e
// estourava o tempo da requisição na primeira abertura do dia. Agora:
//   - o resultado fica em contas_receber_hoje_snapshot (sobrevive ao restart);
//   - GET /hoje devolve o último snapshot NA HORA (com `desatualizado` quando
//     não é de hoje) e, se não houver nenhum, dispara a geração e devolve
//     { gerando: true } para a tela esperar;
//   - ?refresh=1 dispara uma geração nova em segundo plano e devolve o atual;
//   - job: na subida do servidor e todo dia às HOJE_GERAR_HORA (06:10).
const TABELA_SNAP = 'contas_receber_hoje_snapshot';
let geracao = null; // promise da geração em andamento
let ultimoSnap = null; // { dia, gerado_em, tempo_ms, payload }

async function lerSnapshot() {
  const { data, error } = await supabase.from(TABELA_SNAP).select('*').order('gerado_em', { ascending: false }).limit(1);
  if (error) {
    if (!/relation .* does not exist|PGRST205|schema cache/i.test(error.message)) console.warn(`[hoje] snapshot: ${error.message}`);
    return null;
  }
  return data?.[0] || null;
}

async function gerarSnapshot(origem = 'manual') {
  if (geracao) return geracao;
  geracao = (async () => {
    const t0 = Date.now();
    try {
      const payload = await montar();
      const linha = { dia: payload.dia, gerado_em: payload.geradoEm, tempo_ms: Date.now() - t0, payload };
      const { error } = await supabase.from(TABELA_SNAP).insert(linha);
      if (error) console.warn(`[hoje] não gravou snapshot: ${error.message}`);
      ultimoSnap = linha;
      // mantém só os últimos 30 snapshots
      const { data: velhos } = await supabase.from(TABELA_SNAP).select('id').order('gerado_em', { ascending: false }).range(30, 200);
      if (velhos?.length) await supabase.from(TABELA_SNAP).delete().in('id', velhos.map((v) => v.id));
      console.log(`🌅 [hoje] snapshot gerado (${origem}) em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      return linha;
    } finally {
      geracao = null;
    }
  })();
  return geracao;
}

/** Último snapshot (memória → banco). */
async function snapshotAtual() {
  if (ultimoSnap) return ultimoSnap;
  ultimoSnap = await lerSnapshot();
  return ultimoSnap;
}

export async function obterHoje(refresh) {
  const hoje = hojeLoja();
  let snap = await snapshotAtual();
  if (refresh || !snap) {
    gerarSnapshot(refresh ? 'atualizar' : 'primeira carga').catch((e) => console.error(`❌ [hoje] geração: ${e.message}`));
  }
  if (!snap) {
    // sem nada ainda: a tela mostra "gerando" e consulta de novo em alguns segundos
    return { gerando: true, dia: hoje, geradoEm: null, avisos: [], demandas: [] };
  }
  return {
    ...snap.payload,
    snapshotDia: snap.dia,
    snapshotGeradoEm: snap.gerado_em,
    tempoMs: snap.tempo_ms,
    desatualizado: snap.dia !== hoje,
    gerando: Boolean(geracao),
    cached: true,
  };
}

/** Chamado pelo index.js: gera na subida e todo dia no horário configurado. */
export function iniciarJobHoje() {
  const hora = String(process.env.HOJE_GERAR_HORA || '06:10');
  const [hh, mm] = hora.split(':').map(Number);
  setTimeout(() => gerarSnapshot('subida do servidor').catch((e) => console.error(`❌ [hoje] geração inicial: ${e.message}`)), 90_000);
  setInterval(() => {
    const agora = new Date().toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
    if (agora === `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) {
      gerarSnapshot('job diário').catch((e) => console.error(`❌ [hoje] job diário: ${e.message}`));
    }
  }, 60_000);
  console.log(`🌅 [hoje] snapshot do Contas a Receber: na subida (+90s) e todo dia às ${hora} (${TZ})`);
}

router.use(requireAuth);

router.get(
  '/hoje',
  asyncHandler(async (req, res) => {
    req.setTimeout(10 * 60 * 1000);
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const dados = await obterHoje(refresh);
    return successResponse(res, dados, 'Contas a Receber — hoje');
  }),
);

export default router;
