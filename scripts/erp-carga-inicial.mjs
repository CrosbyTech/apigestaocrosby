// Carga inicial dos cadastros mestres TOTVS → HeadCoach (ERP fase 0).
//
//   node scripts/erp-carga-inicial.mjs                 todas as entidades (ordem de dependência)
//   node scripts/erp-carga-inicial.mjs empresas cores  só as entidades listadas
//   node scripts/erp-carga-inicial.mjs --delta         modo delta (só o que mudou)
//   node scripts/erp-carga-inicial.mjs --pular pessoas_pf   tudo menos as listadas
//   node scripts/erp-carga-inicial.mjs contas_pagar --desde 2023-01-01 [--ate 2026-10-16]
//        carga histórica do contas a pagar por emissão, mês a mês (~1.000 parcelas/mês)
//
// Volumes (out/2026): PF ~121k (242 páginas de 500, ~35 min), produtos ~86k
// (172 páginas, ~20 min), PJ 3,5k, resto pequeno. Pode rodar em paralelo ao
// servidor; o runner trava por entidade e registra em erp_sync_log.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { executarVarios, ORDEM_EXPORT } = await import('../services/erp/sync/runner.js').then(async (m) => {
  const { ORDEM } = await import('../services/erp/sync/entidades.js');
  return { executarVarios: m.executarVarios, ORDEM_EXPORT: ORDEM };
});

const argv = process.argv.slice(2);
// --desde/--ate levam valor: tira do argv antes de separar as entidades
const valorDe = (flag) => {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const v = argv[i + 1];
  argv.splice(i, 2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) {
    console.error(`${flag} exige data AAAA-MM-DD`);
    process.exit(1);
  }
  return v;
};
const desde = valorDe('--desde');
const ate = valorDe('--ate');
const args = argv;
const modo = args.includes('--delta') ? 'delta' : 'full';
const pularIdx = args.indexOf('--pular');
const pular = pularIdx >= 0 ? args.slice(pularIdx + 1).filter((a) => !a.startsWith('--')) : [];
const pedidas = args.filter((a, i) => !a.startsWith('--') && (pularIdx < 0 || i < pularIdx));
const entidades = (pedidas.length ? pedidas : ORDEM_EXPORT).filter((e) => !pular.includes(e));

console.log(`▶ carga ${modo}: ${entidades.join(', ')}${desde ? ` desde ${desde}` : ''}${ate ? ` até ${ate}` : ''}`);
const t0 = Date.now();
const opcoes = { ...(desde ? { desde } : {}), ...(ate ? { ate: new Date(`${ate}T23:59:59`) } : {}) };
const res = await executarVarios(entidades, modo, { disparadoPor: 'script-carga-inicial', opcoes });
console.log('\n=== RESUMO ===');
for (const r of res) {
  if (r.erro) console.log(`❌ ${r.entidade}: ${r.erro}`);
  else console.log(`✅ ${r.entidade}: ${r.registros} registros, ${r.paginas} páginas, TOTVS=${r.totalTotvs ?? '?'} local=${r.totalLocal ?? '?'} (${Math.round((r.duracaoMs || 0) / 1000)}s)`);
}
console.log(`tempo total: ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(res.some((r) => r.erro) ? 1 : 0);
