import fs from 'fs';

// Ler o arquivo problemático
const fileContent = fs.readFileSync('C:/Users/NOTCROSBY02/Desktop/SCRIPT/ITAU/EXT_341_6530_33688_13082500.RET', 'utf8');
const lines = fileContent.split('\n').filter(l => l.trim());

console.log('=== DEBUG ITAÚ - ANÁLISE DETALHADA ===');
console.log(`Total de linhas: ${lines.length}`);

// Analisar cada linha
lines.forEach((line, index) => {
  console.log(`\n--- Linha ${index + 1} ---`);
  console.log('Conteúdo:', line);
  
  // Procurar por padrões de data DDMMAAAA
  const dataMatches = line.match(/(\d{2})(\d{2})(\d{4})/g);
  if (dataMatches) {
    console.log('Datas encontradas:', dataMatches);
    dataMatches.forEach(match => {
      const dia = parseInt(match.substring(0, 2));
      const mes = parseInt(match.substring(2, 4));
      const ano = parseInt(match.substring(4, 8));
      console.log(`  ${match} -> dia=${dia}, mes=${mes}, ano=${ano}`);
      
      if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
        console.log(`    ✅ Data válida: ${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`);
      } else {
        console.log(`    ❌ Data inválida`);
      }
    });
  }
  
  // Procurar por padrões de hora HHMMSS
  const horaMatches = line.match(/(\d{2})(\d{2})(\d{2})/g);
  if (horaMatches) {
    console.log('Horas encontradas:', horaMatches);
    horaMatches.forEach(match => {
      const hora = parseInt(match.substring(0, 2));
      const minuto = parseInt(match.substring(2, 4));
      const segundo = parseInt(match.substring(4, 6));
      console.log(`  ${match} -> hora=${hora}, minuto=${minuto}, segundo=${segundo}`);
      
      if (hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59 && segundo >= 0 && segundo <= 59) {
        console.log(`    ✅ Hora válida: ${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}:${segundo.toString().padStart(2, '0')}`);
      } else {
        console.log(`    ❌ Hora inválida`);
      }
    });
  }
});

// Simular a função de extração para entender o problema
console.log('\n=== SIMULAÇÃO DA FUNÇÃO DE EXTRAÇÃO ===');

function simularExtracao() {
  let dataGeracao = null;
  let horaGeracao = null;
  
  // Simular extração da linha de saldo (linha 22)
  const saldoLine = lines[lines.length - 2];
  console.log(`\nAnalisando linha de saldo: "${saldoLine}"`);
  
  const dataMatches = saldoLine.match(/(\d{2})(\d{2})(\d{4})/g);
  if (dataMatches) {
    console.log('Datas na linha de saldo:', dataMatches);
    for (const match of dataMatches) {
      const dia = parseInt(match.substring(0, 2));
      const mes = parseInt(match.substring(2, 4));
      const ano = parseInt(match.substring(4, 8));
      
      if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
        dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
        console.log(`Data extraída da linha de saldo: ${dataGeracao}`);
        break;
      }
    }
  }
  
  // Simular extração do header de lote (linha 2)
  if (!dataGeracao && lines.length > 1) {
    const headerLote = lines[1];
    console.log(`\nAnalisando header de lote: "${headerLote}"`);
    
    const dataMatchesHeader = headerLote.match(/(\d{2})(\d{2})(\d{4})/g);
    if (dataMatchesHeader) {
      console.log('Datas no header de lote:', dataMatchesHeader);
      for (const match of dataMatchesHeader) {
        const dia = parseInt(match.substring(0, 2));
        const mes = parseInt(match.substring(2, 4));
        const ano = parseInt(match.substring(4, 8));
        
        if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
          dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
          console.log(`Data extraída do header de lote: ${dataGeracao}`);
          break;
        }
      }
    }
  }
  
  return { dataGeracao, horaGeracao };
}

const resultado = simularExtracao();
console.log('\n=== RESULTADO FINAL ===');
console.log('Data de geração:', resultado.dataGeracao);
console.log('Hora de geração:', resultado.horaGeracao); 