// ============================================================
// COMPROVANTES DE SAÍDA (PDF do portal Stone) — bot Stone Extratos
//
// Todo dia o bot baixa o comprovante de cada saída (Pix, TED, Conta Stone,
// pagamento de boleto) pela mesma chamada do botão "Baixar comprovante" do
// portal e manda para cá. O PDF fica no bucket privado extratos-bancarios e a
// linha em fluxo_caixa_comprovantes, ligada ao lançamento pela CHAVE estável
// (conta|data|valor|hash(memo)|n — a mesma das conciliações), porque os ids de
// lançamento mudam a cada reimportação do extrato.
//
// Quando uma saída é conciliada com uma Solicitação Crosby (direta, em várias
// duplicatas, ou via Liberação de Pagamento que veio de uma solicitação), o
// comprovante é copiado para o bucket público solicitacoes-crosby, gravado em
// solicitacoes_crosby.comprovante_url, a solicitação é marcada como paga
// (pago_em/pago_por_nome) e, se houver, o título da Liberação vira PAGO.
// ============================================================
import crypto from 'node:crypto';
import supabase from '../config/supabase.js';
import { atribuirChaves, hashMemo } from './fluxoCaixaConciliacao.js';

export const BUCKET_PRIVADO = 'extratos-bancarios';
export const BUCKET_SOLICITACOES = 'solicitacoes-crosby';
const T = { comp: 'fluxo_caixa_comprovantes', contas: 'fluxo_caixa_contas', lanc: 'fluxo_caixa_lancamentos', conc: 'fluxo_caixa_conciliacoes', sol: 'solicitacoes_crosby', lib: 'pagamentos_liberacao' };

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const normMemo = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const agora = () => new Date().toISOString();
const lancar = (error) => {
  if (error) throw new Error(error.message || String(error));
};

/** Conta STONE do Extrato Bancário a partir dos dados da API (agência "1", account_code com DV). */
async function contaStoneDe({ agencia, conta }) {
  const digitos = soDigitos(conta);
  const semDv = digitos.length >= 2 ? digitos.slice(0, -1) : digitos;
  const ag = (soDigitos(agencia || '1') || '1').padStart(4, '0');
  const { data, error } = await supabase.from(T.contas).select('id,apelido,titular_cnpj').eq('banco', 'STONE').eq('agencia', ag).eq('conta', semDv).maybeSingle();
  lancar(error);
  if (!data) throw new Error(`Conta Stone ${ag}/${semDv} não existe no Extrato Bancário (importe o extrato antes).`);
  return data;
}

/**
 * Guarda o PDF e liga ao lançamento.
 * @param {object} p { contaStone:{agencia,conta,cnpj}, data, valor (assinado), memo, stoneEntryId, stoneTipo, buffer, nome, execucaoId }
 */
/** Texto do PDF (para rejeitar o comprovante "genérico" que o portal devolve com resource_type errado). */
async function textoDoPdf(buffer) {
  try {
    const { extrairPaginasPdf } = await import('../utils/extratoStonePdf.js');
    const paginas = await extrairPaginasPdf(buffer);
    return paginas.map((pg) => pg.items.map((i) => i.s).join(' ')).join(' ').replace(/\s+/g, ' ');
  } catch {
    return '';
  }
}

export async function salvarComprovante(p) {
  const conta = await contaStoneDe(p.contaStone || {});
  const texto = await textoDoPdf(p.buffer);
  if (/Nome N[aã]o informado/i.test(texto) && !/Conta Stone/i.test(p.memo || '')) {
    const e = new Error('comprovante genérico (portal devolveu "Entre Contas Stone" sem destinatário) — resource_type errado para esse tipo');
    e.generico = true;
    throw e;
  }
  const valor = round2(p.valor);
  const { data: lancs, error } = await supabase.from(T.lanc).select('id,conta_id,data,seq,valor,memo,descricao').eq('conta_id', conta.id).eq('data', p.data);
  lancar(error);
  atribuirChaves(lancs || []);
  const mesmoValor = (lancs || []).filter((l) => Math.abs(round2(l.valor) - valor) < 0.011);
  const alvoMemo = normMemo(p.memo);
  let alvo = mesmoValor.find((l) => normMemo(l.memo) === alvoMemo) || null;
  if (!alvo && mesmoValor.length) {
    // memo um pouco diferente entre API e PDF: pega um do mesmo valor ainda sem comprovante
    const { data: jaTem } = await supabase.from(T.comp).select('chave').in('chave', mesmoValor.map((l) => l.chave));
    const usadas = new Set((jaTem || []).map((x) => x.chave));
    alvo = mesmoValor.find((l) => !usadas.has(l.chave)) || mesmoValor[0];
  }
  // sem lançamento (extrato do dia ainda não importado): chave calculada pelo memo da API (n = 1)
  const chave = alvo ? alvo.chave : `${conta.id}|${p.data}|${valor.toFixed(2)}|${hashMemo({ memo: p.memo })}|1`;

  const nome = String(p.nome || `Comprovante_${p.data}_${Math.abs(valor).toFixed(2)}.pdf`).replace(/[^\w.\-]+/g, '_');
  const path = `comprovantes/${String(p.data).slice(0, 7)}/${conta.id}_${p.data}_${Math.abs(valor).toFixed(2)}_${soDigitos(p.stoneEntryId || '').slice(-8) || crypto.randomBytes(3).toString('hex')}.pdf`;
  const up = await supabase.storage.from(BUCKET_PRIVADO).upload(path, p.buffer, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error(`Storage (${BUCKET_PRIVADO}): ${up.error.message}`);

  const row = {
    conta_id: conta.id,
    chave,
    data: p.data,
    valor,
    memo: p.memo || null,
    stone_entry_id: p.stoneEntryId || null,
    stone_tipo: p.stoneTipo || null,
    arquivo_path: path,
    arquivo_nome: nome,
    origem: 'bot-stone',
    execucao_id: p.execucaoId || null,
  };
  const { data, error: e2 } = await supabase.from(T.comp).upsert(row, { onConflict: 'chave' }).select().single();
  lancar(e2);
  return { id: data.id, chave, conta: conta.apelido, lancamentoId: alvo?.id || null, casou: !!alvo };
}

/** Anexa `comprovante` aos lançamentos (que já têm `chave`, vinda de anexarConciliacoes). Muta. */
export async function anexarComprovantes(lancamentos) {
  const comChave = lancamentos.filter((l) => l.chave);
  if (!comChave.length) return lancamentos;
  const contas = [...new Set(comChave.map((l) => l.conta_id))];
  const datas = comChave.map((l) => l.data).sort();
  const { data, error } = await supabase.from(T.comp).select('id,chave,arquivo_nome,stone_tipo,solicitacao_id,criado_em').in('conta_id', contas).gte('data', datas[0]).lte('data', datas.at(-1));
  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) return lancamentos;
    throw new Error(error.message);
  }
  const porChave = new Map((data || []).map((c) => [c.chave, c]));
  for (const l of lancamentos) {
    const c = l.chave ? porChave.get(l.chave) : null;
    l.comprovante = c ? { id: c.id, nome: c.arquivo_nome, tipo: c.stone_tipo, solicitacaoId: c.solicitacao_id, em: c.criado_em } : null;
  }
  return lancamentos;
}

export async function comprovantePorChave(chave) {
  if (!chave) return null;
  const { data, error } = await supabase.from(T.comp).select('*').eq('chave', chave).maybeSingle();
  if (error && !/does not exist|schema cache/i.test(error.message || '')) throw new Error(error.message);
  return data || null;
}

/** Link temporário (5 min) do PDF. */
export async function urlComprovante(id) {
  const { data: c, error } = await supabase.from(T.comp).select('id,arquivo_path,arquivo_nome').eq('id', id).maybeSingle();
  lancar(error);
  if (!c) throw new Error('Comprovante não encontrado.');
  const { data, error: e2 } = await supabase.storage.from(BUCKET_PRIVADO).createSignedUrl(c.arquivo_path, 60 * 5, { download: c.arquivo_nome || undefined });
  if (e2) throw new Error(`Storage: ${e2.message}`);
  return { id: c.id, nome: c.arquivo_nome, url: data.signedUrl };
}

/** Copia o PDF do bucket privado para o público das solicitações e devolve a URL pública. */
async function publicarNaSolicitacao(comp, solicitacaoId) {
  const dl = await supabase.storage.from(BUCKET_PRIVADO).download(comp.arquivo_path);
  if (dl.error) throw new Error(`Storage download: ${dl.error.message}`);
  const buf = Buffer.from(await dl.data.arrayBuffer());
  const path = `comprovantes/${solicitacaoId}/stone-${comp.data}-${Math.abs(Number(comp.valor)).toFixed(2).replace('.', '')}.pdf`;
  const up = await supabase.storage.from(BUCKET_SOLICITACOES).upload(path, buf, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error(`Storage (${BUCKET_SOLICITACOES}): ${up.error.message}`);
  const { data } = supabase.storage.from(BUCKET_SOLICITACOES).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Conciliação de uma saída com Solicitação Crosby → comprovante na solicitação
 * + marcada como paga (+ título da Liberação PAGO, se existir).
 * @returns {{url, solicitacaoId}|null} null quando a saída não tem comprovante do bot
 */
export async function vincularComprovanteASolicitacao({ chave, solicitacaoId, dataPagamento, usuario }) {
  if (!chave || !solicitacaoId) return null;
  const comp = await comprovantePorChave(chave);
  if (!comp) return null;
  const { data: sol, error } = await supabase.from(T.sol).select('id,comprovante_url,pago_em,pagamento_liberacao_id,status').eq('id', solicitacaoId).maybeSingle();
  lancar(error);
  if (!sol) return null;

  const url = await publicarNaSolicitacao(comp, solicitacaoId);
  const quem = usuario || 'Conciliação bancária (bot Stone)';
  const patch = {};
  if (!sol.comprovante_url) patch.comprovante_url = url;
  if (!sol.pago_em) {
    patch.pago_em = agora();
    patch.pago_por_nome = quem;
  }
  if (Object.keys(patch).length) {
    const { error: e2 } = await supabase.from(T.sol).update(patch).eq('id', solicitacaoId);
    lancar(e2);
  }
  if (sol.pagamento_liberacao_id) {
    const { data: lib } = await supabase.from(T.lib).select('id,status,dt_pagamento,banco_pagamento').eq('id', sol.pagamento_liberacao_id).maybeSingle();
    if (lib && !['PAGO', 'CANCELADO'].includes(lib.status)) {
      const { error: e3 } = await supabase
        .from(T.lib)
        .update({ status: 'PAGO', pago_em: agora(), pago_por: quem, aprovado_em: agora(), aprovado_por: quem, dt_pagamento: lib.dt_pagamento || dataPagamento || null, banco_pagamento: lib.banco_pagamento || 'STONE' })
        .eq('id', lib.id);
      lancar(e3);
    }
  }
  await supabase.from(T.comp).update({ solicitacao_id: solicitacaoId, solicitacao_em: agora() }).eq('id', comp.id);
  return { url, solicitacaoId, comprovanteId: comp.id, jaTinhaComprovante: !!sol.comprovante_url, jaEstavaPaga: !!sol.pago_em };
}

/**
 * Ids de Solicitação Crosby envolvidos numa conciliação gravada
 * (SOLICITACAO direta, itens de MULTIPLO, ou LIBERACAO que nasceu de uma solicitação).
 */
export async function solicitacoesDaConciliacao(conc) {
  const ref = conc?.referencia || {};
  const ids = new Set();
  if (conc.origem === 'SOLICITACAO' && ref.id) ids.add(String(ref.id));
  for (const it of Array.isArray(ref.itens) ? ref.itens : []) if (it?.origem === 'SOLICITACAO' && it.id) ids.add(String(it.id));
  const libIds = [];
  if (conc.origem === 'LIBERACAO' && ref.id) libIds.push(String(ref.id));
  for (const it of Array.isArray(ref.itens) ? ref.itens : []) if (it?.origem === 'LIBERACAO' && it.id) libIds.push(String(it.id));
  if (libIds.length) {
    const { data } = await supabase.from(T.lib).select('id,dados_completos').in('id', libIds);
    for (const p of data || []) if (p.dados_completos?.solicitacao_id) ids.add(String(p.dados_completos.solicitacao_id));
    // solicitação que aponta para este título
    const { data: sols } = await supabase.from(T.sol).select('id').in('pagamento_liberacao_id', libIds);
    for (const s of sols || []) ids.add(String(s.id));
  }
  return [...ids];
}

export default { salvarComprovante, anexarComprovantes, comprovantePorChave, urlComprovante, vincularComprovanteASolicitacao, solicitacoesDaConciliacao };
