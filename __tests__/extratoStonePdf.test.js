// Testa a interpretação do PDF "Comprovante de Extrato" da Stone a partir de
// itens posicionados sintéticos (mesmas coordenadas do PDF real).
import { interpretarPaginas, montarMemo, parseValorBr } from '../utils/extratoStonePdf.js';
import { classificarLancamento } from '../utils/ofxParaCnab240.js';

const it = (x, y, s) => ({ x, y, w: 10, s });

// Página 1 com cabeçalho + 3 lançamentos (do mais recente ao mais antigo),
// incluindo um bloco multi-linha com nome acima e contraparte abaixo.
const pagina1 = {
  numero: 1,
  largura: 598,
  altura: 842,
  items: [
    it(35.8, 141.5, 'Nome'),
    it(404.3, 141.5, 'Documento'),
    it(35.8, 157.3, 'CROSBY CR VESTUARIO LTDA'),
    it(404.3, 157.3, '17.177.680/0010'),
    it(482.3, 157.3, ''),
    it(487.5, 157.3, '07'),
    it(35.8, 174.5, 'Instituição'),
    it(404.3, 174.5, 'Agência'),
    it(456.8, 174.5, 'Conta'),
    it(35.8, 190.3, 'Stone Instituição de Pagamento S.A.'),
    it(404.3, 190.3, '0001'),
    it(456.8, 190.3, '71938990'),
    it(513, 190.3, '0'),
    it(20, 227.8, 'Período: de 25/06/2026 a 26/09/2026'),
    it(26, 251.8, 'DATA'),
    it(80, 251.8, 'TIPO'),
    it(125, 251.8, 'DESCRIÇÃO'),
    it(283.8, 251.8, 'VALOR'),
    it(358, 251.8, 'SALDO'),
    it(427.8, 251.8, 'CONTRAPARTE'),
    // lançamento 1 (mais recente): saída pix multi-linha
    it(125, 270.5, 'ELIAN INDUSTRIA TEXTIL LTDA'),
    it(26, 276.5, '24/09/26'),
    it(80, 276.5, 'Saída'),
    it(283.8, 276.5, '- R$ 36.134,12'),
    it(358, 276.5, 'R$ 966,78'),
    it(427.8, 276.5, 'ITAÚ UNIBANCO S.A.'),
    it(125, 282.5, 'Transferência | Pix'),
    // lançamento 2: tarifa em linha única (Stone repete o saldo do par
    // depósito+tarifa; aqui o saldo já é o acumulado após a tarifa)
    it(26, 404.8, '23/09/26'),
    it(80, 404.8, 'Saída'),
    it(125, 404.8, 'Tarifa do boleto'),
    it(283.8, 404.8, '- R$ 1,99'),
    it(358, 404.8, 'R$ 37.100,90'),
    // lançamento 3 (mais antigo): antecipação com contraparte de 3 linhas
    it(26, 429.5, '23/09/26'),
    it(80, 429.5, 'Entrada'),
    it(125, 429.5, 'Recebimento vendas'),
    it(125, 441.5, 'Antecipação'),
    it(283.8, 429.5, 'R$ 184,76'),
    it(358, 429.5, 'R$ 37.102,89'),
    it(427.8, 423.5, 'STONE INSTITUIÇÃO DE'),
    it(427.8, 435.5, 'PAGAMENTO S.A.'),
    it(427.8, 447.5, 'Ag: 0001 • Cc: 307728'),
    // rodapé
    it(20, 700, 'Informações do Comprovante'),
    it(20, 720, 'Ouvidoria'),
  ],
};

describe('parseValorBr', () => {
  test('valores com e sem sinal', () => {
    expect(parseValorBr('- R$ 36.134,12')).toBe(-36134.12);
    expect(parseValorBr('R$ 966,78')).toBe(966.78);
    expect(parseValorBr('R$ 0,00')).toBe(0);
    expect(parseValorBr('abc')).toBeNull();
  });
});

describe('montarMemo', () => {
  test('reproduz o formato do OFX', () => {
    expect(montarMemo(['ELIAN INDUSTRIA TEXTIL LTDA', 'Transferência | Pix'])).toBe('ELIAN INDUSTRIA TEXTIL LTDA - Transferência | Pix');
    expect(montarMemo(['FUTURA PRODUTOS DE', 'ARMARINHOS LTDA', 'Devolução | Pix'])).toBe('FUTURA PRODUTOS DE ARMARINHOS LTDA - Devolução | Pix');
    expect(montarMemo(['Recebimento vendas', 'Antecipação'])).toBe('Recebimento vendas - Antecipação | Crédito');
    expect(montarMemo(['Recebimento vendas', 'Antecipação | Crédito'])).toBe('Recebimento vendas - Antecipação | Crédito');
    expect(montarMemo(['Mensalidade', 'Maquininha Stone'])).toBe('Mensalidade - Maquininha Stone');
    expect(montarMemo(['Pedrosa', 'Recebimento | Boleto'])).toBe('Pedrosa - Recebimento | Boleto');
    expect(montarMemo(['Tarifa do boleto'])).toBe('Tarifa do boleto');
  });
});

describe('interpretarPaginas', () => {
  const r = interpretarPaginas([pagina1]);

  test('lê o titular do cabeçalho (hífens somem no PDF)', () => {
    expect(r.titular).toMatchObject({
      nome: 'CROSBY CR VESTUARIO LTDA',
      cnpj: '17177680001007',
      agencia: '0001',
      conta: '71938990',
      contaDv: '0',
      periodoInicio: '2026-06-25',
      periodoFim: '2026-09-26',
    });
  });

  test('lançamentos em ordem cronológica com memo, valor e saldo', () => {
    expect(r.lancamentos).toHaveLength(3);
    const [a, b, c] = r.lancamentos;
    expect(a).toMatchObject({ data: '2026-09-23', valor: 184.76, natureza: 'C', memo: 'Recebimento vendas - Antecipação | Crédito', saldoApos: 37102.89 });
    expect(a.bancoContraparte).toBe('STONE INSTITUIÇÃO DE PAGAMENTO S.A.');
    expect(a.contaContraparte).toBe('Ag: 0001 • Cc: 307728');
    expect(b).toMatchObject({ data: '2026-09-23', valor: -1.99, memo: 'Tarifa do boleto', saldoApos: 37100.9 });
    expect(c).toMatchObject({ data: '2026-09-24', valor: -36134.12, memo: 'ELIAN INDUSTRIA TEXTIL LTDA - Transferência | Pix', saldoApos: 966.78 });
  });

  test('saldo corrente fecha (valida o parsing)', () => {
    expect(r.conferencia).toEqual({ saldoInicial: 36918.13, inconsistencias: 0 });
    expect(r.avisos).toEqual([]);
  });

  test('classificação dos novos padrões (boleto)', () => {
    expect(classificarLancamento({ memo: 'Tarifa do boleto', valor: -1.99 })).toMatchObject({ categoria: '105', historico: '0TB1' });
    expect(classificarLancamento({ memo: 'Depósito por boleto', valor: 900 })).toMatchObject({ grupo: 'boleto', categoria: '202', historico: '0BL1' });
    expect(classificarLancamento({ memo: 'Pedrosa - Recebimento | Boleto', valor: 2245.75 })).toMatchObject({ historico: '0BL2', contraparte: 'PEDROSA' });
    expect(classificarLancamento({ memo: 'Recebimento vendas - Antecipação | Crédito', valor: 184.76 })).toMatchObject({ grupo: 'antecipacao', historico: '0AN1' });
  });
});
