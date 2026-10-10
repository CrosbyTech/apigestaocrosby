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
//
// Transações de devolução (aba Transações — o que foi recebido / faltou / sobrou):
//   POST /transacoes                    registra a transação gerada na Devolução RFID
//   GET  /transacoes                    lista (de, ate, empresa, busca)
//   GET  /transacoes/:id                detalhe com as três listas
//   POST /transacoes/:id/status         atualiza a situação vinda do TOTVS
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

// ─── Transações de devolução ─────────────────────────────────────────────────
// (declaradas antes das rotas /:id para não serem capturadas por elas)
const erroTrx = (res, error) =>
  /relation .*devolucoes_transacoes.* does not exist|devolucoes_transacoes.* in the schema cache/i.test(error?.message || '')
    ? errorResponse(res, 'Tabela devolucoes_transacoes não existe — rode migrations/devolucoes_transacoes.sql', 503, 'MIGRATION_PENDING')
    : errorResponse(res, error.message, 500, 'DB_ERROR');

const limparLista = (lista) =>
  (Array.isArray(lista) ? lista : []).slice(0, 2000).map((i) => ({
    productCode: Number(i.productCode) || null,
    name: i.name ? String(i.name).slice(0, 200) : null,
    quantidade: Number(i.quantidade) || 0,
    esperado: i.esperado != null ? Number(i.esperado) : undefined,
    lido: i.lido != null ? Number(i.lido) : undefined,
    unit: i.unit != null ? Number(i.unit) : undefined,
    total: i.total != null ? Number(i.total) : undefined,
    motivo: i.motivo || undefined,
    epcs: Array.isArray(i.epcs) ? i.epcs.map(String) : [],
  }));
const somaQtd = (lista) => lista.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);

router.post(
  '/transacoes',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const empresa = parseInt(b.empresa, 10);
    const transacaoCode = Number(b.transactionCode);
    if (!empresa || !transacaoCode) {
      return errorResponse(res, 'empresa e transactionCode são obrigatórios', 400, 'INVALID_PAYLOAD');
    }
    const recebidos = limparLista(b.recebidos);
    const faltando = limparLista(b.faltando);
    const sobrando = limparLista(b.sobrando);
    const registro = {
      devolucao_id: b.devolucaoId ? Number(b.devolucaoId) : null,
      empresa,
      transacao_code: transacaoCode,
      transacao_date: b.transactionDate ? String(b.transactionDate).slice(0, 10) : null,
      transacao_status: b.status != null ? Number(b.status) : 1,
      operacao: b.operacao != null ? parseInt(b.operacao, 10) : null,
      cfop: b.cfop != null ? parseInt(b.cfop, 10) : null,
      total: Number(b.total) || 0,
      cliente_code: b.clienteCode ? Number(b.clienteCode) : null,
      cliente_nome: b.clienteNome || null,
      vendedor_code: b.vendedorCode ? Number(b.vendedorCode) : null,
      vendedor_nome: b.vendedorNome || null,
      nf_numero: b.nf?.invoiceCode ?? null,
      nf_serie: b.nf?.serialCode != null ? String(b.nf.serialCode) : null,
      nf_data: b.nf?.invoiceDate || null,
      nf_empresa: b.nf?.branchCode ?? null,
      nf_chave: b.nf?.accessKey || null,
      nf_total: b.nf?.totalValue ?? null,
      nf_qtd_pecas: b.nf?.quantity ?? null,
      qtd_recebida: somaQtd(recebidos),
      qtd_faltando: somaQtd(faltando),
      qtd_sobrando: somaQtd(sobrando),
      valor_faltando: Math.round(faltando.reduce((s2, i) => s2 + (Number(i.total) || 0), 0) * 100) / 100,
      recebidos,
      faltando,
      sobrando,
      criado_por: b.por || null,
    };
    const { data, error } = await supabase
      .from('devolucoes_transacoes')
      .upsert(registro, { onConflict: 'empresa,transacao_code' })
      .select('id')
      .single();
    if (error) return erroTrx(res, error);
    console.log(
      `📦 [Devoluções] transação ${empresa}/${transacaoCode} registrada: ${registro.qtd_recebida} recebida(s), ${registro.qtd_faltando} faltando, ${registro.qtd_sobrando} sobrando`,
    );
    return successResponse(res, { id: data.id }, 'Transação registrada', 201);
  }),
);

router.get(
  '/transacoes',
  asyncHandler(async (req, res) => {
    const de = req.query.de ? String(req.query.de).slice(0, 10) : null;
    const ate = req.query.ate ? String(req.query.ate).slice(0, 10) : null;
    const empresa = parseInt(req.query.empresa, 10) || null;
    const busca = String(req.query.busca || '').trim();
    let q = supabase
      .from('devolucoes_transacoes')
      .select(
        'id, devolucao_id, empresa, transacao_code, transacao_date, transacao_status, operacao, cfop, total, cliente_code, cliente_nome, vendedor_nome, nf_numero, nf_serie, nf_empresa, nf_total, nf_qtd_pecas, qtd_recebida, qtd_faltando, qtd_sobrando, valor_faltando, criado_por, criado_em, atendida_em',
      )
      .order('id', { ascending: false })
      .limit(Math.min(parseInt(req.query.limite, 10) || 300, 1000));
    if (de) q = q.gte('criado_em', `${de}T00:00:00-03:00`);
    if (ate) q = q.lte('criado_em', `${ate}T23:59:59.999-03:00`);
    if (empresa) q = q.eq('empresa', empresa);
    if (busca) {
      q = /^\d+$/.test(busca)
        ? q.or(`transacao_code.eq.${busca},cliente_code.eq.${busca},nf_numero.eq.${busca}`)
        : q.ilike('cliente_nome', `%${busca}%`);
    }
    const { data, error } = await q;
    if (error) return erroTrx(res, error);
    const items = data || [];
    return successResponse(
      res,
      {
        items,
        resumo: {
          transacoes: items.length,
          recebidas: items.reduce((s2, i) => s2 + i.qtd_recebida, 0),
          faltando: items.reduce((s2, i) => s2 + i.qtd_faltando, 0),
          sobrando: items.reduce((s2, i) => s2 + i.qtd_sobrando, 0),
          total: Math.round(items.filter((i) => i.transacao_status !== 6).reduce((s2, i) => s2 + Number(i.total), 0) * 100) / 100,
          comDivergencia: items.filter((i) => i.qtd_faltando > 0 || i.qtd_sobrando > 0).length,
        },
      },
      `${items.length} transação(ões)`,
    );
  }),
);

router.get(
  '/transacoes/:id',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('devolucoes_transacoes')
      .select('*')
      .eq('id', parseInt(req.params.id, 10))
      .maybeSingle();
    if (error) return erroTrx(res, error);
    if (!data) return errorResponse(res, 'Transação não encontrada', 404, 'NOT_FOUND');
    return successResponse(res, data, 'Transação de devolução');
  }),
);

router.post(
  '/transacoes/:id/status',
  asyncHandler(async (req, res) => {
    const status = Number(req.body?.status);
    if (!Number.isInteger(status)) return errorResponse(res, 'status inválido', 400, 'INVALID_STATUS');
    const patch = { transacao_status: status };
    if (status === 4) patch.atendida_em = new Date().toISOString();
    const { data, error } = await supabase
      .from('devolucoes_transacoes')
      .update(patch)
      .eq('id', parseInt(req.params.id, 10))
      .select('id, transacao_status')
      .single();
    if (error) return erroTrx(res, error);
    return successResponse(res, data, 'Situação atualizada');
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
