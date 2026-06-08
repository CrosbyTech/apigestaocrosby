/**
 * Job: snapshot histórico do realizado por canal × período.
 *
 *   - Mensal:  todo dia 2 às 04:00 BRT → congela o mês ANTERIOR
 *   - Semanal: toda segunda às 04:15 BRT → congela a semana ANTERIOR (ISO)
 *
 * O snapshot é foto IMUTÁVEL: o valor que existia naquele momento.
 * Se TOTVS reabrir uma NF retroativa depois, o snapshot não muda.
 *
 * Função `snapshotMensal({ ano, mes })` e `snapshotSemanal({ ano, semana })`
 * podem ser chamadas manualmente via endpoint pra popular meses/semanas passados.
 */
import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';

const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE || `http://localhost:${process.env.PORT || 8080}`;

// ─── Helpers ISO week ─────────────────────────────────────────────────────────
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { ano: d.getUTCFullYear(), semana: weekNo };
}

function isoWeekStartEnd(ano, semana) {
  // Segunda da semana ISO `ano-W{semana}`
  const simple = new Date(Date.UTC(ano, 0, 1 + (semana - 1) * 7));
  const dow = simple.getUTCDay();
  const monday = new Date(simple);
  if (dow <= 4) {
    monday.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  } else {
    monday.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  }
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

// ─── Núcleo: chama /promessa-mensal e /promessa-semanal e salva ──────────────
async function fetchInternal(path) {
  const r = await axios.get(`${INTERNAL_API_BASE}/api/forecast${path}`, {
    timeout: 240000,
  });
  return r.data?.data || r.data;
}

async function persistir(rows) {
  if (!rows.length) return 0;
  // upsert via unique (canal, period_type, period_key)
  const { error } = await supabase
    .from('forecast_realizado_snapshot')
    .upsert(rows, { onConflict: 'canal,period_type,period_key' });
  if (error) throw error;
  return rows.length;
}

/**
 * Congela mês completo (todos os canais).
 */
export async function snapshotMensal({ ano, mes, origem = 'auto-cron' } = {}) {
  const hoje = new Date();
  ano = Number(ano) || hoje.getUTCFullYear();
  mes = Number(mes) || hoje.getUTCMonth() + 1;
  const periodKey = `${ano}-${String(mes).padStart(2, '0')}`;
  const lastDay = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const periodStart = `${periodKey}-01`;
  const periodEnd = `${periodKey}-${String(lastDay).padStart(2, '0')}`;

  console.log(`[forecast-snapshot] mensal ${periodKey} (origem=${origem})…`);
  const d = await fetchInternal(`/promessa-mensal?ano=${ano}&mes=${mes}`);
  const canais = d?.canais || [];
  const rows = canais
    .filter((c) => c?.canal)
    .map((c) => ({
      canal: c.canal,
      period_type: 'mensal',
      period_key: periodKey,
      period_start: periodStart,
      period_end: periodEnd,
      valor: Number(c.real_acumulado || 0),
      meta: c.forecast_mensal != null ? Number(c.forecast_mensal) : null,
      origem,
      fechado_em: new Date().toISOString(),
    }));
  const n = await persistir(rows);
  console.log(`[forecast-snapshot] mensal ${periodKey} ✓ ${n} canais salvos`);
  return { period_key: periodKey, canais_salvos: n };
}

/**
 * Congela semana ISO completa (todos os canais).
 */
export async function snapshotSemanal({ ano, semana, origem = 'auto-cron' } = {}) {
  const hoje = new Date();
  if (!ano || !semana) {
    const cur = isoWeek(hoje);
    ano = ano || cur.ano;
    semana = semana || cur.semana;
  }
  ano = Number(ano);
  semana = Number(semana);
  const periodKey = `${ano}-W${String(semana).padStart(2, '0')}`;
  const { start, end } = isoWeekStartEnd(ano, semana);

  console.log(`[forecast-snapshot] semanal ${periodKey} (origem=${origem})…`);
  const d = await fetchInternal(`/promessa-semanal?ano=${ano}&semana=${semana}`);
  const canais = d?.canais || [];
  const rows = canais
    .filter((c) => c?.canal)
    .map((c) => ({
      canal: c.canal,
      period_type: 'semanal',
      period_key: periodKey,
      period_start: start,
      period_end: end,
      valor: Number(c.real_acumulado || 0),
      meta: c.forecast_semanal != null ? Number(c.forecast_semanal) : null,
      origem,
      fechado_em: new Date().toISOString(),
    }));
  const n = await persistir(rows);
  console.log(`[forecast-snapshot] semanal ${periodKey} ✓ ${n} canais salvos`);
  return { period_key: periodKey, canais_salvos: n };
}

// ─── Cron schedulers ─────────────────────────────────────────────────────────
let agendado = false;
export function iniciarForecastSnapshotJob() {
  if (agendado) return;
  agendado = true;

  // Dia 2 às 04:00 BRT → congela mês anterior
  cron.schedule(
    '0 4 2 * *',
    async () => {
      try {
        const hoje = new Date();
        let ano = hoje.getUTCFullYear();
        let mes = hoje.getUTCMonth(); // mês anterior (getMonth é 0-based, então atual-1)
        if (mes === 0) {
          mes = 12;
          ano = ano - 1;
        }
        await snapshotMensal({ ano, mes, origem: 'auto-cron' });
      } catch (e) {
        console.error('[forecast-snapshot] cron mensal falhou:', e.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );

  // Segunda às 04:15 BRT → congela semana anterior
  cron.schedule(
    '15 4 * * 1',
    async () => {
      try {
        const hoje = new Date();
        const ontem = new Date(hoje);
        ontem.setUTCDate(hoje.getUTCDate() - 1);
        const { ano, semana } = isoWeek(ontem);
        await snapshotSemanal({ ano, semana, origem: 'auto-cron' });
      } catch (e) {
        console.error('[forecast-snapshot] cron semanal falhou:', e.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );

  console.log(
    '[forecast-snapshot] cron agendado: mensal=dia 2 04:00 BRT, semanal=seg 04:15 BRT',
  );
}
