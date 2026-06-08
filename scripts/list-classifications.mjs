import supabase from '../config/supabase.js';

const PAGE = 1000;
const types = new Map();
let totalLidos = 0;
let comClass = 0;
for (let from = 0; from < 200000; from += PAGE) {
  const { data, error } = await supabase
    .from('pes_pessoa')
    .select('code, classifications')
    .range(from, from + PAGE - 1);
  if (error) { console.error(error); break; }
  if (!data || data.length === 0) break;
  for (const r of data) {
    totalLidos++;
    const arr = Array.isArray(r.classifications) ? r.classifications : [];
    if (arr.length > 0) comClass++;
    for (const c of arr) {
      if (c?.type == null) continue;
      const key = `type=${c.type}`;
      if (!types.has(key)) types.set(key, { count: 0, exemplo: c });
      types.get(key).count += 1;
    }
  }
  if (data.length < PAGE) break;
}
console.log(`Lidos: ${totalLidos.toLocaleString('pt-BR')} pes_pessoa`);
console.log(`Com classifications populadas: ${comClass.toLocaleString('pt-BR')}`);
console.log('\nDistribuicao por classification.type:');
for (const [k, v] of [...types.entries()].sort((a, b) => b[1].count - a[1].count)) {
  const ex = JSON.stringify(v.exemplo).slice(0, 200);
  console.log(`  ${k.padEnd(15)} ${v.count.toLocaleString('pt-BR').padStart(8)} pessoas · ex: ${ex}`);
}
