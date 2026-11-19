// =============================================================================
// Roteiro da 2ª via da Energisa Paraíba pelo WhatsApp da Gisa, (83) 99135-5540.
//
// A conversa inteira anda por texto, pela instância CONTAS A PAGAR (uazapi):
// menus, botões e listas aceitam a resposta digitada. Não tem formulário, não
// tem senha e não precisa de navegador.
//
// O que o bot NUNCA responde:
//   • "Pagar com Pix"  — esse botão inicia o pagamento pelo banco;
//   • "Sim" em "próximas faturas apenas com o QR Code PIX" — mudaria o cadastro da conta;
//   • "Sim" em "Deseja se cadastrar?" (oferta de cliente Pix antes do menu);
//   • a nota de 0 a 10 do fim do atendimento.
// =============================================================================
import { passoDaEnergisa, lerRespostaEnergisa, textoDaMensagem, enderecoEhDaSala } from '../../utils/contasFixasEnergisa.js';

// o JID da Gisa não tem o nono dígito (com ele o envio chega, mas a busca não acha a conversa)
export const NUMERO_ENERGISA = '558391355540';
export const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const ESPERA_RESPOSTA_MS = 80000;
const MAX_VOLTAS = 30;

/** Mensagens da conversa em ordem de chegada (a API devolve da mais nova para a mais velha). */
async function conversa(wa) {
  // a consulta cai de vez em quando ("stream has been aborted"): tenta de novo antes de desistir
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      const { mensagens } = await wa.buscarMensagens({ number: NUMERO_ENERGISA, limit: 40, comConteudo: true });
      return (mensagens || []).slice().reverse();
    } catch (e) {
      if (tentativa >= 4) throw e;
      await dormir(4000 * tentativa);
    }
  }
}

// telas de antes da identificação do imóvel: dá para retomar daqui sem risco de misturar contas
const RETOMAVEIS = ['oferta_cadastro', 'menu', 'tipo_via', 'identificar', 'pedir_codigo'];

/**
 * Espera a Energisa terminar de responder: devolve as mensagens dela que chegaram
 * depois das já vistas, quando a conversa fica quieta por alguns segundos.
 */
async function esperarResposta(wa, vistos) {
  const inicio = Date.now();
  let anteriores = -1;
  let quietas = 0;
  while (Date.now() - inicio < ESPERA_RESPOSTA_MS) {
    await dormir(3000);
    const novas = (await conversa(wa)).filter((m) => !m.deMim && !vistos.has(m.id));
    quietas = novas.length && novas.length === anteriores ? quietas + 1 : 0;
    anteriores = novas.length;
    // respondeu e parou: 2 leituras iguais; se a última ainda não diz o que fazer, dá mais um tempo
    if (novas.length && quietas >= (passoDaEnergisa(novas.at(-1)) === 'aguardando' ? 4 : 2)) {
      for (const m of novas) vistos.add(m.id);
      return novas;
    }
  }
  const novas = (await conversa(wa)).filter((m) => !m.deMim && !vistos.has(m.id));
  for (const m of novas) vistos.add(m.id);
  return novas;
}

/**
 * Uma conversa = a fatura em aberto de uma conta.
 * @param conta { codigo: '5/1780082-2', rotulo: 'SALA 101'|null }
 * @returns {{ semFatura, qtd, codigoCliente, uc, endereco, faturas, pix, pdfs }}
 */
export async function pegarFatura({ wa, conta, log }) {
  const antes = await conversa(wa);
  const vistos = new Set(antes.map((m) => m.id)); // o que já estava na conversa não conta
  const recebidas = [];
  const feitos = { codigo: 0, pix: false, pdf: false, oi: 0, espera: 0, naoEntendi: 0 };
  // se a conversa ficou parada há pouco numa tela de antes da identificação, continua dela em vez de mandar outro "Oi"
  const pendente = antes.at(-1);
  let retomar = Boolean(pendente && !pendente.deMim && RETOMAVEIS.includes(passoDaEnergisa(pendente)) && Date.now() - new Date(pendente.em).getTime() < 8 * 60000);
  let dizer = retomar ? null : 'Oi';

  for (let volta = 1; volta <= MAX_VOLTAS; volta += 1) {
    if (dizer) {
      if (dizer === 'Oi') feitos.oi += 1;
      await dormir(1500 + Math.random() * 2000); // ritmo de gente
      await wa.enviarTexto({ number: NUMERO_ENERGISA, text: dizer, trackId: 'bot-energisa' });
      log(`→ ${dizer === conta.codigo ? '(código do cliente)' : dizer}`);
    }
    const novas = retomar ? [pendente] : await esperarResposta(wa, vistos);
    if (retomar) log('retomo a conversa que ficou aberta');
    retomar = false;
    recebidas.push(...novas);
    const ultima = novas.at(-1);
    const passo = passoDaEnergisa(ultima);
    const r = lerRespostaEnergisa(recebidas);
    log(`← ${passo}: "${textoDaMensagem(ultima).replace(/\s+/g, ' ').slice(0, 90)}"`);
    dizer = null;

    if (passo === 'menu') dizer = 'Segunda via de fatura';
    else if (passo === 'oferta_cadastro') dizer = 'Não'; // o bot não cadastra nada
    else if (passo === 'tipo_via') dizer = 'Simplificada'; // a completa é só para o titular
    else if (passo === 'identificar') dizer = 'Número da UC';
    else if (passo === 'pedir_codigo') {
      if (feitos.codigo >= 1) throw new Error('a Energisa pediu o código do cliente de novo: ela não aceitou o que está no cadastro');
      feitos.codigo += 1;
      dizer = conta.codigo;
    } else if (passo === 'confirmar_imovel') {
      if (!enderecoEhDaSala(r.endereco, conta.rotulo)) {
        await wa.enviarTexto({ number: NUMERO_ENERGISA, text: 'Não', trackId: 'bot-energisa' });
        throw new Error(`o imóvel que a Energisa achou não é ${conta.rotulo}: "${r.endereco}"`);
      }
      dizer = 'Sim';
    } else if (passo === 'como_pagar') dizer = 'Ver outras opções'; // nunca "Pagar com Pix"
    else if (passo === 'opcoes') {
      if (!r.pix.length && !feitos.pix) {
        feitos.pix = true;
        dizer = 'Ver o código Pix';
      } else if (!r.pdfs.length && !feitos.pdf) {
        feitos.pdf = true;
        dizer = 'Baixar arquivo da fatura';
      } else dizer = 'Encerrar';
    } else if (passo === 'so_qr_pix') dizer = 'Não'; // "Sim" mudaria o cadastro da conta
    else if (passo === 'o_que_fazer') dizer = '4'; // Encerrar
    else if (passo === 'algo_mais') dizer = 'Não';
    else if (passo === 'nota') {
      // a pesquisa de satisfação fecha o atendimento; se apareceu logo de cara, é de uma conversa antiga
      if (r.faturas.length || r.semFatura || feitos.oi >= 3) return r;
      dizer = 'Oi';
    } else if (passo === 'despedida') {
      // atendimento encerrado: se ainda não pedi nada, o "Oi" caiu no fim de uma conversa antiga — começa de novo
      if (r.faturas.length || r.semFatura) return r;
      if (feitos.oi >= 3) throw new Error('a Energisa encerra o atendimento sem abrir o menu');
      dizer = 'Oi';
    } else if (passo === 'dados_recusados') throw new Error(`a Energisa não achou a conta: "${textoDaMensagem(ultima).replace(/\s+/g, ' ').slice(0, 160)}"`);
    else if (passo === 'sem_fatura') {
      feitos.espera = 0; // a despedida vem em seguida; se não vier, a volta de espera abaixo encerra
    } else if (passo === 'nao_entendi') {
      feitos.naoEntendi += 1;
      if (feitos.naoEntendi > 2) throw new Error(`a Energisa não entendeu a resposta: "${textoDaMensagem(ultima).replace(/\s+/g, ' ').slice(0, 160)}"`);
      dizer = recebidas.length <= 2 ? 'Oi' : null; // no meio da conversa ela reenvia as opções logo depois
    }

    if (!dizer) {
      // nada a responder: espera mais um pouco; se continuar parado, encerra ou acusa a tela desconhecida
      feitos.espera += 1;
      if (feitos.espera >= 3) {
        if (r.semFatura || (r.faturas.length && r.pix.length && r.pdfs.length)) return r;
        throw new Error(`conversa parada numa tela que não conheço: "${textoDaMensagem(ultima).replace(/\s+/g, ' ').slice(0, 200) || '(sem resposta)'}"`);
      }
    } else feitos.espera = 0;
  }
  throw new Error('a conversa deu voltas demais sem terminar');
}
