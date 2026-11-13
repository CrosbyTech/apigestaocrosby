// ============================================================================
// ESTOQUE DO DRYLAND (Yago, 13/11/2026). O estoque da Crosby passou a ser do
// Dryland, com as regras no agente "Estoquista". O HeadCoach só CONSULTA, por
// uma porta única:
//   POST {DRYLAND}/rest/v1/rpc/estq_gw  { p_token, p_acao, p_args }
//   → { ok: true, dados } | { ok: false, erro }
// Ações de consulta: ajuda · manual · operacoes · saldo · grupos · movimentos ·
// minha_fila. A ação "pedir" (entrada, baixa, transferência, balanço…) NÃO está
// ligada aqui: exige OK escrito do David/Fábio e o mapa das operações.
//
// Regras do Estoquista: só esta porta (nada de outras RPCs de estoque, SQL ou
// tabela direta); o TOTVS não é fonte de saldo. O token é pessoal e fica SÓ em
// variável de ambiente (DRYLAND_ESTQ_TOKEN, com a chave pública em DRYLAND_ESTQ_KEY):
// nunca em URL, log, erro ou resposta.
// ============================================================================
import axios from 'axios';
import { DRYLAND_URL, DRYLAND_KEY } from '../routes/drylandChamados.routes.js';

export class EstoqueDrylandError extends Error {
  constructor(message, code = 'ESTOQUE_DRYLAND', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// chave pública do projeto passada pelo Fábio junto do token (sb_publishable_…);
// sem ela, a anon antiga do Dryland
const chavePublica = () => String(process.env.DRYLAND_ESTQ_KEY || '').trim() || DRYLAND_KEY;

const ACOES_CONSULTA = ['ajuda', 'manual', 'operacoes', 'saldo', 'grupos', 'movimentos', 'minha_fila'];

export function tokenConfigurado() {
  return !!String(process.env.DRYLAND_ESTQ_TOKEN || '').trim();
}

/** Chamada crua à porta estq_gw (só ações de consulta). */
export async function estqGw(acao, args = {}) {
  if (!ACOES_CONSULTA.includes(acao)) throw new EstoqueDrylandError(`Ação "${acao}" não liberada no HeadCoach`, 'ACAO_NAO_LIBERADA', 403);
  const token = String(process.env.DRYLAND_ESTQ_TOKEN || '').trim();
  if (!token) {
    throw new EstoqueDrylandError(
      'O token do estoque do Dryland ainda não foi configurado (variável DRYLAND_ESTQ_TOKEN). Peça o token ao Fábio.',
      'TOKEN_NAO_CONFIGURADO',
      503,
    );
  }
  let data;
  try {
    ({ data } = await axios.post(
      `${DRYLAND_URL}/rest/v1/rpc/estq_gw`,
      { p_token: token, p_acao: acao, p_args: args || {} },
      {
        headers: { 'Content-Type': 'application/json', apikey: chavePublica(), Authorization: `Bearer ${chavePublica()}` },
        timeout: 45000,
      },
    ));
  } catch (err) {
    // nunca repassa err.config (o corpo tem o token): só a mensagem do servidor
    const j = err?.response?.data;
    const msg = (j && (j.message || j.hint || j.details || j.erro)) || (err?.code === 'ECONNABORTED' ? 'o Dryland demorou demais para responder' : 'falha de conexão');
    throw new EstoqueDrylandError(`Dryland (estoque): ${String(msg).replaceAll(token, '***')}`, 'DRYLAND_HTTP', 502);
  }
  if (!data || typeof data !== 'object') throw new EstoqueDrylandError('O Dryland devolveu uma resposta vazia', 'DRYLAND_VAZIO', 502);
  if (data.ok === false) throw new EstoqueDrylandError(String(data.erro || 'O Dryland recusou a consulta').replaceAll(token, '***'), 'DRYLAND_RECUSOU', 422);
  return data.dados ?? data;
}

// ─── cache curto para o que quase não muda ──────────────────────────────────
const cache = new Map();
async function comCache(chave, ms, fn) {
  const c = cache.get(chave);
  if (c && Date.now() - c.em < ms) return c.valor;
  const valor = await fn();
  cache.set(chave, { em: Date.now(), valor });
  return valor;
}

// ─── de quem é este estoque ─────────────────────────────────────────────────
// Conferido em 13/11/2026 com o token: o saldo do estq_gw é o da LOJA VIRTUAL
// (site), sem loja na linha — qtd_atual = qtd_max (loja.lv_estoque, "Max", na
// Blue House) + qtd_pe (lv_estoque_pe) + qtd_bj (Brejinho). Tudo isso é da
// empresa 99, então só vê quem enxerga a 99 (owner/admin, Revenda, Multimarcas,
// Expedição, Financeiro…). Estoque das lojas físicas NÃO vem por esta porta.
export const EMPRESA_DO_ESTOQUE = 99;
export function podeVerEstoque(empresas) {
  return !empresas || empresas.map(Number).includes(EMPRESA_DO_ESTOQUE);
}

// ─── consultas ──────────────────────────────────────────────────────────────
const txt = (v) => (v == null ? '' : String(v).trim());
const limiteDe = (v, max = 500) => Math.max(1, Math.min(max, parseInt(v, 10) || 100));

export function ajuda() {
  return comCache('ajuda', 10 * 60_000, () => estqGw('ajuda'));
}
export function operacoes() {
  return comCache('operacoes', 10 * 60_000, () => estqGw('operacoes'));
}
export function grupos() {
  return comCache('grupos', 10 * 60_000, () => estqGw('grupos'));
}
export function manual(id = null) {
  const i = txt(id);
  return comCache(`manual:${i}`, 10 * 60_000, () => estqGw('manual', i ? { id: i } : {}));
}

export function saldo(q = {}) {
  const args = {};
  for (const k of ['cod', 'busca', 'grupo', 'subgrupo', 'classificacao']) if (txt(q[k])) args[k] = txt(q[k]);
  if (q.so_com_saldo === true || q.so_com_saldo === '1' || q.so_com_saldo === 'true') args.so_com_saldo = true;
  args.limite = limiteDe(q.limite);
  args.offset = Math.max(0, parseInt(q.offset, 10) || 0);
  return estqGw('saldo', args);
}

export function movimentos(q = {}) {
  const cod = txt(q.cod);
  if (!cod) throw new EstoqueDrylandError('Informe o código do produto');
  const args = { cod, limite: limiteDe(q.limite), offset: Math.max(0, parseInt(q.offset, 10) || 0) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(txt(q.desde))) args.desde = txt(q.desde);
  return estqGw('movimentos', args);
}

export function minhaFila(id = null) {
  const n = parseInt(id, 10);
  return estqGw('minha_fila', n ? { id: n } : {});
}

/**
 * Visão geral do estoque da Loja Virtual: todos os códigos com saldo (pagina de
 * 500 em 500), somas por local e por classificação. Cache de 5 min.
 */
export function resumo({ forcar = false } = {}) {
  if (forcar) cache.delete('resumo');
  return comCache('resumo', 5 * 60_000, async () => {
    const linhas = [];
    for (let offset = 0; offset < 100_000; offset += 500) {
      const r = await estqGw('saldo', { so_com_saldo: true, limite: 500, offset });
      if (!Array.isArray(r)) throw new EstoqueDrylandError('O Dryland devolveu o saldo num formato inesperado', 'FORMATO', 502);
      linhas.push(...r);
      if (r.length < 500) break;
    }
    const n = (v) => Number(v) || 0;
    const tot = { codigos: linhas.length, max: 0, pe: 0, bj: 0, total: 0, valor: 0, negativos: 0 };
    const porClass = new Map();
    for (const l of linhas) {
      const [mx, pe, bj, at] = [n(l.qtd_max), n(l.qtd_pe), n(l.qtd_bj), n(l.qtd_atual)];
      tot.max += mx;
      tot.pe += pe;
      tot.bj += bj;
      tot.total += at;
      tot.valor += at * n(l.preco_revenda);
      if (mx < 0 || pe < 0 || bj < 0) tot.negativos += 1;
      const c = txt(l.classificacao) || 'SEM CLASSIFICAÇÃO';
      const g = porClass.get(c) || { classificacao: c, codigos: 0, max: 0, pe: 0, bj: 0, total: 0, valor: 0 };
      g.codigos += 1;
      g.max += mx;
      g.pe += pe;
      g.bj += bj;
      g.total += at;
      g.valor += at * n(l.preco_revenda);
      porClass.set(c, g);
    }
    tot.valor = Math.round(tot.valor * 100) / 100;
    const classificacoes = [...porClass.values()].map((g) => ({ ...g, valor: Math.round(g.valor * 100) / 100 })).sort((a, b) => b.total - a.total);
    return { totais: tot, classificacoes, atualizadoEm: new Date().toISOString() };
  });
}

/** Situação da ligação (para a tela): token configurado e a porta respondendo. */
export async function status() {
  if (!tokenConfigurado()) return { configurado: false, conectado: false, erro: 'Token ainda não configurado (DRYLAND_ESTQ_TOKEN)' };
  try {
    const a = await ajuda();
    return { configurado: true, conectado: true, ajuda: a };
  } catch (e) {
    return { configurado: true, conectado: false, erro: e.message };
  }
}
