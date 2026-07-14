// ============================================================
// FILA DA VEZ — Rotas (CRM Varejo)
// Admin: gerencia config, vendedoras, motivos, vê dashboard
// Público (PIN): vendedora opera a fila no chão de loja
// ============================================================
import express from 'express';
import axios from 'axios';
import supabase from '../config/supabase.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';

const router = express.Router();

// ──────────────────────────────────────────────────────────────
// Mapa de lojas varejo (duplicado de crm.routes.js — fonte verdade)
// ──────────────────────────────────────────────────────────────
const VAREJO_STORE_MAP = {
  2:  { name: 'João Pessoa',       shortName: 'João Pessoa',     uf: 'PB', type: 'rua',      codes: [2] },
  5:  { name: 'Nova Cruz',         shortName: 'Nova Cruz',       uf: 'RN', type: 'rua',      codes: [5] },
  55: { name: 'Parnamirim',        shortName: 'Parnamirim',      uf: 'RN', type: 'rua',      codes: [55, 6030] },
  65: { name: 'Canguaretama',      shortName: 'Canguaretama',    uf: 'RN', type: 'rua',      codes: [65, 6062] },
  87: { name: 'Cidade Jardim',     shortName: 'Cidade Jardim',   uf: 'PE', type: 'shopping', codes: [87, 6156] },
  88: { name: 'Guararapes',        shortName: 'Guararapes',      uf: 'PE', type: 'shopping', codes: [88, 6114] },
  90: { name: 'Ayrton Senna',      shortName: 'Ayrton Senna',    uf: 'RN', type: 'rua',      codes: [90, 6152] },
  93: { name: 'Imperatriz',        shortName: 'Imperatriz',      uf: 'MA', type: 'rua',      codes: [93, 6014] },
  94: { name: 'Patos',             shortName: 'Patos',           uf: 'PB', type: 'shopping', codes: [94, 6144] },
  95: { name: 'Midway',            shortName: 'Midway',          uf: 'RN', type: 'shopping', codes: [95] },
  97: { name: 'Teresina',          shortName: 'Teresina',        uf: 'PI', type: 'shopping', codes: [97, 6038] },
  98: { name: 'Shopping Recife',   shortName: 'Shopping Recife', uf: 'PE', type: 'shopping', codes: [98] },
};

function getStoreInfo(branchCode) {
  return VAREJO_STORE_MAP[branchCode] || null;
}

// ──────────────────────────────────────────────────────────────
// Helper TOTVS: buscar pessoa por CPF/CNPJ
// ──────────────────────────────────────────────────────────────
async function lookupClienteTotvs(fiscalNumber) {
  const clean = String(fiscalNumber || '').replace(/\D/g, '');
  if (clean.length !== 11 && clean.length !== 14) return null;
  const isCNPJ = clean.length === 14;

  const tokenData = await getToken();
  if (!tokenData?.access_token) return null;

  const endpoint = isCNPJ
    ? `${TOTVS_BASE_URL}/person/v2/legal-entities/search`
    : `${TOTVS_BASE_URL}/person/v2/individuals/search`;

  const doRequest = (token, payload) =>
    axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 30000,
    });

  let currentToken = tokenData.access_token;
  let found = [];

  if (!isCNPJ) {
    const payload = {
      filter: { cpfList: [clean] },
      expand: 'phones',
      page: 1,
      pageSize: 5,
    };
    try {
      const resp = await doRequest(currentToken, payload);
      found = resp.data?.items || [];
    } catch (err) {
      if (err.response?.status === 401) {
        const nt = await getToken(true);
        const resp2 = await doRequest(nt.access_token, payload);
        found = resp2.data?.items || [];
      }
    }
  } else {
    // PJ: API não tem cnpjList — tentativa rápida com pageSize maior, abort se ficar caro
    try {
      const payload = {
        filter: {},
        expand: 'phones',
        page: 1,
        pageSize: 500,
        order: 'personCode',
      };
      const resp = await doRequest(currentToken, payload);
      const items = resp.data?.items || [];
      found = items.filter((it) => {
        const c = String(it.cnpj || '').replace(/\D/g, '');
        return c === clean;
      });
    } catch (err) {
      return null;
    }
  }

  if (!found.length) return null;
  const it = found[0];
  return {
    personCode: it.personCode || it.code,
    name: it.name || it.personName || it.companyName || it.fantasyName || null,
    document: clean,
    type: isCNPJ ? 'PJ' : 'PF',
  };
}

// ──────────────────────────────────────────────────────────────
// Middleware: valida PIN da vendedora (rotas públicas)
//   Headers: x-fila-branch, x-fila-pin
// ──────────────────────────────────────────────────────────────
async function pinAuth(req, res, next) {
  const branchCode = parseInt(req.headers['x-fila-branch'] || req.body?.branchCode || req.query?.branch, 10);
  const pin = String(req.headers['x-fila-pin'] || req.body?.pin || req.query?.pin || '').trim();

  if (!branchCode || !pin) {
    return errorResponse(res, 'PIN ou loja não informados', 401, 'MISSING_PIN');
  }
  const { data: cfg, error } = await supabase
    .from('fila_lojas_config')
    .select('id, branch_code, pin, ativo')
    .eq('branch_code', branchCode)
    .maybeSingle();

  if (error || !cfg) {
    return errorResponse(res, 'Loja não configurada', 401, 'LOJA_NAO_ENCONTRADA');
  }
  if (!cfg.ativo) {
    return errorResponse(res, 'Fila inativa nesta loja', 403, 'LOJA_INATIVA');
  }
  if (String(cfg.pin) !== pin) {
    return errorResponse(res, 'PIN incorreto', 401, 'PIN_INVALIDO');
  }
  req.filaContext = { branchCode, lojaConfigId: cfg.id };
  next();
}

// ──────────────────────────────────────────────────────────────
// Helper: recompacta posições FIFO (1, 2, 3...) por loja
// ──────────────────────────────────────────────────────────────
async function recompactarFila(branchCode) {
  const { data: disponiveis } = await supabase
    .from('fila_vendedora_status')
    .select('vendedora_id, posicao_fila')
    .eq('branch_code', branchCode)
    .eq('status', 'disponivel')
    .order('posicao_fila', { ascending: true, nullsFirst: false });

  if (!disponiveis) return;
  let pos = 1;
  for (const row of disponiveis) {
    if (row.posicao_fila !== pos) {
      await supabase
        .from('fila_vendedora_status')
        .update({ posicao_fila: pos, atualizado_em: new Date().toISOString() })
        .eq('vendedora_id', row.vendedora_id);
    }
    pos += 1;
  }
}

// Helper: próxima posição livre da fila
async function proximaPosicaoFila(branchCode) {
  const { data } = await supabase
    .from('fila_vendedora_status')
    .select('posicao_fila')
    .eq('branch_code', branchCode)
    .eq('status', 'disponivel')
    .order('posicao_fila', { ascending: false, nullsFirst: false })
    .limit(1);
  if (!data?.length || data[0].posicao_fila == null) return 1;
  return (data[0].posicao_fila || 0) + 1;
}

// Helper: registra mudança de status no log
async function logStatusChange({ vendedora_id, branch_code, status_anterior, status_novo, inicio_status }) {
  let dur = null;
  if (inicio_status) {
    dur = Math.max(0, Math.floor((Date.now() - new Date(inicio_status).getTime()) / 1000));
  }
  await supabase.from('fila_status_log').insert({
    vendedora_id,
    branch_code,
    status_anterior,
    status_novo,
    duracao_segundos: dur,
  });
}

// ═══════════════════════════════════════════════════════════════
// ROTAS ADMIN
// ═══════════════════════════════════════════════════════════════

// GET /fila/lojas — todas lojas do varejo + config atual (se houver)
router.get(
  '/lojas',
  asyncHandler(async (req, res) => {
    const { data: configs } = await supabase
      .from('fila_lojas_config')
      .select('*')
      .order('branch_code');

    const cfgByBranch = new Map((configs || []).map((c) => [c.branch_code, c]));
    const lojas = Object.entries(VAREJO_STORE_MAP).map(([code, info]) => {
      const cfg = cfgByBranch.get(Number(code));
      return {
        branch_code: Number(code),
        name: info.name,
        shortName: info.shortName,
        uf: info.uf,
        type: info.type,
        configurada: !!cfg,
        pin: cfg?.pin || null,
        ativo: cfg?.ativo ?? false,
        atualizado_em: cfg?.atualizado_em || null,
      };
    });

    return successResponse(res, { lojas });
  }),
);

// POST /fila/lojas — cria/atualiza config (PIN, ativo)
router.post(
  '/lojas',
  asyncHandler(async (req, res) => {
    const { branch_code, pin, ativo = true } = req.body || {};
    const bc = parseInt(branch_code, 10);
    if (!bc || !VAREJO_STORE_MAP[bc]) {
      return errorResponse(res, 'branch_code inválido', 400);
    }
    const pinClean = String(pin || '').trim();
    if (!/^\d{4,8}$/.test(pinClean)) {
      return errorResponse(res, 'PIN deve ter 4-8 dígitos numéricos', 400);
    }
    const info = VAREJO_STORE_MAP[bc];
    const usuario = req.user?.email || req.headers['x-user'] || null;

    const { data: existing } = await supabase
      .from('fila_lojas_config')
      .select('id')
      .eq('branch_code', bc)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from('fila_lojas_config')
        .update({
          pin: pinClean,
          ativo,
          nome: info.name,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return errorResponse(res, error.message, 500);
      return successResponse(res, data, 'Configuração atualizada');
    }

    const { data, error } = await supabase
      .from('fila_lojas_config')
      .insert({
        branch_code: bc,
        nome: info.name,
        pin: pinClean,
        ativo,
        criado_por: usuario,
      })
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, data, 'Loja configurada');
  }),
);

// GET /fila/vendedoras?branch=X
router.get(
  '/vendedoras',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.query.branch, 10);
    let q = supabase.from('fila_vendedoras').select('*').order('nome');
    if (branch) q = q.eq('branch_code', branch);
    const { data, error } = await q;
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { vendedoras: data || [] });
  }),
);

// POST /fila/vendedoras
router.post(
  '/vendedoras',
  asyncHandler(async (req, res) => {
    const { branch_code, nome, totvs_id, apelido } = req.body || {};
    if (!branch_code || !nome) {
      return errorResponse(res, 'branch_code e nome são obrigatórios', 400);
    }
    if (!VAREJO_STORE_MAP[branch_code]) {
      return errorResponse(res, 'branch_code inválido', 400);
    }
    const { data, error } = await supabase
      .from('fila_vendedoras')
      .insert({
        branch_code,
        nome: String(nome).trim(),
        totvs_id: totvs_id ? String(totvs_id).trim() : null,
        apelido: apelido ? String(apelido).trim() : null,
      })
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 400);
    return successResponse(res, data, 'Vendedora cadastrada');
  }),
);

// PATCH /fila/vendedoras/:id
router.patch(
  '/vendedoras/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const patch = {};
    for (const f of ['nome', 'totvs_id', 'apelido', 'ativo']) {
      if (req.body?.[f] !== undefined) patch[f] = req.body[f];
    }
    patch.atualizado_em = new Date().toISOString();
    const { data, error } = await supabase
      .from('fila_vendedoras')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, data, 'Vendedora atualizada');
  }),
);

// DELETE /fila/vendedoras/:id  (hard delete só se não tiver atendimentos; senão soft)
router.delete(
  '/vendedoras/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { count } = await supabase
      .from('fila_atendimentos')
      .select('id', { count: 'exact', head: true })
      .eq('vendedora_id', id);
    if (count && count > 0) {
      await supabase.from('fila_vendedoras').update({ ativo: false, atualizado_em: new Date().toISOString() }).eq('id', id);
      await supabase.from('fila_vendedora_status').delete().eq('vendedora_id', id);
      return successResponse(res, { soft: true }, 'Vendedora desativada (tinha histórico)');
    }
    await supabase.from('fila_vendedora_status').delete().eq('vendedora_id', id);
    await supabase.from('fila_vendedoras').delete().eq('id', id);
    return successResponse(res, { soft: false }, 'Vendedora removida');
  }),
);

// GET /fila/motivos
router.get(
  '/motivos',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('fila_motivos_nao_venda')
      .select('*')
      .order('ordem', { ascending: true })
      .order('motivo', { ascending: true });
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { motivos: data || [] });
  }),
);

// POST /fila/motivos
router.post(
  '/motivos',
  asyncHandler(async (req, res) => {
    const { motivo, ordem = 0 } = req.body || {};
    if (!motivo) return errorResponse(res, 'motivo é obrigatório', 400);
    const { data, error } = await supabase
      .from('fila_motivos_nao_venda')
      .insert({ motivo: String(motivo).trim(), ordem: Number(ordem) || 0 })
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 400);
    return successResponse(res, data, 'Motivo cadastrado');
  }),
);

// PATCH /fila/motivos/:id
router.patch(
  '/motivos/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const patch = {};
    for (const f of ['motivo', 'ordem', 'ativo']) {
      if (req.body?.[f] !== undefined) patch[f] = req.body[f];
    }
    const { data, error } = await supabase
      .from('fila_motivos_nao_venda')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, data, 'Motivo atualizado');
  }),
);

// DELETE /fila/motivos/:id (soft delete pra não quebrar histórico)
router.delete(
  '/motivos/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { error } = await supabase
      .from('fila_motivos_nao_venda')
      .update({ ativo: false })
      .eq('id', id);
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { ok: true }, 'Motivo desativado');
  }),
);

// GET /fila/dashboard?branch=X&datemin=&datemax=
// Métricas: total atendimentos, conversão, ticket médio, tempo médio, top motivos, por vendedora
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.query.branch, 10);
    const datemin = req.query.datemin || null; // YYYY-MM-DD
    const datemax = req.query.datemax || null;

    let q = supabase
      .from('fila_atendimentos')
      .select('*')
      .order('inicio', { ascending: false });
    if (branch) q = q.eq('branch_code', branch);
    if (datemin) q = q.gte('inicio', `${datemin}T00:00:00`);
    if (datemax) q = q.lte('inicio', `${datemax}T23:59:59`);

    const { data: atend, error } = await q;
    if (error) return errorResponse(res, error.message, 500);

    const finalizados = (atend || []).filter((a) => a.fim);
    const comVenda = finalizados.filter((a) => a.houve_venda === true);
    const semVenda = finalizados.filter((a) => a.houve_venda === false);

    const totalFin = finalizados.length;
    const totalComVenda = comVenda.length;
    const taxaConversao = totalFin > 0 ? (totalComVenda / totalFin) * 100 : 0;
    const ticketMedio =
      comVenda.length > 0
        ? comVenda.reduce((s, a) => s + Number(a.valor_venda || 0), 0) / comVenda.length
        : 0;
    const tempoMedio =
      totalFin > 0
        ? finalizados.reduce((s, a) => s + Number(a.duracao_segundos || 0), 0) / totalFin
        : 0;

    // Por vendedora
    const perVend = new Map();
    for (const a of finalizados) {
      const key = a.vendedora_id;
      const cur = perVend.get(key) || {
        vendedora_id: key,
        vendedora_nome: a.vendedora_nome,
        atendimentos: 0,
        vendas: 0,
        valor_total: 0,
        tempo_total: 0,
      };
      cur.atendimentos += 1;
      if (a.houve_venda) {
        cur.vendas += 1;
        cur.valor_total += Number(a.valor_venda || 0);
      }
      cur.tempo_total += Number(a.duracao_segundos || 0);
      perVend.set(key, cur);
    }
    const porVendedora = Array.from(perVend.values()).map((v) => ({
      ...v,
      conversao: v.atendimentos > 0 ? (v.vendas / v.atendimentos) * 100 : 0,
      ticket_medio: v.vendas > 0 ? v.valor_total / v.vendas : 0,
      tempo_medio: v.atendimentos > 0 ? v.tempo_total / v.atendimentos : 0,
    })).sort((a, b) => b.conversao - a.conversao);

    // Top motivos
    const motivos = new Map();
    for (const a of semVenda) {
      const key = a.motivo_nao_venda_id || `txt:${a.motivo_nao_venda_txt || 'Sem motivo'}`;
      const label = a.motivo_nao_venda_txt || 'Sem motivo';
      motivos.set(key, (motivos.get(key) || { motivo: label, total: 0 }));
      motivos.get(key).total += 1;
    }
    const topMotivos = Array.from(motivos.values()).sort((a, b) => b.total - a.total);

    return successResponse(res, {
      resumo: {
        total_atendimentos: totalFin,
        total_em_aberto: (atend || []).length - totalFin,
        total_com_venda: totalComVenda,
        total_sem_venda: semVenda.length,
        taxa_conversao: Number(taxaConversao.toFixed(2)),
        ticket_medio: Number(ticketMedio.toFixed(2)),
        tempo_medio_segundos: Math.round(tempoMedio),
      },
      por_vendedora: porVendedora,
      top_motivos: topMotivos,
    });
  }),
);

// GET /fila/atendimentos?branch=X&datemin=&datemax=&limit=200
router.get(
  '/atendimentos',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.query.branch, 10);
    const datemin = req.query.datemin || null;
    const datemax = req.query.datemax || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

    let q = supabase
      .from('fila_atendimentos')
      .select('*')
      .order('inicio', { ascending: false })
      .limit(limit);
    if (branch) q = q.eq('branch_code', branch);
    if (datemin) q = q.gte('inicio', `${datemin}T00:00:00`);
    if (datemax) q = q.lte('inicio', `${datemax}T23:59:59`);

    const { data, error } = await q;
    if (error) return errorResponse(res, error.message, 500);
    return successResponse(res, { atendimentos: data || [] });
  }),
);

// ═══════════════════════════════════════════════════════════════
// ROTAS PÚBLICAS (vendedora autentica via PIN da loja)
// ═══════════════════════════════════════════════════════════════

// POST /fila/public/login — verifica PIN e devolve info da loja + vendedoras
router.post(
  '/public/login',
  asyncHandler(async (req, res) => {
    const { branch_code, pin } = req.body || {};
    const bc = parseInt(branch_code, 10);
    const pinStr = String(pin || '').trim();
    if (!bc || !pinStr) {
      return errorResponse(res, 'Loja e PIN obrigatórios', 400);
    }

    const { data: cfg } = await supabase
      .from('fila_lojas_config')
      .select('*')
      .eq('branch_code', bc)
      .maybeSingle();

    if (!cfg) return errorResponse(res, 'Loja não configurada', 401, 'LOJA_NAO_CONFIG');
    if (!cfg.ativo) return errorResponse(res, 'Fila inativa nesta loja', 403, 'LOJA_INATIVA');
    if (String(cfg.pin) !== pinStr) return errorResponse(res, 'PIN incorreto', 401, 'PIN_INVALIDO');

    const info = getStoreInfo(bc);
    const { data: vendedoras } = await supabase
      .from('fila_vendedoras')
      .select('id, nome, apelido, totvs_id, ativo')
      .eq('branch_code', bc)
      .eq('ativo', true)
      .order('nome');

    return successResponse(res, {
      ok: true,
      loja: {
        branch_code: bc,
        nome: info?.name || cfg.nome,
        shortName: info?.shortName || cfg.nome,
        uf: info?.uf,
      },
      vendedoras: vendedoras || [],
    });
  }),
);

// GET /fila/public/estado — estado atual da fila + status de cada vendedora (não retorna PIN)
router.get(
  '/public/estado',
  pinAuth,
  asyncHandler(async (req, res) => {
    const { branchCode } = req.filaContext;

    const { data: vends } = await supabase
      .from('fila_vendedoras')
      .select('id, nome, apelido, totvs_id, ativo')
      .eq('branch_code', branchCode)
      .eq('ativo', true)
      .order('nome');

    const { data: status } = await supabase
      .from('fila_vendedora_status')
      .select('*')
      .eq('branch_code', branchCode);

    const statusByVend = new Map((status || []).map((s) => [s.vendedora_id, s]));

    const lista = (vends || []).map((v) => {
      const st = statusByVend.get(v.id);
      return {
        ...v,
        status: st?.status || 'fora',
        posicao_fila: st?.posicao_fila || null,
        atendimento_id: st?.atendimento_id || null,
        inicio_status: st?.inicio_status || null,
      };
    });

    // Próxima a atender = menor posicao_fila com status 'disponivel'
    const fila = lista
      .filter((v) => v.status === 'disponivel' && v.posicao_fila != null)
      .sort((a, b) => a.posicao_fila - b.posicao_fila);
    const proxima = fila[0] || null;

    // Atendimentos do dia (resumo)
    const hojeIso = new Date();
    hojeIso.setHours(0, 0, 0, 0);
    const { data: hoje } = await supabase
      .from('fila_atendimentos')
      .select('vendedora_id, houve_venda, fim')
      .eq('branch_code', branchCode)
      .gte('inicio', hojeIso.toISOString());

    const statsHoje = new Map();
    for (const a of (hoje || [])) {
      const cur = statsHoje.get(a.vendedora_id) || { atendimentos: 0, vendas: 0 };
      if (a.fim) cur.atendimentos += 1;
      if (a.houve_venda) cur.vendas += 1;
      statsHoje.set(a.vendedora_id, cur);
    }
    const listaComStats = lista.map((v) => {
      const s = statsHoje.get(v.id) || { atendimentos: 0, vendas: 0 };
      return {
        ...v,
        atendimentos_hoje: s.atendimentos,
        vendas_hoje: s.vendas,
        conversao_hoje: s.atendimentos > 0 ? Number(((s.vendas / s.atendimentos) * 100).toFixed(1)) : 0,
      };
    });

    return successResponse(res, {
      branch_code: branchCode,
      vendedoras: listaComStats,
      fila,
      proxima: proxima ? { id: proxima.id, nome: proxima.nome } : null,
    });
  }),
);

// POST /fila/public/entrar-fila — vendedora entra/volta à fila como 'disponivel'
router.post(
  '/public/entrar-fila',
  pinAuth,
  asyncHandler(async (req, res) => {
    const { branchCode } = req.filaContext;
    const vendedora_id = parseInt(req.body?.vendedora_id, 10);
    if (!vendedora_id) return errorResponse(res, 'vendedora_id obrigatório', 400);

    const { data: v } = await supabase
      .from('fila_vendedoras')
      .select('id, branch_code, ativo')
      .eq('id', vendedora_id)
      .maybeSingle();
    if (!v || v.branch_code !== branchCode || !v.ativo) {
      return errorResponse(res, 'Vendedora inválida', 400);
    }

    const { data: cur } = await supabase
      .from('fila_vendedora_status')
      .select('*')
      .eq('vendedora_id', vendedora_id)
      .maybeSingle();

    if (cur?.status === 'em_atendimento') {
      return errorResponse(res, 'Vendedora está em atendimento, finalize primeiro', 400);
    }

    const pos = await proximaPosicaoFila(branchCode);
    const payload = {
      vendedora_id,
      branch_code: branchCode,
      status: 'disponivel',
      posicao_fila: pos,
      atendimento_id: null,
      inicio_status: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    };

    if (cur) {
      await supabase.from('fila_vendedora_status').update(payload).eq('vendedora_id', vendedora_id);
      await logStatusChange({
        vendedora_id,
        branch_code: branchCode,
        status_anterior: cur.status,
        status_novo: 'disponivel',
        inicio_status: cur.inicio_status,
      });
    } else {
      await supabase.from('fila_vendedora_status').insert(payload);
      await logStatusChange({
        vendedora_id,
        branch_code: branchCode,
        status_anterior: null,
        status_novo: 'disponivel',
      });
    }

    await recompactarFila(branchCode);
    return successResponse(res, { ok: true, posicao: pos }, 'Entrou na fila');
  }),
);

// POST /fila/public/iniciar-atendimento — só a próxima da fila inicia
router.post(
  '/public/iniciar-atendimento',
  pinAuth,
  asyncHandler(async (req, res) => {
    const { branchCode } = req.filaContext;
    const vendedora_id = parseInt(req.body?.vendedora_id, 10);
    if (!vendedora_id) return errorResponse(res, 'vendedora_id obrigatório', 400);

    const { data: cur } = await supabase
      .from('fila_vendedora_status')
      .select('*')
      .eq('vendedora_id', vendedora_id)
      .maybeSingle();

    if (!cur || cur.status !== 'disponivel') {
      return errorResponse(res, 'Vendedora não está disponível na fila', 400);
    }
    if (cur.branch_code !== branchCode) {
      return errorResponse(res, 'Loja diferente', 400);
    }

    // Verifica se é a próxima da fila (menor posicao_fila)
    const { data: fila } = await supabase
      .from('fila_vendedora_status')
      .select('vendedora_id, posicao_fila')
      .eq('branch_code', branchCode)
      .eq('status', 'disponivel')
      .order('posicao_fila', { ascending: true })
      .limit(1);

    if (!fila?.length || fila[0].vendedora_id !== vendedora_id) {
      return errorResponse(res, 'Você não é a próxima da fila', 403);
    }

    const { data: v } = await supabase
      .from('fila_vendedoras')
      .select('nome')
      .eq('id', vendedora_id)
      .single();

    // Cria atendimento aberto
    const { data: atend, error: errAt } = await supabase
      .from('fila_atendimentos')
      .insert({
        branch_code: branchCode,
        vendedora_id,
        vendedora_nome: v?.nome || '',
        inicio: new Date().toISOString(),
      })
      .select()
      .single();
    if (errAt) return errorResponse(res, errAt.message, 500);

    await supabase
      .from('fila_vendedora_status')
      .update({
        status: 'em_atendimento',
        posicao_fila: null,
        atendimento_id: atend.id,
        inicio_status: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      })
      .eq('vendedora_id', vendedora_id);

    await logStatusChange({
      vendedora_id,
      branch_code: branchCode,
      status_anterior: 'disponivel',
      status_novo: 'em_atendimento',
      inicio_status: cur.inicio_status,
    });

    await recompactarFila(branchCode);
    return successResponse(res, { atendimento_id: atend.id }, 'Atendimento iniciado');
  }),
);

// POST /fila/public/finalizar-atendimento
//   { vendedora_id, houve_venda, cpf_cnpj?, motivo_id?, motivo_txt?, valor_venda?, observacao? }
router.post(
  '/public/finalizar-atendimento',
  pinAuth,
  asyncHandler(async (req, res) => {
    const { branchCode } = req.filaContext;
    const vendedora_id = parseInt(req.body?.vendedora_id, 10);
    const houve_venda = req.body?.houve_venda === true;
    const cpf_cnpj = req.body?.cpf_cnpj ? String(req.body.cpf_cnpj).replace(/\D/g, '') : null;
    const motivo_id = req.body?.motivo_id ? parseInt(req.body.motivo_id, 10) : null;
    const motivo_txt_in = req.body?.motivo_txt ? String(req.body.motivo_txt).trim() : null;
    const valor_venda_in = req.body?.valor_venda != null ? Number(req.body.valor_venda) : null;
    const observacao = req.body?.observacao ? String(req.body.observacao).trim() : null;

    if (!vendedora_id) return errorResponse(res, 'vendedora_id obrigatório', 400);
    if (houve_venda && !cpf_cnpj) {
      return errorResponse(res, 'CPF/CNPJ obrigatório quando houve venda', 400);
    }
    if (!houve_venda && !motivo_id && !motivo_txt_in) {
      return errorResponse(res, 'Motivo da não-venda obrigatório', 400);
    }

    const { data: cur } = await supabase
      .from('fila_vendedora_status')
      .select('*')
      .eq('vendedora_id', vendedora_id)
      .maybeSingle();

    if (!cur || cur.status !== 'em_atendimento' || !cur.atendimento_id) {
      return errorResponse(res, 'Vendedora não está em atendimento', 400);
    }
    if (cur.branch_code !== branchCode) {
      return errorResponse(res, 'Loja diferente', 400);
    }

    // Validar cliente no TOTVS (se houve venda)
    let cliente_nome = null;
    let cliente_validado = false;
    if (houve_venda && cpf_cnpj) {
      try {
        const cli = await lookupClienteTotvs(cpf_cnpj);
        if (cli) {
          cliente_nome = cli.name;
          cliente_validado = true;
        }
      } catch (e) {
        // best-effort: não bloqueia o registro
        console.warn('Lookup TOTVS falhou:', e?.message);
      }
    }

    // Resolver motivo
    let motivo_txt = motivo_txt_in;
    if (!houve_venda && motivo_id) {
      const { data: m } = await supabase
        .from('fila_motivos_nao_venda')
        .select('motivo')
        .eq('id', motivo_id)
        .maybeSingle();
      if (m) motivo_txt = m.motivo;
    }

    const fim = new Date();
    const inicio = new Date(cur.inicio_status);
    const duracao = Math.max(0, Math.floor((fim.getTime() - inicio.getTime()) / 1000));

    const { data: updated, error: errAt } = await supabase
      .from('fila_atendimentos')
      .update({
        fim: fim.toISOString(),
        duracao_segundos: duracao,
        houve_venda,
        cliente_cpf_cnpj: cpf_cnpj,
        cliente_nome,
        cliente_validado,
        valor_venda: houve_venda ? valor_venda_in : null,
        motivo_nao_venda_id: !houve_venda ? motivo_id : null,
        motivo_nao_venda_txt: !houve_venda ? motivo_txt : null,
        observacao,
      })
      .eq('id', cur.atendimento_id)
      .select()
      .single();
    if (errAt) return errorResponse(res, errAt.message, 500);

    // Volta vendedora pra fila (final)
    const pos = await proximaPosicaoFila(branchCode);
    await supabase
      .from('fila_vendedora_status')
      .update({
        status: 'disponivel',
        posicao_fila: pos,
        atendimento_id: null,
        inicio_status: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      })
      .eq('vendedora_id', vendedora_id);

    await logStatusChange({
      vendedora_id,
      branch_code: branchCode,
      status_anterior: 'em_atendimento',
      status_novo: 'disponivel',
      inicio_status: cur.inicio_status,
    });

    await recompactarFila(branchCode);
    return successResponse(res, { atendimento: updated, posicao_fila: pos }, 'Atendimento finalizado');
  }),
);

// POST /fila/public/pausa — { vendedora_id, tipo: 'pausa'|'folga'|'atestado' }
router.post(
  '/public/pausa',
  pinAuth,
  asyncHandler(async (req, res) => {
    const { branchCode } = req.filaContext;
    const vendedora_id = parseInt(req.body?.vendedora_id, 10);
    const tipo = String(req.body?.tipo || 'pausa').toLowerCase();
    if (!vendedora_id) return errorResponse(res, 'vendedora_id obrigatório', 400);
    if (!['pausa', 'folga', 'atestado'].includes(tipo)) {
      return errorResponse(res, 'tipo inválido (pausa|folga|atestado)', 400);
    }

    const { data: cur } = await supabase
      .from('fila_vendedora_status')
      .select('*')
      .eq('vendedora_id', vendedora_id)
      .maybeSingle();

    if (cur?.status === 'em_atendimento') {
      return errorResponse(res, 'Finalize o atendimento atual antes de pausar', 400);
    }

    const payload = {
      vendedora_id,
      branch_code: branchCode,
      status: tipo,
      posicao_fila: null,
      atendimento_id: null,
      inicio_status: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    };
    if (cur) {
      await supabase.from('fila_vendedora_status').update(payload).eq('vendedora_id', vendedora_id);
    } else {
      await supabase.from('fila_vendedora_status').insert(payload);
    }
    await logStatusChange({
      vendedora_id,
      branch_code: branchCode,
      status_anterior: cur?.status || null,
      status_novo: tipo,
      inicio_status: cur?.inicio_status,
    });
    await recompactarFila(branchCode);
    return successResponse(res, { ok: true }, `Status alterado para ${tipo}`);
  }),
);

// POST /fila/public/sair — sai da fila sem status especial
router.post(
  '/public/sair',
  pinAuth,
  asyncHandler(async (req, res) => {
    const { branchCode } = req.filaContext;
    const vendedora_id = parseInt(req.body?.vendedora_id, 10);
    if (!vendedora_id) return errorResponse(res, 'vendedora_id obrigatório', 400);
    const { data: cur } = await supabase
      .from('fila_vendedora_status')
      .select('*')
      .eq('vendedora_id', vendedora_id)
      .maybeSingle();
    if (cur?.status === 'em_atendimento') {
      return errorResponse(res, 'Finalize atendimento atual antes', 400);
    }
    await supabase.from('fila_vendedora_status').delete().eq('vendedora_id', vendedora_id);
    if (cur) {
      await logStatusChange({
        vendedora_id,
        branch_code: branchCode,
        status_anterior: cur.status,
        status_novo: 'fora',
        inicio_status: cur.inicio_status,
      });
    }
    await recompactarFila(branchCode);
    return successResponse(res, { ok: true }, 'Saiu da fila');
  }),
);

// GET /fila/public/motivos — motivos ativos (para vendedora escolher)
router.get(
  '/public/motivos',
  pinAuth,
  asyncHandler(async (req, res) => {
    const { data } = await supabase
      .from('fila_motivos_nao_venda')
      .select('id, motivo, ordem')
      .eq('ativo', true)
      .order('ordem', { ascending: true })
      .order('motivo', { ascending: true });
    return successResponse(res, { motivos: data || [] });
  }),
);

// POST /fila/public/lookup-cliente — { cpf_cnpj } valida cliente no TOTVS (preview antes de finalizar)
router.post(
  '/public/lookup-cliente',
  pinAuth,
  asyncHandler(async (req, res) => {
    const cpf_cnpj = String(req.body?.cpf_cnpj || '').replace(/\D/g, '');
    if (cpf_cnpj.length !== 11 && cpf_cnpj.length !== 14) {
      return errorResponse(res, 'CPF/CNPJ inválido', 400);
    }
    try {
      const cli = await lookupClienteTotvs(cpf_cnpj);
      if (!cli) return successResponse(res, { encontrado: false });
      return successResponse(res, { encontrado: true, cliente: cli });
    } catch (e) {
      return errorResponse(res, 'Falha consultando TOTVS', 502);
    }
  }),
);

export default router;
