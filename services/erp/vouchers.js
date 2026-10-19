// Vouchers no formato da API TOTVS v2 (voucher/v2/search, GET).
//
// A busca IGNORA filtro de alteração (StartChangeDate devolve tudo), então o
// sync é sempre a lista inteira: ~51 mil vouchers, PageSize 1000 (~51 chamadas).
// O que deixa de vir ganha removido_em; o que volta tem removido_em limpo.
import axios from 'axios';
import { paginar } from './totvsClient.js';
import { supabase, upsertLote, dedupe, agora } from './db.js';

export const SEARCH_PATH = '/voucher/v2/search';
export const PAGE_SIZE = 1000;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const ts = (v) => (v ? String(v).slice(0, 19) : null);
const json = (v) => (v === undefined ? null : v);

export function mapVoucher(v) {
  return {
    voucher_number: num(v.voucherNumber),
    description: v.description ?? null,
    prefix_code: v.prefixCode ?? null,
    voucher_code: v.voucherCode != null ? String(v.voucherCode) : null,
    voucher_type: num(v.voucherType),
    status: num(v.status),
    value: num(v.value),
    percentage: num(v.percentage),
    start_date: ts(v.startDate),
    end_date: ts(v.endDate),
    inclusion_date: ts(v.inclusionDate),
    customer_code: num(v.customerCode),
    customer_name: v.customerName ?? null,
    partner_code: num(v.partnerCode),
    partner_name: v.partnerName ?? null,
    closing_date: ts(v.closingDate),
    integration_code: v.integrationCode != null ? String(v.integrationCode) : null,
    print_template_code: num(v.printTemplateCode),
    quantity: num(v.quantity),
    branchs: json(v.branchs),
    filters: json(v.filters),
    triggers: json(v.triggers),
    removido_em: null,
    dados: v,
    sincronizado_em: agora(),
  };
}

export async function syncFull(ctx) {
  const inicio = agora();
  let gravados = 0;
  let duplicados = 0;
  const r = await paginar({
    method: 'get',
    path: SEARCH_PATH,
    pageSize: PAGE_SIZE,
    log: ctx.log,
    onPage: async (items) => {
      const rows = items.map(mapVoucher).filter((x) => x.voucher_number != null);
      const unicos = dedupe(rows, (x) => x.voucher_number);
      duplicados += rows.length - unicos.length;
      gravados += await upsertLote('vouchers', unicos, 'voucher_number', { chunk: 500 });
    },
  });
  // só marca removidos se a lista veio completa
  let removidos = 0;
  if (r.count != null && gravados + duplicados >= r.count) {
    const { data, error } = await supabase
      .from('vouchers')
      .update({ removido_em: agora() })
      .lt('sincronizado_em', inicio)
      .is('removido_em', null)
      .eq('origem', 'totvs')
      .select('voucher_number');
    if (error) throw new Error(`marcar removidos: ${error.message}`);
    removidos = data?.length || 0;
  }
  return { registros: gravados, paginas: r.paginas, totalTotvs: r.count, detalhes: { duplicados_na_api: duplicados, marcados_removidos: removidos } };
}

// ─── Escritas do HeadCoach ─────────────────────────────────────────────────

const COMANDOS = { '/voucher/v2/create': 'create', '/voucher/v2/update': 'update', '/voucher/v2/customer/create': 'customer/create' };
export const comandoVoucherDoUrl = (url) => COMANDOS[String(url || '').replace(/^https?:\/\/[^/]+\/api\/totvsmoda/, '').replace(/\?.*$/, '')] || null;

/** Registra criação/alteração de voucher enviada ao TOTVS (background, nunca lança). */
export function registrarComandoVoucher(url, payload, { sucesso, http_status = null, resposta = null, erro = null, usuario = null } = {}) {
  const command = comandoVoucherDoUrl(url);
  if (!command) return;
  setImmediate(() => {
    const r = (Array.isArray(resposta) ? resposta[0] : resposta) || {};
    supabase
      .from('voucher_commands')
      .insert({
        command,
        voucher_number: num(r.voucherNumber ?? payload?.voucherNumber ?? payload?.number),
        customer_code: num(payload?.customerCode ?? payload?.customers?.[0]?.customerCode),
        payload: payload ?? {},
        sucesso,
        http_status,
        resposta: resposta ?? null,
        erro: erro ? String(erro).slice(0, 2000) : null,
        usuario,
      })
      .then(({ error }) => error && console.warn(`[vouchers] registrar comando: ${error.message}`))
      .catch((e) => console.warn(`[vouchers] registrar comando: ${e.message}`));
  });
}

/**
 * axios.post para os endpoints de voucher que também registra o comando.
 * Mesmo contrato do axios.post (devolve a resposta, lança o erro).
 */
export async function postVoucherRegistrado(url, payload, config) {
  try {
    const r = await axios.post(url, payload, config);
    registrarComandoVoucher(url, payload, { sucesso: true, http_status: r.status, resposta: r.data });
    return r;
  } catch (e) {
    registrarComandoVoucher(url, payload, { sucesso: false, http_status: e.response?.status ?? null, resposta: e.response?.data ?? null, erro: e.message });
    throw e;
  }
}
