// ============================================================================
// BALANÇO RFID — arquivos de contagem do app Android (Urovo DT50 + RFDT50)
//
//   • salvar a contagem finalizada no app ("ARQUIVO BALANÇO LOJA X DATA HORA")
//   • resumo por produto: o EPC das etiquetas Crosby é SGTIN-96 (prefixo GS1
//     7890009) e carrega o EAN-13 do produto + a série da peça. Decodificamos
//     localmente, agrupamos as peças por EAN e consultamos cada EAN UMA vez no
//     TOTVS (milhares de etiquetas viram algumas centenas de consultas).
// ============================================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, httpAgent, TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';

export class BalancoError extends Error {
  constructor(message, code = 'BALANCO_ERROR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const TABELA = 'balanco_rfid_arquivos';
const EPC_RE = /^[0-9A-F]{8,64}$/;
const MAX_EPCS = 200000;

export function erroMigracao(error) {
  const msg = error?.message || '';
  return /balanco_rfid_arquivos/.test(msg) && /does not exist|schema cache/i.test(msg);
}

// ─── SGTIN-96 → GTIN/EAN ─────────────────────────────────────────────────────
// partição → [bits do prefixo, dígitos do prefixo, bits da referência, dígitos]
const PARTICOES = {
  0: [40, 12, 4, 1],
  1: [37, 11, 7, 2],
  2: [34, 10, 10, 3],
  3: [30, 9, 14, 4],
  4: [27, 8, 17, 5],
  5: [24, 7, 20, 6],
  6: [20, 6, 24, 7],
};

function digitoGtin(corpo) {
  // pesos 3,1,3,1… a partir da direita
  let soma = 0;
  for (let i = corpo.length - 1, p = 3; i >= 0; i--, p = p === 3 ? 1 : 3) soma += Number(corpo[i]) * p;
  return String((10 - (soma % 10)) % 10);
}

export function decodificarSgtin96(epc) {
  const hex = String(epc || '').trim().toUpperCase();
  if (hex.length !== 24 || !hex.startsWith('30')) return null;
  const v = BigInt(`0x${hex}`);
  const bits = (ini, tam) => (v >> BigInt(96 - ini - tam)) & ((1n << BigInt(tam)) - 1n);
  const particao = Number(bits(11, 3));
  const p = PARTICOES[particao];
  if (!p) return null;
  const [cpBits, cpDig, irBits, irDig] = p;
  const prefixo = bits(14, cpBits).toString().padStart(cpDig, '0');
  const referencia = bits(14 + cpBits, irBits).toString().padStart(irDig, '0');
  const serial = bits(58, 38).toString();
  if (prefixo.length !== cpDig || referencia.length !== irDig) return null;
  const indicador = referencia[0];
  const corpo = `${indicador}${prefixo}${referencia.slice(1)}`; // 13 dígitos
  const gtin14 = corpo + digitoGtin(corpo);
  return { gtin14, ean: indicador === '0' ? gtin14.slice(1) : gtin14, serial };
}

// ─── Salvar ──────────────────────────────────────────────────────────────────
function nomeArquivo(empresa, empresaNome, quando) {
  const d = new Date(quando);
  const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Recife', hour: '2-digit', minute: '2-digit' });
  return `ARQUIVO BALANÇO LOJA ${empresa}${empresaNome ? ` - ${String(empresaNome).toUpperCase()}` : ''} ${data} ${hora}`;
}

export async function salvarArquivo(b) {
  const empresa = parseInt(b.empresa, 10);
  if (!empresa) throw new BalancoError('Informe a loja (empresa)', 'INVALID_PAYLOAD');
  if (!Array.isArray(b.epcs)) throw new BalancoError('Lista de EPCs ausente', 'INVALID_PAYLOAD');
  if (b.epcs.length > MAX_EPCS) throw new BalancoError(`Limite de ${MAX_EPCS} etiquetas por arquivo`, 'TOO_MANY');
  const epcs = [...new Set(b.epcs.map((e) => String(e || '').trim().toUpperCase()).filter((e) => EPC_RE.test(e)))];
  if (!epcs.length) throw new BalancoError('Nenhuma etiqueta lida — nada para salvar', 'EMPTY');

  const clientId = b.clientId ? String(b.clientId).slice(0, 80) : null;
  if (clientId) {
    const { data: ja, error } = await supabase.from(TABELA).select('id, nome, qtd_epcs').eq('client_id', clientId).maybeSingle();
    if (error) throw error;
    if (ja) return { ...ja, jaExistia: true };
  }

  const finalizadoEm = b.finalizadoEm ? new Date(b.finalizadoEm) : new Date();
  const iniciadoEm = b.iniciadoEm ? new Date(b.iniciadoEm) : null;
  const registro = {
    client_id: clientId,
    nome: nomeArquivo(empresa, b.empresaNome, finalizadoEm),
    empresa,
    empresa_nome: b.empresaNome || null,
    usuario_id: b.usuario?.id || null,
    usuario_nome: b.usuario?.nome || null,
    usuario_email: b.usuario?.email || null,
    iniciado_em: iniciadoEm && !Number.isNaN(iniciadoEm.getTime()) ? iniciadoEm.toISOString() : null,
    finalizado_em: Number.isNaN(finalizadoEm.getTime()) ? new Date().toISOString() : finalizadoEm.toISOString(),
    duracao_seg: Number.isFinite(Number(b.duracaoSeg)) ? Math.max(0, Math.round(Number(b.duracaoSeg))) : null,
    qtd_epcs: epcs.length,
    qtd_leituras: Math.max(epcs.length, parseInt(b.qtdLeituras, 10) || 0),
    epcs,
    dispositivo: b.dispositivo && typeof b.dispositivo === 'object' ? b.dispositivo : null,
    observacao: b.observacao ? String(b.observacao).slice(0, 500) : null,
  };
  const { data, error } = await supabase.from(TABELA).insert(registro).select('id, nome, qtd_epcs').single();
  if (error) throw error;
  console.log(`📦 [Balanço RFID] ${data.nome}: ${data.qtd_epcs} peça(s) (${registro.usuario_email || 'sem usuário'})`);
  return data;
}

// ─── Resumo por produto ──────────────────────────────────────────────────────
async function produtoPorEan(ean, empresa, token) {
  try {
    const r = await axios.get(`${TOTVS_BASE_URL}/product/v2/products/${encodeURIComponent(ean)}/${empresa}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      httpsAgent,
      httpAgent,
      timeout: 30000,
    });
    const it = r.data?.items?.[0];
    return it
      ? { productCode: it.productCode, nome: it.productName, referencia: it.referenceName || null, cor: it.colorName || null, tamanho: it.sizeName || null }
      : null;
  } catch (e) {
    if (e.response?.status === 400 || e.response?.status === 404) return null;
    throw e;
  }
}

export async function gerarResumo(id, { forcar = false } = {}) {
  const { data: arq, error } = await supabase.from(TABELA).select('id, empresa, epcs, resumo_produtos, resumo_em').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!arq) throw new BalancoError('Arquivo não encontrado', 'NOT_FOUND', 404);
  if (arq.resumo_produtos && !forcar) return { itens: arq.resumo_produtos, resumoEm: arq.resumo_em, cache: true };

  const porEan = new Map();
  const naoDecodificados = [];
  for (const epc of arq.epcs || []) {
    const d = decodificarSgtin96(epc);
    if (!d) {
      naoDecodificados.push(epc);
      continue;
    }
    porEan.set(d.ean, (porEan.get(d.ean) || 0) + 1);
  }

  const tokenData = await getToken();
  const token = tokenData?.access_token;
  if (!token) throw new BalancoError('Não foi possível obter token do TOTVS', 'TOKEN_UNAVAILABLE', 503);

  // consulta os EANs com concorrência limitada
  const eans = [...porEan.keys()];
  const produtos = new Map();
  let idx = 0;
  const trabalhador = async () => {
    while (idx < eans.length) {
      const ean = eans[idx++];
      produtos.set(ean, await produtoPorEan(ean, arq.empresa, token).catch(() => null));
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, eans.length) }, trabalhador));

  const itens = eans
    .map((ean) => ({ ean, qtd: porEan.get(ean), ...(produtos.get(ean) || { productCode: null, nome: null }) }))
    .sort((a, b) => b.qtd - a.qtd || String(a.nome || '').localeCompare(String(b.nome || '')));
  if (naoDecodificados.length) itens.push({ ean: null, nome: 'EPC fora do padrão SGTIN-96', productCode: null, qtd: naoDecodificados.length, epcs: naoDecodificados.slice(0, 500) });

  const resumoEm = new Date().toISOString();
  await supabase.from(TABELA).update({ resumo_produtos: itens, resumo_em: resumoEm }).eq('id', id);
  return { itens, resumoEm, cache: false };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────
export async function gerarCsv(id, tipo = 'epcs') {
  const { data: arq, error } = await supabase.from(TABELA).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!arq) throw new BalancoError('Arquivo não encontrado', 'NOT_FOUND', 404);
  const linhas = [];
  if (tipo === 'produtos') {
    const { itens } = await gerarResumo(id);
    linhas.push('EAN;CODIGO PRODUTO;PRODUTO;REFERENCIA;COR;TAMANHO;QUANTIDADE');
    for (const i of itens) {
      linhas.push([i.ean || '', i.productCode || '', i.nome || '', i.referencia || '', i.cor || '', i.tamanho || '', i.qtd].map((c) => String(c).replace(/;/g, ',')).join(';'));
    }
  } else {
    linhas.push('EPC;EAN;SERIE');
    for (const e of arq.epcs || []) {
      const d = decodificarSgtin96(e);
      linhas.push(`${e};${d?.ean || ''};${d?.serial || ''}`);
    }
  }
  const arquivo = `${arq.nome.replace(/[\\/:*?"<>|]/g, '-')}${tipo === 'produtos' ? ' - PRODUTOS' : ''}.csv`;
  return { arquivo, conteudo: `﻿${linhas.join('\r\n')}\r\n` };
}
