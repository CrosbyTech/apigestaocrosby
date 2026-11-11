import 'dotenv/config';
import { getLojaByStonecode, stonecodesDaLoja } from '../../config/stoneConciliacao.js';
import { obterDiaStone } from '../../services/stoneConciliacao.js';
const cfg = getLojaByStonecode('579299624');
const dias = ['2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-10-19','2026-10-20'];
const vendas = new Map();
for (const sc of stonecodesDaLoja(cfg)) for (const d of dias) {
  const dia = await obterDiaStone({ ...cfg, stonecode: sc }, d);
  for (const t of dia.transacoes) vendas.set(t.nsu, t);
}
for (const sc of stonecodesDaLoja(cfg)) for (const d of dias) {
  const dia = await obterDiaStone({ ...cfg, stonecode: sc }, d);
  for (const p of dia.pagamentos || []) {
    const liq = (dia.liquidacoes || []).filter(l => String(l.paymentId) === String(p.id));
    const ev = (dia.eventosFinanceiros || []).filter(e => String(e.paymentId) === String(p.id));
    const brands = {};
    let ant = 0, nao = 0;
    for (const l of liq) { const v = vendas.get(l.nsu); const k = v ? `${v.bandeira} ${v.tipoConta}` : '?'; brands[k] = (brands[k]||0)+1; l.antecipada ? ant++ : nao++; }
    console.log(sc, d, p.id, p.carteiraId, p.carteira, p.valorTotal, 'liq', liq.length, 'antecip', ant, 'normal', nao, JSON.stringify(brands), 'ev', ev.length, ev.map(e=>e.tipo+':'+e.valor).join(','), 'conta', p.banco, p.conta);
    if (p.valorTotal <= 0.05) for (const l of liq) console.log('   ->', l.nsu, l.dataCaptura, l.bruto, l.liquido, l.antecipada, l.dataOriginal);
  }
}
process.exit(0);
