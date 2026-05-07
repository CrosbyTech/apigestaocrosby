import { supabase } from '../lib/supabase';

/**
 * Serviço de gerenciamento de permissões customizadas de usuários
 * Todas as funções retornam { data, error } seguindo o padrão Supabase
 */

/**
 * Busca todos os usuários do sistema
 * Usa função RPC do Supabase (apenas owners podem executar)
 * @returns {Promise<{data: Array, error: Error}>}
 */
export const getAllUsers = async () => {
  try {
    const { data, error } = await supabase.rpc('get_all_users');

    if (error) throw error;

    return { data: data || [], error: null };
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    return { data: null, error };
  }
};

/**
 * Busca as permissões (páginas permitidas) de um usuário específico
 * @param {string} userId - ID do usuário
 * @returns {Promise<{data: Array<string>, error: Error}>}
 */
export const getUserPermissions = async (userId) => {
  try {
    console.log('🔍 Buscando permissões no Supabase para:', userId);
    const { data, error } = await supabase
      .from('user_page_permissions')
      .select('page_path')
      .eq('user_id', userId)
      .order('page_path');

    if (error) {
      console.error('❌ Erro do Supabase ao buscar permissões:', error);
      throw error;
    }

    console.log('📦 Dados recebidos do Supabase:', data);

    // Retornar apenas array de caminhos
    const pagePaths = data ? data.map((item) => item.page_path) : [];
    console.log('✅ Permissões processadas:', pagePaths);

    return { data: pagePaths, error: null };
  } catch (error) {
    console.error('❌ Erro crítico ao buscar permissões:', error);
    console.error('Detalhes do erro:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return { data: [], error };
  }
};

/**
 * Salva/atualiza as permissões de um usuário específico
 * Remove todas as permissões antigas e cria novas
 * @param {string} userId - ID do usuário
 * @param {Array<string>} pagePaths - Array de caminhos de páginas permitidas
 * @returns {Promise<{data: boolean, error: Error}>}
 */
export const saveUserPermissions = async (userId, pagePaths) => {
  try {
    // 1. Remover todas as permissões existentes do usuário
    const { error: deleteError } = await supabase
      .from('user_page_permissions')
      .delete()
      .eq('user_id', userId);

    if (deleteError) throw deleteError;

    // 2. Se não há páginas para adicionar, retornar sucesso
    if (!pagePaths || pagePaths.length === 0) {
      return { data: true, error: null };
    }

    // 3. Obter ID do usuário atual (owner que está fazendo a alteração)
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    // 4. Inserir novas permissões
    const permissionsToInsert = pagePaths.map((pagePath) => ({
      user_id: userId,
      page_path: pagePath,
      created_by: currentUser?.id,
    }));

    const { error: insertError } = await supabase
      .from('user_page_permissions')
      .insert(permissionsToInsert);

    if (insertError) throw insertError;

    console.log(
      `✅ Permissões salvas para usuário ${userId}: ${pagePaths.length} páginas`,
    );
    return { data: true, error: null };
  } catch (error) {
    console.error('Erro ao salvar permissões:', error);
    return { data: false, error };
  }
};

/**
 * Salva permissões para múltiplos usuários ao mesmo tempo
 * @param {Array<string>} userIds - Array de IDs de usuários
 * @param {Array<string>} pagePaths - Array de caminhos de páginas permitidas
 * @returns {Promise<{data: boolean, error: Error}>}
 */
export const saveBulkPermissions = async (userIds, pagePaths) => {
  try {
    // Obter ID do usuário atual (owner que está fazendo a alteração)
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    // Para cada usuário, salvar as permissões
    const promises = userIds.map((userId) =>
      saveUserPermissions(userId, pagePaths),
    );

    const results = await Promise.all(promises);

    // Verificar se algum falhou
    const hasError = results.some((result) => result.error);

    if (hasError) {
      const errors = results.filter((r) => r.error).map((r) => r.error);
      console.error('Erros ao salvar permissões em massa:', errors);
      return { data: false, error: errors[0] };
    }

    console.log(
      `✅ Permissões em massa salvas para ${userIds.length} usuários`,
    );
    return { data: true, error: null };
  } catch (error) {
    console.error('Erro ao salvar permissões em massa:', error);
    return { data: false, error };
  }
};

/**
 * Remove uma permissão específica de um usuário
 * @param {string} userId - ID do usuário
 * @param {string} pagePath - Caminho da página a ser removida
 * @returns {Promise<{data: boolean, error: Error}>}
 */
export const removeUserPermission = async (userId, pagePath) => {
  try {
    const { error } = await supabase
      .from('user_page_permissions')
      .delete()
      .eq('user_id', userId)
      .eq('page_path', pagePath);

    if (error) throw error;

    console.log(`✅ Permissão removida: ${pagePath} do usuário ${userId}`);
    return { data: true, error: null };
  } catch (error) {
    console.error('Erro ao remover permissão:', error);
    return { data: false, error };
  }
};

/**
 * Remove todas as permissões de um usuário
 * @param {string} userId - ID do usuário
 * @returns {Promise<{data: boolean, error: Error}>}
 */
export const clearUserPermissions = async (userId) => {
  try {
    const { error } = await supabase
      .from('user_page_permissions')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;

    console.log(`✅ Todas as permissões removidas do usuário ${userId}`);
    return { data: true, error: null };
  } catch (error) {
    console.error('Erro ao limpar permissões:', error);
    return { data: false, error };
  }
};

/**
 * Copia as permissões de um usuário para outro
 * @param {string} fromUserId - ID do usuário origem
 * @param {string} toUserId - ID do usuário destino
 * @returns {Promise<{data: boolean, error: Error}>}
 */
export const copyPermissions = async (fromUserId, toUserId) => {
  try {
    // 1. Buscar permissões do usuário origem
    const { data: permissions, error: fetchError } = await getUserPermissions(
      fromUserId,
    );

    if (fetchError) throw fetchError;

    // 2. Salvar as mesmas permissões para o usuário destino
    const { data, error: saveError } = await saveUserPermissions(
      toUserId,
      permissions,
    );

    if (saveError) throw saveError;

    console.log(
      `✅ Permissões copiadas de ${fromUserId} para ${toUserId}: ${permissions.length} páginas`,
    );
    return { data: true, error: null };
  } catch (error) {
    console.error('Erro ao copiar permissões:', error);
    return { data: false, error };
  }
};

/**
 * Adiciona uma permissão específica para um usuário (sem remover as existentes)
 * @param {string} userId - ID do usuário
 * @param {string} pagePath - Caminho da página a ser adicionada
 * @returns {Promise<{data: boolean, error: Error}>}
 */
export const addUserPermission = async (userId, pagePath) => {
  try {
    // Obter ID do usuário atual (owner que está fazendo a alteração)
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from('user_page_permissions').insert({
      user_id: userId,
      page_path: pagePath,
      created_by: currentUser?.id,
    });

    // Ignorar erro de duplicata (já existe)
    if (error && error.code !== '23505') {
      throw error;
    }

    console.log(`✅ Permissão adicionada: ${pagePath} para usuário ${userId}`);
    return { data: true, error: null };
  } catch (error) {
    console.error('Erro ao adicionar permissão:', error);
    return { data: false, error };
  }
};

/**
 * Busca contagem de permissões por página
 * Útil para saber quantos usuários têm acesso a cada página
 * @returns {Promise<{data: Object, error: Error}>}
 */
export const getPermissionsCountByPage = async () => {
  try {
    const { data, error } = await supabase
      .from('user_page_permissions')
      .select('page_path');

    if (error) throw error;

    // Contar quantos usuários têm acesso a cada página
    const counts = data.reduce((acc, item) => {
      acc[item.page_path] = (acc[item.page_path] || 0) + 1;
      return acc;
    }, {});

    return { data: counts, error: null };
  } catch (error) {
    console.error('Erro ao buscar contagem de permissões:', error);
    return { data: {}, error };
  }
};

/**
 * Busca todos os usuários com suas respectivas permissões
 * Útil para carregar dados completos no gerenciador de acessos
 * @returns {Promise<{data: Array, error: Error}>}
 */
export const getAllUsersWithPermissions = async () => {
  try {
    // 1. Buscar todos os usuários
    const { data: users, error: usersError } = await getAllUsers();
    if (usersError) throw usersError;

    // 2. Buscar permissões de cada usuário
    const usersWithPermissions = await Promise.all(
      users.map(async (user) => {
        const { data: permissions, error: permError } =
          await getUserPermissions(user.id);

        return {
          ...user,
          permissions: permError ? [] : permissions,
          permissionsCount: permError ? 0 : permissions.length,
        };
      }),
    );

    return { data: usersWithPermissions, error: null };
  } catch (error) {
    console.error('Erro ao buscar usuários com permissões:', error);
    return { data: [], error };
  }
};

/**
 * Verifica se um usuário tem permissão para acessar uma página específica
 * @param {string} userId - ID do usuário
 * @param {string} pagePath - Caminho da página
 * @returns {Promise<{data: boolean, error: Error}>}
 */
export const checkUserPermission = async (userId, pagePath) => {
  try {
    const { data, error } = await supabase
      .from('user_page_permissions')
      .select('id')
      .eq('user_id', userId)
      .eq('page_path', pagePath)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = não encontrado
      throw error;
    }

    return { data: !!data, error: null };
  } catch (error) {
    console.error('Erro ao verificar permissão:', error);
    return { data: false, error };
  }
};
