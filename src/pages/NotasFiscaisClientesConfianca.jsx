import React, { useEffect, useState, useMemo } from 'react';
import useApiClient from '../hooks/useApiClient';
import { TotvsURL } from '../config/constants';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import PageTitle from '../components/ui/PageTitle';
import {
  Article,
  Funnel,
  Spinner,
  CurrencyDollar,
  CaretLeft,
  CaretRight,
  CaretUp,
  CaretDown,
  CaretUpDown,
  FileArrowDown,
  Eye,
  X,
  MagnifyingGlass,
  CheckCircle,
  Package,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const NotasFiscaisClientesAntecipacao = () => {
  const apiClient = useApiClient();
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [periodo, setPeriodo] = useState({ dt_inicio: '', dt_fim: '' });

  // Campo de busca por nome/CNPJ
  const [termoBusca, setTermoBusca] = useState('');
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [clientesEncontrados, setClientesEncontrados] = useState([]);
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [showDropdownCliente, setShowDropdownCliente] = useState(false);

  // Paginação
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina] = useState(20);

  // Ordenação
  const [ordenacao, setOrdenacao] = useState({ campo: null, direcao: 'asc' });

  // Modal DANFE
  const [modalAberto, setModalAberto] = useState(false);
  const [pedidoSelecionado, setPedidoSelecionado] = useState(null);
  const [danfeLoading, setDanfeLoading] = useState(false);
  const [danfeBase64, setDanfeBase64] = useState('');
  const [danfeError, setDanfeError] = useState('');

  const [filiaisCodigos, setFiliaisCodigos] = useState([]);

  // Buscar filiais ao carregar
  useEffect(() => {
    const buscarFiliais = async () => {
      try {
        const response = await fetch(`${TotvsURL}branches`);
        if (response.ok) {
          const result = await response.json();
          let empresasArray = [];
          if (result.success && result.data) {
            if (result.data.data && Array.isArray(result.data.data))
              empresasArray = result.data.data;
            else if (Array.isArray(result.data)) empresasArray = result.data;
          }
          const codigos = empresasArray
            .map((b) => parseInt(b.cd_empresa))
            .filter((c) => !isNaN(c) && c > 0);
          setFiliaisCodigos(codigos);
        }
      } catch (error) {
        setFiliaisCodigos([1, 2, 6, 100, 101, 99, 990, 200, 400, 4, 850, 85]);
      }
    };
    buscarFiliais();
  }, []);

  // Buscar clientes por nome via Supabase (pes_pessoa)
  const buscarClientes = async () => {
    if (!termoBusca || termoBusca.trim().length < 3) return;
    setBuscandoCliente(true);
    setClientesEncontrados([]);
    setShowDropdownCliente(true);
    try {
      const termo = termoBusca.trim();
      const params = new URLSearchParams();
      params.append('nome', termo);
      params.append('fantasia', termo);

      const resp = await fetch(
        `${TotvsURL}clientes/search-name?${params.toString()}`,
      );
      const json = await resp.json();
      if (json.success && json.data?.clientes) {
        setClientesEncontrados(json.data.clientes);
      }
    } catch (error) {
      // erro silencioso
    } finally {
      setBuscandoCliente(false);
    }
  };

  const selecionarCliente = (cliente) => {
    setClienteSelecionado(cliente);
    setTermoBusca(
      cliente.fantasy_name || cliente.nm_pessoa || cliente.cpf || '',
    );
    setShowDropdownCliente(false);
  };

  const formatDateBR = (isoDate) => {
    if (!isoDate) return '--';
    try {
      const [datePart] = String(isoDate).split('T');
      const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10));
      if (!y || !m || !d) return '--';
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    } catch {
      return '--';
    }
  };

  // Inicializar período padrão (mês atual)
  useEffect(() => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
      .toISOString()
      .split('T')[0];
    setPeriodo({ dt_inicio: primeiroDia, dt_fim: ultimoDia });
  }, []);

  // CSS
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .extrato-table { border-collapse: collapse; width: 100%; }
      .extrato-table th, .extrato-table td { padding: 6px 8px !important; border-right: 1px solid #f3f4f6; font-size: 12px; line-height: 1.4; }
      .extrato-table th:last-child, .extrato-table td:last-child { border-right: none; }
      .extrato-table th { background-color: #000638; color: white; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
      .extrato-table tbody tr:nth-child(odd) { background-color: white; }
      .extrato-table tbody tr:nth-child(even) { background-color: #f9fafb; }
      .extrato-table tbody tr:hover { background-color: #f3f4f6; }
    `;
    document.head.appendChild(styleElement);
    return () => document.head.removeChild(styleElement);
  }, []);

  const handleSort = (campo) => {
    setOrdenacao((prev) => ({
      campo,
      direcao: prev.campo === campo && prev.direcao === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getSortIcon = (campo) => {
    if (ordenacao.campo !== campo)
      return <CaretUpDown size={12} className="opacity-50" />;
    return ordenacao.direcao === 'asc' ? (
      <CaretUp size={12} />
    ) : (
      <CaretDown size={12} />
    );
  };

  const dadosProcessados = useMemo(() => {
    let dadosFiltrados = [...dados];
    if (ordenacao.campo) {
      dadosFiltrados.sort((a, b) => {
        let valorA = a[ordenacao.campo];
        let valorB = b[ordenacao.campo];
        if (
          ['invoiceDate', 'issueDate', 'transactionDate'].includes(
            ordenacao.campo,
          )
        ) {
          valorA = valorA || '';
          valorB = valorB || '';
        }
        if (
          [
            'totalValue',
            'productValue',
            'quantity',
            'branchCode',
            'personCode',
            'invoiceCode',
            'transactionCode',
          ].includes(ordenacao.campo)
        ) {
          valorA = parseFloat(valorA) || 0;
          valorB = parseFloat(valorB) || 0;
        }
        if (typeof valorA === 'string') {
          valorA = valorA.toLowerCase();
          valorB = (valorB || '').toLowerCase();
        }
        if (valorA < valorB) return ordenacao.direcao === 'asc' ? -1 : 1;
        if (valorA > valorB) return ordenacao.direcao === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return dadosFiltrados;
  }, [dados, ordenacao]);

  const dadosPaginados = useMemo(() => {
    const startIndex = (paginaAtual - 1) * itensPorPagina;
    return dadosProcessados.slice(startIndex, startIndex + itensPorPagina);
  }, [dadosProcessados, paginaAtual, itensPorPagina]);

  const totalPages = Math.ceil(dadosProcessados.length / itensPorPagina);

  const buscarDados = async () => {
    if (!periodo.dt_inicio || !periodo.dt_fim) {
      alert('Selecione o período!');
      return;
    }
    if (!clienteSelecionado) {
      alert('Selecione um cliente!');
      return;
    }

    setLoading(true);
    setPaginaAtual(1);
    try {
      const allCodes =
        filiaisCodigos.length > 0
          ? filiaisCodigos
          : Array.from({ length: 99 }, (_, i) => i + 1);
      const branchCodeList = allCodes.filter((c) => c >= 1 && c <= 99);
      const personCode = parseInt(clienteSelecionado.code);
      const personCodeList = !isNaN(personCode) ? [personCode] : [];

      const result = await apiClient.totvs.invoicesSearch({
        startDate: periodo.dt_inicio,
        endDate: periodo.dt_fim,
        branchCodeList,
        personCodeList,
      });

      if (result.success) {
        const items = result.data?.items || [];
        const filtrados = items.filter((inv) => {
          if (!inv.invoiceDate) return false;
          const d = inv.invoiceDate.slice(0, 10);
          if (d < periodo.dt_inicio || d > periodo.dt_fim) return false;
          if (inv.invoiceStatus !== 'Issued') return false;
          return true;
        });
        setDados(filtrados);
        setDadosCarregados(true);
      } else {
        setDados([]);
        setDadosCarregados(true);
      }
    } catch (err) {
      setDados([]);
      setDadosCarregados(false);
    } finally {
      setLoading(false);
    }
  };

  const handleFiltrar = (e) => {
    e.preventDefault();
    buscarDados();
  };

  const abrirModalDanfe = async (pedido) => {
    setModalAberto(true);
    setPedidoSelecionado(pedido);
    setDanfeBase64('');
    setDanfeError('');
  };

  const gerarDanfe = async () => {
    if (!pedidoSelecionado) return;
    try {
      setDanfeLoading(true);
      setDanfeBase64('');
      setDanfeError('');

      const dataTransacao = pedidoSelecionado.transactionDate
        ? pedidoSelecionado.transactionDate.split('T')[0]
        : pedidoSelecionado.invoiceDate
          ? pedidoSelecionado.invoiceDate.split('T')[0]
          : '';

      const payload = {
        filter: {
          branchCodeList: [pedidoSelecionado.branchCode],
          personCodeList: [pedidoSelecionado.personCode],
          transactionBranchCode:
            pedidoSelecionado.transactionBranchCode ||
            pedidoSelecionado.branchCode,
          transactionCode: pedidoSelecionado.transactionCode,
          transactionDate: dataTransacao,
        },
      };

      const response = await fetch(`${TotvsURL}danfe-from-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Erro ao gerar DANFE');
      }

      const data = await response.json();
      let base64 = '';
      if (data.success && data.data)
        base64 = data.data.danfePdfBase64 || data.data.base64 || '';
      else if (data.danfePdfBase64) base64 = data.danfePdfBase64;

      if (base64) {
        setDanfeBase64(base64);
        abrirPDFDanfe(base64);
      } else {
        throw new Error('DANFE não retornada pela API');
      }
    } catch (error) {
      setDanfeError(error.message || 'Erro ao gerar DANFE');
    } finally {
      setDanfeLoading(false);
    }
  };

  const abrirPDFDanfe = (base64String) => {
    try {
      const base64 = base64String.replace(/^data:application\/pdf;base64,/, '');
      const binaryString = window.atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++)
        bytes[i] = binaryString.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const newWindow = window.open(url, '_blank');
      if (newWindow) {
        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = `danfe-nf-${pedidoSelecionado?.invoiceCode || 'pedido'}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      alert('Erro ao abrir a DANFE.');
    }
  };

  const handleExportExcel = () => {
    if (dadosProcessados.length === 0) {
      alert('Não há dados para exportar!');
      return;
    }
    try {
      const dadosParaExportar = dadosProcessados.map((item) => ({
        Empresa: item.branchCode || '',
        CNPJ: item.branchCnpj || '',
        'Data Emissão': formatDateBR(item.invoiceDate),
        'Nº NF': item.invoiceCode || '',
        Série: item.serialCode || '',
        'Nº Transação': item.transactionCode || '',
        'Cód. Cliente': item.personCode || '',
        Cliente: item.personName || '',
        Tipo:
          item.operationType === 'Input'
            ? 'DEVOLUÇÃO'
            : item.operationType === 'Output'
              ? 'VENDA'
              : item.operationType || '',
        Status: item.invoiceStatus || '',
        'Valor Total': parseFloat(item.totalValue) || 0,
      }));
      const ws = XLSX.utils.json_to_sheet(dadosParaExportar);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Notas Fiscais Antecipação');
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const data = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      saveAs(data, `notas-fiscais-antecipacao-${hoje}.xlsx`);
    } catch (error) {
      alert('Erro ao exportar arquivo Excel.');
    }
  };

  const irParaPagina = (pagina) => setPaginaAtual(pagina);
  const paginaAnterior = () => {
    if (paginaAtual > 1) setPaginaAtual(paginaAtual - 1);
  };
  const proximaPagina = () => {
    if (paginaAtual < totalPages) setPaginaAtual(paginaAtual + 1);
  };

  const calcularTotais = () => {
    const totais = dadosProcessados.reduce(
      (acc, item) => {
        acc.valorTotal += parseFloat(item.totalValue) || 0;
        acc.quantidadePedidos += 1;
        return acc;
      },
      { valorTotal: 0, quantidadePedidos: 0 },
    );
    totais.ticketMedio =
      totais.quantidadePedidos > 0
        ? totais.valorTotal / totais.quantidadePedidos
        : 0;
    return totais;
  };
  const totais = calcularTotais();

  useEffect(() => {
    setPaginaAtual(1);
  }, [dados, ordenacao]);

  const gerarPaginas = () => {
    const totalPaginas = Math.ceil(dadosProcessados.length / itensPorPagina);
    const paginas = [];
    const maxPaginasVisiveis = 5;
    if (totalPaginas <= maxPaginasVisiveis) {
      for (let i = 1; i <= totalPaginas; i++) paginas.push(i);
    } else {
      if (paginaAtual <= 3) {
        for (let i = 1; i <= 4; i++) paginas.push(i);
        paginas.push('...');
        paginas.push(totalPaginas);
      } else if (paginaAtual >= totalPaginas - 2) {
        paginas.push(1);
        paginas.push('...');
        for (let i = totalPaginas - 3; i <= totalPaginas; i++) paginas.push(i);
      } else {
        paginas.push(1);
        paginas.push('...');
        for (let i = paginaAtual - 1; i <= paginaAtual + 1; i++)
          paginas.push(i);
        paginas.push('...');
        paginas.push(totalPaginas);
      }
    }
    return paginas;
  };

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Notas Fiscais - Antecipação"
        subtitle="Consulte notas fiscais de clientes Antecipação"
        icon={Article}
        iconColor="text-amber-600"
      />

      {/* Filtros */}
      <div className="mb-4">
        <form
          onSubmit={handleFiltrar}
          className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full max-w-7xl mx-auto border border-[#000638]/10"
        >
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" /> Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Pesquise por Nome, Nome Fantasia ou CNPJ e selecione o período
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-3">
            <div className="lg:col-span-2 relative">
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Cliente (Nome / CNPJ)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={termoBusca}
                  onChange={(e) => {
                    setTermoBusca(e.target.value);
                    setClienteSelecionado(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      buscarClientes();
                    }
                  }}
                  placeholder="Digite o nome, nome fantasia ou CNPJ..."
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 pr-8 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                />
                <button
                  type="button"
                  onClick={buscarClientes}
                  disabled={
                    buscandoCliente ||
                    !termoBusca ||
                    termoBusca.trim().length < 3
                  }
                  className="absolute right-2 top-1/3 -translate-y-1/2 text-[#000638] hover:text-[#000638]/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {buscandoCliente ? (
                    <Spinner size={14} className="animate-spin" />
                  ) : (
                    <MagnifyingGlass size={14} />
                  )}
                </button>
              </div>
              {clienteSelecionado && (
                <div className="mt-1 text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle size={12} />
                  Selecionado:{' '}
                  {clienteSelecionado.fantasy_name ||
                    clienteSelecionado.nm_pessoa}{' '}
                  (Cód: {clienteSelecionado.code})
                </div>
              )}
              {showDropdownCliente && clientesEncontrados.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {clientesEncontrados.map((cli, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => selecionarCliente(cli)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 text-xs border-b border-gray-100 last:border-b-0"
                    >
                      <div className="font-medium text-gray-900">
                        {cli.fantasy_name || cli.nm_pessoa || '--'}
                      </div>
                      <div className="text-gray-500">
                        Cód: {cli.code} | CPF/CNPJ: {cli.cpf || '--'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {showDropdownCliente &&
                !buscandoCliente &&
                clientesEncontrados.length === 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-xs text-gray-500 text-center">
                    Nenhum cliente encontrado
                  </div>
                )}
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Início
              </label>
              <input
                type="date"
                value={periodo.dt_inicio}
                onChange={(e) =>
                  setPeriodo((prev) => ({ ...prev, dt_inicio: e.target.value }))
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Fim
              </label>
              <input
                type="date"
                value={periodo.dt_fim}
                onChange={(e) =>
                  setPeriodo((prev) => ({ ...prev, dt_fim: e.target.value }))
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div className="flex items-center gap-2 mt-6 sm:mt-0">
              <button
                type="submit"
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Spinner size={10} className="animate-spin" />
                    <span>Carregando...</span>
                  </>
                ) : (
                  <>
                    <Article size={10} />
                    <span>Buscar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Cards */}
      {dadosProcessados.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-3 gap-2 mb-6 max-w-7xl mx-auto">
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-green-600" />
                <CardTitle className="text-xs font-bold text-green-700">
                  Valor Total
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-green-600 mb-0.5 break-words">
                {totais.valorTotal.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Soma de todos os pedidos
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Package size={14} className="text-blue-600" />
                <CardTitle className="text-xs font-bold text-blue-700">
                  Quantidade
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-blue-600 mb-0.5 break-words">
                {totais.quantidadePedidos}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Total de pedidos
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Article size={14} className="text-purple-600" />
                <CardTitle className="text-xs font-bold text-purple-700">
                  Ticket Médio
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-purple-600 mb-0.5 break-words">
                {totais.ticketMedio.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Valor médio por pedido
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white rounded-lg shadow-md border border-[#000638]/10 max-w-7xl mx-auto w-full">
        <div className="p-3 border-b border-[#000638]/10 flex justify-between items-center">
          <h2 className="text-sm font-bold text-[#000638] font-barlow">
            Notas Fiscais - Antecipação
          </h2>
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-600">
              {dadosCarregados
                ? `${dadosProcessados.length} registros encontrados`
                : 'Nenhum dado carregado'}
            </div>
            {dadosProcessados.length > 0 && (
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-1 bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 transition-colors font-medium text-xs"
              >
                <FileArrowDown size={12} /> BAIXAR EXCEL
              </button>
            )}
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
                  Pesquise um cliente e selecione o período
                </div>
              </div>
            </div>
          ) : dados.length === 0 ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="text-gray-500 text-sm mb-2">
                  Nenhum dado encontrado
                </div>
                <div className="text-gray-400 text-xs">
                  Verifique os filtros selecionados ou tente novamente
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-[350px] md:max-w-[700px] lg:max-w-[900px] xl:max-w-[1100px] 2xl:max-w-[1300px] mx-auto overflow-x-auto">
              <table className="border-collapse rounded-lg overflow-hidden shadow-lg extrato-table">
                <thead className="bg-[#000638] text-white text-sm uppercase tracking-wider">
                  <tr>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('branchCode')}
                    >
                      <div className="flex items-center justify-center">
                        Empresa{getSortIcon('branchCode')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('invoiceDate')}
                    >
                      <div className="flex items-center justify-center">
                        Data Emissão{getSortIcon('invoiceDate')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('invoiceCode')}
                    >
                      <div className="flex items-center justify-center">
                        Nº NF{getSortIcon('invoiceCode')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('personCode')}
                    >
                      <div className="flex items-center justify-center">
                        Cód. Cliente{getSortIcon('personCode')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-left cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('personName')}
                    >
                      <div className="flex items-center">
                        Cliente{getSortIcon('personName')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('operationType')}
                    >
                      <div className="flex items-center justify-center">
                        Tipo{getSortIcon('operationType')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('invoiceStatus')}
                    >
                      <div className="flex items-center justify-center">
                        Status{getSortIcon('invoiceStatus')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('totalValue')}
                    >
                      <div className="flex items-center justify-center">
                        Valor Total{getSortIcon('totalValue')}
                      </div>
                    </th>
                    <th className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center">
                        Detalhar
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {dadosPaginados.map((item, index) => (
                    <tr key={index} className="text-sm transition-colors">
                      <td className="text-center text-gray-900 px-2 py-2">
                        {item.branchCode || '--'}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {formatDateBR(item.invoiceDate)}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {item.invoiceCode || '--'}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {item.personCode || '--'}
                      </td>
                      <td className="text-left text-gray-900 px-2 py-2">
                        {item.personName || '--'}
                      </td>
                      <td className="text-center px-2 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            item.operationType === 'Input'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-orange-100 text-orange-700'
                          }`}
                        >
                          {item.operationType === 'Input'
                            ? 'DEVOLUÇÃO'
                            : 'VENDA'}
                        </span>
                      </td>
                      <td className="text-center px-2 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            item.invoiceStatus === 'Issued'
                              ? 'bg-green-100 text-green-700'
                              : item.invoiceStatus === 'Normal'
                                ? 'bg-blue-100 text-blue-700'
                                : item.invoiceStatus === 'Canceled'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {item.invoiceStatus || '--'}
                        </span>
                      </td>
                      <td className="text-center font-semibold text-green-600 px-2 py-2">
                        {(parseFloat(item.totalValue) || 0).toLocaleString(
                          'pt-BR',
                          { style: 'currency', currency: 'BRL' },
                        )}
                      </td>
                      <td className="text-center px-2 py-2">
                        <button
                          onClick={() => abrirModalDanfe(item)}
                          className="flex items-center justify-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs mx-auto font-medium"
                        >
                          <Eye size={14} weight="bold" /> Detalhar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 text-center text-sm text-gray-600">
                Total de {dadosProcessados.length} registros
              </div>

              {/* Paginação */}
              {dadosProcessados.length > itensPorPagina && (
                <div className="flex flex-col sm:flex-row justify-between items-center mt-6 pt-6 border-t border-gray-200">
                  <div className="text-sm text-gray-600 mb-4 sm:mb-0">
                    Mostrando {(paginaAtual - 1) * itensPorPagina + 1} a{' '}
                    {Math.min(
                      paginaAtual * itensPorPagina,
                      dadosProcessados.length,
                    )}{' '}
                    de {dadosProcessados.length} registros
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={paginaAnterior}
                      disabled={paginaAtual === 1}
                      className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <CaretLeft size={16} /> Anterior
                    </button>
                    <div className="flex items-center gap-1">
                      {gerarPaginas().map((pagina, index) => (
                        <button
                          key={index}
                          onClick={() =>
                            typeof pagina === 'number' && irParaPagina(pagina)
                          }
                          disabled={typeof pagina !== 'number'}
                          className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${pagina === paginaAtual ? 'bg-[#000638] text-white' : typeof pagina === 'number' ? 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50' : 'text-gray-400 cursor-default'}`}
                        >
                          {pagina}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={proximaPagina}
                      disabled={paginaAtual === totalPages}
                      className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Próximo <CaretRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal DANFE */}
      {modalAberto && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          style={{ zIndex: 99999 }}
        >
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                Detalhes da Nota Fiscal
              </h2>
              <button
                onClick={() => setModalAberto(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            {pedidoSelecionado && (
              <div className="bg-gray-50 p-4 rounded-lg mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">
                  Informações da NF
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Empresa:</span>
                    <p className="font-medium">
                      {pedidoSelecionado.branchCode}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Nº NF:</span>
                    <p className="font-medium">
                      {pedidoSelecionado.invoiceCode}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Cliente:</span>
                    <p className="font-medium">
                      {pedidoSelecionado.personName}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Valor:</span>
                    <p className="font-medium text-green-600">
                      {(
                        parseFloat(pedidoSelecionado.totalValue) || 0
                      ).toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* DANFE */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileArrowDown size={20} className="text-red-600" /> DANFE
              </h3>
              <button
                onClick={gerarDanfe}
                disabled={danfeLoading}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm"
              >
                {danfeLoading ? (
                  <>
                    <Spinner size={16} className="animate-spin" /> Gerando
                    DANFE...
                  </>
                ) : (
                  <>
                    <FileArrowDown size={16} /> Gerar DANFE
                  </>
                )}
              </button>
              {danfeError && (
                <p className="mt-2 text-sm text-red-600">{danfeError}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotasFiscaisClientesAntecipacao;
