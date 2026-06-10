/**
 * Validador e montador de payload TOTVS para solicitações Crosby.
 *
 * Centraliza, fora do handler HTTP, a forma esperada do registro que vai para
 * a tabela `solicitacoes_crosby` e do payload `CreatedDuplicateCommand` que
 * será enviado ao endpoint TOTVS `POST /accounts-payable/v2/duplicates`.
 *
 * Existe principalmente para permitir testes unitários do fluxo de cada tipo
 * de solicitação (pagamento, reembolso, compra, manutenção, rh).
 *
 * Tipos aceitos: `pagamento`, `reembolso`, `compra`, `manutencao`, `rh`.
 *
 * Regras (espelham `FormularioSolicitacoes.jsx`):
 *  - Comuns a todos: cd_empresa, branch_cnpj, solicitante, setor, descricao,
 *                    tipo_solicitacao
 *  - pagamento/reembolso: supplier_cpf_cnpj, supplier_name, forma_pagamento,
 *                         dt_vencimento, despesa_code,
 *                         comprovante_gestor_url, comprovante_fabio_url
 *                         (reembolso ainda exige comprovante_url do pagamento)
 *  - compra:              descrição dos produtos (em `descricao`), marca_modelo opcional
 *  - manutencao:          descrição do serviço (em `descricao`), marca_modelo +
 *                         recomendacao_fornecedores opcionais
 *  - rh:                  supplier_cpf_cnpj, supplier_name, forma_pagamento,
 *                         duplicate_code, payload_totvs com installments[]
 *
 * O payload TOTVS só é gerado para tipos que originam duplicata
 * (pagamento, reembolso e rh). Compra/manutenção seguem outro fluxo
 * (workflow interno) e não geram payload_totvs.
 */

const TIPOS_VALIDOS = new Set([
  'pagamento',
  'reembolso',
  'compra',
  'manutencao',
  'rh',
]);

const TIPOS_COM_FORNECEDOR = new Set(['pagamento', 'reembolso', 'rh']);
const TIPOS_PAGAMENTO_SIMPLES = new Set(['pagamento', 'reembolso']);
const TIPOS_PRODUTOS_SERVICOS = new Set(['compra', 'manutencao']);

const FORMAS_PAGAMENTO_VALIDAS = new Set([
  'pix',
  'debito',
  'boleto',
  ...Array.from({ length: 12 }, (_, i) => `credito_${i + 1}x`),
]);

const onlyDigits = (v) => String(v ?? '').replace(/\D+/g, '');

const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

const isISODateString = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s);

/**
 * Valida um registro do tipo `solicitacoes_crosby` montado pelo formulário.
 * Retorna { valid: boolean, errors: string[] }.
 */
export function validateSolicitacaoCrosby(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Payload da solicitação ausente.'] };
  }

  if (!TIPOS_VALIDOS.has(data.tipo_solicitacao)) {
    errors.push(`tipo_solicitacao inválido: ${data.tipo_solicitacao}`);
  }
  if (!isFiniteNumber(data.cd_empresa) || data.cd_empresa <= 0) {
    errors.push('cd_empresa deve ser um inteiro positivo.');
  }
  const branch = onlyDigits(data.branch_cnpj);
  if (branch.length !== 14) {
    errors.push('branch_cnpj deve ter 14 dígitos.');
  }
  if (typeof data.solicitante !== 'string' || !data.solicitante.trim()) {
    errors.push('solicitante é obrigatório.');
  }
  if (typeof data.setor !== 'string' || !data.setor.trim()) {
    errors.push('setor é obrigatório.');
  }
  if (typeof data.descricao !== 'string' || !data.descricao.trim()) {
    errors.push('descricao é obrigatória.');
  }

  const tipo = data.tipo_solicitacao;

  if (TIPOS_COM_FORNECEDOR.has(tipo)) {
    const sup = onlyDigits(data.supplier_cpf_cnpj);
    if (sup.length !== 11 && sup.length !== 14) {
      errors.push('supplier_cpf_cnpj deve ter 11 (CPF) ou 14 (CNPJ) dígitos.');
    }
    if (typeof data.supplier_name !== 'string' || !data.supplier_name.trim()) {
      errors.push('supplier_name é obrigatório para esse tipo.');
    }
    if (!FORMAS_PAGAMENTO_VALIDAS.has(data.forma_pagamento)) {
      errors.push(`forma_pagamento inválida: ${data.forma_pagamento}`);
    }
  } else if (TIPOS_PRODUTOS_SERVICOS.has(tipo)) {
    // Compra / manutenção NÃO devem incluir fornecedor TOTVS nem forma_pagamento.
    if (data.supplier_cpf_cnpj) {
      errors.push(`${tipo} não deve trazer supplier_cpf_cnpj.`);
    }
    if (data.forma_pagamento) {
      errors.push(`${tipo} não deve trazer forma_pagamento.`);
    }
    if (data.payload_totvs) {
      errors.push(
        `${tipo} não deve gerar payload_totvs no momento da criação.`,
      );
    }
  }

  if (TIPOS_PAGAMENTO_SIMPLES.has(tipo)) {
    if (!isISODateString(data.dt_vencimento)) {
      errors.push('dt_vencimento deve ser uma data ISO (YYYY-MM-DD).');
    }
    if (!isFiniteNumber(data.despesa_code) || data.despesa_code <= 0) {
      errors.push('despesa_code é obrigatório.');
    }
    if (
      typeof data.comprovante_gestor_url !== 'string' ||
      !data.comprovante_gestor_url
    ) {
      errors.push('comprovante_gestor_url é obrigatório.');
    }
    if (
      typeof data.comprovante_fabio_url !== 'string' ||
      !data.comprovante_fabio_url
    ) {
      errors.push('comprovante_fabio_url é obrigatório.');
    }
    if (tipo === 'reembolso' && !data.comprovante_url) {
      errors.push('comprovante_url (pagamento) é obrigatório para reembolso.');
    }
  }

  if (tipo === 'rh') {
    if (!Number.isInteger(data.duplicate_code) || data.duplicate_code <= 0) {
      errors.push('duplicate_code é obrigatório para RH.');
    }
    if (String(data.duplicate_code).length > 10) {
      errors.push('duplicate_code excede 10 dígitos.');
    }
    if (
      !data.payload_totvs ||
      !Array.isArray(data.payload_totvs.installments) ||
      data.payload_totvs.installments.length === 0
    ) {
      errors.push('RH precisa de payload_totvs.installments com 1+ parcela.');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Monta o payload TOTVS (CreatedDuplicateCommand) a partir do registro de
 * solicitação. Apenas para tipos que originam duplicata. Para os fluxos
 * simplificados de pagamento/reembolso, o financeiro deve completar parcelas
 * e portador antes do envio definitivo.
 *
 * - rh:              usa data.payload_totvs (já populado pelo formulário antigo)
 * - pagamento/reembolso: gera um "rascunho" com 1 installment pendente de
 *                       preenchimento (bearerCode/issueDate/arrivalDate),
 *                       contendo despesa única a 100% e duplicateCode null.
 *                       O financeiro completa antes de enviar ao TOTVS.
 * - compra/manutencao: retorna null (não geram duplicata).
 */
export function buildTotvsPayloadFromSolicitacao(data) {
  if (!data || typeof data !== 'object') return null;
  const tipo = data.tipo_solicitacao;

  if (tipo === 'rh') {
    return data.payload_totvs || null;
  }

  if (!TIPOS_PAGAMENTO_SIMPLES.has(tipo)) {
    return null;
  }

  return {
    branchCnpj: onlyDigits(data.branch_cnpj),
    supplierCpfCnpj: onlyDigits(data.supplier_cpf_cnpj),
    duplicateCode: data.duplicate_code ?? null,
    installments: [
      {
        installmentCode: 1,
        bearerCode: data.bearer_code ?? null,
        issueDate: null,
        dueDate: data.dt_vencimento || null,
        arrivalDate: null,
        duplicateValue: data.valor_total ?? null,
        expenses: data.despesa_code
          ? [
              {
                expenseCode: data.despesa_code,
                costCenterCode: data.cost_center_code ?? null,
                proratedPercentage: 100,
              },
            ]
          : [],
        observations: data.descricao
          ? [{ observation: String(data.descricao).slice(0, 80) }]
          : [],
      },
    ],
  };
}

export const _internal = {
  TIPOS_VALIDOS,
  TIPOS_COM_FORNECEDOR,
  TIPOS_PAGAMENTO_SIMPLES,
  TIPOS_PRODUTOS_SERVICOS,
  FORMAS_PAGAMENTO_VALIDAS,
  onlyDigits,
};
