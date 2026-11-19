import { describe, it, expect } from '@jest/globals';
import { htmlParaTexto, codigoDoEmail, lerRemetente, remetenteAceito } from '../utils/emailEntrada.js';
import { interpretarEmail } from '../services/contasFixasEmail.js';

describe('código de confirmação no e-mail', () => {
  it.each([
    ['Seu código de verificação', 'Olá! Seu código de verificação é 482913. Ele vale por 10 minutos.', '482913'],
    ['Código: 7731', 'Use o código acima para continuar.', '7731'],
    ['Alares', 'Para confirmar sua identidade, informe o token 90 12 34 no atendimento.', '901234'],
    ['Confirmação', '556677 é o seu código de confirmação.', '556677'],
    ['Seu código chegou', 'Digite no WhatsApp:\n\n  204455  \n\nNão compartilhe.', '204455'],
    ['(#123456789) Confirmação de encaminhamento do Gmail', 'Código de confirmação: 123456789', '123456789'],
  ])('%s', (assunto, texto, codigo) => expect(codigoDoEmail(assunto, texto)).toBe(codigo));

  it('e-mail sem código não devolve número nenhum', () => {
    expect(codigoDoEmail('Sua fatura de novembro chegou', 'Valor R$ 139,99, vencimento 08/12/2026. Protocolo 20261119.')).toBeNull();
    expect(codigoDoEmail('Promoção', 'Ligue 0800 123 4567 e ganhe 500 mega.')).toBeNull();
    expect(codigoDoEmail(null, null)).toBeNull();
  });
});

describe('remetente', () => {
  it('lê nome e endereço', () => {
    expect(lerRemetente('Alares Internet <NaoResponda@AlaresInternet.com.br>')).toEqual({ nome: 'Alares Internet', endereco: 'naoresponda@alaresinternet.com.br' });
    expect(lerRemetente('a@b.com')).toEqual({ nome: null, endereco: 'a@b.com' });
    expect(lerRemetente('sem endereço')).toEqual({ nome: null, endereco: null });
  });

  it('aceita por domínio (e subdomínio) ou por endereço exato', () => {
    const aceitos = ['alaresinternet.com.br', 'faturas@inforway.com.br'];
    expect(remetenteAceito('naoresponda@alaresinternet.com.br', aceitos)).toBe(true);
    expect(remetenteAceito('x@mail.alaresinternet.com.br', aceitos)).toBe(true);
    expect(remetenteAceito('faturas@inforway.com.br', aceitos)).toBe(true);
    expect(remetenteAceito('outro@inforway.com.br', aceitos)).toBe(false);
    expect(remetenteAceito('golpe@alaresinternet.com.br.exemplo.com', aceitos)).toBe(false);
    expect(remetenteAceito('x@falsoalaresinternet.com.br', aceitos)).toBe(false);
    expect(remetenteAceito('qualquer@um.com', [])).toBe(true);
  });
});

describe('texto do e-mail', () => {
  it('tira as marcações do HTML', () => {
    expect(htmlParaTexto('<html><head><style>p{color:red}</style></head><body><p>Seu c&oacute;digo &eacute;</p><p><b>482913</b>&nbsp;v&aacute;lido</p></body></html>')).toContain('482913');
    expect(htmlParaTexto('<div>A &amp; B</div><br>linha 2')).toBe('A & B\nlinha 2');
  });

  it('mensagem crua: remetente verdadeiro, assunto, código e anexo', async () => {
    const pdf = Buffer.from('%PDF-1.4 exemplo').toString('base64');
    const cru = [
      'From: Alares Internet <naoresponda@alaresinternet.com.br>',
      'To: patrimonio@exemplo.com',
      'Subject: =?UTF-8?Q?Seu_c=C3=B3digo_de_verifica=C3=A7=C3=A3o?=',
      'Message-ID: <abc123@alaresinternet.com.br>',
      'Date: Thu, 19 Nov 2026 12:02:20 -0300',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="X"',
      '',
      '--X',
      'Content-Type: text/html; charset=UTF-8',
      '',
      '<p>Ol&aacute;!</p><p>Seu c&oacute;digo &eacute; <b>482913</b>.</p>',
      '--X',
      'Content-Type: application/pdf; name="fatura.pdf"',
      'Content-Disposition: attachment; filename="fatura.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdf,
      '--X--',
      '',
    ].join('\r\n');
    const e = await interpretarEmail(Buffer.from(cru));
    expect(e).toMatchObject({ de: 'naoresponda@alaresinternet.com.br', deNome: 'Alares Internet', assunto: 'Seu código de verificação', messageId: '<abc123@alaresinternet.com.br>', codigo: '482913' });
    expect(e.dataEnvio).toBe('2026-11-19T15:02:20.000Z');
    expect(e.anexos).toHaveLength(1);
    expect(e.anexos[0]).toMatchObject({ nome: 'fatura.pdf', tipo: 'application/pdf' });
    expect(e.anexos[0].conteudo.toString()).toBe('%PDF-1.4 exemplo');
  });
});
