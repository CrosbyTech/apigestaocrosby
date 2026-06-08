// Faturamento diário por canal — histórico.
//   GET    /api/faturamento-historico             — lista (filtros: ano, mes, canal)
//   GET    /api/faturamento-historico/resumo      — total agregado por canal × mês
//   POST   /api/faturamento-historico/bulk-upsert — upsert em lote (grid e CSV)
//   POST   /api/faturamento-historico/import-csv  — recebe array {data, canal, valor}
//   DELETE /api/faturamento-historico/:id         — apaga linha
//   DELETE /api/faturamento-historico             — apaga por filtro (ano+mes+canal)
import express from 'express';
import axios from 'axios';
import supabase from '../config/supabase.js';

const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE || `http://localhost:${process.env.PORT || 4100}`;

const router = express.Router();

const CANAIS_VALIDOS = new Set([
  'varejo', 'revenda', 'multimarcas', 'inbound_david', 'inbound_rafael',
  'franquia', 'bazar', 'fabrica', 'business', 'ricardoeletro', 'bluecard',
]);

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

// ─── GET /resumo ──────────────────────────────────────────────────────────────
// Query: ?ano=2025
// Retorna total por canal por mês — pra preview/dashboard
router.get('/resumo', async (req, res) => {
  try {
    const ano = parseInt(req.query.ano, 10);
    if (!ano) return res.status(400).json({ error: 'ano obrigatório' });
    const { data, error } = await supabase
      .from('faturamento_diario_canal')
      .select('data, canal, valor, quantidade')
      .gte('data', `${ano}-01-01`)
      .lte('data', `${ano}-12-31`);
    if (error) return res.status(500).json({ error: error.message });

    // Agrega no JS: { canal: { 1: {valor, qtd}, 2: {...} } }
    const resumo = {};
    for (const r of data || []) {
      const m = parseInt(r.data.slice(5, 7), 10);
      if (!resumo[r.canal]) resumo[r.canal] = {};
      if (!resumo[r.canal][m]) resumo[r.canal][m] = { valor: 0, quantidade: 0, dias: 0 };
      resumo[r.canal][m].valor += Number(r.valor || 0);
      resumo[r.canal][m].quantidade += Number(r.quantidade || 0);
      resumo[r.canal][m].dias += 1;
    }
    return res.json({ ok: true, ano, resumo });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /bulk-upsert ───────────────────────────────────────────────────────
// Body: { rows: [{data, canal, valor, quantidade?, observacao?}], origem?, atualizado_por? }
router.post('/bulk-upsert', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const origem = req.body?.origem || 'manual';
    const atualizado_por = req.body?.atualizado_por || null;
    if (!rows.length) return res.status(400).json({ error: 'rows vazio' });

    // Valida + normaliza
    const limpos = [];
    const erros = [];
    for (const [i, r] of rows.entries()) {
      if (!r.data || !/^\d{4}-\d{2}-\d{2}$/.test(r.data)) {
        erros.push({ idx: i, motivo: 'data inválida (YYYY-MM-DD)' });
        continue;
      }
      if (!r.canal || !CANAIS_VALIDOS.has(r.canal)) {
        erros.push({ idx: i, motivo: `canal inválido: ${r.canal}` });
        continue;
      }
      const valor = Number(r.valor);
      if (!Number.isFinite(valor) || valor < 0) {
        erros.push({ idx: i, motivo: 'valor inválido' });
        continue;
      }
      limpos.push({
        data: r.data,
        canal: r.canal,
        valor,
        quantidade: r.quantidade != null ? Math.round(Number(r.quantidade) || 0) : null,
        observacao: r.observacao || null,
        origem,
        atualizado_em: new Date().toISOString(),
        atualizado_por,
      });
    }
    if (!limpos.length) {
      return res.status(400).json({ error: 'nenhuma linha válida', erros });
    }
    // Upsert em chunks de 500 pra não estourar payload
    let salvos = 0;
    for (let i = 0; i < limpos.length; i += 500) {
      const chunk = limpos.slice(i, i + 500);
      const { error } = await supabase
        .from('faturamento_diario_canal')
        .upsert(chunk, { onConflict: 'data,canal' });
      if (error) return res.status(500).json({ error: error.message, salvos });
      salvos += chunk.length;
    }
    return res.json({ ok: true, salvos, erros });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /import-csv ────────────────────────────────────────────────────────
// Body: { csv: "data;canal;valor[;quantidade]\n..." }
// Aceita ; ou , como separador. Primeira linha é header (opcional).
router.post('/import-csv', async (req, res) => {
  try {
    const csv = String(req.body?.csv || '').trim();
    if (!csv) return res.status(400).json({ error: 'csv vazio' });
    const linhas = csv.split(/\r?\n/).filter(Boolean);
    const sep = linhas[0].includes(';') ? ';' : ',';
    const header = linhas[0].toLowerCase().replace(/\s/g, '');
    const temHeader = header.includes('data') && header.includes('canal') && header.includes('valor');
    const start = temHeader ? 1 : 0;

    const parseBr = (s) => {
      // "1.234,56" → 1234.56  | "1234.56" → 1234.56 | "1234" → 1234
      const v = String(s || '').trim().replace(/\./g, '').replace(',', '.');
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const parseDate = (s) => {
      const v = String(s || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      // dd/mm/yyyy
      const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      return null;
    };

    const rows = [];
    const erros = [];
    for (let i = start; i < linhas.length; i++) {
      const cols = linhas[i].split(sep);
      if (cols.length < 3) {
        erros.push({ linha: i + 1, motivo: 'menos de 3 colunas' });
        continue;
      }
      const d = parseDate(cols[0]);
      const canal = cols[1]?.trim().toLowerCase();
      const valor = parseBr(cols[2]);
      const quantidade = cols[3] ? Math.round(parseBr(cols[3])) : null;
      if (!d) { erros.push({ linha: i + 1, motivo: 'data inválida' }); continue; }
      if (!CANAIS_VALIDOS.has(canal)) {
        erros.push({ linha: i + 1, motivo: `canal inválido: ${canal}` });
        continue;
      }
      rows.push({ data: d, canal, valor, quantidade });
    }

    if (!rows.length) {
      return res.status(400).json({ error: 'nenhuma linha válida no CSV', erros });
    }

    // Upsert
    let salvos = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({
        ...r,
        origem: 'csv-import',
        atualizado_em: new Date().toISOString(),
        atualizado_por: req.body?.atualizado_por || null,
      }));
      const { error } = await supabase
        .from('faturamento_diario_canal')
        .upsert(chunk, { onConflict: 'data,canal' });
      if (error) return res.status(500).json({ error: error.message, salvos, erros });
      salvos += chunk.length;
    }
    return res.json({ ok: true, salvos, erros, total_linhas: linhas.length - start });
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

    // Helper pra chamar fat-seg
    const fetchFatSeg = async (dmin, dmax) => {
      const r = await axios.post(
        `${INTERNAL_API_BASE}/api/crm/faturamento-por-segmento`,
        { datemin: dmin, datemax: dmax },
        { timeout: 240000 },
      );
      return r.data?.data || r.data || {};
    };

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

    // Range principal
    const main = await fetchFatSeg(datemin, datemax);
    const segmentos = main.segmentos || {};
    const credev_por_segmento = main.credev_por_segmento || {};
    const totalLiquido = Number(main.total_liquido ?? main.total ?? 0);
    const totalCredev = Number(main.credev_total ?? 0);
    const totalBruto = totalLiquido + totalCredev;

    // Mini-períodos (em relação a HOJE)
    const hoje = new Date();
    const ymd = (d) => d.toISOString().slice(0, 10);
    const ontemD = new Date(hoje); ontemD.setUTCDate(ontemD.getUTCDate() - 1);
    const seteDiasD = new Date(hoje); seteDiasD.setUTCDate(seteDiasD.getUTCDate() - 7);
    const mesIni = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));

    // Roda 3 mini-períodos em paralelo (todos via fat-seg)
    const [esteMesD, ultimos7D, ontemDt] = await Promise.all([
      fetchFatSeg(ymd(mesIni), ymd(hoje)).catch(() => ({})),
      fetchFatSeg(ymd(seteDiasD), ymd(hoje)).catch(() => ({})),
      fetchFatSeg(ymd(ontemD), ymd(ontemD)).catch(() => ({})),
    ]);

    return res.json({
      ok: true,
      datemin, datemax,
      source: 'crm/faturamento-por-segmento',
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

// ─── POST /auto-popular ──────────────────────────────────────────────────────
// Body: { datemin, datemax }  (ou { date } pra 1 dia só)
// Roda o mesmo cálculo que o Forecast → Promessa Mensal usa hoje
// (/api/crm/faturamento-por-segmento) e salva por dia × canal.
// Substitui qualquer valor já existente (origem='auto-backfill').
router.post('/auto-popular', async (req, res) => {
  try {
    const { datemin, datemax, date } = req.body || {};
    const { popularDiaFaturamento, popularRangeFaturamento } = await import(
      '../jobs/faturamento-historico.job.js'
    );
    if (date) {
      const r = await popularDiaFaturamento(date, { origem: 'auto-backfill' });
      return res.json({ ok: true, ...r });
    }
    if (!datemin || !datemax) {
      return res.status(400).json({ error: 'date OU (datemin + datemax) obrigatórios' });
    }
    const r = await popularRangeFaturamento({
      datemin, datemax, origem: 'auto-backfill',
    });
    return res.json({ ok: true, ...r });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
