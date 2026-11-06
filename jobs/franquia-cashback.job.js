// ─────────────────────────────────────────────────────────────────────────
// Franquia Cashback (Fase 2) — credita automaticamente o cashback de 20% das
// vendas de franquia (ops 9009/9063) que hoje não passam pelo PDV Varejo.
//
// Chama o endpoint interno /api/crm/franquia-cashback-creditar?confirm=true
// para uma janela dos últimos dias (lookback cobre sincronização atrasada do
// TOTVS). A idempotência fica no endpoint (tabela franquia_cashback_log por
// filial×cliente×dia) + o piso FRANQUIA_CASHBACK_INICIO — então reprocessar os
// mesmos dias NÃO duplica.
//
// Schedule: todo dia 05:30 (Natal). Pré-requisito: rodar a migration
// migrations/franquia_cashback_log.sql no Supabase.
// ─────────────────────────────────────────────────────────────────────────
import cron from 'node-cron';
import axios from 'axios';

const INTERNAL = `http://localhost:${process.env.PORT || 4100}`;
const TZ = 'America/Fortaleza'; // Natal/RN
const LOOKBACK_DIAS = Number(process.env.FRANQUIA_CASHBACK_LOOKBACK || 5);

function ymd(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

export async function executarFranquiaCashback() {
  const datemax = ymd(-1); // até ontem (dia já fechado)
  const datemin = ymd(-LOOKBACK_DIAS);
  console.log(`\n💰 [franquia-cashback] creditando ${datemin} → ${datemax}`);
  try {
    const r = await axios.post(
      `${INTERNAL}/api/crm/franquia-cashback-creditar`,
      {},
      { params: { confirm: 'true', datemin, datemax }, timeout: 600000 },
    );
    const d = r.data?.data || r.data || {};
    console.log(
      `[franquia-cashback] ✅ creditados ${d.creditados || 0} (R$ ${d.totalCreditado || 0}) · erros ${d.erros || 0}`,
    );
    if (d.erros > 0) console.warn('[franquia-cashback] erros:', JSON.stringify(d.detalhe_erros || []).slice(0, 400));
    return d;
  } catch (e) {
    console.error('[franquia-cashback] falhou:', e.response?.data?.message || e.message);
    return null;
  }
}

let agendado = false;
export function iniciarFranquiaCashbackJob() {
  if (agendado) return;
  agendado = true;
  cron.schedule(
    '30 5 * * *',
    async () => {
      try {
        await executarFranquiaCashback();
      } catch (e) {
        console.error('[franquia-cashback] cron falhou:', e.message);
      }
    },
    { timezone: TZ },
  );
  console.log(`[franquia-cashback] cron agendado: 05:30 (Natal) · lookback ${LOOKBACK_DIAS} dias`);
}

// Execução manual: node jobs/franquia-cashback.job.js
if (process.argv[1]?.endsWith('franquia-cashback.job.js')) {
  executarFranquiaCashback().then((r) => {
    console.log('Resultado:', r);
    process.exit(0);
  });
}
