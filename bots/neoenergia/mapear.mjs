// =============================================================================
// Mapeador da Agência Virtual da Neoenergia (Cosern).
//
// Abre o Chrome visível com um perfil próprio (perfil-chrome/). O login é feito
// à mão: o bot nunca digita documento, senha ou captcha. Enquanto você navega,
// grava em mapa/chamadas.ndjson cada chamada à API do portal (método, URL,
// status, corpo enviado e resposta), sem senha, captcha nem token.
// Feche o Chrome para terminar.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const pasta = path.dirname(fileURLToPath(import.meta.url));
const dirMapa = path.join(pasta, 'mapa');
fs.mkdirSync(dirMapa, { recursive: true });
const saida = path.join(dirMapa, 'chamadas.ndjson');
const API = /apineprd\.neoenergia\.com|avapineanl\.neoenergia\.com|multilogin-cosern\.neoenergia\.net/i;
const SEGREDO = /senha|password|recaptcha|captcha|token|authorization|secret/i;

// tira senha, captcha e token de qualquer JSON antes de gravar
function limpar(v) {
  if (Array.isArray(v)) return v.map(limpar);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SEGREDO.test(k) ? '[omitido]' : limpar(x)]));
  if (typeof v === 'string' && v.length > 3000) return `${v.slice(0, 200)}… (${v.length} caracteres)`;
  return v;
}
const lerJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

const browser = await puppeteer.launch({
  headless: false,
  userDataDir: path.join(pasta, 'perfil-chrome'),
  defaultViewport: null,
  args: ['--no-first-run', '--no-default-browser-check', '--lang=pt-BR', '--disable-blink-features=AutomationControlled', '--window-size=1366,900'],
});
const [page] = await browser.pages();
let n = 0;

page.on('response', async (res) => {
  const req = res.request();
  const url = res.url();
  if (!API.test(url) || req.method() === 'OPTIONS') return;
  const headers = req.headers();
  const registro = {
    em: new Date().toISOString(),
    metodo: req.method(),
    url: url.replace(/([?&](?:recaptcha|token)[^=]*=)[^&]+/gi, '$1[omitido]'),
    status: res.status(),
    autenticado: Boolean(headers.authorization),
    headersEnviados: Object.keys(headers).filter((k) => !SEGREDO.test(k)),
    corpoEnviado: limpar(lerJson(req.postData() || '') ?? (req.postData() ? '[não JSON]' : null)),
    tipoResposta: res.headers()['content-type'] || null,
  };
  try {
    if (/json/i.test(registro.tipoResposta || '')) registro.resposta = limpar(lerJson(await res.text()));
    else if (/pdf|octet/i.test(registro.tipoResposta || '')) registro.resposta = `[arquivo ${(await res.buffer()).length} bytes]`;
  } catch {
    registro.resposta = '[não consegui ler]';
  }
  fs.appendFileSync(saida, `${JSON.stringify(registro)}\n`);
  n += 1;
  console.log(`${String(n).padStart(3)} ${registro.metodo} ${registro.status} ${registro.url.slice(0, 140)}`);
});

await page.goto('https://agenciavirtual.neoenergia.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
console.log('\nFaça o login na janela do Chrome e navegue:');
console.log('  1) escolha a Cosern e entre com o documento e a senha;');
console.log('  2) abra a lista de unidades consumidoras;');
console.log('  3) abra "Faturas" / "2ª via" de uma unidade e baixe o PDF;');
console.log('  4) se aparecer Multilogin / vínculos, abra também.');
console.log(`Gravando em ${saida}. Feche o Chrome quando terminar.\n`);
await new Promise((ok) => browser.on('disconnected', ok));
console.log(`\nFim: ${n} chamada(s) gravada(s) em ${saida}`);
