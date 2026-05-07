import React, { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import useApiClient from '../hooks/useApiClient';
import PageTitle from '../components/ui/PageTitle';
import {
  ChartLineUp,
  Money,
  Buildings,
  Users,
  Trophy,
  TrendUp,
  ShoppingCart,
  Spinner,
} from '@phosphor-icons/react';

const Dashboard = () => {
  const { user } = useAuth();
  const apiClient = useApiClient();

  const [stats, setStats] = useState({
    faturamentoTotal: { value: 'R$ 0', change: '0%', changeType: 'neutral' },
    lojasAtivas: { value: '0', change: '0', changeType: 'neutral' },
  });

  const [loading, setLoading] = useState(true);
  const [selectedBiPanel, setSelectedBiPanel] = useState(0);

  // Array com todos os painéis BI
  const biPanels = [
    {
      id: 1,
      title: 'Gestão PCP',
      description: 'Métricas detalhadas de PCP',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiMzczYTRkZjgtNTUwYS00ZWEzLTkzYTEtZDdhNTE3MGNmMTc3IiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 2,
      title: 'Funil de Franquias',
      description: 'Painel de Funil das Franquias',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiNjA1YjhkOGItYTgxYi00OGIzLTk4MDEtNTUyNzE0MjE2N2ZhIiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 3,
      title: 'Indicadores de Cashback',
      description: 'Análise de Cashback utilizado pelos clientes',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiYzE4NzZjZTEtYzRhNS00Y2I0LWEwYzEtMmI1ZDU3MThmNGQyIiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 4,
      title: 'Performance Operacional',
      description: 'Métricas de eficiência e produtividade',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiZDcxODA0OTMtYWY3ZC00MzY2LWFmODAtZGRiMzY4MTYwMzE3IiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 5,
      title: 'Indicadores do Vigia',
      description: 'Análise detalhada do Vigia',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiZTlkNDZkZjYtOTRmNC00MzMxLWJhMTAtM2U4NWQ4OWRlNzY5IiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 6,
      title: 'Looker Studio Rafael',
      description: 'Relatórios avançados de Rafael',
      url: 'https://lookerstudio.google.com/embed/reporting/fa465a90-1e72-4284-aa8a-2f5ba9cbf86b/page/ghwBE',
    },
    {
      id: 7,
      title: 'AÇÕES DOS CARTÕES',
      description: 'Painel de ações dos cartões',
      url: 'https://app.clickup.com/9011116713/v/db/8chnen9-886151',
    },
    {
      id: 8,
      title: 'RELATÓRIO DE VENDAS PROMO',
      description: 'Relatório de vendas promocionais',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiMjFjZTZlZjAtMmViYy00NTNlLWJiNWItM2I4MzE1OTQ1ZjgzIiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 9,
      title: 'FATURAMENTO REVENDA',
      description: 'Faturamento Revenda',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiYmM1ODkyNWEtMzJkZC00YjFmLWE5YmEtMDQ4MzkxOGFkNGU5IiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 10,
      title: 'CAC B2C',
      description: 'CAC B2C',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiYTMyMmExMWEtMGYzZS00MTNkLWIyMGYtMDg1NjZmZjc0OTQ3IiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 11,
      title: 'REATIVACAO CASHBACK',
      description: 'Relatório de reativação por cashback',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiYzE4NzZjZTEtYzRhNS00Y2I0LWEwYzEtMmI1ZDU3MThmNGQyIiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 12,
      title: 'TIPO CLIENTE',
      description: 'Análise por tipo de cliente',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiNjA1YjhkOGItYTgxYi00OGIzLTk4MDEtNTUyNzE0MjE2N2ZhIiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 13,
      title: 'COHORT',
      description: 'Análise de cohort',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiZDcxODA0OTMtYWY3ZC00MzY2LWFmODAtZGRiMzY4MTYwMzE3IiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 14,
      title: 'CRONOGRAMA SHOWROOM',
      description: 'Cronograma do showroom',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiYmI2NDQ0MTQtMjdiNy00M2MxLWFmYjYtYTE5YzY0N2YwMThmIiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 15,
      title: 'RH',
      description: 'Relatórios de RH',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiNDJmMmMyY2MtNDM4ZC00MzQ4LWI2ZTQtNWYwMjc0Y2QzYzFmIiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 16,
      title: 'ESTOQUE FILIAIS E LV',
      description: 'Estoque filiais e LV',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiYmY4MGQxMzItNDJiNi00MDQ3LWJkMjAtZjJlZTM2OTRiYTdlIiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
    {
      id: 17,
      title: 'DASHBOARD EXPEDIÇÃO',
      description: 'Dashboard de expedição',
      url: 'https://app.powerbi.com/view?r=eyJrIjoiYmY4MGQxMzItNDJiNi00MDQ3LWJkMjAtZjJlZTM2OTRiYTdlIiwidCI6IjRhZWQyODQ0LWFkZTktNDUzMC1hN2U4LWJmNzM3MjhmMTM4NSJ9',
    },
  ];

  // Função para formatar valores monetários
  const formatCurrency = (value) => {
    if (typeof value === 'number') {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(value);
    }
    return value;
  };

  // Função para calcular a data de hoje e de 2 meses atrás
  const getDateRange = () => {
    const hoje = new Date();
    const doisMesesAtras = new Date();
    doisMesesAtras.setMonth(hoje.getMonth() - 2);

    // Calcular primeiro e último dia do mês atual
    const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

    return {
      hoje: hoje.toISOString().split('T')[0],
      doisMesesAtras: doisMesesAtras.toISOString().split('T')[0],
      primeiroDiaMes: primeiroDiaMes.toISOString().split('T')[0],
      ultimoDiaMes: ultimoDiaMes.toISOString().split('T')[0],
    };
  };

  // Função para buscar dados do faturamento
  const buscarFaturamento = async () => {
    try {
      const { primeiroDiaMes, ultimoDiaMes } = getDateRange();
      const params = {
        dt_inicio: primeiroDiaMes,
        dt_fim: ultimoDiaMes,
        cd_grupoempresa_ini: 1,
        cd_grupoempresa_fim: 9999,
      };

      const result = await apiClient.company.faturamentoLojas(params);

      if (result.success && result.data) {
        const totalFaturamento = result.data.reduce(
          (acc, item) => acc + parseFloat(item.faturamento || 0),
          0,
        );
        setStats((prev) => ({
          ...prev,
          faturamentoTotal: {
            value: formatCurrency(totalFaturamento),
            change: '+0%',
            changeType: 'positive',
          },
        }));
      } else {
        console.warn('API de faturamento não retornou dados válidos:', result);
      }
    } catch (error) {
      console.error('Erro ao buscar faturamento:', error);
    }
  };

  // Função para buscar número de lojas ativas
  const buscarLojasAtivas = async () => {
    try {
      const { doisMesesAtras, hoje } = getDateRange();
      const params = {
        dt_inicio: doisMesesAtras,
        dt_fim: hoje,
        cd_grupoempresa_ini: 1,
        cd_grupoempresa_fim: 9999,
      };

      const result = await apiClient.company.faturamentoLojas(params);

      if (result.success && result.data) {
        // Contar lojas únicas que tiveram faturamento
        const lojasUnicas = new Set(
          result.data.map(
            (item) => item.cd_grupoempresa || item.nm_grupoempresa,
          ),
        );
        setStats((prev) => ({
          ...prev,
          lojasAtivas: {
            value: lojasUnicas.size.toString(),
            change: '+0',
            changeType: 'positive',
          },
        }));
      } else {
        console.warn('API de lojas ativas não retornou dados válidos:', result);
      }
    } catch (error) {
      console.error('Erro ao buscar lojas ativas:', error);
    }
  };

  // Carregar todos os dados
  useEffect(() => {
    const carregarDados = async () => {
      setLoading(true);
      try {
        await Promise.all([buscarFaturamento(), buscarLojasAtivas()]);
      } catch (error) {
        console.error('Erro ao carregar dados do dashboard:', error);
      } finally {
        setLoading(false);
      }
    };

    carregarDados();
  }, []);

  const statsCards = [
    {
      title: 'Faturamento Total',
      value: stats.faturamentoTotal.value,
      change: stats.faturamentoTotal.change,
      changeType: stats.faturamentoTotal.changeType,
      icon: ChartLineUp,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: 'Lojas Ativas',
      value: stats.lojasAtivas.value,
      change: stats.lojasAtivas.change,
      changeType: stats.lojasAtivas.changeType,
      icon: Buildings,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
  ];

  const quickActions = [
    {
      title: 'Ranking Faturamento',
      description: 'Visualizar ranking de faturamento',
      icon: Trophy,
      href: '/ranking-faturamento',
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
    },
    {
      title: 'Consolidado',
      description: 'Relatório consolidado geral',
      icon: ChartLineUp,
      href: '/consolidado',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: 'Fluxo de Caixa',
      description: 'Análise do fluxo de caixa',
      icon: TrendUp,
      href: '/fluxo-caixa',
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
    },
    {
      title: 'Contas a Pagar',
      description: 'Gestão de contas a pagar',
      icon: Money,
      href: '/contas-pagar',
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
    {
      title: 'Looker Studio',
      description: 'Relatórios avançados do Google',
      icon: ChartLineUp,
      href: 'https://lookerstudio.google.com/embed/reporting/fa465a90-1e72-4284-aa8a-2f5ba9cbf86b/page/ghwBE',
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      external: true,
    },
  ];

  return (
    <div className="w-full flex flex-col items-stretch justify-start py-3 px-2">
      <div className="w-full max-auto p-10">
        {/* Header */}
        <PageTitle
          title="BI Externo"
          subtitle={`Bem-vindo, ${user?.name}. Aqui está um resumo dos principais BI que ainda não estão no HEADCOACH.`}
          icon={ChartLineUp}
          iconColor="text-indigo-600"
        />

        {/* Painel BI */}
        <div className="w-full mt-4 bg-white rounded-lg shadow-sm border border-gray-200 p-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900 font-barlow">
              Painel BI
            </h2>
          </div>

          {/* Filtro de seleção do painel */}
          <div className="mb-3">
            <label
              htmlFor="bi-panel-select"
              className="block text-sm font-medium text-gray-700 mb-2 font-barlow"
            >
              Selecione o Painel BI
            </label>
            <select
              id="bi-panel-select"
              value={selectedBiPanel}
              onChange={(e) => setSelectedBiPanel(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-barlow"
              disabled={loading}
            >
              {biPanels.map((panel, index) => (
                <option key={panel.id} value={index}>
                  {panel.title}
                </option>
              ))}
            </select>
          </div>

          {/* Título do painel atual */}
          <div className="mb-2">
            <h3 className="text-sm font-semibold text-gray-900 font-barlow">
              {biPanels[selectedBiPanel].title}
            </h3>
            <p className="text-xs text-gray-600 font-barlow">
              {biPanels[selectedBiPanel].description}
            </p>
          </div>

          {/* Iframe do Power BI ou Botão para ClickUp */}
          <div className="w-full">
            {biPanels[selectedBiPanel].title === 'AÇÕES DOS CARTÕES' ? (
              // Botão para ClickUp
              <div className="flex flex-col items-center justify-center py-8 bg-gray-50 rounded-lg border border-gray-200">
                <div className="text-center mb-4">
                  <h3 className="text-base font-semibold text-gray-900 mb-1 font-barlow">
                    Acessar ClickUp - Ações dos Cartões
                  </h3>
                  <p className="text-xs text-gray-600 font-barlow">
                    Clique no botão abaixo para abrir o painel no ClickUp em uma
                    nova aba
                  </p>
                </div>
                <a
                  href={biPanels[selectedBiPanel].url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors duration-200 font-barlow"
                >
                  <ShoppingCart size={20} className="mr-2" />
                  IR ATÉ O LINK
                </a>
              </div>
            ) : (
              // Iframe para Power BI/Looker Studio
              <>
                <div className="relative w-full" style={{ height: '600px' }}>
                  <iframe
                    title={`Painel BI - ${biPanels[selectedBiPanel].title}`}
                    src={biPanels[selectedBiPanel].url}
                    className="w-full h-full rounded-lg border border-gray-200"
                    frameBorder="0"
                    allowFullScreen
                    loading="lazy"
                  />
                </div>
                <div className="mt-2 text-center">
                  <p className="text-xs text-gray-600 font-barlow">
                    Painel de Business Intelligence integrado - Visualize dados
                    em tempo real
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
