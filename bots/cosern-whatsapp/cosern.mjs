// =============================================================================
// Roteiro da 2ª via da Neoenergia Cosern pelo WhatsApp (84 3215-6001).
//
// A conversa anda pela API (uazapi): mandar "Oi", ler as respostas, escolher
// "2ª via". Só o formulário de identificação precisa do WhatsApp Web: o bot
// clica no botão, marca "código do cliente", digita o código e o CPF/CNPJ do
// titular e envia. Nada de senha: a Cosern não pede.
// =============================================================================
import { dormir } from './whatsappWeb.mjs';
import { passoDaCosern, lerRespostaCosern, lerListaDeFaturas } from '../../utils/contasFixasWhatsapp.js';

export const NUMERO_COSERN = '558432156001';
const ESPERA_TOTAL_MS = 6 * 60000;
const AVANCAR = /^(continu(ar|e)|avan[çc]ar|pr[oó]xim[oa]|confirmar|conclu(ir|[ií]do)|enviar|ok|entendi|prosseguir|finalizar|next|submit|done)\b/i;

// no formulário da Cosern as opções são botões comuns dentro de uma lista
const ehOpcao = (it) => ['radio', 'option', 'checkbox', 'menuitem'].includes(it.role) || ['radio', 'checkbox'].includes(it.tipo) || (it.tag === 'button' && it.emLista);
const ehCampo = (it) => (it.tag === 'input' && !['radio', 'checkbox', 'button', 'submit', 'hidden'].includes(it.tipo)) || it.tag === 'textarea';
const ehBotao = (it) => it.tag === 'button' || it.role === 'button';
const nome = (it) => `${it.texto} ${it.rotulo}`.trim();
const semDigitos = (v) => JSON.parse(JSON.stringify(v).replace(/\d{6,}/g, (d) => `${'*'.repeat(d.length - 3)}${d.slice(-3)}`));

/**
 * Preenche o formulário de identificação aberto. A cada volta faz uma coisa só
 * (marcar opção, preencher campo ou avançar) e olha a tela de novo, porque os
 * campos mudam conforme a opção escolhida.
 */
export async function preencherIdentificacao(web, conta, log) {
  let ultimaAssinatura = null;
  let repetidas = 0;
  let esperas = 0;
  let avancos = 0;
  const jaMarquei = new Set(); // opção sem marca visível não é clicada duas vezes na mesma tela
  for (let volta = 1; volta <= 25; volta += 1) {
    const d = await web.interativos({ dialogo: true });
    if (!d) {
      // a moldura some por instantes ao trocar de tela: só é envio se continuar fechada
      let voltou = false;
      for (let k = 0; k < 4 && !voltou; k += 1) {
        await dormir(1000);
        voltou = Boolean(await web.interativos({ dialogo: true }));
      }
      if (voltou) continue;
      if (avancos < 2) throw new Error('o formulário fechou antes de eu preencher');
      return true;
    }
    if (/^Sua resposta/i.test(d.texto)) {
      await web.fecharDialogo();
      throw new Error('abriu o resumo de um formulário já respondido');
    }
    await web.foto(`identificacao-${volta}`);
    log(`tela ${volta}: "${semDigitos(d.texto.slice(0, 110))}"`, semDigitos(d.itens));

    const assinatura = JSON.stringify(d.itens.map((it) => [it.i, it.valor, it.marcado, it.desabilitado, it.texto]));
    repetidas = assinatura === ultimaAssinatura ? repetidas + 1 : 0;
    ultimaAssinatura = assinatura;
    if (repetidas >= 2) throw new Error(`formulário parado na tela "${d.texto.slice(0, 80)}"`);

    // 1) opções: tipo de documento e como achar o imóvel (código do cliente; sem ele, a UC)
    const temCodigo = d.itens.some((it) => ehOpcao(it) && /c[oó]digo d[oe] cliente/i.test(nome(it)));
    const opcao = d.itens.find((it) => ehOpcao(it) && !it.marcado && !it.desabilitado && !jaMarquei.has(`${d.texto.slice(0, 60)}|${nome(it)}`) && (/c[oó]digo d[oe] cliente/i.test(nome(it)) || (conta.uc && !temCodigo && /unid\.? ?consumidora|unidade consumidora/i.test(nome(it))) || new RegExp(`^${conta.tipoDocumento}$`, 'i').test(it.texto || it.rotulo)));
    if (opcao) {
      jaMarquei.add(`${d.texto.slice(0, 60)}|${nome(opcao)}`);
      log(`marco a opção "${nome(opcao)}"`);
      await web.clicar(opcao.i);
      continue;
    }
    // lista suspensa do tipo de documento ainda fechada
    const lista = d.itens.find((it) => it.role === 'combobox' && /documento|tipo/i.test(nome(it)) && !new RegExp(conta.tipoDocumento, 'i').test(it.texto || it.valor));
    if (lista) {
      log(`abro a lista "${nome(lista)}"`);
      await web.clicar(lista.i);
      continue;
    }
    // 2) campos vazios
    const campo = d.itens.find((it) => ehCampo(it) && !it.valor && !it.desabilitado && valorDoCampo(it, conta, d));
    if (campo) {
      log(`preencho "${campo.rotulo}"`);
      await web.digitar(campo.i, valorDoCampo(campo, conta, d));
      continue;
    }
    // 3) avançar / enviar
    const botao = d.itens.filter((it) => ehBotao(it) && !it.desabilitado && AVANCAR.test(it.texto || it.rotulo)).at(-1);
    if (botao) {
      esperas = 0;
      avancos += 1;
      log(`clico em "${nome(botao)}"`);
      await web.clicar(botao.i);
      await dormir(2500);
      continue;
    }
    // tela ainda carregando (só o rodapé, ou o botão de avançar ainda apagado): espera um pouco
    if (esperas < 10) {
      esperas += 1;
      ultimaAssinatura = null;
      await dormir(2000);
      continue;
    }
    throw new Error(`não sei o que fazer na tela "${d.texto.slice(0, 80)}"`);
  }
  throw new Error('formulário de identificação não terminou em 25 passos');
}

function valorDoCampo(it, conta, tela) {
  const r = it.rotulo;
  if (/c[oó]digo/i.test(r)) return conta.codigo;
  if (/unid\.? ?consumidora|unidade consumidora/i.test(r)) return conta.uc;
  if (/cnpj/i.test(r) && !/cpf/i.test(r)) return conta.tipoDocumento === 'CNPJ' ? conta.documento : null;
  if (/cpf/i.test(r) && !/cnpj/i.test(r)) return conta.tipoDocumento === 'CPF' ? conta.documento : null;
  if (/cpf|cnpj|documento/i.test(r)) return conta.documento;
  // campo sem nome: decide pela opção marcada na tela, quando é o único campo vazio
  const vazios = tela.itens.filter((x) => ehCampo(x) && !x.valor);
  if (vazios.length !== 1) return null;
  const marcada = tela.itens.find((x) => ehOpcao(x) && x.marcado);
  if (marcada && /^(cpf|cnpj)$/i.test(marcada.texto)) return conta.documento;
  if (marcada && /c[oó]digo d[oe] cliente/i.test(nome(marcada))) return conta.codigo;
  if (marcada && /unid\.? ?consumidora|unidade consumidora/i.test(nome(marcada))) return conta.uc;
  return null;
}

/**
 * Pede a 2ª via de uma conta. Devolve { semFatura } ou { qtd, faturas, pix, pdfs }.
 * @param conta { codigo, documento, tipoDocumento }
 */
export async function pegarFatura({ web, wa, conta, log, jaPegas = new Set(), continuacao = false }) {
  await web.abrirConversa(NUMERO_COSERN);
  // a API devolve da mais nova para a mais antiga; aqui fica em ordem de chegada
  const conversa = async () => (await wa.buscarMensagens({ number: NUMERO_COSERN, limit: 40, comConteudo: true })).mensagens.slice().reverse();
  const enviar = (texto) => wa.enviarTexto({ number: NUMERO_COSERN, text: texto, trackId: 'bot-cosern' });
  const antes = new Set((await conversa()).map((m) => m.id));
  // continuacao: a Cosern acabou de perguntar se queremos a 2ª via de outra fatura desta mesma conta
  await enviar(continuacao ? 'Sim' : 'Oi');
  log(continuacao ? 'respondi "Sim" para pegar outra fatura' : 'mandei "Oi" para a Cosern');

  const tratadas = new Set();
  let identificacoes = 0;
  let reinicios = 0;
  let pediu = continuacao; // só aceito lista/resultado depois de pedir a 2ª via NESTA conversa
  let escolhida = null;
  let restantes = 0;
  const chave = (f) => `${f.valor}|${f.vencimento}`;
  const fim = Date.now() + ESPERA_TOTAL_MS;
  while (Date.now() < fim) {
    await dormir(4000);
    const todas = await conversa();
    // só vale o que a Cosern disse DEPOIS da nossa última mensagem
    const respostas = todas.slice(todas.findLastIndex((m) => m.deMim) + 1).filter((m) => !antes.has(m.id));
    const ultima = respostas.at(-1);
    if (!ultima || tratadas.has(ultima.id)) continue;
    const passo = passoDaCosern(ultima);
    if (passo === 'aguardando') continue;
    tratadas.add(ultima.id);

    if (passo === 'identificar') {
      if (identificacoes >= 2) throw new Error('a Cosern pediu a identificação pela terceira vez');
      identificacoes += 1;
      let abriu = false;
      for (let tentativa = 1; tentativa <= 3 && !abriu; tentativa += 1) {
        const clicou = await web.clicarBotaoDaConversa(/come[çc]ar|informar dados/i);
        if (!clicou && tentativa === 3) throw new Error('não achei o botão da identificação na conversa');
        for (let t = 0; t < 6 && !abriu; t += 1) {
          await dormir(1500);
          abriu = Boolean(await web.interativos({ dialogo: true }));
        }
        if (!abriu) log(`o formulário não abriu na tentativa ${tentativa}`);
      }
      if (!abriu) {
        await web.foto('formulario-nao-abriu');
        throw new Error('cliquei no botão, mas o formulário não abriu');
      }
      await preencherIdentificacao(web, conta, log);
      log('identificação enviada');
    } else if (passo === 'menu') {
      await enviar('2ª via');
      pediu = true;
      log('pedi "2ª via"');
    } else if (passo === 'sem_fatura' && pediu) {
      return { semFatura: true, qtd: 0, faturas: [], pix: [], pdfs: [], restantes: 0 };
    } else if (passo === 'lista_faturas' && pediu && !escolhida) {
      // mais de uma fatura em aberto: pega uma por conversa, a primeira ainda não pega
      const lista = lerListaDeFaturas(ultima.conteudo);
      const faltam = lista.filter((f) => !jaPegas.has(chave(f)));
      if (!faltam.length) return { semFatura: false, qtd: lista.length, faturas: [], pix: [], pdfs: [], restantes: 0 };
      [escolhida] = faltam;
      restantes = faltam.length - 1;
      await enviar(escolhida.titulo);
      log(`a Cosern listou ${lista.length} faturas; pedi a "${escolhida.titulo}" (R$ ${escolhida.valor.toFixed(2)}, venc ${escolhida.vencimento})`);
    } else if (passo === 'resultado' && pediu) {
      await dormir(9000); // o PDF e o Pix chegam logo depois do texto
      const r = lerRespostaCosern((await conversa()).filter((m) => !m.deMim && !antes.has(m.id)));
      if (escolhida) r.faturas = [{ valor: escolhida.valor, vencimento: escolhida.vencimento }];
      return { ...r, restantes };
    } else if (passo === 'outra_fatura' && !pediu && reinicios < 3) {
      // pergunta que sobrou da conta anterior: encerro aquela conversa
      reinicios += 1;
      await enviar('Não');
      log('a Cosern ainda perguntava de outra fatura da conta anterior; respondi "Não"');
    } else if (['encerrou', 'avaliacao', 'lista_faturas', 'resultado', 'sem_fatura'].includes(passo) && !pediu && reinicios < 3) {
      // sobrou conversa antiga do lado da Cosern (pesquisa de nota ou atendimento encerrado): começa de novo
      reinicios += 1;
      await dormir(6000);
      await enviar('Oi');
      log(`a Cosern ainda estava na conversa anterior (${passo}); mandei "Oi" de novo`);
    } else {
      await web.foto(`parou-${passo}`);
      throw new Error(`a Cosern respondeu "${String(ultima.texto).slice(0, 120)}" (${passo})`);
    }
  }
  throw new Error('a Cosern não respondeu a tempo');
}
