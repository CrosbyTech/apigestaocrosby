import React, { useState, useEffect } from 'react';
import { X, Check } from '@phosphor-icons/react';
import { useAuth } from './AuthContext';
import { useNotices } from '../hooks/useNotices';

/**
 * Modal de avisos exibido automaticamente ao fazer login
 * Mostra avisos não lidos do dia com countdown de 5 segundos
 * Design igual ao NoticesModal (bg-[#000638], fontes menores, botões compactos)
 */
const LoginNoticesModal = ({ onClose }) => {
  const { user } = useAuth();
  const { getTodayUnreadNotices, confirmRead } = useNotices();
  const [notices, setNotices] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [countdown, setCountdown] = useState(5);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  // Carregar avisos do dia ao montar
  useEffect(() => {
    loadTodayNotices();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (countdown > 0 && notices.length > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown, notices]);

  const loadTodayNotices = async () => {
    if (!user?.id) return;

    setLoading(true);
    try {
      const result = await getTodayUnreadNotices(user.id);
      if (result.success && result.data.length > 0) {
        setNotices(result.data);
      } else {
        // Não há avisos do dia, fechar modal
        onClose();
      }
    } catch (error) {
      console.error('Erro ao carregar avisos do dia:', error);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (countdown > 0 || confirming) return;

    const currentNotice = notices[currentIndex];
    setConfirming(true);

    try {
      await confirmRead(currentNotice.id, user.id);

      // Se houver mais avisos, ir para o próximo
      if (currentIndex < notices.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setCountdown(5); // Resetar countdown
      } else {
        // Todos os avisos foram confirmados
        onClose();
      }
    } catch (error) {
      console.error('Erro ao confirmar leitura:', error);
    } finally {
      setConfirming(false);
    }
  };

  // Não renderizar se estiver carregando ou não houver avisos
  if (loading || notices.length === 0) return null;

  const currentNotice = notices[currentIndex];
  const hasMultiple = notices.length > 1;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col h-4/5">
        {/* Header */}
        <div className="bg-[#000638] from-blue-600 to-indigo-600 p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold mb-0.5">Aviso Importante</h2>
              <p className="text-xs text-blue-100">
                Por favor, leia com atenção antes de continuar
              </p>
            </div>
            {hasMultiple && (
              <span className="text-xs bg-white bg-opacity-20 px-2 py-1 rounded-full font-semibold">
                {currentIndex + 1} de {notices.length}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-base font-bold text-gray-900 mb-1">
            {currentNotice.title}
          </h3>
          <div
            className="prose prose-sm max-w-none text-sm"
            dangerouslySetInnerHTML={{ __html: currentNotice.content }}
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex flex-col gap-3">
            {/* Progress bar do countdown */}
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-green-500 to-emerald-500 h-2 transition-all duration-1000 ease-linear"
                style={{ width: `${((5 - countdown) / 5) * 100}%` }}
              />
            </div>

            {/* Botão de confirmação */}
            <button
              onClick={handleConfirm}
              disabled={countdown > 0 || confirming}
              className={`w-full py-2 bg-[#000638] from-green-600 to-emerald-600 text-white text-sm rounded-lg font-bold hover:from-green-700 hover:to-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                countdown > 0 || confirming ? 'cursor-not-allowed' : ''
              }`}
            >
              {confirming ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Confirmando...</span>
                </>
              ) : countdown > 0 ? (
                <>
                  <span className="text-lg font-bold">{countdown}</span>
                  <span>segundos para continuar...</span>
                </>
              ) : (
                <>
                  <Check size={16} weight="bold" />
                  <span>Li e Compreendi</span>
                </>
              )}
            </button>

            {/* Informações adicionais */}
            <div className="text-[11px] text-gray-500 text-center">
              {hasMultiple && currentIndex < notices.length - 1 ? (
                <p>
                  Após confirmar, você verá o próximo aviso (
                  {notices.length - currentIndex - 1} restante
                  {notices.length - currentIndex - 1 > 1 ? 's' : ''})
                </p>
              ) : (
                <p>Após confirmar, você será redirecionado para o sistema</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginNoticesModal;
