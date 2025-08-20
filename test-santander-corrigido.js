import { BankReturnParser } from './utils/bankReturnParser.js';
import fs from 'fs';

const parser = new BankReturnParser();
const lines = fs.readFileSync('EXT_033_8700482383_20082025_00.RET', 'utf8').split('\n');

console.log('=== TESTE SANTANDER CORRIGIDO ===');
console.log('Arquivo:', 'EXT_033_8700482383_20082025_00.RET');
console.log('Linhas:', lines.length);

// Detectar banco
const banco = parser.detectarBanco(lines);
console.log('Banco detectado:', banco);

// Processar arquivo
const resultado = parser.parse(lines);

console.log('\n=== RESULTADO ===');
console.log('Saldo atual:', resultado.saldoAtual);
console.log('Agência:', resultado.agencia);
console.log('Conta:', resultado.conta);
console.log('Data geração:', resultado.dataGeracao);
console.log('Hora geração:', resultado.horaGeracao);
console.log('Banco detectado:', resultado.bancoDetectado);
console.log('Transações:', resultado.transactions.length);
console.log('Erros:', resultado.errors);
