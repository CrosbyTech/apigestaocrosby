import { processUnicredExtracts } from '../utils/extratos/unicredExtractor.js';

function printSnippet(text, length = 1000) {
  const snippet = text ? text.slice(0, length) : '';
  console.log('Trecho do texto extraído (primeiros', length, 'chars):');
  console.log(snippet);
}

function printTransactions(transactions, max = 50) {
  console.log('Transações encontradas:', transactions.length);
  transactions.slice(0, max).forEach((t, i) => {
    console.log(
      `${i + 1}. ${t.data} | ${t.descricao} | doc=${t.documento} | valor=${t.valor} | saldo=${t.saldo}`
    );
  });
}

async function main() {
  const results = await processUnicredExtracts();
  console.log('Resumo dos PDFs UNICRED processados:');
  for (const r of results) {
    console.log('\nArquivo:', r.file);
    if (r.error) {
      console.log('Erro ao processar:', r.error);
      continue;
    }
    printSnippet(r.text);
    printTransactions(r.transactions);
  }
}

main().catch((err) => {
  console.error('Falha geral ao processar UNICRED:', err);
  process.exit(1);
});
