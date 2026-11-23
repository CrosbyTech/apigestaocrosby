// =============================================================================
// Solicitação Crosby ↔ duplicata no HEADCOACH › CONTAS A PAGAR: o que acontece
// com a duplicata volta para a solicitação (Yago, 23/11/2026 — a liberação das
// solicitações passou a cair na Liberação de Pagamento do HeadCoach).
//
//   • liberação DEVOLVIDA ao contas a pagar → a solicitação deixa de estar
//     "liberada para pagamento" e pode ser liberada de novo;
//   • duplicata PAGA (pela Liberação ou direto no contas a pagar) → quando todas
//     as duplicatas da solicitação estão pagas, a solicitação fica paga.
//
// Nada daqui pode derrubar a baixa nem a devolução: se a solicitação não puder
// ser atualizada, fica só o aviso no log.
// =============================================================================
import supabase from '../config/supabase.js';
import { ORIGEM_SOLICITACAO, solicitacaoQuitada } from '../utils/solicitacaoCp.js';

const EM_ANDAMENTO = ['pendente', 'previsao', 'aprovado', 'incluido'];
const daSolicitacao = (t) => t?.origem === ORIGEM_SOLICITACAO && t.origem_ref;

async function titulosDaSolicitacao(ref) {
  const { data, error } = await supabase.from('hc_cp_titulos').select('id, situacao').eq('origem', ORIGEM_SOLICITACAO).eq('origem_ref', String(ref));
  if (error) throw new Error(error.message);
  return data || [];
}

/** Liberações devolvidas: a solicitação que ficou sem nenhuma liberação em andamento volta a poder ser liberada. */
export async function solicitacoesAposDevolucao(titulos) {
  const refs = [...new Set((titulos || []).filter(daSolicitacao).map((t) => String(t.origem_ref)))];
  for (const ref of refs) {
    try {
      const ids = (await titulosDaSolicitacao(ref)).filter((t) => t.situacao !== 'cancelado').map((t) => t.id);
      if (ids.length) {
        const { data: abertas, error } = await supabase.from('hc_cp_liberacoes').select('id').in('titulo_id', ids).in('status', EM_ANDAMENTO).limit(1);
        if (error) throw new Error(error.message);
        if (abertas?.length) continue; // outra parcela da mesma solicitação segue na liberação
      }
      const { error: e2 } = await supabase.from('solicitacoes_crosby').update({ liberado_pagamento_em: null, liberado_pagamento_por: null, liberado_pagamento_por_nome: null }).eq('id', ref).is('pagamento_liberacao_id', null).is('pago_em', null);
      if (e2) throw new Error(e2.message);
    } catch (e) {
      console.warn(`[solicitação ↔ liberação] não consegui soltar a solicitação ${ref}: ${e.message}`);
    }
  }
}

/** Duplicata quitada: com todas as duplicatas da solicitação pagas, a solicitação fica paga. */
export async function solicitacaoAposBaixa(titulo, { data, por = null, porId = null } = {}) {
  if (!daSolicitacao(titulo)) return;
  const ref = String(titulo.origem_ref);
  try {
    if (!solicitacaoQuitada(await titulosDaSolicitacao(ref))) return;
    const uuid = /^[0-9a-f-]{36}$/i.test(String(porId || '')) ? porId : null;
    const { error } = await supabase
      .from('solicitacoes_crosby')
      .update({ pago_em: `${data}T12:00:00-03:00`, pago_por: uuid, pago_por_nome: por ? `${por} · Contas a Pagar HeadCoach` : 'Contas a Pagar HeadCoach' })
      .eq('id', ref)
      .is('pago_em', null);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn(`[solicitação ↔ contas a pagar] não consegui marcar a solicitação ${ref} como paga: ${e.message}`);
  }
}
