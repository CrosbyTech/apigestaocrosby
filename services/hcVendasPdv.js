// ============================================================================
// VENDAS DO PDV CROSBY (HeadCoach) PARA OS PAINÉIS — Yago, 17/11/2026.
// As lojas que passaram a vender pelo PDV Crosby (a primeira foi o Midway, 95)
// não mandam mais a venda ao TOTVS, então o painel de vendas do TOTVS não as
// enxerga. Este serviço entrega essas vendas para somar no ranking do PDV, no
// Ranking de Faturamento e no varejo do New Forecast / Painel de Vendas.
//
// Regra (a mesma do caixa e das Vendas do dia, definida por ele em 17/11):
//   faturamento da loja = VENDAS − DEVOLUÇÕES (trocas)
// A venda entra pelo valor cheio da nota (inclusive a parte paga com Credev) e
// a troca autorizada entra NEGATIVA, no vendedor que a registrou.
// Só conta transação com a nota AUTORIZADA; cancelada ou rejeitada fica fora.
// Data = a data do caixa em que a venda entrou (como o TOTVS conta); sem caixa,
// o dia em que foi registrada.
// ============================================================================
import supabase from '../config/supabase.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const diaBrasil = (iso) => (iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date(iso)) : null);
const somaDias = (iso, n) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Transações do PDV Crosby com nota autorizada, de dmin a dmax (YYYY-MM-DD),
 * opcionalmente só das empresas informadas. Cada item:
 * { id, empresa, tipo: 'venda'|'troca', valor (troca negativa), qtd (1 venda,
 *   0 troca), pecas (troca negativa), data, vendedor_code, vendedor_nome,
 *   cliente_code, cliente_nome, nf }
 */
export async function vendasPdvHeadcoach({ dmin, dmax, empresas = null }) {
  const de = String(dmin).slice(0, 10);
  const ate = String(dmax).slice(0, 10);
  const lista = Array.isArray(empresas) ? empresas.map(Number).filter((n) => Number.isFinite(n) && n > 0) : null;
  if (lista && lista.length === 0) return [];
  const vendas = [];
  // a data do caixa pode ser diferente do dia da gravação: busca com folga e filtra depois
  for (let ini = 0; ; ini += 1000) {
    let q = supabase
      .from('pdv_vendas')
      .select('id, empresa, tipo_venda, status, total, qtd_pecas, cliente_code, cliente_nome, vendedor_code, vendedor_nome, criado_em, caixa_id, pdv_notas_fiscais(numero, serie, status)')
      .eq('origem', 'pdv')
      .eq('status', 'autorizada')
      .gte('criado_em', `${somaDias(de, -3)}T00:00:00Z`)
      .lte('criado_em', `${somaDias(ate, 3)}T23:59:59Z`)
      .order('id')
      .range(ini, ini + 999);
    if (lista) q = q.in('empresa', lista);
    const { data, error } = await q;
    if (error) throw new Error(`Vendas do PDV Crosby: ${error.message}`);
    vendas.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  if (vendas.length === 0) return [];

  // data do caixa de cada venda
  const caixaIds = [...new Set(vendas.map((v) => v.caixa_id).filter(Boolean))];
  const dataDoCaixa = new Map();
  for (let i = 0; i < caixaIds.length; i += 200) {
    const { data, error } = await supabase.from('hc_caixas').select('id, data_caixa').in('id', caixaIds.slice(i, i + 200));
    if (error) throw new Error(`Caixas do PDV Crosby: ${error.message}`);
    for (const c of data || []) dataDoCaixa.set(c.id, String(c.data_caixa || '').slice(0, 10) || null);
  }

  const out = [];
  for (const v of vendas) {
    const nota = (v.pdv_notas_fiscais || []).find((n) => n.status === 'autorizada');
    if (!nota) continue;
    const data = (v.caixa_id && dataDoCaixa.get(v.caixa_id)) || diaBrasil(v.criado_em);
    if (!data || data < de || data > ate) continue;
    const troca = v.tipo_venda === 'troca';
    const total = round2(v.total);
    if (!(total > 0)) continue;
    out.push({
      id: v.id,
      empresa: Number(v.empresa),
      tipo: troca ? 'troca' : 'venda',
      valor: troca ? -total : total,
      qtd: troca ? 0 : 1,
      pecas: (troca ? -1 : 1) * (Number(v.qtd_pecas) || 0),
      data,
      vendedor_code: Number(v.vendedor_code) || 0,
      vendedor_nome: v.vendedor_nome || null,
      cliente_code: v.cliente_code ?? null,
      cliente_nome: v.cliente_nome || null,
      nf: nota.numero,
    });
  }
  return out;
}

/** { [empresa]: { invoice_qty, invoice_value, itens_qty } } — o formato do ranking por filial. */
export function pdvPorFilial(vendas) {
  const agg = {};
  for (const v of vendas || []) {
    const a = (agg[v.empresa] = agg[v.empresa] || { invoice_qty: 0, invoice_value: 0, itens_qty: 0 });
    a.invoice_qty += v.qtd;
    a.invoice_value = round2(a.invoice_value + v.valor);
    a.itens_qty += v.pecas;
  }
  return agg;
}

/** Map(empresa → Map(vendedor → { seller_code, seller_name, qtd, pecas, valor })) */
export function pdvPorVendedor(vendas) {
  const porEmpresa = new Map();
  for (const v of vendas || []) {
    if (!porEmpresa.has(v.empresa)) porEmpresa.set(v.empresa, new Map());
    const m = porEmpresa.get(v.empresa);
    const s = m.get(v.vendedor_code) || { seller_code: v.vendedor_code, seller_name: v.vendedor_nome, qtd: 0, pecas: 0, valor: 0 };
    s.qtd += v.qtd;
    s.pecas += v.pecas;
    s.valor = round2(s.valor + v.valor);
    if (!s.seller_name && v.vendedor_nome) s.seller_name = v.vendedor_nome;
    m.set(v.vendedor_code, s);
  }
  return porEmpresa;
}
