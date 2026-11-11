// Auditoria (Titia, 11/11/2026): pagos via conciliação aparecem PAGO + data no
// Contas a Pagar - Consulta? Há título pago e em aberto ao mesmo tempo?
import 'dotenv/config';
import fs from 'fs';
import supabase from '../../config/supabase.js';

const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const ORIG = new Set(['TOTVS_CP', 'LIBERACAO', 'SOLICITACAO']);
async function todos(build, page = 1000) {
  const out = [];
  for (let f = 0; ; f += page) {
    const { data, error } = await build().range(f, f + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return out;
}
const emLotes = async (vals, n, fn) => {
  const out = [];
  for (let i = 0; i < vals.length; i += n) out.push(...(await fn(vals.slice(i, i + n))));
  return out;
};

const concs = await todos(() => supabase.from('fluxo_caixa_conciliacoes').select('id,conta_id,lancamento_id,data,valor,origem,referencia,justificativa,usuario').lt('valor', 0).in('origem', ['TOTVS_CP', 'LIBERACAO', 'SOLICITACAO', 'MULTIPLO']).order('id'));
const pagos = await todos(() => supabase.from('contas_pagar_pagos_conciliacao').select('*').order('id'));
const pagosPorConc = new Map();
for (const p of pagos) {
  if (!pagosPorConc.has(p.conciliacao_id)) pagosPorConc.set(p.conciliacao_id, []);
  pagosPorConc.get(p.conciliacao_id).push(p);
}
const itensDe = (c) => {
  const ref = c.referencia || {};
  if (Array.isArray(ref.itens) && ref.itens.length) return ref.itens.filter((it) => ORIG.has(it.origem) && it.id != null).map((it) => ({ origem: it.origem, id: it.id, nome: it.nome, valor: r2(Math.abs(it.valorUsado ?? it.valor ?? 0)) }));
  if (ORIG.has(c.origem) && ref.id != null) return [{ origem: c.origem, id: ref.id, nome: ref.nome, valor: r2(Math.abs(c.valor)) }];
  return [];
};

// 1) conciliações que deviam aparecer PAGO e não geraram linha
const semLinha = [];
for (const c of concs) {
  const itens = itensDe(c);
  if (!itens.length) continue;
  const n = (pagosPorConc.get(c.id) || []).length;
  if (n < itens.length) semLinha.push({ conc: c.id, data: c.data, valor: r2(Math.abs(c.valor)), origem: c.origem, itens: itens.length, linhas: n, nome: itens.map((i) => i.nome).filter(Boolean).join(' / ') || c.justificativa, ids: itens.map((i) => `${i.origem}:${i.id}`).join(' ') });
}

// 2) cada linha "pago via conciliação" × cópia do TOTVS
const dups = [...new Set(pagos.map((p) => p.nr_duplicata))];
const espelho = await emLotes(dups, 200, async (l) => (await supabase.from('accounts_payable_duplicates_v').select('branch_code,supplier_code,supplier_name,duplicate_code,installment_code,due_date,issue_date,settlement_date,status,duplicate_value,paid_value').in('duplicate_code', l)).data || []);
const espDe = new Map();
for (const e of espelho) {
  const k = String(e.duplicate_code);
  if (!espDe.has(k)) espDe.set(k, []);
  espDe.get(k).push(e);
}
const cmp = (a, b) => (a == null || b == null ? null : Number(a) === Number(b));
const casa = (e, p) => {
  if (cmp(e.branch_code, p.cd_empresa) === false) return false;
  const pa = cmp(e.installment_code, p.nr_parcela);
  const fo = cmp(e.supplier_code, p.cd_fornecedor);
  if (pa === false || fo === false) return false;
  return pa === true || fo === true;
};
const naoCasa = [];
const casados = []; // { p, e }
for (const p of pagos) {
  const lista = (espDe.get(String(p.nr_duplicata)) || []).filter((e) => casa(e, p));
  if (!lista.length) naoCasa.push({ ...p, motivo: (espDe.get(String(p.nr_duplicata)) || []).length ? 'duplicata existe no TOTVS mas empresa/parcela/fornecedor não batem' : p.nr_parcela == null && p.cd_fornecedor == null ? 'sem parcela e sem fornecedor (a tela não consegue casar)' : 'duplicata não está na cópia do TOTVS' });
  else for (const e of lista) casados.push({ p, e });
}

// 3a) mesma duplicata/parcela paga por mais de uma conciliação
const porTitulo = new Map();
for (const { p, e } of casados) {
  const k = `${e.branch_code}|${e.duplicate_code}|${e.installment_code}|${e.supplier_code}`;
  if (!porTitulo.has(k)) porTitulo.set(k, { e, pagos: [] });
  porTitulo.get(k).pagos.push(p);
}
const pagoDuasVezes = [...porTitulo.values()].filter((x) => new Set(x.pagos.map((p) => p.conciliacao_id)).size > 1);
// título pago a mais (soma conciliada > valor)
const pagoAMais = [...porTitulo.values()].filter((x) => r2(x.pagos.reduce((s, p) => s + Number(p.vl_pago), 0)) > r2(x.e.duplicate_value) + 0.05);

// 3b) pago via conciliação × outro título EM ABERTO do mesmo fornecedor e valor (vencimento ±20 dias)
const chavesPagas = new Set(porTitulo.keys());
const fornecedores = [...new Set(casados.map(({ e }) => e.supplier_code))];
const abertosForn = await emLotes(fornecedores, 100, async (l) =>
  (await todos(() => supabase.from('accounts_payable_duplicates_v').select('branch_code,supplier_code,supplier_name,duplicate_code,installment_code,due_date,issue_date,settlement_date,status,duplicate_value,paid_value').in('supplier_code', l).is('settlement_date', null).order('duplicate_code').order('installment_code').order('branch_code'))),
);
const abertosDe = new Map();
for (const a of abertosForn) {
  if (Number(a.paid_value) > 0) continue;
  if (chavesPagas.has(`${a.branch_code}|${a.duplicate_code}|${a.installment_code}|${a.supplier_code}`)) continue;
  const k = String(a.supplier_code);
  if (!abertosDe.has(k)) abertosDe.set(k, []);
  abertosDe.get(k).push(a);
}
const dias = (a, b) => Math.abs((new Date(String(a).slice(0, 10)) - new Date(String(b).slice(0, 10))) / 86400000);
const duplicidades = [];
for (const { e, pagos: ps } of porTitulo.values()) {
  for (const a of abertosDe.get(String(e.supplier_code)) || []) {
    if (Math.abs(r2(a.duplicate_value) - r2(e.duplicate_value)) > 0.01) continue;
    if (dias(a.due_date, e.due_date) > 20) continue;
    duplicidades.push({ pago: e, conc: ps.map((p) => p.conciliacao_id).join(','), dtPagamento: ps[0].dt_pagamento, aberto: a });
  }
}

const statusTot = { pagoNoTotvs: 0, abertoNoTotvsPagoHeadcoach: 0 };
for (const { e } of porTitulo.values()) e.settlement_date || Number(e.paid_value) > 0 ? statusTot.pagoNoTotvs++ : statusTot.abertoNoTotvsPagoHeadcoach++;

const res = {
  conciliacoes: concs.length,
  linhasPagos: pagos.length,
  titulosPagosViaConciliacao: porTitulo.size,
  statusTot,
  semLinha,
  naoCasa,
  pagoDuasVezes: pagoDuasVezes.map((x) => ({ titulo: x.e, pagos: x.pagos })),
  pagoAMais: pagoAMais.map((x) => ({ titulo: x.e, soma: r2(x.pagos.reduce((s, p) => s + Number(p.vl_pago), 0)), pagos: x.pagos })),
  duplicidades,
};
fs.writeFileSync('scripts/tmp/auditoria_pagos_conc.json', JSON.stringify(res, null, 1));
console.log(JSON.stringify({ conciliacoes: res.conciliacoes, linhasPagos: res.linhasPagos, titulos: res.titulosPagosViaConciliacao, statusTot, semLinha: semLinha.length, naoCasa: naoCasa.length, pagoDuasVezes: pagoDuasVezes.length, pagoAMais: pagoAMais.length, duplicidades: duplicidades.length }));
setTimeout(() => process.exit(0), 100);
