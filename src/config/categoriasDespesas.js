// Mapeamento central de códigos de despesas para categorias específicas
// Preencha/atualize estas listas com as exceções fornecidas (sem duplicar)

export const CATEGORIAS_DESPESAS = {
  // CUSTO DAS MERCADORIAS VENDIDAS (exceções específicas)
  cmv: new Set([
    271, 470, 7198, 7199, 7200, 7201, 7202, 7203,
    // do CSV
    106, 107, 108, 113,
  ]),

  // ALUGUÉIS E ARRENDAMENTOS (exceções fora das faixas padrão)
  alugueis: new Set([
    340, 341, 342, 699, 344,
    // do CSV
    5, 55, 245,
  ]),

  // DESPESAS COM PESSOAL
  pessoal: new Set([
    295, 4817, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 366, 637,
    931, 681, 683, 684, 685, 687, 698, 7204, 7205, 7206, 7207, 7208, 7209, 7210,
    492, 498,
  ]),

  // DESPESAS GERAIS
  gerais: new Set([
    // já existentes
    321, 1603, 350, 354, 355, 356, 357, 358, 359, 360, 361, 362, 363, 365, 943,
    706, 707, 708, 709, 710, 711, 712, 713, 714, 715, 716, 717, 718, 720, 721,
    722, 723, 724, 725, 726, 728, 729, 730, 731, 733, 734, 737, 738, 748, 749,
    7218, 7219, 7220, 7221, 7222, 7223, 7224,
    // do CSV classificados como gerais
    2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 18, 19, 20, 21, 22, 24, 25, 26,
    80, 81, 82, 87, 109, 120, 121, 237, 246, 247, 248, 250, 251, 256, 257, 260,
    262, 300,
    // opção A: pendentes vão para gerais
    13, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 66, 71, 83, 88, 89, 90,
    91, 92, 93, 95, 114, 116, 118, 122, 127, 128, 129, 130, 131, 132, 133, 134,
    139, 141, 145, 147, 148, 153, 154, 155, 156, 157, 207, 208, 209, 210, 211,
    212, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 243, 244,
    249, 252, 263, 264, 265, 266, 267, 274, 275,
    //depreciação
    6052,
  ]),

  // DESPESAS FINANCEIRAS
  financeiras: new Set([
    369, 370, 371, 422, 372, 7226, 373, 742, 762, 743, 375, 750,
    // do CSV
    54, 94, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 115, 119, 135, 136,
    137, 138, 144, 150, 239, 254, 258, 269, 273,
    // Exceções específicas
    12001,
  ]),

  // OUTRAS DESPESAS OPERACIONAIS
  outrasOperacionais: new Set([
    376, 377, 378, 379,
    // do CSV
    39, 40, 123, 143, 146, 149,
  ]),

  // DESPESAS C/ VENDAS
  vendas: new Set([
    1695, 7225, 744, 747, 746, 380,
    // do CSV
    17, 23, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 79, 140, 142,
    158, 200, 201, 203, 204, 205, 206, 268,
  ]),

  // IMPOSTOS (mapeamos para categoria padrão "IMPOSTOS, TAXAS E CONTRIBUIÇÕES"
  impostos: new Set([
    70, 75, 78, 84, 85, 86, 110, 117, 124, 125, 126, 151, 238, 240, 241, 242,
    255, 261, 270, 271, 272,
  ]),

  // DESPESAS OPERACIONAIS (exceções abaixo de 2000)
  operacionais: new Set([
    56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 67, 68, 69, 72, 73, 74, 76, 77, 152,
    159, 160, 161, 253, 259,
  ]),

  ativos: new Set([
    11006, 11008, 11004, 11003, 11009, 11009, 11007, 11005, 11001, 14000, 13000,
  ]),
};

// Retorna a categoria pelo código, se existir nas exceções. Caso contrário, null
export function getCategoriaPorCodigo(codigoNumero) {
  const codigo = Number(codigoNumero);
  if (Number.isNaN(codigo)) return null;

  // Ordem de precedência para resolver conflitos: impostos > operacionais > cmv > alugueis > pessoal > gerais > financeiras > outras > vendas
  if (CATEGORIAS_DESPESAS.impostos?.has(codigo))
    return 'IMPOSTOS, TAXAS E CONTRIBUIÇÕES';
  if (CATEGORIAS_DESPESAS.operacionais?.has(codigo))
    return 'DESPESAS OPERACIONAIS';
  if (CATEGORIAS_DESPESAS.cmv.has(codigo))
    return 'CUSTO DAS MERCADORIAS VENDIDAS';
  if (CATEGORIAS_DESPESAS.alugueis.has(codigo))
    return 'ALUGUÉIS E ARRENDAMENTOS';
  if (CATEGORIAS_DESPESAS.pessoal.has(codigo)) return 'DESPESAS COM PESSOAL';
  if (CATEGORIAS_DESPESAS.gerais.has(codigo)) return 'DESPESAS GERAIS';
  if (CATEGORIAS_DESPESAS.financeiras.has(codigo))
    return 'DESPESAS FINANCEIRAS';
  if (CATEGORIAS_DESPESAS.outrasOperacionais.has(codigo))
    return 'OUTRAS DESPESAS OPERACIONAIS';
  if (CATEGORIAS_DESPESAS.vendas.has(codigo)) return 'DESPESAS C/ VENDAS';
  if (CATEGORIAS_DESPESAS.ativos.has(codigo)) return 'ATIVOS';
  return null;
}
