// =============================================================================
// HEADCOACH › FINANCEIRO › LIBERAÇÃO DE PAGAMENTO (Yago, 23/11/2026)
//
// No Contas a Pagar do HeadCoach o financeiro seleciona as duplicatas e clica em
// LIBERAR PARA PAGAMENTO. Aqui elas seguem o fluxo
//     PENDENTE → PREVISÃO → APROVADO → INCLUÍDO → PAGO
//   • pendente  — liberada, esperando alguém programar
//   • previsão  — tem dia previsto para pagar
//   • aprovado  — pagamento aprovado
//   • incluído  — pagamento já incluído no banco, esperando sair
//   • pago      — saiu: grava a BAIXA na duplicata (hc_cp_baixas), sem estorno
// Entre as quatro primeiras etapas a liberação vai e volta à vontade. Dá para
// DEVOLVER ao contas a pagar (sai da liberação, a duplicata continua em aberto).
// A liberação vale o que falta pagar da duplicata — ou menos (pagamento parcial:
// a duplicata continua em aberto pelo resto e pode ser liberada de novo).
// Tabela hc_cp_liberacoes (migrations/hc_cp_liberacoes.sql). Nada vai ao TOTVS.
// =============================================================================
import supabase from '../config/supabase.js';
import { CpError, FORMAS, empresasPermitidas, conferirSenha, aplicarBaixa, saldoDoTitulo, rotuloDuplicata } from './hcContasPagar.js';
import { solicitacoesAposDevolucao } from './solicitacaoVinculoHc.js';
import { enfileirarHc } from './hcCpInclusaoStone.js';

export const STATUS = { pendente: 'Pendente', previsao: 'Previsão', aprovado: 'Aprovado', incluido: 'Incluído', pago: 'Pago', cancelado: 'Devolvida' };
export const EM_ANDAMENTO = ['pendente', 'previsao', 'aprovado', 'incluido']; // na ordem do fluxo
// contas de onde o pagamento sai (as mesmas da Liberação antiga: Stone pelo final do CNPJ)
export const BANCOS = ['STONE 0103', 'STONE 0116', 'STONE 0138', 'STONE 0205', 'STONE 0549', 'STONE 0891', 'STONE 0972', 'STONE 0973', 'STONE 1006', 'STONE 1007', 'STONE 1197', 'STONE 1198', 'STONE 1279', 'STONE 1430', 'PAGARME', 'ITAU RECIFE', 'MENTORE'];

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const ehData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime());
const quem = (user) => user?.name || user?.email || null;
const texto = (v, max = 500) => String(v ?? '').trim().slice(0, max) || null;
const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')));
const idsDe = (lista, max = 500) => {
  const ids = [...new Set((Array.isArray(lista) ? lista : [lista]).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw new CpError('Selecione ao menos uma duplicata');
  if (ids.length > max) throw new CpError(`No máximo ${max} por vez`);
  return ids;
};

function falha(error) {
  const msg = String(error?.message || '');
  if (/relation .* does not exist|could not find the table|schema cache|column .* does not exist|relationship/i.test(msg)) return new CpError('A Liberação de Pagamento ainda não está liberada: falta a tabela no banco. Rode "node scripts/migrar-hc-cp-liberacoes.mjs" na pasta da API.', 'MIGRATION_PENDING', 503);
  if (/hc_cp_lib_uma_em_andamento/i.test(msg)) return new CpError('Esta duplicata já está na Liberação de Pagamento', 'JA_LIBERADA', 409);
  return new CpError(msg || 'Erro no banco', 'DB_ERROR', 500);
}
async function q(promessa) {
  const { data, error } = await promessa;
  if (error) throw falha(error);
  return data;
}
async function todas(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const lote = await q(montar().range(de, de + 999));
    out.push(...(lote || []));
    if (!lote || lote.length < 1000) break;
  }
  return out;
}

// ─── regras (sem banco) ──────────────────────────────────────────────────────
/** Entre as etapas em andamento a liberação vai e volta; PAGO e DEVOLVIDA são finais e têm ação própria. */
export const podeMudar = (de, para) => EM_ANDAMENTO.includes(de) && EM_ANDAMENTO.includes(para) && de !== para;

/**
 * O que gravar ao mudar de etapa: carimba quem aprovou / incluiu e, ao voltar,
 * limpa os carimbos das etapas que ficaram para a frente.
 */
export function carimboDaMudanca(para, por, agora = new Date().toISOString()) {
  const i = EM_ANDAMENTO.indexOf(para);
  if (i < 0) throw new CpError('Etapa inválida');
  const patch = { status: para, atualizado_por: por, atualizado_em: agora };
  if (i < EM_ANDAMENTO.indexOf('aprovado')) Object.assign(patch, { aprovado_por: null, aprovado_em: null });
  if (i < EM_ANDAMENTO.indexOf('incluido')) Object.assign(patch, { incluido_por: null, incluido_em: null });
  if (para === 'aprovado') Object.assign(patch, { aprovado_por: por, aprovado_em: agora });
  if (para === 'incluido') Object.assign(patch, { incluido_por: por, incluido_em: agora });
  return patch;
}

/** Por que uma duplicata não pode ser liberada (null = pode). */
export function motivoDeNaoLiberar(t, { jaLiberada = false } = {}) {
  if (!t) return 'duplicata não encontrada';
  if (t.situacao === 'pago') return 'já está paga';
  if (t.situacao === 'cancelado') return 'está cancelada';
  if (jaLiberada) return 'já está na Liberação de Pagamento';
  if (!(saldoDoTitulo(t) > 0)) return 'não tem valor em aberto';
  return null;
}

/** Quantidade e valor por etapa (cards da tela). "ativos" = tudo o que ainda vai ser pago. */
export function resumoDasLiberacoes(linhas) {
  const r = Object.fromEntries(Object.keys(STATUS).map((s) => [s, { qtd: 0, valor: 0 }]));
  r.ativos = { qtd: 0, valor: 0 };
  for (const l of linhas || []) {
    if (!r[l.status]) continue;
    r[l.status].qtd += 1;
    r[l.status].valor = round2(r[l.status].valor + Number(l.valor || 0));
    if (EM_ANDAMENTO.includes(l.status)) {
      r.ativos.qtd += 1;
      r.ativos.valor = round2(r.ativos.valor + Number(l.valor || 0));
    }
  }
  return r;
}

// ─── leitura ─────────────────────────────────────────────────────────────────
const CAMPOS_TITULO = 'id, empresa, fornecedor_code, fornecedor_nome, fornecedor_cpf_cnpj, duplicata, parcela, documento_fiscal, despesa_code, despesa_nome, centro_custo_code, centro_custo_nome, rateio, emissao, vencimento, valor, valor_pago, juros, multa, desconto, situacao, forma_pagamento, chave_pix, codigo_barras, observacao, origem, origem_ref, anexo_path';
const COM_TITULO = `*, titulo:hc_cp_titulos!inner(${CAMPOS_TITULO})`;

const paraTela = (l) => ({ ...l, valor: Number(l.valor), titulo: l.titulo ? { ...l.titulo, rotulo: rotuloDuplicata(l.titulo), falta: saldoDoTitulo(l.titulo) } : null });

/** Liberações (com a duplicata) que o usuário pode mexer; as de empresa sem acesso ficam de fora. */
async function liberacoesDoUsuario(user, ids) {
  const { codes } = await empresasPermitidas(user);
  const linhas = await q(supabase.from('hc_cp_liberacoes').select(COM_TITULO).in('id', ids));
  const permitidas = new Set(codes);
  return (linhas || []).filter((l) => permitidas.has(Number(l.titulo?.empresa)));
}

/** Liberações INCLUÍDAS NO BANCO (com a duplicata) das empresas do usuário — o que a baixa automática confere nos extratos. */
export async function incluidasDoUsuario(user) {
  const { codes } = await empresasPermitidas(user);
  if (!codes.length) return [];
  return todas(() => supabase.from('hc_cp_liberacoes').select(COM_TITULO).in('titulo.empresa', codes).eq('status', 'incluido').order('id'));
}

export async function opcoesDaLiberacao(user) {
  const { lista } = await empresasPermitidas(user);
  return { empresas: lista, status: STATUS, emAndamento: EM_ANDAMENTO, bancos: BANCOS, formas: FORMAS };
}

/**
 * Tudo o que está em andamento + o que foi pago no período (padrão: o mês atual).
 * f: { empresa, de, ate } — de/ate valem só para os PAGOS (data do pagamento).
 */
export async function listarLiberacoes(user, f = {}) {
  const { lista, codes } = await empresasPermitidas(user, f.empresa);
  const hoje = hojeBrasil();
  if (!codes.length) return { liberacoes: [], resumo: resumoDasLiberacoes([]), empresas: lista, hoje };
  const de = ehData(f.de) ? f.de : `${hoje.slice(0, 7)}-01`;
  const ate = ehData(f.ate) ? f.ate : hoje;
  const base = () => supabase.from('hc_cp_liberacoes').select(COM_TITULO).in('titulo.empresa', codes);
  const [andamento, pagos] = await Promise.all([
    todas(() => base().in('status', EM_ANDAMENTO).order('data_prevista', { ascending: true, nullsFirst: false }).order('id')),
    todas(() => base().eq('status', 'pago').gte('data_pagamento', de).lte('data_pagamento', ate).order('data_pagamento', { ascending: false }).order('id', { ascending: false })),
  ]);
  const liberacoes = [...andamento, ...pagos].map(paraTela);
  return { liberacoes, resumo: resumoDasLiberacoes(liberacoes), empresas: lista, hoje, pagosDe: de, pagosAte: ate };
}

// ─── liberar (vem do contas a pagar) ─────────────────────────────────────────
/**
 * LIBERAR PARA PAGAMENTO: as duplicatas selecionadas entram como PENDENTE, pelo
 * que falta pagar. As que não podem (pagas, canceladas, já liberadas) voltam em
 * "ignoradas", com o motivo.
 * semConferirEmpresa: uso interno (liberação de uma Solicitação Crosby, em que a
 * permissão já foi conferida pelo setor de quem liberou).
 */
export async function liberarTitulos(user, b = {}, { semConferirEmpresa = false } = {}) {
  const ids = idsDe(b.ids);
  const permitidas = semConferirEmpresa ? null : new Set((await empresasPermitidas(user)).codes);
  const [titulos, jaLiberadas] = await Promise.all([q(supabase.from('hc_cp_titulos').select('*').in('id', ids)), q(supabase.from('hc_cp_liberacoes').select('titulo_id').in('titulo_id', ids).in('status', EM_ANDAMENTO))]);
  const porId = new Map((titulos || []).map((t) => [Number(t.id), t]));
  const ocupadas = new Set((jaLiberadas || []).map((l) => Number(l.titulo_id)));
  const dataPrevista = ehData(b.dataPrevista) ? b.dataPrevista : null;
  const novas = [];
  const ignoradas = [];
  for (const id of ids) {
    const t = porId.get(id);
    const motivo = t && permitidas && !permitidas.has(Number(t.empresa)) ? 'você não tem acesso à empresa' : motivoDeNaoLiberar(t, { jaLiberada: ocupadas.has(id) });
    if (motivo) ignoradas.push({ id, rotulo: t ? `${t.fornecedor_nome} ${rotuloDuplicata(t)}` : `#${id}`, motivo });
    else novas.push({ titulo_id: id, status: 'pendente', valor: saldoDoTitulo(t), data_prevista: dataPrevista || String(t.vencimento).slice(0, 10), forma_pagamento: t.forma_pagamento || null, liberado_por: quem(user), atualizado_por: quem(user) });
  }
  let liberadas = [];
  if (novas.length) {
    try {
      liberadas = await q(supabase.from('hc_cp_liberacoes').insert(novas).select('id, titulo_id'));
    } catch (e) {
      if (e.code !== 'JA_LIBERADA') throw e;
      // outra pessoa liberou uma delas no mesmo instante: grava uma a uma e separa a repetida
      for (const n of novas) {
        try {
          liberadas.push(...(await q(supabase.from('hc_cp_liberacoes').insert(n).select('id, titulo_id'))));
        } catch (e2) {
          if (e2.code !== 'JA_LIBERADA') throw e2;
          const t = porId.get(n.titulo_id);
          ignoradas.push({ id: n.titulo_id, rotulo: `${t.fornecedor_nome} ${rotuloDuplicata(t)}`, motivo: 'já está na Liberação de Pagamento' });
        }
      }
    }
  }
  if (liberadas.length) console.log(`📤 [liberação de pagamento] ${liberadas.length} duplicata(s) liberada(s) · ${quem(user)}`);
  return { liberadas: liberadas.length, ignoradas };
}

// ─── mudar de etapa ──────────────────────────────────────────────────────────
/** b: { ids, status: pendente | previsao | aprovado | incluido, dataPrevista? } */
export async function mudarStatus(user, b = {}) {
  const ids = idsDe(b.ids);
  const para = String(b.status || '');
  if (!EM_ANDAMENTO.includes(para)) throw new CpError('Etapa inválida');
  if (b.dataPrevista !== undefined && b.dataPrevista !== null && b.dataPrevista !== '' && !ehData(b.dataPrevista)) throw new CpError('Data prevista inválida');
  const linhas = await liberacoesDoUsuario(user, ids);
  const por = quem(user);
  let alteradas = 0;
  const ignoradas = [];
  const aprovadasAgora = []; // vieram de Pendente/Previsão: são as que vão para o bot incluir na Stone
  for (const l of linhas) {
    if (l.status === para && !b.dataPrevista) continue;
    if (l.status !== para && !podeMudar(l.status, para)) {
      ignoradas.push({ id: l.id, rotulo: `${l.titulo.fornecedor_nome} ${rotuloDuplicata(l.titulo)}`, motivo: `está ${STATUS[l.status].toLowerCase()}` });
      continue;
    }
    const patch = l.status === para ? { atualizado_por: por, atualizado_em: new Date().toISOString() } : carimboDaMudanca(para, por);
    if (ehData(b.dataPrevista)) patch.data_prevista = b.dataPrevista;
    const ok = await q(supabase.from('hc_cp_liberacoes').update(patch).eq('id', l.id).eq('status', l.status).select('id').maybeSingle());
    if (ok) {
      alteradas += 1;
      // voltar de Incluído para Aprovado NÃO reenvia: o pagamento pode já estar na Stone
      if (para === 'aprovado' && ['pendente', 'previsao'].includes(l.status)) aprovadasAgora.push({ ...l, status: 'aprovado' });
    } else ignoradas.push({ id: l.id, rotulo: `${l.titulo.fornecedor_nome} ${rotuloDuplicata(l.titulo)}`, motivo: 'acabou de ser alterada por outra pessoa' });
  }
  const inclusao = aprovadasAgora.length ? await incluirNaStone(aprovadasAgora, por) : null;
  return { alteradas, ignoradas, status: para, inclusao };
}

// ─── alterar (banco, forma, data prevista, valor, observação) ────────────────
export async function editarLiberacao(user, id, b = {}) {
  const [l] = await liberacoesDoUsuario(user, [Number(id)]);
  if (!l) throw new CpError('Liberação não encontrada', 'NOT_FOUND', 404);
  if (!EM_ANDAMENTO.includes(l.status)) throw new CpError(`Esta liberação está ${STATUS[l.status].toLowerCase()} e não pode mais ser alterada`, 'FINAL', 409);
  const patch = {};
  if (b.dataPrevista !== undefined) {
    if (b.dataPrevista && !ehData(b.dataPrevista)) throw new CpError('Data prevista inválida');
    patch.data_prevista = b.dataPrevista || null;
  }
  if (b.banco !== undefined) patch.banco = texto(b.banco, 120);
  if (b.formaPagamento !== undefined) {
    if (b.formaPagamento && !FORMAS[b.formaPagamento]) throw new CpError('Forma de pagamento inválida');
    patch.forma_pagamento = b.formaPagamento || null;
  }
  if (b.observacao !== undefined) patch.observacao = texto(b.observacao, 1000);
  if (b.valor !== undefined && b.valor !== null && String(b.valor).trim() !== '') {
    const valor = round2(num(b.valor));
    const falta = saldoDoTitulo(l.titulo);
    if (!Number.isFinite(valor) || valor <= 0) throw new CpError('Valor inválido');
    if (valor > falta + 0.005) throw new CpError(`O valor é maior que o que falta pagar da duplicata (R$ ${falta.toFixed(2).replace('.', ',')})`);
    patch.valor = valor;
  }
  if (!Object.keys(patch).length) return paraTela(l);
  const nova = await q(supabase.from('hc_cp_liberacoes').update({ ...patch, atualizado_por: quem(user), atualizado_em: new Date().toISOString() }).eq('id', l.id).in('status', EM_ANDAMENTO).select(COM_TITULO).maybeSingle());
  if (!nova) throw new CpError('Esta liberação acabou de ser paga ou devolvida', 'FINAL', 409);
  return paraTela(nova);
}

// ─── inclusão automática na Stone (services/hcCpInclusaoStone.js) ────────────
/** Manda as aprovadas para o bot e resume: quantas foram por Pix e quantas ficam para incluir à mão (e por quê). */
async function incluirNaStone(liberacoes, por) {
  try {
    const { itens } = await enfileirarHc(liberacoes, { usuario: por });
    const porId = new Map(liberacoes.map((l) => [l.id, l]));
    return {
      naFila: itens.filter((i) => i.via === 'pix' && i.status === 'fila').length,
      comErro: itens.filter((i) => i.via === 'pix' && i.status === 'erro').map((i) => ({ id: i.id, rotulo: `${porId.get(i.id)?.titulo?.fornecedor_nome || ''} ${rotuloDuplicata(porId.get(i.id)?.titulo || {})}`, motivo: i.erro })),
      manuais: itens.filter((i) => i.via === 'manual').map((i) => ({ id: i.id, rotulo: `${porId.get(i.id)?.titulo?.fornecedor_nome || ''} ${rotuloDuplicata(porId.get(i.id)?.titulo || {})}`, motivo: i.motivo })),
    };
  } catch (e) {
    console.error('[liberação HC → Stone] fila:', e.message);
    return { naFila: 0, comErro: [], manuais: [], falha: e.message };
  }
}

/** REENVIAR AO BOT: liberações em Aprovados cuja inclusão não chegou à Stone (erro, bloqueada, cancelada) ou que ainda não foram enviadas. */
export async function reenviarAoBot(user, b = {}) {
  const ids = idsDe(b.ids);
  const linhas = (await liberacoesDoUsuario(user, ids)).filter((l) => l.status === 'aprovado');
  if (!linhas.length) throw new CpError('Só dá para enviar ao bot o que está em Aprovados');
  const inclusao = await incluirNaStone(linhas, quem(user));
  if (inclusao.falha) throw new CpError(`Não consegui pôr na fila do bot: ${inclusao.falha}`, 'FILA', 500);
  return { inclusao };
}

// ─── devolver ao contas a pagar ──────────────────────────────────────────────
/** Tira da liberação (a duplicata continua em aberto no contas a pagar e pode ser liberada de novo). */
export async function devolverLiberacoes(user, b = {}) {
  const ids = idsDe(b.ids);
  const linhas = await liberacoesDoUsuario(user, ids);
  const agora = new Date().toISOString();
  const por = quem(user);
  let devolvidas = 0;
  const ignoradas = [];
  const soltas = [];
  for (const l of linhas) {
    const ok = EM_ANDAMENTO.includes(l.status) ? await q(supabase.from('hc_cp_liberacoes').update({ status: 'cancelado', cancelado_por: por, cancelado_em: agora, cancelado_motivo: texto(b.motivo, 500) || 'Devolvida ao contas a pagar', atualizado_por: por, atualizado_em: agora }).eq('id', l.id).in('status', EM_ANDAMENTO).select('id').maybeSingle()) : null;
    if (ok) {
      devolvidas += 1;
      soltas.push(l.titulo);
    } else ignoradas.push({ id: l.id, rotulo: `${l.titulo.fornecedor_nome} ${rotuloDuplicata(l.titulo)}`, motivo: `está ${STATUS[l.status].toLowerCase()}` });
  }
  // duplicata que veio de uma Solicitação Crosby: a solicitação volta a poder ser liberada
  await solicitacoesAposDevolucao(soltas);
  return { devolvidas, ignoradas };
}

// ─── pagar ───────────────────────────────────────────────────────────────────
/**
 * Paga UMA liberação: grava a baixa da duplicata (pelo valor da liberação; menor que
 * o que falta = baixa parcial) e fecha a liberação como PAGA. Erro de regra sai
 * como CpError (quem chama decide se ignora). Usada pelo PAGAR da tela e pela
 * baixa automática pelo extrato.
 */
export async function pagarUmaLiberacao(l, { data, banco, por, porId = null, observacao = null } = {}) {
  if (!EM_ANDAMENTO.includes(l.status)) throw new CpError(`está ${STATUS[l.status].toLowerCase()}`);
  if (!banco) throw new CpError('sem o banco de onde o pagamento saiu');
  // relê a duplicata: outra baixa pode ter entrado desde que a tela carregou
  const t = await q(supabase.from('hc_cp_titulos').select('*').eq('id', l.titulo_id).maybeSingle());
  if (!t || t.situacao !== 'aberto') throw new CpError(t?.situacao === 'pago' ? 'a duplicata já está paga' : 'a duplicata não está mais em aberto');
  const falta = saldoDoTitulo(t);
  const valor = Math.min(Number(l.valor), falta);
  const r = await aplicarBaixa(t, { dataPagamento: data, valorPago: valor < falta - 0.005 ? valor : null, formaPagamento: l.forma_pagamento || t.forma_pagamento || null, conta: banco, observacao: ['Liberação de Pagamento', observacao, l.observacao].filter(Boolean).join(' · ') }, { por, porId, semLiberacao: true });
  const agora = new Date().toISOString();
  // só fecha se ainda estiver em andamento (duas pessoas pagando a mesma ao mesmo tempo)
  await q(supabase.from('hc_cp_liberacoes').update({ status: 'pago', valor: r.pago > 0 ? r.pago : l.valor, banco, pago_por: por, pago_em: agora, data_pagamento: r.data, baixa_id: r.baixa?.id || null, atualizado_por: por, atualizado_em: agora }).eq('id', l.id).in('status', EM_ANDAMENTO));
  return r;
}

/**
 * PAGAR: grava a baixa de cada duplicata pelo valor da liberação (menor que o que
 * falta = baixa parcial) e fecha a liberação como PAGA. Não tem estorno.
 * b: { ids, dataPagamento, banco (vale para as que não têm banco próprio), senha }
 */
export async function pagarLiberacoes(user, b = {}) {
  const ids = idsDe(b.ids, 200);
  const hoje = hojeBrasil();
  const data = ehData(b.dataPagamento) ? b.dataPagamento : hoje;
  if (data > hoje) throw new CpError('A data do pagamento não pode ser no futuro');
  const bancoGeral = texto(b.banco, 120);
  const linhas = await liberacoesDoUsuario(user, ids);
  if (!linhas.length) throw new CpError('Nenhuma das liberações selecionadas foi encontrada', 'NOT_FOUND', 404);
  await conferirSenha(user?.email, b.senha);
  const por = quem(user);
  let pagas = 0;
  let valorPago = 0;
  const ignoradas = [];
  for (const l of linhas) {
    const rotulo = `${l.titulo.fornecedor_nome} ${rotuloDuplicata(l.titulo)}`;
    try {
      const r = await pagarUmaLiberacao(l, { data, banco: l.banco || bancoGeral, por, porId: user?.id || null });
      pagas += 1;
      valorPago = round2(valorPago + r.pago);
    } catch (e) {
      if (!(e instanceof CpError) || e.status === 500) throw e;
      ignoradas.push({ id: l.id, rotulo, motivo: e.message });
    }
  }
  if (pagas) console.log(`💸 [liberação de pagamento] ${pagas} paga(s) · R$ ${valorPago.toFixed(2)} · ${por}`);
  return { pagas, valorPago, ignoradas };
}
