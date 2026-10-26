/**
 * Conferência das Solicitações de Baixa contra o TOTVS (bidirecional).
 *
 * Desde 26/10/2026 as baixas de Pix/boleto Pagar.me são feitas NA MÃO pelo
 * João no FCRFP002 (a baixa via API não entra na conciliação de cartões do
 * TOTVS). Pra aba Solicitações de Baixa continuar fiel:
 *   - pendente  + título BAIXADO no TOTVS → processada (por "conferência TOTVS")
 *   - processada (cartão débito, últimos N dias) + título ABERTO → pendente
 *     (baixa desfeita no TOTVS — ex.: as feitas via API que não conciliaram)
 * Nada é apagado. Roda no job (a cada 30 min) e em POST /api/conferencia-baixas/rodar.
 */
import supabase from '../config/supabase.js';
import { postTotvs } from './bluecardLimite.js';

const INTERVALO_MS = Number(process.env.CONFERENCIA_BAIXAS_INTERVALO_MIN || 30) * 60 * 1000;
const DIAS_PROCESSADAS = Number(process.env.CONFERENCIA_BAIXAS_DIAS || 45);
const AUTOR = 'conferência TOTVS'; // só na observação (processado_por é UUID)
const agoraBR = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).slice(0, 16);

async function situacaoTitulo(s) {
  const r = await postTotvs('/accounts-receivable/v2/documents/search', {
    filter: { branchCodeList: [Number(s.cd_empresa)], customerCodeList: [Number(s.cd_cliente)], receivableCodeList: [Number(s.nr_fat)] },
    page: 1,
    pageSize: 50,
  });
  const t = (r.data?.items || []).find((x) => Number(x.installmentCode ?? 1) === Number(s.nr_parcela || 1));
  if (!t) return { situacao: 'nao_encontrado' };
  if (t.paymentDate || t.settlementDate) {
    return { situacao: 'baixado', em: String(t.paymentDate || t.settlementDate).slice(0, 10), empLiq: t.settlementBranchCode, tipo: t.dischargeType, user: t.dischargeUser };
  }
  if (Number(t.status) === 2) return { situacao: 'cancelado' };
  return { situacao: 'aberto' };
}

export async function conferir({ limite = 400 } = {}) {
  const resumo = { conferidas: 0, viraram_processadas: 0, voltaram_pendentes: 0, nao_encontradas: 0, erros: 0, detalhes: [] };
  const desde = new Date(Date.now() - DIAS_PROCESSADAS * 86400000).toISOString();
  const [{ data: pend }, { data: proc }] = await Promise.all([
    supabase.from('solicitacoes_baixa').select('id, cd_empresa, cd_cliente, nm_cliente, nr_fat, nr_parcela, vl_fatura, observacao, origem').eq('status', 'pendente').gt('nr_fat', 0).limit(limite),
    supabase
      .from('solicitacoes_baixa')
      .select('id, cd_empresa, cd_cliente, nm_cliente, nr_fat, nr_parcela, vl_fatura, observacao, origem, processado_por')
      .eq('status', 'processada')
      .gte('processado_em', desde)
      .gt('nr_fat', 0)
      .limit(limite),
  ]);
  const agora = new Date().toISOString();

  for (const s of pend || []) {
    try {
      const t = await situacaoTitulo(s);
      resumo.conferidas++;
      if (t.situacao === 'baixado') {
        // processado_por é UUID — o autor vai na observação (gravar texto aqui falhava em silêncio)
        const { error: e1 } = await supabase
          .from('solicitacoes_baixa')
          .update({
            status: 'processada',
            processado_por: null,
            processado_em: agora,
            forma_pagamento: 'cartao_debito',
            observacao: `${s.observacao || ''} [${agoraBR()}: título já BAIXADO no TOTVS em ${t.em} (liq. emp. ${t.empLiq ?? '?'}, usuário ${t.user ?? '?'}) — marcada como processada pela conferência]`.trim(),
            updated_at: agora,
          })
          .eq('id', s.id)
          .eq('status', 'pendente');
        if (e1) throw new Error(e1.message);
        resumo.viraram_processadas++;
        resumo.detalhes.push({ titulo: `${s.cd_empresa}-${s.nr_fat}/${s.nr_parcela}`, cliente: s.nm_cliente, valor: Number(s.vl_fatura), de: 'pendente', para: 'processada', em: t.em });
      } else if (t.situacao === 'nao_encontrado') resumo.nao_encontradas++;
    } catch (e) {
      resumo.erros++;
    }
  }

  for (const s of proc || []) {
    try {
      const t = await situacaoTitulo(s);
      resumo.conferidas++;
      if (t.situacao === 'aberto') {
        const { error: e2 } = await supabase
          .from('solicitacoes_baixa')
          .update({
            status: 'pendente',
            processado_por: null,
            processado_em: null,
            observacao: `${s.observacao || ''} [${agoraBR()}: baixa DESFEITA no TOTVS (título aberto de novo) — voltou pra pendente pela conferência]`.trim(),
            updated_at: agora,
          })
          .eq('id', s.id)
          .eq('status', 'processada');
        if (e2) throw new Error(e2.message);
        resumo.voltaram_pendentes++;
        resumo.detalhes.push({ titulo: `${s.cd_empresa}-${s.nr_fat}/${s.nr_parcela}`, cliente: s.nm_cliente, valor: Number(s.vl_fatura), de: 'processada', para: 'pendente' });
      }
    } catch (e) {
      resumo.erros++;
    }
  }

  if (resumo.viraram_processadas || resumo.voltaram_pendentes) {
    console.log(`🔎 [conferência-baixas] ${resumo.viraram_processadas} baixada(s) na mão → processada · ${resumo.voltaram_pendentes} desfeita(s) → pendente (de ${resumo.conferidas} conferidas)`);
  }
  return resumo;
}

let rodando = false;
let ultima = { em: null, resumo: null, erro: null };
export async function rodar(opts) {
  if (rodando) return { ok: false, motivo: 'já está rodando', ultima };
  rodando = true;
  try {
    const resumo = await conferir(opts);
    ultima = { em: new Date().toISOString(), resumo, erro: null };
    return { ok: true, ...resumo };
  } catch (e) {
    ultima = { em: new Date().toISOString(), resumo: null, erro: e.message };
    return { ok: false, motivo: e.message };
  } finally {
    rodando = false;
  }
}
export function status() {
  return { intervalo_min: INTERVALO_MS / 60000, dias_processadas: DIAS_PROCESSADAS, ultima };
}
export function iniciarJobConferenciaBaixas() {
  setTimeout(() => rodar().catch(() => {}), 2 * 60 * 1000);
  setInterval(() => rodar().catch(() => {}), INTERVALO_MS);
  console.log(`🔎 [conferência-baixas] job ligado: a cada ${INTERVALO_MS / 60000} min`);
}
