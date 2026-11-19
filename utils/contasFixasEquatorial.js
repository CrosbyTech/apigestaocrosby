// Leitura pura (sem rede) da conversa com a Equatorial Maranhão (Clara) no
// WhatsApp. Como na Energisa, a conversa é toda por texto: menus, botões e
// listas aceitam a resposta digitada.
import { lerContaDaObservacao } from './contasFixasWhatsapp.js';
import { textoDaMensagem } from './contasFixasEnergisa.js';

const semZeros = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
const valorBr = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const linhasDaLista = (m) => (m?.conteudo?.sections || []).flatMap((s) => s.rows || []).map((l) => String(l.title || '').trim());

/**
 * Conta da Equatorial na observação da Controle de Filiais:
 * "está no CPF do antigo locatário: 09708306452 / Conta contrato: 003008536090".
 * @returns {{ contaContrato: string|null, documento: string|null }}
 */
export function lerContaEquatorialDaObservacao(obs) {
  const conta = String(obs ?? '').match(/conta\s*contrato:?\s*(\d{6,12})/i);
  return { contaContrato: conta ? conta[1] : null, documento: lerContaDaObservacao(obs).documento };
}

/**
 * Em que ponto a conversa com a Equatorial está, pela última mensagem recebida.
 * @param ultima { texto, tipo, conteudo } (buscarMensagens com comConteudo)
 */
export function passoDaEquatorial(ultima) {
  if (!ultima) return 'aguardando';
  const texto = textoDaMensagem(ultima);
  const lista = linhasDaLista(ultima);
  if (lista.some((l) => /pagar com pix/i.test(l))) return 'menu_pagamento';
  if (lista.some((l) => /segunda via de fatura/i.test(l))) return 'menu';
  if (/vamos realizar a sua identifica[çc][aã]o/i.test(texto)) return 'identificar';
  if (/digite sua \*?unidade consumidora/i.test(texto)) return 'pedir_uc';
  if (/para esse im[oó]vel que voc[eê] deseja atendimento/i.test(texto)) return 'confirmar_imovel';
  if (/qual conta voc[eê] quer receber agora/i.test(texto)) return 'lista_contas';
  if (/4 primeiros d[ií]gitos/i.test(texto)) return 'validar_inicio';
  if (/4 [uú]ltimos d[ií]gitos/i.test(texto)) return 'validar_fim';
  if (/quer receber alguma outra conta/i.test(texto)) return 'outra_conta';
  if (/posso te ajudar com mais alguma coisa/i.test(texto)) return 'algo_mais';
  if (/o que achou da nossa conversa|muito satisfeito/i.test(texto)) return 'pesquisa';
  if (/n[aã]o (encontrei|localizei|h[aá]|existem?|possui|tem)[^.]{0,50}(conta|fatura|d[eé]bito)s?[^.]{0,25}abert|est[aá] em dia|nenhuma (conta|fatura)/i.test(texto)) return 'sem_fatura';
  if (/n[aã]o (encontrei|localizei)|(unidade|n[uú]mero) (inv[aá]lid|incorret)/i.test(texto)) return 'dados_recusados';
  if (/n[aã]o entendi|op[çc][aã]o inv[aá]lida|est[aá] inv[aá]lido/i.test(texto)) return 'nao_entendi';
  return 'aguardando';
}

/**
 * Contas em aberto da lista "Qual conta você quer receber agora?".
 * @returns [{ opcao, referencia: 'MM/AAAA', valor, vencimento: 'AAAA-MM-DD' }]
 */
export function lerContasAbertas(texto) {
  const out = [];
  for (const m of String(texto ?? '').matchAll(/\*?(\d+)\*?\s*-\s*\*?Refer[êe]ncia:?\*?\s*(\d{2}\/\d{4})\s*-\s*\*?Valor:?\*?\s*R\$\s*([\d.]+,\d{2})\s*-\s*\*?Vencimento:?\*?\s*(\d{2})\/(\d{2})\/(\d{4})/gi)) {
    out.push({ opcao: Number(m[1]), referencia: m[2], valor: valorBr(m[3]), vencimento: `${m[6]}-${m[5]}-${m[4]}` });
  }
  return out;
}

/**
 * Quais contas da lista o bot deve pegar: a da competência pedida; ou todas; ou,
 * por padrão, só a última em aberto (a de vencimento mais novo — a conta do mês).
 * Conta antiga em aberto na concessionária pode já ter sido paga: não sobe sozinha.
 */
export function contasParaPegar(abertas, { referencia = null, todas = false } = {}) {
  const lista = abertas || [];
  if (referencia) return lista.filter((c) => c.referencia === referencia);
  if (todas || lista.length <= 1) return lista;
  return [lista.reduce((a, b) => (b.vencimento > a.vencimento ? b : a))];
}

/**
 * O que a Equatorial disse ao achar o imóvel: conta contrato, a UC nova e o endereço.
 * @returns {{ contaContrato, uc, rua, cidade }} (dígitos sem zeros à esquerda)
 */
export function lerImovelEquatorial(texto) {
  const t = String(texto ?? '');
  const conta = t.match(/Conta Contrato\*? atual [eé] (\d{6,15})/i);
  const uc = t.match(/numera[çc][aã]o ser[aá] (\d{9,18})/i);
  const rua = t.match(/\*?Rua:?\*?\s*([^,*\n]+)/i);
  const cidade = t.match(/\*?Cidade:?\*?\s*([^,*\n]+)/i);
  return { contaContrato: conta ? semZeros(conta[1]) : null, uc: uc ? semZeros(uc[1]) : null, rua: rua ? rua[1].trim() : null, cidade: cidade ? cidade[1].trim() : null };
}

/** Código Pix copia e cola de uma mensagem da Equatorial (vem como texto e dentro do botão de pagamento). */
export function pixDaMensagem(m) {
  const texto = textoDaMensagem(m).trim();
  if (/^000201/.test(texto)) return texto;
  for (const b of m?.conteudo?.InteractiveMessage?.NativeFlowMessage?.buttons || []) {
    let p = b.buttonParamsJSON;
    if (typeof p === 'string') {
      try {
        p = JSON.parse(p);
      } catch {
        p = null;
      }
    }
    const codigo = p?.payment_setting?.pix_dynamic_code?.code || p?.payment_settings?.[0]?.pix_dynamic_code?.code;
    if (typeof codigo === 'string' && /^000201/.test(codigo.trim())) return codigo.trim();
  }
  return null;
}

export const mesmaConta = (a, b) => Boolean(semZeros(a)) && semZeros(a) === semZeros(b);
