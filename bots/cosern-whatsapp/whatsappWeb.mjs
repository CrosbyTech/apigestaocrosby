// =============================================================================
// WhatsApp Web controlado pelo Puppeteer, com um perfil só do bot.
//
// Serve para o que a API (uazapi) não faz: clicar nos botões e preencher os
// formulários (WhatsApp Flows) que as concessionárias mandam. O login é pelo QR
// code, lido uma vez com o celular do número; a sessão fica em perfil-chrome/.
// Os cliques são do mouse de verdade, no botão achado pelo texto.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const pausa = (min = 400, max = 1100) => dormir(min + Math.random() * (max - min)); // ritmo de gente

// o Chrome desacelera página coberta ou minimizada; o bot precisa andar mesmo sem a janela à vista
const SEM_ECONOMIA = ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion"];

export class WhatsAppWeb {
  constructor({ perfil, capturas, log = console.log }) {
    this.perfil = perfil;
    this.capturas = capturas;
    this.log = log;
    this.nFoto = 0;
  }

  async abrir() {
    fs.mkdirSync(this.capturas, { recursive: true });
    // Chrome instalado no PC, quando existe; senão o do Puppeteer
    const instalado = process.env.BOT_CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
    if (instalado) {
      // Chrome aberto como uma pessoa abriria (sem as opções de automação do Puppeteer); o bot só se conecta a ele
      const porta = 9300 + Math.floor(Math.random() * 600); // porta nova a cada execução: uma anterior pode ter ficado presa
      this.processo = spawn(instalado, [`--remote-debugging-port=${porta}`, `--user-data-dir=${this.perfil}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", ...SEM_ECONOMIA, "about:blank"], { detached: false, stdio: "ignore" });
      for (let i = 0; i < 40 && !this.browser; i += 1) {
        await dormir(500);
        this.browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${porta}`, defaultViewport: null }).catch(() => null);
      }
      if (!this.browser) throw new Error("não consegui conectar ao Chrome");
    } else {
      this.browser = await puppeteer.launch({
        headless: false,
        userDataDir: this.perfil,
        defaultViewport: null,
        args: ["--no-first-run", "--no-default-browser-check", "--lang=pt-BR", "--disable-blink-features=AutomationControlled", "--window-size=1280,900"],
      });
    }
    [this.page] = await this.browser.pages();
    this.page.setDefaultTimeout(30000);
    await this.page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  async fechar() {
    await this.browser?.close().catch(() => {});
    // o Chrome aberto à parte tem que sair junto, senão fica comendo memória e prendendo o perfil
    if (this.processo?.pid) spawn("taskkill", ["/F", "/T", "/PID", String(this.processo.pid)], { stdio: "ignore" });
    await dormir(1500);
  }

  logado() {
    return this.page.evaluate(() => Boolean(document.querySelector('#pane-side, #side, [aria-label="Lista de conversas"]'))).catch(() => false);
  }

  /** Espera o QR code ser lido (ou a sessão salva carregar). */
  async esperarLogin({ timeoutMin = 10 } = {}) {
    const fim = Date.now() + timeoutMin * 60000;
    let avisou = false;
    while (Date.now() < fim) {
      if (await this.logado()) return true;
      if (!avisou && (await this.page.$('canvas').catch(() => null))) {
        this.log('QR code na tela: no celular, WhatsApp → Aparelhos conectados → Conectar um aparelho.');
        avisou = true;
      }
      await dormir(2000);
    }
    return false;
  }

  async foto(nome) {
    this.nFoto += 1;
    const arq = path.join(this.capturas, `${String(this.nFoto).padStart(2, '0')}-${nome}.png`);
    await this.page.screenshot({ path: arq }).catch(() => {});
    return arq;
  }

  /** Abre a conversa com o número (só dígitos, com DDI). */
  async abrirConversa(numero) {
    await this.page.goto(`https://web.whatsapp.com/send?phone=${numero}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForSelector('#main footer', { timeout: 90000 });
    await pausa(1500, 2500);
  }

  /**
   * Lista o que dá para clicar ou preencher: no formulário aberto (dialogo) ou
   * na conversa. Marca cada item com data-hc para o clique achar depois.
   * O formulário (WhatsApp Flow) roda numa moldura de flows.whatsapp.net.
   */
  async interativos({ dialogo = false } = {}) {
    const moldura = dialogo ? this.page.frames().find((f) => /flows.whatsapp.net/.test(f.url())) : this.page.mainFrame();
    if (!moldura) return null;
    this.moldura = moldura;
    return moldura.evaluate((soDialogo) => {
      const visivel = (e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const raiz = soDialogo ? document.body : document.querySelector('#main');
      if (!raiz) return null;
      const limpo = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const rotulo = (e) => {
        const direto = e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('title');
        if (direto) return limpo(direto);
        const lb = e.getAttribute('aria-labelledby');
        if (lb) return limpo(lb.split(' ').map((id) => document.getElementById(id)?.innerText || '').join(' '));
        if (e.id) {
          const l = document.querySelector(`label[for="${CSS.escape(e.id)}"]`);
          if (l) return limpo(l.innerText);
        }
        const dentro = e.closest('label');
        if (dentro) return limpo(dentro.innerText);
        let p = e.parentElement;
        for (let i = 0; i < 7 && p; i += 1, p = p.parentElement) {
          const t = limpo(p.innerText);
          if (t && t.length <= 160) return t;
        }
        return '';
      };
      document.querySelectorAll('[data-hc]').forEach((e) => e.removeAttribute('data-hc'));
      const sel = 'button,[role="button"],input,textarea,[contenteditable="true"],[role="radio"],[role="checkbox"],[role="option"],[role="combobox"],[role="listbox"],[role="menuitem"],select';
      const itens = [...raiz.querySelectorAll(sel)].filter(visivel).map((e, i) => {
        e.setAttribute('data-hc', String(i));
        return {
          i,
          tag: e.tagName.toLowerCase(),
          role: e.getAttribute('role') || '',
          tipo: e.getAttribute('type') || '',
          texto: limpo(e.innerText).slice(0, 90),
          rotulo: rotulo(e).slice(0, 160),
          valor: 'value' in e ? String(e.value || '') : e.isContentEditable ? limpo(e.innerText) : '',
          marcado: e.checked === true || ['aria-checked', 'aria-selected', 'aria-pressed'].some((a) => e.getAttribute(a) === 'true') || Boolean(e.querySelector('[aria-checked="true"],input:checked')),
          emLista: !e.matches('ul,[role="listbox"],[role="radiogroup"]') && Boolean(e.closest('ul,[role="listbox"],[role="radiogroup"]')),
          desabilitado: e.disabled === true || e.getAttribute('aria-disabled') === 'true',
        };
      });
      return { texto: limpo(raiz.innerText).slice(0, 1200), itens };
    }, dialogo).catch(() => null); // moldura fechou no meio da leitura
  }

  async #alvo(i) {
    const el = await (this.moldura || this.page.mainFrame()).$(`[data-hc="${i}"]`);
    if (!el) throw new Error(`item ${i} sumiu da tela`);
    await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    // espera a rolagem parar: só clica quando a posição se repete
    let caixa = null;
    for (let t = 0; t < 10; t += 1) {
      await dormir(300);
      const agora = await el.boundingBox();
      if (agora && caixa && Math.abs(agora.y - caixa.y) < 1 && Math.abs(agora.x - caixa.x) < 1) break;
      caixa = agora;
    }
    if (!caixa) throw new Error(`item ${i} sem posição na tela`);
    return { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 };
  }

  /** Clique de mouse no item listado por interativos(). */
  async clicar(i) {
    const { x, y } = await this.#alvo(i);
    await this.page.mouse.move(x, y, { steps: 8 });
    await pausa(150, 350);
    await this.page.mouse.click(x, y);
    await pausa();
  }

  async digitar(i, texto) {
    await this.clicar(i);
    await this.page.keyboard.type(String(texto), { delay: 70 + Math.random() * 60 });
    await pausa();
  }

  /** Clica no botão da ÚLTIMA mensagem recebida cujo texto bate com o regex. */
  async clicarBotaoDaConversa(re) {
    const d = await this.interativos();
    const botoes = (d?.itens || []).filter((it) => (it.tag === 'button' || it.role === 'button') && re.test(it.texto) && it.texto.length <= 40);
    if (botoes.length) {
      // botão antigo (já respondido) abre só o resumo "Sua resposta": o certo é o da última mensagem,
      // então não pode haver outra mensagem depois dele na página
      const ehUltimo = await this.page.evaluate((i) => {
        const el = document.querySelector(`[data-hc="${i}"]`);
        const fim = document.querySelector('#main footer');
        if (!el || !fim) return false;
        const faixa = document.createRange();
        faixa.setStartAfter(el);
        faixa.setEndBefore(fim);
        return faixa.toString().replace(/\s+/g, '').length < 4;
      }, botoes.at(-1).i);
      if (!ehUltimo) return false;
      await this.clicar(botoes.at(-1).i);
      return true;
    }
    // botão sem role: acha pelo texto exato do elemento mais interno
    const achou = await this.page.evaluate((fonte, flags) => {
      const rx = new RegExp(fonte, flags);
      const alvos = [...document.querySelectorAll('#main *')].filter((e) => e.children.length === 0 && rx.test((e.innerText || '').trim()) && (e.innerText || '').trim().length <= 40);
      const ultimo = alvos.at(-1);
      if (!ultimo) return false;
      document.querySelectorAll('[data-hc]').forEach((e) => e.removeAttribute('data-hc'));
      ultimo.setAttribute('data-hc', 'texto');
      return true;
    }, re.source, re.flags);
    if (!achou) return false;
    await this.clicar('texto');
    return true;
  }

  /** O que há na tela quando algo não abre como esperado (para ajustar o bot). */
  diagnostico() {
    return this.page.evaluate(() => {
      const limpo = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      return {
        iframes: [...document.querySelectorAll('iframe')].map((f) => f.src.slice(0, 120)),
        papeis: [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="application"],[aria-modal="true"]')].map((e) => `${e.getAttribute('role')}: ${limpo(e.innerText)}`),
        corpo: [...document.body.children].map((e) => `${e.tagName.toLowerCase()}#${e.id} ${limpo(e.innerText)}`),
      };
    });
  }

  /** Fecha um formulário aberto sem enviar (Esc). */
  async fecharDialogo() {
    await this.page.keyboard.press('Escape');
    await pausa();
  }
}
