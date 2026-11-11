import 'dotenv/config';
import { postTotvs } from '../../services/bluecardLimite.js';
for (const c of [82254, 20392]) {
  const r = await postTotvs('/accounts-receivable/v2/documents/search', { filter: { customerCodeList: [c], receivableCodeList: [196217, 196218] }, expand: 'invoice,classifications', page: 1, pageSize: 10 });
  for (const x of r.data.items || []) console.log(c, x.receivableCode, x.documentType, x.settlementSequence, x.settlementBranchCode, x.settlementDate, x.registrationUser, x.dischargeUser, x.maxChangeFilterDate, x.chargeType, x.billingType);
}
process.exit(0);
