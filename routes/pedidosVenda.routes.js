// ============================================================================
// PEDIDOS DE VENDA (Dryland) — montado em /api/pedidos-venda
// Página /expedicao/pedidos-venda. O pedido é o do Dryland (ref), copiado pelo
// job pedidos-venda-sync (services/pedidosVendaDryland.js).
//
//   GET  /?status=&canal=&transferencias=1&de=&ate=&busca=   lista + resumo
//   GET  /:ref                                                pedido + peças
//   POST /sincronizar                                         copia agora do Dryland
// ============================================================================
import express from 'express';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { sincronizarPedidosDryland } from '../services/pedidosVendaDryland.js';

const router = express.Router();

// Uma sincronização por vez (job e botão da tela dividem a trava)
let emAndamento = null;
let ultima = null; // { em, resultado }
export async function sincronizarComTrava() {
  if (emAndamento) return { emAndamento: true, ...(await emAndamento) };
  emAndamento = sincronizarPedidosDryland()
    .then((r) => {
      ultima = { em: new Date().toISOString(), resultado: r };
      return r;
    })
    .finally(() => {
      emAndamento = null;
    });
  return emAndamento;
}

function responder(res, err) {
  if (/pedidos_venda_dryland/.test(err?.message || '') && /does not exist|schema cache/i.test(err.message)) {
    return errorResponse(res, 'Tabelas de pedidos não existem — rode migrations/pedidos_venda_dryland.sql', 503, 'MIGRATION_PENDING');
  }
  return errorResponse(res, err?.message || 'Erro nos pedidos de venda', 500, 'DB_ERROR');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, canal, de, ate } = req.query;
    const busca = String(req.query.busca || '').trim();
    const pedidos = [];
    for (let off = 0; ; off += 1000) {
      let q = supabase
        .from('pedidos_venda_dryland')
        .select('*')
        .order('criado_em', { ascending: false })
        .range(off, off + 999);
      if (req.query.transferencias !== '1') q = q.eq('eh_venda', true);
      if (status) q = q.eq('status', status);
      if (canal) q = q.eq('canal', canal);
      if (de) q = q.gte('criado_em', `${String(de).slice(0, 10)}T00:00:00-03:00`);
      if (ate) q = q.lte('criado_em', `${String(ate).slice(0, 10)}T23:59:59.999-03:00`);
      if (busca) {
        const b = busca.replace(/[,()*%]/g, ' ');
        q = /^\d+$/.test(b)
          ? q.or(`ref.ilike.%${b}%,vendedor_code.eq.${b},totvs_pedidos.cs.{${b}}`)
          : q.or(`ref.ilike.%${b}%,cliente.ilike.%${b}%,vendedor_nome.ilike.%${b}%`);
      }
      const { data, error } = await q;
      if (error) return responder(res, error);
      pedidos.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const soma = (fn) => pedidos.reduce((s, p) => s + fn(p), 0);
    return successResponse(
      res,
      {
        items: pedidos,
        resumo: {
          pedidos: pedidos.length,
          pecas: soma((p) => p.qtd_pecas),
          separadas: soma((p) => p.qtd_separada),
          valor: Math.round(soma((p) => Number(p.valor_total)) * 100) / 100,
          aguardando: pedidos.filter((p) => p.status === 'aguardando').length,
          emSeparacao: pedidos.filter((p) => p.status === 'em_separacao').length,
          separados: pedidos.filter((p) => p.status === 'separado').length,
          comTotvs: pedidos.filter((p) => (p.totvs_pedidos || []).length > 0).length,
        },
        sincronizacao: ultima,
      },
      `${pedidos.length} pedido(s)`,
    );
  }),
);

router.post(
  '/sincronizar',
  asyncHandler(async (req, res) => {
    try {
      const r = await sincronizarComTrava();
      return successResponse(res, r, `${r.pedidos} pedido(s) atualizados do Dryland`);
    } catch (err) {
      return errorResponse(res, `Não consegui ler o Dryland: ${err.message}`, 502, 'DRYLAND_ERROR');
    }
  }),
);

router.get(
  '/:ref',
  asyncHandler(async (req, res) => {
    const ref = String(req.params.ref).toUpperCase();
    const [{ data: pedido, error: e1 }, { data: itens, error: e2 }] = await Promise.all([
      supabase.from('pedidos_venda_dryland').select('*').eq('ref', ref).maybeSingle(),
      supabase.from('pedidos_venda_dryland_itens').select('*').eq('ref', ref).order('descricao'),
    ]);
    if (e1 || e2) return responder(res, e1 || e2);
    if (!pedido) return errorResponse(res, `Pedido ${ref} não encontrado`, 404, 'NOT_FOUND');
    return successResponse(res, { ...pedido, itens: itens || [] }, `Pedido ${ref}`);
  }),
);

export default router;
