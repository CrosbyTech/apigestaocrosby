// Peças comuns dos scripts da Minha Claro Empresas: ligar no Chrome do robô (já logado pelo usuário),
// achar a aba, clicar por texto e esperar respostas do portal. Nada aqui digita senha nem guarda token.
import puppeteer from 'puppeteer';
import { PORTA } from './abrir.mjs';

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ligar() {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORTA}`, defaultViewport: null }).catch(() => null);
  if (!browser) throw new Error('O Chrome do robô não está aberto (rode abrir.mjs e faça o login).');
  const page = (await browser.pages()).find((p) => /minhaclaroempresas\.claro\.com\.br/i.test(p.url()));
  if (!page) throw new Error('Não achei a aba da Minha Claro Empresas no Chrome do robô.');
  return { browser, page };
}

/** Texto visível da tela. */
export const textoDaTela = (page) => page.evaluate(() => (document.body?.innerText || '').replace(/\n{2,}/g, '\n').trim()).catch(() => '');

/** A sessão caiu? (tela de login ou de boas-vindas sem conta) */
export async function semSessao(page) {
  const t = await textoDaTela(page);
  return /Acesso rápido\s+Fatura fácil|Entrar com|Fazer login/i.test(t) && !/Sair/.test(t.slice(0, 400));
}

/** Clica (com o mouse) no elemento mais interno cujo texto é igual a `texto` (ou o contém). n = qual ocorrência. */
export async function clicar(page, texto, { n = 1, contem = true } = {}) {
  const alvo = await page.evaluate(
    (t, qual, aceitaConter) => {
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const a = norm(t);
      const visivel = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      };
      const todos = [...document.querySelectorAll('button, a, [role=button], [role=tab], [role=option], [role=menuitem], li, label, span, div, p, h1, h2, h3, h4, td')].filter(visivel);
      let lista = todos.filter((el) => norm(el.innerText) === a);
      if (!lista.length && aceitaConter) lista = todos.filter((el) => norm(el.innerText).includes(a)).sort((x, y) => norm(x.innerText).length - norm(y.innerText).length);
      lista = lista.filter((el, _i, arr) => !arr.some((o) => o !== el && el.contains(o) && norm(o.innerText) === norm(el.innerText)));
      const el = lista[qual - 1];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, total: lista.length };
    },
    texto,
    n,
    contem,
  );
  if (!alvo) return false;
  await page.mouse.click(alvo.x, alvo.y);
  return true;
}

/**
 * Espera a próxima resposta do GraphQL do portal cuja operação (nome ou começo da query) casa com `re`
 * e, se dado, cujas variáveis passam em `filtro`. Devolve o JSON da resposta (ou null no tempo esgotado).
 */
export function esperarOperacao(page, re, { filtro = null, timeoutMs = 25000 } = {}) {
  return new Promise((resolve) => {
    let fim = false;
    const acabar = (v) => {
      if (fim) return;
      fim = true;
      clearTimeout(t);
      page.off('response', ao);
      resolve(v);
    };
    const t = setTimeout(() => acabar(null), timeoutMs);
    const ao = async (res) => {
      try {
        if (!/mcm-backend-v1\/v1\/graphql/.test(res.url()) || res.request().method() !== 'POST') return;
        const corpo = JSON.parse(res.request().postData() || '{}');
        if (!re.test(`${corpo.operationName || ''} ${String(corpo.query || '').slice(0, 200)}`)) return;
        if (filtro && !filtro(corpo.variables || {})) return;
        const json = await res.json().catch(() => null);
        acabar({ status: res.status(), variaveis: corpo.variables || {}, json });
      } catch {
        /* resposta que não interessa */
      }
    };
    page.on('response', ao);
  });
}
