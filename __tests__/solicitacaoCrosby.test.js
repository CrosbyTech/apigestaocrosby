import { describe, expect, it } from '@jest/globals';
import {
  validateSolicitacaoCrosby,
  buildTotvsPayloadFromSolicitacao,
} from '../utils/solicitacaoCrosbyValidator.js';

/**
 * Helpers para montar registros válidos por tipo, espelhando o que o
 * `FormularioSolicitacoes` envia para a tabela `solicitacoes_crosby`.
 */

const baseComum = (overrides = {}) => ({
  cd_empresa: 1,
  nm_empresa: 'CROSBY MATRIZ',
  solicitante: 'Maria Teste',
  solicitante_email: 'maria@crosby.test',
  setor: 'FINANCEIRO',
  nivel_urgencia: 'normal',
  descricao: 'Teste de solicitação automatizado',
  observacao: null,
  status: 'pendente',
  branch_cnpj: '12345678000199',
  supplier_cpf_cnpj: null,
  supplier_name: null,
  forma_pagamento: null,
  comprovante_url: null,
  comprovante_gestor_url: null,
  comprovante_fabio_url: null,
  link_exemplo: null,
  imagens_exemplo_urls: [],
  contatos_prestadores: [],
  despesa_code: null,
  marca_modelo: null,
  recomendacao_fornecedores: null,
  ...overrides,
});

const fakeUrl = (sufixo) =>
  `https://supabase.test/storage/v1/object/public/solicitacoes-crosby/${sufixo}`;

const solicitacaoPagamento = (overrides = {}) =>
  baseComum({
    tipo_solicitacao: 'pagamento',
    supplier_cpf_cnpj: '11222333000181',
    supplier_name: 'FORNECEDOR XYZ LTDA',
    forma_pagamento: 'pix',
    dt_vencimento: '2099-12-31',
    despesa_code: 1100,
    comprovante_gestor_url: fakeUrl('comprovantes-gestor/x.pdf'),
    comprovante_fabio_url: fakeUrl('comprovantes-fabio/y.pdf'),
    ...overrides,
  });

const solicitacaoReembolso = (overrides = {}) =>
  baseComum({
    tipo_solicitacao: 'reembolso',
    supplier_cpf_cnpj: '12345678901',
    supplier_name: 'JOAO SOLICITANTE',
    forma_pagamento: 'debito',
    dt_vencimento: '2099-12-31',
    despesa_code: 1234,
    comprovante_gestor_url: fakeUrl('comprovantes-gestor/g.pdf'),
    comprovante_fabio_url: fakeUrl('comprovantes-fabio/f.pdf'),
    comprovante_url: fakeUrl('comprovantes/pgto.pdf'),
    ...overrides,
  });

const solicitacaoCompra = (overrides = {}) =>
  baseComum({
    tipo_solicitacao: 'compra',
    descricao: '1 cadeira ergonômica preta para sala de reunião',
    marca_modelo: 'ThunderX3 EC3',
    ...overrides,
  });

const solicitacaoManutencao = (overrides = {}) =>
  baseComum({
    tipo_solicitacao: 'manutencao',
    descricao: 'Manutenção preventiva no ar-condicionado da loja',
    marca_modelo: 'Springer Midea 12000 BTUs',
    recomendacao_fornecedores:
      'Refrigeração Sul (11) 99999-0001 — atende a região',
    ...overrides,
  });

const solicitacaoRH = (overrides = {}) =>
  baseComum({
    tipo_solicitacao: 'rh',
    supplier_cpf_cnpj: '12345678000100',
    supplier_name: 'FOLHA DE PAGAMENTO LTDA',
    forma_pagamento: 'boleto',
    duplicate_code: 99001,
    valor_total: 1500.0,
    payload_totvs: {
      branchCnpj: '12345678000199',
      supplierCpfCnpj: '12345678000100',
      duplicateCode: 99001,
      installments: [
        {
          installmentCode: 1,
          bearerCode: 1,
          issueDate: '2099-01-01T00:00:00.000Z',
          dueDate: '2099-12-31T00:00:00.000Z',
          arrivalDate: '2099-01-01T00:00:00.000Z',
          duplicateValue: 1500.0,
          expenses: [
            {
              expenseCode: 1100,
              costCenterCode: 1,
              proratedPercentage: 100,
            },
          ],
          observations: [{ observation: 'Pagamento RH — teste unitário' }],
        },
      ],
    },
    ...overrides,
  });

describe('Solicitação Crosby — validação por tipo', () => {
  describe('pagamento', () => {
    it('aceita um pagamento totalmente preenchido', () => {
      const result = validateSolicitacaoCrosby(solicitacaoPagamento());
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('rejeita pagamento sem comprovante do gestor', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoPagamento({ comprovante_gestor_url: null }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/comprovante_gestor_url/);
    });

    it('rejeita pagamento sem comprovante do Fábio', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoPagamento({ comprovante_fabio_url: null }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/comprovante_fabio_url/);
    });

    it('rejeita pagamento sem despesa_code', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoPagamento({ despesa_code: null }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/despesa_code/);
    });

    it('rejeita pagamento sem fornecedor', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoPagamento({
          supplier_cpf_cnpj: null,
          supplier_name: null,
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/supplier_cpf_cnpj/);
    });
  });

  describe('reembolso', () => {
    it('aceita um reembolso totalmente preenchido', () => {
      const result = validateSolicitacaoCrosby(solicitacaoReembolso());
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('exige comprovante de pagamento adicional', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoReembolso({ comprovante_url: null }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/comprovante_url/);
    });
  });

  describe('compra', () => {
    it('aceita uma compra sem fornecedor nem forma de pagamento', () => {
      const result = validateSolicitacaoCrosby(solicitacaoCompra());
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('aceita uma compra mesmo sem marca/modelo', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoCompra({ marca_modelo: null }),
      );
      expect(result.valid).toBe(true);
    });

    it('rejeita compra que venha com fornecedor TOTVS', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoCompra({ supplier_cpf_cnpj: '12345678000199' }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/supplier_cpf_cnpj/);
    });

    it('rejeita compra que venha com payload_totvs', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoCompra({ payload_totvs: { foo: 'bar' } }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/payload_totvs/);
    });

    it('rejeita compra sem descrição dos produtos', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoCompra({ descricao: '' }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/descricao/);
    });
  });

  describe('manutencao', () => {
    it('aceita manutenção com serviço descrito e recomendações opcionais', () => {
      const result = validateSolicitacaoCrosby(solicitacaoManutencao());
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('aceita manutenção sem recomendação de fornecedores', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoManutencao({ recomendacao_fornecedores: null }),
      );
      expect(result.valid).toBe(true);
    });

    it('rejeita manutenção sem descrição do serviço', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoManutencao({ descricao: '' }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/descricao/);
    });
  });

  describe('rh', () => {
    it('aceita um RH com parcelas válidas', () => {
      const result = validateSolicitacaoCrosby(solicitacaoRH());
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('rejeita RH sem duplicate_code', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoRH({ duplicate_code: null }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/duplicate_code/);
    });

    it('rejeita RH com duplicate_code de mais de 10 dígitos', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoRH({ duplicate_code: 12345678901 }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/10/);
    });

    it('rejeita RH sem installments', () => {
      const result = validateSolicitacaoCrosby(
        solicitacaoRH({ payload_totvs: { installments: [] } }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/installments/);
    });
  });
});

describe('buildTotvsPayloadFromSolicitacao — geração de payload TOTVS', () => {
  it('pagamento: gera rascunho de duplicata com 1 installment e despesa 100%', () => {
    const payload = buildTotvsPayloadFromSolicitacao(solicitacaoPagamento());
    expect(payload).not.toBeNull();
    expect(payload.branchCnpj).toBe('12345678000199');
    expect(payload.supplierCpfCnpj).toBe('11222333000181');
    expect(payload.installments).toHaveLength(1);
    expect(payload.installments[0].expenses).toHaveLength(1);
    expect(payload.installments[0].expenses[0].expenseCode).toBe(1100);
    expect(payload.installments[0].expenses[0].proratedPercentage).toBe(100);
    // O financeiro completará os campos pendentes:
    expect(payload.installments[0].bearerCode).toBeNull();
    expect(payload.duplicateCode).toBeNull();
  });

  it('reembolso: também gera rascunho de duplicata', () => {
    const payload = buildTotvsPayloadFromSolicitacao(solicitacaoReembolso());
    expect(payload).not.toBeNull();
    expect(payload.installments[0].expenses[0].expenseCode).toBe(1234);
  });

  it('compra: NÃO gera payload TOTVS', () => {
    expect(buildTotvsPayloadFromSolicitacao(solicitacaoCompra())).toBeNull();
  });

  it('manutencao: NÃO gera payload TOTVS', () => {
    expect(
      buildTotvsPayloadFromSolicitacao(solicitacaoManutencao()),
    ).toBeNull();
  });

  it('rh: reusa o payload_totvs já preenchido pelo formulário antigo', () => {
    const sol = solicitacaoRH();
    const payload = buildTotvsPayloadFromSolicitacao(sol);
    expect(payload).toBe(sol.payload_totvs);
    expect(payload.installments).toHaveLength(1);
    expect(payload.duplicateCode).toBe(99001);
  });
});
