import 'dotenv/config';
import { postTotvs } from '../../services/bluecardLimite.js';
import { escolherCartao } from '../../services/stoneLancarTotvs.js';
for (const rc of [3557482896, 2255245011]) {
  const r = await postTotvs('/accounts-receivable/v2/documents/search', { filter: { customerCodeList: [82254], receivableCodeList: [rc] }, page: 1, pageSize: 10 });
  for (const x of r.data.items || []) console.log(rc, x.branchCode, x.installmentCode, x.documentType, x.bearerCode, x.installmentValue, x.paidValue, x.status, x.issueDate, x.expiredDate, x.settlementDate, x.paymentDate);
  if (!(r.data.items || []).length) console.log(rc, 'não achei');
}
const r = await escolherCartao({ nsu: '1', codAutorizacao: '1', bandeira: 'Mastercard', tipoConta: 'Débito', parcelas: 1 });
console.log('master debito', r.erro || `${r.portador} ${r.card.cardOperator}/${r.card.cardBrand}`);
process.exit(0);
