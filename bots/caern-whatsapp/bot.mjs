// =============================================================================
// BOT CAERN WHATSAPP — pega a 2ª via das contas de água da CAERN (RN) pelo
// WhatsApp da Caren. Tudo por mensagem de texto: não abre navegador.
//
//   node bot.mjs               pede a última fatura em aberto (a do mês) de cada loja da CAERN
//   node bot.mjs --loja=1      só uma loja
//   node bot.mjs --todas       todas as faturas em aberto, inclusive as antigas
//   --sem-salvar               só mostra o que veio, sem gravar nada
//
// As contas vêm da Controle de Filiais (despesas_fixas_filial): a matrícula e o
// CPF/CNPJ do titular ficam na observação da água. Cada fatura é salva em
// contas_fixas_faturas (valor, vencimento, Pix, código de barras e PDF) e vira
// uma parcela no HEADCOACH › CONTAS A PAGAR.
// Roda a partir do repositório (usa o .env e os serviços daqui).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../../config/supabase.js';
import * as wa from '../../services/whatsappContasPagar.js';
import { salvarFatura, gerarDuplicataCp } from '../../services/contasFixasFaturas.js';
import { valorDoPix } from '../../utils/contasFixasWhatsapp.js';
import { lerContaDeAguaDaObservacao } from '../../utils/contasFixasCaern.js';
import { mesmaConta } from '../../utils/contasFixasEquatorial.js';
import { lerFaturaCaernPdf } from '../../utils/faturaCaernPdf.js';
import { dormir } from '../comum/conversa.mjs';
import { pegarFaturas } from './caern.mjs';

const pasta = path.dirname(fileURLToPath(import.meta.url));
const capturas = path.join(pasta, 'capturas');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] || null;
const hora = () => new Date().toLocaleTimeString('pt-BR');
const CNPJ_CAERN = '08334385000135';

fs.mkdirSync(capturas, { recursive: true });
const arqLog = path.join(capturas, 'bot.log');
function log(msg, detalhe) {
  console.log(`${hora()} ${msg}`);
  fs.appendFileSync(arqLog, `${new Date().toISOString()} ${msg}${detalhe ? ` ${JSON.stringify(detalhe)}` : ''}\n`);
}

async function contasCaern() {
  const { data, error } = await supabase.from('despesas_fixas_filial').select('cd_filial,nm_fornecedor,observacao').eq('tipo_despesa', 'AGUA');
  if (error) throw new Error(error.message);
  const contas = [];
  for (const r of (data || []).filter((x) => /CAERN|ESGOTOS DO RIO GRANDE DO NORTE/i.test(x.nm_fornecedor || ''))) {
    const c = lerContaDeAguaDaObservacao(r.observacao);
    if (!c.matricula || !c.documento) {
      log(`loja ${r.cd_filial}: falta ${!c.matricula ? 'a matrícula' : 'o CPF/CNPJ do titular'} na observação — pulei`);
      continue;
    }
    contas.push({ loja: String(r.cd_filial), ...c });
  }
  return contas;
}

let saida = 0;

async function umaFatura(conta, item, rotulo) {
  let pdf = null;
  let lida = null;
  if (item.pdfId) {
    const m = await wa.baixarMidia(item.pdfId, { base64: true });
    if (m.base64) {
      pdf = Buffer.from(m.base64.replace(/^data:[^,]+,/, ''), 'base64');
      fs.writeFileSync(path.join(capturas, `fatura-loja${conta.loja}-${item.vencimento}.pdf`), pdf);
      lida = await lerFaturaCaernPdf(pdf).catch(() => null);
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
    if (!/CAERN/i.test(item.pix)) problemas.push('o Pix não tem a CAERN como recebedora');
  }
  if (!pdf || !lida) problemas.push('não veio o PDF (ou não consegui ler)');
  else {
    if (!mesmaConta(lida.matricula, conta.matricula)) problemas.push(`o PDF é da matrícula ${lida.matricula || '?'}`);
    if (lida.vencimento !== item.vencimento || Math.abs((lida.valor ?? -1) - item.valor) > 0.005) problemas.push(`a conta do PDF é de R$ ${lida.valor} com vencimento ${lida.vencimento}`);
    if (lida.cnpjEmitente && lida.cnpjEmitente !== CNPJ_CAERN) problemas.push('a nota não é da CAERN');
  }
  if (problemas.length) {
    saida = 1;
    log(`⚠️ ${rotulo}: não salvei — ${problemas.join('; ')}. Confira os arquivos em capturas/`);
    return;
  }
  const s = await salvarFatura({
    tipoDespesa: 'AGUA',
    concessionaria: 'CAERN',
    loja: conta.loja,
    codigoCliente: conta.matricula,
    valor: item.valor,
    vencimento: item.vencimento,
    pix: item.pix,
    linhaDigitavel: lida.linhaDigitavel,
    pdf,
    origem: 'bot-caern-whatsapp',
    filtroTitulos: 'nm_fornecedor.ilike.%ESGOTOS DO RIO GRANDE DO NORTE%,nm_fornecedor.ilike.%CAERN%',
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
  const contas = (await contasCaern()).filter((c) => !loja || c.loja === loja);
  if (!contas.length) throw new Error(`nenhuma conta da CAERN pronta${loja ? ` para a loja ${loja}` : ''}`);
  for (const conta of contas) {
    const rotulo = `loja ${conta.loja}`;
    log(`▶ ${rotulo}`);
    try {
      const r = await pegarFaturas({ wa, conta, todas: flag('todas'), log: (m) => log(`   ${m}`) });
      if (r.abertas.length) log(`${rotulo}: ${r.abertas.length} fatura(s) em aberto — ${r.abertas.map((a) => `R$ ${a.valor.toFixed(2)} venc ${a.vencimento}`).join(' · ')}`);
      if (!r.itens.length) log(`✅ ${rotulo}: sem fatura em aberto`);
      const fora = r.abertas.filter((a) => !r.itens.some((i) => i.titulo === a.titulo));
      if (fora.length) log(`${rotulo}: não peguei ${fora.map((a) => `a de ${a.vencimento}`).join(', ')} (fatura antiga em aberto na CAERN; use --todas se quiser)`);
      for (const item of r.itens) await umaFatura(conta, item, `${rotulo} · venc ${item.vencimento}`);
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
