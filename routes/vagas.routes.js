// RH / Banco de Talentos — Vagas + Inscrições
//
//  Públicas (LP /vagas/<slug>, sem auth):
//    GET  /api/vagas/publica/:slug            — dados da vaga p/ montar a LP
//    POST /api/vagas/inscricoes               — recebe inscrição + currículo (multipart)
//
//  Admin (painel; protegidas pelo x-api-key global + PrivateRoute do front):
//    GET    /api/vagas                         — lista vagas (+ nº de inscrições)
//    POST   /api/vagas                         — cria vaga (gera slug único)
//    PATCH  /api/vagas/:id                     — edita/ativa/desativa vaga
//    DELETE /api/vagas/:id                     — remove vaga
//    GET    /api/vagas/:id/inscricoes          — lista candidatos da vaga
//    GET    /api/vagas/inscricoes/:id/curriculo— signed URL do currículo (download)
//    PATCH  /api/vagas/inscricoes/:id          — atualiza status/observação
import express from 'express';
import multer from 'multer';
import path from 'path';
import supabase from '../config/supabase.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';

const router = express.Router();

const CURRICULO_BUCKET = 'curriculos';

// Upload em memória; persiste no Supabase Storage. Aceita PDF/DOC/DOCX até 10MB.
const TIPOS_CURRICULO = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (TIPOS_CURRICULO.has(file.mimetype)) return cb(null, true);
    cb(new Error('Formato inválido. Envie PDF, DOC ou DOCX.'));
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────
function clean(s, max = 255) {
  if (s == null) return null;
  return String(s).trim().slice(0, max) || null;
}
function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function slugify(s) {
  return (
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'vaga'
  );
}
// Gera slug único checando colisão em rh_vagas.slug.
async function gerarSlugUnico(titulo) {
  const base = slugify(titulo);
  let slug = base;
  for (let i = 0; i < 6; i++) {
    const { data } = await supabase
      .from('rh_vagas')
      .select('id')
      .eq('slug', slug)
      .limit(1);
    if (!data || data.length === 0) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ══════════════════════════════════════════════════════════════════════
// PÚBLICO
// ══════════════════════════════════════════════════════════════════════

// GET /api/vagas/publica/:slug — só retorna se a vaga estiver ativa.
router.get(
  '/publica/:slug',
  asyncHandler(async (req, res) => {
    const slug = clean(req.params.slug, 80);
    if (!slug) return errorResponse(res, 'slug inválido', 400);
    const { data, error } = await supabase
      .from('rh_vagas')
      .select(
        'id, slug, titulo, cargo, cidade, estado, tipo_contratacao, descricao, requisitos, beneficios, ativo',
      )
      .eq('slug', slug)
      .maybeSingle();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    if (!data || !data.ativo)
      return errorResponse(res, 'Vaga não encontrada ou encerrada', 404, 'VAGA_INDISPONIVEL');
    successResponse(res, data);
  }),
);

// POST /api/vagas/inscricoes — submissão pública (multipart: campos + curriculo)
router.post(
  '/inscricoes',
  upload.single('curriculo'),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const nome = clean(b.nome);
    const email = clean(b.email, 255)?.toLowerCase();
    if (!nome) return errorResponse(res, 'Nome é obrigatório', 400);
    if (email && !isEmail(email)) return errorResponse(res, 'E-mail inválido', 400);

    // Resolve a vaga (por id ou slug) — a LP envia vaga_slug.
    let vaga = null;
    const vagaSlug = clean(b.vaga_slug, 80);
    const vagaId = parseInt(b.vaga_id, 10);
    if (vagaSlug || vagaId) {
      const q = supabase.from('rh_vagas').select('id, slug, cargo, ativo');
      const { data } = vagaSlug
        ? await q.eq('slug', vagaSlug).maybeSingle()
        : await q.eq('id', vagaId).maybeSingle();
      vaga = data || null;
    }

    // Upload do currículo (opcional, mas recomendado)
    let curriculoPath = null;
    let curriculoNome = null;
    if (req.file) {
      const ext = (path.extname(req.file.originalname) || '').toLowerCase();
      const nomeArq = slugify(nome).slice(0, 40) || 'candidato';
      const pasta = vaga?.slug || vagaSlug || 'geral';
      const storagePath = `${pasta}/${Date.now()}_${nomeArq}${ext}`;
      const { error: upErr } = await supabase.storage
        .from(CURRICULO_BUCKET)
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });
      if (upErr) {
        console.error('[vagas/inscricoes] upload curriculo:', upErr.message);
        return errorResponse(res, 'Falha ao salvar o currículo', 500, 'UPLOAD_ERROR');
      }
      curriculoPath = storagePath;
      curriculoNome = clean(req.file.originalname, 255);
    }

    const row = {
      vaga_id: vaga?.id || null,
      vaga_slug: vaga?.slug || vagaSlug || null,
      nome,
      email,
      telefone: clean(b.telefone, 30),
      cargo: clean(b.cargo, 120) || vaga?.cargo || null,
      cidade: clean(b.cidade, 120),
      estado: clean(b.estado, 2)?.toUpperCase() || null,
      indicacao: clean(b.indicacao, 10),
      indicado_por: clean(b.indicado_por, 120),
      curriculo_path: curriculoPath,
      curriculo_nome: curriculoNome,
      origem: clean(b.origem) || 'lp_vagas',
      ip:
        req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        null,
      user_agent: clean(req.headers['user-agent'], 500),
      status: 'novo',
    };

    const { data, error } = await supabase
      .from('rh_inscricoes')
      .insert(row)
      .select('id')
      .single();
    if (error) {
      console.error('[vagas/inscricoes POST] supabase:', error.message);
      // Não deixa currículo órfão no storage se o insert falhou
      if (curriculoPath)
        await supabase.storage.from(CURRICULO_BUCKET).remove([curriculoPath]).catch(() => {});
      return errorResponse(res, 'Falha ao registrar a inscrição', 500, 'DB_ERROR');
    }
    successResponse(res, { id: data.id }, 'Inscrição enviada com sucesso', 201);
  }),
);

// ══════════════════════════════════════════════════════════════════════
// ADMIN — Vagas
// ══════════════════════════════════════════════════════════════════════

// GET /api/vagas — lista com contagem de inscrições por vaga.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { data: vagas, error } = await supabase
      .from('rh_vagas')
      .select('*')
      .order('criado_em', { ascending: false });
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');

    // Tally de inscrições por vaga (client-side; volume baixo).
    const { data: insc } = await supabase.from('rh_inscricoes').select('vaga_id');
    const contagem = {};
    for (const r of insc || []) {
      if (r.vaga_id != null) contagem[r.vaga_id] = (contagem[r.vaga_id] || 0) + 1;
    }
    const out = (vagas || []).map((v) => ({
      ...v,
      total_inscricoes: contagem[v.id] || 0,
    }));
    successResponse(res, out, `${out.length} vagas encontradas`);
  }),
);

// POST /api/vagas — cria vaga (gera slug único a partir do título).
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const titulo = clean(b.titulo, 200);
    if (!titulo) return errorResponse(res, 'Título é obrigatório', 400);
    const slug = await gerarSlugUnico(titulo);
    const row = {
      slug,
      titulo,
      cargo: clean(b.cargo, 120),
      cidade: clean(b.cidade, 120),
      estado: clean(b.estado, 2)?.toUpperCase() || null,
      tipo_contratacao: clean(b.tipo_contratacao, 60),
      descricao: clean(b.descricao, 5000),
      requisitos: clean(b.requisitos, 5000),
      beneficios: clean(b.beneficios, 5000),
      ativo: b.ativo !== false && b.ativo !== 'false',
    };
    const { data, error } = await supabase
      .from('rh_vagas')
      .insert(row)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Vaga criada com sucesso', 201);
  }),
);

// PATCH /api/vagas/:id — edita campos permitidos.
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return errorResponse(res, 'id inválido', 400);
    const allowed = [
      'titulo',
      'cargo',
      'cidade',
      'estado',
      'tipo_contratacao',
      'descricao',
      'requisitos',
      'beneficios',
      'ativo',
    ];
    const patch = {};
    for (const k of allowed) {
      if (k in req.body) {
        let v = req.body[k];
        if (typeof v === 'string') v = v.trim() || null;
        if (k === 'estado' && typeof v === 'string') v = v.toUpperCase().slice(0, 2);
        if (k === 'ativo') v = v !== false && v !== 'false';
        patch[k] = v;
      }
    }
    if (Object.keys(patch).length === 0)
      return errorResponse(res, 'Nenhum campo válido', 400);
    const { data, error } = await supabase
      .from('rh_vagas')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Vaga atualizada');
  }),
);

// DELETE /api/vagas/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return errorResponse(res, 'id inválido', 400);
    const { error } = await supabase.from('rh_vagas').delete().eq('id', id);
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, { id }, 'Vaga removida');
  }),
);

// ══════════════════════════════════════════════════════════════════════
// ADMIN — Inscrições
// ══════════════════════════════════════════════════════════════════════

// GET /api/vagas/inscricoes/:id/curriculo — signed URL p/ download (5 min).
router.get(
  '/inscricoes/:id/curriculo',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return errorResponse(res, 'id inválido', 400);
    const { data: insc, error } = await supabase
      .from('rh_inscricoes')
      .select('curriculo_path, curriculo_nome')
      .eq('id', id)
      .maybeSingle();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    if (!insc?.curriculo_path) return errorResponse(res, 'Sem currículo anexado', 404);
    const { data: signed, error: e2 } = await supabase.storage
      .from(CURRICULO_BUCKET)
      .createSignedUrl(insc.curriculo_path, 60 * 5);
    if (e2) return errorResponse(res, e2.message, 500);
    successResponse(res, { url: signed.signedUrl, nome: insc.curriculo_nome });
  }),
);

// PATCH /api/vagas/inscricoes/:id — atualiza status/observação.
router.patch(
  '/inscricoes/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return errorResponse(res, 'id inválido', 400);
    const patch = {};
    if ('status' in req.body) patch.status = clean(req.body.status, 40) || 'novo';
    if ('observacao' in req.body) patch.observacao = clean(req.body.observacao, 2000);
    if (Object.keys(patch).length === 0)
      return errorResponse(res, 'Nenhum campo válido', 400);
    const { data, error } = await supabase
      .from('rh_inscricoes')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Inscrição atualizada');
  }),
);

// GET /api/vagas/:id/inscricoes — lista candidatos da vaga.
router.get(
  '/:id/inscricoes',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return errorResponse(res, 'id inválido', 400);
    const status = clean(req.query.status, 40);
    let q = supabase
      .from('rh_inscricoes')
      .select('*')
      .eq('vaga_id', id)
      .order('criado_em', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data || [], `${(data || []).length} inscrições`);
  }),
);

export default router;
