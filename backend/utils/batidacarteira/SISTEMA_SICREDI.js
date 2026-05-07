/**
 * Parser para arquivo CSV exportado do sistema (portador Sicredi = 748)
 *
 * Mesmo formato que SISTEMA_CONFIANCA (CLIENTE;;CPF/CNPJ;EMPRESA;...).
 * A diferença é que as linhas são filtradas por portador 748.
 *
 * Encoding esperado: UTF-8 ou latin1
 */

import { processSistemaConfiancaFile } from './SISTEMA_CONFIANCA.js';

export function processSistemaSicrediFile(fileContent) {
  // Reutiliza o mesmo parser — o formato do arquivo é idêntico.
  // O portador 748 vs 422 já é separado no momento da exportação;
  // se o arquivo contiver ambos, todos serão importados.
  const result = processSistemaConfiancaFile(fileContent);

  // Reescreve o campo banco para identificar como Sicredi
  result.registros = result.registros.map((r) => ({ ...r, banco: 'SICREDI' }));

  return result;
}
