// Faturamento diário por canal — histórico.
//   GET    /api/faturamento-historico             — lista (filtros: ano, mes, canal)
//   GET    /api/faturamento-historico/dashboard   — KPIs por canal (fat-seg)
//   DELETE /api/faturamento-historico/:id         — apaga linha
//   DELETE /api/faturamento-historico             — apaga por filtro (ano+mes+canal)
import express from 'express';
import supabase from '../config/supabase.js';

const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE || `http://localhost:${process.env.PORT || 4100}`;

const router = express.Router();

// ─── GET / ────────────────────────────────────────────────────────────────────
// Query: ?ano=2025&mes=6&canal=varejo
// Sem mes → mês inteiro; sem canal → todos os canais
router.get('/', async (req, res) => {
  try {
    const ano = parseInt(req.query.ano, 10);
    const mes = req.query.mes ? parseInt(req.query.mes, 10) : null;
    const canal = req.query.canal || null;
    if (!ano) return res.status(400).json({ error: 'ano obrigatório' });

    const lastDay = mes ? new Date(ano, mes, 0).getDate() : 31;
    const datemin = mes
      ? `${ano}-${String(mes).padStart(2, '0')}-01`
      : `${ano}-01-01`;
    const datemax = mes
      ? `${ano}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      : `${ano}-12-31`;

    let q = supabase
      .from('faturamento_diario_canal')
      .select('*')
      .gte('data', datemin)
      .lte('data', datemax)
      .order('data', { ascending: true })
      .order('canal', { ascending: true });
    if (canal) q = q.eq('canal', canal);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const { error } = await supabase
    .from('faturamento_diario_canal')
    .delete()
    .eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// ─── DELETE / (com filtro ano+mes+canal) ─────────────────────────────────────
router.delete('/', async (req, res) => {
  const ano = parseInt(req.query.ano, 10);
  const mes = parseInt(req.query.mes, 10);
  const canal = req.query.canal;
  if (!ano || !mes || !canal) {
    return res.status(400).json({ error: 'ano, mes e canal obrigatórios' });
  }
  const lastDay = new Date(ano, mes, 0).getDate();
  const datemin = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const datemax = `${ano}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const { error, count } = await supabase
    .from('faturamento_diario_canal')
    .delete({ count: 'exact' })
    .gte('data', datemin)
    .lte('data', datemax)
    .eq('canal', canal);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, apagados: count || 0 });
});

// ─── GET /dashboard ──────────────────────────────────────────────────────────
// Query: ?datemin=YYYY-MM-DD&datemax=YYYY-MM-DD
// Usa MESMA fonte do Forecast → Por Canal (`/api/crm/faturamento-por-segmento`)
// pra garantir 100% de consistência. Inclui override de painel de vendedores
// pra revenda/multimarcas + canais derivados (Ricardo Eletro, Inbound David/Rafael).
router.get('/dashboard', async (req, res) => {
  try {
    const datemin = req.query.datemin;
    const datemax = req.query.datemax;
    if (!datemin || !datemax) {
      return res.status(400).json({ error: 'datemin e datemax obrigatórios' });
    }

    // SEMPRE usa a TABELA faturamento_transacao_historico (NF a NF, sync 2x/dia
    // via cron 00:00 e 12:00 BRT). Cobre 11 canais (incluindo showroom/inbound/
    // novidadesfranquia/ricardoeletro/business que o agregado diário não tinha).
    // Dado D-1 mas instantâneo em qualquer range.
    const dMin = new Date(datemin + 'T00:00:00Z');
    const dMax = new Date(datemax + 'T00:00:00Z');
    const rangeDays = Math.ceil((dMax - dMin) / 86400000) + 1;

    // Helper pra agregar do Supabase a partir de faturamento_transacao_historico.
    // Tabela cobre todos os 11 canais (showroom, novidades, inbound_david, etc.)
    // — diferente de faturamento_diario_canal que só tem 4-5.
    // Pagina em chunks de 1000. Pra ranges curtos (mês corrente) é rápido (~5k
    // linhas). Pra ranges longos volta a ficar pesado — por isso o default da
    // UI é "mês atual" e o /dashboard depende do cache pros canais principais.
    // ⚠️ IGNORA credev (devoluções Input).
    const fetchFromDb = async (dmin, dmax) => {
      const supabase = (await import('../config/supabase.js')).default;
      const segmentos = {};
      const credev_por_segmento = {};
      let total_liquido = 0;
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('faturamento_transacao_historico')
          .select('canal, vl_fat')
          .gte('data_transacao', dmin)
          .lte('data_transacao', dmax)
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error('DB: ' + error.message);
        const rows = data || [];
        if (rows.length === 0) break;
        for (const r of rows) {
          const c = r.canal;
          if (!c) continue;
          const v = Number(r.vl_fat || 0);
          if (v <= 0) continue;
          segmentos[c] = (segmentos[c] || 0) + v;
          credev_por_segmento[c] = 0;
          total_liquido += v;
        }
        if (rows.length < PAGE) break;
        offset += PAGE;
      }
      return { segmentos, credev_por_segmento, total_liquido, credev_total: 0 };
    };

    const fetchRange = fetchFromDb;

    // Helper pra estruturar resposta canal-totals → {canal, valor, percentual}
    const buildRanking = (segmentos, credevPorSegmento) => {
      const total = Object.values(segmentos || {}).reduce((s, v) => s + Number(v || 0), 0);
      return Object.entries(segmentos || {})
        .filter(([, v]) => Number(v) > 0)
        .map(([canal, valor]) => ({
          canal,
          valor: Math.round(Number(valor) * 100) / 100,
          credev: Math.round(Number(credevPorSegmento?.[canal] || 0) * 100) / 100,
          valor_bruto: Math.round((Number(valor) + Number(credevPorSegmento?.[canal] || 0)) * 100) / 100,
          percentual: total > 0 ? +(Number(valor) / total * 100).toFixed(2) : 0,
        }))
        .sort((a, b) => b.valor - a.valor);
    };

    // ─── Range principal: fat-seg (MESMA fonte do Forecast > Métricas por
    //     Canal). Garante consistência total entre Dashboard Vendas e Forecast.
    //     Fallback pra faturamento_transacao_historico só se fat-seg falhar.
    const tMain0 = Date.now();
    let segmentos = {};
    let credev_por_segmento = {};
    let totalLiquido = 0;
    let totalCredev = 0;
    let totalBruto = 0;
    let usedSource = 'fat-seg';
    try {
      const axios = (await import('axios')).default;
      const r = await axios.post(
        `${INTERNAL_API_BASE}/api/crm/faturamento-por-segmento?lite=true`,
        { datemin, datemax, lite: true },
        { timeout: 180000 },
      );
      const d = r.data?.data || r.data || {};
      segmentos = d.segmentos || d.segmentos_bruto || {};
      credev_por_segmento = d.credev_por_segmento || {};
      totalLiquido = Number(d.total_liquido ?? d.total ?? 0);
      totalCredev = Number(d.credev_total ?? 0);
      totalBruto = totalLiquido + totalCredev;
      console.log(
        `[dashboard] fat-seg OK: ${Object.keys(segmentos).length} canais R$ ${totalLiquido.toFixed(2)} (${Date.now() - tMain0}ms · cached=${d.cached})`,
      );
    } catch (e) {
      console.warn(
        `[dashboard] fat-seg falhou (${e.message}) status=${e.response?.status} data=${JSON.stringify(e.response?.data || {}).slice(0, 200)} — fallback faturamento_transacao_historico`,
      );
      usedSource = 'faturamento_transacao_historico (fallback)';
      const main = await fetchRange(datemin, datemax);
      segmentos = main.segmentos || {};
      credev_por_segmento = main.credev_por_segmento || {};
      totalLiquido = Number(main.total_liquido ?? main.total ?? 0);
      totalCredev = Number(main.credev_total ?? 0);
      totalBruto = totalLiquido + totalCredev;
    }

    // Mini-períodos (em relação a HOJE) — usa DB se range principal usa DB
    // (já que dados estão lá), senão via fat-seg
    const hoje = new Date();
    const ymd = (d) => d.toISOString().slice(0, 10);
    const ontemD = new Date(hoje); ontemD.setUTCDate(ontemD.getUTCDate() - 1);
    const seteDiasD = new Date(hoje); seteDiasD.setUTCDate(seteDiasD.getUTCDate() - 7);
    const mesIni = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));

    // Mini-períodos sempre via DB (instantâneo, ranges pequenos)
    const [esteMesD, ultimos7D, ontemDt] = await Promise.all([
      fetchFromDb(ymd(mesIni), ymd(hoje)).catch(() => ({})),
      fetchFromDb(ymd(seteDiasD), ymd(hoje)).catch(() => ({})),
      fetchFromDb(ymd(ontemD), ymd(ontemD)).catch(() => ({})),
    ]);

    return res.json({
      ok: true,
      datemin, datemax,
      source: usedSource,
      range_days: rangeDays,
      n_nfs: null, // fat-seg agrega, não retorna NFs individuais
      kpis: {
        vl_fat: Math.round(totalBruto * 100) / 100,
        credev: Math.round(totalCredev * 100) / 100,
        total: Math.round(totalLiquido * 100) / 100,
      },
      por_canal: buildRanking(segmentos, credev_por_segmento),
      este_mes: buildRanking(esteMesD.segmentos || {}, esteMesD.credev_por_segmento || {}),
      ultimos_7: buildRanking(ultimos7D.segmentos || {}, ultimos7D.credev_por_segmento || {}),
      ontem: buildRanking(ontemDt.segmentos || {}, ontemDt.credev_por_segmento || {}),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
