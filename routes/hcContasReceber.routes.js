// ============================================================================
// /api/hc/contas-receber — HEADCOACH › CONTAS A RECEBER (services/hcContasReceber.js). Exige login.
//   GET  /empresas                      empresas que o usuário vê
//   GET  /titulos?empresa&campoData&de&ate&situacao&forma&portador&conciliacao&fatura&cliente
//   GET  /titulos/:id                   detalhe (parcelas da fatura, baixas, conciliação)
//   POST /titulos/:id/baixar            { dataPagamento, juros, multa, desconto, formaRecebimento, conta, observacao, senha }  (owner/admin/financeiro; sem estorno)
//   GET  /conciliacao?empresa&ate       cartão e Pix a conciliar (D+1), agrupados
//   POST /conciliacao                   { empresa, dataLiquidacao, forma, portador, valorRecebido, observacao }  (owner/admin/financeiro)
//   GET  /config  ·  PUT /config        taxas, juros, multa e dias de liquidação
//   POST /gerar                         gera os títulos que faltam (owner/admin)
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import {
  CrError,
  FORMAS,
  empresas,
  listarTitulos,
  detalheTitulo,
  baixarTitulo,
  pendentesConciliacao,
  conciliar,
  lerConfig,
  salvarConfig,
  gerarTitulosPendentes,
} from '../services/hcContasReceber.js';

const router = express.Router();
router.use(requireAuth);

const rota = (fn, msg) =>
  asyncHandler(async (req, res) => {
    try {
      const r = await fn(req);
      return successResponse(res, r, typeof msg === 'function' ? msg(r) : msg);
    } catch (err) {
      if (err instanceof CrError) return errorResponse(res, err.message, err.status, err.code);
      console.error('[hc/contas-receber]', err);
      return errorResponse(res, err.message || 'Erro no contas a receber', 500, 'HC_CR');
    }
  });

router.get('/empresas', rota(async (req) => ({ empresas: await empresas(req.user), formas: FORMAS }), 'Empresas'));
router.get('/titulos', rota((req) => listarTitulos(req.user, req.query || {}), 'Títulos'));
router.get('/titulos/:id', rota((req) => detalheTitulo(req.user, req.params.id), 'Título'));
router.post('/titulos/:id/baixar', rota((req) => baixarTitulo(req.user, req.params.id, req.body || {}), 'Título baixado'));
router.get('/conciliacao', rota((req) => pendentesConciliacao(req.user, req.query || {}), 'Conciliação'));
router.post('/conciliacao', rota((req) => conciliar(req.user, req.body || {}), (c) => `Conciliado: ${c.qtd_titulos} título(s), taxa R$ ${Number(c.taxa).toFixed(2).replace('.', ',')}`));
router.get('/config', rota(() => lerConfig(), 'Configuração'));
router.put('/config', rota((req) => salvarConfig(req.user, req.body || {}), 'Configuração salva'));
router.post(
  '/gerar',
  rota(
    async (req) => {
      if (!['owner', 'admin'].includes(req.user?.role)) throw new CrError('Só owner ou admin', 'SEM_PERMISSAO', 403);
      return gerarTitulosPendentes({ todas: !!req.body?.todas });
    },
    (r) => `${r.titulosCriados} título(s) gerado(s) em ${r.vendasComTitulos} venda(s)`,
  ),
);

export default router;
