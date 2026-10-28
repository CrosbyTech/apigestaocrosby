// ============================================================================
// /api/balanco-rfid — arquivos de balanço do app Android (Urovo DT50 + RFDT50)
//
//   POST /                 salva uma contagem finalizada no app
//   GET  /                 lista (?empresa=&de=&ate=&busca=) — sem os EPCs
//   GET  /:id              arquivo completo (com os EPCs)
//   POST /:id/resumo       agrupa por produto (EPC → EAN → TOTVS); ?forcar=1 refaz
//   GET  /:id/csv          exporta (?tipo=epcs|produtos)
// ============================================================================
import express from 'express';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { BalancoError, erroMigracao, salvarArquivo, gerarResumo, gerarCsv } from '../services/balancoRfid.js';

const router = express.Router();

function responder(res, err) {
  if (err instanceof BalancoError) return errorResponse(res, err.message, err.status, err.code);
  if (erroMigracao(err)) {
    return errorResponse(res, 'Tabela balanco_rfid_arquivos não existe — rode migrations/balanco_rfid.sql no Supabase', 503, 'MIGRATION_PENDING');
  }
  return errorResponse(res, err?.message || 'Erro no balanço RFID', 500, 'DB_ERROR');
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const r = await salvarArquivo(req.body || {});
      return successResponse(res, r, r.jaExistia ? 'Arquivo já estava salvo' : 'Balanço salvo', r.jaExistia ? 200 : 201);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const empresa = parseInt(req.query.empresa, 10) || null;
    const de = req.query.de ? String(req.query.de).slice(0, 10) : null;
    const ate = req.query.ate ? String(req.query.ate).slice(0, 10) : null;
    const busca = String(req.query.busca || '').trim();
    let q = supabase
      .from('balanco_rfid_arquivos')
      .select('id, nome, empresa, empresa_nome, usuario_nome, usuario_email, iniciado_em, finalizado_em, duracao_seg, qtd_epcs, qtd_leituras, dispositivo, resumo_em, criado_em')
      .order('finalizado_em', { ascending: false })
      .limit(Math.min(parseInt(req.query.limite, 10) || 300, 1000));
    if (empresa) q = q.eq('empresa', empresa);
    if (de) q = q.gte('finalizado_em', `${de}T00:00:00-03:00`);
    if (ate) q = q.lte('finalizado_em', `${ate}T23:59:59.999-03:00`);
    if (busca) q = q.ilike('nome', `%${busca}%`);
    const { data, error } = await q;
    if (error) return responder(res, error);
    const items = data || [];
    return successResponse(
      res,
      { items, resumo: { arquivos: items.length, pecas: items.reduce((s, i) => s + (i.qtd_epcs || 0), 0) } },
      `${items.length} arquivo(s)`,
    );
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from('balanco_rfid_arquivos').select('*').eq('id', parseInt(req.params.id, 10)).maybeSingle();
    if (error) return responder(res, error);
    if (!data) return errorResponse(res, 'Arquivo não encontrado', 404, 'NOT_FOUND');
    return successResponse(res, data, 'Arquivo de balanço');
  }),
);

router.post(
  '/:id/resumo',
  asyncHandler(async (req, res) => {
    try {
      const r = await gerarResumo(parseInt(req.params.id, 10), { forcar: req.query.forcar === '1' || req.body?.forcar === true });
      return successResponse(res, r, r.cache ? 'Resumo (cache)' : 'Resumo por produto');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.get(
  '/:id/csv',
  asyncHandler(async (req, res) => {
    try {
      const { arquivo, conteudo } = await gerarCsv(parseInt(req.params.id, 10), req.query.tipo === 'produtos' ? 'produtos' : 'epcs');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(arquivo)}`);
      return res.send(conteudo);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

export default router;
