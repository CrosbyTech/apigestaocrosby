// Só olha: liga-se ao Chrome do robô e mostra em que página a Claro está (endereço, título e o texto
// visível). Não clica nem digita nada.
// Uso: node bots/claro-empresas/ver.mjs [quantos caracteres do texto]
import puppeteer from 'puppeteer';
import { PORTA } from './abrir.mjs';

const max = Number(process.argv[2]) || 2500;
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORTA}`, defaultViewport: null }).catch(() => null);
if (!browser) {
  console.log('O Chrome do robô não está aberto (rode abrir.mjs).');
  process.exit(1);
}
const paginas = await browser.pages();
for (const p of paginas) {
  const url = p.url();
  if (!/claro/i.test(url)) {
    console.log(`aba: ${url.slice(0, 100)}`);
    continue;
  }
  const info = await p
    .evaluate(() => ({
      titulo: document.title,
      temSenha: Boolean(document.querySelector('input[type=password]')),
      texto: (document.body?.innerText || '').replace(/\n{2,}/g, '\n').trim(),
    }))
    .catch((e) => ({ erro: e.message }));
  console.log(`aba CLARO: ${url.split('?')[0].slice(0, 160)}`);
  console.log(`título: ${info.titulo || '—'} · tela com campo de senha: ${info.temSenha ? 'SIM (ainda no login)' : 'não'}`);
  if (info.erro) console.log(`erro: ${info.erro}`);
  else console.log(`--- texto visível ---\n${info.texto.slice(0, max)}`);
}
browser.disconnect();
process.exit(0);
