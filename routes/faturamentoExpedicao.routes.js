// ============================================================================
// FATURAMENTO DA EXPEDIÇÃO — montado em /api/faturamento-expedicao
// NF-e pelo HeadCoach (empresa 99) + documento interno e contas a receber no
// TOTVS (empresa 990). Ver services/faturamentoExpedicao.js.
//
//   GET  /preparar/:chave             sugestões do pedido (cliente, transporte, pagamento, comprovantes)
//   POST /previa                      { clienteCode, consumidorFinal, itens[] } cenário fiscal + CFOP por item
//   POST /autorizar-desconto          senha de owner/admin/financeiro libera desconto acima de 20%
//   POST /faturar                     registra a venda, emite a NF-e e espelha no TOTVS
//   POST /vendas/:vendaId/reprocessar tenta de novo o que faltou (NF-e rejeitada / caixa fechado)
//   POST /vendas/:vendaId/duplicata          gera e envia a duplicata (boleto) — { forcar } reenvia
//   POST /vendas/:vendaId/duplicata/conferir confere a assinatura no Autentique
//   GET  /vendas/:vendaId/duplicata/pdf      PDF da duplicata para conferir (não envia)
//   POST /vendas/:vendaId/minuta             pede a minuta ao robô do Dryland { tipo, servico }
//   GET  /transacoes?de=&ate=&busca=  aba Transações (com minuta e duplicata)
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
  listarCartoes,
  FaturamentoError,
} from '../services/faturamentoExpedicao.js';
import { FiscalError } from '../services/pdvFiscal.js';
import { verificarSenhaAutorizador, AutorizacaoError } from '../services/autorizacaoSenha.js';
import { enviarDuplicata, conferirAssinaturas, dadosDaDuplicata, pdfDaDuplicata, textoDaDuplicata, DuplicataError } from '../services/faturamentoDuplicata.js';
import { pedirMinuta, MinutaError } from '../services/faturamentoLogistica.js';

const router = express.Router();

function falha(res, err) {
  if (err instanceof FaturamentoError) return errorResponse(res, err.message, err.status || 400, err.code);
  if (err instanceof DuplicataError || err instanceof MinutaError) return errorResponse(res, err.message, err.status || 400, err.code);
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

// Operadoras e parcelamentos de cartão do cadastro do TOTVS (para a tela)
router.get(
  '/cartoes',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await listarCartoes(), 'Cartões do TOTVS');
    } catch (err) {
      return falha(res, err);
    }
  }),
);

// Desconto no faturamento acima do limite livre (20%): owner, admin ou
// financeiro digita e-mail + senha do HeadCoach para liberar
router.post(
  '/autorizar-desconto',
  asyncHandler(async (req, res) => {
    const { email, senha, pct, pedido, por } = req.body || {};
    try {
      const autorizador = await verificarSenhaAutorizador(email, senha, ['owner', 'admin', 'user']);
      console.log(`🔓 [Faturamento] desconto de ${pct ?? '?'}% liberado por ${autorizador.email} (${autorizador.role}) para ${por || '?'} no pedido ${pedido ?? '?'}`);
      return successResponse(res, autorizador, 'Desconto liberado');
    } catch (err) {
      if (err instanceof AutorizacaoError) return errorResponse(res, err.message, err.status, err.code);
      throw err;
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

// ─── Duplicata (venda com boleto): gera, manda assinar e avisa no WhatsApp ───
router.post(
  '/vendas/:vendaId/duplicata',
  asyncHandler(async (req, res) => {
    try {
      const r = await enviarDuplicata(parseInt(req.params.vendaId, 10), { por: req.body?.por || null, forcar: !!req.body?.forcar });
      const msg = r.naoSeAplica ? 'Venda sem boleto: não tem duplicata' : r.jaEnviada ? 'A duplicata já tinha sido enviada' : r.emAndamento ? 'A duplicata já está sendo enviada' : `Duplicata enviada para ${r.telefone}`;
      return successResponse(res, r, msg);
    } catch (err) {
      return falha(res, err);
    }
  }),
);
// confere agora no Autentique se o cliente já assinou
router.post(
  '/vendas/:vendaId/duplicata/conferir',
  asyncHandler(async (req, res) => {
    try {
      const r = await conferirAssinaturas({ vendaId: parseInt(req.params.vendaId, 10) });
      return successResponse(res, r, r.assinadas ? 'Duplicata assinada' : 'Ainda sem assinatura');
    } catch (err) {
      return falha(res, err);
    }
  }),
);
// PDF da duplicata para conferir (não envia nada)
router.get(
  '/vendas/:vendaId/duplicata/pdf',
  asyncHandler(async (req, res) => {
    try {
      const dados = await dadosDaDuplicata(parseInt(req.params.vendaId, 10));
      if (req.query.texto === '1') return successResponse(res, { texto: textoDaDuplicata(dados, 'https://assina.ae/EXEMPLO'), telefone: dados.telefone }, 'Texto da mensagem');
      const pdf = await pdfDaDuplicata(dados);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="duplicata-nf-${dados.nf}.pdf"`);
      return res.send(pdf);
    } catch (err) {
      return falha(res, err);
    }
  }),
);

// ─── Minuta: pede ao robô do Dryland (Correios / LATAM / Azul) ───────────────
router.post(
  '/vendas/:vendaId/minuta',
  asyncHandler(async (req, res) => {
    try {
      const b = req.body || {};
      const r = await pedirMinuta(parseInt(req.params.vendaId, 10), { tipo: b.tipo, servico: b.servico, altura: b.altura, largura: b.largura, comprimento: b.comprimento, por: b.por || null });
      return successResponse(res, r, 'Minuta pedida ao robô do Dryland — a etiqueta/AWB aparece aqui em até 10 minutos');
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
