import React, { useState, useRef, useEffect } from 'react';
import {
  TextB,
  TextItalic,
  TextUnderline,
  Link,
  Palette,
  X,
} from '@phosphor-icons/react';
import { useAuth } from './AuthContext';
import { useNotices } from '../hooks/useNotices';
import { Card, CardContent, CardHeader, CardTitle } from './ui/cards';
import Input from './ui/Input';

/**
 * Editor rico para criar e editar avisos
 * Permite formatação de texto, cores e links
 */
const NoticeEditor = ({ noticeToEdit = null, onSuccess, onCancel }) => {
  const { user } = useAuth();
  const { createNotice, updateNotice } = useNotices();
  const [title, setTitle] = useState(noticeToEdit?.title || '');
  const [content, setContent] = useState(noticeToEdit?.content || '');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [loading, setLoading] = useState(false);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const editorRef = useRef(null);

  const roles = [
    { value: 'owner', label: 'Proprietário' },
    { value: 'admin', label: 'Administrador' },
    { value: 'manager', label: 'Gerente' },
    { value: 'franquia', label: 'Franquia' },
    { value: 'user', label: 'Usuário' },
    { value: 'vendedor', label: 'Vendedor' },
    { value: 'guest', label: 'Convidado' },
  ];

  const colors = [
    { name: 'Vermelho', value: '#ef4444' },
    { name: 'Laranja', value: '#f97316' },
    { name: 'Amarelo', value: '#eab308' },
    { name: 'Verde', value: '#22c55e' },
    { name: 'Azul', value: '#3b82f6' },
    { name: 'Roxo', value: '#a855f7' },
    { name: 'Rosa', value: '#ec4899' },
    { name: 'Preto', value: '#000000' },
  ];

  // Carregar usuários disponíveis
  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const { supabase } = await import('../lib/supabase');
      let users = [];

      // Tentar buscar usando RPC (mais confiável)
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'get_all_users',
        );

        if (!rpcError && rpcData && rpcData.length > 0) {
          users = rpcData.map((u) => ({
            id: u.id,
            email: u.email,
            name: u.name || u.email,
            role: u.role || 'user',
          }));
          setAvailableUsers(users);
          setLoadingUsers(false);
          return;
        }
      } catch (rpcError) {
        console.warn('RPC get_all_users não disponível:', rpcError);
      }

      // Tentar buscar de user_profiles
      try {
        const { data: profilesData, error: profilesError } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role')
          .order('name');

        if (!profilesError && profilesData && profilesData.length > 0) {
          users = profilesData.map((p) => ({
            id: p.user_id,
            email: p.email,
            name: p.name || p.email,
            role: p.role || 'user',
          }));
          setAvailableUsers(users);
          setLoadingUsers(false);
          return;
        }
      } catch (profilesError) {
        console.warn('Tabela user_profiles não disponível:', profilesError);
      }

      // Fallback: usar apenas o usuário atual
      console.warn(
        'Não foi possível carregar lista de usuários. Execute o script SQL add_user_management.sql no Supabase.',
      );
      users = [
        {
          id: user.id,
          email: user.email,
          name: user.name || user.email,
          role: user.role || 'user',
        },
      ];
      setAvailableUsers(users);
    } catch (error) {
      console.error('Erro ao carregar usuários:', error);
      // Fallback final: usar apenas o usuário atual
      setAvailableUsers([
        {
          id: user.id,
          email: user.email,
          name: user.name || user.email,
          role: user.role || 'user',
        },
      ]);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Comandos de formatação
  const execCommand = (command, value = null) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const applyColor = (color) => {
    execCommand('foreColor', color);
    setShowColorPicker(false);
  };

  const insertLink = () => {
    if (!linkUrl || !linkText) return;

    const link = `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">${linkText}</a>`;
    execCommand('insertHTML', link);
    setLinkUrl('');
    setLinkText('');
    setShowLinkModal(false);
  };

  const handleRoleToggle = (roleValue) => {
    setSelectedRoles((prev) =>
      prev.includes(roleValue)
        ? prev.filter((r) => r !== roleValue)
        : [...prev, roleValue],
    );
  };

  const handleUserToggle = (userId) => {
    setSelectedUsers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!title.trim() || !editorRef.current?.innerHTML.trim()) {
      alert('Por favor, preencha o título e o conteúdo do aviso.');
      return;
    }

    if (selectedRoles.length === 0 && selectedUsers.length === 0) {
      alert(
        'Por favor, selecione pelo menos um destinatário (role ou usuário).',
      );
      return;
    }

    setLoading(true);

    try {
      const noticeData = {
        title: title.trim(),
        content: editorRef.current.innerHTML,
        styles: {},
      };

      // Preparar destinatários
      const recipients = [];

      // Adicionar usuários selecionados por role
      if (selectedRoles.length > 0) {
        const usersByRole = availableUsers.filter((u) =>
          selectedRoles.includes(u.role),
        );
        usersByRole.forEach((u) => {
          if (!recipients.find((r) => r.userId === u.id)) {
            recipients.push({ userId: u.id, role: u.role });
          }
        });
      }

      // Adicionar usuários selecionados individualmente
      selectedUsers.forEach((userId) => {
        const user = availableUsers.find((u) => u.id === userId);
        if (user && !recipients.find((r) => r.userId === userId)) {
          recipients.push({ userId, role: user.role });
        }
      });

      let result;
      if (noticeToEdit) {
        result = await updateNotice(noticeToEdit.id, noticeData);
      } else {
        result = await createNotice(noticeData, recipients);
      }

      if (result.success) {
        alert(
          noticeToEdit
            ? 'Aviso atualizado com sucesso!'
            : 'Aviso criado e enviado com sucesso!',
        );
        // Limpar formulário
        setTitle('');
        setContent('');
        setSelectedUsers([]);
        setSelectedRoles([]);
        if (editorRef.current) {
          editorRef.current.innerHTML = '';
        }
        onSuccess?.();
      } else {
        alert('Erro ao salvar aviso: ' + result.error);
      }
    } catch (error) {
      console.error('Erro ao enviar aviso:', error);
      alert('Erro ao enviar aviso. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h3 className="text-base font-bold text-gray-900 mb-4">
        {noticeToEdit ? 'Editar Aviso' : 'Criar Novo Aviso'}
      </h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Título */}
        <Input
          label="Título do Aviso"
          placeholder="Digite um título claro e objetivo"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          fullWidth
        />

        {/* Editor de conteúdo */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-gray-700">
            Conteúdo do Aviso *
          </label>

          {/* Barra de ferramentas */}
          <div className="flex flex-wrap gap-1.5 p-2 bg-gray-50 border border-gray-300 rounded-t-lg">
            <button
              type="button"
              onClick={() => execCommand('bold')}
              className="p-1.5 rounded hover:bg-gray-200 transition-colors"
              title="Negrito"
            >
              <TextB size={16} weight="bold" />
            </button>
            <button
              type="button"
              onClick={() => execCommand('italic')}
              className="p-1.5 rounded hover:bg-gray-200 transition-colors"
              title="Itálico"
            >
              <TextItalic size={16} weight="bold" />
            </button>
            <button
              type="button"
              onClick={() => execCommand('underline')}
              className="p-1.5 rounded hover:bg-gray-200 transition-colors"
              title="Sublinhado"
            >
              <TextUnderline size={16} weight="bold" />
            </button>

            <div className="w-px h-5 bg-gray-300 mx-0.5" />

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="p-1.5 rounded hover:bg-gray-200 transition-colors"
                title="Cor do texto"
              >
                <Palette size={16} weight="bold" />
              </button>

              {showColorPicker && (
                <div className="absolute top-full mt-1.5 p-2 bg-white border border-gray-300 rounded-lg shadow-lg z-10">
                  <div className="grid grid-cols-4 gap-1.5">
                    {colors.map((color) => (
                      <button
                        key={color.value}
                        type="button"
                        onClick={() => applyColor(color.value)}
                        className="w-6 h-6 rounded border-2 border-gray-300 hover:border-gray-500 transition-colors"
                        style={{ backgroundColor: color.value }}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowLinkModal(true)}
              className="p-1.5 rounded hover:bg-gray-200 transition-colors"
              title="Inserir link"
            >
              <Link size={16} weight="bold" />
            </button>
          </div>

          {/* Área de edição */}
          <div
            ref={editorRef}
            contentEditable
            className="min-h-[150px] p-3 text-sm border border-gray-300 rounded-b-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            style={{ maxHeight: '300px', overflowY: 'auto' }}
            placeholder="Digite o conteúdo do aviso aqui..."
            suppressContentEditableWarning
          />
        </div>

        {/* Modal de inserir link */}
        {showLinkModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Inserir Link</h3>
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="p-1 rounded hover:bg-gray-100"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <Input
                  label="Texto do link"
                  placeholder="Digite o texto que será exibido"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  fullWidth
                />
                <Input
                  label="URL"
                  placeholder="https://exemplo.com"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  fullWidth
                />
                <button
                  type="button"
                  onClick={insertLink}
                  className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Inserir Link
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Seleção de destinatários */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">
            Destinatários *
          </h3>

          {/* Seleção por role */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-700">
              Selecionar por Função
            </label>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((role) => (
                <label
                  key={role.value}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border-2 cursor-pointer transition-all ${
                    selectedRoles.includes(role.value)
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedRoles.includes(role.value)}
                    onChange={() => handleRoleToggle(role.value)}
                    className="w-3 h-3 text-blue-600"
                  />
                  <span className="font-medium">{role.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Seleção individual */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Selecionar Usuários Específicos
            </label>
            {loadingUsers ? (
              <div className="text-sm text-gray-500">
                Carregando usuários...
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-lg p-3 space-y-2">
                {availableUsers.map((u) => (
                  <label
                    key={u.id}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                      selectedUsers.includes(u.id)
                        ? 'bg-blue-50'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(u.id)}
                      onChange={() => handleUserToggle(u.id)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {u.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {u.email} •{' '}
                        {roles.find((r) => r.value === u.role)?.label}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Contador de destinatários */}
          <div className="text-xs text-gray-600 bg-blue-50 p-2 rounded-md">
            <strong>Total de destinatários:</strong>{' '}
            {(() => {
              const roleUsers = availableUsers.filter((u) =>
                selectedRoles.includes(u.role),
              );
              const uniqueUsers = new Set([
                ...roleUsers.map((u) => u.id),
                ...selectedUsers,
              ]);
              return uniqueUsers.size;
            })()}
          </div>
        </div>

        {/* Botões de ação */}
        <div className="flex gap-2 pt-3">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2 bg-[#000638] text-white text-sm rounded-lg font-semibold hover:bg-[#000850] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? 'Enviando...'
              : noticeToEdit
              ? 'Atualizar Aviso'
              : 'Criar e Enviar Aviso'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default NoticeEditor;
