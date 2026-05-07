import React from 'react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const COLORS = [
  '#0088FE',
  '#00C49F',
  '#FFBB28',
  '#FF8042',
  '#8884D8',
  '#82ca9d',
];

/**
 * Componente de Preview do Widget
 * Exibe visualização de dados como tabela ou gráfico
 */
const WidgetPreview = ({ type, data, config }) => {
  console.log('🎨 WidgetPreview - Recebendo:', { type, data, config });

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
        <div className="text-center">
          <p className="text-gray-500 text-lg font-medium">
            Sem dados para exibir
          </p>
          <p className="text-gray-400 text-sm mt-1">
            Configure o widget para ver o preview
          </p>
        </div>
      </div>
    );
  }

  // Usar configuração do chartConfig se disponível
  const chartConfig = config?.chartConfig || {};
  const chartType = chartConfig.chartType || type;
  const xAxis = chartConfig.xAxis;
  const yAxis = chartConfig.yAxis || [];
  const groupBy = chartConfig.groupBy;

  console.log('📊 Configuração do gráfico:', {
    chartType,
    xAxis,
    yAxis,
    groupBy,
    type,
  });

  // Preview de Tabela
  if (type === 'table') {
    const columns = Object.keys(data[0]);

    return (
      <div className="overflow-auto max-h-96 border border-gray-300 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((row, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                {columns.map((column) => (
                  <td
                    key={column}
                    className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap"
                  >
                    {row[column] !== null && row[column] !== undefined
                      ? row[column].toString()
                      : '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Preview de Gráfico de Barras
  if (type === 'bar' || type === 'chart' || type === 'graph') {
    // Usar configuração específica ou fallback para colunas
    const xKey = xAxis || Object.keys(data[0])[0];
    const yKeys = yAxis.length > 0 ? yAxis : Object.keys(data[0]).slice(1);

    console.log('📊 Gráfico de Barras:', {
      xKey,
      yKeys,
      data: data.slice(0, 2),
    });

    return (
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xKey} />
            <YAxis />
            <Tooltip />
            <Legend />
            {yKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Preview de Gráfico de Pizza
  if (type === 'pie' || chartType === 'pie') {
    console.log('🥧 Gráfico de Pizza - ANÁLISE DETALHADA:', {
      'Type recebido': type,
      ChartType: chartType,
      'Config completo': config,
      ChartConfig: chartConfig,
      'xAxis do chartConfig': chartConfig.xAxis,
      'yAxis do chartConfig': chartConfig.yAxis,
      'Dados recebidos (length)': data.length,
      'Primeiro item': data[0],
      'Chaves disponíveis': Object.keys(data[0] || {}),
    });

    // Para pizza: usar xAxis como categoria e primeiro yAxis como valor
    // Priorizar chartConfig, depois fallbacks inteligentes
    let nameKey = chartConfig.xAxis || xAxis || groupBy;
    let valueKey = chartConfig.yAxis?.[0] || yAxis?.[0];

    // Se ainda não temos as chaves, tentar inferir dos dados
    if (!nameKey || !valueKey) {
      const keys = Object.keys(data[0]);
      console.log('🔍 Tentando inferir chaves dos dados:', keys);

      // Procurar por colunas numéricas para o valor
      const numericKeys = keys.filter((key) => {
        const value = data[0][key];
        return typeof value === 'number' || !isNaN(Number(value));
      });

      // Procurar por colunas de texto para o nome
      const textKeys = keys.filter((key) => {
        const value = data[0][key];
        return typeof value === 'string' || isNaN(Number(value));
      });

      // Se não temos nameKey, usar primeira coluna de texto ou primeira coluna
      if (!nameKey) {
        nameKey = textKeys[0] || keys[0];
      }

      // Se não temos valueKey, usar primeira coluna numérica ou segunda coluna
      if (!valueKey) {
        valueKey = numericKeys[0] || keys[1] || keys[0];
      }

      console.log('✨ Chaves inferidas:', {
        nameKey,
        valueKey,
        textKeys,
        numericKeys,
      });
    }

    console.log('🥧 Gráfico de Pizza - CHAVES FINAIS:', {
      'nameKey FINAL': nameKey,
      'valueKey FINAL': valueKey,
      'Valor do primeiro item [nameKey]': data[0]?.[nameKey],
      'Valor do primeiro item [valueKey]': data[0]?.[valueKey],
    });

    // Validar se os dados têm as chaves necessárias
    if (
      !data[0] ||
      data[0][nameKey] === undefined ||
      data[0][valueKey] === undefined
    ) {
      console.error('❌ Configuração inválida do gráfico de pizza:', {
        nameKey,
        valueKey,
        'data[0]': data[0],
        'Todas chaves': Object.keys(data[0] || {}),
      });

      return (
        <div className="flex items-center justify-center h-64 bg-red-50 rounded-lg border-2 border-red-200">
          <div className="text-center p-4">
            <p className="text-red-600 font-medium mb-2">
              ⚠️ Configuração Inválida
            </p>
            <p className="text-sm text-gray-600 mb-2">
              Não foi possível determinar as colunas para o gráfico de pizza.
            </p>
            <ul className="text-sm text-gray-600 mt-2 text-left">
              <li>
                • <strong>Tentou usar para Nome:</strong>{' '}
                {nameKey || '(nenhuma)'}
              </li>
              <li>
                • <strong>Tentou usar para Valor:</strong>{' '}
                {valueKey || '(nenhuma)'}
              </li>
            </ul>
            <p className="text-xs text-gray-500 mt-2">
              Colunas disponíveis: {Object.keys(data[0] || {}).join(', ')}
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Configure o eixo X e Y no passo 4 da criação do widget.
            </p>
          </div>
        </div>
      );
    }

    console.log('✅ Renderizando gráfico de pizza com:', {
      nameKey,
      valueKey,
      'Total de items': data.length,
      'Amostra de dados': data.slice(0, 3).map((item) => ({
        [nameKey]: item[nameKey],
        [valueKey]: item[valueKey],
      })),
    });

    return (
      <div className="h-[500px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey={valueKey}
              nameKey={nameKey}
              cx="50%"
              cy="45%"
              outerRadius={140}
              innerRadius={0}
              label={({ name, value }) =>
                `${name}: R$${value.toLocaleString()}`
              }
              labelLine={false}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                fontSize: '12px',
                padding: '8px',
                borderRadius: '6px',
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={80}
              wrapperStyle={{
                paddingTop: '30px',
                fontSize: '11px',
                lineHeight: '18px',
              }}
              iconSize={10}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Preview de Gráfico de Linha
  if (type === 'line') {
    const columns = Object.keys(data[0]);
    const xKey = columns[0];
    const yKeys = columns.slice(1);

    return (
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xKey} />
            <YAxis />
            <Tooltip />
            <Legend />
            {yKeys.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLORS[index % COLORS.length]}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return null;
};

export default WidgetPreview;
