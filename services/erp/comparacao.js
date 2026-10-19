// Conferência TOTVS × HeadCoach (fase 1): busca o mesmo período nos dois
// lados e cruza registro a registro pela chave da API.
//
//   comparar(modulo, { de, ate, empresas })  → { resumo, porDia, porEmpresa, divergencias }
//   corrigir(modulo, { de, ate, empresas })  → regrava no HeadCoach o que o TOTVS devolveu
//
// Módulos: contas_pagar (emissão), contas_receber (emissão), transacoes (data da transação).
import { totvs, paginar } from './totvsClient.js';
import { supabase } from './db.js';
import { mapDuplicata, gravarDuplicatas, SEARCH_PATH as AP_PATH, PAGE_SIZE as AP_PAGE } from './contasPagar.js';
import { mapTitulo, gravarTitulos, SEARCH_PATH as AR_PATH, EXPAND as AR_EXPAND, PAGE_SIZE as AR_PAGE } from './contasReceber.js';
import { mapTransacao, gravarTransacoes, SEARCH_PATH as TR_PATH, EXPAND as TR_EXPAND, PAGE_SIZE as TR_PAGE, todasEmpresas } from './vendas.js';
import { FILIAIS } from '../../config/sefazFiliais.js';

export const MODULOS = {
  contas_pagar: {
    rotulo: 'Contas a pagar',
    tabela: 'accounts_payable_duplicates',
    chave: ['branch_code', 'supplier_code', 'duplicate_code', 'installment_code'],
    campoData: 'issue_date',
    dataTimestamp: true,
    campoValor: 'duplicate_value',
    campoPessoa: 'supplier_code',
    campos: ['supplier_cpf_cnpj', 'bearer_code', 'entry_date', 'issue_date', 'due_date', 'settlement_date', 'arrival_date', 'status', 'duplicate_value', 'fees_value', 'discount_value', 'paid_value', 'expense', 'inclusion_type'],
    maxDias: 62,
    precisaEmpresa: false,
  },
  contas_receber: {
    rotulo: 'Contas a receber',
    tabela: 'accounts_receivable_documents',
    chave: ['branch_code', 'customer_code', 'receivable_code', 'installment_code'],
    campoData: 'issue_date',
    dataTimestamp: false,
    campoValor: 'installment_value',
    campoPessoa: 'customer_code',
    campos: ['customer_cpf_cnpj', 'expired_date', 'payment_date', 'issue_date', 'settlement_branch_code', 'settlement_date', 'settlement_sequence', 'status', 'document_type', 'billing_type', 'discharge_type', 'charge_type', 'bearer_code', 'installment_value', 'paid_value', 'discount_value', 'rebate_value', 'interest_value', 'assessment_value', 'bar_code', 'digitable_line', 'our_number', 'invoice'],
    maxDias: 62,
    precisaEmpresa: false,
  },
  transacoes: {
    rotulo: 'Transações',
    tabela: 'general_transactions',
    chave: ['branch_code', 'transaction_code'],
    campoData: 'transaction_date',
    dataTimestamp: false,
    campoValor: 'total_value',
    campoPessoa: 'customer_code',
    campos: ['transaction_date', 'customer_code', 'representative_code', 'operation_code', 'seller_code', 'payment_condition_code', 'price_table_code', 'status', 'gross_amount_value', 'total_value', 'discount_value', 'items', 'installment', 'classifications'],
    maxDias: 31,
    precisaEmpresa: true, // a API busca 1 empresa × 1 dia por chamada
  },
};

const MAX_CHAMADAS_TRANSACOES = Math.max(50, parseInt(process.env.ERP_CONFERENCIA_MAX_CHAMADAS || '600', 10));

// ─── helpers ────────────────────────────────────────────────────────────────
const ehDia = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dias = (de, ate) => {
  const out = [];
  for (let d = new Date(`${de}T00:00:00Z`); d <= new Date(`${ate}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) out.push(d.toISOString().slice(0, 10));
  return out;
};
const sortDeep = (v) => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v);
const ehNum = (v) => v !== null && v !== '' && typeof v !== 'object' && Number.isFinite(Number(v));
/** true quando os dois valores são iguais para efeito de conferência */
export function iguais(a, b) {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (a === null && b === null) return true;
  if (ehNum(a) && ehNum(b)) return Math.abs(Number(a) - Number(b)) < 0.005;
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
}
const chaveDe = (def, r) => def.chave.map((c) => r[c]).join('|');
const num = (v) => (ehNum(v) ? Number(v) : 0);
const round2 = (v) => Math.round(v * 100) / 100;

/** Resolve a lista de empresas pedida: null (todas), 'proprias', '1,2,5' ou array. */
export async function resolverEmpresas(empresas) {
  if (!empresas || empresas === 'todas') return null;
  if (empresas === 'proprias') return FILIAIS.map((f) => f.codigo);
  const lista = (Array.isArray(empresas) ? empresas : String(empresas).split(',')).map((e) => parseInt(e, 10)).filter((n) => Number.isFinite(n) && n > 0);
  return lista.length ? [...new Set(lista)] : null;
}

function validar(modulo, { de, ate, empresas }) {
  const def = MODULOS[modulo];
  if (!def) throw Object.assign(new Error(`Módulo inválido: ${modulo}. Opções: ${Object.keys(MODULOS).join(', ')}`), { status: 400 });
  if (!ehDia(de) || !ehDia(ate) || de > ate) throw Object.assign(new Error('Informe de e ate no formato AAAA-MM-DD, com de ≤ ate'), { status: 400 });
  const nDias = dias(de, ate).length;
  if (nDias > def.maxDias) throw Object.assign(new Error(`${def.rotulo}: período máximo de ${def.maxDias} dias por conferência`), { status: 400 });
  return { def, nDias };
}

// ─── TOTVS ──────────────────────────────────────────────────────────────────
async function buscarTotvs(modulo, { de, ate, empresas }) {
  const { def } = validar(modulo, { de, ate, empresas });
  const itens = [];
  if (modulo === 'contas_pagar') {
    const branchCodeList = empresas || (await todasEmpresas());
    await paginar({
      path: AP_PATH,
      data: { filter: { branchCodeList, startIssueDate: `${de}T00:00:00`, endIssueDate: `${ate}T23:59:59` } },
      pageSize: AP_PAGE,
      onPage: (it) => itens.push(...it.map(mapDuplicata)),
    });
    return itens;
  }
  if (modulo === 'contas_receber') {
    const filter = { startIssueDate: de, endIssueDate: ate };
    if (empresas) filter.branchCodeList = empresas;
    await paginar({
      path: AR_PATH,
      data: { filter, expand: AR_EXPAND },
      pageSize: AR_PAGE,
      onPage: (it) => itens.push(...it.map(mapTitulo)),
    });
    return itens;
  }
  // transações: 1 empresa × 1 dia por chamada
  const lista = empresas || (await todasEmpresas());
  const ds = dias(de, ate);
  if (lista.length * ds.length > MAX_CHAMADAS_TRANSACOES) {
    throw Object.assign(new Error(`Transações: ${lista.length} empresas × ${ds.length} dias = ${lista.length * ds.length} consultas ao TOTVS (máximo ${MAX_CHAMADAS_TRANSACOES}). Reduza o período ou escolha menos empresas.`), { status: 400 });
  }
  const puladas = [];
  for (const branch of lista) {
    for (const d of ds) {
      try {
        await paginar({
          method: 'get',
          path: TR_PATH,
          params: { BranchCodeList: branch, TransactionDate: d, Expand: TR_EXPAND },
          pageSize: TR_PAGE,
          onPage: (it) => itens.push(...it.map(mapTransacao)),
        });
      } catch (e) {
        if (e.status && e.status < 500) puladas.push({ branch, dia: d, erro: e.message.slice(0, 160) });
        else throw e;
      }
    }
  }
  itens.puladas = puladas;
  return itens;
}

// ─── HeadCoach ──────────────────────────────────────────────────────────────
async function buscarLocal(modulo, { de, ate, empresas }) {
  const def = MODULOS[modulo];
  const ini = def.dataTimestamp ? `${de}T00:00:00` : de;
  const fim = def.dataTimestamp ? `${ate}T23:59:59` : ate;
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(def.tabela).select('*').gte(def.campoData, ini).lte(def.campoData, fim).order(def.chave[0]).order(def.chave[1]).range(from, from + 999);
    if (empresas) q = q.in('branch_code', empresas);
    const { data, error } = await q;
    if (error) throw new Error(`${def.tabela}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ─── Comparação ─────────────────────────────────────────────────────────────
export async function comparar(modulo, { de, ate, empresas = null, limiteDivergencias = 500 } = {}) {
  const { def } = validar(modulo, { de, ate, empresas });
  const emps = await resolverEmpresas(empresas);
  const t0 = Date.now();
  const [totvsItens, locais] = await Promise.all([buscarTotvs(modulo, { de, ate, empresas: emps }), buscarLocal(modulo, { de, ate, empresas: emps })]);

  const mT = new Map(totvsItens.map((r) => [chaveDe(def, r), r]));
  const mL = new Map(locais.map((r) => [chaveDe(def, r), r]));

  const porDia = new Map();
  const porEmpresa = new Map();
  const bump = (mapa, k, campo, qtd = 1, valor = 0) => {
    const cur = mapa.get(k) || { totvs_qtd: 0, totvs_valor: 0, headcoach_qtd: 0, headcoach_valor: 0, iguais: 0, diferentes: 0, so_totvs: 0, so_headcoach: 0 };
    cur[campo] += qtd;
    if (campo === 'totvs_qtd') cur.totvs_valor = round2(cur.totvs_valor + valor);
    if (campo === 'headcoach_qtd') cur.headcoach_valor = round2(cur.headcoach_valor + valor);
    mapa.set(k, cur);
  };
  const diaDe = (r) => String(r[def.campoData] || '').slice(0, 10) || '—';

  const divergencias = [];
  const resumo = { totvs: { qtd: 0, valor: 0 }, headcoach: { qtd: 0, valor: 0 }, iguais: 0, diferentes: 0, so_totvs: 0, so_headcoach: 0 };
  const add = (tipo, r, difs = null, outro = null) => {
    if (divergencias.length < limiteDivergencias) {
      divergencias.push({
        tipo,
        chave: Object.fromEntries(def.chave.map((c) => [c, r[c]])),
        empresa: r.branch_code,
        pessoa: r[def.campoPessoa] ?? null,
        data: diaDe(r),
        valor_totvs: tipo === 'so_headcoach' ? null : num(r[def.campoValor]),
        valor_headcoach: tipo === 'so_totvs' ? null : num((outro || r)[def.campoValor]),
        status_totvs: tipo === 'so_headcoach' ? null : r.status,
        status_headcoach: tipo === 'so_totvs' ? null : (outro || r).status,
        origem_headcoach: tipo === 'so_totvs' ? null : (outro || r).origem,
        campos: difs,
      });
    }
  };

  for (const [k, t] of mT) {
    const valor = num(t[def.campoValor]);
    resumo.totvs.qtd += 1;
    resumo.totvs.valor += valor;
    bump(porDia, diaDe(t), 'totvs_qtd', 1, valor);
    bump(porEmpresa, t.branch_code, 'totvs_qtd', 1, valor);
    const l = mL.get(k);
    if (!l) {
      resumo.so_totvs += 1;
      bump(porDia, diaDe(t), 'so_totvs');
      bump(porEmpresa, t.branch_code, 'so_totvs');
      add('so_totvs', t);
      continue;
    }
    const difs = [];
    for (const c of def.campos) if (!iguais(t[c], l[c])) difs.push({ campo: c, totvs: t[c] ?? null, headcoach: l[c] ?? null });
    if (difs.length) {
      resumo.diferentes += 1;
      bump(porDia, diaDe(t), 'diferentes');
      bump(porEmpresa, t.branch_code, 'diferentes');
      add('diferente', t, difs, l);
    } else {
      resumo.iguais += 1;
      bump(porDia, diaDe(t), 'iguais');
      bump(porEmpresa, t.branch_code, 'iguais');
    }
  }
  for (const [k, l] of mL) {
    const valor = num(l[def.campoValor]);
    resumo.headcoach.qtd += 1;
    resumo.headcoach.valor += valor;
    bump(porDia, diaDe(l), 'headcoach_qtd', 1, valor);
    bump(porEmpresa, l.branch_code, 'headcoach_qtd', 1, valor);
    if (!mT.has(k)) {
      resumo.so_headcoach += 1;
      bump(porDia, diaDe(l), 'so_headcoach');
      bump(porEmpresa, l.branch_code, 'so_headcoach');
      add('so_headcoach', l);
    }
  }
  resumo.totvs.valor = round2(resumo.totvs.valor);
  resumo.headcoach.valor = round2(resumo.headcoach.valor);
  resumo.divergencias = resumo.diferentes + resumo.so_totvs + resumo.so_headcoach;
  resumo.aderencia = resumo.totvs.qtd ? round2((resumo.iguais / resumo.totvs.qtd) * 100) : null;

  // contagem de campos mais divergentes
  const campos = {};
  for (const d of divergencias) for (const c of d.campos || []) campos[c.campo] = (campos[c.campo] || 0) + 1;

  const { data: nomes } = await supabase.from('erp_empresas').select('code,descricao').in('code', [...porEmpresa.keys()]);
  const nome = new Map((nomes || []).map((e) => [e.code, e.descricao]));

  return {
    modulo,
    rotulo: def.rotulo,
    de,
    ate,
    empresas: emps,
    chave: def.chave,
    campos_comparados: def.campos,
    resumo,
    porDia: [...porDia].map(([dia, v]) => ({ dia, ...v })).sort((a, b) => a.dia.localeCompare(b.dia)),
    porEmpresa: [...porEmpresa]
      .map(([empresa, v]) => ({ empresa, nome: nome.get(empresa) || null, ...v, divergencias: v.diferentes + v.so_totvs + v.so_headcoach }))
      .sort((a, b) => b.divergencias - a.divergencias || b.totvs_qtd - a.totvs_qtd),
    camposDivergentes: Object.entries(campos).sort((a, b) => b[1] - a[1]).map(([campo, qtd]) => ({ campo, qtd })),
    divergencias,
    divergenciasTruncadas: resumo.divergencias > divergencias.length,
    puladas: totvsItens.puladas || [],
    duracaoMs: Date.now() - t0,
  };
}

/** Regrava no HeadCoach tudo que o TOTVS devolveu no período (o TOTVS vence). Não apaga o que só existe no HeadCoach. */
export async function corrigir(modulo, { de, ate, empresas = null } = {}) {
  validar(modulo, { de, ate, empresas });
  const emps = await resolverEmpresas(empresas);
  const itens = await buscarTotvs(modulo, { de, ate, empresas: emps });
  const brutos = itens.map((r) => r.dados);
  let gravados = 0;
  if (modulo === 'contas_pagar') gravados = await gravarDuplicatas(brutos);
  else if (modulo === 'contas_receber') gravados = await gravarTitulos(brutos);
  else gravados = await gravarTransacoes(brutos);
  return { modulo, de, ate, empresas: emps, totvs: itens.length, gravados, puladas: itens.puladas || [] };
}

export const listarModulos = () => Object.entries(MODULOS).map(([id, d]) => ({ id, rotulo: d.rotulo, maxDias: d.maxDias, precisaEmpresa: d.precisaEmpresa, chave: d.chave, campos: d.campos }));

export { totvs };
