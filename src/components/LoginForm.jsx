import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Eye, EyeSlash } from '@phosphor-icons/react';
import { useAuth } from './AuthContext';
import ForgotPasswordModal from './ForgotPasswordModal';

const Logo = () => (
  <div className="flex justify-center mb-6">
    <img src="/crosbyazul.png" alt="Logo" />
  </div>
);

const LoginForm = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log('🚀 Iniciando processo de login...');
    setError('');
    setLoading(true);

    try {
      console.log('🔐 Chamando função login...');
      await login(email, password, rememberMe);
      console.log('✅ Login bem-sucedido!');
      setLoading(false);
      console.log('🧭 Redirecionando para /home...');
      navigate('/home');
      console.log('✅ Redirecionamento concluído');
    } catch (err) {
      console.error('❌ Erro no login:', err);
      setError(err.message || 'Erro ao autenticar.');
      setLoading(false);
    }
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-white">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm mx-auto p-8 rounded-lg shadow-lg bg-white flex flex-col justify-center"
      >
        <Logo />
        <h2 className="text-center text-2xl font-light tracking-wide text-gray-700 mb-2">
          HEADCOACH CROSBY
        </h2>
        <div className="text-center text-cyan-600 text-xl font-medium mb-6">
          Boas-vindas
        </div>

        {error && (
          <div className="mb-4 bg-red-100 border border-red-300 text-red-700 px-4 py-2 rounded text-center">
            {error}
          </div>
        )}

        <div className="mb-4 relative flex items-center">
          <span className="absolute left-3 mt-1.5 -translate-y-1/2 text-gray-400 flex items-center justify-center">
            <User size={20} />
          </span>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="pl-10 pr-3 py-2 w-full border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition placeholder-gray-400"
            placeholder="Email"
            autoComplete="email"
            required
          />
        </div>

        <div className="mb-6 relative flex items-center">
          <span className="absolute left-3 mt-1.5 -translate-y-1/2 text-gray-400 flex items-center justify-center">
            <Lock size={20} />
          </span>
          <input
            type={showPassword ? 'text' : 'password'}
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-10 pr-10 py-2 w-full border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition placeholder-gray-400"
            placeholder="Senha"
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 mt-1.5 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
          >
            {showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}
          </button>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowForgotPasswordModal(true)}
            className="mb-5 text-sm text-gray-600 hover:text-gray-800 transition"
          >
            Esqueceu a senha?
          </button>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-cyan-600 text-white py-2 px-4 rounded hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      {/* Modal de redefinição de senha */}
      <ForgotPasswordModal
        isOpen={showForgotPasswordModal}
        onClose={() => setShowForgotPasswordModal(false)}
      />
    </div>
  );
};

export default LoginForm;
