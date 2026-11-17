// Entradas no estoque das lojas (Dryland, porta estq_gw ação "mov") das transferências
// da 99 feitas SÓ no HeadCoach (nota pelo HeadCoach, sem transação no TOTVS — desde
// 11/11/2026). O Dryland já aplica sozinho tudo o que passa pelo TOTVS (vendas, trocas,
// devoluções, transferências): estas são as que ele não enxerga.
// Pedido do Yago em 16/11/2026. Só entra transferência com nota autorizada DEPOIS do
// balanço da loja de destino; sacolas ficam de fora (não são estoque, manual do Estoquista).
// "ref" = HC-TRF-<id>-NF<nota>: repetir não duplica (regra do mov).
//   node scripts/estoque-lojas-entradas-transferencia.mjs              → só mostra
//   node scripts/estoque-lojas-entradas-transferencia.mjs aplicar 1     → lança só a transferência 1
//   node scripts/estoque-lojas-entradas-transferencia.mjs aplicar todas → lança todas
import 'dotenv/config';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { DRYLAND_URL, DRYLAND_KEY } from '../routes/drylandChamados.routes.js';

const token = String(process.env.DRYLAND_ESTQ_TOKEN || '').trim();
const chave = String(process.env.DRYLAND_ESTQ_KEY || '').trim() || DRYLAND_KEY;
async function gw(acao, args = {}) {
  const { data } = await axios.post(
    `${DRYLAND_URL}/rest/v1/rpc/estq_gw`,
    { p_token: token, p_acao: acao, p_args: args },
    { headers: { 'Content-Type': 'application/json', apikey: chave, Authorization: `Bearer ${chave}` }, timeout: 120000 },
  );
  return data;
}
const SACOLAS = new Set([4538, 29387, 29397, 32691, 44725, 44879, 44901, 49084, 49762, 64568, 64569, 64570, 64571, 66353, 1003187, 5000015, 5000033]);
const ORIGEM = 99;

const [, , modo, qual] = process.argv;
const aplicar = modo === 'aplicar';

// balanço de cada loja (a base que mais aparece no saldo do Dryland)
const lojas = (await gw('lojas')).dados.filter((l) => l.propria).map((l) => Number(l.loja_cd));
const balanco = {};
for (const loja of lojas) {
  const c = new Map();
  for (let off = 0; ; off += 500) {
    const arr = (await gw('saldo_loja', { loja_cd: loja, limite: 500, offset: off })).dados || [];
    for (const x of arr) if (String(x.base).startsWith('balanco')) c.set(x.base_em, (c.get(x.base_em) || 0) + 1);
    if (arr.length < 500) break;
  }
  balanco[loja] = [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

const { data: trx } = await supabase.from('transferencias_transacoes').select('id, empresa, empresa_destino, venda_id, nf_numero, nf_status, itens').eq('empresa', ORIGEM).not('venda_id', 'is', null).order('id');
const { data: notas } = await supabase.from('pdv_notas_fiscais').select('venda_id, numero, dh_autorizacao, status').in('venda_id', (trx || []).map((t) => t.venda_id)).eq('status', 'autorizada');
const notaPor = new Map((notas || []).map((n) => [n.venda_id, n]));

const lotes = [];
for (const t of trx || []) {
  const n = notaPor.get(t.venda_id);
  const destino = Number(t.empresa_destino);
  const b = balanco[destino];
  let motivo = null;
  if (!n || t.nf_status === 'cancelada') motivo = 'nota não autorizada/cancelada';
  else if (!lojas.includes(destino)) motivo = `destino ${destino} não é loja do estoque`;
  else if (!b) motivo = 'loja sem balanço';
  else if (new Date(n.dh_autorizacao) <= new Date(b)) motivo = 'nota antes do balanço (já contada)';
  const ref = `HC-TRF-${t.id}-NF${t.nf_numero}`;
  const itens = (t.itens || [])
    .filter((i) => !SACOLAS.has(Number(i.productCode)) && Number(i.quantidade) > 0)
    .map((i) => ({
      tipo: 'transferencia_entrada',
      loja_cd: destino,
      cod: String(i.productCode),
      qtd: Number(i.quantidade),
      ref,
      ocorrido_em: n?.dh_autorizacao || null,
      loja_outra: ORIGEM,
      ...(Array.isArray(i.epcs) && i.epcs.length ? { epcs: i.epcs } : {}),
    }));
  if (!itens.length && !motivo) motivo = 'só sacolas';
  lotes.push({ id: t.id, destino, nf: t.nf_numero, ref, pecas: itens.reduce((s, i) => s + i.qtd, 0), itens, motivo });
}

let total = 0;
for (const l of lotes) {
  console.log(`${l.motivo ? '  pula' : '→ entra'} trf ${l.id} · 99 → ${l.destino} · NF ${l.nf} · ${l.pecas} pç em ${l.itens.length} produto(s)${l.motivo ? ` · ${l.motivo}` : ''}`);
  if (!l.motivo) total += l.pecas;
}
console.log(`\nA lançar: ${total} peça(s) em ${lotes.filter((l) => !l.motivo).length} transferência(s).`);
if (!aplicar) {
  console.log('(só mostrando — "aplicar 1" lança a transferência 1; "aplicar todas" lança todas)');
  process.exit(0);
}
const alvo = lotes.filter((l) => !l.motivo && (qual === 'todas' || String(l.id) === String(qual)));
if (!alvo.length) {
  console.log('Nada a lançar com esse filtro.');
  process.exit(0);
}
for (const l of alvo) {
  const r = await gw('mov', { itens: l.itens });
  console.log(`\ntrf ${l.id} (${l.ref}): ${JSON.stringify(r).slice(0, 700)}`);
}
process.exit(0);
