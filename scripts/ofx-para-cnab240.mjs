// Converte um extrato da Stone (PDF "Comprovante de Extrato" ou OFX) em CNAB 240
// FEBRABAN (extrato p/ conciliação) para importar no TOTVS.
//
// Uso:
//   node scripts/ofx-para-cnab240.mjs <entrada.pdf|.ofx> <saida.txt> [--cnpj 00000000000000] [--empresa "NOME LTDA"] [--banco-nome "STONE PAGAMENTOS"] [--seq 1]
// No PDF, CNPJ e empresa vêm do próprio arquivo (podem ser sobrescritos). No OFX são obrigatórios.
import fs from 'node:fs';
import { parseOfx, gerarCnab240, decodificarOfx } from '../utils/ofxParaCnab240.js';
import { parseExtratoPdfStone } from '../utils/extratoStonePdf.js';

const args = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const [entrada, saida] = pos;
if (!entrada || !saida) {
  console.error('Uso: node scripts/ofx-para-cnab240.mjs <entrada.pdf|.ofx> <saida.txt> [--cnpj …] [--empresa "…"] [--banco-nome …] [--seq N]');
  process.exit(1);
}

const buf = fs.readFileSync(entrada);
const ehPdf = /\.pdf$/i.test(entrada) || buf.slice(0, 5).toString('latin1') === '%PDF-';
const extrato = ehPdf ? await parseExtratoPdfStone(buf) : parseOfx(decodificarOfx(buf));

if (ehPdf) {
  console.log('Titular (do PDF):', JSON.stringify(extrato.titular));
  console.log('Conferência de saldo:', JSON.stringify(extrato.conferencia), extrato.avisos.length ? `avisos: ${extrato.avisos.join(' | ')}` : 'sem avisos');
}

const { conteudo, resumo } = gerarCnab240(extrato, {
  cnpj: opt('cnpj') || extrato.titular?.cnpj,
  empresa: opt('empresa') || extrato.titular?.nome,
  nomeBanco: opt('banco-nome'),
  sequencia: opt('seq') ? Number(opt('seq')) : undefined,
});
fs.writeFileSync(saida, conteudo, 'latin1');
console.log(JSON.stringify(resumo, null, 2));
console.log(`OK → ${saida}`);
