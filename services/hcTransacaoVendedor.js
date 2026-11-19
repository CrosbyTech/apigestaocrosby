// ============================================================================
// HEADCOACH › TRANSAÇÕES — TROCA DE VENDEDOR (Yago, 19/11/2026)
//
// O owner troca, pela tela de Transações, quem é o vendedor de uma transação.
// A troca tem de valer em TODO cálculo que usa o vendedor:
//   • ranking do PDV, Ranking de Faturamento, New Forecast / Painel de Vendas
//     e Vendas do dia do caixa leem o vendedor direto da transação
//     (pdv_vendas) — basta gravar lá;
//   • as CÓPIAS do vendedor acompanham: contas a receber (hc_cr_titulos),
//     faturamento da expedição (pedidos_venda_faturamentos), transferência
//     (transferencias_transacoes) e cupom de troca (pdv_cupons_troca);
//   • os números já GUARDADOS dos painéis são descartados para serem refeitos:
//     semanas fechadas do New Forecast (new_forecast_semana_cache) e o mês
//     fechado do faturamento por vendedor (faturamento_vendedor_mensal). O
//     cache em memória do faturamento por vendedor é limpo pela rota.
//
// O que NÃO muda (e a função avisa): a nota fiscal já autorizada (o nome do
// vendedor fica nas informações complementares) e a transação espelhada no
// TOTVS, quando houve espelho.
//
// Histórico em hc_transacoes_vendedor_alteracoes (migrations/hc_transacoes_vendedor.sql).
// ============================================================================
import supabase from '../config/supabase.js';

export class VendedorTransacaoError extends Error {
  constructor(message, code = 'VENDEDOR_TRANSACAO', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const diaBrasil = (iso) => (iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date(iso)) : null);
const falhaDb = (error) => new VendedorTransacaoError(error.message, 'DB_ERROR', 500);

/** "V45" / "45" → { fonte: 'venda', id: 45 } · "D28" → { fonte: 'devolucao', id: 28 } */
export function lerNumeroDaTransacao(idTexto) {
  const m = String(idTexto || '').trim().toUpperCase().match(/^([VD])?(\d+)$/);
  if (!m) throw new VendedorTransacaoError('Número de transação inválido', 'ID_INVALIDO');
  return { fonte: m[1] === 'D' ? 'devolucao' : 'venda', id: Number(m[2]), transacao: `${m[1] === 'D' ? 'D' : 'V'}${Number(m[2])}` };
}

/** Histórico das trocas de vendedor de uma transação (mais recente primeiro). */
export async function historicoDeVendedor(idTexto) {
  const { fonte, id } = lerNumeroDaTransacao(idTexto);
  const { data, error } = await supabase
    .from('hc_transacoes_vendedor_alteracoes')
    .select('id, de_code, de_nome, para_code, para_nome, motivo, alterado_por, alterado_em')
    .eq('fonte', fonte)
    .eq('transacao_id', id)
    .order('id', { ascending: false });
  if (error) {
    // tabela ainda não criada: a tela segue funcionando, só sem o histórico
    console.warn(`[hc/transacoes] histórico de vendedor: ${error.message}`);
    return [];
  }
  return (data || []).map((h) => ({
    id: h.id,
    de: { code: h.de_code, nome: h.de_nome },
    para: { code: h.para_code, nome: h.para_nome },
    motivo: h.motivo || null,
    por: h.alterado_por || null,
    em: h.alterado_em,
  }));
}

// atualiza uma cópia do vendedor; devolve quantas linhas mudaram (falha vira aviso, não desfaz a troca)
async function atualizarCopia(nome, montar, avisos) {
  try {
    const { data, error } = await montar();
    if (error) throw new Error(error.message);
    return (data || []).length;
  } catch (e) {
    console.error(`[hc/transacoes] troca de vendedor — ${nome}: ${e.message}`);
    avisos.push(`Não consegui atualizar o vendedor em "${nome}": ${e.message}`);
    return 0;
  }
}

// descarta os números guardados dos painéis que cobrem o dia da transação
async function descartarGuardados(dia, avisos) {
  const out = { semanasForecast: 0, mesFechado: null };
  if (!dia) return out;
  try {
    const { data: semanas, error } = await supabase.from('new_forecast_semana_cache').select('periodo_key');
    if (error) throw new Error(error.message);
    const chaves = (semanas || [])
      .map((s) => s.periodo_key)
      .filter((k) => {
        const [de, ate] = String(k).split('|');
        return de && ate && de <= dia && dia <= ate;
      });
    if (chaves.length) {
      const { error: e2 } = await supabase.from('new_forecast_semana_cache').delete().in('periodo_key', chaves);
      if (e2) throw new Error(e2.message);
      out.semanasForecast = chaves.length;
    }
  } catch (e) {
    avisos.push(`As semanas guardadas do New Forecast não foram refeitas (${e.message}); atualize o painel com "recalcular".`);
  }
  try {
    const mes = `${dia.slice(0, 7)}-01`;
    const { data, error } = await supabase.from('faturamento_vendedor_mensal').delete().eq('mes', mes).select('id');
    if (error) throw new Error(error.message);
    if ((data || []).length) out.mesFechado = dia.slice(0, 7);
  } catch (e) {
    avisos.push(`O mês fechado do faturamento por vendedor não foi refeito (${e.message}).`);
  }
  return out;
}

/**
 * Troca o vendedor de uma transação.
 * @param {string} idTexto  "V45" / "45" (venda, faturamento, transferência) ou "D28" (devolução)
 * @param {{ vendedorCode:number, vendedorNome:string, motivo?:string, user?:{id,name,email} }} p
 */
export async function alterarVendedorDaTransacao(idTexto, { vendedorCode, vendedorNome, motivo, user } = {}) {
  const { fonte, id, transacao } = lerNumeroDaTransacao(idTexto);
  const code = Number(vendedorCode);
  const nome = String(vendedorNome || '').trim();
  if (!Number.isInteger(code) || code <= 0) throw new VendedorTransacaoError('Escolha o vendedor', 'SEM_VENDEDOR');
  if (!nome) throw new VendedorTransacaoError('Informe o nome do vendedor', 'SEM_NOME');
  const por = user?.name || user?.email || null;
  const agora = new Date().toISOString();
  const avisos = [];
  const copias = {};

  const tabela = fonte === 'venda' ? 'pdv_vendas' : 'devolucoes_transacoes';
  const colunas = fonte === 'venda' ? 'id, empresa, vendedor_code, vendedor_nome, status, origem, tipo_venda, criado_em, data_caixa, caixa_id, totvs_transacao_code' : 'id, empresa, vendedor_code, vendedor_nome, criado_em, transacao_code, transacao_date';
  const { data: atual, error } = await supabase.from(tabela).select(colunas).eq('id', id).maybeSingle();
  if (error) throw falhaDb(error);
  if (!atual) throw new VendedorTransacaoError('Transação não encontrada', 'NOT_FOUND', 404);
  const de = { code: atual.vendedor_code ?? null, nome: atual.vendedor_nome || null };
  if (Number(de.code) === code) throw new VendedorTransacaoError(`Esta transação já está no vendedor ${code} — ${de.nome || nome}`, 'MESMO_VENDEDOR');

  // 1) a transação (é dela que os painéis leem)
  // `atualizado_em` só é mexido na venda que não está cancelada: na venda cancelada e na
  // devolução essa data faz as vezes de data de encerramento na tela de Transações.
  const mexeNaData = fonte === 'venda' && atual.status !== 'cancelada';
  const { data: gravada, error: eUp } = await supabase
    .from(tabela)
    .update({ vendedor_code: code, vendedor_nome: nome, ...(mexeNaData ? { atualizado_em: agora } : {}) })
    .eq('id', id)
    .select('id');
  if (eUp) throw falhaDb(eUp);
  if (!(gravada || []).length) throw new VendedorTransacaoError('Transação não encontrada', 'NOT_FOUND', 404);

  // 2) as cópias do vendedor
  let dia = null;
  if (fonte === 'venda') {
    copias.contasReceber = await atualizarCopia('contas a receber', () => supabase.from('hc_cr_titulos').update({ vendedor_code: code, vendedor_nome: nome, atualizado_em: agora }).eq('venda_id', id).select('id'), avisos);
    copias.faturamento = await atualizarCopia('faturamento da expedição', () => supabase.from('pedidos_venda_faturamentos').update({ vendedor_code: code, atualizado_em: agora }).eq('venda_id', id).select('id'), avisos);
    copias.transferencia = await atualizarCopia('transferência', () => supabase.from('transferencias_transacoes').update({ vendedor_code: code, vendedor_nome: nome, atualizado_em: agora }).eq('venda_id', id).select('id'), avisos);
    // cupom de troca: o cupom novo guarda o nº da transação do HeadCoach; o filtro por
    // empresa e data evita casar com cupom antigo (que guardava a transação do TOTVS)
    copias.cupomTroca = await atualizarCopia(
      'cupom de troca',
      () => supabase.from('pdv_cupons_troca').update({ vendedor_code: code, vendedor_nome: nome }).eq('transacao_code', id).eq('empresa', atual.empresa).gte('criado_em', atual.criado_em).select('id'),
      avisos,
    );
    dia = atual.data_caixa || null;
    if (!dia && atual.caixa_id) {
      const { data: cx } = await supabase.from('hc_caixas').select('data_caixa').eq('id', atual.caixa_id).maybeSingle();
      dia = cx?.data_caixa || null;
    }
    dia = String(dia || diaBrasil(atual.criado_em) || '').slice(0, 10) || null;
    if (atual.totvs_transacao_code) avisos.push(`Esta transação também foi lançada no TOTVS (nº ${atual.totvs_transacao_code}). Lá o vendedor não muda: o que o painel traz do TOTVS continua no vendedor anterior.`);
    const { data: notas } = await supabase.from('pdv_notas_fiscais').select('id').eq('venda_id', id).eq('status', 'autorizada').limit(1);
    if ((notas || []).length) avisos.push('A nota fiscal já autorizada não é alterada: nas informações complementares dela continua o nome do vendedor anterior.');
  } else {
    dia = String(atual.transacao_date || diaBrasil(atual.criado_em) || '').slice(0, 10) || null;
    if (atual.transacao_code) avisos.push(`Esta devolução também existe no TOTVS (nº ${atual.transacao_code}). Lá o vendedor não muda.`);
  }

  // 3) histórico
  const { error: eHist } = await supabase.from('hc_transacoes_vendedor_alteracoes').insert({
    transacao,
    fonte,
    transacao_id: id,
    empresa: atual.empresa ?? null,
    de_code: de.code,
    de_nome: de.nome,
    para_code: code,
    para_nome: nome,
    motivo: String(motivo || '').trim() || null,
    alterado_por: por,
    alterado_por_id: user?.id || null,
    alterado_em: agora,
  });
  if (eHist) avisos.push(`A troca foi feita, mas o histórico não foi gravado: ${eHist.message}`);

  // 4) números guardados dos painéis
  const guardados = await descartarGuardados(dia, avisos);

  console.log(`🔁 [hc/transacoes] ${transacao} (empresa ${atual.empresa}): vendedor ${de.code ?? '—'} ${de.nome || ''} → ${code} ${nome}, por ${por || '—'}${motivo ? ` — ${motivo}` : ''}`);
  return { transacao, empresa: atual.empresa ?? null, dia, de, para: { code, nome }, copias, guardados, avisos, por, em: agora };
}
