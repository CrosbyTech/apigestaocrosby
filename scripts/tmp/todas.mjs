import 'dotenv/config';
import express from 'express';
import router from '../../routes/conciliacaoStone.routes.js';
const app = express(); app.use(express.json()); app.use('/x', router);
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  const j = await (await fetch(`http://127.0.0.1:${port}/x/batimento?stonecode=all&inicio=2026-10-01&fim=2026-10-31`)).json();
  if (!j.success) { console.log(j.message); process.exit(1); }
  for (const l of j.data.lojas) {
    console.log(`\n## ${l.loja.nome} [${l.loja.filiais}] stone ${l.resumo.stone.qtd} pares ${l.pares.length} soStone ${l.stoneSemTotvs.length} soTotvs ${l.totvsSemStone.length} erros ${l.erros.length} agrupados ${l.pares.filter(p=>p.tipo==='agrupado').length}`);
    for (const t of l.totvsSemStone) console.log('  T', t.chave, t.dataEmissao, t.valor, t.parcelas + 'x', t.bandeira, t.tipoConta, 'nsu', t.nsu, 'aut', t.autorizacao, t.cancelado ? 'CANCELADO' : '', t.portador);
    for (const e of l.erros) console.log('  ERRO', e.data, e.erro);
  }
  const fs = await import('fs'); fs.writeFileSync('C:/Users/yagom/AppData/Local/Temp/claude/af7426cb677bf6db/51a33ee0-dae9-4511-930e-04da9a24ffc7/scratchpad/bat_out.json', JSON.stringify(j.data));
  srv.close(); process.exit(0);
});
