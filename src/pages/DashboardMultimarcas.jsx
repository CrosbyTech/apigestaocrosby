import React, { useState, useMemo } from 'react';
import useApiClient from '../hooks/useApiClient';
import PageTitle from '../components/ui/PageTitle';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import LoadingSpinner from '../components/LoadingSpinner';
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
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar, Pie } from 'react-chartjs-2';
import {
  ChartLineUp,
  ChartPieSlice,
  TrendUp,
  Money,
  ArrowUp,
  ArrowDown,
  Funnel,
  Receipt,
  CarProfile,
} from '@phosphor-icons/react';

// Registrar componentes do Chart.js
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
  ChartDataLabels,
);

const DashboardMultimarcas = () => {
  const apiClient = useApiClient();

  const [modalGrafico, setModalGrafico] = useState(null);
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const [dataInicio, setDataInicio] = useState(
    firstDay.toISOString().split('T')[0],
  );
  const [dataFim, setDataFim] = useState(today.toISOString().split('T')[0]);

  const [dadosMtm, setDadosMtm] = useState([]);
  const [dadosMesAnterior, setDadosMesAnterior] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Função para formatar valores em Real
  const formatBRL = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value || 0);
  };

  // Função para buscar dados
  const buscarDados = async () => {
    if (!dataInicio || !dataFim) {
      setError('Por favor, selecione as datas de início e fim');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Buscar dados do período atual
      const responseMtm = await apiClient.sales.faturamentoMtm({
        dataInicio,
        dataFim,
      });

      const normalizeResponseToArray = (resp) => {
        if (!resp) return [];
        if (Array.isArray(resp)) return resp;
        if (Array.isArray(resp.data)) return resp.data;
        if (resp.data && Array.isArray(resp.data.data)) return resp.data.data;
        const firstArray = Object.values(resp).find((v) => Array.isArray(v));
        if (firstArray) return firstArray;
        return [];
      };

      const normalizedMtm = normalizeResponseToArray(responseMtm);
      setDadosMtm(normalizedMtm);

      // Calcular período anterior
      const inicio = new Date(dataInicio);
      const fim = new Date(dataFim);
      const diffTime = Math.abs(fim - inicio);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      const inicioAnterior = new Date(inicio);
      inicioAnterior.setDate(inicio.getDate() - diffDays - 1);
      const fimAnterior = new Date(inicio);
      fimAnterior.setDate(inicio.getDate() - 1);

      // Buscar dados do período anterior
      const responseMesAnterior = await apiClient.sales.faturamentoMtm({
        dataInicio: inicioAnterior.toISOString().split('T')[0],
        dataFim: fimAnterior.toISOString().split('T')[0],
      });

      const normalizedMesAnterior =
        normalizeResponseToArray(responseMesAnterior);
      setDadosMesAnterior(normalizedMesAnterior);
    } catch (err) {
      console.error('Erro ao buscar dados de multimarcas:', err);
      setError('Erro ao carregar dados de faturamento de multimarcas');
    } finally {
      setLoading(false);
    }
  };

  // Consolidar dados do multimarcas
  const dadosConsolidados = useMemo(() => {
    if (!dadosMtm.length) return null;

    const consolidado = dadosMtm.reduce(
      (acc, item) => {
        const valorBrutoSaida = parseFloat(item.valor_sem_desconto_saida) || 0;
        const valorBrutoEntrada =
          parseFloat(item.valor_sem_desconto_entrada) || 0;
        const valorLiquidoSaida =
          parseFloat(item.valor_com_desconto_saida) || 0;
        const valorLiquidoEntrada =
          parseFloat(item.valor_com_desconto_entrada) || 0;

        acc.valor_bruto_saida += valorBrutoSaida;
        acc.valor_bruto_entrada += valorBrutoEntrada;
        acc.valor_liquido_saida += valorLiquidoSaida;
        acc.valor_liquido_entrada += valorLiquidoEntrada;

        return acc;
      },
      {
        valor_bruto_saida: 0,
        valor_bruto_entrada: 0,
        valor_liquido_saida: 0,
        valor_liquido_entrada: 0,
      },
    );

    // Calcular totais e descontos
    consolidado.valor_bruto_total =
      consolidado.valor_bruto_saida + consolidado.valor_bruto_entrada;
    consolidado.valor_liquido_total =
      consolidado.valor_liquido_saida + consolidado.valor_liquido_entrada;
    consolidado.desconto_saida =
      consolidado.valor_bruto_saida - consolidado.valor_liquido_saida;
    consolidado.desconto_entrada =
      consolidado.valor_bruto_entrada - consolidado.valor_liquido_entrada;
    consolidado.desconto_total =
      consolidado.desconto_saida + consolidado.desconto_entrada;
    consolidado.receita_liquida =
      consolidado.valor_liquido_saida -
      Math.abs(consolidado.valor_liquido_entrada);

    return consolidado;
  }, [dadosMtm]);

  // Consolidar dados do mês anterior
  const dadosConsolidadosMesAnterior = useMemo(() => {
    if (!dadosMesAnterior.length) return null;

    const consolidado = dadosMesAnterior.reduce(
      (acc, item) => {
        const valorLiquidoSaida =
          parseFloat(item.valor_com_desconto_saida) || 0;
        const valorLiquidoEntrada =
          parseFloat(item.valor_com_desconto_entrada) || 0;

        acc.valor_liquido_saida += valorLiquidoSaida;
        acc.valor_liquido_entrada += valorLiquidoEntrada;

        return acc;
      },
      {
        valor_liquido_saida: 0,
        valor_liquido_entrada: 0,
      },
    );

    consolidado.receita_liquida =
      consolidado.valor_liquido_saida -
      Math.abs(consolidado.valor_liquido_entrada);

    return consolidado;
  }, [dadosMesAnterior]);

  // Calcular crescimento mensal
  const calcularCrescimento = () => {
    if (!dadosConsolidados || !dadosConsolidadosMesAnterior) {
      return { variacao: null, anterior: 0 };
    }

    const atual = dadosConsolidados.receita_liquida;
    const anterior = dadosConsolidadosMesAnterior.receita_liquida;

    if (anterior === 0) {
      return { variacao: atual > 0 ? 100 : 0, anterior };
    }

    const variacao = ((atual - anterior) / Math.abs(anterior)) * 100;
    return { variacao, anterior };
  };

  const crescimento = calcularCrescimento();

  // Dados para gráfico de pizza por empresa
  const dadosPizzaEmpresa = useMemo(() => {
    if (!dadosMtm.length) return null;

    const empresasMap = new Map();

    dadosMtm.forEach((item) => {
      const empresaKey = item.cd_grupoempresa || item.cd_empresa;
      const empresaNome =
        item.nm_grupoempresa ||
        item.cd_grupoempresa ||
        `Empresa ${item.cd_empresa}`;

      const valorSaida = parseFloat(item.valor_com_desconto_saida) || 0;
      const valorEntrada = parseFloat(item.valor_com_desconto_entrada) || 0;
      const receitaLiquida = valorSaida - Math.abs(valorEntrada);

      if (empresasMap.has(empresaKey)) {
        empresasMap.get(empresaKey).valor += receitaLiquida;
      } else {
        empresasMap.set(empresaKey, {
          nome: empresaNome,
          valor: receitaLiquida,
        });
      }
    });

    const empresasArray = Array.from(empresasMap.values());
    const labels = empresasArray.map((e) => e.nome);
    const valores = empresasArray.map((e) => e.valor);

    return {
      labels,
      datasets: [
        {
          data: valores,
          backgroundColor: [
            '#10B981',
            '#3B82F6',
            '#F59E0B',
            '#EF4444',
            '#6366F1',
            '#F472B6',
            '#F87171',
            '#34D399',
            '#A78BFA',
            '#FBBF24',
            '#6EE7B7',
            '#F9A8D4',
            '#FDE68A',
            '#C7D2FE',
            '#FCA5A5',
            '#A3E635',
            '#FCD34D',
            '#818CF8',
            '#FECACA',
            '#F3F4F6',
          ],
          borderWidth: 2,
          borderColor: '#fff',
        },
      ],
    };
  }, [dadosMtm]);

  // Dados para gráfico de barras
  const dadosBarras = useMemo(() => {
    if (!dadosConsolidados) return null;

    return {
      labels: ['Vendas (Saída)', 'Devoluções (Entrada)'],
      datasets: [
        {
          label: 'Valor Bruto',
          data: [
            dadosConsolidados.valor_bruto_saida,
            Math.abs(dadosConsolidados.valor_bruto_entrada),
          ],
          backgroundColor: '#10B981',
        },
        {
          label: 'Valor Líquido',
          data: [
            dadosConsolidados.valor_liquido_saida,
            Math.abs(dadosConsolidados.valor_liquido_entrada),
          ],
          backgroundColor: '#059669',
        },
        {
          label: 'Descontos',
          data: [
            dadosConsolidados.desconto_saida,
            Math.abs(dadosConsolidados.desconto_entrada),
          ],
          backgroundColor: '#F59E0B',
        },
      ],
    };
  }, [dadosConsolidados]);

  // Opções para gráficos
  const opcoesPizza = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          boxWidth: 15,
          padding: 10,
          font: { size: 11 },
        },
      },
      datalabels: {
        color: '#fff',
        font: { weight: 'bold', size: 11 },
        formatter: (value, context) => {
          const total = context.chart.data.datasets[0].data.reduce(
            (a, b) => a + b,
            0,
          );
          const percentage = ((value / total) * 100).toFixed(1);
          return percentage > 3 ? `${percentage}%` : '';
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const label = context.label || '';
            const value = formatBRL(context.parsed);
            return `${label}: ${value}`;
          },
        },
      },
    },
  };

  const opcoesBarras = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      datalabels: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => {
            const label = context.dataset.label || '';
            const value = formatBRL(context.parsed.y);
            return `${label}: ${value}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: (value) => formatBRL(value),
        },
      },
    },
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      <PageTitle
        title="Dashboard Multimarcas"
        subtitle="Análise completa do faturamento do canal Multimarcas"
        icon={CarProfile}
        iconColor="text-green-600"
      />

      {/* Filtros */}
      <div className="mb-4">
        <form className="flex flex-col bg-white  rounded-lg shadow-lg w-full max-w-4xl mx-auto border border-[#000638]/10 gap-5 p-5">
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" />
              Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Selecione o período para análise
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5 mb-3">
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Início
              </label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Fim
              </label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={buscarDados}
                disabled={loading}
                type="button"
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed  transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase"
              >
                <ChartLineUp size={16} />
                Buscar Dados
              </button>
            </div>
          </div>
        </form>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-6">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : dadosConsolidados ? (
        <>
          {/* Cards de Resumo */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* Receita Líquida */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Money size={18} className="text-green-600" />
                  <CardTitle className="text-sm font-bold text-green-700">
                    Receita Líquida
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-xl font-extrabold text-green-600 mb-0.5">
                  {formatBRL(dadosConsolidados.receita_liquida)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Período anterior: {formatBRL(crescimento.anterior)}
                </CardDescription>
                {crescimento.variacao !== null && (
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className={`font-bold ${
                        crescimento.variacao >= 0
                          ? 'text-green-600'
                          : 'text-red-600'
                      } text-base`}
                    >
                      {crescimento.variacao >= 0 ? '+' : ''}
                      {crescimento.variacao.toFixed(1)}%
                    </span>
                    <span className="text-xs text-gray-500">vs. anterior</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Valor Bruto Total */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Receipt size={18} className="text-blue-600" />
                  <CardTitle className="text-sm font-bold text-blue-700">
                    Faturamento Bruto
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-xl font-extrabold text-blue-600 mb-0.5">
                  {formatBRL(dadosConsolidados.valor_bruto_saida)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Sem descontos (saídas)
                </CardDescription>
              </CardContent>
            </Card>

            {/* Descontos Dados */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <TrendUp size={18} className="text-orange-600" />
                  <CardTitle className="text-sm font-bold text-orange-700">
                    Descontos Dados
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-xl font-extrabold text-orange-600 mb-0.5">
                  {formatBRL(dadosConsolidados.desconto_total)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Total de descontos
                </CardDescription>
              </CardContent>
            </Card>

            {/* Devoluções */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <ArrowDown size={18} className="text-red-600" />
                  <CardTitle className="text-sm font-bold text-red-700">
                    Devoluções
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-xl font-extrabold text-red-600 mb-0.5">
                  {formatBRL(Math.abs(dadosConsolidados.valor_liquido_entrada))}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Valores devolvidos
                </CardDescription>
              </CardContent>
            </Card>
          </div>

          {/* Card Detalhado */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl rounded-xl bg-white mb-6">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CarProfile size={20} className="text-[#000638]" />
                <CardTitle className="text-lg font-bold text-[#000638]">
                  Detalhamento Multimarcas
                </CardTitle>
              </div>
              <CardDescription>
                Resumo financeiro completo do canal Multimarcas
              </CardDescription>
            </CardHeader>
            <CardContent className="bg-white">
              <div className="space-y-3">
                {/* Vendas - Saída */}
                <div className="border-b pb-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-semibold text-blue-700">
                      VENDAS (SAÍDA)
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-600">
                      Valor Bruto:
                    </span>
                    <span className="font-bold text-blue-600 text-sm">
                      {formatBRL(dadosConsolidados.valor_bruto_saida)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-600">
                      Valor Líquido:
                    </span>
                    <span className="font-bold text-green-600 text-sm">
                      {formatBRL(dadosConsolidados.valor_liquido_saida)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-600">
                      Descontos:
                    </span>
                    <span className="font-bold text-orange-600 text-sm">
                      {formatBRL(dadosConsolidados.desconto_saida)}
                    </span>
                  </div>
                </div>

                {/* Devoluções - Entrada */}
                <div className="border-b pb-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-semibold text-red-700">
                      DEVOLUÇÕES (ENTRADA)
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-600">
                      Valor Bruto:
                    </span>
                    <span className="font-bold text-red-600 text-sm">
                      {formatBRL(
                        Math.abs(dadosConsolidados.valor_bruto_entrada),
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-600">
                      Valor Líquido:
                    </span>
                    <span className="font-bold text-red-500 text-sm">
                      {formatBRL(
                        Math.abs(dadosConsolidados.valor_liquido_entrada),
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-600">
                      Descontos:
                    </span>
                    <span className="font-bold text-orange-600 text-sm">
                      {formatBRL(Math.abs(dadosConsolidados.desconto_entrada))}
                    </span>
                  </div>
                </div>

                {/* Total Geral */}
                <div className="border-t pt-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-bold text-gray-800">
                      RECEITA LÍQUIDA
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-600">
                      Vendas - Devoluções:
                    </span>
                    <span className="font-bold text-green-600 text-lg">
                      {formatBRL(dadosConsolidados.receita_liquida)}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Gráfico de Pizza - Por Empresa */}
            {dadosPizzaEmpresa && (
              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={() =>
                  setModalGrafico({
                    title: 'Multimarcas - Faturamento por Empresa',
                    data: dadosPizzaEmpresa,
                  })
                }
              >
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <ChartPieSlice size={20} className="text-[#000638]" />
                    <CardTitle className="text-lg font-bold text-[#000638]">
                      Multimarcas - Faturamento por Empresa
                    </CardTitle>
                  </div>
                  <CardDescription>
                    Distribuição do faturamento por empresa (Multimarcas)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80 bg-white rounded">
                    <Pie data={dadosPizzaEmpresa} options={opcoesPizza} />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Gráfico de Barras */}
            {dadosBarras && (
              <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <ChartLineUp size={20} className="text-[#000638]" />
                    <CardTitle className="text-lg font-bold text-[#000638]">
                      Comparativo de Valores
                    </CardTitle>
                  </div>
                  <CardDescription>
                    Bruto vs Líquido vs Descontos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80 bg-white rounded">
                    <Bar data={dadosBarras} options={opcoesBarras} />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Modal para gráfico ampliado */}
          {modalGrafico && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
              <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-3xl w-full flex flex-col items-center relative">
                <button
                  onClick={() => setModalGrafico(null)}
                  className="absolute top-4 right-4 text-gray-500 hover:text-red-600 text-2xl font-bold"
                  aria-label="Fechar"
                >
                  &times;
                </button>
                <div className="mb-4 flex items-center gap-2">
                  <ChartPieSlice size={28} className="text-[#000638]" />
                  <span className="text-2xl font-bold text-[#000638]">
                    {modalGrafico.title}
                  </span>
                </div>
                <div
                  className="w-full flex items-center justify-center"
                  style={{ height: '480px' }}
                >
                  <Pie data={modalGrafico.data} options={opcoesPizza} />
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-gray-50 rounded-xl p-8 max-w-md">
            <ChartLineUp size={48} className="text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              Nenhum dado encontrado
            </h3>
            <p className="text-gray-500 text-sm mb-4">
              Selecione um período e clique em "Buscar Dados" para visualizar o
              dashboard de Multimarcas.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardMultimarcas;
