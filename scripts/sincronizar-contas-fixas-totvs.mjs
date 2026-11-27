// CONTAS FIXAS DAS LOJAS: carrega do TOTVS (só leitura) os títulos das contas fixas de antes de novembro/2026.
//   node scripts/sincronizar-contas-fixas-totvs.mjs                         → só mostra o que viria (jan–out/2026)
//   node scripts/sincronizar-contas-fixas-totvs.mjs aplicar                 → grava em contas_fixas_totvs_titulos
//   node scripts/sincronizar-contas-fixas-totvs.mjs aplicar 2026-09 2026-10 → só esses meses
import 'dotenv/config';
import { sincronizarContasFixasTotvs } from '../services/contasFixasTotvs.js';

const args = process.argv.slice(2);
const aplicar = args.includes('aplicar');
const meses = args.filter((a) => /^\d{4}-\d{2}$/.test(a));
const de = `${meses[0] || '2026-01'}-01`;
const ate = `${meses[1] || meses[0] || '2026-10'}-28`;
const r = await sincronizarContasFixasTotvs({ de, ate, gravar: aplicar, log: (m) => console.log(' ', m) });
console.log(`${aplicar ? 'GRAVADO' : '(simulação: nada foi gravado)'} — ${r.linhas} linha(s) de ${r.meses.length} mês(es)`);
process.exit(0);
