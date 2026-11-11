import 'dotenv/config';
import fs from 'fs';
import { conciliarEntradasPorCsv } from '../../services/conciliacaoEntradasCsv.js';
const simular = process.argv[2] !== 'gravar';
const r = await conciliarEntradasPorCsv({ contaId: 18, buffer: fs.readFileSync('C:/Users/yagom/Downloads/joao-0911-sicredi/extrato.xls'), simular, usuario: 'Theo (extrato Sicredi enviado pelo João)' });
console.log(JSON.stringify({ periodo: r.periodo, linhas: r.linhasCsv, pendentes: r.pendentes, conciliadas: r.conciliadas.length, valor: r.valorConciliado, porCategoria: r.porCategoria, semLinha: r.semLinha.length, erros: r.erros }, null, 1));
const cats = {}; for (const c of r.conciliadas) (cats[c.categoria] ||= []).push(c);
for (const [k, v] of Object.entries(cats)) console.log(k, v.length, '|', v[0].justificativa);
process.exit(0);
