import 'dotenv/config';
import supabaseFiscal from '../config/supabaseFiscal.js';
import supabase from '../config/supabase.js';
import * as XLSX from 'xlsx';
import { getBranchCodes } from '../totvsrouter/totvsHelper.js';

const INICIO = '2026-01-01';
const OPS = [36, 7279, 7000];
const OUT = process.argv[2] || 'C:/Users/teccr/Downloads/frete-2026-YTD.xlsx';

// 1) Puxa NFs de frete (paginado), exclui canceladas/excluidas
const PAGE = 1000;
let offset = 0;
const nfs = [];
while (true) {
  const { data, error } = await supabaseFiscal
    .from('notas_fiscais')
    .select(
      'issue_date, invoice_code, serial_code, branch_code, branch_cnpj, operation_code, operation_name, person_code, person_name, total_value, items, invoice_status',
    )
    .in('operation_code', OPS)
    .gte('issue_date', INICIO)
    .not('invoice_status', 'eq', 'Canceled')
    .not('invoice_status', 'eq', 'Deleted')
    .order('issue_date', { ascending: true })
    .range(offset, offset + PAGE - 1);
  if (error) { console.log('ERRO fiscal:', error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  nfs.push(...data);
  if (data.length < PAGE) break;
  offset += PAGE;
}
console.log(`NFs de frete (${OPS.join('/')}) desde ${INICIO}: ${nfs.length}`);

// 2) Enriquece transportadora (person) com cidade/UF do cadastro
const personCodes = [...new Set(nfs.map((n) => n.person_code).filter(Boolean))];
const personMap = new Map();
for (let i = 0; i < personCodes.length; i += 300) {
  const chunk = personCodes.slice(i, i + 300);
  const { data } = await supabase
    .from('pes_pessoa')
    .select('code, nm_pessoa, fantasy_name, uf, addresses, cpf')
    .in('code', chunk);
  for (const p of data || []) {
    let cidade = '';
    if (Array.isArray(p.addresses) && p.addresses.length) {
      const a = p.addresses.find((x) => x.isDefault) || p.addresses[0];
      cidade = a?.cityName || a?.city || a?.municipio || '';
    }
    personMap.set(Number(p.code), {
      nome: p.fantasy_name || p.nm_pessoa || '',
      uf: p.uf || '',
      cidade,
      cnpj: p.cpf || '',
    });
  }
}

// 3) Mapa filial -> nome (best-effort via branches TOTVS)
let branchMap = new Map();
try {
  const codes = await getBranchCodes();
  // getBranchCodes retorna só códigos; nome fica opcional
  void codes;
} catch { /* ok */ }

const cfopDe = (items) => {
  if (!Array.isArray(items) || !items.length) return '';
  return items[0]?.cfop ?? '';
};

// 4) Monta linhas
const linhas = nfs.map((n) => {
  const tr = personMap.get(Number(n.person_code)) || {};
  const cfop = cfopDe(n.items);
  const cfopStr = String(cfop);
  const ambito = cfopStr.startsWith('1') ? 'Dentro do estado'
    : cfopStr.startsWith('2') ? 'Interestadual'
    : cfopStr.startsWith('3') ? 'Exterior' : '';
  return {
    'Data Emissão': n.issue_date,
    NF: n.invoice_code,
    Série: n.serial_code || '',
    Operação: `${n.operation_code} - ${(n.operation_name || '').replace(/^\d+\s*-\s*/, '')}`,
    'Filial (destino)': n.branch_code,
    'CNPJ Filial': n.branch_cnpj || '',
    'Cód. Transportadora': n.person_code || '',
    Transportadora: n.person_name || tr.nome || '',
    'Cidade Transp.': tr.cidade || '',
    'UF Transp.': tr.uf || '',
    CFOP: cfop,
    Âmbito: ambito,
    'Valor Frete': Number(n.total_value) || 0,
    Status: n.invoice_status || '',
  };
});

// 5) Resumo por transportadora
const porTransp = new Map();
let totalGeral = 0;
for (const l of linhas) {
  totalGeral += l['Valor Frete'];
  const k = l.Transportadora || '(sem nome)';
  const cur = porTransp.get(k) || { valor: 0, qtd: 0 };
  cur.valor += l['Valor Frete'];
  cur.qtd += 1;
  porTransp.set(k, cur);
}
const resumo = [...porTransp.entries()]
  .map(([nome, v]) => ({ Transportadora: nome, 'Qtd CT-e': v.qtd, 'Valor Total': v.valor }))
  .sort((a, b) => b['Valor Total'] - a['Valor Total']);

// 6) Gera Excel
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Fretes (detalhe)');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Por transportadora');
XLSX.writeFile(wb, OUT);

// 7) Log resumo
console.log(`\nTOTAL FRETE YTD: R$ ${totalGeral.toFixed(2)} em ${linhas.length} documentos`);
console.log('\nTop 12 transportadoras:');
for (const r of resumo.slice(0, 12)) {
  console.log(`  R$ ${r['Valor Total'].toFixed(2).padStart(12)}  (${String(r['Qtd CT-e']).padStart(4)} CT-e)  ${r.Transportadora}`);
}
console.log(`\nExcel salvo em: ${OUT}`);
