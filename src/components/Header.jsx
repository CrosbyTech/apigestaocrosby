import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { User, SignOut, Gear, List } from '@phosphor-icons/react';
import NotificationBell from './NotificationBell';

const Header = ({ sidebarOpen = false, onToggleSidebar }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [currentDisplay, setCurrentDisplay] = useState('text'); // 'text' ou 'image'
  const [isTransitioning, setIsTransitioning] = useState(false);
  const dropdownRef = useRef(null);
  const animationRef = useRef(null);

  // Animação cíclica simplificada
  useEffect(() => {
    if (!user) return;

    const startAnimation = () => {
      // Iniciar com texto
      setCurrentDisplay('text');

      // Ciclo a cada 20 segundos
      const cycle = () => {
        setIsTransitioning(true);

        // Mostrar imagem
        setCurrentDisplay('image');

        // Após 10 segundos, voltar para texto
        setTimeout(() => {
          setCurrentDisplay('text');
          setIsTransitioning(false);
        }, 10000);
      };

      // Primeiro ciclo após 3 segundos
      const initialTimer = setTimeout(() => {
        cycle();

        // Ciclos subsequentes a cada 20 segundos
        animationRef.current = setInterval(cycle, 20000);
      }, 3000);

      return () => {
        clearTimeout(initialTimer);
        if (animationRef.current) {
          clearInterval(animationRef.current);
        }
      };
    };

    const cleanup = startAnimation();
    return cleanup;
  }, [user]);

  // Cleanup ao desmontar
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
    // Resetar animação
    setCurrentDisplay('text');
    setIsTransitioning(false);
    if (animationRef.current) {
      clearInterval(animationRef.current);
    }
  };

  // Fechar dropdown quando clicar fora
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleUserPanelClick = () => {
    setShowDropdown(false);
    navigate('/user-panel');
  };

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="w-full flex items-center sm:justify-center md:justify-between p-6 py-1">
        <div className="flex items-center gap-4">
          {/* Botão de menu hambúrguer */}
          <button
            onClick={onToggleSidebar}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <List size={24} />
          </button>

          {/* HEADCOACH - posicionamento dinâmico */}
          <div
            className={`flex items-center transition-all duration-300 ${
              sidebarOpen ? 'ml-64' : 'ml-4'
            }`}
          >
            {/* Container com altura fixa e largura mínima para evitar layout shift */}
            <div className="h-5 w-48 flex items-center justify-start">
              {/* Texto HEADCOACH CROSBY */}
              {currentDisplay === 'text' && (
                <h1
                  className={`text-lg font-bold text-blue-950 font-barlow whitespace-nowrap ${
                    !isTransitioning ? 'animate-fade-in-smooth' : ''
                  }`}
                >
                  HEADCOACH CROSBY
                </h1>
              )}

              {/* Imagem hokey.gif */}
              {currentDisplay === 'image' && (
                <img
                  src="/hokey.gif"
                  alt="HEADCOACH"
                  className="w-8 h-8 rounded-full animate-slide-right-bounce shadow-lg"
                />
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Sino de Notificações */}
          <NotificationBell />

          {/* Dropdown do usuário */}
          <div className="relative" ref={dropdownRef}>
            <button
              className="flex items-center gap-2 px-3 py-1 rounded-lg hover:bg-gray-100 transition-colors"
              onClick={() => setShowDropdown(!showDropdown)}
            >
              <User size={24} className="text-gray-500" />
            </button>

            {/* Dropdown menu */}
            {showDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                <button
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  onClick={handleUserPanelClick}
                >
                  <Gear size={16} className="text-gray-500" />
                  Painel do Usuário
                </button>
                <div className="border-t border-gray-200 my-1"></div>
                <button
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  onClick={handleLogout}
                >
                  <SignOut size={16} className="text-red-500" />
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
