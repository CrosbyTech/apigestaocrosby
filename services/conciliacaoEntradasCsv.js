// ============================================================
// CONCILIAR ENTRADAS PELO CSV DO EXTRATO STONE (João, 09/11/2026)
//
// Contas Stone cujas entradas não fecham pela API de conciliação da Stone
// (ex.: AZ VESTUARIO 0001-03 e IRMAOS VAREJO — o arquivo diário da loja vem
// vazio) ficavam com antecipações/recebíveis pendentes. O CSV exportado do
// app/portal Stone diz de onde veio cada crédito:
//   "Transferência entre contas Stone" de Stone Principal → ANTECIPAÇÃO
//   "Recebível de Cartão"                                  → LIQUIDAÇÃO DE CARTÃO
//   "Pix" de FISERV/CROSBY (o próprio CNPJ)                → PIX DO QR TOTVS
//   "Pix" de terceiros / "Transação"                       → PIX (maquininha/cliente)
// Cada ENTRADA pendente da conta é casada com a linha do CSV de mesma data e
// mesmo valor (1 para 1, na ordem do horário) e conciliada com a justificativa
// tirada da planilha. Só entradas; saídas continuam no fluxo normal.
// ============================================================
import supabase from '../config/supabase.js';
import XLSX from 'xlsx';
import { linhasExtratoStoneCsv } from '../utils/extratoStoneCsv.js';
import { salvarConciliacao, anexarConciliacoes } from './fluxoCaixaConciliacao.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtData = (iso) => String(iso).split('-').reverse().join('/');
const fmtCnpj = (d) => (d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d);

// raízes de CNPJ do grupo: entrada vinda delas é entre contas
const RAIZES_GRUPO = ['17177680', '27728810', '33592092', '53661116'];
const ehDoGrupo = (doc) => !!doc && doc.length === 14 && RAIZES_GRUPO.includes(doc.slice(0, 8));
const fmtDoc = (d) => (d.length === 14 ? fmtCnpj(d) : d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d);

/**
 * Extrato da SICREDI em Excel (.xls/.xlsx do internet banking — João, 09/11/2026):
 * cabeçalho "Associado / Cooperativa / Conta", depois Data | Descrição |
 * Documento | Valor (R$) | Saldo (R$). Para em "Lançamentos Futuros" (agendados).
 */
function linhasExtratoSicrediXls(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  let conta = null;
  let iCab = -1;
  rows.forEach((r, i) => {
    const a = semAcento(String(r[0] || '')).toLowerCase().trim();
    if (a.startsWith('conta') && !conta) conta = soDig(r[1]);
    if (iCab < 0 && a === 'data' && /descri/i.test(semAcento(String(r[1] || '')))) iCab = i;
  });
  if (iCab < 0) return { linhas: [], conta };
  const num = (v) => {
    if (typeof v === 'number') return round2(v);
    const t = String(v || '').trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return round2(Number(t));
    return round2(Number(t.replace(/\./g, '').replace(',', '.')) || 0);
  };
  const out = [];
  for (let i = iCab + 1; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || '').trim();
    if (/lan[cç]amentos futuros/i.test(semAcento(c0))) break;
    const m = c0.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) continue;
    const v = num(r[3]);
    if (!v) continue;
    const descricao = String(r[1] || '').replace(/\s+/g, ' ').trim();
    out.push({ banco: 'SICREDI', credito: v > 0, valor: v, data: `${m[3]}-${m[2]}-${m[1]}`, hora: null, horario: String(i).padStart(5, '0'), tipo: descricao, descricao, documento: String(r[2] || '').trim(), situacao: '', origem: '', origemDoc: '', origemInst: '', contaPropria: conta });
  }
  return { linhas: out, conta };
}

function classificarSicredi(r) {
  const d = semAcento(r.descricao).toUpperCase();
  let m;
  if (/^LIQ\.?\s*COBRANCA/.test(d)) return { rotulo: `Liquidação de boletos da cobrança Sicredi${r.documento ? ` (${r.documento})` : ''}`, categoria: 'BOLETO' };
  if ((m = d.match(/^RECEBIMENTO PIX\s+(\d{11,14})\s+(.*)$/))) {
    const doc = m[1];
    const nome = m[2].trim();
    if (ehDoGrupo(doc)) return { rotulo: `Transferência entre contas do grupo (Pix de ${nome})`, categoria: 'TRANSFERENCIA', origem: nome, origemDoc: doc };
    if (/CREDI ?SHOP/.test(nome)) return { rotulo: `Repasse CrediShop via Pix (${fmtDoc(doc)})`, categoria: 'CREDISHOP', origem: nome, origemDoc: doc };
    return { rotulo: `Pix recebido de ${nome} (${fmtDoc(doc)})`, categoria: 'PIX', origem: nome, origemDoc: doc };
  }
  if (/^RECEBIMENTO PIX/.test(d)) return { rotulo: `Pix recebido — ${r.descricao}`, categoria: 'PIX' };
  if (/^TED/.test(d)) {
    if (/TRIBUNAL DE JUSTICA/.test(d)) return { rotulo: 'TED do Tribunal de Justiça (depósito/alvará judicial)', categoria: 'JUDICIAL' };
    const doc = (d.match(/\b(\d{14})\b/) || [])[1];
    if (ehDoGrupo(doc)) return { rotulo: `Transferência entre contas do grupo (TED ${fmtDoc(doc)})`, categoria: 'TRANSFERENCIA', origemDoc: doc };
    return { rotulo: `TED recebida — ${r.descricao}`, categoria: 'TED' };
  }
  if ((m = d.match(/^REDE\s+(DEBITO|CREDITO|ANTEC(?:IPACAO)?)\s+([A-Z]+).*?\|\s*(\d{4}-\d{2})/))) {
    const tipo = m[1].startsWith('ANTEC') ? 'antecipação' : m[1] === 'DEBITO' ? 'débito' : 'crédito';
    return { rotulo: `Recebimento Rede ${tipo} ${m[2]} (loja ${m[3]})`, categoria: 'REDE' };
  }
  if (/CIELO|GETNET|PAGSEGURO|STONE|SAFRAPAY|SIPAG/.test(d)) return { rotulo: `Recebimento de adquirente — ${r.descricao}`, categoria: 'ADQUIRENTE' };
  return { rotulo: r.descricao, categoria: 'OUTRO' };
}

function classificar(r, cnpjConta) {
  if (r.banco === 'SICREDI') return classificarSicredi(r);
  const tipo = semAcento(r.tipo).toLowerCase();
  if (tipo.startsWith('transferencia entre contas stone') && /stone principal/i.test(r.origem)) return { rotulo: 'Antecipação de recebíveis Stone', categoria: 'ANTECIPACAO' };
  if (tipo.startsWith('recebivel de cartao')) return { rotulo: 'Liquidação de vendas no cartão (Stone)', categoria: 'CARTAO' };
  if (tipo === 'pix' && (/fiserv/i.test(r.origemInst) || (cnpjConta && r.origemDoc === cnpjConta))) return { rotulo: 'Pix do QR Code TOTVS (Fiserv)', categoria: 'PIX_TOTVS' };
  if (tipo === 'pix') return { rotulo: `Pix recebido de ${r.origem || 'terceiro'}`, categoria: 'PIX' };
  if (tipo === 'transacao') return { rotulo: `Pix na maquininha${r.origem ? ` (${r.origem})` : ''}`, categoria: 'PIX_MAQUININHA' };
  if (tipo.startsWith('transferencia entre contas stone')) return { rotulo: `Transferência entre contas Stone de ${r.origem || '?'}`, categoria: 'TRANSFERENCIA' };
  return { rotulo: `${r.tipo}${r.origem ? ` de ${r.origem}` : ''}`, categoria: 'OUTRO' };
}

/**
 * @param {object} p
 * @param {number} p.contaId   conta do Extrato Bancário (fluxo_caixa_contas.id)
 * @param {Buffer} p.buffer    CSV do extrato Stone
 * @param {boolean} [p.simular]
 */
export async function conciliarEntradasPorCsv({ contaId, buffer, usuario = null, simular = false }) {
  const { data: conta, error: eC } = await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,conta,conta_dv,titular_cnpj').eq('id', contaId).maybeSingle();
  if (eC || !conta) throw new Error('Conta não encontrada.');
  // Excel (.xls = OLE D0CF, .xlsx = zip PK) → Sicredi; texto → CSV da Stone
  const ehExcel = buffer.length > 4 && ((buffer[0] === 0xd0 && buffer[1] === 0xcf) || (buffer[0] === 0x50 && buffer[1] === 0x4b));
  const brutas = ehExcel ? linhasExtratoSicrediXls(buffer).linhas : linhasExtratoStoneCsv(buffer);
  const linhas = brutas.filter((r) => r.credito && !/cancel|falh|recusad|rejeit/i.test(r.situacao || ''));
  if (!linhas.length) throw new Error('O arquivo não tem entradas (aceita o CSV do extrato da Stone ou o Excel do extrato da Sicredi).');

  // o CSV tem que ser desta conta (Destino Conta = conta + DV)
  const contaDig = soDig(`${conta.conta}${conta.conta_dv || ''}`);
  const contasCsv = [...new Set(linhas.map((r) => r.contaPropria).filter(Boolean))];
  if (contasCsv.length && !contasCsv.some((c) => c === contaDig || c.endsWith(soDig(conta.conta)) || contaDig.endsWith(c))) {
    throw new Error(`Este CSV é da conta ${contasCsv.join(', ')}, não da ${conta.apelido} (${conta.conta}${conta.conta_dv ? `-${conta.conta_dv}` : ''}).`);
  }
  const datas = linhas.map((r) => r.data).sort();
  const de = datas[0];
  const ate = datas[datas.length - 1];

  // entradas pendentes da conta no período do arquivo — MESMA regra da tela
  // (anexarConciliacoes): gravadas + as resolvidas na hora (depósito Rede pelo
  // histórico, pró-labore, saque Pagar.me, pares de tarifa/devolução/estorno,
  // entre contas). Sem isso as 66 linhas REDE da Sicredi seriam regravadas.
  const { data: lancs, error } = await supabase
    .from('fluxo_caixa_lancamentos')
    .select('*')
    .eq('conta_id', contaId)
    .gte('data', de)
    .lte('data', ate)
    .order('data')
    .order('seq')
    .range(0, 9999);
  if (error) throw new Error(error.message);
  const lista = (lancs || []).map((l) => ({ ...l, valor: Number(l.valor), banco: conta.banco, conta_apelido: conta.apelido, conta_cnpj: conta.titular_cnpj }));
  await anexarConciliacoes(lista, { de, ate });
  const pendentes = lista.filter((l) => l.valor > 0 && l.pendente && !l.transferencia_id && l.tipo !== 'TRANSFERENCIA');

  // casa 1:1 por data + valor (ordem do horário)
  const livres = linhas.map((r, i) => ({ ...r, i, usado: false })).sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  const cnpjConta = soDig(conta.titular_cnpj);
  const resultado = { conta: conta.apelido, periodo: { de, ate }, linhasCsv: linhas.length, pendentes: pendentes.length, conciliadas: [], semLinha: [], erros: [], porCategoria: {} };
  for (const l of pendentes) {
    const r = livres.find((x) => !x.usado && x.data === l.data && Math.abs(x.valor - Number(l.valor)) < 0.005);
    if (!r) {
      resultado.semLinha.push({ lancamentoId: l.id, data: l.data, valor: Number(l.valor), descricao: l.descricao });
      continue;
    }
    r.usado = true;
    const cls = classificar(r, cnpjConta);
    const justificativa =
      r.banco === 'SICREDI'
        ? `${cls.rotulo} — confirmado no extrato Excel da Sicredi em ${fmtData(r.data)}${r.documento ? ` (doc ${r.documento})` : ''}`
        : `${cls.rotulo} — confirmado no extrato CSV da Stone em ${fmtData(r.data)} ${r.horario.slice(0, 8)}${r.origemDoc ? ` (origem ${r.origem} ${fmtCnpj(r.origemDoc)})` : ''}`;
    resultado.porCategoria[cls.categoria] = round2((resultado.porCategoria[cls.categoria] || 0) + Number(l.valor));
    if (!simular) {
      try {
        await salvarConciliacao({
          lancamentoId: l.id,
          origem: 'MANUAL',
          referencia:
            r.banco === 'SICREDI'
              ? { fonte: 'EXTRATO_XLS_SICREDI', categoria: cls.categoria, descricao: r.descricao, documento: r.documento || null, origem: cls.origem || null, origemDoc: cls.origemDoc || null, valor: r.valor }
              : { fonte: 'EXTRATO_CSV_STONE', categoria: cls.categoria, tipoCsv: r.tipo, origem: r.origem, origemDoc: r.origemDoc || null, origemInstituicao: r.origemInst || null, horario: r.horario, valor: r.valor },
          justificativa,
          usuario: usuario || 'Conciliação pelo CSV do extrato Stone',
          automatico: true,
        });
      } catch (e) {
        resultado.erros.push({ lancamentoId: l.id, data: l.data, valor: Number(l.valor), erro: e.message });
        continue;
      }
    }
    resultado.conciliadas.push({ lancamentoId: l.id, data: l.data, valor: Number(l.valor), categoria: cls.categoria, justificativa });
  }
  resultado.valorConciliado = round2(resultado.conciliadas.reduce((s, c) => s + c.valor, 0));
  return resultado;
}

export default { conciliarEntradasPorCsv };
