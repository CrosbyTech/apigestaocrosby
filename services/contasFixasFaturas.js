// ============================================================
// FATURAS DAS DESPESAS FIXAS — o que os bots capturam (Cosern pelo WhatsApp).
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
import { lerFaturaCosernPdf, confereValorEVencimento } from '../utils/faturaCosernPdf.js';

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
 * @param f { tipoDespesa, concessionaria, loja, codigoCliente, valor, vencimento, pix, pdf: Buffer|null, origem, filtroTitulos }
 * @returns { id, nova, liberacaoId, vinculou }
 */
export async function salvarFatura(f) {
  const chave = { concessionaria: f.concessionaria, codigo_cliente: f.codigoCliente, vencimento: f.vencimento, valor: f.valor };
  const { data: existente, error: e0 } = await supabase.from(T.fat).select('*').match(chave).maybeSingle();
  if (e0) throw new Error(e0.message);

  let pdfPath = existente?.pdf_path || null;
  if (!pdfPath && f.pdf) pdfPath = await guardarArquivoExtrato(f.pdf, { nome: `${f.concessionaria}_loja${f.loja}_${f.vencimento}.pdf`, pasta: 'contas-fixas' });

  const linha = { ...chave, tipo_despesa: f.tipoDespesa, cd_filial: String(f.loja), pix_copia_cola: f.pix || existente?.pix_copia_cola || null, pdf_path: pdfPath, origem: f.origem, atualizado_em: agora() };
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
// Fornecedor, despesa e portador das faturas da Cosern, iguais aos que o
// financeiro usa no TOTVS: 184 COMPANHIA ENERGETICA DO RN, 6010 ENERGIA
// ELETRICA e portador 5 BOLETO.
const COSERN_CP = { fornecedorCode: 184, despesaCode: 6010, portadorCode: 5 };
const ORIGEM_CP = 'bot-cosern-whatsapp';
// centro de custo de cada empresa (hc_cp_centros_custo): a conta de luz é da própria loja
export const CENTRO_CUSTO_DA_EMPRESA = { 1: 10, 2: 2, 5: 5, 55: 16, 65: 15, 87: 41, 90: 37, 99: 18 };

/**
 * Gera a duplicata da fatura capturada (uma por fatura; rodar de novo não duplica).
 * Número da nota e emissão vêm do PDF; valor, vencimento e Pix, da conversa.
 * @returns {{ criada: boolean, titulo?: object, motivo?: string }}
 */
export async function gerarDuplicataCp(faturaId, { por = 'Bot Cosern (WhatsApp)' } = {}) {
  const { data: f, error } = await supabase.from(T.fat).select('*').eq('id', Number(faturaId)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!f) throw new Error(`fatura ${faturaId} não existe`);
  if (f.concessionaria !== 'COSERN') return { criada: false, motivo: `ainda não sei gerar duplicata de ${f.concessionaria}` };
  const empresa = Number(f.cd_filial);
  if (!(empresa > 0)) return { criada: false, motivo: `"${f.cd_filial}" não é uma empresa do cadastro` };

  const { data: ja, error: e1 } = await supabase.from('hc_cp_titulos').select('id, duplicata, parcela, documento_fiscal, vencimento, situacao').eq('origem', ORIGEM_CP).eq('origem_ref', String(f.id)).limit(1);
  if (e1) throw new Error(e1.message);
  if (ja?.length) return { criada: false, titulo: ja[0], motivo: 'já tinha duplicata' };

  if (!f.pdf_path) return { criada: false, motivo: 'fatura sem PDF: não tenho a data de emissão nem o número da nota' };
  const { data: arq, error: e2 } = await supabase.storage.from(BUCKET_EXTRATOS).download(f.pdf_path);
  if (e2) throw new Error(`PDF da fatura: ${e2.message}`);
  const lida = await lerFaturaCosernPdf(Buffer.from(await arq.arrayBuffer()));
  if (!lida.notaFiscal || !lida.emissao) return { criada: false, motivo: 'não achei o número da nota ou a emissão no PDF' };
  if (lida.codigoCliente !== f.codigo_cliente) return { criada: false, motivo: `o PDF é do código de cliente ${lida.codigoCliente}, não do ${f.codigo_cliente}` };
  if (!confereValorEVencimento(lida, { valor: f.valor, vencimento: f.vencimento })) return { criada: false, motivo: 'valor ou vencimento do PDF diferentes dos da conversa' };

  // a conta de energia é uma duplicata só por instalação; a fatura de cada mês é uma parcela dela (1/11, 1/12)
  const parcela = parcelaDoMes(f.vencimento);
  const { data: doBot, error: e3 } = await supabase.from('hc_cp_titulos').select('duplicata, parcela, origem_ref').eq('empresa', empresa).eq('fornecedor_code', COSERN_CP.fornecedorCode).eq('origem', ORIGEM_CP).neq('situacao', 'cancelado');
  if (e3) throw new Error(e3.message);
  const ids = [...new Set((doBot || []).map((t) => Number(t.origem_ref)).filter((n) => n > 0))];
  const { data: fats, error: e4 } = ids.length ? await supabase.from(T.fat).select('id, codigo_cliente').in('id', ids) : { data: [] };
  if (e4) throw new Error(e4.message);
  const daInstalacao = new Set((fats || []).filter((x) => x.codigo_cliente === f.codigo_cliente).map((x) => String(x.id)));
  const duplicata = duplicataDaContaMensal((doBot || []).filter((t) => daInstalacao.has(String(t.origem_ref))), parcela);

  const dados = validarInclusao({
    empresa,
    duplicata,
    ...COSERN_CP,
    centroCustoCode: CENTRO_CUSTO_DA_EMPRESA[empresa] || null,
    documentoFiscal: lida.notaFiscal,
    tipoDocumento: 'nota_fiscal',
    formaPagamento: f.pix_copia_cola ? 'pix' : lida.linhaDigitavel ? 'boleto' : null,
    chavePix: f.pix_copia_cola,
    codigoBarras: lida.linhaDigitavel,
    emissao: lida.emissao,
    entrada: String(f.capturado_em).slice(0, 10),
    referencia: lida.referencia,
    observacao: `Energia ${lida.referencia || ''} · código do cliente ${f.codigo_cliente} · nota fiscal ${lida.notaFiscal}${lida.serie ? ` série ${lida.serie}` : ''} · fatura capturada pelo bot da Cosern no WhatsApp`.replace(/\s+/g, ' '),
    parcela,
    vencimento: String(f.vencimento).slice(0, 10),
    valor: Number(f.valor),
  });
  const [titulo] = await inserirTitulos(dados, { por, origem: ORIGEM_CP, origemRef: String(f.id), anexoPath: f.pdf_path });
  return { criada: true, titulo };
}

export default { salvarFatura, gerarDuplicataCp };
