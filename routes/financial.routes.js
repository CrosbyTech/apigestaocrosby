import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PageTitle from '../components/ui/PageTitle';
import FiltroEmpresa from '../components/FiltroEmpresa';
import {
  ChartBar,
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  Receipt,
  CheckCircle,
  Spinner,
  CaretUp,
  CaretUpDown,
  Download,
  FileText,
  CreditCard,
  TrendUp,
  Warning,
} from '@phosphor-icons/react';
import useApiClient from '../hooks/useApiClient';
import * as XLSX from 'xlsx';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../components/ui/cards';

const PAGE_SIZE = 20;

const AuditoriaFaturamento = () => {
  const apiClient = useApiClient();
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [filtros, setFiltros] = useState({
    dt_inicio: '',
    dt_fim: '',
  });
  const [expandTabela, setExpandTabela] = useState(true);

  // Filtro de Mês/Ano
  const [anoSelecionado, setAnoSelecionado] = useState(
    new Date().getFullYear(),
  );
  const [mesSelecionado, setMesSelecionado] = useState('');

  // Estados para paginação
  const [currentPage, setCurrentPage] = useState(1);

  // Estados para ordenação
  const [ordenacao, setOrdenacao] = useState({ campo: null, direcao: 'asc' });

  // Estados para seleção de linhas
  const [linhasSelecionadas, setLinhasSelecionadas] = useState(new Set());

  // Estados para filtros locais
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroOperacao, setFiltroOperacao] = useState('');

  // Estado para alternar entre Dashboard e Dados
  const [visualizacao, setVisualizacao] = useState('DADOS');

  // Estado para classificações de clientes
  const [classificacoesClientes, setClassificacoesClientes] = useState({});
  const [franquiasClientes, setFranquiasClientes] = useState({});

  // CSS customizado para a tabela
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .table-container {
        overflow-x: auto;
        position: relative;
        max-width: 100%;
      }
      .auditoria-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
      }
      .auditoria-table tbody tr:hover {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }
      .table-container::-webkit-scrollbar {
        height: 12px;
      }
      .table-container::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 6px;
      }
      .table-container::-webkit-scrollbar-thumb {
        background: #888;
        border-radius: 6px;
      }
      .table-container::-webkit-scrollbar-thumb:hover {
        background: #555;
      }
    `;
    document.head.appendChild(styleElement);
    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  // Função para ordenação
  const handleSort = useCallback((campo) => {
    setOrdenacao((prev) => ({
      campo,
      direcao: prev.campo === campo && prev.direcao === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  // Função para ícone de ordenação
  const getSortIcon = useCallback(
    (campo) => {
      if (ordenacao.campo !== campo) {
        return <CaretUpDown size={14} className="ml-1" />;
      }
      return ordenacao.direcao === 'asc' ? (
        <CaretUp size={14} className="ml-1" />
      ) : (
        <CaretDown size={14} className="ml-1" />
      );
    },
    [ordenacao],
  );

  // Função para selecionar/deselecionar linha
  const toggleLinhaSelecionada = useCallback((index) => {
    setLinhasSelecionadas((prev) => {
      const novoSet = new Set(prev);
      if (novoSet.has(index)) {
        novoSet.delete(index);
      } else {
        novoSet.add(index);
      }
      return novoSet;
    });
  }, []);

  // Dados filtrados e ordenados
  const dadosProcessados = useMemo(() => {
    let resultado = [...dados];

    // Aplicar filtro de cliente
    if (filtroCliente) {
      resultado = resultado.filter((row) =>
        String(row.cd_cliente).includes(filtroCliente),
      );
    }

    // Aplicar filtro de operação
    if (filtroOperacao) {
      resultado = resultado.filter((row) =>
        String(row.cd_operacao)
          .toLowerCase()
          .includes(filtroOperacao.toLowerCase()),
      );
    }

    // Aplicar ordenação
    if (ordenacao.campo) {
      resultado.sort((a, b) => {
        const valorA = a[ordenacao.campo];
        const valorB = b[ordenacao.campo];

        if (valorA === valorB) return 0;

        let comparacao = 0;
        if (typeof valorA === 'number' && typeof valorB === 'number') {
          comparacao = valorA - valorB;
        } else {
          comparacao = String(valorA).localeCompare(String(valorB));
        }

        return ordenacao.direcao === 'asc' ? comparacao : -comparacao;
      });
    }

    return resultado;
  }, [dados, ordenacao, filtroCliente, filtroOperacao]);

  // Dados paginados para exibição
  const dadosPaginados = useMemo(() => {
    const inicio = (currentPage - 1) * PAGE_SIZE;
    return dadosProcessados.slice(inicio, inicio + PAGE_SIZE);
  }, [dadosProcessados, currentPage]);

  // Total de páginas
  const totalPages = Math.ceil(dadosProcessados.length / PAGE_SIZE);

  // Função para selecionar todas as linhas
  const selecionarTodasLinhas = useCallback(() => {
    setLinhasSelecionadas(new Set(dadosProcessados.map((_, i) => i)));
  }, [dadosProcessados]);

  // Função para deselecionar todas as linhas
  const deselecionarTodasLinhas = useCallback(() => {
    setLinhasSelecionadas(new Set());
  }, []);

  // Limpar seleção quando dados mudarem
  useEffect(() => {
    setLinhasSelecionadas(new Set());
  }, [dados]);

  // Resetar página quando dados mudarem
  useEffect(() => {
    setCurrentPage(1);
  }, [dados]);

  // Cálculo de estatísticas
  const estatisticas = useMemo(() => {
    const totalFaturas = dadosProcessados.length;
    const faturasComTransacao = dadosProcessados.filter(
      (row) => row.nr_transacao,
    ).length;
    const faturasSemTransacao = totalFaturas - faturasComTransacao;
    const valorTotal = dadosProcessados.reduce(
      (acc, row) => acc + (parseFloat(row.vl_fatura) || 0),
      0,
    );
    const valorComTransacao = dadosProcessados
      .filter((row) => row.nr_transacao)
      .reduce((acc, row) => acc + (parseFloat(row.vl_fatura) || 0), 0);
    const valorSemTransacao = valorTotal - valorComTransacao;

    // Tipos de documento
    const tiposDocumento = dadosProcessados.reduce((acc, row) => {
      const tipo = row.tp_documento || 'Não especificado';
      acc[tipo] = (acc[tipo] || 0) + 1;
      return acc;
    }, {});

    // Tipos de operação
    const tiposOperacao = dadosProcessados.reduce((acc, row) => {
      if (row.cd_operacao) {
        const operacao = `${row.cd_operacao} - ${row.tp_operacao || ''}`;
        acc[operacao] = (acc[operacao] || 0) + 1;
      }
      return acc;
    }, {});

    // Códigos de operação para VAREJO
    const codigosVarejo = [
      1, 2, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 8750, 9017,
      9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
      1101,
    ];

    // Filtrar dados de VAREJO
    const dadosVarejo = dadosProcessados.filter((row) =>
      codigosVarejo.includes(Number(row.cd_operacao)),
    );

    // Valor total VAREJO
    const valorVarejo = dadosVarejo.reduce(
      (acc, row) => acc + (parseFloat(row.vl_fatura) || 0),
      0,
    );

    // Valor por tipo de documento VAREJO
    const varejoTipoDocumento = dadosVarejo.reduce((acc, row) => {
      const tipo = row.tp_documento || 'Não especificado';
      acc[tipo] = (acc[tipo] || 0) + (parseFloat(row.vl_fatura) || 0);
      return acc;
    }, {});

    // Filtrar dados de MULTIMARCAS
    const dadosMultimarcas = dadosProcessados.filter(
      (row) => classificacoesClientes[row.cd_cliente] === 'MULTIMARCAS',
    );

    // Valor total MULTIMARCAS
    const valorMultimarcas = dadosMultimarcas.reduce(
      (acc, row) => acc + (parseFloat(row.vl_fatura) || 0),
      0,
    );

    // Valor por tipo de documento MULTIMARCAS
    const multimarcasTipoDocumento = dadosMultimarcas.reduce((acc, row) => {
      const tipo = row.tp_documento || 'Não especificado';
      acc[tipo] = (acc[tipo] || 0) + (parseFloat(row.vl_fatura) || 0);
      return acc;
    }, {});

    // Filtrar dados de REVENDA
    const dadosRevenda = dadosProcessados.filter(
      (row) => classificacoesClientes[row.cd_cliente] === 'REVENDA',
    );

    // Valor total REVENDA
    const valorRevenda = dadosRevenda.reduce(
      (acc, row) => acc + (parseFloat(row.vl_fatura) || 0),
      0,
    );

    // Valor por tipo de documento REVENDA
    const revendaTipoDocumento = dadosRevenda.reduce((acc, row) => {
      const tipo = row.tp_documento || 'Não especificado';
      acc[tipo] = (acc[tipo] || 0) + (parseFloat(row.vl_fatura) || 0);
      return acc;
    }, {});

    // Filtrar dados de BAZAR (cd_operacao = 889)
    const dadosBazar = dadosProcessados.filter(
      (row) => Number(row.cd_operacao) === 889,
    );

    const valorBazar = dadosBazar.reduce(
      (acc, row) => acc + (parseFloat(row.vl_fatura) || 0),
      0,
    );

    const bazarTipoDocumento = dadosBazar.reduce((acc, row) => {
      const tipo = row.tp_documento || 'Não especificado';
      acc[tipo] = (acc[tipo] || 0) + (parseFloat(row.vl_fatura) || 0);
      return acc;
    }, {});

    // Filtrar dados de SELLECT (cd_operacao = 55 ou 53)
    const dadosSellect = dadosProcessados.filter((row) =>
      [55, 53].includes(Number(row.cd_operacao)),
    );

    const valorSellect = dadosSellect.reduce(
      (acc, row) => acc + (parseFloat(row.vl_fatura) || 0),
      0,
    );

    const sellectTipoDocumento = dadosSellect.reduce((acc, row) => {
      const tipo = row.tp_documento || 'Não especificado';
      acc[tipo] = (acc[tipo] || 0) + (parseFloat(row.vl_fatura) || 0);
      return acc;
    }, {});

    // Filtrar dados de FRANQUIAS (clientes com nm_fantasia like '%F%CROSBY%')
    const dadosFranquias = dadosProcessados.filter(
      (row) => franquiasClientes[row.cd_cliente] === true,
    );

    const valorFranquias = dadosFranquias.reduce(
      (acc, row) => acc + (parseFloat(row.vl_fatura) || 0),
      0,
    );

    const franquiasTipoDocumento = dadosFranquias.reduce((acc, row) => {
      const tipo = row.tp_documento || 'Não especificado';
      acc[tipo] = (acc[tipo] || 0) + (parseFloat(row.vl_fatura) || 0);
      return acc;
    }, {});

    return {
      totalFaturas,
      faturasComTransacao,
      faturasSemTransacao,
      valorTotal,
      valorComTransacao,
      valorSemTransacao,
      percentualComTransacao:
        totalFaturas > 0 ? (faturasComTransacao / totalFaturas) * 100 : 0,
      tiposDocumento,
      tiposOperacao,
      valorVarejo,
      varejoTipoDocumento,
      valorMultimarcas,
      multimarcasTipoDocumento,
      valorRevenda,
      revendaTipoDocumento,
      valorBazar,
      bazarTipoDocumento,
      valorSellect,
      sellectTipoDocumento,
      valorFranquias,
      franquiasTipoDocumento,
    };
  }, [dadosProcessados, classificacoesClientes, franquiasClientes]);

  // Função para buscar dados
  const fetchDados = async (filtrosParam = filtros) => {
    setLoading(true);
    setErro('');
    try {
      const params = {
        cd_empresa: filtrosParam.cd_empresa.join(','),
        dt_inicio: filtrosParam.dt_inicio,
        dt_fim: filtrosParam.dt_fim,
      };

      const response = await apiClient.financial.auditoriaFaturamento(params);

      if (response.data && Array.isArray(response.data)) {
        setDados(response.data);
        setDadosCarregados(true);

        // Buscar classificações dos clientes após carregar os dados
        await fetchClassificacoesClientes(response.data);
        await fetchFranquiasClientes(response.data);
      } else {
        setErro('Formato de resposta inválido');
      }
    } catch (error) {
      console.error('Erro ao buscar dados:', error);
      setErro(error.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  // Função para buscar classificações de clientes
  const fetchClassificacoesClientes = async (dadosAuditoria) => {
    try {
      // Extrair códigos únicos de clientes
      const clientesUnicos = [
        ...new Set(dadosAuditoria.map((item) => item.cd_cliente)),
      ];

      if (clientesUnicos.length === 0) return;

      const response = await apiClient.financial.classificacaoClientes({
        cd_clientes: clientesUnicos.join(','),
      });

      if (response.data) {
        setClassificacoesClientes(response.data);
      }
    } catch (error) {
      console.error('Erro ao buscar classificações de clientes:', error);
      // Não interrompe o fluxo se houver erro nas classificações
    }
  };

  // Função para buscar franquias de clientes
  const fetchFranquiasClientes = async (dadosAuditoria) => {
    try {
      // Extrair códigos únicos de clientes
      const clientesUnicos = [
        ...new Set(dadosAuditoria.map((item) => item.cd_cliente)),
      ];

      if (clientesUnicos.length === 0) return;

      const response = await apiClient.financial.franquiasClientes({
        cd_clientes: clientesUnicos.join(','),
      });

      if (response.data) {
        setFranquiasClientes(response.data);
      }
    } catch (error) {
      console.error('Erro ao buscar franquias de clientes:', error);
      // Não interrompe o fluxo se houver erro nas franquias
    }
  };

  const handleChange = (e) => {
    setFiltros({ ...filtros, [e.target.name]: e.target.value });
  };

  // Aplica dt_inicio/dt_fim conforme ano/mês escolhidos
  const aplicarPeriodoMes = (ano, mes) => {
    let dt_ini = '';
    let dt_fim = '';

    if (mes === 'ANO') {
      dt_ini = `${ano}-01-01`;
      dt_fim = `${ano}-12-31`;
    } else if (mes !== '') {
      const mesNum = parseInt(mes, 10);
      const primeiroDia = new Date(ano, mesNum, 1);
      const ultimoDia = new Date(ano, mesNum + 1, 0);
      dt_ini = primeiroDia.toISOString().split('T')[0];
      dt_fim = ultimoDia.toISOString().split('T')[0];
    }

    setFiltros((prev) => ({
      ...prev,
      dt_inicio: dt_ini,
      dt_fim: dt_fim,
    }));
  };

  const handleSelectEmpresas = (empresas) => {
    setEmpresasSelecionadas(empresas);
  };

  const handleFiltrar = (e) => {
    e.preventDefault();
    if (empresasSelecionadas.length === 0) {
      setErro('Selecione pelo menos uma empresa');
      return;
    }
    if (!filtros.dt_inicio || !filtros.dt_fim) {
      setErro('Selecione o período de datas');
      return;
    }
    // Extrair apenas os códigos das empresas
    const codigosEmpresas = empresasSelecionadas.map((emp) => emp.cd_empresa);
    fetchDados({ ...filtros, cd_empresa: codigosEmpresas });
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
  };

  // Função para formatar datas no padrão brasileiro
  function formatarDataBR(data) {
    if (!data) return '';
    const d = new Date(data);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    return `${dia}/${mes}/${ano}`;
  }

  // Função para converter tipo de documento de número para nome
  function converterTipoDocumento(numero) {
    const tiposDocumento = {
      1: 'Fatura',
      2: 'Cheque',
      3: 'Dinheiro',
      4: 'Cartão crédito',
      5: 'Cartão débito',
      6: 'Nota débito',
      7: 'TEF',
      8: 'Cheque TEF',
      9: 'Troco',
      10: 'Adiantamento (saída cx.)',
      11: 'Desconto financeiro',
      12: 'DOFNI',
      13: 'Vale',
      14: 'Nota promissória',
      15: 'Cheque garantido',
      16: 'TED/DOC',
      17: 'Pré-Autorização TEF',
      18: 'Cheque presente',
      19: 'TEF/TECBAN - BANRISUL',
      20: 'CREDEV',
      21: 'Cartão próprio',
      22: 'TEF/HYPERCARD',
      23: 'Bônus desconto',
      25: 'Voucher',
      26: 'PIX',
      27: 'PicPay',
      28: 'Ame',
      29: 'Mercado Pago',
      30: 'Marketplace',
      31: 'Outro documento',
    };

    return tiposDocumento[numero] || `TP_DOC ${numero}` || 'Não informado';
  }

  // Função para exportar Excel
  function exportarCSV() {
    const dadosExport = dadosProcessados.map((row) => ({
      Cliente: row.cd_cliente,
      'Nr. Fatura': row.nr_fat,
      'Valor Fatura': row.vl_fatura,
      Vencimento: formatarDataBR(row.dt_vencimento),
      'Nr. Transação': row.nr_transacao || 'Sem transação',
      'Tipo Documento': row.tp_documento,
      'Tipo Operação': row.tp_operacao,
      'Código Operação': row.cd_operacao,
      Empresa: row.cd_empresa,
    }));

    const ws = XLSX.utils.json_to_sheet(dadosExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Auditoria Faturamento');
    XLSX.writeFile(wb, 'auditoria-faturamento.xlsx');
  }

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col items-stretch justify-start py-8">
      <PageTitle
        title="Auditoria de Faturamento"
        subtitle="Analise o relacionamento entre faturas e transações"
        icon={ChartBar}
        iconColor="text-blue-600"
      />

      <div className="mb-4">
        <form
          onSubmit={handleFiltrar}
          className="flex flex-col bg-white p-8 rounded-2xl shadow-lg w-full max-w-5xl mx-auto border border-[#000638]/10"
        >
          <div className="mb-6">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-2">
              <Receipt size={22} weight="bold" />
              Filtros
            </span>
            <span className="text-sm text-gray-500 mt-1">
              Selecione o período e as empresas para análise
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3 gap-y-2 w-full mb-4">
            <div className="flex flex-col">
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={handleSelectEmpresas}
              />
            </div>
            <div className="flex flex-col">
              <label className="block text-xs font-semibold mb-1 text-[#000638]">
                Ano
              </label>
              <select
                value={anoSelecionado}
                onChange={(e) => {
                  const novoAno = Number(e.target.value);
                  setAnoSelecionado(novoAno);
                  aplicarPeriodoMes(novoAno, mesSelecionado);
                }}
                className="border border-[#000638]/30 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400"
              >
                {Array.from({ length: 6 }).map((_, idx) => {
                  const y = new Date().getFullYear() - idx;
                  return (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="flex flex-col relative z-30">
              <label className="block text-xs font-semibold mb-1 text-[#000638]">
                Mês
              </label>
              <select
                value={mesSelecionado}
                onChange={(e) => {
                  const novoMes = e.target.value;
                  setMesSelecionado(novoMes);
                  aplicarPeriodoMes(anoSelecionado, novoMes);
                }}
                className="border border-[#000638]/30 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400"
              >
                <option value="">— Selecionar —</option>
                <option value="ANO">Ano inteiro</option>
                <option value="0">Jan</option>
                <option value="1">Fev</option>
                <option value="2">Mar</option>
                <option value="3">Abr</option>
                <option value="4">Mai</option>
                <option value="5">Jun</option>
                <option value="6">Jul</option>
                <option value="7">Ago</option>
                <option value="8">Set</option>
                <option value="9">Out</option>
                <option value="10">Nov</option>
                <option value="11">Dez</option>
              </select>
            </div>
            <div className="flex flex-col relative z-20">
              <label className="block text-xs font-semibold mb-1 text-[#000638]">
                Data Inicial
              </label>
              <input
                type="date"
                name="dt_inicio"
                value={filtros.dt_inicio}
                onChange={handleChange}
                className="border border-[#000638]/30 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400"
              />
            </div>
            <div className="flex flex-col relative z-10">
              <label className="block text-xs font-semibold mb-1 text-[#000638]">
                Data Final
              </label>
              <input
                type="date"
                name="dt_fim"
                value={filtros.dt_fim}
                onChange={handleChange}
                className="border border-[#000638]/30 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400"
              />
            </div>
          </div>
          <div className="flex justify-end w-full mt-1">
            <button
              type="submit"
              className="flex items-center gap-1 bg-[#000638] text-white px-5 py-2 rounded-lg hover:bg-[#fe0000] transition h-9 text-sm font-bold shadow tracking-wide uppercase min-w-[90px] disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? (
                <Spinner size={18} className="animate-spin" />
              ) : (
                <ArrowsClockwise size={18} weight="bold" />
              )}
              {loading ? 'Carregando...' : 'Filtrar'}
            </button>
          </div>
        </form>
        {erro && (
          <div className="mt-4 bg-red-100 border border-red-300 text-red-700 px-4 py-2 rounded text-center">
            {erro}
          </div>
        )}
      </div>

      {/* Cards de Estatísticas */}
      {dadosCarregados && (
        <div className="flex flex-row gap-2 mb-8 max-w-full justify-center items-stretch flex-wrap">
          {/* Card Total de Faturas */}
          <Card className="min-w-[140px] max-w-[160px] shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-1 rounded-lg bg-white cursor-pointer p-1">
            <CardHeader className="pb-0 px-1 pt-1">
              <div className="flex flex-row items-center gap-1">
                <FileText size={15} className="text-blue-600" />
                <CardTitle className="text-xs font-bold text-blue-600">
                  Total Faturas
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-1 pl-2">
              <div className="text-lg font-extrabold text-blue-600 mb-0.5">
                {estatisticas.totalFaturas}
              </div>
              <CardDescription className="text-[10px] text-gray-500">
                Registros
              </CardDescription>
              <div className="text-xs font-bold text-blue-600 mt-0.5">
                {estatisticas.valorTotal.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </div>
              <CardDescription className="text-[10px] text-gray-500">
                Valor Total
              </CardDescription>
            </CardContent>
          </Card>

          {/* Card Com Transação */}
          <Card className="min-w-[140px] max-w-[160px] shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-1 rounded-lg bg-white cursor-pointer p-1">
            <CardHeader className="pb-0 px-1 pt-1">
              <div className="flex flex-row items-center gap-1">
                <CheckCircle size={15} className="text-green-600" />
                <CardTitle className="text-xs font-bold text-green-600">
                  Com Transação
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-1 pl-2">
              <div className="text-lg font-extrabold text-green-600 mb-0.5">
                {estatisticas.faturasComTransacao}
              </div>
              <CardDescription className="text-[10px] text-gray-500">
                Qtd
              </CardDescription>
              <div className="text-xs font-bold text-green-600 mt-0.5">
                {estatisticas.valorComTransacao.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </div>
              <CardDescription className="text-[10px] text-gray-500">
                Valor
              </CardDescription>
            </CardContent>
          </Card>

          {/* Card Percentual */}
          <Card className="min-w-[140px] max-w-[160px] shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-1 rounded-lg bg-white cursor-pointer p-1">
            <CardHeader className="pb-0 px-1 pt-1">
              <div className="flex flex-row items-center gap-1">
                <TrendUp size={15} className="text-indigo-600" />
                <CardTitle className="text-xs font-bold text-indigo-600">
                  % Conciliado
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-1 pl-2">
              <div className="text-lg font-extrabold text-indigo-600 mb-0.5">
                {estatisticas.percentualComTransacao.toFixed(1)}%
              </div>
              <CardDescription className="text-[10px] text-gray-500">
                Taxa
              </CardDescription>
            </CardContent>
          </Card>

          {/* Card Sem Transação */}
          <Card className="min-w-[140px] max-w-[160px] shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-1 rounded-lg bg-white cursor-pointer p-1">
            <CardHeader className="pb-0 px-1 pt-1">
              <div className="flex flex-row items-center gap-1">
                <Warning size={15} className="text-red-600" />
                <CardTitle className="text-xs font-bold text-red-600">
                  Sem Transação
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-1 pl-2">
              <div className="text-lg font-extrabold text-red-600 mb-0.5">
                {estatisticas.faturasSemTransacao}
              </div>
              <CardDescription className="text-[10px] text-gray-500">
                Qtd
              </CardDescription>
              <div className="text-xs font-bold text-red-600 mt-0.5">
                {estatisticas.valorSemTransacao.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </div>
              <CardDescription className="text-[10px] text-gray-500">
                Valor
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Botão de exportação */}
      <div className="flex justify-end mb-4">
        <button
          onClick={exportarCSV}
          className="flex items-center gap-2 bg-[#000638] text-white px-4 py-2 rounded-lg hover:bg-[#fe0000] transition-all duration-200 text-sm font-medium shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={loading || dadosProcessados.length === 0}
        >
          {loading ? (
            <Spinner size={18} className="animate-spin" />
          ) : (
            <Download size={18} />
          )}
          {loading ? 'Carregando...' : 'Baixar Excel'}
        </button>
      </div>

      {/* Botões de alternância Dashboard/Dados */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex rounded-lg border-2 border-[#000638] overflow-hidden shadow-md">
          <button
            onClick={() => setVisualizacao('DASHBOARD')}
            className={`px-8 py-3 text-sm font-bold tracking-wide uppercase transition-all duration-200 ${
              visualizacao === 'DASHBOARD'
                ? 'bg-[#000638] text-white'
                : 'bg-white text-[#000638] hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center gap-2">
              <ChartBar size={18} weight="bold" />
              Dashboard
            </div>
          </button>
          <button
            onClick={() => setVisualizacao('DADOS')}
            className={`px-8 py-3 text-sm font-bold tracking-wide uppercase transition-all duration-200 border-l-2 border-[#000638] ${
              visualizacao === 'DADOS'
                ? 'bg-[#000638] text-white'
                : 'bg-white text-[#000638] hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText size={18} weight="bold" />
              Dados
            </div>
          </button>
        </div>
      </div>

      {/* Visualização Dashboard */}
      {visualizacao === 'DASHBOARD' && (
        <div className="rounded-2xl shadow-lg bg-white border border-[#000638]/10 p-8">
          <h2 className="text-2xl font-bold text-[#000638] mb-6">
            Clusters de Operações
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Card VAREJO */}
            <Card className="shadow-md transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-200 cursor-pointer">
              <CardHeader className="pb-2">
                <div className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold text-blue-700">
                      VAREJO
                    </CardTitle>
                    <CardDescription className="text-xs text-blue-600 mt-1">
                      Operações de varejo
                    </CardDescription>
                  </div>
                  <CreditCard
                    size={32}
                    className="text-blue-600"
                    weight="duotone"
                  />
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="text-3xl font-extrabold text-blue-700 mb-2">
                  {estatisticas.valorVarejo.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </div>
                <CardDescription className="text-xs text-blue-600 mb-3">
                  Total faturado
                </CardDescription>

                {/* Detalhamento por tipo de documento */}
                <div className="border-t border-blue-300 pt-3 mt-2">
                  <div className="text-xs font-semibold text-blue-700 mb-2">
                    Por Tipo de Documento:
                  </div>
                  <div className="space-y-1">
                    {Object.entries(estatisticas.varejoTipoDocumento)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([tipo, valor]) => (
                        <div
                          key={tipo}
                          className="flex justify-between items-center text-xs"
                        >
                          <span className="text-blue-600 font-medium">
                            {converterTipoDocumento(Number(tipo))}:
                          </span>
                          <span className="text-blue-700 font-bold">
                            {Number(valor).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Card MULTIMARCAS */}
            <Card className="shadow-md transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-lg bg-gradient-to-br from-green-50 to-green-100 border-2 border-green-200 cursor-pointer">
              <CardHeader className="pb-2">
                <div className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold text-green-700">
                      MULTIMARCAS
                    </CardTitle>
                    <CardDescription className="text-xs text-green-600 mt-1">
                      Clientes multimarcas
                    </CardDescription>
                  </div>
                  <TrendUp
                    size={32}
                    className="text-green-600"
                    weight="duotone"
                  />
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="text-3xl font-extrabold text-green-700 mb-2">
                  {estatisticas.valorMultimarcas.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </div>
                <CardDescription className="text-xs text-green-600 mb-3">
                  Total faturado
                </CardDescription>

                {/* Detalhamento por tipo de documento */}
                <div className="border-t border-green-300 pt-3 mt-2">
                  <div className="text-xs font-semibold text-green-700 mb-2">
                    Por Tipo de Documento:
                  </div>
                  <div className="space-y-1">
                    {Object.entries(estatisticas.multimarcasTipoDocumento)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([tipo, valor]) => (
                        <div
                          key={tipo}
                          className="flex justify-between items-center text-xs"
                        >
                          <span className="text-green-600 font-medium">
                            {converterTipoDocumento(Number(tipo))}:
                          </span>
                          <span className="text-green-700 font-bold">
                            {Number(valor).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Card REVENDA */}
            <Card className="shadow-md transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-lg bg-gradient-to-br from-purple-50 to-purple-100 border-2 border-purple-200 cursor-pointer">
              <CardHeader className="pb-2">
                <div className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold text-purple-700">
                      REVENDA
                    </CardTitle>
                    <CardDescription className="text-xs text-purple-600 mt-1">
                      Clientes revenda
                    </CardDescription>
                  </div>
                  <Receipt
                    size={32}
                    className="text-purple-600"
                    weight="duotone"
                  />
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="text-3xl font-extrabold text-purple-700 mb-2">
                  {estatisticas.valorRevenda.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </div>
                <CardDescription className="text-xs text-purple-600 mb-3">
                  Total faturado
                </CardDescription>

                {/* Detalhamento por tipo de documento */}
                <div className="border-t border-purple-300 pt-3 mt-2">
                  <div className="text-xs font-semibold text-purple-700 mb-2">
                    Por Tipo de Documento:
                  </div>
                  <div className="space-y-1">
                    {Object.entries(estatisticas.revendaTipoDocumento)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([tipo, valor]) => (
                        <div
                          key={tipo}
                          className="flex justify-between items-center text-xs"
                        >
                          <span className="text-purple-600 font-medium">
                            {converterTipoDocumento(Number(tipo))}:
                          </span>
                          <span className="text-purple-700 font-bold">
                            {Number(valor).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Visualização Dados (Tabela) */}
      {visualizacao === 'DADOS' && (
        <div className="rounded-2xl shadow-lg bg-white border border-[#000638]/10">
          <div className="p-4 border-b border-[#000638]/10 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-[#000638]">
                Detalhamento de Auditoria de Faturamento
              </h2>
              {dadosProcessados.length > 0 && (
                <p className="text-sm text-gray-500 mt-1">
                  {dadosProcessados.length} registro
                  {dadosProcessados.length > 1 ? 's' : ''} encontrado
                  {dadosProcessados.length > 1 ? 's' : ''}
                  {totalPages > 1 &&
                    ` - Página ${currentPage} de ${totalPages} (${PAGE_SIZE} por página)`}
                </p>
              )}
            </div>
            <button
              onClick={() => setExpandTabela(!expandTabela)}
              className="flex items-center text-gray-500 hover:text-gray-700"
            >
              {expandTabela ? (
                <CaretDown size={20} />
              ) : (
                <CaretRight size={20} />
              )}
            </button>
          </div>

          {expandTabela && (
            <>
              {/* Filtros Locais */}
              {dadosCarregados && dados.length > 0 && (
                <div className="p-4 bg-gray-50 border-b border-gray-200">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-semibold text-[#000638] whitespace-nowrap">
                        Cliente:
                      </label>
                      <input
                        type="text"
                        placeholder="Código do cliente..."
                        value={filtroCliente}
                        onChange={(e) => setFiltroCliente(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000638] text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-semibold text-[#000638] whitespace-nowrap">
                        Operação:
                      </label>
                      <input
                        type="text"
                        placeholder="Código operação..."
                        value={filtroOperacao}
                        onChange={(e) => setFiltroOperacao(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000638] text-sm"
                      />
                    </div>
                    {(filtroCliente || filtroOperacao) && (
                      <button
                        onClick={() => {
                          setFiltroCliente('');
                          setFiltroOperacao('');
                        }}
                        className="px-4 py-2 text-sm font-medium text-white bg-[#fe0000] rounded-lg hover:bg-[#cc0000] transition-colors"
                      >
                        Limpar Filtros
                      </button>
                    )}
                  </div>
                </div>
              )}

              {loading ? (
                <div className="flex justify-center items-center py-20">
                  <div className="flex items-center gap-3">
                    <Spinner size={32} className="animate-spin text-blue-600" />
                    <span className="text-gray-600">Carregando dados...</span>
                  </div>
                </div>
              ) : !dadosCarregados ? (
                <div className="flex justify-center items-center py-20">
                  <div className="text-center">
                    <div className="text-gray-500 text-lg mb-2">
                      Clique em "Filtrar" para carregar as informações
                    </div>
                    <div className="text-gray-400 text-sm">
                      Selecione o período e as empresas desejadas
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="table-container max-w-full mx-auto">
                    <table
                      className="border-collapse rounded-lg overflow-hidden shadow-lg auditoria-table"
                      style={{ minWidth: '1200px' }}
                    >
                      <thead className="bg-[#000638] text-white text-xs uppercase tracking-wider">
                        <tr>
                          {/* Checkbox para seleção */}
                          <th
                            className="px-2 py-1 text-center text-[10px]"
                            style={{
                              width: '50px',
                              minWidth: '50px',
                              position: 'sticky',
                              left: 0,
                              zIndex: 20,
                              backgroundColor: '#000638',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={
                                linhasSelecionadas.size ===
                                  dadosProcessados.length &&
                                dadosProcessados.length > 0
                              }
                              onChange={() => {
                                if (
                                  linhasSelecionadas.size ===
                                  dadosProcessados.length
                                ) {
                                  deselecionarTodasLinhas();
                                } else {
                                  selecionarTodasLinhas();
                                }
                              }}
                              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                            />
                          </th>

                          {/* Colunas ordenáveis */}
                          <th
                            className="px-3 py-1 text-center text-[10px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('cd_cliente')}
                          >
                            <div className="flex items-center justify-center">
                              Cliente
                              {getSortIcon('cd_cliente')}
                            </div>
                          </th>

                          <th
                            className="px-3 py-1 text-center text-[10px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('nr_fat')}
                          >
                            <div className="flex items-center justify-center">
                              Nr. Fatura
                              {getSortIcon('nr_fat')}
                            </div>
                          </th>

                          <th
                            className="px-3 py-1 text-center text-[10px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('vl_fatura')}
                          >
                            <div className="flex items-center justify-center">
                              Valor
                              {getSortIcon('vl_fatura')}
                            </div>
                          </th>

                          <th
                            className="px-3 py-1 text-center text-[10px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('dt_vencimento')}
                          >
                            <div className="flex items-center justify-center">
                              Vencimento
                              {getSortIcon('dt_vencimento')}
                            </div>
                          </th>

                          <th
                            className="px-3 py-1 text-center text-[10px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('nr_transacao')}
                          >
                            <div className="flex items-center justify-center">
                              Nr. Transação
                              {getSortIcon('nr_transacao')}
                            </div>
                          </th>

                          <th
                            className="px-3 py-1 text-center text-[10px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('tp_documento')}
                          >
                            <div className="flex items-center justify-center">
                              Tipo Doc
                              {getSortIcon('tp_documento')}
                            </div>
                          </th>

                          <th
                            className="px-3 py-1 text-center text-[10px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('cd_operacao')}
                          >
                            <div className="flex items-center justify-center">
                              Operação
                              {getSortIcon('cd_operacao')}
                            </div>
                          </th>

                          <th
                            className="px-3 py-1 text-center text-[10px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                            onClick={() => handleSort('tp_operacao')}
                          >
                            <div className="flex items-center justify-center">
                              Tipo Oper.
                              {getSortIcon('tp_operacao')}
                            </div>
                          </th>

                          <th className="px-3 py-1 text-center text-[10px]">
                            Status
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {dadosPaginados.length === 0 ? (
                          <tr>
                            <td colSpan="10" className="text-center py-20">
                              <div className="text-center">
                                <div className="text-gray-500 text-lg mb-2">
                                  Nenhum dado encontrado
                                </div>
                                <div className="text-gray-400 text-sm">
                                  Verifique os filtros selecionados
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          dadosPaginados.map((row, index) => {
                            const globalIndex =
                              (currentPage - 1) * PAGE_SIZE + index;
                            const temTransacao = !!row.nr_transacao;
                            return (
                              <tr
                                key={globalIndex}
                                className={`text-[11px] border-b transition-colors cursor-pointer ${
                                  linhasSelecionadas.has(globalIndex)
                                    ? 'bg-blue-100 hover:bg-blue-200'
                                    : temTransacao
                                    ? 'bg-green-50 hover:bg-green-100'
                                    : 'bg-red-50 hover:bg-red-100'
                                }`}
                              >
                                {/* Checkbox de seleção */}
                                <td
                                  className="px-2 py-1 text-center"
                                  style={{
                                    width: '50px',
                                    minWidth: '50px',
                                    position: 'sticky',
                                    left: 0,
                                    zIndex: 10,
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={linhasSelecionadas.has(
                                      globalIndex,
                                    )}
                                    onChange={() =>
                                      toggleLinhaSelecionada(globalIndex)
                                    }
                                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                                  />
                                </td>

                                {/* Cliente */}
                                <td className="px-2 py-1 text-center text-[#000638] font-medium">
                                  {row.cd_cliente}
                                </td>

                                {/* Nr. Fatura */}
                                <td className="px-2 py-1 text-center text-blue-600 font-bold">
                                  {row.nr_fat}
                                </td>

                                {/* Valor */}
                                <td className="px-2 py-1 text-right font-bold text-green-600">
                                  {parseFloat(row.vl_fatura).toLocaleString(
                                    'pt-BR',
                                    {
                                      style: 'currency',
                                      currency: 'BRL',
                                    },
                                  )}
                                </td>

                                {/* Vencimento */}
                                <td className="px-2 py-1 text-center text-gray-700">
                                  {formatarDataBR(row.dt_vencimento)}
                                </td>

                                {/* Nr. Transação */}
                                <td className="px-2 py-1 text-center">
                                  {row.nr_transacao ? (
                                    <span className="text-blue-600 font-medium">
                                      {row.nr_transacao}
                                    </span>
                                  ) : (
                                    <span className="text-red-500 text-xs">
                                      Sem transação
                                    </span>
                                  )}
                                </td>

                                {/* Tipo Documento */}
                                <td className="px-2 py-1 text-center text-gray-700">
                                  {row.tp_documento || '-'}
                                </td>

                                {/* Código Operação */}
                                <td className="px-2 py-1 text-center text-indigo-600 font-medium">
                                  {row.cd_operacao || '-'}
                                </td>

                                {/* Tipo Operação */}
                                <td className="px-2 py-1 text-center text-gray-700">
                                  {row.tp_operacao || '-'}
                                </td>

                                {/* Status */}
                                <td className="px-2 py-1 text-center">
                                  {temTransacao ? (
                                    <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                                      Vinculado
                                    </span>
                                  ) : (
                                    <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
                                      Não vinculado
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Resumo das linhas selecionadas */}
                  {linhasSelecionadas.size > 0 && (
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg mx-4 mb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-blue-600" />
                            <span className="text-sm font-medium text-blue-800">
                              {linhasSelecionadas.size} linha
                              {linhasSelecionadas.size > 1 ? 's' : ''}{' '}
                              selecionada
                              {linhasSelecionadas.size > 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Receipt className="w-5 h-5 text-green-600" />
                            <span className="text-sm font-medium text-green-800">
                              Total:{' '}
                              {Array.from(linhasSelecionadas)
                                .reduce((acc, index) => {
                                  return (
                                    acc +
                                    (parseFloat(
                                      dadosProcessados[index]?.vl_fatura,
                                    ) || 0)
                                  );
                                }, 0)
                                .toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                                })}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={deselecionarTodasLinhas}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Limpar seleção
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="bg-white border-t border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                {/* Informações da página */}
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span className="font-medium">
                    Página {currentPage} de {totalPages}
                  </span>
                  <span className="text-gray-500">
                    {dadosProcessados.length} registros • {PAGE_SIZE} por página
                  </span>
                </div>

                {/* Controles de navegação */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePageChange(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Primeira
                  </button>

                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Anterior
                  </button>

                  <span className="px-4 py-1 text-sm font-semibold text-[#000638] bg-gray-100 rounded-md">
                    {currentPage}
                  </span>

                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Próxima
                  </button>

                  <button
                    onClick={() => handlePageChange(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Última
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AuditoriaFaturamento;
