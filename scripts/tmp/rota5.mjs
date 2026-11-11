import 'dotenv/config';
import express from 'express';
import router from '../../routes/conciliacaoStone.routes.js';
const app = express(); app.use(express.json()); app.use('/x', router);
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  const j = await (await fetch(`http://127.0.0.1:${port}/x/batimento?stonecode=168851294&inicio=2026-10-01&fim=2026-10-31`)).json();
  const l = j.data.lojas[0];
  console.log('erros', JSON.stringify(l.erros).slice(0,200)); console.log('soStone', l.stoneSemTotvs.map(s => s.nsu + ' ' + s.valorBruto));
  console.log('pares', l.pares.length, 'stone qtd', l.resumo.stone.qtd); for (const p of l.pares.filter(p => ['39662398217779','39962453497407'].includes(String(p.stone.nsu)))) console.log('par', p.totvs.chave, p.totvs.valor, '<->', p.stone.nsu, p.stone.valorBruto, p.stone.dataCaptura, p.stone.bandeira, p.stone.parcelas+'x', p.tipo, p.rotulo, (p.totvsExtras||[]).map(t=>t.chave), p.divergencias.join('; '));
  console.log('soTotvs', l.totvsSemStone.map(t => JSON.stringify(t).slice(0, 250)));
  srv.close(); process.exit(0);
});
