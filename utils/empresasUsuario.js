// ============================================================================
// Empresas que cada usuário enxerga (Yago, 13/11/2026: os vendedores das lojas
// só acessam a PRÓPRIA empresa no PDV, Transações, Transferências, Caixa,
// Estoque e Recebimento).
//   • owner / admin ............ todas (sem restrição)
//   • com empresas vinculadas .. só as vinculadas (Painel Admin → user_companies)
//   • guest / vendedor SEM vínculo: NENHUMA (vendedor sem loja não vê nada)
//   • demais perfis sem vínculo (financeiro, manager…): todas, como antes
// empresasRestritasDoUsuario devolve null = sem restrição, ou a lista de códigos.
// ============================================================================
import supabase from '../config/supabase.js';
import { usuarioDoToken } from '../middlewares/auth.js';

export const PERFIS_LIVRES = ['owner', 'admin'];
export const PERFIS_SO_VINCULADAS = ['guest', 'vendedor'];

export async function empresasRestritasDoUsuario(user) {
  if (!user) return null;
  if (PERFIS_LIVRES.includes(user.role)) return null;
  const { data, error } = await supabase.from('user_companies').select('cd_empresa').eq('user_id', user.id || '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error(`Não consegui ler as empresas do usuário: ${error.message}`);
  const codes = [...new Set((data || []).map((v) => Number(v.cd_empresa)).filter((n) => Number.isFinite(n)))];
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
