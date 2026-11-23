// ============================================================
// FATURAS QUE CHEGAM POR E-MAIL — transforma o e-mail guardado em
// contas_fixas_emails em fatura (contas_fixas_faturas) e em parcela do
// HEADCOACH › CONTAS A PAGAR.
//
// Hoje: Alares ("A fatura digital da sua internet chegou!") e Lanservi
// ("Lembrete de pagamento LANSERVI TECNOLOGIA"), as duas com o PDF anexo. Um
// e-mail pode trazer várias faturas, quando são encaminhadas juntas.
//
// A loja de cada fatura é a do LOCAL DE INSTALAÇÃO, não a do CNPJ que contratou:
// a internet da Ayrton Senna está no CNPJ da matriz e as da matriz estão no CNPJ
// de outra empresa do grupo (ver empresaDaInstalacao).
//
// Qualquer pessoa pode mandar e-mail para o endereço do domínio, então nada é
// lançado só porque "parece" uma fatura: o boleto tem que ser de uma conta de
// recebimento conhecida da operadora, o documento tem que ser do CNPJ dela, o
// cliente tem que ser uma empresa do grupo e o Pix tem que ser do mesmo título
// do boleto. Na dúvida a fatura fica de fora, com o motivo gravado no e-mail.
// ============================================================
import supabase from '../config/supabase.js';
import { BUCKET_EXTRATOS } from './fluxoCaixaExt.js';
import { salvarFatura, gerarDuplicataCp } from './contasFixasFaturas.js';
import { remetenteAceito } from '../utils/emailEntrada.js';
import { valorDoPix } from '../utils/contasFixasWhatsapp.js';
import { lerFaturaAlaresPdf, pixsDoTexto, remetenteDoEncaminhado, boletoEhDaAlares, empresaDaInstalacao, pixDoBoletoEntre } from '../utils/faturaAlaresEmail.js';
import { lerFaturaLanserviPdf, boletoEhDaLanservi, lerLembreteLanservi } from '../utils/faturaLanserviEmail.js';

const T = 'contas_fixas_emails';

// Uma operadora = quem escreve (domínio do remetente verdadeiro), como ler o PDF e
// o que tem que bater para a fatura entrar.
const LEITORES = [
  {
    nome: 'ALARES',
    remetentes: ['minhaalares.com.br'],
    tipoDespesa: 'INTERNET',
    origem: 'email-alares',
    filtroTitulos: 'nm_fornecedor.ilike.%CABO SERVICOES DE TELECOM%,nm_fornecedor.ilike.%ALARES%',
    cnpjEmitente: '02952192000161',
    lerPdf: lerFaturaAlaresPdf,
    documentoDe: (lida) => lida.notaFiscal,
    boletoConhecido: boletoEhDaAlares,
    recebedorDoPix: /ALARES/i,
    semPdf: 'aviso de vencimento não diz de qual contrato é',
  },
  {
    nome: 'LANSERVI',
    remetentes: ['lanservi.com.br'],
    tipoDespesa: 'INTERNET',
    origem: 'email-lanservi',
    filtroTitulos: 'nm_fornecedor.ilike.%LANSERVI%',
    cnpjEmitente: '19567776000116',
    lerPdf: lerFaturaLanserviPdf,
    documentoDe: (lida) => lida.documento,
    boletoConhecido: boletoEhDaLanservi,
    recebedorDoPix: /LANSERVI/i,
    semPdf: 'o lembrete veio sem o boleto em PDF',
    // o corpo do lembrete repete fatura, valor e vencimento: têm que ser os do PDF
    conferirComOTexto: (lida, texto, quantos) => {
      if (quantos !== 1) return null;
      const l = lerLembreteLanservi(texto);
      if (l.documento && l.documento !== lida.documento) return `o e-mail fala da fatura ${l.documento} e o PDF é da ${lida.documento}`;
      if (l.valor != null && Math.abs(l.valor - lida.valor) > 0.005) return `o e-mail fala em R$ ${l.valor} e o boleto é de R$ ${lida.valor}`;
      if (l.vencimento && l.vencimento !== lida.vencimento) return `o e-mail fala em vencimento ${l.vencimento} e o boleto vence em ${lida.vencimento}`;
      return null;
    },
  },
];

async function empresasDoCadastro() {
  const { data, error } = await supabase.from('erp_empresas').select('code, cnpj, endereco');
  if (error) throw new Error(error.message);
  return data || [];
}

async function baixarAnexo(path) {
  const { data, error } = await supabase.storage.from(BUCKET_EXTRATOS).download(path);
  if (error) throw new Error(`anexo: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function processarFaturas(email, cfg) {
  const anexos = (email.anexos || []).filter((a) => a.path);
  if (!anexos.length) return { ok: false, motivo: `e-mail da ${cfg.nome} sem PDF (${cfg.semPdf})` };

  // lê todos os PDFs antes de lançar; o mesmo boleto anexado duas vezes conta uma vez só
  const lidas = [];
  const recusadas = [];
  for (const anexo of anexos) {
    const pdf = await baixarAnexo(anexo.path);
    const lida = await cfg.lerPdf(pdf).catch(() => null);
    if (!lida?.linhaDigitavel || !lida.codigoCliente || !cfg.documentoDe(lida)) recusadas.push(`${anexo.nome}: não consegui ler a fatura`);
    else if (!lidas.some((l) => l.lida.linhaDigitavel === lida.linhaDigitavel)) lidas.push({ anexo, pdf, lida });
  }

  const empresas = await empresasDoCadastro();
  const pixs = pixsDoTexto(email.texto);
  const faturas = [];
  for (const { anexo, pdf, lida } of lidas) {
    const rotulo = `${anexo.nome} (cliente ${lida.codigoCliente})`;
    const divergencia = cfg.conferirComOTexto ? cfg.conferirComOTexto(lida, email.texto, lidas.length) : null;
    if (lida.cnpjEmitente !== cfg.cnpjEmitente) recusadas.push(`${rotulo}: o documento não é da ${cfg.nome}`);
    else if (!cfg.boletoConhecido(lida.linhaDigitavel)) recusadas.push(`${rotulo}: o boleto não é de uma conta de recebimento conhecida da ${cfg.nome} — conferir à mão`);
    else if (!empresas.some((e) => String(e.cnpj || '') === lida.cnpjCliente)) recusadas.push(`${rotulo}: o CNPJ do cliente não é de uma empresa do cadastro`);
    else if (divergencia) recusadas.push(`${rotulo}: ${divergencia} — conferir à mão`);
    else {
      const empresa = empresaDaInstalacao(lida.instalacao, lida.cnpjCliente, empresas);
      if (!empresa) {
        recusadas.push(`${rotulo}: não deu para saber de qual loja é a instalação`);
        continue;
      }
      // o Pix vem no corpo do e-mail; só entra o que é, sem dúvida, deste boleto
      let pix = pixDoBoletoEntre(pixs, lida, lidas.map((l) => l.lida), valorDoPix);
      if (pix && !cfg.recebedorDoPix.test(pix)) pix = null;
      const s = await salvarFatura({
        tipoDespesa: cfg.tipoDespesa,
        concessionaria: cfg.nome,
        loja: String(empresa.code),
        codigoCliente: lida.codigoCliente,
        valor: lida.valor,
        vencimento: lida.vencimento,
        pix,
        linhaDigitavel: lida.linhaDigitavel,
        pdf,
        origem: cfg.origem,
        filtroTitulos: cfg.filtroTitulos,
      });
      const cp = await gerarDuplicataCp(s.id);
      faturas.push({ faturaId: s.id, nova: s.nova, empresa: empresa.code, empresaPor: empresa.por, codigoCliente: lida.codigoCliente, instalacao: lida.instalacao, valor: lida.valor, vencimento: lida.vencimento, pix: Boolean(pix), cp });
    }
  }
  if (!faturas.length) return { ok: false, motivo: recusadas.join(' · ') || 'nenhuma fatura lida' };
  return { ok: true, concessionaria: cfg.nome, faturas, recusadas };
}

/**
 * Lê um e-mail guardado e, se for fatura de uma operadora conhecida, lança.
 * Rodar de novo no mesmo e-mail não duplica (a fatura e a parcela já existem).
 * @returns {{ ok: boolean, motivo?: string, concessionaria?: string, faturas?: object[], recusadas?: string[] }}
 */
export async function processarEmail(id) {
  const { data: email, error } = await supabase.from(T).select('id, de, assunto, texto, anexos').eq('id', Number(id)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!email) throw new Error(`e-mail ${id} não existe`);
  // encaminhado à mão, o remetente verdadeiro fica no corpo; pelo filtro do Gmail, fica no cabeçalho
  const remetente = remetenteDoEncaminhado(email.texto) || email.de;
  const leitor = LEITORES.find((l) => remetenteAceito(remetente, l.remetentes));
  let r;
  try {
    r = leitor ? await processarFaturas(email, leitor) : { ok: false, motivo: `remetente sem leitor de fatura (${remetente || '?'})` };
  } catch (e) {
    r = { ok: false, motivo: `erro: ${e.message}` };
  }
  const resumo = r.ok
    ? [...r.faturas.map((f) => `fatura #${f.faturaId} empresa ${f.empresa} R$ ${Number(f.valor).toFixed(2)} venc ${f.vencimento}${f.cp?.titulo ? ` → duplicata ${f.cp.titulo.duplicata}/${f.cp.titulo.parcela}` : ''}${f.cp?.criada === false && f.cp?.motivo ? ` (${f.cp.motivo})` : ''}`), ...(r.recusadas || []).map((x) => `FORA: ${x}`)].join(' · ')
    : r.motivo;
  await supabase.from(T).update({ processado_em: new Date().toISOString(), resultado: `${r.ok ? 'OK' : 'NÃO LANÇADO'}: ${resumo}`.slice(0, 1500), fatura_id: r.ok ? r.faturas[0]?.faturaId || null : null }).eq('id', email.id);
  return r;
}

export default { processarEmail };
