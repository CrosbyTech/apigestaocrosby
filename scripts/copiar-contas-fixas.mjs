// CONTAS FIXAS DAS LOJAS: copia as contas de um mês para o seguinte, como PREVISÃO no Contas a Pagar HeadCoach.
//   node scripts/copiar-contas-fixas.mjs novembro            → mostra o que falta em novembro/2026 (vindo de outubro)
//   node scripts/copiar-contas-fixas.mjs dezembro            → mostra dezembro/2026 (tudo de novembro)
//   node scripts/copiar-contas-fixas.mjs novembro aplicar    → cria (não repete o que já foi criado)
//   valor: aluguel e internet repetem o do mês de origem; o resto entra a R$ 0,01 (--valor=0.01 força tudo simbólico)
import 'dotenv/config';
import fs from 'node:fs';
import { planoDaCopia, aplicarCopia } from '../services/contasFixasCopia.js';

const args = process.argv.slice(2);
const qual = args[0];
const aplicar = args.includes('aplicar');
const valorArg = args.find((a) => a.startsWith('--valor='));
const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const PLANOS = {
  // valor 'fixos': aluguel e internet repetem o valor do mês de origem; o resto entra a R$ 0,01
  novembro: { origem: '2026-10', destino: '2026-11', valor: valorArg ? Number(valorArg.split('=')[1]) : 'fixos', soFaltantes: true, comCadastroSemConta: false },
  dezembro: { origem: '2026-11', destino: '2026-12', valor: valorArg ? Number(valorArg.split('=')[1]) : 'fixos', soFaltantes: false, comCadastroSemConta: true },
};
if (!PLANOS[qual]) { console.log('use: node scripts/copiar-contas-fixas.mjs novembro|dezembro [aplicar]'); process.exit(1); }
const plano = await planoDaCopia(PLANOS[qual]);
console.log(`\n${plano.origem} → ${plano.destino}: ${plano.itens.length} conta(s) a criar · total R$ ${brl(plano.total)}${plano.jaCriados ? ` · ${plano.jaCriados} já criada(s) antes` : ''}`);
for (const i of plano.itens) console.log(`  ${i.loja.padEnd(20)} ${i.despesa.padEnd(11)} ${String(i.fornecedor).slice(0, 30).padEnd(30)} emp ${String(i.empresa).padEnd(3)} R$ ${brl(i.valor).padStart(10)} venc ${i.vencimento}${i.temVencimento ? '' : ' (dia 30)'} · ${i.de}`);
if (plano.fora.length) {
  console.log(`\nficam de fora (${plano.fora.length}):`);
  for (const f of plano.fora) console.log(`  ${f.loja.padEnd(20)} ${f.despesa.padEnd(11)} ${String(f.fornecedor).slice(0, 30).padEnd(30)} — ${f.motivo}`);
}
if (args.find((a) => a.startsWith('--json='))) fs.writeFileSync(args.find((a) => a.startsWith('--json=')).split('=')[1], JSON.stringify(plano));
if (!aplicar) { console.log('\n(simulação: nada foi gravado)'); process.exit(0); }
const r = await aplicarCopia(plano, { por: 'Contas fixas — previsão (pedido do Yago em 26/11/2026)' });
console.log(`\nCRIADAS ${r.criados.length} duplicata(s) de previsão em ${r.destino} · total R$ ${brl(r.total)}`);
for (const f of r.falhas) console.log(`  FALHOU ${f.loja} · ${f.despesa} · ${f.fornecedor}: ${f.erro}`);
process.exit(r.falhas.length ? 2 : 0);
