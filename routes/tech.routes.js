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

export default router;
