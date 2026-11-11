import 'dotenv/config';
import supabase from '../../config/supabase.js';
const { data, error } = await supabase.from('accounts_payable_commands').select('id,command,sucesso,payload,resposta,criado_em').eq('command', 'create').order('id', { ascending: false }).limit(300);
if (error) { console.log(error.message); process.exit(0); }
let ok = 0, okPassado = 0, falha = {};
for (const c of data) {
  const inst = c.payload?.installments?.[0] || {};
  const due = String(inst.dueDate || '').slice(0, 10), iss = String(inst.issueDate || '').slice(0, 10), cri = String(c.criado_em).slice(0, 10);
  if (c.sucesso) { ok++; if (due < cri) { okPassado++; if (okPassado <= 5) console.log('OK com venc. passado', c.id, 'venc', due, 'emis', iss, 'criado', cri); } }
  else { const m = JSON.stringify(c.resposta).slice(0, 120); falha[m] = (falha[m] || 0) + 1; }
}
console.log('ok', ok, 'ok com vencimento passado', okPassado);
console.log(falha);
process.exit(0);
