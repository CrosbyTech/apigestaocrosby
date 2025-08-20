import fs from 'fs';

// Ler o arquivo Santander
const lines = fs.readFileSync('EXT_033_8700482383_20082025_00.RET', 'utf8').split('\n');

console.log('=== ANÁLISE DO ARQUIVO SANTANDER ===');
console.log('Linha 5 (trailer):', lines[4]);
console.log('Tamanho da linha:', lines[4].length);

const linha5 = lines[4];

// Procurar por padrões de saldo
console.log('\n=== PROCURANDO PADRÕES DE SALDO ===');

// Padrões atuais do parser
const saldoMatchCP = linha5.match(/(\d{4,8})CP/);
const saldoMatchCF = linha5.match(/(\d{4,8})CF/);
const saldoMatchDP = linha5.match(/(\d{4,8})DP/);
const saldoMatchDF = linha5.match(/(\d{4,8})DF/);

console.log('CP match:', saldoMatchCP);
console.log('CF match:', saldoMatchCF);
console.log('DP match:', saldoMatchDP);
console.log('DF match:', saldoMatchDF);

// Procurar por 5986266 especificamente
console.log('\n=== PROCURANDO 5986266 ===');
const pos5986266 = linha5.indexOf('5986266');
console.log('Posição de 5986266:', pos5986266);

if (pos5986266 !== -1) {
  console.log('Contexto antes:', linha5.substring(Math.max(0, pos5986266 - 10), pos5986266));
  console.log('Valor 5986266:', linha5.substring(pos5986266, pos5986266 + 7));
  console.log('Contexto depois:', linha5.substring(pos5986266 + 7, pos5986266 + 17));
}

// Procurar por 10179 especificamente
console.log('\n=== PROCURANDO 10179 ===');
const pos10179 = linha5.indexOf('10179');
console.log('Posição de 10179:', pos10179);

if (pos10179 !== -1) {
  console.log('Contexto antes:', linha5.substring(Math.max(0, pos10179 - 10), pos10179));
  console.log('Valor 10179:', linha5.substring(pos10179, pos10179 + 5));
  console.log('Contexto depois:', linha5.substring(pos10179 + 5, pos10179 + 15));
}

// Analisar posições específicas
console.log('\n=== ANÁLISE POR POSIÇÕES ===');
const posicoes = [
  { inicio: 130, fim: 136, descricao: 'Posição 130-136' },
  { inicio: 140, fim: 146, descricao: 'Posição 140-146' },
  { inicio: 150, fim: 156, descricao: 'Posição 150-156' },
  { inicio: 160, fim: 166, descricao: 'Posição 160-166' },
  { inicio: 170, fim: 176, descricao: 'Posição 170-176' }
];

for (const pos of posicoes) {
  const valor = linha5.substring(pos.inicio, pos.fim);
  console.log(`${pos.descricao}: "${valor}"`);
}

// Procurar por padrões numéricos maiores
console.log('\n=== PROCURANDO PADRÕES NUMÉRICOS ===');
const numeros = linha5.match(/\d{6,}/g);
console.log('Números com 6+ dígitos:', numeros);

// Procurar por padrões com DF (que parece ser o que está sendo capturado)
console.log('\n=== PROCURANDO PADRÕES COM DF ===');
const padraoDF = linha5.match(/(\d+)DF/);
console.log('Padrão DF encontrado:', padraoDF);
