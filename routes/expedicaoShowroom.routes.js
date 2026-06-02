// Expedição Showroom — controle de envio das NFs showroom/novidades.
//   POST /api/expedicao-showroom/sync-totvs  — puxa NFs do TOTVS (showroom+novidades)
//                                              e cria/atualiza na tabela.
//   GET  /api/expedicao-showroom             — lista (filtros: status, transportadora, busca)
//   PATCH /api/expedicao-showroom/:id        — atualiza status/transportadora/rastreio/obs
import express from 'express';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { getBranchCodes, httpsAgent } from '../totvsrouter/totvsHelper.js';

const router = express.Router();
const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';

// Operações que pertencem a Showroom + Novidades Franquia
const OPERATIONS = [7254, 7007, 7255];
const STATUS_VALIDOS = new Set(['enviado_blue', 'recebido_blue', 'enviado_cliente']);
const TRANSPORTADORAS_VALIDAS = new Set([
  'latam', 'azul', 'correios', 'retirada', 'taxista', 'paulao',
]);

// ─────────────────────────────────────────────────────────────────
// Helper: paginação fiscal/invoices/search com expand=items
// (precisa items pra calcular volume_qty)
// ─────────────────────────────────────────────────────────────────
async function fetchInvoicesFromTotvs({ datemin, datemax, accessToken, branchCodeList }) {
  const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
  const pageSize = 100;
  const fetchPage = async (page) =>
    axios
      .post(
        endpoint,
        {
          filter: {
            branchCodeList, // obrigatório — sem isso TOTVS retorna 400
            operationCodeList: OPERATIONS,
            operationType: 'Output',
            startIssueDate: `${datemin}T00:00:00`,
            endIssueDate: `${datemax}T23:59:59`,
          },
          expand: 'items',
          page,
          pageSize,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          httpsAgent,
          timeout: 120000,
        },
      )
      .then((r) => r.data)
      .catch((err) => {
        console.warn(`[expedicao-showroom] pg ${page}: ${err.response?.data?.message || err.message}`);
        return { items: [] };
      });

  const first = await fetchPage(1);
  const all = [...(first?.items || [])];
  const totalPages =
    first?.totalPages ||
    (first?.totalItems ? Math.ceil(first.totalItems / pageSize) : 1);
  if (totalPages > 1) {
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const CONC = 3;
    for (let i = 0; i < remaining.length; i += CONC) {
      const batch = remaining.slice(i, i + CONC);
      const results = await Promise.all(batch.map(fetchPage));
      for (const pd of results) all.push(...(pd?.items || []));
    }
  }
  return all;
}

// ─────────────────────────────────────────────────────────────────
// Helper: busca nome fantasia das pessoas em lote.
// PJ → /person/v2/legal-entities/search (tem fantasyName)
// PF → /person/v2/individuals/search    (tem só name)
// Retorna Map<personCode, fantasyName|name>.
// ─────────────────────────────────────────────────────────────────
async function fetchFantasyNames({ personCodes, accessToken }) {
  const result = new Map();
  if (!personCodes.length) return result;

  // Helper batch
  const fetchBatch = async (endpoint, codes) => {
    try {
      const r = await axios.post(
        `${TOTVS_BASE_URL}${endpoint}`,
        { filter: { personCodeList: codes }, page: 1, pageSize: codes.length },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          httpsAgent,
          timeout: 60000,
        },
      );
      return r.data?.items || [];
    } catch (e) {
      console.warn(`[expedicao-showroom] fantasy ${endpoint}: ${e?.response?.data?.message || e.message}`);
      return [];
    }
  };

  // Chunks de até 200 codes por chamada
  const CHUNK = 200;
  for (let i = 0; i < personCodes.length; i += CHUNK) {
    const chunk = personCodes.slice(i, i + CHUNK);
    // PJ primeiro (legal-entities) — tem fantasyName
    const pj = await fetchBatch('/person/v2/legal-entities/search', chunk);
    for (const p of pj) {
      const fantasy = p.fantasyName || p.name;
      if (fantasy) result.set(Number(p.code), fantasy);
    }
    // PF (individuals) — preenche os que não estão como PJ
    const semFantasia = chunk.filter((c) => !result.has(Number(c)));
    if (semFantasia.length > 0) {
      const pf = await fetchBatch('/person/v2/individuals/search', semFantasia);
      for (const p of pf) {
        if (p.name) result.set(Number(p.code), p.name);
      }
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────
// POST /api/expedicao-showroom/sync-totvs
//   body: { datemin?, datemax? }  (default = últimos 60 dias)
//   Cria novas NFs, NÃO sobrescreve status/transportadora/rastreio
//   de NFs já existentes (apenas atualiza dados do TOTVS).
// ─────────────────────────────────────────────────────────────────
router.post('/sync-totvs', async (req, res) => {
  try {
    const hoje = new Date();
    const sessenta = new Date(hoje);
    sessenta.setDate(sessenta.getDate() - 60);
    const datemin = req.body?.datemin || sessenta.toISOString().slice(0, 10);
    const datemax = req.body?.datemax || hoje.toISOString().slice(0, 10);

    const tk = await getToken();
    const token = tk?.access_token;
    if (!token) return res.status(503).json({ error: 'Token TOTVS indisponível' });

    // branchCodeList é obrigatório no fiscal/v2/invoices/search
    const branchCodeList = await getBranchCodes(token);

    const invoices = await fetchInvoicesFromTotvs({
      datemin,
      datemax,
      accessToken: token,
      branchCodeList,
    });

    // Resolve nomes fantasia em lote (chama TOTVS persons só pros codes únicos)
    const codes = [...new Set(invoices.map((n) => Number(n.personCode)).filter(Boolean))];
    const fantasyMap = await fetchFantasyNames({ personCodes: codes, accessToken: token });
    console.log(`[expedicao-showroom] ${codes.length} pessoas, ${fantasyMap.size} com fantasy`);

    let novos = 0, atualizados = 0, pulados = 0;
    for (const nf of invoices) {
      if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') {
        pulados++;
        continue;
      }
      // Volume = soma quantity de products
      let volume = 0;
      for (const item of nf.items || []) {
        for (const p of item.products || []) {
          volume += parseFloat(p.quantity) || 0;
        }
      }

      const row = {
        branch_code: nf.branchCode,
        invoice_code: nf.invoiceCode,
        transaction_code: String(nf.transactionCode || ''),
        issue_date: (nf.issueDate || '').slice(0, 10),
        person_code: nf.personCode,
        person_name: nf.personName,
        person_fantasy_name: fantasyMap.get(Number(nf.personCode)) || null,
        operation_code: nf.operationCode,
        operation_name: nf.operatioName || nf.operationName,
        total_value: parseFloat(nf.totalValue) || 0,
        volume_qty: Math.round(volume),
        totvs_synced_at: new Date().toISOString(),
      };
      // Upsert: cria se nova, mantém status/transportadora/rastreio se já existe
      const { data: existing } = await supabase
        .from('expedicao_showroom')
        .select('id, status')
        .eq('branch_code', row.branch_code)
        .eq('invoice_code', row.invoice_code)
        .single();
      if (existing?.id) {
        await supabase
          .from('expedicao_showroom')
          .update({
            transaction_code: row.transaction_code,
            issue_date: row.issue_date,
            person_code: row.person_code,
            person_name: row.person_name,
            person_fantasy_name: row.person_fantasy_name,
            operation_code: row.operation_code,
            operation_name: row.operation_name,
            total_value: row.total_value,
            volume_qty: row.volume_qty,
            totvs_synced_at: row.totvs_synced_at,
          })
          .eq('id', existing.id);
        atualizados++;
      } else {
        await supabase.from('expedicao_showroom').insert(row);
        novos++;
      }
    }
    return res.json({
      ok: true,
      datemin, datemax,
      total_nfs: invoices.length,
      novos, atualizados, pulados,
    });
  } catch (e) {
    console.error('[expedicao-showroom/sync-totvs]', e);
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/expedicao-showroom
//   query: ?status= &transportadora= &busca= &limit= &offset=
// ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, transportadora, busca } = req.query;
  const limit = Math.min(parseInt(req.query.limit || '500', 10) || 500, 2000);
  const offset = parseInt(req.query.offset || '0', 10) || 0;
  let q = supabase
    .from('expedicao_showroom')
    .select('*', { count: 'exact' })
    .order('issue_date', { ascending: false })
    .order('invoice_code', { ascending: false })
    .range(offset, offset + limit - 1);
  if (status) q = q.eq('status', status);
  if (transportadora) q = q.eq('transportadora', transportadora);
  if (busca) {
    const safe = String(busca).replace(/[%_]/g, '');
    q = q.or(
      `person_name.ilike.%${safe}%,person_fantasy_name.ilike.%${safe}%,transaction_code.ilike.%${safe}%,codigo_rastreio.ilike.%${safe}%`,
    );
  }
  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, items: data || [], total: count || 0 });
});

// ─────────────────────────────────────────────────────────────────
// PATCH /api/expedicao-showroom/:id
//   body: { status?, transportadora?, codigo_rastreio?, observacao? }
// ─────────────────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const allowed = ['status', 'transportadora', 'codigo_rastreio', 'observacao', 'atualizado_por', 'volume_caixas'];
  const patch = {};
  for (const k of allowed) {
    if (k in req.body) patch[k] = req.body[k];
  }
  if (patch.status && !STATUS_VALIDOS.has(patch.status)) {
    return res.status(400).json({ error: `status inválido: ${patch.status}` });
  }
  if ('volume_caixas' in patch) {
    const n = Number(patch.volume_caixas);
    if (!Number.isFinite(n) || n < 0 || n > 99999) {
      return res.status(400).json({ error: 'volume_caixas inválido' });
    }
    patch.volume_caixas = Math.round(n);
  }
  if (
    patch.transportadora &&
    patch.transportadora !== '' &&
    !TRANSPORTADORAS_VALIDAS.has(patch.transportadora)
  ) {
    return res.status(400).json({ error: `transportadora inválida: ${patch.transportadora}` });
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'nenhum campo válido' });
  }
  const { data, error } = await supabase
    .from('expedicao_showroom')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, item: data });
});

export default router;
