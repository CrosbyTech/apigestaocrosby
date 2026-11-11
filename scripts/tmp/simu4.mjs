import 'dotenv/config';
import { escolherCartao } from '../../services/stoneLancarTotvs.js';
const base = { nsu: '1', codAutorizacao: '1', valorBruto: 0.01, dataVenda: '2026-10-15' };
const ok = [], erro = [];
for (const b of ['Mastercard','Visa','Elo','Hipercard','Amex']) for (const t of ['Crédito','Débito']) for (const p of (t === 'Débito' ? [1] : [1,2,3,6,10,12])) {
  const r = await escolherCartao({ ...base, bandeira: b, tipoConta: t, parcelas: p });
  (r.erro ? erro : ok).push(`${b} ${t} ${p}x` + (r.erro ? ` → ${r.erro.slice(0, 130)}` : ` → ${r.portador} ${r.card.cardOperator}/${r.card.cardBrand}`));
}
console.log('OK:\n' + ok.join('\n')); console.log('\nERRO:\n' + erro.join('\n'));
process.exit(0);
