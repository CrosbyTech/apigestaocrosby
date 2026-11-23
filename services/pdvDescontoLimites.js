// ============================================================================
// HEADCOACH › FINANCEIRO › LIBERAÇÃO DE DESCONTO (Yago, 19/11/2026)
//
// Limite de desconto do PDV Crosby por vendedor. Antes era 15% fixo na tela,
// igual para todos; acima disso a tela pede a senha de um owner/admin.
// Agora o limite é de cada usuário:
//   • quem aparece na tela: usuários do setor VAREJO (membro ou gestor) com
//     loja configurada (user_companies)
//   • quem não tem limite gravado: DESCONTO_PADRAO_PCT (15%); gerente (perfil
//     manager): DESCONTO_GERENTE_PCT (30%) automático
//   • owner e admin: sem limite, como sempre
// Desconto acima do limite de quem está vendendo: outro usuário digita e-mail e
// senha e autoriza ATÉ O LIMITE DELE (autorizarDesconto) — não precisa ser
// owner/admin: basta ter aquele desconto liberado (Yago, 19/11/2026).
// A mudança pode ser de um usuário, de todos os de uma loja ou de todos.
// Quem tem mais de MAX_LOJAS_VENDEDOR lojas configuradas é supervisor (há usuário
// com todas as empresas): não conta nem muda na mudança POR LOJA — só na
// própria linha ou em "todos" — para uma loja não mexer no limite dele nas outras.
// Tabelas: pdv_desconto_limites e pdv_desconto_limites_hist
// (migrations/pdv_desconto_limites.sql).
// ============================================================================
import supabase from '../config/supabase.js';
import { verificarSenhaAutorizador, AutorizacaoError } from './autorizacaoSenha.js';

export const DESCONTO_PADRAO_PCT = 15;
export const DESCONTO_GERENTE_PCT = 30;
/** Limite de quem nunca teve o seu gravado: gerente 30%, os demais 15%. */
export const padraoDoPerfil = (role) => (role === 'manager' ? DESCONTO_GERENTE_PCT : DESCONTO_PADRAO_PCT);
export const MAX_LOJAS_VENDEDOR = 3;
const PERFIS_SEM_LIMITE = ['owner', 'admin'];
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const norm = (n) =>
  String(n || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();

export class DescontoLimiteError extends Error {
  constructor(message, code = 'DESCONTO_LIMITE', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const semTabela = (error) => /pdv_desconto_limites/.test(error?.message || '') && /does not exist|schema cache/i.test(error.message);
const erroDoBanco = (error) =>
  semTabela(error)
    ? new DescontoLimiteError('As tabelas do limite de desconto ainda não existem — rode node scripts/migrar-pdv-desconto-limites.mjs', 'MIGRATION_PENDING', 503)
    : new DescontoLimiteError(error.message, 'DB_ERROR', 500);

// ── usuários do setor VAREJO com loja configurada ──
let cacheUsuarios = { ate: 0, lista: null };
async function usuariosDoVarejo({ fresco = false } = {}) {
  if (!fresco && cacheUsuarios.lista && cacheUsuarios.ate > Date.now()) return cacheUsuarios.lista;
  const [{ data: setores, error: e1 }, { data: vinculos, error: e2 }] = await Promise.all([supabase.from('setores').select('id, nome, gestor_id'), supabase.from('setor_usuarios').select('setor_id, user_id')]);
  if (e1 || e2) throw new DescontoLimiteError(`Não consegui ler o setor Varejo: ${(e1 || e2).message}`, 'DB_ERROR', 500);
  const ids = new Set();
  for (const s of (setores || []).filter((x) => norm(x.nome) === 'VAREJO')) {
    for (const v of vinculos || []) if (v.setor_id === s.id) ids.add(v.user_id);
    if (s.gestor_id) ids.add(s.gestor_id);
  }
  if (!ids.size) return [];
  const { data: lojas, error: e3 } = await supabase.from('user_companies').select('user_id, cd_empresa').in('user_id', [...ids]);
  if (e3) throw new DescontoLimiteError(`Não consegui ler as lojas dos usuários: ${e3.message}`, 'DB_ERROR', 500);
  const lojasDe = new Map();
  for (const l of lojas || []) {
    const n = Number(l.cd_empresa);
    if (!Number.isFinite(n)) continue;
    if (!lojasDe.has(l.user_id)) lojasDe.set(l.user_id, new Set());
    lojasDe.get(l.user_id).add(n);
  }
  // cadastro (nome, e-mail, perfil) de quem tem loja
  const contas = new Map();
  for (let pagina = 1; pagina <= 50; pagina += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw new DescontoLimiteError(`Não consegui ler o cadastro de usuários: ${error.message}`, 'DB_ERROR', 500);
    for (const u of data?.users || []) if (lojasDe.has(u.id)) contas.set(u.id, u);
    if ((data?.users || []).length < 200) break;
  }
  const lista = [...lojasDe.entries()]
    .filter(([id]) => contas.has(id))
    .map(([id, set]) => {
      const u = contas.get(id);
      return { id, nome: u.user_metadata?.name || u.email, email: u.email, role: u.user_metadata?.role || 'guest', empresas: [...set].sort((a, b) => a - b) };
    })
    .sort((a, b) => a.empresas[0] - b.empresas[0] || a.empresas.length - b.empresas.length || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  cacheUsuarios = { ate: Date.now() + 60000, lista };
  return lista;
}

async function limitesGravados(ids = null) {
  let q = supabase.from('pdv_desconto_limites').select('user_id, pct, atualizado_por, atualizado_em');
  if (ids) q = q.in('user_id', ids);
  const { data, error } = await q;
  if (error) throw erroDoBanco(error);
  return new Map((data || []).map((l) => [l.user_id, l]));
}

/**
 * Tela: usuários do Varejo com loja, o limite de cada um e o resumo por loja.
 * → { padrao, usuarios: [{ userId, nome, email, role, empresas, variasLojas, pct, proprio, semLimite, atualizadoPor, atualizadoEm }], lojas: [{ empresa, usuarios, menor, maior }] }
 */
export async function listarLimites({ fresco = false } = {}) {
  const lista = await usuariosDoVarejo({ fresco });
  const gravados = await limitesGravados();
  const usuarios = lista.map((u) => {
    const g = gravados.get(u.id);
    return {
      userId: u.id,
      nome: u.nome,
      email: u.email,
      role: u.role,
      empresas: u.empresas,
      variasLojas: u.empresas.length > MAX_LOJAS_VENDEDOR, // supervisor: fora da mudança por loja
      pct: g ? Number(g.pct) : padraoDoPerfil(u.role),
      padrao: padraoDoPerfil(u.role), // o que vale para ele sem limite gravado (gerente: 30%)
      proprio: !!g, // false = nunca foi mudado (está no padrão)
      semLimite: PERFIS_SEM_LIMITE.includes(u.role), // owner/admin não são limitados pelo PDV
      atualizadoPor: g?.atualizado_por || null,
      atualizadoEm: g?.atualizado_em || null,
    };
  });
  const porLoja = new Map();
  for (const u of usuarios) {
    if (u.variasLojas) continue;
    for (const e of u.empresas) {
      const l = porLoja.get(e) || { empresa: e, usuarios: 0, menor: u.pct, maior: u.pct };
      l.usuarios += 1;
      l.menor = Math.min(l.menor, u.pct);
      l.maior = Math.max(l.maior, u.pct);
      porLoja.set(e, l);
    }
  }
  return { padrao: DESCONTO_PADRAO_PCT, padraoGerente: DESCONTO_GERENTE_PCT, usuarios, lojas: [...porLoja.values()].sort((a, b) => a.empresa - b.empresa) };
}

/** Limite de quem está logado (o PDV Crosby pergunta ao abrir). Nunca falha: na dúvida, o padrão. */
export async function limiteDoUsuario(user) {
  if (PERFIS_SEM_LIMITE.includes(user?.role)) return { pct: 100, semLimite: true, padrao: DESCONTO_PADRAO_PCT };
  try {
    const { data, error } = await supabase.from('pdv_desconto_limites').select('pct').eq('user_id', user?.id || '00000000-0000-0000-0000-000000000000').maybeSingle();
    if (error) throw error;
    return { pct: data ? Number(data.pct) : padraoDoPerfil(user?.role), semLimite: false, padrao: padraoDoPerfil(user?.role) };
  } catch (e) {
    console.warn(`⚠️ [desconto] não consegui ler o limite de ${user?.email || '?'}: ${e.message} — usando o padrão de ${padraoDoPerfil(user?.role)}%`);
    return { pct: padraoDoPerfil(user?.role), semLimite: false, padrao: padraoDoPerfil(user?.role) };
  }
}

/**
 * Muda o limite de desconto.
 * @param escopo 'usuario' (userId) | 'loja' (empresa) | 'todos'
 * @returns {{ pct, escopo, empresa, alterados: [{ userId, nome, de, para }], iguais: number }}
 */
export async function definirLimite({ escopo, userId = null, empresa = null, pct, por = null } = {}) {
  // vazio não é zero: null, '' e afins são recusados (0% tira o desconto do vendedor)
  const texto = typeof pct === 'number' ? String(pct) : typeof pct === 'string' ? pct.trim().replace(',', '.') : '';
  const valor = /^\d+(\.\d+)?$/.test(texto) ? r2(texto) : NaN;
  if (!Number.isFinite(valor) || valor < 0 || valor > 100) throw new DescontoLimiteError('Informe o limite de desconto entre 0 e 100%', 'PCT_INVALIDO');
  const lista = await usuariosDoVarejo({ fresco: true });
  let alvo;
  const loja = Number(empresa);
  if (escopo === 'usuario') {
    alvo = lista.filter((u) => u.id === userId);
    if (!alvo.length) throw new DescontoLimiteError('Usuário não encontrado entre os do setor Varejo com loja configurada', 'USUARIO_FORA_DA_LISTA', 404);
  } else if (escopo === 'loja') {
    if (!Number.isFinite(loja) || !(loja > 0)) throw new DescontoLimiteError('Informe a loja', 'LOJA_INVALIDA');
    alvo = lista.filter((u) => u.empresas.includes(loja) && u.empresas.length <= MAX_LOJAS_VENDEDOR);
    if (!alvo.length) throw new DescontoLimiteError(`Nenhum vendedor do setor Varejo está configurado na loja ${loja}`, 'LOJA_SEM_USUARIOS', 404);
  } else if (escopo === 'todos') {
    alvo = lista;
    if (!alvo.length) throw new DescontoLimiteError('Nenhum usuário do setor Varejo tem loja configurada', 'SEM_USUARIOS', 404);
  } else {
    throw new DescontoLimiteError('Escopo inválido (usuario, loja ou todos)', 'ESCOPO_INVALIDO');
  }

  const gravados = await limitesGravados(alvo.map((u) => u.id));
  const agora = new Date().toISOString();
  const linhas = [];
  const historico = [];
  const alterados = [];
  let iguais = 0;
  for (const u of alvo) {
    const g = gravados.get(u.id);
    const de = g ? Number(g.pct) : padraoDoPerfil(u.role);
    if (g && de === valor) {
      iguais += 1;
      continue;
    }
    // quem está no padrão e recebe o mesmo valor ganha a linha (fica "definido"), sem histórico de mudança
    linhas.push({ user_id: u.id, usuario_nome: u.nome, usuario_email: u.email, empresas: u.empresas, pct: valor, atualizado_por: por?.nome || null, atualizado_por_id: por?.id || null, atualizado_em: agora });
    if (de === valor) {
      iguais += 1;
      continue;
    }
    historico.push({ user_id: u.id, usuario_nome: u.nome, usuario_email: u.email, empresas: u.empresas, de_pct: de, para_pct: valor, escopo, escopo_empresa: escopo === 'loja' ? loja : null, alterado_por: por?.nome || null, alterado_por_id: por?.id || null, alterado_em: agora });
    alterados.push({ userId: u.id, nome: u.nome, de, para: valor });
  }
  if (linhas.length) {
    const { error } = await supabase.from('pdv_desconto_limites').upsert(linhas, { onConflict: 'user_id' });
    if (error) throw erroDoBanco(error);
  }
  if (historico.length) {
    const { error } = await supabase.from('pdv_desconto_limites_hist').insert(historico);
    if (error) console.error(`❌ [desconto] limites gravados, mas o histórico não (${error.message})`);
  }
  if (alterados.length) {
    console.log(`🏷️ [desconto] limite de desconto → ${valor}% (${escopo}${escopo === 'loja' ? ` ${loja}` : ''}) por ${por?.nome || '?'}: ${alterados.map((a) => `${a.nome} ${a.de}%→${a.para}%`).join('; ').slice(0, 600)}`);
  }
  return { pct: valor, escopo, empresa: escopo === 'loja' ? loja : null, alterados, iguais };
}

/**
 * Desconto acima do limite de quem está vendendo: outro usuário autoriza com o
 * e-mail e a senha dele, até o limite DELE (owner/admin: qualquer desconto).
 * @returns {{ nome, email, role, pct, semLimite }} pct = até quanto ele liberou nesta venda
 */
export async function autorizarDesconto({ email, senha, pct, empresa = null, pedidoPor = null } = {}) {
  const pedido = r2(pct);
  if (!Number.isFinite(pedido) || pedido <= 0 || pedido > 100) throw new DescontoLimiteError('Informe o desconto a liberar', 'PCT_INVALIDO');
  let quem;
  try {
    quem = await verificarSenhaAutorizador(email, senha, null);
  } catch (e) {
    if (e instanceof AutorizacaoError) throw new DescontoLimiteError(e.message, e.code, e.status);
    throw e;
  }
  const limite = await limiteDoUsuario(quem);
  const fmt = (n) => `${String(n).replace('.', ',')}%`;
  if (!limite.semLimite && pedido > limite.pct + 0.0001) {
    console.log(`🔒 [desconto] ${quem.email} (${quem.role}, até ${limite.pct}%) NÃO pôde liberar ${pedido}% para ${pedidoPor || '?'} na empresa ${empresa ?? '?'}`);
    throw new DescontoLimiteError(`${quem.nome} só pode liberar até ${fmt(limite.pct)} de desconto, e o desconto pedido é de ${fmt(pedido)}`, 'LIMITE_DO_AUTORIZADOR', 403);
  }
  console.log(`🔓 [desconto] ${pedido}% liberado por ${quem.email} (${quem.role}, ${limite.semLimite ? 'sem limite' : `até ${limite.pct}%`}) para ${pedidoPor || '?'} na empresa ${empresa ?? '?'}`);
  return { nome: quem.nome, email: quem.email, role: quem.role, pct: limite.semLimite ? 100 : limite.pct, semLimite: limite.semLimite };
}

/** Últimas mudanças (mais recentes primeiro). */
export async function historicoDosLimites({ limite = 200 } = {}) {
  const { data, error } = await supabase
    .from('pdv_desconto_limites_hist')
    .select('id, user_id, usuario_nome, usuario_email, empresas, de_pct, para_pct, escopo, escopo_empresa, alterado_por, alterado_em')
    .order('id', { ascending: false })
    .limit(Math.max(1, Math.min(1000, Number(limite) || 200)));
  if (error) throw erroDoBanco(error);
  return (data || []).map((h) => ({
    id: h.id,
    userId: h.user_id,
    nome: h.usuario_nome,
    email: h.usuario_email,
    empresas: h.empresas || [],
    de: Number(h.de_pct),
    para: Number(h.para_pct),
    escopo: h.escopo,
    escopoEmpresa: h.escopo_empresa,
    por: h.alterado_por,
    em: h.alterado_em,
  }));
}
