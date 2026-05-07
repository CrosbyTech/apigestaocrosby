import React, { useState, useEffect, useMemo } from 'react';
import useApiClient from '../hooks/useApiClient';
import LoadingSpinner from '../components/LoadingSpinner';
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
  Funnel,
  Receipt,
} from '@phosphor-icons/react';

const CredevVarejo = () => {
  const apiClient = useApiClient();
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  // Estados dos filtros
  const [filtroDocumento, setFiltroDocumento] = useState('CREDEV');
  const [filtroEmpresa, setFiltroEmpresa] = useState('');
  const [empresas, setEmpresas] = useState([]);

  // Estados para o modal de auditoria
  const [modalAuditoriaOpen, setModalAuditoriaOpen] = useState(false);
  const [contaSelecionada, setContaSelecionada] = useState(null);

  // Estados para ordenação
  const [sortConfig, setSortConfig] = useState({
    key: 'nm_pessoa',
    direction: 'asc',
  });

  // Buscar dados ao carregar a página
  useEffect(() => {
    fetchDados();
    fetchEmpresas();
  }, []);

  const fetchEmpresas = async () => {
    try {
      console.log('🔍 Buscando empresas...');
      const result = await apiClient.company.empresas();

      console.log('📊 Resposta completa da API empresas:', result);

      if (result.success && result.data) {
        console.log('📊 Estrutura do result.data:', result.data);

        // Extrair array de empresas dependendo da estrutura retornada
        let empresasArray = [];
        if (result.data.data && Array.isArray(result.data.data)) {
          empresasArray = result.data.data;
          console.log(
            '📊 Usando result.data.data:',
            empresasArray.length,
            'empresas',
          );
        } else if (Array.isArray(result.data)) {
          empresasArray = result.data;
          console.log(
            '📊 Usando result.data diretamente:',
            empresasArray.length,
            'empresas',
          );
        } else {
          console.log(
            '📊 Estrutura não reconhecida. Propriedades disponíveis:',
            Object.keys(result.data),
          );
        }

        console.log('📊 Amostra de empresasArray:', empresasArray.slice(0, 3));

        // Filtrar apenas empresas com código menor que 5999 (seguindo a lógica dos dados)
        const empresasFiltradas = empresasArray.filter((empresa) => {
          const codigo = parseInt(empresa.cd_empresa);
          return !isNaN(codigo) && codigo < 5999;
        });

        console.log(
          '📊 Empresas após filtro < 5999:',
          empresasFiltradas.length,
        );

        // Ordenar por código
        const empresasOrdenadas = empresasFiltradas.sort(
          (a, b) => parseInt(a.cd_empresa) - parseInt(b.cd_empresa),
        );

        setEmpresas(empresasOrdenadas);
        console.log(
          '✅ Empresas carregadas no estado:',
          empresasOrdenadas.length,
        );
        console.log(
          '✅ Amostra das empresas ordenadas:',
          empresasOrdenadas.slice(0, 5),
        );
      } else {
        console.log(
          '❌ result.success:',
          result.success,
          'result.data:',
          result.data,
        );
      }
    } catch (err) {
      console.error('❌ Erro ao buscar empresas:', err);
    }
  };
  const fetchDados = async () => {
    setLoading(true);
    setErro('');
    try {
      console.log('🔍 Buscando dados de CREDEV Varejo...');

      const result = await apiClient.financial.credevVarejo();

      if (result.success) {
        console.log('✅ Dados CREDEV Varejo recebidos:', {
          total: result.data.length,
          amostra: result.data.slice(0, 2),
        });

        setDados(result.data);

        // Extrair dados únicos de nomes fantasia (apenas de registros CREDEV com saldo positivo, data >= 2025 e empresa < 5999)
        const nomesFantasiaUnicos = result.data.filter((item) => {
          // Verificar se é do tipo CREDEV
          if (
            filtroDocumento &&
            item.tp_documento &&
            item.tp_documento.toLowerCase() !== filtroDocumento.toLowerCase()
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
            item.nm_pessoa &&
            temSaldoPositivo &&
            temDataValida &&
            temEmpresaValida &&
            naoEhPessoa56
          );
        });
      } else {
        throw new Error(result.message || 'Erro ao buscar dados');
      }
    } catch (err) {
      console.error('❌ Erro ao buscar dados CREDEV Varejo:', err);
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
      // Filtro para mostrar CREDEV, ADIANTAMENTO ou ambos
      if (
        filtroDocumento !== 'TODOS' &&
        filtroDocumento &&
        item.tp_documento &&
        item.tp_documento.toLowerCase() !== filtroDocumento.toLowerCase()
      ) {
        return false;
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

      // Filtro por empresa
      if (
        filtroEmpresa &&
        item.cd_empresa &&
        !item.cd_empresa.toString().includes(filtroEmpresa)
      ) {
        return false;
      }

      return true;
    });
  }, [dados, filtroDocumento, filtroEmpresa]);

  // Limpar filtros
  const limparFiltros = () => {
    setNomesFantasiaSelecionados([]);
    setFiltroDocumento('CREDEV');
    setFiltroEmpresa('');
  };

  // Obter opções únicas para os filtros (apenas de registros CREDEV com saldo positivo, data >= 2025 e empresa < 5999)
  const opcoesDocumento = useMemo(() => {
    const documentos = [
      ...new Set(
        dados
          .filter((item) => {
            // Verificar se é do tipo CREDEV
            if (item.tp_documento !== 'CREDEV') {
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

  // Obter empresas que aparecem nos dados filtrados
  const empresasDisponiveis = useMemo(() => {
    console.log('🔄 Recalculando empresasDisponiveis...');
    console.log('📊 Estado empresas:', empresas.length, 'empresas');
    console.log('📊 Estado dados:', dados.length, 'registros');

    const codigosNoDados = [
      ...new Set(
        dados
          .filter((item) => {
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
              temSaldoPositivo &&
              temDataValida &&
              temEmpresaValida &&
              naoEhPessoa56
            );
          })
          .map((item) => item.cd_empresa)
          .filter(Boolean),
      ),
    ];

    console.log('📊 Códigos únicos encontrados nos dados:', codigosNoDados);

    // Filtrar empresas que existem nos dados
    const resultado = empresas.filter((empresa) =>
      codigosNoDados.includes(empresa.cd_empresa.toString()),
    );

    console.log('📊 Empresas disponíveis para o filtro:', resultado.length);
    console.log('📊 Amostra empresas disponíveis:', resultado.slice(0, 3));

    return resultado;
  }, [dados, empresas]); // Função para ordenar os dados
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
    // Apenas ordena os dados recebidos
    return [...dados].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];
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
          'Nome Cliente': item.nm_pessoa || '',
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
      XLSX.utils.book_append_sheet(wb, ws, 'CREDEV Varejo');

      // Gerar arquivo
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const data = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      // Nome do arquivo com data
      const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      const nomeArquivo = `credev-varejo-${hoje}.xlsx`;

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
          <h1 className="text-3xl font-bold text-[#000638] mb-2">
            CREDEV VAREJO
          </h1>
          <p className="text-gray-600">Saldos de CREDEV - Canal Varejo</p>
        </div>
      </div>

      {erro && (
        <div className="mb-6 bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded-lg">
          {erro}
        </div>
      )}

      {/* Filtros */}
      <div className="mb-4">
        <form className="flex flex-col bg-white p-3 rounded-lg shadow-lg w-full max-w-4xl mx-auto border border-[#000638]/10">
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" />
              Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Configurações para análise CREDEV Varejo
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 mb-3">
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Tipo de Documento
              </label>
              <select
                value={filtroDocumento}
                onChange={(e) => setFiltroDocumento(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="TODOS">TODOS</option>
                <option value="CREDEV">CREDEV</option>
                <option value="ADIANTAMENTO">ADIANTAMENTO</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Empresa
              </label>
              {console.log(
                '🎯 empresasDisponiveis no render:',
                empresasDisponiveis,
              )}
              <select
                value={filtroEmpresa}
                onChange={(e) => setFiltroEmpresa(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="">Todas as Empresas</option>
                {empresasDisponiveis.map((empresa) => {
                  console.log('🔧 Renderizando empresa:', empresa);
                  return (
                    <option key={empresa.cd_empresa} value={empresa.cd_empresa}>
                      {empresa.cd_empresa} - {empresa.nm_grupoempresa}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={fetchDados}
                disabled={loading}
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase"
              >
                {loading ? (
                  <>
                    <CircleNotch size={10} className="animate-spin" />
                    <span>Carregando...</span>
                  </>
                ) : (
                  <>
                    <ArrowClockwise size={10} />
                    <span>Atualizar Dados</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Cards de Resumo */}
      {dadosFiltrados.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 max-w-2xl mx-auto">
          {/* Total de Registros */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Receipt size={18} className="text-blue-600" />
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
              <CardDescription className="text-xs text-gray-500">
                Registros CREDEV
              </CardDescription>
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
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-start mb-3">
            <h2 className="text-xl font-bold text-[#000638]">
              Detalhamento CREDEV por Loja Varejo
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
                  className="px-2 py-2 text-left text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer "
                  onClick={() => handleSort('cd_empresa')}
                >
                  <div className="flex items-center">
                    Empresa
                    {getSortIcon('cd_empresa')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-center text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer "
                  onClick={() => handleSort('cd_pessoa')}
                >
                  <div className="flex items-center justify-center">
                    CD Pessoa
                    {getSortIcon('cd_pessoa')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-center text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer "
                  onClick={() => handleSort('nr_ctapes')}
                >
                  <div className="flex items-center justify-center">
                    NR CTAPES
                    {getSortIcon('nr_ctapes')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-left text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer "
                  onClick={() => handleSort('nm_pessoa')}
                >
                  <div className="flex items-center">
                    Nome Cliente
                    {getSortIcon('nm_pessoa')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-left text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer "
                  onClick={() => handleSort('tp_documento')}
                >
                  <div className="flex items-center">
                    Documento
                    {getSortIcon('tp_documento')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-right text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer "
                  onClick={() => handleSort('vl_saldo')}
                >
                  <div className="flex items-center justify-end">
                    Saldo
                    {getSortIcon('vl_saldo')}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-center text-[10px] font-medium text-white uppercase tracking-wider cursor-pointer "
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
                    className="hover:bg-blue-50 cursor-pointer group"
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
                      {item.nm_pessoa || '-'}
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

export default CredevVarejo;
