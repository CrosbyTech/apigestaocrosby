// Exploração: na Lista de faturas (aba Fixa), mostra como é o seletor de contrato (HTML resumido) e,
// se pedido, abre a lista de opções. Uso: node bots/claro-empresas/olhar-contrato.mjs [abrir]
import { ligar, clicar, dormir, esperarOperacao } from './comum.mjs';

const { browser, page } = await ligar();
if (!/ListaFaturas/.test(page.url())) {
  await page.evaluate(() => { location.hash = '#/ListaFaturas'; });
  await dormir(6000);
}
const jaFixa = await page.evaluate(() => /Contrato\s+\d{3}\//.test(document.body.innerText));
if (!jaFixa) {
  const espera = esperarOperacao(page, /InvoiceList/);
  await clicar(page, 'Fixa', { contem: false });
  await espera;
  await dormir(1500);
}
const html = await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^Contrato$/i.test((e.innerText || '').trim()));
  let caixa = el;
  for (let i = 0; i < 4 && caixa?.parentElement; i += 1) caixa = caixa.parentElement;
  return caixa ? caixa.outerHTML.replace(/\s+/g, ' ').replace(/ class="[^"]{60,}"/g, ' class="…"').slice(0, 2500) : null;
});
console.log('seletor:', html);
if (process.argv[2] === 'abrir') {
  const ok = await clicar(page, '907/16396473') || (await clicar(page, 'Contrato'));
  await dormir(1500);
  const opcoes = await page.evaluate(() => [...document.querySelectorAll('[role=option], [role=listbox] li, ul li, .mdn-Select-option, option')].filter((e) => /\d{3}\/\d{5,}/.test(e.innerText || e.textContent || '')).map((e) => `${e.tagName}[${e.getAttribute('role') || ''}] ${(e.innerText || e.textContent).replace(/\s+/g, ' ').trim().slice(0, 90)}`));
  console.log('abriu:', ok, '\nopções:', [...new Set(opcoes)].join('\n  '));
}
browser.disconnect();
process.exit(0);
