// Leitura pura (sem rede) do que o bot de contas fixas precisa: os dados da
// conta na observação da Controle de Filiais e as respostas da Cosern no WhatsApp.
import { cpfValido, cnpjValido } from './stoneInclusao.js';

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * Código(s) do cliente da Cosern (70xxxxxxxx) e documento do titular escritos na
 * observação. Prefere o documento que vem depois de "CPF"/"CNPJ"; o dígito
 * verificador descarta UC e outros números parecidos.
 * A UC ("UC: 556.891.032-05") é o que a Cosern pede quando não oferece o código do cliente.
 * @returns {{ codigos: string[], ucs: string[], documento: string|null, tipoDocumento: 'CPF'|'CNPJ'|null, ambiguo: boolean }}
 */
export function lerContaDaObservacao(obs) {
  const texto = String(obs ?? '');
  const codigos = [...new Set([...texto.matchAll(/(?<!\d)0{0,2}(70\d{8})(?!\d)/g)].map((m) => m[1]))];
  const ucs = [...new Set([...texto.matchAll(/\bUC:?\s*([\d.]{5,}-?\d{2})/gi)].map((m) => soDigitos(m[1])))];
  const DOC = /(?<!\d)(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/g;
  const valido = (d) => (d.length === 14 ? cnpjValido(d) : d.length === 11 ? cpfValido(d) : false);
  const todos = [...new Set([...texto.matchAll(DOC)].map((m) => soDigitos(m[1])).filter(valido))];
  const rotulados = [...new Set([...texto.matchAll(/(?:CPF|CNPJ)[^\d\n]{0,40}([\d./-]{11,18})/gi)].map((m) => soDigitos(m[1])).filter(valido))];
  const lista = rotulados.length ? rotulados : todos;
  const documento = lista[0] || null;
  return { codigos, ucs, documento, tipoDocumento: documento ? (documento.length === 14 ? 'CNPJ' : 'CPF') : null, ambiguo: lista.length > 1 };
}

const paramsDoBotao = (conteudo) => {
  const b = conteudo?.InteractiveMessage?.NativeFlowMessage?.buttons?.[0];
  if (!b) return null;
  let p = b.buttonParamsJSON;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch {
      p = {};
    }
  }
  return { nome: b.name || '', cta: p?.flow_cta || p?.display_text || '', fluxo: p?.flow_metadata?.flow_name || '' };
};

/**
 * Em que ponto a conversa com a Cosern está, pela última mensagem recebida.
 * @param ultima { texto, tipo, conteudo } (buscarMensagens com comConteudo)
 */
export function passoDaCosern(ultima) {
  if (!ultima) return 'aguardando';
  // mensagens de botões e de lista trazem o texto dentro do conteúdo
  const texto = String(ultima.texto || ultima.conteudo?.contentText || ultima.conteudo?.description || '');
  if (/2ª via de outra fatura/i.test(texto)) return 'outra_fatura';
  const botao = paramsDoBotao(ultima.conteudo);
  if (lerListaDeFaturas(ultima.conteudo).length) return 'lista_faturas';
  if (botao?.nome === 'galaxy_message') {
    if (/identifica/i.test(botao.fluxo)) return 'identificar';
    if (/menu/i.test(botao.fluxo)) return 'menu';
    return 'formulario_desconhecido';
  }
  if (/n[aã]o entendi/i.test(texto)) return 'nao_entendi';
  if (/n[aã]o [eé] uma nota v[aá]lida/i.test(texto)) return 'avaliacao';
  if (/n[aã]o tem nenhuma fatura/i.test(texto)) return 'sem_fatura';
  if (/Encontrei \*?\d+\*? faturas?/i.test(texto) || /informa[çc][oõ]es para pagamento da fatura/i.test(texto) || /^000201/.test(texto.trim()) || /o que achou deste atendimento/i.test(texto)) return 'resultado';
  if (/n[aã]o (localizei|encontrei|consegui)|dados? (inv[aá]lid|incorret)|n[aã]o conferem/i.test(texto)) return 'dados_recusados';
  if (/vou encerrar|atendimento finalizado|agradecemos o seu contato|n[aã]o estamos conseguindo nos entender/i.test(texto)) return 'encerrou';
  return 'aguardando';
}

const valorBr = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));

/**
 * Junta o que a Cosern mandou depois do pedido de 2ª via.
 * @param mensagens recebidas (não as nossas), em ordem de chegada
 * @returns {{ semFatura, qtd, faturas: [{valor, vencimento}], pix: string[], pdfs: string[] }}
 */
export function lerRespostaCosern(mensagens) {
  const out = { semFatura: false, qtd: 0, faturas: [], pix: [], pdfs: [] };
  for (const m of mensagens || []) {
    const texto = String(m.texto || '').trim();
    if (/n[aã]o tem nenhuma fatura/i.test(texto)) out.semFatura = true;
    const q = texto.match(/Encontrei \*?(\d+)\*? faturas?/i);
    if (q) out.qtd = Number(q[1]);
    const valores = [...texto.matchAll(/Valor\*?:\s*(?:R\$\s*)+([\d.]+,\d{2})/gi)].map((x) => valorBr(x[1]));
    const vencs = [...texto.matchAll(/Vencimento\*?:\s*(\d{2})\/(\d{2})\/(\d{4})/gi)].map((x) => `${x[3]}-${x[2]}-${x[1]}`);
    valores.forEach((valor, i) => out.faturas.push({ valor, vencimento: vencs[i] || null }));
    if (/^000201/.test(texto)) out.pix.push(texto);
    if (/document/i.test(m.tipo || '')) out.pdfs.push(m.id);
  }
  return out;
}

const dias = (a, b) => Math.abs(new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000;

/**
 * Título da Liberação que corresponde à fatura: mesmo valor (centavo a centavo),
 * vencimento a até 5 dias, ainda não pago e sem Pix/boleto preenchido. Só devolve
 * quando sobra UM candidato; na dúvida não liga nada.
 * @param fatura { valor, vencimento }
 * @param titulos linhas de pagamentos_liberacao da concessionária
 */
export function escolherTitulo(fatura, titulos) {
  if (!fatura?.valor || !fatura?.vencimento) return null;
  const candidatos = (titulos || []).filter((t) => {
    const valor = Number(t.vl_real ?? t.vl_duplicata ?? 0);
    const venc = String(t.dt_vencimento || '').slice(0, 10);
    return !['PAGO', 'CANCELADO'].includes(t.status) && !t.chave_pix && !t.codigo_barras && Math.abs(valor - fatura.valor) < 0.005 && venc && dias(venc, fatura.vencimento) <= 5;
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * Quando há mais de uma fatura em aberto a Cosern manda uma lista para escolher.
 * @returns [{ titulo, valor, vencimento }] (vazio se a mensagem não é essa lista)
 */
export function lerListaDeFaturas(conteudo) {
  const linhas = (conteudo?.sections || []).flatMap((s) => s.rows || []);
  return linhas
    .map((l) => {
      const m = String(l.description || '').match(/R\$\s*([\d.]+,\d{2}).*?(\d{2})\/(\d{2})\/(\d{4})/);
      return m && /^Fatura \d+$/i.test(String(l.title || '').trim()) ? { titulo: String(l.title).trim(), valor: valorBr(m[1]), vencimento: `${m[4]}-${m[3]}-${m[2]}` } : null;
    })
    .filter(Boolean);
}

/** Valor (campo 54) de um Pix copia e cola; null se o código não traz valor. */
export function valorDoPix(copiaCola) {
  const s = String(copiaCola || '').trim();
  for (let i = 0; i + 4 <= s.length; ) {
    const id = s.slice(i, i + 2);
    const tam = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || Number.isNaN(tam)) return null;
    const valor = s.slice(i + 4, i + 4 + tam);
    if (id === '54') return Number(valor);
    i += 4 + tam;
  }
  return null;
}
