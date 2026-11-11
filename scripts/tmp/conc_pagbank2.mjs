import 'dotenv/config';
import { salvarConciliacao } from '../../services/fluxoCaixaConciliacao.js';
const it = (dup, forn, nome, valor) => ({ origem: 'TOTVS_CP', id: `1|${dup}|1|${forn}`, nome, duplicata: `${dup}|1`, valor, valorDuplicata: valor, vencimento: '2026-11-11', empresa: 'Empresa 1', detalhe: `fatura cartão PagBank 4638 (venc. 10/10/2026) · dup ${dup}/1` });
const usuario = 'Theo (fatura cartão PagBank, pedido da Titia 11/11/2026)';
const motivos = ['fatura do cartão PagBank 4638 (venc. 10/10) — pagamento = soma dos lançamentos'];
const grava = async (id, itens, just) => { const r = await salvarConciliacao({ lancamentoId: id, origem: 'MULTIPLO', usuario, referencia: { motivos, itens }, justificativa: just }); console.log(id, r?.id, r?.origem, r?.valor); };
await grava(294641, [it(65692019, 31124, 'FACEBOOK SERVICOS ONLINE', 674.73), it(73551503, 31124, 'FACEBOOK SERVICOS ONLINE', 23.62), it(47058749, 42537, 'EBAZAR.COM.BR (Mercado Livre)', 29.86), it(36730554, 42537, 'EBAZAR.COM.BR (Mercado Livre)', 23.97)],
  'Fatura cartão PagBank 4638 (venc. 10/10) — pagamento antecipado 29/09: Facebook 674,73 + 23,62 + Mercado Livre 29,86 + 23,97');
await grava(294653, [it(72777237, 31124, 'FACEBOOK SERVICOS ONLINE', 1742.78), it(28233937, 93739, 'GOOGLE BRASIL INTERNET', 49.99)],
  'Fatura cartão PagBank 4638 (venc. 10/10) — pagamento antecipado 30/09: Facebook 1.742,78 + Google 49,99');
await grava(294669, [it(8565965, 94334, 'RENDER', 54.38), it(5566565, 94334, 'RENDER', 1553.75), it(656565, 112730, 'ADOBE SYSTEMS BRASIL', 55), it(656565, 101219, 'DROPBOX BH', 65.49), it(525525353, 93739, 'GOOGLE BRASIL INTERNET', 49.99)],
  'Fatura cartão PagBank 4638 (venc. 10/10) — pagamento 07/10: Render 54,38 + 1.553,75 + Adobe 55,00 + Dropbox 65,49 + Google 49,99');
setTimeout(() => process.exit(0), 300);
