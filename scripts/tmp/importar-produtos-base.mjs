import 'dotenv/config';
import fs from 'fs';
import supabase from '../../config/supabase.js';
const arq = process.argv[2];
const texto = new TextDecoder('latin1').decode(fs.readFileSync(arq));
const linhas = texto.split(/\r?\n/).slice(1).filter((l) => l.trim());
const num = (v) => { const n = Number(String(v || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const rows = linhas.map((l) => {
  const c = l.split(';');
  return { code: parseInt(c[0], 10), nome: (c[1] || '').trim(), unidade: (c[2] || '').trim() || null, referencia_code: (c[3] || '').trim() || null, fisico: num(c[4]), cor_code: (c[5] || '').trim() || null, cor_nome: (c[6] || '').trim() || null, tamanho: (c[7] || '').trim().toUpperCase() || null, fonte: 'produtos.csv (31/10/2026)', importado_em: new Date().toISOString() };
}).filter((r) => r.code > 0 && r.nome);
for (let k = 0; k < rows.length; k += 1000) {
  const { error } = await supabase.from('promocao_produtos_base').upsert(rows.slice(k, k + 1000), { onConflict: 'code' });
  if (error) { console.log('ERRO', k, error.message); process.exit(1); }
}
const { count } = await supabase.from('promocao_produtos_base').select('code', { count: 'exact', head: true });
console.log('lidas', rows.length, 'na base', count, 'exemplo', JSON.stringify(rows[1]));
process.exit(0);
