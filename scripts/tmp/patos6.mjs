import 'dotenv/config';
import supabase from '../../config/supabase.js';
const nsus = ['39662398217779', '39962453497407'];
let from = 0; const achados = [];
for (;;) {
  const { data, error } = await supabase.from('stone_conciliacao_arquivos').select('stonecode,data_ref,conteudo').gte('data_ref', '2026-10-01').lte('data_ref', '2026-11-03').range(from, from + 49);
  if (error) { console.log(error.message); break; }
  for (const r of data) {
    const c = r.conteudo || {};
    for (const t of c.transacoes || []) if (nsus.includes(String(t.nsu)) || ['620595','66355','066355'].includes(String(t.codAutorizacao))) achados.push(`${r.stonecode} ${r.data_ref} tx ${t.nsu} ${t.codAutorizacao} ${t.valorBruto} ${t.dataCaptura}`);
    for (const l of c.liquidacoes || []) if (nsus.includes(String(l.nsu))) achados.push(`${r.stonecode} ${r.data_ref} liq ${l.nsu}`);
  }
  if (data.length < 50) break; from += 50;
}
console.log(achados.length ? achados.join('\n') : 'NSUs não aparecem em nenhum arquivo Stone de out–nov (todas as lojas)');
process.exit(0);
