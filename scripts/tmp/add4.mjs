import 'dotenv/config';
import fs from 'fs';
import supabase from '../../config/supabase.js';
import { lerExtrato } from '../../services/fluxoCaixaExt.js';
const e = await lerExtrato(fs.readFileSync(process.argv[2]), { nomeArquivo: 'extrato.csv' });
const { data: l } = await supabase.from('fluxo_caixa_lancamentos').select('data,valor').eq('conta_id', 14).gte('data', '2026-10-01').lte('data', '2026-10-28').range(0, 999);
const k = (x) => `${x.data}|${Number(x.valor).toFixed(2)}`;
const banco = new Map(); for (const x of l) banco.set(k(x), (banco.get(k(x)) || 0) + 1);
const faltam = [];
for (const x of e.lancamentos) { const n = banco.get(k(x)) || 0; if (n > 0) banco.set(k(x), n - 1); else faltam.push(x); }
console.log('faltam', faltam.map(x => `${x.data} ${x.hora} ${x.valor} ${x.descricao} ${x.contraparteNome || ''}`));
if (faltam.length !== 4) { console.log('esperava 4 — abortando'); process.exit(1); }
const imp = await supabase.from('fluxo_caixa_importacoes').insert({
  conta_id: 14, arquivo_nome: 'extrato.csv (João, 04/11/2026) — complemento: lançamentos que faltavam',
  periodo_inicio: faltam[0].data, periodo_fim: faltam.at(-1).data, saldo_inicial: null, saldo_final: null,
  qtd_lancamentos: faltam.length, inconsistencias: 0, avisos: ['Complemento do CSV da Stone: só os lançamentos que não estavam no extrato do bot (nada foi apagado).'],
  usuario: 'Theo (João)', origem: 'csv-stone-complemento',
}).select().single();
if (imp.error) { console.log(imp.error.message); process.exit(1); }
const rows = faltam.map((x) => ({ conta_id: 14, importacao_id: imp.data.id, data: x.data, hora: x.hora, seq: x.seq, valor: x.valor, natureza: x.natureza, tipo: x.tipo, forma: x.forma, categoria: x.categoria, descricao: x.descricao || null, memo: x.memo || null, documento: x.documento || null, contraparte_nome: x.contraparteNome || null, contraparte_doc: x.contraparteDoc || null, contraparte_banco: x.contraparteBanco || null, bandeira: x.bandeira || null, loja: x.loja || null, saldo_apos: x.saldoApos, pagina: null }));
const ins = await supabase.from('fluxo_caixa_lancamentos').insert(rows);
console.log(ins.error?.message || `inseridos ${rows.length} (importacao ${imp.data.id})`);
process.exit(0);
