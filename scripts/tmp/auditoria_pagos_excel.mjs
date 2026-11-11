// Planilha da auditoria "pagos via conciliação" (Titia, 11/11/2026)
import 'dotenv/config';
import fs from 'fs';
import XLSX from 'xlsx';
import supabase from '../../config/supabase.js';

const r = JSON.parse(fs.readFileSync('scripts/tmp/auditoria_pagos_conc.json', 'utf8'));
const d = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

// conciliações citadas → data/valor/conta/justificativa
const ids = new Set([...r.naoCasa.map((x) => x.conciliacao_id), ...r.pagoDuasVezes.flatMap((x) => x.pagos.map((p) => p.conciliacao_id)), ...r.pagoAMais.flatMap((x) => x.pagos.map((p) => p.conciliacao_id)), ...r.duplicidades.flatMap((x) => String(x.conc).split(',').map(Number))]);
const concDe = new Map();
const lista = [...ids];
for (let i = 0; i < lista.length; i += 200) {
  const { data } = await supabase.from('fluxo_caixa_conciliacoes').select('id,conta_id,data,valor,justificativa').in('id', lista.slice(i, i + 200));
  for (const c of data || []) concDe.set(c.id, c);
}
const { data: contas } = await supabase.from('fluxo_caixa_contas').select('id,apelido');
const contaDe = new Map((contas || []).map((c) => [c.id, c.apelido]));
const descConc = (id) => {
  const c = concDe.get(Number(id));
  return c ? `${d(c.data)} · ${contaDe.get(c.conta_id) || ''} · R$ ${Math.abs(c.valor).toFixed(2)} · ${c.justificativa || ''}` : String(id);
};

const resumo = [
  { Item: 'Conciliações de saída com contas a pagar', Quantidade: r.conciliacoes },
  { Item: 'Títulos do TOTVS que aparecem PAGO via conciliação', Quantidade: r.titulosPagosViaConciliacao },
  { Item: '   … também baixados no TOTVS', Quantidade: r.statusTot.pagoNoTotvs },
  { Item: '   … em aberto no TOTVS (PAGO só no HeadCoach)', Quantidade: r.statusTot.abertoNoTotvsPagoHeadcoach },
  { Item: 'Conciliações sem duplicata do TOTVS (não aparecem na Consulta)', Quantidade: r.semLinha.length },
  { Item: 'Pagos que a Consulta ainda não consegue casar', Quantidade: r.naoCasa.length },
  { Item: 'Título pago por 2 ou mais conciliações', Quantidade: r.pagoDuasVezes.length },
  { Item: 'Título pago acima do valor', Quantidade: r.pagoAMais.length },
  { Item: 'Possível duplicidade (pago via conciliação × outro título em aberto, mesmo fornecedor e valor)', Quantidade: r.duplicidades.length },
];
const semLinha = r.semLinha.map((x) => ({ Conciliação: x.conc, 'Data saída': d(x.data), Valor: x.valor, Origem: x.origem, 'Fornecedor/nome': x.nome, Referência: x.ids, Motivo: 'a Liberação/Solicitação não tem nº de duplicata do TOTVS' }));
const naoCasa = r.naoCasa.map((x) => ({ Conciliação: x.conciliacao_id, Saída: descConc(x.conciliacao_id), Empresa: x.cd_empresa, Duplicata: x.nr_duplicata, Parcela: x.nr_parcela, Fornecedor: x.cd_fornecedor, 'Valor pago': Number(x.vl_pago), 'Data pagamento': d(x.dt_pagamento), Origem: x.origem, Motivo: x.motivo }));
const duasVezes = r.pagoDuasVezes.flatMap((x) =>
  x.pagos.map((p) => ({ Empresa: x.titulo.branch_code, Duplicata: x.titulo.duplicate_code, Parcela: x.titulo.installment_code, Fornecedor: x.titulo.supplier_name, 'Valor título': x.titulo.duplicate_value, Vencimento: d(x.titulo.due_date), 'Baixado no TOTVS': x.titulo.settlement_date ? d(x.titulo.settlement_date) : 'não', Conciliação: p.conciliacao_id, Saída: descConc(p.conciliacao_id), 'Valor conciliado': Number(p.vl_pago), Origem: p.origem })),
);
const aMais = r.pagoAMais.map((x) => ({ Empresa: x.titulo.branch_code, Duplicata: x.titulo.duplicate_code, Parcela: x.titulo.installment_code, Fornecedor: x.titulo.supplier_name, 'Valor título': x.titulo.duplicate_value, 'Soma conciliada': x.soma, Conciliações: x.pagos.map((p) => `${p.conciliacao_id} (${Number(p.vl_pago).toFixed(2)})`).join(', ') }));
const dupl = r.duplicidades.map((x) => ({
  Fornecedor: x.pago.supplier_name || x.aberto.supplier_name || x.pago.supplier_code,
  Valor: x.pago.duplicate_value,
  'PAGO — empresa': x.pago.branch_code,
  'PAGO — duplicata/parcela': `${x.pago.duplicate_code}/${x.pago.installment_code}`,
  'PAGO — vencimento': d(x.pago.due_date),
  'PAGO — data pagamento (conciliação)': d(x.dtPagamento),
  'PAGO — baixado no TOTVS': x.pago.settlement_date ? d(x.pago.settlement_date) : 'não',
  'EM ABERTO — empresa': x.aberto.branch_code,
  'EM ABERTO — duplicata/parcela': `${x.aberto.duplicate_code}/${x.aberto.installment_code}`,
  'EM ABERTO — emissão': d(x.aberto.issue_date),
  'EM ABERTO — vencimento': d(x.aberto.due_date),
  Conciliação: x.conc,
}));

const wb = XLSX.utils.book_new();
const add = (rows, nome) => {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'nada encontrado' }]);
  const cols = Object.keys(rows[0] || { Info: '' });
  ws['!cols'] = cols.map((c) => ({ wch: Math.min(60, Math.max(c.length, ...rows.map((x) => String(x[c] ?? '').length)) + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, nome);
};
add(resumo, 'Resumo');
add(dupl, 'Possíveis duplicidades');
add(duasVezes, 'Título em 2 conciliações');
add(aMais, 'Pago acima do valor');
add(naoCasa, 'Não aparece PAGO');
add(semLinha, 'Sem duplicata TOTVS');
const out = 'tmp/Auditoria_pagos_via_conciliacao_11-11-2026.xlsx';
XLSX.writeFile(wb, out);
console.log(out);
setTimeout(() => process.exit(0), 100);
