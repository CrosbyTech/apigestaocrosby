// =============================================================================
// BOT COSERN WHATSAPP — pega a 2ª via das contas de energia pelo WhatsApp.
//
//   node bot.mjs --login       abre o WhatsApp Web do bot para ler o QR code
//   node bot.mjs --loja=90     pede a fatura de uma loja
//   node bot.mjs               pede a de todas as lojas da Cosern, uma por vez
//   --sem-salvar               só mostra o que veio, sem gravar nada
//   --exceto=90,55             pula essas lojas
//
// As contas vêm da Controle de Filiais (despesas_fixas_filial): o código do
// cliente e o CPF/CNPJ do titular ficam na observação de cada energia.
// Roda neste PC, a partir do repositório (usa o .env e os serviços daqui).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../../config/supabase.js';
import * as wa from '../../services/whatsappContasPagar.js';
import { salvarFatura, gerarDuplicataCp } from '../../services/contasFixasFaturas.js';
import { extrairPaginasPdf } from '../../utils/extratoStonePdf.js';
import { lerContaDaObservacao, valorDoPix } from '../../utils/contasFixasWhatsapp.js';
import { WhatsAppWeb, dormir } from './whatsappWeb.mjs';
import { pegarFatura } from './cosern.mjs';

const pasta = path.dirname(fileURLToPath(import.meta.url));
const dirs = { perfil: path.join(pasta, 'perfil-chrome'), capturas: path.join(pasta, 'capturas') };
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] || null;
const hora = () => new Date().toLocaleTimeString('pt-BR');
const MAX_FATURAS_POR_CONTA = 6;

fs.mkdirSync(dirs.capturas, { recursive: true });
const arqLog = path.join(dirs.capturas, 'bot.log');
function log(msg, detalhe) {
  console.log(`${hora()} ${msg}`);
  fs.appendFileSync(arqLog, `${new Date().toISOString()} ${msg}${detalhe ? ` ${JSON.stringify(detalhe)}` : ''}\n`);
}

async function contasCosern() {
  const { data, error } = await supabase.from('despesas_fixas_filial').select('cd_filial,nm_fornecedor,vencimento,observacao').eq('tipo_despesa', 'ENERGIA');
  if (error) throw new Error(error.message);
  const contas = [];
  for (const r of (data || []).filter((x) => /COSERN|ENERGETICA DO RIO GRANDE DO NORTE/i.test(x.nm_fornecedor || ''))) {
    const c = lerContaDaObservacao(r.observacao);
    if (!c.codigos.length || !c.documento) {
      log(`loja ${r.cd_filial}: falta ${!c.codigos.length ? 'o código do cliente' : 'o CPF/CNPJ do titular'} na observação — pulei`);
      continue;
    }
    for (const [i, codigo] of c.codigos.entries()) contas.push({ loja: String(r.cd_filial), codigo, uc: c.ucs.length === c.codigos.length ? c.ucs[i] : null, documento: c.documento, tipoDocumento: c.tipoDocumento, diaVencimento: r.vencimento });
  }
  return contas;
}

/** O PDF tem que ser da conta pedida: procura o código do cliente no texto dele. */
async function pdfEhDaConta(buffer, codigo) {
  try {
    return JSON.stringify(await extrairPaginasPdf(buffer)).replace(/[.\-\s]/g, '').includes(codigo);
  } catch {
    return false;
  }
}

let saida = 0;

/** Uma conversa = uma fatura. Devolve quantas ainda faltam nesta conta. */
async function umaFatura(web, conta, rotulo, jaPegas, continuacao) {
  const r = await pegarFatura({ web, wa, conta, log, jaPegas, continuacao });
  if (r.semFatura) {
    log(`✅ ${rotulo}: sem fatura em aberto`);
    return 0;
  }
  if (!r.faturas.length) return 0; // todas as da lista já foram pegas
  const [fatura] = r.faturas;
  jaPegas.add(`${fatura.valor}|${fatura.vencimento}`);
  let pdf = null;
  if (r.pdfs[0]) {
    const m = await wa.baixarMidia(r.pdfs[0], { base64: true });
    if (m.base64) {
      pdf = Buffer.from(m.base64.replace(/^data:[^,]+,/, ''), 'base64');
      fs.writeFileSync(path.join(dirs.capturas, `fatura-loja${conta.loja}-${conta.codigo.slice(-4)}-${fatura.vencimento}.pdf`), pdf);
    }
  }
  log(`✅ ${rotulo}: R$ ${fatura.valor.toFixed(2)} venc ${fatura.vencimento} · ${r.pix.length} Pix · ${pdf ? '1' : '0'} PDF`, { faturas: r.faturas, restantes: r.restantes });
  if (flag('sem-salvar')) return r.restantes;

  // só salva quando não há dúvida de que Pix e PDF são desta fatura e desta conta
  const problemas = [];
  if (r.faturas.length !== 1 || r.pix.length !== 1 || !fatura.vencimento) problemas.push(`veio ${r.faturas.length} fatura(s) e ${r.pix.length} Pix`);
  const noPix = r.pix[0] ? valorDoPix(r.pix[0]) : null;
  if (noPix != null && Math.abs(noPix - fatura.valor) > 0.005) problemas.push(`o Pix é de R$ ${noPix.toFixed(2)}`);
  if (pdf && !(await pdfEhDaConta(pdf, conta.codigo))) problemas.push('o PDF não traz o código do cliente desta conta');
  if (problemas.length) {
    saida = 1;
    log(`⚠️ ${rotulo}: não salvei — ${problemas.join('; ')}. Confira os arquivos em capturas/`);
    return r.restantes;
  }
  const s = await salvarFatura({
    tipoDespesa: 'ENERGIA',
    concessionaria: 'COSERN',
    loja: conta.loja,
    codigoCliente: conta.codigo,
    valor: fatura.valor,
    vencimento: fatura.vencimento,
    pix: r.pix[0],
    pdf,
    origem: 'bot-cosern-whatsapp',
    filtroTitulos: 'nm_fornecedor.ilike.%COSERN%,nm_fornecedor.ilike.%ENERGETICA DO RIO GRANDE%',
  });
  log(`💾 ${rotulo}: fatura ${s.nova ? 'salva' : 'atualizada'} (#${s.id})${s.vinculou ? ' e Pix preenchido no título da Liberação' : s.liberacaoId ? ' (já ligada a um título)' : ' — sem título único na Liberação para ligar'}`);
  // toda fatura capturada vira duplicata no HEADCOACH › CONTAS A PAGAR (a fatura de cada mês é uma parcela da duplicata da instalação: 1/11, 1/12)
  try {
    const d = await gerarDuplicataCp(s.id);
    log(d.criada ? `🧾 ${rotulo}: duplicata ${d.titulo.duplicata}/${d.titulo.parcela} (doc. fiscal ${d.titulo.documento_fiscal}) incluída no Contas a Pagar do HeadCoach` : `🧾 ${rotulo}: duplicata não incluída — ${d.motivo}`);
  } catch (e) {
    saida = 1;
    log(`⚠️ ${rotulo}: fatura salva, mas a duplicata do Contas a Pagar falhou — ${e.message}`);
  }
  return r.restantes;
}

const intervalo = () => dormir(30000 + Math.random() * 20000); // ritmo de gente entre uma conversa e outra
const web = new WhatsAppWeb({ ...dirs, log });
try {
  await web.abrir();
  if (!(await web.esperarLogin({ timeoutMin: flag('login') ? 15 : 10 }))) throw new Error('WhatsApp Web sem login: rode login.bat e leia o QR code.');
  log('WhatsApp Web conectado');
  await dormir(4000);
  if (!flag('login')) {
    if (!wa.isConfigurado()) throw new Error('instância CONTAS A PAGAR não configurada no .env');
    const loja = opt('loja');
    const exceto = (opt('exceto') || '').split(',').filter(Boolean);
    const contas = (await contasCosern()).filter((c) => (!loja || c.loja === loja) && !exceto.includes(c.loja));
    if (!contas.length) throw new Error(`nenhuma conta da Cosern pronta${loja ? ` para a loja ${loja}` : ''}`);
    for (const conta of contas) {
      const rotulo = `loja ${conta.loja} · código final ${conta.codigo.slice(-4)}`;
      const jaPegas = new Set();
      log(`▶ ${rotulo}`);
      let continuacao = false; // true = responder "Sim" à pergunta de outra fatura, na mesma conversa
      for (let n = 1; n <= MAX_FATURAS_POR_CONTA; n += 1) {
        let restantes = 0;
        try {
          restantes = await umaFatura(web, conta, rotulo, jaPegas, continuacao);
          continuacao = restantes > 0;
          if (continuacao) await dormir(12000); // a pergunta "outra fatura?" chega alguns segundos depois do Pix
        } catch (e) {
          await web.foto(`erro-loja${conta.loja}`);
          await web.fecharDialogo().catch(() => {});
          log(`❌ ${rotulo}: ${e.message}`);
          if (continuacao) {
            // a conversa caiu no meio: tenta a fatura que falta numa conversa nova
            continuacao = false;
            restantes = 1;
            await intervalo();
          } else saida = 1;
        }
        if (!restantes) break;
        log(`${rotulo}: ainda há fatura em aberto; vou pegar a próxima`);
      }
      if (conta !== contas.at(-1)) await intervalo();
    }
  }
} catch (e) {
  saida = 1;
  log(`❌ ${e.message}`);
} finally {
  await web.fechar();
}
process.exit(saida);
