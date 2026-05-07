import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import * as permissionsService from '../services/permissionsService';

/**
 * Hook customizado para gerenciar permissões de usuários
 * Fornece funções e estados para carregar, salvar e gerenciar permissões
 */
export const usePermissions = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userPermissions, setUserPermissions] = useState([]);

  /**
   * Carrega todos os usuários do sistema
   */
  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: loadError } = await permissionsService.getAllUsers();

      if (loadError) throw loadError;

      setUsers(data || []);
    } catch (err) {
      console.error('Erro ao carregar usuários:', err);
      setError(err.message || 'Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Carrega todos os usuários com suas permissões
   */
  const loadUsersWithPermissions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: loadError } =
        await permissionsService.getAllUsersWithPermissions();

      if (loadError) throw loadError;

      setUsers(data || []);
    } catch (err) {
      console.error('Erro ao carregar usuários com permissões:', err);
      setError(err.message || 'Erro ao carregar usuários com permissões');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Carrega as permissões de um usuário específico
   */
  const loadUserPermissions = useCallback(async (userId) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: loadError } =
        await permissionsService.getUserPermissions(userId);

      if (loadError) throw loadError;

      setUserPermissions(data || []);
      return data || [];
    } catch (err) {
      console.error('Erro ao carregar permissões do usuário:', err);
      setError(err.message || 'Erro ao carregar permissões');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Salva permissões para um usuário
   */
  const savePermissions = useCallback(
    async (userId, pagePaths) => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: saveError } =
          await permissionsService.saveUserPermissions(userId, pagePaths);

        if (saveError) throw saveError;

        // Atualizar estado local
        if (selectedUser?.id === userId) {
          setUserPermissions(pagePaths);
        }

        return { success: true, error: null };
      } catch (err) {
        console.error('Erro ao salvar permissões:', err);
        setError(err.message || 'Erro ao salvar permissões');
        return { success: false, error: err.message };
      } finally {
        setLoading(false);
      }
    },
    [selectedUser],
  );

  /**
   * Salva permissões para múltiplos usuários
   */
  const saveBulkPermissions = useCallback(async (userIds, pagePaths) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: saveError } =
        await permissionsService.saveBulkPermissions(userIds, pagePaths);

      if (saveError) throw saveError;

      return { success: true, error: null };
    } catch (err) {
      console.error('Erro ao salvar permissões em massa:', err);
      setError(err.message || 'Erro ao salvar permissões em massa');
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Remove uma permissão específica
   */
  const removePermission = useCallback(
    async (userId, pagePath) => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: removeError } =
          await permissionsService.removeUserPermission(userId, pagePath);

        if (removeError) throw removeError;

        // Atualizar estado local
        if (selectedUser?.id === userId) {
          setUserPermissions((prev) =>
            prev.filter((path) => path !== pagePath),
          );
        }

        return { success: true, error: null };
      } catch (err) {
        console.error('Erro ao remover permissão:', err);
        setError(err.message || 'Erro ao remover permissão');
        return { success: false, error: err.message };
      } finally {
        setLoading(false);
      }
    },
    [selectedUser],
  );

  /**
   * Adiciona uma permissão específica
   */
  const addPermission = useCallback(
    async (userId, pagePath) => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: addError } =
          await permissionsService.addUserPermission(userId, pagePath);

        if (addError) throw addError;

        // Atualizar estado local
        if (selectedUser?.id === userId) {
          setUserPermissions((prev) => {
            if (!prev.includes(pagePath)) {
              return [...prev, pagePath];
            }
            return prev;
          });
        }

        return { success: true, error: null };
      } catch (err) {
        console.error('Erro ao adicionar permissão:', err);
        setError(err.message || 'Erro ao adicionar permissão');
        return { success: false, error: err.message };
      } finally {
        setLoading(false);
      }
    },
    [selectedUser],
  );

  /**
   * Remove todas as permissões de um usuário
   */
  const clearPermissions = useCallback(
    async (userId) => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: clearError } =
          await permissionsService.clearUserPermissions(userId);

        if (clearError) throw clearError;

        // Atualizar estado local
        if (selectedUser?.id === userId) {
          setUserPermissions([]);
        }

        return { success: true, error: null };
      } catch (err) {
        console.error('Erro ao limpar permissões:', err);
        setError(err.message || 'Erro ao limpar permissões');
        return { success: false, error: err.message };
      } finally {
        setLoading(false);
      }
    },
    [selectedUser],
  );

  /**
   * Copia permissões de um usuário para outro
   */
  const copyPermissions = useCallback(async (fromUserId, toUserId) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: copyError } =
        await permissionsService.copyPermissions(fromUserId, toUserId);

      if (copyError) throw copyError;

      return { success: true, error: null };
    } catch (err) {
      console.error('Erro ao copiar permissões:', err);
      setError(err.message || 'Erro ao copiar permissões');
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Verifica se um usuário tem permissão para uma página
   */
  const checkPermission = useCallback(async (userId, pagePath) => {
    try {
      const { data, error: checkError } =
        await permissionsService.checkUserPermission(userId, pagePath);

      if (checkError) throw checkError;

      return data;
    } catch (err) {
      console.error('Erro ao verificar permissão:', err);
      return false;
    }
  }, []);

  /**
   * Busca contagem de permissões por página
   */
  const getPermissionsCount = useCallback(async () => {
    try {
      const { data, error: countError } =
        await permissionsService.getPermissionsCountByPage();

      if (countError) throw countError;

      return data;
    } catch (err) {
      console.error('Erro ao buscar contagem de permissões:', err);
      return {};
    }
  }, []);

  /**
   * Seleciona um usuário e carrega suas permissões
   */
  const selectUser = useCallback(
    async (user) => {
      setSelectedUser(user);
      if (user) {
        await loadUserPermissions(user.id);
      } else {
        setUserPermissions([]);
      }
    },
    [loadUserPermissions],
  );

  /**
   * Limpa a seleção de usuário
   */
  const clearSelection = useCallback(() => {
    setSelectedUser(null);
    setUserPermissions([]);
  }, []);

  /**
   * Verifica se o usuário atual é owner (pode gerenciar permissões)
   */
  const isOwner = user?.role === 'owner';

  return {
    // Estados
    loading,
    error,
    users,
    selectedUser,
    userPermissions,
    isOwner,

    // Funções de carregamento
    loadUsers,
    loadUsersWithPermissions,
    loadUserPermissions,

    // Funções de modificação
    savePermissions,
    saveBulkPermissions,
    addPermission,
    removePermission,
    clearPermissions,
    copyPermissions,

    // Funções de verificação
    checkPermission,
    getPermissionsCount,

    // Funções de seleção
    selectUser,
    clearSelection,

    // Funções de estado
    setError,
  };
};

export default usePermissions;
