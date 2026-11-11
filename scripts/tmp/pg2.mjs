import 'dotenv/config';
import { postTotvs } from '../../services/bluecardLimite.js';
for (const [b, rc] of [[2, 4623321606], [90, 4631101714], [97, 4627646458]]) {
  const r = await postTotvs('/accounts-receivable/v2/documents/search', { filter: { branchCodeList: [b], receivableCodeList: [rc] }, page: 1, pageSize: 20 });
  for (const x of r.data.items || []) console.log(b, rc, 'cli', x.customerCode, 'parc', x.installmentCode, x.bearerName, x.installmentValue, 'emis', x.issueDate, 'user', x.registrationUser, 'chargeType', x.chargeType, 'liqSeq', x.settlementSequence);
}
process.exit(0);
