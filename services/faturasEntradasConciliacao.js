// ============================================================
// ENTRADA DO EXTRATO → FATURA NO CONTAS A RECEBER (já baixada)
// (pedido do Inefável/João, 10/11/2026)
//
// Na Conciliação (extrato da conta e "Entradas pendentes (todas as contas)"),
// uma entrada pendente — ex.: Pix de R$ 0,01 da Ana Beatriz — pode virar
// título no contas a receber do TOTVS com o cliente informado na tela:
//   1) cria a FATURA (POST accounts-receivable/v2/invoices), doc 1, portador
//      1020 TITULO EM CARTEIRA, emissão = vencimento = data da entrada,
//      valor = valor da entrada, na filial da conta (CNPJ do titular);
//   2) baixa a fatura em CONTA CORRENTE (POST invoices-payment, paidType 4)
//      no banco escolhido (Confiança ou Sicredi — as contas de baixa que o
//      TOTVS tem, iguais às da Solicitação de Baixa), na data da entrada;
//   3) concilia a entrada com o título (origem TOTVS_CR).
// Nº da fatura = 8 + id do lançamento (7 dígitos) — único e rastreável.
// ============================================================
import supabase from '../config/supabase.js';
import { postTotvs } from './bluecardLimite.js';
import { buscarClientePorCodigo } from './stoneLancarTotvs.js';
import { mapearFiliaisTotvsPorCnpj } from './totvsCartoesStone.js';
import { lancamentoComChave, salvarConciliacao } from './fluxoCaixaConciliacao.js';

const BEARER_FATURA = 1020; // TITULO EM CARTEIRA
const PAID_TYPE_CONTA_CORRENTE = 4;
// mesmas contas de baixa da Solicitação de Baixa (SolicitacaoBaixa.jsx / fiscal.js)
export const BANCOS_BAIXA = {
  confianca: { label: 'Confiança', bankNumber: 422, agencyNumber: 1610, account: '005818984' },
  sicredi: { label: 'Sicredi', bankNumber: 748, agencyNumber: 2207, account: '367338' },
};
export const bancoBaixaPadrao = (bancoConta) => (String(bancoConta || '').toUpperCase() === 'SICREDI' ? 'sicredi' : 'confianca');

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const dataMeioDia = (iso) => `${String(iso).slice(0, 10)}T12:00:00`;
const fmtData = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const numeroFatura = (lancamentoId) => Number(`8${String(lancamentoId).padStart(7, '0')}`);
const mensagemTotvs = (e) => {
  const d = e?.response?.data;
  if (Array.isArray(d)) return d.map((x) => x.message || x.detailedMessage).filter(Boolean).join(' | ');
  if (d?.message) return d.message;
  if (d && typeof d === 'object') return JSON.stringify(d).slice(0, 400);
  return e?.message || String(e);
};

async function buscarFatura({ customerCode, receivableCode }) {
  const r = await postTotvs('/accounts-receivable/v2/documents/search', {
    filter: { customerCodeList: [Number(customerCode)], receivableCodeList: [Number(receivableCode)] },
    page: 1,
    pageSize: 50,
  });
  return r.data?.items || [];
}

/**
 * @param itens   [{ lancamentoId, clienteCodigo, banco?: 'confianca'|'sicredi' }]
 * @param simular true = só valida e devolve os payloads
 */
export async function criarFaturasEntradas({ itens, usuario = null, simular = false }) {
  const lista = (itens || []).filter((x) => Number(x?.lancamentoId));
  if (!lista.length) throw new Error('Marque pelo menos uma entrada.');
  const mapa = await mapearFiliaisTotvsPorCnpj().catch(() => null);
  const contasCache = new Map();
  const out = { criadas: [], recusadas: [], total: 0 };

  for (const it of lista) {
    const id = Number(it.lancamentoId);
    let l;
    try {
      l = await lancamentoComChave(id);
    } catch (e) {
      out.recusadas.push({ lancamentoId: id, motivo: e.message });
      continue;
    }
    const valor = round2(Number(l.valor));
    const base = { lancamentoId: id, data: l.data, valor, descricao: l.descricao || l.memo };
    if (!(valor > 0)) {
      out.recusadas.push({ ...base, motivo: 'Só entradas viram fatura no contas a receber.' });
      continue;
    }
    if (l.transferencia_id || l.tipo === 'TRANSFERENCIA') {
      out.recusadas.push({ ...base, motivo: 'Transferência entre contas não vira fatura.' });
      continue;
    }
    const codCli = soDig(it.clienteCodigo);
    if (!codCli) {
      out.recusadas.push({ ...base, motivo: 'Informe o código do cliente (pessoa) no TOTVS.' });
      continue;
    }
    const { data: jaConc } = await supabase.from('fluxo_caixa_conciliacoes').select('id').eq('chave', l.chave).maybeSingle();
    if (jaConc) {
      out.recusadas.push({ ...base, motivo: 'Entrada já conciliada.' });
      continue;
    }
    if (!contasCache.has(l.conta_id)) {
      const { data: c } = await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,titular_nome,titular_cnpj').eq('id', l.conta_id).maybeSingle();
      contasCache.set(l.conta_id, c);
    }
    const conta = contasCache.get(l.conta_id);
    const branchCnpj = soDig(conta?.titular_cnpj);
    if (!branchCnpj) {
      out.recusadas.push({ ...base, motivo: `Conta ${conta?.apelido || l.conta_id} sem CNPJ do titular.` });
      continue;
    }
    const filiais = (mapa?.get(branchCnpj) || []).map((f) => Number(f.code));
    const bancoKey = BANCOS_BAIXA[it.banco] ? it.banco : bancoBaixaPadrao(conta?.banco);
    const banco = BANCOS_BAIXA[bancoKey];

    let cli;
    try {
      cli = await buscarClientePorCodigo(codCli);
    } catch (e) {
      out.recusadas.push({ ...base, motivo: `Consulta do cliente ${codCli} no TOTVS falhou: ${mensagemTotvs(e)}` });
      continue;
    }
    if (!cli) {
      out.recusadas.push({ ...base, motivo: `Cliente ${codCli} não encontrado no TOTVS.` });
      continue;
    }
    if (!cli.cpfCnpj) {
      out.recusadas.push({ ...base, motivo: `Cliente ${codCli} sem CPF/CNPJ no TOTVS.` });
      continue;
    }

    const receivableCode = numeroFatura(id);
    const obs = `Entrada extrato ${conta.apelido} ${fmtData(l.data)} - HeadCoach Conciliacao`.slice(0, 80);
    const payloadFatura = {
      branchCnpj,
      customerCpfCnpj: cli.cpfCnpj,
      receivableCode,
      installments: [
        {
          installmentCode: 1,
          documentType: 1, // Fatura
          billingType: 2,
          chargeType: 0,
          bearerCode: BEARER_FATURA,
          issueDate: dataMeioDia(l.data),
          expiredDate: dataMeioDia(l.data),
          installmentValue: valor,
          observations: [{ observation: obs }],
        },
      ],
    };
    const montarBaixa = (branchCode) => ({
      branchCode,
      settlementDate: dataMeioDia(l.data),
      invoices: [{ branchCode, customerCode: cli.code, receivableCode, installmentCode: 1, paidValue: valor }],
      payments: [
        {
          value: valor,
          paidType: PAID_TYPE_CONTA_CORRENTE,
          movementDate: dataMeioDia(l.data),
          bank: { bankNumber: banco.bankNumber, agencyNumber: banco.agencyNumber, account: banco.account },
        },
      ],
    });

    try {
      let existentes = await buscarFatura({ customerCode: cli.code, receivableCode });
      const daLoja = existentes.filter((x) => Number(x.installmentCode) === 1 && (!filiais.length || filiais.includes(Number(x.branchCode))));
      let fatura = daLoja[0] || null;
      if (fatura && round2(fatura.installmentValue) !== valor) throw new Error(`Já existe a fatura ${fatura.branchCode}/${receivableCode} do cliente ${cli.code} com outro valor (${fatura.installmentValue}).`);
      const jaBaixada = !!(fatura && (Number(fatura.paidValue) > 0 || fatura.settlementDate));

      if (simular) {
        out.criadas.push({ ...base, simulado: true, cliente: cli, banco: banco.label, payloadFatura: fatura ? null : payloadFatura, payloadBaixa: jaBaixada ? null : montarBaixa(fatura ? Number(fatura.branchCode) : filiais[0]) });
        out.total = round2(out.total + valor);
        continue;
      }

      const passos = [];
      if (!fatura) {
        try {
          await postTotvs('/accounts-receivable/v2/invoices', payloadFatura);
        } catch (e) {
          throw new Error(`TOTVS recusou a fatura: ${mensagemTotvs(e)}`);
        }
        passos.push('fatura criada');
        existentes = await buscarFatura({ customerCode: cli.code, receivableCode });
        fatura = existentes.find((x) => Number(x.installmentCode) === 1 && (!filiais.length || filiais.includes(Number(x.branchCode)))) || existentes.find((x) => Number(x.installmentCode) === 1);
        if (!fatura) throw new Error(`Fatura ${receivableCode} criada, mas não a encontrei no TOTVS para baixar — tente de novo em instantes.`);
      }
      const branchCode = Number(fatura.branchCode);
      if (!jaBaixada) {
        try {
          await postTotvs('/accounts-receivable/v2/invoices-payment', montarBaixa(branchCode));
        } catch (e) {
          throw new Error(`Fatura ${branchCode}/${receivableCode} criada, mas a baixa falhou: ${mensagemTotvs(e)} — clique de novo para tentar só a baixa.`);
        }
        passos.push(`baixada em conta corrente (${banco.label})`);
      } else passos.push('já estava baixada');

      await salvarConciliacao({
        lancamentoId: l.id,
        origem: 'TOTVS_CR',
        referencia: {
          id: `${branchCode}|${receivableCode}|1`,
          branch: branchCode,
          nome: cli.nome,
          doc: cli.cpfCnpj,
          valor,
          valorPago: valor,
          valorDuplicata: valor,
          data: l.data,
          emissao: l.data,
          vencimento: l.data,
          empresa: `Empresa ${branchCode}`,
          detalhe: `Fatura · título ${receivableCode}/1 · gerada e baixada pela Conciliação HeadCoach (${banco.label})`,
          duplicata: `${receivableCode}|1`,
          motivos: ['fatura gerada pela Conciliação HeadCoach'],
        },
        justificativa: `${cli.code} ${cli.nome || ''} — fatura ${branchCode}/${receivableCode} gerada e baixada no TOTVS pela Conciliação HeadCoach`.trim(),
        usuario: usuario || 'Conciliação HeadCoach',
        automatico: false,
      });
      console.log(`[faturas-entradas] ${usuario || '?'}: lançamento ${id} R$ ${valor} → fatura ${branchCode}/${receivableCode} cliente ${cli.code} (${passos.join(', ')})`);
      out.criadas.push({ ...base, cliente: { code: cli.code, nome: cli.nome }, fatura: `${branchCode}/${receivableCode}`, banco: banco.label, passos });
      out.total = round2(out.total + valor);
    } catch (e) {
      out.recusadas.push({ ...base, motivo: e.message });
    }
  }
  return out;
}

export default { criarFaturasEntradas, BANCOS_BAIXA, bancoBaixaPadrao };
