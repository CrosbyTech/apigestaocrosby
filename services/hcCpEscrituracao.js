// =============================================================================
// HEADCOACH › CONTAS A PAGAR — marca de ESCRITURAÇÃO da duplicata.
// Pedido do Yago (25/11/2026): a solicitação com nota fiscal não fica mais
// travada esperando a escrituração. Ela vai para o contas a pagar, a duplicata
// mostra "NÃO ESCRITURADA" e o financeiro troca o status na tela.
//
//   • a marca nasce com a duplicata da solicitação (services/solicitacaoContasPagar.js);
//   • quando o chamado de escrituração é concluído (a tela das Solicitações grava
//     nf_escriturado_em), a duplicata que ninguém mexeu à mão vira ESCRITURADA
//     sozinha (sincronizarEscrituracaoDasSolicitacoes);
//   • trocar à mão também troca na solicitação (escriturada / não escriturada).
// =============================================================================
import supabase from '../config/supabase.js';
import { CpError, empresasPermitidas } from './hcContasPagar.js';
import { ORIGEM_SOLICITACAO } from '../utils/solicitacaoCp.js';
import { ESCRITURACOES, escrituracaoPedida, separarParaEscrituracao } from '../utils/hcCpEscrituracao.js';

const quem = (user) => user?.name || user?.email || null;
const POR_CHAMADO = 'Chamado de escrituração (Dryland)';

async function q(promessa) {
  const { data, error } = await promessa;
  if (error) throw new CpError(`Banco de dados: ${error.message}`, 'DB_ERROR', 500);
  return data;
}
const emLotes = (lista, n = 200) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));

/**
 * Troca o status de escrituração das duplicatas escolhidas.
 * b: { ids: [id da duplicata], escrituracao: 'pendente' | 'escriturada' | null (tira a marca) }
 * @returns {{ alteradas, escrituracao, ignoradas: [{ id, rotulo, motivo }] }}
 */
export async function mudarEscrituracao(user, b = {}) {
  const { codes } = await empresasPermitidas(user); // só o financeiro, e só das empresas dele
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n) => n > 0))];
  if (!ids.length) throw new CpError('Selecione ao menos uma duplicata');
  let novo;
  try {
    novo = escrituracaoPedida(b.escrituracao);
  } catch (e) {
    throw new CpError(e.message, 'ESCRITURACAO');
  }

  const titulos = [];
  for (const lote of emLotes(ids)) titulos.push(...((await q(supabase.from('hc_cp_titulos').select('id, empresa, situacao, escrituracao, fornecedor_nome, duplicata, parcela, origem, origem_ref').in('id', lote))) || []));
  const { mudam, ignoradas } = separarParaEscrituracao(titulos, new Set(codes), novo);
  const achados = new Set(titulos.map((t) => Number(t.id)));
  for (const id of ids) if (!achados.has(id)) ignoradas.push({ id, rotulo: `duplicata ${id}`, motivo: 'não encontrada' });
  if (!mudam.length) return { alteradas: 0, escrituracao: novo, ignoradas };

  const agora = new Date().toISOString();
  const por = quem(user);
  let alteradas = 0;
  for (const lote of emLotes(mudam.map((t) => t.id))) {
    const feitas = await q(supabase.from('hc_cp_titulos').update({ escrituracao: novo, escrituracao_em: agora, escrituracao_por: por, atualizado_por: por, atualizado_em: agora }).in('id', lote).neq('situacao', 'cancelado').select('id'));
    alteradas += (feitas || []).length;
  }

  // a solicitação de onde a duplicata veio acompanha: escriturada aqui → escriturada lá; voltou para
  // não escriturada → lá também (se o chamado de escrituração já foi concluído, a tela das Solicitações
  // marca de novo — a duplicata fica como o financeiro deixou)
  const refs = [...new Set(mudam.filter((t) => t.origem === ORIGEM_SOLICITACAO && t.origem_ref).map((t) => String(t.origem_ref)))];
  for (const lote of emLotes(refs)) {
    const base = supabase.from('solicitacoes_crosby').update({ nf_escriturado_em: novo === 'escriturada' ? agora : null }).in('id', lote).eq('tem_nota_fiscal', true);
    const { error } = await (novo === 'escriturada' ? base.is('nf_escriturado_em', null) : base.not('nf_escriturado_em', 'is', null));
    if (error) console.warn(`[escrituração] não consegui atualizar a(s) solicitação(ões) ${lote.join(', ')}: ${error.message}`);
  }
  console.log(`🧾 [contas a pagar · escrituração] ${alteradas} duplicata(s) → ${novo ? ESCRITURACOES[novo] : 'sem marca'} · ${por}`);
  return { alteradas, escrituracao: novo, ignoradas };
}

/**
 * Chamado de escrituração concluído → a duplicata da solicitação vira ESCRITURADA.
 * Só mexe na duplicata que ainda está com a marca original (ninguém trocou à mão).
 * Nunca derruba quem chamou: se falhar, fica só o aviso no log.
 * @returns {number} quantas duplicatas mudaram
 */
export async function sincronizarEscrituracaoDasSolicitacoes() {
  try {
    const pendentes = await q(supabase.from('hc_cp_titulos').select('id, origem_ref').eq('origem', ORIGEM_SOLICITACAO).eq('escrituracao', 'pendente').is('escrituracao_por', null).neq('situacao', 'cancelado'));
    const refs = [...new Set((pendentes || []).map((t) => String(t.origem_ref || '')).filter(Boolean))];
    if (!refs.length) return 0;
    let mudaram = 0;
    for (const lote of emLotes(refs)) {
      const escrituradas = await q(supabase.from('solicitacoes_crosby').select('id, nf_escriturado_em').in('id', lote).not('nf_escriturado_em', 'is', null));
      for (const s of escrituradas || []) {
        const feitas = await q(supabase.from('hc_cp_titulos').update({ escrituracao: 'escriturada', escrituracao_em: s.nf_escriturado_em, escrituracao_por: POR_CHAMADO }).eq('origem', ORIGEM_SOLICITACAO).eq('origem_ref', String(s.id)).eq('escrituracao', 'pendente').is('escrituracao_por', null).select('id'));
        mudaram += (feitas || []).length;
      }
    }
    if (mudaram) console.log(`🧾 [contas a pagar · escrituração] ${mudaram} duplicata(s) escriturada(s) pelo chamado concluído`);
    return mudaram;
  } catch (e) {
    console.warn(`[escrituração] não consegui conferir os chamados concluídos: ${e.message}`);
    return 0;
  }
}

export default { mudarEscrituracao, sincronizarEscrituracaoDasSolicitacoes };
