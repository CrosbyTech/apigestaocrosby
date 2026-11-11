import 'dotenv/config';
import axios from 'axios';
import { getToken } from '../../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent } from '../../totvsrouter/totvsHelper.js';
const auth = (await getToken()).access_token;
const tenta = async (rot, paidType, card, branch = 99) => {
  const payload = { branchCode: branch, settlementDate: '2026-10-15T12:00:00',
    invoices: [{ branchCode: 99, customerCode: 1, receivableCode: 9999999991, installmentCode: 1, paidValue: 0.01 }],
    payments: [{ value: 0.01, paidType, movementDate: '2026-10-15T12:00:00', card: { nsu: 1, autorization: '1', installmentQuantity: 1, ...card } }] };
  try { const r = await axios.post(`${TOTVS_BASE_URL}/accounts-receivable/v2/invoices-payment`, payload, { headers: { Authorization: `Bearer ${auth}` }, httpsAgent }); console.log(rot, 'OK?!', JSON.stringify(r.data).slice(0,300)); }
  catch (e) { console.log(rot, e.response?.status, JSON.stringify(e.response?.data).slice(250, 900)); }
};
await tenta('cred STONE/MASTER', 1, { cardOperator: 'STONE', cardBrand: 'MASTER' });
await tenta('cred MASTER/MASTER', 1, { cardOperator: 'MASTER', cardBrand: 'MASTER' });
await tenta('cred STONE/STONE', 1, { cardOperator: 'STONE', cardBrand: 'STONE' });
await tenta('cred STONE/VISA', 1, { cardOperator: 'STONE', cardBrand: 'VISA' });
await tenta('deb MASTER/MASTER', 2, { cardOperator: 'MASTER', cardBrand: 'MASTER' });
await tenta('cred STONE/STONE b1', 1, { cardOperator: 'STONE', cardBrand: 'STONE' }, 1);
process.exit(0);
