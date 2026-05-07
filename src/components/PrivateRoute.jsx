import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname;

  // Se ainda está carregando, mostra loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando...</p>
        </div>
      </div>
    );
  }

  // Se não há usuário, redireciona para login
  if (!user) {
    return <Navigate to="/" replace />;
  }

  // Verificar se usuário franquias tem empresas vinculadas
  if (user.role === 'franquias') {
    if (!user.allowedCompanies || user.allowedCompanies.length === 0) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
          <div className="text-center bg-white p-8 rounded-lg shadow-lg max-w-md">
            <p className="text-red-600 font-bold mb-2 text-xl">
              Acesso Bloqueado
            </p>
            <p className="text-gray-700 mb-4">
              Nenhuma empresa vinculada ao seu usuário.
              <br />
              Contate um administrador do sistema.
            </p>
          </div>
        </div>
      );
    }
  }

  // Verificar permissões customizadas
  const hasPermission = () => {
    // Owner tem acesso total
    if (user.allowedPages === '*') {
      return true;
    }

    // Verificar se a página atual está nas permissões do usuário
    if (!user.allowedPages || !Array.isArray(user.allowedPages)) {
      return false;
    }

    return user.allowedPages.includes(currentPath);
  };

  // Se não tem permissão, redireciona para /home ou /
  if (!hasPermission()) {
    // Redirecionar para /home se tiver permissão, senão para login
    if (
      user.allowedPages &&
      Array.isArray(user.allowedPages) &&
      user.allowedPages.includes('/home')
    ) {
      return <Navigate to="/home" replace />;
    }

    return <Navigate to="/" replace />;
  }

  return children;
};

export default PrivateRoute;
