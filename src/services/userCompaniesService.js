import { supabase } from '../lib/supabase';

/**
 * Serviço de gerenciamento de empresas vinculadas a usuários
 * Todas as funções retornam { data, error } seguindo o padrão Supabase
 */

/**
 * Busca empresas vinculadas a um usuário específico
 * @param {string} userId - ID do usuário
 * @returns {Promise<{data: Array<string>, error: Error}>}
 */
export const getUserCompanies = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('user_companies')
      .select('cd_empresa')
      .eq('user_id', userId)
      .order('cd_empresa');

    if (error) throw error;

    const companies = data ? data.map((item) => item.cd_empresa) : [];
    return { data: companies, error: null };
  } catch (error) {
    console.error('Erro ao buscar empresas vinculadas:', error);
    return { data: [], error };
  }
};

/**
 * Salva/atualiza as empresas vinculadas de um usuário específico
 * Remove todas as empresas antigas e cria novas
 * @param {string} userId - ID do usuário
 * @param {Array<string>} companyCodes - Array de códigos de empresas
 * @returns {Promise<{data: boolean, error: Error}>}
 */
export const saveUserCompanies = async (userId, companyCodes) => {
  try {
    // 1. Remover todas as empresas existentes do usuário
    const { error: deleteError } = await supabase
      .from('user_companies')
      .delete()
      .eq('user_id', userId);

    if (deleteError) throw deleteError;

    // 2. Se não há empresas para adicionar, retornar sucesso
    if (!companyCodes || companyCodes.length === 0) {
      return { data: true, error: null };
    }

    // 3. Obter ID do usuário atual (owner que está fazendo a alteração)
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    // 4. Inserir novas empresas vinculadas
    const companiesToInsert = companyCodes.map((cd_empresa) => ({
      user_id: userId,
      cd_empresa: cd_empresa,
      created_by: currentUser?.id,
    }));

    const { error: insertError } = await supabase
      .from('user_companies')
      .insert(companiesToInsert);

    if (insertError) throw insertError;

    console.log(
      `✅ Empresas vinculadas salvas para usuário ${userId}: ${companyCodes.length} empresas`,
    );
    return { data: true, error: null };
  } catch (error) {
    console.error('Erro ao salvar empresas vinculadas:', error);
    return { data: false, error };
  }
};

/**
 * Remove todas as empresas vinculadas de um usuário
 * @param {string} userId - ID do usuário
 * @returns {Promise<{data: boolean, error: Error}>}
 */
export const clearUserCompanies = async (userId) => {
  try {
    const { error } = await supabase
      .from('user_companies')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;

    console.log(
      `✅ Todas as empresas vinculadas removidas do usuário ${userId}`,
    );
    return { data: true, error: null };
  } catch (error) {
    console.error('Erro ao limpar empresas vinculadas:', error);
    return { data: false, error };
  }
};

/**
 * Busca todos os usuários com suas respectivas empresas vinculadas
 * Útil para carregar dados completos no gerenciador de acessos
 * @returns {Promise<{data: Array, error: Error}>}
 */
export const getAllUsersWithCompanies = async () => {
  try {
    // Usar a função RPC existente para buscar usuários
    const { data: users, error: usersError } = await supabase.rpc(
      'get_all_users',
    );
    if (usersError) throw usersError;

    // Buscar empresas de cada usuário
    const usersWithCompanies = await Promise.all(
      users.map(async (user) => {
        const { data: companies, error: companiesError } =
          await getUserCompanies(user.id);

        return {
          ...user,
          companies: companiesError ? [] : companies,
          companiesCount: companiesError ? 0 : companies.length,
        };
      }),
    );

    return { data: usersWithCompanies, error: null };
  } catch (error) {
    console.error('Erro ao buscar usuários com empresas:', error);
    return { data: [], error };
  }
};
