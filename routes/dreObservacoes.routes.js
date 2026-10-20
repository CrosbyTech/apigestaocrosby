// ============================================================================
// Importador de observações do DRE (planilha → observacoes_despesas_totvs).
// Montado em /api/dre-observacoes. Exige sessão do HeadCoach.
//
//   POST /preview   (multipart "arquivo")                  analisa, não grava
//   POST /importar  (multipart "arquivo" + dt_inicio/dt_fim/substituir)  grava
// ============================================================================
import express from 'express';
import multer from 'multer';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import * as obs from '../services/dreObservacoes.js';
import { importarHistorico } from '../services/dreHistoricoHtml.js';

const router = express.Router();
router.use(requireAuth);
// Importar/preview exige só login (qualquer usuário logado). A gravação de
// observação já é liberada a qualquer usuário pela própria tela do DRE, então
// não faz sentido o import ser mais restrito (bloqueava o perfil "guest").
const escrita = (req, res, next) => next();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Envie a planilha (.xlsx, .xls ou .csv).'), ok);
  },
});
const comArquivo = (req, res, next) =>
  upload.single('arquivo')(req, res, (err) => {
    if (err) return errorResponse(res, err.message, 400, 'UPLOAD');
    if (!req.file) return errorResponse(res, 'Nenhuma planilha enviada (campo "arquivo").', 400, 'VALIDATION');
    next();
  });

function tratar(res, err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  return errorResponse(res, err.message, status, status === 400 ? 'VALIDATION' : 'ERRO');
}

router.post(
  '/preview',
  escrita,
  comArquivo,
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, obs.preview(req.file.buffer), 'Planilha analisada');
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/importar',
  escrita,
  comArquivo,
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, substituir } = req.body || {};
    try {
      const r = await obs.importar({
        buffer: req.file.buffer,
        dtInicio: dt_inicio,
        dtFim: dt_fim,
        cdUsuario: req.user.id,
        substituir: String(substituir) === 'true',
        por: req.user.email,
      });
      return successResponse(res, r, `Observações importadas: ${r.gravadas} gravadas, ${r.puladas} puladas, ${r.erros} erros`);
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

// Importa o HISTÓRICO (jan–ago) do HTML "Despesas Gerais 2026".
const uploadHtml = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(html?|txt)$/i.test(file.originalname || '') || /html|text/i.test(file.mimetype || '');
    cb(ok ? null : new Error('Envie o arquivo .html da análise de despesas.'), ok);
  },
});
router.post(
  '/importar-historico-html',
  (req, res, next) =>
    uploadHtml.single('arquivo')(req, res, (err) => {
      if (err) return errorResponse(res, err.message, 400, 'UPLOAD');
      if (!req.file) return errorResponse(res, 'Nenhum arquivo enviado (campo "arquivo").', 400, 'VALIDATION');
      next();
    }),
  asyncHandler(async (req, res) => {
    try {
      const r = await importarHistorico({
        html: req.file.buffer.toString('utf8'),
        ano: Number(req.body?.ano) || 2026,
        cdUsuario: req.user.id,
        substituir: String(req.body?.substituir) === 'true',
      });
      return successResponse(res, r, `Histórico importado: ${r.gravadas} observações (jan–ago)`);
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

export default router;
