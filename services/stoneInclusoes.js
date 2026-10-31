// ============================================================
// INCLUSÃO DE PAGAMENTOS NA STONE — fila do botão APROVAR da Liberação.
//
// A tela enfileira os títulos com banco "STONE 0000" e o agente local
// (bots/stone-extratos) inclui cada Pix pelo portal. A aprovação final é do
// Fábio no app da Stone; ao fechar o lote, o aviso vai para o grupo.
//
// Tabela: migrations/stone_inclusoes.sql. Env: STONE_INCLUSAO_ENABLED (default true).
// ============================================================
import crypto from 'node:crypto';
import supabase from '../config/supabase.js';
import { MigrationPendingError } from './fluxoCaixaExt.js';
import * as wa from './whatsappContasPagar.js';
import { grupoChatid, MENCIONAR } from './relatorioSaldosWhatsapp.js';
import { emCentavos, finalContaStone, normalizarChavePix, textoAvisoFabio, valorDoTitulo } from '../utils/stoneInclusao.js';

const T = { inc: 'stone_inclusoes', lib: 'pagamentos_liberacao', saldos: 'stone_bot_saldos' };
const CAMPOS_TITULO = 'id,status,banco_pagamento,forma_pagamento,chave_pix,vl_duplicata,vl_real,nm_fornecedor,nr_duplicata,nr_parcela,dados_completos';
const PROCESSANDO_MAX_MIN = 30;
const REPETIVEIS = ['erro', 'bloqueado', 'cancelada']; // nada foi confirmado na Stone
const RESULTADOS = ['incluido', 'erro', 'bloqueado', 'verificar'];

const agora = () => new Date().toISOString();
const ativo = () => String(process.env.STONE_INCLUSAO_ENABLED ?? 'true').toLowerCase() !== 'false';

function lancar(error) {
  if (!error) return;
  if (/relation .*stone_inclusoes.* does not exist|Could not find the table 'public\.stone_inclusoes|schema cache/i.test(error.message || ''))
    throw new MigrationPendingError('Tabela stone_inclusoes não existe — rode migrations/stone_inclusoes.sql.');
  throw new Error(error.message || String(error));
}

/** Situação da inclusão fica no título: é de lá que a tela lê. */
async function marcarTitulo(liberacaoId, info) {
  const { data, error } = await supabase.from(T.lib).select('dados_completos').eq('id', liberacaoId).maybeSingle();
  lancar(error);
  if (!data) return;
  const dados = { ...(data.dados_completos || {}), stone_inclusao: { ...info, em: agora() } };
  const { error: e2 } = await supabase.from(T.lib).update({ dados_completos: dados }).eq('id', liberacaoId);
  lancar(e2);
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

function descricaoDe(titulo) {
  const dup = [titulo.nr_duplicata, titulo.nr_parcela].filter(Boolean).join('/');
  return `${dup ? `Dup ${dup}` : 'Pagamento'}`.slice(0, 60);
}

function montarLinha(titulo, { lote, contas, usuario }) {
  const conta_final = finalContaStone(titulo.banco_pagamento);
  const valor_centavos = emCentavos(valorDoTitulo(titulo));
  const linha = {
    liberacao_id: titulo.id,
    lote,
    status: 'fila',
    forma: titulo.forma_pagamento,
    conta_final,
    valor_centavos,
    fornecedor: titulo.nm_fornecedor || null,
    descricao: descricaoDe(titulo),
    teste: !!titulo.dados_completos?.teste_inclusao_stone,
    solicitado_por: usuario || null,
    conta_cnpj: null,
    stone_account_id: null,
    chave_pix: null,
    chave_tipo: null,
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
  const iguais = contas.filter((c) => String(c.titular_cnpj || '').endsWith(conta_final));
  if (iguais.length !== 1) return { ...linha, status: 'erro', erro: `Conta Stone ${conta_final}: achei ${iguais.length} conta(s) com esse final.`, concluido_em: agora() };
  const chave = normalizarChavePix(titulo.chave_pix);
  if (!chave) return { ...linha, status: 'erro', erro: 'Chave Pix vazia ou inválida.', concluido_em: agora() };
  return { ...linha, conta_cnpj: iguais[0].titular_cnpj, stone_account_id: iguais[0].stone_account_id, chave_pix: chave.chave, chave_tipo: chave.tipo };
}

/**
 * Enfileira os títulos APROVADOS com banco "STONE 0000". Por enquanto só Pix:
 * as outras formas voltam em `semPix` para serem incluídas à mão.
 */
export async function enfileirar({ ids, usuario } = {}) {
  if (!ativo()) throw new Error('Inclusão na Stone desligada (STONE_INCLUSAO_ENABLED).');
  const lista = [...new Set((ids || []).filter(Boolean))];
  if (!lista.length) return { lote: null, itens: [], semPix: [] };
  const { data: titulos, error } = await supabase.from(T.lib).select(CAMPOS_TITULO).in('id', lista);
  lancar(error);
  const daStone = (titulos || []).filter((t) => t.status === 'APROVADO' && finalContaStone(t.banco_pagamento));
  const semPix = daStone.filter((t) => t.forma_pagamento !== 'PIX').map((t) => ({ id: t.id, fornecedor: t.nm_fornecedor, forma: t.forma_pagamento || null }));
  const alvo = daStone.filter((t) => t.forma_pagamento === 'PIX');
  if (!alvo.length) return { lote: null, itens: [], semPix };

  const { data: existentes, error: e2 } = await supabase.from(T.inc).select('id,liberacao_id,status').in('liberacao_id', alvo.map((t) => t.id));
  lancar(e2);
  const porTitulo = new Map((existentes || []).map((r) => [r.liberacao_id, r]));
  const contas = await contasStone();
  const lote = crypto.randomUUID();
  const itens = [];
  for (const titulo of alvo) {
    const atual = porTitulo.get(titulo.id);
    if (atual && !REPETIVEIS.includes(atual.status)) {
      itens.push({ id: titulo.id, status: atual.status, jaExistia: true });
      continue;
    }
    const linha = montarLinha(titulo, { lote, contas, usuario });
    const q = atual
      ? supabase.from(T.inc).update(linha).eq('id', atual.id).eq('status', atual.status)
      : supabase.from(T.inc).insert(linha);
    const { error: e3 } = await q;
    if (e3 && /duplicate key|unique/i.test(e3.message || '')) {
      itens.push({ id: titulo.id, status: 'fila', jaExistia: true }); // outro clique chegou antes
      continue;
    }
    lancar(e3);
    await marcarTitulo(titulo.id, { status: linha.status, conta: linha.conta_final, erro: linha.erro });
    itens.push({ id: titulo.id, status: linha.status, erro: linha.erro, conta: linha.conta_final });
  }
  return { lote, itens, semPix };
}

/** Inclusão parada no meio não volta para a fila: pode já ter chegado à Stone. */
async function marcarTravadas() {
  const limite = new Date(Date.now() - PROCESSANDO_MAX_MIN * 60000).toISOString();
  const { data, error } = await supabase
    .from(T.inc)
    .update({ status: 'verificar', erro: 'Agente parou no meio: confira na Stone antes de repetir.', concluido_em: agora() })
    .eq('status', 'processando')
    .lt('iniciado_em', limite)
    .select('liberacao_id,conta_final,erro,lote');
  lancar(error);
  for (const r of data || []) {
    await marcarTitulo(r.liberacao_id, { status: 'verificar', conta: r.conta_final, erro: r.erro });
    await avisarSeFechou(r.lote);
  }
}

/** O título pode ter mudado enquanto esperava na fila. */
async function motivoParaCancelar(item) {
  const { data: t, error } = await supabase.from(T.lib).select(CAMPOS_TITULO).eq('id', item.liberacao_id).maybeSingle();
  lancar(error);
  if (!t) return 'Título não existe mais.';
  if (t.status !== 'APROVADO') return `Título saiu de APROVADO (${t.status}).`;
  if (finalContaStone(t.banco_pagamento) !== item.conta_final) return 'Banco do título mudou.';
  if (emCentavos(valorDoTitulo(t)) !== item.valor_centavos) return 'Valor do título mudou.';
  if (normalizarChavePix(t.chave_pix)?.chave !== item.chave_pix) return 'Chave Pix do título mudou.';
  return null;
}

export async function proximaInclusao({ host } = {}) {
  if (!ativo()) return null;
  await marcarTravadas();
  for (;;) {
    const { data: pend, error } = await supabase.from(T.inc).select('*').eq('status', 'fila').order('criado_em', { ascending: true }).limit(1);
    lancar(error);
    const item = pend?.[0];
    if (!item) return null;
    const motivo = await motivoParaCancelar(item);
    if (motivo) {
      const { error: e2 } = await supabase.from(T.inc).update({ status: 'cancelada', erro: motivo, concluido_em: agora() }).eq('id', item.id).eq('status', 'fila');
      lancar(e2);
      await marcarTitulo(item.liberacao_id, { status: 'cancelada', conta: item.conta_final, erro: motivo });
      await avisarSeFechou(item.lote);
      continue;
    }
    const { data, error: e3 } = await supabase
      .from(T.inc)
      .update({ status: 'processando', iniciado_em: agora(), agente: host || null })
      .eq('id', item.id)
      .eq('status', 'fila') // claim atômico: só um agente leva
      .select()
      .maybeSingle();
    lancar(e3);
    if (data) return data;
  }
}

export async function registrarResultado(id, { status, stonePagamentoId, recebedorNome, recebedorDoc, erro } = {}) {
  if (!RESULTADOS.includes(status)) throw new Error(`Resultado inválido: ${status}`);
  const { data, error } = await supabase
    .from(T.inc)
    .update({
      status,
      stone_pagamento_id: stonePagamentoId || null,
      recebedor_nome: recebedorNome || null,
      recebedor_doc: recebedorDoc || null,
      erro: erro ? String(erro).slice(0, 500) : null,
      concluido_em: agora(),
    })
    .eq('id', id)
    .eq('status', 'processando')
    .select()
    .maybeSingle();
  lancar(error);
  if (!data) throw new Error(`Inclusão ${id} não está em processamento.`);
  await marcarTitulo(data.liberacao_id, { status, conta: data.conta_final, erro: data.erro, recebedor: data.recebedor_nome });
  const aviso = await avisarSeFechou(data.lote);
  return { ok: true, aviso };
}

/** Lote sem nada em andamento → um único aviso, só com o que entrou na Stone. */
async function avisarSeFechou(lote) {
  const { count, error } = await supabase.from(T.inc).select('id', { count: 'exact', head: true }).eq('lote', lote).in('status', ['fila', 'processando']);
  lancar(error);
  if (count) return null;
  const { data: linhas, error: e2 } = await supabase.from(T.inc).update({ aviso_em: agora() }).eq('lote', lote).is('aviso_em', null).select('*');
  lancar(e2);
  const itens = (linhas || []).filter((l) => l.status === 'incluido');
  if (!itens.length) return null;
  try {
    const grupo = await grupoChatid();
    await wa.enviarTexto({ number: grupo, text: textoAvisoFabio(itens, { mencionar: MENCIONAR }), mentions: MENCIONAR, trackId: 'veveto' });
    return { enviado: true, contas: [...new Set(itens.map((i) => i.conta_final))] };
  } catch (e) {
    console.error('[stone-inclusoes] aviso no grupo:', e.message);
    const { error: e3 } = await supabase.from(T.inc).update({ aviso_erro: String(e.message).slice(0, 300) }).eq('lote', lote);
    lancar(e3);
    return { enviado: false, erro: e.message };
  }
}

export default { enfileirar, proximaInclusao, registrarResultado };
