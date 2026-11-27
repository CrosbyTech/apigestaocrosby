import { describe, it, expect } from '@jest/globals';
import { casarIncluidos, conferirEscolhas, janelaDosExtratos, bancoDaConta, pontosDaSaida, contraparteDaSaida, addDias, DIAS_ATRAS } from '../utils/hcCpBaixaAutomatica.js';

// pontuação simples de nome para o teste: fração das palavras do fornecedor que aparecem no extrato
const pontuar = (a, b) => {
  const A = String(a).toUpperCase().split(/\s+/).filter((t) => t.length > 2);
  const B = new Set(String(b).toUpperCase().split(/[^A-Z0-9]+/));
  return A.length ? A.filter((t) => B.has(t)).length / A.length : 0;
};
const lib = (id, valor, fornecedor = 'ALARES TELECOM', over = {}) => ({ id, valor, titulo: { fornecedor_code: over.code ?? 10, fornecedor_nome: fornecedor, fornecedor_cpf_cnpj: over.doc ?? '02952192000161', vencimento: over.venc ?? '2026-11-10' } });
const saida = (id, valor, nome = 'ALARES TELECOM', over = {}) => ({ id, conta_id: over.conta ?? 1, data: over.data ?? '2026-11-20', valor: -Math.abs(valor), contraparte_nome: nome, contraparte_doc: over.doc ?? null, memo: `${nome} - Transferência | Pix`, seq: id });
const casar = (libs, saidas, usadas) => casarIncluidos(libs, saidas, { pontuar, usadas });

describe('janela dos extratos e banco da conta', () => {
  it('confere de hoje até 30 dias para trás', () => {
    expect(DIAS_ATRAS).toBe(30);
    expect(janelaDosExtratos('2026-11-24')).toEqual({ de: '2026-10-25', ate: '2026-11-24' });
    expect(janelaDosExtratos('2026-12-03')).toEqual({ de: '2026-11-03', ate: '2026-12-03' });
    expect(addDias('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('o banco sai como a Liberação escreve', () => {
    expect(bancoDaConta({ banco: 'STONE', apelido: 'Stone 0005-49', titular_cnpj: '27728810000549' })).toBe('STONE 0549');
    expect(bancoDaConta({ banco: 'STONE', apelido: 'Stone 0010-07', titular_cnpj: '17.177.680/0010-07' })).toBe('STONE 1007');
    expect(bancoDaConta({ banco: 'PAGARME', apelido: 'Pagar.me 0005-49', titular_cnpj: '27728810000549' })).toBe('PAGARME');
    expect(bancoDaConta({ banco: 'MENTORE', apelido: 'Mêntore A01' })).toBe('MENTORE');
    expect(bancoDaConta({ banco: 'SICREDI', apelido: 'Sicredi 36733-8' })).toBe('SICREDI 36733-8');
    expect(bancoDaConta(null)).toBeNull();
  });

  it('CPF/CNPJ igual vale mais que o nome', () => {
    const t = lib(1, 10).titulo;
    expect(pontosDaSaida(t, saida(1, 10, 'OUTRO NOME QUALQUER', { doc: '02.952.192/0001-61' }), pontuar)).toBe(2);
    expect(pontosDaSaida(t, saida(1, 10, 'ALARES TELECOM'), pontuar)).toBe(1);
    expect(pontosDaSaida(t, saida(1, 10, 'PADARIA DO ZE'), pontuar)).toBe(0);
    expect(contraparteDaSaida({ memo: ' PIX X ' })).toBe('PIX X');
  });
});

describe('nome de quem recebeu só no memo do extrato', () => {
  // caso real de 25/11/2026: o leitor guardou "Transferência | Pix" como nome e o CPF do MEI como documento
  const real = { id: 327094, conta_id: 10, data: '2026-11-17', valor: -450, contraparte_nome: 'Transferência | Pix', contraparte_doc: '05069473433', memo: 'SALATIEL GONCALVES DA SILVA JUNIOR 05069473433 - Transferência | Pix', seq: 1 };
  const liberacao = { id: 69, valor: 450, titulo: { fornecedor_code: 501, fornecedor_nome: 'SALATIEL GONCALVES DA SILVA JUNIOR 05069473433', fornecedor_cpf_cnpj: '34859806000151', vencimento: '2026-11-12' } };

  it('casa pelo memo', () => {
    expect(pontosDaSaida(liberacao.titulo, real, pontuar)).toBe(1);
    const r = casar([liberacao], [real]);
    expect(r.casadas).toHaveLength(1);
    expect(r.casadas[0].saida.id).toBe(327094);
  });

  it('na tela aparece o memo, não "Transferência | Pix"', () => {
    expect(contraparteDaSaida(real)).toMatch(/^SALATIEL/);
    expect(contraparteDaSaida({ contraparte_nome: 'ALARES INTERNET S/A', memo: 'ALARES INTERNET S/A - Transferência | Pix' })).toBe('ALARES INTERNET S/A');
    expect(contraparteDaSaida({ contraparte_nome: 'Pagamento Pix', memo: '' })).toBe('Pagamento Pix');
  });

  it('memo de outra pessoa continua não casando', () => {
    const r = casar([liberacao], [{ ...real, memo: 'PADARIA DO ZE - Transferência | Pix' }]);
    expect(r.casadas).toEqual([]);
  });
});

describe('uma saída = uma liberação', () => {
  it('casa valor igual + mesmo fornecedor', () => {
    const r = casar([lib(1, 170.32)], [saida(100, 170.32)]);
    expect(r.casadas).toHaveLength(1);
    expect(r.casadas[0]).toMatchObject({ tipo: 'individual', liberacoes: [1] });
    expect(r.casadas[0].saida.id).toBe(100);
    expect(r.semSaida).toEqual([]);
  });

  it('valor diferente por um centavo não casa', () => {
    const r = casar([lib(1, 170.32)], [saida(100, 170.33)]);
    expect(r.casadas).toEqual([]);
    expect(r.semSaida[0]).toMatchObject({ id: 1 });
    expect(r.semSaida[0].motivo).toMatch(/nenhuma saída/);
  });

  it('mesmo valor para outra pessoa não casa, e a pista aparece no motivo', () => {
    const r = casar([lib(1, 500)], [saida(100, 500, 'PADARIA DO ZE')]);
    expect(r.casadas).toEqual([]);
    expect(r.semSaida[0].motivo).toMatch(/mesmo valor.*PADARIA DO ZE/);
  });

  it('saída já usada por outra conciliação fica de fora', () => {
    const r = casar([lib(1, 170.32)], [saida(100, 170.32)], new Set([100]));
    expect(r.casadas).toEqual([]);
  });

  it('entrada (valor positivo) nunca paga nada', () => {
    const r = casar([lib(1, 170.32)], [{ ...saida(100, 170.32), valor: 170.32 }]);
    expect(r.casadas).toEqual([]);
  });

  it('duas liberações iguais (mesmo fornecedor e valor) e duas saídas: cada uma com a sua, a mais antiga primeiro', () => {
    const r = casar([lib(2, 136.65, 'ALARES TELECOM', { venc: '2026-11-10' }), lib(1, 136.65, 'ALARES TELECOM', { venc: '2026-11-09' })], [saida(101, 136.65, 'ALARES TELECOM', { data: '2026-11-21' }), saida(100, 136.65, 'ALARES TELECOM', { data: '2026-11-19' })]);
    expect(r.casadas.map((c) => [c.liberacoes[0], c.saida.id])).toEqual([
      [1, 100],
      [2, 101],
    ]);
  });

  it('duas liberações iguais e só uma saída: baixa a de vencimento mais antigo', () => {
    const r = casar([lib(2, 136.65, 'ALARES TELECOM', { venc: '2026-11-10' }), lib(1, 136.65, 'ALARES TELECOM', { venc: '2026-11-09' })], [saida(100, 136.65)]);
    expect(r.casadas).toHaveLength(1);
    expect(r.casadas[0].liberacoes).toEqual([1]);
    expect(r.semSaida.map((x) => x.id)).toEqual([2]);
  });

  it('mais saídas possíveis do que liberações, em dias diferentes: não casa (não tem estorno)', () => {
    const r = casar([lib(1, 136.65)], [saida(100, 136.65, 'ALARES TELECOM', { data: '2026-11-19' }), saida(101, 136.65, 'ALARES TELECOM', { data: '2026-11-21' })]);
    expect(r.casadas).toEqual([]);
    expect(r.semSaida[0].motivo).toMatch(/2 saídas possíveis/);
  });

  it('mais saídas do que liberações, mas na mesma conta e no mesmo dia: casa (data e banco são os mesmos)', () => {
    const r = casar([lib(1, 136.65)], [saida(100, 136.65), saida(101, 136.65)]);
    expect(r.casadas).toHaveLength(1);
    expect(r.casadas[0].saida.id).toBe(100);
  });

  it('a mesma saída não paga duas liberações de fornecedores diferentes', () => {
    const r = casar([lib(1, 300, 'ALARES TELECOM'), lib(2, 300, 'ALARES TELECOM NORDESTE', { code: 11, doc: '11111111000111' })], [saida(100, 300, 'ALARES TELECOM')]);
    expect(r.casadas).toHaveLength(1);
    expect(r.semSaida).toHaveLength(1);
  });
});

describe('uma saída = soma de liberações do mesmo fornecedor', () => {
  it('casa a soma exata', () => {
    const r = casar([lib(1, 100), lib(2, 250.5), lib(3, 40)], [saida(100, 350.5)]);
    expect(r.casadas).toHaveLength(1);
    expect(r.casadas[0]).toMatchObject({ tipo: 'soma', liberacoes: [1, 2] });
    expect(r.semSaida.map((x) => x.id)).toEqual([3]);
  });

  it('valores repetidos não confundem: a combinação de valores é a mesma', () => {
    const r = casar([lib(1, 100, 'ALARES TELECOM', { venc: '2026-11-01' }), lib(2, 100, 'ALARES TELECOM', { venc: '2026-11-02' }), lib(3, 50, 'ALARES TELECOM', { venc: '2026-11-03' })], [saida(100, 150)]);
    expect(r.casadas).toHaveLength(1);
    expect(r.casadas[0].liberacoes).toEqual([1, 3]);
  });

  it('duas combinações diferentes dão o mesmo total: não casa', () => {
    const r = casar([lib(1, 100), lib(2, 50), lib(3, 70), lib(4, 80)], [saida(100, 150)]);
    expect(r.casadas).toEqual([]);
    expect(r.semSaida).toHaveLength(4);
  });

  it('soma com sobra (juros) não casa sozinha', () => {
    const r = casar([lib(1, 100), lib(2, 200)], [saida(100, 303.17)]);
    expect(r.casadas).toEqual([]);
  });

  it('não soma liberações de fornecedores diferentes', () => {
    const r = casar([lib(1, 100), lib(2, 200, 'ALARES TELECOM', { code: 99 })], [saida(100, 300)]);
    expect(r.casadas).toEqual([]);
  });
});

describe('entradas inválidas', () => {
  it('sem a função de pontuar, falha cedo', () => {
    expect(() => casarIncluidos([lib(1, 10)], [saida(1, 10)])).toThrow(/pontua/);
  });

  it('listas vazias', () => {
    expect(casar([], [saida(1, 10)])).toEqual({ casadas: [], semSaida: [], sugestoes: [] });
    expect(casar([lib(1, 10)], []).semSaida).toHaveLength(1);
    expect(casar(null, null)).toEqual({ casadas: [], semSaida: [], sugestoes: [] });
  });
});

describe('sugestões: valor igual no extrato, mas o nome não bate', () => {
  it('a liberação não casa sozinha e a saída de mesmo valor vem como sugestão', () => {
    const r = casar([lib(1, 14250, 'J L DA LIMA CANDIDO')], [saida(7, 14250, 'LENIVALDO CANDIDO DOS SANTOS', { data: '2026-11-26' })]);
    expect(r.casadas).toEqual([]);
    expect(r.semSaida.map((x) => x.id)).toEqual([1]);
    expect(r.sugestoes).toHaveLength(1);
    expect(r.sugestoes[0].id).toBe(1);
    expect(r.sugestoes[0].saidas.map((x) => x.saida.id)).toEqual([7]);
  });

  it('valor diferente por um centavo nunca vira sugestão', () => {
    const r = casar([lib(1, 655, 'C A V DO NASCIMENTO AVIAMENTOS')], [saida(7, 655.01, 'CRISTYAN ALEX VICENTE DO NASCIMENTO')]);
    expect(r.sugestoes).toEqual([]);
  });

  it('a saída que já pagou outra duplicata (casou sozinha) não é oferecida', () => {
    const r = casar([lib(1, 100, 'ALARES TELECOM'), lib(2, 100, 'PADARIA DO ZE', { code: 20, doc: '11111111000111' })], [saida(7, 100, 'ALARES TELECOM')]);
    expect(r.casadas.map((c) => c.liberacoes)).toEqual([[1]]);
    expect(r.sugestoes).toEqual([]);
  });

  it('saída já conciliada com outra coisa não é oferecida', () => {
    const r = casar([lib(1, 47.5, 'JILVANE MARIA LIMA DA SILVA')], [saida(7, 47.5, 'MP 48221435JILVA')], new Set([7]));
    expect(r.sugestoes).toEqual([]);
  });

  it('várias saídas do mesmo valor: todas são oferecidas, a de nome mais parecido primeiro', () => {
    const r = casar([lib(1, 300, 'MARIA SOUZA LIMA', { doc: '' })], [saida(7, 300, 'JOAO PEREIRA', { data: '2026-11-25' }), saida(8, 300, 'MARIA SOUZA', { data: '2026-11-20' }), saida(9, 300, 'PEDRO ALVES', { data: '2026-11-26' })]);
    // "MARIA SOUZA" tem 2 das 3 palavras (0,66) → casaria sozinha; por isso o teste usa um nome que fica abaixo do mínimo
    const r2 = casar([lib(1, 300, 'MARIA SOUZA LIMA SANTOS OLIVEIRA', { doc: '' })], [saida(7, 300, 'JOAO PEREIRA', { data: '2026-11-25' }), saida(8, 300, 'MARIA SOUZA', { data: '2026-11-20' }), saida(9, 300, 'PEDRO ALVES', { data: '2026-11-26' })]);
    expect(r.casadas).toHaveLength(1);
    expect(r2.casadas).toEqual([]);
    expect(r2.sugestoes[0].saidas.map((x) => x.saida.id)).toEqual([8, 9, 7]);
  });

  it('mais saídas possíveis do que liberações, em dias diferentes: vira sugestão para o usuário escolher', () => {
    const r = casar([lib(1, 163.91)], [saida(7, 163.91, 'ALARES TELECOM', { data: '2026-11-18' }), saida(8, 163.91, 'ALARES TELECOM', { data: '2026-11-23' })]);
    expect(r.casadas).toEqual([]);
    expect(r.sugestoes[0].saidas.map((x) => x.saida.id)).toEqual([8, 7]);
  });
});

describe('sugestões aprovadas pelo usuário', () => {
  const sugestoes = [
    { id: 1, saidas: [{ saida: { id: 7 }, pontos: 0.2 }, { saida: { id: 8 }, pontos: 0 }] },
    { id: 2, saidas: [{ saida: { id: 7 }, pontos: 0 }] },
  ];
  it('aceita a saída que continua entre as possíveis', () => {
    const r = conferirEscolhas([{ id: 1, lancamentoId: 8 }], sugestoes);
    expect(r.aceitas.map((x) => [x.id, x.saida.id])).toEqual([[1, 8]]);
    expect(r.recusadas).toEqual([]);
  });
  it('a mesma saída não paga duas duplicatas', () => {
    const r = conferirEscolhas([{ id: 1, lancamentoId: 7 }, { id: 2, lancamentoId: '7' }], sugestoes);
    expect(r.aceitas.map((x) => x.id)).toEqual([1]);
    expect(r.recusadas).toEqual([{ id: 2, motivo: 'a mesma saída foi escolhida para outra duplicata: cada saída paga uma só' }]);
  });
  it('saída que não está mais disponível, ou duplicata sem sugestão: recusa com o motivo', () => {
    const r = conferirEscolhas([{ id: 1, lancamentoId: 99 }, { id: 5, lancamentoId: 7 }], sugestoes);
    expect(r.aceitas).toEqual([]);
    expect(r.recusadas.map((x) => x.id)).toEqual([1, 5]);
    expect(r.recusadas[0].motivo).toMatch(/não está mais disponível/);
    expect(r.recusadas[1].motivo).toMatch(/não há mais saída/);
  });
  it('ignora lixo e duplicata repetida no pedido', () => {
    const r = conferirEscolhas([null, { id: 'x', lancamentoId: 7 }, { id: 1 }, { id: 1, lancamentoId: 7 }, { id: 1, lancamentoId: 8 }], sugestoes);
    expect(r.aceitas.map((x) => [x.id, x.saida.id])).toEqual([[1, 7]]);
    expect(conferirEscolhas(undefined, sugestoes)).toEqual({ aceitas: [], recusadas: [] });
  });
});
