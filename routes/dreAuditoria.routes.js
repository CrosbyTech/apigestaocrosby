// ============================================================
// DRE · AUDITORIA — confronto da DRE com fontes externas
//
// Por enquanto: Contratos PJ do Dryland (área DP) × despesa
// "SERVICOS PRESTADOS POR TERCEIROS" da DRE Analítica. O Dryland é a
// fonte da verdade; aqui só LEITURA. Dois jeitos de ler, nesta ordem:
//
//   1) DRYLAND_DP_USUARIO + DRYLAND_DP_SENHA — faz no servidor o mesmo que
//      o dp.html faz no navegador: dp_login → dp_pj_listar(token) →
//      dp_logout. Não precisa mexer em nada no Supabase do Dryland.
//   2) DRYLAND_DP_KEY — RPC dp_pj_listar_headcoach(p_key), que exige rodar
//      migrations/dryland/dp_pj_listar_headcoach.sql lá.
//
// Credenciais/chave só no env; o front nunca vê nenhuma delas.
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
const DP_USUARIO = process.env.DRYLAND_DP_USUARIO || '';
const DP_SENHA = process.env.DRYLAND_DP_SENHA || '';

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

// Lê os Contratos PJ. Devolve o JSON cru do dp_pj_listar ({ok, contratos, total_mensal}).
async function lerContratosPj() {
  if (DP_USUARIO && DP_SENHA) {
    const lg = await rpc('dp_login', { p_usuario: DP_USUARIO, p_senha: DP_SENHA });
    if (!lg || lg.ok !== true || !lg.token) {
      const motivo = (lg && (lg.erro || (lg.definir ? 'usuário sem senha definida' : null))) || 'login recusado';
      throw Object.assign(new Error(`login no DP do Dryland falhou (${motivo})`), { status: 502 });
    }
    try {
      return await rpc('dp_pj_listar', { p_token: lg.token });
    } finally {
      rpc('dp_logout', { p_token: lg.token }).catch(() => {}); // sessão fica pra expirar se falhar
    }
  }
  if (DP_KEY) return rpc('dp_pj_listar_headcoach', { p_key: DP_KEY });
  throw Object.assign(
    new Error('Acesso ao DP do Dryland não configurado: defina DRYLAND_DP_USUARIO + DRYLAND_DP_SENHA (ou DRYLAND_DP_KEY) no servidor.'),
    { status: 503 },
  );
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
    const force = req.query.refresh === '1';
    if (!force && cache.dados && Date.now() - cache.em < CACHE_MS) {
      return successResponse(res, cache.dados);
    }
    let r;
    try {
      r = await lerContratosPj();
    } catch (err) {
      const j = err?.response?.data;
      const msg = (j && (j.message || j.hint)) || err.message;
      // 404 = função não existe no Dryland (chave sem a migration)
      const status = err.status || (err?.response?.status === 404 ? 503 : 502);
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
