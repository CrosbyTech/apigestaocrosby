// =============================================================================
// Roteiro da 2ª via da Equatorial Maranhão pelo WhatsApp da Clara, (98) 2055-0116.
//
// A conversa inteira anda por texto, pela instância CONTAS A PAGAR (uazapi).
// Para cada conta em aberto o bot pede duas coisas: a "2ª via de conta" (PDF da
// nota fiscal; a Clara confere os 4 primeiros ou os 4 últimos dígitos do CPF/CNPJ
// do titular) e o "Pagar com pix" (só devolve o código copia e cola).
//
// O que o bot NUNCA escolhe: "Pagar agora" e "Pagar com cartão" (iniciam
// pagamento), cadastros e campanhas, e a pesquisa de satisfação do fim.
// =============================================================================
import { criarConversa } from '../comum/conversa.mjs';
import { passoDaEquatorial, lerContasAbertas, lerImovelEquatorial, pixDaMensagem, mesmaConta, contasParaPegar } from '../../utils/contasFixasEquatorial.js';
import { textoDaMensagem } from '../../utils/contasFixasEnergisa.js';
import { valorDoPix } from '../../utils/contasFixasWhatsapp.js';

export const NUMERO_EQUATORIAL = '559820550116';
const MAX_VOLTAS = 70;
// telas de antes da identificação do imóvel: dá para retomar daqui sem risco de misturar contas
const RETOMAVEIS = ['menu', 'identificar', 'pedir_uc'];
const resumo = (m) => textoDaMensagem(m).replace(/\s+/g, ' ').replace(/000201\S{20,}.*/, '(código Pix)').slice(0, 90);

/**
 * Uma conversa = as contas em aberto de uma unidade.
 * @param conta { contaContrato: '003008536090', documento: CPF/CNPJ do titular (só dígitos) }
 * @param referencia 'MM/AAAA' para pegar a conta dessa competência
 * @param todas true = todas as contas em aberto; o padrão é só a última (a do mês)
 * @returns {{ semFatura, imovel, abertas, itens: [{ referencia, valor, vencimento, pix, pdfId }] }}
 */
export async function pegarFaturas({ wa, conta, log, referencia = null, todas = false }) {
  const c = criarConversa({ wa, numero: NUMERO_EQUATORIAL, ehEspera: (m) => passoDaEquatorial(m) === 'aguardando', trackId: 'bot-equatorial' });
  const antes = await c.mensagens();
  const vistos = new Set(antes.map((m) => m.id)); // o que já estava na conversa não conta
  const r = { semFatura: false, imovel: null, abertas: [], itens: [] };
  const feitos = { uc: 0, oi: 0, espera: 0, validacoes: 0, naoEntendi: 0, menus: 0, fim: false };
  let atual = null; // conta escolhida na lista
  let modo = null; // '2via' | 'pix': o que foi pedido por último
  let ganhou = true; // a última escolha trouxe o que faltava?
  const falta = (i) => !i.pdfId || !i.pix;

  const pendente = antes.at(-1);
  let retomar = Boolean(pendente && !pendente.deMim && RETOMAVEIS.includes(passoDaEquatorial(pendente)) && Date.now() - new Date(pendente.em).getTime() < 8 * 60000);
  let dizer = retomar ? null : 'Oi';

  for (let volta = 1; volta <= MAX_VOLTAS; volta += 1) {
    if (dizer) {
      if (dizer === 'Oi') feitos.oi += 1;
      await c.dizer(dizer);
      log(`→ ${/^\d{4,}$/.test(dizer) ? '(dados da conta)' : dizer}`);
    }
    const novas = retomar ? [pendente] : await c.esperarResposta(vistos);
    if (retomar) log('retomo a conversa que ficou aberta');
    retomar = false;

    // guarda o que chegou: lista de contas, imóvel, Pix e PDF
    for (const m of novas) {
      const texto = textoDaMensagem(m);
      const lista = lerContasAbertas(texto);
      if (lista.length) {
        r.abertas = lista;
        for (const l of contasParaPegar(lista, { referencia, todas })) {
          const ja = r.itens.find((i) => i.referencia === l.referencia && i.vencimento === l.vencimento);
          if (ja) ja.opcao = l.opcao;
          else r.itens.push({ ...l, pix: null, pdfId: null });
        }
      }
      if (passoDaEquatorial(m) === 'confirmar_imovel') r.imovel = lerImovelEquatorial(texto);
      if (passoDaEquatorial(m) === 'sem_fatura') r.semFatura = true;
      const pix = pixDaMensagem(m);
      if (pix) {
        const valor = valorDoPix(pix);
        const dono = r.itens.find((i) => !i.pix && valor != null && Math.abs(i.valor - valor) < 0.005 && (i === atual || r.itens.filter((x) => Math.abs(x.valor - valor) < 0.005).length === 1));
        if (dono) {
          dono.pix = pix;
          ganhou = true;
        } else log(`⚠️ chegou um Pix de R$ ${valor} que não é de nenhuma conta pedida`);
      }
      if (/document/i.test(m.tipo || '') && atual && !atual.pdfId) {
        atual.pdfId = m.id;
        ganhou = true;
      }
    }

    const ultima = novas.at(-1);
    const passo = passoDaEquatorial(ultima);
    log(`← ${passo}: "${resumo(ultima)}"`);
    dizer = null;
    if (feitos.fim) return r; // já me despedi: o que vier agora é campanha e pesquisa

    if (passo === 'menu') {
      feitos.menus += 1;
      if (feitos.menus > r.itens.length * 2 + 3) throw new Error('voltei ao menu vezes demais sem conseguir as contas');
      dizer = 'Segunda via de Fatura';
    } else if (passo === 'identificar') dizer = 'Unidade Consumidora';
    else if (passo === 'pedir_uc') {
      if (feitos.uc >= 1) throw new Error('a Equatorial pediu a unidade de novo: ela não aceitou a conta contrato do cadastro');
      feitos.uc += 1;
      dizer = conta.contaContrato;
    } else if (passo === 'confirmar_imovel') {
      if (!mesmaConta(r.imovel?.contaContrato, conta.contaContrato)) {
        await c.dizer('Não');
        throw new Error(`o imóvel que a Equatorial achou é de outra conta contrato (${r.imovel?.contaContrato || '?'})`);
      }
      dizer = 'Sim';
    } else if (passo === 'lista_contas') {
      if (!r.itens.length) throw new Error(`a conta de ${referencia} não está na lista de contas em aberto`);
      const pendentes = r.itens.filter(falta);
      atual = pendentes.find((i) => (modo === 'pix' ? !i.pix : !i.pdfId)) || pendentes[0] || null;
      if (!atual) throw new Error('a Equatorial mostrou a lista de contas, mas eu já tenho todas');
      ganhou = false;
      dizer = String(atual.opcao);
    } else if (passo === 'menu_pagamento') {
      if (!atual) throw new Error('apareceu o menu de pagamento sem eu ter escolhido uma conta');
      modo = atual.pdfId ? 'pix' : '2via';
      dizer = modo === 'pix' ? 'Pagar com pix' : '2ª via de conta';
    } else if (passo === 'validar_inicio' || passo === 'validar_fim') {
      feitos.validacoes += 1;
      if (feitos.validacoes > r.itens.length * 2 + 2) throw new Error('a Equatorial não aceitou os dígitos do CPF/CNPJ do titular que estão no cadastro');
      dizer = passo === 'validar_inicio' ? conta.documento.slice(0, 4) : conta.documento.slice(-4);
    } else if (passo === 'outra_conta') {
      // continua na mesma fila só se a última escolha rendeu e ainda falta coisa do mesmo tipo
      const resta = modo === 'pix' ? r.itens.some((i) => !i.pix) : r.itens.some((i) => !i.pdfId);
      dizer = resta && ganhou ? 'Sim' : 'Não';
    } else if (passo === 'algo_mais') {
      if (r.itens.some(falta) && feitos.menus <= r.itens.length * 2 + 2) dizer = 'Sim'; // volta ao menu para pedir o que falta
      else {
        dizer = 'Não';
        feitos.fim = true;
      }
    } else if (passo === 'pesquisa') {
      // a pesquisa fecha o atendimento; se apareceu logo de cara, é de uma conversa antiga
      if (r.itens.length || r.semFatura || feitos.oi >= 3) return r;
      dizer = 'Oi';
    } else if (passo === 'dados_recusados') throw new Error(`a Equatorial não achou a conta: "${resumo(ultima)}"`);
    else if (passo === 'nao_entendi') {
      feitos.naoEntendi += 1;
      if (feitos.naoEntendi > 2) throw new Error(`a Equatorial não entendeu a resposta: "${resumo(ultima)}"`);
      if (!r.itens.length && !r.imovel && feitos.oi < 3) dizer = 'Oi';
    }

    if (!dizer) {
      // nada a responder: espera mais um pouco; se continuar parado, encerra ou acusa a tela desconhecida
      feitos.espera += 1;
      if (feitos.espera >= 3) {
        if (r.semFatura || (r.itens.length && !r.itens.some(falta))) return r;
        throw new Error(`conversa parada numa tela que não conheço: "${resumo(ultima) || '(sem resposta)'}"`);
      }
    } else feitos.espera = 0;
  }
  throw new Error('a conversa deu voltas demais sem terminar');
}
