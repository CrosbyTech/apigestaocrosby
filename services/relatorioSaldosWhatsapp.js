// ============================================================
// SALDOS PARA O GRUPO "CONTAS A PAGAR CROSBY OFC" (WhatsApp)
//
// O RELATÓRIO AUTOMÁTICO (imagem dos saldos + previsão de pagamentos da
// Liberação antiga, 3x ao dia, marcando o Fábio) foi REMOVIDO em 24/11/2026 a
// pedido do Yago — vai nascer um novo em cima da Liberação de Pagamento do
// HeadCoach. Não há mais agendamento, disparo depois do bot Stone nem envio
// manual.
//
// Ficou só o que outros módulos usam:
//   • grupoChatid / MENCIONAR — o grupo e quem marcar (services/stoneInclusoes.js);
//   • montarDados — saldos e títulos em previsão que o agente VEVETO lê para
//     responder quando é chamado no grupo (services/vevetoBot.js).
//
// Env: RELATORIO_SALDOS_GRUPO_CHATID, RELATORIO_SALDOS_GRUPO_NOME (default
//      "CONTAS A PAGAR CROSBY OFC"), RELATORIO_SALDOS_MENCIONAR (default
//      558487820986 → Fábio)
// ============================================================
import supabase from '../config/supabase.js';
import * as wa from './whatsappContasPagar.js';

const env = (k, d) => process.env[k] ?? d;
const GRUPO_NOME = env('RELATORIO_SALDOS_GRUPO_NOME', 'CONTAS A PAGAR CROSBY OFC');
export const MENCIONAR = String(env('RELATORIO_SALDOS_MENCIONAR', '558487820986')).replace(/\D/g, '');

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const sufixoCnpj = (cnpj) => {
  const d = String(cnpj || '').replace(/\D/g, '');
  return d.slice(-4); // 27.728.810/0005-49 → "0549" (como o Yago identifica as contas)
};
const agoraBr = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** segunda → domingo da semana de `iso` */
export function semanaDe(iso = hojeBr()) {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 dom
  const seg = addDias(iso, dow === 0 ? -6 : 1 - dow);
  return { de: seg, ate: addDias(seg, 6) };
}

// chatid conhecido (27/10/2026) — se o grupo for recriado, o nome resolve de novo
let grupoCache = { id: env('RELATORIO_SALDOS_GRUPO_CHATID', '120363427439356982@g.us') || null, em: 0 };
export async function grupoChatid() {
  if (grupoCache.id) return grupoCache.id;
  const g = await wa.acharGrupoPorNome(GRUPO_NOME);
  if (!g?.id) throw new Error(`grupo "${GRUPO_NOME}" não encontrado na instância CONTAS A PAGAR`);
  grupoCache = { id: g.id, em: Date.now() };
  return g.id;
}

// ─── dados ────────────────────────────────────────────────────
export async function montarDados() {
  const BANCOS = ['STONE', 'PAGARME', 'ITAU RECIFE', 'MENTORE']; // PAGARME A RECEBER fora da contagem (pedido do Yago, 27/10)
  const { data: sb } = await supabase.from('saldo_bancario').select('*').in('banco', BANCOS);
  const saldoDe = (b) => Number((sb || []).find((x) => x.banco === b)?.valor || 0);
  const bancos = BANCOS.map((b) => ({ banco: b, valor: round2(saldoDe(b)) }));

  const { data: ult } = await supabase.from('stone_bot_saldos').select('data,capturado_em').order('capturado_em', { ascending: false }).limit(1);
  const dia = ult?.[0]?.data || null;
  let stone = [];
  let pagarme = [];
  if (dia) {
    const { data: linhas } = await supabase.from('stone_bot_saldos').select('*').eq('data', dia).order('saldo', { ascending: false });
    stone = (linhas || []).filter((l) => (l.banco || 'STONE') === 'STONE').map((l) => ({ rotulo: `Stone ${sufixoCnpj(l.titular_cnpj) || l.conta}`, titular: l.titular_nome, saldo: Number(l.saldo || 0), antecipavel: Number(l.saldo_antecipavel || 0) }));
    pagarme = (linhas || []).filter((l) => l.banco === 'PAGARME').map((l) => ({ rotulo: l.titular_nome || l.conta, saldo: Number(l.saldo || 0), aReceber: Number(l.saldo_a_receber || 0) }));
  }
  const antecipavel = round2(stone.reduce((a, s) => a + s.antecipavel, 0));
  // total inclui o antecipável da STONE (pedido do Yago, 28/10); a Pagar.me NÃO soma o "a receber"
  const total = round2(bancos.reduce((a, b) => a + b.valor, 0) + antecipavel);
  const capturadoEm = ult?.[0]?.capturado_em || null;

  const semana = semanaDe();
  const { data: prov } = await supabase
    .from('pagamentos_liberacao')
    .select('id,nm_fornecedor,vl_duplicata,vl_real,dt_vencimento,nm_empresa,forma_pagamento,cd_despesaitem,ds_despesaitem,dados_completos')
    .eq('status', 'PROVISAO') // tudo que está em previsão: vencidos, de hoje e a vencer (pedido do Yago, 27/10)
    .order('dt_vencimento')
    .order('nm_fornecedor');
  const programacao = (prov || []).map((p) => ({ id: p.id, fornecedor: p.nm_fornecedor || '—', valor: Number(p.vl_real ?? p.vl_duplicata ?? 0), vencimento: p.dt_vencimento, empresa: p.nm_empresa, despesaCodigo: p.cd_despesaitem, despesa: p.ds_despesaitem, origem: p.dados_completos?.origem || null }));
  const totalProgramacao = round2(programacao.reduce((a, p) => a + p.valor, 0));
  const itensSemana = agruparProgramacao(programacao);

  return { geradoEm: agoraBr(), capturadoEm, dia, bancos, total, stone, pagarme, antecipavel, semana, programacao, itensSemana, totalProgramacao };
}

// ─── despesas fixas agrupadas (uma linha por despesa, somando as duplicatas) ──
// Regra do Yago (27/10/2026): água/esgoto, energia, internet, vale transporte e
// vale alimentação viram UMA linha cada, com o total; o resto fica por fornecedor.
const GRUPOS_FIXOS = [
  { rotulo: 'ÁGUA E ESGOTO', codigos: ['6011'], re: /AGUA|ESGOTO|CAERN|CAGEPA|COMPESA|SANEAMENTO/i },
  { rotulo: 'ENERGIA', codigos: ['6010'], re: /ENERGIA|ENERGISA|COSERN|NEOENERGIA|CELPE|ELETRIC|COMPANHIA ENERGETICA/i },
  { rotulo: 'INTERNET', codigos: ['6028'], re: /INTERNET|PROVEDOR|FIBRA|TELECOM|BRISANET|VIVO FIBRA|CLARO NET/i },
  { rotulo: 'VALE TRANSPORTE', codigos: ['3036'], re: /VALE TRANSPORTE|TRANSP COL|TRANSPORTE COLETIVO|SINDICATO DAS EMPRESAS DE TRANSP|SIND DAS EMP DE TRANSP/i },
  { rotulo: 'VALE ALIMENTAÇÃO', codigos: ['3003'], re: /VALE ALIMENTACAO|VALE REFEICAO|PLUXEE|SODEXO|ALELO|TICKET|VR BENEFICIOS|FLASH/i },
];
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
function grupoDe(p) {
  const cod = String(p.despesaCodigo || '').replace(/\D/g, '');
  const texto = semAcento(`${p.despesa || ''} ${p.fornecedor || ''}`).toUpperCase();
  return GRUPOS_FIXOS.find((g) => (cod && g.codigos.includes(cod)) || g.re.test(texto)) || null;
}
/** @returns [{ rotulo, despesa, valor, vencimento, vencimentoAte, qtd, agrupado }] em ordem de vencimento */
export function agruparProgramacao(programacao) {
  const grupos = new Map();
  const itens = [];
  for (const p of programacao) {
    const g = grupoDe(p);
    if (!g) {
      itens.push({ rotulo: p.fornecedor, despesa: p.despesa || null, valor: round2(p.valor), vencimento: p.vencimento, vencimentoAte: p.vencimento, qtd: 1, agrupado: false });
      continue;
    }
    if (!grupos.has(g.rotulo)) grupos.set(g.rotulo, { rotulo: g.rotulo, despesa: p.despesa || g.rotulo, valor: 0, vencimento: p.vencimento, vencimentoAte: p.vencimento, qtd: 0, agrupado: true });
    const x = grupos.get(g.rotulo);
    x.valor = round2(x.valor + p.valor);
    x.qtd += 1;
    if (p.vencimento < x.vencimento) x.vencimento = p.vencimento;
    if (p.vencimento > x.vencimentoAte) x.vencimentoAte = p.vencimento;
  }
  return [...itens, ...grupos.values()].sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : b.valor - a.valor));
}

export default { montarDados, agruparProgramacao, grupoChatid, semanaDe };
