// Saldo de bônus / cashback no formato da API (person/v2/list-balance-bonus).
//
// A API só consulta um CPF por vez (personCpf + branchList obrigatórios), mas
// cada consulta cobre as 290 empresas (~1,4 s). Por isso:
//   * full  = carga do saldo atual de quem comprou (CPFs das notas e das
//             transações), retomável; com opcoes.todos inclui todo PF cadastrado.
//   * delta = reconsulta quem teve transação alterada desde o cursor, quem teve
//             bônus consumido/concedido pelo HeadCoach e um lote de quem tem saldo
//             (o bônus vence sem movimento, então precisa ser revalidado).
// Só empresas com saldo ≠ 0 viram linha em person_balance_bonus; cada CPF
// consultado fica em person_balance_bonus_checks.
import { totvs, ehErroDeRegistro } from './totvsClient.js';
import { supabase, agora, digits } from './db.js';
import { todasEmpresas } from './vendas.js';

export const BONUS_PATH = '/person/v2/list-balance-bonus';
const CONCORRENCIA = () => Math.max(1, Math.min(8, parseInt(process.env.ERP_BONUS_CONCORRENCIA || '3', 10)));
const REVALIDAR_LOTE = () => Math.max(0, parseInt(process.env.ERP_BONUS_REVALIDAR_LOTE || '500', 10));
const REVALIDAR_HORAS = () => Math.max(1, parseInt(process.env.ERP_BONUS_REVALIDAR_HORAS || '24', 10));

const ehCpf = (d) => typeof d === 'string' && d.length === 11;

/** Resposta da API → linhas (só saldo ≠ 0). */
export function linhasDeSaldo(cpf, resposta, personCode = null) {
  const lista = Array.isArray(resposta?.balanceBonus) ? resposta.balanceBonus : [];
  return lista
    .filter((b) => Number(b.balanceValue) !== 0 && b.branchCode != null)
    .map((b) => ({
      person_cpf: cpf,
      branch_code: Number(b.branchCode),
      branch_cnpj: digits(b.branchCnpj),
      balance_value: Number(b.balanceValue),
      person_code: personCode,
      consultado_em: agora(),
    }));
}

/** Consulta o saldo de um CPF no TOTVS e grava. Devolve o total. */
export async function consultarCpf(cpfBruto, { personCode = null, motivo = 'carga' } = {}) {
  const cpf = digits(cpfBruto);
  if (!ehCpf(cpf)) return null;
  const empresas = await todasEmpresas();
  try {
    const r = await totvs('post', BONUS_PATH, { data: { personCpf: cpf, branchList: empresas.map((b) => ({ branchCode: b })) } });
    const linhas = linhasDeSaldo(cpf, r, personCode);
    const { error: eDel } = await supabase.from('person_balance_bonus').delete().eq('person_cpf', cpf);
    if (eDel) throw new Error(`apagar saldo anterior: ${eDel.message}`);
    if (linhas.length) {
      const { error: eIns } = await supabase.from('person_balance_bonus').insert(linhas);
      if (eIns) throw new Error(`gravar saldo: ${eIns.message}`);
    }
    const total = Math.round(linhas.reduce((s, l) => s + l.balance_value, 0) * 100) / 100;
    await supabase
      .from('person_balance_bonus_checks')
      .upsert({ person_cpf: cpf, person_code: personCode, total_balance: total, branches_with_balance: linhas.length, consultado_em: agora(), motivo, erro: null }, { onConflict: 'person_cpf' });
    return total;
  } catch (e) {
    await supabase
      .from('person_balance_bonus_checks')
      .upsert({ person_cpf: cpf, person_code: personCode, consultado_em: agora(), motivo, erro: e.message.slice(0, 500) }, { onConflict: 'person_cpf' });
    if (e.status && e.status >= 500) throw e; // TOTVS fora: interrompe o lote
    return null;
  }
}

/** Resolve o CPF de uma pessoa (erp_pessoas; se faltar, TOTVS) e consulta. */
export async function atualizarSaldoPessoa(personCode, motivo = 'comando') {
  try {
    const mapa = await cpfsDePessoas([personCode]);
    const cpf = mapa.get(Number(personCode));
    if (!cpf) return null;
    return await consultarCpf(cpf, { personCode: Number(personCode), motivo });
  } catch (e) {
    console.warn(`[bonus] atualizar pessoa ${personCode}: ${e.message}`);
    return null;
  }
}

/**
 * code → CPF (só PF). Ordem: erp_pessoas → pes_pessoa (espelho antigo, mais
 * completo enquanto a carga de PF não termina) → TOTVS individuals em lotes de 50.
 * Códigos já conhecidos como PJ não vão ao TOTVS.
 */
export async function cpfsDePessoas(codes) {
  const lista = [...new Set((codes || []).map(Number).filter(Boolean))];
  const mapa = new Map();
  const pj = new Set();
  for (let i = 0; i < lista.length; i += 500) {
    const { data } = await supabase.from('erp_pessoas').select('code,cpf_cnpj,tipo').in('code', lista.slice(i, i + 500));
    for (const p of data || []) {
      if (p.tipo === 'PF' && ehCpf(p.cpf_cnpj)) mapa.set(Number(p.code), p.cpf_cnpj);
      else if (p.tipo === 'PJ') pj.add(Number(p.code));
    }
  }
  let faltando = lista.filter((c) => !mapa.has(c) && !pj.has(c));
  for (let i = 0; i < faltando.length; i += 500) {
    const { data } = await supabase.from('pes_pessoa').select('code,cpf,tipo_pessoa').in('code', faltando.slice(i, i + 500));
    for (const p of data || []) {
      const cpf = digits(p.cpf);
      if (p.tipo_pessoa === 'PF' && ehCpf(cpf)) mapa.set(Number(p.code), cpf);
      else if (p.tipo_pessoa === 'PJ') pj.add(Number(p.code));
    }
  }
  faltando = faltando.filter((c) => !mapa.has(c) && !pj.has(c));
  const buscarLote = async (lote) => {
    try {
      const d = await totvs('post', '/person/v2/individuals/search', { data: { filter: { personCodeList: lote }, page: 1, pageSize: lote.length } });
      for (const p of d?.items || []) {
        const cpf = digits(p.cpf);
        if (ehCpf(cpf)) mapa.set(Number(p.code), cpf);
      }
    } catch (e) {
      // um cadastro inválido derruba o lote inteiro: divide até isolar
      if (ehErroDeRegistro(e) && lote.length > 1) {
        const meio = Math.ceil(lote.length / 2);
        await buscarLote(lote.slice(0, meio));
        await buscarLote(lote.slice(meio));
      } else if (lote.length > 1 || !ehErroDeRegistro(e)) {
        console.warn(`[bonus] buscar CPFs no TOTVS (${lote.length}): ${e.message.slice(0, 160)}`);
      }
    }
  };
  for (let i = 0; i < faltando.length; i += 50) await buscarLote(faltando.slice(i, i + 50));
  return mapa;
}

async function emParalelo(itens, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) {
      const atual = itens[i++];
      await fn(atual);
    }
  });
  await Promise.all(workers);
}

/** Lê uma coluna inteira paginando de 1000 em 1000. */
async function lerTudo(tabela, colunas, filtro = (q) => q, ordem = null) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    let q = supabase.from(tabela).select(colunas).range(de, de + 999);
    if (ordem) q = q.order(ordem);
    q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * CPFs de quem comprou: clientes das notas espelhadas (notas_fiscais, desde
 * 08/2025 — o CPF não vem preenchido nelas, então sai pelo código) e das
 * transações; com `todos`, também todo PF cadastrado.
 */
export async function candidatosCarga({ todos = false } = {}) {
  const mapa = new Map(); // cpf → personCode
  const nfs = await lerTudo('notas_fiscais', 'id,person_code', (q) => q.not('person_code', 'is', null), 'id');
  const trs = await lerTudo('general_transactions', 'branch_code,transaction_code,customer_code', (q) => q.not('customer_code', 'is', null), 'transaction_code');
  const codes = [...new Set([...nfs.map((n) => n.person_code), ...trs.map((t) => t.customer_code)])];
  const cpfs = await cpfsDePessoas(codes);
  for (const [code, cpf] of cpfs) if (!mapa.has(cpf)) mapa.set(cpf, code);
  if (todos) {
    const pfs = await lerTudo('erp_pessoas', 'code,cpf_cnpj', (q) => q.eq('tipo', 'PF').not('cpf_cnpj', 'is', null), 'code');
    for (const p of pfs) if (ehCpf(p.cpf_cnpj) && !mapa.has(p.cpf_cnpj)) mapa.set(p.cpf_cnpj, p.code);
  }
  return [...mapa].map(([cpf, personCode]) => ({ cpf, personCode }));
}

async function rodarLote(ctx, lista, motivo) {
  let ok = 0;
  let comSaldo = 0;
  let erros = 0;
  let feitos = 0;
  const inicio = Date.now();
  await emParalelo(lista, CONCORRENCIA(), async ({ cpf, personCode }) => {
    const total = await consultarCpf(cpf, { personCode, motivo });
    feitos += 1;
    if (total === null) erros += 1;
    else {
      ok += 1;
      if (total !== 0) comSaldo += 1;
    }
    if (feitos % 500 === 0) {
      const porSeg = feitos / ((Date.now() - inicio) / 1000);
      const resta = Math.round((lista.length - feitos) / porSeg / 60);
      ctx.log?.(`  ${feitos}/${lista.length} CPFs · ${comSaldo} com saldo · ~${resta} min restantes`);
    }
  });
  return { ok, comSaldo, erros };
}

/** Carga do saldo atual. Retomável: pula quem já foi consultado desde o início desta carga. */
export async function syncFull(ctx) {
  const { data: ctrl } = await supabase.from('erp_sync_controle').select('checkpoint').eq('entidade', 'bonus_saldo').maybeSingle();
  const todos = !!ctx.opcoes?.todos;
  let iniciadoEm = ctrl?.checkpoint?.full_iniciado_em;
  if (!iniciadoEm || ctrl?.checkpoint?.todos !== todos) {
    iniciadoEm = agora();
    await supabase.from('erp_sync_controle').update({ checkpoint: { full_iniciado_em: iniciadoEm, todos } }).eq('entidade', 'bonus_saldo');
  }
  const candidatos = await candidatosCarga({ todos });
  const jaFeitos = new Set(
    (await lerTudo('person_balance_bonus_checks', 'person_cpf', (q) => q.gte('consultado_em', iniciadoEm).is('erro', null))).map((c) => c.person_cpf),
  );
  const pendentes = candidatos.filter((c) => !jaFeitos.has(c.cpf));
  ctx.log?.(`  ${candidatos.length} CPFs candidatos (${todos ? 'todo PF' : 'quem comprou'}), ${jaFeitos.size} já consultados nesta carga, ${pendentes.length} a consultar`);
  const r = await rodarLote(ctx, pendentes, 'carga');
  await supabase.from('erp_sync_controle').update({ checkpoint: null }).eq('entidade', 'bonus_saldo');
  return { registros: r.ok, paginas: pendentes.length, totalTotvs: null, detalhes: { candidatos: candidatos.length, consultados: r.ok, com_saldo: r.comSaldo, erros: r.erros, retomados: jaFeitos.size } };
}

/** Delta: quem comprou/trocou desde o cursor + comandos de bônus + revalidação de quem tem saldo. */
export async function syncIncremental(ctx) {
  const desde = (ctx.cursorDesde || new Date()).toISOString();
  const trs = await lerTudo('general_transactions', 'customer_code', (q) => q.gte('sincronizado_em', desde).not('customer_code', 'is', null));
  const cmds = await lerTudo('person_bonus_commands', 'person_code', (q) => q.gte('criado_em', desde).not('person_code', 'is', null));
  const codes = [...new Set([...trs.map((t) => t.customer_code), ...cmds.map((c) => c.person_code)])];
  const cpfs = await cpfsDePessoas(codes);
  const lista = new Map([...cpfs].map(([code, cpf]) => [cpf, { cpf, personCode: code, motivo: 'venda' }]));
  if (REVALIDAR_LOTE()) {
    const limite = new Date(Date.now() - REVALIDAR_HORAS() * 3600000).toISOString();
    const { data: velhos } = await supabase
      .from('person_balance_bonus_checks')
      .select('person_cpf,person_code')
      .neq('total_balance', 0)
      .lt('consultado_em', limite)
      .order('consultado_em', { ascending: true })
      .limit(REVALIDAR_LOTE());
    for (const v of velhos || []) if (!lista.has(v.person_cpf)) lista.set(v.person_cpf, { cpf: v.person_cpf, personCode: v.person_code, motivo: 'revalidacao' });
  }
  const itens = [...lista.values()];
  const porVenda = itens.filter((i) => i.motivo === 'venda');
  const reval = itens.filter((i) => i.motivo === 'revalidacao');
  const a = await rodarLote(ctx, porVenda, 'venda');
  const b = await rodarLote(ctx, reval, 'revalidacao');
  return {
    registros: a.ok + b.ok,
    paginas: itens.length,
    totalTotvs: null,
    detalhes: { por_venda: porVenda.length, revalidados: reval.length, com_saldo: a.comSaldo + b.comSaldo, erros: a.erros + b.erros },
  };
}
