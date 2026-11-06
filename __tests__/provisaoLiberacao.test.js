import { describe, it, expect } from '@jest/globals';
import { motivoForaDaProvisao } from '../jobs/provisao-liberacao.job.js';

const item = (cd, ds, forn = 'FORNECEDOR', extra = {}) => ({ cd_despesaitem: cd, ds_despesaitem: ds, nm_fornecedor: forn, dt_emissao: '2026-10-15', dt_vencimento: '2026-11-05', ...extra });

describe('motivoForaDaProvisao', () => {
  it.each([
    [item(5018, 'PARCELAMENTO ICMS'), 'imposto'],
    [item(3013, 'INSS'), 'imposto'],
    [item(3014, 'FGTS'), 'imposto'],
    [item(7011, 'ENCARGOS S/ EMPRESTIMOS E FINANCIAMENTOS'), 'banco'],
    [item(12001, 'EMPRESTIMOS', 'CAIXA ECONOMICA FEDERAL'), 'banco'],
    [item(9003, 'ALUGUEL DE MAQUINETAS', 'CREDI SHOP'), 'banco'],
    [item(3007, 'SEGURO DE VIDA', 'SICREDI RIO GRANDE DO NORTE'), 'banco'],
    [item(3040, 'PROLABORE - FABIO', 'CARTAO DE CREDITO - INTER  PF 5438'), 'banco'],
    [item(3041, 'PROLABORE - FELIPE', 'FELIPE FERREIRA DE LIMA AZEVEDO'), 'pró-labore'],
    [item(3009, 'PROLABORE', 'SOARES RIBEIRO ADVOGADOS ASSOCIADOS'), 'pró-labore'],
    [item(6031, 'PROPAGANDA E ANUNCIOS', 'FACEBOOK'), 'facebook'],
    [item(1002, 'COMPRA DE MATERIA PRIMA', 'RENAUXVIEW', { cd_fornecedor: 32136 }), 'renegociação'],
    [item(1002, 'COMPRA DE MATERIA PRIMA', 'LUNELLI', { cd_fornecedor: 6499 }), 'renegociação'],
    [item(1005, 'SERVICO DE INDUSTRIALIZACAO', 'DADA CORTE', { dt_emissao: '2026-06-10' }), 'produção antiga'],
  ])('%#: %j fica de fora', (it, motivo) => expect(motivoForaDaProvisao(it)).toBe(motivo));

  it.each([
    item(4001, 'ALUGUEIS DE IMOVEIS', 'ANGELA MARIA DE ANDRADE LIMA'),
    item(1002, 'COMPRA DE MATERIA PRIMA', 'AVIL TEXTIL LTDA'),
    item(1004, 'FRETE DE PRODUCAO', 'ARTHUR MALAQUIAS', { dt_emissao: '2026-06-01' }),
    item(6031, 'PROPAGANDA E ANUNCIOS', 'BVG UTILIDADES LTDA'),
    item(6010, 'ENERGIA ELETRICA', 'COMPANHIA ENERGETICA DO RIO GRANDE DO NORTE'),
    item(1002, 'COMPRA DE MATERIA PRIMA', 'ELIAN', { cd_fornecedor: 67813, dt_vencimento: '2026-03-24' }),
  ])('sobe: %j', (it) => expect(motivoForaDaProvisao(it)).toBeNull());
});
