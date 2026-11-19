// =============================================================================
// BOT ENERGISA WHATSAPP — pega a 2ª via das contas de energia da Energisa
// Paraíba pelo WhatsApp da Gisa. Tudo por mensagem de texto: não abre navegador.
//
//   node bot.mjs               pede a fatura de todas as contas da Energisa, uma por vez
//   node bot.mjs --loja=2      só as contas de uma loja
//   node bot.mjs --sala=101    só uma sala
//   --exceto=101,102           pula essas salas
//   --sem-salvar               só mostra o que veio, sem gravar nada
//
// As contas vêm da Controle de Filiais (despesas_fixas_filial): os códigos do
// cliente ficam na observação da energia, um por linha ("SALA 101: 5/1780082-2").
// Cada fatura é salva em contas_fixas_faturas (valor, vencimento, Pix, linha
// digitável e PDF) e vira uma parcela no HEADCOACH › CONTAS A PAGAR.
// Roda a partir do repositório (usa o .env e os serviços daqui).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../../config/supabase.js';
import * as wa from '../../services/whatsappContasPagar.js';
import { salvarFatura, gerarDuplicataCp } from '../../services/contasFixasFaturas.js';
import { valorDoPix } from '../../utils/contasFixasWhatsapp.js';
import { lerContasEnergisaDaObservacao } from '../../utils/contasFixasEnergisa.js';
import { lerFaturaEnergisaPdf } from '../../utils/faturaEnergisaPdf.js';
import { pegarFatura, dormir } from './energisa.mjs';

const pasta = path.dirname(fileURLToPath(import.meta.url));
const capturas = path.join(pasta, 'capturas');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] || null;
const hora = () => new Date().toLocaleTimeString('pt-BR');
const CNPJ_ENERGISA_PB = '09095183000140';

fs.mkdirSync(capturas, { recursive: true });
const arqLog = path.join(capturas, 'bot.log');
function log(msg, detalhe) {
  console.log(`${hora()} ${msg}`);
  fs.appendFileSync(arqLog, `${new Date().toISOString()} ${msg}${detalhe ? ` ${JSON.stringify(detalhe)}` : ''}\n`);
}

async function contasEnergisa() {
  const { data, error } = await supabase.from('despesas_fixas_filial').select('cd_filial,nm_fornecedor,observacao').eq('tipo_despesa', 'ENERGIA');
  if (error) throw new Error(error.message);
  const contas = [];
  for (const r of (data || []).filter((x) => /ENERGISA/i.test(x.nm_fornecedor || ''))) {
    const lidas = lerContasEnergisaDaObservacao(r.observacao);
    if (!lidas.length) log(`loja ${r.cd_filial}: não achei código do cliente na observação — pulei`);
    for (const c of lidas) contas.push({ loja: String(r.cd_filial), ...c });
  }
  return contas;
}

let saida = 0;

async function umaConta(conta, rotulo) {
  const r = await pegarFatura({ wa, conta, log: (m) => log(`   ${m}`) });
  if (r.semFatura && !r.faturas.length) {
    log(`✅ ${rotulo}: sem fatura em aberto`);
    return;
  }
  const [fatura] = r.faturas;
  if (!fatura) throw new Error('a conversa terminou sem mostrar fatura');
  let pdf = null;
  let lida = null;
  if (r.pdfs[0]) {
    const m = await wa.baixarMidia(r.pdfs[0], { base64: true });
    if (m.base64) {
      pdf = Buffer.from(m.base64.replace(/^data:[^,]+,/, ''), 'base64');
      fs.writeFileSync(path.join(capturas, `fatura-loja${conta.loja}-${(conta.rotulo || conta.codigo).replace(/\W+/g, '')}-${fatura.vencimento}.pdf`), pdf);
      lida = await lerFaturaEnergisaPdf(pdf).catch(() => null);
    }
  }
  log(`✅ ${rotulo}: ${fatura.referencia || ''} R$ ${fatura.valor.toFixed(2)} venc ${fatura.vencimento} · ${r.pix.length} Pix · ${pdf ? '1' : '0'} PDF`, { faturas: r.faturas, qtd: r.qtd });
  if (r.qtd > 1) log(`⚠️ ${rotulo}: a Energisa diz que há ${r.qtd} faturas em aberto; peguei só a que ela mostrou`);
  if (flag('sem-salvar')) return;

  // só salva quando não há dúvida de que valor, Pix e PDF são desta conta e desta fatura
  const problemas = [];
  if (r.codigoCliente !== conta.codigo) problemas.push(`a conversa é do código ${r.codigoCliente || '?'}`);
  if (r.faturas.length !== 1 || r.pix.length !== 1) problemas.push(`veio ${r.faturas.length} fatura(s) e ${r.pix.length} Pix`);
  const noPix = r.pix[0] ? valorDoPix(r.pix[0]) : null;
  if (r.pix[0] && (noPix == null || Math.abs(noPix - fatura.valor) > 0.005)) problemas.push(`o Pix é de R$ ${noPix == null ? '?' : noPix.toFixed(2)}`);
  if (r.pix[0] && !/ENERGISA/i.test(r.pix[0])) problemas.push('o Pix não tem a Energisa como recebedora');
  if (!pdf || !lida) problemas.push('não veio o PDF (ou não consegui ler)');
  else {
    if (lida.uc !== r.uc) problemas.push('o PDF é de outra UC');
    if (lida.vencimento !== fatura.vencimento || Math.abs((lida.valor ?? -1) - fatura.valor) > 0.005) problemas.push(`o boleto é de R$ ${lida.valor} com vencimento ${lida.vencimento}`);
    if (lida.cnpjBeneficiario && lida.cnpjBeneficiario !== CNPJ_ENERGISA_PB) problemas.push('o beneficiário do boleto não é a Energisa Paraíba');
  }
  if (problemas.length) {
    saida = 1;
    log(`⚠️ ${rotulo}: não salvei — ${problemas.join('; ')}. Confira os arquivos em capturas/`);
    return;
  }
  const s = await salvarFatura({
    tipoDespesa: 'ENERGIA',
    concessionaria: 'ENERGISA',
    loja: conta.loja,
    codigoCliente: conta.codigo,
    valor: fatura.valor,
    vencimento: fatura.vencimento,
    pix: r.pix[0],
    linhaDigitavel: lida.linhaDigitavel,
    pdf,
    origem: 'bot-energisa-whatsapp',
    filtroTitulos: 'nm_fornecedor.ilike.%ENERGISA%',
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
  const sala = opt('sala');
  const exceto = (opt('exceto') || '').split(',').filter(Boolean);
  const numeroDaSala = (c) => (c.rotulo || '').replace(/\D/g, '');
  const contas = (await contasEnergisa()).filter((c) => (!loja || c.loja === loja) && (!sala || numeroDaSala(c) === sala) && !exceto.includes(numeroDaSala(c)));
  if (!contas.length) throw new Error(`nenhuma conta da Energisa pronta${loja ? ` para a loja ${loja}` : ''}${sala ? ` sala ${sala}` : ''}`);
  for (const conta of contas) {
    const rotulo = `loja ${conta.loja} · ${conta.rotulo || conta.codigo}`;
    log(`▶ ${rotulo}`);
    try {
      await umaConta(conta, rotulo);
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
