// ============================================================
// FLUXO DE CAIXA EXT — extratos bancários importados (Stone, Sicredi,
// Caixa, Mêntore) → entradas, saídas e transferências entre contas.
//
// Endpoints (prefixo /api/fluxo-caixa-ext):
//   GET    /contas                          → contas do grupo + última importação
//   PATCH  /contas/:id                      → apelido / titular / CNPJ / ativo
//   GET    /importacoes                     → histórico de PDFs importados
//   DELETE /importacoes/:id                 → remove a importação e seus lançamentos
//   POST   /ler        (multipart: arquivo) → só lê o PDF (conferência), não grava
//   POST   /importar   (multipart: arquivos[]) → grava e recasa transferências
//   GET    /painel?de&ate[&contas&bancos&tipo&formas&categoria&contraparte&busca]
//   POST   /transferencias/recasar?de&ate  → refaz o casamento automático
//   PATCH  /lancamentos/:id                 → fornecedor / observação / forma / tipo
//   GET    /formas                          → formas de pagamento padronizadas
//   GET    /conciliacao/candidatos?lancamentoId → candidatos (Liberação, Solicitações, TOTVS CP)
//   POST   /conciliacao/automatica {contaId?, de, ate} → concilia saídas pendentes com decisão segura
//   POST   /conciliacao {lancamentoId, origem, referencia, justificativa} → grava/justifica
//   DELETE /conciliacao/:id                  → desfaz
// Sem as tabelas → 503 MIGRATION_PENDING (migrations/fluxo_caixa_ext.sql).
// ============================================================
import express from 'express';
import multer from 'multer';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { FORMAS } from '../utils/extratosBancariosPdf.js';
import fluxo, { MigrationPendingError } from '../services/fluxoCaixaExt.js';
import conciliacao from '../services/fluxoCaixaConciliacao.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 60 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|xlsx)$/i.test(file.originalname || '') || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Envie o PDF do extrato (Stone, Sicredi, Caixa, Mêntore, BNB, Santander, Unicred, Daycoval) ou a planilha .xlsx do Pagar.me.'), ok);
  },
});

const comUpload = (campos) => (req, res, next) =>
  upload.fields(campos)(req, res, (err) => {
    if (err) return errorResponse(res, err.message, 400, 'UPLOAD');
    const lista = [...(req.files?.arquivos || []), ...(req.files?.arquivo || [])];
    if (!lista.length) return errorResponse(res, 'Nenhum arquivo enviado (campo "arquivos").', 400);
    req.arquivos = lista;
    next();
  });

const tratar = (res, e) => {
  if (e instanceof MigrationPendingError || e?.code === 'MIGRATION_PENDING') return errorResponse(res, e.message, 503, 'MIGRATION_PENDING');
  console.error('[fluxo-caixa-ext]', e);
  return errorResponse(res, e.message || 'Erro interno', 500, 'FLUXO_CAIXA_EXT');
};

const lista = (v) =>
  v == null || v === ''
    ? null
    : (Array.isArray(v) ? v : String(v).split(','))
        .map((s) => String(s).trim())
        .filter(Boolean);

const usuarioDe = (req) => req.headers['x-user-email'] || req.headers['x-user-name'] || req.body?.usuario || null;

router.get(
  '/formas',
  asyncHandler(async (req, res) => successResponse(res, Object.values(FORMAS))),
);

router.get(
  '/contas',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await fluxo.listarContas());
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.patch(
  '/contas/:id',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await fluxo.atualizarConta(Number(req.params.id), req.body || {}), 'Conta atualizada');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.get(
  '/importacoes',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await fluxo.listarImportacoes());
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.delete(
  '/importacoes/:id',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await fluxo.excluirImportacao(Number(req.params.id)), 'Importação removida');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.post(
  '/ler',
  comUpload([
    { name: 'arquivos', maxCount: 60 },
    { name: 'arquivo', maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const out = [];
    for (const f of req.arquivos) {
      try {
        out.push({ arquivo: f.originalname, ok: true, ...(await fluxo.lerExtrato(f.buffer, { nomeArquivo: f.originalname })) });
      } catch (e) {
        out.push({ arquivo: f.originalname, ok: false, erro: e.message });
      }
    }
    return successResponse(res, out);
  }),
);

router.post(
  '/importar',
  comUpload([
    { name: 'arquivos', maxCount: 60 },
    { name: 'arquivo', maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    try {
      const r = await fluxo.importarVarios(
        req.arquivos.map((f) => ({ buffer: f.buffer, nome: f.originalname })),
        { usuario: usuarioDe(req) },
      );
      const ok = r.resultados.filter((x) => x.ok).length;
      return successResponse(res, r, `${ok} de ${r.resultados.length} extrato(s) importado(s)`);
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.get(
  '/painel',
  asyncHandler(async (req, res) => {
    const q = req.query;
    if (!q.de || !q.ate) return errorResponse(res, 'Informe de e ate (AAAA-MM-DD).', 400);
    try {
      const data = await fluxo.painel({
        de: String(q.de),
        ate: String(q.ate),
        contas: lista(q.contas)?.map(Number),
        bancos: lista(q.bancos),
        tipo: q.tipo ? String(q.tipo).toUpperCase() : null,
        tipos: lista(q.tipos)?.map((t) => t.toUpperCase()),
        formas: lista(q.formas),
        categoria: q.categoria ? String(q.categoria) : null,
        contraparte: q.contraparte ? String(q.contraparte) : null,
        busca: q.busca ? String(q.busca) : null,
        pendencia: q.pendencia ? String(q.pendencia) : null,
      });
      return successResponse(res, data);
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.post(
  '/transferencias/recasar',
  asyncHandler(async (req, res) => {
    const de = req.query.de || req.body?.de;
    const ate = req.query.ate || req.body?.ate;
    if (!de || !ate) return errorResponse(res, 'Informe de e ate.', 400);
    try {
      return successResponse(res, await fluxo.casarTransferencias({ de: String(de), ate: String(ate) }), 'Transferências recasadas');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.patch(
  '/lancamentos/:id',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await fluxo.atualizarLancamento(Number(req.params.id), req.body || {}), 'Lançamento atualizado');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

// ─── conciliação das pendências ───────────────────────────────
router.get(
  '/conciliacao/candidatos',
  asyncHandler(async (req, res) => {
    const id = Number(req.query.lancamentoId);
    if (!id) return errorResponse(res, 'Informe lancamentoId.', 400);
    try {
      return successResponse(res, await conciliacao.buscarCandidatos(id));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

// aquece o cache das fontes (TOTVS é pesado) — a tela chama ao abrir o período
router.post(
  '/conciliacao/preparar',
  asyncHandler(async (req, res) => {
    const { de, ate } = req.body || {};
    if (!de || !ate) return errorResponse(res, 'Informe de e ate (AAAA-MM-DD).', 400);
    try {
      return successResponse(res, await conciliacao.prepararFontes({ de: String(de), ate: String(ate) }));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.post(
  '/conciliacao/automatica',
  asyncHandler(async (req, res) => {
    const { contaId, de, ate } = req.body || {};
    if (!de || !ate) return errorResponse(res, 'Informe de e ate (AAAA-MM-DD).', 400);
    try {
      const r = await conciliacao.conciliarAutomatico({ contaId: contaId ? Number(contaId) : null, de: String(de), ate: String(ate), usuario: usuarioDe(req) });
      return successResponse(res, r, `${r.conciliadas.length} de ${r.pendentes} saída(s) conciliada(s) automaticamente`);
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.post(
  '/conciliacao',
  asyncHandler(async (req, res) => {
    const { lancamentoId, origem, referencia, justificativa, pontuacao } = req.body || {};
    if (!lancamentoId || !origem) return errorResponse(res, 'Informe lancamentoId e origem.', 400);
    try {
      const r = await conciliacao.salvarConciliacao({ lancamentoId: Number(lancamentoId), origem: String(origem).toUpperCase(), referencia, justificativa, usuario: usuarioDe(req), automatico: false, pontuacao: pontuacao ?? null });
      return successResponse(res, r, 'Pendência conciliada');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.get(
  '/conciliacao/:id/detalhe',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await conciliacao.detalheConciliacao(Number(req.params.id)));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.patch(
  '/conciliacao/:id/anexos',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await conciliacao.atualizarAnexos(Number(req.params.id), req.body?.anexos), 'Anexos atualizados');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.delete(
  '/conciliacao/:id',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await conciliacao.excluirConciliacao(Number(req.params.id)), 'Conciliação desfeita');
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

export default router;
