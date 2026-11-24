// Regras puras da inclusão de pagamentos na Stone (sem banco nem rede).

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function cpfValido(valor) {
  const d = soDigitos(valor);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function cnpjValido(valor) {
  const d = soDigitos(valor);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n) => {
    let soma = 0;
    let peso = n - 7;
    for (let i = 0; i < n; i++) {
      soma += Number(d[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/**
 * Chave Pix no formato que a Stone aceita. Devolve null quando não dá para ter
 * certeza do tipo: um CPF digitado errado não pode virar telefone de outra pessoa.
 */
export function normalizarChavePix(valor) {
  const bruto = String(valor ?? '').trim();
  if (!bruto) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bruto)) return { chave: bruto.toLowerCase(), tipo: 'email' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bruto)) return { chave: bruto.toLowerCase(), tipo: 'evp' };
  if (/[a-z]/i.test(bruto)) return null;
  const d = soDigitos(bruto);
  const formatado = /[./]/.test(bruto); // 000.000.000-00 só pode ser documento
  if (d.length === 14) return cnpjValido(d) ? { chave: d, tipo: 'cnpj' } : null;
  if (d.length === 11 && cpfValido(d)) return { chave: d, tipo: 'cpf' };
  if (formatado) return null;
  const telefone = (n) => (/^[1-9]{2}(9\d{8}|[2-5]\d{7})$/.test(n) ? { chave: `+55${n}`, tipo: 'telefone' } : null);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return telefone(d.slice(2));
  if (d.length === 10 || d.length === 11) return telefone(d);
  return null;
}

/** "STONE 0549" → "0549"; os rótulos antigos (STONE CROSBY…) não entram na inclusão. */
export function finalContaStone(banco) {
  const m = /^STONE (\d{4})$/.exec(String(banco ?? '').trim());
  return m ? m[1] : null;
}

/** VALOR REAL, quando preenchido, é o que vale; senão o valor da duplicata. */
export function valorDoTitulo(titulo) {
  const real = Number(titulo?.vl_real);
  return real > 0 ? real : Number(titulo?.vl_duplicata || 0);
}
export const emCentavos = (valor) => Math.round((Number(valor) + Number.EPSILON) * 100);

/** CRC16-CCITT (o dígito de conferência do Pix copia e cola: os 4 últimos caracteres). */
export function crc16(texto) {
  let crc = 0xffff;
  for (const ch of Buffer.from(String(texto), 'utf8')) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Pix COPIA E COLA (o texto do QR Code, "000201…6304XXXX"). Devolve o código limpo
 * ou null se não tiver esse formato ou se o dígito de conferência não bater
 * (código cortado ao colar não vira pagamento).
 */
export function pixCopiaECola(valor) {
  const codigo = String(valor ?? '').trim();
  if (!/^0002\d{2}/.test(codigo) || codigo.length < 60 || codigo.length > 600) return null;
  const m = /6304([0-9A-Fa-f]{4})$/.exec(codigo);
  if (!m) return null;
  return crc16(codigo.slice(0, -4)) === m[1].toUpperCase() ? codigo : null;
}

/** O dado de Pix da duplicata: chave (cpf, cnpj, e-mail, telefone, aleatória) ou copia e cola. null = não dá para pagar por Pix. */
export function dadoPix(valor) {
  const codigo = pixCopiaECola(valor);
  if (codigo) return { chave: codigo, tipo: 'brcode' };
  return normalizarChavePix(valor);
}

/**
 * Liberação de Pagamento do HeadCoach: como o bot paga esta liberação.
 *   • banco tem que ser uma conta Stone ("STONE 0549");
 *   • com chave Pix válida OU Pix copia e cola (QR Code) vai por PIX — mesmo que a
 *     duplicata também tenha boleto (preferência do Yago, 24/11/2026);
 *   • só boleto, sem chave, ou chave que não dá para ter certeza do tipo: fica para
 *     incluir à mão (o bot não inclui boleto).
 * l: { banco, valor, titulo: { chave_pix, codigo_barras } }
 * @returns {{ via: 'pix', chave, tipo, contaFinal, valorCentavos } | { via: 'manual', motivo, forma? }}
 */
export function planoDeInclusao(l) {
  const contaFinal = finalContaStone(l?.banco);
  if (!contaFinal) return { via: 'manual', motivo: l?.banco ? `o banco ${l.banco} não é uma conta Stone` : 'a liberação está sem banco' };
  const valorCentavos = emCentavos(l?.valor);
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) return { via: 'manual', motivo: 'valor inválido' };
  const chave = dadoPix(l?.titulo?.chave_pix);
  if (chave) return { via: 'pix', chave: chave.chave, tipo: chave.tipo, contaFinal, valorCentavos };
  const temBoleto = soDigitos(l?.titulo?.codigo_barras).length >= 44;
  if (temBoleto) return { via: 'manual', forma: 'boleto', motivo: 'boleto: o bot não inclui, pague pelo app da Stone' };
  const bruto = String(l?.titulo?.chave_pix || '').trim();
  if (/^0002\d{2}/.test(bruto)) return { via: 'manual', motivo: 'o Pix copia e cola da duplicata está incompleto (o código de conferência não bate)' };
  return { via: 'manual', motivo: bruto ? 'a chave Pix da duplicata não é válida' : 'a duplicata está sem chave Pix' };
}

/** Lista por conta + resumo de fornecedor e valor, para o grupo CONTAS A PAGAR. */
export function textoAvisoFabio(itens, { mencionar, assinatura = '— Veveto' } = {}) {
  const contas = [...new Set(itens.map((i) => i.conta_final))].sort();
  const marca = mencionar ? `@${mencionar}` : 'Fábio';
  const teste = itens.length > 0 && itens.every((i) => i.teste);
  const linhas = teste
    ? [`${marca}, isto é um *TESTE* do bot de inclusão na Stone. Veja se o pagamento aparece para aprovar na conta ${contas.join(', ')}.`]
    : [`${marca}, tem pagamento para aprovar na Stone.`];
  linhas.push('', '*Contas para aprovar:*', ...contas);
  linhas.push('', '*Resumo:*');
  for (const conta of contas) {
    for (const i of itens.filter((x) => x.conta_final === conta)) {
      linhas.push(`${conta} — ${i.fornecedor || 'Sem fornecedor'} — ${fmt(i.valor_centavos / 100)}`);
    }
  }
  const total = itens.reduce((s, i) => s + i.valor_centavos, 0) / 100;
  linhas.push('', `Total: *${fmt(total)}*`, '', assinatura);
  return linhas.join('\n');
}
