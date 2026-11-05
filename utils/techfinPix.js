// ============================================================
// Relatórios da Techfin Pagamentos (intermediadora do Pix TOTVS)
// ------------------------------------------------------------
// O QR Code gerado no TOTVS é liquidado pela Fiserv/Techfin, que desconta
// R$ 0,79 por Pix e REPASSA o líquido, algumas vezes por dia, para a conta
// Stone da loja ou para a Sicredi central. No extrato bancário cada repasse
// é um crédito só ("RECEBIMENTO PIX … FISERV" / "RECEBIMENTO PIX CROSBY CR
// VESTUAR"). Dois relatórios do portal da Techfin, ambos CSV com ';':
//
//  1) "Relatório de Transações" (venda a venda): uma linha por Pix com
//     Unidade de Negócio (CNPJ), Data de Pagamento, Data de Liquidação, Valor,
//     Valor Pago, Taxa, Depositado, ID do Repasse (E-id do Pix de repasse),
//     Banco/Agência/Conta de destino, NSU (E-id do Pix do cliente).
//
//  2) Extrato da conta Techfin de uma loja ("Apelido da conta: STONE MIDWAY"):
//     linhas Cobrança (+bruto), Tarifa (−0,79) e Repasse (−líquido, NSU = E-id
//     do repasse). As cobranças de um repasse são as acumuladas desde o
//     repasse anterior; quando a soma não bate (o corte pegou só parte), o
//     subconjunto que fecha o valor é escolhido e o resto fica para o próximo.
//
// Os dois formatos viram o mesmo modelo:
//   pix:      { nsu, cnpj, dataPagamento, valor (bruto), taxa, liquido, repasseId, identificador, pagador }
//   repasses: { id, cnpj, apelido, conta: {banco, agencia, numero}|null, dataLiquidacao, valor (líquido), pix: [nsu] }
// ============================================================

const num = (s) => {
  const t = String(s ?? '').trim();
  if (!t) return 0;
  // "1.234,56" ou "1234,56" ou "0.79"
  if (/,\d{1,2}$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  return Number(t.replace(',', '.'));
};
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
// "31/10/2026 21:02:28" → "2026-10-31T21:02:28"
const dataHora = (s) => {
  const m = String(s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00:00:00'}`;
};

export function decodificar(buffer) {
  if (typeof buffer === 'string') return buffer.replace(/^﻿/, '');
  const utf8 = buffer.toString('utf8');
  const txt = utf8.includes('�') ? buffer.toString('latin1') : utf8;
  return txt.replace(/^﻿/, '');
}

export function detectarTechfin(texto) {
  const cab = texto.slice(0, 4000);
  if (/Unidade de Neg/i.test(cab) && /ID do Repasse/i.test(cab) && /Depositado/i.test(cab)) return 'transacoes';
  if (/Apelido da conta/i.test(cab) && /Data da transa/i.test(cab) && /Tipo de transa/i.test(cab)) return 'conta';
  return null;
}

const linhasCsv = (texto) => texto.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());

// ─── 1) Relatório de Transações ───────────────────────────────
function interpretarTransacoes(texto) {
  const ls = linhasCsv(texto);
  const cab = ls[0].split(';').map((s) => s.trim());
  const col = (nome) => cab.findIndex((c) => c.toLowerCase().startsWith(nome.toLowerCase()));
  const iCnpj = col('Unidade de Neg');
  const iPag = col('Data de Pagamento');
  const iLiq = col('Data de Liquida');
  const iIdent = col('Identificador');
  const iValorPago = col('Valor Pago');
  const iTaxa = col('Taxa');
  const iDep = col('Depositado');
  const iStPag = col('Status do Pagamento');
  const iStLiq = col('Status da Liquida');
  const iRep = col('ID do Repasse');
  const iConta = col('Banco/Ag');
  const iNsu = col('NSU');
  const iPagador = col('Nome Pagador');
  if ([iCnpj, iPag, iValorPago, iRep, iNsu].some((i) => i < 0)) throw new Error('Relatório de Transações da Techfin sem as colunas esperadas.');
  const pix = [];
  const repasses = new Map();
  let ignorados = 0;
  for (const l of ls.slice(1)) {
    const v = l.split(';').map((s) => s.trim());
    if (v.length < cab.length - 2) continue;
    const stPag = iStPag >= 0 ? v[iStPag] : '';
    const stLiq = iStLiq >= 0 ? v[iStLiq] : '';
    const repasseId = v[iRep] || null;
    if ((stPag && !/aprovad/i.test(stPag)) || (stLiq && !/liquidad/i.test(stLiq)) || !repasseId) {
      ignorados++;
      continue;
    }
    const valor = round2(num(v[iValorPago]));
    const taxa = iTaxa >= 0 ? round2(num(v[iTaxa])) : 0.79;
    const liquido = iDep >= 0 && v[iDep] ? round2(num(v[iDep])) : round2(valor - taxa);
    const cnpj = soDigitos(v[iCnpj]);
    const p = {
      nsu: v[iNsu] || null,
      identificador: iIdent >= 0 ? v[iIdent] || null : null,
      cnpj,
      dataPagamento: dataHora(v[iPag]),
      dataLiquidacao: iLiq >= 0 ? dataHora(v[iLiq]) : null,
      valor,
      taxa,
      liquido,
      repasseId,
      pagador: iPagador >= 0 ? v[iPagador] || null : null,
    };
    pix.push(p);
    if (!repasses.has(repasseId)) {
      const partes = (iConta >= 0 ? v[iConta] : '').split('/').map((s) => s.trim());
      const conta = partes.length === 3 && partes.every((x) => x && x !== '-') ? { banco: soDigitos(partes[0]), agencia: soDigitos(partes[1]), numero: soDigitos(partes[2]) } : null;
      repasses.set(repasseId, { id: repasseId, cnpj, cnpjs: new Set(), apelido: null, conta, dataLiquidacao: p.dataLiquidacao, valor: 0, pix: [] });
    }
    const r = repasses.get(repasseId);
    r.valor = round2(r.valor + liquido);
    r.pix.push(p.nsu);
    r.cnpjs.add(cnpj);
    if (p.dataLiquidacao && (!r.dataLiquidacao || p.dataLiquidacao > r.dataLiquidacao)) r.dataLiquidacao = p.dataLiquidacao;
  }
  return {
    formato: 'transacoes',
    apelido: null,
    pix,
    repasses: [...repasses.values()].map((r) => ({ ...r, cnpjs: [...r.cnpjs] })),
    ignorados,
  };
}

// ─── 2) Extrato da conta Techfin da loja ──────────────────────
// subconjunto de cobranças (líquidas) que soma exatamente o repasse
function subconjuntoQueFecha(itens, alvoCents, maxNos = 200000) {
  const pool = itens.map((it, i) => ({ i, cents: Math.round(it.liquido * 100) })).filter((x) => x.cents > 0 && x.cents <= alvoCents).sort((a, b) => b.cents - a.cents);
  const sufixo = new Array(pool.length + 1).fill(0);
  for (let i = pool.length - 1; i >= 0; i--) sufixo[i] = sufixo[i + 1] + pool[i].cents;
  let best = null;
  let nos = 0;
  const dfs = (i, resto, esc) => {
    if (best || nos++ > maxNos) return;
    if (resto === 0) {
      best = [...esc];
      return;
    }
    if (i >= pool.length || resto < 0 || sufixo[i] < resto) return;
    esc.push(pool[i].i);
    dfs(i + 1, resto - pool[i].cents, esc);
    esc.pop();
    if (!best) dfs(i + 1, resto, esc);
  };
  dfs(0, alvoCents, []);
  return best;
}

function interpretarConta(texto) {
  const ls = linhasCsv(texto);
  const apelido = (ls.find((l) => /^Apelido da conta/i.test(l)) || '').split(';')[1]?.trim() || null;
  const iCab = ls.findIndex((l) => /^Data da transa/i.test(l));
  if (iCab < 0) throw new Error('Extrato da conta Techfin sem o cabeçalho das transações.');
  const rows = [];
  for (const l of ls.slice(iCab + 1)) {
    if (/^(Total de|Saldo)/i.test(l)) continue;
    const v = l.split(';').map((s) => s.trim());
    if (v.length < 4 || !dataHora(v[0])) continue;
    rows.push({ dh: dataHora(v[0]), tipo: v[1], cnpj: soDigitos(v[2]), valor: round2(num(v[3])), nsu: v[4] || null, proc: v[5] || null });
  }
  // ordem cronológica; num mesmo instante, cobrança/tarifa antes do repasse
  const peso = (t) => (/repasse/i.test(t) ? 1 : 0);
  rows.sort((a, b) => a.dh.localeCompare(b.dh) || peso(a.tipo) - peso(b.tipo));
  const tarifas = new Map(); // nsu → taxa
  for (const r of rows) if (/tarifa/i.test(r.tipo) && r.nsu) tarifas.set(r.nsu, round2((tarifas.get(r.nsu) || 0) + Math.abs(r.valor)));
  const pix = [];
  const repasses = [];
  let pendentes = []; // cobranças ainda sem repasse
  const avisos = [];
  for (const r of rows) {
    if (/cobran/i.test(r.tipo)) {
      const taxa = tarifas.has(r.nsu) ? tarifas.get(r.nsu) : 0.79;
      const p = { nsu: r.nsu, identificador: r.proc || null, cnpj: r.cnpj, dataPagamento: r.dh, dataLiquidacao: null, valor: Math.abs(r.valor), taxa, liquido: round2(Math.abs(r.valor) - taxa), repasseId: null, pagador: null };
      pix.push(p);
      pendentes.push(p);
    } else if (/repasse/i.test(r.tipo)) {
      const alvo = Math.round(Math.abs(r.valor) * 100);
      const soma = Math.round(pendentes.reduce((s, p) => s + p.liquido, 0) * 100);
      let escolhidos;
      if (soma === alvo) escolhidos = pendentes.map((_, i) => i);
      else escolhidos = subconjuntoQueFecha(pendentes, alvo) || [];
      if (!escolhidos.length) avisos.push(`${apelido || r.cnpj}: repasse de ${r.dh.slice(0, 16).replace('T', ' ')} (R$ ${Math.abs(r.valor).toFixed(2)}) sem cobranças que fechem o valor neste extrato`);
      const set = new Set(escolhidos);
      const doRep = pendentes.filter((_, i) => set.has(i));
      pendentes = pendentes.filter((_, i) => !set.has(i));
      for (const p of doRep) {
        p.repasseId = r.nsu;
        p.dataLiquidacao = r.dh;
      }
      repasses.push({ id: r.nsu, cnpj: r.cnpj, cnpjs: [r.cnpj], apelido, conta: null, dataLiquidacao: r.dh, valor: Math.abs(r.valor), pix: doRep.map((p) => p.nsu), fechou: escolhidos.length > 0 });
    }
  }
  if (pendentes.length) avisos.push(`${apelido || 'conta'}: ${pendentes.length} cobrança(s) ainda sem repasse no fim do extrato (saldo R$ ${pendentes.reduce((s, p) => s + p.liquido, 0).toFixed(2)})`);
  return { formato: 'conta', apelido, pix, repasses, ignorados: 0, avisos };
}

export function interpretarTechfin(buffer) {
  const texto = decodificar(buffer);
  const formato = detectarTechfin(texto);
  if (!formato) throw new Error('Arquivo não reconhecido como relatório da Techfin (Relatório de Transações ou extrato da conta).');
  return formato === 'transacoes' ? interpretarTransacoes(texto) : interpretarConta(texto);
}

/**
 * Junta vários relatórios (transações + extratos de conta) num modelo só:
 * repasses pelo E-id, Pix pelo NSU. O relatório de transações manda nos
 * dados do Pix (tem conta de destino e data de liquidação); o extrato da
 * conta completa o apelido e cobre o que não estiver no outro.
 */
export function mesclarTechfin(lista) {
  const pix = new Map();
  const repasses = new Map();
  const avisos = [];
  const ordenados = [...lista].sort((a, b) => (a.formato === 'transacoes' ? -1 : 1) - (b.formato === 'transacoes' ? -1 : 1));
  for (const rel of ordenados) {
    for (const a of rel.avisos || []) avisos.push(a);
    for (const p of rel.pix) {
      const k = p.nsu || `${p.cnpj}|${p.dataPagamento}|${p.valor}`;
      const atual = pix.get(k);
      if (!atual) pix.set(k, { ...p });
      else {
        if (!atual.repasseId && p.repasseId) atual.repasseId = p.repasseId;
        if (!atual.dataLiquidacao && p.dataLiquidacao) atual.dataLiquidacao = p.dataLiquidacao;
        if (!atual.identificador && p.identificador) atual.identificador = p.identificador;
      }
    }
    for (const r of rel.repasses) {
      const atual = repasses.get(r.id);
      if (!atual) repasses.set(r.id, { ...r, pix: [...r.pix], cnpjs: [...(r.cnpjs || [r.cnpj])] });
      else {
        if (!atual.apelido && r.apelido) atual.apelido = r.apelido;
        if (!atual.conta && r.conta) atual.conta = r.conta;
        if (!atual.dataLiquidacao && r.dataLiquidacao) atual.dataLiquidacao = r.dataLiquidacao;
        for (const n of r.pix) if (!atual.pix.includes(n)) atual.pix.push(n);
      }
    }
  }
  // repasse sem Pix listado pelo relatório de transações mas com Pix que apontam para ele
  for (const p of pix.values()) {
    if (!p.repasseId) continue;
    const r = repasses.get(p.repasseId);
    if (r && !r.pix.includes(p.nsu)) r.pix.push(p.nsu);
  }
  return { pix: [...pix.values()], repasses: [...repasses.values()], avisos };
}

export default { interpretarTechfin, mesclarTechfin, detectarTechfin, decodificar };
