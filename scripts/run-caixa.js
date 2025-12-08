import { processCaixaExtracts } from '../utils/extratos/caixaExtractor.js';

(async () => {
  try {
    const results = await processCaixaExtracts();
    console.log('Resumo dos PDFs CAIXA processados:');
    for (const r of results) {
      console.log(`\nArquivo: ${r.file}`);
      console.log('Texto extraído (primeiros 1000 caracteres):');
      console.log(r.text ? r.text.slice(0, 1000) : '--- sem texto ---');
      console.log(`Transações encontradas: ${r.transactions.length}`);
      r.transactions.slice(0, 50).forEach((t, idx) => {
        console.log(`${idx + 1}. Data: ${t.date} | Tipo: ${t.type} | Valor: ${t.value} | Histórico: ${t.history}`);
      });
      if (r.transactions.length === 0) {
        console.log('Nenhuma transação encontrada pelas heurísticas atuais.');
      }
    }
  } catch (e) {
    console.error('Falha ao executar o parser da CAIXA:', e);
    process.exit(1);
  }
})();
