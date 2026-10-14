// Dados de demonstração — formato espelha o HeadCoach real.
// No app de produção isto vem da API apigestaocrosby (TOTVS / Supabase).
window.MOCK = {
  usuario: { nome: 'Yago Matias', inicial: 'Y', loja: 'Matriz — Natal/RN' },

  // ----------------------------- RANKING DE FATURAMENTO -----------------------------
  // PDV Varejo: faturamento por loja (mês corrente)
  ranking: [
    { loja: 'Midway Mall',       uf: 'RN', fat: 487930.44, meta: 450000, pecas: 3120, ticket: 156.4 },
    { loja: 'Natal Shopping',    uf: 'RN', fat: 421560.10, meta: 430000, pecas: 2740, ticket: 153.8 },
    { loja: 'Partage Mossoró',   uf: 'RN', fat: 318220.75, meta: 300000, pecas: 2050, ticket: 155.2 },
    { loja: 'Praia Shopping',    uf: 'RN', fat: 289140.00, meta: 310000, pecas: 1880, ticket: 153.8 },
    { loja: 'Guararapes',        uf: 'PE', fat: 376410.90, meta: 360000, pecas: 2410, ticket: 156.2 },
    { loja: 'Tacaruna',          uf: 'PE', fat: 254980.33, meta: 280000, pecas: 1690, ticket: 150.9 },
    { loja: 'Parnamirim',        uf: 'RN', fat: 198770.20, meta: 210000, pecas: 1320, ticket: 150.6 },
    { loja: 'Nova Cruz',         uf: 'RN', fat: 142330.60, meta: 150000, pecas: 980,  ticket: 145.2 },
    { loja: 'Brejinho',          uf: 'PE', fat: 121890.45, meta: 120000, pecas: 820,  ticket: 148.6 },
    { loja: 'Mossoró West',      uf: 'RN', fat: 167540.10, meta: 180000, pecas: 1110, ticket: 150.9 },
  ],

  // ----------------------------- DEVOLUÇÕES DE MERCADORIA -----------------------------
  devolucoes: [
    { n: 1048, aberta: '14/10/2026 09:12', cliente: 'Maria Fernandes Lima', vendedor: 'Ana Paula', tipo: 'Troca',    pecas: 3, fotos: 2, chamado: '—',       situacao: 'Aberta',     transacao: '—' },
    { n: 1047, aberta: '13/10/2026 17:48', cliente: 'João Carlos Souza',    vendedor: 'Rafael',    tipo: 'Defeito',  pecas: 1, fotos: 4, chamado: 'DRY-882', situacao: 'Em análise', transacao: '—' },
    { n: 1046, aberta: '13/10/2026 11:05', cliente: 'Patrícia Gomes',       vendedor: 'Bruno',     tipo: 'Devolução',pecas: 2, fotos: 1, chamado: '—',       situacao: 'Concluída',  transacao: '2025008' },
    { n: 1045, aberta: '12/10/2026 15:33', cliente: 'Eduardo Martins',      vendedor: 'Ana Paula', tipo: 'Troca',    pecas: 5, fotos: 3, chamado: '—',       situacao: 'Concluída',  transacao: '2025001' },
    { n: 1044, aberta: '12/10/2026 10:20', cliente: 'Camila Ribeiro',       vendedor: 'Rafael',    tipo: 'Defeito',  pecas: 1, fotos: 5, chamado: 'DRY-879', situacao: 'Aguardando', transacao: '—' },
    { n: 1043, aberta: '11/10/2026 16:02', cliente: 'Felipe Andrade',       vendedor: 'Bruno',     tipo: 'Devolução',pecas: 2, fotos: 0, chamado: '—',       situacao: 'Aberta',     transacao: '—' },
  ],
  devolucaoDetalhe: {
    geradaEm: '13/10/2026 11:05',
    empresa: 'CROSBY MIDWAY MALL — CNPJ 00.000.000/0012-00',
    cliente: 'Patrícia Gomes',
    notaCliente: 'Produto não serviu, quer devolver.',
    transacaoTotvs: '2025008',
    itens: [
      { produto: 'Camiseta Crosby Logo — P — Preta',  recebidas: 1, faltando: 0, sobrando: 0, totvs: 'OK' },
      { produto: 'Bermuda Moletom — M — Cinza',       recebidas: 1, faltando: 0, sobrando: 0, totvs: 'OK' },
    ],
  },

  // ----------------------------- NEW FORECAST -----------------------------
  // Previsão x realizado por filial (mês corrente)
  forecast: {
    mes: 'Outubro/2026',
    linhas: [
      { filial: 'Midway Mall',    previsto: 500000, realizado: 487930, dias: 14, projecao: 1045000 },
      { filial: 'Natal Shopping', previsto: 460000, realizado: 421560, dias: 14, projecao: 903300 },
      { filial: 'Guararapes',     previsto: 390000, realizado: 376410, dias: 14, projecao: 806600 },
      { filial: 'Partage Mossoró',previsto: 330000, realizado: 318220, dias: 14, projecao: 681900 },
      { filial: 'Praia Shopping', previsto: 320000, realizado: 289140, dias: 14, projecao: 619500 },
      { filial: 'Tacaruna',       previsto: 300000, realizado: 254980, dias: 14, projecao: 546400 },
    ],
    canais: [
      { canal: 'Varejo Físico', part: 62, valor: 2148240 },
      { canal: 'Franquias',     part: 21, valor: 727500 },
      { canal: 'Multimarcas',   part: 11, valor: 381100 },
      { canal: 'E-commerce',    part: 6,  valor: 207800 },
    ],
  },
};
