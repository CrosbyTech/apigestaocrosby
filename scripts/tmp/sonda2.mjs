import 'dotenv/config';
import axios from 'axios';
import { getToken } from '../../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent } from '../../totvsrouter/totvsHelper.js';
import { escolherCartao } from '../../services/stoneLancarTotvs.js';
const auth = (await getToken()).access_token;
for (const [b, t, p] of [['Mastercard','Crédito',3],['Visa','Crédito',2],['Elo','Crédito',1],['Hipercard','Crédito',1],['Mastercard','Débito',1],['Visa','Crédito',1]]) {
  const c = await escolherCartao({ nsu: '1', codAutorizacao: '1', bandeira: b, tipoConta: t, parcelas: p });
  const payload = { branchCode: 99, settlementDate: '2026-10-15T12:00:00', invoices: [{ branchCode: 99, customerCode: 82254, receivableCode: 9999999991, installmentCode: 1, paidValue: 0.01 }], payments: [{ value: 0.01, paidType: c.paidType, movementDate: '2026-10-15T12:00:00', card: c.card }] };
  try { await axios.post(`${TOTVS_BASE_URL}/accounts-receivable/v2/invoices-payment`, payload, { headers: { Authorization: `Bearer ${auth}` }, httpsAgent }); console.log(b, t, p, 'OK?!'); }
  catch (e) { const errs = (e.response?.data || []).map(x => x.code + ':' + x.detailedMessage); console.log(b, t, p, errs.some(x => /ValidateCard/.test(x)) ? 'CARTÃO NÃO ACHADO' : 'cartão ok (só fatura inexistente)'); }
}
process.exit(0);
