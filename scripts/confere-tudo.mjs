const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);
async function get(p, ms = 400000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(`${BASE}${p}`, { signal: ac.signal });
    clearTimeout(t);
    const j = await r.json();
    return j.data || j;
  } catch (e) { clearTimeout(t); return { _erro: e.message }; }
}
function showCards(d) {
  if (d._erro) { console.log('  ERRO:', d._erro); return; }
  for (const c of d.cards || []) {
    const t = c.total || {};
    console.log(`\n  ${c.label || c.code}  | total líq R$${f(t.real ?? c.total)} / meta R$${f(t.meta ?? c.meta)}`);
    console.log('  ' + 'VENDEDOR'.padEnd(20) + 'BRUTO'.padStart(13) + 'CREDEV'.padStart(12) + 'LÍQUIDO'.padStart(13));
    for (const v of c.vendedores || []) {
      console.log('  ' + (v.nome || '').slice(0, 19).padEnd(20) + f(v.bruto).padStart(13) + f(v.credev).padStart(12) + f(v.real).padStart(13));
    }
  }
}
console.log('=================== SEMANAL (semana atual, até ontem) ===================');
showCards(await get('/api/forecast/promessa-vendedores'));
console.log('\n\n=================== MENSAL (Maio, até ontem) ===================');
showCards(await get('/api/forecast/vendedores-mensal'));
