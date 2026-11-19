// =============================================================================
// Roteiro da 2ª via da CAERN (água, RN) pelo WhatsApp da Caren, (84) 98118-8400.
//
// A conversa inteira anda por texto, pela instância CONTAS A PAGAR (uazapi):
// "Segunda via" → CPF/CNPJ do titular → matrícula → lista das faturas em aberto
// → ao escolher uma, chegam juntos o PDF da nota e o Pix copia e cola.
//
// A CAERN guarda a matrícula enquanto o atendimento está aberto, então cada
// matrícula tem a sua conversa: o bot encerra no fim e, se achar um atendimento
// aberto há pouco, espera ele cair sozinho (ela fecha por falta de interação).
// O bot não responde à avaliação do fim.
// =============================================================================
import { criarConversa, dormir } from '../comum/conversa.mjs';
import { passoDaCaern, lerFaturasDaCaern, faturasParaPegar } from '../../utils/contasFixasCaern.js';
import { pixDaMensagem } from '../../utils/contasFixasEquatorial.js';
import { textoDaMensagem } from '../../utils/contasFixasEnergisa.js';
import { valorDoPix } from '../../utils/contasFixasWhatsapp.js';

// o JID da CAERN não tem o nono dígito
export const NUMERO_CAERN = '558481188400';
const MAX_VOLTAS = 30;
const ATENDIMENTO_ABERTO_MS = 4 * 60000; // ela fecha sozinha depois de ~1,5 min sem resposta
const resumo = (m) => textoDaMensagem(m).replace(/\s+/g, ' ').replace(/000201\S{20,}.*/i, '(código Pix)').slice(0, 90);

/**
 * Uma conversa = as faturas em aberto de uma matrícula.
 * @param conta { matricula, documento: CPF/CNPJ do titular (só dígitos) }
 * @param todas true = todas as faturas em aberto; o padrão é só a última (a do mês)
 * @returns {{ semFatura, abertas, itens: [{ titulo, valor, vencimento, pix, pdfId }] }}
 */
export async function pegarFaturas({ wa, conta, log, todas = false }) {
  const c = criarConversa({ wa, numero: NUMERO_CAERN, ehEspera: (m) => passoDaCaern(m) === 'aguardando', trackId: 'bot-caern' });
  let antes = await c.mensagens();
  // atendimento de outra matrícula ainda aberto: espera cair antes de começar
  const ultimaDela = antes.filter((m) => !m.deMim).at(-1);
  if (ultimaDela && !['avaliacao', 'encerrou'].includes(passoDaCaern(ultimaDela))) {
    const falta = ATENDIMENTO_ABERTO_MS - (Date.now() - new Date(ultimaDela.em).getTime());
    if (falta > 0) {
      log(`há um atendimento aberto há pouco; espero ${Math.ceil(falta / 1000)} s para ele fechar`);
      await dormir(falta);
      antes = await c.mensagens();
    }
  }
  const vistos = new Set(antes.map((m) => m.id)); // o que já estava na conversa não conta
  const r = { semFatura: false, abertas: [], itens: [] };
  const feitos = { oi: 0, documento: 0, matricula: 0, espera: 0, naoEntendi: 0, fim: false };
  let atual = null;
  let dizer = 'Oi';

  for (let volta = 1; volta <= MAX_VOLTAS; volta += 1) {
    if (dizer) {
      if (dizer === 'Oi') feitos.oi += 1;
      await c.dizer(dizer);
      log(`→ ${/^\d{4,}$/.test(dizer) ? '(dados da conta)' : dizer}`);
    }
    const novas = await c.esperarResposta(vistos);
    for (const m of novas) {
      const lista = lerFaturasDaCaern(m.conteudo);
      if (lista.length && feitos.matricula) {
        r.abertas = lista;
        for (const f of faturasParaPegar(lista, { todas })) if (!r.itens.some((i) => i.titulo === f.titulo)) r.itens.push({ ...f, pix: null, pdfId: null });
      }
      if (passoDaCaern(m) === 'sem_fatura') r.semFatura = true;
      const pix = pixDaMensagem(m);
      if (pix && atual && !atual.pix) atual.pix = pix;
      if (/document/i.test(m.tipo || '') && atual && !atual.pdfId) atual.pdfId = m.id;
    }
    // o menu chega junto com a mensagem de boas-vindas: vale o passo mais útil do lote
    const passos = novas.map(passoDaCaern).filter((p) => p !== 'aguardando');
    const passo = passos.at(-1) || 'aguardando';
    const ultima = novas.filter((m) => passoDaCaern(m) === passo).at(-1) || novas.at(-1);
    log(`← ${passo}: "${resumo(ultima)}"`);
    dizer = null;
    if (feitos.fim) return r;

    if (passo === 'menu') dizer = 'Segunda via';
    else if (passo === 'pedir_documento') {
      if (feitos.documento >= 1) throw new Error('a CAERN pediu o CPF/CNPJ de novo: ela não aceitou o que está no cadastro');
      feitos.documento += 1;
      dizer = conta.documento;
    } else if (passo === 'pedir_matricula') {
      if (feitos.matricula >= 1) throw new Error('a CAERN pediu a matrícula de novo: ela não aceitou a que está no cadastro');
      feitos.matricula += 1;
      dizer = conta.matricula;
    } else if (passo === 'lista_faturas') {
      // só escolho numa lista que veio depois de eu informar a matrícula desta conta
      if (!feitos.matricula) throw new Error('a CAERN mostrou faturas sem pedir a matrícula: havia um atendimento aberto de outra conta; rode de novo em alguns minutos');
      atual = r.itens.find((i) => !i.pdfId || !i.pix) || null;
      if (!atual) throw new Error('a CAERN mostrou a lista de faturas, mas eu já tenho todas');
      dizer = atual.titulo;
    } else if (passo === 'continuar') {
      if (r.itens.some((i) => !i.pdfId || !i.pix) && atual && atual.pdfId && atual.pix) dizer = 'Outra segunda via';
      else {
        dizer = 'Encerrar';
        feitos.fim = true;
      }
    } else if (passo === 'sem_fatura') {
      dizer = 'Encerrar';
      feitos.fim = true;
    } else if (passo === 'avaliacao' || passo === 'encerrou') {
      if (r.itens.length || r.semFatura || feitos.oi >= 3) return r;
      dizer = 'Oi'; // fim de um atendimento antigo: começa de novo
    } else if (passo === 'dados_recusados') throw new Error(`a CAERN não aceitou os dados: "${resumo(ultima)}"`);
    else if (passo === 'nao_entendi') {
      feitos.naoEntendi += 1;
      if (feitos.naoEntendi > 2) throw new Error(`a CAERN não entendeu a resposta: "${resumo(ultima)}"`);
    }

    if (!dizer) {
      feitos.espera += 1;
      if (feitos.espera >= 3) {
        if (r.semFatura || (r.itens.length && r.itens.every((i) => i.pdfId && i.pix))) return r;
        throw new Error(`conversa parada numa tela que não conheço: "${resumo(ultima) || '(sem resposta)'}"`);
      }
    } else feitos.espera = 0;
  }
  throw new Error('a conversa deu voltas demais sem terminar');
}
