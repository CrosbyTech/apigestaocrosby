import 'dotenv/config';
import express from 'express';
import router from '../../routes/conciliacaoStone.routes.js';
const app = express(); app.use(express.json()); app.use('/x', router);
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  // fatura já baixada → lançar de novo só acha o título e grava o vínculo (não regrava nada no TOTVS)
  const r = await (await fetch(`http://127.0.0.1:${port}/x/lancar-totvs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'Theo (teste João)', itens: [{ stonecode: '579299624', nsu: '38863557482896', dataArquivo: '2026-10-15' }, { stonecode: '579299624', nsu: '38862255245011', dataArquivo: '2026-10-15' }] }) })).json();
  for (const x of r.data.resultados) console.log(x.nsu, x.ok, x.jaExistia, x.mensagem || x.erro, JSON.stringify(x.tituloCartao), JSON.stringify(x.vinculo));
  const j = await (await fetch(`http://127.0.0.1:${port}/x/batimento?stonecode=579299624&inicio=2026-10-15&fim=2026-10-15`)).json();
  const l = j.data.lojas[0];
  console.log('soStone', l.stoneSemTotvs.map(s => s.nsu));
  for (const p of l.pares) console.log('par', p.stone.nsu, p.tipo, p.totvs.chave, p.divergencias.join('; '));
  console.log('soTotvs', l.totvsSemStone.map(t => t.chave));
  srv.close(); process.exit(0);
});
