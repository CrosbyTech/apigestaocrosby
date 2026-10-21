// ============================================================
// DRE · AUDITORIA — confronto da DRE com fontes externas
//
// Por enquanto: Contratos PJ do Dryland (área DP) × despesa
// "SERVICOS PRESTADOS POR TERCEIROS" da DRE Analítica. O Dryland é a
// fonte da verdade; aqui só LEITURA, via RPC dp_pj_listar_headcoach
// (migrations/dryland/dp_pj_listar_headcoach.sql) protegida por chave
// (DRYLAND_DP_KEY). O front nunca vê a chave.
// ============================================================
import express from 'express';
import axios from 'axios';
import { requireAuth } from '../middlewares/auth.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';

const router = express.Router();

const DRYLAND_URL =
  process.env.DRYLAND_SUPABASE_URL || 'https://umhczriycvtagjqjnrzm.supabase.co';
const DRYLAND_KEY =
  process.env.DRYLAND_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaGN6cml5Y3Z0YWdqcWpucnptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTAyOTEsImV4cCI6MjA5MzIyNjI5MX0.SVWG6_7DZNv-Tz4AgRwQ1791lAEWgpcEv15k9rERlwI';
const DP_KEY = process.env.DRYLAND_DP_KEY || '';

async function rpc(fn, args = {}) {
  const { data } = await axios.post(`${DRYLAND_URL}/rest/v1/rpc/${fn}`, args, {
    headers: {
      'Content-Type': 'application/json',
      apikey: DRYLAND_KEY,
      Authorization: `Bearer ${DRYLAND_KEY}`,
    },
    timeout: 30000,
  });
  return data;
}

const num = (v) => Math.round((Number(v) || 0) * 100) / 100;
const comp = (v) => String(v || '').slice(0, 7); // 'AAAA-MM'

// cache curto — a tela recarrega várias vezes e o Dryland cria sessão a cada chamada
let cache = { em: 0, dados: null };
const CACHE_MS = 60 * 1000;

// GET /api/dre-auditoria/pj  → contratos PJ com pagamentos por competência
router.get(
  '/pj',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!DP_KEY) {
      return errorResponse(
        res,
        'DRYLAND_DP_KEY não configurada no servidor (ver migrations/dryland/dp_pj_listar_headcoach.sql).',
        503,
      );
    }
    const force = req.query.refresh === '1';
    if (!force && cache.dados && Date.now() - cache.em < CACHE_MS) {
      return successResponse(res, cache.dados);
    }
    let r;
    try {
      r = await rpc('dp_pj_listar_headcoach', { p_key: DP_KEY });
    } catch (err) {
      const j = err?.response?.data;
      const msg = (j && (j.message || j.hint)) || err.message;
      // função ainda não criada no Dryland
      const status = err?.response?.status === 404 ? 503 : 502;
      return errorResponse(res, `Dryland: ${msg}`, status);
    }
    if (!r || r.ok === false) {
      return errorResponse(res, `Dryland recusou a leitura (${(r && r.erro) || 'sem resposta'}).`, 502);
    }
    const contratos = (r.contratos || []).map((c) => ({
      id: c.id,
      nome: c.nome || '',
      valor: num(c.valor),
      inicio: c.inicio || null,
      status: c.status || '',
      obs: c.obs || '',
      pagamentos: (c.pagamentos || []).map((p) => ({
        competencia: comp(p.competencia),
        valor_pago: num(p.valor_pago),
        data_pagamento: p.data_pagamento || null,
      })),
      descontos: (c.descontos || []).map((d) => ({
        competencia: comp(d.competencia),
        valor: num(d.valor),
      })),
    }));
    const dados = {
      contratos,
      total_mensal: (r.total_mensal || []).map((t) => ({
        competencia: comp(t.competencia),
        total: num(t.total),
      })),
      lido_em: new Date().toISOString(),
    };
    cache = { em: Date.now(), dados };
    return successResponse(res, dados);
  }),
);

export default router;
