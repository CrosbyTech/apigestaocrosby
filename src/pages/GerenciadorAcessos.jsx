import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../components/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import PageTitle from '../components/ui/PageTitle';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  MagnifyingGlass,
  Users,
  CheckCircle,
  XCircle,
  Copy,
  FloppyDisk,
  Trash,
  Warning,
  Shield,
  User,
  Check,
  Info,
} from '@phosphor-icons/react';

// Lista de todas as páginas do sistema (sincronizada com App.jsx e Sidebar)
const AVAILABLE_PAGES = [
  // Principal
  { path: '/home', name: 'Home', category: 'Principal' },
  { path: '/crosby-bot', name: 'Crosby Bot', category: 'Principal' },
  { path: '/dashboard', name: 'BI Externo (Dashboard)', category: 'Principal' },
  { path: '/bi-externo', name: 'BI Externo', category: 'Principal' },
  { path: '/user-panel', name: 'Painel do Usuário', category: 'Principal' },

  // Financeiro
  { path: '/contas-a-pagar', name: 'Contas a Pagar', category: 'Financeiro' },
  { path: '/emprestimos', name: 'Empréstimos', category: 'Financeiro' },
  {
    path: '/despesa-filial',
    name: 'Despesas por Filial',
    category: 'Financeiro',
  },
  {
    path: '/liberacao-pagamento',
    name: 'Liberação de Pagamento',
    category: 'Financeiro',
  },
  {
    path: '/contas-a-pagar-emissao',
    name: 'Contas a Pagar (Emissão)',
    category: 'Financeiro',
  },
  {
    path: '/contas-a-receber',
    name: 'Contas a Receber',
    category: 'Financeiro',
  },
  {
    path: '/analise-credito',
    name: 'Análise de Crédito',
    category: 'Financeiro',
  },
  {
    path: '/analise-renegociacao',
    name: 'Análise de Renegociações',
    category: 'Financeiro',
  },
  {
    path: '/batida-carteira',
    name: 'Batida de Carteira',
    category: 'Financeiro',
  },
  { path: '/dre', name: 'DRE', category: 'Financeiro' },
  {
    path: '/dash-contas-a-receber',
    name: 'Dash Contas a Receber',
    category: 'Financeiro',
  },
  {
    path: '/dash-inadimplencia',
    name: 'Dash Inadimplência',
    category: 'Financeiro',
  },
  { path: '/pmr', name: 'PMR', category: 'Financeiro' },
  {
    path: '/solicitacao-baixa',
    name: 'Solicitação de Baixa',
    category: 'Financeiro',
  },
  {
    path: '/extratos-bancos',
    name: 'Extratos Bancos',
    category: 'Financeiro',
  },
  {
    path: '/extrato-totvs',
    name: 'Extrato TOTVS',
    category: 'Financeiro',
  },

  // CMV
  { path: '/cmv-consolidado', name: 'CMV Consolidado', category: 'CMV' },
  { path: '/cmv-multimarcas', name: 'CMV Multimarcas', category: 'CMV' },
  { path: '/cmv-revenda', name: 'CMV Revenda', category: 'CMV' },
  { path: '/cmv-franquia', name: 'CMV Franquia', category: 'CMV' },
  { path: '/cmv-varejo', name: 'CMV Varejo', category: 'CMV' },

  // Varejo
  { path: '/dashboard-varejo', name: 'Dashboard Varejo', category: 'Varejo' },
  { path: '/metas-varejo', name: 'Metas Varejo', category: 'Varejo' },
  { path: '/credev-varejo', name: 'CREDEV Varejo', category: 'Varejo' },
  { path: '/top-clientes', name: 'Top Clientes', category: 'Varejo' },
  {
    path: '/documento-bluecred',
    name: 'Documento Bluecred',
    category: 'Varejo',
  },

  // Multimarcas
  {
    path: '/dashboard-multimarcas',
    name: 'Dashboard Multimarcas',
    category: 'Multimarcas',
  },
  {
    path: '/credev-multimarcas',
    name: 'CREDEV Multimarcas',
    category: 'Multimarcas',
  },
  {
    path: '/inadimplentes-multimarcas',
    name: 'Inadimplentes Multimarcas',
    category: 'Multimarcas',
  },
  {
    path: '/minhas-solicitacoes-baixa',
    name: 'Minhas Solicitações de Baixa',
    category: 'Multimarcas',
  },
  {
    path: '/titulos-clientes',
    name: 'Portal de Títulos MTM',
    category: 'Multimarcas',
  },
  {
    path: '/clientes-mtm',
    name: 'Clientes MTM',
    category: 'Multimarcas',
  },

  // Revenda
  {
    path: '/dashboard-revenda',
    name: 'Dashboard Revenda',
    category: 'Revenda',
  },
  { path: '/credev-revenda', name: 'CREDEV Revenda', category: 'Revenda' },
  {
    path: '/inadimplentes-revenda',
    name: 'Inadimplentes Revenda',
    category: 'Revenda',
  },

  // Franquias
  {
    path: '/dashboard-franquias',
    name: 'Dashboard Franquias',
    category: 'Franquias',
  },
  {
    path: '/voucher-usage',
    name: 'Vouchers',
    category: 'Franquias',
  },
  {
    path: '/compras-franquias',
    name: 'Compras Franquias',
    category: 'Franquias',
  },
  { path: '/credev', name: 'CREDEV', category: 'Franquias' },
  {
    path: '/credito-franquia',
    name: 'Crédito Franquia',
    category: 'Franquias',
  },
  {
    path: '/inadimplentes-franquias',
    name: 'Inadimplentes Franquias',
    category: 'Franquias',
  },
  {
    path: '/minhas-solicitacoes-baixa',
    name: 'Minhas Solicitações de Baixa',
    category: 'Franquias',
  },

  // Recuperação de Crédito
  {
    path: '/recuperacao-credito',
    name: 'Recuperação de Crédito',
    category: 'Recuperação de Crédito',
  },

  // Minha Franquia
  {
    path: '/contas-pagar-franquias',
    name: 'Contas a Pagar Franquias',
    category: 'Minha Franquia',
  },
  {
    path: '/solicitacao-credito',
    name: 'Solicitação de Crédito',
    category: 'Minha Franquia',
  },
  {
    path: '/renegociacao-dividas',
    name: 'Renegociação de Dívidas',
    category: 'Minha Franquia',
  },
  { path: '/notas-fiscais', name: 'Notas Fiscais', category: 'Minha Franquia' },
  {
    path: '/extrato-credito',
    name: 'Extrato de Crédito',
    category: 'Minha Franquia',
  },

  // Antecipações
  {
    path: '/faturas-clientes-antecipacao',
    name: 'Faturas Clientes',
    category: 'Antecipações',
  },
  {
    path: '/nf-clientes-antecipacao',
    name: 'Notas Fiscais Clientes',
    category: 'Antecipações',
  },
  {
    path: '/comprovantes-antecipacao',
    name: 'Comprovantes',
    category: 'Antecipações',
  },
  {
    path: '/clientes-antecipacao',
    name: 'Clientes (Perfil)',
    category: 'Antecipações',
  },
  {
    path: '/licitacao-titulos',
    name: 'Licitação de Títulos',
    category: 'Antecipações',
  },
  {
    path: '/solicitacoes-remessa',
    name: 'Solicitações de Remessa',
    category: 'Antecipações',
  },
  {
    path: '/minhas-remessas',
    name: 'Minhas Remessas',
    category: 'Antecipações',
  },

  // Clientes
  { path: '/consulta-cliente', name: 'Consulta Cliente', category: 'Clientes' },
  { path: '/clientes-totvs', name: 'Clientes TOTVS', category: 'Clientes' },
  {
    path: '/creditos-clientes',
    name: 'Créditos Clientes',
    category: 'Clientes',
  },

  // CRM
  { path: '/crm-vendas', name: 'CRM Vendas', category: 'CRM' },

  // Outros
  { path: '/widgets', name: 'Meus Widgets', category: 'Outros' },
  {
    path: '/ranking-faturamento',
    name: 'Ranking Faturamento',
    category: 'Outros',
  },

  // Administração
  { path: '/painel-admin', name: 'Painel Admin', category: 'Administração' },
  {
    path: '/gerenciador-dashboards',
    name: 'Gerenciador de Dashboards',
    category: 'Administração',
  },
  {
    path: '/gerenciador-acessos',
    name: 'Gerenciador de Acessos',
    category: 'Administração',
  },
  {
    path: '/gerenciador-avisos',
    name: 'Gerenciador de Avisos',
    category: 'Administração',
  },
  {
    path: '/api-claude',
    name: 'API Claude',
    category: 'Administração',
  },
];

const GerenciadorAcessos = () => {
  const { user } = useAuth();
  const {
    loading,
    error,
    users,
    loadUsersWithPermissions,
    savePermissions,
    saveBulkPermissions,
    copyPermissions,
    clearPermissions,
  } = usePermissions();

  // Estados
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [searchUser, setSearchUser] = useState('');
  const [filterRole, setFilterRole] = useState(''); // Novo: filtro por role
  const [selectedPages, setSelectedPages] = useState([]);
  const [mode, setMode] = useState('individual'); // 'individual' ou 'bulk'
  const [saving, setSaving] = useState(false);
  const [copyFromUser, setCopyFromUser] = useState('');
  const [toasts, setToasts] = useState([]);

  // Função para adicionar toast
  const addToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 2000);
  };

  // Verificar se é owner
  if (user?.role !== 'owner') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <Warning size={64} className="mx-auto text-red-500 mb-4" />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              Acesso Negado
            </h2>
            <p className="text-gray-600">
              Apenas proprietários podem acessar o gerenciador de acessos.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Carregar usuários ao montar
  useEffect(() => {
    loadUsersWithPermissions();
  }, [loadUsersWithPermissions]);

  // Filtrar usuários pela busca e role
  const filteredUsers = useMemo(() => {
    let filtered = users;

    // Filtrar por busca
    if (searchUser) {
      const search = searchUser.toLowerCase();
      filtered = filtered.filter(
        (u) =>
          u.email.toLowerCase().includes(search) ||
          u.name.toLowerCase().includes(search) ||
          u.role.toLowerCase().includes(search),
      );
    }

    // Filtrar por role
    if (filterRole) {
      filtered = filtered.filter((u) => u.role === filterRole);
    }

    return filtered;
  }, [users, searchUser, filterRole]);

  // Agrupar páginas por categoria
  const pagesByCategory = useMemo(() => {
    const grouped = {};
    AVAILABLE_PAGES.forEach((page) => {
      if (!grouped[page.category]) {
        grouped[page.category] = [];
      }
      grouped[page.category].push(page);
    });
    return grouped;
  }, []);

  // Quando seleciona um usuário no modo individual
  const handleSelectUser = (userId) => {
    if (mode === 'individual') {
      setSelectedUsers([userId]);
      const user = users.find((u) => u.id === userId);
      setSelectedPages(user?.permissions || []);
    } else {
      // Modo bulk: toggle seleção
      setSelectedUsers((prev) =>
        prev.includes(userId)
          ? prev.filter((id) => id !== userId)
          : [...prev, userId],
      );
    }
  };

  // Toggle página
  const handleTogglePage = (pagePath) => {
    setSelectedPages((prev) =>
      prev.includes(pagePath)
        ? prev.filter((p) => p !== pagePath)
        : [...prev, pagePath],
    );
  };

  // Selecionar todas as páginas de uma categoria
  const handleSelectCategory = (category) => {
    const pagesInCategory = pagesByCategory[category].map((p) => p.path);
    const allSelected = pagesInCategory.every((p) => selectedPages.includes(p));

    if (allSelected) {
      // Desmarcar todas da categoria
      setSelectedPages((prev) =>
        prev.filter((p) => !pagesInCategory.includes(p)),
      );
    } else {
      // Marcar todas da categoria
      setSelectedPages((prev) => [...new Set([...prev, ...pagesInCategory])]);
    }
  };

  // Selecionar todos os usuários filtrados
  const handleSelectAllUsers = () => {
    if (mode === 'bulk') {
      const allUserIds = filteredUsers.map((u) => u.id);
      setSelectedUsers(allUserIds);
    }
  };

  // Desmarcar todos os usuários
  const handleDeselectAllUsers = () => {
    setSelectedUsers([]);
    if (mode === 'individual') {
      setSelectedPages([]);
    }
  };

  // Selecionar todas as páginas
  const handleSelectAllPages = () => {
    const allPagePaths = AVAILABLE_PAGES.map((p) => p.path);
    setSelectedPages(allPagePaths);
  };

  // Desmarcar todas as páginas
  const handleDeselectAllPages = () => {
    setSelectedPages([]);
  };

  // Salvar permissões
  const handleSave = async () => {
    if (selectedUsers.length === 0) {
      addToast('Selecione pelo menos um usuário', 'error');
      return;
    }

    setSaving(true);

    try {
      if (mode === 'individual' && selectedUsers.length === 1) {
        const result = await savePermissions(selectedUsers[0], selectedPages);
        if (result.success) {
          addToast('✅ Permissões salvas com sucesso!');
          await loadUsersWithPermissions();
        } else {
          addToast(result.error || 'Erro ao salvar permissões', 'error');
        }
      } else {
        // Modo bulk
        const result = await saveBulkPermissions(selectedUsers, selectedPages);
        if (result.success) {
          addToast(
            `✅ Permissões salvas para ${selectedUsers.length} usuários!`,
          );
          await loadUsersWithPermissions();
        } else {
          addToast(
            result.error || 'Erro ao salvar permissões em massa',
            'error',
          );
        }
      }
    } catch (err) {
      addToast(err.message || 'Erro ao salvar permissões', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Copiar permissões de outro usuário
  const handleCopyPermissions = async () => {
    if (!copyFromUser || selectedUsers.length === 0) {
      addToast('Selecione usuário de origem e destino', 'error');
      return;
    }

    setSaving(true);

    try {
      for (const toUserId of selectedUsers) {
        await copyPermissions(copyFromUser, toUserId);
      }
      addToast('✅ Permissões copiadas com sucesso!');
      await loadUsersWithPermissions();
      setCopyFromUser('');
    } catch (err) {
      addToast(err.message || 'Erro ao copiar permissões', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Limpar permissões
  const handleClearPermissions = async () => {
    if (selectedUsers.length === 0) {
      addToast('Selecione pelo menos um usuário', 'error');
      return;
    }

    if (
      !confirm(
        `Tem certeza que deseja remover TODAS as permissões de ${selectedUsers.length} usuário(s)?`,
      )
    ) {
      return;
    }

    setSaving(true);

    try {
      for (const userId of selectedUsers) {
        await clearPermissions(userId);
      }
      addToast('✅ Permissões removidas com sucesso!');
      await loadUsersWithPermissions();
      setSelectedPages([]);
    } catch (err) {
      addToast(err.message || 'Erro ao limpar permissões', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Cores dos badges por role
  const getRoleBadgeColor = (role) => {
    const colors = {
      owner: 'bg-purple-100 text-purple-700 border-purple-300',
      admin: 'bg-red-100 text-red-700 border-red-300',
      manager: 'bg-orange-100 text-orange-700 border-orange-300',
      user: 'bg-blue-100 text-blue-700 border-blue-300',
      vendedor: 'bg-green-100 text-green-700 border-green-300',
      guest: 'bg-gray-100 text-gray-700 border-gray-300',
    };
    return colors[role] || colors.guest;
  };

  const getRoleLabel = (role) => {
    const labels = {
      owner: 'Proprietário',
      admin: 'Admin',
      manager: 'Gerente',
      user: 'Financeiro',
      vendedor: 'Vendedor',
      guest: 'Convidado',
    };
    return labels[role] || role;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <PageTitle
          title="Gerenciador de Acessos"
          icon={Shield}
          subtitle="Controle permissões de acesso dos usuários às páginas do sistema"
        />

        {/* Controles */}
        <Card className="mb-4 shadow-md">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              {/* Modo */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Modo de Seleção
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setMode('individual');
                      setSelectedUsers([]);
                      setSelectedPages([]);
                    }}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      mode === 'individual'
                        ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Individual
                  </button>
                  <button
                    onClick={() => {
                      setMode('bulk');
                      setSelectedUsers([]);
                      setSelectedPages([]);
                    }}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      mode === 'bulk'
                        ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Em Massa
                  </button>
                </div>
              </div>

              {/* Copiar de */}
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Copiar Permissões De
                </label>
                <select
                  value={copyFromUser}
                  onChange={(e) => setCopyFromUser(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Selecione um usuário</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} ({u.permissionsCount} páginas)
                    </option>
                  ))}
                </select>
              </div>

              {/* Ações */}
              <div className="flex items-end gap-2">
                {copyFromUser && (
                  <button
                    onClick={handleCopyPermissions}
                    disabled={saving || selectedUsers.length === 0}
                    className="flex-1 px-3 py-2 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg hover:from-purple-700 hover:to-purple-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 text-xs font-semibold shadow-md transition-all"
                  >
                    <Copy size={16} />
                    Copiar
                  </button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Layout principal */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Painel de Usuários */}
          <Card className="shadow-md">
            <CardHeader className="border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold text-gray-800 flex items-center gap-2">
                  <Users size={20} className="text-blue-600" />
                  Usuários ({filteredUsers.length})
                </CardTitle>
                <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-1 rounded-full">
                  {selectedUsers.length} selecionado(s)
                </span>
              </div>
            </CardHeader>

            <CardContent className="p-3">
              {/* Busca e filtros */}
              <div className="mb-3 space-y-2">
                <div className="relative">
                  <MagnifyingGlass
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    placeholder="Buscar por nome, email ou role..."
                    value={searchUser}
                    onChange={(e) => setSearchUser(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Filtro por Role */}
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Todos os perfis</option>
                  <option value="owner">👑 Proprietário</option>
                  <option value="admin">🔴 Admin</option>
                  <option value="manager">🟠 Gerente</option>
                  <option value="user">🔵 Financeiro</option>
                  <option value="vendedor">🟢 Vendedor</option>
                  <option value="guest">⚪ Convidado</option>
                </select>

                {/* Botões de seleção em massa (apenas no modo bulk) */}
                {mode === 'bulk' && filteredUsers.length > 0 && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleSelectAllUsers}
                      className="flex-1 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-xs font-semibold transition-colors"
                    >
                      ✓ Marcar Todos ({filteredUsers.length})
                    </button>
                    <button
                      onClick={handleDeselectAllUsers}
                      className="flex-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-xs font-semibold transition-colors"
                    >
                      ✗ Desmarcar Todos
                    </button>
                  </div>
                )}
              </div>

              {/* Lista de usuários */}
              {loading ? (
                <div className="flex justify-center py-8">
                  <LoadingSpinner />
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-2">
                  {filteredUsers.map((u) => {
                    const isSelected = selectedUsers.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        onClick={() => handleSelectUser(u.id)}
                        className={`w-full p-2.5 rounded-lg border transition-all text-left ${
                          isSelected
                            ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-300 shadow-sm'
                            : 'bg-white border-gray-200 hover:border-blue-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <div
                            className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                              isSelected
                                ? 'bg-blue-600 border-blue-600'
                                : 'border-gray-300'
                            }`}
                          >
                            {isSelected && (
                              <Check size={12} className="text-white" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <User
                                size={14}
                                className="text-gray-600 flex-shrink-0"
                              />
                              <p className="text-xs font-semibold text-gray-900 truncate">
                                {u.name}
                              </p>
                            </div>
                            <p className="text-xs text-gray-600 truncate mb-1">
                              {u.email}
                            </p>
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getRoleBadgeColor(
                                  u.role,
                                )}`}
                              >
                                {getRoleLabel(u.role)}
                              </span>
                              <span className="text-[10px] text-gray-500">
                                {u.permissionsCount} páginas
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Painel de Páginas */}
          <Card className="shadow-md">
            <CardHeader className="border-b border-gray-200 bg-gradient-to-r from-purple-50 to-pink-50 p-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold text-gray-800 flex items-center gap-2">
                  <Shield size={20} className="text-purple-600" />
                  Páginas Disponíveis
                </CardTitle>
                <span className="text-xs font-semibold text-purple-600 bg-purple-100 px-2 py-1 rounded-full">
                  {selectedPages.length} selecionada(s)
                </span>
              </div>
            </CardHeader>

            <CardContent className="p-3">
              {/* Info */}
              {mode === 'individual' && selectedUsers.length === 0 && (
                <div className="mb-3 p-2.5 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
                  <Info
                    size={16}
                    className="text-blue-600 flex-shrink-0 mt-0.5"
                  />
                  <p className="text-xs text-blue-800">
                    Selecione um usuário para visualizar/editar suas permissões
                  </p>
                </div>
              )}

              {/* Botões de seleção de páginas */}
              {selectedUsers.length > 0 && (
                <div className="mb-3 flex gap-2">
                  <button
                    onClick={handleSelectAllPages}
                    className="flex-1 px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-xs font-semibold transition-colors"
                  >
                    ✓ Marcar Todas ({AVAILABLE_PAGES.length})
                  </button>
                  <button
                    onClick={handleDeselectAllPages}
                    className="flex-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-xs font-semibold transition-colors"
                  >
                    ✗ Desmarcar Todas
                  </button>
                </div>
              )}

              {/* Páginas por categoria */}
              <div className="space-y-2 max-h-[550px] overflow-y-auto pr-2">
                {Object.entries(pagesByCategory).map(([category, pages]) => {
                  const allSelected = pages.every((p) =>
                    selectedPages.includes(p.path),
                  );
                  const someSelected = pages.some((p) =>
                    selectedPages.includes(p.path),
                  );

                  return (
                    <div
                      key={category}
                      className="bg-white border border-gray-200 rounded-lg p-2"
                    >
                      {/* Header da categoria */}
                      <button
                        onClick={() => handleSelectCategory(category)}
                        className="w-full flex items-center gap-2 mb-2 hover:bg-gray-50 rounded p-1.5 transition-colors"
                      >
                        <div
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                            allSelected
                              ? 'bg-purple-600 border-purple-600'
                              : someSelected
                                ? 'bg-purple-300 border-purple-300'
                                : 'border-gray-300'
                          }`}
                        >
                          {allSelected && (
                            <Check size={12} className="text-white" />
                          )}
                          {someSelected && !allSelected && (
                            <div className="w-2 h-2 bg-white rounded-sm" />
                          )}
                        </div>
                        <span className="text-xs font-bold text-gray-700">
                          {category}
                        </span>
                        <span className="text-[10px] text-gray-500 ml-auto">
                          {pages.length} páginas
                        </span>
                      </button>

                      {/* Lista de páginas */}
                      <div className="space-y-1 ml-6">
                        {pages.map((page) => {
                          const isSelected = selectedPages.includes(page.path);
                          return (
                            <button
                              key={page.path}
                              onClick={() => handleTogglePage(page.path)}
                              className={`w-full flex items-center gap-2 p-1.5 rounded text-left transition-colors ${
                                isSelected
                                  ? 'bg-purple-50 hover:bg-purple-100'
                                  : 'hover:bg-gray-50'
                              }`}
                            >
                              <div
                                className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                                  isSelected
                                    ? 'bg-purple-600 border-purple-600'
                                    : 'border-gray-300'
                                }`}
                              >
                                {isSelected && (
                                  <Check size={10} className="text-white" />
                                )}
                              </div>
                              <span
                                className={`text-xs ${
                                  isSelected
                                    ? 'font-semibold text-purple-900'
                                    : 'text-gray-700'
                                }`}
                              >
                                {page.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Botões de ação */}
              <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || selectedUsers.length === 0}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-bold shadow-md transition-all"
                >
                  {saving ? (
                    <>Salvando</>
                  ) : (
                    <>
                      <FloppyDisk size={18} />
                      Salvar Permissões
                    </>
                  )}
                </button>
                <button
                  onClick={handleClearPermissions}
                  disabled={saving || selectedUsers.length === 0}
                  className="px-4 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 text-white rounded-lg hover:from-red-700 hover:to-rose-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-bold shadow-md transition-all"
                >
                  <Trash size={18} />
                  Limpar
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`p-4 rounded-lg shadow-lg border flex items-center gap-3 max-w-sm transform transition-all duration-300 ease-in-out ${
              toast.type === 'error'
                ? 'bg-gradient-to-r from-red-50 to-rose-50 border-red-200 text-red-800'
                : 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200 text-green-800'
            }`}
          >
            {toast.type === 'error' ? (
              <XCircle size={20} className="text-red-600 flex-shrink-0" />
            ) : (
              <CheckCircle size={20} className="text-green-600 flex-shrink-0" />
            )}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GerenciadorAcessos;
