import { BankReturnParser } from './utils/bankReturnParser.js';
import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const dirCandidates = ['UNICRED', 'Unicred', 'unicred'].map(d => path.join(cwd, d));
const foundDir = dirCandidates.find(d => fs.existsSync(d));

function formatBRL(v) {
  if (v == null) return 'N/A';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function printResultado(fileName, r) {
  console.log(`\n===== UNICRED | ${fileName} =====`);
  console.log(`Banco: ${r.banco.nome} (${r.banco.codigo}) [${r.banco.layout}]`);
  console.log(`Agência: ${r.agencia}`);
  console.log(`Conta: ${r.conta}`);
  console.log(`Empresa: ${r.empresa ?? '-'}`);
  console.log(`Banco destino: ${r.bancoDestino ?? r.banco.nome}`);
  console.log(`Data de geração: ${r.dataGeracao} ${r.horaGeracao}`);
  console.log('--- Saldo ---');
  console.log(`Saldo anterior: ${formatBRL(r.saldoAnterior)} (${r.saldoAnteriorFormatado ?? ''})`);
  console.log(`Saldo atual: ${r.saldoFormatado}`);
  console.log(`Limite de crédito: ${formatBRL(r.limiteCredito)} (${r.limiteCreditoFormatado ?? ''})`);
  console.log(`Saldo disponível: ${formatBRL(r.saldoDisponivel)} (${r.saldoDisponivelFormatado ?? ''})`);
  if (r.operacao) {
    console.log(`Operação: ${r.operacao.tipo} (${r.operacao.descricao}) | Sinal: ${r.operacao.sinal}`);
  }
  if (r.detalhes) {
    console.log(`Detalhes: débitos=${r.detalhes.debitos?.length || 0}, tarifas=${r.detalhes.tarifas?.length || 0}, créditos=${r.detalhes.creditos?.length || 0}`);
  }
}

(async () => {
  let files = [];
  if (foundDir) {
    files = fs.readdirSync(foundDir)
      .filter(f => f.toLowerCase().endsWith('.ret'))
      .map(f => ({ name: f, full: path.join(foundDir, f) }));
  } else {
    // Fallback: procurar possíveis arquivos conhecidos
    const possible = [
      path.join(cwd, 'UNICRED', 'EXT_136_68500_250813_00000.RET'),
      path.join(cwd, 'UNICRED', 'EXT_136_7098-0_13082500.ret')
    ];
    possible.forEach(p => {
      if (fs.existsSync(p)) files.push({ name: path.basename(p), full: p });
    });
  }

  if (files.length === 0) {
    console.log('Nenhum arquivo .RET da UNICRED encontrado. Verifique a pasta UNICRED/ e tente novamente.');
    process.exit(0);
  }

  const parser = new BankReturnParser();
  for (const f of files) {
    const content = fs.readFileSync(f.full, 'utf8');
    const r = parser.parseFile(content);
    printResultado(f.name, r);
  }
})(); 