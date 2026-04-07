import express from 'express';
import crypto from 'crypto';
import supabase from '../config/supabase.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
  logger,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import {
  TOTVS_BASE_URL,
  getBranchesWithNames,
} from '../totvsrouter/totvsHelper.js';
import axios from 'axios';

const router = express.Router();

const META_GRAPH_BASE = 'https://graph.facebook.com/v22.0';

// =============================================
// Helper: chamada genérica à Graph API
// =============================================
async function graphRequest(path, accessToken, options = {}) {
  const url = `${META_GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Meta Graph API error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.metaError = data?.error;
    throw err;
  }
  return data;
}

// =============================================
// CONTAS  –  CRUD whatsapp_accounts
// =============================================

// GET /api/meta/accounts
router.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('whatsapp_accounts')
      .select('id, name, waba_id, phone_id, nr_telefone, created_at')
      .order('name');

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, `${data.length} contas encontradas`);
  }),
);

// GET /api/meta/accounts/:id
router.get(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('whatsapp_accounts')
      .select('id, name, waba_id, phone_id, nr_telefone, created_at')
      .eq('id', req.params.id)
      .single();

    if (error) return errorResponse(res, error.message, 404, 'NOT_FOUND');
    successResponse(res, data);
  }),
);

// POST /api/meta/accounts
router.post(
  '/accounts',
  asyncHandler(async (req, res) => {
    const { name, waba_id, phone_id, access_token } = req.body;
    if (!name || !waba_id || !phone_id || !access_token) {
      return errorResponse(res, 'name, waba_id, phone_id e access_token são obrigatórios', 400, 'VALIDATION');
    }

    const { data, error } = await supabase
      .from('whatsapp_accounts')
      .insert({ name, waba_id, phone_id, access_token })
      .select('id, name, waba_id, phone_id')
      .single();

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Conta criada com sucesso', 201);
  }),
);

// PUT /api/meta/accounts/:id
router.put(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const { name, waba_id, phone_id, access_token } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (waba_id !== undefined) update.waba_id = waba_id;
    if (phone_id !== undefined) update.phone_id = phone_id;
    if (access_token !== undefined) update.access_token = access_token;

    if (Object.keys(update).length === 0) {
      return errorResponse(res, 'Nenhum campo para atualizar', 400, 'VALIDATION');
    }

    const { data, error } = await supabase
      .from('whatsapp_accounts')
      .update(update)
      .eq('id', req.params.id)
      .select('id, name, waba_id, phone_id')
      .single();

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Conta atualizada');
  }),
);

// DELETE /api/meta/accounts/:id
router.delete(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const { error } = await supabase
      .from('whatsapp_accounts')
      .delete()
      .eq('id', req.params.id);

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, null, 'Conta removida');
  }),
);

// =============================================
// ANALYTICS  –  Message + Pricing Analytics (proxy)
// =============================================

// GET /api/meta/template-analytics/:accountId
// Fonte primária: message_queue (nomes exatos de template + contagem real)
// Custo: distribuído proporcionalmente a partir do pricing_analytics da Meta por categoria
// Fallback: categoria quando não há dados na fila
router.get(
  '/template-analytics/:accountId',
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return errorResponse(res, 'startDate e endDate são obrigatórios', 400, 'VALIDATION');
    }

    const { data: account, error: accErr } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', req.params.accountId)
      .single();
    if (accErr || !account) return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    // 1) Buscar mensagens enviadas do message_queue no período (nomes exatos de template)
    const startISO = new Date(startDate).toISOString();
    const endISO = new Date(endDate + 'T23:59:59').toISOString();

    const { data: mqRows } = await supabase
      .from('message_queue')
      .select('template_name, template_category, delivered_at, read_at, estimated_cost, real_cost')
      .eq('account_id', req.params.accountId)
      .not('sent_at', 'is', null)
      .gte('sent_at', startISO)
      .lte('sent_at', endISO);

    // 2) Buscar custo real por PRICING_CATEGORY da Meta API (billing oficial)
    const start = Math.floor(new Date(startDate).getTime() / 1000);
    const end = Math.floor(new Date(endDate).getTime() / 1000);

    const costByCategory = {};
    try {
      const pricingFields = `pricing_analytics.start(${start}).end(${end}).granularity(MONTHLY).dimensions(["PRICING_CATEGORY"])`;
      const pricingResult = await graphRequest(
        `/${account.waba_id}?fields=${pricingFields}`,
        account.access_token,
      );
      const pricingPoints = (pricingResult?.pricing_analytics?.data || []).flatMap(d => d.data_points || []);
      for (const p of pricingPoints) {
        const cat = (p.pricing_category || 'UNKNOWN').toUpperCase();
        if (!costByCategory[cat]) costByCategory[cat] = { volume: 0, cost: 0 };
        costByCategory[cat].volume += Number(p.volume || 0);
        costByCategory[cat].cost += Number(p.cost || 0);
      }
    } catch (err) {
      logger.error(`Erro pricing_analytics: ${err.message}`);
    }

    // 3) Se há dados no message_queue → retornar por template com sent/delivered/read e custo
    if (mqRows && mqRows.length > 0) {
      const byTemplate = {};
      for (const row of mqRows) {
        const name = row.template_name || 'Desconhecido';
        const cat = (row.template_category || 'MARKETING').toUpperCase();
        if (!byTemplate[name]) {
          byTemplate[name] = { templateName: name, category: cat, sent: 0, delivered: 0, read: 0, realCostSum: 0, estimatedCostSum: 0 };
        }
        byTemplate[name].sent++;
        if (row.delivered_at) byTemplate[name].delivered++;
        if (row.read_at) byTemplate[name].read++;
        byTemplate[name].realCostSum += Number(row.real_cost || 0);
        byTemplate[name].estimatedCostSum += Number(row.estimated_cost || 0);
      }

      // Calcular volume por categoria para distribuição proporcional do custo da Meta
      const volByCat = {};
      for (const t of Object.values(byTemplate)) {
        volByCat[t.category] = (volByCat[t.category] || 0) + t.sent;
      }

      // Atribuir custo: preferência real_cost > estimated_cost > distribuição da Meta
      for (const t of Object.values(byTemplate)) {
        if (t.realCostSum > 0) {
          t.cost = t.realCostSum;
        } else if (t.estimatedCostSum > 0) {
          t.cost = t.estimatedCostSum;
        } else {
          const catCost = costByCategory[t.category]?.cost || 0;
          const catTotal = volByCat[t.category] || 1;
          t.cost = (t.sent / catTotal) * catCost;
        }
        t.volume = t.sent; // compatibilidade com frontend legado
        delete t.realCostSum;
        delete t.estimatedCostSum;
      }

      const templates = Object.values(byTemplate).sort((a, b) => b.sent - a.sent);
      return successResponse(res, { templates, source: 'template' });
    }

    // 4) Fallback: retornar por categoria quando não há dados na fila
    const pricingByCategory = Object.entries(costByCategory).map(([cat, v]) => ({
      templateName: cat,
      category: cat,
      volume: v.volume,
      cost: v.cost,
    })).sort((a, b) => b.volume - a.volume);

    successResponse(res, { templates: pricingByCategory, source: 'category' });
  }),
);

// GET /api/meta/analytics/:accountId
router.get(
  '/analytics/:accountId',
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return errorResponse(res, 'startDate e endDate são obrigatórios (YYYY-MM-DD)', 400, 'VALIDATION');
    }

    // Buscar conta com access_token
    const { data: account, error: accErr } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', req.params.accountId)
      .single();

    if (accErr || !account) return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    const start = Math.floor(new Date(startDate).getTime() / 1000);
    const end = Math.floor(new Date(endDate).getTime() / 1000);

    // Combinar analytics (sent/delivered) + pricing_analytics (volume/cost por categoria)
    // analytics usa granularity DAY, pricing_analytics usa DAILY
    const fields = [
      `analytics.start(${start}).end(${end}).granularity(DAY).phone_numbers([])`,
      `pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["PRICING_CATEGORY"])`,
    ].join(',');

    const result = await graphRequest(
      `/${account.waba_id}?fields=${fields}`,
      account.access_token,
    );

    // Message analytics: sent/delivered
    const msgPoints = result?.analytics?.data_points || [];
    const totalSent = msgPoints.reduce((s, p) => s + (p.sent || 0), 0);
    const totalDelivered = msgPoints.reduce((s, p) => s + (p.delivered || 0), 0);

    // Pricing analytics: volume/cost por categoria
    const pricingPoints = (result?.pricing_analytics?.data || []).flatMap(d => d.data_points || []);
    const summary = {
      sent: totalSent,
      delivered: totalDelivered,
      marketing: 0,
      utility: 0,
      authentication: 0,
      service: 0,
      totalVolume: 0,
      totalCost: 0,
    };

    for (const point of pricingPoints) {
      const cat = String(point.pricing_category || '').toLowerCase();
      const vol = Number(point.volume || 0);
      const costVal = Number(point.cost || 0);

      if (cat.includes('marketing')) summary.marketing += vol;
      else if (cat.includes('utility')) summary.utility += vol;
      else if (cat.includes('authentication')) summary.authentication += vol;
      else if (cat.includes('service')) summary.service += vol;

      summary.totalVolume += vol;
      summary.totalCost += costVal;
    }

    successResponse(res, {
      analytics: { dataPoints: msgPoints, sent: totalSent, delivered: totalDelivered },
      pricing: { dataPoints: pricingPoints },
      summary,
    });
  }),
);

// =============================================
// TEMPLATES  –  Message Templates
// =============================================

// GET /api/meta/templates/:accountId
router.get(
  '/templates/:accountId',
  asyncHandler(async (req, res) => {
    const { limit, status, category } = req.query;

    const { data: account, error: accErr } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', req.params.accountId)
      .single();

    if (accErr || !account) return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    const params = new URLSearchParams({ limit: String(limit || 200) });
    if (status) params.set('status', status);
    if (category) params.set('category', category);

    const result = await graphRequest(
      `/${account.waba_id}/message_templates?${params.toString()}`,
      account.access_token,
    );

    successResponse(res, result.data || [], `${(result.data || []).length} templates`);
  }),
);

// POST /api/meta/templates/:accountId
router.post(
  '/templates/:accountId',
  asyncHandler(async (req, res) => {
    const { data: account, error: accErr } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', req.params.accountId)
      .single();

    if (accErr || !account) return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    const { name, category, language, components, allow_category_change } = req.body;
    if (!name || !category || !language || !components) {
      return errorResponse(res, 'name, category, language e components são obrigatórios', 400, 'VALIDATION');
    }

    const payload = { name, category, language, components };
    if (allow_category_change) payload.allow_category_change = true;

    const result = await graphRequest(
      `/${account.waba_id}/message_templates`,
      account.access_token,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    successResponse(res, result, 'Template criado / enviado para aprovação', 201);
  }),
);

// DELETE /api/meta/templates/:accountId/:templateName
router.delete(
  '/templates/:accountId/:templateName',
  asyncHandler(async (req, res) => {
    const { data: account, error: accErr } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', req.params.accountId)
      .single();

    if (accErr || !account) return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    const result = await graphRequest(
      `/${account.waba_id}/message_templates?name=${encodeURIComponent(req.params.templateName)}`,
      account.access_token,
      { method: 'DELETE' },
    );

    successResponse(res, result, 'Template removido');
  }),
);

// =============================================
// MENSAGENS  –  Envio avulso
// =============================================

// POST /api/meta/send/:accountId
router.post(
  '/send/:accountId',
  asyncHandler(async (req, res) => {
    const { data: account, error: accErr } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', req.params.accountId)
      .single();

    if (accErr || !account) return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    const { to, templateName, languageCode, components } = req.body;
    if (!to || !templateName) {
      return errorResponse(res, 'to e templateName são obrigatórios', 400, 'VALIDATION');
    }

    const result = await graphRequest(
      `/${account.phone_id}/messages`,
      account.access_token,
      {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode || 'pt_BR' },
            ...(components?.length ? { components } : {}),
          },
        }),
      },
    );

    successResponse(res, result, 'Mensagem enviada');
  }),
);

// =============================================
// CAMPANHAS  –  Enfileirar e monitorar
// =============================================

// POST /api/meta/campaigns  (enfileirar contatos)
router.post(
  '/campaigns',
  asyncHandler(async (req, res) => {
    const {
      accountId,
      campaignName,
      templateName,
      templateLanguage,
      templateCategory,
      templatePayload,
      contacts,       // [{ phone, name?, externalId?, variables? }]
      scheduledAt,
      priority,
      dailyTierLimit,
    } = req.body;

    if (!accountId || !templateName || !contacts?.length) {
      return errorResponse(res, 'accountId, templateName e contacts são obrigatórios', 400, 'VALIDATION');
    }

    // Gerar campaign_id único para agrupar
    const campaignId = crypto.randomUUID();

    const rows = contacts.map((c) => ({
      account_id: accountId,
      campaign_id: campaignId,
      campaign_name: campaignName || `Campanha ${new Date().toLocaleDateString('pt-BR')}`,
      phone_number: String(c.phone).replace(/\D/g, ''),
      contact_name: c.name || null,
      contact_external_id: c.externalId || null,
      template_name: templateName,
      template_language: templateLanguage || 'pt_BR',
      template_category: templateCategory || 'MARKETING',
      template_payload: templatePayload || {},
      template_variables: c.variables || {},
      status: 'pending',
      priority: priority || 100,
      scheduled_at: scheduledAt || new Date().toISOString(),
      daily_tier_limit: dailyTierLimit || 1000,
      dedupe_key: `${campaignId}:${String(c.phone).replace(/\D/g, '')}`,
    }));

    // Inserir em lotes de 500
    const batchSize = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from('message_queue').insert(batch);
      if (error) {
        logger.error(`Erro ao inserir lote ${i / batchSize + 1}: ${error.message}`);
        return errorResponse(res, `Erro ao enfileirar: ${error.message}`, 500, 'DB_ERROR');
      }
      inserted += batch.length;
    }

    successResponse(res, {
      campaignId,
      campaignName: rows[0].campaign_name,
      totalQueued: inserted,
      scheduledAt: rows[0].scheduled_at,
    }, `${inserted} mensagens enfileiradas`, 201);
  }),
);

// GET /api/meta/campaigns  (listar campanhas agrupadas)
router.get(
  '/campaigns',
  asyncHandler(async (req, res) => {
    const { accountId, limit, startDate, endDate } = req.query;

    let query = supabase
      .from('message_queue')
      .select('campaign_id, campaign_name, account_id, template_name, template_category, scheduled_at, status')
      .order('scheduled_at', { ascending: false });

    if (accountId) query = query.eq('account_id', accountId);
    if (startDate) query = query.gte('scheduled_at', `${startDate}T00:00:00`);
    if (endDate) query = query.lte('scheduled_at', `${endDate}T23:59:59`);

    const { data, error } = await query.limit(Number(limit) || 5000);
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');

    // Agrupar por campaign_id
    const campaigns = {};
    for (const row of data) {
      if (!campaigns[row.campaign_id]) {
        campaigns[row.campaign_id] = {
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          accountId: row.account_id,
          templateName: row.template_name,
          templateCategory: row.template_category,
          scheduledAt: row.scheduled_at,
          total: 0,
          pending: 0,
          sent: 0,
          delivered: 0,
          read: 0,
          replied: 0,
          failed: 0,
          canceled: 0,
        };
      }
      const c = campaigns[row.campaign_id];
      c.total++;
      const s = row.status;
      if (s === 'pending' || s === 'retrying' || s === 'processing' || s === 'paused') c.pending++;
      else if (s === 'sent') c.sent++;
      else if (s === 'delivered') c.delivered++;
      else if (s === 'read') c.read++;
      else if (s === 'replied') c.replied++;
      else if (s === 'failed') c.failed++;
      else if (s === 'canceled') c.canceled++;
    }

    const list = Object.values(campaigns);
    successResponse(res, list, `${list.length} campanhas`);
  }),
);

// GET /api/meta/campaigns/:campaignId  (detalhes de uma campanha)
router.get(
  '/campaigns/:campaignId',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('message_queue')
      .select('*')
      .eq('campaign_id', req.params.campaignId)
      .order('created_at', { ascending: true });

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    if (!data.length) return errorResponse(res, 'Campanha não encontrada', 404, 'NOT_FOUND');

    // Resumo
    const summary = { total: data.length, pending: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, canceled: 0, estimatedCost: 0, realCost: 0 };
    for (const row of data) {
      const s = row.status;
      if (s === 'pending' || s === 'retrying' || s === 'processing' || s === 'paused') summary.pending++;
      else if (s === 'sent') summary.sent++;
      else if (s === 'delivered') summary.delivered++;
      else if (s === 'read') summary.read++;
      else if (s === 'replied') summary.replied++;
      else if (s === 'failed') summary.failed++;
      else if (s === 'canceled') summary.canceled++;
      summary.estimatedCost += Number(row.estimated_cost || 0);
      summary.realCost += Number(row.real_cost || 0);
    }

    successResponse(res, {
      campaignId: req.params.campaignId,
      campaignName: data[0].campaign_name,
      summary,
      messages: data,
    });
  }),
);

// POST /api/meta/campaigns/:campaignId/cancel
router.post(
  '/campaigns/:campaignId/cancel',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('message_queue')
      .update({ status: 'canceled', canceled_at: new Date().toISOString() })
      .eq('campaign_id', req.params.campaignId)
      .in('status', ['pending', 'retrying', 'paused'])
      .select('id');

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, { canceled: data.length }, `${data.length} mensagens canceladas`);
  }),
);

// =============================================
// QUEUE STATUS  –  Visão geral da fila
// =============================================

// GET /api/meta/queue/status
router.get(
  '/queue/status',
  asyncHandler(async (req, res) => {
    const { accountId } = req.query;

    let query = supabase
      .from('message_queue')
      .select('status, account_id');

    if (accountId) query = query.eq('account_id', accountId);

    const { data, error } = await query;
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');

    const counts = { pending: 0, processing: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, canceled: 0, paused: 0, retrying: 0, total: data.length };
    for (const row of data) {
      if (counts[row.status] !== undefined) counts[row.status]++;
    }

    successResponse(res, counts);
  }),
);

// =============================================
// Helper: buscar conta por waba_id
// =============================================
async function getAccountByWabaId(wabaId) {
  const { data, error } = await supabase
    .from('whatsapp_accounts')
    .select('*')
    .eq('waba_id', wabaId)
    .single();
  if (error || !data) return null;
  return data;
}

// =============================================
// TOTVS PROXY  –  Filiais e Contatos (remove N8N)
// =============================================

// GET /api/meta/totvs-branches  –  lista filiais via backend (sem expor credenciais)
router.get(
  '/totvs-branches',
  asyncHandler(async (req, res) => {
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(res, 'Não foi possível obter token TOTVS', 503, 'TOKEN_UNAVAILABLE');
    }
    const branches = await getBranchesWithNames(tokenData.access_token);
    const formatted = (branches || [])
      .map((b) => ({ id: b.code, nome: b.name }))
      .filter((b) => b.id !== undefined && b.id !== null)
      .sort((a, b) => Number(a.id) - Number(b.id));
    successResponse(res, formatted, `${formatted.length} filiais`);
  }),
);

// POST /api/meta/totvs-contacts  –  busca contatos do TOTVS (substitui N8N)
router.post(
  '/totvs-contacts',
  asyncHandler(async (req, res) => {
    const { operacao, data_inicio, data_fim, empresas } = req.body;

    if (!operacao || !data_inicio || !data_fim) {
      return errorResponse(res, 'operacao, data_inicio e data_fim são obrigatórios', 400, 'VALIDATION');
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(res, 'Não foi possível obter token TOTVS', 503, 'TOKEN_UNAVAILABLE');
    }
    const token = tokenData.access_token;

    const opName = (operacao.nome || '').toLowerCase();
    const isRevenda = opName.includes('revenda');
    const branchCodes = (empresas || []).map(Number);

    // Montar filtro de invoices com base na operação
    const filter = {
      branchCodeList: branchCodes,
      change: {
        startDate: `${data_inicio}T00:00:00.000Z`,
        endDate: `${data_fim}T23:59:59.999Z`,
      },
    };

    // Se a operação tem um código de operação TOTVS, filtrar por ele
    if (operacao.cd_operacao) {
      filter.operationCodeList = Array.isArray(operacao.cd_operacao)
        ? operacao.cd_operacao
        : [operacao.cd_operacao];
    }

    const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
    const allInvoices = [];
    let page = 1;
    let hasNext = true;

    while (hasNext && page <= 50) {
      const payload = { filter, page, pageSize: 200, expand: 'person' };
      try {
        const resp = await axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          timeout: 60000,
        });
        const items = resp.data?.items || [];
        allInvoices.push(...items);
        hasNext = resp.data?.hasNext || false;
        page++;
      } catch (err) {
        if (err.response?.status === 401) {
          const newToken = (await getToken(true))?.access_token;
          const resp = await axios.post(endpoint, payload, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${newToken}`,
            },
            timeout: 60000,
          });
          const items = resp.data?.items || [];
          allInvoices.push(...items);
          hasNext = resp.data?.hasNext || false;
          page++;
        } else {
          logger.error(`Erro ao buscar invoices TOTVS page ${page}: ${err.message}`);
          break;
        }
      }
    }

    // Extrair contatos únicos (deduplicar por personCode)
    const contactsMap = {};
    let totalValue = 0;

    for (const inv of allInvoices) {
      const personCode = inv.personCode || inv.person?.personCode;
      if (!personCode) continue;

      const value = Number(inv.invoiceValue || inv.totalValue || 0);
      totalValue += value;

      if (contactsMap[personCode]) {
        contactsMap[personCode].totalValue += value;
        contactsMap[personCode].invoiceCount++;
        continue;
      }

      // Extrair telefone dos dados de person
      const person = inv.person || {};
      const phones = person.phones || [];
      let phone = '';
      // Priorizar celular
      for (const p of phones) {
        const num = (p.number || '').replace(/\D/g, '');
        if (num.length >= 10) {
          phone = num.startsWith('55') ? num : `55${num}`;
          if (p.typeDescription?.toLowerCase().includes('celular') || num.length === 11 || (num.length === 13 && num.startsWith('55'))) {
            break; // celular encontrado
          }
        }
      }

      const name = person.fantasyName || person.corporateName || person.name || '';
      const cpfCnpj = person.cpfCnpj || person.federalTaxNumber || '';

      contactsMap[personCode] = {
        cd_pessoa: personCode,
        name: name,
        cpf_cnpj: cpfCnpj,
        nr_telefone: phone,
        totalValue: value,
        invoiceCount: 1,
      };
    }

    const contacts = Object.values(contactsMap).filter((c) => c.nr_telefone);
    const ticketMedio = contacts.length > 0 ? totalValue / contacts.length : 0;

    successResponse(res, { data: contacts, ticketMedio }, `${contacts.length} contatos encontrados`);
  }),
);

// =============================================
// CAMPANHA DIRETA  –  Disparo via Meta API (substitui N8N)
// =============================================

// POST /api/meta/campaign-dispatch  –  envia campanha diretamente pela Graph API
router.post(
  '/campaign-dispatch',
  asyncHandler(async (req, res) => {
    const { waba_id, template_name, language, contacts_csv, origem } = req.body;

    if (!waba_id || !template_name) {
      return errorResponse(res, 'waba_id e template_name são obrigatórios', 400, 'VALIDATION');
    }

    // Buscar conta pelo waba_id
    const account = await getAccountByWabaId(waba_id);
    if (!account) return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    // Normalizar contatos
    let contacts = [];

    if (Array.isArray(contacts_csv)) {
      if (typeof contacts_csv[0] === 'string') {
        // CSV rows: primeira linha é header
        const header = contacts_csv[0].split(',').map((h) => h.trim().toLowerCase());
        const phoneIdx = header.findIndex((h) => h === 'telefone' || h === 'phone');
        const nameIdx = header.findIndex((h) => h === 'nome' || h === 'name');

        for (let i = 1; i < contacts_csv.length; i++) {
          const cols = contacts_csv[i].split(',').map((c) => c.trim());
          const phone = (cols[phoneIdx >= 0 ? phoneIdx : 0] || '').replace(/\D/g, '');
          if (!phone || phone.length < 10) continue;

          const variables = {};
          header.forEach((h, idx) => {
            if (h.startsWith('variavel_') || h.startsWith('var_')) {
              variables[h] = cols[idx] || '';
            }
          });

          contacts.push({
            phone: phone.startsWith('55') ? phone : `55${phone}`,
            name: nameIdx >= 0 ? cols[nameIdx] : '',
            variables,
          });
        }
      } else {
        // Array de objetos (TOTVS contacts)
        contacts = contacts_csv.map((c) => {
          const phone = (c.nr_telefone || c.phones || c.phone || '').replace(/\D/g, '');
          return {
            phone: phone.startsWith('55') ? phone : `55${phone}`,
            name: c.name || c.nome || '',
            variables: c.variables || {},
          };
        }).filter((c) => c.phone.length >= 12);
      }
    }

    if (contacts.length === 0) {
      return errorResponse(res, 'Nenhum contato válido para enviar', 400, 'NO_CONTACTS');
    }

    // Gerar campaign_id
    const campaignId = crypto.randomUUID();
    const campaignName = `${template_name} - ${new Date().toLocaleDateString('pt-BR')} (${origem || 'manual'})`;

    // Enfileirar na message_queue
    const rows = contacts.map((c) => ({
      account_id: account.id,
      campaign_id: campaignId,
      campaign_name: campaignName,
      phone_number: c.phone,
      contact_name: c.name || null,
      template_name: template_name,
      template_language: language || 'pt_BR',
      template_category: 'MARKETING',
      template_variables: c.variables || {},
      status: 'pending',
      priority: 100,
      scheduled_at: new Date().toISOString(),
      dedupe_key: `${campaignId}:${c.phone}`,
    }));

    // Inserir em lotes de 500
    const batchSize = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from('message_queue').insert(batch);
      if (error) {
        return errorResponse(res, `Erro ao enfileirar: ${error.message}`, 500, 'DB_ERROR');
      }
      inserted += batch.length;
    }

    // Processar fila em background (enviar mensagens)
    processCampaignQueue(campaignId, account).catch((err) =>
      logger.error(`Erro ao processar fila da campanha ${campaignId}: ${err.message}`)
    );

    successResponse(res, {
      campaignId,
      campaignName,
      totalQueued: inserted,
    }, `${inserted} mensagens enfileiradas e envio iniciado`, 201);
  }),
);

// =============================================
// WORKER: Processar fila de mensagens (substitui N8N)
// =============================================
async function processCampaignQueue(campaignId, account) {
  const BATCH_SIZE = 50;
  const DELAY_MS = 100; // delay entre mensagens para não estourar rate-limit

  while (true) {
    // Buscar próximo lote de pendentes
    const { data: pending, error } = await supabase
      .from('message_queue')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .order('created_at')
      .limit(BATCH_SIZE);

    if (error || !pending || pending.length === 0) break;

    // Marcar como processing
    const ids = pending.map((p) => p.id);
    await supabase.from('message_queue').update({ status: 'processing' }).in('id', ids);

    for (const msg of pending) {
      try {
        // Montar componentes de variáveis do template
        const vars = msg.template_variables || {};
        const varKeys = Object.keys(vars).sort();
        const components = [];

        if (varKeys.length > 0) {
          components.push({
            type: 'body',
            parameters: varKeys.map((k) => ({
              type: 'text',
              text: vars[k] || '',
            })),
          });
        }

        await graphRequest(
          `/${account.phone_id}/messages`,
          account.access_token,
          {
            method: 'POST',
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: msg.phone_number,
              type: 'template',
              template: {
                name: msg.template_name,
                language: { code: msg.template_language || 'pt_BR' },
                ...(components.length ? { components } : {}),
              },
            }),
          },
        );

        await supabase
          .from('message_queue')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', msg.id);
      } catch (err) {
        const retries = (msg.retry_count || 0) + 1;
        await supabase
          .from('message_queue')
          .update({
            status: retries >= 3 ? 'failed' : 'retrying',
            retry_count: retries,
            last_error: err.message,
          })
          .eq('id', msg.id);
      }

      // Delay entre envios
      if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
}

// =============================================
// ANALYTICS PARA CROSBYBOT  –  Resultados por template (substitui N8N)
// =============================================

// POST /api/meta/template-results  –  retorna dados no formato esperado pelo CrosbyBot
router.post(
  '/template-results',
  asyncHandler(async (req, res) => {
    const { waba_id, template_name, start, end } = req.body;

    if (!waba_id || !template_name || !start || !end) {
      return errorResponse(res, 'waba_id, template_name, start e end são obrigatórios', 400, 'VALIDATION');
    }

    const account = await getAccountByWabaId(waba_id);
    if (!account) return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    const COTACAO_DOLAR = 5.8;

    // 1. Buscar analytics de mensagens (sent/delivered por dia)
    const analyticsFields = `analytics.start(${start}).end(${end}).granularity(DAY).phone_numbers([])`;
    let analyticsResult;
    try {
      analyticsResult = await graphRequest(
        `/${account.waba_id}?fields=${analyticsFields}`,
        account.access_token,
      );
    } catch (err) {
      logger.error(`Erro analytics: ${err.message}`);
      analyticsResult = {};
    }

    // 2. Buscar pricing por template
    const pricingFields = `pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["TEMPLATE_NAME"])`;
    let pricingResult;
    try {
      pricingResult = await graphRequest(
        `/${account.waba_id}?fields=${pricingFields}`,
        account.access_token,
      );
    } catch (err) {
      logger.error(`Erro pricing: ${err.message}`);
      pricingResult = {};
    }

    // 3. Buscar dados de conversation analytics (para lidas)
    // A Meta Graph API analytics retorna sent, delivered, read
    const msgPoints = analyticsResult?.analytics?.data_points || [];

    // Calcular totais (os msg analytics são globais, não por template)
    // Para dados por template, usar pricing_analytics
    const pricingPoints = (pricingResult?.pricing_analytics?.data || []).flatMap(d => d.data_points || []);

    // Filtrar points do template específico
    const templatePricing = pricingPoints.filter(
      (p) => (p.template_name || '').toLowerCase() === template_name.toLowerCase()
    );

    let totalVolume = 0;
    let totalCostUSD = 0;
    const dailyMap = {};

    for (const p of templatePricing) {
      const vol = Number(p.volume || 0);
      const cost = Number(p.cost || 0);
      totalVolume += vol;
      totalCostUSD += cost;

      // Agrupar por dia
      const ts = p.start ? new Date(p.start * 1000).toISOString().slice(0, 10) : 'unknown';
      if (!dailyMap[ts]) dailyMap[ts] = { enviadas: 0, entregues: 0, lidas: 0 };
      dailyMap[ts].enviadas += vol;
    }

    // Cruzar com dados de analytics diários (sent/delivered/read)
    // Os analytics são globais, mas podemos estimar proporcionalmente
    let totalSent = 0;
    let totalDelivered = 0;
    let totalRead = 0;

    for (const dp of msgPoints) {
      totalSent += dp.sent || 0;
      totalDelivered += dp.delivered || 0;
      // 'read' pode ou não estar disponível na API analytics
    }

    // Se temos dados de pricing para o template, usar volume como "enviadas"
    // Para "entregues" e "lidas", calcular proporção global e aplicar
    const deliveryRate = totalSent > 0 ? totalDelivered / totalSent : 0.95;
    const readRate = totalSent > 0 ? (totalRead || totalDelivered * 0.6) / totalSent : 0.5;

    const enviadas = totalVolume || 0;
    const entregues = Math.round(enviadas * deliveryRate);
    const lidas = Math.round(enviadas * readRate);

    // Montar gráfico diário
    const grafico = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => {
        const d = new Date(date + 'T12:00:00');
        return {
          label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          enviadas: vals.enviadas,
          entregues: Math.round(vals.enviadas * deliveryRate),
          lidas: Math.round(vals.enviadas * readRate),
        };
      });

    const totalBRL = totalCostUSD * COTACAO_DOLAR;

    res.json({
      enviadas,
      entregues,
      lidas,
      respostas: 0, // Meta API não expõe "respostas" diretamente
      totalUSD: totalCostUSD,
      totalBRL,
      grafico,
    });
  }),
);

export default router;
