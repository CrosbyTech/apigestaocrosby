import 'dotenv/config';
import { salvarConciliacao } from '../../services/fluxoCaixaConciliacao.js';
const it = (dup, forn, nome, valor) => ({ origem: 'TOTVS_CP', id: `1|${dup}|1|${forn}`, nome, duplicata: `${dup}|1`, valor, valorDuplicata: valor, vencimento: '2026-11-11', empresa: 'Empresa 1', detalhe: `fatura cartão PagBank 4638 (venc. 10/11/2026) · dup ${dup}/1` });
const usuario = 'Theo (fatura cartão PagBank, pedido da Titia 11/11/2026)';
const motivos = ['fatura do cartão PagBank 4638 — pagamento antecipado = soma dos lançamentos'];
const a = await salvarConciliacao({ lancamentoId: 294679, origem: 'MULTIPLO', usuario, referencia: { motivos, itens: [
  it(68648763, 31124, 'FACEBOOK SERVICOS ONLINE', 2280.12), it(61575397, 130997, 'DEEPSEEK', 19.36), it(38301590, 130997, 'DEEPSEEK', 553.08), it(90903599, 19940, 'PAGSEGURO (recarga celular)', 50) ] },
  justificativa: 'Fatura cartão PagBank 4638 (venc. 10/11) — pagamento antecipado 14/10: Facebook 2.280,12 + DeepSeek 19,36 + DeepSeek 553,08 + recarga 50,00' });
console.log('294679', a?.id, a?.origem, a?.valor);
const b = await salvarConciliacao({ lancamentoId: 294676, origem: 'MULTIPLO', usuario, referencia: { motivos, itens: [
  it(38297863, 31124, 'FACEBOOK SERVICOS ONLINE', 941.77), it(37185203, 31124, 'FACEBOOK SERVICOS ONLINE', 6.82) ] },
  justificativa: 'Fatura cartão PagBank 4638 (venc. 10/11) — pagamento antecipado 14/10: Facebook 941,77 + Facebook 6,82' });
console.log('294676', b?.id, b?.origem, b?.valor);
setTimeout(() => process.exit(0), 300);
