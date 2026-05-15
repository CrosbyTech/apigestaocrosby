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
    const { canal } = req.query;

    let query = supabase
      .from('whatsapp_accounts')
      .select(
        'id, name, waba_id, phone_id, nr_telefone, canal_venda, created_at',
      )
      .order('name');

    if (canal) query = query.eq('canal_venda', canal);

    const { data, error } = await query;
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
      .select(
        'id, name, waba_id, phone_id, nr_telefone, canal_venda, created_at',
      )
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
    const { name, waba_id, phone_id, access_token, canal_venda } = req.body;
    if (!name || !waba_id || !phone_id || !access_token) {
      return errorResponse(
        res,
        'name, waba_id, phone_id e access_token são obrigatórios',
        400,
        'VALIDATION',
      );
    }

    const { data, error } = await supabase
      .from('whatsapp_accounts')
      .insert({
        name,
        waba_id,
        phone_id,
        access_token,
        canal_venda: canal_venda || null,
      })
      .select('id, name, waba_id, phone_id, canal_venda')
      .single();

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Conta criada com sucesso', 201);
  }),
);

// PUT /api/meta/accounts/:id
router.put(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const { name, waba_id, phone_id, access_token, canal_venda } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (waba_id !== undefined) update.waba_id = waba_id;
    if (phone_id !== undefined) update.phone_id = phone_id;
    if (access_token !== undefined) update.access_token = access_token;
    if (canal_venda !== undefined) update.canal_venda = canal_venda;

    if (Object.keys(update).length === 0) {
      return errorResponse(
        res,
        'Nenhum campo para atualizar',
        400,
        'VALIDATION',
      );
    }

    const { data, error } = await supabase
      .from('whatsapp_accounts')
      .update(update)
      .eq('id', req.params.id)
      .select('id, name, waba_id, phone_id, canal_venda')
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
// Fonte primária: Meta template_analytics API (sent, delivered, read, cost por template_id)
// Fallback: pricing_analytics por PRICING_CATEGORY
router.get(
  '/template-analytics/:accountId',
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return errorResponse(
        res,
        'startDate e endDate são obrigatórios',
        400,
        'VALIDATION',
      );
    }

    const { data: account, error: accErr } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', req.params.accountId)
      .single();
    if (accErr || !account)
      return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    // Janela em BRT (America/Sao_Paulo, UTC-3) pra bater com o range do TOTVS
    const start = Math.floor(
      new Date(`${startDate}T00:00:00-03:00`).getTime() / 1000,
    );
    const end = Math.floor(
      new Date(`${endDate}T23:59:59-03:00`).getTime() / 1000,
    );

    // template_analytics tem janela máxima de 90 dias
    const now = Math.floor(Date.now() / 1000);
    const maxLookback = 90 * 24 * 60 * 60;
    const effectiveStart = Math.max(start, now - maxLookback);

    // 1) Buscar lista de templates aprovados para obter IDs, nomes e categorias
    let templateList = [];
    try {
      let url = `/${account.waba_id}/message_templates?limit=200&fields=id,name,category,status`;
      while (url) {
        const result = await graphRequest(url, account.access_token);
        const items = result?.data || [];
        templateList.push(...items);
        // Paginação
        const nextUrl = result?.paging?.next;
        if (nextUrl) {
          // Extrair path relativo da URL completa
          const parsed = new URL(nextUrl);
          url = parsed.pathname.replace(/^\/v[\d.]+/, '') + parsed.search;
        } else {
          url = null;
        }
      }
    } catch (err) {
      logger.error(`Erro ao buscar lista de templates: ${err.message}`);
    }

    const approvedTemplates = templateList.filter(
      (t) => t.status === 'APPROVED',
    );
    const idToInfo = {};
    for (const t of approvedTemplates) {
      idToInfo[t.id] = {
        name: t.name,
        category: (t.category || 'UTILITY').toUpperCase(),
      };
    }

    // 2) Chamar template_analytics em lotes de 10 (limite da API Meta)
    const templateIds = approvedTemplates.map((t) => t.id);
    const allDataPoints = [];

    if (templateIds.length > 0) {
      const batchSize = 10;
      for (let i = 0; i < templateIds.length; i += batchSize) {
        const batch = templateIds.slice(i, i + batchSize);
        try {
          const idsParam = encodeURIComponent(JSON.stringify(batch));
          const tplAnalyticsUrl = `/${account.waba_id}/template_analytics?start=${effectiveStart}&end=${end}&granularity=DAILY&template_ids=${idsParam}&metric_types=${encodeURIComponent('cost,sent,delivered,read')}`;
          const result = await graphRequest(
            tplAnalyticsUrl,
            account.access_token,
          );
          const points = result?.data?.[0]?.data_points || [];
          allDataPoints.push(...points);
        } catch (err) {
          logger.error(`Erro template_analytics batch ${i}: ${err.message}`);
        }
      }
    }

    // 3) Se temos dados do template_analytics, agrupar por template_id
    if (allDataPoints.length > 0) {
      const byTemplate = {};
      for (const p of allDataPoints) {
        const tplId = p.template_id;
        const info = idToInfo[tplId] || { name: tplId, category: 'UTILITY' };
        const key = tplId;
        if (!byTemplate[key]) {
          byTemplate[key] = {
            templateName: info.name,
            category: info.category,
            sent: 0,
            delivered: 0,
            read: 0,
            cost: 0,
          };
        }
        byTemplate[key].sent += Number(p.sent || 0);
        byTemplate[key].delivered += Number(p.delivered || 0);
        byTemplate[key].read += Number(p.read || 0);

        // cost é array de objetos [{type: "amount_spent", value: X}, ...]
        const costArr = Array.isArray(p.cost) ? p.cost : [];
        const amountSpent = costArr.find((c) => c.type === 'amount_spent');
        if (amountSpent) {
          byTemplate[key].cost += Number(amountSpent.value || 0);
        }
      }

      const templates = Object.values(byTemplate)
        .filter((t) => t.sent > 0)
        .map((t) => ({ ...t, volume: t.sent }))
        .sort((a, b) => b.sent - a.sent);

      return successResponse(res, { templates, source: 'template_analytics' });
    }

    // 4) Fallback: pricing_analytics por PRICING_CATEGORY (dados agregados, sem nome de template)
    try {
      const catFields = `pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["PRICING_CATEGORY"])`;
      const catResult = await graphRequest(
        `/${account.waba_id}?fields=${catFields}`,
        account.access_token,
      );
      const catPoints = (catResult?.pricing_analytics?.data || []).flatMap(
        (d) => d.data_points || [],
      );
      const costByCategory = {};
      for (const p of catPoints) {
        const cat = (p.pricing_category || 'UNKNOWN').toUpperCase();
        if (!costByCategory[cat]) costByCategory[cat] = { volume: 0, cost: 0 };
        costByCategory[cat].volume += Number(p.volume || 0);
        costByCategory[cat].cost += Number(p.cost || 0);
      }

      const templates = Object.entries(costByCategory)
        .map(([cat, v]) => ({
          templateName: cat,
          category: cat,
          sent: v.volume,
          volume: v.volume,
          cost: v.cost,
        }))
        .sort((a, b) => b.volume - a.volume);

      return successResponse(res, { templates, source: 'category' });
    } catch (err) {
      logger.error(
        `Erro pricing_analytics (category fallback): ${err.message}`,
      );
    }

    successResponse(res, { templates: [], source: 'empty' });
  }),
);

// GET /api/meta/analytics/:accountId
router.get(
  '/analytics/:accountId',
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return errorResponse(
        res,
        'startDate e endDate são obrigatórios (YYYY-MM-DD)',
        400,
        'VALIDATION',
      );
    }

    // Buscar conta com access_token
    const { data: account, error: accErr } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', req.params.accountId)
      .single();

    if (accErr || !account)
      return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    // Janela em BRT (America/Sao_Paulo, UTC-3) pra bater com o range do TOTVS
    const start = Math.floor(
      new Date(`${startDate}T00:00:00-03:00`).getTime() / 1000,
    );
    const end = Math.floor(
      new Date(`${endDate}T23:59:59-03:00`).getTime() / 1000,
    );

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
    const totalDelivered = msgPoints.reduce(
      (s, p) => s + (p.delivered || 0),
      0,
    );

    // Pricing analytics: volume/cost por categoria
    const pricingPoints = (result?.pricing_analytics?.data || []).flatMap(
      (d) => d.data_points || [],
    );
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
      analytics: {
        dataPoints: msgPoints,
        sent: totalSent,
        delivered: totalDelivered,
      },
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

    if (accErr || !account)
      return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    const params = new URLSearchParams({ limit: String(limit || 200) });
    if (status) params.set('status', status);
    if (category) params.set('category', category);

    const result = await graphRequest(
      `/${account.waba_id}/message_templates?${params.toString()}`,
      account.access_token,
    );

    successResponse(
      res,
      result.data || [],
      `${(result.data || []).length} templates`,
    );
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

    if (accErr || !account)
      return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    const { name, category, language, components, allow_category_change } =
      req.body;
    if (!name || !category || !language || !components) {
      return errorResponse(
        res,
        'name, category, language e components são obrigatórios',
        400,
        'VALIDATION',
      );
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

    successResponse(
      res,
      result,
      'Template criado / enviado para aprovação',
      201,
    );
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

    if (accErr || !account)
      return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

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

    if (accErr || !account)
      return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    const { to, templateName, languageCode, components } = req.body;
    if (!to || !templateName) {
      return errorResponse(
        res,
        'to e templateName são obrigatórios',
        400,
        'VALIDATION',
      );
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
      contacts, // [{ phone, name?, externalId?, variables? }]
      scheduledAt,
      priority,
      dailyTierLimit,
    } = req.body;

    if (!accountId || !templateName || !contacts?.length) {
      return errorResponse(
        res,
        'accountId, templateName e contacts são obrigatórios',
        400,
        'VALIDATION',
      );
    }

    // Gerar campaign_id único para agrupar
    const campaignId = crypto.randomUUID();

    const rows = contacts.map((c) => ({
      account_id: accountId,
      campaign_id: campaignId,
      campaign_name:
        campaignName || `Campanha ${new Date().toLocaleDateString('pt-BR')}`,
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
        logger.error(
          `Erro ao inserir lote ${i / batchSize + 1}: ${error.message}`,
        );
        return errorResponse(
          res,
          `Erro ao enfileirar: ${error.message}`,
          500,
          'DB_ERROR',
        );
      }
      inserted += batch.length;
    }

    successResponse(
      res,
      {
        campaignId,
        campaignName: rows[0].campaign_name,
        totalQueued: inserted,
        scheduledAt: rows[0].scheduled_at,
      },
      `${inserted} mensagens enfileiradas`,
      201,
    );
  }),
);

// GET /api/meta/campaigns  (listar campanhas agrupadas)
router.get(
  '/campaigns',
  asyncHandler(async (req, res) => {
    const { accountId, limit, startDate, endDate } = req.query;

    let query = supabase
      .from('message_queue')
      .select(
        'campaign_id, campaign_name, account_id, template_name, template_category, scheduled_at, status',
      )
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
      if (
        s === 'pending' ||
        s === 'retrying' ||
        s === 'processing' ||
        s === 'paused'
      )
        c.pending++;
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
    if (!data.length)
      return errorResponse(res, 'Campanha não encontrada', 404, 'NOT_FOUND');

    // Resumo
    const summary = {
      total: data.length,
      pending: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
      canceled: 0,
      estimatedCost: 0,
      realCost: 0,
    };
    for (const row of data) {
      const s = row.status;
      if (
        s === 'pending' ||
        s === 'retrying' ||
        s === 'processing' ||
        s === 'paused'
      )
        summary.pending++;
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
    successResponse(
      res,
      { canceled: data.length },
      `${data.length} mensagens canceladas`,
    );
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

    let query = supabase.from('message_queue').select('status, account_id');

    if (accountId) query = query.eq('account_id', accountId);

    const { data, error } = await query;
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');

    const counts = {
      pending: 0,
      processing: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
      canceled: 0,
      paused: 0,
      retrying: 0,
      total: data.length,
    };
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
      return errorResponse(
        res,
        'Não foi possível obter token TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
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
      return errorResponse(
        res,
        'operacao, data_inicio e data_fim são obrigatórios',
        400,
        'VALIDATION',
      );
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
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
          logger.error(
            `Erro ao buscar invoices TOTVS page ${page}: ${err.message}`,
          );
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
          if (
            p.typeDescription?.toLowerCase().includes('celular') ||
            num.length === 11 ||
            (num.length === 13 && num.startsWith('55'))
          ) {
            break; // celular encontrado
          }
        }
      }

      const name =
        person.fantasyName || person.corporateName || person.name || '';
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

    successResponse(
      res,
      { data: contacts, ticketMedio },
      `${contacts.length} contatos encontrados`,
    );
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
      return errorResponse(
        res,
        'waba_id e template_name são obrigatórios',
        400,
        'VALIDATION',
      );
    }

    // Buscar conta pelo waba_id
    const account = await getAccountByWabaId(waba_id);
    if (!account)
      return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

    // Normalizar contatos
    let contacts = [];

    if (Array.isArray(contacts_csv)) {
      if (typeof contacts_csv[0] === 'string') {
        // CSV rows: primeira linha é header
        const header = contacts_csv[0]
          .split(',')
          .map((h) => h.trim().toLowerCase());
        const phoneIdx = header.findIndex(
          (h) => h === 'telefone' || h === 'phone',
        );
        const nameIdx = header.findIndex((h) => h === 'nome' || h === 'name');

        for (let i = 1; i < contacts_csv.length; i++) {
          const cols = contacts_csv[i].split(',').map((c) => c.trim());
          const phone = (cols[phoneIdx >= 0 ? phoneIdx : 0] || '').replace(
            /\D/g,
            '',
          );
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
        contacts = contacts_csv
          .map((c) => {
            const phone = (c.nr_telefone || c.phones || c.phone || '').replace(
              /\D/g,
              '',
            );
            return {
              phone: phone.startsWith('55') ? phone : `55${phone}`,
              name: c.name || c.nome || '',
              variables: c.variables || {},
            };
          })
          .filter((c) => c.phone.length >= 12);
      }
    }

    if (contacts.length === 0) {
      return errorResponse(
        res,
        'Nenhum contato válido para enviar',
        400,
        'NO_CONTACTS',
      );
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
        return errorResponse(
          res,
          `Erro ao enfileirar: ${error.message}`,
          500,
          'DB_ERROR',
        );
      }
      inserted += batch.length;
    }

    // Processar fila em background (enviar mensagens)
    processCampaignQueue(campaignId, account).catch((err) =>
      logger.error(
        `Erro ao processar fila da campanha ${campaignId}: ${err.message}`,
      ),
    );

    successResponse(
      res,
      {
        campaignId,
        campaignName,
        totalQueued: inserted,
      },
      `${inserted} mensagens enfileiradas e envio iniciado`,
      201,
    );
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
    await supabase
      .from('message_queue')
      .update({ status: 'processing' })
      .in('id', ids);

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
      return errorResponse(
        res,
        'waba_id, template_name, start e end são obrigatórios',
        400,
        'VALIDATION',
      );
    }

    const account = await getAccountByWabaId(waba_id);
    if (!account)
      return errorResponse(res, 'Conta não encontrada', 404, 'NOT_FOUND');

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
    const pricingPoints = (
      pricingResult?.pricing_analytics?.data || []
    ).flatMap((d) => d.data_points || []);

    // Filtrar points do template específico
    const templatePricing = pricingPoints.filter(
      (p) =>
        (p.template_name || '').toLowerCase() === template_name.toLowerCase(),
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
      const ts = p.start
        ? new Date(p.start * 1000).toISOString().slice(0, 10)
        : 'unknown';
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
    const readRate =
      totalSent > 0 ? (totalRead || totalDelivered * 0.6) / totalSent : 0.5;

    const enviadas = totalVolume || 0;
    const entregues = Math.round(enviadas * deliveryRate);
    const lidas = Math.round(enviadas * readRate);

    // Montar gráfico diário
    const grafico = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => {
        const d = new Date(date + 'T12:00:00');
        return {
          label: d.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
          }),
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

// =============================================
// META ADS  –  Contas e gasto com tráfego pago
// =============================================

// GET /api/meta/ad-accounts
router.get(
  '/ad-accounts',
  asyncHandler(async (req, res) => {
    const { canal } = req.query;
    let query = supabase
      .from('meta_ad_accounts')
      .select('id, name, ad_account_id, canal_venda, created_at')
      .order('name');
    if (canal) query = query.eq('canal_venda', canal);
    const { data, error } = await query;
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, `${data.length} contas de anúncio`);
  }),
);

// POST /api/meta/ad-accounts
router.post(
  '/ad-accounts',
  asyncHandler(async (req, res) => {
    const { name, ad_account_id, access_token, canal_venda } = req.body;
    if (!name || !ad_account_id || !access_token) {
      return errorResponse(
        res,
        'name, ad_account_id e access_token são obrigatórios',
        400,
        'VALIDATION',
      );
    }
    const accountId = ad_account_id.startsWith('act_')
      ? ad_account_id
      : `act_${ad_account_id}`;
    const { data, error } = await supabase
      .from('meta_ad_accounts')
      .insert({
        name,
        ad_account_id: accountId,
        access_token,
        canal_venda: canal_venda || null,
      })
      .select('id, name, ad_account_id, canal_venda')
      .single();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Conta de anúncio criada', 201);
  }),
);

// PUT /api/meta/ad-accounts/:id
router.put(
  '/ad-accounts/:id',
  asyncHandler(async (req, res) => {
    const { name, ad_account_id, access_token, canal_venda } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (ad_account_id !== undefined)
      update.ad_account_id = ad_account_id.startsWith('act_')
        ? ad_account_id
        : `act_${ad_account_id}`;
    if (access_token !== undefined) update.access_token = access_token;
    if (canal_venda !== undefined) update.canal_venda = canal_venda;
    if (Object.keys(update).length === 0) {
      return errorResponse(
        res,
        'Nenhum campo para atualizar',
        400,
        'VALIDATION',
      );
    }
    const { data, error } = await supabase
      .from('meta_ad_accounts')
      .update(update)
      .eq('id', req.params.id)
      .select('id, name, ad_account_id, canal_venda')
      .single();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Conta de anúncio atualizada');
  }),
);

// DELETE /api/meta/ad-accounts/:id
router.delete(
  '/ad-accounts/:id',
  asyncHandler(async (req, res) => {
    const { error } = await supabase
      .from('meta_ad_accounts')
      .delete()
      .eq('id', req.params.id);
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, null, 'Conta de anúncio removida');
  }),
);

// POST /api/meta/ads-spend
// Body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", canal?: string }
// Busca todas as contas de anúncio e retorna gasto total com tráfego pago (Meta Ads)
router.post(
  '/ads-spend',
  asyncHandler(async (req, res) => {
    const { startDate, endDate, canal } = req.body;
    if (!startDate || !endDate) {
      return errorResponse(
        res,
        'startDate e endDate são obrigatórios (YYYY-MM-DD)',
        400,
        'VALIDATION',
      );
    }

    let accountsQuery = supabase
      .from('meta_ad_accounts')
      .select('id, name, ad_account_id, canal_venda, access_token')
      .order('name');
    if (canal) accountsQuery = accountsQuery.eq('canal_venda', canal);

    const { data: accounts, error: accErr } = await accountsQuery;
    if (accErr) {
      logger.error(
        `[ads-spend] Erro ao buscar contas de anúncio: ${accErr.message}`,
      );
      return errorResponse(res, accErr.message, 500, 'DB_ERROR');
    }
    if (!accounts || accounts.length === 0) {
      logger.warn(
        '[ads-spend] Nenhuma conta de anúncio cadastrada no Supabase.',
      );
      return successResponse(
        res,
        { accounts: [], totals: { spend: 0, impressions: 0, clicks: 0 } },
        'Nenhuma conta de anúncio cadastrada',
      );
    }

    const allResults = [];

    for (const acc of accounts) {
      const timeRange = encodeURIComponent(
        JSON.stringify({ since: startDate, until: endDate }),
      );
      const fields = 'spend,impressions,clicks,reach';
      const url = `${META_GRAPH_BASE}/${acc.ad_account_id}/insights?fields=${fields}&time_range=${timeRange}&level=account`;

      try {
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${acc.access_token}` },
        });
        const json = await resp.json();

        if (!resp.ok || json.error) {
          logger.error(
            `[ads-spend] Erro na conta ${acc.ad_account_id} (${acc.name}): ${json.error?.message || `HTTP ${resp.status}`}`,
          );
          allResults.push({
            accountId: acc.id,
            name: acc.name,
            ad_account_id: acc.ad_account_id,
            canal_venda: acc.canal_venda || null,
            error: json.error?.message || `HTTP ${resp.status}`,
            spend: 0,
            impressions: 0,
            clicks: 0,
          });
          continue;
        }

        const dataArr = json.data || [];
        const spend = dataArr.reduce((s, d) => s + parseFloat(d.spend || 0), 0);
        const impressions = dataArr.reduce(
          (s, d) => s + parseInt(d.impressions || 0, 10),
          0,
        );
        const clicks = dataArr.reduce(
          (s, d) => s + parseInt(d.clicks || 0, 10),
          0,
        );
        // Pega a moeda da primeira linha (todas devem ser iguais para a conta)
        const currency = dataArr[0]?.account_currency || 'BRL';

        allResults.push({
          accountId: acc.id,
          name: acc.name,
          ad_account_id: acc.ad_account_id,
          canal_venda: acc.canal_venda || null,
          spend,
          impressions,
          clicks,
          currency,
        });
      } catch (err) {
        logger.error(
          `[ads-spend] Erro inesperado na conta ${acc.ad_account_id} (${acc.name}): ${err.message}`,
        );
        allResults.push({
          accountId: acc.id,
          name: acc.name,
          ad_account_id: acc.ad_account_id,
          canal_venda: acc.canal_venda || null,
          error: err.message,
          spend: 0,
          impressions: 0,
          clicks: 0,
        });
      }
    }

    const totalSpend = allResults.reduce((s, r) => s + (r.spend || 0), 0);
    const totalImpressions = allResults.reduce(
      (s, r) => s + (r.impressions || 0),
      0,
    );
    const totalClicks = allResults.reduce((s, r) => s + (r.clicks || 0), 0);
    // Usa a moeda da primeira conta (assumindo todas iguais)
    const totalsCurrency = allResults[0]?.currency || 'BRL';

    // ─── Agregação por canal_venda ───────────────────────────────────────
    const byCanal = {};
    for (const acc of allResults) {
      const c = (acc.canal_venda || 'sem_canal').toLowerCase();
      if (!byCanal[c]) {
        byCanal[c] = {
          canal: c,
          spend: 0,
          impressions: 0,
          clicks: 0,
          accounts_count: 0,
          accounts: [],
        };
      }
      byCanal[c].accounts_count++;
      byCanal[c].spend += acc.spend || 0;
      byCanal[c].impressions += acc.impressions || 0;
      byCanal[c].clicks += acc.clicks || 0;
      byCanal[c].accounts.push(acc.name);
    }

    successResponse(res, {
      startDate,
      endDate,
      accounts: allResults,
      by_canal: byCanal,
      totals: {
        spend: totalSpend,
        impressions: totalImpressions,
        clicks: totalClicks,
        currency: totalsCurrency,
      },
    });
  }),
);

// =============================================
// CUSTOS DE CONVERSAS  –  conversation_analytics por número
// =============================================

// POST /api/meta/conversation-costs
// Body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", canal?: string }
//
// Busca custos de conversa/mensagens via Graph API v22 + pricing_analytics.
// IMPORTANTE: o antigo /phone_id/conversation_analytics foi descontinuado.
// O endpoint atual é /waba_id/pricing_analytics e retorna data_points com
// volume + cost (em USD) por country/pricing_category/pricing_type.
// Como uma WABA pode ter múltiplos phone_ids, dedupamos por WABA pra não
// contar custo duplicado.
const GRAPH_API_VERSION = 'v22.0';
const COTACAO_DOLAR_FALLBACK = 5.8;

router.post(
  '/conversation-costs',
  asyncHandler(async (req, res) => {
    const { startDate, endDate, canal } = req.body;
    if (!startDate || !endDate) {
      return errorResponse(
        res,
        'startDate e endDate são obrigatórios (YYYY-MM-DD)',
        400,
        'VALIDATION',
      );
    }

    // Janela em BRT (America/Sao_Paulo, UTC-3) pra bater com o range do TOTVS
    const start = Math.floor(
      new Date(`${startDate}T00:00:00-03:00`).getTime() / 1000,
    );
    const end = Math.floor(
      new Date(`${endDate}T23:59:59-03:00`).getTime() / 1000,
    );

    let accountsQuery = supabase
      .from('whatsapp_accounts')
      .select('id, name, waba_id, phone_id, nr_telefone, access_token, canal_venda')
      .order('name');

    // Filtro opcional por canal
    if (canal && typeof canal === 'string') {
      accountsQuery = accountsQuery.eq('canal_venda', canal);
    }

    const { data: accounts, error: accErr } = await accountsQuery;

    if (accErr) return errorResponse(res, accErr.message, 500, 'DB_ERROR');
    if (!accounts || accounts.length === 0) {
      return successResponse(
        res,
        { accounts: [], wabas: [], by_canal: {}, totals: { conversations: 0, cost: 0, costBRL: 0 } },
        canal ? `Nenhuma conta para canal=${canal}` : 'Nenhuma conta encontrada',
      );
    }

    // Dedupe por (access_token, waba_id) — uma chamada por WABA, não por phone
    const wabaMap = new Map();
    for (const acc of accounts) {
      if (!acc.access_token || !acc.waba_id) continue;
      const key = `${acc.access_token}|${acc.waba_id}`;
      if (!wabaMap.has(key)) {
        wabaMap.set(key, {
          token: acc.access_token,
          waba_id: acc.waba_id,
          accounts: [],
        });
      }
      wabaMap.get(key).accounts.push(acc);
    }

    const dimensions = encodeURIComponent(
      JSON.stringify(['COUNTRY', 'PRICING_CATEGORY', 'PRICING_TYPE']),
    );
    const pricingTypes = encodeURIComponent(
      JSON.stringify(['REGULAR', 'FREE_CUSTOMER_SERVICE', 'FREE_ENTRY_POINT']),
    );

    // Chama Graph API em paralelo para cada WABA única
    const promises = [...wabaMap.values()].map(async (group) => {
      const url =
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${group.waba_id}` +
        `/pricing_analytics?start=${start}&end=${end}&granularity=DAILY` +
        `&pricing_types=${pricingTypes}&dimensions=${dimensions}`;
      try {
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${group.token}` },
        });
        const body = await resp.json();
        if (body.error) {
          return { group, error: body.error.message, data_points: [] };
        }
        // pricing_analytics retorna data: [{ data_points: [...] }] OU data: [...]
        // Normalizamos pra um array de data_points
        let dp = [];
        if (Array.isArray(body?.data)) {
          if (body.data[0]?.data_points) {
            dp = body.data.flatMap((d) => d.data_points || []);
          } else {
            dp = body.data;
          }
        }
        return { group, data_points: dp };
      } catch (err) {
        return { group, error: err.message, data_points: [] };
      }
    });

    const wabaResults = await Promise.all(promises);

    // Agrega por WABA
    const wabas = [];
    const accountsOut = [];

    for (const { group, error, data_points } of wabaResults) {
      let totalCost = 0;
      let totalVolume = 0;
      const byPricingCategory = {};
      const byPricingType = {};

      for (const p of data_points) {
        const cost = Number(p.cost || 0);
        const vol = Number(p.volume || 0);
        totalCost += cost;
        totalVolume += vol;
        const cat = String(p.pricing_category || 'UNKNOWN').toUpperCase();
        const typ = String(p.pricing_type || 'UNKNOWN').toUpperCase();
        if (!byPricingCategory[cat]) byPricingCategory[cat] = { cost: 0, volume: 0 };
        byPricingCategory[cat].cost += cost;
        byPricingCategory[cat].volume += vol;
        if (!byPricingType[typ]) byPricingType[typ] = { cost: 0, volume: 0 };
        byPricingType[typ].cost += cost;
        byPricingType[typ].volume += vol;
      }

      const firstAcc = group.accounts[0];
      wabas.push({
        waba_id: group.waba_id,
        name: firstAcc?.name || group.waba_id,
        phone_ids: group.accounts.map((a) => a.phone_id),
        phones: group.accounts.map((a) => a.nr_telefone).filter(Boolean),
        totalCost,
        totalVolume,
        totalCostBRL: totalCost * COTACAO_DOLAR_FALLBACK,
        byPricingCategory,
        byPricingType,
        error: error || null,
        data_points,
      });

      // Distribui (replicado) por conta — para compatibilidade com frontend antigo
      for (const acc of group.accounts) {
        accountsOut.push({
          accountId: acc.id,
          name: acc.name,
          phone_id: acc.phone_id,
          waba_id: acc.waba_id,
          nr_telefone: acc.nr_telefone,
          canal_venda: acc.canal_venda || null,
          // ATENÇÃO: estes valores são do WABA inteiro, não do phone individual
          // (Meta não disponibiliza mais granularidade por phone em pricing_analytics)
          totalConversations: totalVolume, // alias legado
          totalVolume,
          totalCost,
          totalCostBRL: totalCost * COTACAO_DOLAR_FALLBACK,
          byCategory: byPricingCategory, // alias legado
          byPricingCategory,
          byPricingType,
          error: error || null,
          // _shared_with_waba: indica quantas linhas compartilham essa WABA
          _shared_with_waba: group.accounts.length,
        });
      }
    }

    // ─── Agregação por canal_venda ───────────────────────────────────────
    // Soma custos de WABAs únicas por canal. Se múltiplas contas no mesmo
    // canal compartilharem WABA, conta apenas uma vez (dedupe por waba_id).
    const byCanal = {};
    const seenWabaInCanal = new Map(); // canal → Set<waba_id>
    for (const acc of accountsOut) {
      const c = acc.canal_venda || 'sem_canal';
      if (!byCanal[c]) {
        byCanal[c] = {
          canal: c,
          cost: 0,
          costBRL: 0,
          volume: 0,
          wabas: [],
          accounts_count: 0,
        };
        seenWabaInCanal.set(c, new Set());
      }
      byCanal[c].accounts_count++;
      // Só conta o cost se ainda não vimos essa WABA neste canal
      if (!seenWabaInCanal.get(c).has(acc.waba_id)) {
        seenWabaInCanal.get(c).add(acc.waba_id);
        byCanal[c].cost += acc.totalCost;
        byCanal[c].costBRL += acc.totalCostBRL;
        byCanal[c].volume += acc.totalVolume;
        byCanal[c].wabas.push(acc.waba_id);
      }
    }

    // Total global — soma apenas wabas únicas (não duplica se houver
    // múltiplos phones na mesma WABA)
    const grandTotalCost = wabas.reduce((s, w) => s + w.totalCost, 0);
    const grandTotalVolume = wabas.reduce((s, w) => s + w.totalVolume, 0);

    return successResponse(res, {
      startDate,
      endDate,
      accounts: accountsOut,
      wabas,
      by_canal: byCanal,
      totals: {
        conversations: grandTotalVolume, // alias legado
        volume: grandTotalVolume,
        cost: grandTotalCost,
        costBRL: grandTotalCost * COTACAO_DOLAR_FALLBACK,
        currency: 'USD',
        cotacao: COTACAO_DOLAR_FALLBACK,
      },
      meta: {
        graph_api_version: GRAPH_API_VERSION,
        endpoint: 'pricing_analytics',
        wabas_consultadas: wabas.length,
        accounts_total: accounts.length,
        canal_filter: canal || null,
      },
    });
  }),
);

// =============================================
// CAMPANHAS DE TRÁFEGO  –  Meta Ads API
// =============================================

/**
 * GET /api/meta/ads/campaigns?adAccountId=act_xxx
 *
 * Lista campanhas de uma conta de anúncio.
 * O access_token é buscado na tabela meta_ad_accounts pelo adAccountId.
 *
 * Query params:
 *   adAccountId  (obrigatório) ex: act_100855593689813
 *   fields       (opcional, default: id,name,status,effective_status,objective)
 */
router.get(
  '/ads/campaigns',
  asyncHandler(async (req, res) => {
    const {
      adAccountId,
      fields = 'id,name,status,effective_status,objective',
    } = req.query;

    if (!adAccountId) {
      return errorResponse(
        res,
        'adAccountId é obrigatório (ex: act_100855593689813)',
        400,
        'MISSING_PARAM',
      );
    }

    // Normaliza: garante prefixo act_
    const normalizedId = adAccountId.startsWith('act_')
      ? adAccountId
      : `act_${adAccountId}`;

    // Busca token no banco
    const { data: acc, error: dbErr } = await supabase
      .from('meta_ad_accounts')
      .select('access_token, name, canal_venda')
      .eq('ad_account_id', normalizedId)
      .maybeSingle();

    if (dbErr) return errorResponse(res, dbErr.message, 500, 'DB_ERROR');
    if (!acc)
      return errorResponse(
        res,
        `Conta ${normalizedId} não encontrada em meta_ad_accounts`,
        404,
        'NOT_FOUND',
      );

    // Busca campanhas na Graph API (paginação automática com limit 500)
    const path = `/${normalizedId}/campaigns?fields=${encodeURIComponent(fields)}&limit=500`;
    const graphData = await graphRequest(path, acc.access_token);

    successResponse(res, {
      adAccountId: normalizedId,
      name: acc.name,
      canal_venda: acc.canal_venda,
      campaigns: graphData.data || [],
      paging: graphData.paging || null,
    });
  }),
);

/**
 * GET /api/meta/ads/campaign-insights?campaignId=xxx
 *
 * Busca insights de uma campanha específica pelo ID.
 * O access_token é buscado na tabela meta_ad_accounts via adAccountId.
 *
 * Query params:
 *   campaignId   (obrigatório) ex: 6968664906191
 *   adAccountId  (obrigatório) ex: act_100855593689813  — usado para buscar o token no DB
 *   datePreset   (opcional, default: yesterday)  ex: last_7d, last_30d, this_month
 *   startDate    (opcional) ex: 2025-04-01   — se informado junto com endDate, ignora datePreset
 *   endDate      (opcional) ex: 2025-04-26
 *   fields       (opcional, default: impressions,clicks,spend,campaign_id,campaign_name,date_start,date_stop,results)
 */
router.get(
  '/ads/campaign-insights',
  asyncHandler(async (req, res) => {
    const {
      campaignId,
      adAccountId,
      datePreset = 'yesterday',
      startDate,
      endDate,
      fields = 'impressions,clicks,spend,campaign_id,campaign_name,date_start,date_stop,results',
    } = req.query;

    if (!campaignId)
      return errorResponse(
        res,
        'campaignId é obrigatório',
        400,
        'MISSING_PARAM',
      );
    if (!adAccountId)
      return errorResponse(
        res,
        'adAccountId é obrigatório',
        400,
        'MISSING_PARAM',
      );

    const normalizedId = adAccountId.startsWith('act_')
      ? adAccountId
      : `act_${adAccountId}`;

    // Busca token no banco
    const { data: acc, error: dbErr } = await supabase
      .from('meta_ad_accounts')
      .select('access_token, name, canal_venda')
      .eq('ad_account_id', normalizedId)
      .maybeSingle();

    if (dbErr) return errorResponse(res, dbErr.message, 500, 'DB_ERROR');
    if (!acc)
      return errorResponse(
        res,
        `Conta ${normalizedId} não encontrada em meta_ad_accounts`,
        404,
        'NOT_FOUND',
      );

    // Monta parâmetros de data
    let timePart;
    if (startDate && endDate) {
      timePart = `time_range=${encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }))}`;
    } else {
      timePart = `date_preset=${encodeURIComponent(datePreset)}`;
    }

    const path = `/${campaignId}/insights?${timePart}&time_increment=1&fields=${encodeURIComponent(fields)}`;
    const graphData = await graphRequest(path, acc.access_token);

    const insights = graphData.data || [];

    // Totais agregados do período
    const totals = insights.reduce(
      (acc, row) => {
        acc.impressions += Number(row.impressions || 0);
        acc.clicks += Number(row.clicks || 0);
        acc.spend += parseFloat(row.spend || 0);
        return acc;
      },
      { impressions: 0, clicks: 0, spend: 0 },
    );

    successResponse(res, {
      campaignId,
      adAccountId: normalizedId,
      canal_venda: acc.canal_venda,
      insights,
      totals,
      paging: graphData.paging || null,
    });
  }),
);

export default router;
