// =============================================================================
// Solicitações Crosby → HEADCOACH › CONTAS A PAGAR.
// O financeiro aprova a solicitação e ela vira duplicata no contas a pagar do
// HeadCoach (no lugar do antigo "Enviar ao TOTVS" — Yago, 23/11/2026). Nada é
// lançado no TOTVS; de lá só se lê o cadastro do fornecedor quando ele ainda
// não está na cópia local.
//
//   • a duplicata nasce com origem "solicitacao-crosby" e origem_ref = id da
//     solicitação (enviar de novo não duplica);
//   • a solicitação segue o fluxo de sempre: fica "enviada" (mesmo status de
//     antes, para a Liberação de Pagamento continuar igual) e guarda em
//     totvs_response { destino: 'contas-pagar-headcoach', titulos: [...] };
//   • Patrimônio/produto já pago no cartão e conciliado: a duplicata entra paga.
//
// LIBERAR PARA PAGAMENTO (Yago, 23/11/2026): a solicitação liberada cai na
// Liberação de Pagamento do HEADCOACH (hc_cp_liberacoes), não mais na antiga.
// A que ainda não tem duplicata no contas a pagar (status Nota Fiscal, que não
// passa pelo envio) ganha a duplicata na hora de liberar.
// =============================================================================
import supabase from '../config/supabase.js';
import { CpError, PERFIS_FINANCEIRO, validarInclusao, inserirTitulos, rotuloDuplicata } from './hcContasPagar.js';
import { liberarTitulos, EM_ANDAMENTO } from './hcCpLiberacao.js';
import { inclusaoDaSolicitacao, escolherFornecedor, motivoDeNaoLiberarSolicitacao, ORIGEM_SOLICITACAO, DESTINO_HC, STATUS_QUE_ENVIAM } from '../utils/solicitacaoCp.js';

const dig = (v) => String(v ?? '').replace(/\D+/g, '');
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const quem = (user) => user?.name || user?.email || null;
const normSetor = (n) =>
  String(n || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();

async function q(promessa) {
  const { data, error } = await promessa;
  if (error) throw new CpError(`Banco de dados: ${error.message}`, 'DB_ERROR', 500);
  return data;
}

/** Quem envia: owner, admin, financeiro — ou quem está no setor FINANCEIRO (igual à tela das Solicitações). */
async function exigirFinanceiroDasSolicitacoes(user) {
  if (PERFIS_FINANCEIRO.includes(user?.role)) return;
  if (user?.id) {
    const [membro, gestor] = await Promise.all([q(supabase.from('setor_usuarios').select('setor_id').eq('user_id', user.id)), q(supabase.from('setores').select('id, nome').eq('gestor_id', user.id))]);
    const ids = (membro || []).map((m) => m.setor_id);
    const setores = ids.length ? await q(supabase.from('setores').select('id, nome').in('id', ids)) : [];
    if ([...(setores || []), ...(gestor || [])].some((s) => normSetor(s.nome) === 'FINANCEIRO')) return;
  }
  throw new CpError('Só o financeiro envia a solicitação ao contas a pagar', 'SEM_PERMISSAO', 403);
}

/** Empresa da solicitação: a escolhida no formulário; se não existir no cadastro, a do CNPJ. */
async function empresaDaSolicitacao(sol) {
  const code = Number(sol.cd_empresa);
  if (code > 0) {
    const e = await q(supabase.from('erp_empresas').select('code').eq('code', code).maybeSingle());
    if (e) return Number(e.code);
  }
  const cnpj = dig(sol.branch_cnpj) || dig(sol.payload_totvs?.branchCnpj);
  if (cnpj) {
    const lista = await q(supabase.from('erp_empresas').select('code, propria').eq('cnpj', cnpj).order('code'));
    const e = (lista || []).find((x) => x.propria) || (lista || [])[0];
    if (e) return Number(e.code);
  }
  throw new CpError(`A empresa da solicitação (${sol.cd_empresa || '—'} · CNPJ ${cnpj || '—'}) não está no cadastro de empresas`, 'EMPRESA', 404);
}

/** Fornecedor ainda fora da cópia local: busca o cadastro dele (só leitura) e grava a cópia. */
async function trazerFornecedorDoCadastro(doc) {
  try {
    const [{ totvs }, { mapPessoa }] = await Promise.all([import('./erp/totvsClient.js'), import('./erp/sync/entidades.js')]);
    const pj = doc.length === 14;
    const r = await totvs('POST', pj ? '/person/v2/legal-entities/search' : '/person/v2/individuals/search', { data: { filter: pj ? { cnpjList: [doc] } : { cpfList: [doc] }, expand: 'phones,emails,addresses,classifications', page: 1, pageSize: 10 }, timeout: 30000 });
    const itens = (r?.items || r?.data?.items || []).filter((p) => dig(pj ? p.cnpj : p.cpf) === doc);
    if (!itens.length) return [];
    const linhas = itens.map((p) => mapPessoa(p, pj ? 'PJ' : 'PF'));
    await q(supabase.from('erp_pessoas').upsert(linhas, { onConflict: 'code' }));
    return linhas;
  } catch (e) {
    if (e instanceof CpError) throw e;
    console.warn(`[solicitação → contas a pagar] não consegui ler o cadastro do fornecedor ${doc}: ${e.message}`);
    return [];
  }
}

async function fornecedorDaSolicitacao(sol) {
  const doc = dig(sol.supplier_cpf_cnpj) || dig(sol.payload_totvs?.supplierCpfCnpj);
  if (doc.length !== 11 && doc.length !== 14) throw new CpError('A solicitação está sem o CPF/CNPJ do fornecedor', 'FORNECEDOR');
  const local = await q(supabase.from('erp_pessoas').select('code, nome, cpf_cnpj, is_fornecedor, inativo').eq('cpf_cnpj', doc));
  let escolhido = escolherFornecedor(local);
  let achados = local || [];
  if (!escolhido) {
    const doCadastro = await trazerFornecedorDoCadastro(doc);
    if (doCadastro.length) achados = doCadastro;
    escolhido = escolherFornecedor(doCadastro);
  }
  if (escolhido) return Number(escolhido.code);
  const nome = sol.supplier_name || doc;
  if (achados.length) throw new CpError(`${nome} (${doc}) está no cadastro, mas não está marcado como fornecedor. Marque como fornecedor e envie de novo.`, 'FORNECEDOR');
  throw new CpError(`${nome} (${doc}) não está no cadastro de fornecedores. Cadastre o fornecedor e envie de novo.`, 'FORNECEDOR', 404);
}

const titulosDaSolicitacao = (id) => q(supabase.from('hc_cp_titulos').select('id, empresa, fornecedor_code, fornecedor_nome, duplicata, parcela, valor, vencimento, situacao').eq('origem', ORIGEM_SOLICITACAO).eq('origem_ref', String(id)).neq('situacao', 'cancelado').order('parcela'));

/** Patrimônio / produto: o cartão já pagou e o extrato já foi conciliado → a duplicata entra paga. */
async function baixarPelaConciliacao(sol, titulos) {
  const data = String(sol.conciliacao_data || sol.conciliado_em || sol.pago_em || '').slice(0, 10) || hojeBrasil();
  const agora = new Date().toISOString();
  const por = 'Conciliação do extrato (Solicitações)';
  for (const t of titulos) {
    const pago = await q(supabase.from('hc_cp_titulos').update({ situacao: 'pago', data_pagamento: data, valor_pago: t.valor, forma_pagamento: 'cartao', conta_pagamento: sol.conciliacao_banco || null, baixado_por: por, baixado_em: agora, atualizado_em: agora }).eq('id', t.id).eq('situacao', 'aberto').select('id').maybeSingle());
    if (pago) await q(supabase.from('hc_cp_baixas').insert({ titulo_id: t.id, data_pagamento: data, valor_titulo: t.valor, juros: 0, multa: 0, desconto: 0, valor_pago: t.valor, forma_pagamento: 'cartao', conta: sol.conciliacao_banco || null, observacao: 'Pago no cartão e conciliado com o extrato na solicitação', por }));
  }
}

const resumo = (titulos) => titulos.map((t) => ({ id: t.id, empresa: t.empresa, fornecedor_code: t.fornecedor_code, duplicata: t.duplicata, parcela: t.parcela, valor: Number(t.valor), vencimento: String(t.vencimento).slice(0, 10) }));

async function marcarEnviada(sol, titulos) {
  const patch = { status: 'enviado_totvs', enviado_totvs_em: new Date().toISOString(), totvs_erro: null, totvs_response: { destino: DESTINO_HC, titulos: resumo(titulos) } };
  await q(supabase.from('solicitacoes_crosby').update(patch).eq('id', sol.id));
  return patch;
}

/** A duplicata pronta para gravar (empresa e fornecedor achados no cadastro, dados conferidos). Não grava nada no contas a pagar. */
export async function prepararDuplicata(sol) {
  const [empresa, fornecedorCode] = await Promise.all([empresaDaSolicitacao(sol), fornecedorDaSolicitacao(sol)]);
  let corpo;
  try {
    corpo = inclusaoDaSolicitacao(sol, { empresa, fornecedorCode, hoje: hojeBrasil() });
  } catch (e) {
    throw new CpError(e.message, 'SOLICITACAO');
  }
  return validarInclusao(corpo);
}

/**
 * Envia a solicitação aprovada para o contas a pagar do HeadCoach.
 * @returns {{ solicitacao, titulos, rotulo, jaEnviada }}
 */
export async function enviarSolicitacaoAoCp(user, id) {
  await exigirFinanceiroDasSolicitacoes(user);
  const sol = await q(supabase.from('solicitacoes_crosby').select('*').eq('id', id).maybeSingle());
  if (!sol) throw new CpError('Solicitação não encontrada', 'NOT_FOUND', 404);

  // já virou duplicata (clique repetido, tela desatualizada): só confirma
  const jaTem = await titulosDaSolicitacao(sol.id);
  if (jaTem?.length) {
    const patch = sol.status === 'enviado_totvs' && sol.totvs_response?.destino === DESTINO_HC ? {} : await marcarEnviada(sol, jaTem);
    return { solicitacao: { ...sol, ...patch }, titulos: jaTem, rotulo: jaTem.map(rotuloDuplicata).join(', '), jaEnviada: true };
  }
  if (sol.status === 'enviado_totvs') throw new CpError('Esta solicitação já foi enviada antes (ao TOTVS) e não pode ser lançada de novo', 'JA_ENVIADA', 409);
  if (sol.tem_nota_fiscal === true && sol.status !== 'conciliado') throw new CpError('Solicitação com nota fiscal não vira duplicata: ela segue pelo chamado de escrituração', 'NOTA_FISCAL', 409);
  // Compras & Manutenção não passam pela aprovação do gestor: seguem as etapas da tela delas
  const porEtapas = ['compra', 'manutencao'].includes(sol.tipo_solicitacao) && sol.status !== 'rejeitado';
  if (!porEtapas && !STATUS_QUE_ENVIAM.includes(sol.status)) throw new CpError(`A solicitação está "${sol.status}" e ainda não pode ir para o contas a pagar`, 'STATUS', 409);

  let criados;
  try {
    criados = await inserirTitulos(await prepararDuplicata(sol), { por: quem(user), origem: ORIGEM_SOLICITACAO, origemRef: String(sol.id) });
  } catch (e) {
    // o erro fica na solicitação (como ficava o erro do envio antigo) para o financeiro corrigir e reenviar
    if (e instanceof CpError && e.status !== 500) await supabase.from('solicitacoes_crosby').update({ status: 'erro_envio', totvs_erro: e.message, totvs_response: { destino: DESTINO_HC, erro: e.code || null } }).eq('id', sol.id);
    throw e;
  }
  if (sol.status === 'conciliado') await baixarPelaConciliacao(sol, criados);
  const patch = await marcarEnviada(sol, criados);
  const rotulo = criados.map(rotuloDuplicata).join(', ');
  console.log(`🧾 [solicitação → contas a pagar] ${sol.id} · ${criados[0]?.fornecedor_nome} · empresa ${criados[0]?.empresa} · duplicata ${rotulo}${sol.status === 'conciliado' ? ' (já paga)' : ''} · ${quem(user)}`);
  return { solicitacao: { ...sol, ...patch }, titulos: criados, rotulo, jaEnviada: false };
}

/**
 * LIBERAR PARA PAGAMENTO de uma solicitação: as duplicatas dela entram como
 * PENDENTE na Liberação de Pagamento do HeadCoach. A solicitação continua no
 * mesmo status (Nota Fiscal segue Nota Fiscal) e fica marcada como liberada.
 * @returns {{ solicitacao, titulos, rotulo, liberadas, criouDuplicata, jaLiberada }}
 */
export async function liberarSolicitacaoParaPagamento(user, id) {
  await exigirFinanceiroDasSolicitacoes(user);
  const sol = await q(supabase.from('solicitacoes_crosby').select('*').eq('id', id).maybeSingle());
  if (!sol) throw new CpError('Solicitação não encontrada', 'NOT_FOUND', 404);
  const motivo = motivoDeNaoLiberarSolicitacao(sol);
  if (motivo) throw new CpError(motivo, 'NAO_LIBERA', 409);

  // sem duplicata no contas a pagar (Nota Fiscal, ou enviada no modelo antigo): cria agora
  let titulos = await titulosDaSolicitacao(sol.id);
  const criouDuplicata = !titulos?.length;
  if (criouDuplicata) titulos = await inserirTitulos(await prepararDuplicata(sol), { por: quem(user), origem: ORIGEM_SOLICITACAO, origemRef: String(sol.id) });

  const ids = titulos.map((t) => t.id);
  const r = await liberarTitulos(user, { ids }, { semConferirEmpresa: true });
  const emAndamento = await q(supabase.from('hc_cp_liberacoes').select('id, titulo_id, status').in('titulo_id', ids).in('status', EM_ANDAMENTO));
  const rotulo = titulos.map(rotuloDuplicata).join(', ');
  if (!emAndamento?.length) throw new CpError(`A duplicata ${rotulo} não foi para a Liberação de Pagamento: ${r.ignoradas?.[0]?.motivo || 'não tem valor em aberto'}`, 'NAO_LIBERA', 409);

  const patch = {
    liberado_pagamento_em: sol.liberado_pagamento_em || new Date().toISOString(),
    liberado_pagamento_por: sol.liberado_pagamento_por || user?.id || null,
    liberado_pagamento_por_nome: sol.liberado_pagamento_por_nome || quem(user),
    totvs_response: { ...(sol.totvs_response && typeof sol.totvs_response === 'object' && !Array.isArray(sol.totvs_response) ? sol.totvs_response : {}), destino: DESTINO_HC, titulos: resumo(titulos), liberacoes: emAndamento.map((l) => l.id) },
  };
  await q(supabase.from('solicitacoes_crosby').update(patch).eq('id', sol.id));
  console.log(`📤 [solicitação → liberação de pagamento] ${sol.id} · ${titulos[0]?.fornecedor_nome} · empresa ${titulos[0]?.empresa} · duplicata ${rotulo}${criouDuplicata ? ' (criada agora)' : ''} · ${quem(user)}`);
  return { solicitacao: { ...sol, ...patch }, titulos, rotulo, liberadas: r.liberadas, criouDuplicata, jaLiberada: r.liberadas === 0 };
}
