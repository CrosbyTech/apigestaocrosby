// Ferramenta de exploração: liga-se ao Chrome do robô (já logado pelo usuário), executa passos simples
// na aba da Claro e mostra o texto da tela e as chamadas de API que o portal fez.
// Nunca digita senha; não grava cabeçalho de autorização, token nem cookie.
// Uso: node bots/claro-empresas/passo.mjs "clicar:Texto do botão" "esperar:3000" "ir:#/Rota" "texto:4000"
//   clicar:<texto>      clica no primeiro elemento clicável cujo texto é (ou contém) <texto>
//   clicarn:<n>:<texto> clica na n-ésima ocorrência (1 = primeira)
//   esperar:<ms>
//   ir:<url ou #/rota>
//   texto:<n>           quantos caracteres do texto da tela mostrar no fim (padrão 3000)
//   links               lista botões e links visíveis
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { PORTA, PASTA } from './abrir.mjs';

const dirMapa = path.join(PASTA, 'mapa');
fs.mkdirSync(dirMapa, { recursive: true });
const SEGREDO = /senha|password|captcha|token|authorization|secret|cookie|bearer|jwt|apikey|api_key|authpayload|sessao|session/i;
function limpar(v, nivel = 0) {
  if (Array.isArray(v)) return v.slice(0, 60).map((x) => limpar(x, nivel + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SEGREDO.test(k) ? '[omitido]' : limpar(x, nivel + 1)]));
  if (typeof v === 'string' && v.length > 1500) return `${v.slice(0, 120)}… (${v.length} caracteres)`;
  return v;
}
const lerJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORTA}`, defaultViewport: null }).catch(() => null);
if (!browser) {
  console.log('O Chrome do robô não está aberto.');
  process.exit(1);
}
const page = (await browser.pages()).find((p) => /claro\.com\.br/i.test(p.url()));
if (!page) {
  console.log('Não achei a aba da Claro.');
  process.exit(1);
}
const chamadas = [];
const aoResponder = async (res) => {
  const req = res.request();
  const url = res.url();
  if (req.method() === 'OPTIONS' || !/claro|embratel|net\.com/i.test(url)) return;
  const tipo = res.headers()['content-type'] || '';
  if (!/json|pdf|octet/i.test(tipo)) return;
  const reg = { em: new Date().toISOString(), metodo: req.method(), url: url.replace(/([?&](?:token|access_token|jwt)[^=]*=)[^&]+/gi, '$1[omitido]'), status: res.status(), tipo, enviado: limpar(lerJson(req.postData() || '') ?? (req.postData() ? '[não JSON]' : null)) };
  try {
    if (/json/i.test(tipo)) reg.resposta = limpar(lerJson(await res.text()));
    else reg.resposta = `[arquivo ${(await res.buffer()).length} bytes]`;
  } catch {
    reg.resposta = '[não consegui ler]';
  }
  chamadas.push(reg);
  fs.appendFileSync(path.join(dirMapa, 'chamadas.ndjson'), `${JSON.stringify(reg)}\n`);
};
page.on('response', aoResponder);
// downloads do portal caem em faturas/_baixando (nunca na pasta Downloads do usuário)
const dirBaixar = path.join(PASTA, 'faturas', '_baixando');
fs.mkdirSync(dirBaixar, { recursive: true });
try {
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dirBaixar, eventsEnabled: true });
} catch (e) {
  console.log('  (não consegui definir a pasta de download: ' + e.message + ')');
}

async function clicar(texto, n = 1) {
  const achou = await page.evaluate(
    (alvo, qual) => {
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const a = norm(alvo);
      const visivel = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      };
      const candidatos = [...document.querySelectorAll('button, a, [role=button], [role=tab], [role=menuitem], [role=option], li, label, span, div, p, h1, h2, h3, h4, td')].filter(visivel);
      const exatos = candidatos.filter((el) => norm(el.innerText) === a);
      const contem = candidatos.filter((el) => norm(el.innerText).includes(a)).sort((x, y) => norm(x.innerText).length - norm(y.innerText).length);
      // o elemento mais interno com o texto
      const lista = (exatos.length ? exatos : contem).filter((el, _i, arr) => !arr.some((o) => o !== el && el.contains(o) && norm(o.innerText) === norm(el.innerText)));
      const el = lista[qual - 1];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, texto: norm(el.innerText).slice(0, 80), total: lista.length };
    },
    texto,
    n,
  );
  if (!achou) {
    console.log(`  não achei "${texto}" (${n}ª)`);
    return false;
  }
  await page.mouse.click(achou.x, achou.y);
  console.log(`  cliquei em <${achou.tag}> "${achou.texto}" (${n} de ${achou.total})`);
  return true;
}

let quantoTexto = 3000;
for (const passo of process.argv.slice(2)) {
  const [cmd, ...resto] = passo.split(':');
  const arg = resto.join(':');
  if (cmd === 'clicar') await clicar(arg);
  else if (cmd === 'clicarn') await clicar(resto.slice(1).join(':'), Number(resto[0]) || 1);
  else if (cmd === 'clicardom') {
    // clique pelo próprio elemento (link/botão que contém o texto), para quando o clique do mouse não pega
    const r = await page.evaluate((alvo) => {
      const norm = (x) => String(x || '').replace(/s+/g, ' ').trim().toLowerCase();
      const els = [...document.querySelectorAll('a, button, [role=button]')].filter((el) => el.getBoundingClientRect().width > 0 && norm(el.innerText) === norm(alvo));
      if (!els.length) return null;
      els[0].scrollIntoView({ block: 'center' });
      els[0].click();
      return { tag: els[0].tagName, total: els.length, html: els[0].outerHTML.slice(0, 300) };
    }, arg);
    console.log(r ? '  clique direto em <' + r.tag + '> (' + r.total + ') ' + r.html : '  não achei link/botão "' + arg + '"');
  }
  else if (cmd === 'esperar') await dormir(Number(arg) || 1000);
  else if (cmd === 'ir') await (arg.startsWith('#') ? page.evaluate((h) => { location.hash = h; }, arg) : page.goto(arg, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log(`  ir: ${e.message}`)));
  else if (cmd === 'texto') quantoTexto = Number(arg) || 3000;
  else if (cmd === 'links') {
    const ls = await page.evaluate(() => [...document.querySelectorAll('button, a, [role=button], [role=tab]')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => `${el.tagName.toLowerCase()}: ${String(el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 70)}${el.getAttribute('href') ? ` → ${el.getAttribute('href').slice(0, 80)}` : ''}`).filter((t) => t.length > 5));
    console.log(`--- botões e links (${ls.length}) ---\n${[...new Set(ls)].join('\n')}`);
  }
  await dormir(600);
}
await dormir(1500);
const texto = await page.evaluate(() => (document.body?.innerText || '').replace(/\n{2,}/g, '\n').trim()).catch(() => '');
console.log(`\nendereço: ${page.url().split('?')[0]}`);
console.log(`--- texto da tela ---\n${texto.slice(0, quantoTexto)}`);
if (chamadas.length) {
  console.log(`\n--- chamadas de API (${chamadas.length}) ---`);
  for (const c of chamadas) console.log(`${c.metodo} ${c.status} ${c.url.slice(0, 170)}${c.enviado ? ` · enviado ${JSON.stringify(c.enviado).slice(0, 160)}` : ''}\n    ↳ ${JSON.stringify(c.resposta).slice(0, 420)}`);
}
page.off('response', aoResponder);
browser.disconnect();
process.exit(0);
