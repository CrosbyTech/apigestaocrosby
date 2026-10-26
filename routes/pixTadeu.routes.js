/**
 * /api/pix-tadeu — Pix recebidos na Pagar.me fora do HeadCoach (links/Gerador do Dryland)
 *   GET  /status            → contas, última execução
 *   GET  /previa?dias=30    → Pix pagos lidos e interpretados (não grava); &bruto=1 mostra 5 pedidos crus
 *   POST /sincronizar       → cria as Solicitações de Baixa dos Pix novos
 * Ver services/pixTadeuPagarme.js.
 */
import express from 'express';
import { status, listar, rodar } from '../services/pixTadeuPagarme.js';

const router = express.Router();

router.get('/status', (_req, res) => res.json(status()));

router.get('/previa', async (req, res) => {
  try {
    res.json(await listar({ dias: Number(req.query.dias) || undefined, bruto: req.query.bruto === '1' }));
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.post('/sincronizar', async (req, res) => {
  try {
    const r = await rodar({ dias: Number(req.body?.dias) || undefined });
    res.status(r.ok ? 200 : 409).json(r);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

export default router;
