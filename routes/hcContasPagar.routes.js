// ============================================================================
// /api/hc/contas-pagar — HEADCOACH › CONTAS A PAGAR (services/hcContasPagar.js).
// Exige login; o módulo é só para owner, admin e financeiro.
//   GET  /opcoes                        empresas, formas, tipos de documento, despesas, portadores, centros de custo
//   GET  /fornecedores?q=               busca no cadastro local (código, CPF/CNPJ ou nome)
//   GET  /titulos?empresa&campoData&de&ate&situacao&fornecedor&duplicata&documentoFiscal&despesa&centroCusto&portador&forma&previsao
//   POST /titulos                       inclui a duplicata (uma ou várias parcelas)
//   GET  /titulos/:id                   detalhe (parcelas do mesmo lote, baixas, link do anexo)
//   PUT  /titulos/:id                   altera (só em aberto)
//   POST /titulos/:id/baixar            { dataPagamento, juros, multa, desconto, formaPagamento, conta, observacao, senha }  (sem estorno)
//   POST /titulos/:id/cancelar          { motivo, senha }  (só em aberto)
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import { CpError, opcoes, buscarFornecedores, listarTitulos, criarTitulos, duplicatasDoFornecedor, detalheTitulo, editarTitulo, baixarTitulo, cancelarTitulo } from '../services/hcContasPagar.js';

const router = express.Router();
router.use(requireAuth);

const rota = (fn, msg) =>
  asyncHandler(async (req, res) => {
    try {
      const r = await fn(req);
      return successResponse(res, r, typeof msg === 'function' ? msg(r) : msg);
    } catch (err) {
      if (err instanceof CpError) return errorResponse(res, err.message, err.status, err.code);
      console.error('[hc/contas-pagar]', err);
      return errorResponse(res, err.message || 'Erro no contas a pagar', 500, 'HC_CP');
    }
  });

router.get('/opcoes', rota((req) => opcoes(req.user), 'Opções'));
router.get('/fornecedores', rota(async (req) => ({ fornecedores: await buscarFornecedores(req.user, req.query?.q) }), 'Fornecedores'));
router.get('/duplicatas', rota((req) => duplicatasDoFornecedor(req.user, req.query || {}), 'Duplicatas do fornecedor'));
router.get('/titulos', rota((req) => listarTitulos(req.user, req.query || {}), 'Duplicatas'));
router.post('/titulos', rota((req) => criarTitulos(req.user, req.body || {}), (r) => `${r.titulos.length} duplicata(s) incluída(s)`));
router.get('/titulos/:id', rota((req) => detalheTitulo(req.user, req.params.id), 'Duplicata'));
router.put('/titulos/:id', rota((req) => editarTitulo(req.user, req.params.id, req.body || {}), 'Duplicata alterada'));
router.post('/titulos/:id/baixar', rota((req) => baixarTitulo(req.user, req.params.id, req.body || {}), 'Duplicata baixada'));
router.post('/titulos/:id/cancelar', rota((req) => cancelarTitulo(req.user, req.params.id, req.body || {}), 'Duplicata cancelada'));

export default router;
