import React from 'react';
import { Robot } from '@phosphor-icons/react';

/**
 * Banner de aviso para administradores quando o sistema está em manutenção
 *
 * @param {Object} props
 * @param {string} props.userRole - Role do usuário ('admin' ou 'owner')
 */
const MaintenanceBanner = ({ userRole }) => {
  return (
    <div className="mb-4 p-4 bg-gradient-to-r from-orange-500 to-red-600 rounded-xl shadow-lg">
      <div className="flex items-center gap-3 text-white">
        <div className="w-10 h-10 bg-white bg-opacity-20 rounded-full flex items-center justify-center animate-pulse">
          <Robot size={24} weight="bold" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm">
            🚧 Sistema em Manutenção - Acesso Administrativo
          </p>
          <p className="text-xs opacity-90">
            Você tem acesso porque é{' '}
            <strong>{userRole === 'owner' ? 'OWNER' : 'ADMIN'}</strong>. Outros
            usuários estão bloqueados.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MaintenanceBanner;
