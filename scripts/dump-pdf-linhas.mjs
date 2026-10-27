// Mostra as linhas de texto de um PDF de extrato (agrupadas por y, com x de cada item)
//   node scripts/dump-pdf-linhas.mjs <arquivo.pdf> [pagina=1] [maxLinhas=80]
import fs from 'node:fs';
import { extrairPaginasPdf } from '../utils/extratoStonePdf.js';

const [, , arquivo, pagArg = '1', maxArg = '80'] = process.argv;
const pags = await extrairPaginasPdf(fs.readFileSync(arquivo));
const pg = pags[Number(pagArg) - 1];
if (!pg) {
  console.log('páginas:', pags.length);
  process.exit(0);
}
console.log(`página ${pg.numero}/${pags.length} — ${pg.largura}x${pg.altura} — ${pg.items.length} itens`);
const linhas = new Map();
for (const it of pg.items) {
  const y = Math.round(it.y / 2.5) * 2.5;
  if (!linhas.has(y)) linhas.set(y, []);
  linhas.get(y).push(it);
}
let n = 0;
for (const y of [...linhas.keys()].sort((a, b) => a - b)) {
  const l = linhas.get(y).sort((a, b) => a.x - b.x);
  console.log(String(y).padStart(6), '|', l.map((i) => `[${Math.round(i.x)}]${String(i.s).trim()}`).filter((t) => !/\]$/.test(t)).join(' ').slice(0, 230));
  if (++n >= Number(maxArg)) break;
}
