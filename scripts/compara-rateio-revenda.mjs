// Compara atribuição ATUAL (NF inteira → dealer principal) vs RATEIO por vendedor
// (proporcional ao netValue dos itens). Canal revenda, semana fechada W21.
const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);

async function ct(datemin, datemax) {
  const r = await fetch(`${BASE}/api/crm/canal-totals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datemin, datemax, modulo: 'revenda' }),
  });
  const j = await r.json();
  return j.data || j;
}

for (const [label, dmin, dmax] of [
  ['W21 (18-24)', '2026-05-18', '2026-05-24'],
  ['W22 (25-28)', '2026-05-25', '2026-05-28'],
]) {
  const d = await ct(dmin, dmax);
  const ps = (d.per_seller || []).slice().sort(
    (a, b) => Number(b.invoice_value || 0) - Number(a.invoice_value || 0),
  );
  console.log(`\n=== Revenda ${label} ===`);
  console.log('code  | nome              | ATUAL (NF→princ) | RATEIO (por item) | credev   | RATEIO líq');
  let tAtual = 0, tRateio = 0, tCredev = 0;
  for (const s of ps) {
    const atual = Number(s.invoice_value || 0);
    const rateio = Number(s.invoice_value_rateio || 0);
    const credev = Number(s.credev_value || 0);
    tAtual += atual; tRateio += rateio; tCredev += credev;
    console.log(
      String(s.seller_code).padStart(5), '|',
      String(s.seller_name || '').slice(0, 17).padEnd(17), '|',
      f(atual).padStart(16), '|',
      f(rateio).padStart(17), '|',
      f(credev).padStart(8), '|',
      f(rateio - credev).padStart(11),
    );
  }
  console.log(
    'TOTAL'.padStart(5), '|', ''.padEnd(17), '|',
    f(tAtual).padStart(16), '|', f(tRateio).padStart(17), '|',
    f(tCredev).padStart(8), '|', f(tRateio - tCredev).padStart(11),
  );
  console.log(`gross canal=R$${f(d.gross_invoice_value)}  liq canal=R$${f(d.invoice_value)}`);
}
