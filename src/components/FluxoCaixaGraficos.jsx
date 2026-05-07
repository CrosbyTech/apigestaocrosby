import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement,
} from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/cards';
import {
  ChartBar,
  ChartPieSlice,
  Building,
  Receipt,
  CreditCard,
  TrendUp,
} from '@phosphor-icons/react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement,
);

const FluxoCaixaGraficos = ({ dadosAgrupados }) => {
  // Função para processar dados para gráficos
  const processarDadosGraficos = () => {
    if (!dadosAgrupados || dadosAgrupados.length === 0) {
      return {
        fornecedores: { labels: [], data: [] },
        centrosCusto: { labels: [], data: [] },
        despesas: { labels: [], data: [] },
        temporal: { labels: [], data: [] },
      };
    }

    // Processar dados por fornecedor
    const dadosFornecedores = {};
    const dadosCentrosCusto = {};
    const dadosDespesas = {};
    const dadosTemporais = {};

    dadosAgrupados.forEach((grupo) => {
      const fornecedor =
        grupo.item.nm_fornecedor ||
        grupo.item.cd_fornecedor ||
        'Sem Fornecedor';
      const centroCusto = grupo.item.ds_ccusto || 'Sem Centro de Custo';
      const despesa = grupo.item.ds_despesaitem || 'Sem Despesa';
      const valor = parseFloat(grupo.item.vl_pago) || 0;
      const dataLiquidacao = grupo.item.dt_liq;

      // Só incluir se tem valor pago
      if (valor > 0) {
        // Fornecedores
        dadosFornecedores[fornecedor] =
          (dadosFornecedores[fornecedor] || 0) + valor;

        // Centros de Custo
        dadosCentrosCusto[centroCusto] =
          (dadosCentrosCusto[centroCusto] || 0) + valor;

        // Despesas
        dadosDespesas[despesa] = (dadosDespesas[despesa] || 0) + valor;

        // Dados temporais (por data de liquidação)
        if (dataLiquidacao) {
          const data = new Date(dataLiquidacao);
          const dataFormatada = data.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });
          dadosTemporais[dataFormatada] =
            (dadosTemporais[dataFormatada] || 0) + valor;
        }
      }
    });

    // Ordenar e limitar aos top 10
    const ordenarElimitar = (dados) => {
      return Object.entries(dados)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .reduce(
          (acc, [label, value]) => {
            acc.labels.push(label);
            acc.data.push(value);
            return acc;
          },
          { labels: [], data: [] },
        );
    };

    // Para dados temporais, ordenar por data
    const dadosTemporaisOrdenados = Object.entries(dadosTemporais)
      .sort(
        ([a], [b]) =>
          new Date(a.split('/').reverse().join('-')) -
          new Date(b.split('/').reverse().join('-')),
      )
      .reduce(
        (acc, [label, value]) => {
          acc.labels.push(label);
          acc.data.push(value);
          return acc;
        },
        { labels: [], data: [] },
      );

    return {
      fornecedores: ordenarElimitar(dadosFornecedores),
      centrosCusto: ordenarElimitar(dadosCentrosCusto),
      despesas: ordenarElimitar(dadosDespesas),
      temporal: dadosTemporaisOrdenados,
    };
  };

  const dadosGraficos = processarDadosGraficos();

  // Configurações dos gráficos
  const opcoesBarra = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function (value) {
            return new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            }).format(value);
          },
        },
      },
    },
  };

  const opcoesPizza = {
    responsive: true,
    plugins: {
      legend: {
        position: 'bottom',
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            const label = context.label || '';
            const value = context.parsed;
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);
            return `${label}: ${new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            }).format(value)} (${percentage}%)`;
          },
        },
      },
    },
  };

  const opcoesLinha = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function (value) {
            return new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            }).format(value);
          },
        },
      },
      x: {
        ticks: {
          maxRotation: 45,
          minRotation: 45,
        },
      },
    },
  };

  // Cores para os gráficos
  const cores = [
    '#3B82F6',
    '#EF4444',
    '#10B981',
    '#F59E0B',
    '#8B5CF6',
    '#06B6D4',
    '#84CC16',
    '#F97316',
    '#EC4899',
    '#6366F1',
  ];

  // Dados para gráfico de fornecedores
  const dadosFornecedoresBarra = {
    labels: dadosGraficos.fornecedores.labels,
    datasets: [
      {
        label: 'Valor Pago por Fornecedor',
        data: dadosGraficos.fornecedores.data,
        backgroundColor: cores.slice(
          0,
          dadosGraficos.fornecedores.labels.length,
        ),
        borderColor: cores.slice(0, dadosGraficos.fornecedores.labels.length),
        borderWidth: 1,
      },
    ],
  };

  const dadosFornecedoresPizza = {
    labels: dadosGraficos.fornecedores.labels,
    datasets: [
      {
        data: dadosGraficos.fornecedores.data,
        backgroundColor: cores.slice(
          0,
          dadosGraficos.fornecedores.labels.length,
        ),
        borderColor: '#ffffff',
        borderWidth: 2,
      },
    ],
  };

  // Dados para gráfico de centros de custo
  const dadosCentrosCustoBarra = {
    labels: dadosGraficos.centrosCusto.labels,
    datasets: [
      {
        label: 'Valor Pago por Centro de Custo',
        data: dadosGraficos.centrosCusto.data,
        backgroundColor: cores.slice(
          0,
          dadosGraficos.centrosCusto.labels.length,
        ),
        borderColor: cores.slice(0, dadosGraficos.centrosCusto.labels.length),
        borderWidth: 1,
      },
    ],
  };

  const dadosCentrosCustoPizza = {
    labels: dadosGraficos.centrosCusto.labels,
    datasets: [
      {
        data: dadosGraficos.centrosCusto.data,
        backgroundColor: cores.slice(
          0,
          dadosGraficos.centrosCusto.labels.length,
        ),
        borderColor: '#ffffff',
        borderWidth: 2,
      },
    ],
  };

  // Dados para gráfico de despesas
  const dadosDespesasBarra = {
    labels: dadosGraficos.despesas.labels,
    datasets: [
      {
        label: 'Valor Pago por Despesa',
        data: dadosGraficos.despesas.data,
        backgroundColor: cores.slice(0, dadosGraficos.despesas.labels.length),
        borderColor: cores.slice(0, dadosGraficos.despesas.labels.length),
        borderWidth: 1,
      },
    ],
  };

  const dadosDespesasPizza = {
    labels: dadosGraficos.despesas.labels,
    datasets: [
      {
        data: dadosGraficos.despesas.data,
        backgroundColor: cores.slice(0, dadosGraficos.despesas.labels.length),
        borderColor: '#ffffff',
        borderWidth: 2,
      },
    ],
  };

  // Dados para gráfico temporal
  const dadosTemporaisLinha = {
    labels: dadosGraficos.temporal.labels,
    datasets: [
      {
        label: 'Valor Pago por Data de Liquidação',
        data: dadosGraficos.temporal.data,
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#3B82F6',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7,
      },
    ],
  };

  if (!dadosAgrupados || dadosAgrupados.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-lg border border-[#000638]/10 max-w-6xl mx-auto w-full mb-8">
        <div className="p-6 border-b border-[#000638]/10">
          <h2 className="text-xl font-bold text-[#000638] flex items-center gap-2">
            <ChartBar size={24} />
            Análise Gráfica do Fluxo de Caixa
          </h2>
        </div>
        <div className="p-6">
          <div className="text-center py-8 text-gray-500">
            <ChartBar size={48} className="mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium">
              Nenhum dado disponível para gráficos
            </p>
            <p className="text-sm">
              Busque dados para visualizar as análises gráficas
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Gráfico Temporal */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[#000638]">
            <TrendUp size={20} />
            Evolução dos Pagamentos ao Longo do Tempo
          </CardTitle>
          <CardDescription>
            Valores pagos por data de liquidação
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <Line data={dadosTemporaisLinha} options={opcoesLinha} />
          </div>
        </CardContent>
      </Card>

      {/* Gráficos de Fornecedores */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#000638]">
              <Building size={20} />
              Top 10 Fornecedores (Barras)
            </CardTitle>
            <CardDescription>
              Distribuição de valores pagos por fornecedor
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <Bar data={dadosFornecedoresBarra} options={opcoesBarra} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#000638]">
              <ChartPieSlice size={20} />
              Top 10 Fornecedores (Pizza)
            </CardTitle>
            <CardDescription>
              Percentual de valores pagos por fornecedor
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <Pie data={dadosFornecedoresPizza} options={opcoesPizza} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos de Centros de Custo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#000638]">
              <CreditCard size={20} />
              Top 10 Centros de Custo (Barras)
            </CardTitle>
            <CardDescription>
              Distribuição de valores pagos por centro de custo
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <Bar data={dadosCentrosCustoBarra} options={opcoesBarra} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#000638]">
              <ChartPieSlice size={20} />
              Top 10 Centros de Custo (Pizza)
            </CardTitle>
            <CardDescription>
              Percentual de valores pagos por centro de custo
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <Pie data={dadosCentrosCustoPizza} options={opcoesPizza} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos de Despesas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#000638]">
              <Receipt size={20} />
              Top 10 Despesas (Barras)
            </CardTitle>
            <CardDescription>
              Distribuição de valores pagos por tipo de despesa
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <Bar data={dadosDespesasBarra} options={opcoesBarra} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#000638]">
              <ChartPieSlice size={20} />
              Top 10 Despesas (Pizza)
            </CardTitle>
            <CardDescription>
              Percentual de valores pagos por tipo de despesa
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <Pie data={dadosDespesasPizza} options={opcoesPizza} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resumo Estatístico */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[#000638]">
            <ChartBar size={20} />
            Resumo Estatístico
          </CardTitle>
          <CardDescription>
            Informações gerais sobre os dados analisados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">
                {dadosGraficos.fornecedores.labels.length}
              </div>
              <div className="text-sm text-gray-600">
                Fornecedores Analisados
              </div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {dadosGraficos.centrosCusto.labels.length}
              </div>
              <div className="text-sm text-gray-600">Centros de Custo</div>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded-lg">
              <div className="text-2xl font-bold text-purple-600">
                {dadosGraficos.despesas.labels.length}
              </div>
              <div className="text-sm text-gray-600">Tipos de Despesa</div>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded-lg">
              <div className="text-2xl font-bold text-orange-600">
                {dadosGraficos.temporal.labels.length}
              </div>
              <div className="text-sm text-gray-600">Dias com Pagamentos</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default FluxoCaixaGraficos;
