// Faturamento histórico por transação (NF) — uma linha por NF da planilha.
//   GET /api/faturamento-transacao        — lista com filtros + paginação
//   GET /api/faturamento-transacao/resumo — totais por canal × ano/mês
import express from 'express';
import supabase from '../config/supabase.js';

const router = express.Router();

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
router.get('/resumo', async (req, res) => {
  try {
    const datemin = req.query.datemin;
    const datemax = req.query.datemax;
    const canal = req.query.canal || null;
    const busca = req.query.busca || null;
    const loja = req.query.loja || null;

    // Como Supabase JS não tem SUM nativo, vamos paginar tudo lendo só os 3 campos
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
        total_vl_fat += Number(r.vl_fat || 0);
        total_credev += Number(r.credev || 0);
        total_liquido += Number(r.total || 0);
        n += 1;
        if (!porCanal[r.canal]) porCanal[r.canal] = { vl_fat: 0, credev: 0, total: 0, count: 0 };
        porCanal[r.canal].vl_fat += Number(r.vl_fat || 0);
        porCanal[r.canal].credev += Number(r.credev || 0);
        porCanal[r.canal].total += Number(r.total || 0);
        porCanal[r.canal].count += 1;
      }
      if (data.length < PAGE) break;
    }
    // Arredonda
    for (const k of Object.keys(porCanal)) {
      porCanal[k].vl_fat = Math.round(porCanal[k].vl_fat * 100) / 100;
      porCanal[k].credev = Math.round(porCanal[k].credev * 100) / 100;
      porCanal[k].total = Math.round(porCanal[k].total * 100) / 100;
    }
    return res.json({
      ok: true,
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
