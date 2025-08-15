import fs from 'fs';

// Ler o arquivo problemático
const fileContent = fs.readFileSync('C:/Users/NOTCROSBY02/Desktop/SCRIPT/ITAU/EXT_341_6530_33688_13082500.RET', 'utf8');
const lines = fileContent.split('\n').filter(l => l.trim());

console.log('=== VERIFICAÇÃO DA DATA CORRETA ITAÚ ===');
console.log(`Total de linhas: ${lines.length}`);

// Analisar cada linha procurando por datas
lines.forEach((line, index) => {
  console.log(`\n--- Linha ${index + 1} ---`);
  
  // Procurar por padrões de data DDMMAAAA
  const dataMatches = line.match(/(\d{2})(\d{2})(\d{4})/g);
  if (dataMatches) {
    console.log('Datas encontradas:', dataMatches);
    dataMatches.forEach(match => {
      const dia = parseInt(match.substring(0, 2));
      const mes = parseInt(match.substring(2, 4));
      const ano = parseInt(match.substring(4, 8));
      
      // Verificar se é uma data válida
      if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
        console.log(`  ✅ Data válida: ${match} -> ${dia}/${mes}/${ano} -> ${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`);
      } else {
        console.log(`  ❌ Data inválida: ${match} -> ${dia}/${mes}/${ano}`);
      }
    });
  }
  
  // Procurar por padrões de data DDMMAA
  const dataMatches6 = line.match(/(\d{2})(\d{2})(\d{2})/g);
  if (dataMatches6) {
    console.log('Datas 6 dígitos encontradas:', dataMatches6);
    dataMatches6.forEach(match => {
      const dia = parseInt(match.substring(0, 2));
      const mes = parseInt(match.substring(2, 4));
      const ano = parseInt(match.substring(4, 6));
      
      // Verificar se pode ser uma data válida (assumindo ano 20xx)
      if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
        const anoCompleto = 2000 + ano;
        console.log(`  ✅ Possível data 6 dígitos: ${match} -> ${dia}/${mes}/${anoCompleto} -> ${anoCompleto}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`);
      }
    });
  }
});

// Verificar especificamente as posições onde podem estar as datas
console.log('\n=== ANÁLISE DE POSIÇÕES ESPECÍFICAS ===');

// Linha 1 (Header)
const header = lines[0];
console.log('\n--- Header (Linha 1) ---');
console.log('Posições 95-100 (DDMMAA):', header.substring(95, 100));
console.log('Posições 100-106 (HHMMSS):', header.substring(100, 106));
console.log('Posições 143-151 (DDMMAAAA):', header.substring(143, 151));
console.log('Posições 151-157 (HHMMSS):', header.substring(151, 157));

// Linha 2 (Header de Lote)
if (lines.length > 1) {
  const headerLote = lines[1];
  console.log('\n--- Header de Lote (Linha 2) ---');
  console.log('Conteúdo completo:', headerLote);
  
  // Procurar por "11082025" ou "12082025"
  const data1108 = headerLote.indexOf('11082025');
  const data1208 = headerLote.indexOf('12082025');
  
  if (data1108 !== -1) {
    console.log(`✅ Encontrou 11082025 na posição ${data1108} -> 11/08/2025`);
  }
  if (data1208 !== -1) {
    console.log(`✅ Encontrou 12082025 na posição ${data1208} -> 12/08/2025`);
  }
  
  // Procurar por outras datas
  const todasDatas = headerLote.match(/(\d{2})(\d{2})(\d{4})/g);
  if (todasDatas) {
    console.log('Todas as datas 8 dígitos encontradas:', todasDatas);
    todasDatas.forEach(match => {
      const dia = parseInt(match.substring(0, 2));
      const mes = parseInt(match.substring(2, 4));
      const ano = parseInt(match.substring(4, 8));
      if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
        console.log(`  ✅ Data válida: ${match} -> ${dia}/${mes}/${ano}`);
      }
    });
  }
}

console.log('\n=== CONCLUSÃO ===');
console.log('Verifique acima quais datas válidas foram encontradas e qual deveria ser a correta.'); 