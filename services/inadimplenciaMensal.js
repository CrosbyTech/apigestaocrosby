/**
 * Inadimplência mensal (>60 dias) — pedido do João (Recuperação de Créditos, 26/10/2026).
 *
 * Índice de inadimplência da marca = títulos (faturas) vencidos há MAIS DE 60
 * DIAS. Série mensal de fevereiro/2026 até o mês atual: para cada mês M, com
 * fim E (último dia, ou hoje no mês corrente), conta o título se
 *   vencimento ≤ E − 60 dias  E  (não pago  OU  pago depois de E).
 * Assim um título pago em maio ainda conta em março se já estava >60 dias
 * vencido no fim de março — a série passada não muda quando a baixa entra.
 *
 * Fonte: TOTVS documents/search (faturas, status normal), para os clientes
 * dos 4 canais (mesmas listas/filiais da tela de cobrança). Pesado (milhares de
 * clientes em lotes de 500) → roda como JOB diário no servidor e grava um
 * snapshot em inadimplencia_mensal_snapshot; a tela só lê o último.
 * O dashboard antigo fazia tudo no navegador e não abria (lista da revenda
 * demora minutos).
 */
import axios from 'axios';
import supabase from '../config/supabase.js';
import { postTotvs } from './bluecardLimite.js';
import { CANAIS, DT_INICIO_PADRAO } from '../routes/cobranca.routes.js';

const TZ = 'America/Sao_Paulo';
const INTERNAL_API_BASE = process.env.INTERNAL_API_BASE || `http://127.0.0.1:${process.env.PORT || 4100}`;
const MES_INICIAL = process.env.INADIMPLENCIA_MES_INICIAL || '2026-02';
const DIAS = Number(process.env.INADIMPLENCIA_DIAS || 60);
const GERAR_HORA = process.env.INADIMPLENCIA_GERAR_HORA || '06:40';
const LOTE_CLIENTES = 500;
const LOTES_SIMULTANEOS = 4;
const DOC_FATURA = 1;
const CLIENTES_TESTE = new Set([3591]);
const TABELA = 'inadimplencia_mensal_snapshot';

const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const addDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fimDoMes = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10);
};
function mesesDesde(inicial, hoje) {
  const out = [];
  let [y, m] = inicial.split('-').map(Number);
  const [hy, hm] = hoje.slice(0, 7).split('-').map(Number);
  while (y < hy || (y === hy && m <= hm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

async function getInterno(path, params = {}, timeout = 15 * 60 * 1000) {
  const r = await axios.get(`${INTERNAL_API_BASE}${path}`, { params, timeout });
  if (r.data?.success === false) throw new Error(r.data?.message || path);
  return r.data;
}

/** Clientes por canal (mesmas rotas da cobrança). Devolve { codigoCanal: Map<code, canal>, avisos }. */
async function clientesPorCanal() {
  const canalDe = new Map();
  const avisos = [];
  for (const c of CANAIS) {
    try {
      const json = await getInterno(c.rota);
      const lista = Array.isArray(json.data) ? json.data : json.data?.codes || json.data?.lista || [];
      let n = 0;
      for (const item of lista) {
        const code = Number(typeof item === 'object' ? item.code : item);
        if (!Number.isFinite(code) || code <= 0 || CLIENTES_TESTE.has(code)) continue;
        if (!canalDe.has(code)) { canalDe.set(code, c.key); n++; }
      }
      if (!n) avisos.push(`${c.key}: lista vazia`);
    } catch (e) {
      avisos.push(`${c.key}: ${e.message}`);
    }
  }
  return { canalDe, avisos };
}

/** Faturas (status normal) dos clientes com vencimento entre dtIni e dtFim — abertas ou pagas. */
async function titulosVencidosAte(codigos, dtIni, dtFim) {
  const lotes = [];
  for (let i = 0; i < codigos.length; i += LOTE_CLIENTES) lotes.push(codigos.slice(i, i + LOTE_CLIENTES));
  const itens = [];
  const avisos = [];
  for (let i = 0; i < lotes.length; i += LOTES_SIMULTANEOS) {
    const grupo = lotes.slice(i, i + LOTES_SIMULTANEOS);
    const rs = await Promise.allSettled(
      grupo.map(async (lote) => {
        const out = [];
        for (let page = 1; page <= 50; page++) {
          const r = await postTotvs('/accounts-receivable/v2/documents/search', {
            filter: { customerCodeList: lote, documentTypeList: [DOC_FATURA], statusList: [1], startExpiredDate: `${dtIni}T00:00:00`, endExpiredDate: `${dtFim}T23:59:59` },
            page,
            pageSize: 200,
          });
          const it = r.data?.items || [];
          out.push(...it);
          if (page >= (r.data?.totalPages || 1) || it.length === 0) break;
        }
        return out;
      }),
    );
    rs.forEach((r, idx) => {
      if (r.status === 'fulfilled') itens.push(...r.value);
      else avisos.push(`lote ${i + idx + 1}/${lotes.length}: ${r.reason?.message}`);
    });
  }
  return { itens, avisos };
}

/** Monta a série mensal. */
export async function calcular() {
  const hoje = hojeBR();
  const meses = mesesDesde(MES_INICIAL, hoje);
  const { canalDe, avisos } = await clientesPorCanal();
  const codigos = [...canalDe.keys()];
  const corteMax = addDias(hoje, -DIAS); // vencimento mais novo que pode contar (mês atual)
  const { itens, avisos: av2 } = await titulosVencidosAte(codigos, DT_INICIO_PADRAO, corteMax);
  avisos.push(...av2);

  const titulos = itens
    .filter((t) => canalDe.has(Number(t.customerCode)))
    .map((t) => ({
      cliente: Number(t.customerCode),
      canal: canalDe.get(Number(t.customerCode)),
      empresa: t.branchCode,
      fatura: t.receivableCode,
      parcela: t.installmentCode ?? 1,
      valor: Number(t.installmentValue) || 0,
      venc: String(t.expiredDate || '').slice(0, 10),
      pago: t.paymentDate ? String(t.paymentDate).slice(0, 10) : null,
    }));

  const serie = meses.map((ym) => {
    const fim = ym === hoje.slice(0, 7) ? hoje : fimDoMes(ym);
    const corte = addDias(fim, -DIAS);
    const dentro = titulos.filter((t) => t.venc && t.venc <= corte && (!t.pago || t.pago > fim));
    const porCanal = {};
    for (const t of dentro) {
      const c = (porCanal[t.canal] ||= { titulos: 0, valor: 0, clientes: new Set() });
      c.titulos++;
      c.valor += t.valor;
      c.clientes.add(t.cliente);
    }
    return {
      mes: ym,
      fim,
      corte,
      titulos: dentro.length,
      valor: r2(dentro.reduce((a, t) => a + t.valor, 0)),
      clientes: new Set(dentro.map((t) => t.cliente)).size,
      por_canal: Object.fromEntries(Object.entries(porCanal).map(([k, v]) => [k, { titulos: v.titulos, valor: r2(v.valor), clientes: v.clientes.size }])),
    };
  });

  // variação mês a mês
  for (let i = 0; i < serie.length; i++) {
    const ant = serie[i - 1];
    serie[i].variacao_valor = ant ? r2(serie[i].valor - ant.valor) : null;
    serie[i].variacao_pct = ant && ant.valor ? r2(((serie[i].valor - ant.valor) / ant.valor) * 100) : null;
  }

  return {
    gerado_em: new Date().toISOString(),
    hoje,
    dias: DIAS,
    mes_inicial: MES_INICIAL,
    clientes_nos_canais: codigos.length,
    titulos_lidos: titulos.length,
    canais: Object.fromEntries(CANAIS.map((c) => [c.key, [...canalDe.values()].filter((v) => v === c.key).length])),
    serie,
    avisos,
  };
}

// ── snapshot ───────────────────────────────────────────────────────────────
let gerando = false;
let ultimoErro = null;

export async function gerarSnapshot() {
  if (gerando) return { ok: false, motivo: 'já está gerando' };
  gerando = true;
  const t0 = Date.now();
  try {
    const dados = await calcular();
    const { error } = await supabase.from(TABELA).insert({ gerado_em: dados.gerado_em, hoje: dados.hoje, dias: dados.dias, dados });
    if (error) throw new Error(`${TABELA}: ${error.message}`);
    ultimoErro = null;
    console.log(`📉 [inadimplência-mensal] snapshot gerado em ${Math.round((Date.now() - t0) / 1000)}s — ${dados.serie.length} meses, ${dados.titulos_lidos} títulos, mês atual R$ ${dados.serie.at(-1)?.valor}`);
    return { ok: true, segundos: Math.round((Date.now() - t0) / 1000), meses: dados.serie.length };
  } catch (e) {
    ultimoErro = e.message;
    console.warn(`⚠️ [inadimplência-mensal] ${e.message}`);
    return { ok: false, motivo: e.message };
  } finally {
    gerando = false;
  }
}

export async function obterUltimo({ refresh = false } = {}) {
  const { data, error } = await supabase.from(TABELA).select('id, gerado_em, hoje, dias, dados').order('gerado_em', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`${TABELA}: ${error.message}`);
  if (refresh && !gerando) gerarSnapshot().catch(() => {});
  const desatualizado = !data || Date.now() - new Date(data.gerado_em).getTime() > 26 * 3600 * 1000;
  if (!data && !gerando) gerarSnapshot().catch(() => {});
  return { ...(data?.dados || { serie: [], avisos: ['ainda não há snapshot — gerando em segundo plano'] }), snapshot_id: data?.id || null, gerando, desatualizado, ultimo_erro: ultimoErro };
}

export function iniciarJobInadimplenciaMensal() {
  const [hh, mm] = GERAR_HORA.split(':').map(Number);
  setTimeout(() => gerarSnapshot().catch(() => {}), 3 * 60 * 1000);
  setInterval(() => {
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
    if (agora.getHours() === hh && agora.getMinutes() === mm) gerarSnapshot().catch(() => {});
  }, 60 * 1000);
  console.log(`📉 [inadimplência-mensal] job: diário às ${GERAR_HORA} (+ na subida)`);
}
