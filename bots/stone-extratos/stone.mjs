// =============================================================================
// Automação do portal Stone (conta.stone.com.br) com Puppeteer.
//
// Princípios:
//  - O bot NUNCA digita usuário/senha. O login é feito à mão UMA vez com
//    `login.bat` (janela visível, com token/biometria do próprio Yago); o
//    Chrome guarda a sessão em perfil-chrome/ e as execuções seguintes
//    reaproveitam. Sessão expirou → o bot avisa no log e pede novo login.
//  - Só LÊ: lista contas, saldo, extrato e exporta PDF. Nada de transferência.
//  - Dados vêm da mesma API que o portal consome (api.openbank.stone.com.br,
//    contrato público em docs.openbank.stone.com.br): o bot captura o
//    Authorization que o próprio portal manda e faz os GETs de dentro da página.
//  - O PDF oficial sai pelo roteiro de cliques do config.json (pdf.passos);
//    se o portal mudar, ajusta-se o roteiro sem mexer no código. Falhou o PDF?
//    O extrato vai em JSON (fallback) e o log diz exatamente onde parou.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const brDe = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export class Stone {
  /**
   * @param {object} cfg config.json (stone, pdf, headless, janelaOculta)
   * @param {object} dirs { perfil, downloads, capturas }
   * @param {(msg:string, nivel?:string)=>void} log
   */
  constructor(cfg, dirs, log) {
    this.cfg = cfg;
    this.dirs = dirs;
    this.log = log || (() => {});
    this.url = (cfg.stone?.url || 'https://conta.stone.com.br').replace(/\/+$/, '');
    this.apiRegex = new RegExp(cfg.stone?.apiRegex || '/api/v1/accounts|openbank\\.stone\\.com\\.br', 'i');
    this.api = null; // { base, headers } capturado do próprio portal
    this.requisicoes = []; // só no --mapear
    this.mapear = false;
  }

  // ─── navegador ─────────────────────────────────────────────────────────────
  async abrir({ visivel = false } = {}) {
    for (const d of Object.values(this.dirs)) fs.mkdirSync(d, { recursive: true });
    const headless = visivel ? false : !!this.cfg.headless;
    const args = ['--no-first-run', '--no-default-browser-check', '--lang=pt-BR', '--disable-blink-features=AutomationControlled', '--window-size=1366,900'];
    if (!visivel && !this.cfg.headless && this.cfg.janelaOculta !== false) args.push('--window-position=-32000,-32000');
    this.browser = await puppeteer.launch({
      headless,
      userDataDir: this.dirs.perfil,
      defaultViewport: { width: 1366, height: 900 },
      args,
    });
    const paginas = await this.browser.pages();
    this.page = paginas[0] || (await this.browser.newPage());
    this.page.setDefaultTimeout(30000);
    this.cdp = await this.page.createCDPSession();
    await this.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: this.dirs.downloads, eventsEnabled: true });
    this.downloads = new Map(); // guid → { nome, estado }
    this.cdp.on('Browser.downloadWillBegin', (ev) => this.downloads.set(ev.guid, { nome: ev.suggestedFilename, estado: 'inProgress' }));
    this.cdp.on('Browser.downloadProgress', (ev) => {
      const d = this.downloads.get(ev.guid);
      if (d) d.estado = ev.state;
    });
    this.page.on('request', (req) => this.#observarRequisicao(req));
    if (this.mapear) this.page.on('response', (res) => this.requisicoes.push({ m: res.request().method(), url: res.url(), status: res.status() }));
    return this.page;
  }

  async fechar() {
    try {
      await this.browser?.close();
    } catch {
      /* ignore */
    }
  }

  #observarRequisicao(req) {
    try {
      const u = req.url();
      if (this.api || !this.apiRegex.test(u)) return;
      const h = req.headers();
      const auth = h.authorization || h.Authorization;
      if (!auth) return;
      const headers = { authorization: auth };
      for (const [k, v] of Object.entries(h)) if (/^x-/i.test(k) && !/idempotency/i.test(k)) headers[k] = v;
      if (h.accept) headers.accept = h.accept;
      const base = new URL(u);
      const idx = base.pathname.indexOf('/api/v1/');
      this.api = { base: base.origin + (idx > 0 ? base.pathname.slice(0, idx) : ''), headers };
      this.log(`API do portal capturada: ${this.api.base}`);
    } catch {
      /* ignore */
    }
  }

  // ─── sessão ────────────────────────────────────────────────────────────────
  async irParaInicio() {
    await this.page.goto(this.url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await this.#fecharCookies();
    await dormir(1500);
  }

  /** true quando a sessão está logada (não caiu em /login) */
  async sessaoOk() {
    const u = this.page.url();
    if (/\/login|\/auth|\/signin/i.test(u)) return false;
    const temLogin = await this.page.$('input#password, input[name="password"]');
    return !temLogin;
  }

  async #fecharCookies() {
    try {
      await this.clicarTexto(['OK', 'Aceitar', 'Entendi'], { timeoutMs: 1500, silencioso: true, exato: true });
    } catch {
      /* sem banner */
    }
  }

  /** Espera a pessoa logar (login.bat). Resolve quando sai da tela de login. */
  async esperarLoginManual({ timeoutMin = 10 } = {}) {
    const fim = Date.now() + timeoutMin * 60000;
    while (Date.now() < fim) {
      if (await this.sessaoOk()) {
        await dormir(2000);
        if (await this.sessaoOk()) return true;
      }
      await dormir(2000);
    }
    return false;
  }

  // ─── API (mesma que o portal usa) ──────────────────────────────────────────
  async garantirApi({ timeoutMs = 25000 } = {}) {
    const inicio = Date.now();
    let cutucou = false;
    while (!this.api && Date.now() - inicio < timeoutMs) {
      if (!cutucou && Date.now() - inicio > timeoutMs / 2) {
        // metade do tempo sem capturar nada: cutuca o portal (recarrega / abre o extrato)
        cutucou = true;
        await this.page.reload({ waitUntil: 'networkidle2' }).catch(() => {});
        await this.clicarTexto(['Extrato'], { timeoutMs: 3000, silencioso: true }).catch(() => {});
      }
      await dormir(500);
    }
    if (!this.api) throw new Error('Não capturei a API do portal (nenhuma chamada autenticada a /api/v1/accounts). Rode --mapear para ver o que o portal chama.');
    return this.api;
  }

  async apiGet(rota) {
    await this.garantirApi();
    const url = /^https?:/i.test(rota) ? rota : `${this.api.base}${rota}`;
    const r = await this.page.evaluate(
      async (u, headers) => {
        const resp = await fetch(u, { method: 'GET', headers, credentials: 'include' });
        const texto = await resp.text();
        return { status: resp.status, texto };
      },
      url,
      this.api.headers,
    );
    if (r.status === 401 || r.status === 403) {
      this.api = null; // token venceu: tenta recapturar na próxima
      throw new Error(`API ${r.status} em ${rota} (token do portal expirou?)`);
    }
    if (r.status >= 400) throw new Error(`API ${r.status} em ${rota}: ${r.texto.slice(0, 200)}`);
    try {
      return JSON.parse(r.texto);
    } catch {
      throw new Error(`API ${rota}: resposta não é JSON (${r.texto.slice(0, 120)})`);
    }
  }

  async listarContas() {
    const j = await this.apiGet('/api/v1/accounts?paginate=false');
    const lista = Array.isArray(j) ? j : j?.data || [];
    return lista.map((c) => ({
      id: c.id,
      account_code: c.account_code,
      branch_code: c.branch_code,
      owner_name: c.owner_name,
      owner_document: c.owner_document,
      owner_id: c.owner_id,
    }));
  }

  async saldo(accountId) {
    const j = await this.apiGet(`/api/v1/accounts/${accountId}/balance`);
    return { balance: j.balance, blocked_balance: j.blocked_balance, scheduled_balance: j.scheduled_balance };
  }

  /** Lançamentos do período (de/ate ISO, inclusivos) — pagina pelo cursor. */
  async extrato(accountId, { de, ate }) {
    const limite = this.cfg.stone?.limitePagina || 100;
    const ini = encodeURIComponent(`${de}T00:00:00-03:00`);
    const fim = encodeURIComponent(`${ate}T23:59:59-03:00`);
    const entradas = [];
    let after = null;
    for (let pagina = 0; pagina < 200; pagina++) {
      const rota = `/api/v1/accounts/${accountId}/statement?limit=${limite}&start_datetime=${ini}&end_datetime=${fim}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
      const j = await this.apiGet(rota);
      const dados = Array.isArray(j) ? j : j?.data || [];
      entradas.push(...dados);
      after = j?.cursor?.after || null;
      if (!after || dados.length < limite || !dados.length) break;
    }
    return entradas;
  }

  // ─── roteiro de cliques (PDF) ──────────────────────────────────────────────
  #substituir(txt, vars) {
    return String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  }

  /** Clica no primeiro elemento clicável cujo texto bate com algum dos textos. */
  async clicarTexto(textos, { timeoutMs = 8000, silencioso = false, exato = false } = {}) {
    const fim = Date.now() + timeoutMs;
    const alvos = (Array.isArray(textos) ? textos : [textos]).map((t) => String(t).trim()).filter(Boolean);
    while (Date.now() < fim) {
      const clicou = await this.page.evaluate(
        (alvos, exato) => {
          const norm = (s) =>
            String(s || '')
              .normalize('NFD')
              .replace(/[̀-ͯ]/g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();
          const visivel = (el) => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
          };
          const cands = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="link"], li, label, span, div, p')];
          for (const alvo of alvos) {
            const a = norm(alvo);
            if (!a) continue;
            let melhor = null;
            for (const el of cands) {
              if (!visivel(el)) continue;
              const t = norm(el.innerText || el.textContent);
              if (!t || t.length > 120) continue;
              const bate = exato ? t === a : t === a || t.startsWith(a) || t.includes(a);
              if (!bate) continue;
              // prefere o elemento mais específico (menor texto) e nativamente clicável
              const peso = (t === a ? 0 : 10) + t.length / 100 + (/^(button|a)$/i.test(el.tagName) || el.getAttribute('role') ? 0 : 5);
              if (!melhor || peso < melhor.peso) melhor = { el, peso };
            }
            if (melhor) {
              melhor.el.scrollIntoView({ block: 'center' });
              const clicavel = melhor.el.closest('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"], label') || melhor.el;
              clicavel.click();
              return alvo;
            }
          }
          return null;
        },
        alvos,
        exato,
      );
      if (clicou) {
        if (!silencioso) this.log(`clique: "${clicou}"`);
        await dormir(700);
        return clicou;
      }
      await dormir(300);
    }
    throw new Error(`não achei nada clicável com o texto ${alvos.map((t) => `"${t}"`).join(' / ')}`);
  }

  /** Preenche o input identificado pelo rótulo/placeholder/aria-label. */
  async preencher(rotulos, valor, { timeoutMs = 6000 } = {}) {
    const fim = Date.now() + timeoutMs;
    const alvos = (Array.isArray(rotulos) ? rotulos : [rotulos]).map((t) => String(t).trim()).filter(Boolean);
    while (Date.now() < fim) {
      const handle = await this.page.evaluateHandle((alvos) => {
        const norm = (s) =>
          String(s || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .trim()
            .toLowerCase();
        const inputs = [...document.querySelectorAll('input:not([type=hidden]), textarea')].filter((i) => i.getBoundingClientRect().width > 0);
        for (const alvo of alvos) {
          const a = norm(alvo);
          for (const i of inputs) {
            const lab = i.labels?.[0]?.innerText || document.querySelector(`label[for="${i.id}"]`)?.innerText || '';
            const chaves = [i.placeholder, i.getAttribute('aria-label'), i.name, i.id, lab].map(norm);
            if (chaves.some((c) => c && (c === a || c.includes(a)))) return i;
          }
        }
        return null;
      }, alvos);
      const el = handle.asElement();
      if (el) {
        await el.click({ clickCount: 3 });
        await this.page.keyboard.press('Backspace');
        await el.type(String(valor), { delay: 30 });
        await this.page.keyboard.press('Tab');
        this.log(`preenchi "${alvos[0]}" = ${valor}`);
        await dormir(400);
        return true;
      }
      await dormir(300);
    }
    throw new Error(`não achei campo com rótulo ${alvos.map((t) => `"${t}"`).join(' / ')}`);
  }

  async esperarDownload({ timeoutSeg = 90, antes = new Set() } = {}) {
    const fim = Date.now() + timeoutSeg * 1000;
    while (Date.now() < fim) {
      for (const [guid, d] of this.downloads) {
        if (antes.has(guid)) continue;
        if (d.estado === 'completed') {
          const caminho = path.join(this.dirs.downloads, d.nome);
          if (fs.existsSync(caminho)) return caminho;
        }
        if (d.estado === 'canceled') throw new Error('download cancelado pelo navegador');
      }
      await dormir(500);
    }
    throw new Error(`download não terminou em ${timeoutSeg}s`);
  }

  /**
   * Executa uma lista de passos do config (ir / clicar / preencher / esperar /
   * esperarDownload). Devolve o caminho do arquivo baixado (se houve).
   */
  async roteiro(passos, vars, { rotulo = 'roteiro' } = {}) {
    let arquivo = null;
    const antes = new Set(this.downloads.keys());
    for (let i = 0; i < (passos || []).length; i++) {
      const p = passos[i];
      const desc = `${rotulo} passo ${i + 1}/${passos.length} (${p.acao})`;
      try {
        if (p.acao === 'ir') {
          await this.page.goto(this.#substituir(p.url, vars), { waitUntil: 'networkidle2', timeout: 60000 });
          await this.#fecharCookies();
        } else if (p.acao === 'clicar') {
          await this.clicarTexto((p.texto || []).map((t) => this.#substituir(t, vars)), { timeoutMs: p.timeoutMs || 8000, exato: !!p.exato });
        } else if (p.acao === 'preencher') {
          await this.preencher(p.rotulo || p.seletor, this.#substituir(p.valor, vars), { timeoutMs: p.timeoutMs || 6000 });
        } else if (p.acao === 'seletor') {
          await this.page.click(p.seletor, { delay: 50 });
        } else if (p.acao === 'esperar') {
          await dormir(p.ms || 1000);
        } else if (p.acao === 'esperarDownload') {
          arquivo = await this.esperarDownload({ timeoutSeg: this.cfg.pdf?.timeoutDownloadSeg || 90, antes });
        } else {
          throw new Error(`ação desconhecida "${p.acao}"`);
        }
      } catch (e) {
        if (p.opcional) {
          this.log(`${desc}: pulado (${e.message})`, 'aviso');
          continue;
        }
        const cap = await this.capturar(`${rotulo}-passo${i + 1}`);
        throw new Error(`${desc}: ${e.message}${cap ? ` [captura: ${path.basename(cap)}]` : ''}`);
      }
    }
    return arquivo;
  }

  async capturar(nome) {
    try {
      const arq = path.join(this.dirs.capturas, `${new Date().toISOString().replace(/[:.]/g, '-')}_${nome}.png`);
      await this.page.screenshot({ path: arq, fullPage: false });
      return arq;
    } catch {
      return null;
    }
  }

  // ─── mapeamento (para ajustar o roteiro quando o portal muda) ──────────────
  async mapa(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const info = await this.page.evaluate(() => {
      const vis = (el) => el.getBoundingClientRect().width > 0;
      const pega = (sel) =>
        [...document.querySelectorAll(sel)]
          .filter(vis)
          .map((el) => ({ tag: el.tagName, texto: (el.innerText || '').trim().slice(0, 80), href: el.href || null, role: el.getAttribute('role'), id: el.id || null, name: el.name || null, placeholder: el.placeholder || null }))
          .filter((x) => x.texto || x.placeholder || x.href);
      return { url: location.href, titulo: document.title, clicaveis: pega('button, a, [role="button"], [role="menuitem"], [role="tab"]'), inputs: pega('input, select, textarea') };
    });
    const nome = `${Date.now()}_${info.url.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}`;
    fs.writeFileSync(path.join(dir, `${nome}.json`), JSON.stringify({ ...info, api: this.api ? { base: this.api.base, headers: Object.keys(this.api.headers) } : null, requisicoes: this.requisicoes }, null, 2));
    await this.page.screenshot({ path: path.join(dir, `${nome}.png`), fullPage: true }).catch(() => {});
    return path.join(dir, `${nome}.json`);
  }
}

export const helpers = { brDe, soDigitos, dormir };
