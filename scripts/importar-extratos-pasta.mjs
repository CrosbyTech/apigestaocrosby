// Importa para o Extrato Bancário (fluxo_caixa_*) todos os extratos de uma pasta
// (recursivo): PDFs dos bancos suportados + planilha .xlsx do Pagar.me.
// Uso: node --env-file=.env scripts/importar-extratos-pasta.mjs <pasta> [--usuario nome] [--so regex]
// Reimportar o mesmo extrato não duplica: o período coberto é apagado e regravado.
import fs from 'node:fs';
import path from 'node:path';
import fluxo from '../services/fluxoCaixaExt.js';

const args = process.argv.slice(2);
const pasta = args.find((a) => !a.startsWith('--'));
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : null;
};
if (!pasta) {
  console.error('Uso: node --env-file=.env scripts/importar-extratos-pasta.mjs <pasta> [--usuario nome] [--so regex]');
  process.exit(1);
}
const so = opt('so') ? new RegExp(opt('so'), 'i') : null;
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(pdf|xlsx)$/i.test(f) && (!so || so.test(p))) files.push(p);
  }
})(pasta);
files.sort();
console.log(`${files.length} arquivo(s) para importar de ${pasta}`);

const r = await fluxo.importarVarios(
  files.map((f) => ({ buffer: fs.readFileSync(f), nome: path.basename(f) })),
  { usuario: opt('usuario') || 'script importar-extratos-pasta' },
);
for (const x of r.resultados) {
  if (x.ok)
    console.log(
      `OK   ${String(x.arquivo).padEnd(40)} ${String(x.banco).padEnd(9)} ${String(x.conta || '').padEnd(22)} | ${x.periodo?.inicio}→${x.periodo?.fim} | ${String(x.qtd).padStart(4)} lanc | saldo ${x.saldo?.inicial} → ${x.saldo?.final}${x.inconsistencias ? ` | INCONSIST ${x.inconsistencias}` : ''}${x.avisos?.length ? ` | ${x.avisos[0]}` : ''}`,
    );
  else console.log(`ERRO ${String(x.arquivo).padEnd(40)} ${x.erro}`);
}
console.log(`período coberto: ${r.periodo?.de} → ${r.periodo?.ate}`);
if (r.transferencias) console.log('transferências recasadas:', JSON.stringify(r.transferencias));
process.exit(0);
