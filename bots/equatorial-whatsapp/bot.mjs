// =============================================================================
// BOT EQUATORIAL WHATSAPP — pega a 2ª via das contas de energia da Equatorial
// Maranhão pelo WhatsApp da Clara. Tudo por mensagem de texto: não abre navegador.
//
//   node bot.mjs                 pede a última conta em aberto (a do mês) de cada loja da Equatorial
//   node bot.mjs --loja=93       só uma loja
//   node bot.mjs --ref=11/2026   a conta dessa competência
//   node bot.mjs --todas         todas as contas em aberto, inclusive as antigas
//   --sem-salvar                 só mostra o que veio, sem gravar nada
//
// As contas vêm da Controle de Filiais (despesas_fixas_filial): a conta contrato
// e o CPF/CNPJ do titular ficam na observação da energia. Cada fatura é salva em
// contas_fixas_faturas (valor, vencimento, Pix, linha digitável e PDF) e vira uma
// parcela no HEADCOACH › CONTAS A PAGAR.
// Roda a partir do repositório (usa o .env e os serviços daqui).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../../config/supabase.js';
import * as wa from '../../services/whatsappContasPagar.js';
import { salvarFatura, gerarDuplicataCp } from '../../services/contasFixasFaturas.js';
import { valorDoPix } from '../../utils/contasFixasWhatsapp.js';
import { lerContaEquatorialDaObservacao, mesmaConta } from '../../utils/contasFixasEquatorial.js';
import { lerFaturaEquatorialPdf } from '../../utils/faturaEquatorialPdf.js';
import { dormir } from '../comum/conversa.mjs';
import { pegarFaturas } from './equatorial.mjs';

const pasta = path.dirname(fileURLToPath(import.meta.url));
const capturas = path.join(pasta, 'capturas');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] || null;
const hora = () => new Date().toLocaleTimeString('pt-BR');
const CNPJ_EQUATORIAL_MA = '06272793000184';

fs.mkdirSync(capturas, { recursive: true });
const arqLog = path.join(capturas, 'bot.log');
function log(msg, detalhe) {
  console.log(`${hora()} ${msg}`);
  fs.appendFileSync(arqLog, `${new Date().toISOString()} ${msg}${detalhe ? ` ${JSON.stringify(detalhe)}` : ''}\n`);
}

async function contasEquatorial() {
  const { data, error } = await supabase.from('despesas_fixas_filial').select('cd_filial,nm_fornecedor,observacao').eq('tipo_despesa', 'ENERGIA');
  if (error) throw new Error(error.message);
  const contas = [];
  for (const r of (data || []).filter((x) => /EQUATORIAL/i.test(x.nm_fornecedor || ''))) {
    const c = lerContaEquatorialDaObservacao(r.observacao);
    if (!c.contaContrato || !c.documento) {
      log(`loja ${r.cd_filial}: falta ${!c.contaContrato ? 'a conta contrato' : 'o CPF/CNPJ do titular'} na observação — pulei`);
      continue;
    }
    contas.push({ loja: String(r.cd_filial), ...c });
  }
  return contas;
}

let saida = 0;

async function umaFatura(conta, item, imovel, rotulo) {
  let pdf = null;
  let lida = null;
  if (item.pdfId) {
    const m = await wa.baixarMidia(item.pdfId, { base64: true });
    if (m.base64) {
      pdf = Buffer.from(m.base64.replace(/^data:[^,]+,/, ''), 'base64');
      fs.writeFileSync(path.join(capturas, `fatura-loja${conta.loja}-${item.referencia.replace('/', '-')}.pdf`), pdf);
      lida = await lerFaturaEquatorialPdf(pdf).catch(() => null);
    }
  }
  log(`✅ ${rotulo}: R$ ${item.valor.toFixed(2)} venc ${item.vencimento} · ${item.pix ? '1' : '0'} Pix · ${pdf ? '1' : '0'} PDF`);
  if (flag('sem-salvar')) return;

  // só salva quando não há dúvida de que valor, Pix e PDF são desta conta e desta fatura
  const problemas = [];
  const noPix = item.pix ? valorDoPix(item.pix) : null;
  if (!item.pix) problemas.push('não veio o Pix');
  else {
    if (noPix == null || Math.abs(noPix - item.valor) > 0.005) problemas.push(`o Pix é de R$ ${noPix == null ? '?' : noPix.toFixed(2)}`);
    if (!/EQUATORIAL/i.test(item.pix)) problemas.push('o Pix não tem a Equatorial como recebedora');
  }
  if (!pdf || !lida) problemas.push('não veio o PDF (ou não consegui ler)');
  else {
    if (!mesmaConta(lida.contaContrato, conta.contaContrato)) problemas.push(`o PDF é da conta contrato ${lida.contaContrato || '?'}`);
    if (imovel?.uc && lida.uc && !mesmaConta(lida.uc, imovel.uc)) problemas.push('o PDF é de outra unidade consumidora');
    if (lida.vencimento !== item.vencimento || Math.abs((lida.valor ?? -1) - item.valor) > 0.005) problemas.push(`o boleto do PDF é de R$ ${lida.valor} com vencimento ${lida.vencimento}`);
    if (lida.referencia && lida.referencia !== item.referencia) problemas.push(`o PDF é da competência ${lida.referencia}`);
    if (lida.cnpjEmitente && lida.cnpjEmitente !== CNPJ_EQUATORIAL_MA) problemas.push('a nota não é da Equatorial Maranhão');
  }
  if (problemas.length) {
    saida = 1;
    log(`⚠️ ${rotulo}: não salvei — ${problemas.join('; ')}. Confira os arquivos em capturas/`);
    return;
  }
  const s = await salvarFatura({
    tipoDespesa: 'ENERGIA',
    concessionaria: 'EQUATORIAL',
    loja: conta.loja,
    codigoCliente: conta.contaContrato,
    valor: item.valor,
    vencimento: item.vencimento,
    pix: item.pix,
    linhaDigitavel: lida.linhaDigitavel,
    pdf,
    origem: 'bot-equatorial-whatsapp',
    filtroTitulos: 'nm_fornecedor.ilike.%EQUATORIAL%',
  });
  log(`💾 ${rotulo}: fatura ${s.nova ? 'salva' : 'atualizada'} (#${s.id})${s.vinculou ? ' e Pix preenchido no título da Liberação' : s.liberacaoId ? ' (já ligada a um título)' : ' — sem título único na Liberação para ligar'}`);
  try {
    const d = await gerarDuplicataCp(s.id);
    log(d.criada ? `🧾 ${rotulo}: duplicata ${d.titulo.duplicata}/${d.titulo.parcela} (doc. fiscal ${d.titulo.documento_fiscal}) incluída no Contas a Pagar do HeadCoach` : `🧾 ${rotulo}: duplicata não incluída — ${d.motivo}`);
  } catch (e) {
    saida = 1;
    log(`⚠️ ${rotulo}: fatura salva, mas a duplicata do Contas a Pagar falhou — ${e.message}`);
  }
}

try {
  if (!wa.isConfigurado()) throw new Error('instância CONTAS A PAGAR não configurada no .env');
  const loja = opt('loja');
  const referencia = opt('ref');
  const contas = (await contasEquatorial()).filter((c) => !loja || c.loja === loja);
  if (!contas.length) throw new Error(`nenhuma conta da Equatorial pronta${loja ? ` para a loja ${loja}` : ''}`);
  for (const conta of contas) {
    const rotulo = `loja ${conta.loja}`;
    log(`▶ ${rotulo}${referencia ? ` · ${referencia}` : ''}`);
    try {
      const r = await pegarFaturas({ wa, conta, referencia, todas: flag('todas'), log: (m) => log(`   ${m}`) });
      if (r.abertas.length) log(`${rotulo}: ${r.abertas.length} conta(s) em aberto — ${r.abertas.map((a) => `${a.referencia} R$ ${a.valor.toFixed(2)} venc ${a.vencimento}`).join(' · ')}`);
      if (!r.itens.length) log(`✅ ${rotulo}: ${r.semFatura || !r.abertas.length ? 'sem fatura em aberto' : `a conta de ${referencia} não está em aberto`}`);
      const fora = r.abertas.filter((a) => !r.itens.some((i) => i.referencia === a.referencia && i.vencimento === a.vencimento));
      if (fora.length) log(`${rotulo}: não peguei ${fora.map((a) => a.referencia).join(', ')} (conta antiga em aberto na Equatorial; use --ref ou --todas se quiser)`);
      for (const item of r.itens) await umaFatura(conta, item, r.imovel, `${rotulo} · ${item.referencia}`);
    } catch (e) {
      saida = 1;
      log(`❌ ${rotulo}: ${e.message}`);
    }
    if (conta !== contas.at(-1)) await dormir(20000 + Math.random() * 15000); // ritmo de gente entre uma conversa e outra
  }
} catch (e) {
  saida = 1;
  log(`❌ ${e.message}`);
}
process.exit(saida);
