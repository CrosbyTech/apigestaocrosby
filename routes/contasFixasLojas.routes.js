// ============================================================================
// /api/contas-fixas-lojas — FINANCEIRO › CONTAS A PAGAR › CONTAS FIXAS DAS LOJAS
// (services/contasFixasLojas.js). Exige login; alterar é só para financeiro, admin e owner.
//   GET    /planilha?mes=AAAA-MM   a planilha do mês: loja × despesa, com o cadastro, como pegar e o que houve no mês
//   GET    /lojas                  cadastro das lojas e imóveis
//   POST   /lojas                  { cdFilial, nome, tipo, … } nova loja / imóvel
//   PUT    /lojas/:cd              altera os dados da loja
//   POST   /despesas               { cdFilial, tipo, fornecedor, fornecedorCode, vencimentoDia, formaPagamento, comoPegarCanal, comoPegar, observacao, contratoVencimento }
//   PUT    /despesas/:id           altera a despesa
//   DELETE /despesas/:id           exclui a despesa do cadastro
//   PUT    /anotacoes              { cdFilial, coluna, naoSeAplica, soCadastro, observacao } anotação e regras da célula
//   POST   /atualizar-totvs        { de, ate } (AAAA-MM, até 2026-10) relê do TOTVS os títulos dos meses antigos, em segundo plano
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import { ContasFixasError, planilhaDoMes, lojasDoCadastro, salvarLoja, criarDespesa, alterarDespesa, excluirDespesa, anotarCelula, atualizarDoTotvs } from '../services/contasFixasLojas.js';

const router = express.Router();
router.use(requireAuth);

const rota = (fn, msg) =>
  asyncHandler(async (req, res) => {
    try {
      const r = await fn(req);
      return successResponse(res, r, typeof msg === 'function' ? msg(r) : msg);
    } catch (err) {
      if (err instanceof ContasFixasError) return errorResponse(res, err.message, err.status, err.code);
      console.error('[contas-fixas-lojas]', err);
      return errorResponse(res, err.message || 'Erro nas contas fixas das lojas', 500, 'CONTAS_FIXAS');
    }
  });

router.get('/planilha', rota((req) => planilhaDoMes({ mes: req.query.mes || null, user: req.user }), (r) => `Contas fixas de ${r.mes}: ${r.lojas.length} loja(s)`));
router.get('/lojas', rota(() => lojasDoCadastro(), (r) => `${r.lojas.length} loja(s)`));
router.post('/lojas', rota((req) => salvarLoja(req.user, req.body?.cdFilial, req.body || {}, { nova: true }), 'Loja cadastrada'));
router.put('/lojas/:cd', rota((req) => salvarLoja(req.user, req.params.cd, req.body || {}), 'Loja atualizada'));
router.post('/despesas', rota((req) => criarDespesa(req.user, req.body || {}), 'Despesa cadastrada'));
router.put('/despesas/:id', rota((req) => alterarDespesa(req.user, req.params.id, req.body || {}), 'Despesa atualizada'));
router.delete('/despesas/:id', rota((req) => excluirDespesa(req.user, req.params.id), 'Despesa excluída'));
router.put('/anotacoes', rota((req) => anotarCelula(req.user, req.body || {}), 'Anotação salva'));
router.post('/atualizar-totvs', rota((req) => atualizarDoTotvs(req.user, req.body || {}), (r) => (r.iniciado ? 'Atualização pelo TOTVS iniciada (leva cerca de 1 minuto)' : 'Já há uma atualização pelo TOTVS em andamento')));

export default router;
