/**
 * Portal de Títulos — boletos e Pix pela Pagar.me (João, Recuperação de
 * Créditos, 27/10/2026). O TOTVS não tem os boletos emitidos pela Pagar.me
 * (Stone) nem a linha digitável deles, então o portal lê de `pagarme_boletos`
 * (já gravado pela Remessa de Boletos) e gera Pix direto na Pagar.me.
 *
 *  - boletosPorTitulos(titulos): para cada título (cd_empresa, nr_fatura,
 *    nr_parcela) devolve o boleto vivo da Pagar.me (linha digitável, URL/PDF,
 *    conta), ignorando os cancelados/falhos.
 *  - gerarPix({...}): cria uma cobrança Pix na Pagar.me pelo VALOR DO TÍTULO
 *    (sem os R$ 2,99 do boleto). Regra do Tadeu: Pix = mesmo valor do boleto,
 *    sem juro/multa se pagar no dia ou 1 dia depois (feriado/fim de semana
 *    igual). metadata origem 'tadeu_pix' + titulos "e-f-p" → quando o cliente
 *    paga, o job Pix do Tadeu já joga na Solicitação de Baixa.
 */
import supabase from '../config/supabase.js';
import { pagarme, contaEmissao, CONTAS } from './pagarmeBoletos.js';

const TABELA = 'pagarme_boletos';
const VIVOS = ['pending', 'paid'];
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const chave = (e, f, p) => `${e}-${f}-${p || 1}`;

/** Boletos Pagar.me vivos dos títulos informados → Map chave → dados. */
export async function boletosPorTitulos(titulos = []) {
  const lista = (Array.isArray(titulos) ? titulos : []).slice(0, 2000).map((t) => ({
    e: Number(t.cd_empresa),
    f: Number(t.nr_fatura ?? t.nr_fat),
    p: Number(t.nr_parcela ?? 1),
  })).filter((t) => Number.isFinite(t.e) && Number.isFinite(t.f));
  if (!lista.length) return {};
  const empresas = [...new Set(lista.map((t) => t.e))];
  const faturas = [...new Set(lista.map((t) => t.f))];
  const alvo = new Set(lista.map((t) => chave(t.e, t.f, t.p)));

  const mapa = {};
  // lotes pelo nº de fatura (evita URL gigante); filtra o triplo exato no JS
  for (let i = 0; i < faturas.length; i += 300) {
    const lote = faturas.slice(i, i + 300);
    const { data, error } = await supabase
      .from(TABELA)
      .select('cd_empresa, nr_fatura, nr_parcela, status, linha_digitavel, boleto_url, boleto_pdf, conta, charge_id, order_id, vl_acrescimo, vl_fatura, dt_vencimento')
      .in('cd_empresa', empresas)
      .in('nr_fatura', lote)
      .in('status', VIVOS)
      .order('id', { ascending: false });
    if (error) throw new Error(`${TABELA}: ${error.message}`);
    for (const r of data || []) {
      const k = chave(r.cd_empresa, r.nr_fatura, r.nr_parcela);
      if (!alvo.has(k) || mapa[k]) continue; // já veio o mais recente (order desc)
      mapa[k] = {
        linha_digitavel: r.linha_digitavel || null,
        boleto_url: r.boleto_url || null,
        boleto_pdf: r.boleto_pdf || null,
        conta: r.conta || null,
        charge_id: r.charge_id || null,
        order_id: r.order_id || null,
        status: r.status,
        vl_acrescimo: Number(r.vl_acrescimo) || 0,
        vl_fatura: Number(r.vl_fatura) || null,
        dt_vencimento: r.dt_vencimento || null,
      };
    }
  }
  return mapa;
}

/** Cria uma cobrança Pix na Pagar.me para um título. Valor = valor do título. */
export async function gerarPix({ cd_empresa, nr_fatura, nr_parcela, cd_cliente, nm_cliente, documento, vl_fatura, conta }) {
  const e = Number(cd_empresa);
  const f = Number(nr_fatura);
  const p = Number(nr_parcela ?? 1);
  const valor = Math.round((Number(vl_fatura) || 0) * 100) / 100;
  if (!Number.isFinite(e) || !Number.isFinite(f) || valor <= 0) {
    throw new Error('título ou valor inválido');
  }
  // conta: a do boleto existente, senão a conta de emissão (FA MODA em prod)
  let contaId = conta && CONTAS[conta] ? conta : null;
  if (!contaId) {
    const { data } = await supabase
      .from(TABELA)
      .select('conta, nr_documento, nm_cliente')
      .eq('cd_empresa', e)
      .eq('nr_fatura', f)
      .eq('nr_parcela', p)
      .in('status', VIVOS)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      contaId = data.conta || null;
      documento = documento || data.nr_documento;
      nm_cliente = nm_cliente || data.nm_cliente;
    }
  }
  if (!contaId) contaId = contaEmissao();
  if (!CONTAS[contaId]?.sk) throw new Error(`conta Pagar.me "${contaId}" não configurada no servidor`);

  const doc = soDigitos(documento);
  const titulo = `Fatura ${f}/${p}`;
  const code = `PIX-${chave(e, f, p)}-${Date.now().toString(36)}`.slice(0, 52);
  const customer = {
    name: String(nm_cliente || `Cliente ${cd_cliente || ''}`).slice(0, 64) || 'Cliente',
    type: doc.length > 11 ? 'company' : 'individual',
    ...(doc.length === 11 || doc.length === 14 ? { document: doc, document_type: doc.length > 11 ? 'CNPJ' : 'CPF' } : {}),
  };
  const pedido = {
    code,
    items: [{ code, amount: Math.round(valor * 100), description: `${titulo} - Crosby`, quantity: 1 }],
    customer,
    payments: [{ payment_method: 'pix', pix: { expires_in: 2 * 24 * 3600 } }], // 2 dias (regra do Tadeu: dia/dia+1 sem juro)
    metadata: {
      origem: 'tadeu_pix',
      titulos: `${e}-${f}-${p}`,
      cd_cliente: String(cd_cliente || ''),
      usuario: 'portal-titulos',
    },
  };

  const resp = await pagarme('POST', '/orders', pedido, contaId);
  const order = resp.data || {};
  const charge = (order.charges || [])[0] || {};
  const tx = charge.last_transaction || {};
  const copia = tx.qr_code || tx.pix_qr_code || null;
  if (!resp.ok || order.status === 'failed' || !copia) {
    const msg = (Array.isArray(tx.gateway_response?.errors) && tx.gateway_response.errors.map((x) => x.message).join('; ')) || order.status || `HTTP ${resp.status}`;
    throw new Error(`Pagar.me não gerou o Pix: ${msg}`);
  }
  return {
    ok: true,
    valor,
    conta: contaId,
    order_id: order.id,
    charge_id: charge.id || null,
    copia_cola: copia,
    qr_code_url: tx.qr_code_url || null,
    expira_em: tx.expires_at || null,
    titulo: `${e}-${f}/${p}`,
  };
}
