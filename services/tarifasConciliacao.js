// ============================================================
// TARIFAS BANCÁRIAS DO EXTRATO → DUPLICATA (TOTVS + Solicitação) + CONCILIAÇÃO
// Pedido do João (Recuperação de Créditos), 09/11/2026.
//
// Na tela Conciliação, saídas pequenas de tarifa / encargo / IOF / custas de
// protesto ficam pendentes porque não existe duplicata para elas. Para cada
// saída marcada:
//   1) cria a duplicata no contas a pagar do TOTVS no nome do BANCO DA CONTA
//      (Stone, Sicredi, Itaú…), empresa = titular da conta, valor e datas da
//      saída, despesa 7008 TARIFAS BANCARIAS, centro de custo 10, portador 1020
//      (o mesmo padrão das tarifas lançadas à mão no TOTVS);
//   2) grava a Solicitação Crosby correspondente (setor FINANCEIRO, status
//      enviado_totvs, paga na data da saída) com a observação de que veio da
//      Conciliação HeadCoach;
//   3) concilia a saída com essa Solicitação (sai de "pendente" na hora).
// Só aceita saída que é tarifa/encargo — o resto é recusado com o motivo.
// ============================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent } from '../totvsrouter/totvsHelper.js';
import { registrarComando as registrarComandoAP, sincronizarDuplicata as sincronizarDuplicataAP } from './erp/contasPagar.js';
import { mapearFiliaisTotvsPorCnpj } from './totvsCartoesStone.js';
import { salvarConciliacao, lancamentoComChave } from './fluxoCaixaConciliacao.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtData = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');

export const DESPESA_TARIFA = { codigo: 7008, nome: 'TARIFAS BANCARIAS', centroCusto: 10, portador: 1020 };

// Fornecedor (como está cadastrado no TOTVS) de cada banco — conferido em 09/11/2026
// nas tarifas já lançadas (despesa 7008) e no cadastro de pessoas.
export const FORNECEDOR_BANCO = {
  STONE: { cnpj: '45283962000133', nome: 'STONE INSTITUICAO FINANCEIRA DE PAGAMENTO' },
  SICREDI: { cnpj: '70038237000147', nome: 'COOPERATIVA DE CREDITO, POUPANCA E INVESTIMENTO RN - SICREDI' },
  ITAU: { cnpj: '60701190278560', nome: 'ITAU UNIBANCO S.A.' },
  CAIXA: { cnpj: '00360305000104', nome: 'CAIXA ECONOMICA FEDERAL' },
  SANTANDER: { cnpj: '90400888000142', nome: 'SANTANDER BR' },
  BNB: { cnpj: '07237373000120', nome: 'BANCO DO NORDESTE DO BRASIL SA' },
  PAGBANK: { cnpj: '08561701000101', nome: 'PAGSEGURO INTERNET INSTITUICAO DE PAGAMENTO S.A.' },
  UNICRED: { cnpj: '73750424000147', nome: 'COOPERATIVA DE ECONOMIA E CREDITO MUTUO UNICRED INTEGRACAO' },
};

/** A saída é tarifa / encargo / IOF / custas? (só essas podem virar duplicata em lote) */
export function ehTarifa(l) {
  if (!l || Number(l.valor) >= 0 || l.transferencia_id || l.tipo === 'TRANSFERENCIA') return false;
  const forma = semAcento(l.forma).toUpperCase();
  if (/TARIFA|ENCARGO/.test(forma)) return true;
  if (String(l.categoria || '').toLowerCase() === 'tarifa') return true;
  const txt = semAcento(`${l.descricao || ''} ${l.memo || ''}`).toUpperCase();
  return /\b(TARIFA|TAR\b|TAXA|IOF|ENCARGO|ENCARGOS|PROTESTO|CUSTAS|CARTORIO|MENSALIDADE|ANUIDADE|CESTA|MANUTENCAO DE CONTA|JUROS\s+(AD|ADIANT|S\/ SALDO|LIMITE)|JUROS AD)\b/.test(txt);
}

const novoCodigo = () => Math.floor(10000000 + Math.random() * 89999999);
const ehCodigoDuplicado = (e) => /DuplicateCode/i.test(JSON.stringify(e?.response?.data || e?.message || '')) && /(already|duplicate|exist)/i.test(JSON.stringify(e?.response?.data || e?.message || ''));
const msgTotvs = (e) => {
  const d = e?.response?.data;
  if (Array.isArray(d)) return d.map((x) => x.message || x.detailedMessage).filter(Boolean).join(' | ');
  if (d?.message) return d.message;
  return e?.message || String(e);
};
// a TOTVS recusa emissão/chegada = hoje: recua para ontem
const dataPassada = (iso) => {
  const hoje = new Date().toISOString().slice(0, 10);
  let d = String(iso).slice(0, 10);
  if (d >= hoje) {
    const x = new Date(`${hoje}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() - 1);
    d = x.toISOString().slice(0, 10);
  }
  return `${d}T15:00:00.000Z`;
};

async function criarNoTotvs({ branchCnpj, supplierCpfCnpj, valor, data, observacao }) {
  const tk = await getToken();
  let token = tk.access_token;
  let ultimo = null;
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const duplicateCode = novoCodigo();
    const payload = {
      branchCnpj,
      supplierCpfCnpj,
      duplicateCode,
      installments: [
        {
          installmentCode: 1,
          bearerCode: DESPESA_TARIFA.portador,
          issueDate: dataPassada(data),
          arrivalDate: dataPassada(data),
          dueDate: `${String(data).slice(0, 10)}T15:00:00.000Z`,
          duplicateValue: valor,
          expenses: [{ expenseCode: DESPESA_TARIFA.codigo, costCenterCode: DESPESA_TARIFA.centroCusto, proratedPercentage: 100 }],
          Document: 1, // Duplicate
          Prevision: 2, // Real
          Stage: 1, // InvoiceNotConfered
        },
      ],
    };
    const post = (t) => axios.post(`${TOTVS_BASE_URL}/accounts-payable/v2/duplicates`, payload, { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${t}` }, httpsAgent, timeout: 60000 });
    try {
      let resp;
      try {
        resp = await post(token);
      } catch (e) {
        if (e.response?.status !== 401) throw e;
        token = (await getToken(true)).access_token;
        resp = await post(token);
      }
      // espelho ERP (accounts_payable_commands / _duplicates), em segundo plano
      setImmediate(() => {
        Promise.resolve()
          .then(async () => {
            await registrarComandoAP({ command: 'create', payload, sucesso: true, http_status: resp.status, resposta: resp.data ?? null, origem_tabela: 'conciliacao-tarifas', origem_id: null });
            const n = await sincronizarDuplicataAP({ ...payload, comando: payload });
            if (!n) setTimeout(() => sincronizarDuplicataAP({ ...payload, comando: payload }).catch(() => {}), 60000);
          })
          .catch((e) => console.warn('[tarifas] espelho AP:', e.message));
      });
      return { duplicateCode, payload, resposta: resp.data ?? null };
    } catch (e) {
      ultimo = e;
      if (ehCodigoDuplicado(e)) continue; // sorteia outro número
      throw new Error(`TOTVS recusou a duplicata: ${msgTotvs(e)}`);
    }
  }
  throw new Error(`TOTVS recusou a duplicata: ${msgTotvs(ultimo)}`);
}

/**
 * @param {number[]} lancamentoIds  saídas do extrato (fluxo_caixa_lancamentos.id)
 * @param {boolean} [simular]       só valida e mostra o que faria
 */
export async function criarDuplicatasTarifas({ lancamentoIds, usuario = null, simular = false }) {
  const ids = [...new Set((lancamentoIds || []).map(Number).filter(Boolean))];
  if (!ids.length) throw new Error('Marque pelo menos uma saída.');
  const mapa = await mapearFiliaisTotvsPorCnpj().catch(() => null);
  const contasCache = new Map();
  const out = { criadas: [], recusadas: [], total: 0 };

  for (const id of ids) {
    let l;
    try {
      l = await lancamentoComChave(id);
    } catch (e) {
      out.recusadas.push({ lancamentoId: id, motivo: e.message });
      continue;
    }
    const base = { lancamentoId: id, data: l.data, valor: Math.abs(Number(l.valor)), descricao: l.descricao || l.memo };
    if (!ehTarifa(l)) {
      out.recusadas.push({ ...base, motivo: 'Não é tarifa / encargo / IOF / custas.' });
      continue;
    }
    const { data: jaConc } = await supabase.from('fluxo_caixa_conciliacoes').select('id').eq('chave', l.chave).maybeSingle();
    if (jaConc) {
      out.recusadas.push({ ...base, motivo: 'Saída já conciliada.' });
      continue;
    }
    if (!contasCache.has(l.conta_id)) {
      const { data: c } = await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,titular_nome,titular_cnpj').eq('id', l.conta_id).maybeSingle();
      contasCache.set(l.conta_id, c);
    }
    const conta = contasCache.get(l.conta_id);
    const forn = FORNECEDOR_BANCO[String(conta?.banco || '').toUpperCase()];
    if (!forn) {
      out.recusadas.push({ ...base, motivo: `Banco ${conta?.banco || '?'} sem fornecedor de tarifa cadastrado no HeadCoach.` });
      continue;
    }
    const branchCnpj = soDig(conta.titular_cnpj);
    const filial = (mapa?.get(branchCnpj) || [])[0] || null;
    const valor = round2(Math.abs(Number(l.valor)));
    const texto = `${l.descricao || ''}${l.memo && l.memo !== l.descricao ? ` · ${l.memo}` : ''}`.trim();
    const observacao = `Tarifa ${fmtData(l.data)} - Conciliacao HeadCoach (${conta.apelido})`;
    if (simular) {
      out.criadas.push({ ...base, banco: conta.banco, fornecedor: forn.nome, empresa: filial?.code ?? null, simulado: true });
      out.total = round2(out.total + valor);
      continue;
    }
    try {
      // 1) TOTVS
      const dup = await criarNoTotvs({ branchCnpj, supplierCpfCnpj: forn.cnpj, valor, data: l.data, observacao });
      // 2) Solicitação Crosby (registro + rastreio da origem)
      const agora = new Date().toISOString();
      const { data: sol, error: eSol } = await supabase
        .from('solicitacoes_crosby')
        .insert({
          cd_empresa: filial?.code ?? null,
          nm_empresa: filial?.nome || conta.titular_nome || null,
          solicitante: 'Conciliação HeadCoach',
          tipo_solicitacao: 'pagamento',
          nivel_urgencia: 'normal',
          setor: 'FINANCEIRO',
          produto_servico: 'SERVICO',
          descricao: `Tarifa bancária debitada no extrato ${conta.apelido} em ${fmtData(l.data)}: ${texto}`.slice(0, 500),
          observacao: 'Criada automaticamente pela Conciliação HeadCoach (tarifa/encargo do extrato), já enviada ao TOTVS e conciliada com a saída.',
          status: 'enviado_totvs',
          branch_cnpj: branchCnpj,
          supplier_cpf_cnpj: forn.cnpj,
          supplier_name: forn.nome,
          duplicate_code: dup.duplicateCode,
          valor_total: valor,
          dt_emissao: l.data,
          dt_vencimento: l.data,
          despesa_code: DESPESA_TARIFA.codigo,
          cost_center_code: DESPESA_TARIFA.centroCusto,
          rateio_percentual: 100,
          forma_pagamento: 'debito_em_conta',
          payload_totvs: dup.payload,
          totvs_response: dup.resposta,
          enviado_totvs_em: agora,
          aprovado_financeiro_em: agora,
          aprovado_financeiro_por_nome: usuario || 'Conciliação HeadCoach',
          pago_em: `${l.data}T12:00:00`,
          pago_por_nome: usuario || 'Conciliação HeadCoach',
          data_solicitacao: agora,
        })
        .select('id')
        .single();
      if (eSol) throw new Error(`duplicata ${dup.duplicateCode} criada no TOTVS, mas a Solicitação falhou: ${eSol.message}`);
      // 3) concilia a saída com a Solicitação
      await salvarConciliacao({
        lancamentoId: l.id,
        origem: 'SOLICITACAO',
        referencia: {
          id: sol.id,
          nome: forn.nome,
          doc: forn.cnpj,
          valor,
          valorDuplicata: valor,
          data: l.data,
          vencimento: l.data,
          empresa: filial?.nome || conta.titular_nome || null,
          detalhe: `Tarifa bancária · dup ${dup.duplicateCode}/1 · despesa ${DESPESA_TARIFA.codigo}`,
          duplicata: `${dup.duplicateCode}|1`,
          motivos: ['duplicata criada pela Conciliação HeadCoach'],
        },
        justificativa: `Tarifa bancária ${conta.banco} — duplicata ${dup.duplicateCode} criada no TOTVS e na Solicitação Crosby pela Conciliação HeadCoach`,
        usuario: usuario || 'Conciliação HeadCoach',
        automatico: false,
      });
      out.criadas.push({ ...base, banco: conta.banco, fornecedor: forn.nome, empresa: filial?.code ?? null, duplicata: dup.duplicateCode, solicitacaoId: sol.id });
      out.total = round2(out.total + valor);
    } catch (e) {
      out.recusadas.push({ ...base, motivo: e.message });
    }
  }
  return out;
}

export default { criarDuplicatasTarifas, ehTarifa, FORNECEDOR_BANCO, DESPESA_TARIFA };
