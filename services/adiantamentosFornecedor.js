// ============================================================
// ADIANTAMENTO A FORNECEDOR (Titia/Niziany, 10/11/2026)
//
// Na Conciliação, o botão Justificar ganhou o tipo "Adiantamento a
// fornecedor": pagamento feito a um fornecedor que ainda não emitiu a nota
// fiscal. Fica gravado como conciliação MANUAL com
//   referencia = { tipo: 'ADIANTAMENTO_FORNECEDOR', fornecedor, fornecedorDoc, ... }
// e esta lista junta todos eles (para cobrar/baixar a NF depois).
// ============================================================
import supabase from '../config/supabase.js';

export const TIPO_ADIANTAMENTO = 'ADIANTAMENTO_FORNECEDOR';

export async function listarAdiantamentos({ de = null, ate = null, escopo = 'crosby' } = {}) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from('fluxo_caixa_conciliacoes')
      .select('id,conta_id,lancamento_id,data,valor,origem,referencia,justificativa,usuario,criado_em')
      .eq('referencia->>tipo', TIPO_ADIANTAMENTO)
      .order('data', { ascending: false })
      .range(from, from + 999);
    if (de) q = q.gte('data', de);
    if (ate) q = q.lte('data', ate);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const contaIds = [...new Set(out.map((c) => c.conta_id))];
  const { data: contas } = contaIds.length ? await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,titular_nome,titular_cnpj,escopo').in('id', contaIds) : { data: [] };
  const contaDe = new Map((contas || []).map((c) => [c.id, c]));
  return out
    .filter((c) => (contaDe.get(c.conta_id)?.escopo || 'crosby') === escopo)
    .map((c) => {
      const conta = contaDe.get(c.conta_id) || {};
      return {
        id: c.id,
        data: c.data,
        valor: Math.abs(Number(c.valor)),
        fornecedor: c.referencia?.fornecedor || null,
        fornecedorDoc: c.referencia?.fornecedorDoc || null,
        observacao: c.referencia?.observacao || null,
        justificativa: c.justificativa,
        banco: conta.banco || null,
        conta: conta.apelido || null,
        empresa: conta.titular_nome || null,
        cnpjEmpresa: conta.titular_cnpj || null,
        usuario: c.usuario || null,
        marcadoEm: c.criado_em,
      };
    });
}

export default { listarAdiantamentos, TIPO_ADIANTAMENTO };
