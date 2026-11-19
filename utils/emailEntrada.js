// Leitura pura (sem rede) dos e-mails encaminhados para o HeadCoach: quem
// escreveu, o texto e o código de confirmação que as operadoras mandam.

// letras acentuadas escritas por nome no HTML ("c&oacute;digo")
const ACENTOS = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈' };
const SOLTAS = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ccedil: 'ç', Ccedil: 'Ç', ordm: 'º', ordf: 'ª', deg: '°' };

/** HTML → texto simples (o bastante para achar um código ou ler um aviso). */
export function htmlParaTexto(html) {
  return String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([A-Za-z])(acute|grave|circ|tilde|uml);/g, (_, letra, acento) => (letra + ACENTOS[acento]).normalize('NFC'))
    .replace(/&([A-Za-z]+);/g, (tudo, nome) => SOLTAS[nome] ?? tudo)
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * Código de confirmação escrito no e-mail: 4 a 10 dígitos
 * perto das palavras código / code / token / verificação. Devolve null se não
 * houver um candidato claro — o bot não chuta código.
 */
export function codigoDoEmail(assunto, texto) {
  const tudo = `${assunto || ''}\n${texto || ''}`;
  const PALAVRA = '(?:c[oó]digo|code|token|senha tempor[aá]ria|verifica[çc][aã]o|confirma[çc][aã]o|autentica[çc][aã]o)';
  // "código: 123456", "código de verificação é 123456", "seu código 12 34 56"
  const depois = tudo.match(new RegExp(`${PALAVRA}[^\\d\\n]{0,60}?(\\d(?:[\\s-]?\\d){3,9})(?!\\d)`, 'i'));
  if (depois) return depois[1].replace(/\D/g, '');
  // "123456 é o seu código"
  const antes = tudo.match(new RegExp(`(?<!\\d)(\\d{4,10})(?!\\d)[^\\d\\n]{0,40}?${PALAVRA}`, 'i'));
  if (antes) return antes[1];
  // código sozinho numa linha, num e-mail que fala de código
  if (new RegExp(PALAVRA, 'i').test(tudo)) {
    const sozinho = tudo.match(/^\s*(\d{4,10})\s*$/m);
    if (sozinho) return sozinho[1];
  }
  return null;
}

/** "Fulano <a@b.com>" → { nome, endereco } em minúsculas. */
export function lerRemetente(valor) {
  const s = String(valor || '').trim();
  const m = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  const endereco = (m ? m[2] : s).trim().toLowerCase();
  return { nome: m ? m[1].trim() || null : null, endereco: /^[^\s@]+@[^\s@]+$/.test(endereco) ? endereco : null };
}

/** O e-mail é de um dos domínios (ou endereços) aceitos? Vazio = aceita qualquer um. */
export function remetenteAceito(endereco, aceitos) {
  const lista = (aceitos || []).map((a) => String(a).trim().toLowerCase()).filter(Boolean);
  if (!lista.length) return true;
  const e = String(endereco || '').toLowerCase();
  const dominio = e.split('@')[1] || '';
  return lista.some((a) => (a.includes('@') ? e === a : dominio === a || dominio.endsWith(`.${a}`)));
}
