import 'dotenv/config';
import express from 'express';
import router from '../../totvsrouter/promocaoValores.js';
const app = express(); app.use(express.json()); app.use('/api/totvs', router);
const srv = app.listen(4199, async () => {
  const post = async (body) => (await fetch('http://localhost:4199/api/totvs/promocao-valores/buscar-produtos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const t0 = Date.now();
  let j = await post({ tamanhos: ['2','4','6','8','10','12','14','P','PP'] });
  console.log('infantil+P/PP', j.data?.itens.length, 'fora', j.data?.inativosFora, (Date.now()-t0)+'ms');
  j = await post({ tamanhos: ['2','4','6','8','10','12','14'] }); console.log('só 2-14', j.data?.itens.length, j.data?.itens.slice(0,2).map(x=>x.nome));
  j = await post({ tamanhos: ['GG','XG','XL1','XL2','XL3'] }); console.log('king', j.data?.itens.length);
  j = await post({ termos: ['FEM','FEMININO','VESTIDO','GOLA'] }); console.log('fem', j.data?.itens.length, j.data?.itens.slice(0,3).map(x=>x.nome));
  j = await post({ termos: ['VESTIDO'], tamanhos: ['P'] }); console.log('vestido P', j.data?.itens.length, j.data?.itens.slice(0,2).map(x=>x.nome+'|'+x.fonte));
  j = await post({}); console.log('vazio', j.message);
  const b = await (await fetch('http://localhost:4199/api/totvs/promocao-valores/base-produtos')).json(); console.log('base', JSON.stringify(b.data));
  srv.close(); process.exit(0);
});
