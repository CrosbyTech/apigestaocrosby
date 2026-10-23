/**
 * /api/dryland-baixas — ponte das Solicitações de Baixa do link do Dryland.
 *   GET  /status        → configurado?, última execução, contagens
 *   GET  /dryland       → lista crua do Dryland (p/ conferência), ?dias=60
 *   POST /sincronizar   → roda agora (espelha novas + devolve status)
 * Ver services/drylandBaixas.js.
 */
import express from 'express';
import { status, listarDryland, sincronizar } from '../services/drylandBaixas.js';

const router = express.Router();

router.get('/status', async (_req, res) => {
  try {
    res.json(await status());
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
});

router.get('/dryland', async (req, res) => {
  try {
    res.json(await listarDryland({ dias: req.query.dias }));
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
});

router.post('/sincronizar', async (req, res) => {
  try {
    res.json(await sincronizar({ dias: req.body?.dias || req.query.dias }));
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
});

export default router;
