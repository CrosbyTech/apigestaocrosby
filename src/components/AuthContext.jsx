import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
} from 'react';
import { supabase, supabaseSession } from '../lib/supabase';
import { getUserPermissions } from '../services/permissionsService';
import { getUserCompanies } from '../services/userCompaniesService';

// Roles disponíveis no sistema (ordenados por hierarquia)
const ROLES = [
  'owner',
  'admin',
  'manager',
  'user',
  'guest',
  'vendedor',
  'franquias',
];

// Configuração de roles com labels e níveis
const ROLE_CONFIG = {
  owner: {
    label: 'Proprietário',
    level: 1,
    color: '#9c27b0',
  },
  admin: {
    label: 'Administrador',
    level: 2,
    color: '#ff4747',
  },
  manager: {
    label: 'Gerente',
    level: 3,
    color: '#ff6b35',
  },
  user: {
    label: 'Financeiro',
    level: 4,
    color: '#4CAF50',
  },
  guest: {
    label: 'Convidado',
    level: 5,
    color: '#757575',
  },
  vendedor: {
    label: 'Vendedor',
    level: 60,
    color: '#10b981',
  },
  franquias: {
    label: 'Franquias',
    level: 50,
    color: '#3b82f6',
  },
};

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Ref para rastrear o usuário atual (para evitar recarregamentos desnecessários)
  const userRef = useRef(null);

  // Cache de permissões para evitar múltiplas chamadas
  const permissionsCache = useRef({});
  const loadingPermissions = useRef(new Set());

  // Flag para controlar se estamos no carregamento inicial
  const isInitialLoad = useRef(true);

  // Helper para atualizar usuário (state + ref)
  const updateUser = (userData) => {
    userRef.current = userData;
    setUser(userData);
  };

  // Função auxiliar para carregar empresas vinculadas do banco
  const loadUserCompanies = async (userId, userRole) => {
    try {
      // Apenas usuários do tipo franquias têm empresas vinculadas
      if (userRole !== 'franquias') {
        return null; // null = todas as empresas disponíveis
      }

      const { data, error } = await getUserCompanies(userId);

      if (error) {
        return []; // Array vazio = nenhuma empresa
      }

      // Retornar array de códigos de empresas
      const companies = data || [];
      return companies;
    } catch (error) {
      return [];
    }
  };

  // Função auxiliar para carregar permissões do banco
  const loadUserPermissions = async (userId, userRole, forceReload = false) => {
    try {
      // Owner tem acesso a todas as páginas (não precisa carregar do banco)
      if (userRole === 'owner') {
        return '*'; // '*' significa acesso a todas as páginas
      }

      // Verificar cache (válido por 5 minutos)
      const cached = permissionsCache.current[userId];
      const now = Date.now();
      const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

      if (!forceReload && cached && now - cached.timestamp < CACHE_DURATION) {
        return cached.permissions;
      }

      // Evitar múltiplas chamadas simultâneas para o mesmo usuário
      if (loadingPermissions.current.has(userId)) {
        // Aguardar até 12 segundos checando o cache a cada 500ms
        const maxWaitTime = 12000; // 12 segundos
        const checkInterval = 500; // 500ms
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
          const cachedAfterWait = permissionsCache.current[userId];
          if (cachedAfterWait) {
            return cachedAfterWait.permissions;
          }
          // Se o carregamento já terminou mas não há cache, sair do loop
          if (!loadingPermissions.current.has(userId)) {
            break;
          }
        }

        // Se chegou aqui, timeout ou erro no carregamento original
        return [];
      }

      // Marcar que estamos carregando
      loadingPermissions.current.add(userId);

      // Para outros usuários, buscar permissões do banco

      // Adicionar timeout de 15 segundos para evitar travamentos
      const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => {
          loadingPermissions.current.delete(userId);
          // Se temos cache antigo, usar ele mesmo expirado
          if (cached) {
            resolve({ data: cached.permissions, error: null });
          } else {
            resolve({ data: [], error: new Error('Timeout') });
          }
        }, 15000),
      );

      const permissionsPromise = getUserPermissions(userId);

      try {
        const result = await Promise.race([permissionsPromise, timeoutPromise]);
        const { data, error } = result;

        // Remover da lista de carregamento
        loadingPermissions.current.delete(userId);

        if (error) {
          // Se temos cache antigo, usar ele
          if (cached) {
            return cached.permissions;
          }
          return [];
        }

        // Salvar no cache
        const permissions = data || [];
        permissionsCache.current[userId] = {
          permissions,
          timestamp: now,
        };

        return permissions;
      } catch (err) {
        loadingPermissions.current.delete(userId);
        // Se temos cache antigo, usar ele
        if (cached) {
          return cached.permissions;
        }
        return [];
      }
    } catch (error) {
      loadingPermissions.current.delete(userId);
      return [];
    }
  };

  // Função de login
  const login = async (email, password, rememberMe = true) => {
    try {
      setLoading(true);

      const client = rememberMe ? supabase : supabaseSession;

      let authData, error;
      try {
        const result = await client.auth.signInWithPassword({
          email,
          password,
        });
        authData = result.data;
        error = result.error;
      } catch (fetchError) {
        // "Failed to fetch" - limpar sessão antiga e tentar novamente
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        await supabaseSession.auth.signOut({ scope: 'local' }).catch(() => {});
        // Segunda tentativa após limpar
        const retryResult = await client.auth.signInWithPassword({
          email,
          password,
        });
        authData = retryResult.data;
        error = retryResult.error;
      }

      if (error) {
        throw error;
      }

      // Obter role do metadata do usuário
      const userRole = authData.user.user_metadata?.role || 'guest';

      // Verificar se o role é válido
      const validRole = ROLES.includes(userRole) ? userRole : 'guest';
      const roleConfig = ROLE_CONFIG[validRole];

      // Carregar permissões do banco
      const allowedPages = await loadUserPermissions(
        authData.user.id,
        validRole,
      );

      // Carregar empresas vinculadas (APENAS para franquias)
      const allowedCompanies = await loadUserCompanies(
        authData.user.id,
        validRole,
      );

      // Configurar usuário
      const userData = {
        id: authData.user.id,
        email: authData.user.email,
        name: authData.user.user_metadata?.name || 'Usuário',
        role: validRole,
        allowedPages, // Adicionar permissões customizadas
        allowedCompanies, // Adicionar empresas vinculadas
        profile: {
          name: validRole,
          label: roleConfig.label,
          level: roleConfig.level,
          color: roleConfig.color,
        },
      };

      updateUser(userData);
      setLoading(false);

      return { success: true, user: userData };
    } catch (error) {
      setLoading(false);
      throw error;
    }
  };

  // Função de logout
  const logout = async () => {
    try {
      await supabase.auth.signOut();
      await supabaseSession.auth.signOut();
      updateUser(null);
      // Limpar cache
      permissionsCache.current = {};
      loadingPermissions.current.clear();
      // Resetar flag de carregamento inicial
      isInitialLoad.current = true;
    } catch (error) {
      // erro silencioso
    }
  };

  // Função para recarregar permissões (sem fazer logout)
  const refreshPermissions = async () => {
    if (!user) return;

    try {
      const allowedPages = await loadUserPermissions(user.id, user.role, true); // forceReload = true

      const updatedUser = {
        ...user,
        allowedPages,
      };
      updateUser(updatedUser);
    } catch (error) {
      // erro silencioso
    }
  };

  // Verificar sessão inicial
  useEffect(() => {
    const checkSession = async () => {
      try {
        let session;
        try {
          const { data, error: sessionError } =
            await supabase.auth.getSession();
          if (sessionError) {
            // Limpar sessão corrompida/expirada para permitir novo login
            await supabase.auth.signOut({ scope: 'local' });
            await supabaseSession.auth.signOut({ scope: 'local' });
            setLoading(false);
            isInitialLoad.current = false;
            return;
          }
          session = data?.session;
        } catch (fetchError) {
          // "Failed to fetch" - limpar dados locais para permitir login fresco
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          await supabaseSession.auth
            .signOut({ scope: 'local' })
            .catch(() => {});
          setLoading(false);
          isInitialLoad.current = false;
          return;
        }

        if (session?.user) {
          const userRole = session.user.user_metadata?.role || 'guest';

          // Verificar se o role é válido
          const validRole = ROLES.includes(userRole) ? userRole : 'guest';
          const roleConfig = ROLE_CONFIG[validRole];

          // Carregar permissões do banco
          const allowedPages = await loadUserPermissions(
            session.user.id,
            validRole,
          );

          // Carregar empresas vinculadas
          const allowedCompanies = await loadUserCompanies(
            session.user.id,
            validRole,
          );

          updateUser({
            id: session.user.id,
            email: session.user.email,
            name: session.user.user_metadata?.name || 'Usuário',
            role: validRole,
            allowedPages, // Adicionar permissões customizadas
            allowedCompanies, // Adicionar empresas vinculadas
            profile: {
              name: validRole,
              label: roleConfig.label,
              level: roleConfig.level,
              color: roleConfig.color,
            },
          });
        } else {
          // Nenhuma sessão encontrada
        }
      } catch (error) {
        // Em caso de erro, limpar sessão para não travar o login
        try {
          await supabase.auth.signOut({ scope: 'local' });
          await supabaseSession.auth.signOut({ scope: 'local' });
        } catch (_) {}
      } finally {
        setLoading(false);
        // Marcar que o carregamento inicial foi concluído
        setTimeout(() => {
          isInitialLoad.current = false;
        }, 500);
      }
    };

    checkSession();

    // Listener para mudanças de autenticação
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Ignorar eventos durante carregamento inicial (checkSession cuida disso)
      if (
        isInitialLoad.current &&
        (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
      ) {
        return;
      }

      if (event === 'SIGNED_IN' && session?.user) {
        // Evitar recarregar se já temos o mesmo usuário logado (evita loops)
        if (userRef.current && userRef.current.id === session.user.id) {
          return;
        }

        const userRole = session.user.user_metadata?.role || 'guest';

        // Verificar se o role é válido
        const validRole = ROLES.includes(userRole) ? userRole : 'guest';
        const roleConfig = ROLE_CONFIG[validRole];

        // Carregar permissões do banco (usará cache se disponível)
        const allowedPages = await loadUserPermissions(
          session.user.id,
          validRole,
        );

        // Carregar empresas vinculadas
        const allowedCompanies = await loadUserCompanies(
          session.user.id,
          validRole,
        );

        updateUser({
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.name || 'Usuário',
          role: validRole,
          allowedPages, // Adicionar permissões customizadas
          allowedCompanies, // Adicionar empresas vinculadas
          profile: {
            name: validRole,
            label: roleConfig.label,
            level: roleConfig.level,
            color: roleConfig.color,
          },
        });
        setLoading(false);
      } else if (event === 'SIGNED_OUT') {
        updateUser(null);
        // Limpar cache de permissões ao fazer logout
        permissionsCache.current = {};
        loadingPermissions.current.clear();
        isInitialLoad.current = true; // Resetar para próximo login
        setLoading(false);
      }
    });

    // Também ouvir mudanças do cliente baseado em sessionStorage
    const {
      data: { subscription: subscriptionSession },
    } = supabaseSession.auth.onAuthStateChange(async (event, session) => {
      // Ignorar eventos durante carregamento inicial (checkSession cuida disso)
      if (
        isInitialLoad.current &&
        (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
      ) {
        return;
      }

      if (event === 'SIGNED_IN' && session?.user) {
        // Evitar recarregar se já temos o mesmo usuário logado
        if (userRef.current && userRef.current.id === session.user.id) {
          return;
        }

        const userRole = session.user.user_metadata?.role || 'guest';
        const validRole = ROLES.includes(userRole) ? userRole : 'guest';
        const roleConfig = ROLE_CONFIG[validRole];

        // Carregar permissões do banco (usará cache se disponível)
        const allowedPages = await loadUserPermissions(
          session.user.id,
          validRole,
        );

        // Carregar empresas vinculadas
        const allowedCompanies = await loadUserCompanies(
          session.user.id,
          validRole,
        );

        updateUser({
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.name || 'Usuário',
          role: validRole,
          allowedPages, // Adicionar permissões customizadas
          allowedCompanies, // Adicionar empresas vinculadas
          profile: {
            name: validRole,
            label: roleConfig.label,
            level: roleConfig.level,
            color: roleConfig.color,
          },
        });
        setLoading(false);
      } else if (event === 'SIGNED_OUT') {
        updateUser(null);
        // Limpar cache ao fazer logout (session)
        permissionsCache.current = {};
        loadingPermissions.current.clear();
        isInitialLoad.current = true; // Resetar para próximo login
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
      subscriptionSession.unsubscribe();
    };
  }, []);

  // Funções de verificação de permissão
  const hasRole = (requiredRole) => {
    // Se for um array, usar hasAnyRole
    if (Array.isArray(requiredRole)) {
      return requiredRole.includes(user?.role);
    }
    // Se for uma string, verificar se o role é igual
    return user?.role === requiredRole;
  };

  const hasAnyRole = (requiredRoles) => {
    return requiredRoles.includes(user?.role);
  };

  const hasPermission = (requiredLevel) => {
    return user?.profile?.level >= requiredLevel;
  };

  const getRoleConfig = (role) => {
    return ROLE_CONFIG[role] || ROLE_CONFIG.guest;
  };

  const value = {
    user,
    loading,
    login,
    logout,
    refreshPermissions,
    hasRole,
    hasAnyRole,
    hasPermission,
    getRoleConfig,
    ROLES,
    ROLE_CONFIG,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
