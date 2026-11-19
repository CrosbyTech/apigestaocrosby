// ============================================================================
// DEVOLUÇÃO RFID 100% NO HEADCOACH (Yago, 17/11/2026)
//
// A tela Devolução RFID não gera mais transação no TOTVS. O operador lê as
// peças, procura as NOTAS DE VENDA do cliente, escolhe as que vai referenciar e
// encerra: o HeadCoach grava a transação (pdv_vendas, igual ao PDV Crosby e à
// tela de Transações), emite a NF-e de devolução e gera o CREDEV do cliente.
//
// Gabarito da NF-e: as 209 devoluções que a empresa 99 emitiu pelo TOTVS nas
// operações 7243 / 7244 / 7245 (jun–nov/2026; ex.: NF 12322 × venda 12176):
//   ide ..... natOp DEVOLUCAO DE VENDA DE PRODUCAO DO ESTABELECIMENTO, tpNF 0,
//             finNFe 4, indPres 0, idDest/indFinal da venda, UMA NFref (a SEFAZ
//             rejeita mais de uma: 255); as demais notas vão no infCpl
//   itens ... o item da nota de venda (mesmo valor unitário, desconto e alíquotas):
//             CFOP 5101→1201, 5102→1202, 6101/6107→2201, 6102/6108→2202;
//             ICMS igual; IPI IPINT CST 03; PIS/COFINS viram Outr CST 50 com os
//             mesmos valores; IBS/CBS iguais; DIFAL: o que a venda mandou ao
//             estado de destino vai em vICMSUFRemet (vICMSUFDest 0,00)
//   frete ... NENHUMA devolução leva frete (vFrete 0,00): a base dos impostos é
//             só a mercadoria devolvida (vProd − vDesc), mesmo quando a venda
//             tinha frete rateado no item
//   transp .. modFrete 9 · pag tPag 90 vPag 0,00
//   infCpl .. "CST 000 ICMS 12,00 <base> = <icms> DEVOLUCAO REFERENTE A NF. n"
// Devolução parcial (menos peças que a linha da nota): valores proporcionais e
// imposto recalculado pela alíquota da própria nota.
//
// A transação é uma pdv_vendas com tipo_venda 'troca' (entrada, sem pagamento:
// é o que já gera o CREDEV na autorização e desfaz no cancelamento), canal
// 'devolucao', origem 'devolucao' e pedido_info.devolucaoRfid com as notas e a
// distribuição peça × linha da nota. Nada vai para o TOTVS.
//
// Peça que NÃO ACHA nas notas escolhidas (Yago, 18/11/2026): só para ela, o
// operador referencia OUTRA nota qualquer da empresa (de outro período ou até de
// outro cliente). Se a peça está nessa nota, entra pela linha dela (valor pago).
// Se não está, entra "avulsa": a nota escolhida vai no NFref e o item copia a
// tributação (CFOP, alíquotas de ICMS/PIS/COFINS/IBS/CBS, DIFAL) de uma linha
// das notas do próprio cliente (mesmo cenário fiscal; sem elas, da nota
// escolhida), com os dados do produto (TOTVS) e o valor da tabela do cliente que
// a tela mostra. Na alocação: avulsa:true + modeloChave/nItem da linha modelo,
// que não é gasta. O destinatário da NF-e nunca vem de nota de outro cliente.
// ============================================================================
import crypto from 'crypto';
import axios from 'axios';
import { xml2json, json2xml } from 'node-sped-nfe';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, httpAgent, TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';
import { notasDoClienteTotvs } from '../totvsrouter/pdv.js';
import { agoraBrasil, buscarEmitente, buscarClienteFiscal, buscarProdutoFiscal, VERSAO_APLICACAO } from './pdvFiscal.js';

export class DevolucaoRfidError extends Error {
  constructor(message, code = 'DEVOLUCAO_RFID', status = 400, detalhes = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.detalhes = detalhes;
  }
}

export const OPERACOES_DEVOLUCAO = { 7243: 'DEVOLUÇÕES FRANQUIAS', 7244: 'DEVOLUÇÕES MULTIMARCAS', 7245: 'DEVOLUÇÃO REVENDEDORES' };
export const NATOP_DEVOLUCAO = 'DEVOLUCAO DE VENDA DE PRODUCAO DO ESTABELECIMENTO';
const CFOP_DEVOLUCAO = { 5101: '1201', 5102: '1202', 6101: '2201', 6107: '2201', 6102: '2202', 6108: '2202' };

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const f2 = (v) => r2(v).toFixed(2);
const num = (v) => Number(v) || 0;
const lista = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const digitos = (v) => String(v || '').replace(/\D/g, '');
const chaveValida = (c) => /^\d{44}$/.test(String(c || ''));
const brNum = (v) => r2(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const diaBrasil = (iso) => (iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date(iso)) : null);

// ─── XML das notas de venda ──────────────────────────────────────────────────
const cacheXml = new Map(); // chave → { em, xml }
const CACHE_XML_MS = 30 * 60 * 1000;

/** XML autorizado de uma nota de venda: HeadCoach (pdv_notas_fiscais) ou TOTVS. */
export async function xmlDaNota(chave) {
  const k = String(chave);
  if (!chaveValida(k)) throw new DevolucaoRfidError('Chave de nota inválida', 'CHAVE_INVALIDA');
  const c = cacheXml.get(k);
  if (c && Date.now() - c.em < CACHE_XML_MS) return c;
  const { data: hc } = await supabase.from('pdv_notas_fiscais').select('xml_proc, xml_assinado, status').eq('chave', k).order('id', { ascending: false }).limit(1);
  let xml = hc?.[0]?.status === 'autorizada' ? hc[0].xml_proc || hc[0].xml_assinado : null;
  let origem = xml ? 'headcoach' : 'totvs';
  if (hc?.[0] && hc[0].status === 'cancelada') throw new DevolucaoRfidError(`A nota ${k.slice(25, 34).replace(/^0+/, '')} está cancelada`, 'NOTA_CANCELADA', 409);
  if (!xml) {
    const tk = await getToken();
    if (!tk?.access_token) throw new DevolucaoRfidError('Sem token do TOTVS para ler a nota de venda', 'TOKEN_UNAVAILABLE', 503);
    try {
      const r = await axios.get(`${TOTVS_BASE_URL}/fiscal/v2/xml-contents/${encodeURIComponent(k)}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${tk.access_token}` },
        httpsAgent,
        httpAgent,
        timeout: 60000,
      });
      xml = r.data?.mainInvoiceXml ? Buffer.from(r.data.mainInvoiceXml, 'base64').toString('utf8') : null;
    } catch (e) {
      const nNota = k.slice(25, 34).replace(/^0+/, '');
      throw new DevolucaoRfidError(
        e.response?.status === 404
          ? `A nota ${nNota} não tem XML no TOTVS (registro sem nota autorizada na SEFAZ): tire essa nota e escolha outra`
          : `O TOTVS não entregou o XML da nota ${nNota} (${e.response?.status || e.message})`,
        'XML_INDISPONIVEL',
        502,
      );
    }
    origem = 'totvs';
  }
  if (!xml || !/<NFe[\s>]/.test(xml)) throw new DevolucaoRfidError(`Não achei o XML da nota ${k.slice(25, 34).replace(/^0+/, '')}`, 'XML_INDISPONIVEL', 502);
  const valor = { em: Date.now(), xml, origem };
  cacheXml.set(k, valor);
  if (cacheXml.size > 300) cacheXml.delete(cacheXml.keys().next().value);
  return valor;
}

/** Nota de venda já interpretada: { chave, numero, serie, modelo, data, emitCnpj, destDoc, inf, linhas[] }. */
async function notaInterpretada(chave) {
  const { xml, origem } = await xmlDaNota(chave);
  const nfeXml = String(xml).match(/<NFe[\s\S]*?<\/NFe>/)?.[0];
  if (!nfeXml) throw new DevolucaoRfidError('XML da nota de venda sem o grupo NFe', 'XML_INVALIDO', 502);
  const doc = await xml2json(nfeXml.replace(/<Signature[\s\S]*?<\/Signature>/, ''));
  const inf = doc.NFe.infNFe;
  const ide = inf.ide;
  if (String(ide.tpNF) !== '1') throw new DevolucaoRfidError(`A nota ${ide.nNF} não é de saída (venda)`, 'NOTA_NAO_E_VENDA');
  if (String(ide.finNFe) !== '1') throw new DevolucaoRfidError(`A nota ${ide.nNF} não é uma venda normal (finalidade ${ide.finNFe})`, 'NOTA_NAO_E_VENDA');
  const linhas = lista(inf.det).map((det) => ({
    nItem: Number(det['@nItem']),
    productCode: Number(det.prod.cProd),
    nome: String(det.prod.xProd || ''),
    quantidade: num(det.prod.qCom),
    // valor da mercadoria por peça (sem frete), como o cliente pagou
    valorUnit: num(det.prod.qCom) > 0 ? r2((num(det.prod.vProd) - num(det.prod.vDesc)) / num(det.prod.qCom)) : 0,
    cfop: String(det.prod.CFOP),
    det,
  }));
  return {
    chave: String(chave),
    origem,
    numero: Number(ide.nNF),
    serie: String(ide.serie),
    modelo: Number(ide.mod),
    data: String(ide.dhEmi || '').slice(0, 10),
    emitCnpj: digitos(inf.emit?.CNPJ),
    destDoc: digitos(inf.dest?.CNPJ || inf.dest?.CPF || ''),
    doc,
    inf,
    linhas,
  };
}

// ─── O que já foi devolvido de cada linha de nota (devoluções do HeadCoach) ──
// Só as devoluções desta tela guardam a distribuição por linha; conta tudo o
// que não foi cancelado (a rejeitada segura a peça até ser reemitida ou cancelada).
async function jaDevolvidoPorLinha(chaves, { ignorarVenda = null } = {}) {
  const mapa = new Map(); // `${chave}|${nItem}` → quantidade
  if (!chaves.length) return mapa;
  const { data, error } = await supabase
    .from('pdv_vendas')
    .select('id, status, nf_referenciada, pedido_info')
    .eq('canal', 'devolucao')
    .neq('status', 'cancelada')
    .not('pedido_info->devolucaoRfid', 'is', null)
    .order('id', { ascending: false })
    .limit(5000);
  if (error) throw new DevolucaoRfidError(`Não consegui ler as devoluções já feitas: ${error.message}`, 'DB_ERROR', 500);
  const alvo = new Set(chaves.map(String));
  for (const v of data || []) {
    if (ignorarVenda && Number(v.id) === Number(ignorarVenda)) continue;
    for (const a of v.pedido_info?.devolucaoRfid?.alocacao || []) {
      if (a.avulsa) continue; // peça avulsa só copiou a tributação da linha
      if (!alvo.has(String(a.chave))) continue;
      const k = `${a.chave}|${a.nItem}`;
      mapa.set(k, (mapa.get(k) || 0) + num(a.quantidade));
    }
  }
  return mapa;
}

// Peças que o cliente já devolveu pelo TOTVS (notas de ENTRADA dele na empresa),
// por produto, desde uma data. As devoluções do HeadCoach não vão para o TOTVS,
// então não há contagem dobrada.
const cacheDevTotvs = new Map();
async function devolvidoNoTotvs(cliente, empresa, desde) {
  const de = /^\d{4}-\d{2}-\d{2}$/.test(String(desde || '')) ? String(desde) : new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const ate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const k = `${cliente}|${empresa}|${de}`;
  const c = cacheDevTotvs.get(k);
  if (c && Date.now() - c.em < 2 * 60 * 1000) return c.valor;
  const entradas = await notasDoClienteTotvs({ customer: cliente, de, ate, branch: empresa, tipo: 'Input' });
  const valor = new Map();
  for (const n of entradas) for (const i of n.itens || []) valor.set(Number(i.productCode), (valor.get(Number(i.productCode)) || 0) + num(i.quantity));
  cacheDevTotvs.set(k, { em: Date.now(), valor });
  if (cacheDevTotvs.size > 200) cacheDevTotvs.delete(cacheDevTotvs.keys().next().value);
  return valor;
}

// ─── Notas de venda do cliente (para escolher o que referenciar) ─────────────
/**
 * Notas de VENDA emitidas para o cliente nesta empresa (TOTVS + HeadCoach), da
 * mais recente para a mais antiga, com as peças de cada uma.
 */
export async function listarNotasDeVenda({ empresa, cliente, de, ate }) {
  const emp = parseInt(empresa, 10);
  const cli = parseInt(cliente, 10);
  if (!emp || !cli) throw new DevolucaoRfidError('Informe a empresa e o cliente', 'PARAMETROS');
  const hoje = new Date();
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(String(ate || '')) ? String(ate) : hoje.toISOString().slice(0, 10);
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(String(de || '')) ? String(de) : new Date(hoje.getTime() - 180 * 86400000).toISOString().slice(0, 10);
  const avisos = [];

  const [hcVendas, totvs] = await Promise.all([
    supabase
      .from('pdv_vendas')
      .select(
        'id, empresa, tipo_venda, canal, origem, status, total, qtd_pecas, criado_em, numero_site, totvs_transacao_code, pdv_venda_itens(product_code, nome, quantidade, valor_unit, desconto_unit), pdv_notas_fiscais(numero, serie, modelo, chave, status, dh_emissao)',
      )
      .eq('cliente_code', cli)
      .eq('empresa', emp)
      .eq('status', 'autorizada')
      .gte('criado_em', `${ini}T00:00:00-03:00`)
      .lte('criado_em', `${fim}T23:59:59-03:00`)
      .order('id', { ascending: false })
      .limit(2000)
      .then(({ data, error }) => {
        if (error) throw new DevolucaoRfidError(`Não consegui ler as vendas do HeadCoach: ${error.message}`, 'DB_ERROR', 500);
        return data || [];
      }),
    notasDoClienteTotvs({ customer: cli, de: ini, ate: fim, branch: emp, tipo: 'Output' }).catch((e) => {
      avisos.push(`O TOTVS não respondeu (${e.message}): a lista traz só as notas emitidas pelo HeadCoach.`);
      return [];
    }),
  ]);

  const notas = [];
  const chavesHc = new Set();
  const espelhadas = new Set();
  for (const v of hcVendas) {
    if (v.tipo_venda === 'troca' || ['transferencia', 'devolucao'].includes(v.canal)) continue;
    const nota = (v.pdv_notas_fiscais || []).find((n) => n.status === 'autorizada');
    if (!nota || !chaveValida(nota.chave)) continue;
    chavesHc.add(String(nota.chave));
    if (v.totvs_transacao_code) espelhadas.add(Number(v.totvs_transacao_code));
    notas.push({
      origem: 'headcoach',
      chave: String(nota.chave),
      numero: Number(nota.numero),
      serie: String(nota.serie),
      modelo: Number(nota.modelo) || 55,
      data: diaBrasil(nota.dh_emissao || v.criado_em),
      total: r2(v.total),
      quantidade: (v.pdv_venda_itens || []).reduce((s, i) => s + num(i.quantidade), 0),
      ref: v.numero_site || `transação ${v.id}`,
      itens: (v.pdv_venda_itens || []).map((i) => ({
        productCode: Number(i.product_code),
        nome: i.nome,
        quantidade: num(i.quantidade),
        valorUnit: r2(num(i.valor_unit) - num(i.desconto_unit)),
      })),
    });
  }
  // Número/série que o HeadCoach já usou nesta empresa (qualquer situação): a nota
  // do TOTVS com o mesmo número e outra chave é só registro, sem XML na SEFAZ
  // (19/11/2026: NF 16494 da 99 no TOTVS dava 404 e travava a devolução).
  const numerosHc = new Set();
  const numerosTotvs = [...new Set(totvs.map((n) => Number(n.invoiceCode)).filter(Boolean))];
  if (numerosTotvs.length) {
    const { data: usados } = await supabase
      .from('pdv_notas_fiscais')
      .select('numero, serie, chave')
      .eq('empresa', emp)
      .in('numero', numerosTotvs);
    for (const u of usados || []) numerosHc.add(`${Number(u.numero)}|${Number(u.serie)}|${String(u.chave || '')}`);
  }
  const ehSombraDoHc = (n) =>
    [...numerosHc].some((k) => {
      const [num, serie, chave] = k.split('|');
      return Number(num) === Number(n.invoiceCode) && Number(serie) === Number(n.serialCode) && chave !== String(n.accessKey);
    });
  let semChave = 0;
  let sombras = 0;
  for (const n of totvs) {
    if (n.accessKey && chavesHc.has(String(n.accessKey))) continue;
    if (ehSombraDoHc(n)) {
      sombras += 1;
      continue;
    }
    if (!n.accessKey && n.transactionCode && espelhadas.has(Number(n.transactionCode))) continue;
    if (!chaveValida(n.accessKey)) {
      semChave += 1;
      continue;
    }
    notas.push({
      origem: 'totvs',
      chave: String(n.accessKey),
      numero: Number(n.invoiceCode),
      serie: String(n.serialCode),
      modelo: Number(String(n.accessKey).slice(20, 22)) || 55,
      data: n.invoiceDate,
      total: r2(n.totalValue),
      quantidade: (n.itens || []).reduce((s, i) => s + num(i.quantity), 0),
      // o nome da operação no TOTVS já começa com o código ("7236 - VENDA REVENDEDORES")
      ref: n.operationName ? String(n.operationName).trim() : n.operationCode ? `operação ${n.operationCode}` : null,
      itens: (n.itens || []).map((i) => ({
        productCode: Number(i.productCode),
        nome: i.name,
        quantidade: num(i.quantity),
        valorUnit: r2(i.unitNet || num(i.unitGross) - num(i.unitDiscount)),
      })),
    });
  }
  if (semChave) avisos.push(`${semChave} nota(s) do cliente não têm chave eletrônica e não podem ser referenciadas.`);
  if (sombras) avisos.push(`${sombras} nota(s) do TOTVS ficaram fora: o número já é de uma nota emitida pelo HeadCoach, então o registro do TOTVS não tem XML.`);
  notas.sort((a, b) => String(b.data).localeCompare(String(a.data)) || b.numero - a.numero);
  return { periodo: { de: ini, ate: fim }, avisos, notas };
}

// ─── Conferência: as peças lidas cabem nas notas escolhidas? ─────────────────
/**
 * itens: [{ productCode, quantidade }] · chaves: notas de venda escolhidas, na ordem.
 * avulsas: [{ productCode, chave, valorUnit }] — só para a peça que não coube nas
 * notas escolhidas: a outra nota que ela referencia e o valor da peça (tabela do
 * cliente) caso o produto não esteja nessa nota.
 * Devolve { ok, itens[{ productCode, quantidade, ok, mensagem, naNota, jaDevolvido,
 * disponivel, valorUnit, total, notas[{ chave, numero, serie, quantidade, valorUnit }] }],
 * alocacao[{ chave, nItem, productCode, quantidade }], notas[], chavesUsadas[], totais, avisos[] }
 */
export async function conferirDevolucao({ empresa, clienteCode, itens, chaves, avulsas = [], ignorarVenda = null }) {
  const emp = parseInt(empresa, 10);
  const cliente = parseInt(clienteCode, 10);
  if (!emp) throw new DevolucaoRfidError('Informe a empresa', 'EMPRESA_OBRIGATORIA');
  if (!cliente) throw new DevolucaoRfidError('A devolução exige o cliente identificado', 'CLIENTE_OBRIGATORIO');
  const escolhidas = [...new Set((chaves || []).map((c) => digitos(c)).filter(chaveValida))];
  // referência avulsa por peça (a última vale se vier repetida)
  const avulsaDe = new Map();
  for (const a of Array.isArray(avulsas) ? avulsas : []) {
    const cod = parseInt(a?.productCode, 10);
    const ch = digitos(a?.chave);
    if (!cod || !chaveValida(ch)) continue;
    avulsaDe.set(cod, { chave: ch, valorUnit: r2(num(a.valorUnit)) });
  }
  if (!escolhidas.length && !avulsaDe.size) throw new DevolucaoRfidError('Escolha ao menos uma nota de venda do cliente para referenciar', 'SEM_NOTA');
  const pedidos = new Map();
  for (const it of itens || []) {
    const cod = parseInt(it.productCode, 10);
    const q = Number(it.quantidade);
    if (!cod || !(q > 0)) continue;
    pedidos.set(cod, (pedidos.get(cod) || 0) + q);
  }
  if (pedidos.size === 0) throw new DevolucaoRfidError('Nenhuma peça na devolução', 'SEM_ITENS');
  for (const cod of [...avulsaDe.keys()]) if (!pedidos.has(cod)) avulsaDe.delete(cod);
  const chavesAvulsas = [...new Set([...avulsaDe.values()].map((a) => a.chave))].filter((c) => !escolhidas.includes(c));

  const [emit, cli, devolvido] = await Promise.all([
    buscarEmitente(emp),
    buscarClienteFiscal(cliente),
    jaDevolvidoPorLinha([...escolhidas, ...chavesAvulsas], { ignorarVenda }),
  ]);
  if (!cli) throw new DevolucaoRfidError(`Cliente ${cliente} não encontrado no TOTVS`, 'CLIENTE_NAO_ENCONTRADO', 404);
  const docCliente = digitos(cli.cnpj || cli.cpf);
  const notas = [];
  for (const chave of escolhidas) {
    const n = await notaInterpretada(chave);
    if (n.emitCnpj !== digitos(emit.cnpj)) {
      throw new DevolucaoRfidError(`A nota ${n.numero}/${n.serie} foi emitida por outra empresa (CNPJ ${n.emitCnpj}): a devolução só referencia notas da empresa ${emp}`, 'NOTA_DE_OUTRA_EMPRESA');
    }
    if (n.destDoc && docCliente && n.destDoc !== docCliente) {
      throw new DevolucaoRfidError(`A nota ${n.numero}/${n.serie} é de outro cliente (documento ${n.destDoc})`, 'NOTA_DE_OUTRO_CLIENTE');
    }
    notas.push(n);
  }
  const avisos = [];
  // notas avulsas: qualquer nota de venda da empresa (outro período, outro cliente)
  const notasAvulsas = new Map(); // chave → nota
  for (const chave of chavesAvulsas) {
    const n = await notaInterpretada(chave);
    if (n.emitCnpj !== digitos(emit.cnpj)) {
      throw new DevolucaoRfidError(`A nota ${n.numero}/${n.serie} foi emitida por outra empresa (CNPJ ${n.emitCnpj}): a devolução só referencia notas da empresa ${emp}`, 'NOTA_DE_OUTRA_EMPRESA');
    }
    if (n.destDoc && docCliente && n.destDoc !== docCliente) avisos.push(`A nota ${n.numero}/${n.serie} (referência avulsa) é de outro cliente (documento ${n.destDoc}).`);
    notasAvulsas.set(chave, n);
  }
  for (const [cod, a] of avulsaDe) if (escolhidas.includes(a.chave)) a.nota = notas.find((n) => n.chave === a.chave);
  for (const a of avulsaDe.values()) if (!a.nota) a.nota = notasAvulsas.get(a.chave);

  // Devoluções que o cliente já fez pelo TOTVS (notas de entrada dele nesta empresa
  // desde a nota mais antiga escolhida): descontam das peças das notas, começando
  // pela compra mais antiga — para a mesma peça não voltar duas vezes.
  const maisAntiga = notas.map((n) => n.data).sort()[0];
  const devTotvs = await devolvidoNoTotvs(cliente, emp, maisAntiga).catch((e) => {
    avisos.push(`O TOTVS não respondeu (${e.message}): não conferi as devoluções antigas do cliente.`);
    return new Map();
  });
  const consumidoTotvs = new Map(); // `${chave}|${nItem}` → peças já devolvidas pelo TOTVS
  for (const [cod, qtdTotvs] of devTotvs) {
    if (!pedidos.has(cod)) continue;
    let resta = qtdTotvs;
    const linhasDoProduto = [...notas, ...notasAvulsas.values()]
      .flatMap((n) => n.linhas.filter((l) => l.productCode === cod).map((l) => ({ n, l })))
      .sort((a, b) => String(a.n.data).localeCompare(String(b.n.data)) || a.n.numero - b.n.numero || a.l.nItem - b.l.nItem);
    for (const { n, l } of linhasDoProduto) {
      if (resta <= 0) break;
      const k = `${n.chave}|${l.nItem}`;
      const livre = l.quantidade - Math.min(devolvido.get(k) || 0, l.quantidade);
      const usa = Math.min(resta, livre);
      if (usa > 0) consumidoTotvs.set(k, usa);
      resta -= usa;
    }
  }
  const alocacao = [];
  const saida = [];
  const usadas = new Set();
  for (const [cod, qtd] of pedidos) {
    let naNota = 0;
    let jaDev = 0;
    let falta = qtd;
    const partes = [];
    let nome = null;
    for (const n of notas) {
      for (const l of n.linhas) {
        if (l.productCode !== cod) continue;
        nome = nome || l.nome;
        const k = `${n.chave}|${l.nItem}`;
        const dev = Math.min((devolvido.get(k) || 0) + (consumidoTotvs.get(k) || 0), l.quantidade);
        naNota += l.quantidade;
        jaDev += dev;
        const livre = l.quantidade - dev;
        if (falta <= 0 || livre <= 0) continue;
        if (!CFOP_DEVOLUCAO[l.cfop]) {
          throw new DevolucaoRfidError(`A peça ${cod} está na nota ${n.numero} com o CFOP ${l.cfop}, que não tem regra de devolução`, 'CFOP_SEM_REGRA');
        }
        const q = Math.min(falta, livre);
        falta -= q;
        partes.push({ chave: n.chave, numero: n.numero, serie: n.serie, nItem: l.nItem, quantidade: q, valorUnit: l.valorUnit });
      }
    }
    const disponivel = naNota - jaDev;
    const base = { productCode: cod, nome, quantidade: qtd, naNota, jaDevolvido: jaDev, disponivel, valorUnit: null, total: 0, notas: [], avulsa: null };
    // Não coube nas escolhidas e o operador apontou outra nota só para esta peça
    const av = falta > 0 ? avulsaDe.get(cod) : null;
    if (av) {
      const n = av.nota;
      let erroAv = null;
      // 1º a própria peça na outra nota (valor pago), se tiver saldo
      for (const l of n.linhas) {
        if (falta <= 0 || l.productCode !== cod || !CFOP_DEVOLUCAO[l.cfop]) continue;
        const k = `${n.chave}|${l.nItem}`;
        const ocupado = partes.filter((p) => p.chave === n.chave && p.nItem === l.nItem).reduce((s, p) => s + p.quantidade, 0);
        const livre = l.quantidade - Math.min((devolvido.get(k) || 0) + (consumidoTotvs.get(k) || 0) + ocupado, l.quantidade);
        if (livre <= 0) continue;
        nome = nome || l.nome;
        const q = Math.min(falta, livre);
        falta -= q;
        partes.push({ chave: n.chave, numero: n.numero, serie: n.serie, nItem: l.nItem, quantidade: q, valorUnit: l.valorUnit, avulsaNota: true });
      }
      // 2º o resto entra avulso: referencia a nota escolhida, com a tributação de
      // uma linha das notas do PRÓPRIO cliente (mesmo cenário fiscal da devolução);
      // sem nota do cliente, uma linha da nota escolhida
      if (falta > 0) {
        if (!(av.valorUnit > 0)) erroAv = 'Peça sem preço na tabela do cliente: não dá para referenciar avulsa';
        else {
          let produto;
          try {
            produto = await buscarProdutoFiscal(cod, emp);
          } catch (e) {
            erroAv = `Não achei o produto ${cod} no TOTVS (${e.message})`;
          }
          const modelo = produto ? linhaModelo([notas, [n]], produto.ncm) : null;
          if (produto && !modelo) erroAv = `A nota ${n.numero}/${n.serie} não tem item com tributação que sirva de modelo para a devolução`;
          if (modelo && modelo.nota === n && !notas.includes(n) && n.destDoc && docCliente && n.destDoc !== docCliente) {
            const aviso = `A tributação da peça avulsa veio da nota ${n.numero}, de outro cliente: confira se o CFOP serve para este cliente.`;
            if (!avisos.includes(aviso)) avisos.push(aviso);
          }
          if (produto && modelo) {
            nome = nome || produto.nome;
            partes.push({
              chave: n.chave,
              numero: n.numero,
              serie: n.serie,
              nItem: modelo.linha.nItem,
              modeloChave: modelo.nota.chave,
              quantidade: falta,
              valorUnit: av.valorUnit,
              avulsaNota: true,
              avulsa: true,
              produto: { nome: produto.nome, sku: produto.sku, ncm: produto.ncm, cest: produto.cest, origem: produto.origem },
            });
            falta = 0;
          }
        }
      }
      base.avulsa = { chave: n.chave, numero: n.numero, serie: n.serie, erro: erroAv };
      if (erroAv) {
        saida.push({ ...base, nome, ok: false, motivo: 'avulsa', mensagem: erroAv });
        continue;
      }
    }
    if (naNota === 0 && falta > 0) {
      saida.push({ ...base, ok: false, motivo: 'fora_das_notas', mensagem: 'Esta peça não está em nenhuma das notas escolhidas' });
      continue;
    }
    if (falta > 0) {
      saida.push({
        ...base,
        ok: false,
        motivo: disponivel === 0 ? 'ja_devolvida' : 'quantidade',
        mensagem:
          disponivel === 0
            ? `As notas escolhidas têm ${naNota} desta peça e ${jaDev === 1 ? 'ela já foi devolvida' : `as ${jaDev} já foram devolvidas`}`
            : `As notas escolhidas têm ${naNota} desta peça${jaDev ? ` (${jaDev} já devolvida${jaDev > 1 ? 's' : ''})` : ''}: só dá para devolver ${disponivel}`,
      });
      continue;
    }
    const total = r2(partes.reduce((s, p) => s + r2(p.quantidade * p.valorUnit), 0));
    for (const p of partes) {
      alocacao.push({
        chave: p.chave,
        nItem: p.nItem,
        productCode: cod,
        quantidade: p.quantidade,
        ...(p.avulsa ? { avulsa: true, modeloChave: p.modeloChave, valorUnit: p.valorUnit, produto: p.produto } : {}),
      });
      usadas.add(p.chave);
    }
    saida.push({
      ...base,
      nome,
      ok: true,
      motivo: null,
      mensagem: null,
      valorUnit: r2(total / qtd),
      total,
      notas: partes.map((p) => ({ chave: p.chave, numero: p.numero, serie: p.serie, quantidade: p.quantidade, valorUnit: p.valorUnit, avulsaNota: !!p.avulsaNota, avulsa: !!p.avulsa })),
    });
  }
  const avulsasUsadas = [...notasAvulsas.values()].filter((n) => usadas.has(n.chave));
  if (saida.some((i) => i.ok && i.notas.some((p) => p.avulsa))) {
    avisos.push('Peça avulsa: entra com o valor da tabela do cliente e a tributação de um item da nota referenciada.');
  }
  const semUso = notas.filter((n) => !usadas.has(n.chave));
  if (semUso.length) avisos.push(`Nota${semUso.length > 1 ? 's' : ''} ${semUso.map((n) => n.numero).join(', ')} escolhida${semUso.length > 1 ? 's' : ''} sem nenhuma peça lida: não ${semUso.length > 1 ? 'serão referenciadas' : 'será referenciada'}.`);
  const ok = saida.every((i) => i.ok);
  return {
    ok,
    itens: saida,
    alocacao: ok ? alocacao : [],
    chavesUsadas: [...notas, ...avulsasUsadas].filter((n) => usadas.has(n.chave)).map((n) => n.chave),
    notas: [
      ...notas.map((n) => ({ chave: n.chave, origem: n.origem, numero: n.numero, serie: n.serie, modelo: n.modelo, data: n.data, usada: usadas.has(n.chave) })),
      ...avulsasUsadas.map((n) => ({ chave: n.chave, origem: n.origem, numero: n.numero, serie: n.serie, modelo: n.modelo, data: n.data, usada: true, avulsa: true })),
    ],
    totais: { pecas: saida.reduce((s, i) => s + (i.ok ? i.quantidade : 0), 0), valor: r2(saida.reduce((s, i) => s + i.total, 0)) },
    cliente: { code: cliente, nome: cli.nome, doc: docCliente || null },
    avisos,
  };
}

// ─── Montagem da NF-e de devolução ───────────────────────────────────────────
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
const fmtQtd = (q) => (Number.isInteger(q) ? String(q) : String(Number(q.toFixed(4))));

/**
 * Linha que serve de modelo de tributação para uma peça avulsa: grupos de notas
 * em ordem de preferência; dentro do grupo, o mesmo NCM primeiro. { nota, linha }
 */
function linhaModelo(grupos, ncm = null) {
  for (const grupo of grupos) {
    const boas = grupo.flatMap((nota) =>
      nota.linhas.filter((l) => CFOP_DEVOLUCAO[l.cfop] && Object.keys(l.det?.imposto?.ICMS || {})[0] === 'ICMS00' && l.quantidade > 0).map((linha) => ({ nota, linha })),
    );
    if (boas.length) return boas.find((b) => ncm && String(b.linha.det.prod.NCM) === String(ncm)) || boas[0];
  }
  return null;
}

/**
 * Item de venda "de mentira" para a peça avulsa: a linha modelo da nota com o
 * produto, a quantidade e o valor da peça; os impostos recalculados com as
 * alíquotas da linha. Depois passa pelo itemDevolvido como qualquer outro.
 */
export function detAvulso(detModelo, a) {
  const det = JSON.parse(JSON.stringify(detModelo));
  const p = det.prod;
  const pr = a.produto || {};
  const q = num(a.quantidade);
  const vUn = r2(a.valorUnit);
  const vProd = r2(q * vUn);
  const ean = /^\d{8,14}$/.test(String(pr.sku || '')) ? String(pr.sku) : 'SEM GTIN';
  p.cProd = String(a.productCode);
  p.cEAN = ean;
  p.xProd = String(pr.nome || `PRODUTO ${a.productCode}`).slice(0, 120);
  if (pr.ncm) p.NCM = pr.ncm;
  if ('CEST' in p) {
    if (pr.cest) p.CEST = pr.cest;
    else delete p.CEST;
  }
  // mesmas casas decimais da linha modelo (1.0000 / 110.0000000000)
  const como = (modelo, v, min) => Number(v).toFixed(Math.max(min, (String(modelo ?? '').split('.')[1] || '').length));
  p.qCom = como(p.qCom, q, 0);
  p.vUnCom = como(p.vUnCom, vUn, 2);
  p.vProd = f2(vProd);
  if ('cEANTrib' in p) p.cEANTrib = ean;
  if ('qTrib' in p) p.qTrib = como(p.qTrib, q, 0);
  if ('vUnTrib' in p) p.vUnTrib = como(p.vUnTrib, vUn, 2);
  for (const campo of ['vDesc', 'vFrete', 'vSeg', 'vOutro', 'xPed', 'nItemPed', 'nFCI']) delete p[campo];
  const imp = det.imposto;
  const icms = imp.ICMS.ICMS00;
  // a base de PIS/COFINS da linha modelo era sem o ICMS? (padrão das notas da Crosby)
  const semIcms = ['PIS', 'COFINS'].some((g) => {
    const x = imp[g]?.[`${g}Aliq`];
    return x && Math.abs(num(x.vBC) - (num(icms.vBC) - num(icms.vICMS))) <= 0.02 && num(icms.vICMS) > 0;
  });
  if (pr.origem != null && /^\d$/.test(String(pr.origem))) icms.orig = String(pr.origem);
  const vICMS = r2((vProd * num(icms.pICMS)) / 100);
  icms.vBC = f2(vProd);
  icms.vICMS = f2(vICMS);
  for (const [g, pCampo, vCampo] of [
    ['PIS', 'pPIS', 'vPIS'],
    ['COFINS', 'pCOFINS', 'vCOFINS'],
  ]) {
    const x = imp[g]?.[`${g}Aliq`];
    if (!x) continue;
    const base = semIcms ? r2(vProd - vICMS) : vProd;
    x.vBC = f2(base);
    x[vCampo] = f2((base * num(x[pCampo])) / 100);
  }
  return det;
}

/** O item da NF-e de devolução de uma linha da alocação (da nota ou avulso). */
function itemDaAlocacao(linha, a) {
  return itemDevolvido(a.avulsa ? detAvulso(linha.det, a) : linha.det, Number(a.quantidade));
}

/**
 * Item da devolução a partir da linha da nota de venda: `q` peças das `Q` da linha.
 * Regra do TOTVS (conferida item a item em 40 devoluções reais da empresa 99):
 *   base = valor da MERCADORIA devolvida (vProd − vDesc), sem o frete da venda;
 *   ICMS = base × alíquota da nota; PIS/COFINS sobre (base − ICMS), como na venda;
 *   DIFAL e IBS/CBS sobre a mesma base, com as alíquotas da nota.
 * Devolve { det, soma, liq } — soma traz os valores que entram nos totais da nota.
 */
export function itemDevolvido(detOriginal, q) {
  const det = JSON.parse(JSON.stringify(detOriginal));
  const p = det.prod;
  const Q = num(p.qCom);
  if (!(q > 0) || q > Q + 1e-9) throw new DevolucaoRfidError(`Quantidade ${q} maior que a da nota (${Q}) na peça ${p.cProd}`, 'QUANTIDADE');
  const cfop = String(p.CFOP);
  if (!CFOP_DEVOLUCAO[cfop]) throw new DevolucaoRfidError(`CFOP ${cfop} sem regra de devolução (peça ${p.cProd})`, 'CFOP_SEM_REGRA');
  const vProdO = num(p.vProd);
  const vDescO = num(p.vDesc);
  const extrasO = num(p.vFrete) + num(p.vSeg) + num(p.vOutro);
  const inteiro = Math.abs(q - Q) < 1e-9;
  const vProd = inteiro ? vProdO : r2(q * num(p.vUnCom));
  const vDesc = inteiro ? vDescO : r2((vDescO * q) / Q);
  const liq = r2(vProd - vDesc); // mercadoria devolvida = base de tudo
  const perto = (x, y) => Math.abs(num(x) - num(y)) <= 0.02;

  p.CFOP = CFOP_DEVOLUCAO[cfop];
  p.qCom = inteiro ? p.qCom : fmtQtd(q);
  p.vProd = f2(vProd);
  if (p.qTrib != null && !inteiro) p.qTrib = fmtQtd(r2((num(p.qTrib) * q) / Q));
  if (vDesc > 0) p.vDesc = f2(vDesc);
  else delete p.vDesc;
  for (const campo of ['vFrete', 'vSeg', 'vOutro', 'xPed', 'nItemPed', 'nFCI']) delete p[campo];

  const imp = det.imposto;
  delete imp.vTotTrib;
  const soma = { vProd, vDesc, vBC: 0, vICMS: 0, vPIS: 0, vCOFINS: 0, vICMSUFRemet: 0, vFCPUFDest: 0, vBCIBSCBS: 0, vIBSUF: 0, vIBSMun: 0, vCBS: 0, pICMS: null, cstIcms: null, temIbs: false };

  // ICMS
  const grupoIcms = Object.keys(imp.ICMS || {})[0];
  const icms = grupoIcms ? imp.ICMS[grupoIcms] : null;
  if (!icms || grupoIcms !== 'ICMS00') {
    throw new DevolucaoRfidError(`A peça ${p.cProd} saiu na nota de venda com ${grupoIcms || 'ICMS desconhecido'}: esse tipo de tributação ainda não tem gabarito de devolução`, 'ICMS_SEM_REGRA');
  }
  const bcIcmsO = num(icms.vBC);
  const vIcmsO = num(icms.vICMS);
  const vBC = liq;
  const vICMS = r2((vBC * num(icms.pICMS)) / 100);
  icms.vBC = f2(vBC);
  icms.vICMS = f2(vICMS);
  soma.vBC = vBC;
  soma.vICMS = vICMS;
  soma.pICMS = num(icms.pICMS);
  soma.cstIcms = `${String(icms.orig ?? '0')}${String(icms.CST)}`;

  // IPI: não tributado na venda (53) → 03 na entrada
  if (imp.IPI) {
    if (!imp.IPI.IPINT) throw new DevolucaoRfidError(`A peça ${p.cProd} saiu com IPI tributado: sem gabarito de devolução`, 'IPI_SEM_REGRA');
    imp.IPI.IPINT.CST = '03';
  }

  // PIS / COFINS: alíquota na venda → "outras operações" CST 50. A base segue a
  // da venda: sem o ICMS (regra das notas da Crosby) ou cheia.
  const basesVenda = [bcIcmsO, r2(vProdO - vDescO), r2(vProdO - vDescO + extrasO)];
  for (const [grupo, aliq, outr, pCampo, vCampo] of [
    ['PIS', 'PISAliq', 'PISOutr', 'pPIS', 'vPIS'],
    ['COFINS', 'COFINSAliq', 'COFINSOutr', 'pCOFINS', 'vCOFINS'],
  ]) {
    const g = imp[grupo]?.[aliq];
    if (!g) throw new DevolucaoRfidError(`A peça ${p.cProd} saiu com ${grupo} fora do padrão (${Object.keys(imp[grupo] || {}).join(',') || 'sem grupo'}): sem gabarito de devolução`, 'PISCOFINS_SEM_REGRA');
    const semIcms = basesVenda.some((x) => perto(g.vBC, x - vIcmsO));
    const cheia = !semIcms && basesVenda.some((x) => perto(g.vBC, x));
    const base = semIcms ? r2(vBC - vICMS) : cheia ? vBC : r2((num(g.vBC) * q) / Q);
    const valor = r2((base * num(g[pCampo])) / 100);
    imp[grupo] = { [outr]: { ...g, CST: '50', vBC: f2(base), [vCampo]: f2(valor) } };
    soma[vCampo] = valor;
  }

  // DIFAL (venda a não contribuinte de outro estado): o valor volta em vICMSUFRemet
  if (imp.ICMSUFDest) {
    const d = imp.ICMSUFDest;
    const vDest = r2((((vBC * (num(d.pICMSUFDest) - num(d.pICMSInter))) / 100) * num(d.pICMSInterPart || 100)) / 100);
    const vFcp = r2((vBC * num(d.pFCPUFDest)) / 100);
    d.vBCUFDest = f2(vBC);
    if (d.vBCFCPUFDest != null) d.vBCFCPUFDest = f2(vBC);
    d.vFCPUFDest = f2(vFcp);
    d.vICMSUFDest = '0.00';
    d.vICMSUFRemet = f2(vDest);
    soma.vICMSUFRemet = vDest;
    soma.vFCPUFDest = vFcp;
  }

  // IBS / CBS: mesmas alíquotas da venda sobre a base da devolução. Nota de venda
  // antiga (antes de 2026) não tem o grupo: a devolução de hoje leva mesmo assim,
  // como o TOTVS faz (NF 12323): CST 000, cClassTrib 000001, 0,10% / 0% / 0,90%.
  if (!imp.IBSCBS) {
    imp.IBSCBS = {
      CST: '000',
      cClassTrib: '000001',
      gIBSCBS: { vBC: '0.00', gIBSUF: { pIBSUF: '0.1000', vIBSUF: '0.00' }, gIBSMun: { pIBSMun: '0.0000', vIBSMun: '0.00' }, vIBS: '0.00', gCBS: { pCBS: '0.9000', vCBS: '0.00' } },
    };
  }
  const g = imp.IBSCBS.gIBSCBS;
  if (g) {
    const vIBSUF = r2((vBC * num(g.gIBSUF?.pIBSUF)) / 100);
    const vIBSMun = r2((vBC * num(g.gIBSMun?.pIBSMun)) / 100);
    const vCBS = r2((vBC * num(g.gCBS?.pCBS)) / 100);
    g.vBC = f2(vBC);
    if (g.gIBSUF) g.gIBSUF.vIBSUF = f2(vIBSUF);
    if (g.gIBSMun) g.gIBSMun.vIBSMun = f2(vIBSMun);
    if (g.vIBS != null) g.vIBS = f2(vIBSUF + vIBSMun);
    if (g.gCBS) g.gCBS.vCBS = f2(vCBS);
    soma.temIbs = true;
    soma.vBCIBSCBS = vBC;
    soma.vIBSUF = vIBSUF;
    soma.vIBSMun = vIBSMun;
    soma.vCBS = vCBS;
    // vItem vem depois do imposto (ordem do schema)
    delete det.vItem;
    det.vItem = f2(liq);
  } else if (det.vItem != null) {
    det.vItem = f2(liq);
  }
  delete det.infAdProd;
  return { det, soma, liq };
}

/**
 * Monta (sem assinar) a NF-e de devolução de uma transação da Devolução RFID.
 * Mesmo contrato do montarXml do pdvFiscal: { xml, modelo, serie, numero, chave, dhEmi, totais }.
 */
export async function montarXmlDevolucaoRfid({ venda, cfg, emit, cliente, numero }) {
  const plano = venda.pedido_info?.devolucaoRfid;
  if (!plano?.alocacao?.length) throw new DevolucaoRfidError(`A transação ${venda.id} não tem as notas de venda da devolução`, 'SEM_PLANO');
  const serie = cfg.serie_nfe;
  const tpAmb = Number(cfg.ambiente);
  // referência avulsa (nota de outro período/cliente, 18/11/2026) vai por último
  const avulsasPlano = new Set((plano.notas || []).filter((n) => n.avulsa).map((n) => String(n.chave)));
  const chaves = [...new Set(plano.alocacao.map((a) => String(a.chave)))].sort((a, b) => Number(avulsasPlano.has(a)) - Number(avulsasPlano.has(b)));
  const notas = new Map();
  for (const chave of new Set([...chaves, ...plano.alocacao.map((a) => a.modeloChave).filter(Boolean).map(String)])) notas.set(chave, await notaInterpretada(chave));
  const primeira = notas.get(chaves[0]);
  if (primeira.emitCnpj !== digitos(emit.cnpj)) throw new DevolucaoRfidError('As notas de venda são de outra empresa', 'NOTA_DE_OUTRA_EMPRESA');

  // itens: uma linha por (nota, linha da nota), na ordem das notas
  const dets = [];
  const tot = { vProd: 0, vDesc: 0, vBC: 0, vICMS: 0, vPIS: 0, vCOFINS: 0, vICMSUFRemet: 0, vFCPUFDest: 0, vBCIBSCBS: 0, vIBSUF: 0, vIBSMun: 0, vCBS: 0, vNF: 0 };
  const aliquotas = new Set();
  const csts = new Set();
  let temIbs = false;
  let temDifal = false;
  const valorPorChave = new Map(); // valor devolvido por nota referenciada
  for (const a of plano.alocacao) {
    const nota = notas.get(String(a.modeloChave || a.chave));
    const linha = nota.linhas.find((l) => l.nItem === Number(a.nItem));
    if (!linha) throw new DevolucaoRfidError(`A linha ${a.nItem} não existe mais na nota ${nota.numero}`, 'LINHA_NAO_ENCONTRADA');
    const { det, soma, liq } = itemDaAlocacao(linha, a);
    det['@nItem'] = String(dets.length + 1);
    dets.push(det);
    for (const k of ['vProd', 'vDesc', 'vBC', 'vICMS', 'vPIS', 'vCOFINS', 'vICMSUFRemet', 'vFCPUFDest', 'vBCIBSCBS', 'vIBSUF', 'vIBSMun', 'vCBS']) tot[k] = r2(tot[k] + soma[k]);
    tot.vNF = r2(tot.vNF + liq);
    valorPorChave.set(String(a.chave), (valorPorChave.get(String(a.chave)) || 0) + liq);
    aliquotas.add(soma.pICMS);
    csts.add(soma.cstIcms);
    temIbs = temIbs || soma.temIbs;
    temDifal = temDifal || !!det.imposto.ICMSUFDest;
  }

  // A SEFAZ rejeita a devolução com mais de uma NFref (255 "NF-e possui mais de
  // uma NF referenciada", 19/11/2026: toda devolução com 2+ notas caiu nela).
  // Vai uma só; todas as notas seguem no infCpl ("DEVOLUCAO REFERENTE A NF. ...").
  // A referenciada precisa ter total >= o da devolução (545 "valor total superior
  // a NF-e devolvida"): entre as que cobrem, a do cliente com mais valor
  // devolvido; se nenhuma cobre, a de maior total.
  const totalDaNota = (c) => num(notas.get(c)?.inf?.total?.ICMSTot?.vNF);
  const candidatas = chaves.filter((c) => !avulsasPlano.has(c));
  const universo = candidatas.length ? candidatas : chaves;
  const cobrem = universo.filter((c) => totalDaNota(c) >= tot.vNF);
  const refPrincipal = cobrem.length
    ? cobrem.reduce((m, c) => ((valorPorChave.get(c) || 0) > (valorPorChave.get(m) || 0) ? c : m))
    : [...universo, ...chaves].reduce((m, c) => (totalDaNota(c) > totalDaNota(m) ? c : m));

  const ideO = primeira.inf.ide;
  const dhEmi = agoraBrasil();
  const cNF = String(crypto.randomInt(0, 99999999)).padStart(8, '0');
  const aamm = dhEmi.slice(2, 4) + dhEmi.slice(5, 7);
  const base43 = `${String(ideO.cUF)}${aamm}${digitos(emit.cnpj)}55${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}1${cNF}`;
  const cDV = dvChave(base43);
  const chave = `${base43}${cDV}`;

  // destinatário: o da nota de venda (NF-e); se as notas forem NFC-e, o cadastro do cliente
  // (nunca de uma nota de outro cliente referenciada avulsa)
  const docCli = digitos(cliente?.cnpj || cliente?.cpf || venda.cliente_cpf_cnpj);
  const comDest = chaves
    .map((c) => notas.get(c))
    .find((n) => n.modelo === 55 && n.inf.dest?.enderDest && (!avulsasPlano.has(n.chave) || (docCli && n.destDoc === docCli)));
  let dest;
  if (comDest) {
    dest = JSON.parse(JSON.stringify(comDest.inf.dest));
  } else {
    if (!cliente?.endereco?.cMun) throw new DevolucaoRfidError(`Cliente ${cliente?.nome || venda.cliente_code} sem endereço no TOTVS: a NF-e de devolução exige o endereço do destinatário`, 'DEST_NO_ADDRESS');
    const ender = Object.fromEntries(Object.entries(cliente.endereco).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    dest = {
      ...(cliente.cnpj ? { CNPJ: cliente.cnpj } : { CPF: cliente.cpf }),
      xNome: cliente.nome,
      enderDest: ender,
      indIEDest: cliente.cnpj && cliente.ie ? '1' : '9',
      ...(cliente.cnpj && cliente.ie ? { IE: cliente.ie } : {}),
    };
  }
  if (tpAmb === 2) dest.xNome = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
  const destUf = dest.enderDest?.UF || emit.uf;

  const ide = {
    cUF: ideO.cUF,
    cNF,
    natOp: NATOP_DEVOLUCAO,
    mod: '55',
    serie: String(serie),
    nNF: String(numero),
    dhEmi,
    dhSaiEnt: dhEmi,
    tpNF: '0',
    idDest: destUf === emit.uf ? '1' : '2',
    cMunFG: ideO.cMunFG,
    tpImp: '1',
    tpEmis: '1',
    cDV: String(cDV),
    tpAmb: String(tpAmb),
    finNFe: '4',
    indFinal: String(comDest ? comDest.inf.ide.indFinal : ideO.indFinal ?? '1'),
    indPres: '0',
    procEmi: '0',
    verProc: VERSAO_APLICACAO,
    NFref: { refNFe: refPrincipal },
  };

  const ICMSTot = {
    vBC: f2(tot.vBC),
    vICMS: f2(tot.vICMS),
    vICMSDeson: '0.00',
    vFCPUFDest: f2(tot.vFCPUFDest),
    vICMSUFDest: '0.00',
    vICMSUFRemet: f2(tot.vICMSUFRemet),
    vFCP: '0.00',
    vBCST: '0.00',
    vST: '0.00',
    vFCPST: '0.00',
    vFCPSTRet: '0.00',
    vProd: f2(tot.vProd),
    vFrete: '0.00',
    vSeg: '0.00',
    vDesc: f2(tot.vDesc),
    vII: '0.00',
    vIPI: '0.00',
    vIPIDevol: '0.00',
    vPIS: f2(tot.vPIS),
    vCOFINS: f2(tot.vCOFINS),
    vOutro: '0.00',
    vNF: f2(tot.vNF),
  };
  if (!temDifal) {
    // sem DIFAL as notas do TOTVS trazem os três campos zerados do mesmo jeito
    ICMSTot.vFCPUFDest = '0.00';
    ICMSTot.vICMSUFRemet = '0.00';
  }
  const total = { ICMSTot };
  if (temIbs) {
    total.IBSCBSTot = {
      vBCIBSCBS: f2(tot.vBCIBSCBS),
      gIBS: {
        gIBSUF: { vDif: '0.00', vDevTrib: '0.00', vIBSUF: f2(tot.vIBSUF) },
        gIBSMun: { vDif: '0.00', vDevTrib: '0.00', vIBSMun: f2(tot.vIBSMun) },
        vIBS: f2(tot.vIBSUF + tot.vIBSMun),
        vCredPres: '0.00',
        vCredPresCondSus: '0.00',
      },
      gCBS: { vDif: '0.00', vDevTrib: '0.00', vCBS: f2(tot.vCBS), vCredPres: '0.00', vCredPresCondSus: '0.00' },
    };
    total.vNFTot = f2(tot.vNF);
  }

  const numeros = chaves.map((c) => notas.get(c).numero);
  const resumoIcms =
    aliquotas.size === 1 && csts.size === 1
      ? `CST ${[...csts][0]} ICMS ${brNum([...aliquotas][0])} ${brNum(tot.vBC)} = ${brNum(tot.vICMS)}`
      : `ICMS BASE ${brNum(tot.vBC)} = ${brNum(tot.vICMS)}`;
  const partes = [
    `${resumoIcms} DEVOLUCAO REFERENTE A NF. ${numeros.join(' / ')}`,
    `DEVOLUCAO HEADCOACH ${venda.id}`,
    plano.solicitacaoId ? `SOLICITACAO DEV-${plano.solicitacaoId}` : null,
  ].filter(Boolean);

  // infNFe na ordem do schema
  const inf = {
    '@Id': `NFe${chave}`,
    '@versao': primeira.inf['@versao'] || '4.00',
    ide,
    emit: JSON.parse(JSON.stringify(primeira.inf.emit)),
    dest,
    det: dets.length === 1 ? dets[0] : dets,
    total,
    transp: { modFrete: '9', vol: { qVol: '0', pesoL: '0.000', pesoB: '0.000' } },
    pag: { detPag: { tPag: '90', vPag: '0.00' } },
    infAdic: { infCpl: partes.join(' - ').slice(0, 5000) },
  };
  const doc = { NFe: { ...Object.fromEntries(Object.entries(primeira.doc.NFe).filter(([k]) => k.startsWith('@'))), infNFe: inf } };
  const xml = await json2xml(doc);
  return { xml, modelo: 55, serie, numero, chave, tpAmb, dhEmi, totais: tot };
}

// ─── Registro da transação ───────────────────────────────────────────────────
/**
 * Confere de novo (o servidor não confia na tela) e monta o que vai para
 * pdv_vendas / pdv_venda_itens. Não grava nada: quem grava é a rota, que
 * também cuida do caixa, das etiquetas e da emissão.
 */
export async function prepararTransacao({ empresa, cliente, vendedor, operacao, itens, chaves, avulsas = [], solicitacaoId = null }) {
  const op = parseInt(operacao, 10);
  if (!OPERACOES_DEVOLUCAO[op]) throw new DevolucaoRfidError('Escolha a operação da devolução (7243, 7244 ou 7245)', 'OPERACAO_OBRIGATORIA');
  if (!vendedor?.code) throw new DevolucaoRfidError('Informe o vendedor', 'VENDEDOR_OBRIGATORIO');
  const conf = await conferirDevolucao({ empresa, clienteCode: cliente?.code, itens, chaves, avulsas });
  if (!conf.ok) {
    const ruins = conf.itens.filter((i) => !i.ok);
    throw new DevolucaoRfidError(`Devolução recusada — ${ruins.map((i) => `peça ${i.productCode}: ${i.mensagem}`).join('; ')}`, 'PECA_FORA_DAS_NOTAS', 422, { itens: conf.itens, avisos: conf.avisos });
  }
  // valores exatos como vão sair na nota (para a transação bater com a NF-e no centavo)
  const notas = new Map();
  for (const chave of new Set([...conf.chavesUsadas, ...conf.alocacao.map((a) => a.modeloChave).filter(Boolean)])) notas.set(chave, await notaInterpretada(chave));
  const porProduto = new Map();
  let vNF = 0;
  let vProdTot = 0;
  let vDescTot = 0;
  for (const a of conf.alocacao) {
    const linha = notas.get(a.modeloChave || a.chave).linhas.find((l) => l.nItem === a.nItem);
    const { det, soma, liq } = itemDaAlocacao(linha, a);
    vNF = r2(vNF + liq);
    vProdTot = r2(vProdTot + soma.vProd);
    vDescTot = r2(vDescTot + soma.vDesc);
    const p = porProduto.get(a.productCode) || { quantidade: 0, vProd: 0, vDesc: 0, nome: det.prod.xProd, ncm: det.prod.NCM, cest: det.prod.CEST || null, origem: String(det.imposto.ICMS.ICMS00.orig ?? '0'), unidade: det.prod.uCom || 'UN', sku: /^\d{8,14}$/.test(String(det.prod.cEAN)) ? String(det.prod.cEAN) : null, cfop: Number(det.prod.CFOP) };
    p.quantidade += a.quantidade;
    p.vProd = r2(p.vProd + soma.vProd);
    p.vDesc = r2(p.vDesc + soma.vDesc);
    porProduto.set(a.productCode, p);
  }
  const epcsDe = new Map();
  for (const it of itens || []) {
    const cod = parseInt(it.productCode, 10);
    if (!cod) continue;
    epcsDe.set(cod, [...(epcsDe.get(cod) || []), ...(Array.isArray(it.epcs) ? it.epcs : [])]);
  }
  let seq = 1;
  const linhasItens = [...porProduto.entries()].map(([cod, p]) => ({
    seq: seq++,
    product_code: cod,
    sku: p.sku,
    nome: String(p.nome || `Produto ${cod}`).slice(0, 200),
    referencia: null,
    ncm: p.ncm || null,
    cest: p.cest,
    origem: p.origem,
    unidade: p.unidade,
    quantidade: p.quantidade,
    valor_unit: r2(p.vProd / p.quantidade),
    desconto_unit: r2(p.vDesc / p.quantidade),
    total: r2(p.vProd - p.vDesc),
    epcs: epcsDe.get(cod) || [],
  }));
  return {
    conferencia: conf,
    total: vNF,
    subtotal: vProdTot,
    desconto: vDescTot,
    qtd: linhasItens.reduce((s, i) => s + i.quantidade, 0),
    itens: linhasItens,
    plano: {
      operacao: op,
      operacaoNome: OPERACOES_DEVOLUCAO[op],
      solicitacaoId: solicitacaoId ? Number(solicitacaoId) : null,
      notas: conf.notas.filter((n) => n.usada).map(({ usada, ...n }) => n),
      alocacao: conf.alocacao,
    },
  };
}
