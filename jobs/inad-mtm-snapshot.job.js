/**
 * Foto semanal da Venda x Inadimplência por Vendedor (Inadimplência MTM).
 * Toda segunda-feira às 06:10 (America/Sao_Paulo) apura e grava em
 * `inad_snapshot`. Se o faturado vier zerado (TOTVS instável), NÃO grava e
 * tenta de novo a cada 20 min, até 6 vezes.
 *
 * CONFIG
 *   INAD_MTM_CRON         default '10 6 * * 1'
 *   INAD_MTM_TENTATIVAS   default 6
 *   INAD_MTM_INTERVALO_MIN default 20
 */
import cron from 'node-cron';
import { apurar } from '../services/inadimplenciaMtm.js';

const CRON_EXPR = process.env.INAD_MTM_CRON || '10 6 * * 1';
const TENTATIVAS = Number(process.env.INAD_MTM_TENTATIVAS || 6);
const INTERVALO_MS = Number(process.env.INAD_MTM_INTERVALO_MIN || 20) * 60_000;
const TZ = 'America/Sao_Paulo';

let RODANDO = false;

export async function rodarFotoSemanal() {
  if (RODANDO) return;
  RODANDO = true;
  try {
    for (let t = 1; t <= TENTATIVAS; t += 1) {
      try {
        const r = await apurar({ origem: 'job' });
        console.log(`📊 [inad-mtm] foto semanal ${r.semana} gravada (tentativa ${t}) em ${Math.round(r.tempoMs / 1000)} s`);
        return;
      } catch (e) {
        console.error(`❌ [inad-mtm] tentativa ${t}/${TENTATIVAS}: ${e.message}`);
        if (t < TENTATIVAS) await new Promise((ok) => setTimeout(ok, INTERVALO_MS));
      }
    }
  } finally {
    RODANDO = false;
  }
}

export function iniciarJobInadMtm() {
  cron.schedule(CRON_EXPR, () => rodarFotoSemanal().catch((e) => console.error('❌ [inad-mtm]', e.message)), { timezone: TZ });
  console.log(`⏰ [inad-mtm] foto semanal agendada (${CRON_EXPR} ${TZ})`);
}
