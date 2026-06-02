// Verifica NFs de 01/06/2026 por canal — pra entender se R$0 é sync atrasado
// no Supabase ou se de fato não houve vendas.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const s = createClient(process.env.SUPABASE_FISCAL_URL, process.env.SUPABASE_FISCAL_KEY);
const DIA = '2026-06-01';

const OPS = {
  multimarcas:    [7235, 7241, 9127],
  inbound_david:  [7235, 7241, 9127],
  inbound_rafael: [7235, 7241, 9127],
  bazar:          [887],
  business:       [7237, 7269, 7279, 7277],
  ricardoeletro:  [7236], // Ricardo Eletro usa op revenda em branch 11/111
  varejo:         [1, 2, 55, 510, 511, 521, 522, 545, 546, 9001, 9061],
  revenda:        [7236, 9122, 5102, 7242, 9061, 9001, 9121, 512],
  franquia:       [7234, 7240, 7802, 9124, 7259],
  showroom:       [7254, 7007],
  novidadesfranquia: [7255],
};

console.log(`📊 NFs Output em ${DIA} (Supabase notas_fiscais):\n`);
for (const [canal, ops] of Object.entries(OPS)) {
  let off = 0, total = 0, qtd = 0;
  while (true) {
    const { data } = await s.from('notas_fiscais')
      .select('total_value, invoice_status')
      .eq('operation_type', 'Output')
      .gte('issue_date', DIA).lte('issue_date', DIA)
      .in('operation_code', ops)
      .range(off, off + 999);
    if (!data?.length) break;
    for (const n of data) {
      if (n.invoice_status === 'Canceled' || n.invoice_status === 'Deleted') continue;
      total += Number(n.total_value || 0);
      qtd++;
    }
    if (data.length < 1000) break;
    off += 1000;
  }
  const marca = total === 0 ? '⚠️' : '✓';
  console.log(`  ${marca} ${canal.padEnd(20)} R$ ${total.toFixed(2).padStart(12)}  (${qtd} NFs)`);
}

// Total NFs em qualquer op pro dia 01/06
const { count } = await s.from('notas_fiscais')
  .select('*', { count: 'exact', head: true })
  .eq('operation_type', 'Output')
  .gte('issue_date', DIA).lte('issue_date', DIA);
console.log(`\nTotal NFs Output em ${DIA}: ${count}`);
