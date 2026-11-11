import 'dotenv/config';
import { postTotvs } from '../../services/bluecardLimite.js';
const r = await postTotvs('/accounts-receivable/v2/documents/search', { filter: { branchCodeList: [94], receivableCodeList: [195367, 195372, 195121] }, expand: 'invoice', page: 1, pageSize: 100 });
for (const x of r.data.items || []) console.log(x.receivableCode, x.customerCode, x.installmentCode, x.documentType, x.bearerCode, x.bearerName, x.installmentValue, x.paidValue, x.issueDate, x.expiredDate, x.status, x.chargeType, x.settlementSequence, x.registrationUser, JSON.stringify(x.invoice || []).slice(0, 200));
process.exit(0);
