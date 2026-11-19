// ============================================================
// FATURAS DAS DESPESAS FIXAS — o que os bots capturam (energia da Cosern, Energisa e Equatorial e água da CAERN e da Cagepa, pelo WhatsApp).
//
// Guarda a fatura (valor, vencimento, Pix copia e cola, PDF) e, quando acha UM
// título correspondente na Liberação de Pagamento, preenche nele a forma PIX e
// a chave. Na dúvida, não liga a título nenhum: a fatura fica só na tabela.
//
// Tabela: migrations/contas_fixas_faturas.sql.
// ============================================================
import supabase from '../config/supabase.js';
import { guardarArquivoExtrato, BUCKET_EXTRATOS } from './fluxoCaixaExt.js';
import { validarInclusao, inserirTitulos, parcelaDoMes, duplicataDaContaMensal } from './hcContasPagar.js';
import { escolherTitulo } from '../utils/contasFixasWhatsapp.js';
import { lerContasEnergisaDaObservacao } from '../utils/contasFixasEnergisa.js';
import { lerFaturaCosernPdf, confereValorEVencimento } from '../utils/faturaCosernPdf.js';
import { lerFaturaEnergisaPdf } from '../utils/faturaEnergisaPdf.js';
import { lerFaturaEquatorialPdf } from '../utils/faturaEquatorialPdf.js';
import { lerFaturaCaernPdf } from '../utils/faturaCaernPdf.js';
import { lerFaturaCagepaPdf } from '../utils/faturaCagepaPdf.js';

const T = { fat: 'contas_fixas_faturas', lib: 'pagamentos_liberacao' };
const agora = () => new Date().toISOString();

/** Títulos da concessionária na Liberação, pelo nome do fornecedor. */
async function titulosDaConcessionaria(filtroNome) {
  const { data, error } = await supabase
    .from(T.lib)
    .select('id,status,nm_fornecedor,vl_duplicata,vl_real,dt_vencimento,chave_pix,codigo_barras,dados_completos')
    .or(filtroNome)
    .not('status', 'in', '(PAGO,CANCELADO)');
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * @param f { tipoDespesa, concessionaria, loja, codigoCliente, valor, vencimento, pix, linhaDigitavel, pdf: Buffer|null, origem, filtroTitulos }
 * @returns { id, nova, liberacaoId, vinculou }
 */
export async function salvarFatura(f) {
  const chave = { concessionaria: f.concessionaria, codigo_cliente: f.codigoCliente, vencimento: f.vencimento, valor: f.valor };
  const { data: existente, error: e0 } = await supabase.from(T.fat).select('*').match(chave).maybeSingle();
  if (e0) throw new Error(e0.message);

  let pdfPath = existente?.pdf_path || null;
  if (!pdfPath && f.pdf) pdfPath = await guardarArquivoExtrato(f.pdf, { nome: `${f.concessionaria}_loja${f.loja}_${f.vencimento}.pdf`, pasta: 'contas-fixas' });

  const linha = { ...chave, tipo_despesa: f.tipoDespesa, cd_filial: String(f.loja), pix_copia_cola: f.pix || existente?.pix_copia_cola || null, linha_digitavel: f.linhaDigitavel || existente?.linha_digitavel || null, pdf_path: pdfPath, origem: f.origem, atualizado_em: agora() };
  const q = existente ? supabase.from(T.fat).update(linha).eq('id', existente.id) : supabase.from(T.fat).insert(linha);
  const { data: salva, error } = await q.select().single();
  if (error) throw new Error(error.message);

  let liberacaoId = salva.liberacao_id || null;
  let vinculou = false;
  if (!liberacaoId && salva.pix_copia_cola && f.filtroTitulos) {
    const titulo = escolherTitulo({ valor: Number(salva.valor), vencimento: salva.vencimento }, await titulosDaConcessionaria(f.filtroTitulos));
    if (titulo) {
      const dados = { ...(titulo.dados_completos || {}), fatura_bot: { id: salva.id, origem: f.origem, pdf_path: pdfPath, em: agora() } };
      const { error: e2, count } = await supabase
        .from(T.lib)
        .update({ forma_pagamento: 'PIX', chave_pix: salva.pix_copia_cola, dados_completos: dados }, { count: 'exact' })
        .eq('id', titulo.id)
        .is('chave_pix', null); // não passa por cima de chave preenchida à mão
      if (e2) throw new Error(e2.message);
      if (count) {
        liberacaoId = titulo.id;
        vinculou = true;
        await supabase.from(T.fat).update({ liberacao_id: titulo.id }).eq('id', salva.id);
      }
    }
  }
  return { id: salva.id, nova: !existente, liberacaoId, vinculou };
}

// ─── duplicata no HEADCOACH › CONTAS A PAGAR ─────────────────────────────────
// centro de custo de cada empresa (hc_cp_centros_custo): a conta de luz é da própria loja
export const CENTRO_CUSTO_DA_EMPRESA = { 1: 10, 2: 2, 5: 5, 55: 16, 65: 15, 87: 41, 90: 37, 93: 32, 99: 18 };

const mesmoValor = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

/** Cosern: DANFE da nota fiscal de energia. */
async function lerCosern(pdf, f) {
  const lida = await lerFaturaCosernPdf(pdf);
  if (!lida.notaFiscal || !lida.emissao) return { motivo: 'não achei o número da nota ou a emissão no PDF' };
  if (lida.codigoCliente !== f.codigo_cliente) return { motivo: `o PDF é do código de cliente ${lida.codigoCliente}, não do ${f.codigo_cliente}` };
  if (!confereValorEVencimento(lida, { valor: f.valor, vencimento: f.vencimento })) return { motivo: 'valor ou vencimento do PDF diferentes dos da conversa' };
  return { documentoFiscal: lida.notaFiscal, emissao: lida.emissao, referencia: lida.referencia, linhaDigitavel: lida.linhaDigitavel, detalhe: `nota fiscal ${lida.notaFiscal}${lida.serie ? ` série ${lida.serie}` : ''}` };
}

/** Energisa: boleto da 2ª via simplificada. Valor e vencimento conferidos pela linha digitável. */
async function lerEnergisa(pdf, f) {
  const lida = await lerFaturaEnergisaPdf(pdf);
  if (!lida.numero || !lida.emissao || !lida.linhaDigitavel) return { motivo: 'não achei o número da fatura, a emissão ou a linha digitável no PDF' };
  if (lida.cnpjBeneficiario && lida.cnpjBeneficiario !== '09095183000140') return { motivo: `o beneficiário do boleto não é a Energisa Paraíba (CNPJ ${lida.cnpjBeneficiario})` };
  if (!mesmoValor(lida.valor, f.valor) || lida.vencimento !== String(f.vencimento).slice(0, 10)) return { motivo: 'valor ou vencimento do boleto diferentes dos da conversa' };
  return { documentoFiscal: lida.numero, emissao: lida.emissao, referencia: lida.referencia, linhaDigitavel: lida.linhaDigitavel, detalhe: `fatura ${lida.numero} · UC ${lida.uc || '?'}` };
}

/** Equatorial Maranhão: nota fiscal de energia com a ficha de compensação. */
async function lerEquatorial(pdf, f) {
  const lida = await lerFaturaEquatorialPdf(pdf);
  if (!lida.notaFiscal || !lida.emissao || !lida.linhaDigitavel) return { motivo: 'não achei o número da nota, a emissão ou a linha digitável no PDF' };
  if (lida.cnpjEmitente && lida.cnpjEmitente !== '06272793000184') return { motivo: `a nota não é da Equatorial Maranhão (CNPJ ${lida.cnpjEmitente})` };
  const semZeros = (v) => String(v ?? '').replace(/D/g, '').replace(/^0+/, '');
  if (semZeros(lida.contaContrato) !== semZeros(f.codigo_cliente)) return { motivo: `o PDF é da conta contrato ${lida.contaContrato}, não da ${f.codigo_cliente}` };
  if (!mesmoValor(lida.valor, f.valor) || lida.vencimento !== String(f.vencimento).slice(0, 10)) return { motivo: 'valor ou vencimento do boleto diferentes dos da conversa' };
  return { documentoFiscal: lida.notaFiscal, emissao: lida.emissao, referencia: lida.referencia, linhaDigitavel: lida.linhaDigitavel, detalhe: `nota fiscal ${lida.notaFiscal}${lida.serie ? ` série ${lida.serie}` : ''} · UC ${lida.uc || '?'}` };
}

/** CAERN: documento auxiliar da nota fiscal de água e saneamento. */
async function lerCaern(pdf, f) {
  const lida = await lerFaturaCaernPdf(pdf);
  if (!lida.notaFiscal || !lida.emissao || !lida.linhaDigitavel) return { motivo: 'não achei o número da nota, a emissão ou o código de barras no PDF' };
  if (lida.cnpjEmitente && lida.cnpjEmitente !== '08334385000135') return { motivo: `a nota não é da CAERN (CNPJ ${lida.cnpjEmitente})` };
  const semZeros = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (semZeros(lida.matricula) !== semZeros(f.codigo_cliente)) return { motivo: `o PDF é da matrícula ${lida.matricula}, não da ${f.codigo_cliente}` };
  if (!mesmoValor(lida.valor, f.valor) || lida.vencimento !== String(f.vencimento).slice(0, 10)) return { motivo: 'valor ou vencimento do PDF diferentes dos da conversa' };
  return { documentoFiscal: lida.notaFiscal, emissao: lida.emissao, referencia: lida.referencia, linhaDigitavel: lida.linhaDigitavel, detalhe: `nota fiscal ${lida.notaFiscal}${lida.serie ? ` série ${lida.serie}` : ''}` };
}

/** Cagepa: documento auxiliar da nota fiscal de água e saneamento (conta detalhada). */
async function lerCagepa(pdf, f) {
  const lida = await lerFaturaCagepaPdf(pdf);
  if (!lida.notaFiscal || !lida.emissao || !lida.linhaDigitavel) return { motivo: 'não achei o número da nota, a data da nota ou o código de barras no PDF' };
  if (lida.cnpjEmitente && lida.cnpjEmitente !== '09123654000187') return { motivo: `a nota não é da Cagepa (CNPJ ${lida.cnpjEmitente})` };
  const semZeros = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (semZeros(lida.matricula) !== semZeros(f.codigo_cliente)) return { motivo: `o PDF é da matrícula ${lida.matricula}, não da ${f.codigo_cliente}` };
  if (!mesmoValor(lida.valor, f.valor) || lida.vencimento !== String(f.vencimento).slice(0, 10)) return { motivo: 'valor ou vencimento do PDF diferentes dos da fatura salva' };
  return { documentoFiscal: lida.notaFiscal, emissao: lida.emissao, referencia: lida.referencia, linhaDigitavel: lida.linhaDigitavel, detalhe: `nota fiscal ${lida.notaFiscal}${lida.serie ? ` série ${lida.serie}` : ''}` };
}

/** Sala (ou outro rótulo) da conta, pela observação da Controle de Filiais. */
async function rotuloDaContaEnergisa(f) {
  const { data } = await supabase.from('despesas_fixas_filial').select('observacao, nm_fornecedor').eq('tipo_despesa', 'ENERGIA').eq('cd_filial', String(f.cd_filial));
  for (const r of data || []) {
    const conta = lerContasEnergisaDaObservacao(r.observacao).find((c) => c.codigo === f.codigo_cliente);
    if (conta?.rotulo) return conta.rotulo;
  }
  return null;
}

// Fornecedor, despesa e portador de cada concessionária, iguais aos que o financeiro
// usa no TOTVS (despesa 6010 ENERGIA ELETRICA ou 6011 AGUA E ESGOTO, portador 5 BOLETO).
export const CP_DA_CONCESSIONARIA = {
  COSERN: { nome: 'Cosern', fornecedorCode: 184, despesaCode: 6010, portadorCode: 5, origem: 'bot-cosern-whatsapp', tipoDocumento: 'nota_fiscal', ler: lerCosern },
  CAGEPA: { nome: 'Cagepa', conta: 'Água', rotuloCodigo: 'matrícula', fornecedorCode: 99808, despesaCode: 6011, portadorCode: 5, origem: 'bot-cagepa-whatsapp', tipoDocumento: 'nota_fiscal', ler: lerCagepa },
  CAERN: { nome: 'CAERN', conta: 'Água', rotuloCodigo: 'matrícula', fornecedorCode: 20519, despesaCode: 6011, portadorCode: 5, origem: 'bot-caern-whatsapp', tipoDocumento: 'nota_fiscal', ler: lerCaern },
  EQUATORIAL: { nome: 'Equatorial', fornecedorCode: 21889, despesaCode: 6010, portadorCode: 5, origem: 'bot-equatorial-whatsapp', tipoDocumento: 'nota_fiscal', ler: lerEquatorial },
  ENERGISA: { nome: 'Energisa', fornecedorCode: 20958, despesaCode: 6010, portadorCode: 5, origem: 'bot-energisa-whatsapp', tipoDocumento: 'boleto', ler: lerEnergisa, rotulo: rotuloDaContaEnergisa },
};

/**
 * Gera a parcela da fatura capturada no Contas a Pagar (uma por fatura; rodar de
 * novo não duplica). Documento fiscal e emissão vêm do PDF; valor, vencimento e
 * Pix, da conversa. A conta (energia ou água) é uma duplicata por instalação (código do
 * cliente) e a fatura de cada mês é uma parcela dela (1/11, 1/12).
 * @returns {{ criada: boolean, titulo?: object, motivo?: string }}
 */
export async function gerarDuplicataCp(faturaId, { por } = {}) {
  const { data: f, error } = await supabase.from(T.fat).select('*').eq('id', Number(faturaId)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!f) throw new Error(`fatura ${faturaId} não existe`);
  const cfg = CP_DA_CONCESSIONARIA[f.concessionaria];
  if (!cfg) return { criada: false, motivo: `ainda não sei gerar duplicata de ${f.concessionaria}` };
  const empresa = Number(f.cd_filial);
  if (!(empresa > 0)) return { criada: false, motivo: `"${f.cd_filial}" não é uma empresa do cadastro` };

  const { data: ja, error: e1 } = await supabase.from('hc_cp_titulos').select('id, duplicata, parcela, documento_fiscal, vencimento, situacao').eq('origem', cfg.origem).eq('origem_ref', String(f.id)).limit(1);
  if (e1) throw new Error(e1.message);
  if (ja?.length) return { criada: false, titulo: ja[0], motivo: 'já tinha duplicata' };

  if (!f.pdf_path) return { criada: false, motivo: 'fatura sem PDF: não tenho a data de emissão nem o número do documento' };
  const { data: arq, error: e2 } = await supabase.storage.from(BUCKET_EXTRATOS).download(f.pdf_path);
  if (e2) throw new Error(`PDF da fatura: ${e2.message}`);
  const lida = await cfg.ler(Buffer.from(await arq.arrayBuffer()), f);
  if (lida.motivo) return { criada: false, motivo: lida.motivo };

  // em qual duplicata entra: a que já é desta instalação, ou uma nova
  const parcela = parcelaDoMes(f.vencimento);
  const { data: doBot, error: e3 } = await supabase.from('hc_cp_titulos').select('duplicata, parcela, origem_ref').eq('empresa', empresa).eq('fornecedor_code', cfg.fornecedorCode).eq('origem', cfg.origem).neq('situacao', 'cancelado');
  if (e3) throw new Error(e3.message);
  const ids = [...new Set((doBot || []).map((t) => Number(t.origem_ref)).filter((n) => n > 0))];
  const { data: fats, error: e4 } = ids.length ? await supabase.from(T.fat).select('id, codigo_cliente').in('id', ids) : { data: [] };
  if (e4) throw new Error(e4.message);
  const daInstalacao = new Set((fats || []).filter((x) => x.codigo_cliente === f.codigo_cliente).map((x) => String(x.id)));
  const duplicata = duplicataDaContaMensal((doBot || []).filter((t) => daInstalacao.has(String(t.origem_ref))), parcela);

  const rotulo = cfg.rotulo ? await cfg.rotulo(f) : null;
  const dados = validarInclusao({
    empresa,
    duplicata,
    fornecedorCode: cfg.fornecedorCode,
    despesaCode: cfg.despesaCode,
    portadorCode: cfg.portadorCode,
    centroCustoCode: CENTRO_CUSTO_DA_EMPRESA[empresa] || null,
    documentoFiscal: lida.documentoFiscal,
    tipoDocumento: cfg.tipoDocumento,
    formaPagamento: f.pix_copia_cola ? 'pix' : lida.linhaDigitavel ? 'boleto' : null,
    chavePix: f.pix_copia_cola,
    codigoBarras: lida.linhaDigitavel,
    emissao: lida.emissao,
    entrada: String(f.capturado_em).slice(0, 10),
    referencia: lida.referencia,
    observacao: `${cfg.conta || 'Energia'} ${lida.referencia || ''}${rotulo ? ` · ${rotulo}` : ''} · ${cfg.rotuloCodigo || 'código do cliente'} ${f.codigo_cliente} · ${lida.detalhe} · fatura capturada pelo bot da ${cfg.nome} no WhatsApp`.replace(/\s+/g, ' '),
    parcela,
    vencimento: String(f.vencimento).slice(0, 10),
    valor: Number(f.valor),
  });
  const [titulo] = await inserirTitulos(dados, { por: por || `Bot ${cfg.nome} (WhatsApp)`, origem: cfg.origem, origemRef: String(f.id), anexoPath: f.pdf_path });
  return { criada: true, titulo };
}

export default { salvarFatura, gerarDuplicataCp };
