import XLSX from 'xlsx';
import fs from 'fs';
const wb = XLSX.read(fs.readFileSync(process.argv[2]), { type: 'buffer', cellDates: false });
for (const n of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });
  console.log('##', n, rows.length);
  rows.slice(0, 18).forEach((r, i) => console.log(i, JSON.stringify(r)));
  console.log('...'); rows.slice(-6).forEach((r) => console.log(JSON.stringify(r)));
}
