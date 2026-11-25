// ============================================================================
// INADIMPLÊNCIA MTM › VENDA x INADIMPLÊNCIA POR VENDEDOR (João/BRUCE, 25/11/2026)
//
// Antes o painel (Inadimplência MTM › Dashboard) buscava o faturado de cada
// vendedor no TOTVS a cada abertura de tela — travava e o total vinha R$ 0,00.
// Agora a API APURA e GRAVA a foto da semana em `inad_snapshot`; o painel só lê.
//
// Por vendedor (desde a data de entrada dele até a apuração):
//   faturado            TOTVS + HeadCoach (Faturamento, Brejinho e PDV Crosby),
//                       pela mesma rota do Painel de Vendas (meses fechados do
//                       banco faturamento_vendedor_mensal, mês aberto ao vivo)
//   inadimplencia_60d   saldo vencido dos clientes MULTIMARCAS do vendedor cujo
//                       maior atraso passa de 60 dias (mesma regra que a tela
//                       usava: o cliente inteiro entra quando passa de 60 dias)
//   carteira_vencida    todo o saldo vencido dos clientes dele (informativo)
//   clientes            clientes distintos com título vencido
// Cliente dividido entre dois vendedores ("WALTER/ RAFAEL") é rateado.
//
// Ajustes manuais (inad_ajustes): somam no valor do sistema sem sobrescrevê-lo.
// O ajuste vale da semana em que foi lançado em diante (o faturado é acumulado
// desde a entrada do vendedor, então a correção continua valendo).
//   faturado_final      = faturado + Σ ajustes FATURADO
//   inadimplencia_final = inadimplencia_60d + Σ ajustes INADIMPLENCIA
//   pct                 = inadimplencia_final / faturado_final * 100 (4 casas)
//                         faturado_final <= 0 → NULL ("sem faturamento")
// Total de um grupo: Σ inadimplência / Σ faturado (média ponderada).
//
// Foto: uma linha por vendedor e semana (semana_ref = segunda-feira). A
// apuração da semana em curso pode ser refeita e substitui a da própria semana.
// Se algum vendedor vier com faturado zerado/nulo, NADA é gravado (erro), para
// não registrar a foto com R$ 0,00 — o job tenta de novo.
// ============================================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { faturamentoPorVendedorJanelas } from './faturamentoVendedorMensal.js';
import { vendasHeadcoachParaForecast } from './hcVendasForecast.js';

const TZ = 'America/Sao_Paulo';
const INTERNAL_API_BASE = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 4100}`;

// Os cinco vendedores do MTM e a data de entrada de cada um (o painel mostra
// sempre os cinco; Walter e Renato foram desligados mas a carteira continua).
export const VENDEDORES_MTM = [
  { chave: 'RAFAEL', code: 21, nome: 'RAFAEL ARAUJO', desde: '2025-03-10', ativo: true },
  { chave: 'DAVID', code: 26, nome: 'DAVID ALMEIDA', desde: '2025-12-01', ativo: true },
  { chave: 'RENATO', code: 65, nome: 'RENATO', desde: '2025-06-01', ativo: false },
  { chave: 'WALTER', code: 177, nome: 'WALTER MULTIMARCAS', desde: '2025-01-01', ativo: false },
  { chave: 'ARTHUR', code: 259, nome: 'ARTHUR BARBOSA', desde: '2026-01-01', ativo: true },
];
const CHAVES = new Set(VENDEDORES_MTM.map((v) => v.chave));

export class InadMtmError extends Error {
  constructor(message, code = 'INAD_MTM', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r4 = (v) => Math.round((Number(v) || 0) * 10000) / 10000;
export const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

/** Segunda-feira da semana do dia (YYYY-MM-DD). */
export function semanaDe(iso = hojeISO()) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = domingo
  dt.setUTCDate(dt.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return dt.toISOString().slice(0, 10);
}
const somarDias = (iso, dias) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
};
const diasEntre = (deIso, ateIso) => {
  const [y1, m1, d1] = String(deIso).slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = String(ateIso).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
};

/** Vendedores citados no texto livre do representante ("WALTER/ RAFAEL" → 2). */
const vendedoresDoTexto = (texto) => [
  ...new Set(
    String(texto || '')
      .toUpperCase()
      .split(/[^A-ZÀ-Ÿ]+/)
      .filter((t) => CHAVES.has(t)),
  ),
];

const totvs = (rota, opts = {}) => axios({ url: `${INTERNAL_API_BASE}/api/totvs/${rota}`, timeout: 600_000, ...opts }).then((r) => r.data);

// ─── Inadimplência por vendedor (TOTVS: títulos vencidos dos multimarcas) ────
async function inadimplenciaPorVendedor(hoje) {
  const mm = await totvs('multibrand-clients');
  const multimarcas = mm?.data || [];
  if (!multimarcas.length) throw new InadMtmError('O TOTVS não devolveu os clientes multimarcas', 'SEM_MULTIMARCAS', 502);
  const nomes = new Map(multimarcas.map((m) => [String(m.code), m.name || m.fantasyName || null]));

  const params = new URLSearchParams({
    dt_inicio: '2024-01-01',
    dt_fim: hoje,
    modo: 'vencimento',
    situacao: '1',
    status: 'Vencido',
    cd_cliente: multimarcas.map((m) => m.code).join(','),
  });
  const ar = await totvs(`accounts-receivable/filter?${params}`);
  const faturas = (ar?.data?.items || []).filter((i) => String(i.tp_documento) === '1');

  // representante de cada cliente: mesma leitura da tela (a última linha lida vale)
  const { data: classif, error } = await supabase
    .from('classificacoes_inadimplentes')
    .select('cd_cliente, representante, data_alteracao')
    .order('data_alteracao', { ascending: false });
  if (error) throw new InadMtmError(`classificações: ${error.message}`, 'DB_ERROR', 500);
  const rep = {};
  for (const c of classif || []) if (c.representante) rep[c.cd_cliente] = c.representante;

  // agrupa por cliente
  const clientes = new Map();
  for (const f of faturas) {
    const cd = String(f.cd_cliente);
    if (!clientes.has(cd)) clientes.set(cd, { cd_cliente: cd, nome: f.nm_cliente || nomes.get(cd) || `Cliente ${cd}`, valor: 0, dias: 0 });
    const c = clientes.get(cd);
    c.valor += parseFloat(f.vl_fatura) || 0;
    if (f.dt_vencimento) c.dias = Math.max(c.dias, diasEntre(f.dt_vencimento, hoje));
  }

  const porVendedor = new Map(VENDEDORES_MTM.map((v) => [v.chave, { inad: 0, carteira: 0, clientes: 0, lista: [] }]));
  for (const c of clientes.values()) {
    const alvos = vendedoresDoTexto(rep[c.cd_cliente] ?? rep[Number(c.cd_cliente)]);
    if (!alvos.length) continue;
    const fatia = 1 / alvos.length;
    for (const chave of alvos) {
      const v = porVendedor.get(chave);
      v.carteira += c.valor * fatia;
      v.clientes += fatia;
      if (c.dias > 60) {
        v.inad += c.valor * fatia;
        v.lista.push({ cd_cliente: c.cd_cliente, nome: c.nome, valor: r2(c.valor * fatia), dias: c.dias, rateado: fatia < 1 });
      }
    }
  }
  return { porVendedor, totalFaturas: faturas.length };
}

// ─── Parte do HeadCoach no faturado (João, 25/11/2026) ───────────────────────
// Mesmas vendas que o faturamento por vendedor soma do HeadCoach (atacado e
// Brejinho, sem CREDEV), na janela de cada vendedor. A parte do TOTVS é o resto.
async function headcoachPorVendedor(hoje) {
  const dmin = VENDEDORES_MTM.reduce((m, v) => (v.desde < m ? v.desde : m), VENDEDORES_MTM[0].desde);
  const hc = await vendasHeadcoachParaForecast({ dmin, dmax: hoje });
  const vendas = [...(hc.atacado || []), ...(hc.brejinho || [])];
  const m = new Map();
  for (const v of VENDEDORES_MTM) {
    const soma = vendas.filter((x) => Number(x.vendedor_code) === v.code && String(x.data) >= v.desde && String(x.data) <= hoje).reduce((s, x) => s + (Number(x.valor) || 0), 0);
    m.set(v.code, r2(soma));
  }
  return m;
}

// ─── Ajustes ─────────────────────────────────────────────────────────────────
/** Σ dos ajustes válidos até a semana (inclusive), por vendedor e tipo. */
async function somaAjustes(semana) {
  const { data, error } = await supabase.from('inad_ajustes').select('vendedor_cod, tipo, valor').lte('semana_ref', semana).is('excluido_em', null);
  if (error) throw new InadMtmError(`ajustes: ${error.message}`, 'DB_ERROR', 500);
  const m = new Map();
  for (const a of data || []) {
    const k = Number(a.vendedor_cod);
    if (!m.has(k)) m.set(k, { FATURADO: 0, INADIMPLENCIA: 0 });
    m.get(k)[a.tipo] += Number(a.valor) || 0;
  }
  return m;
}

export function calcularLinha({ faturado, inadimplencia60d, ajusteFaturado = 0, ajusteInadimplencia = 0 }) {
  const faturadoFinal = r2(Number(faturado) + Number(ajusteFaturado));
  const inadFinal = r2(Number(inadimplencia60d) + Number(ajusteInadimplencia));
  return {
    faturado_final: faturadoFinal,
    inadimplencia_final: inadFinal,
    pct_inadimplencia: faturadoFinal > 0 ? r4((inadFinal / faturadoFinal) * 100) : null,
  };
}

/** Média ponderada de um grupo de linhas. */
export function totalPonderado(linhas) {
  const fat = r2(linhas.reduce((s, l) => s + (Number(l.faturado_final) || 0), 0));
  const inad = r2(linhas.reduce((s, l) => s + (Number(l.inadimplencia_final) || 0), 0));
  return { faturado_final: fat, inadimplencia_final: inad, pct_inadimplencia: fat > 0 ? r4((inad / fat) * 100) : null };
}

// ─── Apuração ────────────────────────────────────────────────────────────────
/**
 * Apura a semana de hoje e grava a foto (gravar=false só calcula).
 * Lança InadMtmError('FATURADO_ZERADO') sem gravar nada se algum vendedor vier zerado.
 */
export async function apurar({ gravar = true, origem = 'job', hoje = hojeISO() } = {}) {
  const semana = semanaDe(hoje);
  const t0 = Date.now();
  const [fat, inad, ajustes, hcPorCod] = await Promise.all([
    faturamentoPorVendedorJanelas(VENDEDORES_MTM.map((v) => ({ seller_code: v.code, datemin: v.desde })), hoje),
    inadimplenciaPorVendedor(hoje),
    somaAjustes(semana),
    headcoachPorVendedor(hoje),
  ]);
  const fatPorCod = new Map((fat.vendedores || []).map((v) => [Number(v.seller_code), v]));

  const zerados = VENDEDORES_MTM.filter((v) => !(Number(fatPorCod.get(v.code)?.valor) > 0));
  if (zerados.length) {
    throw new InadMtmError(`Faturado veio zerado para ${zerados.map((v) => v.chave).join(', ')}: a foto NÃO foi gravada. Tente de novo em alguns minutos.`, 'FATURADO_ZERADO', 502);
  }

  const agora = new Date().toISOString();
  const linhas = VENDEDORES_MTM.map((v) => {
    const i = inad.porVendedor.get(v.chave);
    const aj = ajustes.get(v.code) || { FATURADO: 0, INADIMPLENCIA: 0 };
    const base = {
      vendedor_cod: v.code,
      vendedor_nome: v.nome,
      semana_ref: semana,
      data_apuracao: agora,
      desde: v.desde,
      faturado: r2(fatPorCod.get(v.code).valor),
      faturado_headcoach: hcPorCod.get(v.code) || 0,
      faturado_totvs: r2(fatPorCod.get(v.code).valor - (hcPorCod.get(v.code) || 0)),
      inadimplencia_60d: r2(i.inad),
      ajuste_faturado: r2(aj.FATURADO),
      ajuste_inadimplencia: r2(aj.INADIMPLENCIA),
      carteira_vencida: r2(i.carteira),
      clientes: Math.round(i.clientes),
      clientes_inadimplentes: i.lista.sort((a, b) => b.valor - a.valor),
      origem,
    };
    return { ...base, ...calcularLinha({ faturado: base.faturado, inadimplencia60d: base.inadimplencia_60d, ajusteFaturado: base.ajuste_faturado, ajusteInadimplencia: base.ajuste_inadimplencia }) };
  });

  if (gravar) {
    const { error } = await supabase.from('inad_snapshot').upsert(linhas, { onConflict: 'vendedor_cod,semana_ref' });
    if (error) throw new InadMtmError(`gravar foto: ${error.message}`, 'DB_ERROR', 500);
  }
  return { semana, linhas, tempoMs: Date.now() - t0, consultasTotvs: fat.consultas_totvs, faturasVencidas: inad.totalFaturas };
}

// ─── Leitura do painel ───────────────────────────────────────────────────────
const diff = (a, b) => (a == null || b == null ? null : r4(Number(a) - Number(b)));

/** Foto mais recente e a da semana anterior, com variação e totais. */
export async function painel() {
  const { data: semanas, error } = await supabase.from('inad_snapshot').select('semana_ref').order('semana_ref', { ascending: false }).limit(50);
  if (error) throw new InadMtmError(`ler foto: ${error.message}`, 'DB_ERROR', 500);
  const distintas = [...new Set((semanas || []).map((s) => s.semana_ref))];
  const [atual, anterior] = distintas;
  if (!atual) return { semana: null, semanaAnterior: null, vendedores: [], totais: null };

  const { data: fotos, error: e2 } = await supabase.from('inad_snapshot').select('*').in('semana_ref', [atual, anterior].filter(Boolean));
  if (e2) throw new InadMtmError(`ler foto: ${e2.message}`, 'DB_ERROR', 500);
  const de = (semana, cod) => (fotos || []).find((f) => f.semana_ref === semana && Number(f.vendedor_cod) === cod) || null;

  const vendedores = VENDEDORES_MTM.map((v) => {
    const a = de(atual, v.code);
    const p = anterior ? de(anterior, v.code) : null;
    return {
      ...v,
      atual: a,
      anterior: p ? { pct_inadimplencia: p.pct_inadimplencia, faturado_final: p.faturado_final, inadimplencia_final: p.inadimplencia_final } : null,
      variacao: a && p ? { pp: diff(a.pct_inadimplencia, p.pct_inadimplencia), inadimplencia: diff(a.inadimplencia_final, p.inadimplencia_final), faturado: diff(a.faturado_final, p.faturado_final) } : null,
    };
  });

  const grupo = (lista, semana) => totalPonderado(lista.map((v) => de(semana, v.code)).filter(Boolean));
  const totalCom = (lista) => {
    const a = grupo(lista, atual);
    const p = anterior ? grupo(lista, anterior) : null;
    const carteira = r2(lista.reduce((s, v) => s + (Number(de(atual, v.code)?.carteira_vencida) || 0), 0));
    const clientes = lista.reduce((s, v) => s + (Number(de(atual, v.code)?.clientes) || 0), 0);
    const somaCampo = (campo) => {
      const vals = lista.map((v) => de(atual, v.code)?.[campo]);
      return vals.some((x) => x == null) ? null : r2(vals.reduce((s, x) => s + Number(x), 0));
    };
    return {
      ...a,
      faturado_totvs: somaCampo('faturado_totvs'),
      faturado_headcoach: somaCampo('faturado_headcoach'),
      carteira_vencida: carteira,
      clientes,
      anterior: p,
      variacao: p ? { pp: diff(a.pct_inadimplencia, p.pct_inadimplencia), inadimplencia: diff(a.inadimplencia_final, p.inadimplencia_final), faturado: diff(a.faturado_final, p.faturado_final) } : null,
    };
  };
  const apuradoEm = (fotos || []).filter((f) => f.semana_ref === atual).reduce((m, f) => (f.data_apuracao > m ? f.data_apuracao : m), '');
  return {
    semana: atual,
    semanaAnterior: anterior || null,
    apuradoEm: apuradoEm || null,
    vendedores,
    // principais (ativos) e outros separados (João, 25/11): cada grupo com o seu total ponderado
    totais: {
      ativos: { ...totalCom(VENDEDORES_MTM.filter((v) => v.ativo)), rotulo: VENDEDORES_MTM.filter((v) => v.ativo).map((v) => v.chave).join(' + ') },
      outros: { ...totalCom(VENDEDORES_MTM.filter((v) => !v.ativo)), rotulo: VENDEDORES_MTM.filter((v) => !v.ativo).map((v) => v.chave).join(' + ') },
      geral: totalCom(VENDEDORES_MTM),
    },
  };
}

// ─── Ajustes (lançar / listar / excluir) ─────────────────────────────────────
export async function listarAjustes({ semana } = {}) {
  let q = supabase.from('inad_ajustes').select('*').is('excluido_em', null).order('criado_em', { ascending: false }).limit(200);
  if (semana) q = q.lte('semana_ref', semana);
  const { data, error } = await q;
  if (error) throw new InadMtmError(`ajustes: ${error.message}`, 'DB_ERROR', 500);
  return data || [];
}

export async function lancarAjuste({ vendedorCod, tipo, valor, motivo, semana, usuario }) {
  const v = VENDEDORES_MTM.find((x) => x.code === Number(vendedorCod));
  if (!v) throw new InadMtmError('Vendedor inválido', 'VENDEDOR');
  if (!['FATURADO', 'INADIMPLENCIA'].includes(tipo)) throw new InadMtmError('Tipo deve ser FATURADO ou INADIMPLENCIA', 'TIPO');
  const n = r2(valor);
  if (!n) throw new InadMtmError('Informe o valor do ajuste (positivo ou negativo)', 'VALOR');
  if (String(motivo || '').trim().length < 5) throw new InadMtmError('Escreva o motivo do ajuste', 'MOTIVO');
  const reg = { vendedor_cod: v.code, tipo, valor: n, motivo: String(motivo).trim(), semana_ref: semanaDe(semana || hojeISO()), usuario: usuario || null };
  const { data, error } = await supabase.from('inad_ajustes').insert(reg).select('*').single();
  if (error) throw new InadMtmError(`gravar ajuste: ${error.message}`, 'DB_ERROR', 500);
  return data;
}

export async function excluirAjuste(id, usuario) {
  const { data, error } = await supabase.from('inad_ajustes').update({ excluido_em: new Date().toISOString(), excluido_por: usuario || null }).eq('id', Number(id)).is('excluido_em', null).select('*').maybeSingle();
  if (error) throw new InadMtmError(`excluir ajuste: ${error.message}`, 'DB_ERROR', 500);
  if (!data) throw new InadMtmError('Ajuste não encontrado (ou já excluído)', 'NOT_FOUND', 404);
  return data;
}

/**
 * Reaplica os ajustes na foto da semana mais recente (sem ir ao TOTVS): usado
 * logo depois de lançar/excluir um ajuste, para o painel mostrar na hora.
 */
export async function reaplicarAjustes() {
  const { data: ult } = await supabase.from('inad_snapshot').select('semana_ref').order('semana_ref', { ascending: false }).limit(1);
  const semana = ult?.[0]?.semana_ref;
  if (!semana) return { semana: null, atualizadas: 0 };
  const [{ data: fotos, error }, ajustes] = await Promise.all([supabase.from('inad_snapshot').select('*').eq('semana_ref', semana), somaAjustes(semana)]);
  if (error) throw new InadMtmError(`ler foto: ${error.message}`, 'DB_ERROR', 500);
  const linhas = (fotos || []).map((f) => {
    const aj = ajustes.get(Number(f.vendedor_cod)) || { FATURADO: 0, INADIMPLENCIA: 0 };
    const { id, ...resto } = f;
    return {
      ...resto,
      ajuste_faturado: r2(aj.FATURADO),
      ajuste_inadimplencia: r2(aj.INADIMPLENCIA),
      ...calcularLinha({ faturado: f.faturado, inadimplencia60d: f.inadimplencia_60d, ajusteFaturado: aj.FATURADO, ajusteInadimplencia: aj.INADIMPLENCIA }),
    };
  });
  if (linhas.length) {
    const { error: e2 } = await supabase.from('inad_snapshot').upsert(linhas, { onConflict: 'vendedor_cod,semana_ref' });
    if (e2) throw new InadMtmError(`gravar foto: ${e2.message}`, 'DB_ERROR', 500);
  }
  return { semana, atualizadas: linhas.length };
}

// ─── Apuração em segundo plano (o botão Atualizar do painel) ─────────────────
const estado = { rodando: false, inicio: null, fim: null, erro: null, ultimoResultado: null };
export const statusApuracao = () => ({ ...estado });

/** Dispara a apuração sem esperar (a consulta ao TOTVS pode levar minutos). */
export function apurarEmSegundoPlano(origem) {
  if (estado.rodando) return { jaRodando: true, ...statusApuracao() };
  Object.assign(estado, { rodando: true, inicio: new Date().toISOString(), fim: null, erro: null });
  apurar({ origem })
    .then((r) => {
      estado.ultimoResultado = { semana: r.semana, tempoMs: r.tempoMs };
      console.log(`📊 [inad-mtm] foto da semana ${r.semana} gravada (${origem}) em ${Math.round(r.tempoMs / 1000)} s`);
    })
    .catch((e) => {
      estado.erro = e.message;
      console.error(`❌ [inad-mtm] apuração (${origem}) falhou: ${e.message}`);
    })
    .finally(() => {
      estado.rodando = false;
      estado.fim = new Date().toISOString();
    });
  return { jaRodando: false, ...statusApuracao() };
}

export { somarDias };
