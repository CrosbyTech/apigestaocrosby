import React, { useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Eye, EyeSlash, CheckCircle, XCircle, ArrowLeft } from '@phosphor-icons/react';
import { changePassword, updateUser } from '../lib/userProfiles';
import Toast from '../components/Toast';

const UserPanel = () => {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  
  // Estados do formulário
  const [formData, setFormData] = useState({
    name: user?.name || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });
  
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Limpar erro do campo quando o usuário começar a digitar
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const togglePasswordVisibility = (field) => {
    setShowPasswords(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const validateForm = () => {
    const newErrors = {};

    // Validação do nome
    if (!formData.name.trim()) {
      newErrors.name = 'Nome é obrigatório';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Nome deve ter pelo menos 2 caracteres';
    }

    // Validação da senha (se estiver sendo alterada)
    if (formData.newPassword || formData.confirmPassword || formData.currentPassword) {
      if (!formData.currentPassword) {
        newErrors.currentPassword = 'Senha atual é obrigatória';
      }

      if (!formData.newPassword) {
        newErrors.newPassword = 'Nova senha é obrigatória';
      } else if (formData.newPassword.length < 6) {
        newErrors.newPassword = 'A nova senha deve ter pelo menos 6 caracteres';
      }

      if (!formData.confirmPassword) {
        newErrors.confirmPassword = 'Confirmação de senha é obrigatória';
      } else if (formData.newPassword !== formData.confirmPassword) {
        newErrors.confirmPassword = 'As senhas não coincidem';
      }

      if (formData.currentPassword === formData.newPassword) {
        newErrors.newPassword = 'A nova senha deve ser diferente da senha atual';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      // Atualizar nome se foi alterado
      if (formData.name !== user.name) {
        await updateUser(user.id, { name: formData.name });
      }

      // Alterar senha se foi fornecida
      if (formData.newPassword) {
        await changePassword(user.id, formData.currentPassword, formData.newPassword);
      }

      // Atualizar usuário no contexto
      const updatedUser = {
        ...user,
        name: formData.name
      };
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));

      // Limpar formulário
      setFormData(prev => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      }));

      setToast({
        message: 'Dados atualizados com sucesso!',
        type: 'success'
      });
    } catch (error) {
      setToast({
        message: `Erro ao atualizar dados: ${error.message}`,
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col items-stretch justify-start py-8 px-4">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="Voltar"
          >
            <ArrowLeft size={24} className="text-gray-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Painel do Usuário</h1>
            <p className="text-gray-600">Gerencie suas informações pessoais</p>
          </div>
        </div>

        {/* Card do usuário */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="bg-blue-100 p-3 rounded-full">
              <User size={32} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-800">{user?.name}</h2>
              <p className="text-gray-600">{user?.email}</p>
              <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium mt-1 ${
                user?.role === 'ADM' ? 'bg-red-100 text-red-800' :
                user?.role === 'DIRETOR' ? 'bg-blue-100 text-blue-800' :
                user?.role === 'FINANCEIRO' ? 'bg-green-100 text-green-800' :
                'bg-purple-100 text-purple-800'
              }`}>
                {user?.role}
              </span>
            </div>
          </div>
        </div>

        {/* Formulário de edição */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-6">Editar Informações</h3>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Nome */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nome Completo
              </label>
              <div className="relative">
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className={`w-full pl-10 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    errors.name ? 'border-red-300' : 'border-gray-300'
                  }`}
                  placeholder="Digite seu nome completo"
                />
                <User size={20} className="absolute left-3 top-2.5 text-gray-400" />
              </div>
              {errors.name && (
                <p className="text-red-500 text-sm mt-1 flex items-center gap-1">
                  <XCircle size={16} />
                  {errors.name}
                </p>
              )}
            </div>

            {/* Seção de alteração de senha */}
            <div className="border-t pt-6">
              <h4 className="text-md font-medium text-gray-800 mb-4">Alterar Senha (opcional)</h4>
              
              {/* Senha Atual */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Senha Atual
                </label>
                <div className="relative">
                  <input
                    type={showPasswords.current ? 'text' : 'password'}
                    name="currentPassword"
                    value={formData.currentPassword}
                    onChange={handleChange}
                    className={`w-full pl-10 pr-10 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.currentPassword ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder="Digite sua senha atual"
                  />
                  <Lock size={20} className="absolute left-3 top-2.5 text-gray-400" />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility('current')}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    {showPasswords.current ? <EyeSlash size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                {errors.currentPassword && (
                  <p className="text-red-500 text-sm mt-1 flex items-center gap-1">
                    <XCircle size={16} />
                    {errors.currentPassword}
                  </p>
                )}
              </div>

              {/* Nova Senha */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nova Senha
                </label>
                <div className="relative">
                  <input
                    type={showPasswords.new ? 'text' : 'password'}
                    name="newPassword"
                    value={formData.newPassword}
                    onChange={handleChange}
                    className={`w-full pl-10 pr-10 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.newPassword ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder="Digite sua nova senha"
                  />
                  <Lock size={20} className="absolute left-3 top-2.5 text-gray-400" />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility('new')}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    {showPasswords.new ? <EyeSlash size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                {errors.newPassword && (
                  <p className="text-red-500 text-sm mt-1 flex items-center gap-1">
                    <XCircle size={16} />
                    {errors.newPassword}
                  </p>
                )}
              </div>

              {/* Confirmar Nova Senha */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Confirmar Nova Senha
                </label>
                <div className="relative">
                  <input
                    type={showPasswords.confirm ? 'text' : 'password'}
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    className={`w-full pl-10 pr-10 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.confirmPassword ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder="Confirme sua nova senha"
                  />
                  <Lock size={20} className="absolute left-3 top-2.5 text-gray-400" />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility('confirm')}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    {showPasswords.confirm ? <EyeSlash size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="text-red-500 text-sm mt-1 flex items-center gap-1">
                    <XCircle size={16} />
                    {errors.confirmPassword}
                  </p>
                )}
              </div>

              {/* Requisitos da Senha */}
              {(formData.newPassword || formData.confirmPassword) && (
                <div className="bg-gray-50 p-3 rounded-lg mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Requisitos da senha:</p>
                  <ul className="text-xs text-gray-600 space-y-1">
                    <li className={`flex items-center gap-1 ${formData.newPassword.length >= 6 ? 'text-green-600' : ''}`}>
                      {formData.newPassword.length >= 6 ? <CheckCircle size={12} /> : <XCircle size={12} />}
                      Mínimo de 6 caracteres
                    </li>
                    <li className={`flex items-center gap-1 ${formData.newPassword !== formData.currentPassword ? 'text-green-600' : ''}`}>
                      {formData.newPassword && formData.newPassword !== formData.currentPassword ? <CheckCircle size={12} /> : <XCircle size={12} />}
                      Diferente da senha atual
                    </li>
                    <li className={`flex items-center gap-1 ${formData.newPassword === formData.confirmPassword && formData.confirmPassword ? 'text-green-600' : ''}`}>
                      {formData.newPassword === formData.confirmPassword && formData.confirmPassword ? <CheckCircle size={12} /> : <XCircle size={12} />}
                      Senhas coincidem
                    </li>
                  </ul>
                </div>
              )}
            </div>

            {/* Botão de Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Salvando...
                </div>
              ) : (
                'Salvar Alterações'
              )}
            </button>
          </form>
        </div>

      {/* Toast de notificação */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      </div>
      );
};

export default UserPanel; 