import 'dotenv/config';
import fs from 'fs';
import supabase from '../../config/supabase.js';
import { lerExtrato } from '../../services/fluxoCaixaExt.js';
const e = await lerExtrato(fs.readFileSync(process.argv[2]), { nomeArquivo: 'extrato.csv' });
const { data: l, error } = await supabase.from('fluxo_caixa_lancamentos').select('data,valor,descricao,forma').eq('conta_id', 14).gte('data', '2026-10-01').lte('data', '2026-10-28').order('data').range(0, 999);
if (error) { console.log(error.message); process.exit(1); }
const k = (x) => `${x.data}|${Number(x.valor).toFixed(2)}`;
const cnt = (arr) => { const m = new Map(); for (const x of arr) m.set(k(x), (m.get(k(x)) || 0) + 1); return m; };
const a = cnt(e.lancamentos), b = cnt(l);
const soCsv = [], soBanco = [];
for (const [kk, n] of a) if ((b.get(kk) || 0) < n) soCsv.push(`${kk} x${n - (b.get(kk) || 0)}`);
for (const [kk, n] of b) if ((a.get(kk) || 0) < n) soBanco.push(`${kk} x${n - (a.get(kk) || 0)}`);
console.log('csv', e.lancamentos.length, 'banco', l.length);
console.log('só no CSV', soCsv);
console.log('só no banco', soBanco);
const deps = [['2026-10-20',1730.80],['2026-10-20',1145.53],['2026-10-20',4621.02],['2026-10-19',926.57],['2026-10-19',375.86],['2026-10-19',697.62],['2026-10-19',414.52],['2026-10-19',38.41],['2026-10-19',38.41],['2026-10-19',3618.75],['2026-10-19',3010.33],['2026-10-16',1706.16],['2026-10-16',0.01],['2026-10-16',0.01],['2026-10-15',1476.56],['2026-10-15',38.41],['2026-10-14',1778.60]];
const pool = e.lancamentos.filter(x => x.valor > 0).map(x => ({ ...x, usado: false }));
for (const [d, v] of deps) { const m = pool.find(x => !x.usado && x.data === d && Math.abs(x.valor - v) < 0.005); if (m) m.usado = true; console.log(d, v, m ? `OK ${m.hora} ${m.descricao}` : 'NÃO ESTÁ'); }
process.exit(0);
