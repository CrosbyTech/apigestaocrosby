// Leitura pura (sem rede) da conversa com a CAERN (atendente virtual Caren) no
// WhatsApp. A conversa é toda por texto: menus, botões e listas aceitam a
// resposta digitada.
import { lerContaDaObservacao } from './contasFixasWhatsapp.js';
import { textoDaMensagem } from './contasFixasEnergisa.js';

const valorBr = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const linhas = (m) => (m?.conteudo?.sections || []).flatMap((s) => s.rows || []);

/**
 * Conta de água na observação da Controle de Filiais: "MATRÍCULA: 2045088 CPF TITULAR: 067…".
 * @returns {{ matricula: string|null, documento: string|null }}
 */
export function lerContaDeAguaDaObservacao(obs) {
  const m = String(obs ?? '').match(/matr[ií]cula:?\s*(\d{4,12})/i);
  return { matricula: m ? m[1] : null, documento: lerContaDaObservacao(obs).documento };
}

/**
 * Em que ponto a conversa com a CAERN está, pela última mensagem recebida.
 * @param ultima { texto, tipo, conteudo } (buscarMensagens com comConteudo)
 */
export function passoDaCaern(ultima) {
  if (!ultima) return 'aguardando';
  const texto = textoDaMensagem(ultima);
  if (/n[aã]o encontrei faturas em aberto/i.test(texto)) return 'sem_fatura';
  if (/encontrei \d+ faturas? em aberto/i.test(texto)) return 'lista_faturas';
  if (linhas(ultima).some((l) => /^segunda via$/i.test(String(l.title || '').trim()))) return 'menu';
  if (/informe o CPF ou CNPJ do titular/i.test(texto)) return 'pedir_documento';
  if (/informe a matr[ií]cula do im[oó]vel/i.test(texto)) return 'pedir_matricula';
  if (/como voc[eê] deseja continuar/i.test(texto)) return 'continuar';
  if (/avalie o nosso atendimento/i.test(texto)) return 'avaliacao';
  if (/finalizando atendimento/i.test(texto)) return 'encerrou';
  if (/inv[aá]lid[oa]|n[aã]o (localizei|encontrei|confere)|incorret[oa]/i.test(texto)) return 'dados_recusados';
  if (/n[aã]o entendi|op[çc][aã]o v[aá]lida/i.test(texto)) return 'nao_entendi';
  return 'aguardando';
}

/**
 * Faturas em aberto da lista "Encontrei N faturas em aberto. Escolha qual deseja."
 * @returns [{ titulo: 'Venc. 23/11/2026', valor, vencimento: 'AAAA-MM-DD' }]
 */
export function lerFaturasDaCaern(conteudo) {
  return linhas({ conteudo })
    .map((l) => {
      const titulo = String(l.title || '').trim();
      const venc = titulo.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const valor = String(l.description || '').match(/R\$\s*([\d.]+,\d{2})/);
      return venc && valor ? { titulo, valor: valorBr(valor[1]), vencimento: `${venc[3]}-${venc[2]}-${venc[1]}` } : null;
    })
    .filter(Boolean);
}

/**
 * Quais faturas pegar: por padrão só a de vencimento mais novo (a conta do mês);
 * conta antiga em aberto na concessionária pode já ter sido paga e não sobe sozinha.
 */
export function faturasParaPegar(abertas, { todas = false } = {}) {
  const lista = abertas || [];
  if (todas || lista.length <= 1) return lista;
  return [lista.reduce((a, b) => (b.vencimento > a.vencimento ? b : a))];
}
