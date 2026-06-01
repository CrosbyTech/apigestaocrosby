const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);
// Referência do usuário (relatório oficial TOTVS, mês) — por código de vendedor
const ref = {
  259: 81456.19, 65: 60425.09, 177: 59644.93, 161: 60449.47,
  165: 56999.89, 241: 39420.08, 26: 31055.11, 21: 40087.04,
  288: 2436.47, 25: 46.96, 20: 73188.02, 50: 32494.34, 59: 1294.12, 350: 94.50,
};
const r = await fetch(`${BASE}/api/forecast/vendedores-mensal`);
const j = await r.json();
const d = j.data || j;
console.log('cached:', d.cached, '\n');
console.log('cod  | nome              | NOSSO       | REF         | bate?');
for (const card of d.cards || []) {
  console.log(`--- ${card.label} ---`);
  for (const v of card.vendedores || []) {
    const rf = ref[v.seller_code];
    const ok = rf != null ? (Math.abs(rf - v.real) < 1 ? '✅' : `❌ dif ${f(rf - v.real)}`) : '(sem ref)';
    console.log(
      String(v.seller_code).padStart(4), '|',
      String(v.nome || '').slice(0, 17).padEnd(17), '|',
      f(v.real).padStart(11), '|',
      (rf != null ? f(rf) : '—').padStart(11), '|', ok,
    );
  }
}
// Quais da referência NÃO aparecem
const ourCodes = new Set((d.cards || []).flatMap((c) => (c.vendedores || []).map((v) => Number(v.seller_code))));
const faltando = Object.keys(ref).map(Number).filter((c) => !ourCodes.has(c));
console.log('\nNa referência mas FALTANDO no nosso:', faltando.join(', '));
