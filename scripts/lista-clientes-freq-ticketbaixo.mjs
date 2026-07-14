// Lista de clientes que compram com frequência mas têm ticket médio baixo, por empresa (filial).
// Uso: node lista-clientes-freq-ticketbaixo.mjs <branch> [minCompras] [top]
//   ex: node lista-clientes-freq-ticketbaixo.mjs 5
import 'dotenv/config';
import supabaseFiscal from '../config/supabaseFiscal.js';
import supabase from '../config/supabase.js';
import * as XLSX from 'xlsx';

const BRANCH = Number(process.argv[2] || 65);
const MIN_COMPRAS = Number(process.argv[3] || 3); // "compra com frequência"
const TOP = Number(process.argv[4] || 40);
const DESDE = '2025-07-13'; // últimos ~12 meses
const OPS_VENDA = [510, 521]; // varejo NFC-e + NF-e (venda a cliente)
const OUT = `C:/Users/teccr/Downloads/clientes-freq-ticketbaixo-emp${BRANCH}.xlsx`;

// 1) Agrega compras por cliente
const PAGE = 1000;
let offset = 0;
const agg = new Map();
let totalNf = 0, somaGeral = 0;
while (true) {
  const { data, error } = await supabaseFiscal
    .from('notas_fiscais')
    .select('person_code, person_name, total_value')
    .eq('branch_code', BRANCH)
    .eq('operation_type', 'Output')
    .in('operation_code', OPS_VENDA)
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .gte('issue_date', DESDE)
    .range(offset, offset + PAGE - 1);
  if (error) { console.log('ERRO:', error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  for (const r of data) {
    if (!r.person_code) continue;
    totalNf++; somaGeral += Number(r.total_value) || 0;
    const k = Number(r.person_code);
    const cur = agg.get(k) || { n: 0, sum: 0, nome: r.person_name || '' };
    cur.n++; cur.sum += Number(r.total_value) || 0;
    if (!cur.nome && r.person_name) cur.nome = r.person_name;
    agg.set(k, cur);
  }
  if (data.length < PAGE) break;
  offset += PAGE;
}
const ticketLojaMedio = totalNf ? somaGeral / totalNf : 0;
const nFreq = [...agg.values()].filter((v) => v.n >= MIN_COMPRAS).length;

// 2) Frequentes (>= MIN_COMPRAS), ordena por menor ticket medio, pega TOP
const frequentes = [...agg.entries()]
  .map(([code, v]) => ({ code, n: v.n, sum: v.sum, ticket: v.sum / v.n, nome: v.nome }))
  .filter((c) => c.n >= MIN_COMPRAS)
  .sort((a, b) => a.ticket - b.ticket)
  .slice(0, TOP);

// 3) Enriquece telefone (e nome) pelo cadastro pes_pessoa
const codes = frequentes.map((c) => c.code);
const infoMap = new Map();
for (let i = 0; i < codes.length; i += 300) {
  const chunk = codes.slice(i, i + 300);
  const { data } = await supabase
    .from('pes_pessoa')
    .select('code, nm_pessoa, fantasy_name, telefone')
    .in('code', chunk);
  for (const p of data || []) {
    const k = Number(p.code);
    const prev = infoMap.get(k);
    const tel = p.telefone || '';
    if (!prev || (!prev.telefone && tel)) {
      infoMap.set(k, { nome: p.nm_pessoa || p.fantasy_name || '', telefone: tel });
    }
  }
}

// 4) Monta lista final
const linhas = frequentes.map((c, i) => {
  const info = infoMap.get(c.code) || {};
  return {
    '#': i + 1,
    Nome: info.nome || c.nome || `Cliente ${c.code}`,
    'Código TOTVS': c.code,
    Telefone: info.telefone || '',
    'Nº Compras (12m)': c.n,
    'Ticket Médio': Number(c.ticket.toFixed(2)),
    'Total Comprado': Number(c.sum.toFixed(2)),
  };
});

// 5) Excel
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), `Emp ${BRANCH}`);
XLSX.writeFile(wb, OUT);

// 6) Console
console.log(`Empresa ${BRANCH} | período ${DESDE} → hoje | vendas 510/521`);
console.log(`Ticket médio da LOJA: R$ ${ticketLojaMedio.toFixed(2)} | clientes frequentes (>=${MIN_COMPRAS} compras): ${nFreq} | total NFs: ${totalNf}`);
console.log(`\n${linhas.length} clientes frequentes com MENOR ticket médio:\n`);
console.log('  #  Cód TOTVS   Compras  TicketMed   Telefone         Nome');
for (const l of linhas) {
  console.log(
    `  ${String(l['#']).padStart(2)}  ${String(l['Código TOTVS']).padStart(8)}   ${String(l['Nº Compras (12m)']).padStart(6)}   R$${String(l['Ticket Médio'].toFixed(2)).padStart(8)}  ${String(l.Telefone || '-').padEnd(16)} ${l.Nome}`,
  );
}
console.log(`\nExcel: ${OUT}`);
