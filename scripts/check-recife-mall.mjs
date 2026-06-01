// Verifica NFs de personCode 29541 (suposto Recife Mall) no período da semana
// atual + busca quaisquer NFs com "RECIFE MALL" no nome do cliente.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseFiscal = createClient(
  process.env.SUPABASE_FISCAL_URL,
  process.env.SUPABASE_FISCAL_KEY,
);

const FRANQUIA_OPS = [7234, 7240, 7802, 9124, 7259];
const DMIN = '2026-05-25';
const DMAX = '2026-05-31';

// 1) NFs de franquia no período (todas)
console.log(`\n📋 Franquia (ops ${FRANQUIA_OPS.join(',')}) entre ${DMIN} e ${DMAX}:`);
let off = 0, todas = [];
while (true) {
  const { data, error } = await supabaseFiscal
    .from('notas_fiscais')
    .select('person_code, total_value, branch_code, invoice_code, issue_date, dealer_code')
    .eq('operation_type', 'Output')
    .not('invoice_status', 'eq', 'Canceled')
    .gte('issue_date', DMIN).lte('issue_date', DMAX)
    .in('operation_code', FRANQUIA_OPS)
    .range(off, off + 999);
  if (error) { console.log('err:', error.message); break; }
  if (!data?.length) break;
  todas.push(...data);
  if (data.length < 1000) break;
  off += 1000;
}
console.log(`  Total NFs: ${todas.length}, soma R$ ${todas.reduce((s,n)=>s+Number(n.total_value||0),0).toFixed(2)}`);

// 2) Agrupa por person_code (top 30)
const porPerson = {};
for (const n of todas) {
  const k = n.person_code;
  porPerson[k] = (porPerson[k] || 0) + Number(n.total_value || 0);
}
const top = Object.entries(porPerson).sort((a,b)=>b[1]-a[1]).slice(0, 30);
console.log('\n  Top 30 personCodes:');

// 3) Resolve nomes via tabela persons (se existir) ou direto na NF
const codes = top.map(t => Number(t[0]));
const { data: persons } = await supabaseFiscal
  .from('persons')
  .select('code, name')
  .in('code', codes);
const nomes = new Map((persons || []).map(p => [Number(p.code), p.name]));

for (const [pc, soma] of top) {
  const nome = nomes.get(Number(pc)) || '?';
  const marca = nome.toUpperCase().includes('RECIFE') ? '  ← RECIFE!' : '';
  console.log(`    ${String(pc).padStart(7)}  R$ ${Number(soma).toFixed(2).padStart(12)}  ${nome.slice(0,50)}${marca}`);
}

// 4) Procura "RECIFE MALL" especificamente na tabela persons
console.log('\n🔍 Buscando "RECIFE MALL" na tabela persons:');
const { data: matches } = await supabaseFiscal
  .from('persons')
  .select('code, name')
  .ilike('name', '%RECIFE MALL%');
for (const p of matches || []) console.log(`  code=${p.code}  name=${p.name}`);

// 5) Verifica especificamente personCode 29541
console.log('\n🎯 personCode 29541:');
const { data: p29541 } = await supabaseFiscal.from('persons').select('code, name').eq('code', 29541);
console.log('  persons:', JSON.stringify(p29541));
const nf29541 = todas.filter(n => Number(n.person_code) === 29541);
console.log(`  NFs no período (franquia ops): ${nf29541.length}, soma R$ ${nf29541.reduce((s,n)=>s+Number(n.total_value||0),0).toFixed(2)}`);
