// ============================================================
// Conciliação das contas MÊNTORE com a folha do Dryland (DP/RH)
// ------------------------------------------------------------
// As contas Mêntore só pagam verbas trabalhistas. Cada saída do extrato vem
// nomeada ("Pagamento de salário - NOME", "Pagamento de férias - NOME",
// "Rescisão - NOME", "Adiantamento - NOME") e é batida com:
//   • salário      → LÍQUIDO do funcionário na folha da competência
//                    (pago nos primeiros dias do mês seguinte);
//   • férias       → eventos de férias do funcionário na folha (proventos
//                    de férias/1/3/abono menos os descontos sobre férias);
//   • adiantamento → evento "Adiantamento" (desconto) na folha seguinte;
//   • rescisão     → aba Rescisões do Dryland (verbas líquidas + aviso
//                    indenizado; a multa do FGTS vai na guia, não ao
//                    funcionário).
// A referência gravada carrega o funcionário inteiro (eventos = rubricas com
// código, descrição, referência e valor), para o detalhe mostrar o cálculo.
//
// Fonte: Supabase do Dryland via RPC (dp_login → dp_folha_dados /
// dp_rescisoes → dp_logout), credenciais DRYLAND_DP_USUARIO/SENHA (só no
// Render). A folha é lenta a frio: cache em memória + tabela
// fluxo_caixa_folha_cache (criada sob demanda via exec_sql).
// ============================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { DRYLAND_URL, DRYLAND_KEY } from './drylandBaixas.js';

const DP_USUARIO = process.env.DRYLAND_DP_USUARIO || '';
const DP_SENHA = process.env.DRYLAND_DP_SENHA || '';
const T_CACHE = 'fluxo_caixa_folha_cache';
const CACHE_MEM_MS = 30 * 60 * 1000;
const CACHE_DB_MS = 24 * 60 * 60 * 1000;
const VALOR_TOL = 0.051;

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normNome = (s) => semAcento(s).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const PARTICULAS = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);
const tokensNome = (s) => normNome(s).split(' ').filter((t) => t && !PARTICULAS.has(t));
const mesDe = (iso) => String(iso || '').slice(0, 7);
const addMeses = (mes, n) => {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const diaDe = (iso) => Number(String(iso || '').slice(8, 10)) || 0;

export const ehLinhaFolha = (l) => Number(l.valor) < 0 && (String(l.banco || '').toUpperCase() === 'MENTORE' || String(l.categoria || '') === 'folha');

/** tipo e nome do funcionário a partir da descrição do extrato Mêntore */
export function lerLinhaFolha(l) {
  const txt = String(l.descricao || l.memo || '');
  const up = semAcento(txt).toUpperCase();
  let tipo = null;
  if (/RESCIS/.test(up)) tipo = 'rescisao';
  else if (/FERIAS/.test(up)) tipo = 'ferias';
  else if (/ADIANTAMENTO/.test(up)) tipo = 'adiantamento';
  else if (/13|DECIMO/.test(up)) tipo = 'decimo';
  else if (/SALARIO|FOLHA|PAGAMENTO/.test(up)) tipo = 'salario';
  const m = txt.match(/\s[-–]\s*(.+)$/);
  const nome = (m ? m[1] : l.contraparte_nome || '').trim();
  return { tipo, nome, nomeNorm: normNome(nome) };
}

/** 1 = mesmo nome; 0.8+ = muito parecido (nome truncado ou abreviado); 0 = outro */
// distância de edição (grafias com 1 letra diferente entre extrato e folha)
const lev = (a, b) => {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
};
const tokenIgual = (x, y, { prefixo = false } = {}) => x === y || (x.length >= 5 && y.length >= 5 && lev(x, y) <= 1) || (prefixo && x.length >= 2 && (y.startsWith(x) || x.startsWith(y)));
export function semelhancaNome(a, b) {
  const na = normNome(a);
  const nb = normNome(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.startsWith(nb) || nb.startsWith(na)) return 0.95;
  const ta = tokensNome(a);
  const tb = tokensNome(b);
  if (!ta.length || !tb.length) return 0;
  if (!tokenIgual(ta[0], tb[0])) return 0;
  // nome do extrato truncado ("… DOS SA...") → o último token pode ser prefixo
  const truncado = /\.{3}|…/.test(String(a)) || /\.{3}|…/.test(String(b));
  let comuns = 0;
  const restantes = [...tb];
  ta.forEach((t, i) => {
    const k = restantes.findIndex((u) => tokenIgual(t, u, { prefixo: truncado && i === ta.length - 1 }));
    if (k >= 0) {
      comuns++;
      restantes.splice(k, 1);
    }
  });
  if (comuns < 2) return 0;
  const base = truncado ? Math.min(ta.length, tb.length) : Math.max(ta.length, tb.length);
  return Math.min(1, comuns / base);
}

// ─── Dryland ──────────────────────────────────────────────────
async function rpc(fn, args = {}) {
  const { data } = await axios.post(`${DRYLAND_URL}/rest/v1/rpc/${fn}`, args, {
    headers: { 'Content-Type': 'application/json', apikey: DRYLAND_KEY, Authorization: `Bearer ${DRYLAND_KEY}` },
    timeout: 90000,
  });
  return data;
}
async function comSessao(fn) {
  if (!DP_USUARIO || !DP_SENHA) throw Object.assign(new Error('Acesso ao DP do Dryland não configurado (DRYLAND_DP_USUARIO/SENHA).'), { status: 503 });
  const lg = await rpc('dp_login', { p_usuario: DP_USUARIO, p_senha: DP_SENHA });
  if (!lg || lg.ok !== true || !lg.token) throw Object.assign(new Error(`login no DP do Dryland falhou (${(lg && lg.erro) || 'recusado'})`), { status: 502 });
  try {
    return await fn(lg.token);
  } finally {
    rpc('dp_logout', { p_token: lg.token }).catch(() => {});
  }
}

const normFunc = (f, competencia) => ({
  cnpj: String(f.cnpj || '').replace(/\D/g, ''),
  empresa: f.empresa || null,
  secao: f.secao || null,
  chapa: f.chapa || null,
  nome: f.nome || '',
  funcao: f.funcao || null,
  situacao: f.situacao || null,
  admissao: f.admissao || null,
  salario: f.salario != null ? round2(f.salario) : null,
  proventos: round2(f.proventos || 0),
  descontos: round2(f.descontos || 0),
  liquido: round2(f.liquido != null ? f.liquido : (f.proventos || 0) - (f.descontos || 0)),
  competencia,
  eventos: (f.eventos || []).map((e) => ({ cod: e.cod || null, desc: e.desc || '', ref: e.ref ?? null, valor: round2(e.valor || 0), tipo: e.tipo === 'D' ? 'D' : 'P' })),
});

const mem = new Map(); // mes → { em, dados }
let cacheTabelaOk = null;
async function garantirTabelaCache() {
  if (cacheTabelaOk != null) return cacheTabelaOk;
  try {
    const { error } = await supabase.rpc('exec_sql', { query: `create table if not exists ${T_CACHE} (mes text primary key, dados jsonb not null, atualizado_em timestamptz not null default now())` });
    cacheTabelaOk = !error;
  } catch {
    cacheTabelaOk = false;
  }
  return cacheTabelaOk;
}

/**
 * Folha de uma competência (AAAA-MM): funcionários normalizados + resumos.
 * Devolve { competencia, funcionarios, competencias, em } ou funcionarios
 * vazio quando a competência não foi importada no Dryland.
 */
export async function lerFolha(mes, { forcar = false } = {}) {
  const hit = mem.get(mes);
  if (!forcar && hit && Date.now() - hit.em < CACHE_MEM_MS) return hit.dados;
  if (!forcar && (await garantirTabelaCache())) {
    const { data } = await supabase.from(T_CACHE).select('dados,atualizado_em').eq('mes', mes).maybeSingle();
    if (data?.dados && Date.now() - new Date(data.atualizado_em).getTime() < CACHE_DB_MS) {
      mem.set(mes, { em: Date.now(), dados: data.dados });
      return data.dados;
    }
  }
  const dados = await comSessao(async (token) => {
    const r = await rpc('dp_folha_dados', { p_token: token, p_competencia: `${mes}-01` });
    if (!r || r.ok === false) throw Object.assign(new Error(`folha ${mes}: ${(r && r.erro) || 'sem resposta'}`), { status: 502 });
    const competencias = (r.competencias || []).map((c) => String(c).slice(0, 7));
    const linhas = r.linhas || [];
    // a RPC devolve a competência mais recente quando a pedida não existe
    const comp = String(r.competencia || `${mes}-01`).slice(0, 7);
    const funcionarios = comp === mes ? linhas.filter((l) => !l._resumo).map((f) => normFunc(f, mes)) : [];
    return { competencia: mes, importada: comp === mes, funcionarios, competencias, em: new Date().toISOString() };
  });
  mem.set(mes, { em: Date.now(), dados });
  if (await garantirTabelaCache()) await supabase.from(T_CACHE).upsert({ mes, dados, atualizado_em: new Date().toISOString() }).then(() => {}, () => {});
  return dados;
}

let rescMem = null;
export async function lerRescisoes({ forcar = false } = {}) {
  if (!forcar && rescMem && Date.now() - rescMem.em < CACHE_MEM_MS) return rescMem.itens;
  const itens = await comSessao(async (token) => {
    const r = await rpc('dp_rescisoes', { p_token: token });
    return (r?.itens || []).map((x) => ({
      id: x.id,
      competencia: String(x.competencia || '').slice(0, 7),
      empresa: x.empresa || null,
      colaborador: x.colaborador || '',
      valorRescisao: round2(x.valor_rescisao || 0),
      avisoPrevio: round2(x.aviso_previo || 0),
      multa: round2(x.multa || 0),
      total: round2(x.total || 0),
      pagoAoFuncionario: round2(Number(x.valor_rescisao || 0) + Number(x.aviso_previo || 0)),
      rubricas: (x.rubricas || []).map((r) => ({ cod: r.c ?? r.cod ?? null, desc: r.d ?? r.desc ?? '', valor: round2(r.v ?? r.valor ?? 0), tipo: (r.t ?? r.tipo) === 'D' ? 'D' : 'P' })),
      obs: x.obs || null,
    }));
  });
  rescMem = { em: Date.now(), itens };
  return itens;
}

// ─── valores esperados por tipo ───────────────────────────────
const RE_FERIAS = /FERIAS|1\/3|TERCO|ABONO PECUN/i;
const eventosFerias = (f) => f.eventos.filter((e) => RE_FERIAS.test(semAcento(e.desc)));
export const liquidoFerias = (f) => {
  const ev = eventosFerias(f);
  if (!ev.length) return null;
  return round2(ev.reduce((s, e) => s + (e.tipo === 'P' ? e.valor : -e.valor), 0));
};
const eventosAdiantamento = (f) => f.eventos.filter((e) => e.tipo === 'D' && /ADIANTAMENTO/i.test(semAcento(e.desc)) && !RE_FERIAS.test(semAcento(e.desc)));
export const valorAdiantamento = (f) => {
  const ev = eventosAdiantamento(f);
  return ev.length ? round2(ev.reduce((s, e) => s + e.valor, 0)) : null;
};
const eventosDecimo = (f) => f.eventos.filter((e) => /13|DECIMO/i.test(semAcento(e.desc)));
export const liquidoDecimo = (f) => {
  const ev = eventosDecimo(f);
  if (!ev.length) return null;
  return round2(ev.reduce((s, e) => s + (e.tipo === 'P' ? e.valor : -e.valor), 0));
};

const competenciasPara = (tipo, data) => {
  const mes = mesDe(data);
  const ant = addMeses(mes, -1);
  const prox = addMeses(mes, 1);
  if (tipo === 'salario') return diaDe(data) <= 20 ? [ant, mes] : [mes, ant];
  if (tipo === 'adiantamento') return [mes, prox];
  if (tipo === 'decimo') return [mes, addMeses(mes, -1), prox];
  return [mes, ant, prox]; // férias e outros
};

const rotulo = { salario: 'Salário', ferias: 'Férias', adiantamento: 'Adiantamento', decimo: '13º salário', rescisao: 'Rescisão' };

function candidatoDeFuncionario(l, f, tipo, info, { esperado, score, motivos, comoCalculado }) {
  const valorLinha = Math.abs(Number(l.valor));
  const id = `${f.cnpj || 'x'}|${f.chapa || normNome(f.nome)}|${f.competencia}|${tipo}`;
  const bate = esperado != null && Math.abs(esperado - valorLinha) <= VALOR_TOL;
  return {
    origem: 'FOLHA',
    id,
    nome: f.nome,
    doc: null,
    valor: esperado != null ? esperado : valorLinha,
    valorDuplicata: esperado != null ? esperado : valorLinha,
    data: `${f.competencia}-01`,
    vencimento: null,
    empresa: f.empresa,
    duplicata: f.chapa ? `chapa ${f.chapa}` : null,
    detalhe: [`${rotulo[tipo] || tipo} · competência ${f.competencia.split('-').reverse().join('/')}`, f.secao ? `loja ${f.secao}` : null, f.funcao || null, esperado != null ? `${comoCalculado}: ${esperado.toFixed(2)}` : 'sem o evento na folha'].filter(Boolean).join(' · '),
    score,
    motivos,
    bate,
    parcial: false,
    folha: { fonte: 'dryland', tipo, competencia: f.competencia, nome: f.nome, nomeExtrato: info.nome, chapa: f.chapa, cnpj: f.cnpj, empresa: f.empresa, secao: f.secao, funcao: f.funcao, situacao: f.situacao, admissao: f.admissao, salario: f.salario, proventos: f.proventos, descontos: f.descontos, liquido: f.liquido, esperado, comoCalculado, eventos: f.eventos },
  };
}

function candidatoDeRescisao(l, r, info, sim) {
  const valorLinha = Math.abs(Number(l.valor));
  const esperado = r.pagoAoFuncionario;
  const bate = Math.abs(esperado - valorLinha) <= VALOR_TOL;
  const motivos = [sim >= 0.95 ? 'mesmo colaborador' : 'nome parecido', bate ? 'valor igual (verbas líquidas + aviso)' : `valor diferente (rescisão ${esperado.toFixed(2)})`];
  return {
    origem: 'FOLHA',
    id: `resc|${r.id}`,
    nome: r.colaborador,
    doc: null,
    valor: esperado,
    valorDuplicata: esperado,
    data: `${r.competencia}-01`,
    vencimento: null,
    empresa: r.empresa,
    duplicata: null,
    detalhe: [`Rescisão · competência ${r.competencia.split('-').reverse().join('/')}`, `verbas líquidas ${r.valorRescisao.toFixed(2)}`, r.avisoPrevio ? `aviso indenizado ${r.avisoPrevio.toFixed(2)}` : null, r.multa ? `multa FGTS (guia) ${r.multa.toFixed(2)}` : null].filter(Boolean).join(' · '),
    score: bate ? (sim >= 0.95 ? 100 : 85) : sim >= 0.95 ? 55 : 40,
    motivos,
    bate,
    parcial: false,
    folha: { fonte: 'dryland', tipo: 'rescisao', competencia: r.competencia, nome: r.colaborador, nomeExtrato: info.nome, empresa: r.empresa, esperado, comoCalculado: 'verbas líquidas + aviso prévio indenizado', rescisao: { id: r.id, valorRescisao: r.valorRescisao, avisoPrevio: r.avisoPrevio, multa: r.multa, total: r.total, obs: r.obs }, eventos: r.rubricas },
  };
}

/**
 * Candidatos da folha para uma saída Mêntore. `usados` = Map origem:id → valor
 * já usado (cada pagamento só concilia uma vez).
 */
export async function candidatosFolha(l, usados = new Map(), { avisos = [] } = {}) {
  const info = lerLinhaFolha(l);
  if (!info.nome) return [];
  const valorLinha = Math.abs(Number(l.valor));
  const tipo = info.tipo || 'salario';
  const out = [];
  const livre = (c) => (usados.get(`${c.origem}:${c.id}`) || 0) < VALOR_TOL;

  if (tipo === 'rescisao') {
    let resc = [];
    try {
      resc = await lerRescisoes();
    } catch (e) {
      avisos.push(`Rescisões do Dryland: ${e.message}`);
    }
    const mes = mesDe(l.data);
    const janela = new Set([addMeses(mes, -2), addMeses(mes, -1), mes, addMeses(mes, 1)]);
    for (const r of resc) {
      const sim = semelhancaNome(info.nome, r.colaborador);
      if (sim < 0.6 || !janela.has(r.competencia)) continue;
      const c = candidatoDeRescisao(l, r, info, sim);
      if (livre(c)) out.push(c);
    }
    // sem rescisão cadastrada: oferece a folha do funcionário (não automático)
    if (!out.length) {
      for (const mesF of [mes, addMeses(mes, -1)]) {
        let folha;
        try {
          folha = await lerFolha(mesF);
        } catch (e) {
          avisos.push(`Folha ${mesF}: ${e.message}`);
          continue;
        }
        for (const f of folha.funcionarios) {
          const sim = semelhancaNome(info.nome, f.nome);
          if (sim < 0.6) continue;
          out.push(candidatoDeFuncionario(l, f, 'rescisao', info, { esperado: null, score: 30, motivos: ['rescisão não cadastrada no Dryland; folha do funcionário para conferência'], comoCalculado: null }));
        }
      }
    }
  } else {
    for (const mesF of competenciasPara(tipo, l.data)) {
      let folha;
      try {
        folha = await lerFolha(mesF);
      } catch (e) {
        avisos.push(`Folha ${mesF}: ${e.message}`);
        continue;
      }
      for (const f of folha.funcionarios) {
        const sim = semelhancaNome(info.nome, f.nome);
        if (sim < 0.6) continue;
        let esperado = null;
        let comoCalculado = null;
        if (tipo === 'salario') {
          esperado = f.liquido;
          comoCalculado = 'líquido da folha (proventos − descontos)';
        } else if (tipo === 'ferias') {
          esperado = liquidoFerias(f);
          comoCalculado = 'eventos de férias (proventos − descontos de férias)';
        } else if (tipo === 'adiantamento') {
          esperado = valorAdiantamento(f);
          comoCalculado = 'evento Adiantamento descontado na folha';
        } else if (tipo === 'decimo') {
          esperado = liquidoDecimo(f);
          comoCalculado = 'eventos de 13º (proventos − descontos)';
        }
        const bate = esperado != null && Math.abs(esperado - valorLinha) <= VALOR_TOL;
        const prioridade = competenciasPara(tipo, l.data)[0] === mesF;
        let score;
        // mesmo líquido em duas competências é comum (salário fixo): a
        // competência esperada tem que vencer com folga para o aceite automático
        if (bate) score = sim >= 0.95 ? (prioridade ? 100 : 78) : prioridade ? 85 : 65;
        else if (esperado != null) score = sim >= 0.95 ? 50 : 35;
        else score = sim >= 0.95 ? 40 : 25;
        const motivos = [sim >= 0.95 ? 'mesmo funcionário' : 'nome parecido', bate ? 'valor igual' : esperado != null ? `valor diferente (folha ${esperado.toFixed(2)})` : 'folha sem o evento', prioridade ? 'competência esperada' : 'outra competência'];
        const c = candidatoDeFuncionario(l, f, tipo, info, { esperado, score, motivos, comoCalculado });
        if (livre(c)) out.push(c);
      }
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export default { ehLinhaFolha, lerLinhaFolha, semelhancaNome, lerFolha, lerRescisoes, candidatosFolha, liquidoFerias, valorAdiantamento, liquidoDecimo };
