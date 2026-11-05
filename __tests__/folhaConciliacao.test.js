import { ehLinhaFolha, lerLinhaFolha, semelhancaNome, liquidoFerias, valorAdiantamento, liquidoDecimo } from '../services/folhaConciliacao.js';

describe('contas Mêntore × folha do Dryland', () => {
  test('tipo e nome do funcionário vêm da descrição do extrato', () => {
    expect(lerLinhaFolha({ descricao: 'Pagamento de salário - MARIA APARECIDA SOUSA PEREIRA DA COSTA' })).toMatchObject({ tipo: 'salario', nome: 'MARIA APARECIDA SOUSA PEREIRA DA COSTA' });
    expect(lerLinhaFolha({ descricao: 'Pagamento de férias - PEDRO HENRIQUE DE LIMA MOURA' }).tipo).toBe('ferias');
    expect(lerLinhaFolha({ descricao: 'Rescisão - JOSÉ CARLOS DE ALMEIDA ROCHA' })).toMatchObject({ tipo: 'rescisao', nome: 'JOSÉ CARLOS DE ALMEIDA ROCHA' });
    expect(lerLinhaFolha({ descricao: 'Adiantamento salarial - ANA PAULA' }).tipo).toBe('adiantamento');
    expect(lerLinhaFolha({ descricao: 'Pagamento feito via PIX', contraparte_nome: '' })).toMatchObject({ tipo: 'salario', nome: '' });
  });
  test('só saídas da Mêntore (ou categoria folha) entram', () => {
    expect(ehLinhaFolha({ valor: -2653.05, banco: 'MENTORE' })).toBe(true);
    expect(ehLinhaFolha({ valor: -2653.05, banco: 'STONE', categoria: 'folha' })).toBe(true);
    expect(ehLinhaFolha({ valor: 100, banco: 'MENTORE' })).toBe(false);
    expect(ehLinhaFolha({ valor: -100, banco: 'STONE', categoria: 'pix' })).toBe(false);
  });
  test('semelhança de nomes tolera acento, caixa, truncamento e partículas', () => {
    expect(semelhancaNome('JOSÉ CARLOS DE ALMEIDA ROCHA', 'Jose Carlos de Almeida Rocha')).toBe(1);
    expect(semelhancaNome('MARIA APARECIDA SOUSA PEREIRA DA C', 'MARIA APARECIDA SOUSA PEREIRA DA COSTA')).toBeGreaterThanOrEqual(0.95);
    expect(semelhancaNome('JULIANA CRISTINA MOREIRA LOPES', 'JULIANA CRISTINA MOREIRA LOPES DOS SANTOS')).toBeGreaterThanOrEqual(0.8);
    expect(semelhancaNome('ANA PAULA', 'ANA CAROLINA FREITAS NUNES')).toBeLessThan(0.6);
    expect(semelhancaNome('CARLA REGINA DA SILVA', 'BRUNO SILVA DE OLIVEIRA')).toBe(0);
  });
  test('férias, adiantamento e 13º saem dos eventos da folha', () => {
    const f = {
      eventos: [
        { desc: 'Salário Base', valor: 2000, tipo: 'P' },
        { desc: 'Férias', valor: 1500, tipo: 'P' },
        { desc: '1/3 Férias', valor: 500, tipo: 'P' },
        { desc: 'INSS s/ Férias', valor: 150, tipo: 'D' },
        { desc: 'Desc. Adiantamento', valor: 800, tipo: 'D' },
        { desc: 'Desc. Adiantamento de Férias', valor: 100, tipo: 'D' },
        { desc: 'INSS', valor: 180, tipo: 'D' },
      ],
    };
    expect(liquidoFerias(f)).toBe(1750); // 1500 + 500 − 150 − 100
    expect(valorAdiantamento(f)).toBe(800);
    expect(liquidoDecimo(f)).toBeNull();
    expect(liquidoFerias({ eventos: [{ desc: 'Salário Base', valor: 1, tipo: 'P' }] })).toBeNull();
    expect(liquidoDecimo({ eventos: [{ desc: '13º Salário', valor: 1200, tipo: 'P' }, { desc: 'INSS s/ 13º', valor: 100, tipo: 'D' }] })).toBe(1100);
  });
});
