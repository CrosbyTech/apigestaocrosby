import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import PageTitle from '../components/ui/PageTitle';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import WidgetModal from '../components/WidgetModal';
import LoadingSpinner from '../components/LoadingSpinner';
import { useDashboards } from '../hooks/useDashboards';
import { useWidgets } from '../hooks/useWidgets';
import { useSupabase } from '../hooks/useSupabase';
import {
  SquaresFour,
  Plus,
  PencilSimple,
  Trash,
  SquaresFour as WidgetIcon,
  Users,
  Check,
  X,
  CaretDown,
  CaretRight,
  ChartBar,
} from '@phosphor-icons/react';

const GerenciadorDashboards = () => {
  const { user } = useAuth();
  const { supabase } = useSupabase();
  const [usuariosDisponiveis, setUsuariosDisponiveis] = useState([]);

  // Hooks para Supabase
  const {
    dashboards,
    loading: dashboardsLoading,
    error: dashboardsError,
    createDashboard,
    updateDashboard,
    deleteDashboard,
    fetchDashboardsWithWidgetCount,
  } = useDashboards(user?.id);

  const { createWidget, fetchWidgets, updateWidget, deleteWidget } =
    useWidgets();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isWidgetModalOpen, setIsWidgetModalOpen] = useState(false);
  const [selectedDashboardForWidget, setSelectedDashboardForWidget] =
    useState(null);
  const [editingWidget, setEditingWidget] = useState(null);
  const [formData, setFormData] = useState({
    nome: '',
    descricao: '',
    usuarios: [],
  });
  const [editingDashboard, setEditingDashboard] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchUsuario, setSearchUsuario] = useState('');
  const [expandedDashboard, setExpandedDashboard] = useState(null);
  const [dashboardWidgets, setDashboardWidgets] = useState({});

  // Buscar usuários disponíveis do Supabase
  useEffect(() => {
    const fetchUsuarios = async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, name, email')
          .order('name');

        if (error) throw error;

        setUsuariosDisponiveis(
          data.map((u) => ({
            id: u.id,
            nome: u.name,
            email: u.email,
          })),
        );
      } catch (err) {
        console.error('Erro ao buscar usuários:', err);
      }
    };

    fetchUsuarios();
  }, [supabase]);

  const handleOpenModal = () => {
    setIsEditMode(false);
    setEditingDashboard(null);
    setFormData({ nome: '', descricao: '', usuarios: [] });
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setFormData({ nome: '', descricao: '', usuarios: [] });
    setEditingDashboard(null);
    setIsEditMode(false);
    setSearchUsuario('');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleUserToggle = (usuarioId) => {
    setFormData((prev) => {
      const usuarios = prev.usuarios.includes(usuarioId)
        ? prev.usuarios.filter((id) => id !== usuarioId)
        : [...prev.usuarios, usuarioId];
      return { ...prev, usuarios };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.nome.trim()) {
      alert('Por favor, insira um nome para o dashboard.');
      return;
    }

    if (formData.usuarios.length === 0) {
      alert('Por favor, selecione pelo menos um usuário.');
      return;
    }

    setSubmitting(true);

    try {
      if (isEditMode && editingDashboard) {
        // Editar dashboard existente
        await updateDashboard(editingDashboard.id, {
          nome: formData.nome,
          descricao: formData.descricao,
          usuarios: formData.usuarios,
        });
      } else {
        // Criar novo dashboard
        await createDashboard({
          nome: formData.nome,
          descricao: formData.descricao,
          usuarios: formData.usuarios,
        });
      }

      // Recarregar dashboards
      await fetchDashboardsWithWidgetCount();
      handleCloseModal();
    } catch (error) {
      console.error('Erro ao salvar dashboard:', error);
      alert('Erro ao salvar dashboard. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (dashboard) => {
    setIsEditMode(true);
    setEditingDashboard(dashboard);
    setFormData({
      nome: dashboard.nome || dashboard.name || '',
      descricao: dashboard.descricao || dashboard.description || '',
      usuarios: dashboard.usuarios || dashboard.user_ids || [],
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm('Tem certeza que deseja apagar este dashboard?')) {
      try {
        await deleteDashboard(id);
        await fetchDashboardsWithWidgetCount();
      } catch (error) {
        console.error('Erro ao deletar dashboard:', error);
        alert('Erro ao deletar dashboard. Tente novamente.');
      }
    }
  };

  const handleAddWidget = (dashboard) => {
    setSelectedDashboardForWidget(dashboard);
    setEditingWidget(null);
    setIsWidgetModalOpen(true);
  };

  const handleEditWidget = (dashboard, widget) => {
    setSelectedDashboardForWidget(dashboard);
    setEditingWidget(widget);
    setIsWidgetModalOpen(true);
  };

  const toggleDashboardWidgets = async (dashboardId) => {
    if (expandedDashboard === dashboardId) {
      setExpandedDashboard(null);
    } else {
      setExpandedDashboard(dashboardId);
      // Carregar widgets se ainda não foram carregados
      if (!dashboardWidgets[dashboardId]) {
        const widgets = await fetchWidgets(dashboardId);
        setDashboardWidgets((prev) => ({
          ...prev,
          [dashboardId]: widgets,
        }));
      }
    }
  };

  const handleDeleteWidget = async (widgetId, dashboardId) => {
    if (window.confirm('Tem certeza que deseja excluir este widget?')) {
      try {
        await deleteWidget(widgetId);
        // Atualizar lista de widgets localmente
        setDashboardWidgets((prev) => ({
          ...prev,
          [dashboardId]: prev[dashboardId].filter((w) => w.id !== widgetId),
        }));
        // Atualizar contador de widgets
        await fetchDashboardsWithWidgetCount();
      } catch (error) {
        console.error('Erro ao deletar widget:', error);
        alert('Erro ao deletar widget. Tente novamente.');
      }
    }
  };

  const handleSaveWidget = async (widgetConfig) => {
    try {
      console.log('💾 Salvando widget com config:', widgetConfig);

      if (editingWidget) {
        // Editar widget existente
        await updateWidget(editingWidget.id, {
          nome: widgetConfig.config?.nome || widgetConfig.nome,
          view_name: widgetConfig.config?.viewName || widgetConfig.viewName,
          config: widgetConfig.config || widgetConfig,
        });

        // Atualizar lista local de widgets
        if (dashboardWidgets[selectedDashboardForWidget.id]) {
          setDashboardWidgets((prev) => ({
            ...prev,
            [selectedDashboardForWidget.id]: prev[
              selectedDashboardForWidget.id
            ].map((w) =>
              w.id === editingWidget.id
                ? {
                    ...w,
                    nome: widgetConfig.config?.nome || widgetConfig.nome,
                    view_name:
                      widgetConfig.config?.viewName || widgetConfig.viewName,
                    config: widgetConfig.config || widgetConfig,
                  }
                : w,
            ),
          }));
        }
      } else {
        // Criar novo widget
        const result = await createWidget(
          {
            dashboard_id: selectedDashboardForWidget.id,
            name: widgetConfig.config?.nome || widgetConfig.nome,
            view_name: widgetConfig.config?.viewName || widgetConfig.viewName,
            config: widgetConfig.config || widgetConfig,
          },
          user?.id,
        );

        // Adicionar à lista local se o dashboard está expandido
        if (result.success && dashboardWidgets[selectedDashboardForWidget.id]) {
          setDashboardWidgets((prev) => ({
            ...prev,
            [selectedDashboardForWidget.id]: [
              result.data,
              ...(prev[selectedDashboardForWidget.id] || []),
            ],
          }));
        }
      }

      // Recarregar dashboards para atualizar contador de widgets
      await fetchDashboardsWithWidgetCount();

      setIsWidgetModalOpen(false);
      setSelectedDashboardForWidget(null);
      setEditingWidget(null);
    } catch (error) {
      console.error('Erro ao salvar widget:', error);
      alert('Erro ao salvar widget. Tente novamente.');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <PageTitle title="Gerenciador de Dashboards" icon={SquaresFour} />
        <p className="text-gray-600 mt-2">
          Crie e gerencie dashboards personalizados para os usuários
        </p>
      </div>

      {/* Botão Novo Dashboard */}
      <div className="mb-6 flex justify-end">
        <Button
          variant="primary"
          size="md"
          leftIcon={<Plus size={20} weight="bold" />}
          onClick={handleOpenModal}
        >
          Novo Dashboard
        </Button>
      </div>

      {/* Tabela de Dashboards */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {dashboardsLoading ? (
          <div className="flex justify-center items-center py-12">
            <LoadingSpinner />
          </div>
        ) : dashboardsError ? (
          <div className="px-6 py-12 text-center text-red-500">
            <p className="text-lg font-medium">Erro ao carregar dashboards</p>
            <p className="text-sm mt-1">{dashboardsError.message}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Nome
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Descrição
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="flex items-center justify-center gap-1">
                      <Users size={16} />
                      <span>Usuários</span>
                    </div>
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="flex items-center justify-center gap-1">
                      <Check size={16} />
                      <span>Widgets</span>
                    </div>
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {dashboards.length === 0 ? (
                  <tr>
                    <td
                      colSpan="6"
                      className="px-6 py-12 text-center text-gray-500"
                    >
                      <SquaresFour
                        size={48}
                        className="mx-auto mb-3 text-gray-300"
                      />
                      <p className="text-lg font-medium">
                        Nenhum dashboard criado
                      </p>
                      <p className="text-sm mt-1">
                        Clique em "Novo Dashboard" para começar
                      </p>
                    </td>
                  </tr>
                ) : (
                  dashboards.map((dashboard) => (
                    <React.Fragment key={dashboard.id}>
                      <tr className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          <button
                            type="button"
                            onClick={() => toggleDashboardWidgets(dashboard.id)}
                            className="flex text-xs items-center gap-2 text-gray-600 hover:text-blue-600"
                          >
                            {expandedDashboard === dashboard.id ? (
                              <CaretDown size={16} weight="bold" />
                            ) : (
                              <CaretRight size={16} weight="bold" />
                            )}
                            <span>#{dashboard.id}</span>
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <SquaresFour
                              size={20}
                              className="text-blue-600 mr-2"
                              weight="duotone"
                            />
                            <span className="text-sm font-medium text-gray-900">
                              {dashboard.nome || dashboard.name || 'Sem nome'}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {dashboard.descricao ||
                            dashboard.description ||
                            'Sem descrição'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-[#000638]/10 text-[#000638]">
                            {dashboard.usuarios?.length || 0}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                            {dashboard.widget_count || 0}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleEdit(dashboard)}
                              className="inline-flex items-center p-1.5 text-[#000638] hover:bg-[#000638]/10 rounded-lg transition-colors"
                              title="Editar"
                            >
                              <PencilSimple size={16} weight="bold" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddWidget(dashboard)}
                              className="inline-flex items-center p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              title="Adicionar Widget"
                            >
                              <WidgetIcon size={16} weight="bold" />
                            </button>
                            <button
                              onClick={() => handleDelete(dashboard.id)}
                              className="inline-flex items-center p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Excluir"
                            >
                              <Trash size={18} weight="bold" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Linha Expandida com Widgets */}
                      {expandedDashboard === dashboard.id && (
                        <tr className="bg-gray-50">
                          <td colSpan="6" className="px-6 py-4">
                            <div className="ml-8">
                              <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                                <ChartBar size={18} className="text-blue-600" />
                                Widgets deste Dashboard
                              </h4>
                              {dashboardWidgets[dashboard.id]?.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {dashboardWidgets[dashboard.id].map(
                                    (widget) => (
                                      <div
                                        key={widget.id}
                                        className="bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow"
                                      >
                                        <div className="flex items-start justify-between">
                                          <div className="flex-1">
                                            <h5 className="font-medium text-gray-900">
                                              {widget.nome || 'Widget sem nome'}
                                            </h5>
                                            <p className="text-xs text-gray-500 mt-1">
                                              View: {widget.view_name}
                                            </p>
                                            <p className="text-xs text-gray-400">
                                              Tipo:{' '}
                                              {widget.config?.type || 'table'}
                                            </p>
                                          </div>
                                          <div className="flex gap-1">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleEditWidget(
                                                  dashboard,
                                                  widget,
                                                )
                                              }
                                              className="p-1 text-[#000638] hover:bg-[#000638]/10 rounded transition-colors"
                                              title="Editar Widget"
                                            >
                                              <PencilSimple
                                                size={14}
                                                weight="bold"
                                              />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleDeleteWidget(
                                                  widget.id,
                                                  dashboard.id,
                                                )
                                              }
                                              className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                                              title="Excluir Widget"
                                            >
                                              <Trash size={16} weight="bold" />
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    ),
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500 italic">
                                  Nenhum widget criado ainda. Clique em
                                  "Adicionar Widget" para começar.
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Criar/Editar Dashboard */}
      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={isEditMode ? 'Editar Dashboard' : 'Novo Dashboard'}
        size="2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="nome"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Nome do Dashboard *
            </label>
            <input
              type="text"
              id="nome"
              name="nome"
              value={formData.nome}
              onChange={handleInputChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ex: Dashboard Financeiro"
            />
          </div>

          <div>
            <label
              htmlFor="descricao"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Descrição *
            </label>
            <textarea
              id="descricao"
              name="descricao"
              value={formData.descricao}
              onChange={handleInputChange}
              required
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="Descreva o propósito deste dashboard..."
            />
          </div>

          {/* Seleção de Usuários - Dropdown Multi-Select */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Selecione os Usuários que Visualizarão este Dashboard *
            </label>

            {/* Usuários Selecionados (Tags) */}
            {formData.usuarios.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {formData.usuarios.map((usuarioId) => {
                  const usuario = usuariosDisponiveis.find(
                    (u) => u.id === usuarioId,
                  );
                  return (
                    <span
                      key={usuarioId}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#000638]/10 text-[#000638] rounded-full text-xs font-semibold"
                    >
                      <Users size={12} weight="bold" />
                      <span>{usuario?.nome || 'Usuário'}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUserToggle(usuarioId);
                        }}
                        className="ml-0.5 hover:bg-[#000638]/20 rounded-full p-0.5 transition-colors"
                      >
                        <X size={12} weight="bold" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Input de Busca */}
            <div className="mb-2">
              <input
                type="text"
                value={searchUsuario}
                onChange={(e) => {
                  e.stopPropagation();
                  setSearchUsuario(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="🔍 Buscar por nome ou email..."
                className="w-full border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>

            {/* Dropdown de Seleção */}
            <div className="relative">
              <div className="border border-[#000638]/20 rounded-lg overflow-hidden focus-within:border-[#000638] transition-colors">
                <div className="bg-white max-h-40 overflow-y-auto">
                  {(() => {
                    const usuariosFiltrados = usuariosDisponiveis.filter(
                      (usuario) => {
                        const searchLower = searchUsuario.toLowerCase();
                        return (
                          usuario.nome.toLowerCase().includes(searchLower) ||
                          usuario.email.toLowerCase().includes(searchLower)
                        );
                      },
                    );

                    if (usuariosFiltrados.length === 0) {
                      return (
                        <div className="px-4 py-8 text-center text-gray-500">
                          <Users
                            size={32}
                            className="mx-auto mb-2 text-gray-300"
                          />
                          <p className="text-sm">Nenhum usuário encontrado</p>
                          <p className="text-xs mt-1">
                            Tente buscar por outro nome ou email
                          </p>
                        </div>
                      );
                    }

                    return usuariosFiltrados.map((usuario) => {
                      const isSelected = formData.usuarios.includes(usuario.id);
                      return (
                        <button
                          key={usuario.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUserToggle(usuario.id);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 transition-all border-b border-gray-100 last:border-b-0 text-xs ${
                            isSelected
                              ? 'bg-[#000638]/5 hover:bg-[#000638]/10'
                              : 'bg-white hover:bg-gray-50'
                          }`}
                        >
                          {/* Checkbox */}
                          <div
                            className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                              isSelected
                                ? 'bg-[#000638] border-[#000638]'
                                : 'border-gray-300'
                            }`}
                          >
                            {isSelected && (
                              <Check
                                size={12}
                                className="text-white"
                                weight="bold"
                              />
                            )}
                          </div>

                          {/* Avatar */}
                          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-[#000638] to-[#000638]/80 flex items-center justify-center text-white font-bold text-xs">
                            {usuario.nome.charAt(0).toUpperCase()}
                          </div>

                          {/* Info do Usuário */}
                          <div className="flex-1 text-left">
                            <p
                              className={`font-semibold text-xs ${
                                isSelected ? 'text-[#000638]' : 'text-gray-900'
                              }`}
                            >
                              {usuario.nome}
                            </p>
                            <p className="text-[10px] text-gray-500">
                              {usuario.email}
                            </p>
                          </div>

                          {/* Indicador de Selecionado */}
                          {isSelected && (
                            <div className="flex-shrink-0">
                              <Check
                                size={20}
                                className="text-blue-600"
                                weight="bold"
                              />
                            </div>
                          )}
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>

            {/* Contador e Mensagem */}
            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                {formData.usuarios.length > 0 ? (
                  <span className="font-medium text-blue-600">
                    {formData.usuarios.length} usuário(s) selecionado(s)
                  </span>
                ) : (
                  <span className="text-red-600">
                    Selecione pelo menos um usuário
                  </span>
                )}
              </p>
              {formData.usuarios.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, usuarios: [] }))
                  }
                  className="text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  Limpar todos
                </button>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCloseModal}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={formData.usuarios.length === 0 || submitting}
            >
              {submitting
                ? 'Salvando...'
                : isEditMode
                ? 'Salvar Alterações'
                : 'Criar Dashboard'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Criar Widget */}
      <WidgetModal
        isOpen={isWidgetModalOpen}
        onClose={() => {
          setIsWidgetModalOpen(false);
          setSelectedDashboardForWidget(null);
        }}
        onSave={handleSaveWidget}
      />
    </div>
  );
};

export default GerenciadorDashboards;
