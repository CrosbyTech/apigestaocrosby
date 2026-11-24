// ============================================================
// TRANSFERÊNCIA ENTRE CONTAS DA STONE — fila do botão TRANSFERIR.
//
// Pedido do Yago (24/11/2026): escolher a conta de origem e a de destino na tela,
// clicar em TRANSFERIR e o agente local (bots/stone-extratos) inclui o Pix da
// origem para a CHAVE ALEATÓRIA da conta de destino; o Fábio aprova no app da
// Stone e o HeadCoach confere no extrato se saiu. Vale mandar o saldo de várias
// contas para uma só (uma transferência por conta de origem).
//
// Travas:
//   • destino = só conta do grupo cadastrada em stone_contas, com a chave guardada
//     (ninguém digita chave na hora de transferir);
//   • quem pede confirma com a própria senha do HeadCoach (owner, admin, financeiro);
//   • uma só em andamento por par origem → destino (índice único);
//   • o agente só confirma o Pix se a Stone devolver, como recebedor, o CNPJ da
//     conta de destino (bots/stone-extratos/transferencias.mjs);
//   • transferência parada no meio vira "verificar" e nunca é repetida sozinha.
// O dinheiro só sai quando o Fábio aprova na Stone.
//
// Tabelas: migrations/stone_transferencias.sql. Env: STONE_TRANSFERENCIA_ENABLED (default true).
// ============================================================
import crypto from 'node:crypto';
import supabase from '../config/supabase.js';
import * as wa from './whatsappContasPagar.js';
import { grupoChatid, MENCIONAR } from './relatorioSaldosWhatsapp.js';
import { CpError, PERFIS_FINANCEIRO, conferirSenha } from './hcContasPagar.js';
import { nomeScore } from './conciliacaoAprovados.js';
import { chaveAleatoria, chaveMascarada, finalDoCnpj, emCentavos, motivoDeNaoTransferir, descricaoDaTransferencia, textoAvisoTransferencias, SITUACOES } from '../utils/stoneTransferencia.js';

const T = { contas: 'stone_contas', transf: 'stone_transferencias', saldos: 'stone_bot_saldos' };
const PROCESSANDO_MAX_MIN = 30;
const RESULTADOS = ['incluido', 'erro', 'bloqueado', 'verificar'];
const agora = () => new Date().toISOString();
const ativo = () => String(process.env.STONE_TRANSFERENCIA_ENABLED ?? 'true').toLowerCase() !== 'false';
const quem = (user) => user?.name || user?.email || null;
const diaRecife = (iso) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date(iso));

function lancar(error) {
  if (!error) return;
  const msg = error.message || String(error);
  if (/stone_(contas|transferencias).* does not exist|Could not find the table 'public\.stone_(contas|transferencias)|schema cache/i.test(msg)) throw new CpError('A transferência entre contas ainda não está liberada: falta criar as tabelas (migrations/stone_transferencias.sql).', 'MIGRATION_PENDING', 503);
  if (/stone_transferencias_par_uniq/i.test(msg)) throw new CpError('Já existe uma transferência em andamento entre essas duas contas', 'JA_NA_FILA', 409);
  throw new CpError(msg, 'DB_ERROR', 500);
}
function exigirFinanceiro(user) {
  if (!PERFIS_FINANCEIRO.includes(user?.role)) throw new CpError('A transferência entre contas é só para owner, admin e financeiro', 'SEM_PERMISSAO', 403);
}

// ─── contas ───────────────────────────────────────────────────
/** Saldos da última consulta do bot, por conta Stone. */
async function saldosAtuais() {
  const { data: ult, error } = await supabase.from(T.saldos).select('data').eq('banco', 'STONE').order('data', { ascending: false }).limit(1);
  lancar(error);
  const dia = ult?.[0]?.data;
  if (!dia) return [];
  const { data, error: e2 } = await supabase.from(T.saldos).select('stone_account_id, agencia, conta, titular_nome, titular_cnpj, saldo, saldo_antecipavel, capturado_em').eq('banco', 'STONE').eq('data', dia);
  lancar(e2);
  return (data || []).filter((l) => l.stone_account_id);
}

/** Cada conta que o bot enxerga vira (ou atualiza) uma linha em stone_contas; a chave guardada não é tocada. */
async function sincronizarContas(saldos) {
  if (!saldos.length) return;
  const linhas = saldos.map((s) => ({ stone_account_id: s.stone_account_id, agencia: s.agencia || null, conta: s.conta || null, titular_nome: s.titular_nome || null, titular_cnpj: String(s.titular_cnpj || '').replace(/\D/g, '') || null, conta_final: finalDoCnpj(s.titular_cnpj) || String(s.conta || '').slice(-4), atualizado_em: agora() }));
  const { error } = await supabase.from(T.contas).upsert(linhas, { onConflict: 'stone_account_id' });
  lancar(error);
}

/** As contas Stone do grupo com o saldo da última consulta e se já têm a chave guardada. */
export async function contasComSaldo() {
  const saldos = await saldosAtuais();
  await sincronizarContas(saldos);
  const { data, error } = await supabase.from(T.contas).select('*').eq('ativa', true).order('conta_final');
  lancar(error);
  const porConta = new Map(saldos.map((s) => [s.stone_account_id, s]));
  return (data || []).map((c) => {
    const s = porConta.get(c.stone_account_id);
    return { ...c, saldoCentavos: s ? emCentavos(s.saldo) : null, saldo: s ? Number(s.saldo) : null, antecipavel: s ? Number(s.saldo_antecipavel || 0) : null, saldoEm: s?.capturado_em || null };
  });
}
const paraTela = (c) => ({ id: c.stone_account_id, final: c.conta_final, titular: c.titular_nome, cnpj: c.titular_cnpj, agencia: c.agencia, conta: c.conta, saldo: c.saldo, antecipavel: c.antecipavel, saldoEm: c.saldoEm, temChave: !!chaveAleatoria(c.chave_pix_aleatoria), chave: chaveMascarada(c.chave_pix_aleatoria), chaveOrigem: c.chave_origem, chaveEm: c.chave_atualizada_em });

/** Guarda a chave Pix aleatória de uma conta (colada na tela ou lida pelo bot no portal). */
export async function salvarChave(user, accountId, valor, { origem = 'manual' } = {}) {
  if (origem === 'manual') exigirFinanceiro(user);
  const chave = chaveAleatoria(valor);
  if (!chave) throw new CpError('Chave aleatória inválida: ela tem o formato 00000000-0000-0000-0000-000000000000');
  // a mesma chave não pode estar em duas contas
  const { data: outra, error } = await supabase.from(T.contas).select('stone_account_id, conta_final').eq('chave_pix_aleatoria', chave).neq('stone_account_id', accountId).maybeSingle();
  lancar(error);
  if (outra) throw new CpError(`Esta chave já está guardada na conta ${outra.conta_final}`);
  const { data, error: e2 } = await supabase.from(T.contas).update({ chave_pix_aleatoria: chave, chave_origem: origem, chave_atualizada_em: agora(), chave_atualizada_por: origem === 'manual' ? quem(user) : 'bot-stone', atualizado_em: agora() }).eq('stone_account_id', accountId).select().maybeSingle();
  lancar(e2);
  if (!data) throw new CpError('Conta Stone não encontrada', 'NOT_FOUND', 404);
  return paraTela(data);
}

// ─── pedir ────────────────────────────────────────────────────
/**
 * TRANSFERIR. b: { origens: [stone_account_id], destino, tudo?: boolean, valor?: number (reais; só com uma origem), senha }
 * Com "tudo", cada origem manda o saldo que tiver quando o bot incluir; as sem saldo ficam de fora.
 */
export async function solicitar(user, b = {}) {
  if (!ativo()) throw new CpError('Transferência entre contas desligada (STONE_TRANSFERENCIA_ENABLED).', 'DESLIGADA', 503);
  exigirFinanceiro(user);
  const idsOrigem = [...new Set((Array.isArray(b.origens) ? b.origens : [b.origens]).filter(Boolean).map(String))];
  if (!idsOrigem.length) throw new CpError('Escolha a conta de origem');
  if (!b.destino) throw new CpError('Escolha a conta de destino');
  const tudo = b.tudo === true || b.tudo === 'true';
  const valorCentavos = tudo ? null : emCentavos(b.valor);
  if (!tudo && idsOrigem.length > 1) throw new CpError('Com valor digitado, escolha uma conta de origem só (ou use "todo o saldo")');
  const contas = await contasComSaldo();
  const porId = new Map(contas.map((c) => [c.stone_account_id, c]));
  const destino = porId.get(String(b.destino));
  const pedidos = [];
  const ignoradas = [];
  for (const id of idsOrigem) {
    if (id === String(b.destino)) continue; // "todas para uma": o destino sai da lista de origens sem reclamar
    const origem = porId.get(id);
    const motivo = motivoDeNaoTransferir({ origem, destino, tudo, valorCentavos });
    if (motivo) ignoradas.push({ id, final: origem?.conta_final || '?', motivo });
    else pedidos.push(origem);
  }
  if (!pedidos.length) throw new CpError(ignoradas.length ? `Nada para transferir: ${ignoradas[0].motivo}` : 'Nada para transferir');
  await conferirSenha(user?.email, b.senha);

  const lote = crypto.randomUUID();
  const criadas = [];
  for (const origem of pedidos) {
    const linha = {
      lote,
      status: 'fila',
      origem_account_id: origem.stone_account_id,
      origem_final: origem.conta_final,
      origem_cnpj: origem.titular_cnpj,
      origem_nome: origem.titular_nome,
      destino_account_id: destino.stone_account_id,
      destino_final: destino.conta_final,
      destino_cnpj: destino.titular_cnpj,
      destino_nome: destino.titular_nome,
      destino_chave: chaveAleatoria(destino.chave_pix_aleatoria),
      tudo,
      valor_centavos: valorCentavos,
      descricao: descricaoDaTransferencia(origem.conta_final, destino.conta_final),
      solicitado_por: quem(user),
    };
    const { data, error } = await supabase.from(T.transf).insert(linha).select('id, origem_final, destino_final, tudo, valor_centavos').maybeSingle();
    if (error && /stone_transferencias_par_uniq|duplicate key/i.test(error.message || '')) {
      ignoradas.push({ id: origem.stone_account_id, final: origem.conta_final, motivo: 'já tem uma transferência em andamento para esse destino' });
      continue;
    }
    lancar(error);
    criadas.push(data);
  }
  if (criadas.length) console.log(`🔁 [entre contas] ${criadas.length} transferência(s) na fila → conta ${destino.conta_final} · ${quem(user)}`);
  return { lote, criadas, ignoradas, destino: destino.conta_final };
}

/** Tira da fila (só o que o bot ainda não pegou). */
export async function cancelar(user, id) {
  exigirFinanceiro(user);
  const { data, error } = await supabase.from(T.transf).update({ status: 'cancelada', erro: `Cancelada por ${quem(user)}`, concluido_em: agora() }).eq('id', Number(id)).eq('status', 'fila').select('id, lote').maybeSingle();
  lancar(error);
  if (!data) throw new CpError('Só dá para cancelar a transferência que ainda está na fila', 'NAO_CANCELA', 409);
  return { id: data.id };
}

// ─── leitura (tela) ───────────────────────────────────────────
export async function painel(user, { dias = 15 } = {}) {
  exigirFinanceiro(user);
  await conferirNoExtrato().catch((e) => console.warn('[entre contas] conferência:', e.message));
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const [contas, { data: lista, error }] = await Promise.all([contasComSaldo(), supabase.from(T.transf).select('*').gte('criado_em', desde).order('id', { ascending: false }).limit(200)]);
  lancar(error);
  return {
    ativo: ativo(),
    contas: contas.map(paraTela),
    transferencias: (lista || []).map((t) => ({ id: t.id, lote: t.lote, status: t.status, situacao: SITUACOES[t.status] || t.status, origem: t.origem_final, origemNome: t.origem_nome, destino: t.destino_final, destinoNome: t.destino_nome, tudo: t.tudo, valor: (t.valor_incluido_centavos ?? t.valor_centavos) != null ? (t.valor_incluido_centavos ?? t.valor_centavos) / 100 : null, erro: t.erro, recebedor: t.recebedor_nome, solicitadoPor: t.solicitado_por, criadoEm: t.criado_em, concluidoEm: t.concluido_em, efetivadaEm: t.efetivada_em, entradaConfirmada: t.conferencia?.entrada != null })),
  };
}

// ─── agente ───────────────────────────────────────────────────
/** Parada no meio não volta para a fila: o Pix pode já ter chegado à Stone. */
async function marcarTravadas() {
  const limite = new Date(Date.now() - PROCESSANDO_MAX_MIN * 60000).toISOString();
  const { data, error } = await supabase.from(T.transf).update({ status: 'verificar', erro: 'O agente parou no meio: confira na Stone antes de repetir.', concluido_em: agora() }).eq('status', 'processando').lt('iniciado_em', limite).select('lote');
  lancar(error);
  for (const r of data || []) await avisarSeFechou(r.lote);
}

/** Próxima transferência da fila (claim atômico). Se a conta de destino mudou de chave ou foi desativada desde o pedido, cancela. */
export async function proximaTransferencia({ host } = {}) {
  if (!ativo()) return null;
  await marcarTravadas();
  for (;;) {
    const { data: pend, error } = await supabase.from(T.transf).select('*').eq('status', 'fila').order('criado_em', { ascending: true }).limit(1);
    lancar(error);
    const item = pend?.[0];
    if (!item) return null;
    const { data: destino, error: e1 } = await supabase.from(T.contas).select('chave_pix_aleatoria, ativa, titular_cnpj').eq('stone_account_id', item.destino_account_id).maybeSingle();
    lancar(e1);
    const motivo = !destino || destino.ativa === false ? 'A conta de destino não está mais cadastrada.' : chaveAleatoria(destino.chave_pix_aleatoria) !== item.destino_chave ? 'A chave da conta de destino mudou depois do pedido.' : String(destino.titular_cnpj || '') !== String(item.destino_cnpj || '') ? 'O CNPJ da conta de destino mudou depois do pedido.' : null;
    if (motivo) {
      const { error: e2 } = await supabase.from(T.transf).update({ status: 'cancelada', erro: motivo, concluido_em: agora() }).eq('id', item.id).eq('status', 'fila');
      lancar(e2);
      await avisarSeFechou(item.lote);
      continue;
    }
    const { data, error: e3 } = await supabase.from(T.transf).update({ status: 'processando', iniciado_em: agora(), agente: host || null }).eq('id', item.id).eq('status', 'fila').select().maybeSingle();
    lancar(e3);
    if (data) return data;
  }
}

export async function registrarResultado(id, { status, stonePagamentoId, recebedorNome, recebedorDoc, valorCentavos, erro } = {}) {
  if (!RESULTADOS.includes(status)) throw new CpError(`Resultado inválido: ${status}`);
  const v = Number.isInteger(Number(valorCentavos)) && Number(valorCentavos) > 0 ? Number(valorCentavos) : null;
  const { data, error } = await supabase
    .from(T.transf)
    .update({ status, stone_pagamento_id: stonePagamentoId || null, recebedor_nome: recebedorNome || null, recebedor_doc: recebedorDoc || null, valor_incluido_centavos: v, erro: erro ? String(erro).slice(0, 500) : null, concluido_em: agora() })
    .eq('id', Number(id))
    .eq('status', 'processando')
    .select()
    .maybeSingle();
  lancar(error);
  if (!data) throw new CpError(`Transferência ${id} não está em processamento.`, 'NAO_PROCESSANDO', 409);
  const aviso = await avisarSeFechou(data.lote);
  return { ok: true, aviso };
}

/** Lote sem nada em andamento → um aviso só no grupo, com o que entrou na Stone para o Fábio aprovar. */
async function avisarSeFechou(lote) {
  const { count, error } = await supabase.from(T.transf).select('id', { count: 'exact', head: true }).eq('lote', lote).in('status', ['fila', 'processando']);
  lancar(error);
  if (count) return null;
  const { data: linhas, error: e2 } = await supabase.from(T.transf).update({ aviso_em: agora() }).eq('lote', lote).is('aviso_em', null).select('*');
  lancar(e2);
  const itens = (linhas || []).filter((l) => l.status === 'incluido');
  if (!itens.length) return null;
  try {
    const grupo = await grupoChatid();
    await wa.enviarTexto({ number: grupo, text: textoAvisoTransferencias(itens, { mencionar: MENCIONAR }), mentions: MENCIONAR, trackId: 'veveto' });
    return { enviado: true, contas: [...new Set(itens.map((i) => i.origem_final))] };
  } catch (e) {
    console.error('[entre contas] aviso no grupo:', e.message);
    await supabase.from(T.transf).update({ aviso_erro: String(e.message).slice(0, 300) }).eq('lote', lote);
    return { enviado: false, erro: e.message };
  }
}

// ─── conferência no extrato ───────────────────────────────────
/**
 * "Confere se foi feito": a transferência incluída vira FEITA quando a saída do
 * mesmo valor aparece no extrato da conta de origem (a partir do dia da inclusão),
 * para o titular da conta de destino. A entrada no destino, quando já está no
 * extrato, fica anotada junto. Roda quando a tela abre e ao fim das execuções do bot.
 */
export async function conferirNoExtrato() {
  const desde = new Date(Date.now() - 15 * 864e5).toISOString();
  const { data: abertas, error } = await supabase.from(T.transf).select('*').eq('status', 'incluido').gte('concluido_em', desde).order('id');
  lancar(error);
  if (!abertas?.length) return { conferidas: 0, feitas: 0 };
  const { data: contas, error: e1 } = await supabase.from('fluxo_caixa_contas').select('id, banco, titular_cnpj, escopo').eq('banco', 'STONE');
  lancar(e1);
  const contaDoCnpj = new Map((contas || []).filter((c) => (c.escopo || 'crosby') === 'crosby' && c.titular_cnpj).map((c) => [String(c.titular_cnpj).replace(/\D/g, ''), c.id]));
  const { data: jaUsadas, error: e2 } = await supabase.from(T.transf).select('conferencia').eq('status', 'efetivada').gte('criado_em', new Date(Date.now() - 45 * 864e5).toISOString());
  lancar(e2);
  const usadas = new Set((jaUsadas || []).flatMap((t) => [t.conferencia?.saida, t.conferencia?.entrada]).filter(Boolean));
  let feitas = 0;
  for (const t of abertas) {
    const centavos = t.valor_incluido_centavos ?? t.valor_centavos;
    const contaOrigem = contaDoCnpj.get(String(t.origem_cnpj || ''));
    if (!centavos || !contaOrigem) continue;
    const v = centavos / 100;
    const dia = diaRecife(t.concluido_em);
    const { data: saidas, error: e3 } = await supabase.from('fluxo_caixa_lancamentos').select('id, data, valor, contraparte_nome, memo, transferencia_id').eq('conta_id', contaOrigem).gte('data', dia).gte('valor', -(v + 0.001)).lte('valor', -(v - 0.001)).order('data').order('id');
    lancar(e3);
    const saida = (saidas || []).find((l) => !usadas.has(l.id) && (l.transferencia_id || nomeScore(t.destino_nome || '', l.contraparte_nome || l.memo || '') >= 0.6));
    if (!saida) continue;
    usadas.add(saida.id);
    let entrada = null;
    const contaDestino = contaDoCnpj.get(String(t.destino_cnpj || ''));
    if (contaDestino) {
      const { data: entradas } = await supabase.from('fluxo_caixa_lancamentos').select('id, data, valor').eq('conta_id', contaDestino).gte('data', dia).gte('valor', v - 0.001).lte('valor', v + 0.001).order('data').order('id');
      entrada = (entradas || []).find((l) => !usadas.has(l.id)) || null;
      if (entrada) usadas.add(entrada.id);
    }
    const { error: e4 } = await supabase.from(T.transf).update({ status: 'efetivada', efetivada_em: `${saida.data}T12:00:00-03:00`, conferencia: { saida: saida.id, entrada: entrada?.id ?? null, data: saida.data } }).eq('id', t.id).eq('status', 'incluido');
    lancar(e4);
    feitas += 1;
  }
  if (feitas) console.log(`🔁 [entre contas] ${feitas} transferência(s) confirmada(s) no extrato`);
  return { conferidas: abertas.length, feitas };
}

export default { contasComSaldo, salvarChave, solicitar, cancelar, painel, proximaTransferencia, registrarResultado, conferirNoExtrato };
