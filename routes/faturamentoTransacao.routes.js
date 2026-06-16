// Faturamento histórico por transação (NF) — uma linha por NF da planilha.
//   GET /api/faturamento-transacao        — lista com filtros + paginação
//   GET /api/faturamento-transacao/resumo — totais por canal × ano/mês
import express from 'express';
import supabase from '../config/supabase.js';

const router = express.Router();

// Canais que NÃO devem ter credev/devolução atribuída — replica CANAL_CONFIG.
//   • bazar          → peças de saldo, sem troca/devolução (skipDevolucao=true)
//   • ricardoeletro  → loja parceira, só conta saída op 512; devoluções não contam
// Sem este filtro, NFs de devolução genéricas (op 7245 etc.) pegavam crédito
// errado em canais que não deveriam ter credev nenhum.
const CANAIS_SEM_CREDEV = new Set(['bazar', 'ricardoeletro']);

// ─── GET / ────────────────────────────────────────────────────────────────────
// Query: ?datemin=&datemax=&canal=&busca=&loja=&page=1&pageSize=100&order=data_desc
router.get('/', async (req, res) => {
  try {
    const datemin = req.query.datemin;
    const datemax = req.query.datemax;
    const canal = req.query.canal || null;
    const busca = req.query.busca || null;
    const loja = req.query.loja || null;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(500, Math.max(10, parseInt(req.query.pageSize || '100', 10)));
    const order = req.query.order || 'data_desc';

    let q = supabase
      .from('faturamento_transacao_historico')
      .select('*', { count: 'exact' });

    if (datemin) q = q.gte('data_transacao', datemin);
    if (datemax) q = q.lte('data_transacao', datemax);
    if (canal) q = q.eq('canal', canal);
    if (loja) q = q.ilike('loja', `%${loja.replace(/[%_]/g, '')}%`);
    if (busca) {
      const safe = busca.replace(/[%_]/g, '');
      q = q.or(`cliente_nome.ilike.%${safe}%,loja.ilike.%${safe}%`);
    }

    // Order
    const orderMap = {
      data_desc: ['data_transacao', { ascending: false }],
      data_asc: ['data_transacao', { ascending: true }],
      valor_desc: ['total', { ascending: false }],
      valor_asc: ['total', { ascending: true }],
      cliente_asc: ['cliente_nome', { ascending: true }],
    };
    const [col, opts] = orderMap[order] || orderMap.data_desc;
    q = q.order(col, opts);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    q = q.range(from, to);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      ok: true,
      items: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── GET /resumo ──────────────────────────────────────────────────────────────
// Soma agregada (VL.FAT, CREDEV, Total) pra o range filtrado.
// Necessária pra mostrar totais REAIS (a paginação só conta linhas, não soma).
//
// Estratégia:
//   - Sem filtro de cliente/loja  → usa faturamento_diario_canal (pré-agregado,
//     ~365 linhas/ano). 100x mais rápido que varrer NF a NF.
//   - Com filtro de cliente/loja → fallback que varre faturamento_transacao_historico
//     (não tem como pré-agregar busca textual).
router.get('/resumo', async (req, res) => {
  const t0 = Date.now();
  try {
    const datemin = req.query.datemin;
    const datemax = req.query.datemax;
    const canal = req.query.canal || null;
    const busca = req.query.busca || null;
    const loja = req.query.loja || null;

    // ── Caminho rápido para ranges sem busca/loja ────────────────────────
    if (!busca && !loja) {
      // 1º: agrega faturamento_transacao_historico (NF a NF, todos canais)
      //     Pagina em chunks de 1000. Pra mês corrente são ~5k linhas (rápido).
      const porCanal = {};
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from('faturamento_transacao_historico')
          .select('canal, vl_fat, credev, total')
          .range(from, from + PAGE - 1);
        if (datemin) q = q.gte('data_transacao', datemin);
        if (datemax) q = q.lte('data_transacao', datemax);
        if (canal) q = q.eq('canal', canal);
        const { data, error } = await q;
        if (error) return res.status(500).json({ error: error.message });
        if (!data || data.length === 0) break;
        for (const r of data) {
          const c = r.canal;
          if (!porCanal[c]) porCanal[c] = { vl_fat: 0, credev: 0, total: 0, count: 0 };
          porCanal[c].vl_fat += Number(r.vl_fat || 0);
          // Pula credev em canais sem devolução (ex: bazar)
          if (!CANAIS_SEM_CREDEV.has(c)) {
            porCanal[c].credev += Number(r.credev || 0);
          }
          porCanal[c].total += Number(r.total || 0);
          porCanal[c].count += 1;
        }
        if (data.length < PAGE) break;
      }
      // Para canais sem credev, força total = bruto (não subtrai devolução)
      for (const c of CANAIS_SEM_CREDEV) {
        if (porCanal[c]) {
          porCanal[c].credev = 0;
          porCanal[c].total = porCanal[c].vl_fat;
        }
      }

      // 2º: override dos canais que canal_totals_cache tem (mais corretos)
      try {
        let cq = supabase
          .from('canal_totals_cache')
          .select('canal, valor_liquido, valor_bruto, credev, atualizado_em')
          .eq('datemin', datemin)
          .eq('datemax', datemax);
        if (canal) cq = cq.eq('canal', canal);
        const { data: cacheRows } = await cq;
        if (cacheRows && cacheRows.length > 0) {
          for (const r of cacheRows) {
            const liq = Number(r.valor_liquido || 0);
            const bruto = Number(r.valor_bruto || r.valor_liquido || 0);
            const creCache = Number(r.credev || 0);
            if (liq <= 0 && bruto <= 0) continue;
            // Preserva credev do per-NF (mais confiável que cache, que vem 0).
            // Cache só atualiza bruto/líquido (alinhados com TOTVS oficial).
            const credevNF = Number(porCanal[r.canal]?.credev || 0);
            const credevFinal = creCache > 0 ? creCache : credevNF;
            porCanal[r.canal] = {
              vl_fat: bruto,
              credev: credevFinal,
              // Subtrai credev do bruto pra manter coerência líquido = bruto − credev.
              // Se cache veio com líquido já calculado, prioriza esse valor.
              total: liq > 0 && creCache > 0
                ? liq
                : Math.max(0, bruto - credevFinal),
              count: porCanal[r.canal]?.count || 0,
            };
          }
          console.log(
            `[fat-transacao/resumo] cache override: ${cacheRows.length} canais (${Date.now() - t0}ms · atualizado ${cacheRows[0].atualizado_em})`,
          );
        } else {
          console.log(`[fat-transacao/resumo] sem cache pro range, usou só diario_canal (${Date.now() - t0}ms)`);
        }
      } catch (e) {
        console.warn(`[fat-transacao/resumo] cache lookup falhou: ${e.message}`);
      }

      // soma final
      let total_vl_fat = 0, total_credev = 0, total_liquido = 0;
      for (const k of Object.keys(porCanal)) {
        porCanal[k].vl_fat = Math.round(porCanal[k].vl_fat * 100) / 100;
        porCanal[k].credev = Math.round(porCanal[k].credev * 100) / 100;
        porCanal[k].total = Math.round(porCanal[k].total * 100) / 100;
        total_vl_fat += porCanal[k].vl_fat;
        total_credev += porCanal[k].credev;
        total_liquido += porCanal[k].total;
      }
      return res.json({
        ok: true,
        source: 'diario_canal + canal_totals_cache override',
        n_transacoes: null,
        total_vl_fat: Math.round(total_vl_fat * 100) / 100,
        total_credev: Math.round(total_credev * 100) / 100,
        total_liquido: Math.round(total_liquido * 100) / 100,
        por_canal: porCanal,
      });
    }

    // ── Caminho lento: filtros textuais (busca/loja) — varre NF a NF ──────
    let total_vl_fat = 0, total_credev = 0, total_liquido = 0, n = 0;
    const porCanal = {};
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from('faturamento_transacao_historico')
        .select('canal, vl_fat, credev, total')
        .range(from, from + PAGE - 1);
      if (datemin) q = q.gte('data_transacao', datemin);
      if (datemax) q = q.lte('data_transacao', datemax);
      if (canal) q = q.eq('canal', canal);
      if (loja) q = q.ilike('loja', `%${loja.replace(/[%_]/g, '')}%`);
      if (busca) {
        const safe = busca.replace(/[%_]/g, '');
        q = q.or(`cliente_nome.ilike.%${safe}%,loja.ilike.%${safe}%`);
      }
      const { data, error } = await q;
      if (error) return res.status(500).json({ error: error.message });
      if (!data || data.length === 0) break;
      for (const r of data) {
        const skipCredev = CANAIS_SEM_CREDEV.has(r.canal);
        const credevNF = skipCredev ? 0 : Number(r.credev || 0);
        const totalNF = skipCredev ? Number(r.vl_fat || 0) : Number(r.total || 0);
        total_vl_fat += Number(r.vl_fat || 0);
        total_credev += credevNF;
        total_liquido += totalNF;
        n += 1;
        if (!porCanal[r.canal]) porCanal[r.canal] = { vl_fat: 0, credev: 0, total: 0, count: 0 };
        porCanal[r.canal].vl_fat += Number(r.vl_fat || 0);
        porCanal[r.canal].credev += credevNF;
        porCanal[r.canal].total += totalNF;
        porCanal[r.canal].count += 1;
      }
      if (data.length < PAGE) break;
    }
    for (const k of Object.keys(porCanal)) {
      porCanal[k].vl_fat = Math.round(porCanal[k].vl_fat * 100) / 100;
      porCanal[k].credev = Math.round(porCanal[k].credev * 100) / 100;
      porCanal[k].total = Math.round(porCanal[k].total * 100) / 100;
    }
    console.log(
      `[fat-transacao/resumo] SLOW (per-NF, busca/loja) ${datemin}→${datemax} ${n} linhas ${Date.now() - t0}ms`,
    );
    return res.json({
      ok: true,
      source: 'faturamento_transacao_historico',
      n_transacoes: n,
      total_vl_fat: Math.round(total_vl_fat * 100) / 100,
      total_credev: Math.round(total_credev * 100) / 100,
      total_liquido: Math.round(total_liquido * 100) / 100,
      por_canal: porCanal,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /sync ──────────────────────────────────────────────────────────────
// Body opcional: { datemin, datemax }  (default: D-7 → D-1)
// Dispara sync manual do `notas_fiscais` → `faturamento_transacao_historico`.
// Não chama TOTVS — só copia do Supabase Fiscal pra Supabase histórico.
router.post('/sync', async (req, res) => {
  try {
    const { datemin, datemax } = req.body || {};
    const { executarSyncTransacao } = await import(
      '../jobs/transacao-historico-sync.job.js'
    );
    const r = await executarSyncTransacao({ datemin, datemax });
    if (!r.ok) return res.status(500).json(r);
    return res.json(r);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
