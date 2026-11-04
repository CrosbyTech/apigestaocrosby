/**
 * /api/pix-tadeu — Pix recebidos na Pagar.me fora do HeadCoach (links/Gerador do Dryland)
 *   GET  /status            → contas, última execução
 *   GET  /previa?dias=30    → Pix pagos lidos e interpretados (não grava); &bruto=1 mostra 5 pedidos crus
 *   POST /sincronizar       → cria as Solicitações de Baixa dos Pix novos
 * Ver services/pixTadeuPagarme.js.
 */
import express from 'express';
import { status, listar, rodar, listarChargesPix } from '../services/pixTadeuPagarme.js';

const router = express.Router();

router.get('/status', (_req, res) => res.json(status()));

router.get('/diag-charges', async (req, res) => {
  try { res.json(await listarChargesPix({ dias: Number(req.query.dias) || undefined, q: req.query.q || '' })); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/previa', async (req, res) => {
  try {
    res.json(await listar({ dias: Number(req.query.dias) || undefined, bruto: req.query.bruto === '1', todas: req.query.todas === '1', q: req.query.q || '' }));
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
