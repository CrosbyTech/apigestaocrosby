import React, { useState } from 'react';
import { X, EnvelopeSimple, Key, Check, Warning } from '@phosphor-icons/react';
import { supabase } from '../lib/supabase';

const ForgotPasswordModal = ({ isOpen, onClose }) => {
  const [step, setStep] = useState(1); // 1: Email, 2: Token, 3: Nova senha
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleRequestReset = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setSuccess('Código de verificação enviado para seu email!');
      setTimeout(() => {
        setStep(2);
        setSuccess('');
      }, 2000);
    } catch (err) {
      console.error('Erro ao solicitar redefinição:', err);
      setError(err.message || 'Erro ao enviar email de recuperação');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyToken = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      // Verificar o token OTP
      const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'recovery',
      });

      if (error) throw error;

      setSuccess('Código verificado com sucesso!');
      setTimeout(() => {
        setStep(3);
        setSuccess('');
      }, 1500);
    } catch (err) {
      console.error('Erro ao verificar token:', err);
      setError('Código inválido ou expirado');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validações
    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      setSuccess('Senha redefinida com sucesso!');
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (err) {
      console.error('Erro ao redefinir senha:', err);
      setError(err.message || 'Erro ao redefinir senha');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setEmail('');
    setToken('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md mx-4 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-800">Redefinir Senha</h2>
          <button
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Mensagens */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <Warning size={20} className="text-red-600 flex-shrink-0" />
              <span className="text-sm text-red-800">{error}</span>
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
              <Check size={20} className="text-green-600 flex-shrink-0" />
              <span className="text-sm text-green-800">{success}</span>
            </div>
          )}

          {/* Step 1: Email */}
          {step === 1 && (
            <form onSubmit={handleRequestReset}>
              <p className="text-sm text-gray-600 mb-4">
                Digite seu email para receber um código de verificação
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <div className="relative">
                  <EnvelopeSimple
                    size={20}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    placeholder="seu@email.com"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-cyan-600 text-white py-2 px-4 rounded-lg hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Enviando...' : 'Enviar Código'}
              </button>
            </form>
          )}

          {/* Step 2: Token */}
          {step === 2 && (
            <form onSubmit={handleVerifyToken}>
              <p className="text-sm text-gray-600 mb-4">
                Digite o código de 6 dígitos enviado para{' '}
                <span className="font-semibold">{email}</span>
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Código de Verificação
                </label>
                <div className="relative">
                  <Key
                    size={20}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    value={token}
                    onChange={(e) =>
                      setToken(e.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-center text-2xl tracking-widest font-mono"
                    placeholder="000000"
                    maxLength={6}
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || token.length !== 6}
                className="w-full bg-cyan-600 text-white py-2 px-4 rounded-lg hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Verificando...' : 'Verificar Código'}
              </button>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-full mt-2 text-sm text-gray-600 hover:text-gray-800 transition"
              >
                Voltar
              </button>
            </form>
          )}

          {/* Step 3: Nova Senha */}
          {step === 3 && (
            <form onSubmit={handleResetPassword}>
              <p className="text-sm text-gray-600 mb-4">
                Digite sua nova senha
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nova Senha
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  placeholder="Mínimo 6 caracteres"
                  minLength={6}
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Confirmar Nova Senha
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  placeholder="Digite a senha novamente"
                  minLength={6}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-cyan-600 text-white py-2 px-4 rounded-lg hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Redefinindo...' : 'Redefinir Senha'}
              </button>
            </form>
          )}
        </div>

        {/* Steps Indicator */}
        <div className="px-6 pb-6">
          <div className="flex items-center justify-center gap-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-colors ${
                  s === step
                    ? 'bg-cyan-600'
                    : s < step
                    ? 'bg-green-500'
                    : 'bg-gray-300'
                }`}
              />
            ))}
          </div>
          <div className="text-center text-xs text-gray-500 mt-2">
            {step === 1 && 'Passo 1: Digite seu email'}
            {step === 2 && 'Passo 2: Verifique o código'}
            {step === 3 && 'Passo 3: Nova senha'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordModal;
