/**
 * /api/baixa-lotes — histórico dos lotes de baixa (Solicitações de Baixa → TOTVS).
 *   GET /?dias=30&limite=200 → lotes mais recentes (com itens)
 *   GET /:id                 → um lote
 * Gravado em totvsrouter/fiscal.js (invoices-settle). Tabela: migrations/baixa_lotes.sql.
 */
import express from 'express';
import supabase from '../config/supabase.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const dias = Math.max(1, Math.min(365, Number(req.query.dias) || 30));
    const limite = Math.max(1, Math.min(500, Number(req.query.limite) || 200));
    const desde = new Date(Date.now() - dias * 86400000).toISOString();
    const { data, error } = await supabase
      .from('baixa_lotes')
      .select('*')
      .gte('em', desde)
      .order('em', { ascending: false })
      .limit(limite);
    if (error) throw new Error(error.message);
    res.json({ dias, total: (data || []).length, lotes: data || [] });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('baixa_lotes').select('*').eq('id', Number(req.params.id)).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ erro: 'lote não encontrado' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

export default router;
