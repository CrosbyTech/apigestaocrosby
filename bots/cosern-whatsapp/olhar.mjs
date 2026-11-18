// Abre a conversa com a Cosern no WhatsApp Web do bot, tira um print e diz se os
// botões carregam. Com --oi manda um "Oi" antes (pela API) para chegar um botão novo.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../config/supabase.js'; // carrega o .env
import * as wa from '../../services/whatsappContasPagar.js';
import { WhatsAppWeb, dormir } from './whatsappWeb.mjs';
import { NUMERO_COSERN } from './cosern.mjs';

const pasta = path.dirname(fileURLToPath(import.meta.url));
const web = new WhatsAppWeb({ perfil: path.join(pasta, 'perfil-chrome'), capturas: path.join(pasta, 'capturas') });
try {
  await web.abrir();
  if (!(await web.esperarLogin({ timeoutMin: 2 }))) throw new Error('sem login');
  await dormir(12000); // deixa sincronizar
  await web.abrirConversa(NUMERO_COSERN);
  const texto = process.argv.find((a) => a.startsWith('--texto='))?.split('=')[1] || (process.argv.includes('--oi') ? 'Oi' : null);
  if (texto) {
    await wa.enviarTexto({ number: NUMERO_COSERN, text: texto, trackId: 'bot-cosern' });
    console.log('mandei "Oi"; esperando a resposta…');
    await dormir(40000);
  } else await dormir(8000);
  console.log('print:', await web.foto('olhar'));
  console.log('navegador:', await web.browser.version());
  const estado = await web.page.evaluate(() => {
    const limpo = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const recebidas = [...document.querySelectorAll('#main .message-in')];
    return {
      webdriver: navigator.webdriver,
      cabecalho: limpo(document.querySelector('#main header')?.innerText).slice(0, 80),
      naoCarregou: (document.querySelector('#main')?.innerText.match(/Use seu celular/g) || []).length,
      ultimasRecebidas: recebidas.slice(-3).map((e) => limpo(e.innerText).slice(0, 140)),
    };
  });
  console.log('estado:', JSON.stringify(estado, null, 1));
} catch (e) {
  console.log('erro:', e.message);
} finally {
  await web.fechar();
}
process.exit(0);
