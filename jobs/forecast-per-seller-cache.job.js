// Job: popula forecast_per_seller_cache via /forecast/ontem-vendedor-loja
// dia a dia. A tabela alimenta o card "Faturamento Detalhado por Canal
// (Mês/Semana/Ontem)" do Forecast — quando o cache está fresco, o
// componente FaturamentoOntemVendedorLoja responde em ms; sem cache cai
// no recálculo via TOTVS/notas_fiscais (lento).
//
// Schedule: 01:30 BRT diariamente (após canal-totals-cache + notas_fiscais
// noturnos). Backfill manual via POST /api/forecast/per-seller-cache/refresh.

import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';

const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE || `http://localhost:${process.env.PORT || 4100}`;

const ymd = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

// Lista os últimos N dias úteis (pula domingo). Ordem: mais recente primeiro.
function ultimosNDiasUteis(n) {
  const dias = [];
  const cur = new Date();
  cur.setUTCHours(0, 0, 0, 0);
  // Começa em ontem (D-1) — hoje ainda está vendendo
  cur.setUTCDate(cur.getUTCDate() - 1);
  while (dias.length < n) {
    if (cur.getUTCDay() !== 0) dias.push(ymd(new Date(cur)));
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return dias;
}

// Mapeia a resposta de /ontem-vendedor-loja em rows pra upsert.
// Resposta esperada:
//   varejo.lojas[]        → { nome, uf, valor }
//   multimarcas.vendedores[] / revenda.vendedores[] → { nome, valor }
//   outros.vendedores[]   → { nome, canal, valor }
function montarRows(data, diaIso) {
  const now = new Date().toISOString();
  const rows = [];

  const push = (canal, entidade_tipo, nome, valor, uf = null) => {
    const v = Number(valor || 0);
    if (!nome || v <= 0) return;
    rows.push({
      data: diaIso,
      canal,
      entidade_tipo,
      entidade_nome: String(nome).trim(),
      entidade_uf: uf,
      valor_bruto: v,        // endpoint só retorna líquido — bruto=liquido como aproximação
      credev_value: 0,
      valor_liquido: v,
      atualizado_em: now,
    });
  };

  for (const l of data?.varejo?.lojas || []) push('varejo', 'loja', l.nome, l.valor, l.uf);
  for (const v of data?.multimarcas?.vendedores || []) push('multimarcas', 'vendedor', v.nome, v.valor);
  for (const v of data?.revenda?.vendedores || []) push('revenda', 'vendedor', v.nome, v.valor);
  for (const v of data?.outros?.vendedores || []) push(v.canal || 'outros', 'vendedor', v.nome, v.valor);
  return rows;
}

// Roda 1 dia: chama endpoint e faz upsert. Retorna { ok, rows, dia }.
async function popularDia(diaIso) {
  let resp;
  try {
    resp = await axios.get(
      `${INTERNAL_API_BASE}/api/forecast/ontem-vendedor-loja`,
      {
        params: { datemin: diaIso, datemax: diaIso, cacheOnly: '1', nocache: '1' },
        timeout: 300000,
      },
    );
  } catch (e) {
    console.warn(`[psc-cron] ${diaIso} fetch falhou: ${e.message}`);
    return { ok: false, dia: diaIso, rows: 0 };
  }
  const data = resp.data?.data || resp.data || {};
  const rows = montarRows(data, diaIso);
  if (rows.length === 0) {
    console.log(`[psc-cron] ${diaIso} sem rows (skipping)`);
    return { ok: true, dia: diaIso, rows: 0 };
  }
  // Apaga só os dados do dia antes do upsert (evita órfãos quando entidades somem)
  const { error: delErr } = await supabase
    .from('forecast_per_seller_cache')
    .delete()
    .eq('data', diaIso);
  if (delErr) {
    console.warn(`[psc-cron] ${diaIso} delete falhou: ${delErr.message}`);
    // Não aborta — segue pro insert
  }
  const { error: insErr } = await supabase
    .from('forecast_per_seller_cache')
    .insert(rows);
  if (insErr) {
    console.error(`[psc-cron] ${diaIso} insert falhou: ${insErr.message}`);
    return { ok: false, dia: diaIso, rows: 0 };
  }
  console.log(`[psc-cron] ✅ ${diaIso}: ${rows.length} entidades`);
  return { ok: true, dia: diaIso, rows: rows.length };
}

// Sync público: roda popularDia em sequência (não paraleliza pra não
// martelar TOTVS — cada chamada ao endpoint dispara várias rotas internas).
export async function executarSyncPerSellerCache({ dias = 35 } = {}) {
  const inicio = Date.now();
  console.log(`\n📥 [psc-cron] iniciado — backfill últimos ${dias} dias úteis`);
  const lista = ultimosNDiasUteis(dias);
  let sucessos = 0;
  let totalRows = 0;
  for (const dia of lista) {
    const r = await popularDia(dia);
    if (r.ok) { sucessos += 1; totalRows += r.rows; }
  }
  const segs = ((Date.now() - inicio) / 1000).toFixed(0);
  console.log(`[psc-cron] concluído em ${segs}s — ${sucessos}/${lista.length} dias OK, ${totalRows} entidades`);
  return { dias_processados: sucessos, total_dias: lista.length, total_rows: totalRows, duracao_s: Number(segs) };
}

let agendado = false;
export function iniciarForecastPerSellerCacheJob() {
  if (agendado) return;
  agendado = true;
  // 01:30 BRT — depois de canal-totals-cache (a cada hora) e antes da
  // primeira manhã. Default 7 dias no cron (cobre semana inteira incluindo
  // ajustes retroativos do TOTVS). Backfill maior via rota manual.
  cron.schedule(
    '30 1 * * *',
    async () => {
      try { await executarSyncPerSellerCache({ dias: 7 }); }
      catch (e) { console.error('[psc-cron] cron falhou:', e.message); }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log('[psc-cron] cron agendado: 01:30 BRT diariamente (últimos 7 dias úteis)');
}
