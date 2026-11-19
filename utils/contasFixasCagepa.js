// Leitura pura (sem rede) da conversa com a Cagepa (assistente virtual EVA) no
// WhatsApp. A conversa é toda por texto: menus, botões e listas aceitam a
// resposta digitada.
import { textoDaMensagem, valorDaEnergisa } from './contasFixasEnergisa.js';

const linhas = (m) => (m?.conteudo?.sections || []).flatMap((s) => s.rows || []).map((l) => String(l.title || '').trim());
const botoes = (m) => (m?.conteudo?.buttons || []).map((b) => String(b?.buttonText?.displayText || '').trim());

/**
 * Em que ponto a conversa com a Cagepa está, pela última mensagem recebida.
 * @param ultima { texto, tipo, conteudo } (buscarMensagens com comConteudo)
 */
export function passoDaCagepa(ultima) {
  if (!ultima) return 'aguardando';
  const texto = textoDaMensagem(ultima);
  if (/vamos aproveitar a oportunidade/i.test(texto)) return 'oferta_campanha';
  if (/digite todos os n[uú]meros do seu CPF ou CNPJ/i.test(texto)) return 'pedir_documento';
  if (linhas(ultima).some((l) => /^faturas\b/i.test(l))) return 'servicos';
  if (botoes(ultima).some((b) => /^conta detalhada/i.test(b))) return 'tipo_conta';
  if (/digite sua matr[ií]cula/i.test(texto)) return 'pedir_matricula';
  if (/deseja prosseguir com o atendimento utilizando o CPF\/CNPJ/i.test(texto)) return 'confirmar_documento';
  if (/qual a melhor op[çc][aã]o para voc[eê]/i.test(texto)) return 'opcoes_conta';
  if (/como voc[eê] deseja prosseguir/i.test(texto)) return 'prosseguir';
  // fim do atendimento (é também o que ela responde quando um "Oi" cai na pesquisa de uma conversa antiga)
  if (/obrigad[oa] pela avalia[çc][aã]o|foi um prazer ter voc[eê] aqui/i.test(texto)) return 'despedida';
  if (/o atendimento foi (excelente|bom|razo[aá]vel|ruim|p[eé]ssimo)|avaliar nosso atendimento/i.test(texto)) return 'pesquisa';
  if (/n[aã]o (encontrei|localizei|h[aá]|existem?|possui|tem)[^.]{0,50}(conta|fatura|d[eé]bito)s?[^.]{0,25}(abert|pendente)|nenhuma (conta|fatura)|est[aá] em dia/i.test(texto)) return 'sem_conta';
  if (/inv[aá]lid[oa]|n[aã]o (localizei|encontrei|confere)|incorret[oa]/i.test(texto)) return 'dados_recusados';
  if (/n[aã]o entendi|op[çc][aã]o v[aá]lida/i.test(texto)) return 'nao_entendi';
  return 'aguardando';
}

/**
 * "Encontrei uma conta para sua matrícula: 11/2026, R$ 190.44."
 * @returns {{ qtd: number, contas: [{ referencia, valor }] }} (qtd 0 quando o texto não fala de contas)
 */
export function lerContasDaCagepa(texto) {
  const t = String(texto ?? '');
  const uma = t.match(/Encontrei uma conta para sua matr[ií]cula:\s*(\d{2}\/\d{4}),\s*R\$\s*([\d.,]+?)\.?(?:\s|$)/i);
  if (uma && valorDaEnergisa(uma[2]) != null) return { qtd: 1, contas: [{ referencia: uma[1], valor: valorDaEnergisa(uma[2]) }] };
  const varias = t.match(/Encontrei (\d+) contas?/i);
  return { qtd: varias ? Number(varias[1]) : 0, contas: [] };
}

/** Matrícula que a Cagepa diz estar atendendo ("Para a matrícula 671762") quando lembra a da conversa anterior. */
export function matriculaLembrada(texto) {
  const m = String(texto ?? '').match(/^\s*Para a matr[ií]cula\s*(\d{4,12})/i);
  return m ? m[1] : null;
}

/** CPF/CNPJ que a Cagepa mostra ao perguntar se segue com ele. */
export function documentoConfirmado(texto) {
  const m = String(texto ?? '').match(/CPF\/CNPJ:?\s*([\d./-]{11,18})/i);
  return m ? m[1].replace(/\D/g, '') : null;
}
