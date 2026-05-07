import React, { useState, useEffect, useMemo } from 'react';
import useApiClient from '../hooks/useApiClient';
import LoadingSpinner from '../components/LoadingSpinner';
import FiltroNomeFantasia from '../components/FiltroNomeFantasia';
import ModalAuditoriaCredev from '../components/ModalAuditoriaCredev';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  ArrowClockwise,
  CurrencyDollar,
  Calendar,
  Storefront,
  Users,
  MagnifyingGlass,
  X,
  CaretUp,
  CaretDown,
  DownloadSimple,
  CircleNotch,
} from '@phosphor-icons/react';

const Credev = () => {
  const apiClient = useApiClient();
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  // Estados dos filtros
  const [filtroDocumento, setFiltroDocumento] = useState('TODOS');
  const [nomesFantasiaSelecionados, setNomesFantasiaSelecionados] = useState(
    [],
  );
  const [dadosNomesFantasia, setDadosNomesFantasia] = useState([]);

  // Estados para o modal de auditoria
  const [modalAuditoriaOpen, setModalAuditoriaOpen] = useState(false);
  const [contaSelecionada, setContaSelecionada] = useState(null);

  // Estados para ordenação
  const [sortConfig, setSortConfig] = useState({
    key: 'nm_fantasia',
    direction: 'asc',
  });

  // Buscar dados ao carregar a página
  useEffect(() => {
    fetchDados();
  }, []);

  const fetchDados = async () => {
    setLoading(true);
    setErro('');
    try {
      console.log('🔍 Buscando dados de CREDEV...');

      const result = await apiClient.financial.credevAdiantamento();

      if (result.success) {
        console.log('✅ Dados CREDEV recebidos:', {
          total: result.data.length,
          amostra: result.data.slice(0, 2),
        });

        setDados(result.data);

        // Extrair dados únicos de nomes fantasia (considerar CREDEV e ADIANTAMENTO, saldo positivo, data >= 2025 e empresa < 5999)
        const nomesFantasiaUnicos = result.data
          .filter((item) => {
            // Aceitar registros de CREDEV ou ADIANTAMENTO
            if (
              !item.tp_documento ||
              (item.tp_documento !== 'CREDEV' &&
                item.tp_documento !== 'ADIANTAMENTO')
            ) {
              return false;
            }

            const temSaldoPositivo = isSaldoPositivo(item.vl_saldo);

            // Verificar se a data é a partir de 2025
            let temDataValida = true;
            if (item.dt_ultimocredito) {
              const dataUltimaMovimentacao = new Date(item.dt_ultimocredito);
              const ano2025 = new Date('2025-01-01');
              temDataValida = dataUltimaMovimentacao >= ano2025;
            }

            // Verificar se a empresa tem código abaixo de 5999
            const codigoEmpresa = parseInt(item.cd_empresa);
            const temEmpresaValida =
              !isNaN(codigoEmpresa) && codigoEmpresa < 5999;

            // Verificar se não é código de pessoa 56
            const codigoPessoa = parseInt(item.cd_pessoa);
            const naoEhPessoa56 = isNaN(codigoPessoa) || codigoPessoa !== 56;

            return (
              item.nm_fantasia &&
              temSaldoPositivo &&
              temDataValida &&
              temEmpresaValida &&
              naoEhPessoa56
            );
          })
          .map((item) => ({
            cd_cliente: item.cd_pessoa || item.cd_cliente,
            nm_fantasia: item.nm_fantasia,
          }))
          .filter(
            (item, index, self) =>
              index ===
              self.findIndex((t) => t.nm_fantasia === item.nm_fantasia),
          );
        setDadosNomesFantasia(nomesFantasiaUnicos);
      } else {
        throw new Error(result.message || 'Erro ao buscar dados');
      }
    } catch (err) {
      console.error('❌ Erro ao buscar dados CREDEV:', err);
      setErro('Erro ao carregar dados do servidor.');
      setDados([]);
    } finally {
      setLoading(false);
    }
  };

  const formatarDataBR = (data) => {
    if (!data) return '-';
    const d = new Date(data);
    if (isNaN(d)) return '-';
    return d.toLocaleDateString('pt-BR');
  };

  const formatarMoeda = (valor) => {
    if (valor === null || valor === undefined) return '-';
    return Number(valor).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  // Função auxiliar para verificar se o saldo é válido e positivo
  const isSaldoPositivo = (saldoOriginal) => {
    if (
      saldoOriginal === null ||
      saldoOriginal === undefined ||
      saldoOriginal === ''
    ) {
      return false;
    }

    // Converter para número
    let saldoNumerico;
    if (typeof saldoOriginal === 'string') {
      // Limpar string removendo caracteres não numéricos exceto vírgula e ponto
      const saldoLimpo = saldoOriginal
        .replace(/[^\d.,-]/g, '')
        .replace(',', '.');
      saldoNumerico = parseFloat(saldoLimpo);
    } else {
      saldoNumerico = parseFloat(saldoOriginal);
    }

    // Verificar se é um número válido e positivo
    return !isNaN(saldoNumerico) && saldoNumerico > 0.01;
  };

  // Filtrar dados baseado nos filtros ativos
  const dadosFiltrados = useMemo(() => {
    return dados.filter((item) => {
      // Filtro por tipo de documento: 'TODOS' significa sem filtro
      if (filtroDocumento && filtroDocumento !== 'TODOS') {
        if (item.tp_documento !== filtroDocumento) {
          return false;
        }
      }

      // Filtro para mostrar apenas saldos positivos (excluir zerados e negativos)
      if (!isSaldoPositivo(item.vl_saldo)) {
        return false;
      }

      // Filtro para mostrar apenas dados com última movimentação a partir de 2025
      if (item.dt_ultimocredito) {
        const dataUltimaMovimentacao = new Date(item.dt_ultimocredito);
        const ano2025 = new Date('2025-01-01');

        if (dataUltimaMovimentacao < ano2025) {
          return false;
        }
      }

      // Filtro para mostrar apenas empresas com código abaixo de 5999
      const codigoEmpresa = parseInt(item.cd_empresa);
      if (isNaN(codigoEmpresa) || codigoEmpresa >= 5999) {
        return false;
      }

      // Filtro para excluir registros com código de pessoa 56
      const codigoPessoa = parseInt(item.cd_pessoa);
      if (!isNaN(codigoPessoa) && codigoPessoa === 56) {
        return false;
      }

      // Filtro por nome fantasia (seleção múltipla)
      if (nomesFantasiaSelecionados.length > 0) {
        const fantasia = item.nm_fantasia;
        const isSelected = nomesFantasiaSelecionados.some(
          (nome) => nome.nm_fantasia === fantasia,
        );
        if (!isSelected) {
          return false;
        }
      }

      return true;
    });
  }, [dados, nomesFantasiaSelecionados, filtroDocumento]);

  // Limpar filtros
  const limparFiltros = () => {
    setNomesFantasiaSelecionados([]);
    setFiltroDocumento('TODOS');
  };

  // Função para lidar com seleção de nomes fantasia
  const handleSelectNomesFantasia = (nomesFantasia) => {
    setNomesFantasiaSelecionados([...nomesFantasia]);
  };

  // Obter opções únicas para os filtros (apenas de registros CREDEV com saldo positivo, data >= 2025 e empresa < 5999)
  const opcoesDocumento = useMemo(() => {
    // Construir opções de documento dinamicamente a partir dos dados (considerando CREDEV e ADIANTAMENTO)
    const documentos = [
      ...new Set(
        dados
          .filter((item) => {
            const temSaldoPositivo = isSaldoPositivo(item.vl_saldo);

            let temDataValida = true;
            if (item.dt_ultimocredito) {
              const dataUltimaMovimentacao = new Date(item.dt_ultimocredito);
              const ano2025 = new Date('2025-01-01');
              temDataValida = dataUltimaMovimentacao >= ano2025;
            }

            const codigoEmpresa = parseInt(item.cd_empresa);
            const temEmpresaValida =
              !isNaN(codigoEmpresa) && codigoEmpresa < 5999;

            const codigoPessoa = parseInt(item.cd_pessoa);
            const naoEhPessoa56 = isNaN(codigoPessoa) || codigoPessoa !== 56;

            return (
              temSaldoPositivo &&
              temDataValida &&
              temEmpresaValida &&
              naoEhPessoa56
            );
          })
          .map((item) => item.tp_documento)
          .filter(Boolean),
      ),
    ];
    return documentos.sort();
  }, [dados]);

  // Função para ordenar os dados
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Função para abrir modal de auditoria
  const handleRowClick = (item) => {
    if (item.nr_ctapes) {
      setContaSelecionada({
        nrCtaPes: item.nr_ctapes,
        dataUltimoMovimento: item.dt_ultimocredito,
      });
      setModalAuditoriaOpen(true);
    }
  };

  // Função para fechar modal de auditoria
  const handleCloseModal = () => {
    setModalAuditoriaOpen(false);
    setContaSelecionada(null);
  };

  // Função para obter o ícone de ordenação
  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <CaretDown size={12} className="ml-1 opacity-50" />;
    }
    return sortConfig.direction === 'asc' ? (
      <CaretUp size={12} className="ml-1" />
    ) : (
      <CaretDown size={12} className="ml-1" />
    );
  };

  // Função para ordenar os dados filtrados
  const sortDados = (dados) => {
    if (!dados || dados.length === 0) return dados;

    return [...dados].sort((a, b) => {
      let aValue, bValue;

      switch (sortConfig.key) {
        case 'cd_empresa':
          aValue = a.cd_empresa || '';
          bValue = b.cd_empresa || '';
          break;
        case 'cd_pessoa':
          aValue = Number(a.cd_pessoa) || 0;
          bValue = Number(b.cd_pessoa) || 0;
          break;
        case 'nr_ctapes':
          aValue = Number(a.nr_ctapes) || 0;
          bValue = Number(b.nr_ctapes) || 0;
          break;
        case 'nm_fantasia':
          aValue = a.nm_fantasia || '';
          bValue = b.nm_fantasia || '';
          break;
        case 'tp_documento':
          aValue = a.tp_documento || '';
          bValue = b.tp_documento || '';
          break;
        case 'vl_saldo':
          aValue = Number(a.vl_saldo) || 0;
          bValue = Number(b.vl_saldo) || 0;
          break;
        case 'dt_ultimocredito':
          aValue = a.dt_ultimocredito
            ? new Date(a.dt_ultimocredito)
            : new Date(0);
          bValue = b.dt_ultimocredito
            ? new Date(b.dt_ultimocredito)
            : new Date(0);
          break;
        default:
          aValue = a[sortConfig.key] || '';
          bValue = b[sortConfig.key] || '';
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (sortConfig.direction === 'asc') {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      } else {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      }
    });
  };

  // Função para exportar dados para Excel
  const handleExportExcel = () => {
    if (dadosFiltrados.length === 0) {
      alert('Não há dados para exportar!');
      return;
    }

    try {
      // Preparar dados para exportação
      const dadosParaExportar = sortDados(dadosFiltrados).map((item, index) => {
        return {
          Empresa: item.cd_empresa || '',
          'CD Pessoa': item.cd_pessoa || '',
          'NR CTAPES': item.nr_ctapes || '',
          'Nome Fantasia': item.nm_fantasia || '',
          Documento: item.tp_documento || '',
          Saldo: parseFloat(item.vl_saldo) || 0,
          'Última Movimentação':
            formatarDataBR(item.dt_ultimocredito) === '--'
              ? ''
              : formatarDataBR(item.dt_ultimocredito),
        };
      });

      // Criar workbook e worksheet
      const ws = XLSX.utils.json_to_sheet(dadosParaExportar);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'CREDEV');

      // Gerar arquivo
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const data = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      // Nome do arquivo com data
      const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      const nomeArquivo = `credev-${hoje}.xlsx`;

      // Download
      saveAs(data, nomeArquivo);

      console.log('✅ Excel exportado com sucesso:', nomeArquivo);
    } catch (error) {
      console.error('❌ Erro ao exportar Excel:', error);
      alert('Erro ao exportar arquivo Excel. Tente novamente.');
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col items-stretch justify-start py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-[#000638] mb-2">CREDEV</h1>
          <p className="text-gray-600">Saldos de CREDEV</p>
        </div>
      </div>

      {erro && (
        <div className="mb-6 bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded-lg">
          {erro}
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <MagnifyingGlass size={20} className="text-[#000638]" />
          <h3 className="text-lg font-semibold text-[#000638]">Filtros</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Filtro Nome Fantasia */}
          <div>
            <FiltroNomeFantasia
              nomesFantasiaSelecionados={nomesFantasiaSelecionados}
              onSelectNomesFantasia={handleSelectNomesFantasia}
              dadosNomesFantasia={dadosNomesFantasia}
            />
          </div>

          {/* Filtro Documento */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tipo de Documento
            </label>
            <select
              value={filtroDocumento}
              onChange={(e) => setFiltroDocumento(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-700 outline-none transition-colors"
            >
              <option value="TODOS">TODOS</option>
              <option value="CREDEV">CREDEV</option>
              <option value="ADIANTAMENTO">ADIANTAMENTO</option>
            </select>
          </div>

          {/* Botão Atualizar */}
          <div className="flex items-end">
            <button
              onClick={fetchDados}
              disabled={loading}
              className="flex items-center gap-2 bg-[#000638] text-white px-4 py-2 rounded-lg hover:bg-[#fe0000] transition h-10 text-sm font-bold shadow-md tracking-wide uppercase disabled:opacity-50"
            >
              <ArrowClockwise
                size={18}
                weight="bold"
                className={loading ? 'animate-spin' : ''}
              />
              Atualizar
            </button>
          </div>
        </div>
      </div>

      {/* Cards de Resumo */}
      {dadosFiltrados.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8 max-w-7xl mx-auto">
          {/* Total de Registros */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Storefront size={18} className="text-blue-600" />
                <CardTitle className="text-sm font-bold text-blue-700">
                  Total de Registros
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <div className="text-lg font-extrabold text-blue-600 mb-1 break-words">
                {loading ? (
                  <CircleNotch
                    size={24}
                    className="animate-spin text-blue-600"
                  />
                ) : (
                  dadosFiltrados.length
                )}
              </div>
            </CardContent>
          </Card>

          {/* Saldo Total */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={18} className="text-green-600" />
                <CardTitle className="text-sm font-bold text-green-700">
                  Saldo Total
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <div className="text-lg font-extrabold text-green-600 mb-1 break-words">
                {loading ? (
                  <CircleNotch
                    size={24}
                    className="animate-spin text-green-600"
                  />
                ) : (
                  formatarMoeda(
                    dadosFiltrados.reduce(
                      (acc, item) => acc + (Number(item.vl_saldo) || 0),
                      0,
                    ),
                  )
                )}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Soma de todos os saldos
              </CardDescription>
            </CardContent>
          </Card>

          {/* Total de Franquias */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-purple-600" />
                <CardTitle className="text-sm font-bold text-purple-700">
                  Franquias
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <div className="text-lg font-extrabold text-purple-600 mb-1 break-words">
                {loading ? (
                  <CircleNotch
                    size={24}
                    className="animate-spin text-purple-600"
                  />
                ) : (
                  new Set(dadosFiltrados.map((item) => item.nm_fantasia)).size
                )}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Franquias com saldo ativo
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-start mb-3">
            <h2 className="text-xl font-bold text-[#000638]">
              Detalhamento CREDEV por Franquia
            </h2>
            {dadosFiltrados.length > 0 && (
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors font-medium text-sm"
              >
                <DownloadSimple size={16} />
                BAIXAR EXCEL
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-[#000638]">
              <tr>
                <th
                  className="px-2 py-2 text-left text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000638]/80 transition-colors"
                  onClick={() => handleSort('cd_empresa')}
                >
                  <div className="flex items-center">
                    Empresa
                    {getSortIcon('cd_empresa')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-center text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000638]/80 transition-colors"
                  onClick={() => handleSort('cd_pessoa')}
                >
                  <div className="flex items-center justify-center">
                    CD Pessoa
                    {getSortIcon('cd_pessoa')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-center text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000638]/80 transition-colors"
                  onClick={() => handleSort('nr_ctapes')}
                >
                  <div className="flex items-center justify-center">
                    NR CTAPES
                    {getSortIcon('nr_ctapes')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-left text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000638]/80 transition-colors"
                  onClick={() => handleSort('nm_fantasia')}
                >
                  <div className="flex items-center">
                    Nome Fantasia
                    {getSortIcon('nm_fantasia')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-left text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000638]/80 transition-colors"
                  onClick={() => handleSort('tp_documento')}
                >
                  <div className="flex items-center">
                    Documento
                    {getSortIcon('tp_documento')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-right text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000638]/80 transition-colors"
                  onClick={() => handleSort('vl_saldo')}
                >
                  <div className="flex items-center justify-end">
                    Saldo
                    {getSortIcon('vl_saldo')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-center text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000638]/80 transition-colors"
                  onClick={() => handleSort('dt_ultimocredito')}
                >
                  <div className="flex items-center justify-center">
                    Última Movimentação
                    {getSortIcon('dt_ultimocredito')}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <LoadingSpinner size="lg" />
                      <span className="text-gray-500">Carregando dados...</span>
                    </div>
                  </td>
                </tr>
              ) : dadosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <CurrencyDollar size={48} className="text-gray-400" />
                      <span className="text-gray-500 font-medium">
                        {dados.length === 0
                          ? 'Nenhum dado encontrado'
                          : 'Nenhum registro corresponde aos filtros'}
                      </span>
                      <span className="text-gray-400 text-sm">
                        {dados.length === 0
                          ? 'Não há registros de CREDEV'
                          : 'Tente ajustar os filtros de busca'}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                sortDados(dadosFiltrados).map((item, index) => (
                  <tr
                    key={index}
                    className="hover:bg-blue-50 hover:border-l-4 hover:border-l-blue-500 transition-all duration-200 cursor-pointer group"
                    onClick={() => handleRowClick(item)}
                    title={`Clique para ver detalhes de auditoria da conta ${
                      item.nr_ctapes || 'N/A'
                    }`}
                  >
                    <td className="px-2 py-2 whitespace-nowrap text-[10px] text-gray-900">
                      {item.cd_empresa || '-'}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-[10px] text-center text-gray-900">
                      {item.cd_pessoa || '-'}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-[10px] text-center text-gray-900">
                      <div className="flex items-center justify-center gap-1">
                        <span>{item.nr_ctapes || '-'}</span>
                        <MagnifyingGlass
                          size={10}
                          className="text-blue-500 opacity-70"
                        />
                      </div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-[10px] text-gray-900">
                      {item.nm_fantasia || '-'}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span
                        className={`inline-flex px-1 py-0.5 text-[9px] font-semibold rounded-full ${
                          item.tp_documento === 'CREDEV'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {item.tp_documento || '-'}
                      </span>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-[10px] text-right font-semibold">
                      <span
                        className={
                          Number(item.vl_saldo) >= 0
                            ? 'text-green-600'
                            : 'text-red-600'
                        }
                      >
                        {formatarMoeda(item.vl_saldo)}
                      </span>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-[10px] text-center text-gray-900">
                      <div className="flex items-center justify-center gap-1">
                        <Calendar size={12} className="text-gray-400" />
                        {formatarDataBR(item.dt_ultimocredito)}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Auditoria CREDEV */}
      <ModalAuditoriaCredev
        isOpen={modalAuditoriaOpen}
        onClose={handleCloseModal}
        nrCtaPes={contaSelecionada?.nrCtaPes}
        dataUltimoMovimento={contaSelecionada?.dataUltimoMovimento}
      />
    </div>
  );
};

export default Credev;
