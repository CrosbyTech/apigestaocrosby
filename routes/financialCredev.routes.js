/**
 * Rotas de CREDEV / ADIANTAMENTO por franquia — via API TOTVS.
 *
 * Substitui a antiga consulta SQL direta no ERP Postgres (removido no
 * refactor). Agora usa accounts-receivable/customer-financial-balance do
 * TOTVS (mesma fonte da tela Saldo Financeiro de Franquias):
 *   - refundCreditValue  → CREDEV
 *   - advanceAmountValue  → ADIANTAMENTO
 *
 * A lista de franquias vem do Supabase (pes_pessoa, fantasy_name 'F%CROSBY%').
 *
 * GET /api/financial/credev-adiantamento
 */
import express from 'express';
import axios from 'axios';
import supabase from '../config/supabase.js';

const router = express.Router();

const INTERNAL_API_BASE = `http://localhost:${process.env.PORT || 4100}`;
// Empresas matriz onde ficam os saldos de credev/adiantamento (< 5999).
// Restringe as filiais pra consulta ser rápida (0,4s vs 60s com as 288).
const MATRIZ_BRANCHES = [1, 2, 99];

// Cache leve (5min) — a consulta bate no TOTVS, evita repetir a cada refresh.
let CACHE = { ts: 0, data: null };
const CACHE_TTL = 5 * 60 * 1000;

router.get('/credev-adiantamento', async (req, res) => {
  const noCache = req.query?.nocache === 'true' || req.query?.nocache === '1';
  if (!noCache && CACHE.data && Date.now() - CACHE.ts < CACHE_TTL) {
    return res.json({
      success: true,
      message: 'Adiantamentos e crediários (cache)',
      count: CACHE.data.length,
      data: CACHE.data,
    });
  }

  try {
    // 1) Lista de franquias no Supabase (pes_pessoa)
    const franquias = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('pes_pessoa')
        .select('code, fantasy_name')
        .like('fantasy_name', 'F%CROSBY%')
        .eq('is_customer', true)
        .range(from, from + 999);
      if (error) throw new Error(`Supabase pes_pessoa: ${error.message}`);
      if (!data?.length) break;
      franquias.push(...data);
      if (data.length < 1000) break;
    }
    if (franquias.length === 0) {
      return res.json({ success: true, count: 0, data: [], message: 'Nenhuma franquia encontrada' });
    }
    const codes = franquias
      .map((f) => parseInt(f.code, 10))
      .filter((c) => Number.isFinite(c) && c > 0 && c !== 56);
    const nomeMap = new Map(franquias.map((f) => [Number(f.code), f.fantasy_name]));

    // 2) Saldo financeiro via TOTVS (reusa a rota interna já pronta)
    const r = await axios.post(
      `${INTERNAL_API_BASE}/api/totvs/franchise-financial-balance`,
      { customerCodeList: codes, branchCodeList: MATRIZ_BRANCHES, pageSize: 500 },
      { timeout: 180000 },
    );
    const items = r.data?.data?.items || r.data?.items || [];

    // 3) Monta linhas CREDEV / ADIANTAMENTO por franquia+empresa
    const rows = [];
    for (const it of items) {
      const code = Number(it.code);
      if (!code || code === 56) continue;
      const nome = nomeMap.get(code) || it.name || null;
      const dtRef = it.maxChangeFilterDate || new Date().toISOString();
      for (const bv of it.values || []) {
        const empresa = Number(bv.branchCode);
        if (!Number.isFinite(empresa) || empresa >= 5999) continue;
        const credev = Math.round(Number(bv.refundCreditValue || 0) * 100) / 100;
        const adiant = Math.round(Number(bv.advanceAmountValue || 0) * 100) / 100;
        if (credev > 0) {
          rows.push({
            cd_empresa: empresa,
            nr_ctapes: null,
            cd_pessoa: code,
            nm_fantasia: nome,
            ds_titular: it.name || null,
            tp_documento: 'CREDEV',
            vl_saldo: credev,
            dt_ultimocredito: dtRef,
          });
        }
        if (adiant > 0) {
          rows.push({
            cd_empresa: empresa,
            nr_ctapes: null,
            cd_pessoa: code,
            nm_fantasia: nome,
            ds_titular: it.name || null,
            tp_documento: 'ADIANTAMENTO',
            vl_saldo: adiant,
            dt_ultimocredito: dtRef,
          });
        }
      }
    }
    rows.sort((a, b) => b.vl_saldo - a.vl_saldo);

    CACHE = { ts: Date.now(), data: rows };
    return res.json({
      success: true,
      message: 'Adiantamentos e crediários obtidos com sucesso',
      count: rows.length,
      data: rows,
    });
  } catch (e) {
    console.error('[credev-adiantamento]', e.message);
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar credev/adiantamento no TOTVS',
      error: e.message,
    });
  }
});

export default router;
