// Roda migrations/fluxo_caixa_escopo_dr_ygor.sql no Supabase principal via RPC exec_sql
//   node scripts/migrar-fluxo-caixa-escopo.mjs
import 'dotenv/config';
import fs from 'node:fs';
import supabase from '../config/supabase.js';

const sql = fs.readFileSync(new URL('../migrations/fluxo_caixa_escopo_dr_ygor.sql', import.meta.url), 'utf8');
const r = await supabase.rpc('exec_sql', { query: sql });
console.log('migration:', JSON.stringify(r.data || r.error));
const q = await supabase.from('fluxo_caixa_contas').select('id,escopo').limit(3);
console.log('check:', JSON.stringify(q.data || q.error));
