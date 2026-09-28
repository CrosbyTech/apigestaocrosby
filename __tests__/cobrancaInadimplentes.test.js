import {
  telefoneWhatsApp,
  diasEntre,
  chaveTitulo,
  filtrarVencidos,
  agruparClientes,
  aplicarFiltros,
  resumir,
} from '../utils/cobrancaInadimplentes.js';

const HOJE = '2026-09-16';
const canalMtm = { key: 'MTM', filial: () => true };
const canalBlc = {
  key: 'BLUECRED',
  filial: (bc) => Number(bc) < 5999 && ![98, 980, 551].includes(Number(bc)),
};

const titulo = (extra = {}) => ({
  cd_empresa: 1,
  cd_cliente: 100,
  nr_fat: 5001,
  nr_parcela: 1,
  tp_documento: 1,
  dt_emissao: '2026-06-01T00:00:00',
  dt_vencimento: '2026-07-01T00:00:00',
  vl_fatura: 100,
  vl_juros: 2.5,
  vl_multa: 1,
  vl_pago: 0,
  dt_liq: null,
  ...extra,
});

describe('telefoneWhatsApp', () => {
  test('celular formatado vira 55DDD9XXXXXXXX', () => {
    expect(telefoneWhatsApp('(85) 9 8765-4321')).toEqual({ numero: '5585987654321', tipo: 'celular' });
  });
  test('já com DDI não duplica o 55', () => {
    expect(telefoneWhatsApp('+55 85 98765-4321').numero).toBe('5585987654321');
  });
  test('celular antigo de 8 dígitos ganha o 9', () => {
    expect(telefoneWhatsApp('8587654321').numero).toBe('5585987654321');
  });
  test('fixo é aceito mas marcado como fixo', () => {
    expect(telefoneWhatsApp('8532345678')).toEqual({ numero: '558532345678', tipo: 'fixo' });
  });
  test('inválidos viram null', () => {
    expect(telefoneWhatsApp('')).toBeNull();
    expect(telefoneWhatsApp('123')).toBeNull();
    expect(telefoneWhatsApp('0587654321')).toBeNull(); // DDD < 11
  });
});

describe('diasEntre / chaveTitulo', () => {
  test('conta dias só pela data', () => {
    expect(diasEntre('2026-07-01', HOJE)).toBe(77);
    expect(diasEntre(HOJE, HOJE)).toBe(0);
  });
  test('chave normaliza string/number', () => {
    expect(chaveTitulo({ cd_empresa: '1', nr_fat: '5001', nr_parcela: '1' })).toBe('1-5001-1');
    expect(chaveTitulo({ cd_empresa: 1, nr_fatura: 5001 })).toBe('1-5001-1');
  });
});

describe('filtrarVencidos', () => {
  const canais = new Map([
    [100, canalMtm],
    [200, canalBlc],
    [3591, canalBlc],
  ]);

  test('mantém só FATURA vencida antes de hoje, sem pagamento', () => {
    const itens = [
      titulo(),
      titulo({ nr_fat: 5002, dt_vencimento: HOJE }), // vence hoje: NÃO é vencido
      titulo({ nr_fat: 5003, tp_documento: 4 }), // cheque
      titulo({ nr_fat: 5004, vl_pago: 100, dt_liq: '2026-08-01' }), // pago
      titulo({ nr_fat: 5005, cd_cliente: 999 }), // fora dos canais
    ];
    const v = filtrarVencidos(itens, canais, HOJE);
    expect(v.map((t) => t.nr_fat)).toEqual([5001]);
    expect(v[0]._dias).toBe(77);
    expect(v[0]._canal).toBe('MTM');
  });

  test('deduplica por empresa/fatura/parcela', () => {
    const v = filtrarVencidos([titulo(), titulo(), titulo({ nr_parcela: 2 })], canais, HOJE);
    expect(v).toHaveLength(2);
  });

  test('respeita a filial do canal e exclui cliente de teste', () => {
    const itens = [
      titulo({ cd_cliente: 200, cd_empresa: 551 }), // filial fora do BlueCred
      titulo({ cd_cliente: 200, cd_empresa: 2, nr_fat: 7 }),
      titulo({ cd_cliente: 3591, cd_empresa: 2, nr_fat: 8 }), // cliente de teste
    ];
    const v = filtrarVencidos(itens, canais, HOJE);
    expect(v.map((t) => t.nr_fat)).toEqual([7]);
  });
});

describe('agruparClientes', () => {
  const canais = new Map([[100, canalMtm]]);
  const vencidos = filtrarVencidos(
    [
      titulo({ dt_vencimento: '2026-08-20' }), // 27 dias
      titulo({ nr_fat: 5002, dt_vencimento: '2026-05-01', vl_fatura: 50, vl_juros: 5, vl_multa: 0.5 }), // 138 dias
    ],
    canais,
    HOJE,
  );

  test('soma valores, marca inadimplente pelo maior atraso e prioriza telefone manual', () => {
    const [c] = agruparClientes(vencidos, {
      pessoas: { 100: { name: 'LOJA X', fantasyName: 'X', phone: '85911112222', uf: 'CE' } },
      telefoneManual: new Map([[100, '(85) 98765-4321']]),
      representante: new Map([[100, 'WALTER']]),
      nomeFilial: new Map([[1, 'CROSBY MATRIZ']]),
      emProtesto: new Set(['1-5002-1']),
    });
    expect(c.qtd_titulos).toBe(2);
    expect(c.valor_vencido).toBe(150);
    expect(c.valor_juros).toBe(7.5);
    expect(c.valor_multa).toBe(1.5);
    expect(c.valor_corrigido).toBe(159);
    expect(c.maior_atraso_dias).toBe(138);
    expect(c.situacao).toBe('inadimplente');
    expect(c.vencimento_mais_antigo).toBe('2026-05-01');
    expect(c.telefone_whatsapp).toBe('5585987654321');
    expect(c.telefone_origem).toBe('call_center');
    expect(c.representante).toBe('WALTER');
    expect(c.titulos[0].dt_vencimento).toBe('2026-05-01'); // ordenado por vencimento
    expect(c.titulos[0].em_protesto).toBe(true);
    expect(c.titulos[0].nm_empresa).toBe('CROSBY MATRIZ');
    expect(c.titulos[1].em_protesto).toBe(false);
  });

  test('sem telefone manual usa o do TOTVS; sem nenhum fica null', () => {
    const [c] = agruparClientes(vencidos, { pessoas: { 100: { phone: '85911112222' } } });
    expect(c.telefone_origem).toBe('totvs');
    expect(c.telefone_whatsapp).toBe('5585911112222');
    const [d] = agruparClientes(vencidos, {});
    expect(d.telefone_whatsapp).toBeNull();
    expect(d.nm_cliente).toBe('Cliente 100');
  });
});

describe('aplicarFiltros / resumir', () => {
  const canais = new Map([[100, canalMtm], [200, canalBlc]]);
  const clientes = agruparClientes(
    filtrarVencidos(
      [
        titulo({ dt_vencimento: '2026-08-20' }), // cliente 100: 27 dias
        titulo({ nr_fat: 5002, dt_vencimento: '2026-05-01' }), // cliente 100: 138 dias
        titulo({ cd_cliente: 200, nr_fat: 9, dt_vencimento: '2026-09-10' }), // cliente 200: 6 dias
      ],
      canais,
      HOJE,
    ),
    { pessoas: { 200: { phone: '85999990000' } } },
  );

  test('faixa de atraso recorta títulos e recalcula totais', () => {
    const r = aplicarFiltros(clientes, { diasMin: 30 });
    expect(r).toHaveLength(1);
    expect(r[0].cd_cliente).toBe(100);
    expect(r[0].qtd_titulos).toBe(1);
    expect(r[0].valor_vencido).toBe(100);
  });

  test('situacao e com_telefone filtram clientes', () => {
    expect(aplicarFiltros(clientes, { situacao: 'inadimplente' }).map((c) => c.cd_cliente)).toEqual([100]);
    expect(aplicarFiltros(clientes, { comTelefone: true }).map((c) => c.cd_cliente)).toEqual([200]);
  });

  test('resumo por canal', () => {
    const r = resumir(clientes);
    expect(r.clientes).toBe(2);
    expect(r.titulos).toBe(3);
    expect(r.valor_vencido).toBe(300);
    expect(r.por_canal.MTM.titulos).toBe(2);
    expect(r.por_canal.BLUECRED.clientes).toBe(1);
    expect(r.com_telefone_whatsapp).toBe(1);
  });
});
