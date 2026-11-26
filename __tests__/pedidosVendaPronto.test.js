import { prontoDoCard, cardVoltouAEsperar, varejoEmSeparacao, textoEmSeparacao, mapaAguardando, acharAguardando, textoAguardando, mudancasAguardando, refDoPedido } from '../services/pedidosVendaPronto.js';

// linhas reais do lv_sep_aguardando do Dryland (26/11/2026), só com os campos usados
const AGUARDANDO = [
  { ref: 'PE1640', canal: 'revenda', pecas: 2, separadas: 2, nao_achadas: 0, card_id: 'aaaaaaaa-0000-0000-0000-000000000001', cliente: 'CLIENTE A', criado_em: '2026-11-18T13:49:00+00:00' },
  { ref: 'RV1842', canal: 'revenda', pecas: 37, separadas: 20, nao_achadas: 1, card_id: 'aaaaaaaa-0000-0000-0000-000000000002', cliente: 'CLIENTE B', criado_em: '2026-11-24T21:40:00+00:00' },
  { ref: null, pecas: 3 },
];

describe('pronto pra faturar — pedidos que ainda esperam o vendedor', () => {
  const mapa = mapaAguardando(AGUARDANDO);

  test('monta o mapa por ref e por card, ignorando linha sem ref', () => {
    expect(mapa.porRef.size).toBe(2);
    expect(mapa.porCard.size).toBe(2);
    expect(mapa.porRef.get('RV1842')).toMatchObject({ pecas: 37, separadas: 20, naoAchadas: 1 });
  });

  test('acha pela chave SEP:, pela ref (qualquer caixa) e pelo id do card', () => {
    expect(acharAguardando(mapa, { chave: 'SEP:PE1640' })?.ref).toBe('PE1640');
    expect(acharAguardando(mapa, { chave: 'SEP:pe1640' })?.ref).toBe('PE1640');
    expect(acharAguardando(mapa, { chave: 'outro-card', ref: 'rv1842' })?.ref).toBe('RV1842');
    expect(acharAguardando(mapa, { chave: 'aaaaaaaa-0000-0000-0000-000000000002' })?.ref).toBe('RV1842');
  });

  test('pedido fora da lista não é travado', () => {
    expect(acharAguardando(mapa, { chave: 'SEP:VJ1894' })).toBeNull();
    expect(acharAguardando(mapa, { chave: 'bbbbbbbb-0000-0000-0000-000000000009', ref: 'MT1727' })).toBeNull();
    expect(acharAguardando(null, { chave: 'SEP:PE1640' })).toBeNull();
  });

  test('pedido com todas as peças separadas continua travado enquanto o vendedor não confirma', () => {
    const a = acharAguardando(mapa, { chave: 'SEP:PE1640' });
    expect(a.separadas).toBe(a.pecas);
    expect(textoAguardando(a)).toMatch(/PRONTO PRA FATURAR/);
    expect(textoAguardando(a)).toMatch(/PE1640 \(2 de 2 peças separadas\)/);
  });

  test('o texto conta as peças não achadas', () => {
    expect(textoAguardando(mapa.porRef.get('RV1842'))).toMatch(/20 de 37 peças separadas, 1 não achada\(s\)/);
  });

  test('o que entrou e o que saiu da lista de espera', () => {
    expect(mudancasAguardando(['PE1640', 'MT1594'], ['pe1640', 'RV1842'])).toEqual({ entraram: ['RV1842'], sairam: ['MT1594'] });
    expect(mudancasAguardando([], new Map([['RV1', 1]]).keys())).toEqual({ entraram: ['RV1'], sairam: [] });
  });

  test('refDoPedido normaliza', () => {
    expect(refDoPedido(' rv12 ')).toBe('RV12');
    expect(refDoPedido('')).toBeNull();
    expect(refDoPedido(null)).toBeNull();
  });
});

describe('pronto pra faturar — quem confirmou, pelo card da fila', () => {
  const confirmado = { em: '2026-11-26T16:15:00+00:00', obs: 'separação confirmada (botão Pronto pra faturar): AGUARDANDO FATURAMENTO no HeadCoach', por: 'Arthur', acao: 'status' };
  const esperando = { em: '2026-11-16T21:00:00+00:00', obs: 'aguardando a separação confirmar todas as peças (botão Pronto pra faturar)', por: 'max', acao: 'status' };

  test('lê do log quem marcou e quando (caso MT1594)', () => {
    expect(prontoDoCard({ dados: {}, log: [confirmado, esperando] })).toEqual({ em: '2026-11-26T16:15:00.000Z', por: 'Arthur' });
  });

  test('a ordem do log não importa: vale o evento mais novo', () => {
    expect(prontoDoCard({ log: [esperando, confirmado] })?.por).toBe('Arthur');
  });

  test('voltou a esperar depois de confirmado → não está pronto', () => {
    const voltou = { ...esperando, em: '2026-11-27T10:00:00+00:00' };
    expect(prontoDoCard({ log: [voltou, confirmado] })).toBeNull();
  });

  test('card que nasceu "a faturar" sem confirmação (varejo do site) → sem pronto', () => {
    const log = [
      { em: '2026-11-26T14:46:46+00:00', obs: 'Aguardando faturamento no HeadCoach (sem TOTVS desde 09/11)', por: 'fechar_pedidos_site (HeadCoach)', acao: 'headcoach' },
      { em: '2026-11-26T14:40:03+00:00', por: 'Site varejo (vend. 315)', acao: 'criado', status: 'a faturar' },
    ];
    expect(prontoDoCard({ dados: { faturar_em: 'HEADCOACH' }, log })).toBeNull();
  });

  test('campo próprio do card (quando o Dryland gravar) vale mais que o log', () => {
    expect(prontoDoCard({ dados: { pronto_faturar_em: '2026-11-27T12:00:00Z', pronto_faturar_por: 'Cleiton' }, log: [esperando] })).toEqual({ em: '2026-11-27T12:00:00.000Z', por: 'Cleiton' });
  });

  test('"voltou a esperar" é diferente de "a confirmação saiu do log"', () => {
    const voltou = { ...esperando, em: '2026-11-27T10:00:00+00:00' };
    expect(cardVoltouAEsperar({ log: [voltou, confirmado] })).toBe(true);
    expect(cardVoltouAEsperar({ log: [confirmado, esperando] })).toBe(false);
    // o Dryland só devolve os últimos eventos: log sem nenhum dos dois não apaga o que está guardado
    expect(cardVoltouAEsperar({ log: [{ em: '2026-11-28T10:00:00+00:00', acao: 'status', status: 'Pedido faturado' }] })).toBe(false);
    expect(cardVoltouAEsperar({ dados: { pronto_faturar_em: '2026-11-27T12:00:00Z' }, log: [voltou] })).toBe(false);
    expect(cardVoltouAEsperar(null)).toBe(false);
  });

  test('data inválida, log ausente ou card vazio não quebram', () => {
    expect(prontoDoCard({ dados: { pronto_faturar_em: 'HEADCOACH' } })).toBeNull();
    expect(prontoDoCard({ log: [{ obs: 'separação confirmada', em: 'ontem' }] })).toBeNull();
    expect(prontoDoCard({ log: 'x' })).toBeNull();
    expect(prontoDoCard(null)).toBeNull();
  });
});

describe('varejo online (VJ) — entra no Faturamento quando a separação termina', () => {
  const vj = (extra = {}) => ({ ref: 'VJ1894', canal: 'varejo', eh_venda: true, status: 'aguardando', qtd_pecas: 1, qtd_separada: 0, sumiu_do_dryland_em: null, ...extra });

  test('pago e ainda sem separar (caso de 26/11: nascia "a faturar" no pagamento) → segura', () => {
    expect(varejoEmSeparacao(vj())).toBe(true);
    expect(varejoEmSeparacao(vj({ status: 'em_separacao', qtd_pecas: 7, qtd_separada: 4 }))).toBe(true);
  });

  test('separação terminada → libera', () => {
    expect(varejoEmSeparacao(vj({ status: 'separado', qtd_separada: 1 }))).toBe(false);
  });

  test('pedido sem separação, ou cuja separação já saiu da tela do Dryland, continua como antes', () => {
    expect(varejoEmSeparacao(null)).toBe(false);
    expect(varejoEmSeparacao(vj({ sumiu_do_dryland_em: '2026-11-20T10:00:00Z' }))).toBe(false);
  });

  test('só o varejo: o atacado segue a regra do botão, e transferência não é venda', () => {
    expect(varejoEmSeparacao(vj({ ref: 'RV1842', canal: 'revenda' }))).toBe(false);
    expect(varejoEmSeparacao(vj({ ref: 'MT1860', canal: 'multimarca' }))).toBe(false);
    expect(varejoEmSeparacao(vj({ ref: 'TR485', canal: 'transferencia', eh_venda: false }))).toBe(false);
    // card da fila no canal varejo, mas a separação é de transferência (TRU-…)
    expect(varejoEmSeparacao(vj({ ref: 'TRU-TR484-MAX', canal: 'transferencia', eh_venda: false }), 'varejo')).toBe(false);
  });

  test('o texto diz quantas peças faltam', () => {
    expect(textoEmSeparacao(vj({ status: 'em_separacao', qtd_pecas: 7, qtd_separada: 4 }))).toMatch(/VJ1894 ainda está em separação no Dryland \(4 de 7 peças separadas\)/);
  });
});
