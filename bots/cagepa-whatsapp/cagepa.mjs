// =============================================================================
// Roteiro da conta de água da Cagepa (PB) pelo WhatsApp da EVA, (83) 98198-4495.
//
// A conversa inteira anda por texto, pela instância CONTAS A PAGAR (uazapi):
// CPF/CNPJ do titular → "Faturas" → "Conta detalhada" → matrícula → confirma o
// CPF → conta em aberto → "1" (PDF da nota) → "Com o mesmo imóvel" → "Faturas"
// → "Conta detalhada" → "5" (Pix copia e cola) → "Sair".
//
// O que o bot NUNCA aceita: a campanha de negociação de débitos do começo
// ("Vamos aproveitar a oportunidade?" → Não), parcelamento, pagamento com
// cartão e a pesquisa de satisfação do fim.
// =============================================================================
import { criarConversa } from '../comum/conversa.mjs';
import { passoDaCagepa, lerContasDaCagepa, documentoConfirmado, matriculaLembrada } from '../../utils/contasFixasCagepa.js';
import { textoDaMensagem, pixDoBotao } from '../../utils/contasFixasEnergisa.js';
import { mesmaConta } from '../../utils/contasFixasEquatorial.js';

// o JID da Cagepa não tem o nono dígito
export const NUMERO_CAGEPA = '558381984495';
const MAX_VOLTAS = 40;
const resumo = (m) => textoDaMensagem(m).replace(/\s+/g, ' ').slice(0, 90);

/**
 * Uma conversa = a conta em aberto de uma matrícula.
 * @param conta { matricula, documento: CPF/CNPJ do titular (só dígitos) }
 * @returns {{ semConta, qtd, conta: { referencia, valor }|null, pix, pdfId }}
 */
export async function pegarConta({ wa, conta, log }) {
  const c = criarConversa({ wa, numero: NUMERO_CAGEPA, ehEspera: (m) => passoDaCagepa(m) === 'aguardando', trackId: 'bot-cagepa' });
  const antes = await c.mensagens();
  const vistos = new Set(antes.map((m) => m.id)); // o que já estava na conversa não conta
  const r = { semConta: false, qtd: 0, conta: null, pix: null, pdfId: null };
  const feitos = { oi: 0, documento: 0, matricula: 0, pdf: 0, pix: 0, espera: 0, naoEntendi: 0, fim: false };
  // atendimento parado há pouco no meio do caminho: encerra (ela aceita SAIR a qualquer momento) e começa do zero
  const pendente = antes.filter((m) => !m.deMim).at(-1);
  const aberto = pendente && !['pesquisa', 'despedida', 'aguardando'].includes(passoDaCagepa(pendente)) && Date.now() - new Date(pendente.em).getTime() < 10 * 60000;
  let dizer = aberto ? 'SAIR' : 'Oi';

  for (let volta = 1; volta <= MAX_VOLTAS; volta += 1) {
    if (dizer) {
      if (dizer === 'Oi') feitos.oi += 1;
      await c.dizer(dizer);
      log(`→ ${/^\d{4,}$/.test(dizer) ? '(dados da conta)' : dizer}`);
    }
    const novas = await c.esperarResposta(vistos);
    for (const m of novas) {
      // ela lembra a matrícula da conversa anterior e pula a pergunta: vale se for a desta conta
      const lembrada = matriculaLembrada(textoDaMensagem(m));
      if (lembrada) {
        feitos.matricula = mesmaConta(lembrada, conta.matricula) ? 1 : 0;
        if (!feitos.matricula) log(`ela está atendendo outra matrícula (final ${lembrada.slice(-3)})`);
      }
      const lidas = lerContasDaCagepa(textoDaMensagem(m));
      if (lidas.qtd && feitos.matricula) {
        r.qtd = lidas.qtd;
        if (lidas.contas[0]) r.conta = lidas.contas[0];
      }
      if (passoDaCagepa(m) === 'sem_conta') r.semConta = true;
      const pix = pixDoBotao(m.conteudo);
      if (pix && feitos.pix && !r.pix) r.pix = pix;
      if (/document/i.test(m.tipo || '') && feitos.pdf && !r.pdfId) r.pdfId = m.id;
    }
    // os botões de "como prosseguir" chegam antes do PDF no mesmo lote: vale o passo mais útil do lote
    const passos = novas.map(passoDaCagepa).filter((p) => p !== 'aguardando');
    const passo = passos.at(-1) || 'aguardando';
    const ultima = novas.filter((m) => passoDaCagepa(m) === passo).at(-1) || novas.at(-1);
    log(`← ${passo}: "${resumo(ultima)}"`);
    dizer = null;
    if (feitos.fim) return r;

    if (passo === 'oferta_campanha') dizer = 'Não'; // campanha de negociação de débitos: o bot não negocia nada
    else if (passo === 'pedir_documento') {
      if (feitos.documento >= 1) throw new Error('a Cagepa pediu o CPF/CNPJ de novo: ela não aceitou o que está no cadastro');
      feitos.documento += 1;
      dizer = conta.documento;
    } else if (passo === 'servicos') dizer = 'Faturas';
    else if (passo === 'tipo_conta') dizer = 'Conta detalhada';
    else if (passo === 'pedir_matricula') {
      if (feitos.matricula >= 1) throw new Error('a Cagepa pediu a matrícula de novo: ela não aceitou a que está no cadastro');
      feitos.matricula += 1;
      dizer = conta.matricula;
    } else if (passo === 'confirmar_documento') {
      if (documentoConfirmado(textoDaMensagem(ultima)) !== conta.documento) {
        await c.dizer('Não');
        throw new Error('a Cagepa quis seguir com outro CPF/CNPJ, não o do cadastro');
      }
      dizer = 'Sim';
    } else if (passo === 'opcoes_conta') {
      if (!feitos.matricula) {
        await c.dizer('SAIR');
        throw new Error('a Cagepa mostrou a conta de outra matrícula, sem pedir a desta loja; encerrei o atendimento');
      }
      if (r.qtd !== 1 || !r.conta) throw new Error(`a Cagepa mostrou ${r.qtd || 'mais de uma'} conta(s) em aberto; o bot só conhece a tela de uma conta — "${resumo(novas.find((m) => /Encontrei/i.test(textoDaMensagem(m))) || ultima)}"`);
      if (!r.pdfId && feitos.pdf < 2) {
        feitos.pdf += 1;
        dizer = '1'; // Baixar PDF
      } else if (!r.pix && feitos.pix < 2) {
        feitos.pix += 1;
        dizer = '5'; // PIX copia e cola
      } else throw new Error(`a Cagepa não mandou ${!r.pdfId ? 'o PDF' : 'o Pix'} depois de dois pedidos`);
    } else if (passo === 'prosseguir') {
      if ((!r.pdfId && feitos.pdf < 2) || (!r.pix && feitos.pix < 2)) dizer = 'Com o mesmo imóvel';
      else {
        dizer = 'Sair';
        feitos.fim = true;
      }
    } else if (passo === 'sem_conta') {
      dizer = 'Sair';
      feitos.fim = true;
    } else if (passo === 'pesquisa' || passo === 'despedida') {
      if (r.conta || r.semConta || feitos.oi >= 3) return r;
      dizer = 'Oi'; // fim de um atendimento antigo: começa de novo
    } else if (passo === 'dados_recusados') throw new Error(`a Cagepa não aceitou os dados: "${resumo(ultima)}"`);
    else if (passo === 'nao_entendi') {
      feitos.naoEntendi += 1;
      if (feitos.naoEntendi > 2) throw new Error(`a Cagepa não entendeu a resposta: "${resumo(ultima)}"`);
      if (!feitos.documento && feitos.oi < 3) dizer = 'Oi';
    }

    if (!dizer) {
      feitos.espera += 1;
      if (feitos.espera >= 3) {
        if (r.semConta || (r.conta && r.pdfId && r.pix)) return r;
        throw new Error(`conversa parada numa tela que não conheço: "${resumo(ultima) || '(sem resposta)'}"`);
      }
    } else feitos.espera = 0;
  }
  throw new Error('a conversa deu voltas demais sem terminar');
}
