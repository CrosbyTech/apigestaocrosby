// ============================================================================
// /api/brejinho — Expedição Brejinho (pedidos das franquias do Dryland /brejinho)
//
//   GET /           lista ao vivo (cache 60 s) + resumo por status
//                   ?status=&busca=&uf=&showroom=&de=&ate=&arquivados=1&forcar=1
//   GET /:id        card completo (com histórico) + peças da transação TOTVS (filial 99)
//
// Só leitura: mudar status e campos continua no Dryland. O FATURAR leva o card
// para /expedicao/brejinho/faturamento?chave=BRJ:<id>.
// ============================================================================
import express from 'express';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { BrejinhoError, STATUS_BREJINHO, listarBrejinho, obterBrejinho } from '../services/brejinhoDryland.js';

const router = express.Router();

const norm = (v) =>
  String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

function responder(res, err) {
  if (err instanceof BrejinhoError) return errorResponse(res, err.message, err.status, err.code);
  return errorResponse(res, err?.message || 'Erro ao ler o Brejinho no Dryland', 502, 'DRYLAND_ERROR');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const lista = await listarBrejinho({ forcar: req.query.forcar === '1', arquivados: req.query.arquivados === '1' });
      const status = String(req.query.status || '');
      const uf = String(req.query.uf || '');
      const showroom = String(req.query.showroom || '');
      const de = req.query.de ? String(req.query.de).slice(0, 10) : null;
      const ate = req.query.ate ? String(req.query.ate).slice(0, 10) : null;
      const q = norm(String(req.query.busca || '').trim());

      // resumo sobre TUDO (os cartões do topo não mudam com o filtro)
      const resumo = { total: lista.length, valor: 0, abertos: 0, valorAberto: 0, porStatus: {} };
      for (const s of STATUS_BREJINHO) resumo.porStatus[s] = { n: 0, valor: 0, pecas: 0 };
      for (const p of lista) {
        const v = Number(p.valor) || 0;
        resumo.valor += v;
        const b = resumo.porStatus[p.status] || (resumo.porStatus[p.status] = { n: 0, valor: 0, pecas: 0 });
        b.n += 1;
        b.valor += v;
        b.pecas += Number(p.qtd_pecas) || 0;
        if (!['faturado', 'cancelado'].includes(p.status)) {
          resumo.abertos += 1;
          resumo.valorAberto += v;
        }
      }

      let items = lista;
      if (status === '__abertos') items = items.filter((p) => !['faturado', 'cancelado'].includes(p.status));
      else if (status) items = items.filter((p) => p.status === status);
      if (uf) items = items.filter((p) => (uf === '—' ? !p.uf : p.uf === uf));
      if (showroom) items = items.filter((p) => p.showroom === showroom);
      const dataDe = (p) => String(p.data_transacao || p.criado_em || '').slice(0, 10);
      if (de) items = items.filter((p) => dataDe(p) >= de);
      if (ate) items = items.filter((p) => dataDe(p) <= ate);
      if (q) items = items.filter((p) => [p.pedido, p.cliente, p.transacao, p.nota_fiscal, p.showroom, p.cond_pagamento].some((v) => norm(v).includes(q)));

      // faturamentos feitos no HeadCoach (tela Faturamento, chave BRJ:<id>)
      // (mesma regra da tela Pedido de Venda: NF autorizada ou transação não cancelada)
      const chaves = items.filter((p) => !['faturado', 'cancelado'].includes(p.status)).map((p) => `BRJ:${p.id}`);
      const fats = new Map();
      if (chaves.length) {
        const { data } = await supabase.from('pedidos_venda_faturamentos').select('*').in('chave', chaves).order('criado_em', { ascending: false });
        for (const f of data || []) {
          const vivo = f.venda_id ? f.nf_status === 'autorizada' : f.transacao_status !== 6;
          if (vivo && !fats.has(f.chave)) fats.set(f.chave, { id: f.id, transacao: f.transacao_code, nf: f.nf_numero ?? null, status: f.transacao_status, em: f.criado_em });
        }
      }

      const filtros = {
        uf: [...new Set(lista.map((p) => p.uf).filter(Boolean))].sort(),
        showroom: [...new Set(lista.map((p) => p.showroom).filter(Boolean))].sort(),
      };
      return successResponse(
        res,
        {
          items: items.map((p) => ({ ...p, chave: `BRJ:${p.id}`, faturamento: fats.get(`BRJ:${p.id}`) || null })),
          resumo,
          status: STATUS_BREJINHO,
          filtros,
        },
        `${items.length} pedido(s)`,
      );
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    try {
      const r = await obterBrejinho(req.params.id);
      const { data: fats } = await supabase
        .from('pedidos_venda_faturamentos')
        .select('*')
        .eq('chave', `BRJ:${r.pedido.id}`)
        .order('criado_em', { ascending: false });
      return successResponse(res, { ...r, chave: `BRJ:${r.pedido.id}`, faturamentos: fats || [] }, 'Pedido do Brejinho');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

export default router;
