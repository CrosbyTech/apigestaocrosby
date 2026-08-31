// CNPJs consultados na Distribuição DFe da SEFAZ.
// A DFe é por CNPJ de 14 dígitos: ela devolve exatamente o que foi emitido
// contra aquele estabelecimento. Por isso a filial não é inferida da nota —
// ela é determinada por qual CNPJ fez a consulta.
// O certificado A1 da matriz autoriza consultar qualquer CNPJ da mesma raiz,
// então os 5 certificados cobrem todas as filiais abaixo.
// Código e nome vêm do cadastro de filiais do TOTVS (/api/totvs/branches).
export const FILIAIS = [
  { codigo: 1, cnpj: '17177680000116', nome: 'CROSBY MATRIZ', cert: 'ferreira-comercio.pfx' },
  { codigo: 2, cnpj: '17177680000205', nome: 'CROSBY JOAO PESSOA', cert: 'ferreira-comercio.pfx' },
  { codigo: 5, cnpj: '33592092000103', nome: 'CROSBY NOVA CRUZ', cert: 'irmaos-cr-vestuario.pfx' },
  { codigo: 6, cnpj: '17177680000388', nome: 'CROSBY RECIFE', cert: 'ferreira-comercio.pfx' },
  { codigo: 11, cnpj: '27728810000115', nome: 'CROSBY NATAL', cert: 'fa-moda-varejo.pfx' },
  { codigo: 55, cnpj: '53661116000138', nome: 'CROSBY PARNAMIRIM', cert: 'irmaos-varejo-comercial.pfx' },
  { codigo: 65, cnpj: '27728810000620', nome: 'CROSBY CANGUARETAMA', cert: 'fa-moda-varejo.pfx' },
  { codigo: 87, cnpj: '27728810000972', nome: 'CROSBY SHOPPING CIDADE JARDIM', cert: 'fa-moda-varejo.pfx' },
  { codigo: 88, cnpj: '27728810001006', nome: 'CROSBY SHOPPING GUARARAPES', cert: 'fa-moda-varejo.pfx' },
  { codigo: 89, cnpj: '27728810001197', nome: 'CROSBY SHOPPING TACARUNA', cert: 'fa-moda-varejo.pfx' },
  { codigo: 90, cnpj: '17177680001430', nome: 'CROSBY AYRTON SENNA', cert: 'ferreira-comercio.pfx' },
  { codigo: 91, cnpj: '17177680001350', nome: 'CROSBY SHOPPING MACEIO', cert: 'ferreira-comercio.pfx' },
  { codigo: 92, cnpj: '27728810000387', nome: 'CROSBY CASCAVEL', cert: 'fa-moda-varejo.pfx' },
  { codigo: 93, cnpj: '17177680001279', nome: 'CROSBY IMPERATRIZ', cert: 'ferreira-comercio.pfx' },
  { codigo: 94, cnpj: '17177680001198', nome: 'CROSBY SHOPPING PATOS', cert: 'ferreira-comercio.pfx' },
  { codigo: 95, cnpj: '27728810000549', nome: 'CROSBY SHOPPING MIDWAY', cert: 'fa-moda-varejo.pfx' },
  { codigo: 96, cnpj: '17177680000892', nome: 'CROSBY SHOPPING PATTEO OLINDA', cert: 'ferreira-comercio.pfx' },
  { codigo: 97, cnpj: '17177680000973', nome: 'CROSBY SHOPPING TERESINA', cert: 'ferreira-comercio.pfx' },
  { codigo: 98, cnpj: '36569459000158', nome: 'CROSBY SHOPPING RECIFE', cert: 'shopping-recife.pfx' },
  { codigo: 99, cnpj: '17177680001007', nome: 'CROSBY BREJINHO', cert: 'ferreira-comercio.pfx' },
  // Filial 31 (CROSBY FORTALEZA, 17757554000130) fica de fora: a raiz do CNPJ
  // nao corresponde a nenhum dos certificados que temos.
];

export const filialPorCnpj = (cnpj) =>
  FILIAIS.find((f) => f.cnpj === String(cnpj || '').replace(/\D/g, '')) || null;

export const filialPorCodigo = (codigo) =>
  FILIAIS.find((f) => f.codigo === parseInt(codigo)) || null;

export default { FILIAIS, filialPorCnpj, filialPorCodigo };
