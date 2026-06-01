const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);
const REF = { 161: 9688.63, 165: 5936.08, 241: 4936.81, 65: 16802.00, 177: 14430.25, 26: 4264.06, 259: 1282.72 };
const r = await fetch(`${BASE}/api/forecast/promessa-vendedores`);
const j = await r.json();
const d = j.data || j;
console.log('SEMANAL (escopo 99) vs REFERÊNCIA empresa 99:');
for (const c of d.cards || []) {
  console.log(`\n--- ${c.label} ---`);
  for (const v of c.vendedores || []) {
    const ref = REF[v.seller_code];
    const ok = ref != null ? (Math.abs(ref - v.real) < 1 ? 'OK ✅' : `dif ${f(v.real - ref)}`) : '(s/ref)';
    console.log('  ' + String(v.seller_code).padStart(4), (v.nome || '').slice(0, 16).padEnd(16), 'R$ ' + f(v.real).padStart(11), '| REF ' + (ref != null ? f(ref) : '—').padStart(10), '|', ok);
  }
}
