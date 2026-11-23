// Chamados "Crédito Loja Virtual" do Dryland (peça não encontrada na separação) → crédito do cliente
// na Loja Virtual (adiantamento na empresa 99) + resposta e conclusão do chamado.
// É o mesmo serviço do job de 1 em 1 hora (jobs/credito-loja-virtual-chamados.job.js).
//   node scripts/creditos-loja-virtual-chamados.mjs           → só mostra o que faria (nada é gravado)
//   node scripts/creditos-loja-virtual-chamados.mjs aplicar   → gera os créditos e conclui os chamados
import 'dotenv/config';
import { processarChamadosCreditoLv } from '../services/creditoLojaVirtualChamados.js';

const aplicar = process.argv.includes('aplicar');
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r = await processarChamadosCreditoLv({ simular: !aplicar, por: aplicar ? 'HeadCoach (automático)' : undefined, log: (m) => console.log('  ✓', m) });
const linha = (i) => `#${i.numero} · ${i.pedido} · peça ${i.sku} · cliente ${i.cliente} ${i.clienteNome} · ${brl(i.valor)}`;
console.log(`\n${aplicar ? 'GERADOS' : 'A GERAR'}: ${r.gerados.length} chamado(s) · ${brl(r.gerados.reduce((s, i) => s + i.valor, 0))}`);
for (const i of r.gerados) console.log('  ', linha(i));
console.log(`\nJÁ TINHAM CRÉDITO (só ${aplicar ? 'concluídos' : 'a concluir'}): ${r.jaTinham.length}`);
for (const i of r.jaTinham) console.log('  ', linha(i));
console.log(`\nNÃO MEXIDOS (ficam abertos para o Financeiro): ${r.pulados.length}`);
for (const i of r.pulados) console.log(`   #${i.numero} · ${i.assunto} → ${i.motivo}`);
console.log(`\nERROS: ${r.erros.length}`);
for (const i of r.erros) console.log(`   #${i.numero} · ${i.assunto} → ${i.erro}`);
if (!aplicar) console.log('\n(só mostrando — rode com "aplicar" para gravar)');
process.exit(0);
