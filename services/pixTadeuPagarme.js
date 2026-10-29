/**
 * "Pix do Tadeu" — Pix recebidos pela Pagar.me fora do HeadCoach (link do
 * cliente, Gerador de QR e links das lojas, gerados pelo Dryland do Contas a
 * Receber) → Solicitações de Baixa (caixa "Pix a baixar") e demanda no Hoje.
 *
 * Padrão do Dryland (cobranca-pix.html → rpc cob_pix_gerar(p_cents, p_ref,
 * p_cd)): o pedido na Pagar.me leva uma referência (`ref`) e o código do
 * cliente TOTVS (`cd`); a tela "CONTROLE DE VALORES RECEBIDOS" lista os
 * pagos e a demanda "pago no Pix" do cob_hoje sugere os títulos:
 *   - link do cliente: os títulos são exatamente os do Pix;
 *   - cartão/link da loja: títulos abertos que somam exatamente o valor;
 *   - Gerador: os vencidos mais antigos até o valor (sugestão — conferir).
 * Como as RPCs do Dryland exigem login da cobrança, aqui lemos DIRETO da
 * Pagar.me (contas Crosby e FA MODA, chaves já no servidor): pedidos pagos
 * com Pix, excluindo os do próprio HeadCoach (boletos) e os do app BlueCard
 * (já viram solicitação pelo webhook).
 *
 * Cada Pix vira 1 solicitação por título casado (origem 'pix_pagarme_tadeu',
 * ref_externa pagarme:pix:<order_id>[:fat-parc]); sem casar → 1 linha
 * "a conferir" (nr_fat 0) com todos os dados. Pix > título único → juros.
 * Nada é apagado; idempotente pela ref_externa.
 */
import supabase from '../config/supabase.js';
import { pagarme, contasInfo, CONTA_PADRAO } from './pagarmeBoletos.js';
import { postTotvs } from './bluecardLimite.js';

export const ORIGEM = 'pix_pagarme_tadeu';
const DIAS_PADRAO = Number(process.env.PIX_TADEU_DIAS || 30);
const INTERVALO_MS = Number(process.env.PIX_TADEU_INTERVALO_MIN || 15) * 60 * 1000;
const TOTVS_STATUS_NORMAL = 1;

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const cents = (v) => Math.round((Number(v) || 0) * 100);
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : null);

// ── Pagar.me ───────────────────────────────────────────────────────────────
async function pedidosPagosPix({ conta, dias }) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const lista = [];
  for (let page = 1; page <= 20; page++) {
    const r = await pagarme('GET', `/orders?status=paid&created_since=${encodeURIComponent(desde)}&size=100&page=${page}`, null, conta);
    if (!r?.ok) throw new Error(`Pagar.me ${conta}: HTTP ${r?.status} ${r?.data?.message || ''}`.trim());
    const itens = Array.isArray(r.data?.data) ? r.data.data : [];
    for (const o of itens) {
      const charges = Array.isArray(o.charges) ? o.charges : [];
      const pix = charges.find((c) => c.payment_method === 'pix' && ['paid', 'overpaid', 'underpaid'].includes(c.status));
      if (pix) lista.push({ conta, order: o, charge: pix });
    }
    if (itens.length < 100 || !r.data?.paging?.next) break;
  }
  return lista;
}

/**
 * Lê o que o Dryland grava no pedido (visto em produção, 26/10/2026):
 *   tadeu_pix     → metadata { origem, titulos: "99-12000-4[, ...]", cd_cliente: "116622" }  (link do cliente)
 *   tadeu_gerador → metadata { origem, ref: "Betania - 115281", cd_cliente: "" , usuario }   (Gerador de QR)
 *   tadeu_loja    → metadata { origem, loja: "99", vendedor }                                 (link da loja)
 * Qualquer outro pedido (loja virtual/revenda por payment link, BlueCard, boleto) é ignorado.
 */
// João (27/10/2026): nas Solicitações só o link do cliente (tadeu_pix) e o Gerador
// (tadeu_gerador). O link da loja (tadeu_loja = setor de vendas, loja/vendedor) fica fora.
export const ORIGENS_TADEU = ['tadeu_pix', 'tadeu_gerador'];
const ORIGENS_IGNORADAS = ['tadeu_loja'];
function lerPedido({ conta, order: o, charge: c }) {
  const md = o.metadata || {};
  const item = (o.items || [])[0] || {};
  const ref = md.ref || item.description || o.code || '';
  let cd = Number(String(md.cd_cliente || '').replace(/\D/g, '')) || null;
  // Gerador: a referência é "Nome - código do cliente TOTVS" (João, 27/10/2026:
  // "Exclusive Mens - 119344", "Donna Monny - 43572"). O código vale quando o
  // metadata.cd_cliente vem vazio; o nome fica na observação pra conferência.
  const nomeRef = md.origem === 'tadeu_gerador' ? String(ref).split(' - ')[0].trim() : '';
  if (!cd && md.origem === 'tadeu_gerador') {
    const m = /\s-\s*(\d{1,8})\s*$/.exec(String(ref));
    if (m) cd = Number(m[1]) || null;
  }
  const titulos = String(md.titulos || '')
    .split(/[,;\s]+/)
    .map((t) => /^(\d+)-(\d+)-(\d+)$/.exec(t.trim()))
    .filter(Boolean)
    .map((m) => ({ branchCode: Number(m[1]), receivableCode: Number(m[2]), installmentCode: Number(m[3]) }));
  return {
    conta,
    order_id: o.id,
    charge_id: c.id,
    code: o.code || null,
    ref,
    cd_cliente: cd,
    cpf: soDigitos(o.customer?.document),
    nome: nomeRef || o.customer?.name || null,
    pagador: o.customer?.name || null,
    valor: r2((c.paid_amount ?? c.amount ?? o.amount ?? 0) / 100),
    pago_em: c.paid_at || o.updated_at || o.created_at,
    dia: dataBR(c.paid_at || o.updated_at || o.created_at),
    origem: md.origem || 'outro',
    titulos,
    loja: md.loja || null,
    vendedor: md.vendedor || null,
    metadata: md,
  };
}

// ── TOTVS ──────────────────────────────────────────────────────────────────
async function titulosDoCliente({ cd, cpf }) {
  const filter = { statusList: [TOTVS_STATUS_NORMAL] };
  if (cd) filter.customerCodeList = [Number(cd)];
  else if (cpf) filter.customerCpfCnpjList = [cpf];
  else return [];
  const itens = [];
  for (let page = 1; page <= 5; page++) {
    const r = await postTotvs('/accounts-receivable/v2/documents/search', { filter, page, pageSize: 100, order: '-issueDate' });
    itens.push(...(r.data?.items || []));
    if (page >= (r.data?.totalPages || 1)) break;
  }
  return itens.map((t) => ({
    receivableCode: Number(t.receivableCode),
    installmentCode: Number(t.installmentCode ?? 1),
    branchCode: t.branchCode ?? null,
    customerCode: t.customerCode ?? null,
    customerName: t.customerName ?? null,
    valorCents: cents(t.installmentValue),
    vencimento: String(t.expiredDate || '').slice(0, 10) || null,
    emissao: String(t.issueDate || '').slice(0, 10) || null,
    cd_portador: t.bearerCode ?? null,
    nm_portador: t.bearerName ?? null,
    aberto: !t.paymentDate && !t.settlementDate,
  }));
}

function casar(abertos, valorCents) {
  const ord = abertos.slice().sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  const exato = ord.find((t) => t.valorCents === valorCents);
  if (exato) return { titulos: [exato], criterio: 'valor exato', juros: 0 };
  const base = ord.slice(0, 12);
  let melhor = null;
  for (let mask = 1; mask < 1 << base.length; mask++) {
    let soma = 0; const comb = [];
    for (let i = 0; i < base.length; i++) if (mask & (1 << i)) { soma += base[i].valorCents; comb.push(base[i]); }
    if (soma === valorCents && (!melhor || comb.length < melhor.length)) melhor = comb;
  }
  if (melhor) return { titulos: melhor, criterio: `soma exata de ${melhor.length} títulos`, juros: 0 };
  // Pix maior que um único título aberto (juros/encargos): o mais próximo abaixo, se a diferença for razoável (≤ 15%)
  const abaixo = ord.filter((t) => t.valorCents < valorCents && valorCents - t.valorCents <= t.valorCents * 0.15).sort((a, b) => b.valorCents - a.valorCents);
  if (abaixo.length === 1 || (abaixo.length > 1 && abaixo[0].valorCents !== abaixo[1].valorCents)) {
    return { titulos: [abaixo[0]], criterio: 'título + juros (Pix maior que o título)', juros: r2((valorCents - abaixo[0].valorCents) / 100) };
  }
  return null;
}

/**
 * Gerador de QR (João, 27/10/2026): o Pix cobre os títulos VENCIDOS MAIS ANTIGOS do
 * cliente até o valor; o que sobra é juros/encargos (inclui a tarifa Pix de R$ 0,98
 * por título que o link soma). Ex.: 3.554,79 → 3 títulos (3.501,05) + 53,74 de juros;
 * 569,22 → 2 títulos (567,26) + 1,96. Valor exato de 1 título continua valendo.
 * Sobra acima de 15% do que foi casado = não é isso → null (a conferir).
 */
// Subconjunto de títulos cuja SOMA de face mais se aproxima do valor do Pix por
// baixo (menor sobra), empatando pelo menor nº de títulos. Meet-in-the-middle
// (até ~34 títulos). A sobra é o encargo (tarifa Pix R$ 0,98/título + juros de
// atraso). João (29/10/2026): o Gerador antes pegava os títulos MAIS ANTIGOS até
// o valor e errava (Patio Belem: pegou 7 títulos no lugar dos 2 boletos pagos).
// Agora busca a combinação exata/mais próxima — os 2 boletos somam o Pix.
function melhorSubconjunto(abertos, alvoCents) {
  const itens = abertos.filter((t) => t.valorCents > 0 && t.valorCents <= alvoCents);
  if (!itens.length) return null;
  if (itens.length > 34) return null; // grande demais pra casar com segurança → a conferir
  const meio = Math.floor(itens.length / 2);
  const somasDe = (arr) => {
    let lista = [{ soma: 0, idx: [] }];
    arr.forEach((t, i) => {
      const nv = [];
      for (const s of lista) {
        if (s.soma + t.valorCents <= alvoCents) nv.push({ soma: s.soma + t.valorCents, idx: [...s.idx, i] });
      }
      lista = lista.concat(nv);
    });
    return lista;
  };
  const A = somasDe(itens.slice(0, meio));
  const Braw = somasDe(itens.slice(meio)).map((s) => ({ soma: s.soma, idx: s.idx.map((i) => i + meio) }));
  // para cada soma de A, acha o melhor complemento em B (<= alvo - somaA)
  const B = Braw.sort((x, y) => x.soma - y.soma);
  const somasB = B.map((b) => b.soma);
  const buscaMaior = (lim) => { // maior soma de B <= lim
    let lo = 0, hi = somasB.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (somasB[m] <= lim) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  };
  let best = null;
  for (const a of A) {
    const i = buscaMaior(alvoCents - a.soma);
    if (i < 0) continue;
    // desempata entre somas B iguais pela de menor nº de títulos
    let j = i; const val = somasB[i];
    for (let k = i; k >= 0 && somasB[k] === val; k--) if (B[k].idx.length < B[j].idx.length) j = k;
    const soma = a.soma + B[j].soma;
    const nT = a.idx.length + B[j].idx.length;
    if (!nT) continue;
    const sobra = alvoCents - soma;
    if (!best || sobra < best.sobra || (sobra === best.sobra && nT < best.nT)) {
      best = { sobra, nT, idx: [...a.idx, ...B[j].idx] };
    }
  }
  if (!best) return null;
  return { titulos: best.idx.map((i) => itens[i]), sobra: best.sobra };
}

function casarGerador(abertos, valorCents) {
  if (!abertos.length || valorCents <= 0) return null;
  const exato = abertos.find((t) => t.valorCents === valorCents);
  if (exato) return { titulos: [exato], criterio: 'valor exato', juros: 0 };
  const sub = melhorSubconjunto(abertos, valorCents);
  if (!sub || !sub.titulos.length) return null;
  const soma = sub.titulos.reduce((a, t) => a + t.valorCents, 0);
  // A sobra tem que ser plausível como encargo: tarifa Pix R$ 0,98/título + até 15%
  // de juros sobre o que casou. Acima disso é combinação errada → a conferir.
  const tarifa = 98 * sub.titulos.length;
  const limite = Math.max(tarifa + 50, Math.round(soma * 0.15));
  if (sub.sobra > limite) return null;
  return {
    titulos: sub.titulos,
    criterio: `${sub.titulos.length} título(s) que somam o valor do Pix${sub.sobra ? ' (sobra = tarifa/juros)' : ''}`,
    juros: r2(sub.sobra / 100),
  };
}

// ── solicitações ───────────────────────────────────────────────────────────
async function refsExistentes(prefixos) {
  const set = new Set();
  for (let i = 0; i < prefixos.length; i += 100) {
    const lote = prefixos.slice(i, i + 100);
    const { data } = await supabase.from('solicitacoes_baixa').select('ref_externa').or(lote.map((p) => `ref_externa.like.${p}%`).join(','));
    for (const r of data || []) set.add(String(r.ref_externa).split(':').slice(0, 3).join(':'));
  }
  return set;
}

async function orderIdsBlueCard(dias) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const { data } = await supabase.from('solicitacoes_baixa').select('observacao').eq('origem', 'bluecard_pagarme').gte('created_at', desde).limit(2000);
  const ids = new Set();
  for (const r of data || []) { const m = /Pedido Pagar\.me (or_[A-Za-z0-9]+)/.exec(r.observacao || ''); if (m) ids.add(m[1]); }
  return ids;
}

/** Pix pagos na Pagar.me fora do HeadCoach/BlueCard, já lidos e interpretados (não grava). */
export async function listar({ dias = DIAS_PADRAO, bruto = false } = {}) {
  const contas = contasInfo().contas.filter((c) => c.configurada).map((c) => c.id);
  const avisos = [];
  const todos = [];
  for (const conta of contas) {
    try { todos.push(...(await pedidosPagosPix({ conta, dias }))); } catch (e) { avisos.push(e.message); }
  }
  const bc = await orderIdsBlueCard(dias + 5);
  const ignoradosLoja = todos.filter(({ order }) => ORIGENS_IGNORADAS.includes(order.metadata?.origem || '')).length;
  const lidos = todos
    .filter(({ order }) => ORIGENS_TADEU.includes(order.metadata?.origem || ''))
    .filter(({ order }) => !bc.has(order.id))
    .map(lerPedido);
  return { contas, dias, total: lidos.length, ignorados_loja: ignoradosLoja, avisos, itens: bruto ? todos.slice(0, 5).map(({ conta, order, charge }) => ({ conta, order: { id: order.id, code: order.code, amount: order.amount, metadata: order.metadata, items: order.items, customer: { name: order.customer?.name, document: order.customer?.document, code: order.customer?.code } }, charge: { id: charge.id, status: charge.status, paid_at: charge.paid_at, paid_amount: charge.paid_amount, amount: charge.amount } })) : lidos };
}

/** Cria as solicitações dos Pix ainda não espelhados. */
export async function sincronizar({ dias = DIAS_PADRAO } = {}) {
  const { itens, avisos, ignorados_loja } = await listar({ dias });
  const existentes = await refsExistentes(itens.map((p) => `pagarme:pix:${p.order_id}`));
  const resumo = { lidos: itens.length, ignorados_loja, novos: 0, ja_existiam: 0, abertas: 0, a_conferir: 0, avisos, erros: [] };
  for (const p of itens) {
    const refBase = `pagarme:pix:${p.order_id}`;
    if (existentes.has(refBase)) { resumo.ja_existiam++; continue; }
    try {
      // Gerador: só pelo código da referência (o CPF do pedido é de quem pagou o QR, não do cliente)
      const titulos = p.origem === 'tadeu_gerador'
        ? (p.cd_cliente ? await titulosDoCliente({ cd: p.cd_cliente }) : [])
        : await titulosDoCliente({ cd: p.cd_cliente, cpf: p.cpf });
      const abertos = titulos.filter((t) => t.aberto);
      const cliente = titulos[0] ? { code: titulos[0].customerCode, name: titulos[0].customerName } : null;
      let achado = null;
      if (p.origem === 'tadeu_pix' && p.titulos.length) {
        // link do cliente: os títulos são exatamente os do Pix (metadata.titulos)
        const alvo = p.titulos
          .map((x) => abertos.find((t) => t.receivableCode === x.receivableCode && t.installmentCode === x.installmentCode))
          .filter(Boolean);
        if (alvo.length) {
          const soma = alvo.reduce((a, t) => a + t.valorCents, 0);
          // A baixa tem que bater com o que o cliente pagou (João, 28/10/2026): se o
          // Pix veio MENOR que a soma dos títulos, não baixa (baixaria valor errado) —
          // vira "a conferir". Se veio maior, a diferença entra como juros (total = Pix).
          if (cents(p.valor) >= soma) {
            const juros = r2((cents(p.valor) - soma) / 100);
            achado = { titulos: alvo, criterio: 'título(s) do link do cliente', juros };
          } else {
            resumo.pix_menor_que_titulos = (resumo.pix_menor_que_titulos || 0) + 1;
          }
        }
      } else if (p.origem === 'tadeu_gerador') {
        // Gerador: cliente pelo código da referência; títulos vencidos mais antigos até o valor (+ juros)
        achado = casarGerador(abertos, cents(p.valor));
      }
      const quem = `Pix ${p.origem.replace('tadeu_', '')} · ${p.conta === 'fabio' ? 'FA MODA' : 'Crosby'}${p.loja ? ` · loja ${p.loja}` : ''}${p.vendedor ? ` · ${p.vendedor}` : ''}`;
      const cabec = [
        `Pix recebido na Pagar.me (${quem}) em ${p.dia} — R$ ${p.valor.toFixed(2)}. Pedido ${p.order_id} · cobrança ${p.charge_id}${p.ref ? ` · ref "${String(p.ref).slice(0, 80)}"` : ''}.`,
        p.origem === 'tadeu_gerador'
          ? `Cliente: ${cliente?.name || p.nome || '?'}${p.cd_cliente ? ` cód. ${p.cd_cliente}` : ' (sem código na referência)'} — nome na referência do Gerador: ${p.nome || '?'}; quem pagou o QR: ${p.pagador || '?'}${p.cpf ? ` (${p.cpf})` : ''}.${achado?.juros ? ' A sobra sobre os títulos (inclui a tarifa Pix de R$ 0,98/título) entra como juros.' : ''}`
          : `Cliente: ${cliente?.name || p.nome || '?'}${p.cd_cliente ? ` cód. ${p.cd_cliente}` : ''}${p.cpf ? ` CPF/CNPJ ${p.cpf}` : ''}.`,
      ];
      const filialFallback = titulos.slice().sort((x, y) => String(y.emissao).localeCompare(String(x.emissao)))[0]?.branchCode ?? 0;
      const base = {
        // documents/search não devolve o nome do cliente → vale o nome da referência do Gerador
        nm_cliente: cliente?.name || (p.origem === 'tadeu_gerador' && !achado ? `${p.nome || '?'} (Pix do Gerador — identificar cliente)` : p.nome || ''),
        comprovante_url: '',
        comprovante_path: '',
        status: 'pendente',
        user_id: null,
        user_nome: `Pix do Tadeu · ${p.origem.replace('tadeu_', '')}`,
        user_email: 'pagarme@crosby.app',
        dt_pagamento: p.dia,
        forma_pagamento: 'cartao_debito',
        dados_cartao: null,
        origem: ORIGEM,
      };
      const linhas = achado
        ? achado.titulos.map((t, i) => ({
            ...base,
            cd_empresa: t.branchCode ?? filialFallback,
            cd_cliente: t.customerCode ?? cliente?.code ?? p.cd_cliente,
            nr_fat: t.receivableCode,
            nr_parcela: t.installmentCode,
            vl_fatura: r2(t.valorCents / 100),
            vl_juros: i === achado.titulos.length - 1 ? achado.juros : 0,
            dt_vencimento: t.vencimento,
            dt_emissao: t.emissao,
            cd_portador: t.cd_portador,
            nm_portador: t.nm_portador,
            observacao: [...cabec, `Título TOTVS ${t.receivableCode}-${t.installmentCode} localizado por ${achado.criterio}${achado.titulos.length > 1 ? ` (${i + 1}/${achado.titulos.length})` : ''}${achado.juros ? ` — baixar com juros R$ ${achado.juros.toFixed(2)}` : ''}.`, `[${refBase}:${t.receivableCode}-${t.installmentCode}]`].join(' '),
            ref_externa: `${refBase}:${t.receivableCode}-${t.installmentCode}`,
          }))
        : [{
            ...base,
            cd_empresa: filialFallback,
            cd_cliente: cliente?.code ?? p.cd_cliente ?? 0, // NOT NULL: 0 = não identificado
            nr_fat: 0,
            nr_parcela: 1,
            vl_fatura: p.valor,
            vl_juros: 0,
            dt_vencimento: null,
            dt_emissao: null,
            cd_portador: null,
            nm_portador: null,
            observacao: [...cabec, `⚠️ TÍTULO NÃO LOCALIZADO${cliente ? ` (cliente ${cliente.code} tem ${abertos.length} aberto(s), nenhum/combinação bate com o valor)` : p.cd_cliente ? ` — cliente ${p.cd_cliente} sem título aberto no TOTVS` : ' — cliente não identificado no pedido (sem código/CPF)'}. Conferir manualmente.`, `[${refBase}]`].join(' '),
            ref_externa: refBase,
          }];
      for (const row of linhas) {
        const { error } = await supabase.from('solicitacoes_baixa').insert(row);
        if (error && error.code !== '23505') throw new Error(`solicitacoes_baixa: ${error.message}`);
      }
      resumo.novos++;
      if (achado) resumo.abertas += linhas.length; else resumo.a_conferir++;
    } catch (e) {
      resumo.erros.push({ order: p.order_id, erro: e.message });
    }
  }
  if (resumo.novos) console.log(`💠 [pix-tadeu] ${resumo.novos} Pix novo(s) → ${resumo.abertas} solicitação(ões), ${resumo.a_conferir} a conferir`);
  return resumo;
}

let ultima = { em: null, resumo: null, erro: null };
let rodando = false;
export async function rodar(opts) {
  if (rodando) return { ok: false, motivo: 'já está rodando', ultima };
  rodando = true;
  try {
    const resumo = await sincronizar(opts);
    ultima = { em: new Date().toISOString(), resumo, erro: null };
    return { ok: true, ...resumo };
  } catch (e) {
    ultima = { em: new Date().toISOString(), resumo: null, erro: e.message };
    console.warn(`⚠️ [pix-tadeu] ${e.message}`);
    return { ok: false, motivo: e.message };
  } finally {
    rodando = false;
  }
}
export function status() {
  return { contas: contasInfo().contas, dias: DIAS_PADRAO, intervalo_min: INTERVALO_MS / 60000, ultima };
}
export function iniciarJobPixTadeu() {
  if (String(process.env.PIX_TADEU_JOB || 'on').toLowerCase() === 'off') {
    console.log('ℹ️ [pix-tadeu] job desligado (PIX_TADEU_JOB=off) — use GET /api/pix-tadeu/previa e POST /sincronizar');
    return;
  }
  if (!contasInfo().contas.some((c) => c.configurada)) {
    console.log('ℹ️ [pix-tadeu] sem chave Pagar.me configurada — job desligado');
    return;
  }
  setTimeout(() => rodar().catch(() => {}), 4 * 60 * 1000);
  setInterval(() => rodar().catch(() => {}), INTERVALO_MS);
  console.log(`💠 [pix-tadeu] job ligado: a cada ${INTERVALO_MS / 60000} min (${DIAS_PADRAO} dias)`);
}
