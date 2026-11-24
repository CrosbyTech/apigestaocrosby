// ============================================================================
// /api/hc — módulo HEADCOACH (dados do próprio HeadCoach, sem o TOTVS)
//   GET /transacoes          lista com os filtros do TRAFL016 (só leitura)
//                            ?de&ate&empresa&numero&cliente&vendedor&operacao
//                            &valorMin&valorMax&descontoMin&descontoMax
//                            &encerramentoDe&encerramentoAte&tipo=E|S
//                            &situacao=andamento,atendida,cancelada&origem&nf
//                            &pagina&porPagina
//   GET /transacoes/:id      detalhe (V45 = venda 45, D28 = devolução 28)
//   PUT /transacoes/:id/vendedor   troca o vendedor da transação — SÓ OWNER
//                            body: { vendedorCode, vendedorNome, motivo? }
//   GET  /transacoes/:id/duplicata           situação da duplicata (?conferir=1 consulta a assinatura agora)
//   GET  /transacoes/:id/duplicata/pdf       o documento (o assinado, quando já foi assinado)
//   POST /transacoes/:id/duplicata/reenviar  reenvia ao cliente; body { telefone } manda para OUTRO número — SÓ OWNER
// Exige usuário logado no HeadCoach (JWT da sessão) — são dados financeiros.
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { listarTransacoes, detalheTransacao, HcTransacaoError } from '../services/hcTransacoes.js';
import { empresasRestritasDoUsuario } from '../utils/empresasUsuario.js';
import { alterarVendedorDaTransacao, historicoDeVendedor, VendedorTransacaoError } from '../services/hcTransacaoVendedor.js';
import { limparCacheFaturamentoVendedor } from '../totvsrouter/painelVendas.js';
import { situacaoDaDuplicata, reenviarDuplicata, arquivoDaDuplicata, DuplicataError } from '../services/faturamentoDuplicata.js';

const router = express.Router();
router.use(requireAuth);

const responder = (res, err) => {
  if (err instanceof HcTransacaoError || err instanceof VendedorTransacaoError || err instanceof DuplicataError) return errorResponse(res, err.message, err.status, err.code);
  console.error('[hc/transacoes]', err);
  return errorResponse(res, err.message || 'Erro ao consultar as transações', 500, 'HC_TRANSACOES');
};

router.get(
  '/transacoes',
  asyncHandler(async (req, res) => {
    try {
      // vendedor só vê as transações da(s) própria(s) empresa(s) (Yago, 13/11/2026)
      const query = { ...(req.query || {}) };
      const permitidas = await empresasRestritasDoUsuario(req.user);
      if (permitidas) {
        const pedidas = String(query.empresa || '')
          .split(/[,;\s]+/)
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0);
        const usar = pedidas.length ? pedidas.filter((n) => permitidas.includes(n)) : permitidas;
        query.empresa = usar.length ? usar.join(',') : '-1';
      }
      const r = await listarTransacoes(query);
      return successResponse(res, r, `${r.resumo.transacoes} transação(ões)`);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.get(
  '/transacoes/:id',
  asyncHandler(async (req, res) => {
    try {
      const r = await detalheTransacao(req.params.id);
      const permitidas = await empresasRestritasDoUsuario(req.user);
      if (permitidas && !permitidas.includes(Number(r?.empresa))) return errorResponse(res, 'Transação não encontrada', 404, 'NOT_FOUND');
      // trocas de vendedor já feitas nesta transação (a tela mostra o histórico)
      r.vendedorAlteracoes = await historicoDeVendedor(req.params.id);
      // venda com boleto: a duplicata enviada ao cliente (situação, telefone, histórico)
      r.duplicata = r.fonte === 'venda' ? await situacaoDaDuplicata(Number(r.numero)).catch(() => null) : null;
      return successResponse(res, r, 'Transação');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

// Troca o vendedor da transação (Yago, 19/11/2026) — só o owner. Vale para o
// ranking, o New Forecast e o contas a receber: ver services/hcTransacaoVendedor.js.
router.put(
  '/transacoes/:id/vendedor',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    try {
      const b = req.body || {};
      const r = await alterarVendedorDaTransacao(req.params.id, { vendedorCode: b.vendedorCode, vendedorNome: b.vendedorNome, motivo: b.motivo, user: req.user });
      // o faturamento por vendedor fica 30 min em memória: esvazia para recalcular já
      r.guardados.cacheMemoria = limparCacheFaturamentoVendedor();
      return successResponse(res, r, `Vendedor da transação ${r.transacao} alterado para ${r.para.nome}`);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

// ─── Duplicata da venda com boleto (Yago, 24/11/2026) ────────────────────────
// A duplicata é a "confirmação de compra a prazo" que o cliente assina (Autentique)
// e que segue pelo WhatsApp no faturamento. Aqui dá para ver a situação, baixar o
// documento e reenviar; mandar para OUTRO telefone é só do owner.
async function vendaDaDuplicata(req) {
  const m = /^V?(\d+)$/i.exec(String(req.params.id || '').trim());
  if (!m) throw new HcTransacaoError('A duplicata é só de venda', 'NOT_FOUND', 404);
  const r = await detalheTransacao(`V${m[1]}`);
  const permitidas = await empresasRestritasDoUsuario(req.user);
  if (permitidas && !permitidas.includes(Number(r?.empresa))) throw new HcTransacaoError('Transação não encontrada', 'NOT_FOUND', 404);
  return Number(m[1]);
}

router.get(
  '/transacoes/:id/duplicata',
  asyncHandler(async (req, res) => {
    try {
      const vendaId = await vendaDaDuplicata(req);
      const d = await situacaoDaDuplicata(vendaId, { conferir: req.query.conferir === '1' });
      return successResponse(res, d, d ? `Duplicata: ${d.statusNome}` : 'Venda sem boleto: não tem duplicata');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.get(
  '/transacoes/:id/duplicata/pdf',
  asyncHandler(async (req, res) => {
    try {
      const vendaId = await vendaDaDuplicata(req);
      const a = await arquivoDaDuplicata(vendaId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${req.query.baixar === '1' ? 'attachment' : 'inline'}; filename="${a.nome}"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Duplicata-Assinada');
      res.setHeader('X-Duplicata-Assinada', a.assinado ? '1' : '0');
      return res.send(a.pdf);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.post(
  '/transacoes/:id/duplicata/reenviar',
  asyncHandler(async (req, res) => {
    try {
      const telefone = String(req.body?.telefone || '').replace(/\D/g, '') || null;
      // outro telefone: só o owner (sem telefone no corpo, vai para o número em que a duplicata já está)
      if (telefone && req.user?.role !== 'owner') return errorResponse(res, 'Só o owner envia a duplicata para outro telefone', 403, 'FORBIDDEN');
      const vendaId = await vendaDaDuplicata(req);
      const r = await reenviarDuplicata(vendaId, { por: req.user?.name || req.user?.email || null, telefone });
      const para = String(r.telefone || '').replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
      const msg = r.naoSeAplica ? 'Venda sem boleto: não tem duplicata' : r.outroTelefone ? `Duplicata enviada para o novo número ${para}` : `Duplicata ${r.reenviada ? 'reenviada' : 'enviada'} para ${para}`;
      return successResponse(res, r, msg);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

export default router;
