// ============================================================
// New Extrato Bancário (reconstrução do zero) — /api/novo-extrato
//   POST /importar            (multipart "arquivos": PDF do BB, Itaú, Sicredi, Santander, Unicred ou Bradesco, OFX da Caixa ou Santander; ?forcar=1 aceita saldo que não bate/encadeia)
//   GET  /contas              contas/importações já gravadas
//   GET  /lancamentos?de&ate&bancos&contas&tipos&busca  (traz também transferencias [pares] e semPar)
//   POST /transferencias/recasar                        refaz o casamento entre as contas importadas
// Serviço: services/novoExtrato.js · leitores: utils/extratoBbPdf.js, utils/extratoItauPdf.js, utils/extratoSicrediPdf.js, utils/extratoSantanderPdf.js, utils/extratoSantanderOfx.js, utils/extratoUnicredPdf.js, utils/extratoBradescoPdf.js, utils/extratoCaixaOfx.js
// ============================================================
import express from 'express';
import multer from 'multer';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import novo from '../services/novoExtrato.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 40 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|ofx)$/i.test(file.originalname || '') || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Envie o extrato em PDF (BB, Itaú, Sicredi, Santander, Unicred ou Bradesco) ou OFX (Caixa ou Santander).'), ok);
  },
});
const usuarioDe = (req) => req.headers['x-user-email'] || req.headers['x-user-name'] || null;
const lista = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(',').map((x) => x.trim()).filter(Boolean));

router.post('/importar', (req, res, next) =>
  upload.fields([{ name: 'arquivos', maxCount: 40 }, { name: 'arquivo', maxCount: 1 }])(req, res, (err) => {
    if (err) return errorResponse(res, err.message, 400, 'UPLOAD');
    req.arquivos = [...(req.files?.arquivos || []), ...(req.files?.arquivo || [])];
    if (!req.arquivos.length) return errorResponse(res, 'Nenhum arquivo enviado (campo "arquivos").', 400);
    next();
  }),
  asyncHandler(async (req, res) => {
    const forcar = ['1', 'true'].includes(String(req.query?.forcar ?? req.body?.forcar ?? ''));
    const resultados = [];
    for (const f of req.arquivos) {
      try {
        const r = await novo.importarExtrato({ buffer: f.buffer, nome: f.originalname, usuario: usuarioDe(req), forcar });
        resultados.push({ arquivo: f.originalname, ok: true, ...r });
      } catch (e) {
        resultados.push({ arquivo: f.originalname, ok: false, erro: e.message, conferencia: e.leitura?.conferencia || null });
      }
    }
    const ok = resultados.filter((r) => r.ok).length;
    return successResponse(res, { resultados, ok, falhas: resultados.length - ok }, `${ok} de ${resultados.length} extrato(s) importado(s)`);
  }),
);

router.get(
  '/contas',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await novo.listarContas());
    } catch (e) {
      return errorResponse(res, e.message, 500, 'NOVO_EXTRATO');
    }
  }),
);

router.post(
  '/transferencias/recasar',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await novo.casarTransferencias(), 'Transferências recasadas');
    } catch (e) {
      return errorResponse(res, e.message, 500, 'NOVO_EXTRATO');
    }
  }),
);

router.get(
  '/lancamentos',
  asyncHandler(async (req, res) => {
    const q = req.query || {};
    try {
      return successResponse(res, await novo.listarLancamentos({ de: q.de || null, ate: q.ate || null, bancos: lista(q.bancos), contas: lista(q.contas), tipos: lista(q.tipos), busca: q.busca || '' }));
    } catch (e) {
      return errorResponse(res, e.message, 500, 'NOVO_EXTRATO');
    }
  }),
);

export default router;
