import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Trophy,
  Funnel,
  Spinner,
  MagnifyingGlass,
  User,
  CurrencyDollar,
  ShoppingCart,
  Storefront,
  CaretUp,
  CaretDown,
  CaretUpDown,
  FileArrowDown,
  Calendar,
  X,
  ArrowLeft,
  Receipt,
} from '@phosphor-icons/react';
import PageTitle from '../components/ui/PageTitle';
import FiltroEmpresa from '../components/FiltroEmpresa';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import useApiClient from '../hooks/useApiClient';

const formatBRL = (v) =>
  typeof v === 'number'
    ? v.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '—';

const formatInt = (v) =>
  typeof v === 'number' ? v.toLocaleString('pt-BR') : '—';

export default function TopClientes() {
  const apiClient = useApiClient();

  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [branches, setBranches] = useState([]);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [orderByQuantity, setOrderByQuantity] = useState(false);
  const [returnItensQuantity, setReturnItensQuantity] = useState(50);

  // Modal
  const [modalBranch, setModalBranch] = useState(null);
  const [busca, setBusca] = useState('');
  const [sortField, setSortField] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  // Sub-modal: transações do cliente
  const [selectedClient, setSelectedClient] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [txErro, setTxErro] = useState('');

  // Ordenação da tabela de lojas
  const [ordenacao, setOrdenacao] = useState({ campo: null, direcao: 'asc' });

  // Modal de aviso de pesquisa demorada
  const [showSlowWarning, setShowSlowWarning] = useState(false);

  // CSS customizado para a tabela (padrão do projeto)
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .tc-table-container { overflow-x: auto; position: relative; max-width: 100%; }
      .tc-table { border-collapse: collapse; width: 100%; }
      .tc-table th, .tc-table td { padding: 3px 4px !important; border-right: 1px solid #f3f4f6; word-wrap: break-word; white-space: normal; font-size: 9px; line-height: 1.2; }
      .tc-table th:last-child, .tc-table td:last-child { border-right: none; }
      .tc-table th { background-color: #000638; color: white; font-weight: 600; text-transform: uppercase; font-size: 8px; letter-spacing: 0.05em; }
      .tc-table tbody tr:nth-child(odd) { background-color: white; }
      .tc-table tbody tr:nth-child(even) { background-color: #f9fafb; }
      .tc-table tbody tr:hover { background-color: #f3f4f6; }
      .tc-table thead th:first-child, .tc-table tbody td:first-child { position: sticky; left: 0; z-index: 10; background-color: inherit; }
      .tc-table thead th:first-child { background-color: #000638; }
      .tc-table tbody tr:nth-child(even) td:first-child { background-color: #f9fafb; }
      .tc-table tbody tr:nth-child(odd) td:first-child { background-color: white; }
      .tc-table tbody tr:hover td:first-child { background-color: #f3f4f6; }
    `;
    document.head.appendChild(styleElement);
    return () => document.head.removeChild(styleElement);
  }, []);

  useEffect(() => {
    const hoje = new Date();
    const primeiro = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    setDataInicio(primeiro.toISOString().split('T')[0]);
    setDataFim(hoje.toISOString().split('T')[0]);
  }, []);

  const executarBusca = async () => {
    setShowSlowWarning(false);
    setLoading(true);
    setErro('');
    setBranches([]);
    setDadosCarregados(false);

    try {
      const branchs =
        empresasSelecionadas.length > 0
          ? empresasSelecionadas.map((e) => parseInt(e.cd_empresa))
          : [0];

      const body = {
        branchs,
        datemin: `${dataInicio}T00:00:00.000Z`,
        datemax: `${dataFim}T23:59:59.999Z`,
        orderByQuantity,
        returnItensQuantity: returnItensQuantity || 50,
      };

      const result = await apiClient.totvs.sellerPanelTopCustomers(body);

      if (result && result.success !== false) {
        const payload = result.data ?? result;
        const list = payload.branches ?? payload ?? [];
        setBranches(Array.isArray(list) ? list : []);
        setDadosCarregados(true);
      } else {
        setErro(result?.message || 'Erro ao buscar dados.');
      }
    } catch (err) {
      setErro(err.message || 'Erro ao conectar com a API.');
    } finally {
      setLoading(false);
    }
  };

  const handleBuscar = (e) => {
    if (e) e.preventDefault();
    if (!dataInicio || !dataFim) {
      setErro('Informe as datas de início e fim.');
      return;
    }

    // Verificar se a pesquisa pode ser demorada
    const inicio = new Date(dataInicio);
    const fim = new Date(dataFim);
    const diffMeses = (fim - inicio) / (1000 * 60 * 60 * 24 * 30.44);
    const qtdEmpresas = empresasSelecionadas.length;
    const pesquisaDemorada = diffMeses > 3 || qtdEmpresas > 2;

    if (pesquisaDemorada) {
      setShowSlowWarning(true);
      return;
    }

    executarBusca();
  };

  const openModal = (branch) => {
    setModalBranch(branch);
    setBusca('');
    setSortField(null);
    setSortAsc(true);
  };

  const closeModal = () => {
    setModalBranch(null);
    setSelectedClient(null);
    setTransactions([]);
    setTxErro('');
  };

  const handleClientClick = async (cliente) => {
    if (!modalBranch) return;
    setSelectedClient(cliente);
    setTransactions([]);
    setTxErro('');
    setLoadingTx(true);
    try {
      const body = {
        personCode: cliente.personCode || cliente.code,
        branchCodes: modalBranch.branchCodes || [modalBranch.branchCode],
        datemin: `${dataInicio}T00:00:00.000Z`,
        datemax: `${dataFim}T23:59:59.999Z`,
      };
      const result =
        await apiClient.totvs.sellerPanelTopCustomersTransactions(body);
      if (result && result.success !== false) {
        const payload = result.data ?? result;
        setTransactions(payload.transactions || []);
      } else {
        setTxErro(result?.message || 'Erro ao buscar transações.');
      }
    } catch (err) {
      setTxErro(err.message || 'Erro ao conectar com a API.');
    } finally {
      setLoadingTx(false);
    }
  };

  const handleBackToClients = () => {
    setSelectedClient(null);
    setTransactions([]);
    setTxErro('');
  };

  const handleSort = useCallback((field) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortAsc((a) => !a);
        return field;
      }
      setSortAsc(field === 'name');
      return field;
    });
  }, []);

  // Ordenação da tabela de lojas
  const handleSortBranch = useCallback((campo) => {
    setOrdenacao((prev) => ({
      campo,
      direcao: prev.campo === campo && prev.direcao === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const getSortIcon = useCallback(
    (campo) => {
      if (ordenacao.campo !== campo) {
        return <CaretUpDown size={12} className="opacity-50" />;
      }
      return ordenacao.direcao === 'asc' ? (
        <CaretUp size={12} />
      ) : (
        <CaretDown size={12} />
      );
    },
    [ordenacao],
  );

  const getFilteredClients = () => {
    if (!modalBranch) return [];
    return modalBranch.clients
      .filter((c) => {
        if (!busca) return true;
        const q = busca.toLowerCase();
        return (
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.code && String(c.code).toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (!sortField) return 0;
        const dir = sortAsc ? 1 : -1;
        if (sortField === 'name' || sortField === 'code') {
          return (
            dir *
            String(a[sortField] || '').localeCompare(String(b[sortField] || ''))
          );
        }
        return dir * ((a[sortField] || 0) - (b[sortField] || 0));
      });
  };

  const handleExportCSV = () => {
    const clients = getFilteredClients();
    if (clients.length === 0) return;
    const headers = [
      'Código',
      'Nome',
      'Compras',
      'Freq. Média (meses)',
      'Qtd. Itens',
      'Valor Bruto',
      'Desconto',
      'Valor Líquido',
    ];
    const rows = clients.map((c) => [
      c.code,
      c.name,
      c.purchaseCount || 0,
      c.avgPurchaseIntervalMonths || 0,
      c.quantity,
      c.grossValue,
      c.discountValue,
      c.netValue,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `top_clientes_${modalBranch.branchName}_${dataInicio}_${dataFim}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortAsc ? <CaretUp size={12} /> : <CaretDown size={12} />;
  };

  // Branches ordenadas pela tabela
  const branchesOrdenadas = useMemo(() => {
    if (!ordenacao.campo) return branches;
    const sorted = [...branches].sort((a, b) => {
      const dir = ordenacao.direcao === 'asc' ? 1 : -1;
      const campo = ordenacao.campo;
      if (campo === 'branchName') {
        return dir * (a.branchName || '').localeCompare(b.branchName || '');
      }
      if (campo === 'totalClients')
        return dir * ((a.totalClients || 0) - (b.totalClients || 0));
      if (campo === 'invoiceQty')
        return (
          dir * ((a.ranking?.invoiceQty || 0) - (b.ranking?.invoiceQty || 0))
        );
      if (campo === 'invoiceValue')
        return (
          dir *
          ((a.ranking?.invoiceValue || 0) - (b.ranking?.invoiceValue || 0))
        );
      if (campo === 'tm')
        return dir * ((a.ranking?.tm || 0) - (b.ranking?.tm || 0));
      if (campo === 'pa')
        return dir * ((a.ranking?.pa || 0) - (b.ranking?.pa || 0));
      if (campo === 'totalNetValue')
        return dir * ((a.totalNetValue || 0) - (b.totalNetValue || 0));
      if (campo === 'totalQuantity')
        return dir * ((a.totalQuantity || 0) - (b.totalQuantity || 0));
      return 0;
    });
    return sorted;
  }, [branches, ordenacao]);

  // Totalizadores gerais
  const totalClientes = branches.reduce(
    (acc, b) => acc + (b.totalClients || 0),
    0,
  );
  const totalRankingFaturamento = branches.reduce(
    (acc, b) => acc + (b.ranking?.invoiceValue || 0),
    0,
  );
  const totalRankingVendas = branches.reduce(
    (acc, b) => acc + (b.ranking?.invoiceQty || 0),
    0,
  );
  const totalRankingTM =
    totalRankingVendas > 0 ? totalRankingFaturamento / totalRankingVendas : 0;
  const totalRankingItens = branches.reduce(
    (acc, b) => acc + (b.ranking?.itensQty || 0),
    0,
  );
  const totalRankingPA =
    totalRankingVendas > 0 ? totalRankingItens / totalRankingVendas : 0;

  const filteredClients = getFilteredClients();

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      {/* Modal de aviso — pesquisa demorada */}
      {showSlowWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <span className="text-amber-600 text-xl">⚠️</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-[#000638]">
                  Pesquisa pode demorar
                </h3>
                <p className="text-xs text-gray-600 mt-1">
                  {empresasSelecionadas.length > 2 &&
                  (() => {
                    const inicio = new Date(dataInicio);
                    const fim = new Date(dataFim);
                    const diffMeses =
                      (fim - inicio) / (1000 * 60 * 60 * 24 * 30.44);
                    return diffMeses > 3;
                  })()
                    ? `Você selecionou ${empresasSelecionadas.length} empresa${empresasSelecionadas.length > 1 ? 's' : ''} e um período de mais de 3 meses.`
                    : empresasSelecionadas.length > 2
                      ? `Você selecionou ${empresasSelecionadas.length} empresas.`
                      : 'O período selecionado é superior a 3 meses.'}{' '}
                  Isso pode resultar em uma grande quantidade de dados e levar
                  vários minutos para carregar.
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Deseja continuar mesmo assim?
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowSlowWarning(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executarBusca}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#000638] text-white hover:bg-[#000638]/80 transition-colors"
              >
                Pesquisar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}

      <PageTitle
        title="Top Clientes"
        subtitle="Acompanhe os melhores clientes por loja de varejo"
        icon={Trophy}
        iconColor="text-blue-600"
      />

      {/* Formulário de Filtros */}
      <div className="mb-4">
        <form
          onSubmit={handleBuscar}
          className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full max-w-4xl mx-auto border border-[#000638]/10"
        >
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" />
              Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Selecione o período e empresa para análise
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 mb-3">
            <div>
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={setEmpresasSelecionadas}
              />
            </div>
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
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Qtd. Clientes/Loja
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={returnItensQuantity}
                onChange={(e) =>
                  setReturnItensQuantity(parseInt(e.target.value) || 50)
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={orderByQuantity}
                  onChange={(e) => setOrderByQuantity(e.target.checked)}
                  className="rounded border-[#000638]/30 text-[#000638] focus:ring-[#000638]"
                />
                <span className="text-xs text-[#000638]">Ordenar por qtd.</span>
              </label>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase"
                disabled={loading || !dataInicio || !dataFim}
              >
                {loading ? (
                  <>
                    <Spinner size={10} className="animate-spin" />
                  </>
                ) : (
                  <>
                    <Calendar size={10} />
                    <span>Buscar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Erro */}
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 mb-4">
          {erro}
        </div>
      )}

      {/* Cards de Resumo */}
      {branches.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-6 max-w-4xl mx-auto">
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Storefront size={14} className="text-blue-600" />
                <CardTitle className="text-xs font-bold text-blue-700">
                  Lojas
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-blue-600 mb-0.5">
                {formatInt(branches.length)}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Lojas de varejo
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-green-600" />
                <CardTitle className="text-xs font-bold text-green-700">
                  Faturamento
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-green-600 mb-0.5 break-words">
                {totalRankingFaturamento.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Faturamento total
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <User size={14} className="text-purple-600" />
                <CardTitle className="text-xs font-bold text-purple-700">
                  Clientes
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-purple-600 mb-0.5">
                {formatInt(totalClientes)}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Total de clientes
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <ShoppingCart size={14} className="text-orange-600" />
                <CardTitle className="text-xs font-bold text-orange-700">
                  Vendas
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-orange-600 mb-0.5">
                {formatInt(totalRankingVendas)}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Total de vendas
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-cyan-600" />
                <CardTitle className="text-xs font-bold text-cyan-700">
                  TM
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-cyan-600 mb-0.5 break-words">
                {totalRankingTM.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Ticket médio
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <ShoppingCart size={14} className="text-pink-600" />
                <CardTitle className="text-xs font-bold text-pink-700">
                  PA
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-pink-600 mb-0.5">
                {formatBRL(totalRankingPA)}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Peças por atendimento
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabela de Lojas */}
      <div className="bg-white rounded-lg shadow-md border border-[#000638]/10 max-w-4xl mx-auto w-full">
        <div className="p-3 border-b border-[#000638]/10 flex justify-between items-center">
          <h2 className="text-sm font-bold text-[#000638] font-barlow">
            Ranking por Loja
          </h2>
          <div className="text-xs text-gray-600">
            {dadosCarregados
              ? `${branches.length} lojas encontradas`
              : 'Nenhum dado carregado'}
          </div>
        </div>

        <div className="p-3">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="flex items-center gap-3">
                <Spinner size={18} className="animate-spin text-blue-600" />
                <span className="text-sm text-gray-600">
                  Carregando dados...
                </span>
              </div>
            </div>
          ) : !dadosCarregados ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="text-gray-500 text-sm mb-2">
                  Clique em "Buscar" para carregar as informações
                </div>
                <div className="text-gray-400 text-xs">
                  Selecione o período e empresa desejados
                </div>
              </div>
            </div>
          ) : branches.length === 0 ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="text-gray-500 text-sm mb-2">
                  Nenhum dado encontrado
                </div>
                <div className="text-gray-400 text-xs">
                  Verifique o período selecionado ou tente novamente
                </div>
              </div>
            </div>
          ) : (
            <div className="tc-table-container max-w-full mx-auto">
              <table className="border-collapse rounded-lg overflow-hidden shadow-lg tc-table">
                <thead className="bg-[#000638] text-white text-xs uppercase tracking-wider">
                  <tr>
                    <th
                      className="px-1 py-0.5 text-left text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSortBranch('branchName')}
                    >
                      <div className="flex items-center">
                        Loja {getSortIcon('branchName')}
                      </div>
                    </th>
                    <th
                      className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSortBranch('totalClients')}
                    >
                      <div className="flex items-center justify-center">
                        Clientes {getSortIcon('totalClients')}
                      </div>
                    </th>
                    <th
                      className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSortBranch('invoiceValue')}
                    >
                      <div className="flex items-center justify-center">
                        Faturamento {getSortIcon('invoiceValue')}
                      </div>
                    </th>
                    <th
                      className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSortBranch('invoiceQty')}
                    >
                      <div className="flex items-center justify-center">
                        Vendas {getSortIcon('invoiceQty')}
                      </div>
                    </th>
                    <th
                      className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSortBranch('tm')}
                    >
                      <div className="flex items-center justify-center">
                        TM {getSortIcon('tm')}
                      </div>
                    </th>
                    <th
                      className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSortBranch('pa')}
                    >
                      <div className="flex items-center justify-center">
                        PA {getSortIcon('pa')}
                      </div>
                    </th>
                    <th
                      className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSortBranch('totalQuantity')}
                    >
                      <div className="flex items-center justify-center">
                        Itens {getSortIcon('totalQuantity')}
                      </div>
                    </th>
                    <th
                      className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSortBranch('totalNetValue')}
                    >
                      <div className="flex items-center justify-center">
                        Vlr. Líquido {getSortIcon('totalNetValue')}
                      </div>
                    </th>
                    <th className="px-1 py-0.5 text-center text-[8px]">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {branchesOrdenadas.map((branch, idx) => (
                    <tr
                      key={branch.branchCodes?.join('-') || branch.branchCode}
                      className="cursor-pointer"
                      onClick={() => openModal(branch)}
                    >
                      <td className="px-1 py-0.5 text-left font-semibold text-[#000638]">
                        <div className="flex flex-col">
                          <span>{branch.branchName}</span>
                          <span className="text-[7px] text-gray-400 font-normal">
                            Cód.{' '}
                            {(branch.branchCodes || [branch.branchCode]).join(
                              ', ',
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-1 py-0.5 text-center font-bold text-purple-700">
                        {branch.totalClients}
                      </td>
                      <td className="px-1 py-0.5 text-center font-bold text-green-700">
                        {(branch.ranking?.invoiceValue || 0).toLocaleString(
                          'pt-BR',
                          { style: 'currency', currency: 'BRL' },
                        )}
                      </td>
                      <td className="px-1 py-0.5 text-center text-orange-700 font-bold">
                        {formatInt(branch.ranking?.invoiceQty || 0)}
                      </td>
                      <td className="px-1 py-0.5 text-center text-cyan-700 font-bold">
                        {(branch.ranking?.tm || 0).toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })}
                      </td>
                      <td className="px-1 py-0.5 text-center text-pink-700 font-bold">
                        {formatBRL(branch.ranking?.pa || 0)}
                      </td>
                      <td className="px-1 py-0.5 text-center text-gray-700">
                        {formatInt(branch.totalQuantity)}
                      </td>
                      <td className="px-1 py-0.5 text-center text-emerald-700 font-bold">
                        {(branch.totalNetValue || 0).toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })}
                      </td>
                      <td className="px-1 py-0.5 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openModal(branch);
                          }}
                          className="text-[#000638] hover:text-[#fe0000] transition-colors"
                          title="Ver clientes"
                        >
                          <MagnifyingGlass size={12} weight="bold" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal de Clientes */}
      {modalBranch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-lg shadow-2xl w-[95vw] max-w-5xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#000638]/10 bg-[#000638] rounded-t-lg">
              <div className="flex items-center gap-3">
                {selectedClient ? (
                  <button
                    onClick={handleBackToClients}
                    className="p-1 rounded-md hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                    title="Voltar para lista de clientes"
                  >
                    <ArrowLeft size={18} />
                  </button>
                ) : (
                  <Storefront size={18} className="text-white" />
                )}
                <div>
                  <h2 className="text-sm font-bold text-white">
                    {selectedClient
                      ? `${selectedClient.name} (${selectedClient.code})`
                      : modalBranch.branchName}
                  </h2>
                  <p className="text-[10px] text-white/70">
                    {selectedClient
                      ? `${modalBranch.branchName} | ${transactions.length} transações`
                      : `${modalBranch.totalClients} clientes | R$ ${formatBRL(modalBranch.totalNetValue)} faturado | TM: R$ ${formatBRL(modalBranch.ranking?.tm || 0)} | PA: ${formatBRL(modalBranch.ranking?.pa || 0)}`}
                  </p>
                </div>
              </div>
              <button
                onClick={closeModal}
                className="p-1 rounded-md hover:bg-white/20 text-white/70 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {selectedClient ? (
              /* ===== VISTA DE TRANSAÇÕES DO CLIENTE ===== */
              <>
                {/* Resumo do cliente */}
                <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-100 bg-gray-50 text-xs flex-wrap">
                  <span className="text-gray-600">
                    Compras:{' '}
                    <strong className="text-orange-700">
                      {selectedClient.purchaseCount || 0}
                    </strong>
                  </span>
                  <span className="text-gray-600">
                    Qtd. Itens:{' '}
                    <strong>{formatInt(selectedClient.quantity)}</strong>
                  </span>
                  <span className="text-gray-600">
                    Bruto:{' '}
                    <strong>R$ {formatBRL(selectedClient.grossValue)}</strong>
                  </span>
                  <span className="text-gray-600">
                    Desconto:{' '}
                    <strong className="text-red-600">
                      R$ {formatBRL(selectedClient.discountValue)}
                    </strong>
                  </span>
                  <span className="text-gray-600">
                    Líquido:{' '}
                    <strong className="text-emerald-700">
                      R$ {formatBRL(selectedClient.netValue)}
                    </strong>
                  </span>
                  {transactions.length > 0 && (
                    <span className="text-gray-500 ml-auto">
                      {transactions.length} transações na API
                    </span>
                  )}
                </div>

                {/* Tabela de transações */}
                <div className="flex-1 overflow-auto">
                  {loadingTx ? (
                    <div className="flex justify-center items-center py-12">
                      <Spinner
                        size={18}
                        className="animate-spin text-blue-600"
                      />
                      <span className="text-sm text-gray-600 ml-3">
                        Carregando transações...
                      </span>
                    </div>
                  ) : txErro ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 m-4">
                      {txErro}
                    </div>
                  ) : (
                    <div className="tc-table-container">
                      <table
                        className="border-collapse tc-table"
                        style={{ minWidth: '900px' }}
                      >
                        <thead className="bg-[#000638] text-white text-xs uppercase tracking-wider sticky top-0">
                          <tr>
                            <th className="px-1 py-0.5 text-center text-[8px] w-8">
                              #
                            </th>
                            <th className="px-1 py-0.5 text-center text-[8px]">
                              Data
                            </th>
                            <th className="px-1 py-0.5 text-center text-[8px]">
                              NF
                            </th>
                            <th className="px-1 py-0.5 text-center text-[8px]">
                              Série
                            </th>
                            <th className="px-1 py-0.5 text-center text-[8px]">
                              Filial
                            </th>
                            <th className="px-1 py-0.5 text-center text-[8px]">
                              Operação
                            </th>
                            <th className="px-1 py-0.5 text-center text-[8px]">
                              Tipo
                            </th>
                            <th className="px-1 py-0.5 text-left text-[8px]">
                              Produto
                            </th>
                            <th className="px-1 py-0.5 text-center text-[8px]">
                              Qtd.
                            </th>
                            <th className="px-1 py-0.5 text-center text-[8px]">
                              Bruto
                            </th>
                            <th className="px-1 py-0.5 text-center text-[8px]">
                              Desconto
                            </th>
                            <th className="px-1 py-0.5 text-center text-[8px]">
                              Líquido
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {transactions.map((tx, idx) => (
                            <tr key={idx}>
                              <td className="px-1 py-0.5 text-center text-gray-400 font-medium">
                                {idx + 1}
                              </td>
                              <td className="px-1 py-0.5 text-center text-gray-700">
                                {tx.movementDate
                                  ? new Date(
                                      tx.movementDate,
                                    ).toLocaleDateString('pt-BR')
                                  : '—'}
                              </td>
                              <td className="px-1 py-0.5 text-center font-mono text-gray-600">
                                {tx.invoiceNumber}
                              </td>
                              <td className="px-1 py-0.5 text-center text-gray-500">
                                {tx.invoiceSeries}
                              </td>
                              <td className="px-1 py-0.5 text-center text-gray-600">
                                {tx.branchCode}
                              </td>
                              <td
                                className="px-1 py-0.5 text-center text-gray-600"
                                title={tx.operationName}
                              >
                                {tx.operationCode}
                              </td>
                              <td className="px-1 py-0.5 text-center text-gray-500">
                                {tx.operationModel}
                              </td>
                              <td
                                className="px-1 py-0.5 text-left text-gray-700"
                                title={tx.productName}
                              >
                                <div className="truncate max-w-[200px]">
                                  {tx.productCode ? `${tx.productCode} - ` : ''}
                                  {tx.productName}
                                </div>
                              </td>
                              <td className="px-1 py-0.5 text-center text-gray-700">
                                {formatInt(tx.quantity)}
                              </td>
                              <td className="px-1 py-0.5 text-center text-gray-700">
                                R$ {formatBRL(tx.grossValue)}
                              </td>
                              <td className="px-1 py-0.5 text-center text-red-600">
                                R$ {formatBRL(tx.discountValue)}
                              </td>
                              <td className="px-1 py-0.5 text-center font-bold text-emerald-700">
                                R$ {formatBRL(tx.netValue)}
                              </td>
                            </tr>
                          ))}
                          {transactions.length === 0 && !loadingTx && (
                            <tr>
                              <td
                                colSpan={12}
                                className="px-4 py-8 text-center text-gray-400 text-sm"
                              >
                                Nenhuma transação encontrada.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* ===== VISTA DE LISTA DE CLIENTES ===== */
              <>
                {/* Toolbar */}
                <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
                  <div className="relative flex-1 max-w-xs">
                    <MagnifyingGlass
                      size={12}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                      type="text"
                      placeholder="Buscar cliente..."
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      className="w-full pl-7 pr-3 py-1 text-xs border border-[#000638]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638]"
                    />
                  </div>
                  <span className="text-xs text-gray-500">
                    {filteredClients.length} registros
                  </span>
                  <button
                    onClick={handleExportCSV}
                    className="flex items-center gap-1 bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 transition-colors font-medium text-xs"
                    title="Exportar CSV"
                  >
                    <FileArrowDown size={12} /> CSV
                  </button>
                </div>

                {/* Tabela */}
                <div className="flex-1 overflow-auto">
                  <div className="tc-table-container">
                    <table
                      className="border-collapse tc-table"
                      style={{ minWidth: '700px' }}
                    >
                      <thead className="bg-[#000638] text-white text-xs uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="px-1 py-0.5 text-center text-[8px] w-8">
                            #
                          </th>
                          <th
                            className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('code')}
                          >
                            <div className="flex items-center justify-center">
                              Código <SortIcon field="code" />
                            </div>
                          </th>
                          <th
                            className="px-1 py-0.5 text-left text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('name')}
                          >
                            <div className="flex items-center">
                              Nome <SortIcon field="name" />
                            </div>
                          </th>
                          <th
                            className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('purchaseCount')}
                          >
                            <div className="flex items-center justify-center">
                              Compras <SortIcon field="purchaseCount" />
                            </div>
                          </th>
                          <th
                            className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() =>
                              handleSort('avgPurchaseIntervalMonths')
                            }
                          >
                            <div className="flex items-center justify-center">
                              Freq. Média{' '}
                              <SortIcon field="avgPurchaseIntervalMonths" />
                            </div>
                          </th>
                          <th
                            className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('quantity')}
                          >
                            <div className="flex items-center justify-center">
                              Qtd. Itens <SortIcon field="quantity" />
                            </div>
                          </th>
                          <th
                            className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('grossValue')}
                          >
                            <div className="flex items-center justify-center">
                              Valor Bruto <SortIcon field="grossValue" />
                            </div>
                          </th>
                          <th
                            className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('discountValue')}
                          >
                            <div className="flex items-center justify-center">
                              Desconto <SortIcon field="discountValue" />
                            </div>
                          </th>
                          <th
                            className="px-1 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('netValue')}
                          >
                            <div className="flex items-center justify-center">
                              Valor Líquido <SortIcon field="netValue" />
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredClients.map((cliente, idx) => (
                          <tr
                            key={cliente.code || idx}
                            className="cursor-pointer hover:bg-blue-50"
                            onClick={() => handleClientClick(cliente)}
                            title="Clique para ver transações"
                          >
                            <td className="px-1 py-0.5 text-center text-gray-400 font-medium">
                              {idx + 1}
                            </td>
                            <td className="px-1 py-0.5 text-center font-mono text-gray-600">
                              {cliente.code}
                            </td>
                            <td className="px-1 py-0.5 text-left font-semibold text-[#000638]">
                              {cliente.name}
                            </td>
                            <td className="px-1 py-0.5 text-center font-bold text-orange-700">
                              {cliente.purchaseCount || 0}
                            </td>
                            <td className="px-1 py-0.5 text-center text-cyan-700 font-bold">
                              {cliente.purchaseCount > 1
                                ? cliente.avgPurchaseIntervalMonths < 1
                                  ? `${Math.round(cliente.avgPurchaseIntervalMonths * 30.44)}d`
                                  : `${formatBRL(cliente.avgPurchaseIntervalMonths)}m`
                                : '—'}
                            </td>
                            <td className="px-1 py-0.5 text-center text-gray-700">
                              {formatInt(cliente.quantity)}
                            </td>
                            <td className="px-1 py-0.5 text-center text-gray-700">
                              R$ {formatBRL(cliente.grossValue)}
                            </td>
                            <td className="px-1 py-0.5 text-center text-red-600">
                              R$ {formatBRL(cliente.discountValue)}
                            </td>
                            <td className="px-1 py-0.5 text-center font-bold text-emerald-700">
                              R$ {formatBRL(cliente.netValue)}
                            </td>
                          </tr>
                        ))}
                        {filteredClients.length === 0 && (
                          <tr>
                            <td
                              colSpan={9}
                              className="px-4 py-8 text-center text-gray-400 text-sm"
                            >
                              Nenhum cliente encontrado.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
