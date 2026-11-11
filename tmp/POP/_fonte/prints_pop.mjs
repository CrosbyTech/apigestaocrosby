// Prints para os POPs. Navega, digita peças na conferência e abre janelas — NUNCA confirma faturamento,
// transação, cancelamento ou envio (as janelas de confirmação são fotografadas e fechadas em "Cancelar").
// uso: node prints_pop.mjs [grupo...]   grupos: pv fat trans brj fatbrj transf
import puppeteer from 'file:///C:/Users/yagom/apigestaocrosby/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import fs from 'node:fs';

const OUT = 'C:/Users/yagom/AppData/Local/Temp/claude/af7426cb677bf6db/a9986a76-d8f3-4913-949a-e558f11b5c92/scratchpad/prints';
fs.mkdirSync(OUT, { recursive: true });
const grupos = process.argv.slice(2);
const quer = (g) => !grupos.length || grupos.includes(g);
let L = 1200;
const A = 4200;
const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: L, height: A, deviceScaleFactor: 1.5 });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
// qualquer caixa nativa (confirmar / pedir motivo) é RECUSADA: os prints não gravam nada
page.on('dialog', (d) => d.dismiss().catch(() => {}));
// fecha uma janela clicando fora dela (nunca em botão)
const fecharNoFundo = async () => {
  await page.evaluate(() => {
    const m = document.querySelector('.fixed.inset-0');
    if (m) m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 500));
};

// a rota pública de teste centraliza o conteúdo na altura da janela: encosta no topo
const encostar = () =>
  page.evaluate(() => {
    for (let n = document.querySelector('h1') || document.querySelector('section') || document.body; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display.includes('flex')) {
        n.style.alignItems = 'flex-start';
        n.style.justifyContent = 'flex-start';
      }
      if (n.scrollTop) n.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });
const abrir = async (rota, ms) => {
  await page.goto(`http://localhost:3000${rota}`, { waitUntil: 'domcontentloaded' });
  await espera(ms);
  await encostar();
  await espera(300);
};
const foto = async (nome, rect, margem = 10) => {
  if (!rect) return console.log(`!! ${nome}: sem recorte`);
  const x = Math.max(0, Math.floor(rect.x - margem));
  const y = Math.max(0, Math.floor(rect.y - margem));
  const clip = { x, y, width: Math.min(L - x, Math.ceil(rect.width + 2 * margem)), height: Math.min(A - y, Math.ceil(rect.height + 2 * margem)) };
  await page.screenshot({ path: `${OUT}/${nome}.jpg`, type: 'jpeg', quality: 90, clip });
  console.log(`ok ${nome} ${Math.round(clip.width)}x${Math.round(clip.height)} @${x},${y}`);
};
// recortes
const topo = (altura) =>
  page.evaluate((h) => {
    // o bloco mais largo que envolve o título (o próprio título às vezes tem um max-w menor)
    let c = document.body;
    let larg = 0;
    for (let n = document.querySelector('h1') || document.querySelector('section'); n && n !== document.body; n = n.parentElement) {
      const w = n.getBoundingClientRect().width;
      if (/max-w/.test(String(n.className)) && w > larg) {
        c = n;
        larg = w;
      }
    }
    const b = c.getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: Math.min(h, b.height) };
  }, altura);
const uniao = (fn, arg) =>
  page.evaluate(
    (src, a) => {
      // eslint-disable-next-line no-new-func
      const els = new Function('a', `return (${src})(a)`)(a).filter(Boolean);
      if (!els.length) return null;
      const rs = els.map((e) => e.getBoundingClientRect());
      const x = Math.min(...rs.map((r) => r.left));
      const y = Math.min(...rs.map((r) => r.top));
      return { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y };
    },
    fn.toString(),
    arg,
  );
const secoes = (lista) => uniao((nomes) => [...document.querySelectorAll('section')].filter((s) => nomes.some((n) => new RegExp(n, 'i').test(s.querySelector('h3')?.innerText || s.innerText.slice(0, 60)))), lista);
const janela = () => uniao(() => [...document.querySelectorAll('.fixed.inset-0')].map((m) => m.firstElementChild));
const clicar = (fn, arg) =>
  page.evaluate(
    (src, a) => {
      // eslint-disable-next-line no-new-func
      const e = new Function('a', `return (${src})(a)`)(a);
      if (e) e.click();
      return !!e;
    },
    fn.toString(),
    arg,
  );
const botao = (texto, dentro = null) =>
  clicar(
    ({ texto: t, dentro: d }) => {
      const bts = [...document.querySelectorAll('button')].filter((b) => new RegExp(t, 'i').test(b.innerText.trim()));
      if (!d) return bts[0] || null;
      // o botão cujo bloco mais próximo (até 6 níveis acima) tem o texto pedido
      const re = new RegExp(d);
      for (let nivel = 1; nivel <= 6; nivel += 1) {
        for (const b of bts) {
          let n = b;
          for (let i = 0; i < nivel && n; i += 1) n = n.parentElement;
          if (n && re.test(n.textContent || '')) return b;
        }
      }
      return null;
    },
    { texto, dentro },
  );
const digitarSku = async (sku) => {
  await page.click('input[placeholder="SKU ou código de barras"]');
  await page.type('input[placeholder="SKU ou código de barras"]', String(sku));
  await page.keyboard.press('Enter');
  await espera(5500);
};
const cancelarJanela = async () => {
  const ok = await clicar(() => [...(document.querySelector('.fixed.inset-0')?.querySelectorAll('button') || [])].find((b) => /^(Cancelar|Voltar|Fechar)$/i.test(b.innerText.trim())));
  if (!ok) await page.keyboard.press('Escape');
  await espera(500);
  const aberta = await page.evaluate(() => !!document.querySelector('.fixed.inset-0'));
  if (aberta) await clicar(() => document.querySelector('.fixed.inset-0'));
  await espera(400);
};

const CHAVE = 'e0c9852e-9908-4e5d-a93e-66748b7622a2'; // RV1288: 3 peças, Pix, separação finalizada
const CHAVE_FATURADO = '069bd832-f2d1-4b0a-b86e-959343526e51'; // RV1321: já faturado

// ─── Pedido de Venda ─────────────────────────────────────────────────────────
if (quer('pv')) {
  L = 1600;
  await page.setViewport({ width: L, height: A, deviceScaleFactor: 1.25 });
  await abrir('/teste-pv-tmp', 10000);
  await foto('pv-1-lista', await topo(800));
  await botao('^Detalhar$', 'RV1288');
  await espera(5000);
  await foto('pv-2-detalhe', await janela());
  await cancelarJanela();
  await botao('^Kanban$');
  await espera(2500);
  await encostar();
  await foto('pv-3-kanban', await topo(900));
  await botao('^Painel$');
  await espera(12000);
  await encostar();
  await foto('pv-4-painel', await topo(1000));
  L = 1200;
  await page.setViewport({ width: L, height: A, deviceScaleFactor: 1.5 });
}

// ─── Faturamento ─────────────────────────────────────────────────────────────
if (quer('fat')) {
  await abrir('/teste-fat-tmp', 9000);
  await foto('fat-1-lista', await topo(640));
  await abrir(`/teste-fat-tmp?chave=${CHAVE}`, 12000);
  await foto('fat-2-pedido-topo', await uniao(() => [document.querySelector('h1').closest('[class*="max-w"]').firstElementChild, ...[...document.querySelectorAll('section')].filter((s) => /CLIENTE E FISCAL|PORTAL RFID/i.test(s.querySelector('h3')?.innerText || ''))]));
  await digitarSku(41667);
  await digitarSku(35626);
  await encostar();
  await foto('fat-3-conferencia', await secoes(['Produtos do pedido']));
  await foto('fat-4-portal', await secoes(['PORTAL RFID']));
  await foto('fat-5-transporte', await secoes(['^TRANSPORTE']));
  await foto('fat-6-pagamento', await secoes(['^PAGAMENTO']));
  await foto('fat-7-totvs', await secoes(['TOTVS \\(DOCUMENTO']));
  // peça em falta → saldo bônus
  await clicar(() => [...document.querySelectorAll('label')].find((l) => /Peça em falta/.test(l.innerText))?.querySelector('input'));
  await espera(500);
  await foto('fat-8-resumo-credito', await secoes(['Peças do pedido']));
  await foto('fat-9-pagina', await uniao(() => [...document.querySelectorAll('section')]));
  // confirmação (fotografa e CANCELA)
  await clicar(() => [...document.querySelectorAll('input[type=checkbox]')].find((c) => /Conferi e quero faturar/.test(c.parentElement.innerText) && !c.checked));
  await espera(500);
  const abriu = await clicar(() => [...document.querySelectorAll('button')].find((b) => /^FATURAR \(/.test(b.innerText.trim()) && !b.disabled));
  await espera(1200);
  if (abriu) {
    await foto('fat-10-confirmar', await janela());
    await cancelarJanela();
  } else console.log('!! FATURAR desabilitado:', await page.evaluate(() => [...document.querySelectorAll('ul.list-disc li')].map((l) => l.innerText).join(' | ')));
  // pedido já faturado
  await abrir(`/teste-fat-tmp?chave=${CHAVE_FATURADO}`, 11000);
  await foto('fat-11-bloqueio', await uniao(() => [document.querySelector('h1').closest('[class*="max-w"]').firstElementChild, [...document.querySelectorAll('div')].find((d) => /^PEDIDO FATURADO/.test(d.innerText || '') && String(d.className).includes('rose')), ...[...document.querySelectorAll('section')].filter((s) => /CLIENTE E FISCAL|PORTAL RFID/i.test(s.querySelector('h3')?.innerText || ''))]));
}

// ─── Transações ──────────────────────────────────────────────────────────────
if (quer('trans')) {
  await abrir('/teste-fat-tmp?aba=transacoes', 12000);
  await foto('trans-1-lista', await topo(760));
  // venda em boleto: duplicata e minuta
  await clicar(() => [...document.querySelectorAll('ul.divide-y > li')].find((l) => /RV1258/.test(l.innerText) && /NF 16515/.test(l.innerText))?.querySelector('button'));
  await espera(8000);
  await foto('trans-2-detalhe-boleto', await uniao(() => [[...document.querySelectorAll('ul.divide-y > li')].find((l) => /RV1258/.test(l.innerText) && /NF 16515/.test(l.innerText))]));
  await clicar(() => [...document.querySelectorAll('ul.divide-y > li')].find((l) => /RV1258/.test(l.innerText) && /NF 16515/.test(l.innerText))?.querySelector('button'));
  await espera(500);
  // venda no cartão
  await clicar(() => [...document.querySelectorAll('ul.divide-y > li')].find((l) => /VJ902/.test(l.innerText))?.querySelector('button'));
  await espera(8000);
  await foto('trans-3-detalhe-cartao', await uniao(() => [[...document.querySelectorAll('ul.divide-y > li')].find((l) => /VJ902/.test(l.innerText))]));
  // filtro "TOTVS pendente"
  await clicar(() => [...document.querySelectorAll('ul.divide-y > li')].find((l) => /VJ902/.test(l.innerText))?.querySelector('button'));
  await clicar(() => [...document.querySelectorAll('button')].find((b) => /^TOTVS PENDENTE/i.test(b.innerText.trim())));
  await espera(800);
  await foto('trans-4-pendentes', await topo(640));
}

// ─── Brejinho: pedidos ───────────────────────────────────────────────────────
if (quer('brj')) {
  L = 1500;
  await page.setViewport({ width: L, height: A, deviceScaleFactor: 1.25 });
  await abrir('/teste-brj-tmp', 14000);
  await foto('brj-1-kanban', await topo(900));
  await clicar(() => [...document.querySelectorAll('div')].filter((d) => /Pedido\s+22623/.test(d.innerText || '') && d.innerText.length < 300).pop()?.querySelector('button:last-of-type'));
  await botao('^Detalhar$', 'Pedido\\s+22623');
  await espera(7000);
  if (await page.evaluate(() => !!document.querySelector('.fixed.inset-0'))) {
    await foto('brj-2-detalhe', await janela());
    await cancelarJanela();
  } else console.log('!! brj detalhe não abriu');
  await botao('^Lista$');
  await espera(2500);
  await encostar();
  await foto('brj-3-lista', await topo(820));
  L = 1200;
  await page.setViewport({ width: L, height: A, deviceScaleFactor: 1.5 });
}

// ─── Brejinho: faturamento ───────────────────────────────────────────────────
if (quer('fatbrj')) {
  await abrir('/teste-fatbrj-tmp', 10000);
  await foto('fatbrj-1-lista', await topo(620));
  await abrir(`/teste-fatbrj-tmp?chave=${encodeURIComponent('BRJ:6681')}`, 15000);
  await digitarSku(78390);
  await digitarSku(78388);
  await encostar();
  await foto('fatbrj-2-conferencia', await secoes(['Produtos do pedido']));
  // desconto de 10% (livre)
  const campoDesc = await page.evaluateHandle(() => [...document.querySelectorAll('section')].find((s) => /DESCONTOS DO PEDIDO/i.test(s.querySelector('h3')?.innerText || ''))?.querySelector('input[type=number]'));
  if (campoDesc.asElement()) {
    await campoDesc.asElement().click({ clickCount: 3 });
    await campoDesc.asElement().type('10');
    await espera(900);
    await foto('fatbrj-3-desconto-10', await secoes(['DESCONTOS DO PEDIDO', 'Peças do pedido', 'TOTVS \\(DOCUMENTO']));
    await campoDesc.asElement().click({ clickCount: 3 });
    await campoDesc.asElement().type('25');
    await espera(900);
    await foto('fatbrj-4-desconto-25', await secoes(['DESCONTOS DO PEDIDO']));
    const senha = await clicar(() => [...document.querySelectorAll('button')].find((b) => /senha|liberar/i.test(b.innerText)));
    await espera(900);
    if (senha && (await page.evaluate(() => !!document.querySelector('.fixed.inset-0')))) {
      await foto('fatbrj-5-senha', await janela());
      await cancelarJanela();
    } else console.log('!! sem botão de senha; pendências:', await page.evaluate(() => [...document.querySelectorAll('ul.list-disc li')].map((l) => l.innerText).join(' | ')));
    await campoDesc.asElement().click({ clickCount: 3 });
    await campoDesc.asElement().type('10');
    await espera(600);
  } else console.log('!! campo de desconto não achado');
  await foto('fatbrj-6-pagamento', await secoes(['^PAGAMENTO']));
  await foto('fatbrj-7-pagina', await uniao(() => [...document.querySelectorAll('section')]));
}

// ─── Transferências ──────────────────────────────────────────────────────────
if (quer('transf')) {
  L = 1500;
  await page.setViewport({ width: L, height: A, deviceScaleFactor: 1.25 });
  await abrir('/teste-transf-tmp', 9000);
  await foto('transf-1-solicitacoes', await topo(780));
  await botao('^abrir$', 'TR247');
  await espera(1200);
  await foto('transf-2-detalhe', await janela());
  // nesta janela "Cancelar" cancela a SOLICITAÇÃO: fecha clicando fora
  await fecharNoFundo();
  await botao('^RFID', 'TR247');
  await espera(9000);
  await encostar();
  await foto('transf-3-rfid', await topo(1100));
  await botao('^Transações');
  await espera(6000);
  await encostar();
  await foto('transf-4-transacoes', await topo(600));
}
await browser.close();
