// Auditoria: nosso per_seller (canal-totals) vs painel OFICIAL TOTVS (sale-panel/sellers)
// Semana FECHADA W21 (18-24/05/2026), canal revenda, filiais [2,5,75,99,200].
const BASE = 'http://localhost:4100';
const DMIN = '2026-05-18';
const DMAX = '2026-05-24';
const f = (n) => Number(n || 0).toFixed(2);

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

// 1) Nosso per_seller
const ours = await post('/api/crm/canal-totals', {
  datemin: DMIN, datemax: DMAX, modulo: 'revenda',
});
const od = ours.data || ours;
const ourMap = new Map(); // code -> {nome, bruto, credev}
for (const s of od.per_seller || []) {
  const code = String(s.seller_code ?? '');
  ourMap.set(code, {
    nome: s.seller_name || s.name || '',
    bruto: Number(s.invoice_value || 0),
    credev: Number(s.credev_value || 0),
  });
}

// 2) Oficial TOTVS sale-panel/sellers
const off = await post('/api/totvs/sale-panel/sellers', {
  filtroempresa: [2, 5, 75, 99, 200], datemin: DMIN, datemax: DMAX,
});
const offd = off.data || off;

// Descobre a estrutura
console.log('keys oficial:', Object.keys(offd).join(','));
const branches = offd.branches || offd.filiais || [];
console.log('filiais retornadas:', branches.length);
let offBranchTotal = 0;
for (const b of branches) {
  offBranchTotal += Number(b.invoiceValue || 0);
  console.log(`  filial ${b.branch_code} ${b.branch_name || ''}: invoiceValue=R$${f(b.invoiceValue)} | dataRow itens=${Array.isArray(b.dataRow) ? b.dataRow.length : 'n/a'}`);
}
if (branches[0]?.dataRow?.[0]) {
  console.log('amostra dataRow[0]:', JSON.stringify(branches[0].dataRow[0]).slice(0, 300));
}

// Agrega vendedores oficiais por código a partir do dataRow de cada filial
const REVENDA_SELLERS = new Set([25, 15, 161, 165, 241, 779, 288, 251, 131, 94, 1924, 7044]);
const offMap = new Map(); // code -> {nome, valor}
for (const b of branches) {
  const rows = Array.isArray(b.dataRow) ? b.dataRow : [];
  for (const s of rows) {
    const code = String(
      s.sellerCode ?? s.seller_code ?? s.code ?? s.salesmanCode ?? s.id ?? '',
    );
    const nome = s.sellerName ?? s.seller_name ?? s.name ?? s.salesmanName ?? '';
    const valor = Number(
      s.invoiceValue ?? s.value ?? s.totalValue ?? s.netValue ?? s.total ?? 0,
    );
    if (!code) continue;
    const prev = offMap.get(code) || { nome, valor: 0 };
    prev.valor += valor;
    if (!prev.nome && nome) prev.nome = nome;
    offMap.set(code, prev);
  }
}
console.log('soma invoiceValue das filiais:', f(offBranchTotal));

// Comparação focada nos sellers de revenda
console.log('\n=== COMPARAÇÃO (revenda, W21 18-24) ===');
console.log('code  | nome                | OFICIAL bruto | NOSSO bruto | credev   | NOSSO liq');
const allCodes = new Set([...ourMap.keys(), ...offMap.keys()]);
for (const code of allCodes) {
  const o = ourMap.get(code);
  const of = offMap.get(code);
  const onlyRevenda = REVENDA_SELLERS.has(parseInt(code));
  // mostra só os relevantes (revenda) ou que aparecem no nosso
  if (!onlyRevenda && !o) continue;
  const nome = (o?.nome || of?.nome || '').slice(0, 18).padEnd(18);
  const offBruto = of ? f(of.valor) : '—';
  const ourBruto = o ? f(o.bruto) : '—';
  const credev = o ? f(o.credev) : '—';
  const ourLiq = o ? f(o.bruto - o.credev) : '—';
  console.log(
    String(code).padStart(5), '|', nome, '|',
    String(offBruto).padStart(13), '|',
    String(ourBruto).padStart(11), '|',
    String(credev).padStart(8), '|',
    String(ourLiq).padStart(11),
  );
}
console.log('\nTotais:');
console.log('  oficial (revenda sellers):', f([...offMap].filter(([c]) => REVENDA_SELLERS.has(parseInt(c))).reduce((a, [, v]) => a + v.valor, 0)));
console.log('  oficial (TODOS sellers das filiais):', f([...offMap.values()].reduce((a, v) => a + v.valor, 0)));
console.log('  nosso bruto:', f([...ourMap.values()].reduce((a, v) => a + v.bruto, 0)));
console.log('  nosso líquido:', f([...ourMap.values()].reduce((a, v) => a + (v.bruto - v.credev), 0)));
