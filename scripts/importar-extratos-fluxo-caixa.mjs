// Importa extratos bancários em PDF (Stone, Sicredi, Caixa, Mêntore) direto no
// Supabase, sem passar pela API — útil para carga inicial / lote.
//
// Uso: node scripts/importar-extratos-fluxo-caixa.mjs <pasta-ou-arquivo.pdf> [...]
//      node scripts/importar-extratos-fluxo-caixa.mjs --so-ler <pasta>   (não grava)
//
// Pré-requisito: migrations/fluxo_caixa_ext.sql aplicada no Supabase.
import fs from 'node:fs';
import path from 'node:path';
import fluxo from '../services/fluxoCaixaExt.js';

const args = process.argv.slice(2);
const soLer = args.includes('--so-ler');
const alvos = args.filter((a) => !a.startsWith('--'));
if (!alvos.length) {
  console.error('Uso: node scripts/importar-extratos-fluxo-caixa.mjs <pasta-ou-arquivo.pdf> [...] [--so-ler]');
  process.exit(1);
}

const arquivos = [];
for (const alvo of alvos) {
  const st = fs.statSync(alvo);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(alvo).filter((x) => /\.pdf$/i.test(x)).sort()) arquivos.push(path.join(alvo, f));
  } else if (/\.pdf$/i.test(alvo)) arquivos.push(alvo);
}
if (!arquivos.length) {
  console.error('Nenhum PDF encontrado.');
  process.exit(1);
}
console.log(`${arquivos.length} PDF(s)${soLer ? ' (só leitura)' : ''}\n`);

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));

if (soLer) {
  for (const f of arquivos) {
    try {
      const e = await fluxo.lerExtrato(fs.readFileSync(f), { nomeArquivo: path.basename(f) });
      console.log(`✔ ${path.basename(f)} → ${e.banco} | ${e.apelido} | ${e.titular.nome} | ${e.periodo.inicio}..${e.periodo.fim} | ${e.qtd} lanç. | saldo ${fmt(e.saldo.inicial)} → ${fmt(e.saldo.final)}${e.avisos.length ? ' | avisos: ' + e.avisos.join('; ') : ''}`);
    } catch (err) {
      console.log(`✖ ${path.basename(f)}: ${err.message}`);
    }
  }
  process.exit(0);
}

const r = await fluxo.importarVarios(
  arquivos.map((f) => ({ buffer: fs.readFileSync(f), nome: path.basename(f) })),
  { usuario: 'script' },
);
for (const x of r.resultados) {
  if (x.ok) console.log(`✔ ${x.arquivo} → ${x.banco} | ${x.conta} | ${x.periodo.inicio}..${x.periodo.fim} | ${x.qtd} lanç. | saldo ${fmt(x.saldo.inicial)} → ${fmt(x.saldo.final)}${x.inconsistencias ? ` | ⚠ ${x.inconsistencias} inconsistência(s)` : ''}${x.avisos.length ? ' | ' + x.avisos.join('; ') : ''}`);
  else console.log(`✖ ${x.arquivo}: ${x.erro}`);
}
if (r.transferencias) console.log(`\nTransferências entre contas (${r.periodo.de}..${r.periodo.ate}): ${r.transferencias.criadas} casadas (${r.transferencias.desfeitas} refeitas)`);
process.exit(0);
