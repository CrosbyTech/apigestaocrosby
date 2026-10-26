/**
 * /api/inadimplencia/mensal — série mensal de inadimplência (>60 dias), do snapshot diário.
 *   GET  /mensal?refresh=1 → último snapshot (refresh=1 dispara nova geração em segundo plano)
 *   POST /mensal/gerar     → gera agora (demora minutos; responde quando terminar)
 * Ver services/inadimplenciaMensal.js.
 */
import express from 'express';
import { obterUltimo, gerarSnapshot } from '../services/inadimplenciaMensal.js';

const router = express.Router();

router.get('/mensal', async (req, res) => {
  try {
    res.json(await obterUltimo({ refresh: req.query.refresh === '1' }));
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.post('/mensal/gerar', async (_req, res) => {
  try {
    const r = await gerarSnapshot();
    res.status(r.ok ? 200 : 409).json(r);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

export default router;
