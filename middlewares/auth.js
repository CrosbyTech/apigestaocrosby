// Autenticação das rotas do backend com a sessão do Supabase do HeadCoach.
//
// O frontend manda `Authorization: Bearer <access_token da sessão Supabase>`
// (ver gestaocrosby/src/utils/apiAuth.js). O backend valida o JWT com
// supabase.auth.getUser() (service_role) e anexa req.user = { id, email, name, role }.
//
//   router.use(requireAuth)                       — qualquer usuário logado
//   router.post('/x', requireRole('admin','owner'), ...)
//
// Cache de 60 s por token para não bater no Auth a cada request.
import crypto from 'node:crypto';
import supabase from '../config/supabase.js';

const cache = new Map(); // hash(token) → { user, ate }
const TTL_MS = 60 * 1000;
const ROLES_ADMIN = ['owner', 'admin'];

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

export async function usuarioDoToken(token) {
  if (!token) return null;
  const k = hash(token);
  const c = cache.get(k);
  if (c && c.ate > Date.now()) return c.user;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const u = data.user;
  const user = {
    id: u.id,
    email: u.email,
    name: u.user_metadata?.name || u.email,
    role: u.user_metadata?.role || 'guest',
  };
  cache.set(k, { user, ate: Date.now() + TTL_MS });
  if (cache.size > 2000) {
    for (const [key, v] of cache) if (v.ate <= Date.now()) cache.delete(key);
  }
  return user;
}

export const requireAuth = async (req, res, next) => {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
    const user = await usuarioDoToken(token);
    if (!user) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Faça login no HeadCoach para acessar este recurso' });
    }
    req.user = user;
    return next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: e.message });
  }
};

export const requireRole = (...roles) => (req, res, next) => {
  const permitidos = roles.length ? roles : ROLES_ADMIN;
  if (!req.user) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  if (!permitidos.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'FORBIDDEN', message: `Perfil ${req.user.role} não tem acesso (precisa: ${permitidos.join(', ')})` });
  }
  return next();
};

export const requireAdmin = [requireAuth, requireRole(...ROLES_ADMIN)];
