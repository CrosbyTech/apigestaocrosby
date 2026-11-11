import 'dotenv/config';
import { conciliarLiberacaoPagos } from '../../services/conciliacaoPropagacao.js';
const r = await conciliarLiberacaoPagos({ dias: 15, simular: true });
console.log('analisados', r.analisados, 'conciliaria', r.conciliados.length, 'ambiguos', r.ambiguos.length, 'semSaida', r.semSaida);
for (const c of r.conciliados.slice(0, 15)) console.log(' OK', c.fornecedor, c.valor, '→ saída', c.saida.data, c.saida.id);
for (const a of r.ambiguos.slice(0, 8)) console.log(' ?', a.fornecedor, a.valor, a.dtPagamento, JSON.stringify(a.saidas || a.erro).slice(0, 220));
process.exit(0);
