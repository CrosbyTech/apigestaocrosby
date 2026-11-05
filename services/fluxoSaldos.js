/**
 * Fluxo de Saldos (João/BRUCE, 05/11/2026) — PARTE INDEPENDENTE.
 *
 * Saldo em dinheiro por loja/dia + cálculo de sangria + pedido de retirada.
 * O cálculo do "dinheiro do dia" vem das NFC-e (invoices/search + xml-contents)
 * e ainda está PENDENTE (falta acertar o filtro de data e o de/para das lojas
 * com o João/Tadeu — ver memory fluxo-saldos.md). Enquanto isso, este serviço
 * já entrega: saldo de partida (contado) por loja, o cálculo da sangria e o
 * registro dos pedidos de retirada. dinheiroDia fica null (= pendente).
 *
 * Tabelas (criadas server-side via exec_sql, idempotente):
 *   fluxo_saldos_partida  — saldo contado de partida por loja (cd_empresa)
 *   fluxo_saldos_sangrias — pedidos de retirada (registro no HeadCoach; NÃO
 *                           mexe em TOTVS/banco)
 */
import supabase from '../config/supabase.js';

// De/para loja -> branchCode (Tadeu, 05/11/2026). ATENÇÃO: o código da VENDA vem
// SEM o zero final (x10 = filial de teste). Ex.: Cidade Jardim é 87, não 870.
// 12 lojas do grupo (sem franquias 60xx).
export const LOJAS = [
  { code: 2, nome: 'João Pessoa' },
  { code: 5, nome: 'Nova Cruz' },
  { code: 55, nome: 'Parnamirim' },
  { code: 65, nome: 'Canguaretama' },
  { code: 87, nome: 'Cidade Jardim' },
  { code: 88, nome: 'Guararapes' },
  { code: 90, nome: 'Ayrton Senna' },
  { code: 93, nome: 'Imperatriz' },
  { code: 94, nome: 'Patos' },
  { code: 95, nome: 'Midway' },
  { code: 97, nome: 'Teresina' },
  { code: 98, nome: 'Recife' },
];

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// ── Cálculo da sangria (regra do João, 05/11/2026) ───────────────────────────
// Deixa um fundo de caixa/troco entre R$100 e R$200 na loja; o restante vira
// sangria em MÚLTIPLO de R$50 (valor fechado), escolhendo o que deixa o fundo
// mais próximo de R$150. Ex.: caixa 1.050 → sangria 900, fica 150.
export function calcularSangria(saldoEmCaixa) {
  const S = r2(saldoEmCaixa);
  if (!(S > 200)) return { saldo: S, sangria: 0, fica: S }; // já é nível de fundo (ou abaixo)
  const minSang = Math.ceil((S - 200) / 50) * 50; // fundo <= 200  → sangria >= S-200
  const maxSang = Math.floor((S - 100) / 50) * 50; // fundo >= 100  → sangria <= S-100
  let best = null, bestDist = Infinity;
  for (let x = minSang; x <= maxSang; x += 50) {
    if (x <= 0) continue;
    const fica = S - x;
    const dist = Math.abs(fica - 150);
    if (dist < bestDist || (dist === bestDist && x > best)) { best = x; bestDist = dist; }
  }
  if (best === null) best = Math.max(0, Math.floor((S - 100) / 50) * 50); // nenhum múltiplo deixa em [100,200]
  return { saldo: S, sangria: r2(best), fica: r2(S - best) };
}

// ── Tabelas ──────────────────────────────────────────────────────────────────
let tabelasOk = false;
async function garantirTabelas() {
  if (tabelasOk) return;
  const ddl = `
    CREATE TABLE IF NOT EXISTS fluxo_saldos_partida (
      cd_empresa integer PRIMARY KEY,
      loja_nome text,
      saldo numeric NOT NULL DEFAULT 0,
      contado_em date,
      user_nome text,
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS fluxo_saldos_sangrias (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cd_empresa integer NOT NULL,
      loja_nome text,
      valor numeric NOT NULL,
      data date NOT NULL DEFAULT current_date,
      status text NOT NULL DEFAULT 'solicitada',
      solicitado_por text,
      aprovado_por text,
      observacao text,
      criado_em timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    NOTIFY pgrst, 'reload schema';`;
  let r = await supabase.rpc('exec_sql', { query: ddl });
  if (r.error && /exec_sql\(query\)/.test(r.error.message || '')) r = await supabase.rpc('exec_sql', { sql: ddl });
  if (r.error) throw new Error(`criar tabelas fluxo_saldos: ${r.error.message}`);
  tabelasOk = true;
}

// ── Saldo de partida (contado) ───────────────────────────────────────────────
export async function listarPartida() {
  await garantirTabelas();
  const { data, error } = await supabase.from('fluxo_saldos_partida').select('*');
  if (error) throw new Error(error.message);
  const porLoja = {};
  for (const p of data || []) porLoja[p.cd_empresa] = p;
  return porLoja;
}

export async function setPartida({ cd_empresa, saldo, contado_em, user_nome }) {
  await garantirTabelas();
  const loja = LOJAS.find((l) => Number(l.code) === Number(cd_empresa));
  const row = {
    cd_empresa: Number(cd_empresa),
    loja_nome: loja?.nome || null,
    saldo: r2(saldo),
    contado_em: contado_em || new Date().toISOString().slice(0, 10),
    user_nome: user_nome || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('fluxo_saldos_partida').upsert(row, { onConflict: 'cd_empresa' });
  if (error) throw new Error(error.message);
  return row;
}

// ── Saldos por loja (modo parcial: dinheiroDia pendente) ─────────────────────
export async function saldos({ dia } = {}) {
  await garantirTabelas();
  const partida = await listarPartida();
  const linhas = LOJAS.map((l) => {
    const p = partida[l.code];
    const saldoPartida = p ? r2(p.saldo) : null;
    // dinheiroDia: PENDENTE até ligar as NFC-e (invoices/search + xml-contents).
    const dinheiroDia = null;
    const saldoEmCaixa = saldoPartida; // por enquanto = contado; depois += dinheiroDia - sangrias
    const sangria = saldoEmCaixa != null ? calcularSangria(saldoEmCaixa) : null;
    return {
      cd_empresa: l.code,
      loja: l.nome,
      saldo_partida: saldoPartida,
      contado_em: p?.contado_em || null,
      dinheiro_dia: dinheiroDia, // null = fonte de vendas pendente
      saldo_em_caixa: saldoEmCaixa,
      sangria_disponivel: sangria ? sangria.sangria : null,
      fica_na_loja: sangria ? sangria.fica : null,
    };
  });
  return {
    dia: dia || new Date().toISOString().slice(0, 10),
    fonte_vendas_pendente: true, // dinheiro do dia ainda não ligado (filtro/lojas)
    lojas: linhas,
  };
}

// ── Pedidos de sangria (registro; não mexe em TOTVS/banco) ───────────────────
export async function listarSangrias({ dias = 30 } = {}) {
  await garantirTabelas();
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const { data, error } = await supabase
    .from('fluxo_saldos_sangrias')
    .select('*')
    .gte('criado_em', desde)
    .order('criado_em', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function criarSangria({ cd_empresa, valor, data, solicitado_por, observacao }) {
  await garantirTabelas();
  const loja = LOJAS.find((l) => Number(l.code) === Number(cd_empresa));
  const row = {
    cd_empresa: Number(cd_empresa),
    loja_nome: loja?.nome || null,
    valor: r2(valor),
    data: data || new Date().toISOString().slice(0, 10),
    status: 'solicitada',
    solicitado_por: solicitado_por || null,
    observacao: observacao || null,
  };
  const { data: ins, error } = await supabase.from('fluxo_saldos_sangrias').insert(row).select().single();
  if (error) throw new Error(error.message);
  return ins;
}

export async function atualizarSangriaStatus({ id, status, aprovado_por }) {
  await garantirTabelas();
  if (!['solicitada', 'aprovada', 'rejeitada', 'depositada', 'cancelada'].includes(status)) {
    throw new Error(`status inválido: ${status}`);
  }
  const { data, error } = await supabase
    .from('fluxo_saldos_sangrias')
    .update({ status, aprovado_por: aprovado_por || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}
