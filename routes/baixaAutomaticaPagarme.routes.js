/**
 * /api/baixa-automatica — baixa automática do que entra pela Pagar.me
 * (cartão débito PAGARME, no dia do pagamento). Ver services/baixaAutomaticaPagarme.js.
 *   GET  /status    → ligada?, pendentes, última execução
 *   GET  /previa    → o que seria baixado agora (não toca em nada)
 *   POST /executar  → roda agora (só com PAGARME_BAIXA_AUTO=on)
 */
import express from 'express';
import { status, previa, executar } from '../services/baixaAutomaticaPagarme.js';

const router = express.Router();

router.get('/status', async (_req, res) => {
  try {
    res.json(await status());
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.get('/previa', async (_req, res) => {
  try {
    res.json(await previa());
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.post('/executar', async (req, res) => {
  try {
    const r = await executar({ limite: Number(req.body?.limite) || 100 });
    res.status(r.ok || r.ligada === false ? 200 : 409).json(r);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

export default router;
