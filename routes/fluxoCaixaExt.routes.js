// ============================================================
// FLUXO DE CAIXA EXT — extratos bancários importados (Stone, Sicredi,
// Caixa, Mêntore) → entradas, saídas e transferências entre contas.
//
// Endpoints (prefixo /api/fluxo-caixa-ext):
//   GET    /contas                          → contas do grupo + última importação
//   PATCH  /contas/:id                      → apelido / titular / CNPJ / ativo
//   GET    /importacoes                     → histórico de PDFs importados
//   DELETE /importacoes/:id                 → remove a importação e seus lançamentos
//   GET    /importacoes/:id/arquivo         → link temporário do PDF guardado (bot Stone)
//   POST   /ler        (multipart: arquivo) → só lê o PDF (conferência), não grava
//   POST   /importar   (multipart: arquivos[]) → grava e recasa transferências
//   GET    /painel?de&ate[&contas&bancos&tipo&formas&categoria&contraparte&busca]
//   POST   /transferencias/recasar?de&ate  → refaz o casamento automático (antes completa a contraparte escondida no texto)
//   POST   /lancamentos/enriquecer-contrapartes?de&ate → completa contraparte_doc/nome/banco pelo histórico (dados antigos)
//   PATCH  /lancamentos/:id                 → fornecedor / observação / forma / tipo
//   GET    /formas                          → formas de pagamento padronizadas
//   GET    /conciliacao/buscar-cr?titulo|codigo|cnpj|nome|tipoData(vencimento|emissao|pagamento)|de|ate|status(todos|aberto|pago)|valorMin|valorMax → busca manual no contas a receber (só o pesquisado)
//   GET    /conciliacao/buscar-cp?duplicata|codigo|cnpj|nome|tipoData|de|ate|status|valorMin|valorMax → busca manual no contas a pagar + Liberação + Solicitações (só o pesquisado)
//   GET    /conciliacao/candidatos?lancamentoId → candidatos (Liberação, Solicitações, TOTVS CP)
//   POST   /conciliacao/automatica {contaId?, de, ate} → concilia saídas pendentes com decisão segura
//   POST   /conciliacao/techfin (arquivos: CSVs da Techfin; ?simular=1) → repasses do Pix TOTVS × extrato × contas a receber
//   POST   /conciliacao {lancamentoId, origem, referencia, justificativa} → grava/justifica
//   DELETE /conciliacao/:id                  → desfaz
// Sem as tabelas → 503 MIGRATION_PENDING (migrations/fluxo_caixa_ext.sql).
//
// ESCOPO: o mesmo router é montado duas vezes (index.js), cada um preso a um
// escopo de contas (coluna fluxo_caixa_contas.escopo):
//   /api/fluxo-caixa-ext              → 'crosby'  (Extrato Bancário do grupo)
//   /api/dr-ygor/extratos-bancarios   → 'dr_ygor' (Financeiro → Dr Ygor)
// ============================================================
import express from 'express';
import multer from 'multer';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { FORMAS } from '../utils/extratosBancariosPdf.js';
import fluxo, { MigrationPendingError } from '../services/fluxoCaixaExt.js';
import conciliacao from '../services/fluxoCaixaConciliacao.js';
import { importarTechfin } from '../services/techfinConciliacao.js';
import { urlComprovante } from '../services/comprovantesStone.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 60 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|xlsx|ofx|csv)$/i.test(file.originalname || '') || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Envie o extrato em PDF ou OFX (Stone, Sicredi, Caixa, Mêntore, BNB, Santander, Unicred, Daycoval, Bradesco, Banco do Brasil, Itaú), o CSV da Stone ou a planilha .xlsx do Pagar.me.'), ok);
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

export function criarRouter(escopoFixo = fluxo.ESCOPO_PADRAO) {
const escopo = fluxo.normEscopo(escopoFixo);
const router = express.Router();

router.get(
  '/formas',
  asyncHandler(async (req, res) => successResponse(res, Object.values(FORMAS))),
);

router.get(
  '/contas',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await fluxo.listarContas(escopo));
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
      return successResponse(res, await fluxo.listarImportacoes(escopo));
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

// comprovante de saída baixado do portal Stone pelo bot (link temporário)
router.get(
  '/comprovantes/:id/arquivo',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await urlComprovante(Number(req.params.id)));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.get(
  '/importacoes/:id/arquivo',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await fluxo.urlArquivoImportacao(Number(req.params.id)));
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
        { usuario: usuarioDe(req), escopo },
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
        escopo,
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
  '/lancamentos/enriquecer-contrapartes',
  asyncHandler(async (req, res) => {
    const { de, ate } = { ...req.query, ...(req.body || {}) };
    try {
      return successResponse(res, await fluxo.enriquecerContrapartes({ de: de ? String(de) : null, ate: ate ? String(ate) : null, escopo }), 'Contrapartes completadas');
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
      await fluxo.enriquecerContrapartes({ de: String(de), ate: String(ate), escopo }).catch(() => {});
      return successResponse(res, await fluxo.casarTransferencias({ de: String(de), ate: String(ate), escopo }), 'Transferências recasadas');
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

// ─── pró-labore: saídas aos sócios em todas as contas do período ──
router.get(
  '/pro-labore',
  asyncHandler(async (req, res) => {
    const { de, ate } = req.query;
    if (!de || !ate) return errorResponse(res, 'Informe de e ate (YYYY-MM-DD).', 400);
    try {
      const r = await fluxo.painel({ de: String(de), ate: String(ate) });
      const lancamentos = (r.lancamentos || []).filter((l) => l.proLabore || l.conciliacao?.origem === 'PRO_LABORE');
      return successResponse(res, { de, ate, pessoas: conciliacao.PESSOAS_PRO_LABORE, lancamentos });
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

// busca manual: nº da duplicata, fornecedor (nome/CNPJ), vencimento de/até, valor min/max
router.get(
  '/conciliacao/buscar-cr',
  asyncHandler(async (req, res) => {
    const q = req.query;
    try {
      return successResponse(res, await conciliacao.buscarContasReceber({ titulo: q.titulo, cliente: q.cliente, codigo: q.codigo, cnpj: q.cnpj, nome: q.nome, tipoData: q.tipoData, de: q.de, ate: q.ate, emissaoDe: q.emissaoDe, emissaoAte: q.emissaoAte, status: q.status, valorMin: q.valorMin, valorMax: q.valorMax, lancamentoId: q.lancamentoId ? Number(q.lancamentoId) : null }));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.get(
  '/conciliacao/buscar-cp',
  asyncHandler(async (req, res) => {
    const q = req.query;
    try {
      return successResponse(res, await conciliacao.buscarContasPagar({ duplicata: q.duplicata, fornecedor: q.fornecedor, codigo: q.codigo, cnpj: q.cnpj, nome: q.nome, tipoData: q.tipoData, de: q.de, ate: q.ate, emissaoDe: q.emissaoDe, emissaoAte: q.emissaoAte, status: q.status, valorMin: q.valorMin, valorMax: q.valorMax, fontes: q.fontes, lancamentoId: q.lancamentoId ? Number(q.lancamentoId) : null }));
    } catch (e) {
      return tratar(res, e);
    }
  }),
);

router.post(
  '/conciliacao/techfin',
  comUpload([{ name: 'arquivos', maxCount: 60 }, { name: 'arquivo', maxCount: 1 }]),
  asyncHandler(async (req, res) => {
    try {
      const simular = ['1', 'true'].includes(String(req.query?.simular ?? req.body?.simular ?? ''));
      const r = await importarTechfin({ arquivos: req.arquivos.map((f) => ({ buffer: f.buffer, nome: f.originalname })), usuario: usuarioDe(req), simular, escopo });
      return successResponse(res, r, simular ? 'Simulação concluída' : `${r.totais.conciliadas} repasse(s) conciliado(s)`);
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
      const r = await conciliacao.conciliarAutomatico({ contaId: contaId ? Number(contaId) : null, de: String(de), ate: String(ate), usuario: usuarioDe(req), simular: !!req.body?.simular, apenas: req.body?.apenas || null });
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
  '/conciliacao/:id/justificativa',
  asyncHandler(async (req, res) => {
    try {
      return successResponse(res, await conciliacao.atualizarJustificativa(Number(req.params.id), req.body?.justificativa, usuarioDe(req)), 'Justificativa atualizada');
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

return router;
}

const router = criarRouter('crosby');
export const routerDrYgor = criarRouter('dr_ygor');
export default router;
