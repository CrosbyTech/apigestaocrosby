// ============================================================
// TECNOLOGIA — Rotas
// /chips        — controle de chips telefônicos
// ============================================================
import express from 'express';
import supabase from '../config/supabase.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';

const router = express.Router();

// ──────────────────────────────────────────────────────────────
// CRUD: Chips
// ──────────────────────────────────────────────────────────────

// GET /api/tech/chips
//   Filtros: status, setor, operadora, responsavel, q (busca livre)
router.get(
  '/chips',
  asyncHandler(async (req, res) => {
    const { status, setor, operadora, responsavel, q } = req.query;
    let query = supabase
      .from('tech_chips')
      .select('*')
      .order('atualizado_em', { ascending: false });
    if (status) query = query.eq('status', status);
    if (setor) query = query.eq('setor', setor);
    if (operadora) query = query.eq('operadora', operadora);
    if (responsavel) query = query.ilike('responsavel', `%${responsavel}%`);
    if (q) {
      query = query.or(
        `numero.ilike.%${q}%,responsavel.ilike.%${q}%,setor.ilike.%${q}%,local_uso.ilike.%${q}%`,
      );
    }
    const { data, error } = await query;
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { chips: data || [], total: (data || []).length });
  }),
);

// GET /api/tech/chips/:id
router.get(
  '/chips/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { data, error } = await supabase
      .from('tech_chips')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return errorResponse(res, error.message, 500);
    if (!data) return errorResponse(res, 'Chip não encontrado', 404);
    return successResponse(res, data);
  }),
);

// POST /api/tech/chips
router.post(
  '/chips',
  asyncHandler(async (req, res) => {
    const {
      numero,
      responsavel,
      setor,
      local_uso,
      operadora,
      plano,
      valor_plano,
      iccid,
      status,
      data_aquisicao,
      data_cancelamento,
      motivo_cancelamento,
      observacao,
      tem_api,
      tem_whatsapp,
    } = req.body || {};

    if (!numero) return errorResponse(res, 'numero é obrigatório', 400);
    const numeroClean = String(numero).replace(/\D/g, '');
    if (numeroClean.length < 8) {
      return errorResponse(res, 'número inválido (mínimo 8 dígitos)', 400);
    }

    // Verifica duplicidade
    const { data: existing } = await supabase
      .from('tech_chips')
      .select('id')
      .eq('numero_clean', numeroClean)
      .maybeSingle();
    if (existing) {
      return errorResponse(res, `Já existe chip cadastrado com esse número`, 409);
    }

    const userLogin = req.headers['x-user-login'] || req.headers['x-user'] || null;
    const payload = {
      numero: String(numero).trim(),
      numero_clean: numeroClean,
      responsavel: responsavel ? String(responsavel).trim() : null,
      setor: setor ? String(setor).trim() : null,
      local_uso: local_uso ? String(local_uso).trim() : null,
      operadora: operadora ? String(operadora).toLowerCase().trim() : null,
      plano: plano ? String(plano).trim() : null,
      valor_plano: valor_plano != null && valor_plano !== '' ? Number(valor_plano) : null,
      iccid: iccid ? String(iccid).trim() : null,
      status: status || 'ativo',
      data_aquisicao: data_aquisicao || null,
      data_cancelamento: data_cancelamento || null,
      motivo_cancelamento: motivo_cancelamento ? String(motivo_cancelamento).trim() : null,
      observacao: observacao ? String(observacao).trim() : null,
      tem_api: tem_api === true || tem_api === 'true',
      tem_whatsapp: tem_whatsapp === true || tem_whatsapp === 'true',
      criado_por: userLogin,
      atualizado_por: userLogin,
    };

    const { data, error } = await supabase
      .from('tech_chips')
      .insert(payload)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 400);

    // Log
    try {
      await supabase.from('tech_chips_log').insert({
        chip_id: data.id,
        acao: 'create',
        valor_novo: JSON.stringify(payload),
        alterado_por: userLogin,
      });
    } catch {}

    return successResponse(res, data, 'Chip cadastrado');
  }),
);

// PATCH /api/tech/chips/:id
router.patch(
  '/chips/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const userLogin = req.headers['x-user-login'] || req.headers['x-user'] || null;

    const { data: anterior } = await supabase
      .from('tech_chips')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!anterior) return errorResponse(res, 'Chip não encontrado', 404);

    const patch = {};
    const editable = [
      'numero', 'responsavel', 'setor', 'local_uso', 'operadora', 'plano', 'valor_plano',
      'iccid', 'status', 'data_aquisicao', 'data_cancelamento', 'motivo_cancelamento', 'observacao',
      'tem_api', 'tem_whatsapp',
    ];
    for (const f of editable) {
      if (req.body?.[f] !== undefined) {
        // Booleans podem chegar como string ou bool
        if (f === 'tem_api' || f === 'tem_whatsapp') {
          patch[f] = req.body[f] === true || req.body[f] === 'true';
        } else if (f === 'valor_plano') {
          patch[f] = req.body[f] === '' || req.body[f] == null ? null : Number(req.body[f]);
        } else {
          patch[f] = req.body[f];
        }
      }
    }
    if (patch.numero) {
      const numeroClean = String(patch.numero).replace(/\D/g, '');
      patch.numero_clean = numeroClean;
      // Verifica duplicidade
      if (numeroClean !== anterior.numero_clean) {
        const { data: dup } = await supabase
          .from('tech_chips')
          .select('id')
          .eq('numero_clean', numeroClean)
          .neq('id', id)
          .maybeSingle();
        if (dup) return errorResponse(res, 'Já existe outro chip com esse número', 409);
      }
    }
    patch.atualizado_em = new Date().toISOString();
    patch.atualizado_por = userLogin;

    const { data, error } = await supabase
      .from('tech_chips')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 400);

    // Log das mudanças campo-a-campo
    try {
      const changes = [];
      for (const f of editable) {
        if (req.body?.[f] !== undefined && String(anterior[f] ?? '') !== String(req.body[f] ?? '')) {
          changes.push({
            chip_id: id,
            acao: 'update',
            campo_alterado: f,
            valor_anterior: String(anterior[f] ?? ''),
            valor_novo: String(req.body[f] ?? ''),
            alterado_por: userLogin,
          });
        }
      }
      if (changes.length > 0) {
        await supabase.from('tech_chips_log').insert(changes);
      }
    } catch (e) {
      console.warn('[tech_chips/log] falha:', e.message);
    }

    return successResponse(res, data, 'Chip atualizado');
  }),
);

// DELETE /api/tech/chips/:id
router.delete(
  '/chips/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const userLogin = req.headers['x-user-login'] || req.headers['x-user'] || null;

    const { data: anterior } = await supabase
      .from('tech_chips')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!anterior) return errorResponse(res, 'Chip não encontrado', 404);

    const { error } = await supabase.from('tech_chips').delete().eq('id', id);
    if (error) return errorResponse(res, error.message, 500);

    try {
      await supabase.from('tech_chips_log').insert({
        chip_id: id,
        acao: 'delete',
        valor_anterior: JSON.stringify(anterior),
        alterado_por: userLogin,
      });
    } catch {}

    return successResponse(res, { deleted: true }, 'Chip removido');
  }),
);

// GET /api/tech/chips-log?chip_id=
router.get(
  '/chips-log',
  asyncHandler(async (req, res) => {
    const chipId = parseInt(req.query.chip_id, 10);
    let q = supabase.from('tech_chips_log').select('*').order('alterado_em', { ascending: false }).limit(500);
    if (chipId) q = q.eq('chip_id', chipId);
    const { data, error } = await q;
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { logs: data || [] });
  }),
);

// GET /api/tech/chips-stats
//   Estatísticas agregadas (count por status, operadora, setor)
router.get(
  '/chips-stats',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('tech_chips')
      .select('status, operadora, setor, valor_plano, tem_api, tem_whatsapp');
    if (error) return errorResponse(res, error.message, 500);

    const por_status = {};
    const por_operadora = {};
    const por_setor = {};
    let custo_mensal_total = 0;
    let custo_mensal_ativos = 0;
    let com_api = 0;
    let com_whatsapp = 0;
    for (const c of data || []) {
      por_status[c.status || 'sem_status'] = (por_status[c.status || 'sem_status'] || 0) + 1;
      por_operadora[c.operadora || 'sem_operadora'] = (por_operadora[c.operadora || 'sem_operadora'] || 0) + 1;
      por_setor[c.setor || 'sem_setor'] = (por_setor[c.setor || 'sem_setor'] || 0) + 1;
      const v = Number(c.valor_plano || 0);
      custo_mensal_total += v;
      if (c.status === 'ativo') custo_mensal_ativos += v;
      if (c.tem_api) com_api += 1;
      if (c.tem_whatsapp) com_whatsapp += 1;
    }

    return successResponse(res, {
      total: (data || []).length,
      por_status,
      por_operadora,
      por_setor,
      custo_mensal_total: Number(custo_mensal_total.toFixed(2)),
      custo_mensal_ativos: Number(custo_mensal_ativos.toFixed(2)),
      com_api,
      com_whatsapp,
    });
  }),
);

// ============================================================
// PATRIMÔNIO — Inventário de bens da empresa
// /patrimonio                  — CRUD + filtros
// /patrimonio/estatisticas     — totais por tipo/setor/status
// /patrimonio/proximo-codigo   — sugere próximo código (PAT-XXXXXX)
// ============================================================

const PATRIMONIO_TIPOS = new Set([
  'ar_condicionado',
  'celular',
  'computador',
  'notebook',
  'impressora',
  'monitor',
  'mobiliario',
  'televisor',
  'roteador',
  'outro',
]);

const PATRIMONIO_STATUS = new Set([
  'ativo',
  'em_manutencao',
  'emprestado',
  'descartado',
  'extraviado',
]);

// GET /api/tech/patrimonio
//   Filtros: tipo, status, setor, local, responsavel, q (busca livre)
router.get(
  '/patrimonio',
  asyncHandler(async (req, res) => {
    const { tipo, status, setor, local, responsavel, q } = req.query;
    let query = supabase
      .from('tech_patrimonio')
      .select('*')
      .order('atualizado_em', { ascending: false });
    if (tipo) query = query.eq('tipo', tipo);
    if (status) query = query.eq('status', status);
    if (setor) query = query.eq('setor', setor);
    if (local) query = query.ilike('local', `%${local}%`);
    if (responsavel) query = query.ilike('responsavel', `%${responsavel}%`);
    if (q) {
      query = query.or(
        `codigo_patrimonio.ilike.%${q}%,descricao.ilike.%${q}%,marca.ilike.%${q}%,modelo.ilike.%${q}%,numero_serie.ilike.%${q}%,responsavel.ilike.%${q}%,local.ilike.%${q}%`,
      );
    }
    const { data, error } = await query;
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, {
      items: data || [],
      total: (data || []).length,
    });
  }),
);

// GET /api/tech/patrimonio/estatisticas
router.get(
  '/patrimonio/estatisticas',
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase
      .from('tech_patrimonio')
      .select(
        'tipo, status, setor, local, valor_aquisicao, data_aquisicao',
      );
    if (error) return errorResponse(res, error.message, 500);
    const list = data || [];

    const counter = (key) => {
      const out = {};
      for (const r of list) {
        const k = r[key] || 'sem_info';
        out[k] = (out[k] || 0) + 1;
      }
      return out;
    };
    const por_tipo = counter('tipo');
    const por_status = counter('status');
    const por_setor = counter('setor');
    const por_local = counter('local');

    const valor_total = list.reduce(
      (s, r) => s + (Number(r.valor_aquisicao) || 0),
      0,
    );
    const valor_ativos = list
      .filter((r) => r.status === 'ativo')
      .reduce((s, r) => s + (Number(r.valor_aquisicao) || 0), 0);

    return successResponse(res, {
      total: list.length,
      por_tipo,
      por_status,
      por_setor,
      por_local,
      valor_total: Number(valor_total.toFixed(2)),
      valor_ativos: Number(valor_ativos.toFixed(2)),
    });
  }),
);

// GET /api/tech/patrimonio/proximo-codigo
//   Retorna sugestão de próximo código (PAT-XXXXXX, com zero-padding)
router.get(
  '/patrimonio/proximo-codigo',
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase
      .from('tech_patrimonio')
      .select('codigo_patrimonio')
      .like('codigo_patrimonio', 'PAT-%')
      .order('id', { ascending: false })
      .limit(50);
    if (error) return errorResponse(res, error.message, 500);
    let maxNum = 0;
    for (const r of data || []) {
      const m = String(r.codigo_patrimonio || '').match(/PAT-(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    const proximo = `PAT-${String(maxNum + 1).padStart(6, '0')}`;
    return successResponse(res, { proximo, ultimo_numero: maxNum });
  }),
);

// GET /api/tech/patrimonio/:id
router.get(
  '/patrimonio/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { data, error } = await supabase
      .from('tech_patrimonio')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return errorResponse(res, error.message, 500);
    if (!data) return errorResponse(res, 'Patrimônio não encontrado', 404);
    return successResponse(res, data);
  }),
);

// POST /api/tech/patrimonio
router.post(
  '/patrimonio',
  asyncHandler(async (req, res) => {
    const {
      codigo_patrimonio,
      tipo,
      descricao,
      marca,
      modelo,
      numero_serie,
      local,
      setor,
      responsavel,
      responsavel_cpf,
      responsavel_email,
      data_aquisicao,
      valor_aquisicao,
      fornecedor,
      nota_fiscal,
      status,
      observacao,
      criado_por,
    } = req.body || {};

    if (!codigo_patrimonio || !codigo_patrimonio.trim()) {
      return errorResponse(res, 'codigo_patrimonio obrigatório', 400);
    }
    if (!tipo || !PATRIMONIO_TIPOS.has(tipo)) {
      return errorResponse(
        res,
        `tipo inválido (use: ${[...PATRIMONIO_TIPOS].join(', ')})`,
        400,
      );
    }
    if (status && !PATRIMONIO_STATUS.has(status)) {
      return errorResponse(
        res,
        `status inválido (use: ${[...PATRIMONIO_STATUS].join(', ')})`,
        400,
      );
    }

    // Verifica duplicidade
    const { data: existente } = await supabase
      .from('tech_patrimonio')
      .select('id')
      .eq('codigo_patrimonio', codigo_patrimonio.trim())
      .maybeSingle();
    if (existente) {
      return errorResponse(
        res,
        `Código de patrimônio "${codigo_patrimonio}" já existe`,
        409,
      );
    }

    const payload = {
      codigo_patrimonio: codigo_patrimonio.trim(),
      tipo,
      descricao: descricao || null,
      marca: marca || null,
      modelo: modelo || null,
      numero_serie: numero_serie || null,
      local: local || null,
      setor: setor || null,
      responsavel: responsavel || null,
      responsavel_cpf: responsavel_cpf || null,
      responsavel_email: responsavel_email || null,
      data_aquisicao: data_aquisicao || null,
      valor_aquisicao:
        valor_aquisicao != null && valor_aquisicao !== ''
          ? Number(valor_aquisicao)
          : null,
      fornecedor: fornecedor || null,
      nota_fiscal: nota_fiscal || null,
      status: status || 'ativo',
      observacao: observacao || null,
      criado_por: criado_por || null,
      atualizado_por: criado_por || null,
    };

    const { data, error } = await supabase
      .from('tech_patrimonio')
      .insert(payload)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500);

    // Log
    await supabase.from('tech_patrimonio_log').insert({
      patrimonio_id: data.id,
      acao: 'create',
      valor_novo: JSON.stringify(payload).slice(0, 1000),
      alterado_por: criado_por || null,
    });

    return successResponse(res, data);
  }),
);

// PUT /api/tech/patrimonio/:id
router.put(
  '/patrimonio/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { atualizado_por, ...patch } = req.body || {};

    if (patch.tipo && !PATRIMONIO_TIPOS.has(patch.tipo)) {
      return errorResponse(res, 'tipo inválido', 400);
    }
    if (patch.status && !PATRIMONIO_STATUS.has(patch.status)) {
      return errorResponse(res, 'status inválido', 400);
    }

    // Verifica duplicidade do código se for atualizado
    if (patch.codigo_patrimonio) {
      const { data: existente } = await supabase
        .from('tech_patrimonio')
        .select('id')
        .eq('codigo_patrimonio', patch.codigo_patrimonio.trim())
        .neq('id', id)
        .maybeSingle();
      if (existente) {
        return errorResponse(
          res,
          `Código de patrimônio "${patch.codigo_patrimonio}" já existe em outro item`,
          409,
        );
      }
      patch.codigo_patrimonio = patch.codigo_patrimonio.trim();
    }

    // Normaliza campos
    if (patch.valor_aquisicao === '') patch.valor_aquisicao = null;
    if (patch.data_aquisicao === '') patch.data_aquisicao = null;

    patch.atualizado_por = atualizado_por || null;

    const { data, error } = await supabase
      .from('tech_patrimonio')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500);

    await supabase.from('tech_patrimonio_log').insert({
      patrimonio_id: id,
      acao: 'update',
      valor_novo: JSON.stringify(patch).slice(0, 1000),
      alterado_por: atualizado_por || null,
    });

    return successResponse(res, data);
  }),
);

// DELETE /api/tech/patrimonio/:id
router.delete(
  '/patrimonio/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { deletado_por } = req.body || {};

    // Log antes de deletar
    await supabase.from('tech_patrimonio_log').insert({
      patrimonio_id: id,
      acao: 'delete',
      alterado_por: deletado_por || null,
    });

    const { error } = await supabase
      .from('tech_patrimonio')
      .delete()
      .eq('id', id);
    if (error) return errorResponse(res, error.message, 500);

    return successResponse(res, { id, deleted: true });
  }),
);

export default router;
