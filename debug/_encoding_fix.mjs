import { readFileSync, writeFileSync } from 'fs';
const file = 'C:/Users/teccr/gestaocrosby/src/pages/FaturamentoCanal.jsx';
let c = readFileSync(file, 'utf8');

// Pares duplos primeiro (ex: Ã§Ã£o = ção, Ã§Ãµes = ções)
// Cada sequência de 2 pares C3+XX representa um char com acento
const doublePairs = [
  ['Ã§Ã£o', 'ção'],
  ['Ã§Ãµes', 'ções'],
  ['Ã§Ã£', 'çã'],
];

// Pares simples C3+XX
const singlePairs = [
  ['\u00C3\u00A1', 'á'],  // C3 A1
  ['\u00C3\u00A7', 'ç'],  // C3 A7
  ['\u00C3\u00AA', 'ê'],  // C3 AA
  ['\u00C3\u00AD', 'í'],  // C3 AD
  ['\u00C3\u00B3', 'ó'],  // C3 B3
  ['\u00C3\u00A3', 'ã'],  // C3 A3
  ['\u00C3\u00B5', 'õ'],  // C3 B5
  ['\u00C3\u009A', 'Ú'],  // C3 9A  (Ú — em Último)
  ['\u00C3\u0097', '×'],  // C3 97  (× — em Comparativo ×)
];

let changed = 0;

for (const [from, to] of doublePairs) {
  const count = (c.split(from).length - 1);
  if (count > 0) { c = c.split(from).join(to); changed += count; }
}

for (const [from, to] of singlePairs) {
  const count = (c.split(from).length - 1);
  if (count > 0) { c = c.split(from).join(to); changed += count; }
}

console.log('Fixed', changed, 'sequences');
writeFileSync(file, c, 'utf8');
console.log('Done!');


// Sequências Latin-1 mal interpretadas como UTF-8
// C3 A1 = á, C3 A7 = ç, C3 AA = ê, C3 AD = í, C3 B3 = ó, C3 A3 = ã, C3 B5 = õ
const pairs = [
  [0xC3, 0xA1, 'á'],
  [0xC3, 0xA7, 'ç'],
  [0xC3, 0xAA, 'ê'],
  [0xC3, 0xAD, 'í'],
  [0xC3, 0xB3, 'ó'],
  [0xC3, 0xA3, 'ã'],
  [0xC3, 0xB5, 'õ'],
];

let buf = Buffer.from(c, 'utf8');
let changed = 0;

// Reconstruir buffer substituindo pares
const out = [];
for (let i = 0; i < buf.length; i++) {
  let matched = false;
  for (const [b1, b2, replacement] of pairs) {
    if (buf[i] === b1 && buf[i+1] === b2) {
      const repBuf = Buffer.from(replacement, 'utf8');
      repBuf.forEach(b => out.push(b));
      i++;
      changed++;
      matched = true;
      break;
    }
  }
  if (!matched) out.push(buf[i]);
}

console.log('Fixed', changed, 'sequences');
writeFileSync(file, Buffer.from(out), 'utf8');
console.log('Done!');
