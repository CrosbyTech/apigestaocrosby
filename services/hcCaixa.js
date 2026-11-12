// ============================================================================
// HEADCOACH › CAIXA — abertura, suprimento, retirada, contagem, fechamento e
// encerramento diário (Yago, 12/11/2026). Mesmo roteiro do TOTVS (manual da
// Crosby, itens 3 e 16–20: PDVFM001 › Menu Caixa e GERFP010), mais enxuto:
//   • ABERTURA: empresa + terminal, na DATA DE CAIXA da empresa, com o fundo de
//     troco (sugere o que o caixa anterior deixou). Se a data de caixa ficou
//     para trás, dá para encerrar o dia anterior e abrir em hoje de uma vez.
//   • SUPRIMENTO / RETIRADA: com motivo; a retirada pede a senha de quem lança.
//     Lançou errado → estorno (com motivo e senha); nada é apagado.
//   • CONTAGEM: dinheiro por cédula/moeda + o valor de cada forma (cartão, Pix…)
//     contra o que o sistema registrou; pode contar quantas vezes quiser.
//   • FECHAMENTO: exige contagem feita depois do último movimento; diz quanto
//     fica de fundo para o próximo caixa (o resto sai como retirada do
//     fechamento) e guarda a foto dos totais. Irreversível — só owner/admin
//     reabre, com motivo e senha.
//   • ENCERRAMENTO DIÁRIO: com todos os caixas da empresa fechados, a data de
//     caixa passa para o dia seguinte (ou para hoje, se tinha ficado para
//     trás). Pular para depois de hoje pede owner, admin ou financeiro.
// As vendas (pdv_vendas) entram no caixa aberto da empresa pela coluna
// caixa_id (caixaAbertoPara). Tabelas: migrations/hc_caixa.sql.
// ============================================================================
import supabase from '../config/supabase.js';
import { verificarSenhaAutorizador, AutorizacaoError } from './autorizacaoSenha.js';

export class CaixaError extends Error {
  constructor(message, code = 'CAIXA', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const maisDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const ehData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

const TODOS_OS_PERFIS = ['owner', 'admin', 'manager', 'user', 'guest', 'vendedor', 'franquias'];
const PERFIS_REABRIR = ['owner', 'admin'];
const PERFIS_DATA_FUTURA = ['owner', 'admin', 'user']; // user = financeiro
export const CEDULAS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05];
export const FORMAS = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  boleto: 'Boleto',
  credito_loja: 'Credev',
  adiantamento: 'Adiantamento',
  vale_troca: 'Vale-troca',
  saldo_bonus: 'Saldo bônus',
};

const quem = (user) => user?.name || user?.email || null;

// erro do banco → tabela ainda não criada vira aviso claro
function falhaDb(error) {
  if (/relation .* does not exist|could not find the table|schema cache|column .* does not exist/i.test(String(error?.message || ''))) {
    return new CaixaError('O módulo de caixa ainda não está liberado: faltam as tabelas no banco. Rode "node scripts/migrar-hc-caixa.mjs" na pasta da API.', 'MIGRATION_PENDING', 503);
  }
  return new CaixaError(error?.message || 'Erro no banco', 'DB_ERROR', 500);
}
async function q(promessa) {
  const { data, error } = await promessa;
  if (error) throw falhaDb(error);
  return data;
}

// senha de quem está logado (retirada, estorno, fechamento) ou de quem autoriza
async function conferirSenha(email, senha, perfis = TODOS_OS_PERFIS) {
  try {
    return await verificarSenhaAutorizador(email, senha, perfis);
  } catch (e) {
    if (e instanceof AutorizacaoError) throw new CaixaError(e.message, e.code, e.status);
    throw e;
  }
}

// ─── empresas que o usuário pode operar ──────────────────────────────────────
// owner/admin: todas as próprias; os demais: as vinculadas em user_companies
// (sem vínculo nenhum: todas, como no PDV Crosby)
export async function empresasDoUsuario(user) {
  const proprias = await q(supabase.from('erp_empresas').select('code, descricao, fantasia, uf').eq('propria', true).order('code'));
  let lista = proprias || [];
  if (!['owner', 'admin'].includes(user?.role)) {
    const vinc = await q(supabase.from('user_companies').select('cd_empresa').eq('user_id', user?.id || '00000000-0000-0000-0000-000000000000'));
    const codes = new Set((vinc || []).map((v) => Number(v.cd_empresa)));
    if (codes.size) lista = lista.filter((e) => codes.has(Number(e.code)));
  }
  return lista.map((e) => ({ code: Number(e.code), nome: String(e.descricao || '').replace(/^\s*\d+\s*-\s*/, '').trim() || e.fantasia || `Empresa ${e.code}`, uf: e.uf || null }));
}
async function exigirEmpresa(user, empresa) {
  const n = Number(empresa);
  if (!(n > 0)) throw new CaixaError('Escolha a empresa');
  const lista = await empresasDoUsuario(user);
  const e = lista.find((x) => x.code === n);
  if (!e) throw new CaixaError(`Você não tem acesso à empresa ${n}`, 'SEM_ACESSO_EMPRESA', 403);
  return e;
}

// ─── data de caixa ───────────────────────────────────────────────────────────
async function dataDaEmpresa(empresa) {
  const row = await q(supabase.from('hc_caixa_datas').select('data_caixa, atualizado_em, atualizado_por').eq('empresa', empresa).maybeSingle());
  return row ? { data: String(row.data_caixa).slice(0, 10), definida: true, em: row.atualizado_em, por: row.atualizado_por } : { data: hojeBrasil(), definida: false };
}
async function gravarData(empresa, data, por) {
  await q(supabase.from('hc_caixa_datas').upsert({ empresa, data_caixa: data, atualizado_em: new Date().toISOString(), atualizado_por: por }, { onConflict: 'empresa' }));
}

// ─── vendas e movimentos de um caixa ─────────────────────────────────────────
async function carregarCaixa(id) {
  const c = await q(supabase.from('hc_caixas').select('*').eq('id', Number(id)).maybeSingle());
  if (!c) throw new CaixaError('Caixa não encontrado', 'NOT_FOUND', 404);
  return c;
}

/** Totais do caixa: vendas por forma, movimentos, dinheiro esperado e contagens. */
export async function resumoDoCaixa(caixa) {
  const [vendas, movs, contagens] = await Promise.all([
    q(
      supabase
        .from('pdv_vendas')
        .select('id, tipo_venda, status, total, cliente_nome, vendedor_nome, criado_em, numero_site, origem, canal, pdv_venda_pagamentos(forma, valor, troco), pdv_notas_fiscais(numero, modelo, status)')
        .eq('caixa_id', caixa.id)
        .order('id'),
    ),
    q(supabase.from('hc_caixa_movimentos').select('*').eq('caixa_id', caixa.id).order('id')),
    q(supabase.from('hc_caixa_contagens').select('*').eq('caixa_id', caixa.id).order('id', { ascending: false })),
  ]);
  const formas = {};
  const somar = (forma, valor) => {
    formas[forma] = round2((formas[forma] || 0) + valor);
  };
  let totalVendas = 0;
  let qtdVendas = 0;
  const pendentes = [];
  const lista = [];
  for (const v of vendas || []) {
    const nota = (v.pdv_notas_fiscais || []).find((n) => n.status === 'autorizada') || (v.pdv_notas_fiscais || [])[0] || null;
    const valida = v.status === 'autorizada';
    lista.push({
      id: v.id,
      tipo: v.tipo_venda,
      status: v.status,
      total: round2(v.total),
      cliente: v.cliente_nome,
      vendedor: v.vendedor_nome,
      em: v.criado_em,
      nf: nota ? `${nota.modelo === 65 ? 'NFC-e' : 'NF-e'} ${nota.numero}` : null,
      formas: (v.pdv_venda_pagamentos || []).map((p) => FORMAS[p.forma] || p.forma).join(' + '),
    });
    if (['registrada', 'emitindo', 'rejeitada'].includes(v.status)) pendentes.push({ id: v.id, status: v.status, total: round2(v.total), cliente: v.cliente_nome });
    if (!valida) continue; // só venda com nota autorizada entra no caixa
    qtdVendas += 1;
    totalVendas += Number(v.total) || 0;
    for (const p of v.pdv_venda_pagamentos || []) {
      const valor = p.forma === 'dinheiro' ? Number(p.valor || 0) - Number(p.troco || 0) : Number(p.valor || 0);
      somar(p.forma, valor);
    }
  }
  const ativos = (movs || []).filter((m) => !m.estornado_em);
  const suprimentos = round2(ativos.filter((m) => m.tipo === 'suprimento').reduce((s, m) => s + Number(m.valor), 0));
  const retiradas = round2(ativos.filter((m) => m.tipo === 'retirada').reduce((s, m) => s + Number(m.valor), 0));
  const retiradaFechamento = round2(ativos.filter((m) => m.tipo === 'retirada_fechamento').reduce((s, m) => s + Number(m.valor), 0));
  const vendasDinheiro = round2(formas.dinheiro || 0);
  const fundo = round2(caixa.fundo_inicial);
  const dinheiroEsperado = round2(fundo + vendasDinheiro + suprimentos - retiradas);
  const ultima = (contagens || [])[0] || null;
  // houve venda ou movimento depois da última contagem? (então precisa contar de novo)
  const depois = ultima
    ? (vendas || []).some((v) => v.criado_em > ultima.em) || (movs || []).some((m) => m.em > ultima.em || (m.estornado_em && m.estornado_em > ultima.em))
    : false;
  return {
    caixa,
    formas,
    vendas: lista,
    qtdVendas,
    totalVendas: round2(totalVendas),
    pendentes,
    movimentos: movs || [],
    suprimentos,
    retiradas,
    retiradaFechamento,
    dinheiro: { fundo, vendas: vendasDinheiro, suprimentos, retiradas, esperado: dinheiroEsperado },
    contagens: contagens || [],
    ultimaContagem: ultima,
    contagemDesatualizada: depois,
  };
}

// ─── situação (o que a tela mostra ao escolher empresa + terminal) ───────────
export async function situacao(user, empresa, terminal = 1) {
  const e = await exigirEmpresa(user, empresa);
  const t = Math.max(1, parseInt(terminal, 10) || 1);
  const data = await dataDaEmpresa(e.code);
  const [aberto, ultimoFechado, caixasDaData, encerramentos] = await Promise.all([
    q(supabase.from('hc_caixas').select('*').eq('empresa', e.code).eq('terminal', t).eq('status', 'aberto').maybeSingle()),
    q(supabase.from('hc_caixas').select('*').eq('empresa', e.code).eq('terminal', t).eq('status', 'fechado').order('fechado_em', { ascending: false }).limit(1).maybeSingle()),
    q(supabase.from('hc_caixas').select('id, terminal, data_caixa, status, aberto_em, aberto_por, fechado_em, fechado_por, fundo_inicial, diferenca').eq('empresa', e.code).eq('data_caixa', data.data).order('terminal')),
    q(supabase.from('hc_caixa_encerramentos').select('data_caixa, proxima_data, por, em').eq('empresa', e.code).order('em', { ascending: false }).limit(5)),
  ]);
  const hoje = hojeBrasil();
  return {
    empresa: e,
    terminal: t,
    hoje,
    dataCaixa: data.data,
    dataDefinida: data.definida,
    dataAtrasada: data.data < hoje,
    caixa: aberto ? await resumoDoCaixa(aberto) : null,
    ultimoFechado: ultimoFechado ? { id: ultimoFechado.id, dataCaixa: ultimoFechado.data_caixa, fechadoEm: ultimoFechado.fechado_em, fechadoPor: ultimoFechado.fechado_por, fundoFinal: ultimoFechado.fundo_final, diferenca: ultimoFechado.diferenca } : null,
    fundoSugerido: ultimoFechado?.fundo_final != null ? round2(ultimoFechado.fundo_final) : null,
    caixasDaData: caixasDaData || [],
    encerramentos: encerramentos || [],
  };
}

// ─── abertura ────────────────────────────────────────────────────────────────
export async function abrirCaixa(user, b = {}) {
  const e = await exigirEmpresa(user, b.empresa);
  const terminal = Math.max(1, parseInt(b.terminal, 10) || 1);
  const fundo = round2(Number(String(b.fundoInicial ?? 0).replace(',', '.')) || 0);
  if (fundo < 0) throw new CaixaError('O fundo de troco não pode ser negativo');
  const hoje = hojeBrasil();
  let data = await dataDaEmpresa(e.code);
  // data de caixa para trás: encerra o dia anterior e abre em hoje (se pedido)
  if (data.definida && data.data < hoje) {
    if (!b.encerrarAnterior) {
      throw new CaixaError(
        `A data de caixa da empresa ${e.code} ainda é ${fmtData(data.data)}: o dia não foi encerrado. Encerre o dia (ou marque "encerrar ${fmtData(data.data)} e abrir em ${fmtData(hoje)}").`,
        'DATA_ATRASADA',
        409,
      );
    }
    await encerrarDia(user, { empresa: e.code, proximaData: hoje, automatico: true });
    data = await dataDaEmpresa(e.code);
  }
  if (!data.definida) await gravarData(e.code, data.data, quem(user));
  const anterior = await q(supabase.from('hc_caixas').select('fundo_final').eq('empresa', e.code).eq('terminal', terminal).eq('status', 'fechado').order('fechado_em', { ascending: false }).limit(1).maybeSingle());
  const { data: caixa, error } = await supabase
    .from('hc_caixas')
    .insert({
      empresa: e.code,
      terminal,
      data_caixa: data.data,
      status: 'aberto',
      fundo_inicial: fundo,
      fundo_sugerido: anterior?.fundo_final ?? null,
      observacao_abertura: String(b.observacao || '').trim() || null,
      aberto_por_id: user?.id || null,
      aberto_por: quem(user),
    })
    .select()
    .single();
  if (error) {
    if (/duplicate key|hc_caixas_um_aberto/i.test(error.message)) throw new CaixaError(`O terminal ${terminal} da empresa ${e.code} já tem um caixa aberto`, 'JA_ABERTO', 409);
    throw falhaDb(error);
  }
  console.log(`💰 [caixa] aberto #${caixa.id} · empresa ${e.code} terminal ${terminal} · data ${data.data} · fundo R$ ${fundo.toFixed(2)} · ${quem(user)}`);
  return caixa;
}

// ─── suprimento / retirada ───────────────────────────────────────────────────
export async function lancarMovimento(user, caixaId, b = {}) {
  const caixa = await carregarCaixa(caixaId);
  await exigirEmpresa(user, caixa.empresa);
  if (caixa.status !== 'aberto') throw new CaixaError('O caixa está fechado', 'CAIXA_FECHADO', 409);
  const tipo = String(b.tipo || '');
  if (!['suprimento', 'retirada'].includes(tipo)) throw new CaixaError('Tipo de movimento inválido');
  const valor = round2(Number(String(b.valor ?? '').replace(',', '.')) || 0);
  if (!(valor > 0)) throw new CaixaError('Informe o valor');
  const motivo = String(b.motivo || '').trim();
  if (motivo.length < 3) throw new CaixaError('Informe o motivo');
  if (tipo === 'retirada') {
    await conferirSenha(user?.email, b.senha);
    const r = await resumoDoCaixa(caixa);
    if (valor > r.dinheiro.esperado + 0.005) throw new CaixaError(`Retirada maior que o dinheiro do caixa (${r.dinheiro.esperado.toFixed(2).replace('.', ',')})`, 'SEM_DINHEIRO');
  }
  const mov = await q(
    supabase
      .from('hc_caixa_movimentos')
      .insert({ caixa_id: caixa.id, empresa: caixa.empresa, data_caixa: caixa.data_caixa, tipo, valor, motivo, por_id: user?.id || null, por: quem(user) })
      .select()
      .single(),
  );
  console.log(`💰 [caixa] #${caixa.id} ${tipo} R$ ${valor.toFixed(2)} · ${motivo} · ${quem(user)}`);
  return mov;
}

export async function estornarMovimento(user, movId, b = {}) {
  const mov = await q(supabase.from('hc_caixa_movimentos').select('*').eq('id', Number(movId)).maybeSingle());
  if (!mov) throw new CaixaError('Movimento não encontrado', 'NOT_FOUND', 404);
  const caixa = await carregarCaixa(mov.caixa_id);
  await exigirEmpresa(user, caixa.empresa);
  if (caixa.status !== 'aberto') throw new CaixaError('O caixa está fechado: não dá para estornar', 'CAIXA_FECHADO', 409);
  if (mov.tipo === 'retirada_fechamento') throw new CaixaError('A retirada do fechamento não se estorna');
  if (mov.estornado_em) throw new CaixaError('Este movimento já foi estornado');
  const motivo = String(b.motivo || '').trim();
  if (motivo.length < 3) throw new CaixaError('Informe o motivo do estorno');
  await conferirSenha(user?.email, b.senha);
  return q(supabase.from('hc_caixa_movimentos').update({ estornado_em: new Date().toISOString(), estornado_por: quem(user), estorno_motivo: motivo }).eq('id', mov.id).is('estornado_em', null).select().single());
}

// ─── contagem ────────────────────────────────────────────────────────────────
export async function registrarContagem(user, caixaId, b = {}) {
  const caixa = await carregarCaixa(caixaId);
  await exigirEmpresa(user, caixa.empresa);
  if (caixa.status !== 'aberto') throw new CaixaError('O caixa está fechado', 'CAIXA_FECHADO', 409);
  const cedulas = {};
  let contado = 0;
  for (const c of CEDULAS) {
    const n = Math.max(0, parseInt(b.cedulas?.[String(c)] ?? b.cedulas?.[c] ?? 0, 10) || 0);
    if (n > 100000) throw new CaixaError(`Quantidade de ${c} grande demais`);
    if (n) cedulas[String(c)] = n;
    contado += n * c;
  }
  contado = round2(contado);
  const r = await resumoDoCaixa(caixa);
  // outras formas: o que o operador conferiu (comprovantes da maquininha, extrato do Pix…)
  const formas = {};
  let difOutras = 0;
  const todas = new Set([...Object.keys(r.formas).filter((f) => f !== 'dinheiro'), ...Object.keys(b.formas || {}).filter((f) => FORMAS[f] && f !== 'dinheiro')]);
  for (const f of todas) {
    const sistema = round2(r.formas[f] || 0);
    const bruto = b.formas?.[f];
    const informado = bruto === undefined || bruto === null || bruto === '' ? sistema : round2(Number(String(bruto).replace(',', '.')) || 0);
    const diferenca = round2(informado - sistema);
    difOutras += diferenca;
    formas[f] = { sistema, informado, diferenca };
  }
  const difDinheiro = round2(contado - r.dinheiro.esperado);
  const cont = await q(
    supabase
      .from('hc_caixa_contagens')
      .insert({
        caixa_id: caixa.id,
        cedulas,
        dinheiro_contado: contado,
        dinheiro_esperado: r.dinheiro.esperado,
        formas,
        diferenca_dinheiro: difDinheiro,
        diferenca_total: round2(difDinheiro + difOutras),
        observacao: String(b.observacao || '').trim() || null,
        por_id: user?.id || null,
        por: quem(user),
      })
      .select()
      .single(),
  );
  console.log(`💰 [caixa] #${caixa.id} contagem: dinheiro R$ ${contado.toFixed(2)} (esperado ${r.dinheiro.esperado.toFixed(2)}) · diferença total ${cont.diferenca_total} · ${quem(user)}`);
  return cont;
}

// ─── fechamento ──────────────────────────────────────────────────────────────
export async function fecharCaixa(user, caixaId, b = {}) {
  const caixa = await carregarCaixa(caixaId);
  await exigirEmpresa(user, caixa.empresa);
  if (caixa.status !== 'aberto') throw new CaixaError('Este caixa já está fechado', 'CAIXA_FECHADO', 409);
  const r = await resumoDoCaixa(caixa);
  if (!r.ultimaContagem) throw new CaixaError('Faça a contagem do caixa antes de fechar', 'SEM_CONTAGEM');
  if (r.contagemDesatualizada) throw new CaixaError('Houve venda ou movimento depois da última contagem: conte o caixa de novo antes de fechar', 'CONTAGEM_DESATUALIZADA');
  const contado = round2(r.ultimaContagem.dinheiro_contado);
  const fundoFinal = round2(Number(String(b.fundoFinal ?? contado).replace(',', '.')) || 0);
  if (fundoFinal < 0 || fundoFinal > contado + 0.005) throw new CaixaError(`O fundo que fica no caixa tem que estar entre 0 e o dinheiro contado (${contado.toFixed(2).replace('.', ',')})`);
  await conferirSenha(user?.email, b.senha);
  const retiradaFechamento = round2(contado - fundoFinal);
  if (retiradaFechamento > 0) {
    await q(
      supabase.from('hc_caixa_movimentos').insert({
        caixa_id: caixa.id,
        empresa: caixa.empresa,
        data_caixa: caixa.data_caixa,
        tipo: 'retirada_fechamento',
        valor: retiradaFechamento,
        motivo: String(b.destinoRetirada || '').trim() || 'Retirada do fechamento',
        por_id: user?.id || null,
        por: quem(user),
      }),
    );
  }
  const resumo = {
    vendas: r.qtdVendas,
    totalVendas: r.totalVendas,
    formas: r.formas,
    dinheiro: r.dinheiro,
    contagem: { id: r.ultimaContagem.id, dinheiroContado: contado, formas: r.ultimaContagem.formas, diferencaDinheiro: r.ultimaContagem.diferenca_dinheiro, diferencaTotal: r.ultimaContagem.diferenca_total, cedulas: r.ultimaContagem.cedulas },
    fundoFinal,
    retiradaFechamento,
    pendentes: r.pendentes,
  };
  const { data: fechado, error } = await supabase
    .from('hc_caixas')
    .update({
      status: 'fechado',
      fechado_em: new Date().toISOString(),
      fechado_por_id: user?.id || null,
      fechado_por: quem(user),
      fundo_final: fundoFinal,
      retirada_fechamento: retiradaFechamento,
      diferenca: round2(r.ultimaContagem.diferenca_total),
      diferenca_dinheiro: round2(r.ultimaContagem.diferenca_dinheiro),
      resumo,
      observacao_fechamento: String(b.observacao || '').trim() || null,
    })
    .eq('id', caixa.id)
    .eq('status', 'aberto')
    .select()
    .single();
  if (error) throw falhaDb(error);
  console.log(`💰 [caixa] fechado #${caixa.id} · empresa ${caixa.empresa} terminal ${caixa.terminal} · diferença ${fechado.diferenca} · fundo ${fundoFinal.toFixed(2)} · ${quem(user)}`);
  return fechado;
}

export async function reabrirCaixa(user, caixaId, b = {}) {
  if (!PERFIS_REABRIR.includes(user?.role)) throw new CaixaError('Só owner ou admin reabre um caixa fechado', 'SEM_PERMISSAO', 403);
  const caixa = await carregarCaixa(caixaId);
  await exigirEmpresa(user, caixa.empresa);
  if (caixa.status !== 'fechado') throw new CaixaError('Este caixa não está fechado');
  const motivo = String(b.motivo || '').trim();
  if (motivo.length < 5) throw new CaixaError('Informe o motivo da reabertura');
  const data = await dataDaEmpresa(caixa.empresa);
  if (String(caixa.data_caixa).slice(0, 10) < data.data) throw new CaixaError(`O dia ${fmtData(String(caixa.data_caixa).slice(0, 10))} já foi encerrado: não dá para reabrir este caixa`, 'DIA_ENCERRADO');
  await conferirSenha(user?.email, b.senha, PERFIS_REABRIR);
  // a retirada do fechamento volta (o dinheiro está de novo no caixa)
  await q(
    supabase
      .from('hc_caixa_movimentos')
      .update({ estornado_em: new Date().toISOString(), estornado_por: quem(user), estorno_motivo: `Caixa reaberto: ${motivo}` })
      .eq('caixa_id', caixa.id)
      .eq('tipo', 'retirada_fechamento')
      .is('estornado_em', null),
  );
  const { data: reaberto, error } = await supabase
    .from('hc_caixas')
    .update({ status: 'aberto', reaberto_em: new Date().toISOString(), reaberto_por: quem(user), reabertura_motivo: motivo, fechado_em: null, fechado_por: null, fechado_por_id: null })
    .eq('id', caixa.id)
    .eq('status', 'fechado')
    .select()
    .single();
  if (error) {
    if (/duplicate key|hc_caixas_um_aberto/i.test(error.message)) throw new CaixaError(`O terminal ${caixa.terminal} já tem outro caixa aberto`, 'JA_ABERTO', 409);
    throw falhaDb(error);
  }
  return reaberto;
}

// ─── encerramento diário ─────────────────────────────────────────────────────
export async function verificarEncerramento(user, empresa) {
  const e = await exigirEmpresa(user, empresa);
  const data = await dataDaEmpresa(e.code);
  const hoje = hojeBrasil();
  const caixas = await q(supabase.from('hc_caixas').select('id, terminal, status, aberto_por, aberto_em, fechado_em, fechado_por, diferenca').eq('empresa', e.code).eq('data_caixa', data.data).order('terminal'));
  const ids = (caixas || []).map((c) => c.id);
  const pendentes = ids.length
    ? await q(supabase.from('pdv_vendas').select('id, status, total, cliente_nome, caixa_id').in('caixa_id', ids).in('status', ['registrada', 'emitindo', 'rejeitada']))
    : [];
  const abertos = (caixas || []).filter((c) => c.status === 'aberto');
  const sugerida = data.data < hoje ? hoje : maisDias(data.data, 1);
  return {
    empresa: e,
    dataCaixa: data.data,
    hoje,
    proximaSugerida: sugerida,
    caixas: caixas || [],
    caixasAbertos: abertos,
    vendasPendentes: pendentes || [],
    comDiferenca: (caixas || []).filter((c) => c.status === 'fechado' && Math.abs(Number(c.diferenca || 0)) > 0.005),
    podeEncerrar: abertos.length === 0,
    motivo: abertos.length ? `Feche ${abertos.length === 1 ? 'o caixa' : 'os caixas'} do terminal ${abertos.map((c) => c.terminal).join(', ')} antes de encerrar o dia` : null,
  };
}

export async function encerrarDia(user, b = {}) {
  const v = await verificarEncerramento(user, b.empresa);
  if (!v.podeEncerrar) throw new CaixaError(v.motivo, 'CAIXA_ABERTO', 409);
  const proxima = ehData(b.proximaData) ? b.proximaData : v.proximaSugerida;
  if (proxima <= v.dataCaixa) throw new CaixaError('A nova data de caixa tem que ser depois da atual');
  // até amanhã do dia encerrado (ou até hoje, se a data tinha ficado para trás) é livre;
  // pular para mais adiante pede owner, admin ou financeiro (como o GERFP081 do TOTVS)
  const limiteLivre = v.dataCaixa < v.hoje ? v.hoje : maisDias(v.dataCaixa, 1);
  let autorizadoPor = null;
  if (proxima > limiteLivre) {
    if (!b.autorizador?.email) throw new CaixaError(`Avançar a data de caixa para ${fmtData(proxima)} pede a senha de owner, admin ou financeiro`, 'PEDE_AUTORIZACAO', 403);
    const a = await conferirSenha(b.autorizador.email, b.autorizador.senha, PERFIS_DATA_FUTURA);
    autorizadoPor = a.nome;
  }
  await gravarData(v.empresa.code, proxima, quem(user));
  const enc = await q(
    supabase
      .from('hc_caixa_encerramentos')
      .insert({
        empresa: v.empresa.code,
        data_caixa: v.dataCaixa,
        proxima_data: proxima,
        verificacao: { caixas: v.caixas.length, vendasPendentes: v.vendasPendentes.length, comDiferenca: v.comDiferenca.length, automatico: !!b.automatico },
        autorizado_por: autorizadoPor,
        por_id: user?.id || null,
        por: quem(user),
      })
      .select()
      .single(),
  );
  console.log(`📅 [caixa] encerramento empresa ${v.empresa.code}: ${v.dataCaixa} → ${proxima} · ${quem(user)}${b.automatico ? ' (na abertura)' : ''}`);
  return enc;
}

// ─── histórico de caixas ─────────────────────────────────────────────────────
export async function listarCaixas(user, { empresa, de, ate } = {}) {
  const e = await exigirEmpresa(user, empresa);
  let qy = supabase
    .from('hc_caixas')
    .select('id, terminal, data_caixa, status, aberto_em, aberto_por, fechado_em, fechado_por, fundo_inicial, fundo_final, retirada_fechamento, diferenca, diferenca_dinheiro, resumo')
    .eq('empresa', e.code)
    .order('data_caixa', { ascending: false })
    .order('terminal')
    .limit(200);
  if (ehData(de)) qy = qy.gte('data_caixa', de);
  if (ehData(ate)) qy = qy.lte('data_caixa', ate);
  return q(qy);
}

export async function detalheCaixa(user, caixaId) {
  const caixa = await carregarCaixa(caixaId);
  const e = await exigirEmpresa(user, caixa.empresa);
  return { empresa: e, ...(await resumoDoCaixa(caixa)) };
}

// ─── vínculo da venda com o caixa aberto ─────────────────────────────────────
/**
 * Caixa aberto da empresa para gravar na venda (pdv_vendas.caixa_id).
 * Nunca lança erro: sem caixa aberto (ou sem as tabelas) devolve null e a
 * venda segue como antes. Com mais de um terminal aberto, usa o terminal
 * informado; senão, o de menor número.
 */
export async function caixaAbertoPara(empresa, terminal = null) {
  try {
    const { data, error } = await supabase.from('hc_caixas').select('id, terminal, data_caixa').eq('empresa', Number(empresa)).eq('status', 'aberto').order('terminal');
    if (error || !data?.length) return null;
    return data.find((c) => Number(c.terminal) === Number(terminal)) || data[0];
  } catch {
    return null;
  }
}
