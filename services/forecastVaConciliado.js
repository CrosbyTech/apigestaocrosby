// Vale Alimentação do Forecast a partir de out/2026 (Niziany, 26/11/2026).
//
// Os pagamentos passaram a sair pelas Solicitações Crosby, Liberação de Pagamento
// e Contas a Pagar do HeadCoach, e a duplicata do TOTVS ficou sem baixa. Então o
// VA deixa de ser "liquidado no TOTVS" e passa a ser: os pagamentos CONCILIADOS
// no extrato (fluxo_caixa_conciliacoes) cujo VENCIMENTO cai no mês, só a parte da
// natureza 3003 (VALE ALIMENTACAO E REFEICAO). Cada saída do banco é conciliada
// uma vez só, então não há contagem em dobro entre as origens.
import supabase from '../config/supabase.js';

export const VA_CONCILIADO_DESDE = '2026-10';
const EXP_VA = 3003;
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const ultimoDia = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
const menosDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

async function todas(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

async function emLotes(ids, buscar) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...(await buscar(ids.slice(i, i + 200))));
  return out;
}

/** Itens pagos (com vencimento no mês) de cada conciliação, com a origem de cada um. */
function itensDoMes(rows, de, ate) {
  const itens = [];
  for (const row of rows) {
    const ref = row.referencia;
    if (!ref) continue;
    const lista = Array.isArray(ref.itens) && ref.itens.length ? ref.itens : [ref];
    for (const it of lista) {
      const origem = it.origem || row.origem;
      const venc = String(it.vencimento || '').slice(0, 10);
      if (!venc || venc < de || venc > ate || it.id == null) continue;
      const valor = num(it.valorUsado ?? it.valor ?? (lista.length === 1 ? Math.abs(num(row.valor)) : 0));
      if (valor > 0) itens.push({ origem, id: String(it.id), valor, doc: String(it.doc || '').replace(/\D/g, '') || null, nome: it.nome || null, empresa: it.empresa || null, vencimento: venc });
    }
  }
  return itens;
}

/** Percentual da natureza VA em cada documento, por origem. */
async function percentuaisVa(itens) {
  const pct = new Map(); // `${origem}:${id}` → %
  const ids = (o) => [...new Set(itens.filter((i) => i.origem === o).map((i) => i.id))];
  const docDe = new Map(itens.map((i) => [`${i.origem}:${i.id}`, i.doc]));

  // Solicitação e Liberação nem sempre guardam a natureza: aí vale a da duplicata
  // do TOTVS que elas geraram/pagaram (empresa + nº da duplicata).
  const semNatureza = []; // { chave, empresa, duplicata, parcela }
  const sol = await emLotes(ids('SOLICITACAO'), async (l) => (await supabase.from('solicitacoes_crosby').select('id, despesa_code, cd_empresa, duplicate_code').in('id', l)).data || []);
  for (const s of sol) {
    if (s.despesa_code != null) pct.set(`SOLICITACAO:${s.id}`, Number(s.despesa_code) === EXP_VA ? 100 : 0);
    else if (s.duplicate_code) semNatureza.push({ chave: `SOLICITACAO:${s.id}`, empresa: Number(s.cd_empresa), duplicata: Number(s.duplicate_code), parcela: null });
  }

  const lib = await emLotes(ids('LIBERACAO'), async (l) => (await supabase.from('pagamentos_liberacao').select('id, cd_despesaitem, cd_empresa, nr_duplicata, nr_parcela').in('id', l)).data || []);
  for (const x of lib) {
    if (x.cd_despesaitem != null) pct.set(`LIBERACAO:${x.id}`, Number(x.cd_despesaitem) === EXP_VA ? 100 : 0);
    else if (x.nr_duplicata) semNatureza.push({ chave: `LIBERACAO:${x.id}`, empresa: Number(x.cd_empresa), duplicata: Number(x.nr_duplicata), parcela: x.nr_parcela != null ? Number(x.nr_parcela) : null });
  }

  const dupsSem = [...new Set(semNatureza.map((s) => s.duplicata).filter(Number.isFinite))];
  const apSem = await emLotes(dupsSem, async (l) => (await supabase.from('accounts_payable_duplicates').select('branch_code, duplicate_code, installment_code, supplier_cpf_cnpj, expense').in('duplicate_code', l)).data || []);
  for (const s of semNatureza) {
    const doc = docDe.get(s.chave);
    const a = apSem.find((x) => x.branch_code === s.empresa && x.duplicate_code === s.duplicata && (s.parcela == null || x.installment_code === s.parcela) && (!doc || String(x.supplier_cpf_cnpj || '').replace(/\D/g, '') === doc));
    if (!a) continue;
    const linhas = (a.expense || []).filter((e) => Number(e.expenseCode) === EXP_VA);
    pct.set(s.chave, linhas.reduce((t, e) => t + num(e.proratedPercentage), 0));
  }

  const hcIds = ids('HC_CP').map(Number).filter(Number.isFinite);
  const hc = await emLotes(hcIds, async (l) => (await supabase.from('hc_cp_titulos').select('id, rateio').in('id', l)).data || []);
  for (const t of hc) {
    const p = (t.rateio || []).filter((r) => Number(r.despesa_code) === EXP_VA).reduce((a, r) => a + num(r.percentual), 0);
    pct.set(`HC_CP:${t.id}`, p);
  }

  // TOTVS_CP: id = "empresa|duplicata|parcela|fornecedor"
  const totvs = ids('TOTVS_CP');
  const porDup = new Map();
  for (const id of totvs) {
    const [b, d, p, f] = id.split('|').map(Number);
    if ([b, d, p, f].every(Number.isFinite)) porDup.set(id, { b, d, p, f });
  }
  const dups = [...new Set([...porDup.values()].map((x) => x.d))];
  const ap = await emLotes(dups, async (l) => (await supabase.from('accounts_payable_duplicates').select('branch_code, duplicate_code, installment_code, supplier_code, expense').in('duplicate_code', l)).data || []);
  for (const [id, k] of porDup) {
    const a = ap.find((x) => x.branch_code === k.b && x.duplicate_code === k.d && x.installment_code === k.p && x.supplier_code === k.f);
    if (!a) continue;
    const linhas = (a.expense || []).filter((e) => Number(e.expenseCode) === EXP_VA);
    pct.set(`TOTVS_CP:${id}`, linhas.reduce((s, e) => s + num(e.proratedPercentage), 0));
  }
  return pct;
}

/**
 * VA do mês pelos pagamentos conciliados (vencimento no mês, natureza 3003).
 * Busca conciliações de 45 dias antes do mês até hoje (pagamento antecipado ou atrasado).
 */
export async function vaConciliado(mes) {
  const de = `${mes}-01`;
  const ate = ultimoDia(mes);
  const rows = await todas(() => supabase.from('fluxo_caixa_conciliacoes').select('origem, referencia, valor, data').gte('data', menosDias(de, 45)).lt('valor', 0).order('id'));
  const itens = itensDoMes(rows, de, ate);
  const pct = await percentuaisVa(itens);
  let total = 0;
  const detalhe = [];
  for (const it of itens) {
    const p = pct.get(`${it.origem}:${it.id}`) || 0;
    if (!p) continue;
    const v = r2((it.valor * p) / 100);
    total += v;
    detalhe.push({ ...it, percentual: p, valorVa: v });
  }
  return { total: r2(total), detalhe };
}
