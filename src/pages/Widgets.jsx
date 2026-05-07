import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import PageTitle from '../components/ui/PageTitle';
import WidgetPreview from '../components/WidgetPreview';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/ui/Modal';
import { useDashboards } from '../hooks/useDashboards';
import { useWidgets } from '../hooks/useWidgets';
import { useWidgetAPI } from '../hooks/useWidgetAPI';
import {
  SquaresFour,
  ChartBar,
  Table as TableIcon,
  ChartPie,
  ChartLine,
  ArrowsOut,
  X as XIcon,
} from '@phosphor-icons/react';

const Widgets = () => {
  const { user } = useAuth();
  const [selectedDashboardId, setSelectedDashboardId] = useState(null);
  const [widgetsWithData, setWidgetsWithData] = useState([]);
  const [loadingWidgets, setLoadingWidgets] = useState(true);
  const [expandedWidget, setExpandedWidget] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Hooks do Supabase
  const { fetchUserDashboards } = useDashboards(user?.id);
  const { fetchUserWidgets } = useWidgets();
  const { executeQuery } = useWidgetAPI();

  const [userDashboards, setUserDashboards] = useState([]);

  // Buscar dashboards do usuário
  useEffect(() => {
    const loadUserDashboards = async () => {
      if (!user?.id) return;

      try {
        console.log('🔍 Buscando dashboards para usuário:', user.id);
        const dashboards = await fetchUserDashboards();
        console.log('📊 Dashboards encontrados:', dashboards);
        setUserDashboards(dashboards);
      } catch (error) {
        console.error('❌ Erro ao carregar dashboards:', error);
      }
    };

    loadUserDashboards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]); // fetchUserDashboards não muda, não precisa estar nas dependências

  // Buscar widgets e seus dados
  useEffect(() => {
    const loadWidgetsWithData = async () => {
      if (!user?.id || userDashboards.length === 0) {
        console.log('⏸️ Não carregando widgets:', {
          hasUser: !!user?.id,
          dashboardCount: userDashboards.length,
        });
        setLoadingWidgets(false);
        return;
      }

      setLoadingWidgets(true);

      try {
        console.log('🔍 Buscando widgets do usuário:', user.id);
        // Buscar widgets do usuário (já filtrados por RLS)
        const userWidgets = await fetchUserWidgets(user.id);
        console.log('✅ Widgets encontrados:', userWidgets.length);
        console.log('📋 Widgets:', userWidgets);

        // Carregar dados para cada widget
        const widgetsWithDataPromises = userWidgets.map(async (widget) => {
          try {
            console.log('🔍 Widget completo:', widget);
            console.log('📋 Config do widget:', widget.config);

            const dashboard = userDashboards.find(
              (d) => d.id === widget.dashboard_id,
            );

            console.log('🎯 Widget config ORIGINAL:', {
              id: widget.id,
              name: widget.name,
              type: widget.config.type,
              chartConfig: widget.config.chartConfig,
            });

            // Executar query do widget para obter os dados
            const queryResult = await executeQuery({
              viewName: widget.config.viewName || widget.view_name,
              columns: widget.config.selectedColumns || widget.config.columns,
              filters: widget.config.filters || [],
              aggregations: widget.config.aggregations || [],
              orderBy: widget.config.orderBy,
            });

            const widgetWithData = {
              id: widget.id,
              dashboardId: widget.dashboard_id,
              dashboardName: dashboard?.nome || dashboard?.name || 'Dashboard',
              config: {
                ...widget.config,
                nome: widget.name,
                data: queryResult.data || [],
                // Garantir que chartConfig está presente e completo
                chartConfig: widget.config.chartConfig || {
                  xAxis: '',
                  yAxis: [],
                  groupBy: '',
                  chartType: widget.config.type || 'bar',
                },
              },
              createdAt: widget.created_at,
            };

            console.log('✅ Widget PROCESSADO:', {
              id: widgetWithData.id,
              nome: widgetWithData.config.nome,
              type: widgetWithData.config.type,
              hasData: !!widgetWithData.config.data,
              dataLength: widgetWithData.config.data?.length,
              chartConfig: widgetWithData.config.chartConfig,
            });

            return widgetWithData;
          } catch (error) {
            console.error(
              `Erro ao carregar dados do widget ${widget.id}:`,
              error,
            );

            const dashboard = userDashboards.find(
              (d) => d.id === widget.dashboard_id,
            );

            // Retornar widget sem dados em caso de erro
            return {
              id: widget.id,
              dashboardId: widget.dashboard_id,
              dashboardName: dashboard?.nome || dashboard?.name || 'Dashboard',
              config: {
                ...widget.config,
                nome: widget.name,
                data: [],
                chartConfig: widget.config.chartConfig || {
                  xAxis: '',
                  yAxis: [],
                  groupBy: '',
                  chartType: widget.config.type || 'bar',
                },
              },
              createdAt: widget.created_at,
            };
          }
        });

        const loadedWidgets = await Promise.all(widgetsWithDataPromises);
        setWidgetsWithData(loadedWidgets);
      } catch (error) {
        console.error('Erro ao carregar widgets:', error);
      } finally {
        setLoadingWidgets(false);
      }
    };

    loadWidgetsWithData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, userDashboards]); // fetchWidgets e executeQuery não mudam, não precisam estar nas dependências

  // Filtrar widgets pelo dashboard selecionado
  const filteredWidgets = selectedDashboardId
    ? widgetsWithData.filter(
        (widget) => widget.dashboardId === selectedDashboardId,
      )
    : widgetsWithData;

  // Função para abrir widget em modal
  const handleExpandWidget = (widget) => {
    setExpandedWidget(widget);
    setIsModalOpen(true);
  };

  // Função para fechar modal
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setExpandedWidget(null);
  };

  // Ícone baseado no tipo de visualização
  const getVisualizationIcon = (type) => {
    switch (type) {
      case 'table':
        return <TableIcon size={20} weight="duotone" />;
      case 'bar':
        return <ChartBar size={20} weight="duotone" />;
      case 'pie':
        return <ChartPie size={20} weight="duotone" />;
      case 'line':
        return <ChartLine size={20} weight="duotone" />;
      default:
        return <SquaresFour size={20} weight="duotone" />;
    }
  };

  // Label do tipo de visualização
  const getVisualizationLabel = (type) => {
    switch (type) {
      case 'table':
        return 'Tabela';
      case 'bar':
        return 'Gráfico de Barras';
      case 'pie':
        return 'Gráfico de Pizza';
      case 'line':
        return 'Gráfico de Linhas';
      default:
        return type;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar - Navegação de Dashboards */}
      <aside className="w-72 bg-white border-r border-gray-200 overflow-y-auto">
        <div className="p-4 border-b border-gray-200 bg-[#000638]">
          <div className="flex items-center gap-2 text-white">
            <SquaresFour size={24} weight="bold" />
            <h2 className="text-lg font-bold">Dashboards</h2>
          </div>
          <p className="text-xs text-white/70 mt-1">Selecione um dashboard</p>
        </div>

        {/* Lista de Dashboards */}
        <div className="p-3">
          {loadingWidgets ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : userDashboards.length === 0 ? (
            <div className="text-center py-8">
              <SquaresFour size={48} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm text-gray-500">
                Nenhum dashboard encontrado
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {userDashboards.map((dashboard) => {
                const widgetCount = widgetsWithData.filter(
                  (w) => w.dashboardId === dashboard.id,
                ).length;
                const isSelected = selectedDashboardId === dashboard.id;

                // DEBUG: Verificar estrutura do dashboard
                console.log('📊 Dashboard na lista:', {
                  id: dashboard.id,
                  nome: dashboard.nome,
                  name: dashboard.name,
                  description: dashboard.description,
                  descricao: dashboard.descricao,
                  dashboard: dashboard,
                });

                return (
                  <button
                    key={dashboard.id}
                    onClick={() => setSelectedDashboardId(dashboard.id)}
                    className={`w-full text-left p-3 rounded-lg transition-all ${
                      isSelected
                        ? 'bg-[#000638] text-white shadow-md'
                        : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3
                          className={`text-sm font-semibold mb-1 ${
                            isSelected ? 'text-white' : 'text-[#000638]'
                          }`}
                        >
                          {dashboard.nome ||
                            dashboard.name ||
                            'Dashboard sem nome'}
                        </h3>
                        {(dashboard.descricao || dashboard.description) && (
                          <p
                            className={`text-xs line-clamp-2 ${
                              isSelected ? 'text-white/70' : 'text-gray-500'
                            }`}
                          >
                            {dashboard.descricao || dashboard.description}
                          </p>
                        )}
                      </div>
                      <span
                        className={`flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-[#000638]/10 text-[#000638]'
                        }`}
                      >
                        {widgetCount}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* Área Principal - Widgets */}
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-[#000638]">
                {selectedDashboardId
                  ? userDashboards.find((d) => d.id === selectedDashboardId)
                      ?.nome ||
                    userDashboards.find((d) => d.id === selectedDashboardId)
                      ?.name ||
                    'Widgets'
                  : 'Meus Widgets'}
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                {selectedDashboardId
                  ? `${filteredWidgets.length} widget(s) encontrado(s)`
                  : 'Selecione um dashboard para visualizar os widgets'}
              </p>
            </div>
            {filteredWidgets.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Total:</span>
                <span className="bg-[#000638] text-white text-xs font-bold px-3 py-1 rounded-full">
                  {filteredWidgets.length}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Conteúdo */}
        <div className="p-6">
          {!selectedDashboardId ? (
            <div className="flex items-center justify-center h-96">
              <div className="text-center">
                <SquaresFour size={64} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">
                  Selecione um Dashboard
                </h3>
                <p className="text-sm text-gray-500">
                  Escolha um dashboard na barra lateral para visualizar os
                  widgets
                </p>
              </div>
            </div>
          ) : filteredWidgets.length === 0 ? (
            <div className="flex items-center justify-center h-96">
              <div className="text-center">
                <SquaresFour size={64} className="mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">
                  Nenhum widget encontrado
                </h3>
                <p className="text-sm text-gray-500">
                  Este dashboard ainda não possui widgets configurados
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredWidgets.map((widget) => (
                <div
                  key={widget.id}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-all"
                >
                  {/* Header do Widget */}
                  <div className="bg-[#000638] px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="bg-white/10 p-1.5 rounded">
                          {getVisualizationIcon(widget.config.type)}
                        </div>
                        <div>
                          <h3 className="text-white font-semibold text-sm">
                            {widget.config.nome}
                          </h3>
                          <p className="text-white/60 text-xs">
                            {getVisualizationLabel(widget.config.type)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleExpandWidget(widget)}
                        className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition-colors text-xs font-semibold"
                        title="Expandir visualização"
                      >
                        <ArrowsOut size={14} weight="bold" />
                        Expandir
                      </button>
                    </div>
                  </div>

                  {/* Body do Widget - Preview */}
                  <div className="p-6">
                    {console.log('🎯 Widget sendo renderizado:', {
                      id: widget.id,
                      nome: widget.config.nome,
                      type: widget.config.type,
                      hasData: !!widget.config.data,
                      dataLength: widget.config.data?.length,
                      firstItem: widget.config.data?.[0],
                      chartConfig: widget.config.chartConfig,
                    })}
                    <WidgetPreview
                      type={widget.config.type}
                      data={widget.config.data}
                      config={widget.config}
                    />
                  </div>

                  {/* Footer do Widget */}
                  <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>
                        View:{' '}
                        <span className="font-semibold text-gray-700">
                          {widget.config.viewName || widget.config.view}
                        </span>
                      </span>
                      <span>
                        {new Date(widget.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Modal para Widget Expandido */}
      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={expandedWidget?.config.nome || 'Widget'}
        size="6xl"
      >
        {expandedWidget && (
          <div className="space-y-6">
            {/* Info do Widget */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="bg-[#000638]/10 p-2 rounded-lg">
                  {getVisualizationIcon(expandedWidget.config.type)}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#000638]">
                    {getVisualizationLabel(expandedWidget.config.type)}
                  </h3>
                  <p className="text-xs text-gray-500">
                    View:{' '}
                    {expandedWidget.config.viewName ||
                      expandedWidget.config.view}
                  </p>
                </div>
              </div>
              <span className="text-xs text-gray-500">
                Dashboard: {expandedWidget.dashboardName}
              </span>
            </div>

            {/* Widget Expandido */}
            <div className="min-h-[600px]">
              <WidgetPreview
                type={expandedWidget.config.type}
                data={expandedWidget.config.data}
                config={expandedWidget.config}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Widgets;
