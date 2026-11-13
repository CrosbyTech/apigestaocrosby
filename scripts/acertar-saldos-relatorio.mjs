// Acerta os saldos de CREDEV e adiantamento do HeadCoach pelo relatório do
// TOTVS FCCR015 (Saldo de Conta por Pool, exportado em texto): o saldo de cada
// cliente na empresa vira o do relatório (só as colunas Credev e Adiantamento)
// + o que só aconteceu no HeadCoach. Sem --aplicar, só simula.
// Uso, na raiz da API:
//   node scripts/acertar-saldos-relatorio.mjs "C:/caminho/lista credev.txt" [empresa] [--aplicar]
import fs from 'node:fs';
import { lerRelatorioFccr015, acertarPeloRelatorio } from '../services/hcSaldosClientes.js';

const arquivo = process.argv[2];
const empresa = Number(process.argv.find((a, i) => i > 2 && /^\d+$/.test(a))) || 99;
const aplicar = process.argv.includes('--aplicar');
if (!arquivo || !fs.existsSync(arquivo)) {
  console.error('Informe o arquivo do relatório FCCR015 (texto).');
  process.exit(1);
}
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const texto = fs.readFileSync(arquivo, 'latin1');
const { linhas, contas, totais } = lerRelatorioFccr015(texto);
const soma = (t) => Math.round(linhas.reduce((s, l) => s + l[t], 0) * 100) / 100;
console.log(`Relatório: ${linhas.length}/${contas} conta(s) lida(s) · CREDEV ${brl(soma('credev'))} · adiantamento ${brl(soma('adiantamento'))}`);
if (totais) console.log(`Total do TOTVS:        CREDEV ${brl(totais.credev)} · adiantamento ${brl(totais.adiantamento)}`);
if (linhas.length !== contas || (totais && (Math.abs(soma('credev') - totais.credev) > 0.005 || Math.abs(soma('adiantamento') - totais.adiantamento) > 0.005))) {
  console.error('❌ A leitura não bate com o relatório — nada foi feito.');
  process.exit(1);
}
const outros = linhas.filter((l) => l.grupo !== empresa);
if (outros.length) {
  console.error(`❌ O relatório tem contas de outro grupo/empresa (${[...new Set(outros.map((l) => l.grupo))].join(', ')}) — confira a empresa.`);
  process.exit(1);
}
const dataRel = (texto.match(/Data\/Hora\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/) || [])[1] || 'sem data';
const r = await acertarPeloRelatorio({ empresa, linhas, referencia: `FCCR015 ${dataRel}`, aplicar });
console.log(`\n${aplicar ? 'APLICADO' : 'SIMULAÇÃO (nada gravado)'} — empresa ${empresa}: ${r.clientes} cliente(s) · ${r.mudancas.length} mudança(s) · ${r.semMudanca} já certo(s)`);
console.log(`  antes:  CREDEV ${brl(r.antes.credev)} · adiantamento ${brl(r.antes.adiantamento)}`);
console.log(`  depois: CREDEV ${brl(r.depois.credev)} · adiantamento ${brl(r.depois.adiantamento)}`);
for (const n of r.negativos) console.log(`  NEGATIVO no TOTVS (fica 0 aqui): cliente ${n.cliente} ${n.nome || ''} ${n.tipo} ${brl(n.valor)}`);
const comHc = r.mudancas.filter((m) => m.soHeadcoach);
for (const m of comHc) console.log(`  com movimento só do HeadCoach: cliente ${m.cliente} ${m.tipo}: TOTVS ${brl(m.totvs)} + HeadCoach ${brl(m.soHeadcoach)} = ${brl(m.depois)}`);
for (const e of r.erros) console.log(`  ERRO ${JSON.stringify(e)}`);
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync(`tmp/acerto-saldos-${empresa}${aplicar ? '' : '-simulacao'}.json`, JSON.stringify(r, null, 2));
console.log(`detalhe: tmp/acerto-saldos-${empresa}${aplicar ? '' : '-simulacao'}.json`);
process.exit(r.erros.length ? 1 : 0);
