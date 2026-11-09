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
import { linhasExtratoStoneCsv } from '../utils/extratoStoneCsv.js';
import { salvarConciliacao, listarConciliacoes, atribuirChaves } from './fluxoCaixaConciliacao.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtData = (iso) => String(iso).split('-').reverse().join('/');
const fmtCnpj = (d) => (d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d);

function classificar(r, cnpjConta) {
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
  const linhas = linhasExtratoStoneCsv(buffer).filter((r) => r.credito && !/cancel|falh|recusad|rejeit/i.test(r.situacao));
  if (!linhas.length) throw new Error('O CSV não tem entradas (formato esperado: extrato da Stone com Movimentação, Tipo, Valor…).');

  // o CSV tem que ser desta conta (Destino Conta = conta + DV)
  const contaDig = soDig(`${conta.conta}${conta.conta_dv || ''}`);
  const contasCsv = [...new Set(linhas.map((r) => r.contaPropria).filter(Boolean))];
  if (contasCsv.length && !contasCsv.some((c) => c === contaDig || c.endsWith(soDig(conta.conta)) || contaDig.endsWith(c))) {
    throw new Error(`Este CSV é da conta ${contasCsv.join(', ')}, não da ${conta.apelido} (${conta.conta}${conta.conta_dv ? `-${conta.conta_dv}` : ''}).`);
  }
  const datas = linhas.map((r) => r.data).sort();
  const de = datas[0];
  const ate = datas[datas.length - 1];

  // entradas pendentes da conta no período do CSV
  const { data: lancs, error } = await supabase
    .from('fluxo_caixa_lancamentos')
    .select('id,conta_id,data,hora,valor,seq,memo,descricao,forma,transferencia_id,tipo')
    .eq('conta_id', contaId)
    .gte('data', de)
    .lte('data', ate)
    .gt('valor', 0)
    .order('data')
    .order('seq')
    .range(0, 4999);
  if (error) throw new Error(error.message);
  // chave estável: numeração entre os lançamentos iguais do mesmo dia (todos, não só entradas)
  const { data: todos } = await supabase.from('fluxo_caixa_lancamentos').select('id,conta_id,data,valor,seq,memo,descricao').eq('conta_id', contaId).gte('data', de).lte('data', ate).gt('valor', 0).range(0, 4999);
  atribuirChaves(todos || []);
  const chaveDe = new Map((todos || []).map((x) => [x.id, x.chave]));
  const concs = await listarConciliacoes({ de, ate, contaIds: [contaId] });
  const conciliadas = new Set(concs.map((c) => c.chave));
  const pendentes = (lancs || []).filter((l) => !l.transferencia_id && l.tipo !== 'TRANSFERENCIA' && !conciliadas.has(chaveDe.get(l.id)));

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
    const justificativa = `${cls.rotulo} — confirmado no extrato CSV da Stone em ${fmtData(r.data)} ${r.horario.slice(0, 8)}${r.origemDoc ? ` (origem ${r.origem} ${fmtCnpj(r.origemDoc)})` : ''}`;
    resultado.porCategoria[cls.categoria] = round2((resultado.porCategoria[cls.categoria] || 0) + Number(l.valor));
    if (!simular) {
      try {
        await salvarConciliacao({
          lancamentoId: l.id,
          origem: 'MANUAL',
          referencia: { fonte: 'EXTRATO_CSV_STONE', categoria: cls.categoria, tipoCsv: r.tipo, origem: r.origem, origemDoc: r.origemDoc || null, origemInstituicao: r.origemInst || null, horario: r.horario, valor: r.valor },
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
