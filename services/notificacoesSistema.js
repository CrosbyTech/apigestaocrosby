/**
 * Serviço de notificações de sistema (jobs automáticos).
 * Insere em `notificacoes_sistema` usando a service key (bypassa RLS).
 * Segmentação por papel via destinatario_roles (ex.: ['owner','admin']).
 */
import supabase from '../config/supabase.js';

/**
 * @param {Object} p
 * @param {string} p.tipo      Ex.: 'PROVISAO_LIBERACAO'
 * @param {string} p.nivel     'success' | 'error' | 'warning' | 'info'
 * @param {string} p.titulo
 * @param {string} [p.mensagem]
 * @param {Object} [p.dados]   Payload arbitrário (ex.: lista de duplicatas)
 * @param {string[]} [p.roles] Papéis destinatários (default: owner + admin)
 * @returns {Promise<boolean>} true se criou com sucesso
 */
export async function criarNotificacaoSistema({
  tipo = 'SISTEMA',
  nivel = 'info',
  titulo,
  mensagem = null,
  dados = {},
  roles = ['owner', 'admin'],
}) {
  if (!titulo) {
    console.warn('[notificacoes_sistema] titulo é obrigatório — ignorando.');
    return false;
  }
  try {
    const { error } = await supabase.from('notificacoes_sistema').insert([
      {
        tipo,
        nivel,
        titulo,
        mensagem,
        dados: dados || {},
        destinatario_roles: roles,
      },
    ]);
    if (error) {
      console.error('[notificacoes_sistema] erro ao criar:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[notificacoes_sistema] exceção ao criar:', e.message);
    return false;
  }
}
