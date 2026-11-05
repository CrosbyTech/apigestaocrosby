/**
 * /api/fluxo-saldos — aba Fluxo de Saldos (saldo em dinheiro por loja/dia,
 * sangria e pedido de retirada). Ver services/fluxoSaldos.js.
 *   GET  /lojas                 → lojas configuradas
 *   GET  /?dia=AAAA-MM-DD        → saldos por loja (dinheiro do dia pendente)
 *   GET  /partida               → saldo de partida (contado) por loja
 *   POST /partida               → define o saldo contado de uma loja
 *   GET  /sangrias?dias=30       → pedidos de retirada
 *   POST /sangrias              → cria pedido de retirada (registro)
 *   POST /sangrias/:id/status    → aprova/rejeita/etc. (registro)
 *   POST /simular-sangria        → calcula a sangria de um saldo (sem gravar)
 */
import express from 'express';
import {
  LOJAS, calcularSangria, saldos, listarPartida, setPartida,
  listarSangrias, criarSangria, atualizarSangriaStatus,
} from '../services/fluxoSaldos.js';

const router = express.Router();

router.get('/lojas', (_req, res) => res.json({ lojas: LOJAS }));

router.get('/', async (req, res) => {
  try { res.json(await saldos({ dia: req.query.dia })); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/partida', async (_req, res) => {
  try { res.json(await listarPartida()); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/partida', async (req, res) => {
  try {
    const { cd_empresa, saldo, contado_em, user_nome } = req.body || {};
    if (cd_empresa == null || saldo == null) return res.status(400).json({ erro: 'cd_empresa e saldo são obrigatórios' });
    res.json(await setPartida({ cd_empresa, saldo, contado_em, user_nome }));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/sangrias', async (req, res) => {
  try { res.json(await listarSangrias({ dias: Number(req.query.dias) || undefined })); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/sangrias', async (req, res) => {
  try {
    const { cd_empresa, valor, data, solicitado_por, observacao } = req.body || {};
    if (cd_empresa == null || valor == null) return res.status(400).json({ erro: 'cd_empresa e valor são obrigatórios' });
    res.status(201).json(await criarSangria({ cd_empresa, valor, data, solicitado_por, observacao }));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/sangrias/:id/status', async (req, res) => {
  try {
    const { status, aprovado_por } = req.body || {};
    res.json(await atualizarSangriaStatus({ id: req.params.id, status, aprovado_por }));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/simular-sangria', (req, res) => {
  const s = Number(req.body?.saldo);
  if (!Number.isFinite(s)) return res.status(400).json({ erro: 'saldo inválido' });
  res.json(calcularSangria(s));
});

export default router;
