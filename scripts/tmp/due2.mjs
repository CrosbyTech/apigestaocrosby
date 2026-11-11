import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data } = await supabase.from('accounts_payable_commands').select('id,sucesso,payload,resposta,criado_em').eq('command', 'create').order('id', { ascending: false }).limit(400);
const cmp = { okIgual: 0, okMaior: 0, okMenor: 0, falhaDue: [] };
for (const c of data) {
  const i = c.payload?.installments?.[0] || {};
  const due = String(i.dueDate || '').slice(0, 19), iss = String(i.issueDate || '').slice(0, 19), arr = String(i.arrivalDate || '').slice(0, 19);
  if (c.sucesso) { if (due.slice(0,10) === iss.slice(0,10)) { cmp.okIgual++; if (cmp.okIgual < 4) console.log('OK igual', c.id, due, iss, arr); } else if (due > iss) cmp.okMaior++; else cmp.okMenor++; }
  else if (/DueDate/i.test(JSON.stringify(c.resposta))) cmp.falhaDue.push([c.id, due, iss, arr, JSON.stringify(c.resposta).slice(0, 200)]);
}
console.log(cmp.okIgual, cmp.okMaior, cmp.okMenor); console.log(cmp.falhaDue.slice(0, 5));
process.exit(0);
