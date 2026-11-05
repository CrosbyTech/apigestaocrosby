/**
 * Fluxo de Saldos (João/BRUCE, 05/11/2026) — PARTE INDEPENDENTE.
 *
 * Saldo em dinheiro por loja/dia + cálculo de sangria + pedido de retirada.
 * O "dinheiro do dia" vem das NFC-e: self-call no wrapper /api/totvs/invoices/
 * search (startDate/endDate; pagina sozinho; filtra por change ±3 dias) e, no
 * código, filtra issueDate==dia + Issued + documentType 55/65 + Output; para
 * cada nota lê o XML (/fiscal/v2/xml-contents/{accessKey}) e soma os <detPag>
 * tPag 01 (dinheiro) menos o <vTroco>. Cada nota é cacheada por accessKey
 * (fluxo_saldos_notas) — XML de nota não muda. Caminho e de/para das lojas
 * confirmados com o Tadeu (05/11; códigos SEM o zero). Saldo em caixa =
 * saldo contado (partida) + dinheiro do dia (sangrias/despesas à parte).
 *
 * Tabelas (criadas server-side via exec_sql, idempotente):
 *   fluxo_saldos_partida  — saldo contado de partida por loja (cd_empresa)
 *   fluxo_saldos_sangrias — pedidos de retirada (registro no HeadCoach; NÃO
 *                           mexe em TOTVS/banco)
 *   fluxo_saldos_notas    — cache do dinheiro por nota (accessKey)
 */
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';

const INTERNAL = process.env.INTERNAL_API_BASE || `http://127.0.0.1:${process.env.PORT || 4100}`;
const DOCTYPES_VENDA = new Set(['55', '65']);

// De/para loja -> branchCode (Tadeu, 05/11/2026). ATENÇÃO: o código da VENDA vem
// SEM o zero final (x10 = filial de teste). Ex.: Cidade Jardim é 87, não 870.
// 12 lojas do grupo (sem franquias 60xx).
export const LOJAS = [
  { code: 2, nome: 'João Pessoa' },
  { code: 5, nome: 'Nova Cruz' },
  { code: 55, nome: 'Parnamirim' },
  { code: 65, nome: 'Canguaretama' },
  { code: 87, nome: 'Cidade Jardim' },
  { code: 88, nome: 'Guararapes' },
  { code: 90, nome: 'Ayrton Senna' },
  { code: 93, nome: 'Imperatriz' },
  { code: 94, nome: 'Patos' },
  { code: 95, nome: 'Midway' },
  { code: 97, nome: 'Teresina' },
  { code: 98, nome: 'Recife' },
];

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// ── Cálculo da sangria (regra do João, 05/11/2026) ───────────────────────────
// Deixa um fundo de caixa/troco entre R$100 e R$200 na loja; o restante vira
// sangria em MÚLTIPLO de R$50 (valor fechado), escolhendo o que deixa o fundo
// mais próximo de R$150. Ex.: caixa 1.050 → sangria 900, fica 150.
export function calcularSangria(saldoEmCaixa) {
  const S = r2(saldoEmCaixa);
  if (!(S > 200)) return { saldo: S, sangria: 0, fica: S }; // já é nível de fundo (ou abaixo)
  const minSang = Math.ceil((S - 200) / 50) * 50; // fundo <= 200  → sangria >= S-200
  const maxSang = Math.floor((S - 100) / 50) * 50; // fundo >= 100  → sangria <= S-100
  let best = null, bestDist = Infinity;
  for (let x = minSang; x <= maxSang; x += 50) {
    if (x <= 0) continue;
    const fica = S - x;
    const dist = Math.abs(fica - 150);
    if (dist < bestDist || (dist === bestDist && x > best)) { best = x; bestDist = dist; }
  }
  if (best === null) best = Math.max(0, Math.floor((S - 100) / 50) * 50); // nenhum múltiplo deixa em [100,200]
  return { saldo: S, sangria: r2(best), fica: r2(S - best) };
}

// ── Tabelas ──────────────────────────────────────────────────────────────────
let tabelasOk = false;
async function garantirTabelas() {
  if (tabelasOk) return;
  const ddl = `
    CREATE TABLE IF NOT EXISTS fluxo_saldos_partida (
      cd_empresa integer PRIMARY KEY,
      loja_nome text,
      saldo numeric NOT NULL DEFAULT 0,
      contado_em date,
      user_nome text,
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS fluxo_saldos_sangrias (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cd_empresa integer NOT NULL,
      loja_nome text,
      valor numeric NOT NULL,
      data date NOT NULL DEFAULT current_date,
      status text NOT NULL DEFAULT 'solicitada',
      solicitado_por text,
      aprovado_por text,
      observacao text,
      criado_em timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS fluxo_saldos_notas (
      access_key text PRIMARY KEY,
      cd_empresa integer,
      dia date,
      invoice_code text,
      dinheiro numeric DEFAULT 0,
      troco numeric DEFAULT 0,
      total numeric DEFAULT 0,
      pags jsonb,
      updated_at timestamptz DEFAULT now()
    );
    NOTIFY pgrst, 'reload schema';`;
  let r = await supabase.rpc('exec_sql', { query: ddl });
  if (r.error && /exec_sql\(query\)/.test(r.error.message || '')) r = await supabase.rpc('exec_sql', { sql: ddl });
  if (r.error) throw new Error(`criar tabelas fluxo_saldos: ${r.error.message}`);
  tabelasOk = true;
}

// ── Dinheiro do dia pelas NFC-e ──────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lista as notas de VENDA de uma loja num dia (via wrapper; filtra no código).
async function invoicesDoDia(loja, dia) {
  let resp;
  for (let t = 1; t <= 4; t++) {
    try {
      const r = await axios.post(`${INTERNAL}/api/totvs/invoices/search`,
        { startDate: dia, endDate: dia, branchCodeList: [Number(loja)] },
        { timeout: 180000, validateStatus: (s) => s < 500 });
      if (r.status >= 400) throw new Error('HTTP ' + r.status);
      resp = r.data; break;
    } catch (e) { if (t === 4) throw e; await sleep(4000 * t); }
  }
  const items = resp?.data?.items || resp?.items || [];
  return items.filter((it) =>
    String(it.issueDate || it.invoiceDate || '').slice(0, 10) === dia &&
    it.invoiceStatus === 'Issued' &&
    DOCTYPES_VENDA.has(String(it.documentType)) &&
    it.operationType === 'Output' &&
    it.eletronic?.accessKey,
  ).map((it) => ({ accessKey: it.eletronic.accessKey, invoiceCode: it.invoiceCode }));
}

// Dinheiro de uma nota (tPag 01 − vTroco), com cache por accessKey.
async function dinheiroDaNota(accessKey, cd_empresa, dia, invoiceCode) {
  const { data: cache } = await supabase.from('fluxo_saldos_notas').select('dinheiro,troco,total').eq('access_key', accessKey).maybeSingle();
  if (cache) return cache;
  if (!TOTVS_BASE_URL) throw new Error('TOTVS_BASE_URL não configurado');
  const t = await getToken();
  const tok = typeof t === 'string' ? t : t?.access_token;
  const xr = await axios.get(`${TOTVS_BASE_URL}/fiscal/v2/xml-contents/${encodeURIComponent(accessKey)}`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${tok}` }, timeout: 30000 });
  const xml = Buffer.from(xr.data?.mainInvoiceXml || '', 'base64').toString('utf8');
  const pags = [...xml.matchAll(/<detPag>([\s\S]*?)<\/detPag>/g)].map((m) => ({
    tPag: (/<tPag>(\d+)<\/tPag>/.exec(m[1]) || [])[1] || null,
    vPag: Number((/<vPag>([\d.]+)<\/vPag>/.exec(m[1]) || [])[1] || 0),
  }));
  const troco = Number((/<vTroco>([\d.]+)<\/vTroco>/.exec(xml) || [])[1] || 0);
  const emDinheiro = pags.filter((p) => p.tPag === '01').reduce((a, p) => a + p.vPag, 0);
  const total = pags.reduce((a, p) => a + p.vPag, 0);
  const row = { dinheiro: r2(Math.max(0, emDinheiro - troco)), troco: r2(troco), total: r2(total) };
  await supabase.from('fluxo_saldos_notas').upsert(
    { access_key: accessKey, cd_empresa: Number(cd_empresa), dia, invoice_code: String(invoiceCode ?? ''), pags, ...row, updated_at: new Date().toISOString() },
    { onConflict: 'access_key' },
  );
  return row;
}

// Dinheiro em dinheiro (vendas) de uma loja no dia + detalhe por nota.
export async function dinheiroDoDia(loja, dia) {
  await garantirTabelas();
  const notas = await invoicesDoDia(loja, dia);
  const detalhe = [];
  let dinheiro = 0;
  const CONC = 5;
  for (let i = 0; i < notas.length; i += CONC) {
    const grupo = notas.slice(i, i + CONC);
    const res = await Promise.all(grupo.map(async (n) => {
      try { const d = await dinheiroDaNota(n.accessKey, loja, dia, n.invoiceCode); return { ...n, ...d }; }
      catch (e) { return { ...n, erro: e.message, dinheiro: 0 }; }
    }));
    for (const x of res) { dinheiro += Number(x.dinheiro) || 0; detalhe.push(x); }
  }
  return { dinheiro: r2(dinheiro), qtd_notas: notas.length, detalhe };
}

// ── Saldo de partida (contado) ───────────────────────────────────────────────
export async function listarPartida() {
  await garantirTabelas();
  const { data, error } = await supabase.from('fluxo_saldos_partida').select('*');
  if (error) throw new Error(error.message);
  const porLoja = {};
  for (const p of data || []) porLoja[p.cd_empresa] = p;
  return porLoja;
}

export async function setPartida({ cd_empresa, saldo, contado_em, user_nome }) {
  await garantirTabelas();
  const loja = LOJAS.find((l) => Number(l.code) === Number(cd_empresa));
  const row = {
    cd_empresa: Number(cd_empresa),
    loja_nome: loja?.nome || null,
    saldo: r2(saldo),
    contado_em: contado_em || new Date().toISOString().slice(0, 10),
    user_nome: user_nome || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('fluxo_saldos_partida').upsert(row, { onConflict: 'cd_empresa' });
  if (error) throw new Error(error.message);
  return row;
}

// ── Saldos por loja (saldo contado + dinheiro do dia das NFC-e) ──────────────
export async function saldos({ dia, comVendas = true } = {}) {
  await garantirTabelas();
  const oDia = dia || new Date().toISOString().slice(0, 10);
  const partida = await listarPartida();
  let fonteVendasErro = null;

  // dinheiro do dia por loja (NFC-e). comVendas=false pula (carregamento rápido).
  const dinheiroPorLoja = {};
  if (comVendas) {
    for (const l of LOJAS) {
      try { dinheiroPorLoja[l.code] = (await dinheiroDoDia(l.code, oDia)).dinheiro; }
      catch (e) { dinheiroPorLoja[l.code] = null; fonteVendasErro = e.message; }
    }
  }

  const linhas = LOJAS.map((l) => {
    const p = partida[l.code];
    const saldoPartida = p ? r2(p.saldo) : null;
    const dinheiroDia = comVendas ? (dinheiroPorLoja[l.code] ?? null) : null;
    // Saldo em caixa = contado (partida) + dinheiro do dia. Sangrias/despesas à parte.
    const saldoEmCaixa =
      saldoPartida == null && dinheiroDia == null ? null : r2((saldoPartida || 0) + (dinheiroDia || 0));
    const sangria = saldoEmCaixa != null ? calcularSangria(saldoEmCaixa) : null;
    return {
      cd_empresa: l.code,
      loja: l.nome,
      saldo_partida: saldoPartida,
      contado_em: p?.contado_em || null,
      dinheiro_dia: dinheiroDia,
      saldo_em_caixa: saldoEmCaixa,
      sangria_disponivel: sangria ? sangria.sangria : null,
      fica_na_loja: sangria ? sangria.fica : null,
    };
  });
  return {
    dia: oDia,
    fonte_vendas_pendente: !comVendas,
    fonte_vendas_erro: fonteVendasErro,
    lojas: linhas,
  };
}

// ── Pedidos de sangria (registro; não mexe em TOTVS/banco) ───────────────────
export async function listarSangrias({ dias = 30 } = {}) {
  await garantirTabelas();
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const { data, error } = await supabase
    .from('fluxo_saldos_sangrias')
    .select('*')
    .gte('criado_em', desde)
    .order('criado_em', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function criarSangria({ cd_empresa, valor, data, solicitado_por, observacao }) {
  await garantirTabelas();
  const loja = LOJAS.find((l) => Number(l.code) === Number(cd_empresa));
  const row = {
    cd_empresa: Number(cd_empresa),
    loja_nome: loja?.nome || null,
    valor: r2(valor),
    data: data || new Date().toISOString().slice(0, 10),
    status: 'solicitada',
    solicitado_por: solicitado_por || null,
    observacao: observacao || null,
  };
  const { data: ins, error } = await supabase.from('fluxo_saldos_sangrias').insert(row).select().single();
  if (error) throw new Error(error.message);
  return ins;
}

export async function atualizarSangriaStatus({ id, status, aprovado_por }) {
  await garantirTabelas();
  if (!['solicitada', 'aprovada', 'rejeitada', 'depositada', 'cancelada'].includes(status)) {
    throw new Error(`status inválido: ${status}`);
  }
  const { data, error } = await supabase
    .from('fluxo_saldos_sangrias')
    .update({ status, aprovado_por: aprovado_por || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}
