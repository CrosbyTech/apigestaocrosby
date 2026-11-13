// ============================================================================
// Empresas que cada usuário enxerga (Yago, 13/11/2026: os vendedores das lojas
// só acessam a PRÓPRIA empresa no PDV, Transações, Transferências, Caixa,
// Estoque e Recebimento).
//   • owner / admin ............ todas (sem restrição)
//   • setor REVENDA, MULTIMARCAS ou EXPEDIÇÃO (membro ou gestor): empresas
//     fixas 99 e 990 (Yago, 13/11/2026), somadas às vinculadas, se houver
//   • com empresas vinculadas .. só as vinculadas (Painel Admin → user_companies)
//   • guest / vendedor SEM vínculo: NENHUMA (vendedor sem loja não vê nada)
//   • demais perfis sem vínculo (financeiro, manager…): todas, como antes
// empresasRestritasDoUsuario devolve null = sem restrição, ou a lista de códigos.
// ============================================================================
import supabase from '../config/supabase.js';
import { usuarioDoToken } from '../middlewares/auth.js';

export const PERFIS_LIVRES = ['owner', 'admin'];
export const PERFIS_SO_VINCULADAS = ['guest', 'vendedor'];
// setor (tabelas setores + setor_usuarios, nome sem acento e em maiúsculas) → empresas fixas
export const EMPRESAS_FIXAS_POR_SETOR = {
  REVENDA: [99, 990],
  MULTIMARCAS: [99, 990],
  EXPEDICAO: [99, 990],
};
const normSetor = (n) =>
  String(n || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

/** Empresas fixas pelos setores do usuário (membro ou gestor). */
export async function empresasDoSetor(user) {
  if (!user?.id) return [];
  const [{ data: membro, error: e1 }, { data: gestor, error: e2 }] = await Promise.all([
    supabase.from('setor_usuarios').select('setor_id').eq('user_id', user.id),
    supabase.from('setores').select('id, nome').eq('gestor_id', user.id),
  ]);
  if (e1 || e2) throw new Error(`Não consegui ler o setor do usuário: ${(e1 || e2).message}`);
  const ids = (membro || []).map((m) => m.setor_id);
  const { data: setores, error: e3 } = ids.length ? await supabase.from('setores').select('id, nome').in('id', ids) : { data: [] };
  if (e3) throw new Error(`Não consegui ler o setor do usuário: ${e3.message}`);
  const codes = new Set();
  for (const st of [...(setores || []), ...(gestor || [])]) for (const c of EMPRESAS_FIXAS_POR_SETOR[normSetor(st.nome)] || []) codes.add(c);
  return [...codes];
}

export async function empresasRestritasDoUsuario(user) {
  if (!user) return null;
  if (PERFIS_LIVRES.includes(user.role)) return null;
  const { data, error } = await supabase.from('user_companies').select('cd_empresa').eq('user_id', user.id || '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error(`Não consegui ler as empresas do usuário: ${error.message}`);
  const codes = [...new Set([...(data || []).map((v) => Number(v.cd_empresa)).filter((n) => Number.isFinite(n)), ...(await empresasDoSetor(user))])];
  if (codes.length) return codes;
  return PERFIS_SO_VINCULADAS.includes(user.role) ? [] : null;
}

/** Usuário da requisição pelo token (rotas que ainda não exigem login): null sem token. */
export async function usuarioDaRequisicao(req) {
  if (req.user) return req.user;
  const h = req.headers?.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  return token ? usuarioDoToken(token).catch(() => null) : null;
}
