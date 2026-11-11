import 'dotenv/config';
import { postTotvs } from '../../services/bluecardLimite.js';
for (const f of [{ startIssueDate: '2026-10-15T00:00:00', endIssueDate: '2026-10-15T23:59:59' }, { startIssueDate: '2026-11-04T00:00:00', endIssueDate: '2026-11-05T23:59:59' }]) {
  let page = 1;
  for (;;) {
    const r = await postTotvs('/accounts-receivable/v2/documents/search', { filter: { branchCodeList: [99], documentTypeList: [4, 5], ...f }, page, pageSize: 100 });
    for (const x of (r.data.items || []).filter(x => Number(x.installmentValue) <= 0.05)) console.log(JSON.stringify({ b: x.branchCode, c: x.customerCode, rc: x.receivableCode, p: x.installmentCode, dt: x.documentType, bearer: x.bearerCode, nome: x.bearerName, v: x.installmentValue, pago: x.paidValue, emis: x.issueDate, venc: x.expiredDate, st: x.status }));
    if (!r.data.hasNext) break; page++;
  }
}
process.exit(0);
