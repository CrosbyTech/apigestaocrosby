// ============================================================================
// TRANSFERÊNCIAS DE MERCADORIA ENTRE EMPRESAS — montado em /api/transferencias
// (página /transferencias-mercadoria: Solicitações / Transferência RFID /
// Transações — mesmo desenho das Devoluções de Mercadoria)
//
//   GET  /filiais                       filiais dos grupos do POP (CNPJ, pessoa, UF)
//   GET  /regra?origem=&destino=        operação do POP (destino = código da empresa)
//   POST /gerar                         valida o POP e gera a transação no TOTVS
//
// Solicitações:
//   GET  /                              lista (status, busca, empresa)
//   GET  /:id                           detalhe
//   PATCH /:id                          observação interna, local, cancelar/reabrir
//   POST /:id/transacao                 liga a transação gerada na Transferência RFID
//
// Transações (aba Transações):
//   POST /transacoes                    registra a transação gerada
//   GET  /transacoes                    lista (de, ate, empresa, busca)
//   GET  /transacoes/:id                detalhe com os itens e EPCs
//   POST /transacoes/:id/status         atualiza a situação vinda do TOTVS
// ============================================================================
import express from 'express';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import {
  TransferenciaError,
  STATUS,
  LOCAIS,
  OPERACOES_POP,
  listarFiliaisPop,
  operacaoPop,
  cfopPop,
  gerarTransacaoTotvs,
  vincularTransacao,
  registrarTransacao,
  importarTransferenciasDryland,
} from '../services/transferenciasMercadoria.js';
import { prepararTransferenciaNota, transferirComNota, processarTransferenciaNota, EMPRESA_ORIGEM_NOTA } from '../services/transferenciaNota.js';
import { FiscalError } from '../services/pdvFiscal.js';
import { empresasRestritasDoUsuario, usuarioDaRequisicao } from '../utils/empresasUsuario.js';

// vendedor só vê as transferências da(s) própria(s) loja(s), como origem ou
// destino (Yago, 13/11/2026). null = sem restrição (owner/admin, sem login).
async function lojasDoPedido(req) {
  const user = await usuarioDaRequisicao(req);
  return user ? empresasRestritasDoUsuario(user) : null;
}
const daLoja = (lojas, ...codigos) => !lojas || codigos.some((c) => lojas.includes(Number(c)));

const router = express.Router();

function responder(res, err) {
  if (err instanceof TransferenciaError) return errorResponse(res, err.message, err.status, err.code, err.details);
  if (err instanceof FiscalError) return errorResponse(res, err.message, 422, err.code);
  if (/transferencias_/.test(err?.message || '') && /does not exist|schema cache/i.test(err.message)) {
    return errorResponse(res, 'Tabelas de transferência não existem — rode migrations/transferencias_mercadoria.sql', 503, 'MIGRATION_PENDING');
  }
  return errorResponse(res, err?.message || 'Erro nas transferências', 500, 'DB_ERROR');
}

// ─── POP ─────────────────────────────────────────────────────────────────────
router.get(
  '/filiais',
  asyncHandler(async (req, res) => {
    try {
      const filiais = await listarFiliaisPop({ fresco: req.query.refresh === '1' });
      return successResponse(res, { filiais, operacoes: OPERACOES_POP }, `${filiais.length} filiais no POP`);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.get(
  '/regra',
  asyncHandler(async (req, res) => {
    try {
      const filiais = await listarFiliaisPop();
      const o = filiais.find((f) => f.code === Number(req.query.origem));
      const d = filiais.find((f) => f.code === Number(req.query.destino));
      if (!o || !d) return errorResponse(res, 'Origem ou destino fora dos grupos do POP', 404, 'FORA_DO_POP');
      const regra = operacaoPop(o.cnpj, d.cnpj);
      return successResponse(res, { ...regra, cfop: regra.permitido ? cfopPop(regra.operacao, o.uf, d.uf) : null, origem: o, destino: d }, 'Regra do POP');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.post(
  '/gerar',
  asyncHandler(async (req, res) => {
    try {
      const trx = await gerarTransacaoTotvs(req.body || {});
      console.log(`🔁 [Transferência] ${trx.origem.code} → ${trx.destino.code} op ${trx.operacao} cfop ${trx.cfop}: transação ${trx.transactionCode}`);
      return successResponse(res, trx, `Transferência ${trx.transactionCode} gerada`);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

// ─── Transações ──────────────────────────────────────────────────────────────
// Transferência com nota pelo HeadCoach (venda_id) não tem transação no TOTVS: a
// situação é a da NOTA — autorizada = concluída (4), cancelada = cancelada (6),
// senão em andamento (1). As primeiras ficaram com uma transação aberta na 990
// que não conta mais (o número fica guardado em transacao_code_antiga).
const situacaoPelaNota = (t) => {
  if (!t?.venda_id) return t;
  const st = t.nf_status === 'autorizada' ? 4 : t.nf_status === 'cancelada' ? 6 : 1;
  return { ...t, transacao_status: st, sem_totvs: true, transacao_code_antiga: t.transacao_code || null, transacao_code: null, empresa_totvs: null, totvs_erro: null };
};
router.post(
  '/transacoes',
  asyncHandler(async (req, res) => {
    try {
      const r = await registrarTransacao(req.body || {});
      return successResponse(res, r, 'Transação registrada');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.get(
  '/transacoes',
  asyncHandler(async (req, res) => {
    const de = req.query.de ? String(req.query.de).slice(0, 10) : null;
    const ate = req.query.ate ? String(req.query.ate).slice(0, 10) : null;
    const empresa = parseInt(req.query.empresa, 10) || null;
    const busca = String(req.query.busca || '').trim();
    const lojas = await lojasDoPedido(req);
    const COLUNAS =
      'id, transferencia_id, empresa, empresa_destino, transacao_code, transacao_date, transacao_status, operacao, cfop, total, qtd_pecas, qtd_epcs, cliente_code, cliente_nome, vendedor_nome, criado_por, criado_em, atendida_em';
    // transferência com nota pelo HeadCoach: a lista precisa destes campos para mostrar a
    // NF e o "Tentar de novo" (sem eles o botão nunca aparecia na linha)
    const COLUNAS_NOTA = 'venda_id, empresa_totvs, natureza, nota_id, nf_numero, nf_serie, nf_status, totvs_erro';
    const consultar = (colunas) => {
      let q = supabase
        .from('transferencias_transacoes')
        .select(colunas)
        .order('id', { ascending: false })
        .limit(Math.min(parseInt(req.query.limite, 10) || 300, 1000));
      if (de) q = q.gte('criado_em', `${de}T00:00:00-03:00`);
      if (ate) q = q.lte('criado_em', `${ate}T23:59:59.999-03:00`);
      if (empresa) q = q.or(`empresa.eq.${empresa},empresa_destino.eq.${empresa}`);
      if (lojas) {
        const l = lojas.length ? lojas.join(',') : '-1';
        q = q.or(`empresa.in.(${l}),empresa_destino.in.(${l})`);
      }
      if (busca) {
        q = /^\d+$/.test(busca)
          ? q.or(`transacao_code.eq.${busca},empresa.eq.${busca},empresa_destino.eq.${busca},cliente_code.eq.${busca}`)
          : q.ilike('cliente_nome', `%${busca}%`);
      }
      return q;
    };
    let { data, error } = await consultar(`${COLUNAS}, ${COLUNAS_NOTA}`);
    // banco ainda sem as colunas da nota: lista como antes
    if (error && /column|does not exist|schema cache/i.test(String(error.message || ''))) ({ data, error } = await consultar(COLUNAS));
    if (error) return responder(res, error);
    const items = (data || []).map(situacaoPelaNota);
    const valendo = items.filter((i) => i.transacao_status !== 6);
    return successResponse(
      res,
      {
        items,
        resumo: {
          transacoes: items.length,
          pecas: valendo.reduce((s, i) => s + i.qtd_pecas, 0),
          emAndamento: items.filter((i) => i.transacao_status === 1).length,
          atendidas: items.filter((i) => i.transacao_status === 4).length,
          canceladas: items.filter((i) => i.transacao_status === 6).length,
          total: Math.round(valendo.reduce((s, i) => s + Number(i.total), 0) * 100) / 100,
        },
      },
      `${items.length} transação(ões)`,
    );
  }),
);

router.get(
  '/transacoes/:id',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from('transferencias_transacoes').select('*').eq('id', parseInt(req.params.id, 10)).maybeSingle();
    if (error) return responder(res, error);
    if (!data || !daLoja(await lojasDoPedido(req), data.empresa, data.empresa_destino)) return errorResponse(res, 'Transação não encontrada', 404, 'NOT_FOUND');
    return successResponse(res, situacaoPelaNota(data), 'Transação de transferência');
  }),
);

router.post(
  '/transacoes/:id/status',
  asyncHandler(async (req, res) => {
    const status = Number(req.body?.status);
    if (!Number.isInteger(status)) return errorResponse(res, 'status inválido', 400, 'INVALID_STATUS');
    const patch = { transacao_status: status, atualizado_em: new Date().toISOString() };
    if (status === 4) patch.atendida_em = new Date().toISOString();
    const { data, error } = await supabase
      .from('transferencias_transacoes')
      .update(patch)
      .eq('id', parseInt(req.params.id, 10))
      .select('id, transferencia_id, empresa, transacao_code, transacao_date, total, operacao, qtd_epcs, transacao_status')
      .single();
    if (error) return responder(res, error);
    // vinculada a uma solicitação: acompanha a situação (4 conclui, 6 volta p/ fila)
    if (data?.transferencia_id && status !== 1) {
      await vincularTransacao(data.transferencia_id, {
        transactionCode: data.transacao_code,
        branchCode: data.empresa,
        transactionDate: data.transacao_date,
        total: data.total,
        operacao: data.operacao,
        qtdEpcs: data.qtd_epcs,
        status,
      }).catch(() => {});
    }
    return successResponse(res, data, 'Situação atualizada');
  }),
);

// ─── Transferência saindo da 99 com a NF-e pelo HeadCoach ────────────────────
// (services/transferenciaNota.js) — a nota sai pela 99 e a transação vai para a
// 990 como documento interno, já atendida
router.get(
  '/nota/preparar',
  asyncHandler(async (req, res) => {
    try {
      const r = await prepararTransferenciaNota({
        solicitacaoId: parseInt(req.query.solicitacao, 10) || null,
        destinoClienteCode: parseInt(req.query.destino, 10) || null,
      });
      return successResponse(res, r, `Transferência da ${EMPRESA_ORIGEM_NOTA} para ${r.destino.nome}`);
    } catch (err) {
      return responder(res, err);
    }
  }),
);
const mensagemNota = (r) =>
  !r.fiscal?.ok
    ? `NF-e não autorizada: ${r.fiscal?.mensagem || 'erro'}`
    : `Transferência concluída: NF-e ${r.nota?.numero}/${r.nota?.serie} autorizada e registrada no HeadCoach`;
router.post(
  '/nota',
  asyncHandler(async (req, res) => {
    try {
      const r = await transferirComNota(req.body || {});
      return successResponse(res, r, mensagemNota(r), 201);
    } catch (err) {
      return responder(res, err);
    }
  }),
);
// "Tentar de novo": emite a nota que não saiu (não há transação no TOTVS)
router.post(
  '/nota/:vendaId/reprocessar',
  asyncHandler(async (req, res) => {
    try {
      const r = await processarTransferenciaNota(parseInt(req.params.vendaId, 10));
      return successResponse(res, r, mensagemNota(r));
    } catch (err) {
      return responder(res, err);
    }
  }),
);

// ─── Solicitações ────────────────────────────────────────────────────────────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || '');
    const busca = String(req.query.busca || '').trim();
    const empresa = parseInt(req.query.empresa, 10) || null;
    // pedidos de transferência entre lojas do Dryland entram aqui como solicitações
    let dryland = null;
    try {
      dryland = await importarTransferenciasDryland({ forcar: req.query.refresh === '1' });
    } catch (e) {
      dryland = { erro: e.message };
      console.warn('[transferências] não importei as solicitações do Dryland:', e.message);
    }
    const lojas = await lojasDoPedido(req);
    let q = supabase.from('transferencias_mercadoria').select('*').order('id', { ascending: false }).limit(500);
    if (status === 'abertas') q = q.in('status', ['aguardando_transferencia', 'em_transferencia']);
    else if (STATUS.includes(status)) q = q.eq('status', status);
    if (empresa) q = q.or(`empresa_origem.eq.${empresa},empresa_destino.eq.${empresa}`);
    if (lojas) {
      const l = lojas.length ? lojas.join(',') : '-1';
      q = q.or(`empresa_origem.in.(${l}),empresa_destino.in.(${l})`);
    }
    if (busca) {
      q = /^\d+$/.test(busca)
        ? q.or(`id.eq.${busca},empresa_origem.eq.${busca},empresa_destino.eq.${busca},transacao_code.eq.${busca}`)
        : q.or(`empresa_origem_nome.ilike.%${busca}%,empresa_destino_nome.ilike.%${busca}%,solicitante_nome.ilike.%${busca}%,origem_ref.ilike.%${busca}%`);
    }
    const { data, error } = await q;
    if (error) return responder(res, error);
    // resumo sobre todas (não só o filtro)
    let qTodas = supabase.from('transferencias_mercadoria').select('status, qtd_pecas');
    if (lojas) {
      const l = lojas.length ? lojas.join(',') : '-1';
      qTodas = qTodas.or(`empresa_origem.in.(${l}),empresa_destino.in.(${l})`);
    }
    const { data: todas } = await qTodas;
    const conta = (s) => (todas || []).filter((t) => t.status === s).length;
    return successResponse(
      res,
      {
        items: data || [],
        dryland,
        resumo: {
          aguardando: conta('aguardando_transferencia'),
          emTransferencia: conta('em_transferencia'),
          concluidas: conta('concluida'),
          canceladas: conta('cancelada'),
          pecas: (todas || []).filter((t) => t.status !== 'cancelada').reduce((s, t) => s + (t.qtd_pecas || 0), 0),
        },
      },
      `${(data || []).length} solicitação(ões)`,
    );
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from('transferencias_mercadoria').select('*').eq('id', parseInt(req.params.id, 10)).maybeSingle();
    if (error) return responder(res, error);
    if (!data || !daLoja(await lojasDoPedido(req), data.empresa_origem, data.empresa_destino)) return errorResponse(res, 'Solicitação não encontrada', 404, 'NOT_FOUND');
    return successResponse(res, data, 'Solicitação');
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const patch = { atualizado_em: new Date().toISOString() };
    if (b.observacao_interna !== undefined) patch.observacao_interna = b.observacao_interna || null;
    if (b.local !== undefined) {
      if (!LOCAIS.includes(b.local)) return errorResponse(res, 'Local inválido', 400, 'INVALID_LOCAL');
      patch.local = b.local;
      patch.local_por = b.por || null;
      patch.local_em = new Date().toISOString();
    }
    if (b.status !== undefined) {
      if (!STATUS.includes(b.status)) return errorResponse(res, 'Status inválido', 400, 'INVALID_STATUS');
      patch.status = b.status;
      if (b.status === 'cancelada') patch.motivo_cancelamento = b.motivo || 'Cancelada pela equipe';
    }
    if (Object.keys(patch).length === 1) return errorResponse(res, 'Nada para atualizar', 400, 'EMPTY_PATCH');
    const { data, error } = await supabase.from('transferencias_mercadoria').update(patch).eq('id', parseInt(req.params.id, 10)).select().single();
    if (error) return responder(res, error);
    return successResponse(res, data, 'Solicitação atualizada');
  }),
);

router.post(
  '/:id/transacao',
  asyncHandler(async (req, res) => {
    try {
      const d = await vincularTransacao(parseInt(req.params.id, 10), req.body || {}, req.body?.por || null);
      return successResponse(res, d, 'Transação vinculada');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

export default router;
