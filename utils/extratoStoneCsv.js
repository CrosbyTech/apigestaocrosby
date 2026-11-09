// ============================================================
// EXTRATO STONE EM CSV (export do app/portal Stone)
//
// Cabeçalho: Movimentação,Tipo,Valor,Saldo antes,Saldo depois,Tarifa,Data,
//   Horário,Situação,Nosso Número,Destino,Destino Documento,Destino Instituição,
//   Destino Agência,Destino Conta,Origem,Origem Documento,Origem Instituição,
//   Origem Agência,Origem Conta,Descrição
// Linhas da mais nova para a mais antiga. "Valor" é o BRUTO; a tarifa
// ("Tarifa", ex. R$ 1,99 do boleto, R$ 0,95 do Pix da maquininha) sai do saldo
// junto — como no PDF, viramos a tarifa num lançamento próprio.
//
// Memos no formato do PDF/OFX ("NOME - Transferência | Pix",
// "Recebimento vendas - Antecipação"...) para o classificador Stone existente.
// Visto no CSV da Brejinho (04/11/2026, enviado pelo João):
//   Transferência entre contas Stone vinda de "Stone Principal" = depósito de
//   ANTECIPAÇÃO (≈03h); "Recebível de Cartão" = liquidação normal de cartão;
//   "Transação" crédito com tarifa = Pix da maquininha; "Pagamento" crédito
//   com Nosso Número = boleto recebido.
// ============================================================
import { montarExtrato, classificarStoneNormalizado } from './extratosBancariosPdf.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const desconhecido = (s) => !s || /^desconhecid/i.test(limpar(s));

// "1.234,56" | "-334,19" | "R$ 1,99" | "Grátis" → número
function valorBr(s) {
  const t = String(s ?? '').replace(/R\$\s*/i, '').trim();
  if (!t || /gr[aá]tis/i.test(t)) return 0;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// CSV com aspas (valores "1.234,56" vêm entre aspas por causa da vírgula)
function parseCsv(texto) {
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo);
      campo = '';
      if (linha.some((x) => x !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  if (campo !== '' || linha.length) {
    linha.push(campo);
    if (linha.some((x) => x !== '')) linhas.push(linha);
  }
  return linhas;
}

const textoDoBuffer = (buffer) => {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let t = b.toString('utf8');
  if (t.includes('�')) t = b.toString('latin1');
  return t.replace(/^﻿/, '');
};

/** O buffer é o CSV de extrato da Stone? */
export function ehCsvStone(buffer) {
  try {
    const head = semAcento(textoDoBuffer(Buffer.from(buffer).slice(0, 2000))).toLowerCase();
    return /^movimentacao,tipo,valor,saldo antes,saldo depois,tarifa,data/.test(head.trim());
  } catch {
    return false;
  }
}

function memoDaLinha(r, credito) {
  const tipo = semAcento(r.tipo).toLowerCase();
  const origem = desconhecido(r.origem) ? null : limpar(r.origem);
  const destino = desconhecido(r.destino) ? null : limpar(r.destino);
  const outro = credito ? origem : destino;
  if (tipo === 'pix') return `${outro || 'PIX'} - ${/devolu/i.test(r.situacao) ? 'Devolução' : 'Transferência'} | Pix`;
  if (tipo.startsWith('transferencia entre contas stone')) {
    if (credito && /^stone principal$/i.test(origem || '')) return 'Recebimento vendas - Antecipação';
    return `${outro || 'CONTA STONE'} - Transferência | Conta Stone`;
  }
  if (tipo.startsWith('recebivel de cartao')) return 'Recebimento vendas - Cartão';
  if (tipo === 'pagamento') return credito ? 'Depósito por boleto' : `${outro || 'PAGAMENTO'} - Pagamento`;
  if (tipo.startsWith('pagamento com cartao stone')) return `${outro || 'CARTÃO'} - Crédito | Pré-pago`;
  if (tipo.startsWith('devolucao') && /cartao stone/.test(tipo)) return `${outro || 'CARTÃO'} - Estorno | Cartão`;
  if (tipo === 'transacao') return credito ? `${outro || 'CLIENTE'} - Pix | Maquininha` : `${outro || 'Transação'} - Transação`;
  if (/tarifa/.test(tipo)) return 'Cobrança de tarifa - Tarifa';
  if (/mensalidade|aluguel/.test(tipo)) return 'Mensalidade - Maquininha Stone';
  return limpar(`${r.tipo}${outro ? ` - ${outro}` : ''}`) || 'Lançamento Stone';
}

/**
 * Lê o CSV de extrato da Stone e devolve o mesmo objeto de extrato do PDF
 * (montarExtrato). Conta/titular saem das colunas Destino/Origem do lado da
 * própria conta (instituição "Stone Instituição de Pagamento", com conta).
 */
export function lerExtratoStoneCsv(buffer, { nomeArquivo } = {}) {
  const linhas = parseCsv(textoDoBuffer(buffer));
  if (linhas.length < 2) throw new Error('CSV da Stone vazio.');
  const cab = linhas[0].map((h) => semAcento(h).toLowerCase().trim());
  const idx = (nome) => cab.indexOf(nome);
  const col = {
    mov: idx('movimentacao'),
    tipo: idx('tipo'),
    valor: idx('valor'),
    saldoAntes: idx('saldo antes'),
    saldoDepois: idx('saldo depois'),
    tarifa: idx('tarifa'),
    data: idx('data'),
    horario: idx('horario'),
    situacao: idx('situacao'),
    nossoNumero: idx('nosso numero'),
    destino: idx('destino'),
    destinoDoc: idx('destino documento'),
    destinoInst: idx('destino instituicao'),
    destinoAg: idx('destino agencia'),
    destinoConta: idx('destino conta'),
    origem: idx('origem'),
    origemDoc: idx('origem documento'),
    origemInst: idx('origem instituicao'),
    origemAg: idx('origem agencia'),
    origemConta: idx('origem conta'),
    descricao: idx('descricao'),
  };
  if (col.valor < 0 || col.data < 0) throw new Error('CSV sem as colunas Valor/Data do extrato Stone.');
  const g = (l, k) => (col[k] >= 0 ? l[col[k]] ?? '' : '');

  const regs = linhas.slice(1).map((l, i) => {
    const valor = valorBr(g(l, 'valor'));
    const credito = valor >= 0 && !/^d[eé]bito/i.test(g(l, 'mov'));
    const [d, hm] = String(g(l, 'data')).trim().split(/\s+/);
    const [dd, mm, yy] = String(d || '').split('/');
    return {
      linhaCsv: i,
      credito,
      valor,
      tarifa: valorBr(g(l, 'tarifa')),
      saldoAntes: valorBr(g(l, 'saldoAntes')),
      saldoDepois: valorBr(g(l, 'saldoDepois')),
      data: yy && mm && dd ? `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : null,
      hora: (hm || '').slice(0, 5) || null,
      horario: String(g(l, 'horario') || hm || ''),
      tipo: g(l, 'tipo'),
      situacao: g(l, 'situacao'),
      nossoNumero: limpar(g(l, 'nossoNumero')) || null,
      destino: g(l, 'destino'),
      destinoDoc: g(l, 'destinoDoc'),
      destinoInst: g(l, 'destinoInst'),
      destinoAg: g(l, 'destinoAg'),
      destinoConta: g(l, 'destinoConta'),
      origem: g(l, 'origem'),
      origemDoc: g(l, 'origemDoc'),
      origemInst: g(l, 'origemInst'),
      origemAg: g(l, 'origemAg'),
      origemConta: g(l, 'origemConta'),
      descricao: limpar(g(l, 'descricao')),
    };
  }).filter((r) => r.data && r.valor !== 0 && !/cancel|falh|recusad|rejeit/i.test(r.situacao));

  // titular = o lado "conta própria" (débito → origem; crédito → destino)
  const contaPropria = regs
    .map((r) => (r.credito
      ? { nome: r.destino, doc: r.destinoDoc, inst: r.destinoInst, ag: r.destinoAg, conta: r.destinoConta }
      : { nome: r.origem, doc: r.origemDoc, inst: r.origemInst, ag: r.origemAg, conta: r.origemConta }))
    .find((c) => /stone/i.test(c.inst) && soDigitos(c.conta).length >= 4);
  if (!contaPropria) throw new Error('Não achei a conta Stone do titular no CSV (colunas Destino/Origem Conta).');
  const contaTxt = String(contaPropria.conta);
  const [contaNum, dv] = contaTxt.includes('-') ? contaTxt.split('-') : [contaTxt.slice(0, -1), contaTxt.slice(-1)];
  const titular = {
    nome: limpar(contaPropria.nome) || null,
    cnpj: soDigitos(contaPropria.doc) || null,
    agencia: (soDigitos(contaPropria.ag) || '1').padStart(4, '0'),
    conta: soDigitos(contaNum),
    contaDv: soDigitos(dv) || null,
  };

  // cronológico: data + horário (ms); empate → ordem inversa do CSV (mais nova em cima)
  regs.sort((a, b) =>
    a.data !== b.data ? (a.data < b.data ? -1 : 1)
      : a.horario !== b.horario ? (a.horario < b.horario ? -1 : 1)
        : b.linhaCsv - a.linhaCsv);

  const lancamentos = [];
  for (const r of regs) {
    const memo = memoDaLinha(r, r.credito);
    const docOutro = soDigitos(r.credito ? r.origemDoc : r.destinoDoc);
    const instOutro = r.credito ? r.origemInst : r.destinoInst;
    const temTarifa = r.tarifa > 0 && Math.abs(round2(r.saldoAntes + r.valor - r.saldoDepois) - r.tarifa) < 0.011;
    const base = {
      pagina: null,
      data: r.data,
      hora: r.hora,
      valor: round2(r.valor),
      saldoApos: temTarifa ? round2(r.saldoAntes + r.valor) : round2(r.saldoDepois),
      memo,
      bancoContraparte: desconhecido(instOutro) ? null : limpar(instOutro),
      documento: r.nossoNumero,
    };
    const cls = classificarStoneNormalizado(base);
    lancamentos.push({
      ...base,
      ...cls,
      documento: base.documento,
      contraparteDoc: docOutro.length === 11 || docOutro.length === 14 ? docOutro : null,
    });
    if (temTarifa) {
      const t = { pagina: null, data: r.data, hora: r.hora, valor: -round2(r.tarifa), saldoApos: round2(r.saldoDepois), memo: `Cobrança de tarifa - Tarifa | ${limpar(r.tipo)}`, bancoContraparte: null, documento: null };
      lancamentos.push({ ...t, ...classificarStoneNormalizado(t), documento: null });
    }
  }

  const primeiro = regs[0];
  const ultimo = regs.at(-1);
  return montarExtrato(
    'STONE',
    {
      titular,
      periodo: { inicio: primeiro?.data || null, fim: ultimo?.data || null },
      saldoInicial: primeiro ? round2(primeiro.saldoAntes) : null,
      saldoFinalInformado: ultimo ? round2(ultimo.saldoDepois) : null,
      lancamentos,
      avisos: ['Importado do CSV de extrato da Stone.'],
    },
    { nomeArquivo: nomeArquivo || null, paginas: 0 },
  );
}

/**
 * Linhas cruas do CSV da Stone (para conciliar entradas pela planilha — João,
 * 09/11/2026): [{ credito, valor, data, horario, tipo, situacao, origem,
 * origemDoc, origemInst, destino, destinoDoc, destinoConta, contaPropria }].
 */
export function linhasExtratoStoneCsv(buffer) {
  const linhas = parseCsv(textoDoBuffer(buffer));
  if (linhas.length < 2) return [];
  const cab = linhas[0].map((h) => semAcento(h).toLowerCase().trim());
  const ix = (n) => cab.indexOf(n);
  const g = (l, n) => (ix(n) >= 0 ? l[ix(n)] ?? '' : '');
  return linhas.slice(1).map((l) => {
    const valor = valorBr(g(l, 'valor'));
    const credito = valor >= 0 && !/^d[eé]bito/i.test(g(l, 'movimentacao'));
    const [d, hm] = String(g(l, 'data')).trim().split(/\s+/);
    const [dd, mm, yy] = String(d || '').split('/');
    return {
      credito,
      valor: round2(valor),
      data: yy && mm && dd ? `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : null,
      hora: (hm || '').slice(0, 5) || null,
      horario: String(g(l, 'horario') || hm || ''),
      tipo: limpar(g(l, 'tipo')),
      situacao: limpar(g(l, 'situacao')),
      origem: limpar(g(l, 'origem')),
      origemDoc: soDigitos(g(l, 'origem documento')),
      origemInst: limpar(g(l, 'origem instituicao')),
      destino: limpar(g(l, 'destino')),
      destinoDoc: soDigitos(g(l, 'destino documento')),
      contaPropria: soDigitos(credito ? g(l, 'destino conta') : g(l, 'origem conta')),
    };
  }).filter((r) => r.data && r.valor !== 0);
}
