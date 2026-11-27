import { describe, test, expect } from '@jest/globals';
import {
  bandeiraCanonica,
  diaLocal,
  janelaUtc,
  ehDaStone,
  ehTituloHeadcoach,
  idDoPagamento,
  tituloDoPagamento,
  semEspelhadasNoTotvs,
} from '../utils/hcCartoesPdv.js';
import { bater } from '../services/stoneBatimento.js';

const venda = (extra = {}) => ({
  id: 812,
  empresa: 95,
  status: 'autorizada',
  origem: 'pdv',
  cliente_code: 1234,
  cliente_nome: 'MARIA DA SILVA',
  total: 399.9,
  criado_em: '2026-11-21T01:30:00.000Z', // 22h30 do dia 20 em Natal
  data_caixa: null,
  totvs_transacao_code: null,
  ...extra,
});
const pagamento = (extra = {}) => ({
  id: 4501,
  venda_id: 812,
  forma: 'credito',
  valor: 399.9,
  troco: 0,
  parcelas: 3,
  bandeira: 'mastercard',
  nsu: '43162009951516',
  autorizacao: '081779',
  adquirente_cnpj: null,
  cartao_totvs: null,
  ...extra,
});
const stone = (extra = {}) => ({
  nsu: '43162009951516',
  codAutorizacao: '081779',
  valorBruto: 399.9,
  valorLiquido: 390,
  taxa: 9.9,
  dataVenda: '2026-11-20',
  dataCaptura: '2026-11-20T22:30:00',
  parcelas: 3,
  bandeira: 'Mastercard',
  tipoConta: 'Crédito',
  cancelada: false,
  ...extra,
});

describe('vendas em cartão do PDV Crosby para a Conciliação Stone', () => {
  test('bandeira do caixa vira o nome usado pela Stone', () => {
    expect(bandeiraCanonica('mastercard')).toBe('Mastercard');
    expect(bandeiraCanonica('VISA ELECTRON')).toBe('Visa');
    expect(bandeiraCanonica('elo')).toBe('Elo');
    expect(bandeiraCanonica('apple pay')).toBeNull();
    expect(bandeiraCanonica('outros')).toBeNull();
    expect(bandeiraCanonica('')).toBeNull();
  });

  test('dia da venda é o dia local da loja, não o UTC', () => {
    expect(diaLocal('2026-11-21T01:30:00.000Z')).toBe('2026-11-20');
    expect(diaLocal('2026-11-21T03:00:00.000Z')).toBe('2026-11-21');
    expect(janelaUtc('2026-11-20', '2026-11-21')).toEqual({ de: '2026-11-20T03:00:00.000Z', ate: '2026-11-22T03:00:00.000Z' });
  });

  test('sem operadora informada o cartão é da Stone; link e Rede não são', () => {
    expect(ehDaStone(pagamento())).toBe(true);
    expect(ehDaStone(pagamento({ cartao_totvs: { operadora: 'PAGARME' } }))).toBe(false);
    expect(ehDaStone(pagamento({ cartao_totvs: { operadora: 'REDE' } }))).toBe(false);
    expect(ehDaStone(pagamento({ cartao_totvs: { operadora: 'STONE' } }))).toBe(true);
    expect(ehDaStone(pagamento({ adquirente_cnpj: '16.501.555/0001-57' }))).toBe(true);
    expect(ehDaStone(pagamento({ adquirente_cnpj: '01.425.787/0001-04' }))).toBe(false);
  });

  test('pagamento vira registro com identidade negativa e os dados da venda', () => {
    const t = tituloDoPagamento(pagamento(), venda(), { numero: 3310, modelo: 65, dh_emissao: '2026-11-21T01:31:00.000Z' });
    expect(t).toMatchObject({
      origem: 'headcoach',
      chave: '95|-4501',
      filial: 95,
      titulo: -4501,
      pagamentoId: 4501,
      transacao: 812,
      nf: 3310,
      nsu: '43162009951516',
      autorizacao: '081779',
      valor: 399.9,
      parcelas: 3,
      bandeira: 'Mastercard',
      bandeiraDesconhecida: false,
      tipoConta: 'Crédito',
      dataEmissao: '2026-11-20',
      portadorStone: true,
      cancelado: false,
      nomeCliente: 'MARIA DA SILVA',
    });
    expect(ehTituloHeadcoach(t)).toBe(true);
    expect(ehTituloHeadcoach({ filial: 95, titulo: -4501 })).toBe(true);
    expect(ehTituloHeadcoach({ filial: 95, titulo: 195120 })).toBe(false);
    expect(idDoPagamento(-4501)).toBe(4501);
  });

  test('débito é sempre 1x; venda cancelada sai como cancelada; link não é Stone', () => {
    expect(tituloDoPagamento(pagamento({ forma: 'debito', parcelas: 3 }), venda()).parcelas).toBe(1);
    expect(tituloDoPagamento(pagamento({ forma: 'debito' }), venda()).tipoConta).toBe('Débito');
    expect(tituloDoPagamento(pagamento(), venda({ status: 'cancelada' })).cancelado).toBe(true);
    const link = tituloDoPagamento(pagamento({ cartao_totvs: { operadora: 'PAGARME', bandeira: 'OUTROS', parcelas: 2 }, parcelas: null, bandeira: 'outros' }), venda({ empresa: 99 }));
    expect(link.portadorStone).toBe(false);
    expect(link.parcelas).toBe(2);
    expect(link.bandeiraDesconhecida).toBe(true);
  });

  test('venda espelhada no TOTVS fica só com o título do TOTVS', () => {
    const hc = [
      tituloDoPagamento(pagamento({ id: 1 }), venda({ id: 10, totvs_transacao_code: 777 })),
      tituloDoPagamento(pagamento({ id: 2 }), venda({ id: 11, totvs_transacao_code: 888 })),
      tituloDoPagamento(pagamento({ id: 3 }), venda({ id: 12 })),
    ];
    const totvs = [{ chave: '95|500', filial: 95, titulo: 500, transacao: 777 }];
    expect(semEspelhadasNoTotvs(hc, totvs).map((t) => t.pagamentoId)).toEqual([2, 3]);
  });
});

describe('batimento Stone × venda do HeadCoach', () => {
  test('NSU, autorização e valor iguais → par exato com a venda do PDV Crosby', () => {
    const t = tituloDoPagamento(pagamento(), venda());
    const r = bater([stone()], [t]);
    expect(r.pares).toHaveLength(1);
    expect(r.pares[0].tipo).toBe('exato');
    expect(r.pares[0].totvs.origem).toBe('headcoach');
    expect(r.pares[0].divergencias).toEqual([]);
    expect(r.resumo.headcoach).toMatchObject({ qtd: 1, valor: 399.9, conciliadas: 1, semStone: 0 });
    expect(r.stoneSemTotvs).toHaveLength(0);
    expect(r.totvsSemStone).toHaveLength(0);
  });

  test('divergência fala em HeadCoach, e bandeira não informada no caixa não é divergência', () => {
    const t = tituloDoPagamento(pagamento({ valor: 389.9, bandeira: '' }), venda());
    const r = bater([stone()], [t]);
    expect(r.pares[0].tipo).toBe('valor_diverge');
    expect(r.pares[0].divergencias).toEqual(['valor Stone 399.9 × HeadCoach 389.9']);
  });

  test('NSU e autorização trocados no caixa casam pela data, valor e parcelas', () => {
    const t = tituloDoPagamento(pagamento({ nsu: '081779', autorizacao: '43162009951516', bandeira: 'apple pay' }), venda());
    const r = bater([stone()], [t]);
    expect(r.pares).toHaveLength(1);
    expect(r.pares[0].tipo).toBe('digitado_errado');
    expect(r.pares[0].divergencias[0]).toBe('NSU e AUT trocados no caixa');
  });

  test('vínculo manual aponta para a venda do HeadCoach pelo número negativo', () => {
    const t = tituloDoPagamento(pagamento({ nsu: null, autorizacao: null, valor: 100 }), venda());
    const r = bater([stone()], [t], [{ id: 9, nsu: '43162009951516', filial: 95, titulo: -4501, usuario: 'yago' }]);
    expect(r.pares[0].tipo).toBe('manual');
    expect(r.pares[0].totvs.pagamentoId).toBe(4501);
  });

  test('venda no link (Pagar.me) sem venda na Stone não vira pendência; a da loja vira', () => {
    const link = tituloDoPagamento(pagamento({ id: 1, nsu: '111', autorizacao: '222', cartao_totvs: { operadora: 'PAGARME' } }), venda({ empresa: 99 }));
    const loja = tituloDoPagamento(pagamento({ id: 2, nsu: '333', autorizacao: '444' }), venda());
    const r = bater([], [link, loja]);
    expect(r.totvsSemStone.map((t) => t.pagamentoId)).toEqual([2]);
    expect(r.resumo.headcoach).toMatchObject({ qtd: 1, semStone: 1 });
  });
});

describe('refinos vistos em novembro/2026', () => {
  test('número da Pagar.me no NSU ou na autorização = link de pagamento, não é Stone', () => {
    expect(ehDaStone(pagamento({ nsu: '4663784799', autorizacao: '276489' }))).toBe(false);
    expect(ehDaStone(pagamento({ nsu: '640619', autorizacao: '4670703106' }))).toBe(false);
    expect(ehDaStone(pagamento({ nsu: '43162009951516', autorizacao: '081779' }))).toBe(true);
    const t = tituloDoPagamento(pagamento({ nsu: '4663784799', autorizacao: '276489' }), venda());
    expect(t.portadorStone).toBe(false);
    expect(t.portador).toContain('PAGARME');
    expect(bater([], [t]).totvsSemStone).toHaveLength(0);
  });

  test('duas vendas de mesmo valor no dia com NSU e AUT trocados casam cada uma com a sua', () => {
    const a = tituloDoPagamento(pagamento({ id: 1, valor: 53.7, parcelas: 1, nsu: 'jdfoca', autorizacao: '42763962266598' }), venda({ id: 462 }));
    const b = tituloDoPagamento(pagamento({ id: 2, valor: 53.7, parcelas: 1, nsu: 'feanhg', autorizacao: '42762947639276', bandeira: 'visa' }), venda({ id: 495 }));
    const s1 = stone({ nsu: '42763962266598', codAutorizacao: 'JDFOCA', valorBruto: 53.7, parcelas: 1 });
    const s2 = stone({ nsu: '42762947639276', codAutorizacao: 'FEANHG', valorBruto: 53.7, parcelas: 1, bandeira: 'Visa' });
    const r = bater([s1, s2], [a, b]);
    expect(r.pares).toHaveLength(2);
    const par = (nsu) => r.pares.find((p) => p.stone.nsu === nsu);
    expect(par('42763962266598').totvs.transacao).toBe(462);
    expect(par('42762947639276').totvs.transacao).toBe(495);
    expect(r.pares.every((p) => p.tipo === 'digitado_errado' && p.divergencias[0] === 'NSU e AUT trocados no caixa')).toBe(true);
  });
});
