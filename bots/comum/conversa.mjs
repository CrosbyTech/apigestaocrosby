// Conversa por texto com um número do WhatsApp pela instância CONTAS A PAGAR
// (uazapi): ler as mensagens em ordem e esperar o outro lado terminar de responder.
export const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * @param wa services/whatsappContasPagar.js
 * @param numero JID do contato, só dígitos
 * @param ehEspera (mensagem) => true quando a última mensagem ainda não diz o que fazer (dá mais tempo antes de devolver)
 */
export function criarConversa({ wa, numero, ehEspera = () => false, esperaMs = 80000, trackId = 'bot-contas-fixas' }) {
  /** Mensagens em ordem de chegada (a API devolve da mais nova para a mais velha). */
  async function mensagens() {
    // a consulta cai de vez em quando ("stream has been aborted"): tenta de novo antes de desistir
    for (let tentativa = 1; ; tentativa += 1) {
      try {
        const r = await wa.buscarMensagens({ number: numero, limit: 40, comConteudo: true });
        return (r.mensagens || []).slice().reverse();
      } catch (e) {
        if (tentativa >= 4) throw e;
        await dormir(4000 * tentativa);
      }
    }
  }

  /** Mensagens do outro lado que chegaram depois das já vistas, quando a conversa fica quieta. */
  async function esperarResposta(vistos) {
    const inicio = Date.now();
    let anteriores = -1;
    let quietas = 0;
    let novas = [];
    while (Date.now() - inicio < esperaMs) {
      await dormir(3000);
      novas = (await mensagens()).filter((m) => !m.deMim && !vistos.has(m.id));
      quietas = novas.length && novas.length === anteriores ? quietas + 1 : 0;
      anteriores = novas.length;
      if (novas.length && quietas >= (ehEspera(novas.at(-1)) ? 4 : 2)) break;
    }
    for (const m of novas) vistos.add(m.id);
    return novas;
  }

  async function dizer(texto) {
    await dormir(1500 + Math.random() * 2000); // ritmo de gente
    await wa.enviarTexto({ number: numero, text: texto, trackId });
  }

  return { mensagens, esperarResposta, dizer };
}
