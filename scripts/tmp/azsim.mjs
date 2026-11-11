import 'dotenv/config';
import fs from 'fs';
import { conciliarEntradasPorCsv } from '../../services/conciliacaoEntradasCsv.js';
const r = await conciliarEntradasPorCsv({ contaId: 6, buffer: fs.readFileSync('C:/Users/yagom/Downloads/joao-0911-az/planilha.csv'), simular: true });
console.log(JSON.stringify({ ...r, conciliadas: r.conciliadas.length, valor: r.valorConciliado }, null, 1));
for (const c of r.conciliadas.slice(0, 3)) console.log(c.data, c.valor, c.justificativa);
process.exit(0);
