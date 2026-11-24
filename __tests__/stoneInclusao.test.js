import { describe, it, expect } from '@jest/globals';
import { cpfValido, cnpjValido, normalizarChavePix, finalContaStone, valorDoTitulo, emCentavos, textoAvisoFabio, planoDeInclusao, crc16, pixCopiaECola, dadoPix } from '../utils/stoneInclusao.js';
import { incluirPix, documentoConfere, dadosDoBrcode } from '../bots/stone-extratos/inclusoes.mjs';

describe('chave Pix', () => {
  it('valida CPF e CNPJ pelo dígito', () => {
    expect(cpfValido('067.041.974-51')).toBe(true);
    expect(cpfValido('067.051.974-51')).toBe(false);
    expect(cnpjValido('27.728.810/0005-49')).toBe(true);
    expect(cnpjValido('27.728.810/0005-48')).toBe(false);
  });

  it.each([
    ['067.041.974-51', { chave: '06704197451', tipo: 'cpf' }],
    ['27.728.810/0005-49', { chave: '27728810000549', tipo: 'cnpj' }],
    ['Financeiro@Crosby.com.br', { chave: 'financeiro@crosby.com.br', tipo: 'email' }],
    ['6A5AF0BA-1111-2222-3333-444455556666', { chave: '6a5af0ba-1111-2222-3333-444455556666', tipo: 'evp' }],
    ['(84) 98718-7425', { chave: '+5584987187425', tipo: 'telefone' }],
    ['+55 84 98718-7425', { chave: '+5584987187425', tipo: 'telefone' }],
  ])('%s', (bruto, esperado) => expect(normalizarChavePix(bruto)).toEqual(esperado));

  it.each([['067.051.974-51'], ['06705197451'], [''], [null], ['123'], ['chave do fornecedor']])('recusa %s', (bruto) => {
    expect(normalizarChavePix(bruto)).toBeNull();
  });
});

describe('título', () => {
  it('só os rótulos novos entram na inclusão', () => {
    expect(finalContaStone('STONE 0549')).toBe('0549');
    expect(finalContaStone('STONE FABIO')).toBeNull();
    expect(finalContaStone('STONE')).toBeNull();
    expect(finalContaStone('SICREDI CROSBY')).toBeNull();
  });

  it('VALOR REAL vale quando preenchido', () => {
    expect(valorDoTitulo({ vl_duplicata: 100, vl_real: 90.5 })).toBe(90.5);
    expect(valorDoTitulo({ vl_duplicata: 100, vl_real: null })).toBe(100);
    expect(emCentavos(1)).toBe(100);
    expect(emCentavos(19.99)).toBe(1999);
  });
});

describe('aviso no grupo', () => {
  const item = (over) => ({ conta_final: '0549', fornecedor: 'JJI', valor_centavos: 100000, teste: false, ...over });

  it('lista as contas, marca o Fábio e resume fornecedor e valor', () => {
    const t = textoAvisoFabio([item(), item({ conta_final: '0116', fornecedor: 'COSERN', valor_centavos: 5050 })], { mencionar: '558487820986' });
    expect(t).toContain('@558487820986');
    expect(t.indexOf('0116')).toBeLessThan(t.indexOf('0549'));
    expect(t).toContain('0549 — JJI — R$ 1.000,00');
    expect(t).toContain('0116 — COSERN — R$ 50,50');
    expect(t).toContain('Total: *R$ 1.050,50*');
    expect(t).not.toContain('TESTE');
  });

  it('o teste se identifica como teste', () => {
    const t = textoAvisoFabio([item({ teste: true, valor_centavos: 100 })], { mencionar: '558487820986' });
    expect(t).toContain('*TESTE*');
    expect(t).toContain('conta 0549');
  });
});

describe('incluirPix', () => {
  const item = { id: 1, liberacao_id: 'L1', stone_account_id: 'A1', conta_final: '0549', chave_pix: '06704197451', chave_tipo: 'cpf', valor_centavos: 100, descricao: 'Dup 1' };
  const contas = [{ id: 'A1', owner_document: '27728810000549' }];
  const criadoOk = { status: 200, json: { id: 'P1', amount: 100, target: { entity: { name: 'FABIO', document: '***.041.974-**' } } } };
  const fake = ({ criado = criadoOk, confirmado = { status: 204, texto: '' }, lanca = null } = {}) => {
    const chamadas = [];
    return {
      chamadas,
      criarPix: async (a) => (chamadas.push(['criar', a]), criado),
      confirmarPix: async (a) => {
        chamadas.push(['confirmar', a]);
        if (lanca) throw lanca;
        return confirmado;
      },
    };
  };

  it('cria, confere e confirma', async () => {
    const s = fake();
    const r = await incluirPix(s, item, contas);
    expect(r).toMatchObject({ status: 'incluido', stonePagamentoId: 'P1', recebedorNome: 'FABIO' });
    expect(s.chamadas.map((c) => c[0])).toEqual(['criar', 'confirmar']);
    expect(s.chamadas[0][1]).toMatchObject({ accountId: 'A1', chave: '06704197451', valorCentavos: 100 });
    expect(s.chamadas[0][1].idempotencia).not.toBe(s.chamadas[1][1].idempotencia);
  });

  it('não confirma quando o valor devolvido é outro', async () => {
    const s = fake({ criado: { status: 200, json: { ...criadoOk.json, amount: 10000 } } });
    expect((await incluirPix(s, item, contas)).status).toBe('erro');
    expect(s.chamadas.map((c) => c[0])).toEqual(['criar']);
  });

  it('não confirma quando o documento não bate com a chave', async () => {
    const s = fake({ criado: { status: 200, json: { ...criadoOk.json, target: { entity: { document: '***.999.888-**' } } } } });
    expect((await incluirPix(s, item, contas)).status).toBe('erro');
    expect(s.chamadas.map((c) => c[0])).toEqual(['criar']);
  });

  it('para quando a Stone pede senha ou código', async () => {
    const s = fake({ confirmado: { status: 403, texto: '{"type":"srn:error:challenge_required","challenge":{"id":"x"}}' } });
    const r = await incluirPix(s, item, contas);
    expect(r.status).toBe('bloqueado');
    expect(s.chamadas.filter((c) => c[0] === 'confirmar')).toHaveLength(1);
  });

  it('sem resposta no confirm marca verificar e não repete', async () => {
    const s = fake({ lanca: new Error('fetch failed') });
    expect((await incluirPix(s, item, contas)).status).toBe('verificar');
    expect(s.chamadas.filter((c) => c[0] === 'confirmar')).toHaveLength(1);
  });

  it('erro 500 no confirm também marca verificar', async () => {
    expect((await incluirPix(fake({ confirmado: { status: 502, texto: '' } }), item, contas)).status).toBe('verificar');
  });

  it('conta sem acesso nem chama a Stone', async () => {
    const s = fake();
    expect((await incluirPix(s, item, [])).status).toBe('bloqueado');
    expect(s.chamadas).toHaveLength(0);
  });

  it('confere o documento mascarado', () => {
    expect(documentoConfere('06704197451', '***.041.974-**')).toBe(true);
    expect(documentoConfere('06704197451', '***.041.975-**')).toBe(false);
    expect(documentoConfere('06704197451', null)).toBe(true);
  });
});

describe('Liberação do HeadCoach: como o bot paga (planoDeInclusao)', () => {
  const lib = (over = {}, titulo = {}) => ({ banco: 'STONE 0549', valor: 1234.56, titulo: { chave_pix: null, codigo_barras: null, ...titulo }, ...over });
  const BOLETO = '34191.79001 01043.510047 91020.150008 5 12340000123456';

  it('com chave Pix válida vai por Pix, na conta Stone da liberação, pelo valor em centavos', () => {
    expect(planoDeInclusao(lib({}, { chave_pix: '27.728.810/0005-49' }))).toEqual({ via: 'pix', chave: '27728810000549', tipo: 'cnpj', contaFinal: '0549', valorCentavos: 123456 });
    expect(planoDeInclusao(lib({ banco: 'STONE 1007', valor: 280 }, { chave_pix: 'financeiro@fornecedor.com.br' }))).toMatchObject({ via: 'pix', tipo: 'email', contaFinal: '1007', valorCentavos: 28000 });
  });

  it('tem Pix e boleto: prefere o Pix', () => {
    expect(planoDeInclusao(lib({}, { chave_pix: '06704197451', codigo_barras: BOLETO }))).toMatchObject({ via: 'pix', tipo: 'cpf' });
  });

  it('só boleto: fica para incluir à mão, dizendo que é boleto', () => {
    const p = planoDeInclusao(lib({}, { codigo_barras: BOLETO }));
    expect(p).toMatchObject({ via: 'manual', forma: 'boleto' });
    expect(p.motivo).toMatch(/boleto/);
  });

  it('chave Pix que não dá para ter certeza do tipo não vira pagamento', () => {
    expect(planoDeInclusao(lib({}, { chave_pix: '067.051.974-51' }))).toMatchObject({ via: 'manual', motivo: expect.stringMatching(/não é válida/) }); // CPF com dígito errado
    expect(planoDeInclusao(lib({}, { chave_pix: '   ' }))).toMatchObject({ via: 'manual', motivo: expect.stringMatching(/sem chave/) });
    expect(planoDeInclusao(lib())).toMatchObject({ via: 'manual', motivo: expect.stringMatching(/sem chave/) });
  });

  it('banco que não é conta Stone (ou sem banco) não vai para o bot', () => {
    expect(planoDeInclusao(lib({ banco: 'PAGARME' }, { chave_pix: '06704197451' }))).toMatchObject({ via: 'manual', motivo: expect.stringMatching(/não é uma conta Stone/) });
    expect(planoDeInclusao(lib({ banco: 'STONE CROSBY' }, { chave_pix: '06704197451' })).via).toBe('manual');
    expect(planoDeInclusao(lib({ banco: null }, { chave_pix: '06704197451' }))).toMatchObject({ via: 'manual', motivo: expect.stringMatching(/sem banco/) });
  });

  it('valor zerado ou inválido não vai', () => {
    expect(planoDeInclusao(lib({ valor: 0 }, { chave_pix: '06704197451' })).via).toBe('manual');
    expect(planoDeInclusao(lib({ valor: 'abc' }, { chave_pix: '06704197451' })).via).toBe('manual');
  });
});

describe('Pix copia e cola (QR Code)', () => {
  const BASE = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  const QR = BASE + crc16(BASE);

  it('o dígito de conferência é o CRC16 conhecido do padrão ("123456789" → 29B1)', () => {
    expect(crc16('123456789')).toBe('29B1');
    expect(QR.slice(-4)).toMatch(/^[0-9A-F]{4}$/);
  });

  it('aceita o código inteiro e recusa o cortado ou alterado', () => {
    expect(pixCopiaECola(` ${QR} `)).toBe(QR);
    expect(pixCopiaECola(QR.slice(0, -1))).toBeNull(); // faltou um caractere ao colar
    expect(pixCopiaECola(QR.replace('Fulano', 'Sicran'))).toBeNull(); // conteúdo não bate com o CRC
    expect(pixCopiaECola('06704197451')).toBeNull();
    expect(pixCopiaECola(null)).toBeNull();
  });

  it('dadoPix distingue copia e cola de chave', () => {
    expect(dadoPix(QR)).toEqual({ chave: QR, tipo: 'brcode' });
    expect(dadoPix('06704197451')).toEqual({ chave: '06704197451', tipo: 'cpf' });
    expect(dadoPix('qualquer coisa')).toBeNull();
  });

  it('a liberação com copia e cola vai por Pix pelo bot — inclusive quando também tem boleto', () => {
    const l = { banco: 'STONE 0549', valor: 913.33, titulo: { chave_pix: QR, codigo_barras: '34191.79001 01043.510047 91020.150008 5 12340000091333' } };
    expect(planoDeInclusao(l)).toEqual({ via: 'pix', chave: QR, tipo: 'brcode', contaFinal: '0549', valorCentavos: 91333 });
  });

  it('copia e cola cortado não vira pagamento e o motivo diz isso', () => {
    const p = planoDeInclusao({ banco: 'STONE 0549', valor: 10, titulo: { chave_pix: QR.slice(0, 80) } });
    expect(p.via).toBe('manual');
    expect(p.motivo).toMatch(/incompleto/);
  });

  describe('no bot (Stone simulada)', () => {
    const contas = [{ id: 'acc-0549', owner_document: '27728810000549', owner_id: 'dono-1' }];
    const item = { liberacao_id: 'hc-77', stone_account_id: 'acc-0549', conta_final: '0549', chave_pix: QR, chave_tipo: 'brcode', valor_centavos: 91333, descricao: 'Dup 1/11' };
    const stoneFalsa = ({ lido = { dynamic: { key: 'chave-do-recebedor', amount: 91333, transaction_id: 'tx-1' }, type: 'dynamic' }, statusLido = 200 } = {}) => {
      const chamadas = [];
      return {
        chamadas,
        decodificarBrcode: async (p) => (chamadas.push(['ler', p]), { status: statusLido, json: lido, texto: JSON.stringify(lido) }),
        criarPix: async (p) => (chamadas.push(['criar', p]), { status: 201, json: { id: 'pix-9', amount: p.valorCentavos, target: { entity: { name: 'EQUATORIAL', document: '06272793000184' } } } }),
        confirmarPix: async (p) => (chamadas.push(['confirmar', p]), { status: 204, json: null, texto: '' }),
      };
    };

    it('lê o código, cria o Pix com a chave e a cobrança que a Stone devolveu e confirma', async () => {
      const s = stoneFalsa();
      const r = await incluirPix(s, item, contas);
      expect(r).toMatchObject({ status: 'incluido', stonePagamentoId: 'pix-9' });
      expect(s.chamadas.map((c) => c[0])).toEqual(['ler', 'criar', 'confirmar']);
      expect(s.chamadas[0][1]).toMatchObject({ brcode: QR, ownerId: 'dono-1' });
      expect(s.chamadas[1][1]).toMatchObject({ accountId: 'acc-0549', chave: 'chave-do-recebedor', transactionId: 'tx-1', valorCentavos: 91333 });
    });

    it('valor do QR diferente do da liberação (conta com juros): não cria nada', async () => {
      const s = stoneFalsa({ lido: { dynamic: { key: 'k', amount: 92000, transaction_id: 'tx' }, type: 'dynamic' } });
      const r = await incluirPix(s, item, contas);
      expect(r.status).toBe('erro');
      expect(r.erro).toMatch(/920\.00.*913\.33/);
      expect(s.chamadas.map((c) => c[0])).toEqual(['ler']);
    });

    it('QR estático (sem valor): usa o valor da liberação e não manda cobrança', async () => {
      const s = stoneFalsa({ lido: { static: { key: 'k-estatica', amount: null, transaction_id: 'COD1' }, type: 'static' } });
      const r = await incluirPix(s, item, contas);
      expect(r.status).toBe('incluido');
      expect(s.chamadas[1][1]).toMatchObject({ chave: 'k-estatica', transactionId: null, valorCentavos: 91333 });
    });

    it('formato real da Stone (24/11/2026): estático COM valor e com transaction_id', async () => {
      const real = { static: { additional_information: 'CONTA 11/2026', amount: 12072, key: '1245d328-7ad1-42cf-b726-4d7d458edd3c', key_type: 'random_key', transaction_id: '1150020450880111202600003' }, type: 'static' };
      expect(dadosDoBrcode(real)).toEqual({ tipo: 'static', chave: '1245d328-7ad1-42cf-b726-4d7d458edd3c', valorCentavos: 12072, transactionId: '1150020450880111202600003' });
      const s = stoneFalsa({ lido: real });
      const r = await incluirPix(s, { ...item, valor_centavos: 12072 }, contas);
      expect(r.status).toBe('incluido');
      // estático: vai só a chave, sem a cobrança (como o portal faz)
      expect(s.chamadas[1][1]).toMatchObject({ chave: '1245d328-7ad1-42cf-b726-4d7d458edd3c', transactionId: null, valorCentavos: 12072 });
      // e se a liberação for de outro valor, não inclui
      const s2 = stoneFalsa({ lido: real });
      expect((await incluirPix(s2, { ...item, valor_centavos: 12070 }, contas)).status).toBe('erro');
      expect(s2.chamadas.map((c) => c[0])).toEqual(['ler']);
    });

    it('leitura da resposta: dados soltos, dentro de data, sem chave', () => {
      expect(dadosDoBrcode({ key: 'k', amount: 100, type: 'static' })).toMatchObject({ chave: 'k', valorCentavos: 100 });
      expect(dadosDoBrcode({ data: { key: 'k2', amount: 0 } })).toMatchObject({ chave: 'k2', valorCentavos: null });
      expect(dadosDoBrcode({ dynamic: { key: 'k3', amount: { original: 500, final: 512 }, transaction_id: 't' }, type: 'dynamic' })).toEqual({ tipo: 'dynamic', chave: 'k3', valorCentavos: 512, transactionId: 't' });
      expect(dadosDoBrcode({ type: 'static', static: {} })).toBeNull();
      expect(dadosDoBrcode(null)).toBeNull();
    });

    it('a Stone não leu o código (vencido, inválido): erro, sem criar Pix', async () => {
      const s = stoneFalsa({ lido: { type: 'srn:error:invalid_brcode' }, statusLido: 422 });
      const r = await incluirPix(s, item, contas);
      expect(r.status).toBe('erro');
      expect(r.erro).toMatch(/não leu o Pix copia e cola \(422\)/);
      expect(s.chamadas.map((c) => c[0])).toEqual(['ler']);
    });

    it('Pix por chave continua igual: não chama a leitura de código', async () => {
      const s = stoneFalsa();
      const r = await incluirPix(s, { ...item, chave_pix: '06272793000184', chave_tipo: 'cnpj' }, contas);
      expect(r.status).toBe('incluido');
      expect(s.chamadas.map((c) => c[0])).toEqual(['criar', 'confirmar']);
    });
  });
});
