// ============================================================================
// FATURAMENTO DA EXPEDIÇÃO — montado em /api/faturamento-expedicao
// NF-e pelo HeadCoach (empresa 99) + documento interno e contas a receber no
// TOTVS. Ver services/faturamentoExpedicao.js.
//
//   GET  /preparar/:chave             sugestões do pedido (cliente, transporte, pagamento, comprovantes)
//   POST /previa                      { clienteCode, consumidorFinal, itens[] } cenário fiscal + CFOP por item
//   POST /faturar                     registra a venda, emite a NF-e e espelha no TOTVS
//   POST /vendas/:vendaId/reprocessar tenta de novo o que faltou (NF-e rejeitada / caixa fechado)
//   GET  /transacoes?de=&ate=&busca=  aba Transações
//   GET  /transacoes/:id              detalhe com o kardex RFID
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import {
  prepararFaturamento,
  previaFiscal,
  faturar,
  processarFaturamento,
  listarTransacoes,
  detalheTransacao,
  FaturamentoError,
} from '../services/faturamentoExpedicao.js';
import { FiscalError } from '../services/pdvFiscal.js';

const router = express.Router();

function falha(res, err) {
  if (err instanceof FaturamentoError) return errorResponse(res, err.message, err.status || 400, err.code);
  if (err instanceof FiscalError) return errorResponse(res, err.message, 422, err.code);
  return errorResponse(res, err?.message || 'Erro no faturamento', 500, 'FATURAMENTO_ERROR');
}

router.get(
  '/preparar/:chave',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await prepararFaturamento(String(req.params.chave)), 'Pedido pronto para faturar');
    } catch (err) {
      return falha(res, err);
    }
  }),
);

router.post(
  '/previa',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await previaFiscal(req.body || {}), 'Prévia fiscal');
    } catch (err) {
      return falha(res, err);
    }
  }),
);

router.post(
  '/faturar',
  asyncHandler(async (req, res) => {
    try {
      const r = await faturar(req.body || {});
      const ok = r.fiscal.ok && r.totvs.ok;
      const msg = ok
        ? `NF-e ${r.nota?.numero}/${r.nota?.serie} autorizada e documento interno ${r.totvs.transactionCode} no TOTVS`
        : !r.fiscal.ok
          ? `NF-e não autorizada: ${r.fiscal.mensagem}`
          : `NF-e autorizada, mas o TOTVS não recebeu: ${r.totvs.mensagem}`;
      return successResponse(res, r, msg, ok ? 200 : 207);
    } catch (err) {
      return falha(res, err);
    }
  }),
);

router.post(
  '/vendas/:vendaId/reprocessar',
  asyncHandler(async (req, res) => {
    try {
      const r = await processarFaturamento(parseInt(req.params.vendaId, 10), null, { terminal: req.body?.terminal, comoFatura: req.body?.comoFatura, operacaoDocInterno: req.body?.operacaoDocInterno });
      const ok = r.fiscal.ok && r.totvs.ok;
      return successResponse(res, r, ok ? 'Faturamento concluído' : r.fiscal.ok ? `TOTVS: ${r.totvs.mensagem}` : `NF-e: ${r.fiscal.mensagem}`, ok ? 200 : 207);
    } catch (err) {
      return falha(res, err);
    }
  }),
);

router.get(
  '/transacoes',
  asyncHandler(async (req, res) => {
    try {
      const l = await listarTransacoes(req.query);
      return successResponse(res, l, `${l.length} transação(ões)`);
    } catch (err) {
      return falha(res, err);
    }
  }),
);

router.get(
  '/transacoes/:id',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await detalheTransacao(parseInt(req.params.id, 10)), 'Transação');
    } catch (err) {
      return falha(res, err);
    }
  }),
);

export default router;
