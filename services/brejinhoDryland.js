// ============================================================================
// EXPEDIÇÃO BREJINHO — pedidos das franquias controlados no Dryland
// (dryland-missao-separacao.vercel.app/brejinho), lidos AO VIVO do Supabase
// do Dryland (cache de 60 s). Só leitura: status, campos e anexos continuam
// sendo mexidos no Dryland.
//
// Status do Dryland: aguardando cliente · em separação · aguardando pagamento ·
// pendência financeira · faturado · cancelado.
//
// Cada card é uma REMESSA de um pedido do showroom (campo `pedido` = nº do
// pedido de venda do TOTVS da filial 99). As peças da remessa estão na
// TRANSAÇÃO do card (`transacao`, filial 99) — a data dela no TOTVS pode
// diferir 1 dia da `data_transacao` do card, por isso a busca é por código
// numa janela de datas de alteração.
//
// Faturamento: chave `BRJ:<id do card>` na tela Expedição → Faturamento;
// cardBrejinho() devolve o card no mesmo formato da fila de faturamento
// (pedidos_venda_fila: { canal, titulo, status, dados: { itens, ... } }).
// ============================================================================
import axios from 'axios';
import { drylandRpc } from './pedidosVendaDryland.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, httpAgent, TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';

export const STATUS_BREJINHO = ['aguardando cliente', 'em separação', 'aguardando pagamento', 'pendência financeira', 'faturado', 'cancelado'];
const EMPRESA_BREJINHO = 99;
const CACHE_MS = 60 * 1000;

export class BrejinhoError extends Error {
  constructor(message, code = 'BREJINHO_ERROR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const cache = new Map(); // chave -> { em, valor }
async function comCache(chave, fn, forcar = false) {
  const c = cache.get(chave);
  if (!forcar && c && Date.now() - c.em < CACHE_MS) return c.valor;
  const valor = await fn();
  cache.set(chave, { em: Date.now(), valor });
  return valor;
}

// Card do Dryland sem o histórico (log) — a lista inteira cru pesa 2,5 MB
function enxuto(p) {
  return {
    id: p.id,
    status: p.status,
    pedido: p.pedido || null,
    cliente: p.cliente || null,
    transacao: p.transacao || null,
    data_transacao: p.data_transacao || null,
    nota_fiscal: p.nota_fiscal || null,
    valor: p.valor != null ? Number(p.valor) : null,
    qtd_pecas: p.qtd_pecas != null ? Number(p.qtd_pecas) : null,
    volume: p.volume ?? null,
    uf: p.uf || null,
    cidade: p.cidade || null,
    destino: p.destino || null,
    frete: p.frete || null,
    cond_pagamento: p.cond_pagamento || null,
    parcelas: p.parcelas || null,
    showroom: p.showroom || null,
    consultor: p.consultor || null,
    responsavel: p.responsavel || null,
    justificativa: p.justificativa || null,
    cancel_motivo_livre: p.cancel_motivo_livre || null,
    parecer_comercial: p.parecer_comercial || null,
    parecer_consultor: p.parecer_consultor || null,
    totvs_status: p.totvs_status || null,
    fonte: p.fonte || null,
    criado_em: p.criado_em || null,
    atualizado_em: p.atualizado_em || null,
    atualizado_por: p.atualizado_por || null,
    arquivado_em: p.arquivado_em || null,
    ultimo_evento: Array.isArray(p.log) && p.log.length ? p.log[p.log.length - 1] : null,
  };
}

export async function listarBrejinho({ forcar = false, arquivados = false } = {}) {
  return comCache(
    `lista:${arquivados ? 1 : 0}`,
    async () => {
      const l = await drylandRpc('brejinho_listar', { p_limit: 5000, p_arquivados: !!arquivados });
      if (!Array.isArray(l)) throw new BrejinhoError('O Dryland não devolveu a lista do Brejinho', 'DRYLAND', 502);
      return l.map(enxuto);
    },
    forcar,
  );
}

export async function kpisBrejinho({ forcar = false } = {}) {
  return comCache('kpis', () => drylandRpc('brejinho_kpis'), forcar);
}

// ─── TOTVS: transação da remessa (filial 99) ─────────────────────────────────
async function totvsGet(url, params) {
  const tk = await getToken();
  if (!tk?.access_token) throw new BrejinhoError('Sem token do TOTVS', 'TOKEN_UNAVAILABLE', 503);
  const qs = Object.entries(params)
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}=${encodeURIComponent(x)}`) : [`${k}=${encodeURIComponent(v)}`]))
    .join('&');
  const r = await axios.get(`${url}?${qs}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${tk.access_token}` },
    httpsAgent,
    httpAgent,
    timeout: 60000,
  });
  return r.data;
}

const isoDia = (d) => new Date(d).toISOString().slice(0, 19);

export async function transacaoDaRemessa(codigo, dataRef) {
  const code = parseInt(String(codigo || '').replace(/\D/g, ''), 10);
  if (!code) return null;
  const base = dataRef ? new Date(`${String(dataRef).slice(0, 10)}T12:00:00Z`) : new Date();
  const de = new Date(base.getTime() - 20 * 86400000);
  const ate = new Date(Math.max(Date.now(), base.getTime()) + 2 * 86400000);
  const d = await totvsGet(`${TOTVS_BASE_URL}/general/v2/transactions/search`, {
    BranchCodeList: EMPRESA_BREJINHO,
    TransactionCodeList: code,
    StartChangeDate: isoDia(de),
    EndChangeDate: isoDia(ate),
    Page: 1,
    PageSize: 5,
    Expand: 'items',
  });
  const t = (d?.items || [])[0];
  if (!t) return null;
  const itens = (t.items || []).map((i) => ({
    productCode: Number(i.productCode),
    quantidade: Number(i.quantity) || 0,
    valorUnit: Number(i.value) || 0,
    descontoUnit: Number(i.unitDiscountValue) || 0,
    total: Number(i.netValue) || 0,
    vendedor: i.sellerCode ?? null,
  }));
  return {
    code: t.transactionCode,
    date: String(t.transactionDate || '').slice(0, 10),
    status: t.status,
    customerCode: t.customerCode ?? null,
    operationCode: t.operationCode ?? null,
    sellerCode: itens.find((i) => i.vendedor != null)?.vendedor ?? null,
    totalValue: Number(t.totalValue) || 0,
    itens,
  };
}

// nomes/cor/tamanho dos produtos (uma chamada para todos)
async function produtos(codigos) {
  const lista = [...new Set(codigos.filter(Boolean).map(Number))];
  const mapa = new Map();
  if (!lista.length) return mapa;
  const tk = await getToken();
  for (let i = 0; i < lista.length; i += 100) {
    const r = await axios
      .post(
        `${TOTVS_BASE_URL}/product/v2/products/search`,
        { filter: { productCodeList: lista.slice(i, i + 100) }, option: { branchInfoCode: EMPRESA_BREJINHO }, page: 1, pageSize: 100 },
        { headers: { Accept: 'application/json', Authorization: `Bearer ${tk.access_token}` }, httpsAgent, httpAgent, timeout: 60000 },
      )
      .catch(() => null);
    for (const p of r?.data?.items || []) {
      mapa.set(Number(p.productCode), { nome: p.productName || p.name || null, cor: p.colorName || null, tam: p.sizeName || null, sku: p.productSku || null });
    }
  }
  return mapa;
}

// ─── Detalhe ─────────────────────────────────────────────────────────────────
export async function obterBrejinho(id) {
  const n = parseInt(String(id), 10);
  if (!n) throw new BrejinhoError('Pedido inválido', 'INVALID_ID');
  const p = await drylandRpc('brejinho_get', { p_id: n });
  if (!p || !p.id) throw new BrejinhoError('Pedido não encontrado no Dryland', 'NOT_FOUND', 404);
  let transacao = null;
  let transacaoErro = null;
  if (p.transacao) {
    try {
      transacao = await transacaoDaRemessa(p.transacao, p.data_transacao || p.criado_em);
      if (!transacao) transacaoErro = `Transação ${p.transacao} não encontrada na filial ${EMPRESA_BREJINHO} do TOTVS`;
    } catch (e) {
      transacaoErro = e.message;
    }
  }
  if (transacao?.itens?.length) {
    const info = await produtos(transacao.itens.map((i) => i.productCode));
    transacao.itens = transacao.itens.map((i) => ({ ...i, ...(info.get(i.productCode) || {}) }));
  }
  return { pedido: { ...enxuto(p), log: Array.isArray(p.log) ? p.log : [], anexos: p.anexos || p.cancel_anexos || [] }, transacao, transacaoErro };
}

// forma de pagamento do Dryland → texto que o Faturamento entende
function formaTexto(cond) {
  const c = String(cond || '').toUpperCase();
  if (!c) return null;
  if (/^CC\b|CART|CRED(I|Í)TO/.test(c) && !/CREDEV/.test(c)) return `CARTAO ${c}`;
  if (/^CD\b|DEB|DÉB/.test(c)) return `DEBITO ${c}`;
  return c;
}

/** Card no formato da fila de faturamento, para a tela Expedição → Faturamento. */
export async function cardBrejinho(chave) {
  const id = String(chave).replace(/^BRJ:/i, '');
  const { pedido: p, transacao, transacaoErro } = await obterBrejinho(id);
  const itens = (transacao?.itens || []).map((i) => ({
    cod: String(i.productCode),
    descricao: i.nome || `Produto ${i.productCode}`,
    cor: i.cor || null,
    tam: i.tam || null,
    qtd: i.quantidade,
    preco: Math.round((i.valorUnit - i.descontoUnit) * 100) / 100,
  }));
  const card = {
    id: `BRJ:${p.id}`,
    origem: 'brejinho',
    canal: 'franquias',
    titulo: p.cliente,
    status: p.status,
    comprovantes: [],
    numero_site: null,
    criado_em: p.criado_em,
    dados: {
      nome_cliente: p.cliente,
      codigo_cliente: transacao?.customerCode ? String(transacao.customerCode) : null,
      cod_vendedor: transacao?.sellerCode ? String(transacao.sellerCode) : null,
      itens,
      forma_pagamento: formaTexto(p.cond_pagamento),
      parcelamento: p.parcelas ? `${p.parcelas}x` : null,
      valor_pedido: p.valor,
      loja: p.cliente,
      obs: [p.parecer_comercial, p.parecer_consultor].filter(Boolean).join(' · ') || null,
      // transação da remessa só conta como "já no TOTVS" se não estiver cancelada
      transacao: transacao && transacao.status !== 6 ? String(transacao.code) : null,
      pedido_totvs: null,
      // referências do Brejinho (exibição)
      brejinho: {
        id: p.id,
        pedido_showroom: p.pedido,
        transacao_remessa: p.transacao,
        transacao_status: transacao?.status ?? null,
        transacao_erro: transacaoErro,
        showroom: p.showroom,
        destino: p.destino,
        frete: p.frete,
        uf: p.uf,
        cond_pagamento: p.cond_pagamento,
        parcelas: p.parcelas,
        qtd_pecas: p.qtd_pecas,
      },
    },
  };
  return { card, transacao, transacaoErro };
}
