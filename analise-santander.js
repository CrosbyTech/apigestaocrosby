const fs = require('fs');

const lines = fs.readFileSync('EXT_033_8700482383_20082025_00.RET', 'utf8').split('\n');
const linha5 = lines[4];

console.log('Linha 5 completa:', linha5);
console.log('Tamanho:', linha5.length);

// Procurar por 5986266
const pos5986266 = linha5.indexOf('5986266');
console.log('\nPosição 5986266:', pos5986266);
if (pos5986266 !== -1) {
  console.log('Contexto 5986266:', linha5.substring(pos5986266 - 5, pos5986266 + 10));
}

// Procurar por 10179
const pos10179 = linha5.indexOf('10179');
console.log('\nPosição 10179:', pos10179);
if (pos10179 !== -1) {
  console.log('Contexto 10179:', linha5.substring(pos10179 - 5, pos10179 + 10));
}

// Procurar por padrões DF
const padraoDF = linha5.match(/(\d+)DF/);
console.log('\nPadrão DF:', padraoDF);

// Analisar posições específicas
console.log('\nPosições específicas:');
console.log('130-136:', linha5.substring(130, 136));
console.log('140-146:', linha5.substring(140, 146));
console.log('150-156:', linha5.substring(150, 156));
console.log('160-166:', linha5.substring(160, 166));
console.log('170-176:', linha5.substring(170, 176));
