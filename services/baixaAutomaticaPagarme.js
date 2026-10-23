/**
 * Baixa automática do que entra pela Pagar.me — cartão débito PAGARME, no dia
 * do pagamento (regra do João, Recuperação de Créditos, 22–23/10/2026).
 *
 * Tudo que a Pagar.me recebe vira uma Solicitação de Baixa na aba do HeadCoach:
 *   - Pix pago no app BlueCard  → origem 'bluecard_pagarme' (services/bluecardBaixaPagarme.js)
 *   - boleto Pagar.me pago       → origem 'pagarme_boleto'  (abrirSolicitacaoBoleto, chamado
 *                                  pelo retorno em services/pagarmeBoletos.js)
 * Este serviço processa essas solicitações pendentes do mesmo jeito que o João
 * faz na tela: POST /api/totvs/invoices-settle com Cartão de Débito, portador
 * 9901 (operadora/bandeira lidas do cadastro do TOTVS), NSU e autorização =
 * dia do pagamento (ddmmaaaa), liquidação na empresa 1, data = dt_pagamento.
 *
 * CHAVE: só executa com PAGARME_BAIXA_AUTO=on (ligar exige OK do Yago — é
 * baixa em massa no TOTVS). Desligada, só a prévia funciona.
 *
 * Se o TOTVS recusar por documento repetido (mesmo cliente, 2 parcelas no
 * mesmo dia → mesmo NSU), tenta de novo com NSU = ddmmaaaa + parcela.
 * Erro: a solicitação continua 'pendente' com o motivo anotado na observação,
 * pra o João ver na aba. Nada é apagado.
 */
import axios from 'axios';
import supabase from '../config/supabase.js';

const LIGADA = () => String(process.env.PAGARME_BAIXA_AUTO || '').toLowerCase() === 'on';
const INTERVALO_MS = Number(process.env.BAIXA_AUTO_INTERVALO_MIN || 30) * 60 * 1000;
const SELF_URL = process.env.SELF_URL || `http://127.0.0.1:${process.env.PORT || 4100}`;
const ORIGENS_AUTO = ['bluecard_pagarme', 'pagarme_boleto'];
const PORTADOR_PAGARME_DEBITO = 9901;
const EMPRESA_LIQUIDACAO = Number(process.env.PAGARME_CARD_SETTLE_BRANCH || 1);
const AUTOR = 'bruce-automatico';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const dataISO = (v) => (String(v || '').match(/^\d{4}-\d{2}-\d{2}/) || [null])[0];
const ddmmaaaa = (iso) => {
  const [a, m, d] = String(iso || '').slice(0, 10).split('-');
  return d ? `${d}${m}${a}` : '';
};
const agoraBR = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).slice(0, 16);

// (abrirSolicitacaoBoleto vive em services/pagarmeBoletos.js — usa a data do CRÉDITO.)

// ── prévia / execução ───────────────────────────────────────────────────────
async function pendentes({ limite = 200 } = {}) {
  const { data, error } = await supabase
    .from('solicitacoes_baixa')
    .select('id, cd_empresa, cd_cliente, nm_cliente, nr_fat, nr_parcela, vl_fatura, dt_pagamento, origem, ref_externa, observacao, created_at')
    .eq('status', 'pendente')
    .in('origem', ORIGENS_AUTO)
    .gt('nr_fat', 0)
    .order('dt_pagamento', { ascending: true })
    .limit(limite);
  if (error) throw new Error(`solicitacoes_baixa: ${error.message}`);
  return data || [];
}

/** O que seria baixado agora (não toca em nada). */
export async function previa() {
  const lista = await pendentes();
  const porOrigem = {};
  for (const s of lista) {
    const o = (porOrigem[s.origem] ||= { n: 0, valor: 0 });
    o.n++;
    o.valor = r2(o.valor + Number(s.vl_fatura || 0));
  }
  return {
    ligada: LIGADA(),
    total: lista.length,
    valor: r2(lista.reduce((a, s) => a + Number(s.vl_fatura || 0), 0)),
    porOrigem,
    itens: lista.map((s) => ({
      id: s.id,
      origem: s.origem,
      cliente: `${s.cd_cliente} · ${s.nm_cliente}`,
      titulo: `${s.cd_empresa}-${s.nr_fat}/${s.nr_parcela}`,
      valor: r2(s.vl_fatura),
      dt_pagamento: s.dt_pagamento,
      nsu: ddmmaaaa(s.dt_pagamento),
    })),
  };
}

async function settle(item, nsu) {
  const dt = dataISO(item.dt_pagamento) || new Date().toISOString().slice(0, 10);
  const body = {
    items: [
      {
        branchCode: item.cd_empresa,
        customerCode: item.cd_cliente,
        receivableCode: item.nr_fat,
        installmentCode: item.nr_parcela || 1,
        paidValue: Number(item.vl_fatura) || 0,
        settlementDate: dt,
        card: { nsu, autorizacao: ddmmaaaa(dt), bandeira: '', operadora: '', parcelas: 1, portador: PORTADOR_PAGARME_DEBITO },
      },
    ],
    paidType: 2,
    cardSettlementBranch: EMPRESA_LIQUIDACAO,
    dadosCartao: { parcelas: 1, portador: PORTADOR_PAGARME_DEBITO },
  };
  const { data } = await axios.post(`${SELF_URL}/api/totvs/invoices-settle`, body, { timeout: 120000, validateStatus: () => true });
  const err = data?.errors?.[0];
  const ok = (data?.results || []).find((r) => r.success);
  if (ok) return { ok: true, resposta: ok };
  const msgs = err?.errorMessages?.length ? err.errorMessages : [err?.error || data?.message || 'falha sem detalhe'];
  return { ok: false, mensagens: msgs.map(String) };
}

const pareceDuplicado = (msgs) => msgs.some((m) => /already|exist|duplic|já existe|ja existe|cadastrad/i.test(m));

async function processarUma(s) {
  const dt = dataISO(s.dt_pagamento) || new Date().toISOString().slice(0, 10);
  let nsu = ddmmaaaa(dt);
  let r = await settle(s, nsu);
  if (!r.ok && pareceDuplicado(r.mensagens)) {
    nsu = `${ddmmaaaa(dt)}${s.nr_parcela || 1}`;
    r = await settle(s, nsu);
  }
  const agora = new Date().toISOString();
  if (r.ok) {
    await supabase
      .from('solicitacoes_baixa')
      .update({
        status: 'processada',
        processado_por: AUTOR,
        processado_em: agora,
        forma_pagamento: 'cartao_debito',
        dados_cartao: { portador: PORTADOR_PAGARME_DEBITO, nsu, autorizacao: ddmmaaaa(dt), parcelas: 1, empresa_liquidacao: EMPRESA_LIQUIDACAO, automatico: true },
        observacao: `${s.observacao || ''} [auto ${agoraBR()}: baixada no TOTVS como cartão débito PAGARME, NSU ${nsu}]`.trim(),
        updated_at: agora,
      })
      .eq('id', s.id)
      .eq('status', 'pendente');
    const mb = /\[pagarme:boleto:(\d+)\]/.exec(s.ref_externa || '');
    if (mb) {
      await supabase
        .from('pagarme_boletos')
        .update({ baixa_status: 'processada', baixa_erro: null, baixa_em: agora, updated_at: agora })
        .eq('id', Number(mb[1]));
    }
    return { ok: true, nsu };
  }
  const motivo = r.mensagens.join('; ').slice(0, 400);
  await supabase
    .from('solicitacoes_baixa')
    .update({ observacao: `${s.observacao || ''} [auto ${agoraBR()}: NÃO baixou — ${motivo}]`.trim(), updated_at: agora })
    .eq('id', s.id);
  return { ok: false, motivo };
}

let rodando = false;
let ultima = { em: null, resumo: null, erro: null };

/** Baixa as pendentes de origem Pagar.me. Só com PAGARME_BAIXA_AUTO=on. */
export async function executar({ limite = 100 } = {}) {
  if (!LIGADA()) {
    return { ok: false, ligada: false, motivo: 'Baixa automática desligada (PAGARME_BAIXA_AUTO≠on). Só a prévia está disponível.' };
  }
  if (rodando) return { ok: false, ligada: true, motivo: 'já está rodando', ultima };
  rodando = true;
  const resumo = { total: 0, baixadas: 0, falhas: 0, valor_baixado: 0, detalhes: [] };
  try {
    const lista = await pendentes({ limite });
    resumo.total = lista.length;
    for (const s of lista) {
      try {
        const r = await processarUma(s);
        if (r.ok) {
          resumo.baixadas++;
          resumo.valor_baixado = r2(resumo.valor_baixado + Number(s.vl_fatura || 0));
        } else resumo.falhas++;
        resumo.detalhes.push({ id: s.id, titulo: `${s.cd_empresa}-${s.nr_fat}/${s.nr_parcela}`, cliente: s.nm_cliente, valor: r2(s.vl_fatura), ...r });
      } catch (e) {
        resumo.falhas++;
        resumo.detalhes.push({ id: s.id, titulo: `${s.cd_empresa}-${s.nr_fat}/${s.nr_parcela}`, ok: false, motivo: e.message });
      }
    }
    ultima = { em: new Date().toISOString(), resumo, erro: null };
    if (resumo.total) console.log(`💳 [baixa-auto] ${resumo.baixadas}/${resumo.total} baixada(s) como cartão PAGARME (R$ ${resumo.valor_baixado.toFixed(2)}), ${resumo.falhas} falha(s)`);
    return { ok: true, ligada: true, ...resumo };
  } catch (e) {
    ultima = { em: new Date().toISOString(), resumo: null, erro: e.message };
    console.warn(`⚠️ [baixa-auto] ${e.message}`);
    return { ok: false, ligada: true, motivo: e.message };
  } finally {
    rodando = false;
  }
}

export async function status() {
  const p = await previa();
  return { ligada: LIGADA(), intervalo_min: INTERVALO_MS / 60000, empresa_liquidacao: EMPRESA_LIQUIDACAO, portador: PORTADOR_PAGARME_DEBITO, pendentes: p.total, valor_pendente: p.valor, porOrigem: p.porOrigem, ultima };
}

export function iniciarJobBaixaAutomaticaPagarme() {
  if (!LIGADA()) {
    console.log('ℹ️ [baixa-auto] desligada (PAGARME_BAIXA_AUTO≠on) — só prévia em /api/baixa-automatica/previa');
    return;
  }
  setTimeout(() => executar().catch(() => {}), 3 * 60 * 1000);
  setInterval(() => executar().catch(() => {}), INTERVALO_MS);
  console.log(`💳 [baixa-auto] LIGADA: a cada ${INTERVALO_MS / 60000} min, cartão débito PAGARME, empresa ${EMPRESA_LIQUIDACAO}`);
}
