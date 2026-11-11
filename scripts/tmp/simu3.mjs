import 'dotenv/config';
import { lancarVendaStone, escolherCartao } from '../../services/stoneLancarTotvs.js';
const base = { nsu: '38863557000001', codAutorizacao: '123456', parcelas: 1, valorBruto: 0.01, dataVenda: '2026-10-15', cancelada: false };
for (const [b, t, p] of [['Visa','Crédito',1],['Visa','Débito',1],['Elo','Crédito',1],['Elo','Débito',1],['Mastercard','Débito',1],['Visa','Crédito',3]]) {
  const r = await escolherCartao({ ...base, bandeira: b, tipoConta: t, parcelas: p });
  console.log(b, t, p, r.erro ? 'ERRO: ' + r.erro.slice(0, 160) : `${r.portador} ${r.cadastro} ${JSON.stringify(r.card)}`);
}
const r = await lancarVendaStone({ venda: { ...base, bandeira: 'Visa', tipoConta: 'Crédito' }, loja: { cnpj: '17177680001007', filiais: [99] }, cliente: 82254, simular: true });
console.log(JSON.stringify(r));
process.exit(0);
