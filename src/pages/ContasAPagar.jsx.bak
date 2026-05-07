import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';

import FiltroEmpresa from '../components/FiltroEmpresa';
import FiltroCentroCusto from '../components/FiltroCentroCusto';
import FiltroDespesas from '../components/FiltroDespesas';
import useApiClient from '../hooks/useApiClient';
import { API_BASE_URL } from '../config/constants';
import PageTitle from '../components/ui/PageTitle';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';
import FilterDropdown from '../components/ui/FilterDropdown';
import ModalDetalhesConta from '../components/ModalDetalhesConta';
import {
  Receipt,
  Calendar,
  Funnel,
  FunnelSimple,
  Spinner,
  CurrencyDollar,
  Clock,
  Warning,
  CheckCircle,
  ArrowUp,
  ArrowDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  CaretDown,
  TrendDown,
  FileArrowDown,
  XCircle,
  Trash,
  MagnifyingGlass,
  X,
  ChatCircleDots,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { getCategoriaPorCodigo } from '../config/categoriasDespesas';
import {
  autorizacoesSupabase,
  STATUS_AUTORIZACAO,
} from '../lib/autorizacoesSupabase';
import ChatContasPagar from '../components/ChatIA/ChatContasPagar';

// Função para criar Date object sem problemas de fuso horário
const criarDataSemFusoHorario = (dataString) => {
  if (!dataString) return null;
  if (dataString.includes('T')) {
    // Para datas ISO, usar apenas a parte da data
    const dataPart = dataString.split('T')[0];
    const [ano, mes, dia] = dataPart.split('-');
    return new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
  }
  // Para datas já no formato DD/MM/YYYY
  if (dataString.includes('/')) {
    const [dia, mes, ano] = dataString.split('/');
    return new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
  }
  return new Date(dataString);
};

// Função para formatar data
const formatarData = (data) => {
  if (!data) return '';
  if (data.includes('T')) {
    // Para datas ISO, criar a data considerando apenas a parte da data (YYYY-MM-DD)
    const dataPart = data.split('T')[0];
    const [ano, mes, dia] = dataPart.split('-');
    return `${dia}/${mes}/${ano}`;
  }
  return data;
};

const ContasAPagar = (props) => {
  const { user, hasRole } = useAuth?.() || { user: null, hasRole: () => false };
  const apiClient = useApiClient();
  const isEmissao = !!props?.__modoEmissao;
  const blockedCostCenters = (props?.__blockedCostCenters || []).map((n) =>
    typeof n === 'string' ? parseInt(n, 10) : Number(n),
  );
  const despesasFixas = props?.__despesasFixas || null;

  // Debug logs para verificar o status do usuário
  useEffect(() => {
    console.log('🔍 DEBUG - Usuário atual:', user);
    console.log('🔍 DEBUG - Role do usuário:', user?.role);
    console.log(
      '🔍 DEBUG - hasRole owner:',
      hasRole(['owner', 'admin', 'manager']),
    );
    console.log('🔍 DEBUG - hasRole user:', hasRole(['user']));
  }, [user, hasRole]);

  const [dados, setDados] = useState([]);

  // Estados para busca de fornecedor por nome
  const [termoBuscaFornecedor, setTermoBuscaFornecedor] = useState('');
  const [termoBuscaFantasiaFornecedor, setTermoBuscaFantasiaFornecedor] =
    useState('');
  const [fornecedoresEncontrados, setFornecedoresEncontrados] = useState([]);
  const [modalBuscaFornecedorAberto, setModalBuscaFornecedorAberto] =
    useState(false);
  const [buscandoFornecedores, setBuscandoFornecedores] = useState(false);
  const [fornecedorBuscaSelecionado, setFornecedorBuscaSelecionado] =
    useState(null);
  const [dadosCentroCusto, setDadosCentroCusto] = useState([]);
  const [dadosDespesa, setDadosDespesa] = useState([]);
  const [dataInicio, setDataInicio] = useState('');
  const [modalDetalhes, setModalDetalhes] = useState({
    isOpen: false,
    conta: null,
  });

  // Injetar CSS customizado para a tabela
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .table-container {
        overflow-x: auto;
        position: relative;
      }
      
      .table-container table {
        position: relative;
      }
      
      .contas-table {
        border-collapse: collapse;
        width: 100%;
      }
      
      .contas-table th,
      .contas-table td {
        padding: !important;
        border-right: 1px solid #f3f4f6;
        word-wrap: break-word;
        white-space: normal;
        font-size: 11px;
        line-height: 1.3;
      }
      
      .contas-table th:last-child,
      .contas-table td:last-child {
        border-right: none;
      }
      
      .contas-table th {
        background-color: #000638;
        color: white;
        font-weight: 600;
        text-transform: uppercase;
        font-size: 10px;
        letter-spacing: 0.05em;
      }
      
      .contas-table tbody tr:nth-child(odd) {
        background-color: white;
      }
      
      .contas-table tbody tr:nth-child(even) {
        background-color: #fafafa;
      }
      
      .contas-table tbody tr:hover {
        background-color: #f0f9ff;
        transition: background-color 0.2s ease;
      }
      
      /* CSS para coluna fixa */
      .contas-table thead th:first-child,
      .contas-table tbody td:first-child {
        position: sticky !important;
        left: 0 !important;
        z-index: 10 !important;
        border-right: 2px solid #e5e7eb !important;
        box-shadow: 2px 0 4px rgba(0,0,0,0.1) !important;
      }
      
      .contas-table thead th:first-child {
        background: #000638 !important;
        z-index: 20 !important;
        border-right: 2px solid #374151 !important;
      }
      
      .contas-table tbody tr:nth-child(even) td:first-child {
        background: #fafafa !important;
      }
      
      .contas-table tbody tr:nth-child(odd) td:first-child {
        background: #ffffff !important;
      }
      
      .contas-table tbody tr:hover td:first-child {
        background: #f0f9ff !important;
      }
      
      .contas-table tbody tr.bg-blue-100 td:first-child {
        background: #dbeafe !important;
      }
      
      .contas-table tbody tr.bg-blue-100:hover td:first-child {
        background: #bfdbfe !important;
      }
      
      .contas-table th:first-child input[type="checkbox"] {
        transform: scale(1.1);
      }
      
      .contas-table td:first-child input[type="checkbox"] {
        transform: scale(1.1);
      }
      

    `;
    document.head.appendChild(styleElement);

    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  const [dataFim, setDataFim] = useState('');
  const [loading, setLoading] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [situacao, setSituacao] = useState('N');
  const [previsao, setPrevisao] = useState('TODOS');
  const [filtroAutorizacao, setFiltroAutorizacao] = useState('TODOS');

  const [duplicata, setDuplicata] = useState('');

  const [linhasSelecionadas, setLinhasSelecionadas] = useState(new Set());
  const [linhasSelecionadasAgrupadas, setLinhasSelecionadasAgrupadas] =
    useState(new Set());

  // Estados para filtro mensal
  const [filtroMensal, setFiltroMensal] = useState('ANO');
  const [filtroDia, setFiltroDia] = useState(null);

  // Estados para modais dos cards
  const [modalCardAberto, setModalCardAberto] = useState(false);
  const [tipoCardSelecionado, setTipoCardSelecionado] = useState('');
  const [dadosCardModal, setDadosCardModal] = useState([]);
  // Estado para exibição do plano de contas
  const [planoOpen, setPlanoOpen] = useState(true);

  // Estados para modais (mantidos para compatibilidade)
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showAutorizarTodosModal, setShowAutorizarTodosModal] = useState(false);
  const [showRemoverTodosModal, setShowRemoverTodosModal] = useState(false);
  const [showEnviarPagamentoModal, setShowEnviarPagamentoModal] =
    useState(false);
  const [showRemoverPagamentoModal, setShowRemoverPagamentoModal] =
    useState(false);
  const [contaParaEnviar, setContaParaEnviar] = useState(null);
  const [dadosAcessoRestrito, setDadosAcessoRestrito] = useState(null);
  const [showAcessoRestritoModal, setShowAcessoRestritoModal] = useState(false);
  const [carregandoAutorizacoes, setCarregandoAutorizacoes] = useState(false);

  // Estado para o chat IA
  const [chatIAAberto, setChatIAAberto] = useState(false);

  // Objeto vazio para compatibilidade
  const autorizacoes = {};

  // Constantes para compatibilidade
  const STATUS_AUTORIZACAO = {
    AUTORIZADO: 'AUTORIZADO',
    NAO_AUTORIZADO: 'NAO_AUTORIZADO',
    ENVIADO_PAGAMENTO: 'ENVIADO_PAGAMENTO',
  };

  // Estados para paginação
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [registrosPorPagina] = useState(20);

  // Função para lidar com mudança de filtro mensal
  const handleFiltroMensalChange = (novoFiltro) => {
    setFiltroMensal(novoFiltro);
    setFiltroDia(null); // Limpar filtro de dia quando mudar o mês
  };

  // Função para abrir modal do card
  const abrirModalCard = (tipo) => {
    console.log('🔍 Abrindo modal do card:', tipo);
    console.log(
      '📊 Total de dados disponíveis:',
      dadosOrdenadosParaCards.length,
    );

    let dadosFiltrados = [];

    switch (tipo) {
      case 'vencidas':
        dadosFiltrados = dadosOrdenadosParaCards
          .filter((grupo) => {
            const status = getStatusFromData(grupo.item);
            return status === 'Vencido';
          })
          .map((grupo) => grupo.item);
        break;
      case 'aVencer':
        dadosFiltrados = dadosOrdenadosParaCards
          .filter((grupo) => {
            const status = getStatusFromData(grupo.item);
            return status === 'A Vencer';
          })
          .map((grupo) => grupo.item);
        break;
      case 'proximasVencer':
        dadosFiltrados = dadosOrdenadosParaCards
          .filter((grupo) => {
            const status = getStatusFromData(grupo.item);
            return status === 'Próxima a Vencer';
          })
          .map((grupo) => grupo.item);
        break;
      case 'pagas':
        dadosFiltrados = dadosOrdenadosParaCards
          .filter((grupo) => {
            const status = getStatusFromData(grupo.item);
            return status === 'Pago';
          })
          .map((grupo) => grupo.item);
        break;
      case 'faltaPagar':
        dadosFiltrados = dadosOrdenadosParaCards
          .filter((grupo) => {
            const status = getStatusFromData(grupo.item);
            return status !== 'Pago';
          })
          .map((grupo) => grupo.item);
        break;
      case 'descontos':
        dadosFiltrados = dadosOrdenadosParaCards
          .filter((grupo) => {
            return parseFloat(grupo.item.vl_desconto || 0) > 0;
          })
          .map((grupo) => grupo.item);
        break;
      default:
        dadosFiltrados = [];
    }

    console.log('✅ Dados filtrados encontrados:', dadosFiltrados.length);
    console.log('📋 Amostra dos dados filtrados:', dadosFiltrados.slice(0, 2));

    setDadosCardModal(dadosFiltrados);
    setTipoCardSelecionado(tipo);
    setModalCardAberto(true);
  };

  // Função para fechar modal do card
  const fecharModalCard = () => {
    setModalCardAberto(false);
    setTipoCardSelecionado('');
    setDadosCardModal([]);
  };

  // Função para obter título do modal
  const getTituloModal = (tipo) => {
    switch (tipo) {
      case 'vencidas':
        return 'Contas Vencidas';
      case 'aVencer':
        return 'Contas a Vencer';
      case 'proximasVencer':
        return 'Próximas a Vencer';
      case 'pagas':
        return 'Contas Pagas';
      case 'faltaPagar':
        return 'Falta Pagar';
      case 'descontos':
        return 'Descontos Ganhos';
      default:
        return 'Detalhes';
    }
  };

  // Funções para seleção de linhas
  const toggleLinhaSelecionada = (index) => {
    setLinhasSelecionadas((prev) => {
      const novoSet = new Set(prev);
      if (novoSet.has(index)) {
        novoSet.delete(index);
      } else {
        novoSet.add(index);
      }
      return novoSet;
    });
  };

  // Limpar seleção quando os dados mudarem
  useEffect(() => {
    setLinhasSelecionadas(new Set());
  }, [dados]);

  // Limpar seleção agrupada quando os dados mudarem
  useEffect(() => {
    setLinhasSelecionadasAgrupadas(new Set());
  }, [dados]);

  // Limpar seleção quando o filtro mensal mudar
  useEffect(() => {
    setLinhasSelecionadas(new Set());
  }, [filtroMensal]);

  // Funções seleção agrupada
  const toggleLinhaSelecionadaAgrupada = (index) => {
    setLinhasSelecionadasAgrupadas((prev) => {
      const novoSet = new Set(prev);
      if (novoSet.has(index)) {
        novoSet.delete(index);
      } else {
        novoSet.add(index);
      }
      return novoSet;
    });
  };

  // Exportar Excel do Detalhamento de Contas (agrupado)
  const exportarExcelDetalhamento = () => {
    if (!dadosOrdenadosParaCards || dadosOrdenadosParaCards.length === 0) {
      alert('Nenhum dado para exportar');
      return;
    }

    const dadosParaExportar = dadosOrdenadosParaCards.map((grupo) => {
      const rateioTotal =
        grupo.rateios && grupo.rateios.length > 0
          ? grupo.rateios
              .map((r) => parseFloat(r || 0))
              .reduce((a, b) => a + b, 0)
          : 0;

      return {
        Vencimento: formatarData(grupo.item.dt_vencimento),
        Valor: parseFloat(grupo.item.vl_duplicata || 0),
        Fornecedor: grupo.item.cd_fornecedor || '',
        'Nome Fornecedor': grupo.item.nm_fornecedor || '',
        Despesa: grupo.item.ds_despesaitem || '',
        'Centro de Custo': grupo.item.ds_ccusto || '',
        Empresa: grupo.item.cd_empresa || '',
        Duplicata: grupo.item.nr_duplicata || '',
        Parcela: grupo.item.nr_parcela || '',
        Portador: grupo.item.nr_portador || '',
        Emissão: formatarData(grupo.item.dt_emissao),
        Entrada: formatarData(grupo.item.dt_entrada),
        Liquidação: formatarData(grupo.item.dt_liq),
        Situação: grupo.item.tp_situacao || '',
        Estágio: grupo.item.tp_estagio || '',
        Juros: parseFloat(grupo.item.vl_juros || 0),
        Acréscimo: parseFloat(grupo.item.vl_acrescimo || 0),
        Desconto: parseFloat(grupo.item.vl_desconto || 0),
        Pago: parseFloat(grupo.item.vl_pago || 0),
        Aceite: grupo.item.in_aceite || '',
        'Rateio Total': rateioTotal,
        Observação: grupo.item.ds_observacao || '',
        Previsão: grupo.item.tp_previsaoreal || '',
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dadosParaExportar);
    ws['!cols'] = [
      { wch: 12 }, // Vencimento
      { wch: 14 }, // Valor
      { wch: 12 }, // Fornecedor
      { wch: 28 }, // Nome Fornecedor
      { wch: 28 }, // Despesa
      { wch: 24 }, // Centro de Custo
      { wch: 10 }, // Empresa
      { wch: 12 }, // Duplicata
      { wch: 8 }, // Parcela
      { wch: 10 }, // Portador
      { wch: 12 }, // Emissão
      { wch: 12 }, // Entrada
      { wch: 12 }, // Liquidação
      { wch: 10 }, // Situação
      { wch: 10 }, // Estágio
      { wch: 12 }, // Juros
      { wch: 12 }, // Acréscimo
      { wch: 12 }, // Desconto
      { wch: 12 }, // Pago
      { wch: 10 }, // Aceite
      { wch: 14 }, // Rateio Total
      { wch: 30 }, // Observação
      { wch: 10 }, // Previsão
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Detalhamento');
    const fileName = `detalhamento_contas_${
      new Date().toISOString().split('T')[0]
    }.xlsx`;
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const dataBlob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(dataBlob, fileName);
  };

  // Limpar filtro de dia quando o filtro mensal mudar
  useEffect(() => {
    setFiltroDia(null);
  }, [filtroMensal]);

  // Empresas pré-selecionadas (serão carregadas do banco de dados)
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);

  // Centros de custo selecionados (carregados dos dados filtrados)
  const [centrosCustoSelecionados, setCentrosCustoSelecionados] = useState([]);
  const [despesasSelecionadas, setDespesasSelecionadas] = useState([]);

  // Estados para o modal de observações
  const [modalAberto, setModalAberto] = useState(false);
  const [dadosModal, setDadosModal] = useState(null);

  // Estados para ordenação
  const [sortConfig, setSortConfig] = useState({
    key: 'dt_vencimento',
    direction: 'asc',
  });

  // Estados para filtros de coluna (FilterDropdown)
  const [columnFilters, setColumnFilters] = useState({}); // { colKey: { sortDirection: 'asc', searchTerm: '', selected: ['val1', 'val2'] } }
  const [openFilterDropdown, setOpenFilterDropdown] = useState(null); // colKey of the open dropdown

  // Filtros agora são aplicados pelo backend (SQL) - dados já vêm filtrados da API
  const dadosFiltrados = dados;
  const dadosFiltradosPorAutorizacao = dados;
  const dadosFiltradosCompletos = dados;

  // Função para ordenar os dados
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Função para obter o ícone de ordenação
  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <CaretDown size={10} className="ml-1 opacity-50" />;
    }
    return sortConfig.direction === 'asc' ? (
      <CaretUp size={10} className="ml-1" />
    ) : (
      <CaretDown size={10} className="ml-1" />
    );
  };

  // Função para obter dias do mês
  const obterDiasDoMes = (mes) => {
    const meses = {
      JAN: 31,
      FEV: 28,
      MAR: 31,
      ABR: 30,
      MAI: 31,
      JUN: 30,
      JUL: 31,
      AGO: 31,
      SET: 30,
      OUT: 31,
      NOV: 30,
      DEZ: 31,
    };
    return meses[mes] || 0;
  };

  // Função para aplicar filtro mensal e por dia
  const aplicarFiltroMensal = (dados, filtro, diaFiltro = null) => {
    return dados.filter((item) => {
      // Usar dt_vencimento como base para o filtro mensal (data de vencimento)
      const dataVencimento = item.dt_vencimento;
      if (!dataVencimento) return false;

      const data = criarDataSemFusoHorario(dataVencimento);
      if (!data) return false;

      const ano = data.getFullYear();
      const mes = data.getMonth() + 1; // getMonth() retorna 0-11, então +1
      const dia = data.getDate();

      if (filtro === 'ANO') {
        // Mostrar TODOS os dados, independente do ano (permite anos diferentes)
        return true;
      }

      // Filtros por mês específico
      const mesesMap = {
        JAN: 1,
        FEV: 2,
        MAR: 3,
        ABR: 4,
        MAI: 5,
        JUN: 6,
        JUL: 7,
        AGO: 8,
        SET: 9,
        OUT: 10,
        NOV: 11,
        DEZ: 12,
      };

      const mesDoFiltro = mesesMap[filtro];
      if (mesDoFiltro) {
        // Se há filtro por dia, verificar também o dia
        if (diaFiltro !== null) {
          return mes === mesDoFiltro && dia === diaFiltro;
        }
        return mes === mesDoFiltro;
      }

      return true;
    });
  };

  // Função para agrupar dados idênticos (igual ao FluxoCaixa)
  const agruparDadosIdenticos = (dados) => {
    const grupos = new Map();

    dados.forEach((item) => {
      // Criar chave única SEM vl_rateio para manter totais corretos
      // O vl_rateio será usado apenas para separação visual no componente
      const chave = `${item.cd_fornecedor}|${item.nm_fornecedor}|${item.nr_duplicata}|${item.nr_parcela}|${item.cd_empresa}|${item.dt_emissao}|${item.dt_vencimento}|${item.dt_entrada}|${item.dt_liq}|${item.tp_situacao}|${item.tp_previsaoreal}|${item.vl_duplicata}|${item.vl_juros}|${item.vl_acrescimo}|${item.vl_desconto}|${item.vl_pago}`;

      if (!grupos.has(chave)) {
        grupos.set(chave, {
          item: item,
          observacoes: [],
          situacoes: [],
          datasEmissao: [],
          datasVencimento: [],
          datasEntrada: [],
          datasLiquidacao: [],
          rateios: [], // Array para armazenar diferentes rateios
          quantidade: 0,
        });
      }

      const grupo = grupos.get(chave);
      grupo.quantidade += 1;

      // Adicionar rateio se não existir
      if (item.vl_rateio && !grupo.rateios.includes(item.vl_rateio)) {
        grupo.rateios.push(item.vl_rateio);
      }

      // Adicionar observação se existir e for diferente
      if (
        item.ds_observacao &&
        !grupo.observacoes.includes(item.ds_observacao)
      ) {
        grupo.observacoes.push(item.ds_observacao);
      }

      // Adicionar situação se existir e for diferente
      if (item.tp_situacao && !grupo.situacoes.includes(item.tp_situacao)) {
        grupo.situacoes.push(item.tp_situacao);
      }

      // Adicionar previsão se existir e for diferente
      if (item.tp_previsaoreal && !grupo.previsoes) {
        grupo.previsoes = [];
      }
      if (
        item.tp_previsaoreal &&
        !grupo.previsoes.includes(item.tp_previsaoreal)
      ) {
        grupo.previsoes.push(item.tp_previsaoreal);
      }

      // Adicionar datas se existirem e forem diferentes
      if (item.dt_emissao && !grupo.datasEmissao.includes(item.dt_emissao)) {
        grupo.datasEmissao.push(item.dt_emissao);
      }
      if (
        item.dt_vencimento &&
        !grupo.datasVencimento.includes(item.dt_vencimento)
      ) {
        grupo.datasVencimento.push(item.dt_vencimento);
      }
      if (item.dt_entrada && !grupo.datasEntrada.includes(item.dt_entrada)) {
        grupo.datasEntrada.push(item.dt_entrada);
      }
      if (item.dt_liq && !grupo.datasLiquidacao.includes(item.dt_liq)) {
        grupo.datasLiquidacao.push(item.dt_liq);
      }
    });

    // Processar os grupos para determinar a situação final e datas mais relevantes
    return Array.from(grupos.values()).map((grupo) => {
      // Se há múltiplas situações, priorizar CANCELADAS (C) sobre NORMAIS (N)
      let situacaoFinal = grupo.item.tp_situacao;

      if (grupo.situacoes.length > 1) {
        // Se há 'C' entre as situações, usar 'C' (cancelada tem prioridade)
        if (grupo.situacoes.includes('C')) {
          situacaoFinal = 'C';
        } else if (grupo.situacoes.includes('N')) {
          situacaoFinal = 'N';
        }
        // Se não há nem 'C' nem 'N', manter a primeira situação
      }

      // Se há múltiplas previsões, priorizar REAL (R) sobre PREVISÃO (P) sobre CONSIGNADO (C)
      let previsaoFinal = grupo.item.tp_previsaoreal;

      if (grupo.previsoes && grupo.previsoes.length > 1) {
        // Prioridade: REAL > PREVISÃO > CONSIGNADO
        if (grupo.previsoes.includes('R')) {
          previsaoFinal = 'R';
        } else if (grupo.previsoes.includes('P')) {
          previsaoFinal = 'P';
        } else if (grupo.previsoes.includes('C')) {
          previsaoFinal = 'C';
        }
        // Se não há nenhum dos valores esperados, manter o primeiro
      }

      // Para as datas, usar a mais recente ou a mais relevante
      const dtEmissaoFinal =
        grupo.datasEmissao.length > 0
          ? grupo.datasEmissao.sort((a, b) => new Date(b) - new Date(a))[0]
          : grupo.item.dt_emissao;

      const dtVencimentoFinal =
        grupo.datasVencimento.length > 0
          ? grupo.datasVencimento.sort((a, b) => new Date(b) - new Date(a))[0]
          : grupo.item.dt_vencimento;

      const dtEntradaFinal =
        grupo.datasEntrada.length > 0
          ? grupo.datasEntrada.sort((a, b) => new Date(b) - new Date(a))[0]
          : grupo.item.dt_entrada;

      const dtLiquidacaoFinal =
        grupo.datasLiquidacao.length > 0
          ? grupo.datasLiquidacao.sort((a, b) => new Date(b) - new Date(a))[0]
          : grupo.item.dt_liq;

      return {
        ...grupo,
        item: {
          ...grupo.item,
          tp_situacao: situacaoFinal,
          tp_previsaoreal: previsaoFinal,
          dt_emissao: dtEmissaoFinal,
          dt_vencimento: dtVencimentoFinal,
          dt_entrada: dtEntradaFinal,
          dt_liq: dtLiquidacaoFinal,
        },
      };
    });
  };

  // Função para ordenar os dados
  const sortDadosAgrupados = (dados) => {
    if (!dados || dados.length === 0) return dados;

    return [...dados].sort((a, b) => {
      let aValue, bValue;

      switch (sortConfig.key) {
        case 'cd_empresa':
          aValue = a.item?.cd_empresa || '';
          bValue = b.item?.cd_empresa || '';
          break;
        case 'cd_fornecedor':
          aValue = a.item?.cd_fornecedor || '';
          bValue = b.item?.cd_fornecedor || '';
          break;
        case 'nm_fornecedor':
          aValue = a.item?.nm_fornecedor || '';
          bValue = b.item?.nm_fornecedor || '';
          break;
        case 'ds_despesaitem':
          aValue = a.item?.ds_despesaitem || '';
          bValue = b.item?.ds_despesaitem || '';
          break;
        case 'ds_ccusto':
          aValue = a.item?.ds_ccusto || '';
          bValue = b.item?.ds_ccusto || '';
          break;
        case 'nr_duplicata':
          aValue = a.item?.nr_duplicata || '';
          bValue = b.item?.nr_duplicata || '';
          break;
        case 'nr_portador':
          aValue = a.item?.nr_portador || '';
          bValue = b.item?.nr_portador || '';
          break;
        case 'dt_emissao':
          aValue = a.item?.dt_emissao
            ? criarDataSemFusoHorario(a.item.dt_emissao)
            : new Date(0);
          bValue = b.item?.dt_emissao
            ? criarDataSemFusoHorario(b.item.dt_emissao)
            : new Date(0);
          break;
        case 'dt_vencimento':
          aValue = a.item?.dt_vencimento
            ? criarDataSemFusoHorario(a.item.dt_vencimento)
            : new Date(0);
          bValue = b.item?.dt_vencimento
            ? criarDataSemFusoHorario(b.item.dt_vencimento)
            : new Date(0);
          break;
        case 'dt_entrada':
          aValue = a.item?.dt_entrada
            ? criarDataSemFusoHorario(a.item.dt_entrada)
            : new Date(0);
          bValue = b.item?.dt_entrada
            ? criarDataSemFusoHorario(b.item.dt_entrada)
            : new Date(0);
          break;
        case 'dt_liq':
          aValue = a.item?.dt_liq
            ? criarDataSemFusoHorario(a.item.dt_liq)
            : new Date(0);
          bValue = b.item?.dt_liq
            ? criarDataSemFusoHorario(b.item.dt_liq)
            : new Date(0);
          break;
        case 'tp_situacao':
          aValue = a.item?.tp_situacao || '';
          bValue = b.item?.tp_situacao || '';
          break;
        case 'tp_estagio':
          aValue = a.item?.tp_estagio || '';
          bValue = b.item?.tp_estagio || '';
          break;
        case 'tp_previsaoreal':
          aValue = a.item?.tp_previsaoreal || '';
          bValue = b.item?.tp_previsaoreal || '';
          break;
        case 'vl_duplicata':
          aValue = parseFloat(a.item?.vl_duplicata) || 0;
          bValue = parseFloat(b.item?.vl_duplicata) || 0;
          break;
        case 'vl_juros':
          aValue = parseFloat(a.item?.vl_juros) || 0;
          bValue = parseFloat(b.item?.vl_juros) || 0;
          break;
        case 'vl_acrescimo':
          aValue = parseFloat(a.item?.vl_acrescimo) || 0;
          bValue = parseFloat(b.item?.vl_acrescimo) || 0;
          break;
        case 'vl_desconto':
          aValue = parseFloat(a.item?.vl_desconto) || 0;
          bValue = parseFloat(b.item?.vl_desconto) || 0;
          break;
        case 'vl_pago':
          aValue = parseFloat(a.item?.vl_pago) || 0;
          bValue = parseFloat(b.item?.vl_pago) || 0;
          break;
        case 'in_aceite':
          aValue = a.item?.in_aceite || '';
          bValue = b.item?.in_aceite || '';
          break;
        case 'nr_parcela':
          aValue = parseInt(a.item?.nr_parcela) || 0;
          bValue = parseInt(b.item?.nr_parcela) || 0;
          break;
        default:
          aValue = a.item?.[sortConfig.key] || '';
          bValue = b.item?.[sortConfig.key] || '';
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

  const buscarDados = async (inicio = dataInicio, fim = dataFim) => {
    if (!inicio || !fim) return;

    if (empresasSelecionadas.length === 0) {
      alert('Selecione pelo menos uma empresa para consultar!');
      return;
    }

    setLoading(true);

    try {
      console.log('🔍 Iniciando busca de contas a pagar via API TOTVS...');
      console.log('📅 Período:', { inicio, fim });
      console.log('🏢 Empresas selecionadas:', empresasSelecionadas);

      // Adicionar códigos das empresas selecionadas como array
      const codigosEmpresas = empresasSelecionadas
        .filter((empresa) => empresa.cd_empresa)
        .map((empresa) => parseInt(empresa.cd_empresa));

      // Montar payload para a API TOTVS accounts-payable/search
      const payload = {
        dt_inicio: inicio,
        dt_fim: fim,
        branches: codigosEmpresas,
        modo: isEmissao ? 'emissao' : 'vencimento',
        situacao: situacao || 'N',
        previsao: previsao === 'PREVISÃO' ? 'PREVISAO' : previsao || 'TODOS',
      };

      // Adicionar filtro de fornecedor
      if (fornecedorBuscaSelecionado) {
        payload.supplierCodeList = [
          parseInt(fornecedorBuscaSelecionado.cd_pessoa),
        ];
      }

      // Adicionar filtro de duplicata
      if (duplicata && duplicata.trim() !== '') {
        payload.duplicateCodeList = [parseInt(duplicata.trim())].filter(
          (d) => !isNaN(d),
        );
      }

      console.log('📋 Payload da requisição TOTVS:', payload);
      console.log('🏢 Códigos das empresas:', codigosEmpresas);

      // Buscar dados via API TOTVS accounts-payable
      const result = await apiClient.totvs.accountsPayableSearch(payload);

      console.log('🔍 Resultado da API TOTVS:', {
        success: result?.success !== undefined ? result.success : !!result,
        dataLength: result?.data?.length || result?.count,
        message: result?.message,
        timeMs: result?.timeMs,
        totalCount: result?.totalCount,
        pagesSearched: result?.pagesSearched,
      });

      // Extrair dados da resposta
      let dadosArray = [];

      if (result && typeof result === 'object') {
        if (Array.isArray(result.data)) {
          dadosArray = result.data;
        } else if (result.data && Array.isArray(result.data.data)) {
          dadosArray = result.data.data;
        } else if (result.metadata && Array.isArray(result.metadata.data)) {
          dadosArray = result.metadata.data;
        } else {
          console.warn('⚠️ Estrutura de dados não reconhecida:', result);
          dadosArray = [];
        }
      }

      if (dadosArray.length > 0) {
        const primeiroItem = dadosArray[0];
        console.log(
          '🔍 Campos disponíveis no primeiro item:',
          Object.keys(primeiroItem),
        );

        // Verificar campos obrigatórios
        const camposObrigatorios = [
          'cd_empresa',
          'cd_fornecedor',
          'nr_duplicata',
          'dt_vencimento',
          'vl_duplicata',
        ];
        const camposFaltando = camposObrigatorios.filter(
          (campo) => !(campo in primeiroItem),
        );

        if (camposFaltando.length > 0) {
          console.warn(
            '⚠️ Campos faltando na resposta da API:',
            camposFaltando,
          );
        }
      }

      console.log('✅ Dados obtidos:', {
        total: dadosArray.length,
        amostra: dadosArray.slice(0, 2),
        empresas: codigosEmpresas,
      });

      // Todos os dados já vêm preenchidos da API TOTVS (fornecedor, despesa, ccusto código)
      // ds_ccusto = '----' pois a API TOTVS não retorna o nome do centro de custo
      const dadosProcessados = dadosArray.map((item) => ({
        ...item,
        ds_observacao: item.ds_observacao || '',
        in_aceite: item.in_aceite || '',
        vl_rateio: item.vl_rateio || 0,
        tp_aceite: item.in_aceite || '',
        ds_ccusto: item.cd_ccusto ? '----' : '',
        nm_fornecedor: item.nm_fornecedor || '',
        ds_despesaitem: item.ds_despesaitem || '',
        cd_despesaitem: item.cd_despesaitem || '',
        cd_ccusto: item.cd_ccusto || '',
      }));

      // Debug para verificar enriquecimento
      if (dadosProcessados.length > 0) {
        console.log('🔍 Debug - Primeiros 3 registros enriquecidos:');
        dadosProcessados.slice(0, 3).forEach((item, index) => {
          console.log(`📋 Registro ${index + 1}:`, {
            cd_fornecedor: item.cd_fornecedor,
            nm_fornecedor: item.nm_fornecedor,
            cd_ccusto: item.cd_ccusto,
            ds_ccusto: item.ds_ccusto,
            cd_despesaitem: item.cd_despesaitem,
            ds_despesaitem: item.ds_despesaitem,
          });
        });

        // Verificar se há dados vazios
        const fornecedoresVazios = dadosProcessados.filter(
          (item) => !item.nm_fornecedor,
        ).length;
        const centrosCustoVazios = dadosProcessados.filter(
          (item) => !item.ds_ccusto,
        ).length;
        const despesasVazias = dadosProcessados.filter(
          (item) => !item.ds_despesaitem,
        ).length;

        console.log('📊 Estatísticas dos dados processados:', {
          total: dadosProcessados.length,
          fornecedoresVazios,
          centrosCustoVazios,
          despesasVazias,
          percentualFornecedoresVazios:
            ((fornecedoresVazios / dadosProcessados.length) * 100).toFixed(2) +
            '%',
          percentualCentrosCustoVazios:
            ((centrosCustoVazios / dadosProcessados.length) * 100).toFixed(2) +
            '%',
          percentualDespesasVazias:
            ((despesasVazias / dadosProcessados.length) * 100).toFixed(2) + '%',
        });
      }

      // Aplicar filtros de centros de custo selecionados
      let dadosComFiltroCC = dadosProcessados;
      if (centrosCustoSelecionados.length > 0) {
        const ccsFiltro = centrosCustoSelecionados.map((c) =>
          String(c.cd_ccusto),
        );
        dadosComFiltroCC = dadosProcessados.filter((item) =>
          ccsFiltro.includes(String(item.cd_ccusto)),
        );
        console.log(
          `🔍 Filtro CC: ${dadosProcessados.length} → ${dadosComFiltroCC.length}`,
        );
      }

      // Aplicar filtros de despesas selecionadas
      let dadosComFiltroDespesa = dadosComFiltroCC;
      if (despesasSelecionadas.length > 0) {
        const despsFiltro = despesasSelecionadas.map((d) =>
          String(d.cd_despesaitem),
        );
        dadosComFiltroDespesa = dadosComFiltroCC.filter((item) =>
          despsFiltro.includes(String(item.cd_despesaitem)),
        );
        console.log(
          `🔍 Filtro Despesa: ${dadosComFiltroCC.length} → ${dadosComFiltroDespesa.length}`,
        );
      }

      // Aplicar bloqueio de centros de custo, se configurado pelo wrapper
      const dadosAposBloqueio =
        blockedCostCenters && blockedCostCenters.length > 0
          ? dadosComFiltroDespesa.filter((item) => {
              const cc = Number(
                typeof item.cd_ccusto === 'string'
                  ? parseInt(item.cd_ccusto, 10)
                  : item.cd_ccusto,
              );
              return !blockedCostCenters.includes(cc);
            })
          : dadosComFiltroDespesa;

      // Aplicar filtro de despesas fixas, se configurado pelo wrapper
      const dadosFinais =
        despesasFixas && despesasFixas.length > 0
          ? dadosAposBloqueio.filter((item) => {
              const cdDespesa = parseInt(item.cd_despesaitem) || 0;
              return despesasFixas.includes(cdDespesa);
            })
          : dadosAposBloqueio;

      console.log('🔍 DEBUG - Filtros finais:', {
        despesasFixas,
        blockedCostCenters,
        totalProcessados: dadosProcessados.length,
        totalAposFiltroCC: dadosComFiltroCC.length,
        totalAposFiltroDespesa: dadosComFiltroDespesa.length,
        totalAposBloqueio: dadosAposBloqueio.length,
        totalFinal: dadosFinais.length,
      });

      setDados(dadosFinais);
      // Extrair despesas únicas dos dados para alimentar o filtro
      const despesasUnicas = [];
      const despesaCodigosVistos = new Set();
      dadosFinais.forEach((item) => {
        if (
          item.cd_despesaitem &&
          !despesaCodigosVistos.has(item.cd_despesaitem)
        ) {
          despesaCodigosVistos.add(item.cd_despesaitem);
          despesasUnicas.push({
            cd_despesaitem: item.cd_despesaitem,
            ds_despesaitem: item.ds_despesaitem || '',
          });
        }
      });
      setDadosDespesa(despesasUnicas);
      // Extrair centros de custo únicos dos dados para alimentar filtro
      const ccUnicos = [];
      const ccCodigosVistos = new Set();
      dadosFinais.forEach((item) => {
        if (item.cd_ccusto && !ccCodigosVistos.has(item.cd_ccusto)) {
          ccCodigosVistos.add(item.cd_ccusto);
          ccUnicos.push({
            cd_ccusto: item.cd_ccusto,
            ds_ccusto: item.ds_ccusto || '----',
          });
        }
      });
      setDadosCentroCusto(ccUnicos);
      setDadosCarregados(true);

      console.log('✅ Resumo final:', {
        fonte: 'API TOTVS accounts-payable',
        contasPagar: dadosFinais.length,
      });
    } catch (err) {
      console.error('❌ Erro geral ao buscar dados:', err);
      setDados([]);
      setDadosCarregados(false);
    } finally {
      setLoading(false);
    }
  };

  const getStatusFromData = (item) => {
    // Se tem data de liquidação, está pago
    if (item.dt_liq) {
      return 'Pago';
    }

    // Se tem vencimento, verificar se está vencido
    if (item.dt_vencimento) {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const vencimento = criarDataSemFusoHorario(item.dt_vencimento);
      const diasParaVencer = Math.ceil(
        (vencimento - hoje) / (1000 * 60 * 60 * 24),
      );

      if (vencimento < hoje) {
        return 'Vencido';
      } else if (diasParaVencer >= 0 && diasParaVencer <= 7) {
        return 'Próxima a Vencer';
      } else {
        return 'A Vencer';
      }
    }

    // Verificar tp_situacao se disponível
    if (item.tp_situacao) {
      switch (item.tp_situacao.toString()) {
        case '1':
        case 'P':
          return 'Pago';
        case '2':
        case 'V':
          return 'Vencido';
        case '3':
        case 'A':
          return 'A Vencer';
        default:
          return 'Pendente';
      }
    }

    return 'Pendente';
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'pago':
      case 'liquidado':
        return 'bg-green-100 text-green-800';
      case 'vencido':
      case 'atrasado':
        return 'bg-red-100 text-red-800';
      case 'a vencer':
      case 'vencendo':
        return 'bg-yellow-100 text-yellow-800';
      case 'pendente':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status) => {
    switch (status?.toLowerCase()) {
      case 'pago':
      case 'liquidado':
        return <CheckCircle size={14} className="text-green-600" />;
      case 'vencido':
      case 'atrasado':
        return <Warning size={14} className="text-red-600" />;
      case 'a vencer':
      case 'vencendo':
        return <Clock size={14} className="text-yellow-600" />;
      case 'pendente':
        return <ArrowUp size={14} className="text-blue-600" />;
      default:
        return <ArrowDown size={14} className="text-gray-600" />;
    }
  };

  useEffect(() => {
    // Definir datas padrão (mês atual)
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

    setDataInicio(primeiroDia.toISOString().split('T')[0]);
    setDataFim(ultimoDia.toISOString().split('T')[0]);
  }, []);

  // Filtros de fornecedor, duplicata, centro de custo e despesa já aplicados pelo backend
  const dadosComFiltrosAdicionais = dadosFiltradosCompletos;

  // Aplicar filtro mensal aos dados filtrados
  const dadosComFiltroMensal = aplicarFiltroMensal(
    dadosComFiltrosAdicionais,
    filtroMensal,
    filtroDia,
  );

  // Usar dados filtrados diretamente (sem ordenação personalizada)
  const dadosOrdenadosComFiltroMensal = dadosComFiltroMensal;

  // Função para aplicar filtros de coluna aos dados
  const aplicarFiltrosColuna = useCallback(
    (dadosOriginais) => {
      if (!dadosOriginais || dadosOriginais.length === 0) return [];
      if (Object.keys(columnFilters).length === 0) return dadosOriginais;

      console.log('🔍 Aplicando filtros de coluna:', columnFilters);
      console.log('📊 Dados originais:', dadosOriginais.length);

      const dadosFiltrados = dadosOriginais.filter((grupo) => {
        const item = grupo.item;

        // Verificar cada filtro de coluna ativo
        for (const [columnKey, filterConfig] of Object.entries(columnFilters)) {
          if (!filterConfig) continue;

          const valorItem = String(item[columnKey] || '');

          // Filtro por texto (searchTerm)
          if (
            filterConfig.searchTerm &&
            filterConfig.searchTerm.trim() !== ''
          ) {
            if (
              !valorItem
                .toLowerCase()
                .includes(filterConfig.searchTerm.toLowerCase())
            ) {
              console.log(
                `❌ Item rejeitado por searchTerm - ${columnKey}: "${valorItem}" não contém "${filterConfig.searchTerm}"`,
              );
              return false;
            }
          }

          // Filtro por seleção (selected)
          if (filterConfig.selected && filterConfig.selected.length > 0) {
            if (!filterConfig.selected.includes(valorItem)) {
              console.log(
                `❌ Item rejeitado por seleção - ${columnKey}: "${valorItem}" não está em [${filterConfig.selected.join(
                  ', ',
                )}]`,
              );
              return false;
            }
          }
        }

        return true;
      });

      console.log('✅ Dados filtrados:', dadosFiltrados.length);
      return dadosFiltrados;
    },
    [columnFilters],
  );

  // ===== LÓGICA SEPARADA PARA OS CARDS (igual ao Fluxo de Caixa) =====
  // Agrupar dados APENAS para os cards (não afeta a tabela)
  const dadosAgrupadosParaCards = agruparDadosIdenticos(dadosComFiltroMensal);

  // Ordenar dados para cards usando useMemo para re-calcular quando sortConfig mudar
  const dadosOrdenadosParaCards = useMemo(() => {
    const dadosOrdenados = sortDadosAgrupados(dadosAgrupadosParaCards);
    // Aplicar filtros de coluna aos dados ordenados
    return aplicarFiltrosColuna(dadosOrdenados);
  }, [dadosAgrupadosParaCards, sortConfig, aplicarFiltrosColuna]);

  // Calcular dados paginados
  const calcularDadosPaginados = useMemo(() => {
    const inicio = (paginaAtual - 1) * registrosPorPagina;
    const fim = inicio + registrosPorPagina;
    return {
      dados: dadosOrdenadosParaCards.slice(inicio, fim),
      totalRegistros: dadosOrdenadosParaCards.length,
      totalPaginas: Math.ceil(
        dadosOrdenadosParaCards.length / registrosPorPagina,
      ),
      paginaAtual,
      registrosPorPagina,
    };
  }, [dadosOrdenadosParaCards, paginaAtual, registrosPorPagina]);

  // Função para mudar de página
  const mudarPagina = (novaPagina) => {
    const totalPaginas = Math.ceil(
      dadosOrdenadosParaCards.length / registrosPorPagina,
    );

    // Verificar se a página é válida
    if (novaPagina >= 1 && novaPagina <= totalPaginas) {
      setPaginaAtual(novaPagina);
      // Limpar seleção ao mudar de página
      setLinhasSelecionadasAgrupadas(new Set());
    } else if (totalPaginas > 0) {
      // Se a página não for válida, ir para a última página disponível
      setPaginaAtual(totalPaginas);
      setLinhasSelecionadasAgrupadas(new Set());
    }
  };

  // Função para ir para a primeira página
  const irParaPrimeiraPagina = () => mudarPagina(1);

  // Função para ir para a última página
  const irParaUltimaPagina = () =>
    mudarPagina(calcularDadosPaginados.totalPaginas);

  // Função para ir para a página anterior
  const irParaPaginaAnterior = () => {
    if (paginaAtual > 1) {
      mudarPagina(paginaAtual - 1);
    }
  };

  // Função para ir para a próxima página
  const irParaProximaPagina = () => {
    if (paginaAtual < calcularDadosPaginados.totalPaginas) {
      mudarPagina(paginaAtual + 1);
    }
  };

  // Cálculos dos cards (baseados em dados agrupados - igual ao Fluxo de Caixa)
  const totalContasCards = dadosOrdenadosParaCards.length;
  const totalValorCards = dadosOrdenadosParaCards.reduce(
    (acc, grupo) => acc + parseFloat(grupo.item.vl_duplicata || 0),
    0,
  );

  const contasVencidasCards = dadosOrdenadosParaCards.filter((grupo) => {
    const status = getStatusFromData(grupo.item);
    return status.toLowerCase().includes('vencido');
  });

  const totalContasVencidasCards = contasVencidasCards.length;
  const valorContasVencidasCards = contasVencidasCards.reduce(
    (acc, grupo) => acc + (parseFloat(grupo.item.vl_duplicata) || 0),
    0,
  );

  const contasAVencerCards = dadosOrdenadosParaCards.filter((grupo) => {
    const status = getStatusFromData(grupo.item);
    return status.toLowerCase().includes('vencer');
  });

  const totalContasAVencerCards = contasAVencerCards.length;
  const valorContasAVencerCards = contasAVencerCards.reduce(
    (acc, grupo) => acc + (parseFloat(grupo.item.vl_duplicata) || 0),
    0,
  );

  // Cálculo para contas próximas a vencer (próximos 7 dias)
  const hoje = new Date();
  const contasProximasVencerCards = dadosOrdenadosParaCards.filter((grupo) => {
    if (!grupo.item.dt_vencimento) return false;
    const dataVencimento = criarDataSemFusoHorario(grupo.item.dt_vencimento);
    const diasParaVencer = Math.ceil(
      (dataVencimento - hoje) / (1000 * 60 * 60 * 24),
    );
    return diasParaVencer >= 0 && diasParaVencer <= 7 && !grupo.item.dt_liq;
  });

  const totalContasProximasVencerCards = contasProximasVencerCards.length;
  const valorContasProximasVencerCards = contasProximasVencerCards.reduce(
    (acc, grupo) => acc + (parseFloat(grupo.item.vl_duplicata) || 0),
    0,
  );

  // Cálculo para contas pagas
  const contasPagasCards = dadosOrdenadosParaCards.filter((grupo) => {
    const status = getStatusFromData(grupo.item);
    return status.toLowerCase().includes('pago');
  });

  const totalContasPagasCards = contasPagasCards.length;
  const valorContasPagasCards = contasPagasCards.reduce(
    (acc, grupo) => acc + (parseFloat(grupo.item.vl_pago) || 0),
    0,
  );

  // Cálculo para valor que falta pagar
  const valorFaltaPagarCards = totalValorCards - valorContasPagasCards;

  // Cálculo para descontos ganhos
  const totalDescontosCards = dadosOrdenadosParaCards.reduce(
    (acc, grupo) => acc + (parseFloat(grupo.item.vl_desconto) || 0),
    0,
  );

  // Função para lidar com seleção de empresas
  const handleSelectEmpresas = (empresas) => {
    setEmpresasSelecionadas([...empresas]); // Garantir que é um novo array
  };

  // Função para lidar com seleção de centros de custo
  const handleSelectCentrosCusto = (centrosCusto) => {
    setCentrosCustoSelecionados([...centrosCusto]); // Garantir que é um novo array
  };

  // Função para lidar com seleção de despesas
  const handleSelectDespesas = (despesas) => {
    setDespesasSelecionadas([...despesas]); // Garantir que é um novo array
  };

  // Função para buscar fornecedores por nome ou fantasia (mesma rota buscar-clientes)
  const buscarFornecedorPorNome = async () => {
    const nome = termoBuscaFornecedor.trim();
    const fantasia = termoBuscaFantasiaFornecedor.trim();

    if (!nome && !fantasia) {
      alert('Digite o nome ou nome fantasia para buscar!');
      return;
    }

    setBuscandoFornecedores(true);
    try {
      let query = '';
      if (nome && fantasia) {
        query = `nm_pessoa=${encodeURIComponent(nome)}&nm_fantasia=${encodeURIComponent(fantasia)}`;
      } else if (nome) {
        query = `nm_pessoa=${encodeURIComponent(nome)}`;
      } else if (fantasia) {
        query = `nm_fantasia=${encodeURIComponent(fantasia)}`;
      }

      console.log('🔍 Buscando fornecedores:', { nome, fantasia });

      const response = await fetch(
        `${API_BASE_URL}/api/financial/buscar-clientes?${query}`,
      );

      if (!response.ok) {
        throw new Error('Erro ao buscar fornecedores');
      }

      const data = await response.json();
      console.log('✅ Fornecedores encontrados:', data);

      let fornecedores = [];
      if (data.success && data.data && Array.isArray(data.data)) {
        fornecedores = data.data;
      } else if (Array.isArray(data)) {
        fornecedores = data;
      }

      if (fornecedores.length === 0) {
        alert('Nenhum fornecedor encontrado com os critérios informados.');
      } else {
        setFornecedoresEncontrados(fornecedores);
        setModalBuscaFornecedorAberto(true);
      }
    } catch (error) {
      console.error('❌ Erro ao buscar fornecedores:', error);
      alert('Erro ao buscar fornecedores. Tente novamente.');
    } finally {
      setBuscandoFornecedores(false);
    }
  };

  const selecionarFornecedorBusca = (fornecedor) => {
    setFornecedorBuscaSelecionado(fornecedor);
    setModalBuscaFornecedorAberto(false);
    console.log('✅ Fornecedor selecionado para filtro:', fornecedor);
  };

  const limparFornecedorBusca = () => {
    setFornecedorBuscaSelecionado(null);
    setTermoBuscaFornecedor('');
    setTermoBuscaFantasiaFornecedor('');
  };

  const handleFiltrar = (e) => {
    e.preventDefault();
    buscarDados();
  };

  // Funções para controle do FilterDropdown
  const toggleFilterDropdown = (colKey) => {
    setOpenFilterDropdown((prev) => (prev === colKey ? null : colKey));
  };

  const handleApplyFilter = (columnKey, filterConfig) => {
    setColumnFilters((prev) => {
      if (filterConfig) {
        return { ...prev, [columnKey]: filterConfig };
      } else {
        const newState = { ...prev };
        delete newState[columnKey];
        return newState;
      }
    });
    setOpenFilterDropdown(null); // Fechar o dropdown após aplicar o filtro
  };

  // Função para fechar modal
  const fecharModal = () => {
    setModalAberto(false);
    setDadosModal(null);
  };

  // Funções para modal de detalhes da conta
  const abrirModalDetalhes = (conta) => {
    setModalDetalhes({ isOpen: true, conta });
  };

  const fecharModalDetalhes = () => {
    setModalDetalhes({ isOpen: false, conta: null });
  };

  // Funções para modal de confirmação de remoção de autorização
  const handleRemoveAuthorization = (chaveUnica, autorizadoPor) => {
    // Verificar se o usuário tem permissão
    if (!hasRole(['owner', 'admin', 'manager'])) {
      console.error('❌ Usuário sem permissão para remover autorização');
      alert('Você não tem permissão para realizar esta ação.');
      return;
    }

    setAutorizacaoToRemove({ chaveUnica, autorizadoPor });
    setShowConfirmModal(true);
  };

  const handleConfirmRemoveAuthorization = async () => {
    if (autorizacaoToRemove) {
      try {
        const { error } = await autorizacoesSupabase.removerAutorizacao(
          autorizacaoToRemove.chaveUnica,
        );

        if (error) {
          console.error('Erro ao remover autorização:', error);
          alert('Erro ao remover autorização. Tente novamente.');
          return;
        }

        // Atualizar estado local
        setAutorizacoes((prev) => {
          const novasAutorizacoes = { ...prev };
          delete novasAutorizacoes[autorizacaoToRemove.chaveUnica];
          return novasAutorizacoes;
        });

        console.log('✅ Autorização removida com sucesso');
      } catch (error) {
        console.error('Erro ao remover autorização:', error);
        alert('Erro ao remover autorização. Tente novamente.');
      }
    }
    setShowConfirmModal(false);
    setAutorizacaoToRemove(null);
  };

  /* Funções removidas
    const handleCancelRemoveAuthorizationOriginal = () => {
    setShowConfirmModal(false);
    setAutorizacaoToRemove(null);
  };

  // Fechar modal ao clicar fora ou pressionar ESC
    const handleModalCloseOriginal = (e) => {
    if (e.target === e.currentTarget) {
      handleCancelRemoveAuthorization();
    }
  };
    */

  // Adicionar listener para tecla ESC
  useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key === 'Escape' && showConfirmModal) {
        handleCancelRemoveAuthorization();
      }
      if (e.key === 'Escape' && showAutorizarTodosModal) {
        handleCancelAutorizarTodos();
      }
      if (e.key === 'Escape' && showRemoverTodosModal) {
        handleCancelRemoverTodos();
      }
    };

    if (showConfirmModal || showAutorizarTodosModal || showRemoverTodosModal) {
      document.addEventListener('keydown', handleEscKey);
      document.body.style.overflow = 'hidden'; // Prevenir scroll
    }

    return () => {
      document.removeEventListener('keydown', handleEscKey);
      document.body.style.overflow = 'unset';
    };
  }, [showConfirmModal, showAutorizarTodosModal, showRemoverTodosModal]);

  // Resetar página apenas quando necessário
  useEffect(() => {
    const totalPaginas = Math.ceil(
      dadosOrdenadosParaCards.length / registrosPorPagina,
    );

    // Se não há dados, ir para página 1
    if (dadosOrdenadosParaCards.length === 0) {
      setPaginaAtual(1);
    }
    // Se a página atual é maior que o total de páginas, ir para a última página
    else if (paginaAtual > totalPaginas && totalPaginas > 0) {
      setPaginaAtual(totalPaginas);
    }
  }, [dadosOrdenadosParaCards.length, paginaAtual, registrosPorPagina]);

  // Funções vazias para compatibilidade (substituindo funções de autorização removidas)
  const handleCancelRemoveAuthorization = () => setShowConfirmModal(false);
  const handleModalClose = () => setShowConfirmModal(false);
  const handleAutorizarTodosModalClose = () =>
    setShowAutorizarTodosModal(false);
  const handlePagarTodos = () => console.log('Função removida: Pagar Todos');
  const handleRemoverPagamentoTodos = () =>
    console.log('Função removida: Remover Pagamentos');
  const handlePagarSelecionados = () =>
    console.log('Função removida: Pagar Selecionados');
  const handleRemoverPagamentoSelecionados = () =>
    console.log('Função removida: Remover Pagamentos Selecionados');
  const handleAutorizarTodos = () =>
    console.log('Função removida: Autorizar Todos');
  const handleRemoverTodos = () =>
    console.log('Função removida: Remover Todos');
  const handleAutorizarSelecionados = () =>
    console.log('Função removida: Autorizar Selecionados');
  const handleRemoverSelecionados = () =>
    console.log('Função removida: Remover Selecionados');
  const carregarAutorizacoesSupabase = () =>
    console.log('Função removida: Carregar Autorizações Supabase');

  // Cálculos para autorizações
  // Simplificado - sem cálculos de autorização
  const contasAutorizadas = [];
  const totalContasAutorizadas = 0;
  const valorTotalAutorizado = 0;

  // Função para mostrar modal de acesso restrito
  const handleAcessoRestrito = (enviadoPor) => {
    setDadosAcessoRestrito({ enviadoPor });
    setShowAcessoRestritoModal(true);
  };

  const handleCloseAcessoRestrito = () => {
    setShowAcessoRestritoModal(false);
    setDadosAcessoRestrito(null);
  };

  // Função para pagar todas as contas autorizadas
  const handlePagarTodosRemovida = async () => {
    // Verificar se o usuário tem permissão
    if (!hasRole(['user'])) {
      console.error('❌ Usuário sem permissão para pagar contas');
      alert('Você não tem permissão para realizar esta ação.');
      return;
    }

    const contasAutorizadas = dadosOrdenadosParaCards.filter((grupo) => {
      const chaveUnica = `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`;
      const autorizacao = autorizacoes[chaveUnica];
      const contaPaga = grupo.item.dt_liq && grupo.item.dt_liq.trim() !== '';
      return (
        autorizacao &&
        autorizacao.status === STATUS_AUTORIZACAO.AUTORIZADO &&
        !contaPaga
      );
    });

    if (contasAutorizadas.length === 0) {
      alert('Nenhuma conta autorizada para pagar!');
      return;
    }

    try {
      const chavesUnicas = contasAutorizadas.map(
        (grupo) =>
          `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`,
      );

      const { error } = await autorizacoesSupabase.enviarMultiplasParaPagamento(
        chavesUnicas,
        user?.name || 'USUÁRIO',
      );

      if (error) {
        console.error('Erro ao pagar todas as contas:', error);
        alert('Erro ao pagar contas. Tente novamente.');
        return;
      }

      // Atualizar estado local
      const novasAutorizacoes = { ...autorizacoes };
      contasAutorizadas.forEach((grupo) => {
        const chaveUnica = `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`;
        novasAutorizacoes[chaveUnica] = {
          ...novasAutorizacoes[chaveUnica],
          status: STATUS_AUTORIZACAO.ENVIADO_PAGAMENTO,
          enviadoPor: user?.name || 'USUÁRIO',
          dataEnvioPagamento: new Date().toISOString(),
        };
      });

      setAutorizacoes(novasAutorizacoes);
      console.log('✅ Todas as contas autorizadas foram pagas com sucesso');
      alert(`✅ ${contasAutorizadas.length} contas foram pagas com sucesso!`);
    } catch (error) {
      console.error('Erro ao pagar todas as contas:', error);
      alert('Erro ao pagar contas. Tente novamente.');
    }
  };

  // Função para remover pagamento de todas as contas
  const handleRemoverPagamentoTodosRemovida = async () => {
    // Verificar se o usuário tem permissão
    if (!hasRole(['user'])) {
      console.error('❌ Usuário sem permissão para remover pagamento');
      alert('Você não tem permissão para realizar esta ação.');
      return;
    }

    const contasEnviadas = dadosOrdenadosParaCards.filter((grupo) => {
      const chaveUnica = `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`;
      const autorizacao = autorizacoes[chaveUnica];
      const contaPaga = grupo.item.dt_liq && grupo.item.dt_liq.trim() !== '';
      return (
        autorizacao &&
        autorizacao.status === STATUS_AUTORIZACAO.ENVIADO_PAGAMENTO &&
        !contaPaga
      );
    });

    if (contasEnviadas.length === 0) {
      alert('Nenhuma conta enviada para pagamento para remover!');
      return;
    }

    try {
      const chavesUnicas = contasEnviadas.map(
        (grupo) =>
          `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`,
      );

      const { error } =
        await autorizacoesSupabase.removerMultiplasEnviadasParaPagamento(
          chavesUnicas,
        );

      if (error) {
        console.error('Erro ao remover pagamento de todas as contas:', error);
        alert('Erro ao remover pagamento. Tente novamente.');
        return;
      }

      // Atualizar estado local
      const novasAutorizacoes = { ...autorizacoes };
      contasEnviadas.forEach((grupo) => {
        const chaveUnica = `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`;
        novasAutorizacoes[chaveUnica] = {
          ...novasAutorizacoes[chaveUnica],
          status: STATUS_AUTORIZACAO.AUTORIZADO,
          enviadoPor: null,
          dataEnvioPagamento: null,
        };
      });

      setAutorizacoes(novasAutorizacoes);
      console.log('✅ Pagamento removido de todas as contas com sucesso');
      alert(
        `✅ Pagamento removido de ${contasEnviadas.length} contas com sucesso!`,
      );
    } catch (error) {
      console.error('Erro ao remover pagamento de todas as contas:', error);
      alert('Erro ao remover pagamento. Tente novamente.');
    }
  };

  // Função para pagar contas selecionadas
  const handlePagarSelecionadosRemovida = async () => {
    // Verificar se o usuário tem permissão
    if (!hasRole(['user'])) {
      console.error('❌ Usuário sem permissão para pagar contas selecionadas');
      alert('Você não tem permissão para realizar esta ação.');
      return;
    }

    if (linhasSelecionadasAgrupadas.size === 0) {
      alert('Nenhuma conta selecionada para pagar!');
      return;
    }

    const contasSelecionadas = Array.from(linhasSelecionadasAgrupadas).map(
      (index) => dadosOrdenadosParaCards[index],
    );
    const contasAutorizadas = contasSelecionadas.filter((grupo) => {
      const chaveUnica = `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`;
      const autorizacao = autorizacoes[chaveUnica];
      const contaPaga = grupo.item.dt_liq && grupo.item.dt_liq.trim() !== '';
      return (
        autorizacao &&
        autorizacao.status === STATUS_AUTORIZACAO.AUTORIZADO &&
        !contaPaga
      );
    });

    if (contasAutorizadas.length === 0) {
      alert('Nenhuma das contas selecionadas está autorizada!');
      return;
    }

    try {
      const chavesUnicas = contasAutorizadas.map(
        (grupo) =>
          `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`,
      );

      const { error } = await autorizacoesSupabase.enviarMultiplasParaPagamento(
        chavesUnicas,
        user?.name || 'USUÁRIO',
      );

      if (error) {
        console.error('Erro ao pagar contas selecionadas:', error);
        alert('Erro ao pagar contas. Tente novamente.');
        return;
      }

      // Atualizar estado local
      const novasAutorizacoes = { ...autorizacoes };
      contasAutorizadas.forEach((grupo) => {
        const chaveUnica = `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`;
        novasAutorizacoes[chaveUnica] = {
          ...novasAutorizacoes[chaveUnica],
          status: STATUS_AUTORIZACAO.ENVIADO_PAGAMENTO,
          enviadoPor: user?.name || 'USUÁRIO',
          dataEnvioPagamento: new Date().toISOString(),
        };
      });

      setAutorizacoes(novasAutorizacoes);
      console.log('✅ Contas selecionadas pagas com sucesso');
      alert(
        `✅ ${contasAutorizadas.length} contas selecionadas foram pagas com sucesso!`,
      );

      // Limpar seleção
      setLinhasSelecionadasAgrupadas(new Set());
    } catch (error) {
      console.error('Erro ao pagar contas selecionadas:', error);
      alert('Erro ao pagar contas. Tente novamente.');
    }
  };

  // Função para remover pagamento de contas selecionadas
  const handleRemoverPagamentoSelecionadosRemovida = async () => {
    // Verificar se o usuário tem permissão
    if (!hasRole(['user'])) {
      console.error(
        '❌ Usuário sem permissão para remover pagamento de contas selecionadas',
      );
      alert('Você não tem permissão para realizar esta ação.');
      return;
    }

    if (linhasSelecionadasAgrupadas.size === 0) {
      alert('Nenhuma conta selecionada para remover pagamento!');
      return;
    }

    const contasSelecionadas = Array.from(linhasSelecionadasAgrupadas).map(
      (index) => dadosOrdenadosParaCards[index],
    );
    const contasEnviadas = contasSelecionadas.filter((grupo) => {
      const chaveUnica = `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`;
      const autorizacao = autorizacoes[chaveUnica];
      const contaPaga = grupo.item.dt_liq && grupo.item.dt_liq.trim() !== '';
      return (
        autorizacao &&
        autorizacao.status === STATUS_AUTORIZACAO.ENVIADO_PAGAMENTO &&
        !contaPaga
      );
    });

    if (contasEnviadas.length === 0) {
      alert('Nenhuma das contas selecionadas foi enviada para pagamento!');
      return;
    }

    try {
      const chavesUnicas = contasEnviadas.map(
        (grupo) =>
          `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`,
      );

      const { error } =
        await autorizacoesSupabase.removerMultiplasEnviadasParaPagamento(
          chavesUnicas,
        );

      if (error) {
        console.error(
          'Erro ao remover pagamento das contas selecionadas:',
          error,
        );
        alert('Erro ao remover pagamento. Tente novamente.');
        return;
      }

      // Atualizar estado local
      const novasAutorizacoes = { ...autorizacoes };
      contasEnviadas.forEach((grupo) => {
        const chaveUnica = `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`;
        novasAutorizacoes[chaveUnica] = {
          ...novasAutorizacoes[chaveUnica],
          status: STATUS_AUTORIZACAO.AUTORIZADO,
          enviadoPor: null,
          dataEnvioPagamento: null,
        };
      });

      setAutorizacoes(novasAutorizacoes);
      console.log('✅ Pagamento removido das contas selecionadas com sucesso');
      alert(
        `✅ Pagamento removido de ${contasEnviadas.length} contas selecionadas com sucesso!`,
      );

      // Limpar seleção
      setLinhasSelecionadasAgrupadas(new Set());
    } catch (error) {
      console.error(
        'Erro ao remover pagamento das contas selecionadas:',
        error,
      );
      alert('Erro ao remover pagamento. Tente novamente.');
    }
  };

  // Função para enviar múltiplas contas selecionadas para pagamento
  const handleEnviarSelecionadosParaPagamento = async () => {
    if (linhasSelecionadasAgrupadas.size === 0) {
      alert('Nenhuma conta selecionada para enviar para pagamento!');
      return;
    }

    const contasSelecionadas = Array.from(linhasSelecionadasAgrupadas).map(
      (index) => dadosOrdenadosParaCards[index],
    );
    const contasAutorizadas = contasSelecionadas.filter((grupo) => {
      const chaveUnica = `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`;
      const autorizacao = autorizacoes[chaveUnica];
      return (
        autorizacao && autorizacao.status === STATUS_AUTORIZACAO.AUTORIZADO
      );
    });

    if (contasAutorizadas.length === 0) {
      alert('Nenhuma das contas selecionadas está autorizada!');
      return;
    }

    try {
      const chavesUnicas = contasAutorizadas.map(
        (grupo) =>
          `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`,
      );

      const { error } = await autorizacoesSupabase.enviarMultiplasParaPagamento(
        chavesUnicas,
        user?.name || 'USUÁRIO',
      );

      if (error) {
        console.error(
          'Erro ao enviar contas selecionadas para pagamento:',
          error,
        );
        alert('Erro ao enviar contas para pagamento. Tente novamente.');
        return;
      }

      // Atualizar estado local
      const novasAutorizacoes = { ...autorizacoes };
      contasAutorizadas.forEach((grupo) => {
        const chaveUnica = `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`;
        novasAutorizacoes[chaveUnica] = {
          ...novasAutorizacoes[chaveUnica],
          status: STATUS_AUTORIZACAO.ENVIADO_PAGAMENTO,
          enviadoPor: user?.name || 'USUÁRIO',
          dataEnvioPagamento: new Date().toISOString(),
        };
      });

      setAutorizacoes(novasAutorizacoes);
      console.log('✅ Contas selecionadas enviadas para pagamento com sucesso');

      // Limpar seleção
      setLinhasSelecionadasAgrupadas(new Set());
    } catch (error) {
      console.error(
        'Erro ao enviar contas selecionadas para pagamento:',
        error,
      );
      alert('Erro ao enviar contas para pagamento. Tente novamente.');
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Contas a Pagar"
        subtitle="Gerencie e acompanhe todas as contas a pagar da empresa"
        icon={Receipt}
        iconColor="text-red-600"
      />

      {/* Filtros */}
      <div className="mb-4">
        <form
          onSubmit={handleFiltrar}
          className="flex flex-col bg-white p-3 rounded-lg shadow-lg w-full max-w-4xl mx-auto border border-[#000638]/10"
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-1 mb-3">
            <div className="lg:col-span-2">
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={handleSelectEmpresas}
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
                Situação
              </label>
              <select
                value={situacao}
                onChange={(e) => setSituacao(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="TODAS">TODAS</option>
                <option value="N">NORMAL</option>
                <option value="C">CANCELADA</option>
                <option value="A">AGRUPADA</option>
                <option value="D">DEVOLVIDA</option>
                <option value="L">LIQUIDADA COMISSÃO</option>
                <option value="Q">QUEBRADA</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Previsão
              </label>
              <select
                value={previsao}
                onChange={(e) => setPrevisao(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="TODOS">TODOS</option>
                <option value="PREVISÃO">PREVISÃO</option>
                <option value="REAL">REAL</option>
                <option value="CONSIGNADO">CONSIGNADO</option>
              </select>
            </div>
            {/* Busca de fornecedor por nome */}
            <div className="relative">
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Buscar Fornecedor
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={
                    fornecedorBuscaSelecionado
                      ? fornecedorBuscaSelecionado.nm_pessoa
                      : termoBuscaFornecedor
                  }
                  onChange={(e) => {
                    setTermoBuscaFornecedor(e.target.value);
                    if (fornecedorBuscaSelecionado)
                      setFornecedorBuscaSelecionado(null);
                  }}
                  onKeyPress={(e) =>
                    e.key === 'Enter' &&
                    (e.preventDefault(), buscarFornecedorPorNome())
                  }
                  placeholder="Nome do fornecedor..."
                  className={`border border-[#000638]/30 rounded-lg px-2 py-1.5 pr-8 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] text-xs ${
                    fornecedorBuscaSelecionado
                      ? 'bg-blue-50 text-blue-800 font-medium'
                      : 'bg-[#f8f9fb] text-[#000638]'
                  }`}
                />
                {fornecedorBuscaSelecionado ? (
                  <button
                    type="button"
                    onClick={limparFornecedorBusca}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-red-500 hover:text-red-700"
                    title="Limpar fornecedor"
                  >
                    <X size={14} weight="bold" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={buscarFornecedorPorNome}
                    disabled={buscandoFornecedores}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#000638] hover:text-[#000638]/70 disabled:opacity-50"
                    title="Buscar fornecedor"
                  >
                    {buscandoFornecedores ? (
                      <Spinner size={14} className="animate-spin" />
                    ) : (
                      <MagnifyingGlass size={14} weight="bold" />
                    )}
                  </button>
                )}
              </div>
            </div>
            <div className="relative">
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Buscar Fantasia
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={
                    fornecedorBuscaSelecionado
                      ? fornecedorBuscaSelecionado.nm_fantasia || ''
                      : termoBuscaFantasiaFornecedor
                  }
                  onChange={(e) => {
                    setTermoBuscaFantasiaFornecedor(e.target.value);
                    if (fornecedorBuscaSelecionado)
                      setFornecedorBuscaSelecionado(null);
                  }}
                  onKeyPress={(e) =>
                    e.key === 'Enter' &&
                    (e.preventDefault(), buscarFornecedorPorNome())
                  }
                  placeholder="Nome fantasia..."
                  className={`border border-[#000638]/30 rounded-lg px-2 py-1.5 pr-8 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] text-xs ${
                    fornecedorBuscaSelecionado
                      ? 'bg-blue-50 text-blue-800 font-medium'
                      : 'bg-[#f8f9fb] text-[#000638]'
                  }`}
                />
                {fornecedorBuscaSelecionado ? (
                  <button
                    type="button"
                    onClick={limparFornecedorBusca}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-red-500 hover:text-red-700"
                    title="Limpar fornecedor"
                  >
                    <X size={14} weight="bold" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={buscarFornecedorPorNome}
                    disabled={buscandoFornecedores}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#000638] hover:text-[#000638]/70 disabled:opacity-50"
                    title="Buscar fornecedor"
                  >
                    {buscandoFornecedores ? (
                      <Spinner size={14} className="animate-spin" />
                    ) : (
                      <MagnifyingGlass size={14} weight="bold" />
                    )}
                  </button>
                )}
              </div>
            </div>
            <div>
              <FiltroDespesas
                despesasSelecionadas={despesasSelecionadas}
                onSelectDespesas={handleSelectDespesas}
                dadosDespesa={dadosDespesa}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Duplicata
              </label>
              <input
                type="text"
                value={duplicata}
                onChange={(e) => setDuplicata(e.target.value)}
                placeholder="Buscar duplicata..."
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <FiltroCentroCusto
                centrosCustoSelecionados={centrosCustoSelecionados}
                onSelectCentrosCusto={handleSelectCentrosCusto}
                dadosCentroCusto={dadosCentroCusto}
              />
            </div>
            <div className="flex items-center">
              <button
                type="submit"
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase"
                disabled={loading || !dataInicio || !dataFim}
              >
                {loading ? (
                  <>
                    <Spinner size={10} className="animate-spin" />
                    <span>Buscando...</span>
                  </>
                ) : (
                  <>
                    <Calendar size={10} />
                    <span>Buscar Dados</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8 max-w-7xl mx-auto">
        {/* Total de Contas */}
        <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Receipt size={18} className="text-blue-600" />
              <CardTitle className="text-sm font-bold text-blue-700">
                Total de Contas
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-blue-600 mb-0.5">
              {loading ? (
                <Spinner size={24} className="animate-spin text-blue-600" />
              ) : (
                totalContasCards
              )}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Contas no período
            </CardDescription>
          </CardContent>
        </Card>

        {/* Valor Total */}
        <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CurrencyDollar size={18} className="text-green-600" />
              <CardTitle className="text-sm font-bold text-green-700">
                Valor Total
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-green-600 mb-0.5 break-words">
              {loading ? (
                <Spinner size={24} className="animate-spin text-green-600" />
              ) : (
                totalValorCards.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })
              )}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Valor total das contas
            </CardDescription>
          </CardContent>
        </Card>

        {/* Falta Pagar */}
        <Card
          className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
          onClick={() => abrirModalCard('faltaPagar')}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <ArrowDown size={18} className="text-purple-600" />
              <CardTitle className="text-sm font-bold text-purple-700">
                Falta Pagar
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-purple-600 mb-0.5">
              {loading ? (
                <Spinner size={24} className="animate-spin text-purple-600" />
              ) : (
                valorFaltaPagarCards.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })
              )}
            </div>
            <div className="text-base font-medium text-purple-500">
              {loading
                ? '...'
                : `${totalContasCards - totalContasPagasCards} contas`}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Contas pendentes
            </CardDescription>
          </CardContent>
        </Card>

        {/* Contas Vencidas */}
        <Card
          className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
          onClick={() => abrirModalCard('vencidas')}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Warning size={18} className="text-red-600" />
              <CardTitle className="text-sm font-bold text-red-700">
                Contas Vencidas
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-red-600 mb-0.5">
              {loading ? (
                <Spinner size={24} className="animate-spin text-red-600" />
              ) : (
                valorContasVencidasCards.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })
              )}
            </div>
            <div className="text-base font-medium text-red-500">
              {loading ? '...' : `${totalContasVencidasCards} contas`}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Contas em atraso
            </CardDescription>
          </CardContent>
        </Card>

        {/* Contas A Vencer */}
        <Card
          className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
          onClick={() => abrirModalCard('aVencer')}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Clock size={18} className="text-yellow-600" />
              <CardTitle className="text-sm font-bold text-yellow-700">
                A Vencer
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-yellow-600 mb-0.5">
              {loading ? (
                <Spinner size={24} className="animate-spin text-yellow-600" />
              ) : (
                valorContasAVencerCards.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })
              )}
            </div>
            <div className="text-base font-medium text-yellow-500">
              {loading ? '...' : `${totalContasAVencerCards} contas`}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Contas futuras
            </CardDescription>
          </CardContent>
        </Card>

        {/* Próximas a Vencer (próximos 7 dias) */}
        <Card
          className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
          onClick={() => abrirModalCard('proximasVencer')}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <ArrowUp size={18} className="text-orange-600" />
              <CardTitle className="text-sm font-bold text-orange-700">
                Próximas a Vencer
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-orange-600 mb-0.5">
              {loading ? (
                <Spinner size={24} className="animate-spin text-orange-600" />
              ) : (
                valorContasProximasVencerCards.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })
              )}
            </div>
            <div className="text-base font-medium text-orange-500">
              {loading ? '...' : `${totalContasProximasVencerCards} contas`}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Próximos 7 dias
            </CardDescription>
          </CardContent>
        </Card>

        {/* Contas Pagas */}
        <Card
          className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
          onClick={() => abrirModalCard('pagas')}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CheckCircle size={18} className="text-green-600" />
              <CardTitle className="text-sm font-bold text-green-700">
                Contas Pagas
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-green-600 mb-0.5">
              {loading ? (
                <Spinner size={24} className="animate-spin text-green-600" />
              ) : (
                valorContasPagasCards.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })
              )}
            </div>
            <div className="text-base font-medium text-green-500">
              {loading ? '...' : `${totalContasPagasCards} contas`}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Contas liquidadas
            </CardDescription>
          </CardContent>
        </Card>

        {/* Descontos Ganhos */}
        <Card
          className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
          onClick={() => abrirModalCard('descontos')}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <TrendDown size={18} className="text-emerald-600" />
              <CardTitle className="text-sm font-bold text-emerald-700">
                Descontos Ganhos
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-emerald-600 mb-0.5">
              {loading ? (
                <Spinner size={24} className="animate-spin text-emerald-600" />
              ) : (
                totalDescontosCards.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })
              )}
            </div>
            <div className="text-base font-medium text-emerald-500">
              {loading
                ? '...'
                : `${
                    dadosOrdenadosParaCards.filter(
                      (grupo) => parseFloat(grupo.item.vl_desconto || 0) > 0,
                    ).length
                  } contas`}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Total de descontos obtidos
            </CardDescription>
          </CardContent>
        </Card>
      </div>

      {/* Conteúdo principal */}
      <div className="flex flex-col gap-3 justify-center bg-white rounded-lg shadow-lg border border-[#000638]/10">
        <div className="p-3">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="flex items-center gap-1">
                <Spinner size={18} className="animate-spin text-blue-600" />
                <span className="text-sm text-gray-600">
                  Carregando dados...
                </span>
              </div>
            </div>
          ) : !dadosCarregados ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="text-gray-500 text-sm mb-0.5">
                  Clique em "Buscar Dados" para carregar as informações
                </div>
                <div className="text-gray-400 text-xs">
                  Selecione o período e empresa desejados
                </div>
              </div>
            </div>
          ) : dados.length === 0 ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="text-gray-500 text-sm mb-0.5">
                  Nenhum dado encontrado
                </div>
                <div className="text-gray-400 text-xs">
                  Verifique o período selecionado ou tente novamente
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Plano de Contas (dropdown) */}
              <div className="bg-white rounded-lg shadow-lg border border-[#000638]/10 w-full mb-3">
                <button
                  className="w-full p-3 flex items-center justify-between"
                  onClick={() => setPlanoOpen(!planoOpen)}
                >
                  <h2 className="text-sm font-bold text-[#000638]">
                    Plano de Contas
                  </h2>
                  <span className="text-xs text-gray-500">
                    {planoOpen ? 'Ocultar' : 'Mostrar'}
                  </span>
                </button>
                {planoOpen && (
                  <div className="p-3 border-t border-[#000638]/10">
                    <DespesasPorCategoria
                      dados={dadosOrdenadosComFiltroMensal}
                      totalContas={dadosOrdenadosComFiltroMensal.length}
                      linhasSelecionadas={linhasSelecionadas}
                      toggleLinhaSelecionada={toggleLinhaSelecionada}
                      filtroMensal={filtroMensal}
                      setFiltroMensal={setFiltroMensal}
                      dadosOriginais={dadosComFiltrosAdicionais}
                      filtroDia={filtroDia}
                      setFiltroDia={setFiltroDia}
                      handleFiltroMensalChange={handleFiltroMensalChange}
                      obterDiasDoMes={obterDiasDoMes}
                      abrirModalDetalhes={abrirModalDetalhes}
                      getSortIcon={getSortIcon}
                      handleSort={handleSort}
                      agruparDadosIdenticos={agruparDadosIdenticos}
                    />
                  </div>
                )}
              </div>

              {/* Detalhamento de Contas */}
              <div className="bg-white rounded-lg shadow-lg border border-[#000638]/10  w-full mb-3">
                <div className="p-3 border-b border-[#000638]/10">
                  <h2 className="text-sm font-bold text-[#000638]">
                    Detalhamento de Contas
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">
                    Registros consolidados por duplicata/parcela/fornecedor,
                    unificando situações, previsões e datas como nos cards.
                  </p>
                  {carregandoAutorizacoes && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-blue-600">
                      <Spinner size={10} className="animate-spin" />
                      <span>Carregando autorizações...</span>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-1">
                    {(() => {
                      const allSelected =
                        linhasSelecionadasAgrupadas.size ===
                          calcularDadosPaginados.dados.length &&
                        calcularDadosPaginados.dados.length > 0;
                      const cls = allSelected
                        ? 'text-xs px-0.5 py-0.5 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors'
                        : 'text-xs px-0.5 py-0.5 bg-[#000638] text-white rounded hover:bg-[#fe0000] transition-colors';
                      return (
                        <button
                          onClick={() => {
                            const isAll =
                              linhasSelecionadasAgrupadas.size ===
                                calcularDadosPaginados.dados.length &&
                              calcularDadosPaginados.dados.length > 0;
                            if (isAll) {
                              // Desmarcar todas da página atual
                              const indicesParaRemover =
                                calcularDadosPaginados.dados.map(
                                  (_, idx) =>
                                    (calcularDadosPaginados.paginaAtual - 1) *
                                      calcularDadosPaginados.registrosPorPagina +
                                    idx,
                                );
                              setLinhasSelecionadasAgrupadas((prev) => {
                                const novoSet = new Set(prev);
                                indicesParaRemover.forEach((idx) =>
                                  novoSet.delete(idx),
                                );
                                return novoSet;
                              });
                            } else {
                              // Selecionar todas da página atual
                              const indicesParaAdicionar =
                                calcularDadosPaginados.dados.map(
                                  (_, idx) =>
                                    (calcularDadosPaginados.paginaAtual - 1) *
                                      calcularDadosPaginados.registrosPorPagina +
                                    idx,
                                );
                              setLinhasSelecionadasAgrupadas((prev) => {
                                const novoSet = new Set(prev);
                                indicesParaAdicionar.forEach((idx) =>
                                  novoSet.add(idx),
                                );
                                return novoSet;
                              });
                            }
                          }}
                          className={cls}
                        >
                          {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
                        </button>
                      );
                    })()}
                    {/* Botões de autorização removidos */}
                    {hasRole(['user']) && (
                      <>
                        <button
                          onClick={() => handlePagarTodos()}
                          className="text-xs px-0.5 py-0.5 bg-yellow-500 text-black font-bold rounded hover:bg-yellow-600 transition-colors"
                        >
                          PAGAR TODOS
                        </button>
                        <button
                          onClick={() => handleRemoverPagamentoTodos()}
                          className="text-xs px-0.5 py-0.5 bg-red-500 text-white font-bold rounded hover:bg-red-600 transition-colors"
                        >
                          REMOVER TODOS
                        </button>
                        <button
                          onClick={() => handlePagarSelecionados()}
                          disabled={linhasSelecionadasAgrupadas.size === 0}
                          className="text-xs px-0.5 py-0.5 bg-yellow-500 text-black font-bold rounded hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          PAGAR SELECIONADOS ({linhasSelecionadasAgrupadas.size}
                          )
                        </button>
                        <button
                          onClick={() => handleRemoverPagamentoSelecionados()}
                          disabled={linhasSelecionadasAgrupadas.size === 0}
                          className="text-xs px-0.5 py-0.5 bg-red-500 text-white font-bold rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          REMOVER SELECIONADOS (
                          {linhasSelecionadasAgrupadas.size})
                        </button>
                      </>
                    )}
                    <button
                      onClick={exportarExcelDetalhamento}
                      className="text-xs px-0.5 py-0.5 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                    >
                      Baixar Excel
                    </button>
                    {hasRole(['owner', 'admin', 'manager']) && (
                      <button
                        onClick={carregarAutorizacoesSupabase}
                        disabled={carregandoAutorizacoes}
                        className="text-xs px-0.5 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {carregandoAutorizacoes ? (
                          <div className="flex items-center gap-1">
                            <Spinner size={10} className="animate-spin" />
                            <span>Carregando...</span>
                          </div>
                        ) : (
                          '🔄 Recarregar'
                        )}
                      </button>
                    )}
                  </div>
                </div>
                <div className="p-3 overflow-x-auto">
                  <table className="contas-table w-full border-collapse">
                    <thead className="min-w-full border border-gray-200 rounded-lg">
                      <tr className="bg-[#000638] text-white text-[8px]">
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px]"
                          style={{
                            width: '30px',
                            minWidth: '30px',
                            position: 'sticky',
                            left: 0,
                            zIndex: 10,
                          }}
                        >
                          Selecionar
                        </th>
                        {(hasRole(['owner', 'admin', 'manager']) ||
                          hasRole(['user'])) && (
                          <th className="px-0.5 py-0.5 text-center text-[8px]">
                            Ações
                          </th>
                        )}
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('tp_situacao')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Status {getSortIcon('tp_situacao')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('tp_situacao');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['tp_situacao']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Status"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'tp_situacao' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="tp_situacao"
                                  columnTitle="Status"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['tp_situacao']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('dt_vencimento')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Vencimento {getSortIcon('dt_vencimento')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('dt_vencimento');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['dt_vencimento']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Vencimento"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'dt_vencimento' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="dt_vencimento"
                                  columnTitle="Vencimento"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['dt_vencimento']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('vl_duplicata')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Valor {getSortIcon('vl_duplicata')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('vl_duplicata');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['vl_duplicata']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Valor"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'vl_duplicata' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="vl_duplicata"
                                  columnTitle="Valor"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['vl_duplicata']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('cd_fornecedor')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Fornecedor {getSortIcon('cd_fornecedor')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('cd_fornecedor');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['cd_fornecedor']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Fornecedor"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'cd_fornecedor' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="cd_fornecedor"
                                  columnTitle="Fornecedor"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['cd_fornecedor']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('nm_fornecedor')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            NM Fornecedor {getSortIcon('nm_fornecedor')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('nm_fornecedor');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['nm_fornecedor']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Nome Fornecedor"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'nm_fornecedor' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="nm_fornecedor"
                                  columnTitle="Nome Fornecedor"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['nm_fornecedor']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('ds_despesaitem')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Despesa {getSortIcon('ds_despesaitem')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('ds_despesaitem');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['ds_despesaitem']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Despesa"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'ds_despesaitem' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="ds_despesaitem"
                                  columnTitle="Despesa"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={
                                    columnFilters['ds_despesaitem']
                                  }
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('ds_ccusto')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            NM CUSTO {getSortIcon('ds_ccusto')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('ds_ccusto');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['ds_ccusto']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Centro de Custo"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'ds_ccusto' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="ds_ccusto"
                                  columnTitle="Centro de Custo"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['ds_ccusto']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('cd_empresa')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Empresa {getSortIcon('cd_empresa')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('cd_empresa');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['cd_empresa']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Empresa"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'cd_empresa' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="cd_empresa"
                                  columnTitle="Empresa"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['cd_empresa']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('nr_duplicata')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Duplicata {getSortIcon('nr_duplicata')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('nr_duplicata');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['nr_duplicata']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Duplicata"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'nr_duplicata' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="nr_duplicata"
                                  columnTitle="Duplicata"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['nr_duplicata']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('nr_parcela')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Parcela {getSortIcon('nr_parcela')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('nr_parcela');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['nr_parcela']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Parcela"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'nr_parcela' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="nr_parcela"
                                  columnTitle="Parcela"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['nr_parcela']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('nr_portador')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Portador {getSortIcon('nr_portador')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('nr_portador');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['nr_portador']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Portador"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'nr_portador' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="nr_portador"
                                  columnTitle="Portador"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['nr_portador']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('dt_emissao')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Emissão {getSortIcon('dt_emissao')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('dt_emissao');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['dt_emissao']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Emissão"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'dt_emissao' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="dt_emissao"
                                  columnTitle="Emissão"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['dt_emissao']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('dt_entrada')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Entrada {getSortIcon('dt_entrada')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('dt_entrada');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['dt_entrada']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Entrada"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'dt_entrada' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="dt_entrada"
                                  columnTitle="Entrada"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['dt_entrada']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('dt_liq')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Liquidação {getSortIcon('dt_liq')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('dt_liq');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['dt_liq']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Liquidação"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'dt_liq' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="dt_liq"
                                  columnTitle="Liquidação"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['dt_liq']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('tp_situacao')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Situação {getSortIcon('tp_situacao')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('tp_situacao_col');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['tp_situacao_col']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Situação"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'tp_situacao_col' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="tp_situacao_col"
                                  columnTitle="Situação"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={
                                    columnFilters['tp_situacao_col']
                                  }
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('tp_estagio')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Estágio {getSortIcon('tp_estagio')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('tp_estagio');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['tp_estagio']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Estágio"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'tp_estagio' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="tp_estagio"
                                  columnTitle="Estágio"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['tp_estagio']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('vl_juros')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Juros {getSortIcon('vl_juros')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('vl_juros');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['vl_juros']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Juros"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'vl_juros' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="vl_juros"
                                  columnTitle="Juros"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['vl_juros']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('vl_acrescimo')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Acréscimo {getSortIcon('vl_acrescimo')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('vl_acrescimo');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['vl_acrescimo']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Acréscimo"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'vl_acrescimo' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="vl_acrescimo"
                                  columnTitle="Acréscimo"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['vl_acrescimo']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('vl_desconto')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Desconto {getSortIcon('vl_desconto')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('vl_desconto');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['vl_desconto']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Desconto"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'vl_desconto' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="vl_desconto"
                                  columnTitle="Desconto"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['vl_desconto']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('vl_pago')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Pago {getSortIcon('vl_pago')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('vl_pago');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['vl_pago']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Valor Pago"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'vl_pago' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="vl_pago"
                                  columnTitle="Valor Pago"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['vl_pago']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('in_aceite')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Aceite {getSortIcon('in_aceite')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('in_aceite');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['in_aceite']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Aceite"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'in_aceite' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="in_aceite"
                                  columnTitle="Aceite"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={columnFilters['in_aceite']}
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                        <th className="px-0.5 py-0.5 text-center text-[8px]">
                          Rateio(s)
                        </th>
                        <th className="px-0.5 py-0.5 text-center text-[8px]">
                          Observação
                        </th>
                        <th
                          className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                          onClick={() => handleSort('tp_previsaoreal')}
                        >
                          <div className="flex items-center justify-center gap-1 relative">
                            Previsão {getSortIcon('tp_previsaoreal')}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown('tp_previsaoreal');
                              }}
                              className={`hover:text-gray-300 focus:outline-none focus:text-gray-300 ${
                                columnFilters['tp_previsaoreal']
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label="Filtrar por Previsão"
                            >
                              <FunnelSimple size={10} />
                            </button>
                            {openFilterDropdown === 'tp_previsaoreal' && (
                              <div className="absolute top-full left-0 z-50 mt-1">
                                <FilterDropdown
                                  columnKey="tp_previsaoreal"
                                  columnTitle="Previsão"
                                  data={dadosOrdenadosParaCards.map(
                                    (grupo) => grupo.item,
                                  )}
                                  currentFilter={
                                    columnFilters['tp_previsaoreal']
                                  }
                                  onApplyFilter={handleApplyFilter}
                                  onClose={() => toggleFilterDropdown(null)}
                                />
                              </div>
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {calcularDadosPaginados.dados.map((grupo, index) => {
                        const indiceGlobal =
                          (calcularDadosPaginados.paginaAtual - 1) *
                            calcularDadosPaginados.registrosPorPagina +
                          index;
                        const isSelected =
                          linhasSelecionadasAgrupadas.has(indiceGlobal);
                        const chaveUnica = `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`;
                        const autorizacao = autorizacoes[chaveUnica];
                        const autorizadoPor = autorizacao?.autorizadoPor;
                        const podeAutorizar = hasRole([
                          'owner',
                          'admin',
                          'manager',
                        ]);
                        const contaPaga =
                          grupo.item.dt_liq && grupo.item.dt_liq.trim() !== '';

                        // Debug para o botão ENVIAR PARA PAGAMENTO
                        if (index === 0) {
                          // Apenas para o primeiro item para não poluir o console
                          console.log(
                            '🔍 Debug condições botão ENVIAR PARA PAGAMENTO:',
                          );
                          console.log(
                            '👤 hasRole FINANCEIRO:',
                            hasRole(['user']),
                          );
                          console.log('✅ autorizadoPor:', autorizadoPor);
                          console.log(
                            '📊 autorizacao?.status:',
                            autorizacao?.status,
                          );
                          console.log(
                            '🎯 STATUS_AUTORIZACAO.AUTORIZADO:',
                            STATUS_AUTORIZACAO.AUTORIZADO,
                          );
                          console.log(
                            '🔗 Condição completa:',
                            hasRole(['user']) &&
                              autorizadoPor &&
                              autorizacao?.status ===
                                STATUS_AUTORIZACAO.AUTORIZADO,
                          );
                          console.log('💰 contaPaga:', contaPaga);
                        }

                        return (
                          <tr
                            key={`grp-${index}`}
                            className={`text-[8px] border-b transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-blue-100 hover:bg-blue-200'
                                : index % 2 === 0
                                  ? 'bg-white hover:bg-gray-100'
                                  : 'bg-gray-50 hover:bg-gray-100'
                            }`}
                            onClick={() => abrirModalDetalhes(grupo.item)}
                            title="Clique para ver detalhes da conta"
                          >
                            <td
                              className="px-0.5 py-0.5 text-center"
                              style={{
                                width: '30px',
                                minWidth: '30px',
                                position: 'sticky',
                                left: 0,
                                zIndex: 10,
                                background: isSelected ? '#dbeafe' : 'inherit',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleLinhaSelecionadaAgrupada(indiceGlobal);
                                }}
                                className="rounded w-3 h-3"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {contaPaga ? (
                                <span className="text-[8px] text-red-700 font-semibold">
                                  PAGO
                                </span>
                              ) : (
                                <span className="text-[8px] text-blue-700 font-semibold">
                                  ABERTO
                                </span>
                              )}
                            </td>
                            <td className="px-0.5 py-0.5 text-center text-[8px]">
                              {contaPaga ? (
                                <div className="flex items-center justify-center gap-1">
                                  <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                                  <span className="text-red-700 font-semibold">
                                    PAGO
                                  </span>
                                  <span className="text-gray-600">em</span>
                                  <span className="text-red-600 font-medium">
                                    {formatarData(grupo.item.dt_liq)}
                                  </span>
                                </div>
                              ) : autorizacao?.status ===
                                STATUS_AUTORIZACAO.ENVIADO_PAGAMENTO ? (
                                <div className="flex items-center justify-center gap-1">
                                  <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                                  <span className="text-yellow-700 font-semibold">
                                    ENVIADO PARA PAGAMENTO
                                  </span>
                                  <span className="text-gray-600">por</span>
                                  <span className="text-blue-600 font-medium">
                                    {autorizacao.enviadoPor}
                                  </span>
                                </div>
                              ) : autorizadoPor ? (
                                <div className="flex items-center justify-center gap-1">
                                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                                  <span className="text-green-700 font-semibold">
                                    AUTORIZADO
                                  </span>
                                  <span className="text-gray-600">por</span>
                                  <span className="text-blue-600 font-medium">
                                    {autorizadoPor}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-1">
                                  <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                                  <span className="text-gray-500 font-medium">
                                    NÃO AUTORIZADO
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {formatarData(grupo.item.dt_vencimento)}
                            </td>
                            <td className="px-0.5 py-0.5 text-right font-medium text-green-600">
                              {parseFloat(
                                grupo.item.vl_duplicata || 0,
                              ).toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {grupo.item.cd_fornecedor || ''}
                            </td>
                            <td
                              className="px-0.5 py-0.5 text-left max-w-32 truncate"
                              title={grupo.item.nm_fornecedor}
                            >
                              {grupo.item.nm_fornecedor || ''}
                            </td>
                            <td
                              className="px-0.5 py-0.5 text-left max-w-48 truncate min-w-32"
                              title={grupo.item.ds_despesaitem}
                            >
                              {grupo.item.ds_despesaitem || ''}
                            </td>
                            <td
                              className="px-0.5 py-0.5 text-left max-w-48 truncate min-w-32"
                              title={grupo.item.ds_ccusto}
                            >
                              {grupo.item.ds_ccusto || ''}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {grupo.item.cd_empresa || ''}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {grupo.item.nr_duplicata || ''}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {grupo.item.nr_parcela || ''}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {grupo.item.nr_portador || ''}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {formatarData(grupo.item.dt_emissao)}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {formatarData(grupo.item.dt_entrada)}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {formatarData(grupo.item.dt_liq)}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {grupo.item.tp_situacao || ''}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {grupo.item.tp_estagio || ''}
                            </td>
                            <td className="px-0.5 py-0.5 text-right">
                              {parseFloat(
                                grupo.item.vl_juros || 0,
                              ).toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </td>
                            <td className="px-0.5 py-0.5 text-right">
                              {parseFloat(
                                grupo.item.vl_acrescimo || 0,
                              ).toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </td>
                            <td className="px-0.5 py-0.5 text-right">
                              {parseFloat(
                                grupo.item.vl_desconto || 0,
                              ).toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </td>
                            <td className="px-0.5 py-0.5 text-right">
                              {parseFloat(
                                grupo.item.vl_pago || 0,
                              ).toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {grupo.item.in_aceite || ''}
                            </td>
                            <td
                              className="px-0.5 py-0.5 text-right"
                              title={
                                grupo.rateios && grupo.rateios.length > 0
                                  ? grupo.rateios.join(' | ')
                                  : ''
                              }
                            >
                              {grupo.rateios && grupo.rateios.length > 0
                                ? grupo.rateios
                                    .map((r) => parseFloat(r || 0))
                                    .reduce((a, b) => a + b, 0)
                                    .toLocaleString('pt-BR', {
                                      style: 'currency',
                                      currency: 'BRL',
                                    })
                                : ''}
                            </td>
                            <td
                              className="px-0.5 py-0.5 text-left max-w-32 truncate"
                              title={(grupo.observacoes || []).join(' | ')}
                            >
                              {grupo.item.ds_observacao || ''}
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              {grupo.item.tp_previsaoreal || ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {/* Controles de Paginação */}
                  {calcularDadosPaginados.totalPaginas > 1 && (
                    <div className="mt-4 flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">
                          Mostrando{' '}
                          {(calcularDadosPaginados.paginaAtual - 1) *
                            calcularDadosPaginados.registrosPorPagina +
                            1}{' '}
                          a{' '}
                          {Math.min(
                            calcularDadosPaginados.paginaAtual *
                              calcularDadosPaginados.registrosPorPagina,
                            calcularDadosPaginados.totalRegistros,
                          )}{' '}
                          de {calcularDadosPaginados.totalRegistros} registros
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        {/* Botão Primeira Página */}
                        <button
                          onClick={irParaPrimeiraPagina}
                          disabled={calcularDadosPaginados.paginaAtual === 1}
                          className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Primeira página"
                        >
                          ««
                        </button>

                        {/* Botão Página Anterior */}
                        <button
                          onClick={irParaPaginaAnterior}
                          disabled={calcularDadosPaginados.paginaAtual === 1}
                          className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Página anterior"
                        >
                          «
                        </button>

                        {/* Números das páginas */}
                        <div className="flex items-center gap-1">
                          {Array.from(
                            {
                              length: Math.min(
                                5,
                                calcularDadosPaginados.totalPaginas,
                              ),
                            },
                            (_, i) => {
                              const paginaInicial = Math.max(
                                1,
                                calcularDadosPaginados.paginaAtual - 2,
                              );
                              const numeroPagina = paginaInicial + i;

                              if (
                                numeroPagina >
                                calcularDadosPaginados.totalPaginas
                              )
                                return null;

                              return (
                                <button
                                  key={numeroPagina}
                                  onClick={() => mudarPagina(numeroPagina)}
                                  className={`px-2 py-1 text-xs rounded ${
                                    calcularDadosPaginados.paginaAtual ===
                                    numeroPagina
                                      ? 'bg-[#000638] text-white'
                                      : 'bg-white border border-gray-300 hover:bg-gray-50'
                                  }`}
                                >
                                  {numeroPagina}
                                </button>
                              );
                            },
                          )}
                        </div>

                        {/* Botão Próxima Página */}
                        <button
                          onClick={irParaProximaPagina}
                          disabled={
                            calcularDadosPaginados.paginaAtual ===
                            calcularDadosPaginados.totalPaginas
                          }
                          className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Próxima página"
                        >
                          »
                        </button>

                        {/* Botão Última Página */}
                        <button
                          onClick={irParaUltimaPagina}
                          disabled={
                            calcularDadosPaginados.paginaAtual ===
                            calcularDadosPaginados.totalPaginas
                          }
                          className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Última página"
                        >
                          »»
                        </button>
                      </div>

                      <div className="text-sm text-gray-600">
                        Página {calcularDadosPaginados.paginaAtual} de{' '}
                        {calcularDadosPaginados.totalPaginas}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 text-xs text-gray-600 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div>
                        Selecionadas:{' '}
                        <span className="font-semibold">
                          {linhasSelecionadasAgrupadas.size}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-green-600">✓</span>
                        <span>
                          Dados de fornecedor, centro de custo e despesa das
                          rotas refeitas (/fornecedor, /centrocusto e /despesa)
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div>
                        Valor total:{' '}
                        <span className="font-semibold text-green-700">
                          {Array.from(linhasSelecionadasAgrupadas)
                            .reduce(
                              (acc, idx) =>
                                acc +
                                parseFloat(
                                  calcularDadosPaginados.dados[idx]?.item
                                    ?.vl_duplicata || 0,
                                ),
                              0,
                            )
                            .toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                        </span>
                      </div>
                      <div>
                        Valor autorizado:{' '}
                        <span className="font-semibold text-emerald-700">
                          {valorTotalAutorizado.toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })}
                        </span>
                      </div>
                      <div>
                        Contas autorizadas:{' '}
                        <span className="font-semibold text-emerald-700">
                          {totalContasAutorizadas}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal para exibir observações */}
      {modalAberto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
            {/* Header do Modal */}
            <div className="bg-[#000638] text-white p-3 rounded-t-lg">
              <h2 className="text-sm font-bold">Observações</h2>
              <p className="text-xs opacity-90 mt-1">
                Detalhes das observações para a conta selecionada
              </p>
            </div>

            {/* Conteúdo do Modal */}
            <div className="flex-1 overflow-y-auto p-3">
              {dadosModal &&
              dadosModal.observacoes &&
              dadosModal.observacoes.length > 0 ? (
                <div className="space-y-3">
                  {dadosModal.observacoes.map((obs, index) => (
                    <div
                      key={index}
                      className="bg-gray-50 p-4 rounded-lg border border-gray-200"
                    >
                      <p className="text-gray-800 text-sm leading-relaxed">
                        {obs}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400 mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p className="text-lg font-medium">
                    Nenhuma observação encontrada
                  </p>
                  <p className="text-sm">
                    Este registro não possui observações cadastradas.
                  </p>
                </div>
              )}
            </div>
          </div>
          {/* Footer do Modal */}
          <div className="bg-gray-50 px-6 py-4 flex justify-end">
            <button
              onClick={fecharModal}
              className="bg-[#000638] text-white px-6 py-2 rounded-lg hover:bg-[#fe0000] transition-colors font-medium"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Modal para exibir dados dos cards */}
      {modalCardAberto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] flex flex-col">
            {/* Header do Modal */}
            <div className="bg-[#000638] text-white p-3 rounded-t-lg">
              <h2 className="text-sm font-bold">
                {getTituloModal(tipoCardSelecionado)}
              </h2>
              <p className="text-xs opacity-90 mt-1">
                {dadosCardModal.length} registro
                {dadosCardModal.length !== 1 ? 's' : ''} encontrado
                {dadosCardModal.length !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Conteúdo do Modal */}
            <div className="flex-1 overflow-y-auto p-3">
              {dadosCardModal.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium text-gray-700">
                          Vencimento
                        </th>
                        <th className="px-2 py-2 text-right font-medium text-gray-700">
                          Valor
                        </th>
                        <th className="px-2 py-2 text-center font-medium text-gray-700">
                          Fornecedor
                        </th>
                        <th className="px-2 py-2 text-left font-medium text-gray-700">
                          Despesa
                        </th>
                        <th className="px-2 py-2 text-center font-medium text-gray-700">
                          Duplicata
                        </th>
                        <th className="px-2 py-2 text-center font-medium text-gray-700">
                          Status
                        </th>
                        <th className="px-2 py-2 text-center font-medium text-gray-700">
                          Previsão
                        </th>
                        {tipoCardSelecionado === 'descontos' && (
                          <th className="px-2 py-2 text-right font-medium text-gray-700">
                            Desconto
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {dadosCardModal.map((item, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-2 py-2 text-sm text-gray-900">
                            {formatarData(item.dt_vencimento)}
                          </td>
                          <td className="px-2 py-2 text-sm text-right font-medium text-green-600">
                            {parseFloat(item.vl_duplicata || 0).toLocaleString(
                              'pt-BR',
                              {
                                style: 'currency',
                                currency: 'BRL',
                              },
                            )}
                          </td>
                          <td className="px-2 py-2 text-sm text-center text-gray-900">
                            {item.nm_fornecedor || ''}
                          </td>
                          <td className="px-2 py-2 text-sm text-gray-900">
                            {item.ds_despesaitem || ''}
                          </td>
                          <td className="px-2 py-2 text-sm text-center text-gray-900">
                            {item.nr_duplicata || ''}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span
                              className={`inline-flex items-center px-0.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                                getStatusFromData(item),
                              )}`}
                            >
                              {getStatusIcon(getStatusFromData(item))}
                              <span className="ml-1">
                                {getStatusFromData(item)}
                              </span>
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center text-gray-900">
                            {item.tp_previsaoreal || ''}
                          </td>
                          {tipoCardSelecionado === 'descontos' && (
                            <td className="px-2 py-2 text-sm text-right font-medium text-emerald-600">
                              {parseFloat(item.vl_desconto || 0).toLocaleString(
                                'pt-BR',
                                {
                                  style: 'currency',
                                  currency: 'BRL',
                                },
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400 mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p className="text-lg font-medium">
                    Nenhum registro encontrado
                  </p>
                  <p className="text-sm">
                    Não há registros para o filtro selecionado.
                  </p>
                </div>
              )}
            </div>

            {/* Footer do Modal */}
            <div className="bg-gray-50 px-6 py-4 flex justify-end">
              <button
                onClick={fecharModalCard}
                className="bg-[#000638] text-white px-6 py-2 rounded-lg hover:bg-[#fe0000] transition-colors font-medium"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Busca de Fornecedores */}
      {modalBuscaFornecedorAberto && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4"
          style={{ zIndex: 99998 }}
          onClick={() => setModalBuscaFornecedorAberto(false)}
        >
          <div
            className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#000638] flex items-center gap-2">
                <MagnifyingGlass size={20} weight="bold" />
                Fornecedores Encontrados
              </h2>
              <button
                onClick={() => setModalBuscaFornecedorAberto(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={20} weight="bold" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-3">
              {fornecedoresEncontrados.length} fornecedor(es) encontrado(s)
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#000638] text-white">
                    <th className="px-3 py-2 text-left rounded-tl-lg">
                      Código
                    </th>
                    <th className="px-3 py-2 text-left">Nome</th>
                    <th className="px-3 py-2 text-left">Nome Fantasia</th>
                    <th className="px-3 py-2 text-center rounded-tr-lg">
                      Ação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fornecedoresEncontrados.map((fornecedor, index) => (
                    <tr
                      key={fornecedor.cd_pessoa || index}
                      className={`border-b hover:bg-blue-50 cursor-pointer ${
                        index % 2 === 0 ? 'bg-gray-50' : 'bg-white'
                      }`}
                      onClick={() => selecionarFornecedorBusca(fornecedor)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        {fornecedor.cd_pessoa}
                      </td>
                      <td className="px-3 py-2">{fornecedor.nm_pessoa}</td>
                      <td className="px-3 py-2 text-gray-600">
                        {fornecedor.nm_fantasia || '--'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            selecionarFornecedorBusca(fornecedor);
                          }}
                          className="bg-[#000638] text-white px-3 py-1 rounded text-xs hover:bg-[#000638]/80 transition-colors"
                        >
                          Selecionar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setModalBuscaFornecedorAberto(false)}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors text-sm"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes da Conta */}
      <ModalDetalhesConta
        conta={modalDetalhes.conta}
        isOpen={modalDetalhes.isOpen}
        onClose={fecharModalDetalhes}
      />

      {/* Modal de Confirmação de Remoção de Autorização */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
          onClick={handleModalClose}
        >
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-3 relative animate-in zoom-in-95 duration-200">
            {/* Botão de fechar */}
            <button
              onClick={handleCancelRemoveAuthorization}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XCircle size={24} />
            </button>

            <div className="text-center mb-6">
              <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <Trash size={32} className="text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                Remover Autorização
              </h3>
              <p className="text-gray-600">
                Tem certeza que deseja remover a autorização de{' '}
                <strong>{autorizacaoToRemove?.autorizadoPor}</strong>?
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h4 className="font-semibold text-gray-900 mb-2 text-sm">
                Detalhes da autorização:
              </h4>
              <div className="space-y-1">
                <div className="text-sm text-gray-600 flex items-center gap-1">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  Autorizado por:{' '}
                  <strong>{autorizacaoToRemove?.autorizadoPor}</strong>
                </div>
                <div className="text-sm text-gray-600 flex items-center gap-1">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  Esta ação não pode ser desfeita
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCancelRemoveAuthorization}
                className="flex-1 px-4 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmRemoveAuthorization}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Autorização em Massa */}
      {showAutorizarTodosModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
          onClick={handleAutorizarTodosModalClose}
        >
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-3 relative animate-in zoom-in-95 duration-200">
            {/* Botão de fechar */}
            <button
              onClick={handleCancelAutorizarTodos}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XCircle size={24} />
            </button>

            <div className="text-center mb-6">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle size={32} className="text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-green-600 mb-2">
                Autorizar Todos
              </h3>
              <p className="text-gray-600">
                Tem certeza que deseja autorizar TODAS as{' '}
                {contasParaAutorizar.length} contas não autorizadas?
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCancelAutorizarTodos}
                className="flex-1 px-4 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmAutorizarTodos}
                className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
              >
                Autorizar Todos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Remoção em Massa */}
      {showRemoverTodosModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
          onClick={handleRemoverTodosModalClose}
        >
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-3 relative animate-in zoom-in-95 duration-200">
            {/* Botão de fechar */}
            <button
              onClick={handleCancelRemoverTodos}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XCircle size={24} />
            </button>

            <div className="text-center mb-6">
              <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <Trash size={32} className="text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-red-600 mb-2">
                Remover Todos
              </h3>
              <p className="text-gray-600">
                Tem certeza que deseja remover TODAS as{' '}
                {contasParaRemover.length} autorizações?
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCancelRemoverTodos}
                className="flex-1 px-4 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmRemoverTodos}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Remover Todos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug: Mostrar estado do modal */}
      {console.log(
        '🔍 Renderizando componente - showEnviarPagamentoModal:',
        showEnviarPagamentoModal,
      )}

      {/* Modal de Teste Simples */}
      {showEnviarPagamentoModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={handleCancelEnviarParaPagamento}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '8px',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                color: '#000638',
                fontSize: '20px',
                fontWeight: 'bold',
                marginBottom: '10px',
              }}
            >
              Confirmar Pagamento
            </h2>
            <p style={{ marginBottom: '20px', color: '#666' }}>
              Tem certeza que deseja pagar esta conta?
            </p>
            <p
              style={{ marginBottom: '20px', color: '#666', fontSize: '12px' }}
            >
              Fornecedor: {contaParaEnviar?.dadosConta?.nm_fornecedor || 'N/A'}
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleCancelEnviarParaPagamento}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#666',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Fechar
              </button>
              <button
                onClick={handleConfirmEnviarParaPagamento}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#eab308',
                  color: 'black',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                PAGAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação para Remover Pagamento */}
      {showRemoverPagamentoModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={handleCancelRemoverEnviadoParaPagamento}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '8px',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                color: '#dc2626',
                fontSize: '20px',
                fontWeight: 'bold',
                marginBottom: '10px',
              }}
            >
              Remover Pagamento
            </h2>
            <p style={{ marginBottom: '20px', color: '#666' }}>
              Tem certeza que deseja remover o status de pagamento desta conta?
            </p>
            <p
              style={{ marginBottom: '20px', color: '#666', fontSize: '12px' }}
            >
              Fornecedor: {contaParaEnviar?.dadosConta?.nm_fornecedor || 'N/A'}
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleCancelRemoverEnviadoParaPagamento}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#666',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmRemoverEnviadoParaPagamento}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                REMOVER
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Acesso Restrito */}
      {showAcessoRestritoModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={handleCloseAcessoRestrito}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '8px',
              maxWidth: '450px',
              width: '90%',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                color: '#dc2626',
                fontSize: '20px',
                fontWeight: 'bold',
                marginBottom: '15px',
                textAlign: 'center',
              }}
            >
              ⚠️ ACESSO RESTRITO
            </h2>
            <div
              style={{
                marginBottom: '20px',
                padding: '15px',
                backgroundColor: '#fef3c7',
                borderRadius: '6px',
                border: '1px solid #f59e0b',
              }}
            >
              <p
                style={{
                  marginBottom: '10px',
                  color: '#92400e',
                  fontSize: '14px',
                  fontWeight: 'bold',
                }}
              >
                Esta conta foi enviada para pagamento por{' '}
                <strong>{dadosAcessoRestrito?.enviadoPor}</strong>.
              </p>
              <p
                style={{
                  marginBottom: '10px',
                  color: '#92400e',
                  fontSize: '13px',
                }}
              >
                Apenas administradores podem remover autorizações de contas que
                já foram enviadas para pagamento.
              </p>
              <p style={{ color: '#92400e', fontSize: '13px' }}>
                Para solicitar a remoção, entre em contato com um administrador
                do sistema.
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={handleCloseAcessoRestrito}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#6b7280',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px',
                }}
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug: Mostrar estado do modal */}
      {console.log(
        '🔍 Renderizando componente - showEnviarPagamentoModal:',
        showEnviarPagamentoModal,
      )}
      {console.log(
        '🔍 Renderizando componente - showRemoverPagamentoModal:',
        showRemoverPagamentoModal,
      )}
      {console.log(
        '🔍 Renderizando componente - showAcessoRestritoModal:',
        showAcessoRestritoModal,
      )}

      {/* Botão flutuante para abrir o Chat IA */}
      {!chatIAAberto && dadosCarregados && dados.length > 0 && (
        <button
          onClick={() => setChatIAAberto(true)}
          className="fixed bottom-6 right-6 bg-[#000638] text-white p-4 rounded-full shadow-2xl hover:bg-[#fe0000] transition-all duration-300 z-50 group"
          title="Abrir Assistente IA"
        >
          <ChatCircleDots size={28} weight="fill" />
          <span className="absolute -top-10 right-0 bg-gray-900 text-white text-xs px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
            Assistente IA
          </span>
        </button>
      )}

      {/* Chat IA */}
      {chatIAAberto && (
        <ChatContasPagar
          dadosContas={dados}
          resumo={{
            totalContas: totalContasCards,
            valorTotal: totalValorCards,
            contasVencidas: totalContasVencidasCards,
            contasPagas: totalContasPagasCards,
            valorPago: valorContasPagasCards,
            faltaPagar: valorFaltaPagarCards,
          }}
          filtrosAtivos={`Período: ${dataInicio} a ${dataFim} | Situação: ${situacao}`}
          onClose={() => setChatIAAberto(false)}
        />
      )}
    </div>
  );
};

// Componente para agrupar despesas por categoria
const DespesasPorCategoria = ({
  dados,
  totalContas,
  linhasSelecionadas,
  toggleLinhaSelecionada,
  filtroMensal,
  setFiltroMensal,
  dadosOriginais,
  filtroDia,
  setFiltroDia,
  handleFiltroMensalChange,
  obterDiasDoMes,
  abrirModalDetalhes,
  getSortIcon,
  handleSort,
  agruparDadosIdenticos,
}) => {
  const [categoriasExpandidas, setCategoriasExpandidas] = useState(new Set());
  const [todosExpandidos, setTodosExpandidos] = useState(false);

  // Função para classificar despesa por código
  const classificarDespesa = (cdDespesa) => {
    const codigo = parseInt(cdDespesa) || 0;

    const categoriaExcecao = getCategoriaPorCodigo(codigo);
    if (categoriaExcecao) {
      return categoriaExcecao;
    }

    if (codigo >= 1000 && codigo <= 1999) {
      return 'CUSTO DAS MERCADORIAS VENDIDAS';
    } else if (codigo >= 2000 && codigo <= 2999) {
      return 'DESPESAS OPERACIONAIS';
    } else if (codigo >= 3000 && codigo <= 3999) {
      return 'DESPESAS COM PESSOAL';
    } else if (codigo >= 4001 && codigo <= 4999) {
      return 'ALUGUÉIS E ARRENDAMENTOS';
    } else if (codigo >= 5000 && codigo <= 5999) {
      return 'IMPOSTOS, TAXAS E CONTRIBUIÇÕES';
    } else if (codigo >= 6000 && codigo <= 6999) {
      return 'DESPESAS GERAIS';
    } else if (codigo >= 7000 && codigo <= 7999) {
      return 'DESPESAS FINANCEIRAS';
    } else if (codigo >= 8000 && codigo <= 8999 && codigo === 12001) {
      return 'OUTRAS DESPESAS OPERACIONAIS';
    } else if (codigo >= 9000 && codigo <= 9999) {
      return 'DESPESAS C/ VENDAS';
    } else {
      return 'SEM CLASSIFICAÇÃO';
    }
  };

  // Agrupar dados por classificação de despesa, nome da despesa e fornecedor
  const dadosAgrupados = useMemo(() => {
    const categorias = {};

    // Primeiro passo: agrupar os dados para evitar duplicações
    const dadosAgrupados = agruparDadosIdenticos(dados);

    dadosAgrupados.forEach((grupo, index) => {
      const item = grupo.item;
      const cdDespesa = item.cd_despesaitem;
      const nomeDespesa = item.ds_despesaitem || 'SEM DESCRIÇÃO';
      const nomeFornecedor = item.nm_fornecedor || 'SEM FORNECEDOR';
      // Usar o valor da duplicata em vez do rateio para manter consistência com os cards
      const vlDuplicata = parseFloat(item.vl_duplicata || 0);
      const categoria = classificarDespesa(cdDespesa);

      // Criar categoria principal se não existir
      if (!categorias[categoria]) {
        categorias[categoria] = {
          nome: categoria,
          despesas: {},
          total: 0,
          quantidade: 0,
          expandida: false,
        };
      }

      // Criar sub-tópico da despesa se não existir
      if (!categorias[categoria].despesas[nomeDespesa]) {
        categorias[categoria].despesas[nomeDespesa] = {
          nome: nomeDespesa,
          fornecedores: {},
          total: 0,
          quantidade: 0,
          expandida: false,
        };
      }

      // Criar chave única para o fornecedor incluindo duplicata e parcela
      const chaveFornecedor = `${nomeFornecedor}|${item.nr_duplicata}|${item.nr_parcela}`;

      // Criar sub-tópico do fornecedor se não existir
      if (
        !categorias[categoria].despesas[nomeDespesa].fornecedores[
          chaveFornecedor
        ]
      ) {
        categorias[categoria].despesas[nomeDespesa].fornecedores[
          chaveFornecedor
        ] = {
          nome: nomeFornecedor,
          nrDuplicata: item.nr_duplicata,
          nrParcela: item.nr_parcela,
          vlDuplicata: vlDuplicata,
          itens: [],
          total: 0,
          quantidade: 0,
          expandida: false,
        };
      }

      // Adicionar item ao fornecedor específico
      categorias[categoria].despesas[nomeDespesa].fornecedores[
        chaveFornecedor
      ].itens.push({ grupo, indiceOriginal: index });

      // Usar o valor da duplicata como total para este item específico
      categorias[categoria].despesas[nomeDespesa].fornecedores[
        chaveFornecedor
      ].total = vlDuplicata;
      categorias[categoria].despesas[nomeDespesa].fornecedores[
        chaveFornecedor
      ].quantidade = 1;

      // Adicionar totais da despesa e categoria usando o valor da duplicata
      categorias[categoria].despesas[nomeDespesa].total += vlDuplicata;
      categorias[categoria].despesas[nomeDespesa].quantidade += 1;
      categorias[categoria].total += vlDuplicata;
      categorias[categoria].quantidade += 1;
    });

    // Definir ordem específica das categorias
    const ordemCategorias = [
      'CUSTO DAS MERCADORIAS VENDIDAS',
      'DESPESAS OPERACIONAIS',
      'DESPESAS COM PESSOAL',
      'ALUGUÉIS E ARRENDAMENTOS',
      'IMPOSTOS, TAXAS E CONTRIBUIÇÕES',
      'DESPESAS GERAIS',
      'DESPESAS FINANCEIRAS',
      'OUTRAS DESPESAS OPERACIONAIS',
      'DESPESAS C/ VENDAS',
      'ATIVOS',
      'SEM CLASSIFICAÇÃO',
    ];

    // Converter para array e ordenar pela ordem definida
    return ordemCategorias
      .filter((categoria) => categorias[categoria]) // Só incluir categorias que têm dados
      .map((categoria) => {
        const cat = categorias[categoria];
        // Converter despesas em array e ordenar por valor (maior primeiro)
        cat.despesasArray = Object.values(cat.despesas)
          .map((despesa) => {
            // Converter fornecedores em array e ordenar por valor (maior primeiro)
            despesa.fornecedoresArray = Object.values(
              despesa.fornecedores,
            ).sort((a, b) => b.total - a.total);
            return despesa;
          })
          .sort((a, b) => b.total - a.total);
        return cat;
      });
  }, [dados]);

  const toggleCategoria = (nomeCategoria) => {
    setCategoriasExpandidas((prev) => {
      const novoSet = new Set(prev);
      if (novoSet.has(nomeCategoria)) {
        novoSet.delete(nomeCategoria);
      } else {
        novoSet.add(nomeCategoria);
      }
      return novoSet;
    });
  };

  const toggleDespesa = (nomeCategoria, nomeDespesa) => {
    const chave = `${nomeCategoria}|${nomeDespesa}`;
    setCategoriasExpandidas((prev) => {
      const novoSet = new Set(prev);
      if (novoSet.has(chave)) {
        novoSet.delete(chave);
      } else {
        novoSet.add(chave);
      }
      return novoSet;
    });
  };

  const toggleFornecedor = (
    nomeCategoria,
    nomeDespesa,
    nomeFornecedor,
    nrDuplicata,
    nrParcela,
    vlRateio,
  ) => {
    const chave = `${nomeCategoria}|${nomeDespesa}|${nomeFornecedor}|${nrDuplicata}|${nrParcela}|${vlRateio}`;
    setCategoriasExpandidas((prev) => {
      const novoSet = new Set(prev);
      if (novoSet.has(chave)) {
        novoSet.delete(chave);
      } else {
        novoSet.add(chave);
      }
      return novoSet;
    });
  };

  const toggleTodosTopicos = () => {
    if (todosExpandidos) {
      // Colapsar todos
      setCategoriasExpandidas(new Set());
      setTodosExpandidos(false);
    } else {
      // Expandir todos
      const todasCategorias = new Set(
        dadosAgrupados.map((categoria) => categoria.nome),
      );
      setCategoriasExpandidas(todasCategorias);
      setTodosExpandidos(true);
    }
  };

  // Função para exportar dados da última linha de hierarquia para Excel
  const exportarDadosUltimaLinha = () => {
    if (!dadosAgrupados || dadosAgrupados.length === 0) {
      alert('Nenhum dado disponível para exportar');
      return;
    }

    // Coletar todos os dados da última linha de hierarquia (itens individuais)
    const dadosParaExportar = [];

    dadosAgrupados.forEach((categoria) => {
      categoria.despesasArray.forEach((despesa) => {
        despesa.fornecedoresArray.forEach((fornecedor) => {
          fornecedor.itens.forEach((item) => {
            const dadoItem = item.grupo.item;
            dadosParaExportar.push({
              Categoria: categoria.nome,
              Despesa: despesa.nome,
              Fornecedor: fornecedor.nome,
              Duplicata: fornecedor.nrDuplicata,
              Valor: fornecedor.vlDuplicata,
              Vencimento: formatarData(dadoItem.dt_vencimento),
              'Valor Duplicata': parseFloat(dadoItem.vl_duplicata || 0),
              'Código Fornecedor': dadoItem.cd_fornecedor || '',
              'Nome Fornecedor': dadoItem.nm_fornecedor || '',
              'Despesa Item': dadoItem.ds_despesaitem || '',
              'Centro de Custo': dadoItem.ds_ccusto || '',
              Empresa: dadoItem.cd_empresa || '',
              Portador: dadoItem.nr_portador || '',
              Emissão: formatarData(dadoItem.dt_emissao),
              Entrada: formatarData(dadoItem.dt_entrada),
              Liquidação: formatarData(dadoItem.dt_liq),
              Situação: dadoItem.tp_situacao || '',
              Estágio: dadoItem.tp_estagio || '',
              Juros: parseFloat(dadoItem.vl_juros || 0),
              Acréscimo: parseFloat(dadoItem.vl_acrescimo || 0),
              Desconto: parseFloat(dadoItem.vl_desconto || 0),
              Pago: parseFloat(dadoItem.vl_pago || 0),
              Aceite: dadoItem.in_aceite || '',
              Parcela: dadoItem.nr_parcela || '',
              'Rateio Item': dadoItem.vl_rateio || '',
              Observação: dadoItem.ds_observacao || '',
              Previsão: dadoItem.tp_previsaoreal || '',
            });
          });
        });
      });
    });

    if (dadosParaExportar.length === 0) {
      alert('Nenhum dado encontrado para exportar');
      return;
    }

    // Criar workbook e worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dadosParaExportar);

    // Ajustar largura das colunas
    const colWidths = [
      { wch: 20 }, // Categoria
      { wch: 30 }, // Despesa
      { wch: 25 }, // Fornecedor
      { wch: 12 }, // Duplicata
      { wch: 12 }, // Rateio
      { wch: 12 }, // Vencimento
      { wch: 15 }, // Valor
      { wch: 15 }, // Código Fornecedor
      { wch: 30 }, // Nome Fornecedor
      { wch: 30 }, // Despesa Item
      { wch: 25 }, // Centro de Custo
      { wch: 10 }, // Empresa
      { wch: 10 }, // Portador
      { wch: 12 }, // Emissão
      { wch: 12 }, // Entrada
      { wch: 12 }, // Liquidação
      { wch: 10 }, // Situação
      { wch: 10 }, // Estágio
      { wch: 12 }, // Juros
      { wch: 12 }, // Acréscimo
      { wch: 12 }, // Desconto
      { wch: 12 }, // Pago
      { wch: 10 }, // Aceite
      { wch: 10 }, // Parcela
      { wch: 10 }, // Rateio
      { wch: 30 }, // Observação
      { wch: 12 }, // Previsão
    ];
    ws['!cols'] = colWidths;

    // Adicionar worksheet ao workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Contas a Pagar');

    // Gerar arquivo e fazer download
    const fileName = `contas_a_pagar_${
      new Date().toISOString().split('T')[0]
    }.xlsx`;
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const data = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(data, fileName);

    console.log(
      `✅ Exportados ${dadosParaExportar.length} registros para Excel`,
    );
  };

  // Calcular dados mensais para mostrar quantidades nos botões
  const calcularDadosMensais = () => {
    const meses = [
      'JAN',
      'FEV',
      'MAR',
      'ABR',
      'MAI',
      'JUN',
      'JUL',
      'AGO',
      'SET',
      'OUT',
      'NOV',
      'DEZ',
    ];
    const dadosMensais = {};

    // Calcular ANO - TODOS os dados do período consultado
    dadosMensais['ANO'] = dadosOriginais.filter((item) => {
      if (!item.dt_vencimento) return false;
      return true; // Retorna todos os dados, independente do ano
    }).length;

    // Calcular cada mês - considera todos os anos
    meses.forEach((mes, index) => {
      const numeroMes = index + 1;
      dadosMensais[mes] = dadosOriginais.filter((item) => {
        if (!item.dt_vencimento) return false;
        const data = criarDataSemFusoHorario(item.dt_vencimento);
        return data.getMonth() + 1 === numeroMes; // Mês específico de qualquer ano
      }).length;
    });

    return dadosMensais;
  };

  const dadosMensais = calcularDadosMensais();

  return (
    <div className="space-y-4">
      {/* Filtros Mensais */}
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
        <div className="flex items-center gap-1 mb-3">
          <Calendar size={10} className="text-[#000638]" />
          <h3 className="font-bold text-sm text-[#000638]">
            Filtro por Período (Data Vencimento)
          </h3>
        </div>

        <div className="flex flex-wrap gap-1">
          {/* Botão ANO */}
          <button
            onClick={() => handleFiltroMensalChange('ANO')}
            className={`px-4 py-2 text-[0.7rem] font-medium rounded-md transition-colors ${
              filtroMensal === 'ANO'
                ? 'bg-[#000638] text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
            }`}
          >
            ANO
          </button>

          {/* Botões dos Meses */}
          {[
            'JAN',
            'FEV',
            'MAR',
            'ABR',
            'MAI',
            'JUN',
            'JUL',
            'AGO',
            'SET',
            'OUT',
            'NOV',
            'DEZ',
          ].map((mes) => (
            <button
              key={mes}
              onClick={() => handleFiltroMensalChange(mes)}
              className={`px-2 py-2 text-[0.7rem] font-medium rounded-md transition-colors ${
                filtroMensal === mes
                  ? 'bg-[#000638] text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
              }`}
            >
              {mes}
            </button>
          ))}
        </div>

        {/* Informação do filtro ativo */}
        <div className="mt-3 text-xs text-gray-500">
          <span className="font-medium">Filtro ativo:</span> {filtroMensal}
          {filtroDia && <span className="ml-1">- Dia {filtroDia}</span>}
          <span className="ml-2">
            ({dados.length} registro{dados.length !== 1 ? 's' : ''})
          </span>
        </div>

        {/* Filtro por Dia - aparece apenas quando um mês está selecionado */}
        {filtroMensal !== 'ANO' && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-1 mb-3">
              <Calendar size={14} className="text-[#000638]" />
              <h4 className="font-bold text-sm text-[#000638]">
                Filtro por Dia - {filtroMensal}
              </h4>
            </div>

            <div className="flex flex-wrap gap-1">
              {/* Botão "Todos os Dias" */}
              <button
                onClick={() => setFiltroDia(null)}
                className={`px-0.5 py-0.5 text-xs font-medium rounded-md transition-colors ${
                  filtroDia === null
                    ? 'bg-[#000638] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
                }`}
              >
                TODOS
              </button>

              {/* Botões dos dias */}
              {Array.from(
                { length: obterDiasDoMes(filtroMensal) },
                (_, i) => i + 1,
              ).map((dia) => (
                <button
                  key={dia}
                  onClick={() => setFiltroDia(dia)}
                  className={`px-0.5 py-0.5 text-xs font-medium rounded-md transition-colors ${
                    filtroDia === dia
                      ? 'bg-[#000638] text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
                  }`}
                >
                  {dia}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Categorias de Despesas */}
      <div className="space-y-2">
        {/* Botões de ação */}
        {dadosAgrupados.length > 0 && (
          <div className="flex justify-between items-center">
            {/* Botão discreto para expandir/colapsar todos */}
            <button
              onClick={toggleTodosTopicos}
              className="text-xs text-gray-500 hover:text-gray-700 px-0.5 py-0.5 rounded transition-colors flex items-center gap-1"
              title={
                todosExpandidos
                  ? 'Colapsar todos os tópicos'
                  : 'Expandir todos os tópicos'
              }
            >
              {todosExpandidos ? (
                <>
                  <span>−</span>
                  <span>Colapsar tudo</span>
                </>
              ) : (
                <>
                  <span>+</span>
                  <span>Expandir tudo</span>
                </>
              )}
            </button>

            {/* Botão para baixar Excel */}
            <button
              onClick={exportarDadosUltimaLinha}
              className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium"
              title="Exportar todos os dados da última linha de hierarquia para Excel"
            >
              <FileArrowDown size={14} />
              BAIXAR EXCEL
            </button>
          </div>
        )}

        {dadosAgrupados.map((categoria, categoriaIndex) => {
          const isCategoriaExpanded = categoriasExpandidas.has(categoria.nome);

          return (
            <div
              key={`categoria-${categoriaIndex}-${categoria.nome}`}
              className="border border-gray-200 rounded-lg overflow-hidden"
            >
              {/* Cabeçalho da categoria principal */}
              <div
                className="bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors px-2 py-1.5 flex items-center justify-between"
                onClick={() => toggleCategoria(categoria.nome)}
              >
                <div className="flex items-center space-x-2">
                  {isCategoriaExpanded ? (
                    <CaretDown size={10} className="text-gray-600" />
                  ) : (
                    <CaretRight size={10} className="text-gray-600" />
                  )}
                  <div>
                    <h3 className="font-medium text-xs text-gray-800">
                      {categoria.nome}
                    </h3>
                    <div className="flex items-center space-x-3 text-xs text-gray-600">
                      <span>{categoria.quantidade} conta(s)</span>
                      <span>{categoria.despesasArray.length} despesa(s)</span>
                      <span className="font-medium text-red-600">
                        {categoria.total.toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sub-tópicos de despesas */}
              {isCategoriaExpanded && (
                <div className="bg-white border-t border-gray-100">
                  {categoria.despesasArray.map((despesa, despesaIndex) => {
                    const chaveExpansao = `${categoria.nome}|${despesa.nome}`;
                    const isDespesaExpanded =
                      categoriasExpandidas.has(chaveExpansao);

                    return (
                      <div
                        key={`despesa-${categoriaIndex}-${despesaIndex}-${despesa.nome}`}
                        className="border-b border-gray-100 last:border-b-0"
                      >
                        {/* Cabeçalho da despesa específica */}
                        <div
                          className="bg-gray-25 hover:bg-gray-50 cursor-pointer transition-colors px-4 py-1.5 flex items-center justify-between"
                          onClick={() =>
                            toggleDespesa(categoria.nome, despesa.nome)
                          }
                        >
                          <div className="flex items-center space-x-2">
                            {isDespesaExpanded ? (
                              <CaretDown size={10} className="text-gray-500" />
                            ) : (
                              <CaretRight size={10} className="text-gray-500" />
                            )}
                            <div>
                              <h4 className="font-medium text-xs text-gray-700">
                                {despesa.nome}
                              </h4>
                              <div className="flex items-center space-x-3 text-xs text-gray-500">
                                <span>{despesa.quantidade} conta(s)</span>
                                <span>
                                  {despesa.fornecedoresArray.length}{' '}
                                  fornecedor(es)
                                </span>
                                <span className="font-medium text-red-500">
                                  {despesa.total.toLocaleString('pt-BR', {
                                    style: 'currency',
                                    currency: 'BRL',
                                  })}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Sub-tópicos de fornecedores */}
                        {isDespesaExpanded && (
                          <div className="bg-white border-t border-gray-50">
                            {despesa.fornecedoresArray.map(
                              (fornecedor, fornecedorIndex) => {
                                const chaveExpansaoFornecedor = `${categoria.nome}|${despesa.nome}|${fornecedor.nome}|${fornecedor.nrDuplicata}|${fornecedor.nrParcela}|${fornecedor.vlRateio}`;
                                const isFornecedorExpanded =
                                  categoriasExpandidas.has(
                                    chaveExpansaoFornecedor,
                                  );

                                return (
                                  <div
                                    key={`fornecedor-${categoriaIndex}-${despesaIndex}-${fornecedorIndex}-${fornecedor.nome}-${fornecedor.nrDuplicata}-${fornecedor.nrParcela}`}
                                    className="border-b border-gray-50 last:border-b-0"
                                  >
                                    {/* Cabeçalho do fornecedor */}
                                    <div
                                      className="bg-gray-25 hover:bg-gray-50 cursor-pointer transition-colors px-6 py-1.5 flex items-center justify-between"
                                      onClick={() =>
                                        toggleFornecedor(
                                          categoria.nome,
                                          despesa.nome,
                                          fornecedor.nome,
                                          fornecedor.nrDuplicata,
                                          fornecedor.nrParcela,
                                          fornecedor.vlRateio,
                                        )
                                      }
                                    >
                                      <div className="flex items-center space-x-2">
                                        {isFornecedorExpanded ? (
                                          <CaretDown
                                            size={10}
                                            className="text-gray-400"
                                          />
                                        ) : (
                                          <CaretRight
                                            size={10}
                                            className="text-gray-400"
                                          />
                                        )}
                                        <div>
                                          <h5 className="font-medium text-xs text-gray-600">
                                            {fornecedor.nome}
                                            <span className="ml-1 text-gray-400">
                                              (Dup: {fornecedor.nrDuplicata} |
                                              Parc:{' '}
                                              {fornecedor.nrParcela || '-'})
                                            </span>
                                            {fornecedor.vlRateio > 0 && (
                                              <span className="ml-1 text-gray-400">
                                                - Rateio:{' '}
                                                {parseFloat(
                                                  fornecedor.vlRateio,
                                                ).toLocaleString('pt-BR', {
                                                  style: 'currency',
                                                  currency: 'BRL',
                                                })}
                                              </span>
                                            )}
                                          </h5>
                                          <div className="flex items-center space-x-3 text-xs text-gray-400">
                                            <span>
                                              {fornecedor.quantidade} conta(s)
                                            </span>
                                            <span className="font-medium text-red-400">
                                              {fornecedor.total.toLocaleString(
                                                'pt-BR',
                                                {
                                                  style: 'currency',
                                                  currency: 'BRL',
                                                },
                                              )}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Tabela de detalhes do fornecedor */}
                                    {isFornecedorExpanded && (
                                      <div className="bg-white">
                                        <div className="overflow-x-auto">
                                          <table className="contas-table w-full border-collapse">
                                            <thead>
                                              <tr className="bg-[#000638] text-white text-[8px]">
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px]"
                                                  style={{
                                                    width: '30px',
                                                    minWidth: '30px',
                                                    position: 'sticky',
                                                    left: 0,
                                                    zIndex: 10,
                                                    background: '#000638',
                                                  }}
                                                >
                                                  Selecionar
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('dt_vencimento')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Vencimento{' '}
                                                    {getSortIcon(
                                                      'dt_vencimento',
                                                    )}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('vl_duplicata')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Valor{' '}
                                                    {getSortIcon(
                                                      'vl_duplicata',
                                                    )}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('cd_fornecedor')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Fornecedor{' '}
                                                    {getSortIcon(
                                                      'cd_fornecedor',
                                                    )}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('nm_fornecedor')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    NM Fornecedor{' '}
                                                    {getSortIcon(
                                                      'nm_fornecedor',
                                                    )}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('ds_despesaitem')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Despesa{' '}
                                                    {getSortIcon(
                                                      'ds_despesaitem',
                                                    )}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('ds_ccusto')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    NM CUSTO{' '}
                                                    {getSortIcon('ds_ccusto')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('cd_empresa')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Empresa{' '}
                                                    {getSortIcon('cd_empresa')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('nr_duplicata')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Duplicata{' '}
                                                    {getSortIcon(
                                                      'nr_duplicata',
                                                    )}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('nr_portador')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Portador{' '}
                                                    {getSortIcon('nr_portador')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('dt_emissao')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Emissão{' '}
                                                    {getSortIcon('dt_emissao')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('dt_entrada')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Entrada{' '}
                                                    {getSortIcon('dt_entrada')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('dt_liq')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Liquidação{' '}
                                                    {getSortIcon('dt_liq')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('tp_situacao')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Situação{' '}
                                                    {getSortIcon('tp_situacao')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('tp_estagio')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Estágio{' '}
                                                    {getSortIcon('tp_estagio')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('vl_juros')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Juros{' '}
                                                    {getSortIcon('vl_juros')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('vl_acrescimo')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Acréscimo{' '}
                                                    {getSortIcon(
                                                      'vl_acrescimo',
                                                    )}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('vl_desconto')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Desconto{' '}
                                                    {getSortIcon('vl_desconto')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('vl_pago')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Pago{' '}
                                                    {getSortIcon('vl_pago')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('in_aceite')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Aceite{' '}
                                                    {getSortIcon('in_aceite')}
                                                  </div>
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort('nr_parcela')
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Parcela{' '}
                                                    {getSortIcon('nr_parcela')}
                                                  </div>
                                                </th>
                                                <th className="px-0.5 py-0.5 text-center text-[8px]">
                                                  Rateio
                                                </th>
                                                <th className="px-0.5 py-0.5 text-center text-[8px]">
                                                  Observação
                                                </th>
                                                <th
                                                  className="px-0.5 py-0.5 text-center text-[8px] cursor-pointer hover:bg-[#000638]/80 transition-colors"
                                                  onClick={() =>
                                                    handleSort(
                                                      'tp_previsaoreal',
                                                    )
                                                  }
                                                >
                                                  <div className="flex items-center justify-center">
                                                    Previsão{' '}
                                                    {getSortIcon(
                                                      'tp_previsaoreal',
                                                    )}
                                                  </div>
                                                </th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {fornecedor.itens.map(
                                                (item, index) => {
                                                  const indiceReal =
                                                    item.indiceOriginal;
                                                  const isSelected =
                                                    linhasSelecionadas.has(
                                                      indiceReal,
                                                    );
                                                  const dadoItem =
                                                    item.grupo.item; // Acessar o item através do grupo

                                                  return (
                                                    <tr
                                                      key={`${dadoItem.cd_empresa}-${dadoItem.nr_duplicata}-${index}`}
                                                      className={`text-[8px] border-b transition-colors cursor-pointer ${
                                                        isSelected
                                                          ? 'bg-blue-100 hover:bg-blue-200'
                                                          : index % 2 === 0
                                                            ? 'bg-white hover:bg-gray-100'
                                                            : 'bg-gray-50 hover:bg-gray-100'
                                                      }`}
                                                      onClick={() =>
                                                        abrirModalDetalhes(
                                                          dadoItem,
                                                        )
                                                      }
                                                      title="Clique para ver detalhes da conta"
                                                    >
                                                      <td
                                                        className="px-0.5 py-0.5 text-center"
                                                        style={{
                                                          width: '30px',
                                                          minWidth: '30px',
                                                          position: 'sticky',
                                                          left: 0,
                                                          zIndex: 10,
                                                          background: isSelected
                                                            ? '#dbeafe'
                                                            : 'inherit',
                                                        }}
                                                      >
                                                        <input
                                                          type="checkbox"
                                                          checked={isSelected}
                                                          onChange={(e) => {
                                                            e.stopPropagation();
                                                            toggleLinhaSelecionada(
                                                              indiceReal,
                                                            );
                                                          }}
                                                          className="rounded w-3 h-3"
                                                          onClick={(e) =>
                                                            e.stopPropagation()
                                                          }
                                                        />
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {formatarData(
                                                          dadoItem.dt_vencimento,
                                                        )}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-right font-medium text-green-600">
                                                        {parseFloat(
                                                          dadoItem.vl_duplicata ||
                                                            0,
                                                        ).toLocaleString(
                                                          'pt-BR',
                                                          {
                                                            style: 'currency',
                                                            currency: 'BRL',
                                                          },
                                                        )}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {dadoItem.cd_fornecedor ||
                                                          ''}
                                                      </td>
                                                      <td
                                                        className="px-0.5 py-0.5 text-left max-w-32 truncate"
                                                        title={
                                                          dadoItem.nm_fornecedor
                                                        }
                                                      >
                                                        {dadoItem.nm_fornecedor ||
                                                          ''}
                                                      </td>
                                                      <td
                                                        className="px-0.5 py-0.5 text-left max-w-48 truncate min-w-32"
                                                        title={
                                                          dadoItem.ds_despesaitem
                                                        }
                                                      >
                                                        {dadoItem.ds_despesaitem ||
                                                          ''}
                                                      </td>
                                                      <td
                                                        className="px-0.5 py-0.5 text-left max-w-48 truncate min-w-32"
                                                        title={
                                                          dadoItem.ds_ccusto
                                                        }
                                                      >
                                                        {dadoItem.ds_ccusto ||
                                                          ''}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {dadoItem.cd_empresa ||
                                                          ''}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {dadoItem.nr_duplicata ||
                                                          ''}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {dadoItem.nr_portador ||
                                                          ''}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {formatarData(
                                                          dadoItem.dt_emissao,
                                                        )}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {formatarData(
                                                          dadoItem.dt_entrada,
                                                        )}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {formatarData(
                                                          dadoItem.dt_liq,
                                                        )}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {dadoItem.tp_situacao ||
                                                          ''}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {dadoItem.tp_estagio ||
                                                          ''}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-right">
                                                        {parseFloat(
                                                          dadoItem.vl_juros ||
                                                            0,
                                                        ).toLocaleString(
                                                          'pt-BR',
                                                          {
                                                            style: 'currency',
                                                            currency: 'BRL',
                                                          },
                                                        )}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-right">
                                                        {parseFloat(
                                                          dadoItem.vl_acrescimo ||
                                                            0,
                                                        ).toLocaleString(
                                                          'pt-BR',
                                                          {
                                                            style: 'currency',
                                                            currency: 'BRL',
                                                          },
                                                        )}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-right">
                                                        {parseFloat(
                                                          dadoItem.vl_desconto ||
                                                            0,
                                                        ).toLocaleString(
                                                          'pt-BR',
                                                          {
                                                            style: 'currency',
                                                            currency: 'BRL',
                                                          },
                                                        )}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-right">
                                                        {parseFloat(
                                                          dadoItem.vl_pago || 0,
                                                        ).toLocaleString(
                                                          'pt-BR',
                                                          {
                                                            style: 'currency',
                                                            currency: 'BRL',
                                                          },
                                                        )}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {dadoItem.in_aceite ||
                                                          ''}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {dadoItem.nr_parcela ||
                                                          ''}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-right">
                                                        {parseFloat(
                                                          dadoItem.vl_rateio ||
                                                            0,
                                                        ).toLocaleString(
                                                          'pt-BR',
                                                          {
                                                            style: 'currency',
                                                            currency: 'BRL',
                                                          },
                                                        )}
                                                      </td>
                                                      <td
                                                        className="px-0.5 py-0.5 text-left max-w-32 truncate"
                                                        title={
                                                          dadoItem.ds_observacao
                                                        }
                                                      >
                                                        {dadoItem.ds_observacao ||
                                                          ''}
                                                      </td>
                                                      <td className="px-0.5 py-0.5 text-center">
                                                        {dadoItem.tp_previsaoreal ||
                                                          ''}
                                                      </td>
                                                    </tr>
                                                  );
                                                },
                                              )}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              },
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {dadosAgrupados.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            Nenhuma despesa encontrada para os filtros selecionados
          </div>
        )}
      </div>
    </div>
  );
};

export default ContasAPagar;
