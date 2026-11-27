// ============================================================================
// CONTAS FIXAS DAS LOJAS — meses ANTES de novembro/2026 (Yago, 26/11/2026).
// De janeiro a outubro as contas fixas (aluguel, condomínio, energia, água,
// internet, telefone) estavam no TOTVS. Aqui:
//   1) sincronizarContasFixasTotvs  lê os títulos do TOTVS (só leitura) e guarda
//      em contas_fixas_totvs_titulos — uma linha por título × despesa do rateio;
//   2) titulosTotvsDoMes            devolve os títulos do mês já CONFERIDOS:
//        • pago no TOTVS (data de liquidação), e/ou
//        • baixado pelo HeadCoach: saída conciliada no extrato
//          (contas_pagar_pagos_conciliacao), Liberação de Pagamento PAGO
//          (pagamentos_liberacao) ou o título do TOTVS copiado e baixado no Contas a
//          Pagar HeadCoach (hc_cp_titulos, origem totvs) — o TOTVS recebia a baixa
//          com atraso, ou nunca.
// A partir de novembro/2026 vale só o Contas a Pagar do HeadCoach (hc_cp_titulos).
// ============================================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';
import { isDuplicataAbatida } from '../utils/contasPagarAbatidas.js';

export const MES_INICIO_HEADCOACH = '2026-11'; // deste mês em diante a planilha usa só o HeadCoach
export const DESPESAS_FIXAS = [4001, 4005, 6010, 6011, 6028, 6012];
// empresas em que as contas das lojas eram lançadas (próprias + as da tela CTO)
export const EMPRESAS_TOTVS = [1, 2, 5, 6, 11, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99];

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const dia = (v) => (v ? String(v).slice(0, 10) : null);
const ultimoDia = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const mesesEntre = (de, ate) => {
  const out = [];
  let [a, m] = de.slice(0, 7).split('-').map(Number);
  const fim = ate.slice(0, 7);
  for (let i = 0; i < 60; i++) {
    const atual = `${a}-${String(m).padStart(2, '0')}`;
    if (atual > fim) break;
    out.push(atual);
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return out;
};

// ─── 1) TOTVS → HeadCoach ────────────────────────────────────────────────────
async function paginaTotvs(filter, page, token, tentativa = 1) {
  try {
    const r = await axios.post(`${TOTVS_BASE_URL}/accounts-payable/v2/duplicates/search`, { filter, page, pageSize: 100 }, { headers: { Authorization: `Bearer ${token.valor}`, 'Content-Type': 'application/json' }, httpsAgent, timeout: 90000 });
    return r.data || {};
  } catch (e) {
    if (e.response?.status === 401 && tentativa <= 2) {
      token.valor = (await getToken(true)).access_token;
      return paginaTotvs(filter, page, token, tentativa + 1);
    }
    if (tentativa <= 3 && (!e.response || e.response.status >= 500 || e.response.status === 429)) {
      await new Promise((ok) => setTimeout(ok, 1500 * tentativa));
      return paginaTotvs(filter, page, token, tentativa + 1);
    }
    throw new Error(`TOTVS (contas a pagar, página ${page}): ${e.response?.status || ''} ${e.message}`);
  }
}

/** Linhas da tabela a partir dos títulos crus do TOTVS (só as despesas fixas; sem as abatidas). */
export function linhasDosTitulos(itens, nomes = new Map()) {
  const linhas = [];
  for (const it of itens || []) {
    if (isDuplicataAbatida(it)) continue; // liquidada por desconto/ajuste, com valor pago zero: nunca aparece
    const despesas = Array.isArray(it.expense) ? it.expense : [];
    const total = Number(it.duplicateValue) || 0;
    despesas.forEach((e, i) => {
      if (!DESPESAS_FIXAS.includes(Number(e.expenseCode))) return;
      const pct = e.proratedPercentage != null ? Number(e.proratedPercentage) : 100;
      linhas.push({
        empresa: Number(it.branchCode),
        fornecedor_code: Number(it.supplierCode),
        duplicata: Number(it.duplicateCode),
        parcela: Number(it.installmentCode) || 1,
        linha: i + 1,
        despesa_code: Number(e.expenseCode),
        despesa_nome: e.expenseName || null,
        centro_custo_code: e.costCenterCode != null ? Number(e.costCenterCode) : null,
        percentual: round2(pct),
        valor: round2(e.proratedValue != null ? e.proratedValue : (total * pct) / 100),
        valor_titulo: round2(total),
        fornecedor_nome: nomes.get(Number(it.supplierCode)) || null,
        fornecedor_doc: it.supplierCpfCnpj ? String(it.supplierCpfCnpj).replace(/\D/g, '') : null,
        portador_code: it.bearerCode != null ? Number(it.bearerCode) : null,
        emissao: dia(it.issueDate),
        vencimento: dia(it.dueDate),
        liquidacao: dia(it.settlementDate),
        valor_pago_titulo: round2(it.paidValue || 0),
        juros: round2(it.feesValue || 0),
        desconto: round2(it.discountValue || 0),
        status: it.status || null,
        incluido_por: it.userInclusionName || null,
      });
    });
  }
  return linhas.filter((l) => l.vencimento);
}

async function nomesDosFornecedores(codigos) {
  const nomes = new Map();
  const lista = [...new Set(codigos.map(Number).filter((n) => n > 0))];
  for (let i = 0; i < lista.length; i += 300) {
    const { data } = await supabase.from('erp_pessoas').select('code, nome, fantasia').in('code', lista.slice(i, i + 300));
    for (const p of data || []) nomes.set(Number(p.code), p.nome || p.fantasia || null);
  }
  return nomes;
}

/**
 * Lê do TOTVS os títulos das contas fixas com vencimento entre `de` e `ate` (AAAA-MM-DD) e regrava
 * a cópia mês a mês (o mês só é trocado depois de lido inteiro). Só leitura no TOTVS.
 */
export async function sincronizarContasFixasTotvs({ de = '2026-01-01', ate = '2026-10-31', gravar = true, log = () => {} } = {}) {
  const token = { valor: (await getToken()).access_token };
  const resumo = [];
  for (const mes of mesesEntre(de, ate)) {
    const filter = { branchCodeList: EMPRESAS_TOTVS, startExpiredDate: `${mes}-01T00:00:00`, endExpiredDate: `${ultimoDia(mes)}T23:59:59`, status: 'Normal' };
    const primeira = await paginaTotvs(filter, 1, token);
    const itens = [...(primeira.items || [])];
    const paginas = primeira.totalPages || 1;
    for (let p = 2; p <= paginas; p += 5) {
      const lote = await Promise.all(Array.from({ length: Math.min(5, paginas - p + 1) }, (_, k) => paginaTotvs(filter, p + k, token)));
      for (const r of lote) itens.push(...(r.items || []));
    }
    const fixas = itens.filter((it) => (it.expense || []).some((e) => DESPESAS_FIXAS.includes(Number(e.expenseCode))));
    const linhas = linhasDosTitulos(fixas, await nomesDosFornecedores(fixas.map((x) => x.supplierCode)));
    const pagas = linhas.filter((l) => l.liquidacao).length;
    resumo.push({ mes, titulosNoTotvs: itens.length, linhas: linhas.length, pagasNoTotvs: pagas, valor: round2(linhas.reduce((s, l) => s + l.valor, 0)) });
    log(`${mes}: ${itens.length} títulos no TOTVS → ${linhas.length} linha(s) de contas fixas (${pagas} com baixa no TOTVS)`);
    if (!gravar) continue;
    const agora = new Date().toISOString();
    const { error: e1 } = await supabase.from('contas_fixas_totvs_titulos').delete().gte('vencimento', `${mes}-01`).lte('vencimento', ultimoDia(mes));
    if (e1) throw new Error(`limpar ${mes}: ${e1.message}`);
    for (let i = 0; i < linhas.length; i += 400) {
      const { error } = await supabase.from('contas_fixas_totvs_titulos').insert(linhas.slice(i, i + 400).map((l) => ({ ...l, sincronizado_em: agora })));
      if (error) throw new Error(`gravar ${mes}: ${error.message}`);
    }
  }
  return { de, ate, gravado: gravar, meses: resumo, linhas: resumo.reduce((s, r) => s + r.linhas, 0) };
}

// ─── 2) conferência: TOTVS × baixas do HeadCoach ─────────────────────────────
// null = um dos lados não tem o dado (não decide); true / false = igual / diferente
const mesmo = (a, b) => (a == null || b == null || a === '' || b === '' ? null : String(a) === String(b));
function casaComBaixa(t, b) {
  if (mesmo(t.empresa, b.cd_empresa) === false) return false;
  const forn = mesmo(t.fornecedor_code, b.cd_fornecedor);
  const parc = mesmo(t.parcela, b.nr_parcela);
  if (forn === false || parc === false) return false; // parcela diferente NUNCA casa
  if (forn === true || parc === true) return true;
  return b.vl_duplicata != null && Math.abs(Number(t.valor_titulo) - Number(b.vl_duplicata)) < 0.005;
}
async function baixasDoHeadcoach(duplicatas) {
  const conc = [];
  const lib = [];
  const hc = new Map(); // "empresa|fornecedor|duplicata|parcela" → título do TOTVS copiado e baixado no Contas a Pagar HeadCoach
  const lista = [...new Set(duplicatas.map(String))];
  for (let i = 0; i < lista.length; i += 200) {
    const fatia = lista.slice(i, i + 200);
    const c = await supabase.from('hc_cp_titulos').select('origem_ref, data_pagamento, valor_pago, valor, conta_pagamento').in('origem', ['totvs', 'replica-totvs']).eq('situacao', 'pago').in('documento_fiscal', fatia);
    if (c.error) throw new Error(`baixas no Contas a Pagar HeadCoach: ${c.error.message}`);
    for (const x of c.data || []) if (x.origem_ref) hc.set(String(x.origem_ref), x);
    const [a, b] = await Promise.all([
      supabase.from('contas_pagar_pagos_conciliacao').select('nr_duplicata, cd_empresa, nr_parcela, cd_fornecedor, dt_pagamento, vl_pago, banco, conciliacao_id').in('nr_duplicata', fatia.map(Number)),
      supabase.from('pagamentos_liberacao').select('nr_duplicata, cd_empresa, nr_parcela, cd_fornecedor, vl_duplicata, vl_real, dt_pagamento, pago_em, banco_pagamento').eq('status', 'PAGO').in('nr_duplicata', fatia),
    ]);
    if (a.error) throw new Error(`baixas pela conciliação: ${a.error.message}`);
    if (b.error) throw new Error(`baixas pela Liberação: ${b.error.message}`);
    conc.push(...(a.data || []));
    lib.push(...(b.data || []));
  }
  const agrupar = (l) => l.reduce((m, x) => m.set(String(x.nr_duplicata), [...(m.get(String(x.nr_duplicata)) || []), x]), new Map());
  return { conc: agrupar(conc), lib: agrupar(lib), hc };
}

/**
 * Títulos das contas fixas do mês (pelo vencimento), cada um com a conferência:
 *   totvs      { data, valor } | null   baixa no TOTVS
 *   headcoach  { tipo: 'conciliacao' | 'liberacao' | 'contas_pagar', data, valor, banco } | null   baixa feita pelo HeadCoach
 *   situacao   'pago' | 'aberto'  ·  pagoOnde  'totvs' | 'totvs+headcoach' | 'headcoach' | null
 */
export async function titulosTotvsDoMes(mes) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from('contas_fixas_totvs_titulos').select('*').gte('vencimento', `${mes}-01`).lte('vencimento', ultimoDia(mes)).order('vencimento').order('id').range(de, de + 999);
    if (error) throw error;
    linhas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  if (!linhas.length) return { titulos: [], sincronizadoEm: null };
  const { conc, lib, hc } = await baixasDoHeadcoach(linhas.map((l) => l.duplicata));
  const titulos = linhas.map((t) => {
    const fracao = Number(t.valor_titulo) > 0 ? Number(t.valor) / Number(t.valor_titulo) : 1;
    const totvs = t.liquidacao ? { data: dia(t.liquidacao), valor: round2((Number(t.valor_pago_titulo) || Number(t.valor_titulo)) * fracao) } : null;
    const c = (conc.get(String(t.duplicata)) || []).find((b) => casaComBaixa(t, b));
    const l = c ? null : (lib.get(String(t.duplicata)) || []).find((b) => casaComBaixa(t, b));
    const h = c || l ? null : hc.get(`${t.empresa}|${t.fornecedor_code}|${t.duplicata}|${t.parcela}`) || null;
    const headcoach = c
      ? { tipo: 'conciliacao', data: dia(c.dt_pagamento), valor: round2((Number(c.vl_pago) || Number(t.valor_titulo)) * fracao), banco: c.banco || null }
      : l
        ? { tipo: 'liberacao', data: dia(l.dt_pagamento || l.pago_em), valor: round2((Number(l.vl_real) || Number(l.vl_duplicata) || Number(t.valor_titulo)) * fracao), banco: l.banco_pagamento || null }
        : h
          ? { tipo: 'contas_pagar', data: dia(h.data_pagamento), valor: round2((Number(h.valor_pago) || Number(h.valor) || Number(t.valor_titulo)) * fracao), banco: h.conta_pagamento || null }
          : null;
    return { ...t, totvs, headcoach, situacao: totvs || headcoach ? 'pago' : 'aberto', pagoOnde: totvs && headcoach ? 'totvs+headcoach' : totvs ? 'totvs' : headcoach ? 'headcoach' : null };
  });
  return { titulos, sincronizadoEm: linhas.map((l) => l.sincronizado_em).sort().at(-1) || null };
}
