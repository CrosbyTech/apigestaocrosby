// Transferências com nota pelo HeadCoach (saindo da 99) que ficaram esperando a
// transação da empresa 990 no TOTVS. Desde 11/11/2026 a transferência fica
// registrada SÓ no HeadCoach: com a NF-e autorizada ela está CONCLUÍDA.
// Este script acerta as que já existiam (registro da aba Transações + solicitação).
//
//   node scripts/concluir-transferencias-nota.mjs            → só lista
//   node scripts/concluir-transferencias-nota.mjs aplicar    → grava
//
// Não apaga nada e não mexe no TOTVS.
import 'dotenv/config';
import supabase from '../config/supabase.js';

const aplicar = process.argv[2] === 'aplicar';
const agora = new Date().toISOString();
const { data: regs, error } = await supabase
  .from('transferencias_transacoes')
  .select('id, transferencia_id, venda_id, nf_numero, nf_status, transacao_code, transacao_status, cliente_nome, total, qtd_pecas')
  .not('venda_id', 'is', null)
  .order('id');
if (error) throw error;
const autorizadas = (regs || []).filter((r) => r.nf_status === 'autorizada');
const pendentes = autorizadas.filter((r) => r.transacao_status !== 4);
console.log(`registros com nota pelo HeadCoach: ${(regs || []).length} · nota autorizada: ${autorizadas.length} · ainda sem "concluída": ${pendentes.length}`);
for (const r of pendentes) {
  console.log(
    `  registro ${r.id} · NF ${r.nf_numero} · ${r.cliente_nome} · ${r.qtd_pecas} pç · R$ ${Number(r.total).toFixed(2)} · transação 990 antiga: ${r.transacao_code || '—'} · solicitação: ${r.transferencia_id ? `TRF-${r.transferencia_id}` : 'avulsa'}`,
  );
}

const idsSol = autorizadas.map((r) => r.transferencia_id).filter(Boolean);
const { data: sols } = idsSol.length ? await supabase.from('transferencias_mercadoria').select('id, status, nf_numero, origem_ref').in('id', idsSol) : { data: [] };
const solPend = (sols || []).filter((s) => s.status === 'em_transferencia');
console.log(`solicitações ligadas: ${(sols || []).length} · ainda "em transferência": ${solPend.length}`);
for (const s of solPend) console.log(`  TRF-${s.id} ${s.origem_ref || ''} · NF ${s.nf_numero || '—'}`);

if (!aplicar) {
  console.log('\n(só listagem — nada foi gravado; rode com "aplicar" para gravar)');
  process.exit(0);
}
for (const r of pendentes) {
  const { error: e } = await supabase
    .from('transferencias_transacoes')
    .update({ transacao_status: 4, totvs_erro: null, atendida_em: agora, atualizado_em: agora })
    .eq('id', r.id)
    .eq('nf_status', 'autorizada');
  console.log(`  registro ${r.id}: ${e ? `ERRO ${e.message}` : 'concluído'}`);
}
for (const s of solPend) {
  const reg = autorizadas.find((r) => r.transferencia_id === s.id);
  const { error: e } = await supabase
    .from('transferencias_mercadoria')
    .update({ status: 'concluida', transacao_status: 4, transacao_atendida_em: agora, nf_numero: s.nf_numero || reg?.nf_numero || null, atualizado_em: agora })
    .eq('id', s.id)
    .eq('status', 'em_transferencia');
  console.log(`  TRF-${s.id}: ${e ? `ERRO ${e.message}` : 'concluída'}`);
}
console.log('feito');
