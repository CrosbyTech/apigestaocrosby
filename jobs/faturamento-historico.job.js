/**
 * Job: popula `faturamento_diario_canal` automaticamente a partir do mesmo
 * endpoint que o Forecast → Promessa Mensal usa hoje (/api/crm/faturamento-por-segmento).
 *
 * Garante que os números do histórico = números que aparecem no Forecast.
 *
 * Cron diário às 03:00 BRT processa o D-1 (ontem). Para backfill manual de
 * um range, usar `popularRangeFaturamento({ datemin, datemax })`.
 *
 * Canais quantitativos (bluecard) ficam de fora — esse endpoint não cobre.
 */
import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';

const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE || `http://localhost:${process.env.PORT || 4100}`;

// Canais que o fat-seg cobre (mesma chave usada em faturamento_diario_canal).
// bluecard é quantitativo — fica fora.
const CANAIS_FAT_SEG = [
  'varejo', 'revenda', 'multimarcas',
  'inbound_david', 'inbound_rafael',
  'franquia', 'bazar', 'fabrica',
  'business', 'ricardoeletro',
];

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chama /api/crm/faturamento-por-segmento e retorna o `segmentos` (líquido).
 */
async function fetchFatSeg(date) {
  const url = `${INTERNAL_API_BASE}/api/crm/faturamento-por-segmento`;
  const r = await axios.post(
    url,
    { datemin: date, datemax: date },
    { timeout: 300000 },
  );
  const data = r.data?.data || r.data;
  return data?.segmentos || {};
}

/**
 * Popula 1 dia em faturamento_diario_canal a partir de /faturamento-por-segmento.
 * Retorna { date, canais_salvos, total }.
 */
export async function popularDiaFaturamento(date, { origem = 'auto-cron', atualizado_por = null } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new Error(`data inválida: ${date}`);
  }
  const segmentos = await fetchFatSeg(date);

  const rows = [];
  for (const canal of CANAIS_FAT_SEG) {
    const valor = Number(segmentos[canal] || 0);
    // Só insere/atualiza se TEM valor (evita sujar a tabela com 0s)
    if (valor <= 0) continue;
    rows.push({
      data: date,
      canal,
      valor: Math.round(valor * 100) / 100,
      origem,
      observacao: `Auto via /faturamento-por-segmento`,
      atualizado_em: new Date().toISOString(),
      atualizado_por,
    });
  }

  if (!rows.length) {
    return { date, canais_salvos: 0, total: 0, segmentos };
  }
  const { error } = await supabase
    .from('faturamento_diario_canal')
    .upsert(rows, { onConflict: 'data,canal' });
  if (error) throw error;

  const total = rows.reduce((s, r) => s + r.valor, 0);
  return { date, canais_salvos: rows.length, total: Math.round(total * 100) / 100, segmentos };
}

/**
 * Itera dias de [datemin, datemax] e popula um por um.
 * Sequencial pra não martelar TOTVS (fat-seg é pesado).
 * Aceita callback `onProgress` que recebe { idx, total, day, result }.
 */
export async function popularRangeFaturamento(
  { datemin, datemax, origem = 'manual-backfill', onProgress, gapMs = 250 } = {},
) {
  const start = new Date(datemin + 'T00:00:00Z');
  const end = new Date(datemax + 'T00:00:00Z');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('datas inválidas');
  }
  const dias = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dias.push(d.toISOString().slice(0, 10));
  }
  const out = { processados: 0, salvos: 0, erros: [] };
  for (let i = 0; i < dias.length; i++) {
    const day = dias[i];
    try {
      const r = await popularDiaFaturamento(day, { origem });
      out.salvos += r.canais_salvos;
      out.processados += 1;
      if (onProgress) onProgress({ idx: i + 1, total: dias.length, day, result: r });
    } catch (e) {
      out.erros.push({ day, motivo: e.message });
      console.error(`[faturamento-historico] ${day} falhou: ${e.message}`);
    }
    if (gapMs > 0 && i < dias.length - 1) await SLEEP(gapMs);
  }
  return out;
}

// ─── Cron diário ─────────────────────────────────────────────────────────────
let agendado = false;
export function iniciarFaturamentoHistoricoJob() {
  if (agendado) return;
  agendado = true;
  // 03:00 BRT — depois do faturamento-diario (01:30) já ter rodado
  cron.schedule(
    '0 3 * * *',
    async () => {
      try {
        const hoje = new Date();
        const ontem = new Date(hoje);
        ontem.setUTCDate(ontem.getUTCDate() - 1);
        const dateIso = ontem.toISOString().slice(0, 10);
        console.log(`[faturamento-historico] cron 03:00 → populando ${dateIso}`);
        const r = await popularDiaFaturamento(dateIso, { origem: 'auto-cron' });
        console.log(`[faturamento-historico] ✓ ${dateIso} salvo: ${r.canais_salvos} canais, R$ ${r.total.toFixed(2)}`);
      } catch (e) {
        console.error('[faturamento-historico] cron falhou:', e.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log('[faturamento-historico] cron agendado: 03:00 BRT diário');
}
