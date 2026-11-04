// ============================================================================
// AUTORIZAÇÃO POR SENHA — um gerente/admin/owner digita e-mail + senha do
// HeadCoach para liberar uma ação de outro usuário (download vencido do
// Balanço RFID, desconto acima do limite no PDV Crosby…).
//
// Confere no Supabase Auth num cliente isolado, sem guardar sessão, e limita
// as tentativas por e-mail (5 a cada 10 minutos).
// ============================================================================
import { createClient } from '@supabase/supabase-js';

export class AutorizacaoError extends Error {
  constructor(message, code = 'AUTORIZACAO_ERROR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const NOMES_ROLE = { manager: 'gerente', admin: 'admin', owner: 'owner' };
const tentativas = new Map(); // email -> [timestamps]

export async function verificarSenhaAutorizador(email, senha, roles) {
  const quem = roles.map((r) => NOMES_ROLE[r] || r).join(', ').replace(/, ([^,]*)$/, ' ou $1');
  const e = String(email || '').trim().toLowerCase();
  if (!e || !senha) throw new AutorizacaoError(`Informe o e-mail e a senha do ${quem}`, 'CREDENCIAIS_AUSENTES');
  const agora = Date.now();
  const recentes = (tentativas.get(e) || []).filter((t) => agora - t < 10 * 60 * 1000);
  if (recentes.length >= 5) throw new AutorizacaoError('Muitas tentativas. Aguarde 10 minutos.', 'MUITAS_TENTATIVAS', 429);
  recentes.push(agora);
  tentativas.set(e, recentes);

  const cli = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await cli.auth.signInWithPassword({ email: e, password: String(senha) });
  if (error || !data?.user) throw new AutorizacaoError('E-mail ou senha inválidos', 'CREDENCIAIS_INVALIDAS', 401);
  try {
    await cli.auth.signOut({ scope: 'local' });
  } catch {
    /* sessão só em memória */
  }
  const role = data.user.user_metadata?.role;
  if (!roles.includes(role)) {
    throw new AutorizacaoError(`Esse usuário não é ${quem}`, 'SEM_PERMISSAO', 403);
  }
  tentativas.delete(e);
  return { email: e, nome: data.user.user_metadata?.name || e, role };
}
