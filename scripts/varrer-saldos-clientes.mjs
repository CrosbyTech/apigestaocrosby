// Carga COMPLETA dos saldos de CREDEV e adiantamento: confere no TOTVS (só
// leitura) TODOS os clientes do cadastro na empresa e traz para o HeadCoach
// quem tem saldo e ainda não foi carregado. Pode rodar de novo (não duplica).
// Uso, na raiz da API:  node scripts/varrer-saldos-clientes.mjs [empresa]   (padrão 99)
import fs from 'node:fs';
import { varrerTodosDoTotvs } from '../services/hcSaldosClientes.js';

const empresa = Number(process.argv[2]) || 99;
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r = await varrerTodosDoTotvs({ empresa });
console.log(`\nVARREDURA da empresa ${empresa}: ${r.conferidas}/${r.pessoas} pessoa(s) conferida(s) · ${r.comSaldo} com saldo no TOTVS`);
console.log(`  carregados agora: ${r.carregados} saldo(s) — CREDEV ${brl(r.credev)} · adiantamento ${brl(r.adiantamento)}`);
console.log(`  já estavam carregados: ${r.jaCarregados} · para revisar: ${r.revisar.length} · erros: ${r.erros.length}`);
for (const x of r.revisar) console.log(`  REVISAR cliente ${x.cliente} ${x.nome || ''} ${x.tipo}: TOTVS ${brl(x.saldoTotvs)} (já tem movimento no HeadCoach sem carga)`);
for (const e of r.erros.slice(0, 30)) console.log(`  ERRO ${JSON.stringify(e)}`);
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync(`tmp/varredura-saldos-${empresa}.json`, JSON.stringify(r, null, 2));
console.log(`relatório: tmp/varredura-saldos-${empresa}.json`);
process.exit(r.erros.length ? 1 : 0);
