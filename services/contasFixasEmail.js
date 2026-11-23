// ============================================================
// E-MAILS DAS DESPESAS FIXAS — o que a caixa de Patrimônio encaminha por filtro
// para o endereço do domínio, e a Cloudflare repassa para a API.
//
// Guarda a mensagem (quem escreveu, assunto, texto, anexos em PDF) e separa o
// código de confirmação quando há. Os bots pedem o código com esperarCodigo().
// Tabela: migrations/contas_fixas_emails.sql.
// ============================================================
import PostalMime from 'postal-mime';
import supabase from '../config/supabase.js';
import { guardarArquivoExtrato } from './fluxoCaixaExt.js';
import { htmlParaTexto, codigoDoEmail, lerRemetente, remetenteAceito } from '../utils/emailEntrada.js';

const T = 'contas_fixas_emails';
const MAX_ANEXO = 15 * 1024 * 1024;
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Mensagem crua (RFC 822) → campos que interessam. */
export async function interpretarEmail(bruto) {
  const m = await PostalMime.parse(bruto);
  const texto = (m.text && m.text.trim()) || htmlParaTexto(m.html);
  const de = lerRemetente(m.from?.address ? `${m.from.name || ''} <${m.from.address}>` : '');
  return {
    de: de.endereco,
    deNome: de.nome,
    assunto: m.subject || null,
    dataEnvio: m.date ? new Date(m.date).toISOString() : null,
    messageId: m.messageId || null,
    texto: texto ? texto.slice(0, 60000) : null, // conversa inteira encaminhada traz várias mensagens
    codigo: codigoDoEmail(m.subject, texto),
    anexos: (m.attachments || []).map((a) => ({ nome: a.filename || 'anexo', tipo: a.mimeType || '', conteudo: Buffer.from(a.content) })),
  };
}

/**
 * Guarda uma mensagem recebida. A mesma mensagem entregue duas vezes não duplica.
 * @param bruto Buffer com a mensagem crua
 * @param envelope { de, para } como a Cloudflare recebeu
 * @returns {{ id, nova, de, assunto, codigo: boolean, anexos: number, filhos: [{ id, nova }] }}
 */
export async function receberEmail(bruto, envelope = {}, nivel = 0) {
  const e = await interpretarEmail(bruto);
  if (e.messageId) {
    const { data: ja } = await supabase.from(T).select('id').eq('message_id', e.messageId).maybeSingle();
    if (ja) return { id: ja.id, nova: false, de: e.de, assunto: e.assunto, codigo: Boolean(e.codigo), anexos: 0, filhos: [] };
  }
  const anexos = [];
  const filhos = []; // e-mails que vieram anexados dentro deste ("encaminhar como anexo")
  for (const a of e.anexos) {
    const ehPdf = /pdf/i.test(a.tipo) || /\.pdf$/i.test(a.nome);
    const ehEmail = /message\/rfc822/i.test(a.tipo) || /\.eml$/i.test(a.nome);
    const item = { nome: a.nome, tipo: a.tipo, tamanho: a.conteudo.length, path: null };
    if (ehPdf && a.conteudo.length <= MAX_ANEXO) item.path = await guardarArquivoExtrato(a.conteudo, { nome: a.nome, pasta: 'contas-fixas-email' });
    if (ehEmail && nivel < 2) {
      // cada e-mail anexado é guardado como uma mensagem própria, com o remetente e os anexos originais
      const filho = await receberEmail(a.conteudo, envelope, nivel + 1);
      item.email_id = filho.id;
      filhos.push({ id: filho.id, nova: filho.nova }, ...filho.filhos);
    }
    anexos.push(item);
  }
  const { data, error } = await supabase
    .from(T)
    .insert({
      envelope_de: envelope.de || null,
      envelope_para: envelope.para || null,
      de: e.de,
      de_nome: e.deNome,
      assunto: e.assunto,
      data_envio: e.dataEnvio,
      message_id: e.messageId,
      texto: e.texto,
      codigo: e.codigo,
      anexos,
      tamanho: bruto.length,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, nova: true, de: e.de, assunto: e.assunto, codigo: Boolean(e.codigo), anexos: anexos.length, filhos };
}

/**
 * Espera chegar um e-mail com código, de um dos remetentes aceitos, recebido
 * depois de `desde`. Marca o e-mail como usado para o código não servir duas vezes.
 * @returns {Promise<{ id, codigo, de, assunto }|null>} null se não chegar a tempo
 */
export async function esperarCodigo({ remetentes = [], desde = new Date(), timeoutMs = 180000, por = null } = {}) {
  const inicio = new Date(new Date(desde).getTime() - 5000).toISOString(); // folga para relógios diferentes
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    const { data, error } = await supabase.from(T).select('id, codigo, de, assunto').gte('recebido_em', inicio).not('codigo', 'is', null).is('usado_em', null).order('recebido_em', { ascending: false }).limit(10);
    if (error) throw new Error(error.message);
    const achado = (data || []).find((m) => remetenteAceito(m.de, remetentes));
    if (achado) {
      const { data: meu } = await supabase.from(T).update({ usado_em: new Date().toISOString(), usado_por: por }).eq('id', achado.id).is('usado_em', null).select('id').maybeSingle();
      if (meu) return achado;
    }
    await dormir(4000);
  }
  return null;
}

export default { receberEmail, esperarCodigo, interpretarEmail };
