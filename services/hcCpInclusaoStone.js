// =============================================================================
// LIBERAÇÃO DE PAGAMENTO (HeadCoach) → INCLUSÃO AUTOMÁTICA NA STONE.
// Pedido do Yago (24/11/2026): ao APROVAR, a duplicata com banco "STONE 0000" vai
// para a fila do agente local (a mesma do botão APROVAR da Liberação antiga,
// stone_inclusoes); o bot inclui o Pix e o Fábio aprova no app da Stone. Quando o
// bot inclui, a liberação anda sozinha de APROVADO para INCLUÍDO.
//
//   • Forma: PIX sempre que a duplicata tem chave Pix válida ou Pix copia e cola
//     (QR Code) — mesmo que também tenha boleto (preferência pedida pelo Yago).
//   • BOLETO: o bot NÃO inclui. No portal da Stone o boleto é criado numa chamada
//     só, que já exige a senha da conta; não existe o passo "criar sem senha e
//     confirmar depois" que o Pix tem. A liberação fica marcada "incluir à mão".
//   • Uma liberação só entra uma vez na fila (índice único em hc_liberacao_id);
//     só repete o que não chegou à Stone (erro, bloqueado, cancelada).
//   • Voltar de INCLUÍDO para APROVADO não reenvia nada.
//
// Situação da inclusão: hc_cp_liberacoes.inclusao (jsonb) — a tela lê de lá.
// Env: STONE_INCLUSAO_ENABLED (o mesmo interruptor da Liberação antiga).
// =============================================================================
import crypto from 'node:crypto';
import supabase from '../config/supabase.js';
import { emCentavos, finalContaStone, dadoPix, planoDeInclusao } from '../utils/stoneInclusao.js';

const T = { inc: 'stone_inclusoes', lib: 'hc_cp_liberacoes', saldos: 'stone_bot_saldos' };
const REPETIVEIS = ['erro', 'bloqueado', 'cancelada']; // nada foi confirmado na Stone
const agora = () => new Date().toISOString();
export const inclusaoAtiva = () => String(process.env.STONE_INCLUSAO_ENABLED ?? 'true').toLowerCase() !== 'false';

function lancar(error) {
  if (error) throw new Error(error.message || String(error));
}

/** Guarda na liberação como está a inclusão; quando o bot incluiu, a liberação vai para INCLUÍDO. */
export async function marcarLiberacaoHc(hcLiberacaoId, info, { incluida = false } = {}) {
  const patch = { inclusao: { ...info, em: agora() }, atualizado_em: agora() };
  if (!incluida) {
    const { error } = await supabase.from(T.lib).update(patch).eq('id', hcLiberacaoId);
    lancar(error);
    return;
  }
  // só anda se ainda estiver em APROVADO (alguém pode ter mexido enquanto o bot incluía)
  const { data, error } = await supabase.from(T.lib).update({ ...patch, status: 'incluido', incluido_por: 'Bot Stone', incluido_em: agora(), atualizado_por: 'Bot Stone', forma_pagamento: 'pix' }).eq('id', hcLiberacaoId).eq('status', 'aprovado').select('id').maybeSingle();
  lancar(error);
  if (!data) {
    const { error: e2 } = await supabase.from(T.lib).update(patch).eq('id', hcLiberacaoId);
    lancar(e2);
  }
}

async function contasStone() {
  const { data: ult, error } = await supabase.from(T.saldos).select('data').eq('banco', 'STONE').order('data', { ascending: false }).limit(1);
  lancar(error);
  const dia = ult?.[0]?.data;
  if (!dia) return [];
  const { data, error: e2 } = await supabase.from(T.saldos).select('stone_account_id,titular_cnpj').eq('banco', 'STONE').eq('data', dia);
  lancar(e2);
  return data || [];
}

const descricaoDe = (t) => `Dup ${[t?.duplicata, t?.parcela].filter((x) => x != null).join('/')}`.slice(0, 60);

/**
 * Enfileira as liberações (já em APROVADO, com a duplicata junto em `titulo`).
 * @returns {{ lote, itens: [{ id, via: 'pix'|'manual', status?, motivo?, conta?, jaExistia? }] }}
 */
export async function enfileirarHc(liberacoes, { usuario } = {}) {
  const itens = [];
  const lista = (liberacoes || []).filter((l) => l?.id && l.titulo);
  if (!lista.length) return { lote: null, itens };
  if (!inclusaoAtiva()) return { lote: null, itens: lista.map((l) => ({ id: l.id, via: 'manual', motivo: 'inclusão automática desligada no servidor' })) };
  const { data: existentes, error } = await supabase.from(T.inc).select('id,hc_liberacao_id,status').in('hc_liberacao_id', lista.map((l) => l.id));
  lancar(error);
  const porLib = new Map((existentes || []).map((r) => [Number(r.hc_liberacao_id), r]));
  const contas = await contasStone();
  const lote = crypto.randomUUID();
  for (const l of lista) {
    const plano = planoDeInclusao(l);
    if (plano.via !== 'pix') {
      await marcarLiberacaoHc(l.id, { status: 'manual', motivo: plano.motivo, forma: plano.forma || null });
      itens.push({ id: l.id, via: 'manual', motivo: plano.motivo });
      continue;
    }
    const atual = porLib.get(Number(l.id));
    if (atual && !REPETIVEIS.includes(atual.status)) {
      itens.push({ id: l.id, via: 'pix', status: atual.status, jaExistia: true });
      continue;
    }
    const iguais = contas.filter((c) => String(c.titular_cnpj || '').endsWith(plano.contaFinal));
    const linha = {
      liberacao_id: null,
      hc_liberacao_id: l.id,
      lote,
      status: 'fila',
      forma: 'PIX',
      conta_final: plano.contaFinal,
      valor_centavos: plano.valorCentavos,
      fornecedor: l.titulo.fornecedor_nome || null,
      descricao: descricaoDe(l.titulo),
      teste: false,
      solicitado_por: usuario || null,
      conta_cnpj: iguais.length === 1 ? iguais[0].titular_cnpj : null,
      stone_account_id: iguais.length === 1 ? iguais[0].stone_account_id : null,
      chave_pix: plano.chave,
      chave_tipo: plano.tipo,
      stone_pagamento_id: null,
      recebedor_nome: null,
      recebedor_doc: null,
      erro: null,
      agente: null,
      aviso_em: null,
      aviso_erro: null,
      iniciado_em: null,
      concluido_em: null,
      criado_em: agora(),
    };
    if (iguais.length !== 1) Object.assign(linha, { status: 'erro', erro: `Conta Stone ${plano.contaFinal}: achei ${iguais.length} conta(s) com esse final.`, concluido_em: agora() });
    const q = atual ? supabase.from(T.inc).update(linha).eq('id', atual.id).eq('status', atual.status) : supabase.from(T.inc).insert(linha);
    const { error: e3 } = await q;
    if (e3 && /duplicate key|unique/i.test(e3.message || '')) {
      itens.push({ id: l.id, via: 'pix', status: 'fila', jaExistia: true }); // outro clique chegou antes
      continue;
    }
    lancar(e3);
    await marcarLiberacaoHc(l.id, { status: linha.status, conta: linha.conta_final, erro: linha.erro, forma: 'pix' });
    itens.push({ id: l.id, via: 'pix', status: linha.status, erro: linha.erro, conta: linha.conta_final });
  }
  const naFila = itens.filter((i) => i.via === 'pix' && i.status === 'fila' && !i.jaExistia).length;
  if (naFila) console.log(`🏦 [liberação HC → Stone] ${naFila} Pix na fila do bot · ${usuario || '?'}`);
  return { lote, itens };
}

/** A liberação pode ter mudado enquanto esperava na fila: se mudou, o bot não inclui. */
export async function motivoParaCancelarHc(item) {
  const { data: l, error } = await supabase.from(T.lib).select('id,status,valor,banco,titulo:hc_cp_titulos!inner(situacao,chave_pix)').eq('id', item.hc_liberacao_id).maybeSingle();
  lancar(error);
  if (!l) return 'A liberação não existe mais.';
  if (l.status !== 'aprovado') return `A liberação saiu de Aprovados (${l.status}).`;
  if (l.titulo?.situacao !== 'aberto') return 'A duplicata não está mais em aberto.';
  if (finalContaStone(l.banco) !== item.conta_final) return 'O banco da liberação mudou.';
  if (emCentavos(l.valor) !== item.valor_centavos) return 'O valor da liberação mudou.';
  if (dadoPix(l.titulo?.chave_pix)?.chave !== item.chave_pix) return 'A chave Pix (ou o copia e cola) da duplicata mudou.';
  return null;
}

export default { enfileirarHc, motivoParaCancelarHc, marcarLiberacaoHc, inclusaoAtiva };
