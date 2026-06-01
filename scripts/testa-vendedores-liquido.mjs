const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);
async function get(p) { const r = await fetch(`${BASE}${p}`); const j = await r.json(); return j.data || j; }

for (const [titulo, path] of [
  ['SEMANAL (até ontem)', '/api/forecast/promessa-vendedores'],
  ['MENSAL', '/api/forecast/vendedores-mensal'],
]) {
  const d = await get(path);
  console.log(`\n======== ${titulo} | fonte: ${d.fonte || '?'} ========`);
  for (const card of d.cards || []) {
    const tot = card.total?.real ?? card.total;
    const meta = card.total?.meta ?? card.meta;
    const pct = card.total?.percentual ?? card.percentual;
    console.log(`\n--- ${card.label || card.code}  LÍQUIDO total=R$${f(tot)} / meta R$${f(meta)} (${f(pct)}%) ---`);
    for (const v of card.vendedores || []) {
      console.log('   ' + String(v.seller_code).padStart(4), (v.nome || '').slice(0, 20).padEnd(20), 'líq=R$ ' + f(v.real).padStart(11));
    }
  }
}
