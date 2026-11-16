// ============================================================================
// VENDAS DO HEADCOACH PARA O NEW FORECAST / PAINEL DE VENDAS (Yago, 16/11/2026)
//
// Desde 10/11/2026 o Faturamento e o Faturamento Brejinho (empresa 99) emitem a
// NF-e pelo HeadCoach, e desde 13/11 a transação e o contas a receber ficam SÓ
// no HeadCoach. O New Forecast lia tudo do TOTVS (contas a receber + NFs), então
// essas vendas sumiam dos canais. Aqui elas saem do HeadCoach, já no formato que
// totvsrouter/painelVendas.js (faturamento-vendedor) soma:
//
//   • Revenda / Multimarcas / Franquias (pedidos RV, MT, PE, FR e avulsos)
//       → ATACADO, no vendedor da venda (161, 165, 21, 26, 259, 241, 40…).
//   • Faturamento Brejinho (chave BRJ:) → EXPEDIÇÃO / SHOWROOM (no TOTVS era a
//         operação 7254, sempre de franquia).
//   • Varejo da loja virtual (pedidos VJ) → VAREJO, empresa 99.
//
// CREDEV NUNCA ENTRA (diretriz do New Forecast): o valor de cada venda é o total
// menos o que foi pago com CREDEV (forma credito_loja); venda toda em CREDEV
// fica de fora. Vale para os três grupos.
//
// De 10 a 13/11 a venda também foi espelhada na empresa 990 do TOTVS (documento
// interno + contas a receber). O painel remove esse espelho (mesmo cliente e nº
// = NF ou transação do TOTVS) para não contar em dobro; no VAREJO o espelho já
// entra pelo painel oficial do TOTVS (operação 511), então a venda de varejo
// espelhada NÃO é somada de novo aqui (`espelhada: true`).
//
// Ficam de fora: transferências, "venda" para CNPJ do próprio grupo (também é
// transferência), notas de devolução (anulação de duplicada), vendas canceladas
// ou sem nota autorizada.
// ============================================================================
import supabase from '../config/supabase.js';
import { GRUPO_EMPRESA_POR_RAIZ } from '../totvsrouter/totvsHelper.js';

export const EMPRESA_HC_FATURAMENTO = 99;
// operação que o Brejinho tinha no TOTVS (showroom) — o Forecast separa por ela
export const OP_SHOWROOM_BREJINHO = 7254;
const CANAIS_ATACADO = ['revenda', 'mtm', 'franquias'];
const CANAIS_VENDA = [...CANAIS_ATACADO, 'varejo'];
const FORMA_CREDEV = 'credito_loja';

// Venda para CNPJ do próprio grupo não é venda, é transferência (Yago,
// 16/11/2026 — caso do avulso AV-MWFJLQ0O, R$ 18.702 faturados para o CNPJ da
// própria empresa 99). Raízes do grupo + Shopping Recife / Recife Mall.
const RAIZES_DO_GRUPO = new Set([...Object.keys(GRUPO_EMPRESA_POR_RAIZ), '36569459']);
export const ehCnpjDoGrupo = (doc) => {
  const d = String(doc || '').replace(/\D/g, '');
  return d.length === 14 && RAIZES_DO_GRUPO.has(d.slice(0, 8));
};

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const diaBrasil = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
};
const somaDias = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Vendas do Faturamento (origem "expedicao") com nota autorizada, pela data de
 * caixa da venda (senão a emissão da nota), de dmin a dmax.
 * Devolve { atacado: [], brejinho: [], varejo: [], espelhos: Set, espelhoClientes: Set }:
 * `espelhos` tem as chaves `${cliente}|${numero}` (NF e transação do TOTVS) e
 * `espelhoClientes` os clientes das vendas que também foram para a 990 do TOTVS.
 */
export async function vendasHeadcoachParaForecast({ dmin, dmax }) {
  const vendas = [];
  // a data de caixa pode ser anterior à gravação (caixa com a data voltada):
  // busca com folga e filtra pela data certa
  const de = `${somaDias(dmin, -1)}T00:00:00Z`;
  const ate = `${somaDias(dmax, 12)}T23:59:59Z`;
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await supabase
      .from('pdv_vendas')
      .select(
        'id, status, canal, pedido_chave, numero_site, cliente_code, cliente_nome, cliente_cpf_cnpj, vendedor_code, vendedor_nome, total, data_caixa, criado_em, totvs_transacao_code, pedido_info, pdv_venda_pagamentos(forma, valor), pdv_notas_fiscais(numero, status, dh_emissao)',
      )
      .eq('origem', 'expedicao')
      .eq('empresa', EMPRESA_HC_FATURAMENTO)
      .gte('criado_em', de)
      .lte('criado_em', ate)
      .order('id')
      .range(ini, ini + 999);
    if (error) throw new Error(`Vendas do HeadCoach: ${error.message}`);
    vendas.push(...(data || []));
    if ((data || []).length < 1000) break;
  }

  const out = {
    atacado: [],
    brejinho: [],
    varejo: [],
    espelhos: new Set(),
    espelhoClientes: new Set(),
    credevDescontado: 0, // CREDEV tirado das vendas que entraram em parte
    soCredev: { qtd: 0, valor: 0 }, // vendas 100% em CREDEV (não entram)
    doGrupo: { qtd: 0, valor: 0 }, // "venda" para CNPJ do grupo = transferência (não entra)
  };
  for (const v of vendas) {
    const cliente = Number(v.cliente_code) || 0;
    // Espelho no TOTVS: vale para QUALQUER venda que foi espelhada, inclusive a
    // cancelada aqui (ex.: pedido faturado em dobro, anulado por nota de
    // devolução) — a transação da 990 continua lá e não pode contar.
    if (v.totvs_transacao_code) {
      // o título da 990 nem sempre leva o nº da NF/transação (cartão sai com o
      // nº da liquidação, adiantamento com o do lançamento): o cliente basta,
      // porque a 990 só recebeu o espelho destas vendas
      out.espelhoClientes.add(cliente);
      out.espelhos.add(`${cliente}|${Number(v.totvs_transacao_code)}`);
      for (const n of v.pdv_notas_fiscais || []) if (n.numero) out.espelhos.add(`${cliente}|${Number(n.numero)}`);
    }
    if (v.status !== 'autorizada' || !CANAIS_VENDA.includes(v.canal)) continue;
    const nota = (v.pdv_notas_fiscais || []).find((n) => n.status === 'autorizada');
    if (!nota) continue;
    // régua do painel = data da transação/NF: a data de caixa da venda. A "venda do
    // dia" informada na tela (pedido_info.dataVenda) é só observação: o pedido
    // conta na semana em que foi faturado, como era no TOTVS.
    const data = v.data_caixa || diaBrasil(nota.dh_emissao) || diaBrasil(v.criado_em);
    if (!data || data < dmin || data > dmax) continue;
    const total = r2(v.total);
    if (!(total > 0)) continue;
    if (ehCnpjDoGrupo(v.cliente_cpf_cnpj)) {
      out.doGrupo.qtd += 1;
      out.doGrupo.valor = r2(out.doGrupo.valor + total);
      continue;
    }
    const credev = r2((v.pdv_venda_pagamentos || []).filter((p) => p.forma === FORMA_CREDEV).reduce((s, p) => s + Number(p.valor || 0), 0));
    const espelhada = !!v.totvs_transacao_code;
    const linha = {
      venda_id: v.id,
      data,
      branch_code: EMPRESA_HC_FATURAMENTO,
      fatura: Number(nota.numero), // nº da NF-e
      pedido: v.numero_site || null,
      cliente_code: cliente,
      cliente_nome: v.cliente_nome || null,
      vendedor_code: Number(v.vendedor_code) || 0,
      vendedor_nome: v.vendedor_nome || null,
      total,
      credev,
      espelhada,
    };
    // DIRETRIZ DO NEW FORECAST (Yago, 16/11/2026): CREDEV nunca entra. Venda de
    // 1.000 com 500 em CREDEV conta 500; venda toda em CREDEV não conta. Vale
    // para os três grupos (atacado, Brejinho e varejo).
    const valor = r2(total - credev);
    if (!(valor > 0)) {
      out.soCredev.qtd += 1;
      out.soCredev.valor = r2(out.soCredev.valor + total);
      continue;
    }
    if (credev > 0) out.credevDescontado = r2(out.credevDescontado + credev);
    if (String(v.pedido_chave || '').startsWith('BRJ:')) out.brejinho.push({ ...linha, valor });
    else if (v.canal === 'varejo') out.varejo.push({ ...linha, valor });
    else out.atacado.push({ ...linha, canal: v.canal, valor });
  }
  return out;
}
