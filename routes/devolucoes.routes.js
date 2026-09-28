// ============================================================================
// DEVOLUÇÕES DE MERCADORIA — montado em /api/devolucoes
//
// Público (link /devolucao das Solicitações Crosby, sem login):
//   GET  /publico/cliente?doc=          valida CPF/CNPJ no cadastro
//   GET  /publico/vendedores?empresa=   vendedores da empresa do cliente + matrizes
//   POST /publico                       abre a solicitação (fotos em base64)
//
// Interno (página /devolucoes-mercadoria):
//   GET  /                              lista (status, de, ate, busca, tipo)
//   GET  /:id                           detalhe
//   PATCH /:id                          observação interna, cancelar/reabrir
//   POST /:id/chamado                   abre o chamado no Dryland se faltou
//   POST /:id/transacao                 liga a transação gerada na Devolução RFID
//   POST /sincronizar                   chamados concluídos → aguardando_devolucao
//   POST /:id/sincronizar               idem, uma só
// ============================================================================
import express from 'express';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import {
  DevolucaoError,
  STATUS,
  TIPOS,
  buscarClientePorDocumento,
  listarVendedores,
  criarSolicitacao,
  abrirChamadoPendente,
  sincronizarChamados,
  registrarTransacao,
} from '../services/devolucoesMercadoria.js';

const router = express.Router();

function responderErro(res, err) {
  if (err instanceof DevolucaoError) {
    return errorResponse(res, err.message, err.status || 400, err.code, err.details);
  }
  throw err;
}

// Limite simples por IP para o formulário público (memória do processo)
const janelas = new Map();
function limitarPorIp(ip, max = 20, janelaMs = 10 * 60 * 1000) {
  const agora = Date.now();
  const w = janelas.get(ip) || [];
  const recentes = w.filter((t) => agora - t < janelaMs);
  recentes.push(agora);
  janelas.set(ip, recentes);
  return recentes.length <= max;
}

const ipDe = (req) => (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();

// ─── Público ─────────────────────────────────────────────────────────────────
router.get(
  '/publico/cliente',
  asyncHandler(async (req, res) => {
    try {
      const cli = await buscarClientePorDocumento(req.query.doc);
      return successResponse(res, cli, 'Cliente encontrado');
    } catch (err) {
      return responderErro(res, err);
    }
  }),
);

router.get(
  '/publico/vendedores',
  asyncHandler(async (req, res) => {
    try {
      const lista = await listarVendedores(req.query.empresa);
      return successResponse(res, { items: lista }, `${lista.length} vendedor(es)`);
    } catch (err) {
      return responderErro(res, err);
    }
  }),
);

router.post(
  '/publico',
  asyncHandler(async (req, res) => {
    const ip = ipDe(req);
    if (!limitarPorIp(ip)) {
      return errorResponse(res, 'Muitas solicitações em pouco tempo. Aguarde alguns minutos.', 429, 'RATE_LIMIT');
    }
    try {
      const dev = await criarSolicitacao(req.body || {}, { ip, origem: 'publico' });
      return successResponse(
        res,
        {
          id: dev.id,
          protocolo: dev.protocolo,
          status: dev.status,
          tipo: dev.tipo,
          chamado: dev.chamado,
          avisoChamado: dev.avisoChamado,
          fotos: dev.fotos.length,
        },
        'Solicitação registrada',
        201,
      );
    } catch (err) {
      return responderErro(res, err);
    }
  }),
);

// ─── Interno ─────────────────────────────────────────────────────────────────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || '').toLowerCase();
    const tipo = String(req.query.tipo || '').toLowerCase();
    const de = req.query.de ? String(req.query.de).slice(0, 10) : null;
    const ate = req.query.ate ? String(req.query.ate).slice(0, 10) : null;
    const busca = String(req.query.busca || '').trim();
    const limite = Math.min(parseInt(req.query.limite, 10) || 300, 1000);

    let q = supabase.from('devolucoes_mercadoria').select('*').order('id', { ascending: false }).limit(limite);
    if (STATUS.includes(status)) q = q.eq('status', status);
    if (status === 'abertas') q = q.in('status', ['aguardando_avaliacao', 'aguardando_devolucao', 'em_devolucao']);
    if (TIPOS.includes(tipo)) q = q.eq('tipo', tipo);
    if (de) q = q.gte('criado_em', `${de}T00:00:00-03:00`);
    if (ate) q = q.lte('criado_em', `${ate}T23:59:59.999-03:00`);
    if (busca) {
      const d = busca.replace(/\D/g, '');
      q = /^\d+$/.test(busca)
        ? q.or(`id.eq.${busca},cliente_code.eq.${busca},cliente_cpf_cnpj.ilike.%${d}%,transacao_code.eq.${busca}`)
        : q.or(`cliente_nome.ilike.%${busca}%,vendedor_nome.ilike.%${busca}%`);
    }
    const { data, error } = await q;
    if (error) {
      if (/relation .*devolucoes_mercadoria.* does not exist/i.test(error.message)) {
        return errorResponse(res, 'Tabela devolucoes_mercadoria não existe — rode migrations/devolucoes_mercadoria.sql', 503, 'MIGRATION_PENDING');
      }
      return errorResponse(res, error.message, 500, 'DB_ERROR');
    }
    const items = data || [];
    const contar = (s) => items.filter((i) => i.status === s).length;
    return successResponse(
      res,
      {
        items,
        resumo: {
          total: items.length,
          aguardandoAvaliacao: contar('aguardando_avaliacao'),
          aguardandoDevolucao: contar('aguardando_devolucao'),
          emDevolucao: contar('em_devolucao'),
          concluidas: contar('concluida'),
          canceladas: contar('cancelada'),
          defeito: items.filter((i) => i.tipo === 'defeito').length,
          pecas: items.filter((i) => i.status !== 'cancelada').reduce((s, i) => s + Number(i.qtd_pecas || 0), 0),
        },
      },
      `${items.length} solicitação(ões)`,
    );
  }),
);

router.post(
  '/sincronizar',
  asyncHandler(async (req, res) => {
    try {
      const r = await sincronizarChamados();
      return successResponse(res, r, `${r.verificadas} verificada(s) · ${r.liberadas.length} liberada(s)`);
    } catch (err) {
      return responderErro(res, err);
    }
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { data, error } = await supabase.from('devolucoes_mercadoria').select('*').eq('id', id).maybeSingle();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    if (!data) return errorResponse(res, 'Solicitação não encontrada', 404, 'NOT_FOUND');
    return successResponse(res, data, 'Solicitação');
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const patch = {};
    if (b.observacao_interna !== undefined) patch.observacao_interna = b.observacao_interna || null;
    if (b.vendedor_code !== undefined) patch.vendedor_code = parseInt(b.vendedor_code, 10) || null;
    if (b.vendedor_nome !== undefined) patch.vendedor_nome = b.vendedor_nome || null;
    if (b.status !== undefined) {
      if (!STATUS.includes(b.status)) return errorResponse(res, 'Status inválido', 400, 'INVALID_STATUS');
      patch.status = b.status;
      if (b.status === 'cancelada') patch.motivo_cancelamento = b.motivo || 'Cancelada pela equipe';
    }
    if (!Object.keys(patch).length) return errorResponse(res, 'Nada para atualizar', 400, 'EMPTY_PATCH');
    const { data, error } = await supabase.from('devolucoes_mercadoria').update(patch).eq('id', id).select().single();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    return successResponse(res, data, 'Solicitação atualizada');
  }),
);

router.post(
  '/:id/chamado',
  asyncHandler(async (req, res) => {
    try {
      const c = await abrirChamadoPendente(parseInt(req.params.id, 10));
      return successResponse(res, c, c.jaExistia ? 'Chamado já existia' : 'Chamado aberto no Dryland');
    } catch (err) {
      return responderErro(res, err);
    }
  }),
);

router.post(
  '/:id/sincronizar',
  asyncHandler(async (req, res) => {
    try {
      const r = await sincronizarChamados({ ids: [parseInt(req.params.id, 10)] });
      return successResponse(res, r, r.liberadas.length ? 'Liberada para a Devolução RFID' : 'Sem mudança');
    } catch (err) {
      return responderErro(res, err);
    }
  }),
);

router.post(
  '/:id/transacao',
  asyncHandler(async (req, res) => {
    try {
      const d = await registrarTransacao(parseInt(req.params.id, 10), req.body || {}, req.body?.por || null);
      return successResponse(res, d, 'Transação vinculada');
    } catch (err) {
      return responderErro(res, err);
    }
  }),
);

export default router;
