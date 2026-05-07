import React, { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import WidgetPreview from './WidgetPreview';
import LoadingSpinner from './LoadingSpinner';
import { useWidgetAPI } from '../hooks/useWidgetAPI';
import {
  Plus,
  Trash,
  Eye,
  Database,
  Funnel,
  ChartBar,
  Check,
  X as XIcon,
} from '@phosphor-icons/react';
import {
  OPERATORS_LIST,
  AGGREGATION_FUNCTIONS_LIST,
  WIDGET_TYPES_LIST,
  operatorRequiresValue,
  operatorRequiresTwoValues,
  operatorAcceptsMultipleValues,
  validateFilter,
  formatFilterForDisplay,
} from '../utils/widgetValidators';

const WidgetModal = ({ isOpen, onClose, onSave, editingWidget = null }) => {
  const { fetchViews, fetchViewColumns, executeQuery, validateQuery } =
    useWidgetAPI();

  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [availableViews, setAvailableViews] = useState([]);
  const [availableColumns, setAvailableColumns] = useState([]);

  const [widgetConfig, setWidgetConfig] = useState({
    nome: '',
    name: '',
    viewName: '',
    selectedColumns: [],
    filters: [],
    aggregations: [],
    orderBy: { column: '', direction: 'ASC' },
    type: 'table',
    chartConfig: {
      // Configurações de gráfico
      title: '',
      subtitle: '',
      xAxis: '',
      yAxis: [],
      groupBy: '',
      colorScheme: 'default',
      showLegend: true,
      showDataLabels: false,
      showGrid: true,
      chartType: 'bar', // bar, line, pie, area, scatter
      stacked: false,
      horizontal: false,
      calculations: [],
      customColors: {},
    },
  });

  const [newFilter, setNewFilter] = useState({
    column: '',
    operator: '',
    value: '',
    value2: '',
    values: [],
  });

  const [previewData, setPreviewData] = useState([]);
  const [previewError, setPreviewError] = useState(null);

  // Carregar views disponíveis ao abrir modal
  useEffect(() => {
    const loadViews = async () => {
      if (!isOpen) return;

      setLoading(true);
      try {
        const views = await fetchViews();
        setAvailableViews(views);
      } catch (error) {
        console.error('Erro ao carregar views:', error);
        // Fallback para views mockadas se houver erro
        setAvailableViews([
          { name: 'vw_vendas', label: 'View de Vendas' },
          { name: 'vw_financeiro', label: 'View Financeira' },
          { name: 'vw_estoque', label: 'View de Estoque' },
        ]);
      } finally {
        setLoading(false);
      }
    };

    loadViews();
  }, [isOpen, fetchViews]);

  // Carregar dados de edição
  useEffect(() => {
    if (editingWidget) {
      // Garantir que todos os campos tenham valores padrão para evitar inputs não controlados
      setWidgetConfig({
        nome: editingWidget.config.nome || '',
        name: editingWidget.config.name || '',
        viewName: editingWidget.config.viewName || '',
        selectedColumns: editingWidget.config.selectedColumns || [],
        filters: editingWidget.config.filters || [],
        aggregations: editingWidget.config.aggregations || [],
        orderBy: editingWidget.config.orderBy || {
          column: '',
          direction: 'ASC',
        },
        type: editingWidget.config.type || 'table',
        chartConfig: editingWidget.config.chartConfig || {
          title: '',
          subtitle: '',
          xAxis: '',
          yAxis: [],
          groupBy: '',
          colorScheme: 'default',
          showLegend: true,
          showDataLabels: false,
          showGrid: true,
          chartType: 'bar',
          stacked: false,
          horizontal: false,
          calculations: [],
          customColors: {},
        },
      });
      generatePreview(editingWidget.config);
    } else {
      resetConfig();
    }
  }, [editingWidget, isOpen]);

  const resetConfig = () => {
    setWidgetConfig({
      nome: '',
      name: '',
      viewName: '',
      selectedColumns: [],
      filters: [],
      aggregations: [],
      orderBy: { column: '', direction: 'ASC' },
      type: 'table',
      chartConfig: {
        title: '',
        subtitle: '',
        xAxis: '',
        yAxis: [],
        groupBy: '',
        colorScheme: 'default',
        showLegend: true,
        showDataLabels: false,
        showGrid: true,
        chartType: 'bar',
        stacked: false,
        horizontal: false,
        calculations: [],
        customColors: {},
      },
    });
    setCurrentStep(1);
    setPreviewData([]);
    setPreviewError(null);
    setAvailableColumns([]);
  };

  const handleViewSelect = async (viewName) => {
    setWidgetConfig((prev) => ({
      ...prev,
      viewName,
      selectedColumns: [],
      filters: [],
      aggregations: [],
    }));

    // Carregar colunas da view selecionada
    setLoading(true);
    try {
      const columns = await fetchViewColumns(viewName);
      setAvailableColumns(columns);
    } catch (error) {
      console.error('Erro ao carregar colunas:', error);
      setAvailableColumns([]);
    } finally {
      setLoading(false);
    }
  };

  const handleColumnToggle = (column) => {
    setWidgetConfig((prev) => {
      const isSelected = prev.selectedColumns.includes(column);
      return {
        ...prev,
        selectedColumns: isSelected
          ? prev.selectedColumns.filter((c) => c !== column)
          : [...prev.selectedColumns, column],
      };
    });
  };

  const handleAddFilter = () => {
    const validation = validateFilter(newFilter);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    setWidgetConfig((prev) => ({
      ...prev,
      filters: [...prev.filters, { ...newFilter, id: Date.now() }],
    }));

    setNewFilter({
      column: '',
      operator: '',
      value: '',
      value2: '',
      values: [],
    });
  };

  const handleRemoveFilter = (filterId) => {
    setWidgetConfig((prev) => ({
      ...prev,
      filters: prev.filters.filter((f) => f.id !== filterId),
    }));
  };

  const handleAddAggregation = (column, func) => {
    setWidgetConfig((prev) => {
      const existing = prev.aggregations.find((a) => a.column === column);
      if (existing) {
        return {
          ...prev,
          aggregations: prev.aggregations.map((a) =>
            a.column === column ? { ...a, function: func } : a,
          ),
        };
      }
      return {
        ...prev,
        aggregations: [...prev.aggregations, { column, function: func }],
      };
    });
  };

  const handleRemoveAggregation = (column) => {
    setWidgetConfig((prev) => ({
      ...prev,
      aggregations: prev.aggregations.filter((a) => a.column !== column),
    }));
  };

  const generatePreview = async (config = widgetConfig) => {
    if (config.selectedColumns.length === 0 || !config.viewName) {
      setPreviewData([]);
      setPreviewError(null);
      return;
    }

    setLoading(true);
    setPreviewError(null);

    try {
      // Filtrar apenas filtros válidos (com coluna e operador preenchidos)
      const validFilters = config.filters.filter((f) => f.column && f.operator);

      const result = await executeQuery({
        viewName: config.viewName,
        columns: config.selectedColumns,
        filters: validFilters,
        aggregations: config.aggregations,
        orderBy: config.orderBy,
      });

      console.log('📊 Preview gerado com chartConfig:', {
        chartType: config.chartConfig.chartType,
        xAxis: config.chartConfig.xAxis,
        yAxis: config.chartConfig.yAxis,
        dataLength: result.data?.length,
      });

      setPreviewData(result.data || []);
    } catch (error) {
      console.error('Erro ao gerar preview:', error);
      setPreviewError('Erro ao carregar dados de preview');
      setPreviewData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWidget = () => {
    if (!widgetConfig.nome.trim()) {
      alert('Digite um nome para o widget');
      return;
    }

    if (!widgetConfig.viewName) {
      alert('Selecione uma view');
      return;
    }

    if (widgetConfig.selectedColumns.length === 0) {
      alert('Selecione pelo menos uma coluna');
      return;
    }

    // Filtrar apenas filtros válidos antes de salvar
    const validFilters = widgetConfig.filters.filter(
      (f) => f.column && f.operator,
    );

    const widget = {
      id: editingWidget?.id || Date.now(),
      config: {
        ...widgetConfig,
        filters: validFilters, // Salva apenas filtros válidos
      },
      createdAt: editingWidget?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSave(widget);
    onClose();
    resetConfig();
  };

  const selectedView = availableViews.find(
    (v) => v.name === widgetConfig.viewName,
  );

  const steps = [
    { number: 1, title: 'View & Colunas' },
    { number: 2, title: 'Filtros' },
    { number: 3, title: 'Agregações & Ordem' },
    { number: 4, title: 'Visualização' },
    { number: 5, title: 'Preview & Salvar' },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        resetConfig();
      }}
      title={editingWidget ? 'Editar Widget' : 'Novo Widget'}
      size="6xl"
    >
      <div className="space-y-6">
        {/* Stepper */}
        <div className="flex items-center justify-between mb-4">
          {steps.map((step, index) => (
            <React.Fragment key={step.number}>
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setCurrentStep(step.number)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    currentStep === step.number
                      ? 'bg-[#000638] text-white shadow-md'
                      : currentStep > step.number
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {currentStep > step.number ? (
                    <Check size={14} weight="bold" />
                  ) : (
                    step.number
                  )}
                </button>
                <span
                  className={`text-[10px] mt-0.5 ${
                    currentStep === step.number
                      ? 'font-bold text-[#000638]'
                      : 'text-gray-500'
                  }`}
                >
                  {step.title}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-1 ${
                    currentStep > step.number ? 'bg-green-500' : 'bg-gray-200'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Nome do Widget (sempre visível) */}
        <div>
          <label className="block text-xs font-semibold mb-1 text-[#000638]">
            Nome do Widget *
          </label>
          <input
            type="text"
            value={widgetConfig.nome}
            onChange={(e) =>
              setWidgetConfig((prev) => ({ ...prev, nome: e.target.value }))
            }
            className="w-full border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
            placeholder="Ex: Vendas por Produto"
          />
        </div>

        {/* Step 1: View & Colunas */}
        {currentStep === 1 && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-[#000638] flex items-center gap-1.5">
                <Database size={14} />
                Selecione a View *
              </label>
              {loading ? (
                <div className="flex justify-center py-6">
                  <LoadingSpinner />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {availableViews.map((view) => (
                    <button
                      type="button"
                      key={view.name}
                      onClick={() => handleViewSelect(view.name)}
                      className={`p-2.5 border-2 rounded-lg text-left transition-all ${
                        widgetConfig.viewName === view.name
                          ? 'border-[#000638] bg-[#000638]/5'
                          : 'border-gray-200 hover:border-[#000638]/30'
                      }`}
                    >
                      <p className="font-semibold text-xs text-[#000638]">
                        {view.label || view.name}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {view.name}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {widgetConfig.viewName && availableColumns.length > 0 && (
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-[#000638]">
                  Selecione as Colunas * ({widgetConfig.selectedColumns.length}{' '}
                  selecionadas)
                </label>
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 border border-[#000638]/20 rounded-lg bg-[#f8f9fb]">
                  {availableColumns.map((column) => (
                    <button
                      type="button"
                      key={column.name}
                      onClick={() => handleColumnToggle(column.name)}
                      className={`p-1.5 border-2 rounded-lg text-xs transition-all ${
                        widgetConfig.selectedColumns.includes(column.name)
                          ? 'border-[#000638] bg-[#000638]/5 text-[#000638] font-semibold'
                          : 'border-gray-200 hover:border-[#000638]/30 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <div
                          className={`w-3 h-3 rounded border-2 flex items-center justify-center ${
                            widgetConfig.selectedColumns.includes(column.name)
                              ? 'bg-[#000638] border-[#000638]'
                              : 'border-gray-300'
                          }`}
                        >
                          {widgetConfig.selectedColumns.includes(
                            column.name,
                          ) && (
                            <Check
                              size={10}
                              className="text-white"
                              weight="bold"
                            />
                          )}
                        </div>
                        <span className="truncate">{column.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Filtros */}
        {currentStep === 2 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Funnel size={12} />
              <h3 className="text-xs font-semibold text-[#000638]">
                Adicionar Filtros WHERE
              </h3>
            </div>

            {/* Lista de filtros existentes */}
            {widgetConfig.filters.length > 0 && (
              <div className="space-y-1.5 mb-3">
                <p className="text-xs font-semibold text-gray-700">
                  Filtros Aplicados:
                </p>
                {widgetConfig.filters.map((filter) => (
                  <div
                    key={filter.id}
                    className="flex items-center justify-between p-2 bg-[#000638]/5 border border-[#000638]/20 rounded-lg"
                  >
                    <span className="text-[10px] text-[#000638] font-mono">
                      {formatFilterForDisplay(filter)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFilter(filter.id)}
                      className="text-red-600 hover:text-red-800 p-0.5"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Adicionar novo filtro */}
            {widgetConfig.viewName && availableColumns.length > 0 && (
              <div className="grid  border border-[#000638]/20 rounded-lg p-2.5 bg-[#f8f9fb] ">
                <p className="text-[10px] mb-2 font-semibold text-gray-600">
                  Novo Filtro:
                </p>
                <div className="grid grid-cols-12 gap-2 p-2.5 border-2 rounded-lg text-left transition-all">
                  {/* Coluna */}
                  <select
                    value={newFilter.column}
                    onChange={(e) =>
                      setNewFilter((prev) => ({
                        ...prev,
                        column: e.target.value,
                      }))
                    }
                    className="w-30 h-7 col-span-3 border border-[#000638]/30 rounded-lg  focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] text-xs"
                  >
                    <option value="">Coluna...</option>
                    {availableColumns.map((col) => (
                      <option key={col.name} value={col.name}>
                        {col.name}
                      </option>
                    ))}
                  </select>

                  {/* Operador */}
                  <select
                    value={newFilter.operator}
                    onChange={(e) =>
                      setNewFilter((prev) => ({
                        ...prev,
                        operator: e.target.value,
                      }))
                    }
                    className="w-30 h-7 col-span-3 border border-[#000638]/30 rounded-lg  focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] text-xs"
                  >
                    <option value="">Operador...</option>
                    {OPERATORS_LIST.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label} ({op.symbol})
                      </option>
                    ))}
                  </select>

                  {/* Valor(es) */}
                  {operatorRequiresValue(newFilter.operator) && (
                    <>
                      {operatorRequiresTwoValues(newFilter.operator) ? (
                        <>
                          <input
                            type="text"
                            value={newFilter.value}
                            onChange={(e) =>
                              setNewFilter((prev) => ({
                                ...prev,
                                value: e.target.value,
                              }))
                            }
                            placeholder="Valor 1"
                            className="col-span-3 border border-[#000638]/30 rounded-lg  focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] text-xs"
                          />
                          <input
                            type="text"
                            value={newFilter.value2}
                            onChange={(e) =>
                              setNewFilter((prev) => ({
                                ...prev,
                                value2: e.target.value,
                              }))
                            }
                            placeholder="Valor 2"
                            className="col-span-2 border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
                          />
                        </>
                      ) : (
                        <input
                          type="text"
                          value={newFilter.value}
                          onChange={(e) =>
                            setNewFilter((prev) => ({
                              ...prev,
                              value: e.target.value,
                            }))
                          }
                          placeholder="Valor"
                          className="col-span-4 border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
                        />
                      )}
                    </>
                  )}

                  {/* Botão Adicionar */}
                  <button
                    type="button"
                    onClick={handleAddFilter}
                    className="col-span-2 px-3 py-1 bg-[#000638] text-white rounded-lg hover:bg-[#fe0000] transition-colors flex items-center justify-center gap-1.5 text-xs font-semibold h-7"
                  >
                    <Plus size={14} weight="bold" />
                    Adicionar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Agregações & Ordem */}
        {currentStep === 3 && (
          <div className="space-y-3">
            {/* Agregações */}
            <div>
              <h3 className="text-xs font-semibold mb-2 text-[#000638]">
                Funções de Agregação (Opcional)
              </h3>
              <div className="space-y-1.5">
                {widgetConfig.selectedColumns.map((column) => {
                  const agg = widgetConfig.aggregations.find(
                    (a) => a.column === column,
                  );
                  return (
                    <div
                      key={column}
                      className="flex items-center gap-2 p-1.5 border border-[#000638]/20 rounded-lg"
                    >
                      <span className="text-xs font-medium w-28 truncate text-[#000638]">
                        {column}
                      </span>
                      <select
                        value={agg?.function || ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            handleAddAggregation(column, e.target.value);
                          } else {
                            handleRemoveAggregation(column);
                          }
                        }}
                        className="flex-1 border border-[#000638]/30 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] text-xs"
                      >
                        <option value="">Sem agregação</option>
                        {AGGREGATION_FUNCTIONS_LIST.map((func) => (
                          <option key={func.value} value={func.value}>
                            {func.label} ({func.value})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Order By */}
            <div>
              <h3 className="text-xs font-semibold mb-2 text-[#000638]">
                Ordenação (Opcional)
              </h3>
              <div className="flex gap-2">
                <select
                  value={widgetConfig.orderBy.column}
                  onChange={(e) =>
                    setWidgetConfig((prev) => ({
                      ...prev,
                      orderBy: { ...prev.orderBy, column: e.target.value },
                    }))
                  }
                  className="flex-1 border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                >
                  <option value="">Selecione uma coluna...</option>
                  {widgetConfig.selectedColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
                <select
                  value={widgetConfig.orderBy.direction}
                  onChange={(e) =>
                    setWidgetConfig((prev) => ({
                      ...prev,
                      orderBy: { ...prev.orderBy, direction: e.target.value },
                    }))
                  }
                  className="w-32 border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                >
                  <option value="ASC">Crescente (A-Z)</option>
                  <option value="DESC">Decrescente (Z-A)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Tipo de Visualização e Configurações */}
        {currentStep === 4 && (
          <div className="space-y-3">
            {/* Escolha do Tipo */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <ChartBar size={14} />
                <h3 className="text-xs font-semibold text-[#000638]">
                  Escolha o Tipo de Visualização *
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {WIDGET_TYPES_LIST.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() =>
                      setWidgetConfig((prev) => ({ ...prev, type: type.value }))
                    }
                    className={`p-3 border-2 rounded-lg transition-all ${
                      widgetConfig.type === type.value
                        ? 'border-[#000638] bg-[#000638]/5'
                        : 'border-gray-200 hover:border-[#000638]/30'
                    }`}
                  >
                    <div className="text-2xl mb-1">{type.icon}</div>
                    <p className="font-semibold text-xs text-[#000638]">
                      {type.label}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Configurações de Gráfico (se não for tabela) */}
            {widgetConfig.type !== 'table' && (
              <div className="border-t border-gray-200 pt-3 space-y-3">
                <h3 className="text-xs font-semibold text-[#000638] flex items-center gap-1.5">
                  <ChartBar size={14} className="text-[#000638]" />
                  Configurações do Gráfico
                </h3>

                {/* Títulos */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-[#000638]">
                      Título do Gráfico
                    </label>
                    <input
                      type="text"
                      value={widgetConfig.chartConfig.title}
                      onChange={(e) => {
                        setWidgetConfig((prev) => ({
                          ...prev,
                          chartConfig: {
                            ...prev.chartConfig,
                            title: e.target.value,
                          },
                        }));
                      }}
                      placeholder="Ex: Vendas por Mês"
                      className="w-full border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-[#000638]">
                      Subtítulo (Opcional)
                    </label>
                    <input
                      type="text"
                      value={widgetConfig.chartConfig.subtitle}
                      onChange={(e) => {
                        setWidgetConfig((prev) => ({
                          ...prev,
                          chartConfig: {
                            ...prev.chartConfig,
                            subtitle: e.target.value,
                          },
                        }));
                      }}
                      placeholder="Ex: Janeiro - Dezembro 2024"
                      className="w-full border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
                    />
                  </div>
                </div>

                {/* Tipo de Gráfico com Exemplos Visuais */}
                {(widgetConfig.type === 'chart' ||
                  widgetConfig.type === 'graph') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      Tipo de Gráfico *
                    </label>
                    <div className="grid grid-cols-5 gap-3">
                      {[
                        {
                          value: 'bar',
                          label: 'Barras',
                          icon: '📊',
                          description: 'Comparar valores entre categorias',
                          example: (
                            <div className="flex items-end justify-around h-12 gap-1">
                              <div
                                className="w-full bg-blue-500 rounded-t"
                                style={{ height: '70%' }}
                              ></div>
                              <div
                                className="w-full bg-blue-500 rounded-t"
                                style={{ height: '45%' }}
                              ></div>
                              <div
                                className="w-full bg-blue-500 rounded-t"
                                style={{ height: '90%' }}
                              ></div>
                              <div
                                className="w-full bg-blue-500 rounded-t"
                                style={{ height: '60%' }}
                              ></div>
                            </div>
                          ),
                        },
                        {
                          value: 'line',
                          label: 'Linhas',
                          icon: '📈',
                          description: 'Mostrar tendências ao longo do tempo',
                          example: (
                            <svg className="w-full h-12" viewBox="0 0 100 40">
                              <polyline
                                points="0,35 25,25 50,15 75,20 100,10"
                                fill="none"
                                stroke="#3b82f6"
                                strokeWidth="2"
                              />
                              <circle cx="0" cy="35" r="2" fill="#3b82f6" />
                              <circle cx="25" cy="25" r="2" fill="#3b82f6" />
                              <circle cx="50" cy="15" r="2" fill="#3b82f6" />
                              <circle cx="75" cy="20" r="2" fill="#3b82f6" />
                              <circle cx="100" cy="10" r="2" fill="#3b82f6" />
                            </svg>
                          ),
                        },
                        {
                          value: 'area',
                          label: 'Área',
                          icon: '🏔️',
                          description: 'Destacar volume acumulado',
                          example: (
                            <svg className="w-full h-12" viewBox="0 0 100 40">
                              <path
                                d="M 0,35 L 25,25 L 50,15 L 75,20 L 100,10 L 100,40 L 0,40 Z"
                                fill="#3b82f6"
                                fillOpacity="0.3"
                                stroke="#3b82f6"
                                strokeWidth="2"
                              />
                            </svg>
                          ),
                        },
                        {
                          value: 'pie',
                          label: 'Pizza',
                          icon: '🥧',
                          description: 'Mostrar proporções de um todo',
                          example: (
                            <svg className="w-full h-12" viewBox="0 0 40 40">
                              <circle
                                cx="20"
                                cy="20"
                                r="18"
                                fill="#3b82f6"
                                opacity="0.3"
                              />
                              <path
                                d="M 20,20 L 20,2 A 18,18 0 0,1 35,28 Z"
                                fill="#3b82f6"
                              />
                              <path
                                d="M 20,20 L 35,28 A 18,18 0 0,1 10,35 Z"
                                fill="#8b5cf6"
                              />
                            </svg>
                          ),
                        },
                        {
                          value: 'scatter',
                          label: 'Dispersão',
                          icon: '⚪',
                          description: 'Correlação entre duas variáveis',
                          example: (
                            <svg className="w-full h-12" viewBox="0 0 100 40">
                              <circle cx="10" cy="30" r="2" fill="#3b82f6" />
                              <circle cx="25" cy="20" r="2" fill="#3b82f6" />
                              <circle cx="40" cy="25" r="2" fill="#3b82f6" />
                              <circle cx="55" cy="15" r="2" fill="#3b82f6" />
                              <circle cx="70" cy="18" r="2" fill="#3b82f6" />
                              <circle cx="85" cy="10" r="2" fill="#3b82f6" />
                              <circle cx="30" cy="35" r="2" fill="#3b82f6" />
                              <circle cx="60" cy="28" r="2" fill="#3b82f6" />
                            </svg>
                          ),
                        },
                      ].map((chartType) => (
                        <button
                          key={chartType.value}
                          type="button"
                          onClick={() => {
                            setWidgetConfig((prev) => ({
                              ...prev,
                              chartConfig: {
                                ...prev.chartConfig,
                                chartType: chartType.value,
                              },
                            }));
                          }}
                          className={`p-2.5 border-2 rounded-lg transition-all hover:shadow-md ${
                            widgetConfig.chartConfig.chartType ===
                            chartType.value
                              ? 'border-[#000638] bg-[#000638]/5 shadow-lg'
                              : 'border-gray-200 hover:border-[#000638]/30'
                          }`}
                        >
                          <div className="text-xl mb-1.5">{chartType.icon}</div>
                          <div className="mb-1.5">{chartType.example}</div>
                          <p className="text-xs font-bold mb-0.5 text-[#000638]">
                            {chartType.label}
                          </p>
                          <p className="text-[10px] text-gray-500 leading-tight">
                            {chartType.description}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Eixos (para gráficos não-pizza) com Explicação Visual */}
                {widgetConfig.chartConfig.chartType !== 'pie' && (
                  <div className="bg-[#f8f9fb] border border-[#000638]/20 rounded-lg p-4">
                    <h4 className="font-semibold text-[#000638] mb-3 flex items-center gap-1.5 text-sm">
                      <span className="bg-[#000638] text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                        ?
                      </span>
                      Entenda os Eixos do Gráfico
                    </h4>

                    {/* Exemplo Visual de Eixos */}
                    <div className="bg-white rounded-lg p-3 mb-3 border border-[#000638]/10">
                      <div className="relative" style={{ height: '150px' }}>
                        {/* Exemplo de Gráfico */}
                        <div
                          className="absolute bottom-0 left-0 right-0 flex items-end justify-around gap-1.5 px-6"
                          style={{ height: '120px' }}
                        >
                          <div className="flex flex-col items-center flex-1">
                            <div
                              className="w-full bg-gradient-to-t from-[#000638] to-[#000638]/80 rounded-t flex items-center justify-center text-white text-[10px] font-bold"
                              style={{ height: '70%' }}
                            >
                              100
                            </div>
                            <p className="text-[10px] mt-1 font-medium text-gray-700">
                              Jan
                            </p>
                          </div>
                          <div className="flex flex-col items-center flex-1">
                            <div
                              className="w-full bg-gradient-to-t from-[#000638] to-[#000638]/80 rounded-t flex items-center justify-center text-white text-[10px] font-bold"
                              style={{ height: '45%' }}
                            >
                              70
                            </div>
                            <p className="text-[10px] mt-1 font-medium text-gray-700">
                              Fev
                            </p>
                          </div>
                          <div className="flex flex-col items-center flex-1">
                            <div
                              className="w-full bg-gradient-to-t from-[#000638] to-[#000638]/80 rounded-t flex items-center justify-center text-white text-[10px] font-bold"
                              style={{ height: '90%' }}
                            >
                              150
                            </div>
                            <p className="text-[10px] mt-1 font-medium text-gray-700">
                              Mar
                            </p>
                          </div>
                          <div className="flex flex-col items-center flex-1">
                            <div
                              className="w-full bg-gradient-to-t from-[#000638] to-[#000638]/80 rounded-t flex items-center justify-center text-white text-[10px] font-bold"
                              style={{ height: '60%' }}
                            >
                              90
                            </div>
                            <p className="text-[10px] mt-1 font-medium text-gray-700">
                              Abr
                            </p>
                          </div>
                        </div>

                        {/* Setas e Labels */}
                        <div className="absolute left-0 top-0 bottom-10 flex items-center">
                          <div className="bg-green-600 text-white px-1.5 py-0.5 rounded text-[10px] font-bold shadow-md">
                            ← EIXO Y<br />
                            (Valores)
                          </div>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 flex justify-center">
                          <div className="bg-orange-600 text-white px-2 py-0.5 rounded text-[10px] font-bold shadow-md">
                            EIXO X (Categorias) →
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {/* Eixo X */}
                      <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-3 border border-orange-300">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="bg-orange-600 text-white rounded px-1.5 py-0.5 text-[10px] font-bold">
                            EIXO X
                          </span>
                          <span className="text-xs font-semibold text-gray-900">
                            Horizontal (Categorias)
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-600 mb-2">
                          Os <strong>rótulos</strong> que aparecem na base do
                          gráfico (ex: meses, produtos, regiões)
                        </p>
                        <select
                          value={widgetConfig.chartConfig.xAxis}
                          onChange={(e) => {
                            setWidgetConfig((prev) => ({
                              ...prev,
                              chartConfig: {
                                ...prev.chartConfig,
                                xAxis: e.target.value,
                              },
                            }));
                            // Gerar preview automaticamente
                            setTimeout(() => generatePreview(), 100);
                          }}
                          className="w-full border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] text-xs font-medium"
                        >
                          <option value="">❌ Selecione uma coluna...</option>
                          {widgetConfig.selectedColumns.map((col) => (
                            <option key={col} value={col}>
                              📌 {col}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Eixo Y */}
                      <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 border border-green-300">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="bg-green-600 text-white rounded px-1.5 py-0.5 text-[10px] font-bold">
                            EIXO Y
                          </span>
                          <span className="text-xs font-semibold text-gray-900">
                            Vertical (Valores)
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-600 mb-2">
                          Os <strong>números/valores</strong> que serão exibidos
                          (ex: vendas, quantidade, preço)
                        </p>
                        <div className="border border-green-300 rounded-lg p-1.5 max-h-24 overflow-y-auto bg-white">
                          {widgetConfig.selectedColumns.length === 0 ? (
                            <p className="text-[10px] text-gray-400 text-center py-1">
                              Nenhuma coluna disponível
                            </p>
                          ) : (
                            widgetConfig.selectedColumns.map((col) => (
                              <label
                                key={col}
                                className="flex items-center gap-1.5 p-1 hover:bg-green-50 rounded cursor-pointer transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  checked={widgetConfig.chartConfig.yAxis.includes(
                                    col,
                                  )}
                                  onChange={(e) => {
                                    const yAxis = e.target.checked
                                      ? [...widgetConfig.chartConfig.yAxis, col]
                                      : widgetConfig.chartConfig.yAxis.filter(
                                          (y) => y !== col,
                                        );
                                    setWidgetConfig((prev) => ({
                                      ...prev,
                                      chartConfig: {
                                        ...prev.chartConfig,
                                        yAxis,
                                      },
                                    }));
                                    // Gerar preview automaticamente
                                    setTimeout(() => generatePreview(), 100);
                                  }}
                                  className="rounded border-green-400 text-green-600 focus:ring-green-500 w-3 h-3"
                                />
                                <span className="text-[10px] font-medium">
                                  📊 {col}
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                        {widgetConfig.chartConfig.yAxis.length > 0 && (
                          <p className="text-[10px] text-green-700 mt-1 font-medium">
                            ✓ {widgetConfig.chartConfig.yAxis.length} série(s)
                            selecionada(s)
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Configuração para Gráfico de Pizza */}
                {widgetConfig.chartConfig.chartType === 'pie' && (
                  <div className="bg-purple-50 border border-purple-300 rounded-lg p-4">
                    <h4 className="font-semibold text-[#000638] mb-3 flex items-center gap-1.5 text-sm">
                      <span className="text-lg">🥧</span>
                      Como Configurar Gráfico de Pizza
                    </h4>

                    {/* Exemplo Visual de Pizza */}
                    <div className="bg-white rounded-lg p-3 mb-3 border border-purple-200">
                      <div className="flex items-center gap-4">
                        {/* Pizza Visual */}
                        <div className="flex-shrink-0">
                          <svg width="80" height="80" viewBox="0 0 120 120">
                            <circle
                              cx="60"
                              cy="60"
                              r="55"
                              fill="#ec4899"
                              opacity="0.3"
                            />
                            <path
                              d="M 60,60 L 60,5 A 55,55 0 0,1 110,80 Z"
                              fill="#ec4899"
                            />
                            <path
                              d="M 60,60 L 110,80 A 55,55 0 0,1 15,85 Z"
                              fill="#8b5cf6"
                            />
                            <path
                              d="M 60,60 L 15,85 A 55,55 0 0,1 60,5 Z"
                              fill="#3b82f6"
                            />
                          </svg>
                        </div>
                        {/* Explicação */}
                        <div className="flex-1">
                          <div className="space-y-1.5">
                            <div className="flex items-start gap-1.5">
                              <span className="text-sm">🏷️</span>
                              <div>
                                <p className="font-semibold text-xs text-[#000638]">
                                  Nome das Fatias (Eixo X)
                                </p>
                                <p className="text-[10px] text-gray-600">
                                  Ex: Nome Fantasia, Produto, Região
                                </p>
                              </div>
                            </div>
                            <div className="flex items-start gap-1.5">
                              <span className="text-sm">📊</span>
                              <div>
                                <p className="font-semibold text-xs text-[#000638]">
                                  Tamanho das Fatias (Eixo Y)
                                </p>
                                <p className="text-[10px] text-gray-600">
                                  Ex: Faturamento, Quantidade, Total
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {/* Nome das Fatias */}
                      <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-3 border border-purple-300">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-sm">🏷️</span>
                          <span className="text-xs font-semibold text-gray-900">
                            Nome das Fatias
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-600 mb-2">
                          O que identifica cada fatia da pizza (ex:{' '}
                          <strong>nome_fantasia</strong>)
                        </p>
                        <select
                          value={widgetConfig.chartConfig.xAxis}
                          onChange={(e) => {
                            setWidgetConfig((prev) => ({
                              ...prev,
                              chartConfig: {
                                ...prev.chartConfig,
                                xAxis: e.target.value,
                              },
                            }));
                            setTimeout(() => generatePreview(), 100);
                          }}
                          className="w-full border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] text-xs font-medium"
                        >
                          <option value="">❌ Selecione...</option>
                          {widgetConfig.selectedColumns.map((col) => (
                            <option key={col} value={col}>
                              🏷️ {col}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Tamanho das Fatias */}
                      <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-lg p-3 border border-pink-300">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-sm">📊</span>
                          <span className="text-xs font-semibold text-gray-900">
                            Tamanho das Fatias
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-600 mb-2">
                          O valor numérico de cada fatia (ex:{' '}
                          <strong>faturamento</strong>)
                        </p>
                        <div className="border border-pink-300 rounded-lg p-1.5 max-h-24 overflow-y-auto bg-white">
                          {widgetConfig.selectedColumns.length === 0 ? (
                            <p className="text-[10px] text-gray-400 text-center py-1">
                              Nenhuma coluna disponível
                            </p>
                          ) : (
                            widgetConfig.selectedColumns.map((col) => (
                              <label
                                key={col}
                                className="flex items-center gap-1.5 p-1 hover:bg-pink-50 rounded cursor-pointer transition-colors"
                              >
                                <input
                                  type="radio"
                                  name="pieValue"
                                  checked={
                                    widgetConfig.chartConfig.yAxis[0] === col
                                  }
                                  onChange={() => {
                                    setWidgetConfig((prev) => ({
                                      ...prev,
                                      chartConfig: {
                                        ...prev.chartConfig,
                                        yAxis: [col],
                                      },
                                    }));
                                    setTimeout(() => generatePreview(), 100);
                                  }}
                                  className="border-pink-400 text-pink-600 focus:ring-pink-500 w-3 h-3"
                                />
                                <span className="text-sm font-medium">
                                  📊 {col}
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                        {widgetConfig.chartConfig.yAxis.length > 0 && (
                          <p className="text-xs text-pink-700 mt-2 font-medium">
                            ✓ Usando: {widgetConfig.chartConfig.yAxis[0]}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Agrupar Por (para gráficos pizza e segmentados) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Agrupar/Dividir Por (Opcional)
                  </label>
                  <select
                    value={widgetConfig.chartConfig.groupBy}
                    onChange={(e) =>
                      setWidgetConfig((prev) => ({
                        ...prev,
                        chartConfig: {
                          ...prev.chartConfig,
                          groupBy: e.target.value,
                        },
                      }))
                    }
                    className="w-full border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                  >
                    <option value="">Sem agrupamento</option>
                    {widgetConfig.selectedColumns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Cria séries separadas no gráfico (ex: por categoria, região,
                    etc)
                  </p>
                </div>

                {/* Esquema de Cores */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Esquema de Cores
                  </label>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      {
                        value: 'default',
                        label: 'Padrão',
                        colors: ['#3b82f6', '#8b5cf6', '#ec4899'],
                      },
                      {
                        value: 'business',
                        label: 'Negócios',
                        colors: ['#1e40af', '#0891b2', '#059669'],
                      },
                      {
                        value: 'warm',
                        label: 'Quente',
                        colors: ['#dc2626', '#ea580c', '#f59e0b'],
                      },
                      {
                        value: 'cool',
                        label: 'Frio',
                        colors: ['#0284c7', '#0891b2', '#06b6d4'],
                      },
                    ].map((scheme) => (
                      <button
                        key={scheme.value}
                        type="button"
                        onClick={() =>
                          setWidgetConfig((prev) => ({
                            ...prev,
                            chartConfig: {
                              ...prev.chartConfig,
                              colorScheme: scheme.value,
                            },
                          }))
                        }
                        className={`p-3 border-2 rounded-lg transition-all ${
                          widgetConfig.chartConfig.colorScheme === scheme.value
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex gap-1 mb-2 justify-center">
                          {scheme.colors.map((color, i) => (
                            <div
                              key={i}
                              className="w-4 h-4 rounded"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                        <p className="text-xs font-medium">{scheme.label}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Opções Visuais */}
                <div>
                  <label className="block text-xs font-semibold mb-2 text-[#000638]">
                    Opções de Exibição
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 p-2 border border-[#000638]/20 rounded-lg hover:bg-[#f8f9fb] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={widgetConfig.chartConfig.showLegend}
                        onChange={(e) =>
                          setWidgetConfig((prev) => ({
                            ...prev,
                            chartConfig: {
                              ...prev.chartConfig,
                              showLegend: e.target.checked,
                            },
                          }))
                        }
                        className="rounded border-gray-300 w-3 h-3"
                      />
                      <div>
                        <p className="font-semibold text-xs text-[#000638]">
                          Mostrar Legenda
                        </p>
                        <p className="text-[10px] text-gray-500">
                          Exibe os rótulos das séries
                        </p>
                      </div>
                    </label>

                    <label className="flex items-center gap-2 p-2 border border-[#000638]/20 rounded-lg hover:bg-[#f8f9fb] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={widgetConfig.chartConfig.showDataLabels}
                        onChange={(e) =>
                          setWidgetConfig((prev) => ({
                            ...prev,
                            chartConfig: {
                              ...prev.chartConfig,
                              showDataLabels: e.target.checked,
                            },
                          }))
                        }
                        className="rounded border-gray-300 w-3 h-3"
                      />
                      <div>
                        <p className="font-semibold text-xs text-[#000638]">
                          Rótulos de Dados
                        </p>
                        <p className="text-[10px] text-gray-500">
                          Mostra valores nos pontos
                        </p>
                      </div>
                    </label>

                    <label className="flex items-center gap-2 p-2 border border-[#000638]/20 rounded-lg hover:bg-[#f8f9fb] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={widgetConfig.chartConfig.showGrid}
                        onChange={(e) =>
                          setWidgetConfig((prev) => ({
                            ...prev,
                            chartConfig: {
                              ...prev.chartConfig,
                              showGrid: e.target.checked,
                            },
                          }))
                        }
                        className="rounded border-gray-300 w-3 h-3"
                      />
                      <div>
                        <p className="font-semibold text-xs text-[#000638]">
                          Mostrar Grade
                        </p>
                        <p className="text-[10px] text-gray-500">
                          Linhas de referência no fundo
                        </p>
                      </div>
                    </label>

                    {widgetConfig.chartConfig.chartType === 'bar' && (
                      <>
                        <label className="flex items-center gap-2 p-2 border border-[#000638]/20 rounded-lg hover:bg-[#f8f9fb] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={widgetConfig.chartConfig.stacked}
                            onChange={(e) =>
                              setWidgetConfig((prev) => ({
                                ...prev,
                                chartConfig: {
                                  ...prev.chartConfig,
                                  stacked: e.target.checked,
                                },
                              }))
                            }
                            className="rounded border-gray-300 w-3 h-3"
                          />
                          <div>
                            <p className="font-semibold text-xs text-[#000638]">
                              Empilhado
                            </p>
                            <p className="text-[10px] text-gray-500">
                              Barras uma sobre a outra
                            </p>
                          </div>
                        </label>

                        <label className="flex items-center gap-2 p-2 border border-[#000638]/20 rounded-lg hover:bg-[#f8f9fb] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={widgetConfig.chartConfig.horizontal}
                            onChange={(e) =>
                              setWidgetConfig((prev) => ({
                                ...prev,
                                chartConfig: {
                                  ...prev.chartConfig,
                                  horizontal: e.target.checked,
                                },
                              }))
                            }
                            className="rounded border-gray-300 w-3 h-3"
                          />
                          <div>
                            <p className="font-semibold text-xs text-[#000638]">
                              Horizontal
                            </p>
                            <p className="text-[10px] text-gray-500">
                              Barras na horizontal
                            </p>
                          </div>
                        </label>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 5: Preview */}
        {currentStep === 5 && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold flex items-center gap-1.5 text-[#000638]">
                <Eye size={14} />
                Preview do Widget
              </h3>
              <button
                type="button"
                onClick={() => generatePreview()}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-[#000638]/30 text-[#000638] hover:bg-[#000638]/10 transition-colors h-6"
              >
                Atualizar Preview
              </button>
            </div>

            <div className="border border-[#000638]/20 rounded-lg p-3">
              <WidgetPreview
                type={widgetConfig.type}
                data={previewData}
                config={widgetConfig}
              />
            </div>

            {/* Resumo da configuração */}
            <div className="bg-[#f8f9fb] p-2.5 rounded-lg border border-[#000638]/20">
              <p className="font-semibold mb-1.5 text-xs text-[#000638]">
                Resumo da Configuração:
              </p>
              <ul className="text-[10px] space-y-0.5 text-gray-700">
                <li>
                  <strong className="text-[#000638]">View:</strong>{' '}
                  {selectedView?.label}
                </li>
                <li>
                  <strong className="text-[#000638]">Colunas:</strong>{' '}
                  {widgetConfig.selectedColumns.join(', ')}
                </li>
                <li>
                  <strong className="text-[#000638]">Filtros:</strong>{' '}
                  {widgetConfig.filters.length} aplicado(s)
                </li>
                <li>
                  <strong className="text-[#000638]">Agregações:</strong>{' '}
                  {widgetConfig.aggregations.length} aplicada(s)
                </li>
                <li>
                  <strong className="text-[#000638]">Tipo:</strong>{' '}
                  {
                    WIDGET_TYPES_LIST.find((t) => t.value === widgetConfig.type)
                      ?.label
                  }
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Navegação entre steps */}
        <div className="flex justify-between pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
            disabled={currentStep === 1}
            className="px-3 py-1 rounded-lg text-xs font-semibold border-2 border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors h-7"
          >
            Anterior
          </button>

          <div className="flex gap-2">
            {currentStep < 5 ? (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => Math.min(5, prev + 1))}
                className="px-3 py-1 rounded-lg text-xs font-bold bg-[#000638] text-white hover:bg-[#fe0000] transition-colors h-7 shadow-md"
              >
                Próximo
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSaveWidget}
                className="px-3 py-1 rounded-lg text-xs font-bold bg-[#000638] text-white hover:bg-[#fe0000] transition-colors h-7 shadow-md"
              >
                {editingWidget ? 'Salvar Alterações' : 'Criar Widget'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default WidgetModal;
