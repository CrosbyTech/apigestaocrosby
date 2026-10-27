/**
 * /api/portal-boletos — boletos e Pix da Pagar.me para o Portal de Títulos (João, 27/10/2026)
 *   POST /por-titulos { titulos: [{cd_empresa, nr_fatura, nr_parcela}] } → mapa chave→boleto vivo
 *   POST /pix { cd_empresa, nr_fatura, nr_parcela, cd_cliente, nm_cliente, documento, vl_fatura, conta }
 * Ver services/portalBoletos.js.
 */
import express from 'express';
import { boletosPorTitulos, gerarPix } from '../services/portalBoletos.js';

const router = express.Router();

router.post('/por-titulos', async (req, res) => {
  try {
    res.json({ ok: true, boletos: await boletosPorTitulos(req.body?.titulos || []) });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.post('/pix', async (req, res) => {
  try {
    res.json(await gerarPix(req.body || {}));
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});

export default router;
