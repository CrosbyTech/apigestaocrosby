/**
 * Snapshot da aba Metas Inadimplência no banco do HeadCoach (João, 04/11/2026).
 *
 * A aba puxava tudo do TOTVS ao vivo (4 listas de clientes + contas a receber
 * em lotes) — lento. Agora o servidor gera um snapshot e guarda no Supabase;
 * a aba lê do banco (rápido). Reprocessa pelo job diário e pelo botão
 * "Atualizar dados" (POST /gerar). As MESMAS regras da aba são aplicadas aqui:
 * só FATURA, sem renegociação (tp_baixa 9) nem abatimento (tp_baixa 17); o
 * a vencer tira pago-antes-do-mês-de-vencimento e a lista FORA_VENCENDO; o
 * pago tira a lista FORA_RECUPERADO (pagamento em mercadoria). Nada é apagado.
 */
import axios from 'axios';
import supabase from '../config/supabase.js';

const INTERNAL = process.env.INTERNAL_API_BASE || `http://127.0.0.1:${process.env.PORT || 4100}`;
const TABELA = 'metas_inadimplencia_snapshot';
const CHAVE = 'geral';
const INTERVALO_MS = Number(process.env.METAS_SNAPSHOT_INTERVALO_MIN || 360) * 60 * 1000; // 6h
const GERAR_HORA = process.env.METAS_SNAPSHOT_HORA || '05:30';

// ── regras iguais à aba MetasInadimplencia.jsx ──────────────────────────────
const mesKey = (d) => (d ? String(d).slice(0, 7) : null);
const mesDe = (d) => String(d || '').slice(0, 7);
const BLC_FORA = new Set([98, 980, 551]);
const filialBlueCard = (e) => { const n = parseInt(e, 10); return Number.isFinite(n) && n < 5999 && !BLC_FORA.has(n); };
const FORA_RECUP = new Set(['101-8445-45685-24', '101-8445-45685-205', '101-45209-12315-3', '101-45209-12315-20', '101-45209-84575-3', '101-45209-84575-4', '101-45209-84575-203', '101-45209-123456-2', '101-45209-123456-3', '101-45209-123456-4', '101-45209-123456-207']);
const FORA_VENC = new Set(['111-4824-734398-1']);
const chaveTit = (i) => `${i.cd_empresa}-${i.cd_cliente}-${i.nr_fatura ?? i.nr_fat}-${i.nr_parcela}`;
const soFatura = (i) => i.tp_documento === 1 || i.tp_documento === '1';
const valeParaMeta = (i) => soFatura(i) && Number(i.tp_baixa) !== 9 && Number(i.tp_baixa) !== 17;
const pagoAntes = (i) => { const l = mesDe(i.dt_liq), v = mesDe(i.dt_vencimento); return !!l && !!v && l < v; };

const primeiroDiaDoMes = (iso) => `${String(iso).slice(0, 7)}-01`;
const ultimoDiaDoMes = (iso) => { const ym = String(iso).slice(0, 7); const [a, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`; };
const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jget(path, params, tent = 5) {
  let ultErro;
  for (let t = 1; t <= tent; t++) {
    try { const r = await axios.get(`${INTERNAL}${path}`, { params, timeout: 150000, validateStatus: (s) => s < 500 }); if (r.status >= 400) throw new Error('HTTP ' + r.status); return r.data; }
    catch (e) { ultErro = e; await sleep(4000 * t); }
  }
  throw ultErro;
}
async function listaCanal(rota) {
  const j = await jget(`/api/totvs/${rota}`);
  const raw = j?.data;
  return Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : (raw?.codes || []).map((code) => ({ code }));
}
async function arLotes(paramsBase, codigos) {
  const LOTE = 500, SIM = 4;
  const lotes = []; for (let i = 0; i < codigos.length; i += LOTE) lotes.push(codigos.slice(i, i + LOTE));
  const itens = [];
  for (let i = 0; i < lotes.length; i += SIM) {
    const grupo = lotes.slice(i, i + SIM);
    const res = await Promise.all(grupo.map(async (lote) => {
      const j = await jget('/api/totvs/accounts-receivable/filter', { ...paramsBase, cd_cliente: lote.join(',') });
      return j?.data?.items || [];
    }));
    res.forEach((a) => itens.push(...a));
  }
  return itens;
}
async function nomesClientes(cods) {
  const nome = {};
  for (let i = 0; i < cods.length; i += 800) {
    const chunk = cods.slice(i, i + 800);
    try {
      const r = await axios.post(`${INTERNAL}/api/totvs/persons/batch-lookup`, { personCodes: chunk }, { timeout: 120000 });
      const data = r.data?.data || {};
      for (const [k, v] of Object.entries(data)) nome[k] = v?.name || v?.fantasyName || '';
    } catch { /* segue sem nome desse lote */ }
  }
  return nome;
}

const CAMPOS = ['cd_empresa', 'cd_cliente', 'nm_cliente', 'nr_fatura', 'nr_fat', 'nr_parcela', 'dt_vencimento', 'dt_liq', 'dt_emissao', 'vl_fatura', 'vl_pago', 'vl_juros', 'tp_baixa', 'tp_documento', 'cd_portador', 'nm_portador', 'tp_cobranca', 'canal'];
const enxuto = (i) => { const o = {}; for (const c of CAMPOS) if (i[c] !== undefined) o[c] = i[c]; return o; };

async function garantirTabela() {
  const ddl = `CREATE TABLE IF NOT EXISTS ${TABELA} (chave text primary key, payload jsonb, gerado_em timestamptz default now()); NOTIFY pgrst, 'reload schema';`;
  let r = await supabase.rpc('exec_sql', { query: ddl });
  if (r.error && /exec_sql\(query\)/.test(r.error.message || '')) r = await supabase.rpc('exec_sql', { sql: ddl });
  if (r.error) throw new Error(`criar ${TABELA}: ${r.error.message}`);
}

let ultima = { em: null, resumo: null, erro: null };
let rodando = false;

export async function gerar({ dtInicio, dtFim } = {}) {
  if (rodando) return { ok: false, motivo: 'já está gerando', ultima };
  rodando = true;
  const t0 = Date.now();
  try {
    const hoje = hojeBR();
    const ini = dtInicio || `${hoje.slice(0, 4)}-01-01`;
    const fim = dtFim || ultimoDiaDoMes(hoje);
    const DT_INI = primeiroDiaDoMes(ini), DT_FIM = ultimoDiaDoMes(fim);

    // 1) canais (precedência FRQ > MTM > REV > BLC)
    const fontes = [['FRQ', 'franchise-clients'], ['MTM', 'multibrand-clients'], ['REV', 'reseller-clients'], ['BLC', 'bluecred/clientes']];
    const canalDoCliente = {};
    const canaisFora = [];
    for (const [canal, rota] of fontes) {
      try { const lista = await listaCanal(rota); for (const c of lista) { const k = String(c.code); if (!canalDoCliente[k]) canalDoCliente[k] = canal; } }
      catch { canaisFora.push(canal); }
    }
    const codigos = Object.keys(canalDoCliente);
    if (!codigos.length) throw new Error('nenhum cliente de canal (todas as listas falharam)');

    // 2) contas a receber
    const vencRaw = await arLotes({ dt_inicio: DT_INI, dt_fim: DT_FIM, modo: 'vencimento', situacao: '1', tp_documento: '1' }, codigos);
    const pagosRaw = await arLotes({ dt_inicio: DT_INI, dt_fim: DT_FIM, modo: 'pagamento', situacao: '1', status: 'Pago', tp_documento: '1' }, codigos);

    const marcar = (i) => ({ ...i, canal: canalDoCliente[String(i.cd_cliente).trim()] || '' });
    const filialOk = (i) => i.canal !== 'BLC' || filialBlueCard(i.cd_empresa);

    const vencendo = vencRaw.map(marcar).filter((i) => valeParaMeta(i) && filialOk(i) && !pagoAntes(i) && !FORA_VENC.has(chaveTit(i))).map(enxuto);
    const pagos = pagosRaw.map(marcar).filter((i) => valeParaMeta(i) && filialOk(i) && !FORA_RECUP.has(chaveTit(i))).map(enxuto);

    // 3) nomes
    const cods = [...new Set([...vencendo, ...pagos].map((i) => Number(i.cd_cliente)).filter(Boolean))];
    const pessoas = await nomesClientes(cods);

    const totVenc = vencendo.reduce((s, i) => s + (Number(i.vl_fatura) || 0), 0);
    const totPago = pagos.reduce((s, i) => s + (Number(i.vl_pago) || Number(i.vl_fatura) || 0), 0);

    const payload = {
      gerado_em: new Date().toISOString(),
      periodo: { inicio: DT_INI, fim: DT_FIM },
      canais_fora: canaisFora,
      totais: { aVencer: Math.round(totVenc * 100) / 100, pago: Math.round(totPago * 100) / 100, qtdVencendo: vencendo.length, qtdPagos: pagos.length },
      vencendo,
      pagos,
      pessoas,
    };
    await garantirTabela();
    const { error } = await supabase.from(TABELA).upsert({ chave: CHAVE, payload, gerado_em: new Date().toISOString() }, { onConflict: 'chave' });
    if (error) throw new Error(`upsert ${TABELA}: ${error.message}`);

    const resumo = { ...payload.totais, canais_fora: canaisFora, segundos: Math.round((Date.now() - t0) / 1000) };
    ultima = { em: new Date().toISOString(), resumo, erro: null };
    return { ok: true, ...resumo };
  } catch (e) {
    ultima = { em: new Date().toISOString(), resumo: null, erro: e.message };
    console.warn(`⚠️ [metas-snapshot] ${e.message}`);
    return { ok: false, motivo: e.message };
  } finally {
    rodando = false;
  }
}

export async function obter() {
  const { data, error } = await supabase.from(TABELA).select('payload, gerado_em').eq('chave', CHAVE).maybeSingle();
  if (error && !/does not exist|schema cache/i.test(error.message || '')) throw new Error(error.message);
  return data?.payload || null;
}

export function status() {
  return { tabela: TABELA, intervalo_min: INTERVALO_MS / 60000, hora_job: GERAR_HORA, rodando, ultima };
}

export function iniciarJobMetasSnapshot() {
  if (String(process.env.METAS_SNAPSHOT_JOB || 'on').toLowerCase() === 'off') {
    console.log('ℹ️ [metas-snapshot] job desligado (METAS_SNAPSHOT_JOB=off)');
    return;
  }
  // 1ª geração 3 min após subir, se ainda não houver snapshot; depois a cada INTERVALO
  setTimeout(async () => {
    try { const atual = await obter(); if (!atual) { console.log('💠 [metas-snapshot] sem snapshot — gerando 1ª vez'); await gerar(); } }
    catch { /* ignora */ }
  }, 3 * 60 * 1000);
  setInterval(() => { gerar().catch(() => {}); }, INTERVALO_MS);
  console.log(`💠 [metas-snapshot] job ligado: a cada ${INTERVALO_MS / 60000} min`);
}
