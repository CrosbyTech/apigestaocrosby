/**
 * Previsão de Recebimento — réplica no HeadCoach da aba "Fluxo de Recebíveis"
 * do Dryland (cobranca.html → rpc cob_previsao / cob_previsao_marcar), pedida
 * pelo João (Recuperação de Créditos) em 27/10/2026.
 *
 * Semana = sábado a sexta. Para a semana escolhida (0 = esta, 1 = próxima…):
 *   - títulos (faturas, situação normal) dos clientes dos 4 canais com
 *     vencimento na semana — abertos = "previsto", já baixados = "pago";
 *   - cada CLIENTE recebe SIM / TALVEZ / NÃO automaticamente pelo histórico de
 *     baixas dos últimos 12 meses no TOTVS (regras iguais às do Dryland, abaixo);
 *   - marcação manual por cliente (tabela previsao_recebimento_marcacoes)
 *     sobrepõe a automática; 'auto' desfaz sem apagar linha;
 *   - recebido por dia (baixas no TOTVS na semana, só clientes dos canais).
 *
 * Regras da classificação automática (texto do Dryland):
 *   Sim:    não deve nada vencido e paga em dia (todas as parcelas pagas até 3
 *           dias depois do vencimento), ou tem no máximo 20% das parcelas pagas
 *           com mais de 5 dias de atraso.
 *   Não:    tem título com mais de 30 dias de atraso, ou costuma atrasar e já
 *           está com título vencido.
 *   Talvez: todo o resto (vencido há até 30 dias, costuma atrasar, histórico
 *           irregular ou pouco histórico).
 *
 * Fonte: rota interna /api/totvs/accounts-receivable/filter (todas as páginas,
 * campos renomeados) — a mesma da tela de cobrança. Cache de CACHE_MIN por semana.
 */
import axios from 'axios';
import supabase from '../config/supabase.js';
import { CANAIS } from '../routes/cobranca.routes.js';

const TZ = 'America/Sao_Paulo';
const INTERNAL_API_BASE = process.env.INTERNAL_API_BASE || `http://127.0.0.1:${process.env.PORT || 4100}`;
const CACHE_MIN = Number(process.env.PREVISAO_CACHE_MIN || 10);
const CLIENTES_TESTE = new Set([3591]);
const DOC_FATURA = '1';
const LOTE_CLIENTES = 500;
const LOTES_SIMULTANEOS = 3;
const CANAL_NOME = { FRANQUIAS: 'franquia', MTM: 'multimarca', REVENDA: 'revenda', BLUECRED: 'bluecred' };
const TABELA_MARCACOES = 'previsao_recebimento_marcacoes';
const TABELA_SEMANAS = 'previsao_recebimento_semanas';
const TABELA_SNAP = 'previsao_recebimento_snapshot';
const SNAP_VELHO_H = Number(process.env.PREVISAO_SNAP_VELHO_H || 6);
const ST_LABEL = { sim: 'Sim', talvez: 'Talvez', nao: 'Não' };

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const addDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const dia = (v) => String(v || '').slice(0, 10);

/** Sábado que abre a semana `idx` (0 = esta semana) e a sexta que fecha. */
export function semanaInfo(idx, hoje = hojeBR()) {
  const d = new Date(`${hoje}T12:00:00Z`);
  const sab = addDias(hoje, -((d.getUTCDay() + 1) % 7) + 7 * idx);
  const sex = addDias(sab, 6);
  const br = (x) => `${x.slice(8, 10)}/${x.slice(5, 7)}`;
  return { idx, de: sab, ate: sex, label: `${idx === 0 ? 'Esta semana: ' : idx === 1 ? 'Próxima semana: ' : ''}${br(sab)} a ${br(sex)}` };
}

async function getInterno(path, params = {}, timeout = 10 * 60 * 1000) {
  // O TOTVS 500/estoura timeout de vez em quando (a consulta da semana sem
  // cd_cliente é pesada) e derrubava a tela toda. 3 tentativas com espera.
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const r = await axios.get(`${INTERNAL_API_BASE}${path}`, { params, timeout });
      if (r.data?.success === false) throw new Error(r.data?.message || path);
      return r.data;
    } catch (e) {
      ultimoErro = e;
      const status = e.response?.status;
      const retriavel = !status || status >= 500 || e.code === 'ECONNABORTED' || e.code === 'ECONNRESET';
      if (!retriavel || tentativa === 3) break;
      await new Promise((r) => setTimeout(r, 2000 * tentativa));
    }
  }
  throw ultimoErro;
}
async function postInterno(path, body, timeout = 2 * 60 * 1000) {
  const r = await axios.post(`${INTERNAL_API_BASE}${path}`, body, { timeout });
  return r.data;
}

/** Clientes dos canais: Map code → { canal, nome }. Precedência = ordem de CANAIS. */
async function clientesPorCanal() {
  const mapa = new Map();
  const avisos = [];
  for (const c of CANAIS) {
    try {
      const json = await getInterno(c.rota);
      // reseller-clients devolve { data: { data: [...], meta } }; os outros, { data: [...] } ou { data: { codes } }
      const lista = Array.isArray(json.data) ? json.data : Array.isArray(json.data?.data) ? json.data.data : json.data?.codes || json.data?.lista || [];
      let n = 0;
      for (const item of lista) {
        const code = Number(typeof item === 'object' ? item.code : item);
        if (!Number.isFinite(code) || code <= 0 || CLIENTES_TESTE.has(code)) continue;
        if (!mapa.has(code)) {
          mapa.set(code, { canal: c.key, nome: typeof item === 'object' ? item.fantasyName || item.name || '' : '' });
          n++;
        }
      }
      if (!n) avisos.push(`${c.key}: lista vazia`);
    } catch (e) {
      avisos.push(`${c.key}: ${e.message}`);
    }
  }
  return { mapa, avisos };
}

/** Nomes que faltam (BlueCred vem só com códigos) via persons/batch-lookup. */
async function completarNomes(mapa, codigos) {
  const faltam = codigos.filter((cd) => !mapa.get(cd)?.nome);
  for (let i = 0; i < faltam.length; i += 200) {
    const lote = faltam.slice(i, i + 200);
    try {
      const json = await postInterno('/api/totvs/persons/batch-lookup', { personCodes: lote });
      const res = json?.data || json || {};
      for (const cd of lote) {
        const p = res[cd] || res[String(cd)];
        if (p && mapa.get(cd)) mapa.get(cd).nome = p.fantasyName || p.name || '';
      }
    } catch (e) {
      /* fica "Cliente N" */
    }
  }
}

const filialOk = (canalKey, cdEmpresa) => {
  const c = CANAIS.find((x) => x.key === canalKey);
  return c ? c.filial(cdEmpresa) : true;
};
const titulo = (t) => ({
  e: t.cd_empresa,
  f: t.nr_fatura ?? t.nr_fat,
  p: t.nr_parcela ?? 1,
  cd: Number(t.cd_cliente),
  venc: dia(t.dt_vencimento),
  dt_liq: t.dt_liq ? dia(t.dt_liq) : null,
  valor: r2(t.vl_fatura),
  vl_pago: r2(t.vl_pago),
  pago: Boolean(t.dt_liq) && Number(t.vl_pago || 0) > 0.01,
});

async function titulosFiltro(params) {
  const json = await getInterno('/api/totvs/accounts-receivable/filter', { modo: 'vencimento', situacao: '1', status: 'Todos', tp_documento: DOC_FATURA, ...params });
  return (json.data?.items || []).map(titulo);
}

/** Histórico de 12 meses dos clientes informados (lotes de 500, 3 por vez). */
async function historico(codigos, dtIni, dtFim) {
  const lotes = [];
  for (let i = 0; i < codigos.length; i += LOTE_CLIENTES) lotes.push(codigos.slice(i, i + LOTE_CLIENTES));
  const out = [];
  const avisos = [];
  for (let i = 0; i < lotes.length; i += LOTES_SIMULTANEOS) {
    const grupo = lotes.slice(i, i + LOTES_SIMULTANEOS);
    const rs = await Promise.allSettled(grupo.map((lote) => titulosFiltro({ dt_inicio: dtIni, dt_fim: dtFim, cd_cliente: lote.join(',') })));
    rs.forEach((r, j) => {
      if (r.status === 'fulfilled') out.push(...r.value);
      else avisos.push(`histórico lote ${i + j + 1}/${lotes.length}: ${r.reason?.message}`);
    });
  }
  return { itens: out, avisos };
}

/** Regras do Dryland. `hist` = títulos do cliente nos últimos 12 meses (abertos e pagos). */
export function classificar(hist, hoje) {
  const abertos = hist.filter((t) => !t.pago);
  const vencidos = abertos.filter((t) => t.venc && t.venc < hoje);
  const maxAtraso = vencidos.reduce((m, t) => Math.max(m, diasEntre(t.venc, hoje)), 0);
  const pagos = hist.filter((t) => t.pago && t.dt_liq && t.venc);
  const atraso = (t) => diasEntre(t.venc, t.dt_liq);
  const n = pagos.length;
  const late3 = pagos.filter((t) => atraso(t) > 3).length;
  const late5 = pagos.filter((t) => atraso(t) > 5).length;
  const pct5 = n ? late5 / n : 0;
  const costuma = n >= 3 && pct5 > 0.2;
  const vencTxt = vencidos.length ? `${vencidos.length} título(s) vencido(s), o mais antigo há ${maxAtraso} dia(s)` : '';
  if (maxAtraso > 30) return { status: 'nao', motivo: `título vencido há ${maxAtraso} dias (mais de 30)` };
  if (costuma && vencidos.length) return { status: 'nao', motivo: `costuma atrasar (${pct(pct5)} das ${n} parcelas pagas com mais de 5 dias) e ${vencTxt}` };
  if (n < 3) return { status: 'talvez', motivo: `pouco histórico (${n} parcela(s) paga(s) nos últimos 12 meses)${vencTxt ? `; ${vencTxt}` : ''}` };
  if (vencidos.length) return { status: 'talvez', motivo: `${vencTxt} (até 30 dias)` };
  if (late3 === 0) return { status: 'sim', motivo: `paga em dia: ${n} parcelas pagas até 3 dias após o vencimento, nada vencido` };
  if (!costuma) return { status: 'sim', motivo: `nada vencido e só ${pct(pct5)} das ${n} parcelas pagas com mais de 5 dias de atraso` };
  return { status: 'talvez', motivo: `histórico irregular: ${pct(pct5)} das ${n} parcelas pagas com mais de 5 dias de atraso` };
}

// ── cálculo ─────────────────────────────────────────────────────────────────
const cache = new Map(); // idx → { em, dados }
const emCurso = new Map();

export async function calcular(idx = 0) {
  const hoje = hojeBR();
  const sem = semanaInfo(idx, hoje);
  const avisos = [];
  const { mapa, avisos: av1 } = await clientesPorCanal();
  avisos.push(...av1);

  // títulos que vencem na semana (todos os clientes) → só os dos canais
  const daSemana = (await titulosFiltro({ dt_inicio: sem.de, dt_fim: sem.ate })).filter((t) => mapa.has(t.cd) && filialOk(mapa.get(t.cd).canal, t.e));
  const codigos = [...new Set(daSemana.map((t) => t.cd))];
  await completarNomes(mapa, codigos);

  // histórico de 12 meses dos clientes da semana
  const { itens: hist, avisos: av2 } = codigos.length ? await historico(codigos, addDias(hoje, -365), sem.ate) : { itens: [], avisos: [] };
  avisos.push(...av2);
  const histPorCliente = new Map();
  for (const t of hist) {
    if (!histPorCliente.has(t.cd)) histPorCliente.set(t.cd, []);
    histPorCliente.get(t.cd).push(t);
  }

  // marcações manuais
  const manual = new Map();
  if (codigos.length) {
    const { data } = await supabase.from(TABELA_MARCACOES).select('cd_cliente, status, por, motivo, em').in('cd_cliente', codigos);
    for (const m of data || []) if (m.status !== 'auto') manual.set(Number(m.cd_cliente), m);
  }

  const clientes = codigos.map((cd) => {
    const info = mapa.get(cd) || {};
    const ts = daSemana.filter((t) => t.cd === cd).sort((a, b) => a.venc.localeCompare(b.venc));
    const abertosSemana = ts.filter((t) => !t.pago);
    const h = histPorCliente.get(cd) || ts;
    const auto = classificar(h, hoje);
    const m = manual.get(cd);
    const vencido = r2(h.filter((t) => !t.pago && t.venc < hoje).reduce((a, t) => a + t.valor, 0));
    return {
      cd,
      nome: info.nome || `Cliente ${cd}`,
      canal: CANAL_NOME[info.canal] || info.canal || '',
      status: m ? m.status : auto.status,
      auto: auto.status,
      motivo: auto.motivo,
      manual: Boolean(m),
      manual_por: m?.por || null,
      manual_motivo: m?.motivo || null,
      manual_em: m?.em || null,
      n: ts.length,
      n_abertos: abertosSemana.length,
      valor: r2(abertosSemana.reduce((a, t) => a + t.valor, 0)),
      pago: r2(ts.filter((t) => t.pago).reduce((a, t) => a + t.vl_pago, 0)),
      vencido,
      prox: abertosSemana[0]?.venc || ts[0]?.venc || null,
      titulos: ts,
    };
  }).sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome));

  // por dia (sáb..sex) × status
  const porDia = {};
  for (const c of clientes) {
    for (const t of c.titulos) {
      const k = `${t.venc}|${c.status}`;
      porDia[k] ||= { dia: t.venc, status: c.status, previsto: 0, pago: 0, titulos: 0 };
      if (t.pago) porDia[k].pago = r2(porDia[k].pago + t.vl_pago);
      else porDia[k].previsto = r2(porDia[k].previsto + t.valor);
      porDia[k].titulos++;
    }
  }

  // recebido por dia (baixas no TOTVS na semana, clientes dos canais)
  const recebidoDia = [];
  let recebidoHoje = { valor: 0, n: 0, clientes: 0 };
  if (sem.de <= hoje) {
    try {
      const pagos = (await titulosFiltro({ dt_inicio: sem.de, dt_fim: sem.ate < hoje ? sem.ate : hoje, modo: 'pagamento', status: 'Pago' })).filter((t) => mapa.has(t.cd));
      const porD = {};
      for (const t of pagos) {
        const k = t.dt_liq;
        porD[k] ||= { dia: k, valor: 0, n: 0, clientes: new Set() };
        porD[k].valor = r2(porD[k].valor + t.vl_pago);
        porD[k].n++;
        porD[k].clientes.add(t.cd);
      }
      for (const v of Object.values(porD)) recebidoDia.push({ dia: v.dia, valor: v.valor, n: v.n, clientes: v.clientes.size });
      recebidoDia.sort((a, b) => a.dia.localeCompare(b.dia));
      const h = porD[hoje];
      if (h) recebidoHoje = { valor: h.valor, n: h.n, clientes: h.clientes.size };
    } catch (e) {
      avisos.push(`recebido por dia: ${e.message}`);
    }
  }

  const dados = {
    ok: true,
    gerado_em: new Date().toISOString(),
    hoje,
    semana: sem,
    semanas: [0, 1, 2, 3, 4, 5].map((i) => semanaInfo(i, hoje)),
    clientes,
    por_dia: Object.values(porDia).sort((a, b) => a.dia.localeCompare(b.dia)),
    recebido_dia: recebidoDia,
    recebido_hoje: recebidoHoje,
    totais: ['sim', 'talvez', 'nao'].reduce((acc, st) => {
      const g = clientes.filter((c) => c.status === st);
      acc[st] = { clientes: g.length, valor: r2(g.reduce((a, c) => a + c.valor, 0)), label: ST_LABEL[st] };
      return acc;
    }, {}),
    avisos,
  };

  // guarda a previsão da semana (esta e a próxima) para comparar depois com o realizado
  if (idx <= 1 && clientes.length) {
    try {
      const linhas = clientes.map((c) => ({
        semana: sem.de,
        cd_cliente: c.cd,
        canal: c.canal,
        status: c.status,
        previsto: c.valor,
        titulos: c.titulos.map((t) => ({ e: t.e, f: t.f, p: t.p, venc: t.venc, valor: t.valor, pago: t.pago })),
        gravado_em: new Date().toISOString(),
      }));
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await supabase.from(TABELA_SEMANAS).upsert(linhas.slice(i, i + 500), { onConflict: 'semana,cd_cliente' });
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      avisos.push(`histórico semanal: ${e.message}`);
    }
  }
  return dados;
}

/** Calcula e grava o snapshot FIXO da semana (João, 27/10/2026). */
export async function gerarSnapshot(idx = 0) {
  const dados = await calcular(idx);
  const { error } = await supabase
    .from(TABELA_SNAP)
    .upsert({ semana: dados.semana.de, idx, dados, gerado_em: dados.gerado_em }, { onConflict: 'semana' });
  if (error) throw new Error(`${TABELA_SNAP}: ${error.message}`);
  cache.set(idx, { em: Date.now(), dados });
  return dados;
}

// estrutura vazia válida: a tela nunca recebe erro/branco, mesmo se o TOTVS cair
const vazio = (idx, aviso) => ({
  ok: true,
  gerado_em: new Date().toISOString(),
  hoje: hojeBR(),
  semana: semanaInfo(idx),
  semanas: [0, 1, 2, 3, 4, 5].map((i) => semanaInfo(i)),
  clientes: [],
  por_dia: [],
  recebido_dia: [],
  recebido_hoje: { valor: 0, n: 0, clientes: 0 },
  totais: { sim: { clientes: 0, valor: 0, label: 'Sim' }, talvez: { clientes: 0, valor: 0, label: 'Talvez' }, nao: { clientes: 0, valor: 0, label: 'Não' } },
  avisos: [aviso],
  gerando: true,
});

/**
 * A tela LÊ o snapshot fixo da semana (não calcula ao abrir → carrega na hora e
 * nunca fica em branco). Se o snapshot ainda não existe, gera na 1ª vez; se
 * falhar, devolve estrutura vazia com aviso (a rota nunca dá 500). O job mantém
 * as semanas 0 e 1 atualizadas e cria a nova no sábado.
 */
export async function obter({ semana = 0, refresh = false } = {}) {
  const idx = Math.min(Math.max(Number(semana) || 0, 0), 7);
  const c = cache.get(idx);
  if (c && !refresh && Date.now() - c.em < CACHE_MIN * 60 * 1000) return { ...c.dados, fonte: 'cache' };

  const sab = semanaInfo(idx).de;
  let snap = null;
  try {
    const { data } = await supabase.from(TABELA_SNAP).select('dados, gerado_em').eq('semana', sab).maybeSingle();
    snap = data || null;
  } catch {
    /* sem snapshot */
  }
  if (snap?.dados) {
    cache.set(idx, { em: Date.now(), dados: snap.dados });
    const velho = Date.now() - new Date(snap.gerado_em).getTime() > SNAP_VELHO_H * 3600 * 1000;
    if ((refresh || velho) && !emCurso.has(idx)) {
      const p = gerarSnapshot(idx).catch(() => {}).finally(() => emCurso.delete(idx));
      emCurso.set(idx, p);
    }
    return { ...snap.dados, fonte: 'snapshot', gerado_em: snap.gerado_em };
  }

  // primeira vez: gera agora; nunca propaga erro pra tela
  if (emCurso.has(idx)) return emCurso.get(idx);
  const p = gerarSnapshot(idx)
    .catch((e) => vazio(idx, `gerando a previsão em segundo plano — atualize em instantes (${e.message})`))
    .finally(() => emCurso.delete(idx));
  emCurso.set(idx, p);
  return p;
}

export function invalidar() {
  cache.clear();
}

export function iniciarJobPrevisao() {
  if (String(process.env.PREVISAO_JOB || 'on').toLowerCase() === 'off') {
    console.log('ℹ️ [previsao-recebimento] job desligado (PREVISAO_JOB=off)');
    return;
  }
  const rodar = async () => {
    for (const i of [0, 1]) {
      try { await gerarSnapshot(i); } catch (e) { console.warn(`⚠️ [previsao-recebimento] snapshot semana ${i}: ${e.message}`); }
    }
  };
  setTimeout(() => rodar().catch(() => {}), 3 * 60 * 1000);
  setInterval(() => rodar().catch(() => {}), 60 * 60 * 1000); // de hora em hora: atualiza e cria a nova semana no sábado
  console.log('🗓️ [previsao-recebimento] job: snapshot das semanas 0 e 1 na subida (+3min) e de hora em hora');
}

/** Marcação manual: sim/talvez/nao, ou 'auto' para voltar ao automático (sem apagar a linha). */
export async function marcar({ cd_cliente, status, por, motivo }) {
  const cd = Number(cd_cliente);
  if (!Number.isFinite(cd) || cd <= 0) throw new Error('cd_cliente inválido');
  if (!['sim', 'talvez', 'nao', 'auto'].includes(status)) throw new Error('status inválido');
  const { error } = await supabase.from(TABELA_MARCACOES).upsert({ cd_cliente: cd, status, por: por || null, motivo: motivo || null, em: new Date().toISOString() }, { onConflict: 'cd_cliente' });
  if (error) throw new Error(error.message);
  // atualiza o cache sem recalcular tudo
  for (const [, c] of cache) {
    const cli = c.dados?.clientes?.find((x) => x.cd === cd);
    if (!cli) continue;
    cli.manual = status !== 'auto';
    cli.status = status === 'auto' ? cli.auto : status;
    cli.manual_por = status === 'auto' ? null : por || null;
    cli.manual_motivo = status === 'auto' ? null : motivo || null;
    c.dados.totais = ['sim', 'talvez', 'nao'].reduce((acc, st) => {
      const g = c.dados.clientes.filter((x) => x.status === st);
      acc[st] = { clientes: g.length, valor: r2(g.reduce((a, x) => a + x.valor, 0)), label: ST_LABEL[st] };
      return acc;
    }, {});
    const porDia = {};
    for (const cc of c.dados.clientes) for (const t of cc.titulos) {
      const k = `${t.venc}|${cc.status}`;
      porDia[k] ||= { dia: t.venc, status: cc.status, previsto: 0, pago: 0, titulos: 0 };
      if (t.pago) porDia[k].pago = r2(porDia[k].pago + t.vl_pago); else porDia[k].previsto = r2(porDia[k].previsto + t.valor);
      porDia[k].titulos++;
    }
    c.dados.por_dia = Object.values(porDia).sort((a, b) => a.dia.localeCompare(b.dia));
  }
  return { ok: true };
}

/** Semanas guardadas: previsto por status (para "realizado por semana" na tela). */
export async function historicoSemanas(limite = 8) {
  const { data, error } = await supabase.from(TABELA_SEMANAS).select('semana, status, previsto, canal').order('semana', { ascending: false }).limit(5000);
  if (error) throw new Error(error.message);
  const porSemana = {};
  for (const r of data || []) {
    const s = (porSemana[r.semana] ||= { semana: r.semana, sim: 0, talvez: 0, nao: 0, clientes: 0 });
    s[r.status] = r2((s[r.status] || 0) + Number(r.previsto || 0));
    s.clientes++;
  }
  return Object.values(porSemana).sort((a, b) => b.semana.localeCompare(a.semana)).slice(0, limite);
}
