import fs from 'fs';
import { BankReturnParser } from './utils/bankReturnParser.js';

// Testar o arquivo problemático
async function testItauFix() {
  try {
    console.log('=== TESTE DE CORREÇÃO DA DATA ITAÚ (FEBRABAN) ===');
    
    // Ler o arquivo problemático original
    const fileContent = fs.readFileSync('C:/Users/NOTCROSBY02/Desktop/SCRIPT/ITAU/EXT_341_0382_98141_13082500.RET', 'utf8');
    
    // Processar o arquivo
    const parser = new BankReturnParser();
    const result = parser.parseFile(fileContent);
    
    console.log('\n=== RESULTADO DO PROCESSAMENTO ===');
    console.log('Data de geração:', result.dataGeracao);
    console.log('Hora de geração:', result.horaGeracao);
    console.log('Banco:', result.banco.nome);
    console.log('Saldo atual:', result.saldoFormatado);
    
    // Verificar se a data está correta (11/08/2025 - Data de Gravação FEBRABAN)
    if (result.dataGeracao === '2025-08-11') {
      console.log('✅ CORREÇÃO FUNCIONOU! Data de Gravação extraída corretamente: 2025-08-11');
      console.log('📋 Conforme manual FEBRABAN: Data de Gravação no Header de Lote');
    } else {
      console.log('❌ CORREÇÃO NÃO FUNCIONOU! Data esperada: 2025-08-11, Data obtida:', result.dataGeracao);
    }
    
  } catch (error) {
    console.error('❌ Erro no teste:', error.message);
  }
}

// Executar o teste
testItauFix(); 