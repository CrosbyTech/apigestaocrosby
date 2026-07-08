// ─────────────────────────────────────────────────────────────────────────
// Painel de Vendas Sync — sincroniza o "Painel de Vendas" do TOTVS
// (sale-panel/sellers, campo seller_sale_value) pra tabela Supabase
// forecast_painel_vendas, por dia/vendedor/filial.
//
// É a FONTE OFICIAL do Forecast por vendedor: o card espelha exatamente o que
// o TOTVS mostra no Painel de Vendas (ex: David R$2.872,94, Rafael R$1.558,18).
// O buildVendedoresLiquido lê dessa tabela (rápido) em vez de bater no TOTVS
// ao vivo (lento).
//
// Schedule: a cada 30min em horário comercial (06:00-23:30 BRT) pro dia
// corrente + noturno 02:00 pros últimos 7 dias (ajustes retroativos TOTVS).
// ─────────────────────────────────────────────────────────────────────────
import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';

const INTERNAL_API_BASE = `http://localhost:${process.env.PORT || 4100}`;

// Filiais que cobrem os canais de vendedor do Forecast (B2R + B2M + franquia
// atacado). O sale-panel devolve TODOS os vendedores dessas filiais; o
// buildVendedoresLiquido filtra por g.sellers depois.
const BRANCHS_PAINEL = [2, 5, 75, 99, 200, 95, 87, 88, 90, 94, 97];

function ymd(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}
function ultimosNDiasUteis(n) {
  const dias = [];
  const d = new Date();
  while (dias.length < n) {
    const iso = ymd(d);
    const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
    if (dow !== 0) dias.push(iso); // pula domingo
    d.setDate(d.getDate() - 1);
  }
  return dias;
}

// Popula 1 dia: chama o sale-panel e faz upsert por seller/branch.
async function popularDia(diaIso) {
  let resp;
  try {
    resp = await axios.post(
      `${INTERNAL_API_BASE}/api/totvs/sale-panel/sellers`,
      { branchs: BRANCHS_PAINEL, datemin: diaIso, datemax: diaIso },
      { timeout: 180000 },
    );
  } catch (e) {
    console.warn(`[painel-vendas-sync] ${diaIso} fetch falhou: ${e.message}`);
    return { ok: false, dia: diaIso, rows: 0 };
  }
  const branches = resp.data?.data?.branches || resp.data?.branches || [];
  const rows = [];
  const now = new Date().toISOString();
  for (const b of branches) {
    const branchCode = Number(b.branch_code);
    for (const s of b.dataRow || []) {
      const code = Number(s.seller_code);
      const valor = Number(s.seller_sale_value || 0);
      const qtd = Number(s.seller_sale_qty || 0);
      if (!Number.isFinite(code)) continue;
      rows.push({
        data: diaIso,
        seller_code: code,
        seller_name: s.seller_name || null,
        branch_code: branchCode,
        valor: Math.round(valor * 100) / 100,
        qtd: Number.isFinite(qtd) ? Math.round(qtd) : 0,
        atualizado_em: now,
      });
    }
  }
  // Apaga o dia antes de reinserir (evita órfãos)
  await supabase.from('forecast_painel_vendas').delete().eq('data', diaIso);
  if (rows.length === 0) {
    console.log(`[painel-vendas-sync] ${diaIso} sem vendedores`);
    return { ok: true, dia: diaIso, rows: 0 };
  }
  const { error } = await supabase.from('forecast_painel_vendas').insert(rows);
  if (error) {
    console.error(`[painel-vendas-sync] ${diaIso} insert falhou: ${error.message}`);
    return { ok: false, dia: diaIso, rows: 0 };
  }
  console.log(`[painel-vendas-sync] ✅ ${diaIso}: ${rows.length} linhas`);
  return { ok: true, dia: diaIso, rows: rows.length };
}

export async function executarSyncPainelVendas({ dias = 7 } = {}) {
  const inicio = Date.now();
  console.log(`\n📥 [painel-vendas-sync] iniciado — últimos ${dias} dias úteis`);
  const lista = ultimosNDiasUteis(dias);
  let sucessos = 0, totalRows = 0;
  for (const dia of lista) {
    const r = await popularDia(dia);
    if (r.ok) { sucessos += 1; totalRows += r.rows; }
  }
  const segs = ((Date.now() - inicio) / 1000).toFixed(0);
  console.log(`[painel-vendas-sync] concluído em ${segs}s — ${sucessos}/${lista.length} dias, ${totalRows} linhas`);
  return { dias_ok: sucessos, total_dias: lista.length, total_rows: totalRows, duracao_s: Number(segs) };
}

let agendado = false;
export function iniciarPainelVendasSyncJob() {
  if (agendado) return;
  agendado = true;
  // Comercial: dia corrente a cada 30min (06:00-23:30 BRT)
  cron.schedule(
    '*/30 6-23 * * *',
    async () => {
      try { await executarSyncPainelVendas({ dias: 1 }); }
      catch (e) { console.error('[painel-vendas-sync] cron comercial falhou:', e.message); }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  // Noturno: últimos 7 dias (pega ajustes retroativos do TOTVS)
  cron.schedule(
    '0 2 * * *',
    async () => {
      try { await executarSyncPainelVendas({ dias: 7 }); }
      catch (e) { console.error('[painel-vendas-sync] cron noturno falhou:', e.message); }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log('[painel-vendas-sync] cron agendado: 30min comercial + 02:00 noturno (7 dias)');
}
