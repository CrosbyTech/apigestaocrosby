// CASHBACK dos clientes no HeadCoach (services/hcCashback.js): copia para a tabela de
// saldos (hc_cliente_saldos, tipo "cashback") o saldo bônus que o TOTVS tem para quem
// comprou nas lojas ativas nos últimos 90 dias. Só LÊ o TOTVS.
//   node scripts/sincronizar-cashback.mjs             → só simula (não grava nada)
//   node scripts/sincronizar-cashback.mjs --aplicar   → grava no HeadCoach
// Antes da 1ª vez com --aplicar: node scripts/migrar-hc-saldos-clientes.mjs
// (libera o tipo "cashback" na tabela). Depois disso o job diário cuida sozinho.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sincronizarCashback, LOJAS_CASHBACK, CASHBACK_DIAS } from '../services/hcCashback.js';

const aplicar = process.argv.includes('--aplicar');
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
console.log(`CASHBACK · lojas ${LOJAS_CASHBACK.join(', ')} · quem comprou nos últimos ${CASHBACK_DIAS} dias · ${aplicar ? 'GRAVANDO no HeadCoach' : 'SIMULAÇÃO (nada é gravado)'}`);
try {
  const r = await sincronizarCashback({ aplicar, log: (m) => console.log(m) });
  console.log(`\n${r.consultados} CPF(s) conferidos em ${r.segundos} s · ${r.comSaldo} cliente(s) com cashback · total no TOTVS ${brl(r.totalTotvs)}`);
  console.log('por loja:', Object.entries(r.porLoja).sort((a, b) => Number(a[0]) - Number(b[0])).map(([l, v]) => `${l}: ${brl(v)}`).join(' · '));
  console.log(`${aplicar ? 'gravados' : 'a gravar'}: ${r.movimentos} acerto(s) · entra ${brl(r.entrou)} · sai ${brl(r.saiu)} · já iguais: ${r.semMudanca} · erros: ${r.erros.length}`);
  for (const e of r.erros.slice(0, 20)) console.log(`  cliente ${e.cliente}${e.loja ? ` loja ${e.loja}` : ''}: ${e.erro}`);
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const saida = path.join(aqui, '..', 'tmp', `cashback-${aplicar ? 'aplicado' : 'simulacao'}.json`);
  fs.writeFileSync(saida, JSON.stringify(r, null, 1));
  console.log(`resumo em ${saida}`);
} catch (e) {
  console.error(`PAROU: ${e.message}`);
  process.exit(1);
}
process.exit(0);
