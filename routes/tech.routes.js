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

// ──────────────────────────────────────────────────────────────
// COTAÇÃO DE COMPRAS — 1 item/cotação, N fornecedores
// ──────────────────────────────────────────────────────────────

const COTACAO_STATUS = new Set([
  'rascunho', 'cotando', 'escolhido', 'comprado', 'cancelado',
]);
const COTACAO_URGENCIA = new Set(['baixa', 'normal', 'alta']);
const COTACAO_TIPO = new Set(['online', 'presencial']);
const COTACAO_CATEGORIA = new Set([
  'compras', 'patrimonio', 'uso_consumo', 'tecnologia',
]);
const COTACAO_BUCKET = 'tech-cotacoes-anexos';

// GET /api/tech/cotacoes — lista (filtros: status, urgencia, categoria, q)
router.get(
  '/cotacoes',
  asyncHandler(async (req, res) => {
    const { status, urgencia, categoria, q } = req.query;
    let query = supabase
      .from('tech_cotacoes')
      .select(`
        *,
        fornecedores:tech_cotacoes_fornecedores!cotacao_id(id, fornecedor_nome, valor_unitario, frete, taxas, tipo_compra)
      `)
      .order('criado_em', { ascending: false });
    if (status) query = query.eq('status', status);
    if (urgencia) query = query.eq('urgencia', urgencia);
    if (categoria) query = query.eq('categoria', categoria);
    if (q) {
      query = query.or(
        `titulo.ilike.%${q}%,descricao.ilike.%${q}%,solicitante.ilike.%${q}%`,
      );
    }
    const { data, error } = await query;
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { cotacoes: data || [], total: (data || []).length });
  }),
);

// GET /api/tech/cotacoes/:id — detalhe (cotação + fornecedores)
router.get(
  '/cotacoes/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return errorResponse(res, 'id inválido', 400);
    const { data: cot, error: e1 } = await supabase
      .from('tech_cotacoes')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (e1) return errorResponse(res, e1.message, 500);
    if (!cot) return errorResponse(res, 'Cotação não encontrada', 404);
    const { data: forn, error: e2 } = await supabase
      .from('tech_cotacoes_fornecedores')
      .select('*')
      .eq('cotacao_id', id)
      .order('valor_unitario', { ascending: true });
    if (e2) return errorResponse(res, e2.message, 500);
    return successResponse(res, { ...cot, fornecedores: forn || [] });
  }),
);

// POST /api/tech/cotacoes — cria
router.post(
  '/cotacoes',
  asyncHandler(async (req, res) => {
    const {
      titulo, descricao, quantidade, unidade,
      categoria, solicitante, urgencia, data_necessidade, observacao,
    } = req.body || {};
    if (!titulo || !String(titulo).trim()) {
      return errorResponse(res, 'titulo é obrigatório', 400);
    }
    if (urgencia && !COTACAO_URGENCIA.has(urgencia)) {
      return errorResponse(res, 'urgencia inválida', 400);
    }
    if (categoria && !COTACAO_CATEGORIA.has(categoria)) {
      return errorResponse(res, 'categoria inválida', 400);
    }
    const userLogin = req.headers['x-user-login'] || req.headers['x-user'] || null;
    const payload = {
      titulo: String(titulo).trim(),
      descricao: descricao || null,
      quantidade: Number(quantidade) > 0 ? Number(quantidade) : 1,
      unidade: unidade || 'un',
      categoria: categoria || 'compras',
      status: 'rascunho',
      solicitante: solicitante || null,
      urgencia: urgencia || 'normal',
      data_necessidade: data_necessidade || null,
      observacao: observacao || null,
      criado_por: userLogin,
    };
    const { data, error } = await supabase
      .from('tech_cotacoes')
      .insert(payload)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, data, 'Cotação criada');
  }),
);

// PATCH /api/tech/cotacoes/:id — edita (incluindo status e fornecedor_escolhido_id)
router.patch(
  '/cotacoes/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return errorResponse(res, 'id inválido', 400);
    const body = req.body || {};
    if (body.status && !COTACAO_STATUS.has(body.status)) {
      return errorResponse(res, 'status inválido', 400);
    }
    if (body.urgencia && !COTACAO_URGENCIA.has(body.urgencia)) {
      return errorResponse(res, 'urgencia inválida', 400);
    }
    if (body.categoria && !COTACAO_CATEGORIA.has(body.categoria)) {
      return errorResponse(res, 'categoria inválida', 400);
    }
    const allowed = [
      'titulo', 'descricao', 'quantidade', 'unidade', 'categoria', 'status',
      'fornecedor_escolhido_id', 'solicitante', 'urgencia',
      'data_necessidade', 'observacao',
    ];
    const update = {};
    for (const k of allowed) if (k in body) update[k] = body[k];
    if (Object.keys(update).length === 0) {
      return errorResponse(res, 'nenhum campo válido para atualizar', 400);
    }
    // Se marcou escolhido, força status escolhido (a menos que mande explícito)
    if (update.fornecedor_escolhido_id && !update.status) {
      update.status = 'escolhido';
    }
    const { data, error } = await supabase
      .from('tech_cotacoes')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500);
    if (!data) return errorResponse(res, 'Cotação não encontrada', 404);
    return successResponse(res, data, 'Cotação atualizada');
  }),
);

// DELETE /api/tech/cotacoes/:id — remove (cascade nos fornecedores)
router.delete(
  '/cotacoes/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return errorResponse(res, 'id inválido', 400);
    // Apaga anexos do storage antes de deletar
    const { data: forn } = await supabase
      .from('tech_cotacoes_fornecedores')
      .select('anexo_path')
      .eq('cotacao_id', id);
    const paths = (forn || []).map((f) => f.anexo_path).filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from(COTACAO_BUCKET).remove(paths);
    }
    const { error } = await supabase.from('tech_cotacoes').delete().eq('id', id);
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { id, deleted: true });
  }),
);

// ─── Fornecedores ─────────────────────────────────────────────

// POST /api/tech/cotacoes/:id/fornecedores — adiciona
router.post(
  '/cotacoes/:id/fornecedores',
  asyncHandler(async (req, res) => {
    const cotacao_id = parseInt(req.params.id, 10);
    if (!cotacao_id) return errorResponse(res, 'cotacao_id inválido', 400);
    const {
      fornecedor_nome, fornecedor_contato, tipo_compra,
      link, endereco, valor_unitario, frete, taxas,
      prazo_entrega, condicao_pagamento, garantia,
      anexo_path, anexo_nome, observacao,
    } = req.body || {};
    if (!fornecedor_nome || !String(fornecedor_nome).trim()) {
      return errorResponse(res, 'fornecedor_nome é obrigatório', 400);
    }
    const tipo = tipo_compra || 'online';
    if (!COTACAO_TIPO.has(tipo)) {
      return errorResponse(res, 'tipo_compra inválido', 400);
    }
    const payload = {
      cotacao_id,
      fornecedor_nome: String(fornecedor_nome).trim(),
      fornecedor_contato: fornecedor_contato || null,
      tipo_compra: tipo,
      link: link || null,
      endereco: endereco || null,
      valor_unitario: Number(valor_unitario) || 0,
      frete: Number(frete) || 0,
      taxas: Number(taxas) || 0,
      prazo_entrega: prazo_entrega || null,
      condicao_pagamento: condicao_pagamento || null,
      garantia: garantia || null,
      anexo_path: anexo_path || null,
      anexo_nome: anexo_nome || null,
      observacao: observacao || null,
    };
    const { data, error } = await supabase
      .from('tech_cotacoes_fornecedores')
      .insert(payload)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500);
    // Cotação sai de rascunho automaticamente quando recebe 1º fornecedor
    await supabase
      .from('tech_cotacoes')
      .update({ status: 'cotando' })
      .eq('id', cotacao_id)
      .eq('status', 'rascunho');
    return successResponse(res, data, 'Fornecedor adicionado');
  }),
);

// PATCH /api/tech/cotacoes/fornecedores/:id — edita
router.patch(
  '/cotacoes/fornecedores/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return errorResponse(res, 'id inválido', 400);
    const body = req.body || {};
    if (body.tipo_compra && !COTACAO_TIPO.has(body.tipo_compra)) {
      return errorResponse(res, 'tipo_compra inválido', 400);
    }
    const allowed = [
      'fornecedor_nome', 'fornecedor_contato', 'tipo_compra',
      'link', 'endereco', 'valor_unitario', 'frete', 'taxas',
      'prazo_entrega', 'condicao_pagamento', 'garantia',
      'anexo_path', 'anexo_nome', 'observacao',
    ];
    const update = {};
    for (const k of allowed) if (k in body) update[k] = body[k];
    if (Object.keys(update).length === 0) {
      return errorResponse(res, 'nenhum campo válido para atualizar', 400);
    }
    const { data, error } = await supabase
      .from('tech_cotacoes_fornecedores')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500);
    if (!data) return errorResponse(res, 'Fornecedor não encontrado', 404);
    return successResponse(res, data, 'Fornecedor atualizado');
  }),
);

// DELETE /api/tech/cotacoes/fornecedores/:id — remove
router.delete(
  '/cotacoes/fornecedores/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return errorResponse(res, 'id inválido', 400);
    // Apaga anexo do storage antes
    const { data: f } = await supabase
      .from('tech_cotacoes_fornecedores')
      .select('anexo_path')
      .eq('id', id)
      .maybeSingle();
    if (f?.anexo_path) {
      await supabase.storage.from(COTACAO_BUCKET).remove([f.anexo_path]);
    }
    const { error } = await supabase
      .from('tech_cotacoes_fornecedores')
      .delete()
      .eq('id', id);
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { id, deleted: true });
  }),
);

// GET /api/tech/cotacoes/anexo/:fornecedorId — gera signed URL p/ download
router.get(
  '/cotacoes/anexo/:fornecedorId',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.fornecedorId, 10);
    if (!id) return errorResponse(res, 'id inválido', 400);
    const { data: f, error: e1 } = await supabase
      .from('tech_cotacoes_fornecedores')
      .select('anexo_path, anexo_nome')
      .eq('id', id)
      .maybeSingle();
    if (e1) return errorResponse(res, e1.message, 500);
    if (!f?.anexo_path) return errorResponse(res, 'Sem anexo', 404);
    const { data: signed, error: e2 } = await supabase.storage
      .from(COTACAO_BUCKET)
      .createSignedUrl(f.anexo_path, 60 * 5); // 5 min
    if (e2) return errorResponse(res, e2.message, 500);
    return successResponse(res, { url: signed.signedUrl, nome: f.anexo_nome });
  }),
);

// ============================================================
// CLIENTES POR FILIAL (BRANCH)
// POST /api/tech/clientes-por-empresa
// Body: { branch_code, search?, page?, pageSize? }
// Retorna clientes que compraram nessa filial (a partir de notas_fiscais)
// ============================================================
router.post(
  '/clientes-por-empresa',
  asyncHandler(async (req, res) => {
    const { branch_code, search, page = 1, pageSize = 50 } = req.body || {};
    if (!branch_code) {
      return errorResponse(res, 'branch_code obrigatório', 400, 'MISSING_BRANCH');
    }

    const brCode = Number(branch_code);
    if (!Number.isFinite(brCode)) {
      return errorResponse(res, 'branch_code inválido', 400, 'INVALID_BRANCH');
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabaseFiscal = createClient(
      process.env.SUPABASE_FISCAL_URL,
      process.env.SUPABASE_FISCAL_KEY,
    );

    // Busca NFs da filial (histórico completo)
    const buscarTodas = async () => {
      const PAGE = 1000;
      const linhas = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseFiscal
          .from('notas_fiscais')
          .select('person_code, person_name, dealer_code, total_value, issue_date, operation_type, operation_code')
          .eq('branch_code', brCode)
          .neq('invoice_status', 'Canceled')
          .neq('invoice_status', 'Deleted')
          .range(from, from + PAGE - 1);
        if (error || !data?.length) break;
        linhas.push(...data);
        if (data.length < PAGE) break;
      }
      return linhas;
    };

    let todasNFs = await buscarTodas();

    // Fallback: se Supabase tem poucos dados pra essa filial (multimarcas raramente
    // entram no sync diário), busca direto do TOTVS pelos últimos 18 meses.
    if (todasNFs.length < 10) {
      try {
        const { getToken } = await import('../utils/totvsTokenManager.js');
        const axios = (await import('axios')).default;
        const tokenData = await getToken();
        const token = tokenData?.access_token;
        if (token) {
          const BASE = process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';
          const hoje = new Date();
          const inicio = new Date(hoje); inicio.setDate(hoje.getDate() - 540); // 18 meses
          const chunks = [];
          let cur = new Date(inicio);
          const MS_5MES = 150 * 86400000;
          while (cur < hoje) {
            const fim = new Date(Math.min(cur.getTime() + MS_5MES, hoje.getTime()));
            chunks.push([cur.toISOString().slice(0, 19), fim.toISOString().slice(0, 19)]);
            cur = new Date(fim.getTime() + 1000);
          }
          const totvsNFs = [];
          for (const [s, e] of chunks) {
            for (const type of ['Output', 'Input']) {
              let p = 1, hasNext = true;
              while (hasNext && p <= 30) {
                const r = await axios.post(`${BASE}/fiscal/v2/invoices/search`, {
                  filter: { branchCodeList: [brCode], startIssueDate: s, endIssueDate: e, operationType: type },
                  page: p, pageSize: 100, expand: 'items', order: 'issueDate:desc',
                }, { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 });
                const items = r.data?.items || [];
                for (const it of items) {
                  // Dealer dominante: pega do primeiro produto com dealerCode
                  let dealer = null;
                  for (const item of (it.items || [])) {
                    for (const prod of (item.products || [])) {
                      if (prod.dealerCode != null) { dealer = Number(prod.dealerCode); break; }
                    }
                    if (dealer != null) break;
                  }
                  totvsNFs.push({
                    person_code: it.personCode || it.person?.personCode || it.person?.code || null,
                    person_name: it.personName || null,
                    dealer_code: dealer,
                    total_value: Number(it.totalValue || 0),
                    issue_date: (it.issueDate || '').slice(0, 10),
                    operation_type: it.operationType,
                    operation_code: it.operationCode,
                    invoice_status: it.invoiceStatus,
                  });
                }
                hasNext = r.data?.hasNext;
                p++;
              }
            }
          }
          // Descarta canceladas
          const valid = totvsNFs.filter((n) =>
            n.invoice_status !== 'Canceled' && n.invoice_status !== 'Deleted' && n.person_code,
          );
          console.log(`[clientes-por-empresa] fallback TOTVS branch=${brCode}: ${valid.length} NFs`);
          if (valid.length > todasNFs.length) {
            todasNFs = valid;
          }
        }
      } catch (e) {
        console.warn(`[clientes-por-empresa] fallback TOTVS falhou: ${e.message}`);
      }
    }

    // Resolve nome dos vendedores
    const dealerNames = new Map();
    const allDealers = new Set();
    for (const nf of todasNFs) if (nf.dealer_code != null) allDealers.add(Number(nf.dealer_code));
    if (allDealers.size > 0) {
      try {
        const { data: vs } = await supabase
          .from('v_vendedores_integracao')
          .select('totvs_id, nome_vendedor')
          .in('totvs_id', [...allDealers]);
        for (const v of vs || []) {
          if (v?.totvs_id != null) dealerNames.set(Number(v.totvs_id), v.nome_vendedor || `Vend. ${v.totvs_id}`);
        }
      } catch {}
    }

    // Agrega por cliente
    const porCliente = new Map();
    const dealerCount = new Map();
    for (const nf of todasNFs) {
      const pc = Number(nf.person_code);
      if (!Number.isFinite(pc)) continue;
      const v = Number(nf.total_value || 0);
      const cur = porCliente.get(pc) || {
        person_code: pc,
        person_name: nf.person_name || `Cliente ${pc}`,
        total_value: 0,
        num_nfs: 0,
        first_purchase: nf.issue_date,
        last_purchase: nf.issue_date,
      };
      if (nf.operation_type === 'Output') {
        cur.total_value += v;
        cur.num_nfs += 1;
      } else if (nf.operation_type === 'Input') {
        cur.total_value -= v;
      }
      if (nf.issue_date < cur.first_purchase) cur.first_purchase = nf.issue_date;
      if (nf.issue_date > cur.last_purchase) cur.last_purchase = nf.issue_date;
      if (nf.person_name && !cur.person_name.startsWith('Cliente ')) cur.person_name = nf.person_name;
      porCliente.set(pc, cur);
      if (nf.dealer_code != null) {
        const key = `${pc}|${nf.dealer_code}`;
        dealerCount.set(key, (dealerCount.get(key) || 0) + 1);
      }
    }

    for (const [pc, c] of porCliente.entries()) {
      let bestDealer = null; let bestCount = 0;
      for (const [key, cnt] of dealerCount.entries()) {
        const [pcKey, dc] = key.split('|');
        if (Number(pcKey) !== pc) continue;
        if (cnt > bestCount) { bestCount = cnt; bestDealer = Number(dc); }
      }
      c.vendedor_code = bestDealer;
      c.vendedor_nome = bestDealer != null ? (dealerNames.get(bestDealer) || `Vend. ${bestDealer}`) : null;
      c.total_value = Math.round(c.total_value * 100) / 100;
    }

    // Lookup telefones via pes_pessoa
    const pessoaCodes = [...porCliente.keys()];
    if (pessoaCodes.length > 0) {
      try {
        const CHUNK = 800;
        for (let i = 0; i < pessoaCodes.length; i += CHUNK) {
          const batch = pessoaCodes.slice(i, i + CHUNK);
          const { data: pessoas } = await supabase
            .from('pes_pessoa')
            .select('code, telefone, email, uf, addresses, phones, cpf, fantasy_name, nm_pessoa')
            .in('code', batch);
          for (const p of pessoas || []) {
            const cur = porCliente.get(Number(p.code));
            if (cur) {
              let tel = p.telefone || null;
              if (!tel && Array.isArray(p.phones) && p.phones.length > 0) {
                tel = p.phones[0]?.number || null;
              }
              cur.telefone = tel;
              cur.email = p.email || null;
              cur.cpf_cnpj = p.cpf || null;
              cur.razao_social = p.nm_pessoa || null;
              let uf = p.uf || null;
              if (!uf && Array.isArray(p.addresses) && p.addresses.length > 0) {
                uf = p.addresses[0]?.stateAbbreviation || p.addresses[0]?.uf || null;
              }
              cur.uf = uf;
              if (Array.isArray(p.addresses) && p.addresses.length > 0) {
                const addr = p.addresses[0];
                cur.city = addr?.cityName || addr?.city || null;
              }
            }
          }
        }
      } catch (e) { console.warn(`[clientes-por-empresa] pes_pessoa: ${e.message}`); }
    }

    let contatos = [...porCliente.values()];

    // Filtro busca
    if (search && String(search).trim()) {
      const q = String(search).trim().toLowerCase();
      contatos = contatos.filter((c) =>
        String(c.person_name || '').toLowerCase().includes(q)
        || String(c.person_code).includes(q)
        || String(c.telefone || '').includes(q)
        || String(c.cpf_cnpj || '').includes(q),
      );
    }

    // Lista de UFs/vendedores pra filtros
    const ufsSet = new Set();
    const vendsMap = new Map();
    for (const c of contatos) {
      if (c.uf) ufsSet.add(c.uf);
      if (c.vendedor_code != null) vendsMap.set(c.vendedor_code, c.vendedor_nome);
    }

    contatos.sort((a, b) => b.total_value - a.total_value);

    const total = contatos.length;
    const pageNum = Math.max(1, Number(page) || 1);
    const psize = Math.min(10000, Math.max(10, Number(pageSize) || 50));
    const start = (pageNum - 1) * psize;
    const paginados = contatos.slice(start, start + psize);

    return successResponse(
      res,
      {
        contatos: paginados,
        total,
        page: pageNum,
        pageSize: psize,
        branch_code: brCode,
        ufs: [...ufsSet].sort(),
        vendedores: [...vendsMap.entries()]
          .map(([code, nome]) => ({ code, nome }))
          .sort((a, b) => String(a.nome).localeCompare(String(b.nome))),
        nf_total: todasNFs.length,
      },
      `${total} clientes na filial ${brCode}`,
    );
  }),
);

// ============================================================
// CLIENTES SALVOS POR FILIAL
// POST   /api/tech/clientes-por-empresa/salvar
// GET    /api/tech/clientes-por-empresa/salvos
// GET    /api/tech/clientes-por-empresa/salvos/:id
// DELETE /api/tech/clientes-por-empresa/salvos/:id
// ============================================================

router.post(
  '/clientes-por-empresa/salvar',
  asyncHandler(async (req, res) => {
    const { branch_code, lista_nome, clientes, filtros, branch_name } = req.body || {};
    if (!branch_code) return errorResponse(res, 'branch_code obrigatório', 400, 'MISSING_BRANCH');
    if (!Array.isArray(clientes) || clientes.length === 0) {
      return errorResponse(res, 'clientes (array) obrigatório', 400, 'MISSING_CLIENTES');
    }
    const faturamento = clientes.reduce((s, c) => s + Number(c.total_value || 0), 0);
    const created_by = req.headers['x-user-email'] || req.body?.created_by || null;
    const { data, error } = await supabase
      .from('clientes_filial_salvos')
      .insert({
        branch_code: Number(branch_code),
        branch_name: branch_name || null,
        lista_nome: lista_nome || `Filial ${branch_code} - ${new Date().toLocaleDateString('pt-BR')}`,
        total_clientes: clientes.length,
        faturamento_total: Math.round(faturamento * 100) / 100,
        filtros: filtros || null,
        clientes,
        created_by,
      })
      .select('id, lista_nome, branch_code, total_clientes, faturamento_total, created_at')
      .single();
    if (error) return errorResponse(res, error.message, 500, 'INSERT_ERROR');
    return successResponse(res, data, 'Lista salva');
  }),
);

router.get(
  '/clientes-por-empresa/salvos',
  asyncHandler(async (req, res) => {
    const { branch_code } = req.query;
    let q = supabase
      .from('clientes_filial_salvos')
      .select('id, branch_code, branch_name, lista_nome, total_clientes, faturamento_total, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (branch_code) q = q.eq('branch_code', Number(branch_code));
    const { data, error } = await q;
    if (error) return errorResponse(res, error.message, 500, 'QUERY_ERROR');
    return successResponse(res, data || [], `${(data || []).length} listas`);
  }),
);

router.get(
  '/clientes-por-empresa/salvos/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return errorResponse(res, 'id inválido', 400, 'BAD_ID');
    const { data, error } = await supabase
      .from('clientes_filial_salvos')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return errorResponse(res, error.message, 404, 'NOT_FOUND');
    return successResponse(res, data, 'OK');
  }),
);

router.delete(
  '/clientes-por-empresa/salvos/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return errorResponse(res, 'id inválido', 400, 'BAD_ID');
    const { error } = await supabase.from('clientes_filial_salvos').delete().eq('id', id);
    if (error) return errorResponse(res, error.message, 500, 'DELETE_ERROR');
    return successResponse(res, { id }, 'Removido');
  }),
);

// ============================================================
// VOUCHERS — Criação em lote pra clientes do TOTVS
// POST /api/tech/vouchers/totvs-contacts
//   body: { operacao, data_inicio, data_fim, empresas? }
//   reusa o mesmo fluxo do Crosby Bot pra buscar contatos do TOTVS
//
// POST /api/tech/vouchers/create-batch
//   body: {
//     branchCodeRegistration, voucherType, prefixCode, printTemplateCode,
//     startDate, endDate, percentage, voucherBranches[], customerCodes[]
//   }
//   pra cada customer: cria voucher (voucher/v2/create) + associa ao
//   cliente (voucher/v2/customer/create). Retorna array com resultado.
// ============================================================

router.post(
  '/vouchers/totvs-contacts',
  asyncHandler(async (req, res) => {
    // Proxy pro endpoint existente de contatos TOTVS (reusa lógica do Crosby Bot)
    const axios = (await import('axios')).default;
    const INTERNAL =
      process.env.INTERNAL_API_BASE
      || (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:4001');
    try {
      const r = await axios.post(
        `${INTERNAL}/api/meta/totvs-contacts`,
        req.body,
        { timeout: 300000 },
      );
      return res.status(r.status).json(r.data);
    } catch (e) {
      const status = e.response?.status || 500;
      return res.status(status).json(e.response?.data || { success: false, message: e.message });
    }
  }),
);

router.post(
  '/vouchers/create-batch',
  asyncHandler(async (req, res) => {
    const {
      branchCodeRegistration,
      voucherType = 1,
      prefixCode,
      printTemplateCode = 1,
      startDate,
      endDate,
      percentage,
      voucherBranches,
      customerCodes,
    } = req.body || {};

    // Validação
    if (!branchCodeRegistration || !prefixCode || !startDate || !endDate) {
      return errorResponse(
        res,
        'branchCodeRegistration, prefixCode, startDate e endDate obrigatórios',
        400,
        'VALIDATION',
      );
    }
    if (!percentage || Number(percentage) <= 0 || Number(percentage) > 100) {
      return errorResponse(res, 'percentage deve estar entre 1 e 100', 400, 'BAD_PERCENT');
    }
    if (!Array.isArray(customerCodes) || customerCodes.length === 0) {
      return errorResponse(res, 'customerCodes (array) obrigatório', 400, 'NO_CUSTOMERS');
    }
    if (customerCodes.length > 5000) {
      return errorResponse(res, 'máximo 5000 clientes por batch', 400, 'TOO_MANY');
    }

    const { getToken } = await import('../utils/totvsTokenManager.js');
    const axios = (await import('axios')).default;

    const tokenData = await getToken();
    let token = tokenData?.access_token;
    if (!token) {
      return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_OFF');
    }

    const BASE_API = process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';
    // O endpoint "customer/create" no n8n usa um host diferente
    // (www30.bhan.com.br:9443). A API moderna deve aceitar o mesmo BASE.
    const BASE_CUSTOMER = process.env.TOTVS_VOUCHER_BASE_URL || BASE_API;

    const branchsArr = Array.isArray(voucherBranches) && voucherBranches.length > 0
      ? voucherBranches.map((b) => ({ branchCode: Number(b) }))
      : [{ branchCode: Number(branchCodeRegistration) }];

    const results = [];
    let sucessos = 0;
    let falhas = 0;
    const CONCURRENCY = 4; // evita afogar o TOTVS

    async function processarCliente(customerCode) {
      const code = Number(customerCode);
      if (!Number.isFinite(code)) {
        return { customerCode, success: false, error: 'customerCode inválido' };
      }
      // 1) Cria voucher mestre
      const createPayload = {
        branchCodeRegistration: Number(branchCodeRegistration),
        voucherType: Number(voucherType),
        prefixCode: String(prefixCode),
        printTemplateCode: Number(printTemplateCode),
        status: 1,
        startDate,
        endDate,
        percentage: Number(percentage),
        branchs: branchsArr,
        items: [{ customerCode: code }],
      };
      let voucherNumber, voucherCode;
      try {
        const r = await axios.post(
          `${BASE_API}/voucher/v2/create`,
          createPayload,
          { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 },
        );
        const d = r.data || {};
        voucherNumber = d.voucherNumber || d.number || d.id || d.voucherCode || null;
        voucherCode = d.voucherCode || d.code || null;
        if (voucherNumber == null) {
          return { customerCode: code, success: false, error: 'voucherNumber não retornado', raw: d };
        }
      } catch (e) {
        // Tenta refresh token se 401
        if (e.response?.status === 401) {
          try {
            const nt = await getToken(true);
            token = nt?.access_token || token;
            const r = await axios.post(
              `${BASE_API}/voucher/v2/create`,
              createPayload,
              { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 },
            );
            const d = r.data || {};
            voucherNumber = d.voucherNumber || d.number || d.id || null;
            voucherCode = d.voucherCode || d.code || null;
          } catch (e2) {
            return {
              customerCode: code,
              success: false,
              error: e2.response?.data?.message || e2.message,
              stage: 'create',
            };
          }
        } else {
          return {
            customerCode: code,
            success: false,
            error: e.response?.data?.message || e.message,
            stage: 'create',
          };
        }
      }

      // 2) Associa voucher ao cliente
      const assocPayload = {
        branchCodeRegistration: Number(branchCodeRegistration),
        voucherNumberBase: Number(voucherNumber),
        customerCodeList: [code],
      };
      try {
        await axios.post(
          `${BASE_CUSTOMER}/voucher/v2/customer/create`,
          assocPayload,
          { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 },
        );
        return { customerCode: code, success: true, voucherNumber, voucherCode };
      } catch (e) {
        // Voucher foi criado mas associação falhou — relata pra investigar
        return {
          customerCode: code,
          success: false,
          voucherNumber,
          voucherCode,
          error: e.response?.data?.message || e.message,
          stage: 'associate',
        };
      }
    }

    // Processa em lotes paralelos
    for (let i = 0; i < customerCodes.length; i += CONCURRENCY) {
      const slice = customerCodes.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(slice.map(processarCliente));
      for (const r of batchResults) {
        results.push(r);
        if (r.success) sucessos++; else falhas++;
      }
    }

    // Persiste batch no Supabase pra histórico
    let batchId = null;
    try {
      const { data: ins, error: insErr } = await supabase
        .from('voucher_batches')
        .insert({
          branch_code_registration: Number(branchCodeRegistration),
          voucher_type: Number(voucherType),
          prefix_code: String(prefixCode),
          print_template_code: Number(printTemplateCode),
          start_date: startDate,
          end_date: endDate,
          percentage: Number(percentage),
          voucher_branches: branchsArr.map((b) => b.branchCode),
          origem: req.body?.origem || 'totvs',
          total_clientes: customerCodes.length,
          sucessos,
          falhas,
          resultados: results,
          created_by: req.headers['x-user-email'] || null,
        })
        .select('id, created_at')
        .single();
      if (insErr) {
        console.warn(`[vouchers/create-batch] insert historico falhou: ${insErr.message}`);
      } else {
        batchId = ins?.id || null;
      }
    } catch (e) {
      console.warn(`[vouchers/create-batch] historico exception: ${e.message}`);
    }

    return successResponse(
      res,
      {
        batchId,
        total: customerCodes.length,
        sucessos,
        falhas,
        results,
      },
      `${sucessos} vouchers gerados, ${falhas} falhas`,
    );
  }),
);

// GET /api/tech/vouchers/batches?limit=100
//   lista batches recentes (sem o JSON pesado de resultados)
router.get(
  '/vouchers/batches',
  asyncHandler(async (req, res) => {
    const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 100));
    const { data, error } = await supabase
      .from('voucher_batches')
      .select(
        'id, branch_code_registration, prefix_code, start_date, end_date, percentage, origem, total_clientes, sucessos, falhas, created_by, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return errorResponse(res, error.message, 500, 'QUERY_ERROR');
    return successResponse(res, data || [], `${(data || []).length} batches`);
  }),
);

// GET /api/tech/vouchers/batches/:id
//   detalhe do batch (inclui resultados completos)
router.get(
  '/vouchers/batches/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return errorResponse(res, 'id inválido', 400, 'BAD_ID');
    const { data, error } = await supabase
      .from('voucher_batches')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return errorResponse(res, error.message, 404, 'NOT_FOUND');
    return successResponse(res, data, 'OK');
  }),
);

export default router;
