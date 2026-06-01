const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  const j = await r.json();
  return j.data || j;
}

for (const [titulo, path] of [
  ['SEMANAL (semana atual, até ontem)', '/api/forecast/promessa-vendedores'],
  ['MENSAL (mês atual)', '/api/forecast/vendedores-mensal'],
]) {
  const d = await get(path);
  console.log(`\n======== ${titulo} | fonte: ${d.fonte || '?'} ========`);
  for (const card of d.cards || []) {
    console.log(`\n--- ${card.label || card.code}  total=R$${f(card.total?.real ?? card.total)}  meta=R$${f(card.total?.meta ?? card.meta)} (${f(card.total?.percentual ?? card.percentual)}%) ---`);
    for (const v of card.vendedores || []) {
      console.log('   ' + String(v.seller_code).padStart(4), (v.nome || '').slice(0, 22).padEnd(22), 'R$ ' + f(v.real).padStart(12));
    }
  }
}
