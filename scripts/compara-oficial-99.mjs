// Compara painel OFICIAL TOTVS (filial 99) vs nosso per_seller, por vendedor.
const BASE = 'http://localhost:4100';
const DMIN = '2026-05-25';
const DMAX = '2026-05-28';
const f = (n) => Number(n || 0).toFixed(2);

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

// 1) OFICIAL — só filial 99
const off = await post('/api/totvs/sale-panel/sellers', {
  filtroempresa: [99], datemin: DMIN, datemax: DMAX,
});
const offd = off.data || off;
const offMap = new Map();
for (const b of offd.branches || []) {
  for (const s of b.dataRow || []) {
    const code = String(s.sellerCode ?? s.seller_code ?? s.code ?? '');
    const nome = s.sellerName ?? s.seller_name ?? s.name ?? '';
    const valor = Number(s.invoiceValue ?? s.value ?? s.netValue ?? 0);
    if (!code) continue;
    const p = offMap.get(code) || { nome, valor: 0 };
    p.valor += valor; if (!p.nome) p.nome = nome;
    offMap.set(code, p);
  }
}
if (offd.branches?.[0]?.dataRow?.[0]) {
  console.log('amostra dataRow oficial:', JSON.stringify(offd.branches[0].dataRow[0]).slice(0, 250));
}

// 2) NOSSO per_seller (revenda + multimarcas + inbound)
const ourMap = new Map();
for (const mod of ['revenda', 'multimarcas', 'inbound_david', 'inbound_rafael']) {
  const d = (await post('/api/crm/canal-totals', { datemin: DMIN, datemax: DMAX, modulo: mod })).data;
  for (const s of (d?.per_seller || [])) {
    const code = String(s.seller_code ?? '');
    if (!code) continue;
    const bruto = Number(s.invoice_value || 0);
    const credev = Number(s.credev_value || 0);
    const p = ourMap.get(code) || { nome: s.seller_name || '', bruto: 0, credev: 0, canais: [] };
    p.bruto += bruto; p.credev += credev; p.canais.push(mod);
    if (!p.nome) p.nome = s.seller_name || '';
    ourMap.set(code, p);
  }
}

console.log('\n=== OFICIAL (filial 99, 25-28) vs NOSSO ===');
console.log('code  | nome             | OFICIAL 99 | NOSSO bruto | NOSSO liq  | canais');
const codes = new Set([...offMap.keys(), ...ourMap.keys()]);
const ordered = [...codes].sort((a, b) => (offMap.get(b)?.valor || 0) - (offMap.get(a)?.valor || 0));
let tOff = 0, tBruto = 0, tLiq = 0;
for (const code of ordered) {
  const o = offMap.get(code);
  const u = ourMap.get(code);
  if (!o && !u) continue;
  const nome = (o?.nome || u?.nome || '').slice(0, 16).padEnd(16);
  const offV = o ? f(o.valor) : '—';
  const bruto = u ? f(u.bruto) : '—';
  const liq = u ? f(u.bruto - u.credev) : '—';
  tOff += o?.valor || 0; tBruto += u?.bruto || 0; tLiq += u ? (u.bruto - u.credev) : 0;
  console.log(
    String(code).padStart(5), '|', nome, '|',
    String(offV).padStart(10), '|', String(bruto).padStart(11), '|',
    String(liq).padStart(10), '|', (u?.canais || []).join(','),
  );
}
console.log('TOTAL'.padStart(5), '|', ''.padEnd(16), '|', f(tOff).padStart(10), '|', f(tBruto).padStart(11), '|', f(tLiq).padStart(10));
