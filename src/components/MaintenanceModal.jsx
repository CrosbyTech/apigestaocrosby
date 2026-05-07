import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Robot, House } from '@phosphor-icons/react';

// Adicionar estilo para animação (apenas uma vez)
if (!document.head.querySelector('style[data-maintenance-animation]')) {
  const styleSheet = document.createElement('style');
  styleSheet.setAttribute('data-maintenance-animation', 'true');
  styleSheet.textContent = `
    @keyframes float {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-20px); }
    }
  `;
  document.head.appendChild(styleSheet);
}

/**
 * Componente de Modal de Manutenção
 * Exibe uma tela de bloqueio quando o sistema está em manutenção
 *
 * @param {Object} props
 * @param {string} props.systemName - Nome do sistema em manutenção (padrão: "Sistema")
 * @param {string} props.homeRoute - Rota para onde o botão "Voltar ao Home" redireciona (padrão: "/home")
 * @param {boolean} props.showBackButton - Mostrar ou ocultar botão de voltar (padrão: true)
 */
const MaintenanceModal = ({
  systemName = 'Sistema',
  homeRoute = '/home',
  showBackButton = true,
}) => {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-full mx-4 overflow-hidden">
        {/* Header com animação */}
        <div className="bg-gradient-to-r from-orange-500 to-red-600 p-6 text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-0 left-0 w-full h-full animate-pulse">
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className="absolute bg-white rounded-full"
                  style={{
                    width: Math.random() * 100 + 50 + 'px',
                    height: Math.random() * 100 + 50 + 'px',
                    top: Math.random() * 100 + '%',
                    left: Math.random() * 100 + '%',
                    animation: `float ${
                      Math.random() * 3 + 2
                    }s ease-in-out infinite`,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="relative z-10">
            <div className="inline-block p-4 bg-white bg-opacity-20 rounded-full mb-4 animate-bounce">
              <Robot size={64} className="text-white" weight="bold" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              🚧 Sistema em Manutenção
            </h2>
            <p className="text-white text-sm opacity-90">
              Estamos trabalhando em melhorias
            </p>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="p-8 text-center">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-orange-100 text-orange-800 rounded-full text-sm font-semibold mb-4">
              <div className="w-2 h-2 bg-orange-600 rounded-full animate-pulse"></div>
              Acesso Restrito
            </div>

            {showBackButton && (
              <button
                onClick={() => navigate(homeRoute)}
                className="w-full mb-3 flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-sm shadow-md transition-all duration-200 hover:scale-105"
              >
                <House size={20} weight="fill" />
                Voltar ao Home
              </button>
            )}

            <p className="text-gray-700 text-base leading-relaxed">
              O <strong>{systemName}</strong> está temporariamente indisponível
              para manutenção e atualizações.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MaintenanceModal;
