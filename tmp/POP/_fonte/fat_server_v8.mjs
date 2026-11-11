// Servidor mínimo para testar Faturamento e Transferências (sem os jobs do index.js)
const B = 'file:///C:/Users/yagom/apigestaocrosby/';
await import(B + 'node_modules/dotenv/config.js');
const express = (await import(B + 'node_modules/express/index.js')).default;
const cors = (await import(B + 'node_modules/cors/lib/index.js')).default;
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use('/api/pedidos-venda', (await import(B + 'routes/pedidosVenda.routes.js')).default);
app.use('/api/faturamento-expedicao', (await import(B + 'routes/faturamentoExpedicao.routes.js')).default);
app.use('/api/pdv-crosby', (await import(B + 'routes/pdvCrosby.routes.js')).default);
app.use('/api/brejinho', (await import(B + 'routes/brejinho.routes.js')).default);
app.use('/api/transferencias', (await import(B + 'routes/transferencias.routes.js')).default);
app.use('/api/totvs', (await import(B + 'totvsrouter/clientes.js')).default);
app.use('/api/totvs', (await import(B + 'totvsrouter/pdv.js')).default);
app.listen(4100, () => console.log('fat-teste na 4100'));
