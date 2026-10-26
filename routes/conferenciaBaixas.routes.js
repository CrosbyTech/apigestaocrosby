/**
 * /api/conferencia-baixas — conferência das Solicitações de Baixa contra o TOTVS.
 *   GET  /status → última execução
 *   POST /rodar  → confere agora (pendente→processada se baixado; processada→pendente se desfeito)
 * Ver services/conferenciaSolicitacoesTotvs.js.
 */
import express from 'express';
import { status, rodar } from '../services/conferenciaSolicitacoesTotvs.js';

const router = express.Router();

router.get('/status', (_req, res) => res.json(status()));

router.post('/rodar', async (req, res) => {
  try {
    const r = await rodar({ limite: Number(req.body?.limite) || 400 });
    res.status(r.ok ? 200 : 409).json(r);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

export default router;
