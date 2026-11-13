// ============================================================================
// /api/hc/caixa — HEADCOACH › CAIXA (services/hcCaixa.js). Exige login.
//   GET  /empresas                         empresas que o usuário opera
//   GET  /situacao?empresa                 data de caixa, caixa aberto (com o resumo), caixas do dia
//   POST /abrir                            { empresa, fundoInicial, observacao, encerrarAnterior }
//   (um caixa por empresa — sem terminal)
//   POST /:id/movimentos                   { tipo: suprimento|retirada, valor, motivo, senha (retirada) }
//   POST /movimentos/:movId/estornar       { motivo, senha }
//   POST /:id/contagem                     { dinheiroContado, formas: { pix: 120, … }, observacao }  (travada depois de salva)
//   POST /:id/contagem/reabrir             { autorizador: { email, senha }, motivo }  (owner/admin/financeiro)
//   POST /:id/fechar                       { fundoFinal, destinoRetirada, observacao, senha }
//   POST /:id/reabrir                      { motivo, senha }  (owner/admin)
//   GET  /:id                              detalhe/resumo de um caixa (comprovante)
//   GET  /historico?empresa&de&ate         caixas da empresa
//   GET  /encerramento?empresa             verificação do encerramento diário
//   POST /encerrar                         { empresa, proximaData, autorizador: { email, senha } }
//   POST /voltar-data                      { empresa, novaData, motivo, senha }  (owner/admin/financeiro)
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import {
  CaixaError,
  CEDULAS,
  FORMAS,
  empresasDoUsuario,
  situacao,
  abrirCaixa,
  lancarMovimento,
  estornarMovimento,
  registrarContagem,
  reabrirContagem,
  voltarData,
  fecharCaixa,
  reabrirCaixa,
  detalheCaixa,
  listarCaixas,
  verificarEncerramento,
  encerrarDia,
} from '../services/hcCaixa.js';

const router = express.Router();
router.use(requireAuth);

const responder = (res, err) => {
  if (err instanceof CaixaError) return errorResponse(res, err.message, err.status, err.code);
  console.error('[hc/caixa]', err);
  return errorResponse(res, err.message || 'Erro no caixa', 500, 'HC_CAIXA');
};
const rota = (fn, msg) =>
  asyncHandler(async (req, res) => {
    try {
      const r = await fn(req);
      return successResponse(res, r, typeof msg === 'function' ? msg(r) : msg);
    } catch (err) {
      return responder(res, err);
    }
  });

router.get('/empresas', rota(async (req) => ({ empresas: await empresasDoUsuario(req.user), cedulas: CEDULAS, formas: FORMAS }), 'Empresas'));
router.get('/situacao', rota((req) => situacao(req.user, req.query.empresa), 'Situação do caixa'));
router.get('/historico', rota((req) => listarCaixas(req.user, req.query || {}), 'Caixas'));
router.get('/encerramento', rota((req) => verificarEncerramento(req.user, req.query.empresa), 'Verificação do encerramento'));
router.post('/abrir', rota((req) => abrirCaixa(req.user, req.body || {}), (c) => `Caixa #${c.id} aberto`));
router.post('/encerrar', rota((req) => encerrarDia(req.user, req.body || {}), (e) => `Dia encerrado: data de caixa agora é ${String(e.proxima_data).split('-').reverse().join('/')}`));
router.post('/voltar-data', rota((req) => voltarData(req.user, req.body || {}), (e) => `Data de caixa voltou para ${String(e.proxima_data).split('-').reverse().join('/')}`));
router.post('/movimentos/:movId/estornar', rota((req) => estornarMovimento(req.user, req.params.movId, req.body || {}), 'Movimento estornado'));
router.post('/:id/movimentos', rota((req) => lancarMovimento(req.user, req.params.id, req.body || {}), (m) => (m.tipo === 'suprimento' ? 'Suprimento lançado' : 'Retirada lançada')));
router.post('/:id/contagem', rota((req) => registrarContagem(req.user, req.params.id, req.body || {}), 'Contagem salva'));
router.post('/:id/contagem/reabrir', rota((req) => reabrirContagem(req.user, req.params.id, req.body || {}), 'Contagem reaberta'));
router.post('/:id/fechar', rota((req) => fecharCaixa(req.user, req.params.id, req.body || {}), 'Caixa fechado'));
router.post('/:id/reabrir', rota((req) => reabrirCaixa(req.user, req.params.id, req.body || {}), 'Caixa reaberto'));
router.get('/:id', rota((req) => detalheCaixa(req.user, req.params.id), 'Caixa'));

export default router;
