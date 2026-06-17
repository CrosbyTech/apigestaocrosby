// Integração Wix eCommerce — busca pedidos paginado e salva no Supabase
// Doc: https://dev.wix.com/docs/rest/business-solutions/ecom/orders/order-v3/search-orders
import axios from 'axios';
import supabase from '../config/supabase.js';

const WIX_API = 'https://www.wixapis.com';

function headers() {
  const apiKey = process.env.WIX_API_KEY;
  const accountId = process.env.WIX_ACCOUNT_ID;
  const siteId = process.env.WIX_SITE_ID;
  if (!apiKey || !accountId || !siteId) {
    throw new Error('Credenciais WIX_* faltando no .env');
  }
  return {
    Authorization: apiKey,
    'wix-account-id': accountId,
    'wix-site-id': siteId,
    'Content-Type': 'application/json',
  };
}

// Extrai CPF de customFields (caso o lojista tenha campo de CPF no checkout)
function extrairCPF(order) {
  // Wix permite custom fields no checkout — tenta achar algo que pareça CPF
  const candidatos = [];
  for (const cf of order.customFields || []) {
    const valor = String(cf.value || '').replace(/\D/g, '');
    if (valor.length === 11) candidatos.push(valor);
  }
  // Fallback: procura no taxIdentifier (alguns países gravam aqui)
  const ti = order.billingInfo?.contactDetails?.taxIdentifier?.id
    || order.buyerInfo?.taxIdentifier?.id;
  if (ti) {
    const v = String(ti).replace(/\D/g, '');
    if (v.length === 11) candidatos.push(v);
  }
  return candidatos[0] || null;
}

function moneyToNumber(money) {
  if (!money) return 0;
  // priceSummary.total = { amount: "1112.00", formattedAmount: "R$1.112,00" }
  const v = Number(money.amount || money.value || 0);
  return Number.isFinite(v) ? v : 0;
}

// Mapeia 1 pedido Wix → linha em wix_pedidos
function mapPedido(o) {
  const ship = o.shippingInfo?.logistics?.shippingDestination?.address || {};
  const buyer = o.buyerInfo || {};
  const bill = o.billingInfo?.contactDetails || {};
  const recip = o.recipientInfo?.contactDetails || {};
  return {
    id: o.id,
    numero: String(o.number ?? ''),
    status: o.status || null,
    payment_status: o.paymentStatus || null,
    fulfillment_status: o.fulfillmentStatus || null,
    buyer_email: buyer.email || o.billingInfo?.contactDetails?.email || null,
    buyer_nome: bill.firstName || recip.firstName || buyer.firstName || null,
    buyer_sobrenome: bill.lastName || recip.lastName || buyer.lastName || null,
    buyer_telefone: bill.phone || recip.phone || buyer.phone || null,
    buyer_cpf: extrairCPF(o),
    total: moneyToNumber(o.priceSummary?.total),
    subtotal: moneyToNumber(o.priceSummary?.subtotal),
    desconto: moneyToNumber(o.priceSummary?.discount),
    frete: moneyToNumber(o.priceSummary?.shipping),
    imposto: moneyToNumber(o.priceSummary?.tax),
    moeda: o.currency || 'BRL',
    ship_cidade: ship.city || null,
    ship_uf: ship.subdivision || null,
    ship_cep: ship.postalCode || null,
    ship_logradouro: ship.streetAddress?.name || ship.addressLine || null,
    ship_numero: ship.streetAddress?.number || null,
    ship_complemento: ship.addressLine2 || null,
    criado_em: o.createdDate || null,
    comprado_em: o.purchasedDate || o.createdDate || null,
    atualizado_em: o.updatedDate || null,
    canal: o.channelInfo?.type || null,
    origem: o.attributionSource || null,
    raw: o,
    sincronizado_em: new Date().toISOString(),
  };
}

// Extrai cor (com hex) e tamanho do line item Wix.
// Wix envia em 2 lugares: descriptionLines (rico) e catalogReference.options.options (mapa).
function extrairVariacao(li) {
  let cor = null, corHex = null, tamanho = null;
  // 1ª fonte: descriptionLines (mais completo — tem hex da cor)
  for (const dl of li.descriptionLines || []) {
    const nome = String(
      dl.name?.original || dl.name?.translated || ''
    ).toLowerCase();
    if (dl.lineType === 'COLOR' || /cor|color/.test(nome)) {
      cor = dl.colorInfo?.original || dl.colorInfo?.translated || dl.color || cor;
      corHex = dl.colorInfo?.code || corHex;
    } else if (
      dl.lineType === 'PLAIN_TEXT' &&
      /tamanho|size/.test(nome)
    ) {
      tamanho =
        dl.plainText?.original || dl.plainText?.translated || tamanho;
    }
  }
  // 2ª fonte (fallback): catalogReference.options.options (mapa key/value)
  const opts = li.catalogReference?.options?.options || {};
  if (!cor) cor = opts.Cor || opts.cor || opts.Color || null;
  if (!tamanho) tamanho = opts.Tamanho || opts.tamanho || opts.Size || null;
  return { cor: cor || null, cor_hex: corHex || null, tamanho: tamanho || null };
}

// Mapeia 1 line item Wix → linha em wix_pedido_items
function mapItens(o) {
  const itens = [];
  for (const li of o.lineItems || []) {
    const variacao = extrairVariacao(li);
    itens.push({
      pedido_id: o.id,
      line_item_id: li.id || null,
      produto_id: li.catalogReference?.catalogItemId || null,
      variant_id: li.catalogReference?.options?.variantId || null,
      nome: li.productName?.original || li.productName?.translated || null,
      sku: li.physicalProperties?.sku || null,
      quantidade: Number(li.quantity || 1),
      preco_unit: moneyToNumber(li.price),
      preco_total: moneyToNumber(li.totalPriceBeforeTax || li.totalPrice),
      // Wix retorna image como objeto {id, url, height, width} ou string.
      imagem:
        typeof li.image === 'string'
          ? li.image
          : li.image?.url || null,
      cor: variacao.cor,
      cor_hex: variacao.cor_hex,
      tamanho: variacao.tamanho,
    });
  }
  return itens;
}

/**
 * Busca pedidos do Wix via /ecom/v1/orders/search com paginação.
 *
 * @param {object} opts
 * @param {string} opts.dataDe   - ISO date (opcional) — só pedidos criados a partir de
 * @param {string} opts.dataAte  - ISO date (opcional) — só pedidos criados até
 * @param {number} opts.limit    - 100 default
 * @param {string} opts.cursor   - cursor de paginação (vazio = primeira pág)
 */
export async function buscarPedidosWix({ dataDe, dataAte, limit = 100, cursor = '' } = {}) {
  const filter = {};
  if (dataDe || dataAte) {
    filter.createdDate = {};
    if (dataDe) filter.createdDate.$gte = dataDe;
    if (dataAte) filter.createdDate.$lte = dataAte;
  }
  const body = {
    search: {
      filter,
      sort: [{ fieldName: 'createdDate', order: 'DESC' }],
      cursorPaging: cursor ? { cursor, limit } : { limit },
    },
  };
  const r = await axios.post(`${WIX_API}/ecom/v1/orders/search`, body, {
    headers: headers(),
    timeout: 30000,
  });
  return {
    orders: r.data?.orders || [],
    nextCursor: r.data?.metadata?.cursors?.next || '',
    total: r.data?.metadata?.totalCount,
  };
}

/**
 * Sync incremental — pega pedidos novos/atualizados desde a última sync.
 * Salva em batches no Supabase (upsert por id).
 */
export async function syncPedidosWix({ desdeData, paginaUnica = false } = {}) {
  const t0 = Date.now();
  console.log(`📥 [wix-sync] iniciado${desdeData ? ` (desde ${desdeData})` : ' (full)'}`);
  let totalSalvos = 0;
  let totalItens = 0;
  let cursor = '';
  let pagina = 0;
  while (true) {
    pagina++;
    const { orders, nextCursor } = await buscarPedidosWix({
      dataDe: desdeData,
      cursor,
      limit: 100,
    });
    if (orders.length === 0) break;
    // Mapeia + upsert pedidos
    const rows = orders.map(mapPedido);
    const { error: e1 } = await supabase
      .from('wix_pedidos')
      .upsert(rows, { onConflict: 'id' });
    if (e1) {
      console.error('[wix-sync] erro upsert pedidos:', e1.message);
      break;
    }
    // Reset + insert dos line items
    // (delete + insert simplifica caso o pedido tenha sido editado)
    const ids = rows.map((r) => r.id);
    await supabase.from('wix_pedido_items').delete().in('pedido_id', ids);
    const itens = orders.flatMap(mapItens);
    if (itens.length > 0) {
      const { error: e2 } = await supabase.from('wix_pedido_items').insert(itens);
      if (e2) console.warn('[wix-sync] erro insert items:', e2.message);
    }
    totalSalvos += rows.length;
    totalItens += itens.length;
    console.log(`[wix-sync] pág ${pagina}: ${rows.length} pedidos / ${itens.length} itens`);
    if (paginaUnica || !nextCursor) break;
    cursor = nextCursor;
  }
  const dur = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`✅ [wix-sync] concluído em ${dur}s — ${totalSalvos} pedidos / ${totalItens} itens`);
  return { ok: true, pedidos: totalSalvos, itens: totalItens, duracao_s: Number(dur) };
}

/**
 * Pega data do pedido mais recente já sincronizado (pra sync incremental).
 */
export async function ultimaDataSyncada() {
  const { data } = await supabase
    .from('wix_pedidos')
    .select('criado_em')
    .order('criado_em', { ascending: false })
    .limit(1);
  return data?.[0]?.criado_em || null;
}
