// ============================================================================
// HEADCOACH › CASHBACK DOS CLIENTES (Yago, 16/11/2026)
//
// O cashback é o "saldo bônus" do TOTVS (PESFC054). Enquanto o TOTVS não é
// desligado, o HeadCoach guarda uma cópia do saldo na MESMA tabela do CREDEV e
// do adiantamento (hc_cliente_saldos, tipo "cashback"), por loja:
//
//   1. clientes que compraram nas lojas ativas nos últimos 90 dias — saem das
//      notas de saída do TOTVS que o HeadCoach já espelha (tabela notas_fiscais),
//      mais quem já tem cashback guardado aqui (para o saldo que zerou zerar aqui);
//   2. CPF de cada cliente (cadastro: erp_pessoas → pes_pessoa → TOTVS);
//   3. saldo bônus do CPF no TOTVS, nas lojas (person/v2/list-balance-bonus — a
//      API só consulta um CPF por vez; só leitura);
//   4. o saldo do HeadCoach é ACERTADO para o do TOTVS: a diferença entra no
//      extrato como "carga_inicial" (1ª vez) ou "sinc_totvs" (dias seguintes).
//
// Roda todo dia (jobs/hc-cashback.job.js) e à mão (scripts/sincronizar-cashback.mjs).
// O cashback continua sendo gerado e consumido no TOTVS pelo PDV; aqui é cópia.
// ============================================================================
import { supabase } from './erp/db.js';
import { totvs } from './erp/totvsClient.js';
import { BONUS_PATH, cpfsDePessoas } from './erp/bonus.js';

// lojas ativas (Yago, 16/11/2026) e janela de quem comprou
export const LOJAS_CASHBACK = [2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97, 98];
export const CASHBACK_DIAS = 90;
const TIPO = 'cashback';
const POR = 'sincronização do cashback (TOTVS)';

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export class CashbackError extends Error {
  constructor(message, code = 'CASHBACK', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const ehFaltaDeMigracao = (msg) => /Tipo de saldo inválido|hc_cliente_saldos_tipo_check|hc_cliente_saldos_mov_(tipo|movimento)_check|violates check constraint/i.test(String(msg || ''));
const MIGRACAO = 'O cashback ainda não está liberado na tabela de saldos: rode "node scripts/migrar-hc-saldos-clientes.mjs" na pasta da API.';

async function lerTudo(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw new CashbackError(error.message, 'DB_ERROR', 500);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Clientes com nota de saída emitida nas lojas desde `desde` → Map(code → nome). */
export async function clientesQueCompraram({ lojas = LOJAS_CASHBACK, dias = CASHBACK_DIAS } = {}) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const notas = await lerTudo(() =>
    supabase
      .from('notas_fiscais')
      .select('id, person_code, person_name')
      .in('branch_code', lojas)
      .eq('operation_type', 'Output')
      .eq('invoice_status', 'Issued')
      .gte('issue_date', desde)
      .not('person_code', 'is', null)
      .order('id'),
  );
  const clientes = new Map();
  for (const n of notas) if (!clientes.has(Number(n.person_code))) clientes.set(Number(n.person_code), n.person_name || null);
  return { desde, notas: notas.length, clientes };
}

/** Saldo bônus de um CPF no TOTVS, por loja → Map(loja → valor). */
export async function saldoBonusNoTotvs(cpf, lojas = LOJAS_CASHBACK) {
  const r = await totvs('post', BONUS_PATH, { data: { personCpf: cpf, branchList: lojas.map((b) => ({ branchCode: b })) } });
  const m = new Map();
  for (const b of r?.balanceBonus || []) {
    const loja = Number(b.branchCode);
    const v = r2(b.balanceValue);
    if (lojas.includes(loja) && v > 0) m.set(loja, v);
  }
  return m;
}

/**
 * Acerta o cashback do HeadCoach pelo saldo bônus do TOTVS.
 * aplicar=false só simula (nada é gravado). Devolve o resumo.
 */
export async function sincronizarCashback({ lojas = LOJAS_CASHBACK, dias = CASHBACK_DIAS, aplicar = true, paralelo = 3, log = () => {} } = {}) {
  const inicio = Date.now();
  // 1) quem comprou + quem já tem cashback guardado
  const compras = await clientesQueCompraram({ lojas, dias });
  const guardados = await lerTudo(() =>
    supabase.from('hc_cliente_saldos').select('empresa, cliente_code, cliente_nome, cliente_cpf_cnpj, saldo').eq('tipo', TIPO).in('empresa', lojas).order('cliente_code'),
  );
  const atual = new Map(); // `${loja}|${cliente}` → saldo no HeadCoach
  const nomes = new Map(compras.clientes);
  for (const g of guardados) {
    atual.set(`${g.empresa}|${g.cliente_code}`, r2(g.saldo));
    if (!nomes.has(Number(g.cliente_code))) nomes.set(Number(g.cliente_code), g.cliente_nome || null);
  }
  const codes = [...nomes.keys()];
  log(`${compras.notas} nota(s) de saída desde ${compras.desde} nas lojas ${lojas.join(', ')} → ${compras.clientes.size} cliente(s); com cashback já guardado: ${new Set(guardados.map((g) => g.cliente_code)).size}; a conferir: ${codes.length}`);

  // 2) CPF (pessoa jurídica não tem saldo bônus). Dois códigos com o mesmo CPF: vale o primeiro.
  const cpfPorCode = await cpfsDePessoas(codes);
  const codePorCpf = new Map();
  for (const code of codes) {
    const cpf = cpfPorCode.get(code);
    if (cpf && !codePorCpf.has(cpf)) codePorCpf.set(cpf, code);
  }
  const fila = [...codePorCpf.entries()].map(([cpf, code]) => ({ cpf, code }));
  log(`${fila.length} CPF(s) a consultar no TOTVS (${codes.length - cpfPorCode.size} cliente(s) sem CPF — empresas — ficam de fora)`);

  // 3) saldo no TOTVS e 4) acerto no HeadCoach
  const res = { desde: compras.desde, lojas, notas: compras.notas, clientes: codes.length, cpfs: fila.length, consultados: 0, comSaldo: 0, totalTotvs: 0, movimentos: 0, entrou: 0, saiu: 0, semMudanca: 0, erros: [], porLoja: {}, aplicado: aplicar };
  let parar = null;
  let i = 0;
  const trabalhar = async () => {
    while (i < fila.length && !parar) {
      const { cpf, code } = fila[i++];
      let saldos;
      try {
        saldos = await saldoBonusNoTotvs(cpf, lojas);
      } catch (e) {
        if (e.status && e.status >= 500) parar = new CashbackError(`O TOTVS parou de responder (${e.message}); ${res.consultados} de ${fila.length} CPF(s) conferidos`, 'TOTVS_FORA', 502);
        else res.erros.push({ cliente: code, erro: String(e.message).slice(0, 160) });
        continue;
      }
      res.consultados += 1;
      if (saldos.size > 0) res.comSaldo += 1;
      for (const loja of lojas) {
        const alvo = saldos.get(loja) || 0;
        const tinha = atual.get(`${loja}|${code}`);
        const delta = r2(alvo - (tinha || 0));
        if (alvo > 0) {
          res.totalTotvs = r2(res.totalTotvs + alvo);
          res.porLoja[loja] = r2((res.porLoja[loja] || 0) + alvo);
        }
        if (Math.abs(delta) < 0.005) {
          if (alvo > 0) res.semMudanca += 1;
          continue;
        }
        if (aplicar) {
          const { error } = await supabase.rpc('hc_saldo_movimentar', {
            p_empresa: loja,
            p_cliente: code,
            p_tipo: TIPO,
            p_valor: delta,
            p_movimento: tinha === undefined ? 'carga_inicial' : 'sinc_totvs',
            p_venda: null,
            p_devolucao: null,
            p_referencia: 'saldo bônus TOTVS',
            p_observacao: `Saldo bônus no TOTVS: ${brl(alvo)}${tinha === undefined ? '' : ` (aqui estava ${brl(tinha)})`}`,
            p_por: POR,
            p_nome: nomes.get(code) || null,
            p_doc: cpf,
          });
          if (error) {
            if (ehFaltaDeMigracao(error.message)) {
              parar = new CashbackError(MIGRACAO, 'MIGRATION_PENDING', 503);
              break;
            }
            res.erros.push({ cliente: code, loja, erro: String(error.message).slice(0, 160) });
            continue;
          }
          atual.set(`${loja}|${code}`, alvo);
        }
        res.movimentos += 1;
        if (delta > 0) res.entrou = r2(res.entrou + delta);
        else res.saiu = r2(res.saiu - delta);
      }
      if (res.consultados % 250 === 0) log(`  ${res.consultados}/${fila.length} CPF(s) · ${res.comSaldo} com saldo · ${brl(res.totalTotvs)} · ${Math.round((Date.now() - inicio) / 1000)} s`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(6, paralelo)) }, trabalhar));
  if (parar) throw parar;
  res.segundos = Math.round((Date.now() - inicio) / 1000);
  return res;
}
