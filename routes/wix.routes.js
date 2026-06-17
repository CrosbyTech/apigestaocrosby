// Rotas da integração Wix
//   GET  /api/wix/pedidos     — lista pedidos (com filtros) + itens
//   GET  /api/wix/pedidos/:id — detalhes de 1 pedido com items
//   POST /api/wix/sync        — força sync manual
import express from 'express';
import supabase from '../config/supabase.js';
import { executarSyncWix } from '../jobs/wix-sync.job.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────
// GET /api/wix/pedidos
//   ?datemin=YYYY-MM-DD     pedidos criados a partir
//   ?datemax=YYYY-MM-DD     pedidos criados até
//   ?status=APPROVED        filtra por status
//   ?busca=texto            nome / email / numero
//   ?limit=100&offset=0
// ─────────────────────────────────────────────────────────────────────
router.get('/pedidos', async (req, res) => {
  try {
    const { datemin, datemax, status, busca } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const offset = parseInt(req.query.offset || '0', 10) || 0;

    let q = supabase
      .from('wix_pedidos')
      .select('*', { count: 'exact' })
      .order('criado_em', { ascending: false })
      .range(offset, offset + limit - 1);

    if (datemin) q = q.gte('criado_em', `${datemin}T00:00:00`);
    if (datemax) q = q.lte('criado_em', `${datemax}T23:59:59`);
    if (status) q = q.eq('status', status);
    if (busca) {
      const safe = busca.replace(/[%_]/g, '');
      q = q.or(
        `numero.ilike.%${safe}%,buyer_email.ilike.%${safe}%,buyer_nome.ilike.%${safe}%,buyer_sobrenome.ilike.%${safe}%,buyer_cpf.ilike.%${safe}%`,
      );
    }

    const { data: pedidos, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Busca itens dos pedidos retornados (1 query)
    const ids = (pedidos || []).map((p) => p.id);
    let itens = [];
    if (ids.length > 0) {
      const r = await supabase
        .from('wix_pedido_items')
        .select('*')
        .in('pedido_id', ids);
      itens = r.data || [];
    }
    // Agrupa por pedido_id
    const itensPorPedido = {};
    for (const it of itens) {
      if (!itensPorPedido[it.pedido_id]) itensPorPedido[it.pedido_id] = [];
      itensPorPedido[it.pedido_id].push(it);
    }
    const pedidosComItens = (pedidos || []).map((p) => ({
      ...p,
      itens: itensPorPedido[p.id] || [],
      itens_qty: (itensPorPedido[p.id] || []).reduce((s, i) => s + i.quantidade, 0),
    }));

    return res.json({
      ok: true,
      pedidos: pedidosComItens,
      total: count || 0,
      limit,
      offset,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/wix/pedidos/:id — detalhe de 1 pedido (full + raw)
// ─────────────────────────────────────────────────────────────────────
router.get('/pedidos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: pedido, error } = await supabase
      .from('wix_pedidos')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !pedido) return res.status(404).json({ error: 'pedido não encontrado' });
    const { data: itens } = await supabase
      .from('wix_pedido_items')
      .select('*')
      .eq('pedido_id', id);
    return res.json({ ok: true, pedido: { ...pedido, itens: itens || [] } });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/wix/pedidos/:id — atualiza campos editáveis manualmente
//   Body: { forma_pagamento, data_pagamento, observacao_pagamento,
//           cliente_totvs_code, cliente_totvs_nome, cliente_totvs_doc,
//           cliente_classificacao, vendedor }
// ─────────────────────────────────────────────────────────────────────
router.patch('/pedidos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = [
      'forma_pagamento', 'data_pagamento', 'observacao_pagamento',
      'cliente_totvs_code', 'cliente_totvs_nome', 'cliente_totvs_doc',
      'cliente_classificacao', 'vendedor',
    ];
    const patch = {};
    for (const k of allowed) {
      if (k in req.body) {
        let val = req.body[k];
        if (typeof val === 'string') val = val.trim() || null;
        if (k === 'cliente_totvs_code' && val != null) val = Number(val) || null;
        patch[k] = val;
      }
    }
    // Auto-stamp: se marcou forma_pagamento e não tem data, usa agora
    if (patch.forma_pagamento && !('data_pagamento' in req.body)) {
      patch.data_pagamento = new Date().toISOString();
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'nenhum campo válido' });
    }
    const { data, error } = await supabase
      .from('wix_pedidos')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, pedido: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/wix/cliente-totvs/:code
// Busca cliente pelo personCode no pes_pessoa local (sync TOTVS).
// Retorna: { code, nome, fantasia, doc (cpf/cnpj), classificacao (auto) }
// Classificação auto-detectada:
//   - franquia → fantasy_name começa com F\d+ CROSBY ou email @franquiacrosby
//     ou classifications contém type=2/20
//   - multimarcas → fantasy_name começa com "MTM "
//   - varejo → senão (cliente normal de varejo)
// ─────────────────────────────────────────────────────────────────────
router.get('/cliente-totvs/:code', async (req, res) => {
  try {
    const code = parseInt(req.params.code, 10);
    if (!code) return res.status(400).json({ error: 'code inválido' });

    const { data: p, error } = await supabase
      .from('pes_pessoa')
      .select('code, nm_pessoa, fantasy_name, cpf, classifications, email, tipo_pessoa, is_inactive')
      .eq('code', code)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!p) return res.status(404).json({ error: 'cliente não encontrado no TOTVS' });

    // Detecta classificação
    const fantasy = String(p.fantasy_name || '').toUpperCase();
    const nome = String(p.nm_pessoa || '').toUpperCase();
    const email = String(p.email || '').toLowerCase();
    const classifs = Array.isArray(p.classifications) ? p.classifications : [];
    let classificacao = 'varejo';
    if (
      /^F\d+\s*-?\s*CROSBY/.test(fantasy)
      || /^F\d+\s*-?\s*CROSBY/.test(nome)
      || email.endsWith('@franquiacrosby.com')
      || classifs.some((c) => Number(c?.type) === 2 || Number(c?.type) === 20)
    ) {
      classificacao = 'franquia';
    } else if (
      fantasy.startsWith('MTM ') || fantasy.startsWith('MTM-')
      || nome.startsWith('MTM ') || nome.startsWith('MTM-')
    ) {
      classificacao = 'multimarcas';
    }

    return res.json({
      ok: true,
      cliente: {
        code: p.code,
        nome: p.nm_pessoa,
        fantasia: p.fantasy_name,
        doc: p.cpf,
        tipo_pessoa: p.tipo_pessoa,
        is_inactive: p.is_inactive,
        classificacao,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/wix/sync — força sync manual
//   Body opcional: { full: true } pra ignorar cursor incremental
// ─────────────────────────────────────────────────────────────────────
router.post('/sync', async (req, res) => {
  try {
    const r = await executarSyncWix({ full: req.body?.full === true });
    return res.json(r);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/wix/stats — KPIs do dashboard (total pedidos, valor, ticket médio)
// ─────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const { datemin, datemax } = req.query;
    let q = supabase.from('wix_pedidos').select('status, total, criado_em');
    if (datemin) q = q.gte('criado_em', `${datemin}T00:00:00`);
    if (datemax) q = q.lte('criado_em', `${datemax}T23:59:59`);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    const stats = {
      total_pedidos: data.length,
      total_valor: 0,
      ticket_medio: 0,
      por_status: {},
    };
    for (const p of data) {
      const v = Number(p.total || 0);
      stats.total_valor += v;
      const s = p.status || 'UNKNOWN';
      if (!stats.por_status[s]) stats.por_status[s] = { qty: 0, total: 0 };
      stats.por_status[s].qty += 1;
      stats.por_status[s].total += v;
    }
    stats.total_valor = Math.round(stats.total_valor * 100) / 100;
    stats.ticket_medio = data.length > 0
      ? Math.round((stats.total_valor / data.length) * 100) / 100
      : 0;
    return res.json({ ok: true, ...stats });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/wix/webhook/cart-abandoned — recebe webhook do Wix Automations
// Wix dispara quando um carrinho é abandonado. Payload contém o checkout
// com cliente, items e total.
// CONFIGURAÇÃO NO WIX:
//   Dashboard → Automations → New Automation
//   Trigger: "Cart Abandoned"
//   Action: "Send HTTP Request"
//   URL: https://SEUDOMINIO/api/wix/webhook/cart-abandoned
//   Method: POST
//   Body: deixar Wix mandar o payload padrão
// ─────────────────────────────────────────────────────────────────────
router.post('/webhook/cart-abandoned', async (req, res) => {
  try {
    const b = req.body || {};
    // O shape do webhook do Wix Automations pode vir em vários formatos
    // dependendo do tipo de trigger. Cobrimos os principais.
    const checkout = b.checkout || b.cart || b.data?.checkout || b.data || b;
    const id =
      checkout?.id ||
      checkout?.checkoutId ||
      checkout?.cartId ||
      checkout?._id ||
      `${Date.now()}-${Math.random()}`;

    const buyer =
      checkout?.buyerInfo ||
      checkout?.buyerNote?.buyer ||
      checkout?.customer ||
      {};
    const billing = checkout?.billingInfo?.contactDetails || {};
    const totals = checkout?.priceSummary || checkout?.totals || {};

    const itens = (checkout?.lineItems || checkout?.items || []).map((li) => ({
      nome: li.productName?.original || li.productName?.translated || li.name || null,
      sku: li.physicalProperties?.sku || li.sku || null,
      qtd: Number(li.quantity || 1),
      preco_unit: Number(li.price?.amount || li.price || 0),
      imagem: typeof li.image === 'string' ? li.image : li.image?.url || null,
      cor:
        (li.descriptionLines || []).find((d) => d.lineType === 'COLOR')
          ?.colorInfo?.original || null,
      tamanho:
        (li.descriptionLines || []).find(
          (d) => d.lineType === 'PLAIN_TEXT' && /tamanho|size/i.test(d.name?.original || ''),
        )?.plainText?.original || null,
    }));

    const row = {
      wix_checkout_id: String(id),
      wix_cart_id: checkout?.cartId || null,
      cliente_email: buyer.email || billing.email || checkout?.buyerEmail || null,
      cliente_nome:
        [billing.firstName, billing.lastName].filter(Boolean).join(' ') ||
        buyer.firstName ||
        buyer.name ||
        null,
      cliente_telefone: billing.phone || buyer.phone || null,
      total: Number(totals.total?.amount || totals.total || checkout?.total || 0),
      moeda: checkout?.currency || 'BRL',
      itens_qty: itens.reduce((s, i) => s + (i.qtd || 0), 0),
      itens,
      ultima_atividade:
        checkout?.updatedDate || checkout?.lastActivityDate || new Date().toISOString(),
      criado_em: checkout?.createdDate || new Date().toISOString(),
      raw: b,
    };

    // Upsert por wix_checkout_id (mesma sessão pode disparar várias vezes)
    const { error } = await supabase
      .from('wix_carrinhos_abandonados')
      .upsert(row, { onConflict: 'wix_checkout_id' });
    if (error) {
      console.error('[wix-cart-abandoned] erro upsert:', error.message);
      return res.status(500).json({ error: error.message });
    }
    console.log(
      `[wix-cart-abandoned] ✓ recebido: ${row.cliente_email || '?'} · R$ ${row.total.toFixed(2)} · ${row.itens_qty} itens`,
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[wix-cart-abandoned] erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/wix/carrinhos — lista carrinhos abandonados (admin)
// ─────────────────────────────────────────────────────────────────────
router.get('/carrinhos', async (req, res) => {
  try {
    const { datemin, datemax, busca, recuperado } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const offset = parseInt(req.query.offset || '0', 10) || 0;
    let q = supabase
      .from('wix_carrinhos_abandonados')
      .select('*', { count: 'exact' })
      .order('ultima_atividade', { ascending: false })
      .range(offset, offset + limit - 1);
    if (datemin) q = q.gte('ultima_atividade', `${datemin}T00:00:00`);
    if (datemax) q = q.lte('ultima_atividade', `${datemax}T23:59:59`);
    if (recuperado === 'true') q = q.eq('recuperado', true);
    if (recuperado === 'false') q = q.eq('recuperado', false);
    if (busca) {
      const safe = busca.replace(/[%_]/g, '');
      q = q.or(
        `cliente_email.ilike.%${safe}%,cliente_nome.ilike.%${safe}%,cliente_telefone.ilike.%${safe}%`,
      );
    }
    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, carrinhos: data || [], total: count || 0 });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// PATCH /api/wix/carrinhos/:id — marca recuperado manualmente
router.patch('/carrinhos/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id inválido' });
    const allowed = ['recuperado', 'pedido_id_relacionado'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    const { data, error } = await supabase
      .from('wix_carrinhos_abandonados')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, carrinho: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
