// ============================================================================
// NF-e DE DEVOLUÇÃO (ENTRADA) DE UMA NOTA DE VENDA DO HEADCOACH
// (Yago, 13/11/2026: anular as NF-e emitidas em dobro nos faturamentos de 10 e
// 11/11 com uma nota de devolução na operação 7245.)
//
// Gabarito copiado das devoluções que o próprio TOTVS emitiu na empresa 99 com
// a operação 7245 "DEVOL REVENDEDORES" (ex.: NF 15037/PE, 15639/MG, 15009/RN):
//   ide ..... natOp DEVOLUCAO DE VENDA DE PRODUCAO DO ESTABELECIMENTO, tpNF 0,
//             finNFe 4, indPres 0 (sem indIntermed), NFref/refNFe = nota original
//   itens ... mesmos valores da venda; CFOP 5101→1201, 5102→1202, 6101/6107→2201,
//             6102/6108→2202; ICMS igual; IPI IPINT CST 03; PIS/COFINS
//             Outr CST 50 com os mesmos valores; IBS/CBS iguais; DIFAL: o valor
//             que a venda mandou ao estado de destino vai em vICMSUFRemet e
//             vICMSUFDest fica 0,00
//   transp .. modFrete 9 · pag tPag 90 vPag 0,00 · infCpl com a referência
// A devolução vira uma transação própria em pdv_vendas (canal 'devolucao',
// operação 7245, sem pagamento → sem contas a receber) com a nota em
// pdv_notas_fiscais; nada vai para o TOTVS.
// ============================================================================
import crypto from 'crypto';
import { xml2json, json2xml } from 'node-sped-nfe';
import supabase from '../config/supabase.js';
import { agoraBrasil, buscarConfig, buscarEmitente, certificadoPara, assinarEEnviar, VERSAO_APLICACAO } from './pdvFiscal.js';

export class DevolucaoNotaError extends Error {
  constructor(message, code = 'DEVOLUCAO_NOTA', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const NATOP_DEVOLUCAO = 'DEVOLUCAO DE VENDA DE PRODUCAO DO ESTABELECIMENTO';
const CFOP_DEVOLUCAO = { 5101: '1201', 5102: '1202', 6101: '2201', 6107: '2201', 6102: '2202', 6108: '2202' };
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const f2 = (v) => r2(v).toFixed(2);
const lista = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// dígito verificador da chave (módulo 11, pesos 2..9)
function dvChave(base43) {
  let soma = 0;
  let peso = 2;
  for (let i = base43.length - 1; i >= 0; i -= 1) {
    soma += Number(base43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * Monta (sem assinar) a NF-e de devolução de uma nota de venda autorizada.
 * Devolve { xml, chave, dhEmi, vNF }.
 */
export async function montarDevolucao({ xmlOriginal, chaveOriginal, numeroOriginal, numero, serie, tpAmb, observacao }) {
  const nfeXml = String(xmlOriginal).match(/<NFe[\s\S]*?<\/NFe>/)?.[0];
  if (!nfeXml) throw new DevolucaoNotaError('XML da nota original não encontrado');
  const doc = await xml2json(nfeXml.replace(/<Signature[\s\S]*?<\/Signature>/, ''));
  const inf = doc.NFe.infNFe;
  delete doc.NFe.infNFeSupl;
  const ide = inf.ide;
  if (String(ide.mod) !== '55') throw new DevolucaoNotaError('Só NF-e (modelo 55)');
  if (String(ide.tpNF) !== '1') throw new DevolucaoNotaError('A nota original não é de saída');

  const dhEmi = agoraBrasil();
  const cNF = String(crypto.randomInt(0, 99999999)).padStart(8, '0');
  const cnpj = String(inf.emit.CNPJ);
  const aamm = dhEmi.slice(2, 4) + dhEmi.slice(5, 7);
  const base = `${String(ide.cUF)}${aamm}${cnpj}55${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}1${cNF}`;
  const cDV = dvChave(base);
  const chave = `${base}${cDV}`;

  // ide na ordem do schema (indIntermed sai; NFref entra depois de verProc)
  inf.ide = {
    cUF: ide.cUF,
    cNF,
    natOp: NATOP_DEVOLUCAO,
    mod: '55',
    serie: String(serie),
    nNF: String(numero),
    dhEmi,
    dhSaiEnt: dhEmi,
    tpNF: '0',
    idDest: ide.idDest,
    cMunFG: ide.cMunFG,
    tpImp: ide.tpImp,
    tpEmis: '1',
    cDV: String(cDV),
    tpAmb: String(tpAmb),
    finNFe: '4',
    indFinal: ide.indFinal,
    indPres: '0',
    procEmi: '0',
    verProc: VERSAO_APLICACAO,
    NFref: { refNFe: chaveOriginal },
  };
  inf['@Id'] = `NFe${chave}`;
  // homologação: a SEFAZ exige este nome no destinatário
  if (Number(tpAmb) === 2 && inf.dest) inf.dest.xNome = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

  let totRemet = 0;
  for (const det of lista(inf.det)) {
    const cfop = String(det.prod.CFOP);
    if (!CFOP_DEVOLUCAO[cfop]) throw new DevolucaoNotaError(`CFOP ${cfop} sem regra de devolução`);
    det.prod.CFOP = CFOP_DEVOLUCAO[cfop];
    const imp = det.imposto;
    if (imp.IPI?.IPINT) imp.IPI.IPINT.CST = '03';
    for (const [grupo, aliq, outr] of [
      ['PIS', 'PISAliq', 'PISOutr'],
      ['COFINS', 'COFINSAliq', 'COFINSOutr'],
    ]) {
      const g = imp[grupo]?.[aliq];
      if (g) imp[grupo] = { [outr]: { ...g, CST: '50' } };
    }
    if (imp.ICMSUFDest) {
      const v = Number(imp.ICMSUFDest.vICMSUFDest || 0);
      imp.ICMSUFDest.vICMSUFDest = '0.00';
      imp.ICMSUFDest.vICMSUFRemet = f2(v);
      totRemet = r2(totRemet + v);
    }
  }
  const tot = inf.total.ICMSTot;
  if (Number(tot.vICMSUFDest || 0) > 0 || totRemet > 0) {
    tot.vICMSUFDest = '0.00';
    tot.vICMSUFRemet = f2(totRemet);
  }
  inf.transp = { modFrete: '9', vol: { qVol: '0', pesoL: '0.000', pesoB: '0.000' } };
  delete inf.cobr;
  inf.pag = { detPag: { tPag: '90', vPag: '0.00' } };
  const cplOriginal = String(inf.infAdic?.infCpl || '');
  const resumoIcms = cplOriginal.match(/^CST \d+ ICMS [\d.,]+ [\d.,]+ = [\d.,]+/)?.[0] || '';
  inf.infAdic = {
    infCpl: [resumoIcms, `DEVOLUCAO REFERENTE A NF. ${numeroOriginal}`, observacao].filter(Boolean).join(' - ').slice(0, 5000),
  };
  const xml = await json2xml(doc);
  return { xml, chave, dhEmi, vNF: Number(tot.vNF) };
}

/**
 * Emite a NF-e de devolução de uma venda do HeadCoach (nota autorizada) e
 * registra a devolução como transação própria. aplicar=false só monta o XML.
 * opcoes.ambiente força o ambiente (2 = homologação, para teste: não grava nada).
 */
export async function emitirDevolucaoDaVenda(vendaId, { operacao = 7245, observacao = '', por = null, ambiente = null } = {}) {
  const { data: venda, error } = await supabase.from('pdv_vendas').select('*').eq('id', Number(vendaId)).maybeSingle();
  if (error) throw new DevolucaoNotaError(error.message, 'DB_ERROR', 500);
  if (!venda) throw new DevolucaoNotaError(`Venda ${vendaId} não encontrada`, 'NOT_FOUND', 404);
  const { data: notas } = await supabase.from('pdv_notas_fiscais').select('*').eq('venda_id', venda.id).eq('status', 'autorizada').eq('modelo', 55);
  const original = (notas || [])[0];
  if (!original?.chave) throw new DevolucaoNotaError(`A venda ${vendaId} não tem NF-e autorizada`, 'SEM_NOTA');
  // já existe devolução autorizada desta nota?
  const { data: jaFeita } = await supabase.from('pdv_vendas').select('id, status').eq('nf_referenciada', original.chave).eq('canal', 'devolucao');
  const devAutorizada = (jaFeita || []).find((d) => d.status === 'autorizada');
  if (devAutorizada && ambiente !== 2) return { jaExistia: true, devolucaoVendaId: devAutorizada.id };

  const cfg0 = await buscarConfig(venda.empresa);
  const teste = Number(ambiente) === 2;
  const cfg = teste ? { ...cfg0, ambiente: 2 } : cfg0;
  const emit = await buscarEmitente(venda.empresa);
  const cert = certificadoPara(emit.cnpj);
  const serie = cfg.serie_nfe;

  if (teste) {
    // homologação: número qualquer, nada gravado
    const m = await montarDevolucao({ xmlOriginal: original.xml_proc || original.xml_assinado, chaveOriginal: original.chave, numeroOriginal: original.numero, numero: 900000 + Number(venda.id), serie, tpAmb: 2, observacao });
    const envio = await assinarEEnviar({ xml: m.xml, modelo: 55, emit, cfg, cert });
    return { teste: true, chave: m.chave, cStat: envio.cStat, xMotivo: envio.xMotivo, autorizada: envio.autorizada, xml: m.xml };
  }

  // 1) a transação de devolução (entrada, sem pagamento)
  const reaproveitar = (jaFeita || []).find((d) => d.status !== 'autorizada' && d.status !== 'cancelada');
  let devId = reaproveitar?.id;
  if (!devId) {
    const { data: itens } = await supabase.from('pdv_venda_itens').select('*').eq('venda_id', venda.id).order('seq');
    const { data: nova, error: e1 } = await supabase
      .from('pdv_vendas')
      .insert({
        empresa: venda.empresa,
        empresa_cnpj: venda.empresa_cnpj,
        empresa_nome: venda.empresa_nome,
        tipo_venda: 'nfe',
        operacao,
        cliente_code: venda.cliente_code,
        cliente_nome: venda.cliente_nome,
        cliente_cpf_cnpj: venda.cliente_cpf_cnpj,
        vendedor_code: venda.vendedor_code,
        vendedor_nome: venda.vendedor_nome,
        qtd_pecas: venda.qtd_pecas,
        subtotal: venda.subtotal,
        desconto: venda.desconto,
        total: venda.total,
        status: 'registrada',
        nf_referenciada: original.chave,
        observacao: `NF-e de devolução da NF ${original.numero} (venda ${venda.id}). ${observacao}`.trim(),
        criado_por: por,
        origem: venda.origem,
        canal: 'devolucao',
        numero_site: venda.numero_site ? `${venda.numero_site}-DEV` : null,
        pedido_info: { devolucao: { vendaOriginal: venda.id, notaOriginal: original.numero, chaveOriginal: original.chave, motivo: observacao, operacao } },
      })
      .select()
      .single();
    if (e1) throw new DevolucaoNotaError(e1.message, 'DB_ERROR', 500);
    devId = nova.id;
    if ((itens || []).length) {
      const copia = itens.map(({ id, venda_id, ...i }) => ({ ...i, venda_id: devId, cfop: i.cfop ? Number(CFOP_DEVOLUCAO[String(i.cfop)] || i.cfop) : i.cfop }));
      const { error: e2 } = await supabase.from('pdv_venda_itens').insert(copia);
      if (e2) throw new DevolucaoNotaError(e2.message, 'DB_ERROR', 500);
    }
  }

  // 2) numeração (reaproveita a de uma tentativa rejeitada desta devolução)
  const { data: notasDev } = await supabase.from('pdv_notas_fiscais').select('*').eq('venda_id', devId).order('id');
  const reapNota = (notasDev || []).find((n) => ['rejeitada', 'erro', 'gerada'].includes(n.status) && n.ambiente === cfg.ambiente);
  let numero = reapNota?.numero;
  if (!numero) {
    const { data: n, error: e3 } = await supabase.rpc('pdv_fiscal_proximo_numero', { p_empresa: venda.empresa, p_modelo: 55 });
    if (e3) throw new DevolucaoNotaError(`Falha ao obter numeração: ${e3.message}`, 'NUMBERING_ERROR', 500);
    numero = Number(n);
  }
  const base = { venda_id: devId, empresa: venda.empresa, cnpj_emitente: emit.cnpj, modelo: 55, serie, numero, chave: null, ambiente: cfg.ambiente, status: 'gerada', dh_emissao: null, cstat: null, xmotivo: null, protocolo: null, erro: null };
  let notaId = reapNota?.id;
  if (notaId) await supabase.from('pdv_notas_fiscais').update(base).eq('id', notaId);
  else {
    const { data: nn, error: e4 } = await supabase.from('pdv_notas_fiscais').insert(base).select('id').single();
    if (e4) throw new DevolucaoNotaError(e4.message, 'DB_ERROR', 500);
    notaId = nn.id;
  }
  await supabase.from('pdv_vendas').update({ status: 'emitindo' }).eq('id', devId);

  // 3) monta, assina e envia
  const m = await montarDevolucao({ xmlOriginal: original.xml_proc || original.xml_assinado, chaveOriginal: original.chave, numeroOriginal: original.numero, numero, serie, tpAmb: cfg.ambiente, observacao });
  await supabase.from('pdv_notas_fiscais').update({ chave: m.chave, dh_emissao: m.dhEmi }).eq('id', notaId);
  let envio;
  try {
    envio = await assinarEEnviar({ xml: m.xml, modelo: 55, emit, cfg, cert });
  } catch (err) {
    await supabase.from('pdv_notas_fiscais').update({ status: 'erro', erro: err.message, xml_assinado: err.details?.xmlAssinado || null }).eq('id', notaId);
    await supabase.from('pdv_vendas').update({ status: 'rejeitada' }).eq('id', devId);
    throw err;
  }
  await supabase
    .from('pdv_notas_fiscais')
    .update({
      status: envio.autorizada ? 'autorizada' : 'rejeitada',
      cstat: envio.cStat,
      xmotivo: envio.xMotivo,
      protocolo: envio.nProt,
      dh_autorizacao: envio.autorizada ? envio.dhRecbto : null,
      xml_assinado: envio.xmlAssinado,
      xml_proc: envio.xmlProc,
      erro: envio.autorizada ? null : `${envio.cStat} - ${envio.xMotivo}`,
    })
    .eq('id', notaId);
  await supabase.from('pdv_vendas').update({ status: envio.autorizada ? 'autorizada' : 'rejeitada' }).eq('id', devId);
  console.log(`${envio.autorizada ? '✅' : '❌'} [devolução] venda ${venda.id} NF ${original.numero} → devolução ${devId} NF-e ${serie}/${numero} ${envio.cStat} ${envio.xMotivo}`);
  return { devolucaoVendaId: devId, notaId, numero, serie, chave: m.chave, autorizada: envio.autorizada, cStat: envio.cStat, xMotivo: envio.xMotivo };
}
