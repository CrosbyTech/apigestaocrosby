// ============================================================================
// /api/inadimplencia-mtm — Venda x Inadimplência por Vendedor (João/BRUCE, 25/11/2026)
//   GET    /painel           foto mais recente + anterior, variação e totais
//   POST   /apurar           refaz a foto da semana em segundo plano
//   GET    /apurar/status    andamento da apuração
//   GET    /ajustes          ajustes válidos (?semana=YYYY-MM-DD: até essa semana)
//   POST   /ajustes          { vendedorCod, tipo: FATURADO|INADIMPLENCIA, valor, motivo, semana? }
//   DELETE /ajustes/:id      exclusão lógica (o histórico fica)
// Tudo exige login. Regras em services/inadimplenciaMtm.js.
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import { InadMtmError, painel, apurarEmSegundoPlano, statusApuracao, listarAjustes, lancarAjuste, excluirAjuste, reaplicarAjustes, VENDEDORES_MTM } from '../services/inadimplenciaMtm.js';

const router = express.Router();
router.use(requireAuth);

const quem = (req) => req.user?.name || req.user?.email || null;
const falha = (res, e) => (e instanceof InadMtmError ? errorResponse(res, e.message, e.status, e.code) : errorResponse(res, e.message, 500, 'INAD_MTM'));

router.get(
  '/painel',
  asyncHandler(async (req, res) => {
    try {
      const p = await painel();
      return successResponse(res, { ...p, apuracao: statusApuracao(), vendedoresMtm: VENDEDORES_MTM }, p.semana ? `Foto da semana ${p.semana}` : 'Ainda não há foto gravada');
    } catch (e) {
      return falha(res, e);
    }
  }),
);

router.post(
  '/apurar',
  asyncHandler(async (req, res) => {
    const r = apurarEmSegundoPlano(`manual:${quem(req) || '?'}`);
    return successResponse(res, r, r.jaRodando ? 'Já tem uma apuração em andamento' : 'Apuração iniciada');
  }),
);

router.get(
  '/apurar/status',
  asyncHandler(async (req, res) => successResponse(res, statusApuracao(), 'Status da apuração')),
);

router.get(
  '/ajustes',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await listarAjustes({ semana: req.query.semana }), 'Ajustes');
    } catch (e) {
      return falha(res, e);
    }
  }),
);

router.post(
  '/ajustes',
  asyncHandler(async (req, res) => {
    try {
      const b = req.body || {};
      const aj = await lancarAjuste({ vendedorCod: b.vendedorCod, tipo: String(b.tipo || '').toUpperCase(), valor: b.valor, motivo: b.motivo, semana: b.semana, usuario: quem(req) });
      const foto = await reaplicarAjustes();
      return successResponse(res, { ajuste: aj, foto }, 'Ajuste lançado');
    } catch (e) {
      return falha(res, e);
    }
  }),
);

router.delete(
  '/ajustes/:id',
  asyncHandler(async (req, res) => {
    try {
      const aj = await excluirAjuste(req.params.id, quem(req));
      const foto = await reaplicarAjustes();
      return successResponse(res, { ajuste: aj, foto }, 'Ajuste excluído');
    } catch (e) {
      return falha(res, e);
    }
  }),
);

export default router;
