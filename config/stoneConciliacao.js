// ============================================================
// Stone Conciliação — Configuração de lojas (StoneCodes)
//
// ⚠️ As chaves de API (sk_...) são SECRETAS e devem ficar SOMENTE no
// backend. Nunca expor no frontend. Prefira definir via variável de
// ambiente no Render (STONE_KEY_<stonecode>); o fallback embutido existe
// só para não quebrar caso a env não esteja configurada.
//
// Autenticação (cliente Stone / lojista):
//   GET https://conciliation.stone.com.br/v2/merchant/{stoneCode}/conciliation-file/{AAAAMMDD}
//   Header Authorization: Basic base64("<apiKey>:")  (senha vazia)
//   Header x-user-type: client   (obrigatório)
//   → responde 307 redirect para um blob Azure (com SAS token na URL);
//     o blob deve ser baixado SEM o header Authorization.
// ============================================================

export const STONE_LOJAS = [
  {
    cnpj: '17177680001007',
    cnpjFmt: '17.177.680/0010-07',
    nome: 'CROSBY CR V — 0010-07',
    stonecode: '579299624',
    affiliationKey: '79c5d4e31cee4f6198a738b9ce93c504',
    apiKey:
      process.env.STONE_KEY_579299624 ||
      'sk_c25866725e774e6786b851360ad0d728',
  },
  {
    cnpj: '27728810001006',
    cnpjFmt: '27.728.810/0010-06',
    nome: 'FA MODA & VAREJO — 0010-06',
    stonecode: '177781981',
    affiliationKey: '1a4e28d1980f4997b7e8d20bf2a19896',
    apiKey:
      process.env.STONE_KEY_177781981 ||
      'sk_28c40f1ca4c7472a856672fcbf9ef3ba',
  },
  {
    cnpj: '27728810000549',
    cnpjFmt: '27.728.810/0005-49',
    nome: 'FA MODA & VAREJO — 0005-49',
    stonecode: '192477589',
    affiliationKey: '517e82ab22c44469a6f1e8b7a5c6710d',
    apiKey:
      process.env.STONE_KEY_192477589 ||
      'sk_d7479d172bf245998eaf0c183b254243',
  },
  {
    cnpj: '27728810000972',
    cnpjFmt: '27.728.810/0009-72',
    nome: 'FA MODA & VAREJO — 0009-72',
    stonecode: '593907947',
    affiliationKey: 'def024d1b1ac4273b1974cfe187278d5',
    apiKey:
      process.env.STONE_KEY_593907947 ||
      'sk_482e767925b243b09fc7216bcb39ed38',
  },
];

export const getLojaByStonecode = (stonecode) =>
  STONE_LOJAS.find((l) => String(l.stonecode) === String(stonecode)) || null;

// Lista pública (sem expor as chaves) para o frontend montar o seletor.
export const getLojasPublic = () =>
  STONE_LOJAS.map(({ cnpj, cnpjFmt, nome, stonecode }) => ({
    cnpj,
    cnpjFmt,
    nome,
    stonecode,
  }));
