import 'dotenv/config';
import express from 'express';
import router from '../../routes/conciliacaoStone.routes.js';
const app = express(); app.use(express.json()); app.use('/x', router);
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  const j = await (await fetch(`http://127.0.0.1:${port}/x/batimento?stonecode=579299624&inicio=2026-10-14&fim=2026-10-20`)).json();
  const l = j.data.lojas[0];
  for (const p of l.pagamentos) console.log(p.data, p.id, p.carteiraStone, '=>', p.carteira, p.valorTotal, JSON.stringify(p.composicao.bandeiras));
  for (const s of l.stoneSemTotvs) console.log('so stone', s.nsu, s.valorBruto, JSON.stringify(s.depositos));
  console.log('par exemplo', JSON.stringify(l.pares[0]?.stone?.depositos));
  srv.close(); process.exit(0);
});
