// Cria a tabela contas_pagar_pagos_conciliacao (migrations/contas_pagar_pagos_conciliacao.sql)
// e faz a 1ª carga a partir das conciliações já gravadas.
// Uso: node scripts/migrar-cp-pagos-conciliacao.mjs
import 'dotenv/config';
import fs from 'fs';
import supabase from '../config/supabase.js';
import { sincronizarTodas } from '../services/conciliacaoPropagacao.js';

const sql = fs.readFileSync(new URL('../migrations/contas_pagar_pagos_conciliacao.sql', import.meta.url), 'utf8');
const { error } = await supabase.rpc('exec_sql', { query: sql });
if (error) {
  console.error('Migration falhou:', error.message);
  process.exit(1);
}
console.log('Tabela contas_pagar_pagos_conciliacao OK.');
const r = await sincronizarTodas({ de: '2026-01-01' });
console.log(`Carga: ${r.conciliacoes} conciliações lidas, ${r.duplicatas} duplicatas marcadas PAGO VIA CONCILIAÇÃO, ${r.liberacaoPagos} APROVADO→PAGO na Liberação.`);
process.exit(0);
