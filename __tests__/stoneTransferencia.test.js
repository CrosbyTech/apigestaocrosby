import { describe, it, expect } from '@jest/globals';
import { chaveAleatoria, chaveMascarada, finalDoCnpj, emCentavos, motivoDeNaoTransferir, descricaoDaTransferencia, textoAvisoTransferencias, SITUACOES } from '../utils/stoneTransferencia.js';
import { recebedorEhOEsperado } from '../bots/stone-extratos/inclusoes.mjs';
import { incluirTransferencia } from '../bots/stone-extratos/transferencias.mjs';

const CHAVE = '6a5af0ba-1111-4222-8333-abcdefabcdef';
const conta = (final, over = {}) => ({ stone_account_id: `acc-${final}`, conta_final: final, titular_cnpj: `277288100005${final.slice(-2)}`, titular_nome: 'FA MODA & VAREJO LTDA', chave_pix_aleatoria: CHAVE, ativa: true, ...over });

describe('chave aleatória e conta', () => {
  it('só aceita o formato de chave aleatória (UUID), em minúsculas', () => {
    expect(chaveAleatoria(` ${CHAVE.toUpperCase()} `)).toBe(CHAVE);
    expect(chaveAleatoria('27728810000549')).toBeNull(); // CNPJ não é chave aleatória
    expect(chaveAleatoria('fabio@crosby.com')).toBeNull();
    expect(chaveAleatoria('6a5af0ba-1111-4222-8333')).toBeNull();
    expect(chaveAleatoria(null)).toBeNull();
  });

  it('na tela a chave aparece só pelo começo e pelo fim', () => {
    expect(chaveMascarada(CHAVE)).toBe('6a5af0ba…cdef');
    expect(chaveMascarada(null)).toBeNull();
  });

  it('a conta é chamada pelo final do CNPJ', () => {
    expect(finalDoCnpj('27.728.810/0005-49')).toBe('0549');
    expect(finalDoCnpj('17177680001007')).toBe('1007');
    expect(finalDoCnpj('')).toBeNull();
    expect(emCentavos(1234.56)).toBe(123456);
    expect(emCentavos(0.29)).toBe(29);
  });
});

describe('o que pode ser transferido', () => {
  const origem = conta('0549', { saldoCentavos: 500000 });
  const destino = conta('1007', { stone_account_id: 'acc-1007', titular_cnpj: '17177680001007' });

  it('valor dentro do saldo, destino com chave e CNPJ: pode', () => {
    expect(motivoDeNaoTransferir({ origem, destino, valorCentavos: 100000 })).toBeNull();
    expect(motivoDeNaoTransferir({ origem, destino, tudo: true })).toBeNull();
  });

  it('mesma conta, conta inexistente ou desativada: não', () => {
    expect(motivoDeNaoTransferir({ origem, destino: origem, tudo: true })).toMatch(/mesma conta/);
    expect(motivoDeNaoTransferir({ origem: null, destino, tudo: true })).toMatch(/origem não encontrada/);
    expect(motivoDeNaoTransferir({ origem, destino: null, tudo: true })).toMatch(/destino não encontrada/);
    expect(motivoDeNaoTransferir({ origem, destino: { ...destino, ativa: false }, tudo: true })).toMatch(/desativada/);
  });

  it('destino sem a chave guardada (ou com chave de outro tipo) não recebe', () => {
    expect(motivoDeNaoTransferir({ origem, destino: { ...destino, chave_pix_aleatoria: null }, tudo: true })).toMatch(/sem a chave/);
    expect(motivoDeNaoTransferir({ origem, destino: { ...destino, chave_pix_aleatoria: '17177680001007' }, tudo: true })).toMatch(/sem a chave/);
    expect(motivoDeNaoTransferir({ origem, destino: { ...destino, titular_cnpj: '' }, tudo: true })).toMatch(/sem o CNPJ/);
  });

  it('valor zerado, quebrado, negativo ou maior que o saldo: não', () => {
    expect(motivoDeNaoTransferir({ origem, destino, valorCentavos: 0 })).toMatch(/informe o valor/);
    expect(motivoDeNaoTransferir({ origem, destino, valorCentavos: -5 })).toMatch(/informe o valor/);
    expect(motivoDeNaoTransferir({ origem, destino, valorCentavos: 10.5 })).toMatch(/informe o valor/);
    expect(motivoDeNaoTransferir({ origem, destino, valorCentavos: null })).toMatch(/informe o valor/);
    expect(motivoDeNaoTransferir({ origem, destino, valorCentavos: 500001 })).toMatch(/só tem/);
  });

  it('"todo o saldo" de conta zerada não vai; sem saldo conhecido, quem decide é o bot na hora', () => {
    expect(motivoDeNaoTransferir({ origem: { ...origem, saldoCentavos: 0 }, destino, tudo: true })).toMatch(/sem saldo/);
    expect(motivoDeNaoTransferir({ origem: { ...origem, saldoCentavos: null }, destino, tudo: true })).toBeNull();
  });
});

describe('textos', () => {
  it('descrição do Pix e situações', () => {
    expect(descricaoDaTransferencia('0549', '1007')).toBe('Entre contas 0549 > 1007');
    expect(SITUACOES.incluido).toMatch(/Fábio/);
    expect(Object.keys(SITUACOES)).toEqual(['fila', 'processando', 'incluido', 'efetivada', 'erro', 'bloqueado', 'verificar', 'cancelada']);
  });

  it('aviso do grupo: contas para aprovar, cada transferência e o total', () => {
    const t = textoAvisoTransferencias(
      [
        { origem_final: '1007', destino_final: '0549', valor_incluido_centavos: 332172 },
        { origem_final: '0205', destino_final: '0549', valor_centavos: 100000 },
      ],
      { mencionar: '558487820986' },
    );
    expect(t).toMatch(/@558487820986, tem \*transferência entre contas\* para aprovar/);
    expect(t).toMatch(/0205 → 0549 — R\$\s1\.000,00/);
    expect(t).toMatch(/1007 → 0549 — R\$\s3\.321,72/);
    expect(t).toMatch(/Total: \*R\$\s4\.321,72\*/);
    expect(t.indexOf('0205 →')).toBeLessThan(t.indexOf('1007 →'));
  });
});

describe('trava do recebedor (bot)', () => {
  it('CNPJ inteiro igual, com ou sem pontuação: confere', () => {
    expect(recebedorEhOEsperado('17177680001007', '17.177.680/0010-07')).toBe(true);
    expect(recebedorEhOEsperado('17177680001007', '17177680001007')).toBe(true);
  });

  it('CNPJ de outra empresa: não confere', () => {
    expect(recebedorEhOEsperado('17177680001007', '27.728.810/0005-49')).toBe(false);
    expect(recebedorEhOEsperado('17177680001007', '17177680000116')).toBe(false); // mesma raiz, outra conta
  });

  it('mascarado: confere só se os trechos visíveis estão no esperado e somam 6 dígitos ou mais', () => {
    expect(recebedorEhOEsperado('17177680001007', '**.177.680/0010-**')).toBe(true);
    expect(recebedorEhOEsperado('17177680001007', '**.***.680/****-**')).toBe(false); // 3 dígitos é pouco
    expect(recebedorEhOEsperado('17177680001007', '**.999.680/0010-**')).toBe(false);
  });

  it('sem documento visível não dá para afirmar: não confere', () => {
    expect(recebedorEhOEsperado('17177680001007', '')).toBe(false);
    expect(recebedorEhOEsperado('17177680001007', null)).toBe(false);
    expect(recebedorEhOEsperado('17177680001007', '***')).toBe(false);
    expect(recebedorEhOEsperado('', '17177680001007')).toBe(false);
  });
});

describe('inclusão da transferência (bot, com a Stone simulada)', () => {
  const item = { id: 7, origem_account_id: 'acc-0549', origem_final: '0549', destino_account_id: 'acc-1007', destino_final: '1007', destino_cnpj: '17177680001007', destino_chave: CHAVE, tudo: false, valor_centavos: 100000, descricao: 'Entre contas 0549 > 1007' };
  const contas = [{ id: 'acc-0549', owner_document: '27728810000549' }];
  const stoneFalsa = ({ saldo = 500000, documento = '17.177.680/0010-07', confirma = 204 } = {}) => {
    const chamadas = [];
    return {
      chamadas,
      saldo: async (id) => (chamadas.push(['saldo', id]), { balance: saldo }),
      criarPix: async (p) => (chamadas.push(['criar', p]), { status: 201, json: { id: 'pix-1', amount: p.valorCentavos, target: { entity: { name: 'CROSBY CR VESTUARIO LTDA', document: documento } } } }),
      confirmarPix: async (p) => (chamadas.push(['confirmar', p]), { status: confirma, json: null, texto: '' }),
    };
  };

  it('cria o Pix da origem para a chave do destino e confirma', async () => {
    const s = stoneFalsa();
    const r = await incluirTransferencia(s, item, contas);
    expect(r).toMatchObject({ status: 'incluido', valorCentavos: 100000, stonePagamentoId: 'pix-1', recebedorDoc: '17.177.680/0010-07' });
    expect(s.chamadas.map((c) => c[0])).toEqual(['criar', 'confirmar']);
    expect(s.chamadas[0][1]).toMatchObject({ accountId: 'acc-0549', chave: CHAVE, valorCentavos: 100000 });
  });

  it('recebedor que não é a conta de destino: NÃO confirma', async () => {
    const s = stoneFalsa({ documento: '27.728.810/0005-49' });
    const r = await incluirTransferencia(s, item, contas);
    expect(r.status).toBe('erro');
    expect(r.erro).toMatch(/não é a conta de destino/);
    expect(s.chamadas.map((c) => c[0])).toEqual(['criar']); // parou antes do confirmar
  });

  it('"todo o saldo" usa o saldo lido na hora; conta zerada não gera Pix', async () => {
    const s = stoneFalsa({ saldo: 332172 });
    const r = await incluirTransferencia(s, { ...item, tudo: true, valor_centavos: null }, contas);
    expect(r).toMatchObject({ status: 'incluido', valorCentavos: 332172 });
    expect(s.chamadas[1][1].valorCentavos).toBe(332172);
    const vazia = stoneFalsa({ saldo: 0 });
    const r2 = await incluirTransferencia(vazia, { ...item, tudo: true, valor_centavos: null }, contas);
    expect(r2.status).toBe('erro');
    expect(vazia.chamadas.map((c) => c[0])).toEqual(['saldo']);
  });

  it('conta de origem que o usuário do portal não enxerga, ou que não termina no final esperado: não cria nada', async () => {
    const s = stoneFalsa();
    expect((await incluirTransferencia(s, item, [])).status).toBe('bloqueado');
    expect((await incluirTransferencia(s, item, [{ id: 'acc-0549', owner_document: '27728810000972' }])).status).toBe('erro');
    expect(s.chamadas).toEqual([]);
  });

  it('sem chave ou CNPJ do destino, ou origem = destino: não cria nada', async () => {
    const s = stoneFalsa();
    expect((await incluirTransferencia(s, { ...item, destino_chave: null }, contas)).status).toBe('erro');
    expect((await incluirTransferencia(s, { ...item, destino_cnpj: null }, contas)).status).toBe('erro');
    expect((await incluirTransferencia(s, { ...item, destino_account_id: 'acc-0549' }, contas)).status).toBe('erro');
    expect(s.chamadas).toEqual([]);
  });
});
