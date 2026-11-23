// ============================================================================
// /api/hc/contas-pagar — HEADCOACH › CONTAS A PAGAR (services/hcContasPagar.js).
// Exige login; o módulo é só para owner, admin e financeiro.
//   GET  /opcoes                        empresas, formas, tipos de documento, despesas, portadores, centros de custo
//   GET  /fornecedores?q=               busca no cadastro local (código, CPF/CNPJ ou nome)
//   GET  /titulos?empresa&campoData&de&ate&situacao&fornecedor&duplicata&documentoFiscal&despesa&centroCusto&portador&forma&previsao&origem
//                                       situacao: aberto | vencido | a_vencer | parcial | pago (inclui o já pago das parciais) | cancelado
//   POST /titulos                       inclui a duplicata (uma ou várias parcelas)
//   GET  /titulos/:id                   detalhe (parcelas do mesmo lote, baixas, link do anexo)
//   PUT  /titulos/:id                   altera (só em aberto)
//   POST /titulos/:id/baixar            { dataPagamento, valorPago?, juros, multa, desconto, formaPagamento, conta, observacao, senha }  (sem estorno)
//                                       valorPago em branco = tudo o que falta; menor = BAIXA PARCIAL (continua em aberto pelo restante)
//   POST /titulos/:id/cancelar          { motivo, senha }  (só em aberto)
//   POST /solicitacoes/:id/enviar       Solicitação Crosby aprovada → duplicata no contas a pagar (financeiro ou setor FINANCEIRO)
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import { enviarSolicitacaoAoCp } from '../services/solicitacaoContasPagar.js';
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
router.post('/titulos/:id/baixar', rota((req) => baixarTitulo(req.user, req.params.id, req.body || {}), (r) => (r.baixaParcial ? `Baixa parcial lançada — falta pagar R$ ${Number(r.faltaPagar).toFixed(2).replace('.', ',')}` : 'Duplicata baixada')));
router.post('/titulos/:id/cancelar', rota((req) => cancelarTitulo(req.user, req.params.id, req.body || {}), 'Duplicata cancelada'));
// Solicitações Crosby: o "Enviar ao Contas a Pagar HC" (no lugar do antigo envio ao TOTVS)
router.post('/solicitacoes/:id/enviar', rota((req) => enviarSolicitacaoAoCp(req.user, req.params.id), (r) => (r.jaEnviada ? `Esta solicitação já estava no contas a pagar (duplicata ${r.rotulo})` : `Solicitação enviada ao contas a pagar — duplicata ${r.rotulo}`)));

export default router;
