import { describe, it, expect } from '@jest/globals';
import { payloadDaSolicitacao, formaDoCp, tipoDocumentoDoCp, inclusaoDaSolicitacao, escolherFornecedor, podeRenumerarDocumento, documentoComSufixo, observacaoDaSolicitacao, STATUS_QUE_LIBERAM, ehPatrimonioProduto, motivoDeNaoLiberarSolicitacao, solicitacaoQuitada } from '../utils/solicitacaoCp.js';
import { validarInclusao } from '../services/hcContasPagar.js';

const HOJE = '2026-11-23';
const sol = (over = {}) => ({
  id: 'abc',
  tipo_solicitacao: 'pagamento',
  cd_empresa: 2,
  branch_cnpj: '17.177.680/0002-05',
  supplier_cpf_cnpj: '49.203.529/0001-00',
  supplier_name: 'BARAUNAS ENTREGAS',
  solicitante: 'Camila',
  setor: 'VAREJO',
  descricao: 'frete 08 volumes',
  observacao: null,
  duplicate_code: 4561,
  valor_total: 560,
  dt_emissao: '2026-11-20',
  dt_vencimento: '2026-11-28',
  dt_chegada: '2026-11-20',
  forma_pagamento: 'pix',
  chave_pix: 'paulo@exemplo.com',
  despesa_code: 6043,
  cost_center_code: 2,
  rateio_percentual: 100,
  payload_totvs: { branchCnpj: '17177680000205', supplierCpfCnpj: '49203529000100', duplicateCode: 1, installments: [{ installmentCode: 1, bearerCode: 1020, issueDate: '2026-11-01T00:00:00.000Z', dueDate: '2026-11-02T00:00:00.000Z', arrivalDate: '2026-11-20T00:00:00.000Z', duplicateValue: 1, expenses: [{ expenseCode: 6043, costCenterCode: 2, proratedPercentage: 100 }] }] },
  ...over,
});
const ctx = { empresa: 2, fornecedorCode: 777, hoje: HOJE };

describe('duplicata da solicitação', () => {
  it('pagamento: valem as colunas da solicitação (o que o financeiro editou), não o payload salvo', () => {
    const p = payloadDaSolicitacao(sol());
    expect(p).toMatchObject({ branchCnpj: '17177680000205', supplierCpfCnpj: '49203529000100', duplicateCode: 4561 });
    expect(p.installments).toHaveLength(1);
    expect(p.installments[0]).toMatchObject({ installmentCode: 1, bearerCode: 1020, issueDate: '2026-11-20', dueDate: '2026-11-28', duplicateValue: 560 });
  });

  it('parcelado: as parcelas salvas são a fonte', () => {
    const inst = [{ installmentCode: 1, dueDate: '2026-12-12T00:00:00.000Z', duplicateValue: 4672.5, expenses: [{ expenseCode: 1002, costCenterCode: 23, proratedPercentage: 100 }] }, { installmentCode: 2, dueDate: '2027-01-12T00:00:00.000Z', duplicateValue: 4672.5, expenses: [{ expenseCode: 1002, costCenterCode: 23, proratedPercentage: 100 }] }];
    const corpo = inclusaoDaSolicitacao(sol({ valor_total: 9345, payload_totvs: { installments: inst } }), ctx);
    expect(corpo.parcelas).toEqual([{ parcela: 1, vencimento: '2026-12-12', valor: 4672.5 }, { parcela: 2, vencimento: '2027-01-12', valor: 4672.5 }]);
  });

  it('RH e compras usam o payload salvo, com o código editado', () => {
    const p = payloadDaSolicitacao(sol({ tipo_solicitacao: 'rh', duplicate_code: '11092026' }));
    expect(p.duplicateCode).toBe(11092026);
    expect(p.installments[0].dueDate).toBe('2026-11-02T00:00:00.000Z');
  });
});

describe('inclusão no contas a pagar', () => {
  it('vira o corpo que o contas a pagar aceita', () => {
    const corpo = inclusaoDaSolicitacao(sol(), ctx);
    expect(corpo).toMatchObject({ empresa: 2, fornecedorCode: 777, documentoFiscal: '4561', tipoDocumento: 'duplicata', portadorCode: 1020, formaPagamento: 'pix', chavePix: 'paulo@exemplo.com', despesaCode: 6043, centroCustoCode: 2, previsao: 'real', emissao: '2026-11-20', entrada: '2026-11-20' });
    expect(corpo.parcelas).toEqual([{ parcela: 1, vencimento: '2026-11-28', valor: 560 }]);
    const dados = validarInclusao(corpo, HOJE);
    expect(dados.comum).toMatchObject({ empresa: 2, fornecedor_code: 777, documento_fiscal: '4561', forma_pagamento: 'pix', despesa_code: 6043, centro_custo_code: 2 });
    expect(dados.rateio).toEqual([{ despesa_code: 6043, centro_custo_code: 2, percentual: 100 }]);
  });

  it('rateio de várias linhas vai inteiro', () => {
    const expenses = [{ expenseCode: 3014, costCenterCode: 28, proratedPercentage: 27.14 }, { expenseCode: 3014, costCenterCode: 27, proratedPercentage: 20.9 }, { expenseCode: 3014, costCenterCode: 23, proratedPercentage: 51.96 }];
    const s = sol({ tipo_solicitacao: 'rh', document_type: 'Receipt', payload_totvs: { installments: [{ installmentCode: 1, bearerCode: 1020, issueDate: '2026-11-12T15:00:00.000Z', dueDate: '2026-11-19T15:00:00.000Z', duplicateValue: 1229.4, expenses }] } });
    const dados = validarInclusao(inclusaoDaSolicitacao(s, ctx), HOJE);
    expect(dados.rateio.map((r) => r.percentual)).toEqual([27.14, 20.9, 51.96]);
    expect(dados.comum.tipo_documento).toBe('recibo');
    expect(dados.comum.despesa_code).toBe(3014);
    expect(dados.comum.centro_custo_code).toBe(23); // a linha de maior percentual
  });

  it('sem código da duplicata, o documento fiscal fica vazio; previsão vira previsão', () => {
    const corpo = inclusaoDaSolicitacao(sol({ duplicate_code: null, prevision_type: 'Forecast', payload_totvs: null }), ctx);
    expect(corpo.documentoFiscal).toBe('');
    expect(corpo.previsao).toBe('previsao');
    expect(corpo.portadorCode).toBeNull();
    expect(validarInclusao(corpo, HOJE).comum.documento_fiscal).toBeNull();
  });

  it('sem despesa não vira duplicata', () => {
    expect(() => inclusaoDaSolicitacao(sol({ despesa_code: null, payload_totvs: null }), ctx)).toThrow(/despesa/);
  });

  it('a observação identifica a solicitação', () => {
    expect(observacaoDaSolicitacao(sol())).toBe('Solicitação Crosby 4561 · Camila (VAREJO) · frete 08 volumes');
  });
});

describe('cadastros', () => {
  it('forma de pagamento da solicitação → a do contas a pagar', () => {
    expect(formaDoCp('pix')).toBe('pix');
    expect(formaDoCp('PIX')).toBe('pix');
    expect(formaDoCp('Boleto')).toBe('boleto');
    expect(formaDoCp('debito_em_conta')).toBe('debito_automatico');
    expect(formaDoCp('credito_1x')).toBe('cartao');
    expect(formaDoCp('Crédito 1x')).toBe('cartao');
    expect(formaDoCp('Débito')).toBe('cartao');
    expect(formaDoCp('saldo_pagbank')).toBe('outro');
    expect(formaDoCp('')).toBeNull();
    expect(formaDoCp(null)).toBeNull();
  });

  it('tipo de documento', () => {
    expect(tipoDocumentoDoCp('Receipt')).toBe('recibo');
    expect(tipoDocumentoDoCp('Duplicate')).toBe('duplicata');
    expect(tipoDocumentoDoCp(null)).toBe('duplicata');
  });

  it('entre pessoas com o mesmo documento, escolhe o fornecedor ativo', () => {
    expect(escolherFornecedor([{ code: 1, is_fornecedor: false }, { code: 2, is_fornecedor: true, inativo: true }, { code: 3, is_fornecedor: true, inativo: false }]).code).toBe(3);
    expect(escolherFornecedor([{ code: 2, is_fornecedor: true, inativo: true }]).code).toBe(2);
    // sem a marca de fornecedor a pessoa do cadastro serve do mesmo jeito (a marca só desempata)
    expect(escolherFornecedor([{ code: 1, is_fornecedor: false }]).code).toBe(1);
    expect(escolherFornecedor([{ code: 1, is_fornecedor: false, inativo: true }, { code: 4, is_fornecedor: false }]).code).toBe(4);
    expect(escolherFornecedor([{ code: 5, is_fornecedor: false }, { code: 2, is_fornecedor: true, inativo: true }]).code).toBe(5);
    expect(escolherFornecedor([])).toBeNull();
  });
});

describe('liberar a solicitação para pagamento (Liberação do HeadCoach)', () => {
  it('libera a enviada ao contas a pagar e a de nota fiscal', () => {
    expect(STATUS_QUE_LIBERAM).toEqual(['enviado_totvs', 'nota_fiscal']);
    expect(motivoDeNaoLiberarSolicitacao(sol({ status: 'enviado_totvs' }))).toBeNull();
    expect(motivoDeNaoLiberarSolicitacao(sol({ status: 'nota_fiscal', tem_nota_fiscal: true }))).toBeNull();
  });

  it('não libera antes do envio, nem a rejeitada', () => {
    for (const status of ['pendente', 'aprovado_gestor', 'erro_envio', 'rejeitado', 'conciliado']) expect(motivoDeNaoLiberarSolicitacao(sol({ status }))).toMatch(/depois do envio/);
  });

  it('produto de patrimônio (já pago no cartão) nunca vai para a liberação', () => {
    expect(ehPatrimonioProduto({ setor: ' patrimonio ', produto_servico: 'produto' })).toBe(true);
    expect(ehPatrimonioProduto({ setor: 'PATRIMONIO', produto_servico: 'SERVICO' })).toBe(false);
    expect(motivoDeNaoLiberarSolicitacao(sol({ status: 'enviado_totvs', setor: 'PATRIMONIO', produto_servico: 'PRODUTO' }))).toMatch(/cartão/);
  });

  it('já liberada na tela antiga, já paga ou inexistente: não', () => {
    expect(motivoDeNaoLiberarSolicitacao(sol({ status: 'nota_fiscal', pagamento_liberacao_id: 'x' }))).toMatch(/antiga/);
    expect(motivoDeNaoLiberarSolicitacao(sol({ status: 'nota_fiscal', pago_em: '2026-11-20T12:00:00Z' }))).toMatch(/paga/);
    expect(motivoDeNaoLiberarSolicitacao(null)).toMatch(/não encontrada/);
  });

  it('a solicitação fica paga quando todas as duplicatas dela estão pagas (canceladas não contam)', () => {
    expect(solicitacaoQuitada([{ situacao: 'pago' }])).toBe(true);
    expect(solicitacaoQuitada([{ situacao: 'pago' }, { situacao: 'cancelado' }])).toBe(true);
    expect(solicitacaoQuitada([{ situacao: 'pago' }, { situacao: 'aberto' }])).toBe(false);
    expect(solicitacaoQuitada([{ situacao: 'cancelado' }])).toBe(false);
    expect(solicitacaoQuitada([])).toBe(false);
    expect(solicitacaoQuitada(null)).toBe(false);
  });
});

describe('número de controle repetido em pedidos diferentes', () => {
  it('sem nota fiscal o documento pode ganhar sufixo; com nota a trava continua', () => {
    expect(podeRenumerarDocumento({ tem_nota_fiscal: false })).toBe(true);
    expect(podeRenumerarDocumento({ tem_nota_fiscal: null })).toBe(true);
    expect(podeRenumerarDocumento({ tem_nota_fiscal: true })).toBe(false);
    expect(podeRenumerarDocumento({ tem_nota_fiscal: 'true' })).toBe(false);
  });
  it('o sufixo cabe nos 40 caracteres do documento', () => {
    expect(documentoComSufixo('2411202601', 2)).toBe('2411202601-2');
    expect(documentoComSufixo('1'.repeat(40), 3)).toHaveLength(40);
    expect(documentoComSufixo('1'.repeat(40), 3).endsWith('-3')).toBe(true);
  });
});
