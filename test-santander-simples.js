import fs from 'fs';

const lines = fs.readFileSync('EXT_033_8700482383_20082025_00.RET', 'utf8').split('\n');
const linha5 = lines[4];

console.log('=== TESTE SANTANDER SIMPLES ===');
console.log('Linha 5:', linha5);

// Testar o novo regex
const saldoPrincipal = linha5.match(/(\d{7})04543/);
console.log('Regex saldo principal:', saldoPrincipal);

if (saldoPrincipal) {
  console.log('Saldo encontrado:', saldoPrincipal[1]);
  console.log('Valor esperado: 5986266');
  console.log('Valor encontrado:', saldoPrincipal[1]);
  console.log('Correto?', saldoPrincipal[1] === '5986266');
} else {
  console.log('Saldo principal não encontrado');
}

// Testar regex antigo
const saldoMatchDF = linha5.match(/(\d{4,8})DF/);
console.log('Regex antigo DF:', saldoMatchDF);

if (saldoMatchDF) {
  console.log('Saldo antigo encontrado:', saldoMatchDF[1]);
}
