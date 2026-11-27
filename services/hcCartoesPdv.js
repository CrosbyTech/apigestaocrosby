// ============================================================
// Pagamentos em cartão das vendas do PDV Crosby (HeadCoach) para a
// Conciliação Stone. Só leitura. O formato de saída é o dos títulos do
// batimento (utils/hcCartoesPdv.js → tituloDoPagamento).
// ============================================================
import supabase from '../config/supabase.js';
import { FORMAS_CARTAO, janelaUtc, tituloDoPagamento, idDoPagamento } from '../utils/hcCartoesPdv.js';

const COLUNAS_VENDA =
  'id, empresa, status, origem, canal, tipo_venda, cliente_code, cliente_nome, cliente_cpf_cnpj, vendedor_nome, total, criado_em, data_caixa, totvs_transacao_code';
const COLUNAS_PAGAMENTO = 'id, venda_id, forma, valor, troco, parcelas, bandeira, nsu, autorizacao, adquirente_cnpj, cartao_totvs';
const COLUNAS_NOTA = 'venda_id, modelo, numero, status, dh_emissao';
const LOTE = 200;
const PAGINA = 1000;

async function emLotes(ids, buscar) {
  const out = [];
  for (let i = 0; i < ids.length; i += LOTE) out.push(...(await buscar(ids.slice(i, i + LOTE))));
  return out;
}

async function todasAsPaginas(montar) {
  const out = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await montar().range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGINA) break;
  }
  return out;
}

// A nota autorizada da venda (a rejeitada/cancelada só entra se for a única)
function notaPorVenda(notas) {
  const map = new Map();
  for (const n of notas) {
    const atual = map.get(n.venda_id);
    if (!atual || (String(n.status).toLowerCase() === 'autorizada' && String(atual.status).toLowerCase() !== 'autorizada'))
      map.set(n.venda_id, n);
  }
  return map;
}

async function montarTitulos(vendas, pagamentos) {
  if (!pagamentos.length) return [];
  const porVenda = new Map(vendas.map((v) => [v.id, v]));
  const idsVenda = [...new Set(pagamentos.map((p) => p.venda_id))];
  const notas = await emLotes(idsVenda, async (lote) => {
    const { data, error } = await supabase.from('pdv_notas_fiscais').select(COLUNAS_NOTA).in('venda_id', lote);
    if (error) {
      console.warn(`[stone] notas do PDV Crosby: ${error.message}`);
      return [];
    }
    return data || [];
  });
  const nota = notaPorVenda(notas);
  return pagamentos
    .filter((p) => porVenda.has(p.venda_id))
    .map((p) => tituloDoPagamento(p, porVenda.get(p.venda_id), nota.get(p.venda_id) || null));
}

/**
 * Pagamentos em cartão das vendas do PDV Crosby das empresas no período
 * (dia local da venda), no formato dos títulos do batimento.
 */
export async function buscarPagamentosCartaoPdv({ empresas, inicioIso, fimIso }) {
  const codigos = [...new Set((empresas || []).map(Number).filter(Number.isFinite))];
  if (!codigos.length) return [];
  const { de, ate } = janelaUtc(inicioIso, fimIso);
  const vendas = await todasAsPaginas(() =>
    supabase.from('pdv_vendas').select(COLUNAS_VENDA).in('empresa', codigos).gte('criado_em', de).lt('criado_em', ate).order('id'),
  );
  if (!vendas.length) return [];
  const pagamentos = await emLotes(
    vendas.map((v) => v.id),
    async (lote) => {
      const { data, error } = await supabase
        .from('pdv_venda_pagamentos')
        .select(COLUNAS_PAGAMENTO)
        .in('venda_id', lote)
        .in('forma', FORMAS_CARTAO);
      if (error) throw new Error(error.message);
      return data || [];
    },
  );
  return montarTitulos(vendas, pagamentos);
}

/**
 * Pagamentos apontados por vínculos manuais ({ filial, titulo } com titulo
 * negativo = −id do pagamento) que ficaram fora do período buscado.
 */
export async function buscarPagamentosPdvPorRef(refs) {
  const ids = [...new Set((refs || []).map((r) => idDoPagamento(r.titulo)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];
  const pagamentos = await emLotes(ids, async (lote) => {
    const { data, error } = await supabase.from('pdv_venda_pagamentos').select(COLUNAS_PAGAMENTO).in('id', lote);
    if (error) throw new Error(error.message);
    return data || [];
  });
  if (!pagamentos.length) return [];
  const vendas = await emLotes([...new Set(pagamentos.map((p) => p.venda_id))], async (lote) => {
    const { data, error } = await supabase.from('pdv_vendas').select(COLUNAS_VENDA).in('id', lote);
    if (error) throw new Error(error.message);
    return data || [];
  });
  return montarTitulos(vendas, pagamentos);
}

const FORMAS_PDV = {
  credito: 'Cartão crédito',
  debito: 'Cartão débito',
  pix: 'PIX',
  dinheiro: 'Dinheiro',
  boleto: 'Boleto',
  vale_troca: 'Vale troca',
  adiantamento: 'Adiantamento',
  credito_loja: 'Crédito da loja',
  bluecard: 'BlueCard',
};

/**
 * Vendas do dia no PDV Crosby (drill-down do vínculo manual), no mesmo
 * formato de buscarTransacoesDia do TOTVS: uma venda com as formas de
 * pagamento; o pagamento em cartão leva o "titulo" negativo (−id) que o
 * vínculo manual grava.
 */
export async function buscarTransacoesDiaPdv({ empresas, dataIso }) {
  const codigos = [...new Set((empresas || []).map(Number).filter(Number.isFinite))];
  if (!codigos.length) return [];
  const { de, ate } = janelaUtc(dataIso, dataIso);
  const vendas = await todasAsPaginas(() =>
    supabase.from('pdv_vendas').select(COLUNAS_VENDA).in('empresa', codigos).gte('criado_em', de).lt('criado_em', ate).order('criado_em'),
  );
  if (!vendas.length) return [];
  const ids = vendas.map((v) => v.id);
  const [pagamentos, notas] = await Promise.all([
    emLotes(ids, async (lote) => {
      const { data, error } = await supabase.from('pdv_venda_pagamentos').select(COLUNAS_PAGAMENTO).in('venda_id', lote);
      if (error) throw new Error(error.message);
      return data || [];
    }),
    emLotes(ids, async (lote) => {
      const { data, error } = await supabase.from('pdv_notas_fiscais').select(COLUNAS_NOTA).in('venda_id', lote);
      return error ? [] : data || [];
    }),
  ]);
  const nota = notaPorVenda(notas);
  const porVenda = new Map();
  for (const p of pagamentos) (porVenda.get(p.venda_id) || porVenda.set(p.venda_id, []).get(p.venda_id)).push(p);
  const hora = (iso) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 19);
  return vendas
    .filter((v) => String(v.status).toLowerCase() !== 'cancelada' && porVenda.has(v.id))
    .map((v) => ({
      origem: 'headcoach',
      filial: Number(v.empresa),
      nf: nota.get(v.id)?.numero ?? null,
      sequencia: null,
      transacao: v.id,
      transacaoTotvs: v.totvs_transacao_code ?? null,
      data: dataIso,
      hora: v.criado_em ? hora(v.criado_em) : null,
      operacao: null,
      cliente: v.cliente_code ?? null,
      nomeCliente: v.cliente_nome || null,
      valorTotal: Number(v.total || 0),
      pagamentos: porVenda.get(v.id).map((p) => {
        const cartao = FORMAS_CARTAO.includes(p.forma);
        const t = cartao ? tituloDoPagamento(p, v, nota.get(v.id) || null) : null;
        return {
          forma: FORMAS_PDV[p.forma] || p.forma || 'Outros',
          tipoDoc: p.forma,
          valor: t ? t.valor : Math.round((Number(p.valor || 0) - Number(p.troco || 0)) * 100) / 100,
          parcelas: t ? t.parcelas : 1,
          titulo: t ? t.titulo : null,
          portador: t ? t.portador : null,
          portadorCodigo: null,
          bandeira: t && !t.bandeiraDesconhecida ? t.bandeira : null,
          nsu: p.nsu || null,
          autorizacao: p.autorizacao || null,
          cartao,
        };
      }),
    }));
}
