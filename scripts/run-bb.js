import { processBBExtracts } from '../utils/extratos/bbExtractor.js';

(async () => {
  try {
    const results = await processBBExtracts();
    console.log('Resumo dos PDFs BANCO DO BRASIL processados:');
    for (const r of results) {
      console.log(`\nArquivo: ${r.file}`);
      console.log('Texto extraído (primeiros 1000 caracteres):');
      console.log(r.text ? r.text.slice(0, 1000) : '--- sem texto ---');
      console.log(`Transações encontradas: ${r.transactions.length}`);
      r.transactions.slice(0, 50).forEach((t, idx) => {
        console.log(`${idx + 1}. Data: ${t.date} | Tipo: ${t.type} | Valor: ${t.value} | Saldo: ${t.saldo ?? '-'} | Histórico: ${t.history}`);
      });
      if (r.transactions.length === 0) {
        console.log('Nenhuma transação encontrada pelas heurísticas atuais.');
      }
    }
  } catch (e) {
    console.error('Falha ao executar o parser do BANCO DO BRASIL:', e);
    process.exit(1);
  }
})();
