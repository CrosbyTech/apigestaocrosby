// ============================================================
// Stone Conciliação — Configuração de lojas (StoneCodes)
//
// ⚠️ As chaves de API (sk_...) são SECRETAS e devem ficar SOMENTE no
// backend. Nunca expor no frontend. Prefira definir via variável de
// ambiente no Render (STONE_KEY_<stonecode>); o fallback embutido existe
// só para não quebrar caso a env não esteja configurada.
//
// Autenticação (fluxo "cliente Stone" / lojista):
//   GET https://conciliation.stone.com.br/v2/merchant/{stoneCode}/conciliation-file/{AAAAMMDD}
//   Header Authorization: Basic base64("<apiKey>:")  (senha vazia)
//   Header x-user-type: client   (obrigatório)
//   → responde 307 redirect para um blob Azure (com SAS token na URL);
//     o blob deve ser baixado SEM o header Authorization.
//
// A chave sk_ é gerada no Portal Stone de CADA estabelecimento
// (Perfil › Chaves de Autenticação › Criar Chave › "API de Conciliação").
// Testado em 24/09/2026: a chave de um CNPJ NÃO abre o StoneCode de outra
// filial (403 Forbidden), mesmo sendo a mesma raiz de CNPJ.
//
// A "AffiliationKey" que a Stone envia por WhatsApp é o identificador do
// consentimento do fluxo de PARCEIRO conciliador (ClientId/ClientSecret +
// consentimento por CNPJ). Ela NÃO serve como credencial neste fluxo;
// fica registrada aqui só para referência/suporte.
//
// `filiais` = código(s) da empresa no TOTVS onde os títulos de cartão desta
// maquininha são lançados (portador "STONE - <bandeira> (C|D)").
//
// A Stone dá DOIS StoneCodes por loja: um presencial (maquininha) e um ONLINE
// (Link de Pagamento / e-commerce). O arquivo de conciliação é por StoneCode,
// então vendas por link só aparecem no código online. `stonecodesExtras` lista
// os códigos adicionais do mesmo CNPJ (a chave sk_ é por CNPJ e vale para
// todos); o batimento junta as transações de todos antes de bater com o TOTVS.
// ============================================================

const envKey = (stonecode) => {
  const v = process.env[`STONE_KEY_${stonecode}`];
  return v && v.trim() ? v.trim() : null;
};

export const STONE_LOJAS = [
  {
    cnpj: '17177680000205',
    cnpjFmt: '17.177.680/0002-05',
    nome: 'CROSBY JOAO PESSOA',
    razao: 'FERREIRA COMERCIO',
    stonecode: '864768792',
    affiliationKey: 'a696c14150064fbf950718ae41ae874c',
    filiais: [2],
    apiKey: envKey('864768792') || 'sk_23cc282f1bf34b999eb1c71c2d4cdde1',
  },
  {
    cnpj: '33592092000103',
    cnpjFmt: '33.592.092/0001-03',
    nome: 'CROSBY NOVA CRUZ',
    razao: 'IRMAOS CR VESTUARIO',
    stonecode: '187229109',
    affiliationKey: 'd5073b8835da47a5873e5ae8119892cf',
    filiais: [5],
    apiKey: envKey('187229109'),
  },
  {
    cnpj: '53661116000138',
    cnpjFmt: '53.661.116/0001-38',
    nome: 'CROSBY PARNAMIRIM',
    razao: 'IRMAOS VAREJO COMERCIAL',
    // StoneCode e chave ainda não informados (14/10/2026). Sem títulos com
    // portador STONE no TOTVS nos últimos 30 dias — confirmar se usa Stone.
    stonecode: null,
    affiliationKey: null,
    filiais: [55],
    apiKey: null,
  },
  {
    cnpj: '27728810000620',
    cnpjFmt: '27.728.810/0006-20',
    nome: 'CROSBY CANGUARETAMA',
    razao: 'FA MODA & VAREJO',
    stonecode: '167972584',
    affiliationKey: null,
    filiais: [65],
    apiKey: envKey('167972584') || 'sk_bb43846402eb4866868b73c552e80a47',
  },
  {
    cnpj: '27728810000972',
    cnpjFmt: '27.728.810/0009-72',
    nome: 'CROSBY SHOPPING CIDADE JARDIM',
    razao: 'FA MODA & VAREJO',
    stonecode: '593907947',
    affiliationKey: 'def024d1b1ac4273b1974cfe187278d5',
    filiais: [87],
    apiKey: envKey('593907947') || 'sk_482e767925b243b09fc7216bcb39ed38',
  },
  {
    cnpj: '27728810001006',
    cnpjFmt: '27.728.810/0010-06',
    nome: 'CROSBY SHOPPING GUARARAPES',
    razao: 'FA MODA & VAREJO',
    stonecode: '177781981',
    affiliationKey: '1a4e28d1980f4997b7e8d20bf2a19896',
    // A Stone informou o MESMO StoneCode 177781981 para Guararapes (0010-06)
    // e Tacaruna (0011-97). Enquanto não houver StoneCode próprio, o arquivo
    // desta maquininha é batido contra os títulos das duas filiais.
    filiais: [88, 89],
    observacao:
      'StoneCode compartilhado com TACARUNA (27.728.810/0011-97) segundo a Stone — batimento considera filiais 88 e 89.',
    apiKey: envKey('177781981') || 'sk_28c40f1ca4c7472a856672fcbf9ef3ba',
  },
  {
    cnpj: '17177680001430',
    cnpjFmt: '17.177.680/0014-30',
    nome: 'CROSBY AYRTON SENNA',
    razao: 'FERREIRA COMERCIO',
    stonecode: '721608089',
    affiliationKey: 'fa250569b21e4df893c1d76bee479e04',
    filiais: [90],
    apiKey: envKey('721608089') || 'sk_85b1723d2fb34335bf39817188a543be',
  },
  {
    cnpj: '17177680001279',
    cnpjFmt: '17.177.680/0012-79',
    nome: 'CROSBY IMPERATRIZ',
    razao: 'FERREIRA COMERCIO',
    stonecode: '134006802',
    affiliationKey: '2248ce4424de44e3bc8ceef4497691c2',
    filiais: [93],
    apiKey: envKey('134006802') || 'sk_e446b100ce22438191f6c25fc89f361a',
  },
  {
    cnpj: '17177680001198',
    cnpjFmt: '17.177.680/0011-98',
    nome: 'CROSBY SHOPPING PATOS',
    razao: 'FERREIRA COMERCIO',
    stonecode: '168851294',
    affiliationKey: 'fbbb0a8aa0ff4f3f8acf0fc16d526dc6',
    filiais: [94],
    apiKey: envKey('168851294') || 'sk_a21f7b3b8eea4757bd5bc81b85dea9ac',
  },
  {
    cnpj: '27728810000549',
    cnpjFmt: '27.728.810/0005-49',
    nome: 'CROSBY SHOPPING MIDWAY',
    razao: 'FA MODA & VAREJO',
    stonecode: '192477589',
    affiliationKey: '517e82ab22c44469a6f1e8b7a5c6710d',
    filiais: [95],
    apiKey: envKey('192477589') || 'sk_d7479d172bf245998eaf0c183b254243',
  },
  {
    cnpj: '17177680000973',
    cnpjFmt: '17.177.680/0009-73',
    nome: 'CROSBY SHOPPING TERESINA',
    razao: 'FERREIRA COMERCIO',
    stonecode: '176584300',
    affiliationKey: 'b402dfa398654cb2bb3c01ae4dc93360',
    filiais: [97],
    apiKey: envKey('176584300') || 'sk_e83da2ff4ab74e0fbe2a93a37b824f95',
  },
  {
    cnpj: '17177680001007',
    cnpjFmt: '17.177.680/0010-07',
    nome: 'CROSBY BREJINHO',
    razao: 'CROSBY CR VESTUARIO',
    stonecode: '579299624',
    // Brejinho vende por Link de Pagamento: o código presencial vem sempre
    // vazio; as vendas estão no StoneCode ONLINE (informado em 14/10/2026).
    stonecodesExtras: ['425016393'],
    affiliationKey: '79c5d4e31cee4f6198a738b9ce93c504',
    filiais: [99],
    apiKey: envKey('579299624') || 'sk_c25866725e774e6786b851360ad0d728',
  },
];

export const getLojaByStonecode = (stonecode) =>
  (stonecode &&
    STONE_LOJAS.find(
      (l) =>
        (l.stonecode && String(l.stonecode) === String(stonecode)) ||
        (l.stonecodesExtras || []).some((c) => String(c) === String(stonecode)),
    )) ||
  null;

// Todos os StoneCodes de uma loja (principal + extras), sem nulos
export const stonecodesDaLoja = (loja) =>
  [loja?.stonecode, ...(loja?.stonecodesExtras || [])].filter(Boolean).map(String);

// Lojas prontas para consultar a Stone: têm chave E StoneCode
export const getLojasComChave = () => STONE_LOJAS.filter((l) => !!l.apiKey && !!l.stonecode);

// Lista pública (sem expor as chaves) para o frontend montar o seletor.
export const getLojasPublic = () =>
  STONE_LOJAS.map(
    ({ cnpj, cnpjFmt, nome, razao, stonecode, stonecodesExtras, filiais, observacao, apiKey }) => ({
      cnpj,
      cnpjFmt,
      nome,
      razao,
      stonecode,
      stonecodesExtras: stonecodesExtras || [],
      filiais,
      filial: filiais[0],
      observacao: observacao || null,
      temChave: !!apiKey,
      // sem StoneCode a loja aparece no seletor, mas não pode ser consultada
      pendente: !stonecode,
    }),
  );
