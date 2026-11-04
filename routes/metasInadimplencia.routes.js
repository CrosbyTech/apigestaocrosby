/**
 * /api/metas-inadimplencia — snapshot da aba Metas Inadimplência (lê do banco
 * do HeadCoach; gerar reprocessa do TOTVS). Ver services/metasInadimplenciaSnapshot.js.
 *   GET  /            → snapshot salvo (rápido). 404 se ainda não há snapshot.
 *   GET  /status      → última geração / estado do job
 *   POST /gerar       → reprocessa agora (botão "Atualizar dados"); ?bg=1 roda em 2º plano
 */
import express from 'express';
import { obter, gerar, status } from '../services/metasInadimplenciaSnapshot.js';

const router = express.Router();

router.get('/status', (_req, res) => res.json(status()));

router.get('/', async (_req, res) => {
  try {
    const p = await obter();
    if (!p) return res.status(404).json({ erro: 'sem snapshot ainda — rode POST /api/metas-inadimplencia/gerar' });
    res.json(p);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/gerar', async (req, res) => {
  const opts = { dtInicio: req.body?.dtInicio, dtFim: req.body?.dtFim };
  if (req.query.bg === '1' || req.body?.bg) {
    gerar(opts).catch(() => {});
    return res.status(202).json({ ok: true, iniciado: true, mensagem: 'Gerando em segundo plano — recarregue em ~alguns minutos.' });
  }
  try {
    const r = await gerar(opts);
    res.status(r.ok ? 200 : 409).json(r);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

export default router;
