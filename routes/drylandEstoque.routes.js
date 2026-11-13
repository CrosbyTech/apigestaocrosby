// ============================================================================
// /api/dryland-estoque — ESTOQUE DO DRYLAND (só consulta; services/drylandEstoque.js).
// Exige login. O saldo do estq_gw é o da LOJA VIRTUAL (Max + PE + Brejinho, empresa
// 99): só vê quem enxerga a 99 (utils/empresasUsuario.js). Lojas físicas não vêm daqui.
//   GET /status                      token configurado? porta respondendo?
//   GET /ajuda | /operacoes | /grupos
//   GET /manual?id=
//   GET /resumo?forcar=1             totais (Max, PE, Brejinho) e por classificação
//   GET /saldo?cod&busca&grupo&subgrupo&classificacao&so_com_saldo&limite&offset
//   GET /movimentos?cod&desde&limite&offset
//   GET /fila?id=                    pedidos do HeadCoach na fila do Estoquista (sem restrição de loja)
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import { empresasRestritasDoUsuario } from '../utils/empresasUsuario.js';
import { EstoqueDrylandError, EMPRESA_DO_ESTOQUE, podeVerEstoque, status, ajuda, operacoes, grupos, manual, saldo, movimentos, minhaFila, resumo } from '../services/drylandEstoque.js';

const router = express.Router();
router.use(requireAuth);

const rota = (fn, msg) =>
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await fn(req), msg);
    } catch (err) {
      if (err instanceof EstoqueDrylandError) return errorResponse(res, err.message, err.status, err.code);
      console.error('[dryland-estoque]', err?.message);
      return errorResponse(res, err.message || 'Erro no estoque do Dryland', 500, 'ESTOQUE_DRYLAND');
    }
  });

// o estoque do estq_gw é o da Loja Virtual (empresa 99): só quem enxerga a 99
const exigeEmpresa99 = async (req) => {
  const empresas = await empresasRestritasDoUsuario(req.user);
  if (!podeVerEstoque(empresas)) throw new EstoqueDrylandError(`Este é o estoque da Loja Virtual (empresa ${EMPRESA_DO_ESTOQUE}); você não tem acesso a essa empresa.`, 'SEM_ACESSO_EMPRESA', 403);
};
const comTrava = (fn) => async (req) => {
  await exigeEmpresa99(req);
  return fn(req);
};

const soSemRestricao = async (req) => {
  const empresas = await empresasRestritasDoUsuario(req.user);
  if (empresas) throw new EstoqueDrylandError('Só quem enxerga todas as lojas pode ver a fila de pedidos do estoque', 'SEM_PERMISSAO', 403);
};

router.get('/status', rota(() => status(), 'Situação do estoque do Dryland'));
router.get('/ajuda', rota(() => ajuda(), 'Ações do estoque'));
router.get('/operacoes', rota(() => operacoes(), 'Operações do estoque'));
router.get('/grupos', rota(() => grupos(), 'Grupos de produto'));
router.get('/manual', rota((req) => manual(req.query.id || null), 'Manual do estoque'));
router.get('/resumo', rota(comTrava((req) => resumo({ forcar: req.query.forcar === '1' })), 'Resumo do estoque da Loja Virtual'));
router.get('/saldo', rota(comTrava((req) => saldo(req.query)), 'Saldo do estoque'));
router.get('/movimentos', rota(comTrava((req) => movimentos(req.query)), 'Movimentos do produto'));
router.get(
  '/fila',
  rota(async (req) => {
    await soSemRestricao(req);
    return minhaFila(req.query.id || null);
  }, 'Fila de pedidos do estoque'),
);

export default router;
