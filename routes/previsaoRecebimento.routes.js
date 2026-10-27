/**
 * /api/previsao-recebimento — Fluxo de Recebíveis / Previsão de Recebimento (João, 27/10/2026)
 *   GET  /?semana=0[&refresh=1]   → semana (sáb–sex), clientes com SIM/TALVEZ/NÃO, por dia, recebido
 *   POST /marcar { cd_cliente, status: sim|talvez|nao|auto, por, motivo }
 *   GET  /historico               → previsto por status nas semanas guardadas
 * Ver services/previsaoRecebimento.js.
 */
import express from 'express';
import { obter, marcar, historicoSemanas, invalidar } from '../services/previsaoRecebimento.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.json(await obter({ semana: Number(req.query.semana) || 0, refresh: req.query.refresh === '1' }));
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.post('/marcar', async (req, res) => {
  try {
    res.json(await marcar(req.body || {}));
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});

router.get('/historico', async (_req, res) => {
  try {
    res.json({ ok: true, semanas: await historicoSemanas(Number(_req.query?.limite) || 8) });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.post('/invalidar', (_req, res) => {
  invalidar();
  res.json({ ok: true });
});

export default router;
