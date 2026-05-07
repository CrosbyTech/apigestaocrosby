import React, { useEffect, useState } from 'react';
import { Gear, UserGear } from '@phosphor-icons/react';
import { useAuth } from '../components/AuthContext';
import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  checkEmailExists,
} from '../lib/userProfiles';
import {
  saveUserCompanies,
  getUserCompanies,
} from '../services/userCompaniesService';
import LoadingSpinner from '../components/LoadingSpinner';
import Notification from '../components/Notification';
import FiltroEmpresa from '../components/FiltroEmpresa';
import {
  USER_ROLES,
  USER_ROLE_LABELS,
  USER_ROLE_COLORS,
} from '../config/constants';

const perfis = Object.entries(USER_ROLE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export default function PainelAdmin() {
  const { user } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    id: null,
    name: '',
    email: '',
    password: '',
    role: 'user',
    active: true,
  });
  const [editando, setEditando] = useState(false);
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [loadingEmpresas, setLoadingEmpresas] = useState(false);

  // Só Owner pode acessar
  if (!user || user.role !== 'owner') {
    return (
      <div className="p-8 text-red-600 font-bold text-center">
        <UserGear size={48} className="mx-auto mb-4 text-red-500" />
        <p>Acesso restrito ao Proprietário.</p>
        <p className="text-sm text-gray-600 mt-2">
          Você não tem permissão para acessar esta página.
        </p>
      </div>
    );
  }

  // Buscar usuários
  const fetchUsuarios = async () => {
    setLoading(true);
    setErro('');
    try {
      const data = await fetchUsers();
      setUsuarios(data);
    } catch (e) {
      setErro(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsuarios();
  }, []);

  // NOVO: Carregar empresas vinculadas quando editar usuário franquias
  useEffect(() => {
    const loadCompaniesForUser = async () => {
      if (editando && form.id && form.role === 'franquias') {
        setLoadingEmpresas(true);
        try {
          const { data } = await getUserCompanies(form.id);
          if (data) {
            const empresasObjs = data.map((codigo) => ({ cd_empresa: codigo }));
            setEmpresasSelecionadas(empresasObjs);
          }
        } catch (error) {
          console.error('Erro ao carregar empresas:', error);
        } finally {
          setLoadingEmpresas(false);
        }
      } else if (form.role !== 'franquias') {
        setEmpresasSelecionadas([]);
      }
    };
    loadCompaniesForUser();
  }, [editando, form.id, form.role]);

  // Handlers
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro('');
    try {
      // Verificar se email já existe (exceto se estiver editando o mesmo usuário)
      const emailExists = await checkEmailExists(
        form.email,
        editando ? form.id : null,
      );
      if (emailExists) {
        setErro('Este email já está em uso.');
        return;
      }

      // Validar se usuário franquias tem empresas vinculadas
      if (form.role === 'franquias' && empresasSelecionadas.length === 0) {
        setErro(
          'Usuário do tipo Franquias deve ter pelo menos uma empresa vinculada.',
        );
        return;
      }

      let userId;

      if (editando) {
        // Atualizar usuário
        const updateData = { ...form };
        if (!updateData.password) {
          delete updateData.password; // Não atualizar senha se estiver vazia
        }
        await updateUser(form.id, updateData);
        userId = form.id;
      } else {
        // Criar novo usuário
        if (!form.password) {
          setErro('Senha é obrigatória para novos usuários.');
          return;
        }
        const newUser = await createUser(form);
        userId = newUser.id;
      }

      // Salvar empresas vinculadas se for franquias
      if (form.role === 'franquias') {
        const companyCodes = empresasSelecionadas.map((emp) => emp.cd_empresa);
        const { error: companiesError } = await saveUserCompanies(
          userId,
          companyCodes,
        );
        if (companiesError) {
          setErro(
            'Erro ao salvar empresas vinculadas: ' + companiesError.message,
          );
          return;
        }
      }

      setForm({
        id: null,
        name: '',
        email: '',
        password: '',
        role: 'user',
        active: true,
      });
      setEmpresasSelecionadas([]);
      setEditando(false);
      setSuccess(
        editando
          ? 'Usuário atualizado com sucesso!'
          : 'Usuário criado com sucesso!',
      );
      fetchUsuarios();
    } catch (e) {
      setErro(e.message);
    }
  };

  const handleEdit = (usuario) => {
    setForm({ ...usuario, password: '' });
    setEditando(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Tem certeza que deseja excluir este usuário?')) return;
    setErro('');
    try {
      await deleteUser(id);
      setSuccess('Usuário excluído com sucesso!');
      fetchUsuarios();
    } catch (e) {
      setErro(e.message);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {erro && (
        <Notification message={erro} type="error" onClose={() => setErro('')} />
      )}
      {success && (
        <Notification
          message={success}
          type="success"
          onClose={() => setSuccess('')}
        />
      )}

      <div className="flex items-center mb-6 gap-2">
        <UserGear size={32} className="text-blue-700" />
        <h1 className="text-2xl font-bold">Painel Admin</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mb-8 bg-gray-50 p-4 rounded-lg shadow"
      >
        <div className="flex gap-4 mb-2">
          <input
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="Nome"
            className="border p-2 rounded w-full"
            required
          />
          <input
            name="email"
            value={form.email}
            onChange={handleChange}
            placeholder="E-mail"
            className="border p-2 rounded w-full"
            required
            type="email"
          />
        </div>
        <div className="flex gap-4 mb-2">
          <input
            name="password"
            value={form.password}
            onChange={handleChange}
            placeholder={editando ? 'Nova senha (opcional)' : 'Senha'}
            className="border p-2 rounded w-full"
            type="password"
            minLength={4}
          />
          <select
            name="role"
            value={form.role}
            onChange={handleChange}
            className="border p-2 rounded"
          >
            {perfis.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              name="active"
              checked={form.active}
              onChange={handleChange}
            />
            Ativo
          </label>
        </div>

        {/* Campo de seleção de empresas para tipo franquias */}
        {form.role === 'franquias' && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2 text-gray-700">
              Empresas Vinculadas (obrigatório para Franquias)
            </label>
            {loadingEmpresas ? (
              <LoadingSpinner text="Carregando empresas..." />
            ) : (
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={setEmpresasSelecionadas}
              />
            )}
            {form.role === 'franquias' && empresasSelecionadas.length === 0 && (
              <p className="text-red-600 text-sm mt-1">
                Selecione pelo menos uma empresa
              </p>
            )}
          </div>
        )}

        <button
          className="bg-blue-700 text-white px-4 py-2 rounded hover:bg-blue-800"
          type="submit"
        >
          {editando ? 'Salvar' : 'Criar Usuário'}
        </button>
        {editando && (
          <button
            type="button"
            className="ml-4 text-gray-600 underline"
            onClick={() => {
              setEditando(false);
              setEmpresasSelecionadas([]);
              setForm({
                id: null,
                name: '',
                email: '',
                password: '',
                role: 'user',
                active: true,
              });
            }}
          >
            Cancelar
          </button>
        )}
      </form>

      <h2 className="text-lg font-bold mb-2">Usuários cadastrados</h2>
      {loading ? (
        <LoadingSpinner text="Carregando usuários..." />
      ) : (
        <table className="w-full border bg-white rounded shadow text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="p-2">Nome</th>
              <th className="p-2">E-mail</th>
              <th className="p-2">Perfil</th>
              <th className="p-2">Ativo</th>
              <th className="p-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-2">{u.name}</td>
                <td className="p-2">{u.email}</td>
                <td className="p-2">
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      USER_ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {USER_ROLE_LABELS[u.role] || u.role}
                  </span>
                </td>
                <td className="p-2">
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      u.active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {u.active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="p-2 flex gap-2">
                  <button
                    className="text-blue-700 underline"
                    onClick={() => handleEdit(u)}
                  >
                    Editar
                  </button>
                  <button
                    className="text-red-600 underline"
                    onClick={() => handleDelete(u.id)}
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
