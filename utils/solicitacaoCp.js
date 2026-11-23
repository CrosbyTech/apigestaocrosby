// Regras puras (sem rede) do envio de uma Solicitação Crosby para o
// HEADCOACH › CONTAS A PAGAR (no lugar do antigo "Enviar ao TOTVS").
//
// A solicitação guarda os dados da duplicata em colunas próprias e em
// payload_totvs (parcelas, portador, rateio). Daqui sai o corpo que
// validarInclusao (services/hcContasPagar.js) entende.

const dig = (v) => String(v ?? '').replace(/\D+/g, '');
const dia = (v) => (v ? String(v).slice(0, 10) : null);

export const ORIGEM_SOLICITACAO = 'solicitacao-crosby';
export const DESTINO_HC = 'contas-pagar-headcoach';

/** Situações da solicitação em que o financeiro pode mandar para o contas a pagar. */
export const STATUS_QUE_ENVIAM = ['aprovado_gestor', 'aprovado_financeiro', 'erro_envio', 'conciliado'];

/**
 * A duplicata da solicitação (mesma regra da tela): pagamento/reembolso montam
 * pelas colunas; os outros tipos usam o que foi salvo. Parcelado: vale o salvo.
 */
export function payloadDaSolicitacao(sol) {
  const salvo = sol.payload_totvs || {};
  const lista = Array.isArray(salvo.installments) ? salvo.installments : [];
  const duplicateCode = sol.duplicate_code != null ? Number.parseInt(sol.duplicate_code, 10) : (salvo.duplicateCode ?? null);
  const tipo = sol.tipo_solicitacao;
  if (tipo !== 'pagamento' && tipo !== 'reembolso') {
    return { branchCnpj: dig(salvo.branchCnpj) || dig(sol.branch_cnpj), supplierCpfCnpj: dig(salvo.supplierCpfCnpj) || dig(sol.supplier_cpf_cnpj), ...salvo, duplicateCode, installments: lista };
  }
  const base = { branchCnpj: dig(sol.branch_cnpj) || dig(salvo.branchCnpj), supplierCpfCnpj: dig(sol.supplier_cpf_cnpj) || dig(salvo.supplierCpfCnpj), duplicateCode };
  if (lista.length > 1) return { ...base, installments: lista };
  const s = lista[0];
  return {
    ...base,
    installments: [
      {
        installmentCode: s?.installmentCode ?? 1,
        bearerCode: s?.bearerCode ?? null,
        issueDate: sol.dt_emissao || s?.issueDate || null,
        dueDate: sol.dt_vencimento || s?.dueDate || null,
        arrivalDate: s?.arrivalDate || null,
        duplicateValue: sol.valor_total ?? s?.duplicateValue ?? null,
        expenses: s?.expenses?.length ? s.expenses : sol.despesa_code ? [{ expenseCode: sol.despesa_code, costCenterCode: sol.cost_center_code ?? null, proratedPercentage: sol.rateio_percentual ?? 100 }] : [],
      },
    ],
  };
}

/** Forma de pagamento da solicitação ("pix", "Boleto", "credito_1x", "Saldo PagBank"…) → a do contas a pagar. */
export function formaDoCp(forma) {
  const f = String(forma || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s_]+/g, ' ')
    .trim();
  if (!f) return null;
  if (f === 'pix') return 'pix';
  if (f === 'boleto') return 'boleto';
  if (f.startsWith('debito em conta') || f === 'debito automatico') return 'debito_automatico';
  if (f.startsWith('credito') || f === 'debito' || f.startsWith('cartao')) return 'cartao';
  if (f.startsWith('transfer') || f === 'ted') return 'transferencia';
  if (f === 'dinheiro') return 'dinheiro';
  return 'outro'; // saldo PagBank e o que mais aparecer
}

const TIPOS_DOC = { Duplicate: 'duplicata', Receipt: 'recibo', Invoice: 'nota_fiscal', InvoicePrint: 'nota_fiscal', BankSlip: 'boleto' };
export const tipoDocumentoDoCp = (t) => TIPOS_DOC[t] || 'duplicata';

/** Texto que identifica a solicitação dentro da duplicata. */
export function observacaoDaSolicitacao(sol) {
  return [`Solicitação Crosby${sol.duplicate_code ? ` ${sol.duplicate_code}` : ''}`, sol.solicitante ? `${sol.solicitante}${sol.setor ? ` (${sol.setor})` : ''}` : sol.setor || null, sol.descricao ? String(sol.descricao).trim() : null, sol.observacao ? String(sol.observacao).trim() : null]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 2000);
}

/**
 * Corpo da inclusão no contas a pagar (o que validarInclusao recebe).
 * @param ctx { empresa, fornecedorCode, hoje }
 * @throws Error com mensagem para o usuário quando falta dado na solicitação
 */
export function inclusaoDaSolicitacao(sol, { empresa, fornecedorCode, hoje }) {
  const p = payloadDaSolicitacao(sol);
  const parcelas = (p.installments || []).filter(Boolean);
  if (!parcelas.length) throw new Error('A solicitação não tem valor e vencimento para virar duplicata');
  const primeira = parcelas[0];
  const despesas = (primeira.expenses || []).filter((e) => Number(e?.expenseCode) > 0);
  if (!despesas.length) throw new Error('A solicitação está sem despesa; edite a solicitação e escolha a despesa');
  const emissao = dia(sol.dt_emissao) || dia(primeira.issueDate) || hoje;
  const umaLinha = despesas.length === 1;
  return {
    empresa,
    fornecedorCode,
    documentoFiscal: p.duplicateCode != null && !Number.isNaN(p.duplicateCode) ? String(p.duplicateCode) : '',
    tipoDocumento: tipoDocumentoDoCp(sol.document_type || primeira.document),
    portadorCode: primeira.bearerCode || null,
    formaPagamento: formaDoCp(sol.forma_pagamento),
    chavePix: sol.chave_pix || null,
    codigoBarras: sol.codigo_barras || null,
    // uma despesa só pode vir sem centro de custo (solicitação antiga); rateio de várias linhas exige o centro em todas
    ...(umaLinha ? { despesaCode: despesas[0].expenseCode, centroCustoCode: despesas[0].costCenterCode || null } : { rateio: despesas.map((e) => ({ despesaCode: e.expenseCode, centroCustoCode: e.costCenterCode || null, percentual: Number(e.proratedPercentage) })) }),
    previsao: (sol.prevision_type || primeira.prevision) === 'Forecast' ? 'previsao' : 'real',
    emissao,
    entrada: dia(sol.dt_chegada) || dia(primeira.arrivalDate) || hoje,
    observacao: observacaoDaSolicitacao(sol),
    parcelas: parcelas.map((i, n) => ({ parcela: Number(i.installmentCode) >= 1 ? Number(i.installmentCode) : n + 1, vencimento: parcelas.length === 1 ? dia(sol.dt_vencimento) || dia(i.dueDate) : dia(i.dueDate), valor: Number(i.duplicateValue ?? (parcelas.length === 1 ? sol.valor_total : 0)) })),
  };
}

/** Entre as pessoas com o mesmo CPF/CNPJ, a que é fornecedor ativo. */
export function escolherFornecedor(pessoas) {
  const lista = pessoas || [];
  return lista.find((p) => p.is_fornecedor && !p.inativo) || lista.find((p) => p.is_fornecedor) || null;
}
