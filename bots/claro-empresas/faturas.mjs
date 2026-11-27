// =============================================================================
// Minha Claro Empresas — faturas dos contratos FIXOS (internet) de um CNPJ.
//
// Usa o Chrome do robô já logado pelo usuário (abrir.mjs). Para cada contrato da
// aba "Fixa": lê a lista de faturas e, de cada fatura que NÃO está paga, pede o
// Pix copia e cola pelo botão "Pagar com pix" (só mostra o código; não paga nada).
// Não toca em cartão de crédito, débito automático, promessa de pagamento nem
// troca de vencimento. Grava o resultado em faturas/claro-<cnpj>.json.
//
// Uso: node bots/claro-empresas/faturas.mjs --cnpj=17177680000116 [--sem-pix]
//        [--contrato=4204914] [--venc=2026-11-10]   (com filtro, junta ao que já estava guardado)
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { PASTA } from './abrir.mjs';
import { ligar, clicar, dormir, textoDaTela, semSessao } from './comum.mjs';

const arg = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split('=')[1] || null;
const cnpj = String(arg('cnpj') || '').replace(/\D/g, '');
const semPix = process.argv.includes('--sem-pix');
const soContrato = String(arg('contrato') || '').replace(/\D/g, ''); // só este contrato (número, sem o código da cidade)
const soVencimento = arg('venc'); // só a fatura deste vencimento (AAAA-MM-DD)
if (cnpj.length !== 14) {
  console.log('Informe --cnpj=<14 dígitos>');
  process.exit(1);
}
const cnpjFormatado = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const rotuloDoMes = (data) => `${MESES[Number(String(data).slice(5, 7)) - 1]} de ${String(data).slice(0, 4)}`;
const log = (m) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${m}`);

const { browser, page } = await ligar();
if (await semSessao(page)) {
  console.log('A sessão da Claro caiu: faça o login de novo na janela do Chrome do robô.');
  process.exit(2);
}

// ── o que o portal responde fica guardado aqui (a última resposta de cada consulta) ──
const visto = { contratos: null, dados: null, listas: new Map(), pix: new Map() };
page.on('response', async (res) => {
  try {
    if (!/mcm-backend-v1\/v1\/graphql/.test(res.url()) || res.request().method() !== 'POST') return;
    const corpo = JSON.parse(res.request().postData() || '{}');
    const op = `${corpo.operationName || ''} ${String(corpo.query || '').slice(0, 160)}`;
    if (!/contractsResidential|ConsultaDadosResidencial|InvoiceList|GeneratePixCode/.test(op)) return;
    const json = await res.json().catch(() => null);
    const v = corpo.variables || {};
    const em = Date.now();
    if (/contractsResidential/.test(op) && json?.data?.invoice?.contractsResidential) visto.contratos = json.data.invoice.contractsResidential.contracts || [];
    else if (/ConsultaDadosResidencial/.test(op) && json?.data?.ConsultaDadosResidencial) visto.dados = json.data.ConsultaDadosResidencial;
    else if (/InvoiceList/.test(op)) visto.listas.set(String(v.customerAccountId), { em, status: res.status(), periodo: v.dateRange || null, faturas: json?.data?.invoice?.list?.invoices || null, erro: json?.errors?.[0] || null });
    else if (/GeneratePixCode/.test(op)) visto.pix.set(String(v.invoiceId).replace(/^0+/, ''), { em, status: res.status(), pix: json?.data?.invoice?.generatePixCode?.invoice || null, erro: json?.errors?.[0] || null });
  } catch {
    /* resposta que não interessa */
  }
});
const ate = async (cond, ms = 30000, passo = 400) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const v = await cond();
    if (v) return v;
    await dormir(passo);
  }
  return null;
};

// ── empresa ──
async function selecionarEmpresa() {
  const t = await textoDaTela(page);
  if (t.slice(0, 300).includes(`CNPJ - ${cnpjFormatado}`)) return;
  await page.evaluate(() => { location.hash = '#/SelecaoEmpresa'; });
  await ate(async () => (await textoDaTela(page)).includes('Selecione um CNPJ'), 20000);
  await dormir(1000);
  if (!(await clicar(page, cnpjFormatado, { contem: false }))) throw new Error(`O CNPJ ${cnpjFormatado} não aparece na seleção de empresa`);
  await dormir(700);
  await clicar(page, 'Continuar', { contem: false });
  const ok = await ate(async () => /HomeLogada/.test(page.url()) && (await textoDaTela(page)).slice(0, 300).includes(`CNPJ - ${cnpjFormatado}`), 60000, 1000);
  if (!ok) throw new Error(`Não consegui entrar no CNPJ ${cnpjFormatado}`);
  visto.contratos = null;
  visto.dados = null;
  visto.listas.clear();
  await dormir(5000);
}

// ── lista de faturas, aba Fixa: só volta com o seletor de contrato na tela ──
const temSeletor = () => page.evaluate(() => Boolean(document.querySelector('.mce-account-selector__trigger')) && /Contrato/i.test(document.querySelector('.mce-account-selector__label')?.innerText || ''));
const contratoAtual = () => page.evaluate(() => (document.querySelector('.mce-account-selector__value')?.innerText || '').replace(/\s+/g, ' ').trim());

async function abrirFixa() {
  for (let t = 1; t <= 4; t += 1) {
    await page.evaluate(() => { location.hash = '#/HomeLogada'; });
    await dormir(1200);
    await page.evaluate(() => { location.hash = '#/ListaFaturas'; });
    const carregou = await ate(async () => /Histórico de faturas|Nenhuma fatura|não possui/i.test(await textoDaTela(page)), 30000);
    await dormir(1500);
    if (await temSeletor()) return true;
    const texto = await textoDaTela(page);
    if (carregou && !/\bFixa\b/.test(texto)) return false; // CNPJ sem contrato fixo
    await clicar(page, 'Fixa', { contem: false });
    if (await ate(temSeletor, 20000)) {
      await dormir(1500);
      return true;
    }
    log(`   (a aba Fixa não abriu na tentativa ${t}; tentando de novo)`);
    await dormir(3000);
  }
  throw new Error('a aba Fixa não abriu (o portal pode estar lento)');
}

/** Põe o contrato no seletor e devolve a lista de faturas dele (a resposta mais nova do portal). */
async function escolherContrato(c) {
  const rotulo = `${c.operatorCode}/${c.contractNumber}`;
  const chave = [...visto.listas.keys()].find((k) => k.endsWith(c.contractNumber));
  const antes = chave ? visto.listas.get(chave).em : 0;
  const inicio = Date.now();
  if (!(await ate(temSeletor, 15000))) {
    await abrirFixa();
    if (!(await ate(temSeletor, 15000))) throw new Error('o seletor de contrato não apareceu');
  }
  await dormir(600);
  if (!(await contratoAtual()).startsWith(rotulo)) {
    await page.click('.mce-account-selector__trigger');
    await dormir(1200);
    const ok = await page.evaluate((r) => {
      const li = [...document.querySelectorAll('li')].find((e) => e.getBoundingClientRect().width > 0 && (e.innerText || '').replace(/\s+/g, ' ').trim().startsWith(r));
      if (!li) return false;
      li.scrollIntoView({ block: 'center' });
      (li.querySelector('button, a, label, input') || li).click();
      return true;
    }, rotulo);
    if (!ok) throw new Error(`O contrato ${rotulo} não aparece no seletor`);
    await dormir(800);
    for (const botao of ['Confirmar', 'Selecionar', 'Aplicar']) {
      if ((await contratoAtual()).startsWith(rotulo)) break;
      await clicar(page, botao, { contem: false });
      await dormir(600);
    }
    if (!(await ate(async () => (await contratoAtual()).startsWith(rotulo), 10000))) throw new Error(`O seletor não mudou para ${rotulo} (ficou em "${await contratoAtual()}")`);
  }
  // a lista deste contrato: uma resposta que chegou agora, ou a que já estava guardada (se o contrato já estava na tela)
  const lista = await ate(async () => {
    const k = [...visto.listas.keys()].find((x) => x.endsWith(c.contractNumber));
    const l = k ? visto.listas.get(k) : null;
    return l && (l.em > antes || Date.now() - inicio > 6000) ? l : null;
  }, 30000);
  await dormir(1200);
  if (!lista) throw new Error('a lista de faturas não veio');
  if (lista.status !== 200 || !lista.faturas) throw new Error(`a lista de faturas veio com erro (${lista.status})`);
  return lista;
}

async function pixDaFatura(c, f) {
  const rotulo = rotuloDoMes(f.vencimento);
  const inicio = Date.now();
  if (!(await clicar(page, rotulo, { contem: false }))) return { erro: `não achei a linha "${rotulo}" na tela` };
  if (!(await ate(async () => /DetalhesFaturas/.test(page.url()), 15000))) return { erro: 'a tela de detalhes não abriu' };
  await ate(async () => (await textoDaTela(page)).includes('Opções de pagamento'), 20000);
  await dormir(1500);
  const tela = await textoDaTela(page);
  if (!tela.includes(`${c.operatorCode}/${c.contractNumber}`)) return { erro: 'a tela de detalhes abriu em outro contrato' };
  if (!(await clicar(page, 'Pagar com pix', { contem: false }))) return { erro: 'sem o botão "Pagar com pix"' };
  const r = await ate(async () => {
    const x = visto.pix.get(String(f.id).replace(/^0+/, ''));
    return x && x.em >= inicio ? x : null;
  }, 30000);
  await dormir(800);
  if (!r) return { erro: 'o portal não respondeu ao pedido do Pix' };
  if (!r.pix?.payload) return { erro: `o portal não devolveu o Pix (${r.status}: ${JSON.stringify(r.erro?.message || r.erro?.error?.detailedMessage || '').slice(0, 160)})` };
  return { pix: r.pix.payload, vencimentoDoPix: r.pix.dueDate || null };
}

// ── roteiro ──
await selecionarEmpresa();
log(`CNPJ ${cnpjFormatado}`);
const resultado = { cnpj, em: new Date().toISOString(), contratos: [] };
const temFixa = await abrirFixa();
if (!temFixa) log('este CNPJ não tem a aba Fixa (sem contrato de internet).');
else {
  const contratos = await ate(async () => visto.contratos, 30000);
  if (!contratos) throw new Error('o portal não devolveu a lista de contratos');
  await ate(async () => visto.dados, 15000);
  const enderecos = visto.dados?.address || [];
  const produtos = visto.dados?.products || [];
  log(`${contratos.length} contrato(s) fixo(s)`);
  for (const c of contratos) {
    if (soContrato && c.contractNumber !== soContrato) continue;
    const end = enderecos.find((a) => String(a.customerAccountId).endsWith(c.contractNumber)) || null;
    const item = { contrato: `${c.operatorCode}/${c.contractNumber}`, conta: `${c.operatorCode}${c.contractNumber}`, situacao: c.statusDescription, adimplencia: c.statusDefaulter, diaVencimento: c.dueDate, endereco: end ? `${end.streetName}, ${end.streetNrFirst}${end.complements ? `, ${String(end.complements).trim()}` : ''}${end.neighborhood ? `, ${end.neighborhood}` : ''}, ${end.cityName}, ${end.stateAbbreviation}` : null, produtos: produtos.filter((p) => String(p.customerAccountId).endsWith(c.contractNumber) && p.productType !== 'CANAL A LA CARTE').map((p) => p.productName), faturas: [] };
    resultado.contratos.push(item);
    try {
      const lista = await escolherContrato(c);
      item.periodoConsultado = lista.periodo;
      for (const f of lista.faturas) item.faturas.push({ id: f.invoiceId, vencimento: f.dueDate, valor: Number(f.invoiceAmount), situacao: f.statusInvoiceDescription, paga: String(f.statusInvoiceId) === '2', aberta: String(f.statusInvoiceId) !== '2' && !/pag[oa]|cancelad|quitad/i.test(f.statusInvoiceDescription || ''), forma: f.paymentForm });
      const abertas = item.faturas.filter((f) => f.aberta && f.valor > 0 && (!soVencimento || f.vencimento === soVencimento));
      log(`${item.contrato} · ${item.endereco || 'sem endereço'} · ${item.faturas.length} fatura(s), ${abertas.length} em aberto${abertas.length ? ` (${abertas.map((f) => `${f.vencimento} R$ ${f.valor.toFixed(2)} ${f.situacao}`).join(' · ')})` : ''}`);
      if (semPix) continue;
      for (const f of abertas) {
        let r = await pixDaFatura(c, f);
        if (!r.pix) {
          // uma segunda tentativa, do começo
          await abrirFixa();
          await escolherContrato(c);
          r = await pixDaFatura(c, f);
        }
        Object.assign(f, r);
        log(`   ${f.vencimento} R$ ${f.valor.toFixed(2)} → ${r.pix ? `Pix ok (${r.pix.length} caracteres)` : `SEM PIX: ${r.erro}`}`);
        await abrirFixa();
        await escolherContrato(c);
      }
    } catch (e) {
      item.erro = e.message;
      log(`${item.contrato}: ERRO ${e.message}`);
      await abrirFixa().catch(() => null);
    }
  }
}
const dir = path.join(PASTA, 'faturas');
fs.mkdirSync(dir, { recursive: true });
const arq = path.join(dir, `claro-${cnpj}.json`);
if ((soContrato || soVencimento) && fs.existsSync(arq)) {
  // com filtro: junta ao que já estava guardado
  const antes = JSON.parse(fs.readFileSync(arq, 'utf8'));
  for (const novo of resultado.contratos) {
    const velho = antes.contratos.find((x) => x.contrato === novo.contrato);
    if (!velho) antes.contratos.push(novo);
    else {
      for (const fn of novo.faturas) {
        const fv = velho.faturas.find((x) => x.id === fn.id);
        if (!fv) velho.faturas.push(fn);
        else if (fn.pix) Object.assign(fv, fn, { erro: undefined });
        else Object.assign(fv, { ...fn, pix: fv.pix, vencimentoDoPix: fv.vencimentoDoPix, erro: fv.pix ? undefined : fn.erro });
      }
      if (!novo.erro) delete velho.erro;
    }
  }
  antes.em = resultado.em;
  fs.writeFileSync(arq, JSON.stringify(antes, null, 1));
} else fs.writeFileSync(arq, JSON.stringify(resultado, null, 1));
log(`guardado em ${arq}`);
browser.disconnect();
process.exit(0);
