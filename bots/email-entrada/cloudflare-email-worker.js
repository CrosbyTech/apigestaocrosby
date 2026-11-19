// =============================================================================
// EMAIL WORKER da Cloudflare — repassa ao HeadCoach cada e-mail que chega no
// endereço do domínio (ex.: contas-fixas@crosbytech.com.br).
//
// Onde fica: painel da Cloudflare → crosbytech.com.br → Email → Email Routing →
// Email Workers. Este arquivo é só a cópia de referência do que está colado lá.
//
// Variáveis do Worker (Settings → Variables and Secrets):
//   HEADCOACH_URL     texto     https://apigestaocrosby-bw2v.onrender.com/api/contas-fixas/email-entrada
//   HEADCOACH_SECRET  segredo   o mesmo valor de CONTAS_FIXAS_EMAIL_SECRET no Render
//
// O Worker não lê nem guarda nada: entrega a mensagem inteira e pronto. Se o
// HeadCoach não responder, a entrega falha e o servidor de origem tenta de novo.
// =============================================================================
export default {
  async email(message, env) {
    const bruto = await new Response(message.raw).arrayBuffer();
    const resposta = await fetch(env.HEADCOACH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'message/rfc822',
        'x-email-secret': env.HEADCOACH_SECRET,
        'x-email-de': message.from,
        'x-email-para': message.to,
      },
      body: bruto,
    });
    if (!resposta.ok) throw new Error(`HeadCoach respondeu ${resposta.status}`);
  },
};
