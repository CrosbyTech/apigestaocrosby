import 'dotenv/config';
import express from 'express';
import router from '../../routes/conciliacaoStone.routes.js';
const app = express(); app.use(express.json()); app.use('/x', router);
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  const j = await (await fetch(`http://127.0.0.1:${port}/x/batimento?stonecode=579299624&inicio=2026-10-15&fim=2026-10-15`)).json();
  console.log('clientePadrao', JSON.stringify(j.data.lojas[0].loja.clientePadrao));
  const r = await (await fetch(`http://127.0.0.1:${port}/x/lancar-totvs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ simular: true, itens: [{ stonecode: '579299624', nsu: '38863557482896', dataArquivo: '2026-10-15', cliente: '' }] }) })).json();
  console.log(JSON.stringify(r.data.resultados[0]).slice(0, 400));
  srv.close(); process.exit(0);
});
