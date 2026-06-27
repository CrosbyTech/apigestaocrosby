import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import supabase from '../config/supabase.js';
import supabaseFiscal from '../config/supabaseFiscal.js';
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
  getBranchCodes,
} from '../totvsrouter/totvsHelper.js';
import axios from 'axios';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

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
// Helper: busca contatos INATIVOS via Supabase
// =============================================
// "Inativo" = comprou em [dataInicio, dataFim] mas NÃO comprou após dataFim.
// Roda 100% no Supabase (notas_fiscais + pes_pessoa) — sem TOTVS, sub-segundo.
async function fetchContatosInativosSupabase({ dataInicio, dataFim, operacao, branchHint }) {
  const t0 = Date.now();

  // 1) Monta filtros de operação/filial (mesma lógica do path TOTVS)
  const opCodesRaw = operacao?.codigos_operacao || operacao?.cd_operacao;
  let operationCodes = [];
  if (opCodesRaw) {
    const codes = Array.isArray(opCodesRaw)
      ? opCodesRaw
      : String(opCodesRaw).split(',').map((s) => s.trim()).filter(Boolean);
    operationCodes = codes.map((c) => Number(c)).filter((n) => Number.isFinite(n));
  }

  const buildBaseQuery = (start, end) => {
    let q = supabaseFiscal
      .from('notas_fiscais')
      .select('person_code, total_value, issue_date', { count: 'exact' })
      .eq('operation_type', 'Output')
      .not('invoice_status', 'in', '(Canceled,Deleted)')
      .gte('issue_date', start)
      .lte('issue_date', end)
      .not('person_code', 'is', null);
    if (operationCodes.length > 0) {
      q = q.in('operation_code', operationCodes);
    } else if (branchHint) {
      // Sem operationCodes: filtra branch_code por canal
      if (branchHint.isRevenda || branchHint.isVarejo) {
        q = q.lte('branch_code', 5999);
      } else if (branchHint.isMultimarcas) {
        q = q.gte('branch_code', 6000);
      }
    }
    return q;
  };

  // 2) Paginação: pega TODAS as NFs em [dataInicio, dataFim]
  async function fetchAllNFs(start, end) {
    const all = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await buildBaseQuery(start, end)
        .order('issue_date', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`Supabase NF: ${error.message}`);
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
      if (from > 200000) break; // safety: 200k NFs max
    }
    return all;
  }

  // 3) Compradores no período do filtro
  const nfsPeriodo = await fetchAllNFs(dataInicio, dataFim);
  const periodoStats = new Map(); // person_code -> { totalValue, count, lastDate }
  for (const nf of nfsPeriodo) {
    const pc = Number(nf.person_code);
    if (!Number.isFinite(pc)) continue;
    const cur = periodoStats.get(pc) || { totalValue: 0, count: 0, lastDate: nf.issue_date };
    cur.totalValue += Number(nf.total_value || 0);
    cur.count++;
    if (nf.issue_date > cur.lastDate) cur.lastDate = nf.issue_date;
    periodoStats.set(pc, cur);
  }

  // 4) Compradores ATIVOS (compraram depois de dataFim) — excluir
  const hoje = new Date().toISOString().slice(0, 10);
  const dataAposFim = new Date(`${dataFim}T00:00:00Z`);
  dataAposFim.setUTCDate(dataAposFim.getUTCDate() + 1);
  const startAtivos = dataAposFim.toISOString().slice(0, 10);
  const nfsAtivos = await fetchAllNFs(startAtivos, hoje);
  const ativos = new Set(nfsAtivos.map((n) => Number(n.person_code)));

  const inativosCodes = [];
  for (const pc of periodoStats.keys()) {
    if (!ativos.has(pc)) inativosCodes.push(pc);
  }
  console.log(
    `[inativos] periodo=${periodoStats.size} | ativos_excluidos=${periodoStats.size - inativosCodes.length} | inativos=${inativosCodes.length} | ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  if (inativosCodes.length === 0) {
    return { contacts: [], ticketMedio: 0 };
  }

  // 5) Busca telefones em pes_pessoa (chunks de 500 pra cabe na URL)
  const CHUNK = 500;
  const pessoas = [];
  for (let i = 0; i < inativosCodes.length; i += CHUNK) {
    const slice = inativosCodes.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('pes_pessoa')
      .select('code, cpf, nm_pessoa, phones')
      .in('code', slice);
    if (error) {
      console.warn(`[inativos] pes_pessoa chunk ${i}: ${error.message}`);
      continue;
    }
    pessoas.push(...(data || []));
  }
  const pessoasMap = new Map(pessoas.map((p) => [Number(p.code), p]));

  // 6) Monta contacts (só quem tem telefone válido)
  const contacts = [];
  let totalValueAll = 0;
  for (const pc of inativosCodes) {
    const p = pessoasMap.get(pc);
    if (!p) continue;
    const phones = Array.isArray(p.phones) ? p.phones : [];
    // Prioriza: WHATSAPP > default > celular (11 dígitos) > qualquer
    let phone = '';
    const candidates = [...phones].sort((a, b) => {
      const score = (x) => {
        let s = 0;
        if (x.typeName?.toUpperCase() === 'WHATSAPP') s += 100;
        if (x.isDefault) s += 50;
        const n = String(x.number || '').replace(/\D/g, '');
        if (n.length === 11) s += 20; // celular
        return s;
      };
      return score(b) - score(a);
    });
    for (const ph of candidates) {
      const raw = String(ph.number || '').replace(/\D/g, '');
      if (raw.length >= 10) {
        phone = raw.startsWith('55') ? raw : `55${raw}`;
        break;
      }
    }
    if (!phone) continue;
    const stats = periodoStats.get(pc);
    totalValueAll += stats.totalValue;
    contacts.push({
      cd_pessoa: pc,
      name: p.nm_pessoa || '',
      cpf_cnpj: p.cpf || '',
      nr_telefone: phone,
      totalValue: stats.totalValue,
      invoiceCount: stats.count,
      ultimaCompra: stats.lastDate,
    });
  }
  const ticketMedio = contacts.length > 0 ? totalValueAll / contacts.length : 0;
  console.log(
    `[inativos] contatos_com_telefone=${contacts.length}/${inativosCodes.length} | ticketMedio=${ticketMedio.toFixed(2)} | ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  return { contacts, ticketMedio };
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

// =====================================================================
// WEBHOOK META — recebe eventos de delivery/read/failed do WhatsApp
// =====================================================================
// GET /api/meta/webhook — verificação inicial (Meta envia hub.challenge)
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && token && token === expected) {
    console.log('✅ [meta-webhook] verificação OK');
    return res.status(200).send(challenge);
  }
  console.warn(`❌ [meta-webhook] verificação falhou (token=${token?.slice(0, 10)}...)`);
  return res.sendStatus(403);
});

// POST /api/meta/webhook — recebe eventos
router.post('/webhook', asyncHandler(async (req, res) => {
  // Sempre responde 200 rapidamente (Meta exige <20s)
  res.status(200).send('OK');

  try {
    const body = req.body;
    if (body?.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const statuses = value.statuses || [];
        const messages = value.messages || []; // respostas do usuário

        // STATUSES (delivered/read/failed)
        for (const st of statuses) {
          const metaId = st.id;       // wamid.xxx
          const status = st.status;   // 'delivered' | 'read' | 'failed'
          const recipient = st.recipient_id;
          if (!metaId) continue;

          // Atualiza message_queue (busca por meta_message_id se gravado, senão por phone+template recente)
          const novoStatus = ['delivered', 'read', 'failed'].includes(status) ? status : null;
          if (!novoStatus) continue;

          // message_queue usa o id da mensagem se tivermos gravado — caso contrário busca por phone
          const updateMq = await supabase
            .from('message_queue')
            .update({
              status: novoStatus,
              ...(status === 'failed' && st.errors?.[0]?.message
                ? { last_error: st.errors[0].message?.slice(0, 500) }
                : {}),
            })
            .eq('meta_message_id', metaId);

          // template_disparos
          await supabase
            .from('template_disparos')
            .update({
              status: novoStatus,
              ...(status === 'failed' && st.errors?.[0]?.message
                ? { error_message: st.errors[0].message?.slice(0, 500) }
                : {}),
            })
            .eq('meta_message_id', metaId);
        }

        // RESPOSTAS (mensagens recebidas) — marca template_disparos como 'replied'
        for (const msg of messages) {
          const from = msg.from; // telefone do remetente (cliente)
          if (!from) continue;
          // Pega disparo mais recente pra esse telefone
          const { data: ultimos } = await supabase
            .from('template_disparos')
            .select('id')
            .eq('phone_number', from)
            .in('status', ['sent', 'delivered', 'read'])
            .order('sent_at', { ascending: false })
            .limit(1);
          if (ultimos?.[0]) {
            await supabase
              .from('template_disparos')
              .update({ status: 'replied' })
              .eq('id', ultimos[0].id);
            // E na message_queue tbm
            await supabase
              .from('message_queue')
              .update({ status: 'replied' })
              .eq('phone_number', from)
              .in('status', ['sent', 'delivered', 'read'])
              .order('sent_at', { ascending: false })
              .limit(1);
          }
        }
      }
    }
  } catch (e) {
    console.warn(`[meta-webhook] erro processando: ${e.message}`);
  }
}));

// =====================================================================
// POST /api/meta/upload-template-media/:accountId
// Faz upload de mídia (imagem/vídeo) para uso em template (carrossel/header)
// via Resumable Upload da Meta. Retorna { handle } pra embutir no template.
//
// Multipart form: file=<arquivo>
// Resposta: { handle: 'h:...', mimeType, fileLength }
// Requer: account.app_id configurado em whatsapp_accounts
// =====================================================================
router.post(
  '/upload-template-media/:accountId',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return errorResponse(res, 'Arquivo obrigatório (campo "file")', 400);
    const { data: account, error: accErr } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', req.params.accountId)
      .single();
    if (accErr || !account) return errorResponse(res, 'Conta não encontrada', 404);
    if (!account.app_id) {
      return errorResponse(
        res,
        'Account sem app_id configurado. Adicione na tabela whatsapp_accounts.',
        400,
        'MISSING_APP_ID',
      );
    }

    const mimeType = req.file.mimetype;
    const fileLength = req.file.size;
    const fileName = req.file.originalname || `upload-${Date.now()}`;

    try {
      // 1) Cria sessão de upload
      const startUrl = `${META_GRAPH_BASE}/${account.app_id}/uploads?file_name=${encodeURIComponent(fileName)}&file_length=${fileLength}&file_type=${encodeURIComponent(mimeType)}&access_token=${encodeURIComponent(account.access_token)}`;
      const startRes = await fetch(startUrl, { method: 'POST' });
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok || !startData?.id) {
        return errorResponse(res, startData?.error?.message || 'Falha ao criar sessão de upload', 500, 'UPLOAD_SESSION_FAIL');
      }
      const uploadId = startData.id; // formato "upload:XXX"

      // 2) Envia bytes do arquivo
      const uploadUrl = `${META_GRAPH_BASE}/${uploadId}`;
      const upRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${account.access_token}`,
          file_offset: '0',
        },
        body: req.file.buffer,
      });
      const upData = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !upData?.h) {
        return errorResponse(
          res,
          upData?.error?.message || 'Falha ao fazer upload do arquivo',
          500,
          'UPLOAD_FAIL',
        );
      }

      return successResponse(res, {
        handle: upData.h,
        mimeType,
        fileLength,
        fileName,
      }, 'Upload concluído');
    } catch (err) {
      logger.error(`upload-template-media erro: ${err.message}`);
      return errorResponse(res, err.message, 500, 'UPLOAD_ERROR');
    }
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
    const { operacao, data_inicio, data_fim, empresas, modo } = req.body;

    if (!operacao || !data_inicio || !data_fim) {
      return errorResponse(
        res,
        'operacao, data_inicio e data_fim são obrigatórios',
        400,
        'VALIDATION',
      );
    }

    const opName = (operacao.nome || '').toLowerCase();
    const isRevenda = opName.includes('revenda');
    const isMultimarcas = opName.includes('multimarc');
    const isVarejo = opName.includes('varejo');

    // ===== MODO INATIVOS: roda no Supabase (sem TOTVS) =====
    // Cliente "inativo" = comprou em [data_inicio, data_fim] mas NÃO comprou
    // entre data_fim e hoje. Janela típica do front: -365d até -61d.
    if (modo === 'inativos') {
      try {
        const result = await fetchContatosInativosSupabase({
          dataInicio: data_inicio,
          dataFim: data_fim,
          operacao,
          branchHint: { isRevenda, isMultimarcas, isVarejo },
        });
        return successResponse(
          res,
          { data: result.contacts, ticketMedio: result.ticketMedio },
          `${result.contacts.length} contatos inativos`,
        );
      } catch (e) {
        logger.error(`[totvs-contacts inativos] ${e.message}`);
        return errorResponse(res, `Inativos: ${e.message}`, 500, 'INATIVOS_ERROR');
      }
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
    let branchCodes = (empresas || []).map(Number).filter(Number.isFinite);

    // Fallback: se nenhuma filial veio do front, busca lista do TOTVS e filtra
    // por canal (revenda/varejo: filiais próprias ≤5999, multimarcas: ≥6000).
    if (branchCodes.length === 0) {
      try {
        const all = await getBranchCodes(token);
        if (isRevenda || isVarejo) {
          branchCodes = all.filter((c) => c <= 5999);
        } else if (isMultimarcas) {
          branchCodes = all.filter((c) => c >= 6000);
        } else {
          branchCodes = all;
        }
        console.log(`[totvs-contacts] branches auto-populadas: ${branchCodes.length}`);
      } catch (e) {
        console.warn(`[totvs-contacts] getBranchCodes falhou: ${e.message}`);
      }
    }

    // Montar filtro de invoices com base na operação
    // TOTVS exige datetime YYYY-MM-DDTHH:mm:ss e operationType
    const filter = {
      branchCodeList: branchCodes,
      startIssueDate: `${data_inicio}T00:00:00`,
      endIssueDate: `${data_fim}T23:59:59`,
      operationType: 'Output',
    };

    // Se a operação tem código(s) de operação TOTVS, filtrar por eles.
    // Campo real é `codigos_operacao` (CSV string), aceita também cd_operacao por compatibilidade.
    const opCodesRaw = operacao.codigos_operacao || operacao.cd_operacao;
    if (opCodesRaw) {
      const codes = Array.isArray(opCodesRaw)
        ? opCodesRaw
        : String(opCodesRaw).split(',').map((s) => s.trim()).filter(Boolean);
      const codesNum = codes.map((c) => Number(c)).filter((n) => Number.isFinite(n));
      if (codesNum.length > 0) filter.operationCodeList = codesNum;
    }

    const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
    console.log(`[totvs-contacts] op="${operacao.nome}" branches=${branchCodes.length} ops=${filter.operationCodeList?.length || 0} period=${data_inicio}~${data_fim}`);

    // TOTVS limita range a 6 meses — divide em chunks de 5 meses pra ter folga
    const chunks = [];
    const dStart = new Date(`${data_inicio}T00:00:00`);
    const dEnd = new Date(`${data_fim}T23:59:59`);
    const MAX_DAYS = 150; // 5 meses
    let cur = new Date(dStart);
    while (cur < dEnd) {
      const chunkEnd = new Date(Math.min(
        cur.getTime() + MAX_DAYS * 86400000,
        dEnd.getTime(),
      ));
      chunks.push({
        start: cur.toISOString().slice(0, 19),
        end: chunkEnd.toISOString().slice(0, 19),
      });
      cur = new Date(chunkEnd.getTime() + 1000); // +1s pra evitar overlap
    }
    if (chunks.length > 1) {
      console.log(`[totvs-contacts] range dividido em ${chunks.length} chunks de até ${MAX_DAYS}d`);
    }

    const allInvoices = [];

    for (const chunk of chunks) {
      const chunkFilter = {
        ...filter,
        startIssueDate: chunk.start,
        endIssueDate: chunk.end,
      };
      let page = 1;
      let hasNext = true;
      while (hasNext && page <= 50) {
      const payload = { filter: chunkFilter, page, pageSize: 100, expand: 'person', order: 'issueDate:desc' };
      if (page === 1) {
        console.log(`[totvs-contacts] chunk ${chunk.start.slice(0,10)}~${chunk.end.slice(0,10)} pág 1`);
      }
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
        if (page === 1) {
          console.log(`[totvs-contacts] página 1 retornou ${items.length} invoices · hasNext=${hasNext}`);
        }
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
          const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : '';
          logger.error(
            `Erro ao buscar invoices TOTVS page ${page}: ${err.message} | detail=${detail}`,
          );
          break;
        }
      }
      } // end while pages
    } // end for chunk

    // Extrair contatos únicos (deduplicar por personCode)
    const contactsMap = {};
    let totalValue = 0;

    if (allInvoices.length > 0) {
      const sample = allInvoices[0];
      console.log(`[totvs-contacts] sample invoice keys:`, Object.keys(sample).slice(0, 20).join(','));
      console.log(`[totvs-contacts] person keys:`, sample.person ? Object.keys(sample.person).slice(0, 15).join(',') : 'no person');
      console.log(`[totvs-contacts] sample IDs: personCode=${sample.personCode} person.personCode=${sample.person?.personCode} customerCode=${sample.customerCode}`);
    }

    for (const inv of allInvoices) {
      const personCode = inv.personCode || inv.person?.personCode || inv.person?.code || inv.customerCode;
      if (!personCode) continue;

      const value = Number(inv.totalValue || inv.invoiceValue || 0);
      totalValue += value;

      if (contactsMap[personCode]) {
        contactsMap[personCode].totalValue += value;
        contactsMap[personCode].invoiceCount++;
        continue;
      }

      // Extrair telefone dos dados de person
      // TOTVS pode retornar como: person.foneNumber (string direta) ou person.phones[] (array)
      const person = inv.person || {};
      let phone = '';
      const phones = person.phones || [];
      if (phones.length > 0) {
        // Formato com array — priorizar celular
        for (const p of phones) {
          const num = (p.number || p.phoneNumber || '').replace(/\D/g, '');
          if (num.length >= 10) {
            phone = num.startsWith('55') ? num : `55${num}`;
            if (
              p.typeDescription?.toLowerCase().includes('celular') ||
              num.length === 11 ||
              (num.length === 13 && num.startsWith('55'))
            ) break;
          }
        }
      } else {
        // Formato com campo direto foneNumber (PJ fiscal)
        const raw = (person.foneNumber || person.phone || '').replace(/\D/g, '');
        if (raw.length >= 10) {
          phone = raw.startsWith('55') ? raw : `55${raw}`;
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
        // Array de objetos (TOTVS contacts) — preserva person_code pra tracking
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
              person_code: c.cd_pessoa || c.person_code || c.personCode || null,
              cpf_cnpj: c.cpf_cnpj || c.cpfCnpj || null,
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

    // Deduplica contatos por telefone (mesmo número pode aparecer pra 2+ pessoas)
    const phonesVistos = new Set();
    const contactsUnicos = contacts.filter((c) => {
      if (phonesVistos.has(c.phone)) return false;
      phonesVistos.add(c.phone);
      return true;
    });

    // Helper: primeiro nome capitalizado, fallback "Você" — pra preencher {{1}}
    // automaticamente caso o template tenha variável e o front não tenha passado.
    const primeiroNome = (full) => {
      const s = String(full || '').trim();
      if (!s) return 'Você';
      const first = s.split(/\s+/)[0];
      if (!first || first.length < 2) return 'Você';
      return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    };

    // Enfileirar na message_queue. Persiste contact_external_id (= person_code
    // do TOTVS) pra cruzar venda depois. Se variables vier vazio, popula {{1}}
    // com o primeiro nome do contato (evita erro 132000 "missing parameter"
    // pra templates com variável de nome).
    const rows = contactsUnicos.map((c) => {
      const vars = c.variables && Object.keys(c.variables).length > 0
        ? c.variables
        : { '1': primeiroNome(c.name) };
      return {
        account_id: account.id,
        campaign_id: campaignId,
        campaign_name: campaignName,
        phone_number: c.phone,
        contact_name: c.name || null,
        contact_external_id: c.person_code ? String(c.person_code) : null,
        template_name: template_name,
        template_language: language || 'pt_BR',
        template_category: 'MARKETING',
        template_variables: vars,
        status: 'pending',
        priority: 100,
        scheduled_at: new Date().toISOString(),
        dedupe_key: `${campaignId}:${c.phone}`,
      };
    });

    // Inserir em lotes de 500. Dedupe já garantida em contactsUnicos (Set por phone),
    // então INSERT simples não vai colidir dentro da mesma campanha (campaign_id novo).
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

    // Salva registros em template_disparos pra cruzamento com vendas (pós-disparo)
    const disparosRows = contactsUnicos.map((c) => ({
      campaign_id: campaignId,
      campaign_name: campaignName,
      template_name,
      template_language: language || 'pt_BR',
      template_category: 'MARKETING',
      account_id: account.id,
      waba_id: account.waba_id || null,
      person_code: c.person_code ? Number(c.person_code) : null,
      phone_number: c.phone,
      contact_name: c.name || null,
      cpf_cnpj: c.cpf_cnpj || null,
      origem: origem || 'manual',
      template_variables: c.variables || {},
      status: 'queued',
      scheduled_at: new Date().toISOString(),
    }));
    try {
      for (let i = 0; i < disparosRows.length; i += batchSize) {
        const batch = disparosRows.slice(i, i + batchSize);
        const { error } = await supabase.from('template_disparos').insert(batch);
        if (error) {
          logger.warn(`[template_disparos] insert: ${error.message}`);
          break;
        }
      }
    } catch (e) {
      logger.warn(`[template_disparos] erro: ${e.message}`);
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

// POST /api/meta/campaigns/:campaignId/resume
//   Retoma campanha presa: reseta status="processing" pra "pending" + reinicia worker
router.post(
  '/campaigns/:campaignId/resume',
  asyncHandler(async (req, res) => {
    const { campaignId } = req.params;
    // Pega conta da campanha
    const { data: anyMsg } = await supabase
      .from('message_queue')
      .select('account_id')
      .eq('campaign_id', campaignId)
      .limit(1)
      .single();
    if (!anyMsg) return errorResponse(res, 'Campanha não encontrada', 404);
    const { data: account } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', anyMsg.account_id)
      .single();
    if (!account) return errorResponse(res, 'Conta não encontrada', 404);

    // Reseta processing → pending
    const { count: resetCount } = await supabase
      .from('message_queue')
      .update({ status: 'pending' }, { count: 'exact' })
      .eq('campaign_id', campaignId)
      .in('status', ['processing', 'retrying']);

    // Conta pendentes
    const { count: pending } = await supabase
      .from('message_queue')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'pending');

    // Reinicia worker em background
    processCampaignQueue(campaignId, account).catch((err) =>
      logger.error(`[campaign-resume] worker erro: ${err.message}`),
    );

    return successResponse(res, {
      campaignId,
      reset: resetCount,
      pending,
    }, `${resetCount} resetadas pra pending. ${pending} aguardando envio.`);
  }),
);

// GET /api/meta/campaigns/:campaignId/status
router.get(
  '/campaigns/:campaignId/status',
  asyncHandler(async (req, res) => {
    const { campaignId } = req.params;
    const { data, error } = await supabase
      .from('message_queue')
      .select('status, last_error')
      .eq('campaign_id', campaignId);
    if (error) return errorResponse(res, error.message, 500);
    const counts = {};
    const erros = new Set();
    for (const r of data || []) {
      counts[r.status] = (counts[r.status] || 0) + 1;
      if (r.last_error) erros.add(r.last_error.slice(0, 200));
    }
    return successResponse(res, {
      campaignId,
      total: (data || []).length,
      counts,
      erros: [...erros],
    });
  }),
);

// =============================================
// WORKER: Processar fila de mensagens (substitui N8N)
// =============================================
export async function processCampaignQueue(campaignId, account) {
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

    // Cache de metadados de template (header URL) por nome — evita refetch
    if (!processCampaignQueue._tmplMetaCache) processCampaignQueue._tmplMetaCache = new Map();
    const tmplCache = processCampaignQueue._tmplMetaCache;

    // Cache de media_id por URL de imagem (válido por ~30 dias pra Meta)
    if (!processCampaignQueue._mediaCache) processCampaignQueue._mediaCache = new Map();
    const mediaCache = processCampaignQueue._mediaCache;

    // Helper: baixa imagem da URL e faz upload pra /media, retorna media_id
    async function uploadImageToMedia(imageUrl) {
      if (mediaCache.has(imageUrl)) return mediaCache.get(imageUrl);
      try {
        // 1) Baixa a imagem
        const imgResp = await fetch(imageUrl);
        if (!imgResp.ok) throw new Error(`download ${imgResp.status}`);
        const buf = Buffer.from(await imgResp.arrayBuffer());
        const ct = imgResp.headers.get('content-type') || 'image/jpeg';

        // 2) Faz upload pra /media
        // Endpoint Meta: POST /{phone_id}/media com multipart form
        // Usa FormData (Node 18+ tem global)
        const form = new FormData();
        const blob = new Blob([buf], { type: ct });
        form.append('messaging_product', 'whatsapp');
        form.append('type', ct);
        form.append('file', blob, `card.${ct.split('/')[1] || 'jpg'}`);

        const upResp = await fetch(`https://graph.facebook.com/v22.0/${account.phone_id}/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${account.access_token}` },
          body: form,
        });
        const upData = await upResp.json();
        if (!upResp.ok || !upData?.id) {
          throw new Error(upData?.error?.message || `upload ${upResp.status}`);
        }
        mediaCache.set(imageUrl, upData.id);
        return upData.id;
      } catch (e) {
        console.warn(`[upload-media] falhou: ${e.message}`);
        return null;
      }
    }

    // Helper: pega metadados do template (header + carousel) pra montar payload de envio
    async function getTemplateMeta(tmplName) {
      if (tmplCache.has(tmplName)) return tmplCache.get(tmplName);
      try {
        const result = await graphRequest(
          `/${account.waba_id}/message_templates?name=${encodeURIComponent(tmplName)}&fields=name,components,language&limit=10`,
          account.access_token,
          { method: 'GET' },
        );
        const tmpl = (result?.data || []).find((t) => t.name === tmplName);
        const comps = tmpl?.components || [];
        const header = comps.find((c) => c.type === 'HEADER');
        const carousel = comps.find((c) => c.type === 'CAROUSEL');
        let headerUrl = null;
        if (header?.format === 'IMAGE') {
          headerUrl = header?.example?.header_handle?.[0] || header?.example?.header_url?.[0] || null;
        }
        // Extrai imagens dos cards do carrossel (em ordem)
        const cardImages = [];
        if (carousel?.cards?.length > 0) {
          for (const card of carousel.cards) {
            const cardComps = card.components || [];
            const cardHeader = cardComps.find((c) => c.type === 'HEADER');
            const url = cardHeader?.example?.header_handle?.[0] || cardHeader?.example?.header_url?.[0] || null;
            cardImages.push(url);
          }
        }
        const meta = {
          headerFormat: header?.format || null,
          headerUrl,
          isCarousel: !!carousel,
          cardImages,
        };
        tmplCache.set(tmplName, meta);
        return meta;
      } catch (e) {
        tmplCache.set(tmplName, { headerFormat: null, headerUrl: null, isCarousel: false, cardImages: [] });
        return { headerFormat: null, headerUrl: null, isCarousel: false, cardImages: [] };
      }
    }

    for (const msg of pending) {
      try {
        // Montar componentes de variáveis do template
        const vars = msg.template_variables || {};
        const varKeys = Object.keys(vars).sort();
        const components = [];

        const tmplMeta = await getTemplateMeta(msg.template_name);

        // HEADER (template texto/mídia simples)
        if (!tmplMeta.isCarousel && tmplMeta.headerFormat === 'IMAGE' && tmplMeta.headerUrl) {
          components.push({
            type: 'header',
            parameters: [
              { type: 'image', image: { link: tmplMeta.headerUrl } },
            ],
          });
        }

        if (varKeys.length > 0) {
          components.push({
            type: 'body',
            parameters: varKeys.map((k) => ({
              type: 'text',
              text: vars[k] || '',
            })),
          });
        }

        // CARROSSEL: Meta exige media_id (não aceita link). Upload pra /media e cacheia.
        if (tmplMeta.isCarousel && tmplMeta.cardImages.length > 0) {
          const mediaIds = await Promise.all(
            tmplMeta.cardImages.map((url) => uploadImageToMedia(url)),
          );
          const cardsArr = [];
          for (let idx = 0; idx < mediaIds.length; idx++) {
            const mid = mediaIds[idx];
            if (!mid) {
              throw new Error(`upload card ${idx} falhou`);
            }
            cardsArr.push({
              card_index: idx,
              components: [
                {
                  type: 'header',
                  parameters: [{ type: 'image', image: { id: mid } }],
                },
              ],
            });
          }
          components.push({ type: 'carousel', cards: cardsArr });
        }

        const sendResult = await graphRequest(
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

        const metaMessageId = sendResult?.messages?.[0]?.id || null;
        const nowIso = new Date().toISOString();

        await supabase
          .from('message_queue')
          .update({ status: 'sent', sent_at: nowIso, meta_message_id: metaMessageId })
          .eq('id', msg.id);

        // Atualiza template_disparos com status=sent + meta_message_id (best-effort)
        supabase
          .from('template_disparos')
          .update({ status: 'sent', sent_at: nowIso, meta_message_id: metaMessageId })
          .eq('campaign_id', msg.campaign_id)
          .eq('phone_number', msg.phone_number)
          .then(({ error: upErr }) => {
            if (upErr) logger.warn(`[template_disparos sent] ${upErr.message}`);
          });
      } catch (err) {
        const retries = (msg.attempt_count || 0) + 1;
        const maxAttempts = msg.max_attempts || 3;
        const isFinal = retries >= maxAttempts;
        const { error: updErr } = await supabase
          .from('message_queue')
          .update({
            status: isFinal ? 'failed' : 'retrying',
            attempt_count: retries,
            last_error: String(err.message || err).slice(0, 1000),
          })
          .eq('id', msg.id);
        if (updErr) {
          // Fallback: garante que ao menos não trave em processing — força failed
          console.warn(`[worker] update falha: ${updErr.message} | msg ${msg.id}`);
          await supabase
            .from('message_queue')
            .update({ status: 'failed', last_error: `${err.message} | upd: ${updErr.message}`.slice(0, 1000) })
            .eq('id', msg.id);
        }

        // Em failed definitivo, marca também em template_disparos
        if (isFinal) {
          supabase
            .from('template_disparos')
            .update({ status: 'failed', error_message: String(err.message || err).slice(0, 500) })
            .eq('campaign_id', msg.campaign_id)
            .eq('phone_number', msg.phone_number)
            .then(() => {});
        }
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

// =============================================
// TEMPLATE STATS — cache por template (whatsapp_template_stats)
// =============================================

async function montarStatsDoTemplate({ account, tpl, startUnix, endUnix, periodStart, periodEnd, catPricing }) {
  let metaSent = 0, metaDelivered = 0, metaRead = 0, metaClicked = 0, metaReplied = 0;
  if (tpl.id) {
    const CHUNK_SEC = 20 * 24 * 3600;
    const chunks = [];
    let cursor = startUnix;
    while (cursor < endUnix) {
      const chunkEnd = Math.min(cursor + CHUNK_SEC, endUnix);
      chunks.push([cursor, chunkEnd]);
      cursor = chunkEnd + 1;
    }
    const respostas = await Promise.all(
      chunks.map(async ([chS, chE]) => {
        const url = `/${account.waba_id}?fields=template_analytics.start(${chS}).end(${chE})`
          + `.granularity(DAILY).metric_types(['SENT','DELIVERED','READ','CLICKED','REPLIED'])`
          + `.template_ids(['${tpl.id}'])`;
        try {
          const r = await graphRequest(url, account.access_token);
          return (r?.template_analytics?.data || []).flatMap((d) => d.data_points || []);
        } catch (e) { return []; }
      }),
    );
    for (const pts of respostas) {
      for (const p of pts) {
        metaSent += Number(p.sent || 0);
        metaDelivered += Number(p.delivered || 0);
        metaRead += Number(p.read || 0);
        metaReplied += Number(p.replied || 0);
        if (Array.isArray(p.clicked)) metaClicked += p.clicked.reduce((s, c) => s + Number(c.count || 0), 0);
      }
    }
  }
  const { data: localRows } = await supabase
    .from('message_queue').select('status')
    .eq('account_id', account.waba_id).eq('template_name', tpl.name)
    .gte('scheduled_at', periodStart).lte('scheduled_at', periodEnd);
  let localReplied = 0;
  for (const r of localRows || []) if (r.status === 'replied') localReplied++;
  const category = (tpl.category || '').toUpperCase();
  const catData = catPricing.get(category);
  const unit = catData && catData.vol > 0 ? catData.cost / catData.vol : 0;
  const cost = unit * metaSent;
  return {
    waba_id: account.waba_id, template_id: tpl.id, template_name: tpl.name,
    template_category: category || null, template_language: tpl.language || null, template_status: tpl.status || null,
    period_start: periodStart, period_end: periodEnd,
    sent: metaSent, delivered: metaDelivered, read: metaRead, clicked: metaClicked,
    replied: Math.max(metaReplied, localReplied),
    cost_usd: Math.round(cost * 10000) / 10000,
    unit_cost_usd: Math.round(unit * 1000000) / 1000000,
    last_synced_at: new Date().toISOString(),
  };
}

router.post('/template-stats/sync', asyncHandler(async (req, res) => {
  const { waba_id, start, end } = req.body || {};
  const now = new Date();
  const periodEnd = end ? new Date(`${end}T23:59:59Z`).toISOString() : now.toISOString();
  const periodStart = start ? new Date(`${start}T00:00:00Z`).toISOString() : new Date(now.getTime() - 30 * 86400000).toISOString();
  const startUnix = Math.floor(new Date(periodStart).getTime() / 1000);
  const endUnix = Math.floor(new Date(periodEnd).getTime() / 1000);
  let query = supabase.from('whatsapp_accounts').select('*');
  if (waba_id) query = query.eq('waba_id', waba_id);
  const { data: contas, error: contasErr } = await query;
  if (contasErr) return errorResponse(res, contasErr.message, 500, 'DB_ERROR');
  if (!contas?.length) return errorResponse(res, 'Nenhuma conta encontrada', 404, 'NOT_FOUND');
  const resumo = [];
  for (const account of contas) {
    const catPricing = new Map();
    try {
      const pricingFields = `pricing_analytics.start(${startUnix}).end(${endUnix}).granularity(DAILY).dimensions(['PRICING_CATEGORY'])`;
      const pricingRes = await graphRequest(`/${account.waba_id}?fields=${pricingFields}`, account.access_token);
      const pts = (pricingRes?.pricing_analytics?.data || []).flatMap((d) => d.data_points || []);
      for (const p of pts) {
        const k = String(p.pricing_category || '').toUpperCase();
        if (!catPricing.has(k)) catPricing.set(k, { vol: 0, cost: 0 });
        const s = catPricing.get(k);
        s.vol += Number(p.volume || 0); s.cost += Number(p.cost || 0);
      }
    } catch {}
    const templates = [];
    let nextUrl = `/${account.waba_id}/message_templates?limit=200`;
    let safety = 0;
    while (nextUrl && safety++ < 20) {
      try {
        const r = await graphRequest(nextUrl, account.access_token);
        for (const t of r?.data || []) templates.push(t);
        const next = r?.paging?.next;
        if (next && next.startsWith('http')) { const u = new URL(next); nextUrl = u.pathname + u.search; }
        else nextUrl = null;
      } catch { break; }
    }
    let inseridos = 0;
    for (const tpl of templates) {
      try {
        const row = await montarStatsDoTemplate({ account, tpl, startUnix, endUnix, periodStart, periodEnd, catPricing });
        const { error: upErr } = await supabase.from('whatsapp_template_stats').upsert(row, { onConflict: 'waba_id,template_id' });
        if (!upErr) inseridos++;
      } catch {}
    }
    resumo.push({ account: account.name, waba_id: account.waba_id, templates_total: templates.length, templates_atualizados: inseridos });
  }
  successResponse(res, { period_start: periodStart, period_end: periodEnd, contas: resumo }, 'Sync concluído');
}));

router.get('/template-stats', asyncHandler(async (req, res) => {
  const { waba_id, category, grupo, canal_venda, order } = req.query;
  let q = supabase.from('whatsapp_template_stats').select('*');
  if (waba_id) q = q.eq('waba_id', waba_id);
  if (category) q = q.eq('template_category', String(category).toUpperCase());
  if (grupo) q = q.eq('grupo', String(grupo).toLowerCase());
  const orderCol = ['sent', 'delivered', 'read', 'replied', 'cost_usd', 'last_synced_at'].includes(order) ? order : 'sent';
  q = q.order(orderCol, { ascending: false });
  const { data, error } = await q;
  if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
  const { data: accs } = await supabase.from('whatsapp_accounts').select('waba_id, name, canal_venda');
  const accMap = new Map((accs || []).map((a) => [a.waba_id, a]));
  let enriched = (data || []).map((r) => ({ ...r, account_name: accMap.get(r.waba_id)?.name || null, canal_venda: accMap.get(r.waba_id)?.canal_venda || null }));
  if (canal_venda) enriched = enriched.filter((r) => (r.canal_venda || '').toLowerCase() === String(canal_venda).toLowerCase());
  successResponse(res, enriched, `${enriched.length} templates`);
}));

router.patch('/template-stats/:id/grupo', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return errorResponse(res, 'id inválido', 400, 'VALIDATION');
  let { grupo } = req.body || {};
  grupo = grupo == null ? null : String(grupo).trim().toLowerCase() || null;
  const { data, error } = await supabase.from('whatsapp_template_stats').update({ grupo }).eq('id', id).select('id, template_name, grupo').single();
  if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
  successResponse(res, data, `Grupo atualizado pra "${grupo || 'sem grupo'}"`);
}));

router.get('/template-stats/contas', asyncHandler(async (req, res) => {
  const { canal_venda } = req.query;
  let q = supabase.from('whatsapp_accounts').select('waba_id, name, canal_venda, phone_id, nr_telefone').order('name');
  if (canal_venda) q = q.eq('canal_venda', String(canal_venda).toLowerCase());
  const { data, error } = await q;
  if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
  successResponse(res, data, `${data.length} contas`);
}));

router.get('/template-stats/grupos', asyncHandler(async (req, res) => {
  const { waba_id } = req.query;
  let q = supabase.from('whatsapp_template_stats').select('grupo').not('grupo', 'is', null);
  if (waba_id) q = q.eq('waba_id', waba_id);
  const { data, error } = await q;
  if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
  const grupos = Array.from(new Set((data || []).map((r) => r.grupo).filter(Boolean))).sort();
  successResponse(res, grupos, `${grupos.length} grupos`);
}));

// ============================================================
// DISPAROS — Histórico de campanhas com contatos enviados
// GET /api/meta/disparos                 — agrega por campanha
// GET /api/meta/disparos/:campaign_id/contatos — contatos de uma campanha
// ============================================================

router.get(
  '/disparos',
  asyncHandler(async (req, res) => {
    const { waba_id, days = 30, limit = 50 } = req.query;
    const desde = new Date(Date.now() - Number(days) * 86400000).toISOString();

    // Fonte: message_queue (única tabela com dados reais hoje).
    // template_disparos foi planejada pra conversão, mas ainda está vazia.
    let q = supabase
      .from('message_queue')
      .select('campaign_id, campaign_name, template_name, status, sent_at, created_at, account_id')
      .gte('created_at', desde)
      .not('campaign_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50000);
    const { data, error } = await q;
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');

    let accountFilter = null;
    if (waba_id) {
      const { data: acc } = await supabase
        .from('whatsapp_accounts')
        .select('id, waba_id')
        .eq('waba_id', waba_id)
        .maybeSingle();
      if (acc?.id) accountFilter = acc.id;
    }

    const porCampanha = new Map();
    for (const r of data || []) {
      if (accountFilter && r.account_id !== accountFilter) continue;
      const k = r.campaign_id;
      if (!k) continue;
      const cur = porCampanha.get(k) || {
        campaign_id: k,
        campaign_name: r.campaign_name || '—',
        template_name: r.template_name,
        account_id: r.account_id,
        total: 0,
        enviados: 0,
        falharam: 0,
        entregues: 0,
        lidas: 0,
        responderam: 0,
        compraram: 0,
        faturamento: 0,
        primeiro_envio: r.sent_at || r.created_at,
        ultimo_envio: r.sent_at || r.created_at,
      };
      cur.total++;
      if (['sent', 'delivered', 'read', 'replied'].includes(r.status)) cur.enviados++;
      if (r.status === 'delivered' || r.status === 'read' || r.status === 'replied') cur.entregues++;
      if (r.status === 'read' || r.status === 'replied') cur.lidas++;
      if (r.status === 'replied') cur.responderam++;
      if (r.status === 'failed' || r.status === 'error') cur.falharam++;
      const ts = r.sent_at || r.created_at;
      if (ts && ts > cur.ultimo_envio) cur.ultimo_envio = ts;
      if (ts && ts < cur.primeiro_envio) cur.primeiro_envio = ts;
      porCampanha.set(k, cur);
    }

    const lista = [...porCampanha.values()]
      .map((c) => ({
        ...c,
        faturamento: Math.round(c.faturamento * 100) / 100,
        taxa_conversao: c.enviados > 0 ? Math.round((c.compraram / c.enviados) * 10000) / 100 : 0,
      }))
      .sort((a, b) => (b.ultimo_envio || '').localeCompare(a.ultimo_envio || ''))
      .slice(0, Number(limit) || 50);

    return successResponse(res, lista, `${lista.length} campanhas`);
  }),
);

router.get(
  '/disparos/:campaign_id/contatos',
  asyncHandler(async (req, res) => {
    const { campaign_id } = req.params;
    const { search, page = 1, pageSize = 100, status } = req.query;
    if (!campaign_id) return errorResponse(res, 'campaign_id obrigatório', 400, 'MISSING');

    let q = supabase
      .from('message_queue')
      .select('id, contact_external_id, phone_number, contact_name, status, sent_at, last_error, attempt_count, meta_message_id, campaign_name, template_name, metadata, delivered_at, read_at, replied_at', { count: 'exact' })
      .eq('campaign_id', campaign_id)
      .order('id', { ascending: true });
    if (status) q = q.eq('status', status);
    if (search) {
      q = q.or(`contact_name.ilike.%${search}%,phone_number.ilike.%${search}%`);
    }
    const pn = Math.max(1, Number(page) || 1);
    const ps = Math.min(500, Math.max(10, Number(pageSize) || 100));
    q = q.range((pn - 1) * ps, pn * ps - 1);

    const { data, error, count } = await q;
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');

    // Enriquece com pes_pessoa via telefone (best-effort, sem quebrar se faltar)
    const rows = data || [];
    const phones = rows.map((r) => String(r.phone_number || '').replace(/\D/g, '')).filter(Boolean);
    let phoneToPessoa = new Map();
    if (phones.length > 0) {
      try {
        // pes_pessoa.phones é jsonb array; busca por contém — pode ser pesado, então
        // só faz se a página é pequena (<= 200 telefones)
        if (phones.length <= 200) {
          // Tenta números nos formatos com e sem 55
          const cands = new Set();
          for (const p of phones) {
            cands.add(p);
            if (p.startsWith('55')) cands.add(p.slice(2));
          }
          // Busca por person_code se contact_external_id estiver preenchido
          const personCodes = rows
            .map((r) => Number(r.contact_external_id))
            .filter((n) => Number.isFinite(n) && n > 0);
          if (personCodes.length > 0) {
            const { data: pp } = await supabase
              .from('pes_pessoa')
              .select('code, cpf, nm_pessoa, phones')
              .in('code', personCodes);
            for (const p of pp || []) {
              const ph = Array.isArray(p.phones) ? p.phones : [];
              for (const phRec of ph) {
                const n = String(phRec.number || '').replace(/\D/g, '');
                if (n) phoneToPessoa.set(n, p);
              }
              phoneToPessoa.set(`code:${p.code}`, p);
            }
          }
        }
      } catch (e) { /* enrich é best-effort */ }
    }

    const contatos = rows.map((r) => {
      const phoneDigits = String(r.phone_number || '').replace(/\D/g, '');
      const phoneNo55 = phoneDigits.startsWith('55') ? phoneDigits.slice(2) : phoneDigits;
      const pp = phoneToPessoa.get(`code:${Number(r.contact_external_id) || 0}`)
        || phoneToPessoa.get(phoneDigits)
        || phoneToPessoa.get(phoneNo55);
      // Promove status de eventos do webhook (read/delivered) se sent_at já existe
      let st = r.status;
      if (r.replied_at) st = 'replied';
      else if (r.read_at) st = 'read';
      else if (r.delivered_at) st = 'delivered';
      return {
        id: r.id,
        person_code: pp?.code || (Number(r.contact_external_id) || null),
        phone_number: r.phone_number,
        contact_name: r.contact_name || pp?.nm_pessoa || null,
        cpf_cnpj: pp?.cpf || null,
        status: st,
        sent_at: r.sent_at,
        delivered_at: r.delivered_at,
        read_at: r.read_at,
        replied_at: r.replied_at,
        error_message: r.last_error,
        attempt_count: r.attempt_count,
        meta_message_id: r.meta_message_id,
        campaign_name: r.campaign_name,
        template_name: r.template_name,
        comprou: false,
        valor_compra: 0,
        data_compra: null,
      };
    });

    return successResponse(
      res,
      { contatos, total: count || 0, page: pn, pageSize: ps },
      `${contatos.length} contatos`,
    );
  }),
);

export default router;
