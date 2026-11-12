// =============================================================================
// PDV CROSBY — emissão fiscal direta (NFC-e modelo 65 / NF-e modelo 55)
//
// Monta o XML da nota a partir de uma venda registrada no HeadCoach, assina
// com o certificado A1 da matriz (mesma raiz de CNPJ da filial), envia à
// SEFAZ (via node-sped-nfe) e devolve o protocolo. Não passa pelo TOTVS.
//
// Regras fiscais (copiadas das regras 5102 / 1202 do TOTVS e conferidas
// contra XMLs autorizados da filial 95 em set/2026):
//   VENDA (NFCE 510/545, NFE 521/548) — CFOP 5102, tpNF 1, finNFe 1
//     ICMS  CST 00, modBC 3, alíquota interna da UF (RN 20%)
//     PIS   CST 01 0,65%  } base = valor líquido do item − ICMS
//     COFINS CST 01 3,00% }
//     IPI   (só NF-e) cEnq 999, IPINT CST 53
//     IBS/CBS CST 000, cClassTrib 000001, IBS UF 0,10%, IBS Mun 0%, CBS 0,90%
//   TROCA (1/555) — CFOP 1202 (devolução, entrada), tpNF 0, finNFe 4
//     ICMS igual; PIS/COFINS CST 50 (isento, "Outr" zerado); IPI IPINT CST 03
//     IBS/CBS igual; pagamento tPag 90 (sem pagamento)
// =============================================================================
import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import { Make, Tools, xml2json, json2xml, UF2cUF } from 'node-sped-nfe';
import supabase from '../config/supabase.js';
import { carregarCertificados } from '../config/sefazCerts.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, httpAgent, TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';

// ─── Parâmetros ──────────────────────────────────────────────────────────────
export const VERSAO_APLICACAO = 'HeadCoach-PDV-1.0';

// Alíquota interna de ICMS por UF (%). Pode ser sobrescrita em
// pdv_fiscal_config.aliq_icms. RN=20 conferido em XML autorizado (set/2026).
export const ICMS_ALIQ_UF = {
  RN: 20, PE: 20.5, PB: 20, CE: 20, AL: 20, SE: 20, BA: 20.5, PI: 22.5, MA: 23,
  SP: 18, MG: 18, RJ: 22, ES: 17, PR: 19.5, SC: 17, RS: 17, GO: 19, DF: 20,
  MT: 17, MS: 17, TO: 20, PA: 19, AM: 20, RO: 19.5, AC: 19, RR: 20, AP: 18,
};

const REGRAS = {
  venda: {
    cfop: 5102,
    natOp: 'VENDA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIROS',
    tpNF: 1,
    finNFe: 1,
    pis: { CST: '01', aliq: 0.65 },
    cofins: { CST: '01', aliq: 3.0 },
    ipiCST: '53',
  },
  devolucao: {
    cfop: 1202,
    natOp: 'DEVOLUCAO DE VENDA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TE',
    tpNF: 0,
    finNFe: 4,
    pis: { CST: '50', aliq: 0 },
    cofins: { CST: '50', aliq: 0 },
    ipiCST: '03',
  },
};

const IBSCBS = { CST: '000', cClassTrib: '000001', pIBSUF: 0.1, pIBSMun: 0, pCBS: 0.9 };

// Forma de pagamento HeadCoach → tPag da NF-e
const TPAG = {
  dinheiro: '01',
  pix: '17',
  credito: '03',
  debito: '04',
  credito_loja: '05',
  vale_troca: '05',
};

// Bandeiras (tBand) da NF-e
export const BANDEIRAS = {
  visa: '01', mastercard: '02', amex: '03', sorocred: '04', diners: '05',
  elo: '06', hipercard: '07', aura: '08', cabal: '09', alelo: '10',
  banescard: '11', calcard: '12', credz: '13', discover: '14', goodcard: '15',
  greencard: '16', hiper: '17', jcb: '18', mais: '19', maxvan: '20',
  policard: '21', redecompras: '22', sicredi: '23', sodexo: '24', valecard: '25',
  verocheque: '26', vr: '27', ticket: '28', outros: '99',
};

// ─── Utilidades ──────────────────────────────────────────────────────────────
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const f2 = (v) => round2(v).toFixed(2);
const f4 = (v) => Number(v).toFixed(4);
const digits = (v) => String(v || '').replace(/\D/g, '');
const semAcento = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Data/hora no fuso de Brasília (-03:00) independente do fuso do servidor
export function agoraBrasil() {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Recife',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  return `${fmt.format(new Date()).replace(' ', 'T')}-03:00`;
}

class FiscalError extends Error {
  constructor(message, code = 'FISCAL_ERROR', details = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export { FiscalError };

// ─── TOTVS (dados cadastrais: emitente, cliente, produto) ────────────────────
async function callTotvs(method, url, { data, params, timeout } = {}) {
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new FiscalError('Sem token TOTVS', 'TOKEN_UNAVAILABLE');
  const doCall = (token) =>
    axios({
      method, url, data, params,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      httpsAgent, httpAgent, timeout: timeout ?? 30000,
    });
  try {
    return await doCall(tokenData.access_token);
  } catch (err) {
    if (err.response?.status === 401) {
      const refreshed = await getToken(true);
      return doCall(refreshed.access_token);
    }
    throw err;
  }
}

const cache = new Map(); // chave → { at, value }
const TTL = 30 * 60 * 1000;
async function cached(key, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function enderecoDe(addr) {
  if (!addr) return null;
  const lgr = [addr.publicPlace, addr.address].filter(Boolean).join(' ');
  return {
    xLgr: semAcento(lgr).slice(0, 60),
    nro: addr.addressNumber != null && addr.addressNumber !== '' ? String(addr.addressNumber) : 'S/N',
    xCpl: addr.complement ? semAcento(addr.complement).slice(0, 60) : undefined,
    xBairro: semAcento(addr.neighborhood || 'CENTRO').slice(0, 60),
    cMun: String(addr.ibgeCityCode || ''),
    xMun: semAcento(addr.cityName).slice(0, 60),
    UF: addr.stateAbbreviation,
    CEP: digits(addr.cep),
    cPais: '1058',
    xPais: 'BRASIL',
  };
}

// Lista de filiais do TOTVS (code, cnpj, nomes). Cacheada por 30 min.
export async function listarBranches() {
  return cached('branches', async () => {
    const lista = await callTotvs('get', `${TOTVS_BASE_URL}/person/v2/branchesList`, {
      params: { BranchCodePool: 1, Page: 1, PageSize: 1000 },
    });
    return (lista.data?.items || [])
      .map((b) => ({
        code: Number(b.code),
        cnpj: digits(b.cnpj) || null,
        personCode: b.personCode,
        description: b.description || null,
        fantasyName: b.fantasyName || null,
        branchGroupName: b.branchGroupName || null,
      }))
      .sort((a, b) => a.code - b.code);
  });
}

// Emitente: pessoa jurídica da filial (branchesList → personCode → legal-entities)
export async function buscarEmitente(empresa) {
  return cached(`emit:${empresa}`, async () => {
    const filial = (await listarBranches()).find((b) => Number(b.code) === Number(empresa));
    if (!filial) throw new FiscalError(`Empresa ${empresa} não encontrada no TOTVS`, 'BRANCH_NOT_FOUND');
    const pj = await callTotvs('post', `${TOTVS_BASE_URL}/person/v2/legal-entities/search`, {
      data: { filter: { personCodeList: [filial.personCode] }, expand: 'addresses,phones,emails', page: 1, pageSize: 1 },
    });
    const item = pj.data?.items?.[0];
    if (!item) throw new FiscalError(`Cadastro PJ da empresa ${empresa} não encontrado`, 'EMIT_NOT_FOUND');
    const addr = (item.addresses || []).find((a) => a.addressTypeCode === 1) || item.addresses?.[0];
    const ender = enderecoDe(addr);
    if (!ender?.cMun || !ender?.UF) throw new FiscalError(`Empresa ${empresa} sem endereço fiscal no TOTVS`, 'EMIT_NO_ADDRESS');
    const fone = (item.phones || []).find((p) => p.isDefault) || item.phones?.[0];
    return {
      empresa: Number(empresa),
      cnpj: digits(item.cnpj || filial.cnpj),
      xNome: semAcento(item.name).slice(0, 60),
      xFant: semAcento(item.fantasyName || filial.fantasyName || item.name).slice(0, 60),
      ie: digits(item.numberStateRegistration),
      uf: ender.UF,
      cMun: ender.cMun,
      endereco: { ...ender, fone: fone ? digits(fone.number) : undefined },
      crt: 3,
    };
  });
}

// Cliente (PF ou PJ) com endereço — usado no <dest>
export async function buscarClienteFiscal(code) {
  return cached(`cli:${code}`, async () => {
    const payload = { filter: { personCodeList: [Number(code)] }, expand: 'addresses,phones,emails', page: 1, pageSize: 1 };
    const [pf, pj] = await Promise.allSettled([
      callTotvs('post', `${TOTVS_BASE_URL}/person/v2/individuals/search`, { data: payload }),
      callTotvs('post', `${TOTVS_BASE_URL}/person/v2/legal-entities/search`, { data: payload }),
    ]);
    const ind = pf.status === 'fulfilled' ? pf.value.data?.items?.[0] : null;
    const leg = pj.status === 'fulfilled' ? pj.value.data?.items?.[0] : null;
    const item = ind || leg;
    if (!item) return null;
    const addr = item.addresses?.[0];
    const email = (item.emails || []).find((e) => e.isDefault)?.email || item.emails?.[0]?.email;
    const fone = (item.phones || []).find((p) => p.isDefault) || item.phones?.[0];
    return {
      code: Number(code),
      nome: semAcento(item.name).slice(0, 60),
      cpf: ind ? digits(ind.cpf) : null,
      cnpj: leg ? digits(leg.cnpj) : null,
      ie: leg ? digits(leg.numberStateRegistration) : null,
      email: email || null,
      fone: fone ? digits(fone.number) : null,
      endereco: enderecoDe(addr),
    };
  });
}

// Produto: NCM / CEST / origem (products/search com option.branchInfoCode)
export async function buscarProdutoFiscal(productCode, empresa) {
  return cached(`prod:${productCode}:${empresa}`, async () => {
    const r = await callTotvs('post', `${TOTVS_BASE_URL}/product/v2/products/search`, {
      data: { filter: { productCodeList: [Number(productCode)] }, option: { branchInfoCode: Number(empresa) }, page: 1, pageSize: 1 },
    });
    const p = r.data?.items?.[0];
    if (!p) throw new FiscalError(`Produto ${productCode} não encontrado no TOTVS`, 'PRODUCT_NOT_FOUND');
    return {
      productCode: p.productCode,
      nome: p.productName,
      sku: p.productSku || null,
      ncm: digits(p.ncm),
      cest: p.cest ? digits(p.cest) : null,
      origem: /^\d$/.test(String(p.cst ?? '')) ? String(p.cst) : '0',
      unidade: p.measuredUnit || 'UN',
      referencia: p.referenceName || null,
    };
  });
}

// ─── Certificado da matriz (mesma raiz de CNPJ da filial) ────────────────────
export function certificadoPara(cnpjFilial) {
  const raiz = digits(cnpjFilial).slice(0, 8);
  const lista = carregarCertificados();
  const cert = lista.find((c) => digits(c.cnpj).slice(0, 8) === raiz);
  if (!cert) {
    throw new FiscalError(
      lista.length === 0
        ? `Nenhum certificado A1 carregado no backend. Local: defina SEFAZ_CERTS_DIR (pasta com certificados.json + .pfx) no .env. Render: SEFAZ_CERTIFICADOS + SEFAZ_PFX_*. Reinicie o servidor após configurar.`
        : `Nenhum certificado A1 com raiz de CNPJ ${raiz} (filial ${cnpjFilial}). Certificados carregados: ${lista.map((c) => c.cnpj).join(', ')}`,
      'CERT_NOT_FOUND',
    );
  }
  if (cert.validade && new Date(cert.validade) < new Date()) {
    throw new FiscalError(`Certificado ${cert.arquivo} vencido em ${new Date(cert.validade).toISOString().slice(0, 10)}`, 'CERT_EXPIRED');
  }
  return cert;
}

// ─── Configuração fiscal da empresa ──────────────────────────────────────────
export async function buscarConfig(empresa) {
  const { data, error } = await supabase.from('pdv_fiscal_config').select('*').eq('empresa', Number(empresa)).maybeSingle();
  if (error) throw new FiscalError(`Erro ao ler pdv_fiscal_config: ${error.message}`, 'CONFIG_ERROR');
  if (!data) throw new FiscalError(`Empresa ${empresa} sem configuração fiscal — configure série, ambiente e CSC em Fiscal ⚙`, 'CONFIG_MISSING');
  if (!data.ativo) throw new FiscalError(`Emissão fiscal desativada para a empresa ${empresa}`, 'CONFIG_INACTIVE');
  return data;
}

function cscDe(cfg) {
  const prod = Number(cfg.ambiente) === 1;
  return { id: prod ? cfg.csc_id_prod : cfg.csc_id_hom, token: prod ? cfg.csc_token_prod : cfg.csc_token_hom };
}

function toolsPara({ modelo, uf, cfg, cert, cnpj }) {
  const csc = cscDe(cfg);
  return new Tools(
    {
      mod: String(modelo),
      UF: uf,
      tpAmb: Number(cfg.ambiente),
      versao: '4.00',
      CSC: csc.token || '',
      CSCid: csc.id || '',
      timeout: 60,
      openssl: process.env.NFE_OPENSSL_PATH || null,
      xmllint: 'xmllint',
      CNPJ: cnpj,
    },
    { pfx: cert.pfx, senha: cert.senha },
  );
}

// ─── Cálculo dos impostos de um item ─────────────────────────────────────────
export function calcularImpostosItem({ vProd, vDesc, aliqIcms, regra, modelo }) {
  const base = round2(vProd - vDesc); // valor líquido do item
  const vICMS = round2((base * aliqIcms) / 100);
  const basePisCofins = round2(base - vICMS);
  const vPIS = regra.pis.aliq > 0 ? round2((basePisCofins * regra.pis.aliq) / 100) : 0;
  const vCOFINS = regra.cofins.aliq > 0 ? round2((basePisCofins * regra.cofins.aliq) / 100) : 0;
  const vIBSUF = round2((base * IBSCBS.pIBSUF) / 100);
  const vIBSMun = round2((base * IBSCBS.pIBSMun) / 100);
  const vCBS = round2((base * IBSCBS.pCBS) / 100);

  const imposto = {
    ICMS: {
      ICMS00: { orig: undefined, CST: '00', modBC: '3', vBC: f2(base), pICMS: f2(aliqIcms), vICMS: f2(vICMS) },
    },
  };
  if (Number(modelo) === 55) imposto.IPI = { cEnq: '999', IPINT: { CST: regra.ipiCST } };
  if (regra.pis.aliq > 0) {
    imposto.PIS = { PISAliq: { CST: regra.pis.CST, vBC: f2(basePisCofins), pPIS: f4(regra.pis.aliq), vPIS: f2(vPIS) } };
    imposto.COFINS = { COFINSAliq: { CST: regra.cofins.CST, vBC: f2(basePisCofins), pCOFINS: f4(regra.cofins.aliq), vCOFINS: f2(vCOFINS) } };
  } else {
    imposto.PIS = { PISOutr: { CST: regra.pis.CST, vBC: '0.00', pPIS: '0.0000', vPIS: '0.00' } };
    imposto.COFINS = { COFINSOutr: { CST: regra.cofins.CST, vBC: '0.00', pCOFINS: '0.0000', vCOFINS: '0.00' } };
  }
  imposto.IBSCBS = {
    CST: IBSCBS.CST,
    cClassTrib: IBSCBS.cClassTrib,
    gIBSCBS: {
      vBC: f2(base),
      gIBSUF: { pIBSUF: f4(IBSCBS.pIBSUF), vIBSUF: f2(vIBSUF) },
      gIBSMun: { pIBSMun: f4(IBSCBS.pIBSMun), vIBSMun: f2(vIBSMun) },
      vIBS: f2(vIBSUF + vIBSMun),
      gCBS: { pCBS: f4(IBSCBS.pCBS), vCBS: f2(vCBS) },
    },
  };
  return { imposto, base, vICMS, vPIS, vCOFINS, vIBSUF, vIBSMun, vCBS };
}

// ─── Montagem do XML ─────────────────────────────────────────────────────────
// venda: linha de pdv_vendas + itens[] + pagamentos[]
// Retorna { xml (não assinado), numero, serie, modelo, chaveParcial }
export async function montarXml({ venda, itens, pagamentos, cfg, emit, cliente, numero }) {
  if (venda.origem === 'expedicao') return montarXmlExpedicao({ venda, itens, pagamentos, cfg, emit, cliente, numero });
  const modelo = venda.tipo_venda === 'nfce' ? 65 : 55;
  const regra = venda.tipo_venda === 'troca' ? REGRAS.devolucao : REGRAS.venda;
  const serie = modelo === 65 ? cfg.serie_nfce : cfg.serie_nfe;
  const tpAmb = Number(cfg.ambiente);
  const aliqIcms = cfg.aliq_icms != null ? Number(cfg.aliq_icms) : ICMS_ALIQ_UF[emit.uf];
  if (!(aliqIcms >= 0)) throw new FiscalError(`Alíquota de ICMS não definida para a UF ${emit.uf}`, 'ICMS_ALIQ_MISSING');

  // NF-e (55) exige destinatário com endereço; NFC-e aceita sem destinatário
  if (modelo === 55) {
    if (!cliente) throw new FiscalError('NF-e exige cliente identificado', 'DEST_REQUIRED');
    if (!cliente.endereco?.cMun) throw new FiscalError(`Cliente ${cliente.nome} sem endereço no TOTVS — NF-e exige endereço do destinatário`, 'DEST_NO_ADDRESS');
    if (cliente.endereco.UF !== emit.uf) {
      throw new FiscalError(`Cliente de outra UF (${cliente.endereco.UF}); a NF-e interestadual a consumidor exige DIFAL e não é suportada aqui — use NFC-e`, 'DEST_INTERSTATE');
    }
  }
  if (cliente && !cliente.cpf && !cliente.cnpj) {
    throw new FiscalError(`Cliente ${cliente.nome} sem CPF/CNPJ no TOTVS`, 'DEST_NO_DOC');
  }

  const dhEmi = agoraBrasil();
  const nfe = new Make();
  nfe.tagInfNFe({ versao: '4.00' });
  nfe.tagIde({
    cUF: String(UF2cUF[emit.uf]),
    cNF: String(crypto.randomInt(0, 99999999)).padStart(8, '0'),
    natOp: regra.natOp,
    mod: String(modelo),
    serie: String(serie),
    nNF: String(numero),
    dhEmi,
    ...(modelo === 55 ? { dhSaiEnt: dhEmi } : {}),
    tpNF: String(regra.tpNF),
    idDest: '1',
    cMunFG: emit.cMun,
    tpImp: modelo === 65 ? '4' : '1',
    tpEmis: '1',
    cDV: '0', // recalculado pela lib ao gerar a chave
    tpAmb: String(tpAmb),
    finNFe: String(regra.finNFe),
    indFinal: '1',
    indPres: venda.tipo_venda === 'nfe' ? '0' : '1',
    // indIntermed só é permitido quando há presença (indPres ≠ 0)
    ...(venda.tipo_venda === 'nfe' ? {} : { indIntermed: '0' }),
    procEmi: '0',
    verProc: VERSAO_APLICACAO,
  });
  // TROCA: referencia a NF-e/NFC-e de origem quando informada
  if (venda.tipo_venda === 'troca' && digits(venda.nf_referenciada).length === 44) {
    nfe.tagRefNFe(digits(venda.nf_referenciada));
  }

  // A lib grava as chaves na ordem de inserção: ao receber xFant, tagEmit cria
  // enderEmit logo após — então IE e CRT passados aqui ficam DEPOIS do endereço,
  // como o schema exige (CNPJ, xNome, xFant, enderEmit, IE, CRT).
  nfe.tagEmit({ CNPJ: emit.cnpj, xNome: emit.xNome, xFant: emit.xFant, IE: emit.ie, CRT: String(emit.crt) });
  nfe.tagEnderEmit(limparUndefined(emit.endereco));

  if (cliente) {
    // Mesmo truque: em modelo 55, tagDest cria enderDest logo após xNome.
    const dest = cliente.cnpj ? { CNPJ: cliente.cnpj } : { CPF: cliente.cpf };
    dest.xNome = cliente.nome;
    dest.indIEDest = cliente.cnpj && cliente.ie ? '1' : '9';
    if (cliente.cnpj && cliente.ie) dest.IE = cliente.ie;
    if (cliente.email) dest.email = cliente.email.slice(0, 60);
    nfe.tagDest(dest);
    if (modelo === 55 && cliente.endereco?.cMun) nfe.tagEnderDest(limparUndefined(cliente.endereco));
  }

  // Itens
  const det = [];
  const tot = { vBC: 0, vICMS: 0, vProd: 0, vDesc: 0, vPIS: 0, vCOFINS: 0, vIBSUF: 0, vIBSMun: 0, vCBS: 0, vNF: 0 };
  const impostos = [];
  for (const it of itens) {
    const q = Number(it.quantidade);
    const vUn = round2(it.valor_unit);
    const vProd = round2(q * vUn);
    const vDesc = round2(q * Number(it.desconto_unit || 0));
    if (!it.ncm || String(it.ncm).length !== 8) throw new FiscalError(`Produto ${it.product_code} (${it.nome}) sem NCM válido no TOTVS`, 'NCM_MISSING');
    const ean = digits(it.sku);
    const cEAN = ean.length === 13 || ean.length === 12 || ean.length === 14 || ean.length === 8 ? ean : 'SEM GTIN';
    det.push({
      cProd: String(it.product_code),
      cEAN,
      xProd: semAcento(it.nome).slice(0, 120),
      NCM: String(it.ncm),
      ...(it.cest ? { CEST: String(it.cest) } : {}),
      CFOP: String(regra.cfop),
      uCom: it.unidade || 'UN',
      qCom: q,
      vUnCom: vUn,
      vProd,
      cEANTrib: cEAN,
      uTrib: it.unidade || 'UN',
      qTrib: q,
      vUnTrib: vUn,
      ...(vDesc > 0 ? { vDesc } : {}),
      indTot: '1',
    });
    const calc = calcularImpostosItem({ vProd, vDesc, aliqIcms, regra, modelo });
    calc.imposto.ICMS.ICMS00.orig = it.origem || '0';
    impostos.push(calc);
    tot.vBC += calc.base; tot.vICMS += calc.vICMS; tot.vProd += vProd; tot.vDesc += vDesc;
    tot.vPIS += calc.vPIS; tot.vCOFINS += calc.vCOFINS; tot.vIBSUF += calc.vIBSUF; tot.vIBSMun += calc.vIBSMun; tot.vCBS += calc.vCBS;
    tot.vNF += calc.base;
  }
  await nfe.tagProd(det);
  impostos.forEach((calc, i) => nfe.taginfAdProd(i, { imposto: calc.imposto, vItem: f2(calc.base) }));

  // Totais (forçados: cálculo próprio, no formato aceito pela SEFAZ)
  nfe.tagTotal(
    {
      ICMSTot: {
        vBC: f2(tot.vBC), vICMS: f2(tot.vICMS), vICMSDeson: '0.00', vFCPUFDest: '0.00', vICMSUFDest: '0.00',
        vICMSUFRemet: '0.00', vFCP: '0.00', vBCST: '0.00', vST: '0.00', vFCPST: '0.00', vFCPSTRet: '0.00',
        vProd: f2(tot.vProd), vFrete: '0.00', vSeg: '0.00', vDesc: f2(tot.vDesc), vII: '0.00', vIPI: '0.00',
        vIPIDevol: '0.00', vPIS: f2(tot.vPIS), vCOFINS: f2(tot.vCOFINS), vOutro: '0.00', vNF: f2(tot.vNF),
      },
      IBSCBSTot: {
        vBCIBSCBS: f2(tot.vBC),
        gIBS: {
          gIBSUF: { vDif: '0.00', vDevTrib: '0.00', vIBSUF: f2(tot.vIBSUF) },
          gIBSMun: { vDif: '0.00', vDevTrib: '0.00', vIBSMun: f2(tot.vIBSMun) },
          vIBS: f2(tot.vIBSUF + tot.vIBSMun), vCredPres: '0.00', vCredPresCondSus: '0.00',
        },
        gCBS: { vDif: '0.00', vDevTrib: '0.00', vCBS: f2(tot.vCBS), vCredPres: '0.00', vCredPresCondSus: '0.00' },
      },
      vNFTot: f2(tot.vNF),
    },
    true,
  );
  nfe.tagTransp({ modFrete: '9' });

  // Pagamentos
  const detPag = [];
  let troco = 0;
  if (venda.tipo_venda === 'troca') {
    detPag.push({ tPag: '90', vPag: '0.00' });
  } else {
    for (const p of pagamentos) {
      const valor = round2(p.valor);
      if (!(valor > 0)) continue;
      const cartao = p.forma === 'credito' || p.forma === 'debito';
      const d = {
        indPag: p.forma === 'credito' && Number(p.parcelas || 1) > 1 ? '1' : p.forma === 'credito' ? '1' : '0',
        tPag: TPAG[p.forma] || '99',
        vPag: f2(valor),
      };
      if (cartao) {
        d.card = { tpIntegra: '2' };
        if (digits(p.adquirente_cnpj).length === 14) d.card.CNPJ = digits(p.adquirente_cnpj);
        if (p.bandeira && BANDEIRAS[p.bandeira]) d.card.tBand = BANDEIRAS[p.bandeira];
        if (p.autorizacao) d.card.cAut = String(p.autorizacao).slice(0, 20);
      }
      detPag.push(d);
      troco += Number(p.troco || 0);
    }
    if (detPag.length === 0) throw new FiscalError('Venda sem pagamento informado', 'PAYMENT_MISSING');
  }
  nfe.tagDetPag(detPag);
  if (troco > 0) nfe.tagTroco(f2(troco));

  // Informações complementares
  const partes = [];
  if (venda.tipo_venda === 'troca') partes.push(`DEVOLUCAO DE MERCADORIA - TROCA - VENDA HEADCOACH ${venda.id}`);
  else partes.push(`VENDA HEADCOACH ${venda.id}`);
  if (venda.vendedor_nome) partes.push(`VENDEDOR ${semAcento(venda.vendedor_nome)}`);
  partes.push(`ICMS ${f2(aliqIcms).replace('.', ',')}% BASE ${f2(tot.vBC).replace('.', ',')} = ${f2(tot.vICMS).replace('.', ',')}`);
  if (cfg.info_complementar) partes.push(semAcento(cfg.info_complementar));
  nfe.tagInfAdic({ infCpl: partes.join(' | ').slice(0, 2000) });

  const xml = nfe.xml();
  const chave = xml.match(/Id="NFe(\d{44})"/)?.[1] || null;
  return { xml, modelo, serie, numero, chave, tpAmb, aliqIcms, dhEmi, totais: tot };
}

// ─── FATURAMENTO DA EXPEDIÇÃO (NF-e 55, empresa 99) ──────────────────────────
// Gabarito copiado de 1.544 NF-e autorizadas do TOTVS na empresa 99
// (ops 7234/7235/7236/7254/7299, ago–nov/2026):
//   natOp "VENDA DE PRODUCAO DO ESTABELECIMENTO" (+ ", DESTINADAS A NAO CONTR")
//   item de produção própria 5101 / 6101 / 6107; adquirido 5102 / 6102 / 6108
//     (dentro do RN / fora com IE / fora sem IE — consumidor final)
//   ICMS00 20% no RN, 12% interestadual (4% se origem importada 1/2/3/8)
//   frete rateado nos itens (prod.vFrete) e SOMADO à base do ICMS, IBS e CBS
//   PIS 01 0,65% / COFINS 01 3% sobre (base − ICMS); IPI IPINT 53
//   DIFAL (ICMSUFDest) só fora do RN e sem IE: base cheia, FCP 0, partilha 100%
//   transp: modFrete 1 (cliente paga) / 0 (Crosby paga) com transporta + vol;
//           sem transportadora modFrete 9
//   boleto: cobr/fat + dup (001…), pagamento a prazo
//   indPres 9, indIntermed 0, indFinal 1 sem IE / 0 com IE
// Alíquota interna da UF de destino usada no DIFAL — SÓ as conferidas nas notas
// do TOTVS (pICMSUFDest, FCP 0). UF fora da lista é recusada em vez de chutar.
// MG: 18% conferido em 12/11/2026 nas NF 15639/3 e 15640/3 da empresa 99 (14/10/2026,
// consumidor final de MG): pICMSUFDest 18, pICMSInter 12, pFCPUFDest 0, partilha 100%.
export const ICMS_DIFAL_UF_CONFERIDA = { AL: 19, BA: 20.5, CE: 20, ES: 17, MA: 23, MG: 18, PA: 19, PB: 20, PE: 20.5, PI: 22.5, SE: 19, TO: 20 };
const NATOP_PRODUCAO = 'VENDA DE PRODUCAO DO ESTABELECIMENTO';
const NATOP_ADQUIRIDA = 'VENDA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIROS';
const SUFIXO_NAO_CONTRIB = ', DESTINADAS A NAO CONTRIBUINTE';
const CFOP_EXPEDICAO = {
  interna: { producao: 5101, adquirido: 5102 },
  interContrib: { producao: 6101, adquirido: 6102 },
  interNaoContrib: { producao: 6107, adquirido: 6108 },
};
// TRANSFERÊNCIA saindo da expedição com a NF-e pelo HeadCoach (Yago, 11/11/2026),
// no padrão das notas que a 99 emitia pelo TOTVS (venda.pedido_info.transferencia):
//   natureza 'transferencia' (destino da MESMA raiz de CNPJ, op 8400 — NF 16126):
//     natOp TRANSFERENCIA…, CFOP 5151/5152 (6151/6152 fora do estado), PIS/COFINS CST 08
//   natureza 'venda' (destino de OUTRA raiz, op 8405 — NF 16088):
//     igual à venda (VENDA DE PRODUCAO…, 5101/5102 ou 6101/6102, PIS/COFINS 01)
//   As duas: ICMS 00 cheio, destinatário contribuinte, SEM pagamento (tPag 90,
//   vPag 0,00), sem frete (modFrete 9) e "TRANSFERENCIA … NAO E VENDA" no infCpl.
const NATOP_TRANSF_PRODUCAO = 'TRANSFERENCIA DE PRODUCAO DO ESTABELECIMENTO';
const NATOP_TRANSF_ADQUIRIDA = 'TRANSFERENCIA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIR';
const CFOP_TRANSFERENCIA = {
  interna: { producao: 5151, adquirido: 5152 },
  interContrib: { producao: 6151, adquirido: 6152 },
};
/** CFOP de um item de transferência da expedição (natureza: 'transferencia' | 'venda'). */
export function cfopTransferencia(chave, tipo, natureza) {
  const t = tipo === 'adquirido' ? 'adquirido' : 'producao';
  if (natureza === 'transferencia') {
    if (!CFOP_TRANSFERENCIA[chave]) throw new FiscalError('Transferência exige destinatário com CNPJ e inscrição estadual', 'TRANSF_DEST_NAO_CONTRIBUINTE');
    return CFOP_TRANSFERENCIA[chave][t];
  }
  return CFOP_EXPEDICAO[chave][t];
}
// saldo_bonus = crédito do cliente guardado no HeadCoach (peça em falta de outro pedido)
const TPAG_EXPEDICAO = { ...TPAG, boleto: '15', adiantamento: TPAG.credito_loja, saldo_bonus: TPAG.credito_loja };
const f3 = (v) => (Number(v) || 0).toFixed(3);
const brl = (v) => round2(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Cenário fiscal de uma venda da expedição (também usado na tela antes de emitir)
// consumidorFinal: o operador marca quando o cliente tem IE mas o TOTVS o trata
// como consumidor final (ex.: MEI) — vira não contribuinte, com DIFAL
export function cenarioExpedicao({ emitUf, cliente, consumidorFinal = false }) {
  const destUf = cliente?.endereco?.UF || null;
  const contribuinte = !consumidorFinal && !!(cliente?.cnpj && cliente?.ie);
  const interestadual = !!destUf && destUf !== emitUf;
  const chave = !interestadual ? 'interna' : contribuinte ? 'interContrib' : 'interNaoContrib';
  return { destUf, contribuinte, interestadual, chave, difal: chave === 'interNaoContrib' };
}
export function cfopExpedicao(chave, tipo) {
  return CFOP_EXPEDICAO[chave]?.[tipo === 'adquirido' ? 'adquirido' : 'producao'] ?? null;
}

// Transportadora (pessoa do TOTVS) no formato do <transporta>
export async function buscarTransportadora(code) {
  return cached(`transp:${code}`, async () => {
    const payload = { filter: { personCodeList: [Number(code)] }, expand: 'addresses', page: 1, pageSize: 1 };
    const [pj, pf] = await Promise.allSettled([
      callTotvs('post', `${TOTVS_BASE_URL}/person/v2/legal-entities/search`, { data: payload }),
      callTotvs('post', `${TOTVS_BASE_URL}/person/v2/individuals/search`, { data: payload }),
    ]);
    const leg = pj.status === 'fulfilled' ? pj.value.data?.items?.[0] : null;
    const ind = pf.status === 'fulfilled' ? pf.value.data?.items?.[0] : null;
    const item = leg || ind;
    if (!item) throw new FiscalError(`Transportadora ${code} não encontrada no TOTVS`, 'CARRIER_NOT_FOUND');
    const addr = enderecoDe(item.addresses?.[0]);
    return {
      code: Number(code),
      nome: semAcento(item.name).slice(0, 60),
      cnpj: leg ? digits(leg.cnpj) : null,
      cpf: ind ? digits(ind.cpf) : null,
      ie: leg ? digits(leg.numberStateRegistration) || null : null,
      xEnder: addr ? semAcento([addr.xLgr, addr.nro && !/^(S\/N|0+)$/i.test(addr.nro) ? addr.nro : ''].filter(Boolean).join(' ')).slice(0, 60) : null,
      xMun: addr?.xMun || null,
      uf: addr?.UF || null,
    };
  });
}

// Produção própria × adquirido por produto, aprendido das notas do TOTVS
// (fiscal_produto_tipo). Sem histórico: maioria dos produtos da mesma
// referência (nome começa igual); sem nada, produção.
export async function tiposFiscais(empresa, itens) {
  const codes = [...new Set(itens.map((i) => Number(i.product_code ?? i.productCode)))];
  const { data } = await supabase.from('fiscal_produto_tipo').select('product_code, tipo').eq('empresa', Number(empresa)).in('product_code', codes);
  const mapa = new Map((data || []).map((r) => [Number(r.product_code), r.tipo]));
  for (const it of itens) {
    const code = Number(it.product_code ?? it.productCode);
    if (mapa.has(code)) continue;
    const ref = semAcento(it.referencia || '').toUpperCase();
    let tipo = 'producao';
    if (ref.length >= 6) {
      const { data: irmaos } = await supabase.from('fiscal_produto_tipo').select('tipo').eq('empresa', Number(empresa)).ilike('nome', `${ref}%`).limit(200);
      const adq = (irmaos || []).filter((r) => r.tipo === 'adquirido').length;
      if (irmaos?.length && adq > irmaos.length / 2) tipo = 'adquirido';
    }
    mapa.set(code, tipo);
  }
  return mapa;
}

async function montarXmlExpedicao({ venda, itens, pagamentos, cfg, emit, cliente, numero }) {
  const serie = cfg.serie_nfe;
  const tpAmb = Number(cfg.ambiente);
  if (!cliente) throw new FiscalError('NF-e exige cliente identificado', 'DEST_REQUIRED');
  if (!cliente.endereco?.cMun || !cliente.endereco?.UF) throw new FiscalError(`Cliente ${cliente.nome} sem endereço completo no TOTVS — NF-e exige o endereço do destinatário`, 'DEST_NO_ADDRESS');
  if (!cliente.cpf && !cliente.cnpj) throw new FiscalError(`Cliente ${cliente.nome} sem CPF/CNPJ no TOTVS`, 'DEST_NO_DOC');

  const cen = cenarioExpedicao({ emitUf: emit.uf, cliente, consumidorFinal: !!venda.pedido_info?.consumidorFinal });
  // transferência entre empresas do grupo (nota pelo HeadCoach): ver CFOP_TRANSFERENCIA
  const transf = venda.pedido_info?.transferencia || null;
  const ehTransf = transf?.natureza === 'transferencia';
  if (transf && !cen.contribuinte) {
    throw new FiscalError(`Transferência: a filial de destino (${cliente.nome}) precisa de CNPJ e inscrição estadual no cadastro do TOTVS`, 'TRANSF_DEST_NAO_CONTRIBUINTE');
  }
  const aliqInterna = cfg.aliq_icms != null ? Number(cfg.aliq_icms) : ICMS_ALIQ_UF[emit.uf];
  const pDifal = cen.difal ? ICMS_DIFAL_UF_CONFERIDA[cen.destUf] : null;
  if (cen.difal && pDifal == null) {
    throw new FiscalError(
      `Venda para consumidor final em ${cen.destUf}: a alíquota do DIFAL de ${cen.destUf} ainda não foi conferida em nota do TOTVS — fature esta pelo TOTVS ou confirme a alíquota antes`,
      'DIFAL_UF_NAO_CONFERIDA',
    );
  }

  // frete rateado pelo valor líquido de cada item (arredondado por item); a
  // sobra de centavos vai no item de MAIOR valor — igual ao TOTVS (NF 16082)
  const frete = round2(venda.frete || 0);
  const liq = itens.map((it) => round2(Number(it.quantidade) * round2(it.valor_unit) - Number(it.quantidade) * Number(it.desconto_unit || 0)));
  const somaLiq = liq.reduce((s, v) => s + v, 0);
  const fretes = liq.map((v) => (frete > 0 && somaLiq > 0 ? round2((frete * v) / somaLiq) : 0));
  if (frete > 0 && somaLiq > 0) {
    const sobra = round2(frete - fretes.reduce((s, v) => s + v, 0));
    if (sobra !== 0) {
      const iMaior = liq.indexOf(Math.max(...liq));
      fretes[iMaior] = round2(fretes[iMaior] + sobra);
    }
  }

  const tipos = itens.map((it) => it.tipo_fiscal || 'producao');
  // natureza pelo PRIMEIRO item, como o TOTVS (NF 15921: 1º item adquirido)
  let natOp = tipos[0] === 'adquirido' ? NATOP_ADQUIRIDA : NATOP_PRODUCAO;
  if (cen.chave === 'interNaoContrib') natOp = `${natOp}${SUFIXO_NAO_CONTRIB}`;
  if (ehTransf) natOp = tipos[0] === 'adquirido' ? NATOP_TRANSF_ADQUIRIDA : NATOP_TRANSF_PRODUCAO;
  natOp = natOp.slice(0, 60);

  const dhEmi = agoraBrasil();
  const nfe = new Make();
  nfe.tagInfNFe({ versao: '4.00' });
  nfe.tagIde({
    cUF: String(UF2cUF[emit.uf]),
    cNF: String(crypto.randomInt(0, 99999999)).padStart(8, '0'),
    natOp,
    mod: '55',
    serie: String(serie),
    nNF: String(numero),
    dhEmi,
    dhSaiEnt: dhEmi,
    tpNF: '1',
    idDest: cen.interestadual ? '2' : '1',
    cMunFG: emit.cMun,
    tpImp: '1',
    tpEmis: '1',
    cDV: '0',
    tpAmb: String(tpAmb),
    finNFe: '1',
    indFinal: cen.contribuinte ? '0' : '1',
    indPres: '9',
    indIntermed: '0',
    procEmi: '0',
    verProc: VERSAO_APLICACAO,
  });
  nfe.tagEmit({ CNPJ: emit.cnpj, xNome: emit.xNome, xFant: emit.xFant, IE: emit.ie, CRT: String(emit.crt) });
  nfe.tagEnderEmit(limparUndefined(emit.endereco));
  const dest = cliente.cnpj ? { CNPJ: cliente.cnpj } : { CPF: cliente.cpf };
  dest.xNome = cliente.nome;
  dest.indIEDest = cen.contribuinte ? '1' : '9';
  if (cen.contribuinte) dest.IE = cliente.ie;
  if (cliente.email) dest.email = cliente.email.slice(0, 60);
  nfe.tagDest(dest);
  nfe.tagEnderDest(limparUndefined(cliente.endereco));

  const det = [];
  const imps = [];
  const tot = { vBC: 0, vICMS: 0, vICMSUFDest: 0, vProd: 0, vFrete: 0, vDesc: 0, vPIS: 0, vCOFINS: 0, vIBSUF: 0, vCBS: 0, vNF: 0 };
  const cfops = [];
  itens.forEach((it, i) => {
    const q = Number(it.quantidade);
    const vUn = round2(it.valor_unit);
    const vProd = round2(q * vUn);
    const vDesc = round2(q * Number(it.desconto_unit || 0));
    const vFrete = fretes[i];
    if (!it.ncm || String(it.ncm).length !== 8) throw new FiscalError(`Produto ${it.product_code} (${it.nome}) sem NCM válido no TOTVS`, 'NCM_MISSING');
    const cfop = transf ? cfopTransferencia(cen.chave, tipos[i], transf.natureza) : cfopExpedicao(cen.chave, tipos[i]);
    cfops.push(cfop);
    const ean = digits(it.sku);
    const cEAN = [8, 12, 13, 14].includes(ean.length) ? ean : 'SEM GTIN';
    det.push({
      cProd: String(it.product_code),
      cEAN,
      xProd: semAcento(it.nome).slice(0, 120),
      NCM: String(it.ncm),
      ...(it.cest ? { CEST: String(it.cest) } : {}),
      CFOP: String(cfop),
      uCom: it.unidade || 'UN',
      qCom: q,
      vUnCom: vUn,
      vProd,
      cEANTrib: cEAN,
      uTrib: it.unidade || 'UN',
      qTrib: q,
      vUnTrib: vUn,
      ...(vFrete > 0 ? { vFrete: f2(vFrete) } : {}),
      ...(vDesc > 0 ? { vDesc } : {}),
      indTot: '1',
    });
    const orig = String(it.origem || '0');
    const aliq = cen.interestadual ? (['1', '2', '3', '8'].includes(orig) ? 4 : 12) : aliqInterna;
    const base = round2(vProd - vDesc + vFrete);
    const vICMS = round2((base * aliq) / 100);
    const basePC = round2(base - vICMS);
    // transferência entre estabelecimentos da mesma empresa: PIS/COFINS CST 08, sem valor
    const vPIS = ehTransf ? 0 : round2((basePC * 0.65) / 100);
    const vCOFINS = ehTransf ? 0 : round2((basePC * 3) / 100);
    const vIBSUF = round2((base * IBSCBS.pIBSUF) / 100);
    const vCBS = round2((base * IBSCBS.pCBS) / 100);
    const imposto = {
      ICMS: { ICMS00: { orig, CST: '00', modBC: '3', vBC: f2(base), pICMS: f2(aliq), vICMS: f2(vICMS) } },
      IPI: { cEnq: '999', IPINT: { CST: '53' } },
      PIS: ehTransf ? { PISNT: { CST: '08' } } : { PISAliq: { CST: '01', vBC: f2(basePC), pPIS: f4(0.65), vPIS: f2(vPIS) } },
      COFINS: ehTransf ? { COFINSNT: { CST: '08' } } : { COFINSAliq: { CST: '01', vBC: f2(basePC), pCOFINS: f4(3), vCOFINS: f2(vCOFINS) } },
    };
    let vDifal = 0;
    if (cen.difal) {
      vDifal = round2((base * (pDifal - aliq)) / 100);
      imposto.ICMSUFDest = {
        vBCUFDest: f2(base),
        vBCFCPUFDest: f2(base),
        pFCPUFDest: f4(0),
        pICMSUFDest: f4(pDifal),
        pICMSInter: f2(aliq),
        pICMSInterPart: f4(100),
        vFCPUFDest: '0.00',
        vICMSUFDest: f2(vDifal),
        vICMSUFRemet: '0.00',
      };
    }
    imposto.IBSCBS = {
      CST: IBSCBS.CST,
      cClassTrib: IBSCBS.cClassTrib,
      gIBSCBS: {
        vBC: f2(base),
        gIBSUF: { pIBSUF: f4(IBSCBS.pIBSUF), vIBSUF: f2(vIBSUF) },
        gIBSMun: { pIBSMun: f4(IBSCBS.pIBSMun), vIBSMun: '0.00' },
        vIBS: f2(vIBSUF),
        gCBS: { pCBS: f4(IBSCBS.pCBS), vCBS: f2(vCBS) },
      },
    };
    imps.push({ imposto, vItem: f2(base) });
    tot.vBC += base;
    tot.vICMS += vICMS;
    tot.vICMSUFDest += vDifal;
    tot.vProd += vProd;
    tot.vFrete += vFrete;
    tot.vDesc += vDesc;
    tot.vPIS += vPIS;
    tot.vCOFINS += vCOFINS;
    tot.vIBSUF += vIBSUF;
    tot.vCBS += vCBS;
    tot.vNF += base;
  });
  await nfe.tagProd(det);
  imps.forEach((x, i) => nfe.taginfAdProd(i, x));

  nfe.tagTotal(
    {
      ICMSTot: {
        vBC: f2(tot.vBC), vICMS: f2(tot.vICMS), vICMSDeson: '0.00', vFCPUFDest: '0.00', vICMSUFDest: f2(tot.vICMSUFDest),
        vICMSUFRemet: '0.00', vFCP: '0.00', vBCST: '0.00', vST: '0.00', vFCPST: '0.00', vFCPSTRet: '0.00',
        vProd: f2(tot.vProd), vFrete: f2(tot.vFrete), vSeg: '0.00', vDesc: f2(tot.vDesc), vII: '0.00', vIPI: '0.00',
        vIPIDevol: '0.00', vPIS: f2(tot.vPIS), vCOFINS: f2(tot.vCOFINS), vOutro: '0.00', vNF: f2(tot.vNF),
      },
      IBSCBSTot: {
        vBCIBSCBS: f2(tot.vBC),
        gIBS: {
          gIBSUF: { vDif: '0.00', vDevTrib: '0.00', vIBSUF: f2(tot.vIBSUF) },
          gIBSMun: { vDif: '0.00', vDevTrib: '0.00', vIBSMun: '0.00' },
          vIBS: f2(tot.vIBSUF), vCredPres: '0.00', vCredPresCondSus: '0.00',
        },
        gCBS: { vDif: '0.00', vDevTrib: '0.00', vCBS: f2(tot.vCBS), vCredPres: '0.00', vCredPresCondSus: '0.00' },
      },
      vNFTot: f2(tot.vNF),
    },
    true,
  );

  // Transporte
  const t = venda.transporte || {};
  const temTransp = !!(t.cnpj || t.cpf);
  const modFrete = temTransp ? String(t.modFrete ?? (frete > 0 ? 1 : 0)) : '9';
  nfe.tagTransp({
    modFrete,
    ...(temTransp
      ? {
          transporta: limparUndefined({
            ...(t.cnpj ? { CNPJ: t.cnpj } : { CPF: t.cpf }),
            xNome: semAcento(t.nome).slice(0, 60),
            IE: t.ie || undefined,
            xEnder: t.xEnder || undefined,
            xMun: t.xMun || undefined,
            UF: t.uf || undefined,
          }),
        }
      : {}),
    vol: { qVol: String(Number(t.volumes ?? (temTransp ? 1 : 0)) || 0), pesoL: f3(t.pesoL), pesoB: f3(t.pesoB) },
  });

  // Pagamento
  const detPag = [];
  // transferência não tem pagamento: tPag 90 "sem pagamento", valor zero
  if (transf) detPag.push({ tPag: '90', vPag: '0.00' });
  for (const p of transf ? [] : pagamentos) {
    const valor = round2(p.valor);
    if (!(valor > 0)) continue;
    const cartao = p.forma === 'credito' || p.forma === 'debito';
    const d = { indPag: p.forma === 'boleto' || p.forma === 'credito' ? '1' : '0', tPag: TPAG_EXPEDICAO[p.forma] || '99', vPag: f2(valor) };
    if (cartao) {
      d.card = { tpIntegra: '2' };
      if (digits(p.adquirente_cnpj).length === 14) d.card.CNPJ = digits(p.adquirente_cnpj);
      if (p.bandeira && BANDEIRAS[p.bandeira]) d.card.tBand = BANDEIRAS[p.bandeira];
      if (p.autorizacao) d.card.cAut = String(p.autorizacao).slice(0, 20);
    }
    detPag.push(d);
  }
  if (!detPag.length) throw new FiscalError('Venda sem pagamento informado', 'PAYMENT_MISSING');
  const somaPag = round2(detPag.reduce((s, d) => s + Number(d.vPag), 0));
  if (!transf && Math.abs(somaPag - round2(tot.vNF)) > 0.01) {
    throw new FiscalError(`Pagamentos (R$ ${brl(somaPag)}) não fecham com o total da nota (R$ ${brl(tot.vNF)}, produtos + frete)`, 'PAYMENT_MISMATCH');
  }
  nfe.tagDetPag(detPag);

  // Informações complementares (mesmo começo das notas do TOTVS)
  const aliqNota = cen.interestadual ? 12 : aliqInterna;
  const partes = [`CST 000 ICMS ${brl(aliqNota)} ${brl(tot.vBC)} = ${brl(tot.vICMS)}`];
  if (transf) {
    partes.push(`TRANSFERENCIA${transf.ref ? ` ${semAcento(transf.ref)}` : ''} -> ${semAcento(transf.destinoNome || cliente.nome).toUpperCase()} NAO E VENDA`);
    partes.push(`TRANSFERENCIA HEADCOACH ${venda.id}`);
  } else {
    if (venda.numero_site) partes.push(`PEDIDO ${semAcento(venda.numero_site)}`);
    partes.push(`VENDA HEADCOACH ${venda.id}`);
  }
  if (venda.vendedor_nome && !transf) partes.push(`VENDEDOR ${semAcento(venda.vendedor_nome)}`);
  const pi = venda.pedido_info || {};
  if (pi.forma) partes.push(`PAGO ${semAcento(pi.forma).toUpperCase()}${pi.nsu ? ` NSU ${pi.nsu}` : ''}${pi.autorizacao ? ` AUT ${pi.autorizacao}` : ''}`);
  if (cfg.info_complementar) partes.push(semAcento(cfg.info_complementar));
  nfe.tagInfAdic({ infCpl: partes.join(' ').slice(0, 2000) });

  let xml = nfe.xml();
  // <cobr> (fatura + duplicatas) entre <transp> e <pag> — a lib não implementa tagFat/tagDup
  if (!transf && pagamentos.some((p) => p.forma === 'boleto')) {
    const parcelas = venda.cobranca?.parcelas || [];
    if (!parcelas.length) throw new FiscalError('Boleto sem parcelas/vencimentos', 'BOLETO_SEM_PARCELAS');
    const somaDup = round2(parcelas.reduce((s, d) => s + Number(d.valor), 0));
    if (Math.abs(somaDup - round2(tot.vNF)) > 0.01) {
      throw new FiscalError(`Parcelas do boleto (R$ ${brl(somaDup)}) não fecham com o total da nota (R$ ${brl(tot.vNF)})`, 'BOLETO_MISMATCH');
    }
    const dups = parcelas
      .map((d, i) => `<dup><nDup>${String(i + 1).padStart(3, '0')}</nDup><dVenc>${String(d.vencimento).slice(0, 10)}</dVenc><vDup>${f2(d.valor)}</vDup></dup>`)
      .join('');
    const cobr = `<cobr><fat><nFat>${numero}</nFat><vOrig>${f2(tot.vNF)}</vOrig><vDesc>0.00</vDesc><vLiq>${f2(tot.vNF)}</vLiq></fat>${dups}</cobr>`;
    if (!xml.includes('<pag>')) throw new FiscalError('XML sem grupo <pag> para inserir a cobrança', 'XML_COBR');
    xml = xml.replace('<pag>', `${cobr}<pag>`);
  }
  const chave = xml.match(/Id="NFe(\d{44})"/)?.[1] || null;
  return { xml, modelo: 55, serie, numero, chave, tpAmb, aliqIcms: aliqNota, dhEmi, totais: tot, cfops, cenario: cen };
}

function limparUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

// ─── Envio, consulta e cancelamento ──────────────────────────────────────────
function parseRetorno(objOuXml) {
  return typeof objOuXml === 'string' ? xml2json(objOuXml) : Promise.resolve(objOuXml);
}

const val = (o, ...ks) => ks.reduce((a, k) => (a == null ? a : a[k]), o);

// Assina e envia (síncrono). Retorna { autorizada, cStat, xMotivo, nProt, dhRecbto, xmlAssinado, xmlProc, qrCode, urlChave }
export async function assinarEEnviar({ xml, modelo, emit, cfg, cert }) {
  if (Number(modelo) === 65) {
    const csc = cscDe(cfg);
    if (!csc.id || !csc.token) {
      throw new FiscalError(
        `CSC (id + token) de ${Number(cfg.ambiente) === 1 ? 'produção' : 'homologação'} não configurado para a empresa ${cfg.empresa} — obrigatório para o QR Code da NFC-e`,
        'CSC_MISSING',
      );
    }
  }
  const tools = toolsPara({ modelo, uf: emit.uf, cfg, cert, cnpj: emit.cnpj });
  let xmlAssinado;
  try {
    xmlAssinado = await tools.xmlSign(xml);
  } catch (e) {
    throw new FiscalError(`Falha ao assinar o XML: ${e?.message || e}`, 'SIGN_ERROR');
  }
  const qrCode = xmlAssinado.match(/<qrCode>(.*?)<\/qrCode>/)?.[1]?.replace(/&amp;/g, '&') || null;
  const urlChave = xmlAssinado.match(/<urlChave>(.*?)<\/urlChave>/)?.[1] || null;

  let retornoXml;
  try {
    retornoXml = await tools.sefazEnviaLote(xmlAssinado, { idLote: Date.now() % 1000000000, indSinc: 1 });
  } catch (e) {
    throw new FiscalError(`Falha na comunicação com a SEFAZ: ${e?.message || e}`, 'SEFAZ_UNREACHABLE', { xmlAssinado });
  }
  const ret = await parseRetorno(retornoXml);
  const r = ret.retEnviNFe || ret;
  const cStatLote = String(val(r, 'cStat') ?? '');
  const prot = val(r, 'protNFe', 'infProt');
  const cStat = String(val(prot, 'cStat') ?? cStatLote);
  const xMotivo = val(prot, 'xMotivo') ?? val(r, 'xMotivo') ?? '';
  const nProt = val(prot, 'nProt') ? String(val(prot, 'nProt')) : null;
  const dhRecbto = val(prot, 'dhRecbto') || null;
  const autorizada = cStat === '100' || cStat === '150';

  let xmlProc = null;
  if (autorizada) {
    const protXml = retornoXml.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] || '';
    const nfeSemDecl = xmlAssinado.replace(/^<\?xml[^>]*\?>/, '');
    xmlProc = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nfeSemDecl}${protXml.replace(/ xmlns="[^"]*"/, '').replace('<protNFe', '<protNFe xmlns="http://www.portalfiscal.inf.br/nfe"')}</nfeProc>`;
  }
  return { autorizada, cStat, cStatLote, xMotivo, nProt, dhRecbto, xmlAssinado, xmlProc, qrCode, urlChave, retornoBruto: retornoXml };
}

// ─── Webservices da SEFAZ sem xmllint ────────────────────────────────────────
// Os métodos sefazEvento / consultarNFe / sefazStatus da node-sped-nfe validam
// o XML com o binário externo `xmllint` ANTES de enviar. Quando ele não existe
// (Windows e boa parte das imagens Linux), a lib rejeita com uma STRING — o que
// pendurava a requisição. Só a emissão (sefazEnviaLote) não passa por ali, por
// isso ela funcionava e cancelar/consultar/status travavam.
//
// Aqui montamos e enviamos o SOAP por conta própria, com timeout explícito. A
// tabela oficial de URLs da lib é reaproveitada, carregada por caminho de
// arquivo porque o package.json dela não exporta subcaminhos.
const SOAP_TIMEOUT_MS = Number(process.env.SEFAZ_TIMEOUT_MS || 45000);

let urlEventosFn = null;
async function tabelaUrlsSefaz() {
  if (urlEventosFn) return urlEventosFn;
  const [{ createRequire }, { pathToFileURL }, path] = await Promise.all([
    import('node:module'),
    import('node:url'),
    import('node:path'),
  ]);
  const req = createRequire(import.meta.url);
  const dir = path.dirname(req.resolve('node-sped-nfe'));
  const mod = await import(pathToFileURL(path.join(dir, 'utils', 'eventos.js')).href);
  urlEventosFn = mod.urlEventos;
  return urlEventosFn;
}

async function urlWs({ uf, modelo, ambiente, servico }) {
  const urlEventos = await tabelaUrlsSefaz();
  const tabela = urlEventos(uf, '4.00');
  const url = tabela?.[`mod${modelo}`]?.[Number(ambiente) === 1 ? 'producao' : 'homologacao']?.[servico];
  if (!url) {
    throw new FiscalError(
      `Webservice ${servico} não encontrado para ${uf} / modelo ${modelo}`,
      'WS_NOT_FOUND',
    );
  }
  return url;
}

function postSoap({ url, xml, pem, timeoutMs = SOAP_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const alvo = new URL(url);
    const corpo = Buffer.from(xml, 'utf8');
    const req = https.request(
      {
        hostname: alvo.hostname,
        port: alvo.port || 443,
        path: `${alvo.pathname}${alvo.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': corpo.length,
        },
        key: pem.key,
        cert: pem.cert,
        ca: pem.ca,
        rejectUnauthorized: false,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          if (res.statusCode >= 400 && !/<\w*:?ret/i.test(data)) {
            reject(
              new FiscalError(
                `SEFAZ respondeu HTTP ${res.statusCode} em ${alvo.hostname}: ${String(data).replace(/\s+/g, ' ').slice(0, 200)}`,
                'SEFAZ_HTTP_ERROR',
              ),
            );
            return;
          }
          resolve(data);
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(
        new FiscalError(
          `A SEFAZ (${alvo.hostname}) não respondeu em ${Math.round(timeoutMs / 1000)}s`,
          'SEFAZ_TIMEOUT',
        ),
      );
    });
    req.on('error', (e) =>
      reject(
        e instanceof FiscalError
          ? e
          : new FiscalError(`Falha de comunicação com a SEFAZ: ${e.message}`, 'SEFAZ_UNREACHABLE'),
      ),
    );
    req.write(corpo);
    req.end();
  });
}

// Descasca o envelope SOAP e devolve o nó da resposta (retEnvEvento, etc.)
async function corpoSoap(xml, raiz) {
  const json = await xml2json(xml);
  const achar = (no, prof = 0) => {
    if (!no || typeof no !== 'object' || prof > 12) return null;
    if (no[raiz] !== undefined) return no[raiz];
    for (const k of Object.keys(no)) {
      if (k.startsWith('@') || k === '#text') continue;
      const r = achar(no[k], prof + 1);
      if (r) return r;
    }
    return null;
  };
  return { corpo: achar(json), json };
}

const envelopar = (wsdl, conteudo) =>
  json2xml({
    'soap:Envelope': {
      '@xmlns:soap': 'http://www.w3.org/2003/05/soap-envelope',
      '@xmlns:nfe': `http://www.portalfiscal.inf.br/nfe/wsdl/${wsdl}`,
      'soap:Body': {
        'nfe:nfeDadosMsg': { ...conteudo, '@xmlns': `http://www.portalfiscal.inf.br/nfe/wsdl/${wsdl}` },
      },
    },
  });

// Consulta a situação da nota na SEFAZ pela chave de acesso
export async function consultarChave({ chave, modelo, emit, cfg, cert }) {
  const tools = toolsPara({ modelo, uf: emit.uf, cfg, cert, cnpj: emit.cnpj });
  const pem = await tools.getCertificado();
  const url = await urlWs({ uf: emit.uf, modelo, ambiente: cfg.ambiente, servico: 'NFeConsultaProtocolo' });
  const xml = await envelopar('NFeConsultaProtocolo4', {
    consSitNFe: {
      '@xmlns': 'http://www.portalfiscal.inf.br/nfe',
      '@versao': '4.00',
      tpAmb: Number(cfg.ambiente),
      xServ: 'CONSULTAR',
      chNFe: chave,
    },
  });
  const retorno = await postSoap({ url, xml, pem });
  const { corpo } = await corpoSoap(retorno, 'retConsSitNFe');
  const r = corpo || {};
  const prot = val(r, 'protNFe', 'infProt');
  const evts = r.procEventoNFe ? [].concat(r.procEventoNFe) : [];
  const cancelada =
    String(val(r, 'cStat')) === '101' ||
    evts.some((e) => ['110111', '110112'].includes(String(val(e, 'evento', 'infEvento', 'tpEvento'))));
  return {
    cStat: String(val(r, 'cStat') ?? ''),
    xMotivo: val(r, 'xMotivo') || '',
    nProt: val(prot, 'nProt') ? String(val(prot, 'nProt')) : null,
    cancelada,
    bruto: retorno,
  };
}

// Evento de cancelamento (110111)
export async function cancelarNota({ chave, nProt, justificativa, modelo, emit, cfg, cert, nSeqEvento = 1 }) {
  const just = semAcento(justificativa || '').trim();
  if (just.length < 15) {
    throw new FiscalError('Justificativa deve ter ao menos 15 caracteres', 'CANCEL_JUST_SHORT');
  }
  if (!chave || digits(chave).length !== 44) {
    throw new FiscalError('Nota sem chave de acesso válida', 'CANCEL_NO_KEY');
  }
  if (!nProt) {
    throw new FiscalError(
      'Nota sem protocolo de autorização — use "Consultar SEFAZ" antes de cancelar',
      'CANCEL_NO_PROTOCOL',
    );
  }

  const tools = toolsPara({ modelo, uf: emit.uf, cfg, cert, cnpj: emit.cnpj });
  const pem = await tools.getCertificado();
  const evento = {
    envEvento: {
      '@xmlns': 'http://www.portalfiscal.inf.br/nfe',
      '@versao': '1.00',
      idLote: String(Date.now()).slice(-15),
      evento: {
        '@xmlns': 'http://www.portalfiscal.inf.br/nfe',
        '@versao': '1.00',
        infEvento: {
          '@Id': `ID110111${digits(chave)}${String(nSeqEvento).padStart(2, '0')}`,
          cOrgao: digits(chave).substring(0, 2),
          tpAmb: Number(cfg.ambiente),
          CNPJ: emit.cnpj,
          chNFe: digits(chave),
          dhEvento: agoraBrasil(),
          tpEvento: '110111',
          nSeqEvento: Number(nSeqEvento),
          verEvento: '1.00',
          detEvento: {
            '@versao': '1.00',
            descEvento: 'Cancelamento',
            nProt: String(nProt),
            xJust: just.slice(0, 255),
          },
        },
      },
    },
  };

  let assinado;
  try {
    assinado = await tools.xmlSign(await json2xml(evento), { tag: 'infEvento' });
  } catch (e) {
    throw new FiscalError(
      `Falha ao assinar o evento de cancelamento: ${e?.message || e}`,
      'CANCEL_SIGN_ERROR',
    );
  }

  const url = await urlWs({ uf: emit.uf, modelo, ambiente: cfg.ambiente, servico: 'NFeRecepcaoEvento' });
  const xml = await envelopar('NFeRecepcaoEvento4', await xml2json(assinado));
  const retorno = await postSoap({ url, xml, pem });

  const { corpo } = await corpoSoap(retorno, 'retEnvEvento');
  const r = corpo || {};
  const inf = val(r, 'retEvento', 'infEvento') || val([].concat(r.retEvento || [])[0], 'infEvento');
  const cStat = String(val(inf, 'cStat') ?? val(r, 'cStat') ?? '');
  // 135 = cancelamento homologado, 155 = homologado fora de prazo
  return {
    ok: cStat === '135' || cStat === '155',
    cStat,
    xMotivo: val(inf, 'xMotivo') || val(r, 'xMotivo') || '',
    nProt: val(inf, 'nProt') ? String(val(inf, 'nProt')) : null,
    dhRegEvento: val(inf, 'dhRegEvento') || null,
    xmlEvento: assinado,
    bruto: retorno,
  };
}

// Status do serviço na SEFAZ
export async function statusSefaz({ modelo, emit, cfg, cert }) {
  const tools = toolsPara({ modelo, uf: emit.uf, cfg, cert, cnpj: emit.cnpj });
  const pem = await tools.getCertificado();
  const url = await urlWs({ uf: emit.uf, modelo, ambiente: cfg.ambiente, servico: 'NFeStatusServico' });
  const xml = await envelopar('NFeStatusServico4', {
    consStatServ: {
      '@xmlns': 'http://www.portalfiscal.inf.br/nfe',
      '@versao': '4.00',
      tpAmb: Number(cfg.ambiente),
      cUF: UF2cUF[emit.uf],
      xServ: 'STATUS',
    },
  });
  const retorno = await postSoap({ url, xml, pem });
  const { corpo } = await corpoSoap(retorno, 'retConsStatServ');
  const r = corpo || {};
  return {
    cStat: String(val(r, 'cStat') ?? ''),
    xMotivo: val(r, 'xMotivo') || '',
    tMed: val(r, 'tMed') || null,
    bruto: retorno,
  };
}

export function limparCache() {
  cache.clear();
}

// Reaproveitados pela manifestação do destinatário (services/sefazManifestacao.js)
export { postSoap, corpoSoap, envelopar, urlWs };
