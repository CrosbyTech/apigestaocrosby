// Validação local de documentos (CPF/CNPJ) com dígito verificador.
// Evita roundtrip ao TOTVS em casos de typo (que retornaria 400 confuso),
// e dá mensagem de erro mais clara pro usuário.

/**
 * Valida CPF (11 dígitos) verificando os 2 dígitos de controle.
 * Aceita string com/sem máscara. Retorna { ok, cpf, error }.
 */
export function validarCPF(input) {
  const cpf = String(input || '').replace(/\D/g, '');
  if (cpf.length !== 11) {
    return { ok: false, cpf, error: 'CPF precisa ter 11 dígitos' };
  }
  // Rejeita sequências repetidas (000..., 111..., etc.) que passam no algoritmo
  if (/^(\d)\1{10}$/.test(cpf)) {
    return { ok: false, cpf, error: 'CPF inválido (todos dígitos iguais)' };
  }
  // Primeiro dígito verificador
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
  let d1 = (soma * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) {
    return { ok: false, cpf, error: 'CPF inválido (dígito verificador 1)' };
  }
  // Segundo dígito verificador
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
  let d2 = (soma * 10) % 11;
  if (d2 === 10) d2 = 0;
  if (d2 !== parseInt(cpf[10], 10)) {
    return { ok: false, cpf, error: 'CPF inválido (dígito verificador 2)' };
  }
  return { ok: true, cpf };
}

/**
 * Valida CNPJ (14 dígitos) verificando os 2 dígitos de controle.
 * Retorna { ok, cnpj, error }.
 */
export function validarCNPJ(input) {
  const cnpj = String(input || '').replace(/\D/g, '');
  if (cnpj.length !== 14) {
    return { ok: false, cnpj, error: 'CNPJ precisa ter 14 dígitos' };
  }
  if (/^(\d)\1{13}$/.test(cnpj)) {
    return { ok: false, cnpj, error: 'CNPJ inválido (todos dígitos iguais)' };
  }
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += parseInt(cnpj[i], 10) * pesos1[i];
  let d1 = soma % 11;
  d1 = d1 < 2 ? 0 : 11 - d1;
  if (d1 !== parseInt(cnpj[12], 10)) {
    return { ok: false, cnpj, error: 'CNPJ inválido (dígito verificador 1)' };
  }
  soma = 0;
  for (let i = 0; i < 13; i++) soma += parseInt(cnpj[i], 10) * pesos2[i];
  let d2 = soma % 11;
  d2 = d2 < 2 ? 0 : 11 - d2;
  if (d2 !== parseInt(cnpj[13], 10)) {
    return { ok: false, cnpj, error: 'CNPJ inválido (dígito verificador 2)' };
  }
  return { ok: true, cnpj };
}

/**
 * Normaliza telefone BR — retorna só dígitos (10 ou 11).
 * Aceita números com DDI 55 e remove.
 */
export function normalizarTelefone(input) {
  let phone = String(input || '').replace(/\D/g, '');
  // Remove DDI 55 se vier (whatsapp pode incluir)
  if (phone.length >= 12 && phone.startsWith('55')) {
    phone = phone.slice(2);
  }
  if (phone.length !== 10 && phone.length !== 11) {
    return { ok: false, phone, error: 'Telefone precisa ter 10 ou 11 dígitos (DDD + número)' };
  }
  return { ok: true, phone };
}

/**
 * Valida CEP (8 dígitos numéricos).
 */
export function validarCEP(input) {
  const cep = String(input || '').replace(/\D/g, '');
  if (cep.length !== 8) {
    return { ok: false, cep, error: 'CEP precisa ter 8 dígitos' };
  }
  return { ok: true, cep };
}
