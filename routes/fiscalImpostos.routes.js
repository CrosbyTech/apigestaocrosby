// ============================================================================
// Painel de Impostos (aba Fiscal) — montado em /api/fiscal-impostos.
// Exige sessão do HeadCoach. v1: ICMS (provisão pelas notas + realizado por SPED).
//
//   GET  /empresas                         filiais do painel
//   GET  /painel?ano=&imposto=ICMS         grid filial × mês
//   POST /provisao/calcular {cdEmpresa,ano,mes}   calcula 1 célula (TOTVS)
//   POST /provisao/calcular-mes {ano,mes}         calcula todas as filiais do mês
//   POST /sped/importar  (multipart "arquivo", ou {conteudo})  realizado
// ============================================================================
import express from 'express';
import multer from 'multer';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import * as fiscal from '../services/fiscalImpostos.js';

const router = express.Router();
router.use(requireAuth);
const escrita = requireRole('owner', 'admin', 'manager', 'user');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(txt|sped|efd)$/i.test(file.originalname || '') || file.mimetype === 'text/plain';
    cb(ok ? null : new Error('Envie o arquivo do SPED EFD ICMS/IPI (.txt).'), ok);
  },
});

function tratar(res, err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const code = err.code || (status === 400 ? 'VALIDATION' : status === 503 ? 'MIGRATION_PENDING' : 'ERRO');
  return errorResponse(res, err.message, status, code);
}

router.get(
  '/empresas',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await fiscal.listarFiliais());
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.get(
  '/painel',
  asyncHandler(async (req, res) => {
    const ano = Number(req.query.ano) || new Date().getFullYear();
    const imposto = String(req.query.imposto || 'ICMS').toUpperCase();
    try {
      return successResponse(res, await fiscal.listarPainel({ ano, imposto }));
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/provisao/calcular',
  escrita,
  asyncHandler(async (req, res) => {
    const { cdEmpresa, ano, mes } = req.body || {};
    if (!cdEmpresa || !ano || !mes) return errorResponse(res, 'Informe cdEmpresa, ano e mes', 400, 'VALIDATION');
    try {
      const r = await fiscal.calcularProvisao({ cdEmpresa, ano, mes, por: req.user.email });
      return successResponse(res, r, r.pulado ? 'Mês já tem SPED realizado — provisão não sobrescreve' : 'Provisão calculada');
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/provisao/calcular-mes',
  escrita,
  asyncHandler(async (req, res) => {
    const { ano, mes } = req.body || {};
    if (!ano || !mes) return errorResponse(res, 'Informe ano e mes', 400, 'VALIDATION');
    try {
      return successResponse(res, await fiscal.calcularProvisaoMes({ ano, mes, por: req.user.email }), 'Provisão do mês calculada');
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

router.post(
  '/sped/importar',
  escrita,
  (req, res, next) =>
    upload.single('arquivo')(req, res, (err) => {
      if (err) return errorResponse(res, err.message, 400, 'UPLOAD');
      next();
    }),
  asyncHandler(async (req, res) => {
    const conteudo = req.file ? req.file.buffer.toString('latin1') : req.body?.conteudo;
    if (!conteudo) return errorResponse(res, 'Envie o arquivo do SPED (campo "arquivo") ou o texto em "conteudo".', 400, 'VALIDATION');
    try {
      const r = await fiscal.importarSped({ conteudo, nomeArquivo: req.file?.originalname || 'sped.txt', por: req.user.email });
      return successResponse(res, r, `SPED importado: ${r.resultados.filter((x) => x.ok).length}/${r.periodos} períodos`);
    } catch (err) {
      return tratar(res, err);
    }
  }),
);

export default router;
