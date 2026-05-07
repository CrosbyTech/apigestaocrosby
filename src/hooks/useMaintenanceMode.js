import { useMemo } from 'react';
import { useAuth } from '../components/AuthContext';

/**
 * Hook para gerenciar o modo de manutenção do sistema
 *
 * @param {boolean} isMaintenanceActive - Define se o sistema está em manutenção
 * @returns {Object} Objeto com informações sobre o estado de manutenção
 *
 * @example
 * const { sistemaAcessivel, isAdminOrOwner, userRole, showBanner, showModal } = useMaintenanceMode(true);
 */
const useMaintenanceMode = (isMaintenanceActive = false) => {
  const { user } = useAuth();

  const maintenanceState = useMemo(() => {
    // Determinar role do usuário
    const userRole = user?.user_metadata?.role || user?.role || 'user';

    // Verificar se é admin ou owner
    const isAdminOrOwner = userRole === 'admin' || userRole === 'owner';

    // Sistema é acessível se não está em manutenção OU se é admin/owner
    const sistemaAcessivel = !isMaintenanceActive || isAdminOrOwner;

    // Mostrar banner de admin quando está em manutenção E é admin/owner
    const showBanner = isMaintenanceActive && isAdminOrOwner;

    // Mostrar modal de bloqueio quando não é acessível
    const showModal = !sistemaAcessivel;

    return {
      sistemaAcessivel,
      isAdminOrOwner,
      userRole,
      showBanner,
      showModal,
      isMaintenanceActive,
    };
  }, [user, isMaintenanceActive]);

  return maintenanceState;
};

export default useMaintenanceMode;
