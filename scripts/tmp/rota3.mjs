import 'dotenv/config';
import express from 'express';
import router from '../../routes/conciliacaoStone.routes.js';
const app = express(); app.use(express.json()); app.use('/x', router);
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  const j = await (await fetch(`http://127.0.0.1:${port}/x/batimento?stonecode=579299624&inicio=2026-10-15&fim=2026-10-15`)).json();
  const l = j.data.lojas[0];
  console.log('erros', JSON.stringify(l.erros).slice(0,200)); console.log('soStone', l.stoneSemTotvs.map(s => s.nsu + ' ' + s.valorBruto));
  console.log('pares', l.pares.length, 'stone qtd', l.resumo.stone.qtd); for (const p of l.pares.filter(p => ['38863557482896','38862255245011'].includes(String(p.stone.nsu)))) console.log('par', p.stone.nsu, p.tipo, p.rotulo, JSON.stringify(p.totvs).slice(0, 300), p.divergencias);
  console.log('soTotvs', l.totvsSemStone.filter(t => t.valor <= 0.05).map(t => JSON.stringify(t).slice(0, 250)));
  srv.close(); process.exit(0);
});
