// ============================================================
// PROVISÃO AUTOMÁTICA (Liberação de Pagamento) — duplicatas selecionadas
//
// A rotina diária (jobs/provisao-liberacao.job.js) provisiona, além das
// despesas fixas por código, as duplicatas específicas que o usuário escolhe
// na tela (botão "Selecionar duplicatas" em Provisão). Esta rota mantém essa
// lista (tabela provisao_duplicatas_selecionadas) e pesquisa o Contas a Pagar
// do TOTVS com a mesma regra de filiais do job.
//
// Endpoints (prefixo /api/provisao-liberacao) — exige login; escrita só
// admin/owner:
//   GET    /duplicatas       → lista das duplicatas na automação
//   POST   /duplicatas       → adiciona { itens: [ {cd_fornecedor, nr_duplicata, ...} ] }
//   DELETE /duplicatas/:id   → remove uma
//   POST   /buscar           → pesquisa no Contas a Pagar
//                              { dt_inicio, dt_fim, cd_fornecedor?, nr_duplicata? }
// Migration: migrations/provisao_duplicatas_selecionadas.sql
// ============================================================
import express from 'express';
import supabase from '../config/supabase.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import {
  buscarDuplicatasContasPagar,
  carregarDuplicatasSelecionadas,
} from '../jobs/provisao-liberacao.job.js';

const router = express.Router();
router.use(requireAuth);
const admin = requireRole('owner', 'admin');

const TABELA = 'provisao_duplicatas_selecionadas';
const isoDate = (d) => {
  if (!d) return null;
  const s = String(d).split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// GET /duplicatas — lista completa
router.get(
  '/duplicatas',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from(TABELA)
      .select('*')
      .order('nm_fornecedor', { ascending: true })
      .order('nr_duplicata', { ascending: true });
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, { itens: data || [], total: (data || []).length });
  }),
);

// POST /duplicatas — adiciona um ou mais pares (fornecedor, duplicata).
// Pares já cadastrados são ignorados (não dá erro).
router.post(
  '/duplicatas',
  admin,
  asyncHandler(async (req, res) => {
    const itens = Array.isArray(req.body?.itens)
      ? req.body.itens
      : req.body?.cd_fornecedor
        ? [req.body]
        : [];
    const linhas = [];
    for (const it of itens) {
      const cd = parseInt(it.cd_fornecedor, 10);
      const nr = it.nr_duplicata != null ? String(it.nr_duplicata).trim() : '';
      if (Number.isNaN(cd) || cd <= 0 || !nr) continue;
      const vl = parseFloat(it.vl_duplicata);
      linhas.push({
        cd_fornecedor: cd,
        nm_fornecedor: it.nm_fornecedor || null,
        nr_duplicata: nr,
        cd_empresa: it.cd_empresa != null ? parseInt(it.cd_empresa, 10) || null : null,
        nm_empresa: it.nm_empresa || null,
        nr_parcela: it.nr_parcela != null ? String(it.nr_parcela) : null,
        dt_vencimento: isoDate(it.dt_vencimento),
        vl_duplicata: Number.isNaN(vl) ? null : vl,
        ds_despesaitem: it.ds_despesaitem || null,
        observacao: it.observacao || null,
        adicionado_por: req.user?.email || null,
      });
    }
    if (linhas.length === 0) {
      return errorResponse(
        res,
        'Informe ao menos uma duplicata válida (cd_fornecedor + nr_duplicata).',
        400,
        'INVALID',
      );
    }
    // dedup dentro do próprio pedido
    const vistos = new Set();
    const unicas = linhas.filter((l) => {
      const k = `${l.cd_fornecedor}|${l.nr_duplicata}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    const { data, error } = await supabase
      .from(TABELA)
      .upsert(unicas, {
        onConflict: 'cd_fornecedor,nr_duplicata',
        ignoreDuplicates: true,
      })
      .select('*');
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    const inseridas = data || [];
    successResponse(
      res,
      {
        inseridas,
        total_enviadas: unicas.length,
        ja_existiam: unicas.length - inseridas.length,
      },
      `${inseridas.length} duplicata(s) adicionada(s) à automação`,
    );
  }),
);

// DELETE /duplicatas/:id
router.delete(
  '/duplicatas/:id',
  admin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return errorResponse(res, 'id inválido', 400, 'INVALID');
    const { data, error } = await supabase
      .from(TABELA)
      .delete()
      .eq('id', id)
      .select('id');
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    if (!data || data.length === 0) {
      return errorResponse(res, 'Duplicata não encontrada', 404, 'NOT_FOUND');
    }
    successResponse(res, { id }, 'Duplicata removida da automação');
  }),
);

// POST /buscar — pesquisa no Contas a Pagar (Normais, em aberto, filiais do job)
router.post(
  '/buscar',
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, cd_fornecedor, nr_duplicata } = req.body || {};
    const dtInicio = isoDate(dt_inicio);
    const dtFim = isoDate(dt_fim);
    if (!dtInicio || !dtFim) {
      return errorResponse(
        res,
        'Informe o período de vencimento (dt_inicio e dt_fim).',
        400,
        'MISSING_PARAMS',
      );
    }
    const supplierCodeList = [];
    const duplicateCodeList = [];
    if (cd_fornecedor != null && String(cd_fornecedor).trim() !== '') {
      const cd = parseInt(cd_fornecedor, 10);
      if (Number.isNaN(cd)) {
        return errorResponse(res, 'Código do fornecedor inválido.', 400, 'INVALID');
      }
      supplierCodeList.push(cd);
    }
    if (nr_duplicata != null && String(nr_duplicata).trim() !== '') {
      const nr = parseInt(String(nr_duplicata).trim(), 10);
      if (Number.isNaN(nr)) {
        return errorResponse(res, 'Número da duplicata inválido.', 400, 'INVALID');
      }
      duplicateCodeList.push(nr);
    }
    if (supplierCodeList.length === 0 && duplicateCodeList.length === 0) {
      return errorResponse(
        res,
        'Informe o fornecedor ou o número da duplicata.',
        400,
        'MISSING_PARAMS',
      );
    }

    const [itens, selecionadas] = await Promise.all([
      buscarDuplicatasContasPagar({
        dtInicio,
        dtFim,
        supplierCodeList,
        duplicateCodeList,
      }),
      carregarDuplicatasSelecionadas(),
    ]);
    const jaNaAutomacao = new Set(
      selecionadas.map((s) => `${s.cd_fornecedor}|${s.nr_duplicata}`),
    );
    const resultado = itens
      .filter((it) => {
        // o TOTVS pode cruzar os filtros; garante o par exato quando os dois vêm
        if (
          supplierCodeList.length &&
          !supplierCodeList.includes(parseInt(it.cd_fornecedor, 10))
        )
          return false;
        if (
          duplicateCodeList.length &&
          !duplicateCodeList.includes(parseInt(it.nr_duplicata, 10))
        )
          return false;
        return true;
      })
      .map((it) => ({
        cd_empresa: it.cd_empresa ?? null,
        cd_fornecedor: it.cd_fornecedor ?? null,
        nm_fornecedor: it.nm_fornecedor || null,
        nr_duplicata: it.nr_duplicata != null ? String(it.nr_duplicata) : null,
        nr_parcela: it.nr_parcela != null ? String(it.nr_parcela) : null,
        dt_emissao: isoDate(it.dt_emissao),
        dt_vencimento: isoDate(it.dt_vencimento),
        vl_duplicata: parseFloat(it.vl_duplicata || 0),
        cd_despesaitem: it.cd_despesaitem ?? null,
        ds_despesaitem: it.ds_despesaitem || null,
        ja_na_automacao: jaNaAutomacao.has(
          `${it.cd_fornecedor}|${String(it.nr_duplicata)}`,
        ),
      }))
      .sort((a, b) =>
        String(a.dt_vencimento || '').localeCompare(String(b.dt_vencimento || '')),
      );
    successResponse(res, {
      periodo: { dt_inicio: dtInicio, dt_fim: dtFim },
      itens: resultado,
      total: resultado.length,
    });
  }),
);

export default router;
