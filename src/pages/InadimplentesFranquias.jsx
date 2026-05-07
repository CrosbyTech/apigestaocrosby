import React, { useState, useEffect, useMemo } from 'react';
import FiltroEstados from '../components/filters/FiltroEstados';
import FiltroClientes from '../components/filters/FiltroClientes';
import useApiClient from '../hooks/useApiClient';
import useClassificacoesInadimplentes from '../hooks/useClassificacoesInadimplentes';
import { useAuth } from '../components/AuthContext';
import { supabaseAdmin } from '../lib/supabase';
import PageTitle from '../components/ui/PageTitle';
import Notification from '../components/ui/Notification';
import { TotvsURL } from '../config/constants';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
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
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import {
  ChartBar,
  CircleNotch,
  Users,
  CurrencyDollar,
  MapPin,
  Receipt,
  FileArrowDown,
  ChatCircleDots,
  Trash,
  UploadSimple,
  PaperPlaneRight,
  FileText,
  X,
  Spinner,
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
);

const InadimplentesFranquias = () => {
  const apiClient = useApiClient();
  const { user } = useAuth();
  const {
    salvarObservacaoFranquia,
    buscarObservacoesFranquia,
    deletarObservacaoFranquia,
  } = useClassificacoesInadimplentes();
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [filtroDataInicial, setFiltroDataInicial] = useState('2024-04-01');
  const hojeStr = new Date().toISOString().slice(0, 10);
  const [filtroDataFinal, setFiltroDataFinal] = useState(hojeStr);
  const [filtroClientes, setFiltroClientes] = useState([]);
  const [filtroEstados, setFiltroEstados] = useState([]);

  const [modalAberto, setModalAberto] = useState(false);
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [faturasSelecionadas, setFaturasSelecionadas] = useState([]);
  const [faturasAVencer, setFaturasAVencer] = useState([]);
  const [loadingFaturasModal, setLoadingFaturasModal] = useState(false);
  const [obsModalAberto, setObsModalAberto] = useState(false);
  const [obsFatura, setObsFatura] = useState([]);
  const [obsLoading, setObsLoading] = useState(false);

  // Estados para controle de ordenação
  const [ordenarPor, setOrdenarPor] = useState(null);
  const [direcaoOrdenacao, setDirecaoOrdenacao] = useState('asc');

  // Estado para valores a vencer por cliente
  const [valoresAVencer, setValoresAVencer] = useState({});

  // Estados para modal de solicitação de baixa
  const [modalBaixaAberto, setModalBaixaAberto] = useState(false);
  const [faturaBaixa, setFaturaBaixa] = useState(null);
  const [comprovanteBaixa, setComprovanteBaixa] = useState(null);
  const [previewComprovante, setPreviewComprovante] = useState(null);
  const [observacaoBaixa, setObservacaoBaixa] = useState('');
  const [loadingBaixa, setLoadingBaixa] = useState(false);

  // Estados para modal de observações
  const [modalObservacoesAberto, setModalObservacoesAberto] = useState(false);
  const [clienteObservacoes, setClienteObservacoes] = useState(null);
  const [observacoesList, setObservacoesList] = useState([]);
  const [novaObservacao, setNovaObservacao] = useState('');
  const [loadingObservacoes, setLoadingObservacoes] = useState(false);

  // Função para ordenar colunas
  const ordenarColuna = (coluna) => {
    if (ordenarPor === coluna) {
      setDirecaoOrdenacao(direcaoOrdenacao === 'asc' ? 'desc' : 'asc');
    } else {
      setOrdenarPor(coluna);
      setDirecaoOrdenacao('asc');
    }
  };

  const fetchDados = async () => {
    try {
      setLoading(true);

      const dataIni = filtroDataInicial || '2024-01-01';
      const dataFim = filtroDataFinal || hojeStr;

      // Calcular data de amanhã para buscar "a vencer"
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const amanhaStr = amanha.toISOString().split('T')[0];
      // 1 ano a frente para faturas a vencer
      const umAnoFrente = new Date();
      umAnoFrente.setFullYear(umAnoFrente.getFullYear() + 1);
      const umAnoFrenteStr = umAnoFrente.toISOString().split('T')[0];

      // ============================================================
      // PASSO 1: Buscar códigos dos clientes FRANQUIA (classificação TOTVS)
      // ============================================================
      console.log('🔍 Buscando clientes FRANQUIA...');
      const respFranquias = await fetch(`${TotvsURL}franchise-clients`);
      if (!respFranquias.ok) {
        const errData = await respFranquias.json().catch(() => ({}));
        throw new Error(
          errData.message ||
            `Erro ao buscar franquias: HTTP ${respFranquias.status}`,
        );
      }
      const resultFranquias = await respFranquias.json();
      const franquias = resultFranquias.data || [];

      if (franquias.length === 0) {
        console.warn('⚠️ Nenhum cliente franquia encontrado.');
        setDados([]);
        setValoresAVencer({});
        return;
      }

      // Montar mapa de franquias para enriquecer depois (nome, fantasia)
      const franquiasMap = {};
      franquias.forEach((f) => {
        franquiasMap[String(f.code)] = f;
      });

      // Códigos de franquias separados por vírgula para query param
      const codigosFranquias = franquias.map((f) => f.code).join(',');
      console.log(`📋 ${franquias.length} clientes franquia encontrados`);

      // ============================================================
      // PASSO 2: Buscar contas a receber APENAS dos clientes franquia
      // ============================================================
      const paramsVencidas = new URLSearchParams({
        dt_inicio: dataIni,
        dt_fim: dataFim,
        modo: 'vencimento',
        situacao: '1',
        status: 'Vencido',
        cd_cliente: codigosFranquias,
      });

      const paramsAVencer = new URLSearchParams({
        dt_inicio: amanhaStr,
        dt_fim: umAnoFrenteStr,
        modo: 'vencimento',
        situacao: '1',
        status: 'Em Aberto',
        cd_cliente: codigosFranquias,
      });

      console.log('🔍 Buscando inadimplentes (apenas franquias) via TOTVS...');

      const [responseVencidas, responseAVencer] = await Promise.all([
        fetch(
          `${TotvsURL}accounts-receivable/filter?${paramsVencidas.toString()}`,
        ),
        fetch(
          `${TotvsURL}accounts-receivable/filter?${paramsAVencer.toString()}`,
        ),
      ]);

      if (!responseVencidas.ok) {
        const errData = await responseVencidas.json();
        throw new Error(
          errData.message || `Erro HTTP ${responseVencidas.status}`,
        );
      }

      const resultVencidas = await responseVencidas.json();
      const faturasVencidas = resultVencidas.data?.items || [];

      let faturasAVencerTodas = [];
      if (responseAVencer.ok) {
        const resultAVencer = await responseAVencer.json();
        faturasAVencerTodas = resultAVencer.data?.items || [];
      }

      console.log(
        `📊 Faturas franquias — vencidas: ${faturasVencidas.length}, A vencer: ${faturasAVencerTodas.length}`,
      );

      // Filtrar apenas tipo documento FATURA (tp_documento = 1)
      const vencidasFiltradas = faturasVencidas.filter(
        (item) => item.tp_documento === 1 || item.tp_documento === '1',
      );

      const aVencerFiltradas = faturasAVencerTodas.filter(
        (item) => item.tp_documento === 1 || item.tp_documento === '1',
      );

      console.log(
        `📊 Após filtro FATURA: vencidas=${vencidasFiltradas.length}, a vencer=${aVencerFiltradas.length}`,
      );

      // ============================================================
      // PASSO 3: Enriquecer com dados de pessoa (telefone, UF)
      // ============================================================
      const todosCodigosClientes = [
        ...new Set(
          [
            ...vencidasFiltradas.map((item) => item.cd_cliente),
            ...aVencerFiltradas.map((item) => item.cd_cliente),
          ].filter(Boolean),
        ),
      ];

      let pessoasMap = {};
      if (todosCodigosClientes.length > 0) {
        try {
          const respPessoas = await fetch(`${TotvsURL}persons/batch-lookup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personCodes: todosCodigosClientes }),
          });
          if (respPessoas.ok) {
            const dataPessoas = await respPessoas.json();
            pessoasMap = dataPessoas?.data || {};
            console.log(
              `👤 ${Object.keys(pessoasMap).length} clientes encontrados via batch-lookup`,
            );
          }
        } catch (err) {
          console.warn('⚠️ Erro ao buscar dados de pessoas:', err.message);
        }
      }

      // Enriquecer faturas vencidas com dados de pessoa + dados do cache de franquias
      const dadosEnriquecidos = vencidasFiltradas.map((item) => {
        const pessoa = pessoasMap[String(item.cd_cliente)] || {};
        const franquia = franquiasMap[String(item.cd_cliente)] || {};
        return {
          ...item,
          nm_cliente:
            pessoa.name ||
            franquia.name ||
            item.nm_cliente ||
            item.nr_cpfcnpj ||
            `Cliente ${item.cd_cliente}`,
          nm_fantasia:
            pessoa.fantasyName ||
            franquia.fantasyName ||
            item.nm_fantasia ||
            '',
          nr_telefone: pessoa.phone || '',
          ds_uf: pessoa.uf || item.ds_uf || '',
        };
      });

      // Processar valores a vencer por cd_cliente
      const aVencerMap = {};
      aVencerFiltradas.forEach((item) => {
        const cd = String(item.cd_cliente);
        aVencerMap[cd] =
          (aVencerMap[cd] || 0) + (parseFloat(item.vl_fatura) || 0);
      });
      setValoresAVencer(aVencerMap);

      console.log(
        '📊 Dados inadimplentes franquias via TOTVS:',
        dadosEnriquecidos.length,
      );
      setDados(dadosEnriquecidos);
    } catch (error) {
      console.error('❌ Erro ao buscar dados de inadimplentes:', error);
      alert(`Erro ao buscar dados: ${error.message}`);
      setDados([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDados();
  }, []);

  const dadosFiltrados = useMemo(() => {
    return dados.filter((item) => {
      // Filtros já aplicados no backend: tipo documento, situação, vencido sem pagamento
      // Aqui só filtramos por cliente e estado selecionados no frontend

      const matchCliente =
        filtroClientes.length === 0 ||
        filtroClientes.includes(String(item.cd_cliente));

      const sigla = (item.ds_uf || '').trim();
      const matchEstado =
        filtroEstados.length === 0 || filtroEstados.includes(sigla);

      // Confirmar que está vencido (segurança local)
      if (!item.dt_vencimento) return false;
      const hoje = new Date();
      const vencimento = new Date(item.dt_vencimento);
      const diasAtraso = Math.floor(
        (hoje - vencimento) / (1000 * 60 * 60 * 24),
      );
      const estaAtrasado = diasAtraso >= 1;

      return matchCliente && estaAtrasado && matchEstado;
    });
  }, [dados, filtroClientes, filtroEstados]);

  const estadosDisponiveis = useMemo(() => {
    const setEstados = new Set();
    dados.forEach((d) => {
      const sigla = (d.ds_uf || '').trim();
      if (sigla) setEstados.add(sigla);
    });
    return Array.from(setEstados).filter(Boolean).sort();
  }, [dados]);

  const clientesDisponiveis = useMemo(() => {
    const map = new Map();
    (dados || []).forEach((d) => {
      if (d.cd_cliente) {
        const key = String(d.cd_cliente);
        if (!map.has(key)) {
          // Para franquias, exibir nome fantasia quando disponível
          const nome = d.nm_fantasia || d.nm_cliente || key;
          map.set(key, { cd_cliente: key, nm_cliente: nome });
        }
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      a.nm_cliente > b.nm_cliente ? 1 : -1,
    );
  }, [dados]);

  const clientesAgrupados = useMemo(() => {
    const agrupado = dadosFiltrados.reduce((acc, item) => {
      const cdCliente = item.cd_cliente;
      if (!acc[cdCliente]) {
        acc[cdCliente] = {
          cd_cliente: cdCliente,
          nm_fantasia: item.nm_fantasia || null,
          nm_cliente: item.nm_cliente || null,
          nr_telefone: item.nr_telefone || '',
          ds_uf: (item.ds_uf || '').trim() || null,
          valor_total: 0,
          faturas: [],
        };
      }
      acc[cdCliente].valor_total += parseFloat(item.vl_fatura) || 0;
      acc[cdCliente].faturas.push(item);
      return acc;
    }, {});

    const resultado = Object.values(agrupado).map((cliente) => {
      // Calcular dias de atraso máximo
      const diasAtrasoMax = (cliente.faturas || []).reduce((max, fatura) => {
        if (!fatura.dt_vencimento) return max;
        const diff = Math.floor(
          (new Date() - new Date(fatura.dt_vencimento)) / (1000 * 60 * 60 * 24),
        );
        return Math.max(max, diff);
      }, 0);

      // Definir situação: > 60 dias = INADIMPLENTE, <= 60 dias = ATRASADO
      const situacao = diasAtrasoMax > 60 ? 'INADIMPLENTE' : 'ATRASADO';

      // Valor a vencer do cliente
      const valor_a_vencer = valoresAVencer[cliente.cd_cliente] || 0;

      return {
        ...cliente,
        diasAtrasoMax,
        situacao,
        valor_a_vencer,
      };
    });

    // Aplicar ordenação
    if (ordenarPor) {
      resultado.sort((a, b) => {
        let valorA, valorB;

        switch (ordenarPor) {
          case 'cd_cliente':
            valorA = a.cd_cliente || '';
            valorB = b.cd_cliente || '';
            break;
          case 'nm_cliente':
            valorA = (a.nm_fantasia || a.nm_cliente || '').toLowerCase();
            valorB = (b.nm_fantasia || b.nm_cliente || '').toLowerCase();
            break;
          case 'ds_uf':
            valorA = (a.ds_uf || '').toLowerCase();
            valorB = (b.ds_uf || '').toLowerCase();
            break;
          case 'valor_total':
            valorA = parseFloat(a.valor_total) || 0;
            valorB = parseFloat(b.valor_total) || 0;
            break;
          case 'valor_a_vencer':
            valorA = parseFloat(a.valor_a_vencer) || 0;
            valorB = parseFloat(b.valor_a_vencer) || 0;
            break;
          case 'situacao':
            valorA = (a.situacao || '').toLowerCase();
            valorB = (b.situacao || '').toLowerCase();
            break;
          default:
            return 0;
        }

        if (valorA < valorB) return direcaoOrdenacao === 'asc' ? -1 : 1;
        if (valorA > valorB) return direcaoOrdenacao === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return resultado;
  }, [dadosFiltrados, ordenarPor, direcaoOrdenacao, valoresAVencer]);

  const metricas = useMemo(() => {
    const totalClientes = clientesAgrupados.length;
    const valorTotal = clientesAgrupados.reduce(
      (acc, cliente) => acc + cliente.valor_total,
      0,
    );

    return {
      totalClientes,
      valorTotal,
    };
  }, [clientesAgrupados]);

  const dadosPorEstado = useMemo(() => {
    const agrupado = dadosFiltrados.reduce((acc, item) => {
      const estado = (item.ds_uf || '').trim() || 'Não informado';
      if (!acc[estado]) {
        acc[estado] = { clientes: 0, valor: 0 };
      }
      acc[estado].clientes += 1;
      acc[estado].valor += parseFloat(item.vl_fatura) || 0;
      return acc;
    }, {});

    const estados = Object.keys(agrupado);
    const clientesPorEstado = estados.map(
      (estado) => agrupado[estado].clientes,
    );

    return {
      estados,
      clientesPorEstado,
    };
  }, [dadosFiltrados]);

  const topClientes = useMemo(() => {
    if (!clientesAgrupados || clientesAgrupados.length === 0) return [];
    const sorted = [...clientesAgrupados]
      .sort((a, b) => b.valor_total - a.valor_total)
      .slice(0, 10);
    return sorted.map((c) => {
      const diasMax = (c.faturas || []).reduce((max, f) => {
        if (!f.dt_vencimento) return max;
        const diff = Math.floor(
          (new Date() - new Date(f.dt_vencimento)) / (1000 * 60 * 60 * 24),
        );
        return Math.max(max, diff);
      }, 0);
      return { ...c, diasAtrasoMax: diasMax };
    });
  }, [clientesAgrupados]);

  const graficoPrincipalData = {
    labels: topClientes.map((c) =>
      c.nm_cliente ? c.nm_cliente : c.cd_cliente,
    ),
    datasets: [
      {
        label: 'Valor Inadimplente (R$)',
        data: topClientes.map((c) => Number(c.valor_total || 0)),
        backgroundColor: '#000638',
        borderColor: '#000638',
        borderWidth: 1,
      },
    ],
  };

  const graficoEstadoData = {
    labels: dadosPorEstado.estados,
    datasets: [
      {
        label: 'Clientes',
        data: dadosPorEstado.clientesPorEstado,
        backgroundColor: '#000638',
        borderColor: '#000638',
        borderWidth: 1,
      },
    ],
  };

  // Mapear tipo de cobrança TOTVS
  const getTipoCobranca = (tipo) => {
    const mapa = {
      0: { label: 'SIMPLES', color: 'bg-gray-100 text-gray-800' },
      1: { label: 'DESCONTADA', color: 'bg-purple-100 text-purple-800' },
      2: { label: 'VINCULADA', color: 'bg-cyan-100 text-cyan-800' },
      3: { label: 'CAUCIONADA', color: 'bg-yellow-100 text-yellow-800' },
      4: { label: 'PROTESTO', color: 'bg-red-100 text-red-800' },
    };
    return (
      mapa[tipo] || {
        label: tipo != null ? `TIPO ${tipo}` : '--',
        color: 'bg-gray-100 text-gray-600',
      }
    );
  };

  const formatarMoeda = (valor) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(valor || 0);
  };

  const formatarData = (data) => {
    if (!data) return 'N/A';
    const [datePart] = String(data).split('T');
    const [y, m, d] = datePart.split('-');
    if (!y || !m || !d) return 'N/A';
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  };

  const calcularTempoInadimplencia = (dtVencimento) => {
    if (!dtVencimento) return 'N/A';

    const hoje = new Date();
    const vencimento = new Date(dtVencimento);
    const diferencaMs = hoje - vencimento;
    const dias = Math.floor(diferencaMs / (1000 * 60 * 60 * 24));

    if (dias <= 0) return '0 dias';
    if (dias === 1) return '1 dia';
    if (dias < 30) return `${dias} dias`;
    if (dias < 365) {
      const meses = Math.floor(dias / 30);
      return meses === 1 ? '1 mês' : `${meses} meses`;
    }
    const anos = Math.floor(dias / 365);
    return anos === 1 ? '1 ano' : `${anos} anos`;
  };

  const abrirModal = async (cliente) => {
    setClienteSelecionado(cliente);
    setFaturasSelecionadas(cliente.faturas);
    setModalAberto(true);
    setLoadingFaturasModal(true);

    try {
      // Buscar faturas a vencer do cliente via TOTVS
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const amanhaStr = amanha.toISOString().split('T')[0];
      const umAno = new Date();
      umAno.setFullYear(umAno.getFullYear() + 1);
      const umAnoStr = umAno.toISOString().split('T')[0];

      const params = new URLSearchParams({
        dt_inicio: amanhaStr,
        dt_fim: umAnoStr,
        modo: 'vencimento',
        situacao: '1',
        status: 'Em Aberto',
        cd_cliente: String(cliente.cd_cliente),
      });

      const response = await fetch(
        `${TotvsURL}accounts-receivable/filter?${params.toString()}`,
      );

      let faturasAVencerRecebidas = [];
      if (response.ok) {
        const result = await response.json();
        faturasAVencerRecebidas = (result.data?.items || []).filter(
          (item) => item.tp_documento === 1 || item.tp_documento === '1',
        );
      }

      setFaturasAVencer(faturasAVencerRecebidas);
    } catch (error) {
      console.error('Erro ao buscar faturas a vencer:', error);
      setFaturasAVencer([]);
    } finally {
      setLoadingFaturasModal(false);
    }
  };

  const abrirObsFatura = async (fatura) => {
    // Chamar rota obsfati com cd_cliente e nr_fat
    try {
      setObsLoading(true);
      const cd_cliente =
        clienteSelecionado?.cd_cliente || fatura.cd_cliente || '';
      const nr_fat = fatura.nr_fat || fatura.nr_fatura || '';

      const response = await apiClient.financial.obsFati({
        cd_cliente,
        nr_fat,
      });

      let rows = [];
      if (response && response.success && Array.isArray(response.data)) {
        rows = response.data;
      } else if (Array.isArray(response)) {
        rows = response;
      }

      setObsFatura(rows);
      setObsModalAberto(true);
    } catch (error) {
      console.error('Erro ao carregar observações da fatura', error);
      setObsFatura([]);
      setObsModalAberto(true);
    } finally {
      setObsLoading(false);
    }
  };

  const fecharModal = () => {
    setModalAberto(false);
    setClienteSelecionado(null);
    setFaturasSelecionadas([]);
    setFaturasAVencer([]);
  };

  // === Funções de Solicitação de Baixa ===
  const [dataPagamentoBaixa, setDataPagamentoBaixa] = useState('');
  const [formaPagamentoBaixa, setFormaPagamentoBaixa] = useState('');
  const [dadosCartaoBaixa, setDadosCartaoBaixa] = useState({
    bandeira: '',
    autorizacao: '',
    nsu: '',
  });

  const FORMAS_PAGAMENTO = [
    { id: 'confianca', label: 'Confiança', paidType: 4 },
    { id: 'sicredi', label: 'Sicredi', paidType: 4 },
    { id: 'adiantamento', label: 'Adiantamento (PIX TOTVS)', paidType: 3 },
    { id: 'cartao_credito', label: 'Cartão de Crédito', paidType: 1 },
    { id: 'cartao_debito', label: 'Cartão de Débito', paidType: 2 },
    { id: 'credev', label: 'CREDEV', paidType: 5 },
  ];

  const abrirModalBaixa = (fatura) => {
    setFaturaBaixa(fatura);
    setComprovanteBaixa(null);
    setPreviewComprovante(null);
    setObservacaoBaixa('');
    setDataPagamentoBaixa('');
    setFormaPagamentoBaixa('');
    setDadosCartaoBaixa({ bandeira: '', autorizacao: '', nsu: '' });
    setModalBaixaAberto(true);
  };

  const fecharModalBaixa = () => {
    setModalBaixaAberto(false);
    setFaturaBaixa(null);
    setComprovanteBaixa(null);
    setPreviewComprovante(null);
    setObservacaoBaixa('');
    setDataPagamentoBaixa('');
    setFormaPagamentoBaixa('');
    setDadosCartaoBaixa({ bandeira: '', autorizacao: '', nsu: '' });
  };

  const handleComprovanteChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setComprovanteBaixa(file);
    if (file.type.startsWith('image/') || file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onloadend = () => setPreviewComprovante(reader.result);
      reader.readAsDataURL(file);
    } else {
      setPreviewComprovante(null);
    }
  };

  const handleEnviarBaixa = async () => {
    if (!faturaBaixa || !comprovanteBaixa) {
      setNotification({
        type: 'error',
        message: 'Selecione o comprovante de pagamento.',
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (!dataPagamentoBaixa) {
      setNotification({
        type: 'error',
        message: 'Informe a data de pagamento.',
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (!formaPagamentoBaixa) {
      setNotification({
        type: 'error',
        message: 'Selecione a forma de pagamento.',
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (
      (formaPagamentoBaixa === 'cartao_credito' ||
        formaPagamentoBaixa === 'cartao_debito') &&
      (!dadosCartaoBaixa.bandeira ||
        !dadosCartaoBaixa.autorizacao ||
        !dadosCartaoBaixa.nsu)
    ) {
      setNotification({
        type: 'error',
        message:
          'Preencha todos os dados do cartão (bandeira, autorização e NSU).',
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    setLoadingBaixa(true);
    try {
      const fileExt = comprovanteBaixa.name.split('.').pop();
      const fileName = `${faturaBaixa.cd_empresa}_${faturaBaixa.cd_cliente}_${faturaBaixa.nr_fat || faturaBaixa.nr_fatura}_${Date.now()}.${fileExt}`;
      const filePath = `comprovantes/${fileName}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from('comprovantes_baixa')
        .upload(filePath, comprovanteBaixa, { upsert: false });

      if (uploadError)
        throw new Error(`Erro no upload: ${uploadError.message}`);

      const { data: urlData } = supabaseAdmin.storage
        .from('comprovantes_baixa')
        .getPublicUrl(filePath);

      const comprovanteUrl = urlData?.publicUrl;

      const { error: insertError } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .insert({
          cd_empresa: faturaBaixa.cd_empresa,
          cd_cliente: faturaBaixa.cd_cliente,
          nm_cliente:
            clienteSelecionado?.nm_cliente || faturaBaixa.nm_cliente || '',
          nr_fat: faturaBaixa.nr_fat || faturaBaixa.nr_fatura,
          nr_parcela: faturaBaixa.nr_parcela || 1,
          vl_fatura: parseFloat(faturaBaixa.vl_fatura) || 0,
          vl_juros: parseFloat(faturaBaixa.vl_juros) || 0,
          dt_vencimento: faturaBaixa.dt_vencimento
            ? faturaBaixa.dt_vencimento.split('T')[0]
            : null,
          dt_emissao: faturaBaixa.dt_emissao
            ? faturaBaixa.dt_emissao.split('T')[0]
            : null,
          cd_portador: faturaBaixa.cd_portador || null,
          nm_portador: faturaBaixa.nm_portador || null,
          comprovante_url: comprovanteUrl,
          comprovante_path: filePath,
          status: 'pendente',
          user_id: user?.id || null,
          user_nome: user?.name || 'Usuário',
          user_email: user?.email || '',
          observacao: observacaoBaixa || null,
          dt_pagamento: dataPagamentoBaixa || null,
          forma_pagamento: formaPagamentoBaixa || null,
          dados_cartao:
            formaPagamentoBaixa === 'cartao_credito' ||
            formaPagamentoBaixa === 'cartao_debito'
              ? dadosCartaoBaixa
              : null,
        });

      if (insertError)
        throw new Error(`Erro ao salvar: ${insertError.message}`);

      setNotification({
        type: 'success',
        message: 'Solicitação de baixa enviada com sucesso!',
      });
      setTimeout(() => setNotification(null), 4000);
      fecharModalBaixa();
    } catch (error) {
      console.error('Erro ao enviar solicitação de baixa:', error);
      setNotification({
        type: 'error',
        message: error.message || 'Erro ao enviar solicitação.',
      });
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setLoadingBaixa(false);
    }
  };

  // Funções para modal de observações
  const abrirModalObservacoes = async (cliente, e) => {
    if (e) e.stopPropagation();
    setClienteObservacoes(cliente);
    setModalObservacoesAberto(true);
    setLoadingObservacoes(true);

    try {
      const { success, data } = await buscarObservacoesFranquia(
        cliente.cd_cliente,
      );
      if (success) {
        setObservacoesList(data || []);
      }
    } catch (error) {
      console.error('Erro ao buscar observações:', error);
      setObservacoesList([]);
    } finally {
      setLoadingObservacoes(false);
    }
  };

  const fecharModalObservacoes = () => {
    setModalObservacoesAberto(false);
    setClienteObservacoes(null);
    setObservacoesList([]);
    setNovaObservacao('');
  };

  const adicionarObservacao = async () => {
    if (!novaObservacao.trim()) return;
    if (!clienteObservacoes) return;
    if (!user) {
      alert('Usuário não autenticado!');
      return;
    }

    setLoadingObservacoes(true);

    try {
      const observacao = {
        cd_cliente: clienteObservacoes.cd_cliente,
        nm_cliente: clienteObservacoes.nm_cliente,
        observacao: novaObservacao,
        usuario: user.email || user.id,
      };

      const { success, data } = await salvarObservacaoFranquia(observacao);

      if (success) {
        // Adicionar a nova observação à lista
        setObservacoesList((prev) => [...prev, data[0]]);
        setNovaObservacao('');
      } else {
        alert('Erro ao salvar observação!');
      }
    } catch (error) {
      console.error('Erro ao adicionar observação:', error);
      alert('Erro ao adicionar observação!');
    } finally {
      setLoadingObservacoes(false);
    }
  };

  const excluirObservacao = async (idObservacao) => {
    if (!confirm('Tem certeza que deseja excluir esta observação?')) return;

    setLoadingObservacoes(true);

    try {
      const { success } = await deletarObservacaoFranquia(idObservacao);

      if (success) {
        // Remover a observação da lista
        setObservacoesList((prev) =>
          prev.filter((obs) => obs.id !== idObservacao),
        );
      } else {
        alert('Erro ao excluir observação!');
      }
    } catch (error) {
      console.error('Erro ao excluir observação:', error);
      alert('Erro ao excluir observação!');
    } finally {
      setLoadingObservacoes(false);
    }
  };

  const podeExcluirObservacao = (observacao) => {
    if (!user) return false;
    if (observacao.usuario !== user.email && observacao.usuario !== user.id)
      return false;

    const dataObservacao = new Date(observacao.data_criacao);
    const agora = new Date();
    const diferencaSegundos = (agora - dataObservacao) / 1000;

    return diferencaSegundos <= 120; // 120 segundos = 2 minutos
  };

  // Handler para abrir WhatsApp do cliente
  const abrirWhatsApp = (cliente, e) => {
    e.stopPropagation();

    const telefone = cliente.nr_telefone || '';

    if (!telefone) {
      alert('Telefone não encontrado para este cliente');
      return;
    }

    // Limpar telefone (remover caracteres especiais)
    const telefoneClean = telefone.replace(/\D/g, '');

    if (!telefoneClean) {
      alert('Telefone não encontrado para este cliente');
      return;
    }

    // Construir lista de faturas
    const listaFaturas = (cliente.faturas || [])
      .map((fatura) => {
        const numeroFatura = fatura.nr_fat || fatura.nr_fatura || 'N/A';
        const vencimento = fatura.dt_vencimento
          ? new Date(fatura.dt_vencimento).toLocaleDateString('pt-BR')
          : 'N/A';
        const valor = formatarMoeda(fatura.vl_fatura || 0);

        return `*Fatura:* ${numeroFatura}\n*Vencimento:* ${vencimento}\n*Valor:* ${valor}`;
      })
      .join('\n\n');

    // Mensagem padrão pré-definida
    const mensagemPadrao = `Olá, tudo bem? *${cliente.nm_fantasia || cliente.nm_cliente}*
Somos da área de Recuperação de Créditos da Crosby.
Consta em nosso sistema a existência de pendências financeiras em aberto em seu cadastro.
Entramos em contato para alinhar e verificar a melhor forma de regularização.

Segue a lista dos títulos em aberto:

${listaFaturas}

*Observação:* Caso os pagamentos já tenham sido realizados, pedimos gentilmente que desconsidere esta mensagem e se possível nos envie o comprovante para atualização em nosso sistema.

Atenciosamente,
Crosby`;

    // Codificar a mensagem para URL
    const mensagemCodificada = encodeURIComponent(mensagemPadrao);

    // Abrir WhatsApp com mensagem pré-definida
    const whatsappUrl = `https://wa.me/55${telefoneClean}?text=${mensagemCodificada}`;
    window.open(whatsappUrl, '_blank');
  };

  // Função para exportar dados para PDF
  const handleExportPDF = () => {
    if (clientesAgrupados.length === 0) {
      alert('Não há dados para exportar!');
      return;
    }

    try {
      const doc = new jsPDF('l', 'mm', 'a4'); // landscape orientation

      // Título do documento
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Inadimplência Franquias', 14, 15);

      // Data de geração
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const dataGeracao = new Date().toLocaleString('pt-BR');
      doc.text(`Gerado em: ${dataGeracao}`, 14, 22);

      // Informações de filtros aplicados
      let yPos = 28;
      if (filtroDataInicial) {
        doc.text(`Data Inicial: ${filtroDataInicial}`, 14, yPos);
        yPos += 5;
      }
      if (filtroDataFinal) {
        doc.text(`Data Final: ${filtroDataFinal}`, 14, yPos);
        yPos += 5;
      }
      if (filtroClientes.length > 0) {
        doc.text(
          `Filtro de Clientes Aplicado: ${filtroClientes.length} selecionados`,
          14,
          yPos,
        );
        yPos += 5;
      }
      if (filtroEstados.length > 0) {
        doc.text(`Estados Filtrados: ${filtroEstados.join(', ')}`, 14, yPos);
        yPos += 5;
      }

      // Preparar dados para a tabela
      const tableData = clientesAgrupados.map((cliente) => {
        const diasMax = (cliente.faturas || []).reduce((max, f) => {
          if (!f.dt_vencimento) return max;
          const diff = Math.floor(
            (new Date() - new Date(f.dt_vencimento)) / (1000 * 60 * 60 * 24),
          );
          return Math.max(max, diff);
        }, 0);

        return [
          cliente.cd_cliente || '-',
          cliente.nm_fantasia || '-',
          cliente.nm_cliente || '-',
          cliente.ds_uf || '-',
          formatarMoeda(cliente.valor_total),
          cliente.faturas.length.toString(),
          diasMax > 0 ? `${diasMax} dias` : '-',
        ];
      });

      // Criar a tabela
      autoTable(doc, {
        startY: yPos + 5,
        head: [
          [
            'Cód. Cliente',
            'Nome Fantasia',
            'Nome Cliente',
            'Estado',
            'Valor Total',
            'Nº Faturas',
            'Maior Atraso',
          ],
        ],
        body: tableData,
        styles: {
          fontSize: 8,
          cellPadding: 2,
        },
        headStyles: {
          fillColor: [0, 6, 56], // cor #000638
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center',
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 25 }, // Cód. Cliente
          1: { halign: 'left', cellWidth: 50 }, // Nome Fantasia
          2: { halign: 'left', cellWidth: 50 }, // Nome Cliente
          3: { halign: 'center', cellWidth: 20 }, // Estado
          4: { halign: 'right', cellWidth: 30 }, // Valor Total
          5: { halign: 'center', cellWidth: 25 }, // Nº Faturas
          6: { halign: 'center', cellWidth: 30 }, // Maior Atraso
        },
        alternateRowStyles: {
          fillColor: [245, 245, 245],
        },
        margin: { top: 10 },
      });

      // Adicionar rodapé com totalizadores
      const finalY =
        doc.lastAutoTable?.finalY || doc.previousAutoTable?.finalY || yPos + 10;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');

      doc.text('RESUMO GERAL:', 14, finalY + 10);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `Total de Clientes Inadimplentes: ${metricas.totalClientes}`,
        14,
        finalY + 16,
      );
      doc.text(
        `Valor Total em Aberto: ${formatarMoeda(metricas.valorTotal)}`,
        14,
        finalY + 22,
      );

      const totalFaturas = clientesAgrupados.reduce(
        (acc, c) => acc + c.faturas.length,
        0,
      );
      doc.text(`Total de Faturas: ${totalFaturas}`, 14, finalY + 28);

      // Salvar o PDF
      const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      const nomeArquivo = `inadimplentes-franquias-${hoje}.pdf`;
      doc.save(nomeArquivo);

      console.log('✅ PDF exportado com sucesso:', nomeArquivo);
    } catch (error) {
      console.error('❌ Erro ao exportar PDF:', error);
      alert('Erro ao exportar arquivo PDF. Tente novamente.');
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto py-6 px-4 space-y-6">
      <PageTitle
        title="Inadimplência Franquias"
        subtitle="Acompanhe os clientes inadimplentes das Franquias"
        icon={ChartBar}
        iconColor="text-purple-600"
      />
      <div className="bg-white p-6 rounded-lg shadow-sm border mb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchDados();
          }}
        >
          <div className="text-sm font-semibold text-[#000638] mb-2">
            Configurações para análise de Inadimplência - Franquias
          </div>
          <span className="text-xs text-gray-500 mt-1">
            Filtros para consulta de clientes inadimplentes
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3 mt-4">
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Inicial
              </label>
              <input
                type="date"
                value={filtroDataInicial}
                onChange={(e) => setFiltroDataInicial(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Final
              </label>
              <input
                type="date"
                value={filtroDataFinal}
                onChange={(e) => setFiltroDataFinal(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div className="col-span-1">
              <FiltroClientes
                clientes={clientesDisponiveis}
                selected={filtroClientes}
                onChange={setFiltroClientes}
              />
            </div>
            <div className="col-span-1">
              <FiltroEstados
                estados={estadosDisponiveis}
                selected={filtroEstados}
                onChange={setFiltroEstados}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={fetchDados}
              disabled={loading}
              className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase"
            >
              {loading ? (
                <div className="inline-flex items-center gap-2">
                  <CircleNotch size={16} className="animate-spin" />
                  <span>Carregando...</span>
                </div>
              ) : (
                'Buscar Dados'
              )}
            </button>
          </div>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-blue-600" />
              <CardTitle className="text-sm font-bold text-blue-700">
                Total de Clientes
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-blue-600 mb-0.5">
              {metricas.totalClientes}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Clientes inadimplentes
            </CardDescription>
          </CardContent>
        </Card>

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
            <div className="text-base font-extrabold text-green-600 mb-0.5">
              {formatarMoeda(metricas.valorTotal)}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Valor em aberto
            </CardDescription>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <ChartBar size={18} className="text-blue-600" />
              <CardTitle className="text-sm font-bold text-blue-700">
                TOP CLIENTES INADIMPLENTES
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <CardDescription className="text-xs text-gray-500 mb-3">
              Visão geral dos dados de inadimplência
            </CardDescription>
            <div className="h-64">
              <Bar
                data={graficoPrincipalData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: function (context) {
                          const idx = context.dataIndex;
                          const cliente = topClientes[idx];
                          const valor = context.dataset.data[idx] || 0;
                          const valorFmt = new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(valor);
                          const dias = cliente?.diasAtrasoMax ?? 0;
                          return `${valorFmt} — ${dias} dias em atraso`;
                        },
                      },
                    },
                  },
                  scales: { y: { beginAtZero: true } },
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <MapPin size={18} className="text-green-600" />
              <CardTitle className="text-sm font-bold text-green-700">
                Clientes por Estado
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <CardDescription className="text-xs text-gray-500 mb-3">
              Distribuição de inadimplentes por estado
            </CardDescription>
            <div className="h-64">
              <Bar
                data={graficoEstadoData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: false,
                    },
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                    },
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt size={18} className="text-purple-600" />
              <CardTitle className="text-sm font-bold text-purple-700">
                Lista de Clientes Inadimplentes
              </CardTitle>
            </div>
            {clientesAgrupados.length > 0 && (
              <button
                onClick={handleExportPDF}
                className="flex items-center gap-1 bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 transition-colors font-medium text-xs shadow-md"
              >
                <FileArrowDown size={14} />
                EXPORTAR PDF
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <CardDescription className="text-xs text-gray-500 mb-4">
            Detalhes completos dos clientes em situação de inadimplência
          </CardDescription>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="md" text="Carregando dados..." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                  <tr>
                    <th
                      className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => ordenarColuna('cd_cliente')}
                      title="Clique para ordenar"
                    >
                      <div className="flex items-center gap-1">
                        Código Cliente
                        {ordenarPor === 'cd_cliente' && (
                          <span>{direcaoOrdenacao === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => ordenarColuna('nm_cliente')}
                      title="Clique para ordenar"
                    >
                      <div className="flex items-center gap-1">
                        Nome Fantasia
                        {ordenarPor === 'nm_cliente' && (
                          <span>{direcaoOrdenacao === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-4 py-3">Nome Cliente</th>
                    <th
                      className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => ordenarColuna('ds_uf')}
                      title="Clique para ordenar"
                    >
                      <div className="flex items-center gap-1">
                        Estado
                        {ordenarPor === 'ds_uf' && (
                          <span>{direcaoOrdenacao === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => ordenarColuna('valor_total')}
                      title="Clique para ordenar"
                    >
                      <div className="flex items-center gap-1">
                        Valor Vencido
                        {ordenarPor === 'valor_total' && (
                          <span>{direcaoOrdenacao === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => ordenarColuna('valor_a_vencer')}
                      title="Clique para ordenar"
                    >
                      <div className="flex items-center gap-1">
                        A Vencer
                        {ordenarPor === 'valor_a_vencer' && (
                          <span>{direcaoOrdenacao === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => ordenarColuna('situacao')}
                      title="Clique para ordenar"
                    >
                      <div className="flex items-center gap-1">
                        Situação
                        {ordenarPor === 'situacao' && (
                          <span>{direcaoOrdenacao === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-4 py-3">Observações</th>
                    <th className="px-4 py-3">Contato</th>
                  </tr>
                </thead>
                <tbody>
                  {clientesAgrupados.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-8 text-center text-gray-500"
                      >
                        Nenhum cliente inadimplente encontrado
                      </td>
                    </tr>
                  ) : (
                    clientesAgrupados.map((cliente, index) => (
                      <tr
                        key={index}
                        className="bg-white border-b hover:bg-blue-50 cursor-pointer transition-colors"
                        onClick={() => abrirModal(cliente)}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {cliente.cd_cliente || 'N/A'}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {cliente.nm_fantasia || '---'}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {cliente.nm_cliente || 'N/A'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-1 rounded">
                            {cliente.ds_uf || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-red-600">
                          {formatarMoeda(cliente.valor_total)}
                        </td>
                        <td className="px-4 py-3 font-medium text-orange-600">
                          {formatarMoeda(cliente.valor_a_vencer)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-semibold px-2 py-1 rounded ${
                              cliente.situacao === 'INADIMPLENTE'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {cliente.situacao}
                          </span>
                        </td>
                        <td
                          className="px-4 py-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={(e) => abrirModalObservacoes(cliente, e)}
                            className="bg-[#000638] hover:bg-[#fe0000] text-white text-xs font-medium px-3 py-1 rounded transition-colors"
                          >
                            OBS
                          </button>
                        </td>
                        <td
                          className="px-4 py-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={(e) => abrirWhatsApp(cliente, e)}
                            className="bg-green-500 hover:bg-green-600 text-white text-xs font-medium px-3 py-1 rounded transition-colors flex items-center gap-1"
                            title="Abrir WhatsApp"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="w-4 h-4"
                            >
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {modalAberto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-6xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Detalhes das Faturas -{' '}
                {clienteSelecionado?.nm_fantasia ||
                  clienteSelecionado?.nm_cliente}
              </h3>
              <button
                onClick={fecharModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Tabela de Faturas Vencidas */}
            <div className="mb-6">
              <h4 className="text-md font-semibold text-red-600 mb-3 flex items-center gap-2">
                <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded">
                  VENCIDAS
                </span>
                Faturas em Atraso ({faturasSelecionadas.length})
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-gray-700 uppercase bg-red-50">
                    <tr>
                      <th className="px-4 py-3">Empresa</th>
                      <th className="px-4 py-3">Nº Fatura</th>
                      <th className="px-4 py-3">Emissão</th>
                      <th className="px-4 py-3">Vencimento</th>
                      <th className="px-4 py-3">Valor Fatura</th>
                      <th className="px-4 py-3">Juros</th>
                      <th className="px-4 py-3">Parcela</th>
                      <th className="px-4 py-3">Cobrança</th>
                      <th className="px-4 py-3">Portador</th>
                      <th className="px-4 py-3">Tempo Inadimplência</th>
                      <th className="px-4 py-3 text-center">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faturasSelecionadas.length === 0 ? (
                      <tr>
                        <td
                          colSpan={11}
                          className="px-4 py-4 text-center text-gray-500"
                        >
                          Nenhuma fatura vencida
                        </td>
                      </tr>
                    ) : (
                      faturasSelecionadas.map((fatura, index) => (
                        <tr
                          key={index}
                          className="bg-white border-b hover:bg-red-50 cursor-pointer"
                          onClick={() => abrirObsFatura(fatura)}
                        >
                          <td className="px-4 py-3">
                            {fatura.cd_empresa || 'N/A'}
                          </td>
                          <td className="px-4 py-3">
                            {fatura.nr_fat || fatura.nr_fatura || 'N/A'}
                          </td>
                          <td className="px-4 py-3">
                            {formatarData(fatura.dt_emissao)}
                          </td>
                          <td className="px-4 py-3">
                            {formatarData(fatura.dt_vencimento)}
                          </td>
                          <td className="px-4 py-3 font-medium text-red-600">
                            {formatarMoeda(fatura.vl_fatura)}
                          </td>
                          <td className="px-4 py-3 font-medium text-red-600">
                            {formatarMoeda(fatura.vl_juros)}
                          </td>
                          <td className="px-4 py-3">
                            {fatura.nr_parcela || 'N/A'}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {(() => {
                              const tc = getTipoCobranca(fatura.tp_cobranca);
                              return (
                                <span
                                  className={`${tc.color} px-1.5 py-0.5 rounded font-medium`}
                                >
                                  {tc.label}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium">
                              {fatura.nm_portador || fatura.cd_portador || '--'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded">
                              {calcularTempoInadimplencia(fatura.dt_vencimento)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                abrirModalBaixa(fatura);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-white bg-[#000638] hover:bg-[#fe0000] rounded-lg transition-colors"
                              title="Enviar para solicitação de baixa"
                            >
                              <PaperPlaneRight size={12} weight="bold" />
                              Baixa
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tabela de Faturas a Vencer */}
            <div className="mb-4">
              <h4 className="text-md font-semibold text-orange-600 mb-3 flex items-center gap-2">
                <span className="bg-orange-100 text-orange-800 text-xs font-medium px-2 py-1 rounded">
                  A VENCER
                </span>
                Faturas Futuras ({faturasAVencer.length})
              </h4>
              {loadingFaturasModal ? (
                <div className="flex items-center justify-center py-4">
                  <CircleNotch
                    size={24}
                    className="animate-spin text-orange-600"
                  />
                  <span className="ml-2 text-gray-500">
                    Carregando faturas a vencer...
                  </span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-gray-700 uppercase bg-orange-50">
                      <tr>
                        <th className="px-4 py-3">Empresa</th>
                        <th className="px-4 py-3">Nº Fatura</th>
                        <th className="px-4 py-3">Emissão</th>
                        <th className="px-4 py-3">Vencimento</th>
                        <th className="px-4 py-3">Valor Fatura</th>
                        <th className="px-4 py-3">Parcela</th>
                        <th className="px-4 py-3">Cobrança</th>
                        <th className="px-4 py-3">Portador</th>
                        <th className="px-4 py-3">Dias para Vencer</th>
                        <th className="px-4 py-3 text-center">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {faturasAVencer.length === 0 ? (
                        <tr>
                          <td
                            colSpan={10}
                            className="px-4 py-4 text-center text-gray-500"
                          >
                            Nenhuma fatura a vencer
                          </td>
                        </tr>
                      ) : (
                        faturasAVencer.map((fatura, index) => {
                          const diasParaVencer = Math.ceil(
                            (new Date(fatura.dt_vencimento) - new Date()) /
                              (1000 * 60 * 60 * 24),
                          );
                          return (
                            <tr
                              key={index}
                              className="bg-white border-b hover:bg-orange-50"
                            >
                              <td className="px-4 py-3">
                                {fatura.cd_empresa || 'N/A'}
                              </td>
                              <td className="px-4 py-3">
                                {fatura.nr_fat || fatura.nr_fatura || 'N/A'}
                              </td>
                              <td className="px-4 py-3">
                                {formatarData(fatura.dt_emissao)}
                              </td>
                              <td className="px-4 py-3">
                                {formatarData(fatura.dt_vencimento)}
                              </td>
                              <td className="px-4 py-3 font-medium text-orange-600">
                                {formatarMoeda(fatura.vl_fatura)}
                              </td>
                              <td className="px-4 py-3">
                                {fatura.nr_parcela || 'N/A'}
                              </td>
                              <td className="px-4 py-3 text-xs">
                                {(() => {
                                  const tc = getTipoCobranca(
                                    fatura.tp_cobranca,
                                  );
                                  return (
                                    <span
                                      className={`${tc.color} px-1.5 py-0.5 rounded font-medium`}
                                    >
                                      {tc.label}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-4 py-3 text-xs">
                                <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium">
                                  {fatura.nm_portador ||
                                    fatura.cd_portador ||
                                    '--'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="bg-orange-100 text-orange-800 text-xs font-medium px-2 py-1 rounded">
                                  {diasParaVencer === 0
                                    ? 'Hoje'
                                    : diasParaVencer === 1
                                      ? '1 dia'
                                      : `${diasParaVencer} dias`}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    abrirModalBaixa(fatura);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-white bg-[#000638] hover:bg-[#fe0000] rounded-lg transition-colors"
                                  title="Enviar para solicitação de baixa"
                                >
                                  <PaperPlaneRight size={12} weight="bold" />
                                  Baixa
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={fecharModal}
                className="px-4 py-2 bg-[#000638] text-white rounded hover:bg-[#fe0000] transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {obsModalAberto && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          style={{ zIndex: 99999 }}
        >
          <div className="bg-white rounded-lg p-6 max-w-3xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Observações da Fatura
              </h3>
              <button
                onClick={() => setObsModalAberto(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="mb-4">
              {obsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <LoadingSpinner size="sm" text="Carregando observações..." />
                </div>
              ) : obsFatura && obsFatura.length > 0 ? (
                <ul className="list-disc pl-5 space-y-2">
                  {obsFatura.map((o, idx) => (
                    <li key={idx} className="text-sm text-gray-700">
                      {o.ds_observacao}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-gray-500">
                  Nenhuma observação encontrada para esta fatura.
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setObsModalAberto(false)}
                className="px-4 py-2 bg-[#000638] text-white rounded hover:bg-[#fe0000] transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Observações */}
      {modalObservacoesAberto && clienteObservacoes && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-hidden mx-4 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <ChatCircleDots
                  size={24}
                  weight="bold"
                  className="text-[#000638]"
                />
                <h3 className="text-lg font-semibold text-gray-900">
                  Observações - {clienteObservacoes.nm_cliente}
                </h3>
              </div>
              <button
                onClick={fecharModalObservacoes}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Cliente: {clienteObservacoes.cd_cliente} | Valor:{' '}
              {formatarMoeda(clienteObservacoes.valor_total)}
            </p>

            {/* Área de chat com observações */}
            <div className="flex-1 overflow-y-auto bg-gray-50 rounded-lg p-4 mb-4 min-h-[300px] max-h-[400px]">
              {loadingObservacoes ? (
                <div className="flex justify-center items-center py-8">
                  <CircleNotch
                    size={32}
                    className="animate-spin text-[#000638]"
                  />
                </div>
              ) : observacoesList.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <ChatCircleDots
                    size={48}
                    className="mx-auto mb-2 opacity-50"
                  />
                  <p>Nenhuma observação registrada ainda</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {observacoesList.map((obs, index) => (
                    <div
                      key={index}
                      className="bg-white rounded-lg p-4 shadow-sm border border-gray-200"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <Users size={16} className="text-[#000638]" />
                          <span className="text-sm font-semibold text-[#000638]">
                            {obs.usuario}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">
                            {new Date(obs.data_criacao).toLocaleString(
                              'pt-BR',
                              {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              },
                            )}
                          </span>
                          {podeExcluirObservacao(obs) && (
                            <button
                              onClick={() => excluirObservacao(obs.id)}
                              className="text-red-500 hover:text-red-700 transition-colors"
                              title="Excluir observação (disponível por 2 minutos)"
                            >
                              <Trash size={16} weight="bold" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">
                        {obs.observacao}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Campo para adicionar nova observação */}
            <div className="border-t pt-4">
              <div className="flex flex-col justbetween mb-4">
                <textarea
                  value={novaObservacao}
                  onChange={(e) => setNovaObservacao(e.target.value)}
                  placeholder="Digite sua observação..."
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#000638] resize-none"
                  rows={3}
                />
                <div>
                  <button
                    onClick={adicionarObservacao}
                    disabled={!novaObservacao.trim() || loadingObservacoes}
                    className="bg-[#000638] hover:bg-[#fe0000] text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-end mt-2"
                  >
                    Enviar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Solicitação de Baixa */}
      {modalBaixaAberto && faturaBaixa && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[#000638] text-white p-4 rounded-t-xl flex justify-between items-center">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <PaperPlaneRight size={20} weight="bold" />
                Solicitação de Baixa
              </h3>
              <button
                onClick={fecharModalBaixa}
                className="text-white hover:text-red-300 transition-colors"
              >
                <X size={22} weight="bold" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Dados da fatura */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Cliente:</span>
                  <span className="font-semibold">
                    {clienteSelecionado?.nm_cliente ||
                      faturaBaixa.nm_cliente ||
                      'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Fatura:</span>
                  <span className="font-semibold">
                    {faturaBaixa.nr_fat || faturaBaixa.nr_fatura}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Parcela:</span>
                  <span className="font-semibold">
                    {faturaBaixa.nr_parcela || 1}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Valor:</span>
                  <span className="font-bold text-red-600">
                    {formatarMoeda(faturaBaixa.vl_fatura)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Vencimento:</span>
                  <span className="font-semibold">
                    {formatarData(faturaBaixa.dt_vencimento)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Portador:</span>
                  <span className="font-semibold">
                    <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-xs">
                      {faturaBaixa.nm_portador ||
                        faturaBaixa.cd_portador ||
                        '--'}
                    </span>
                  </span>
                </div>
              </div>

              {/* Data de Pagamento */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  Data de Pagamento *
                </label>
                <input
                  type="date"
                  value={dataPagamentoBaixa}
                  onChange={(e) => setDataPagamentoBaixa(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638] focus:border-transparent"
                  max={new Date().toISOString().split('T')[0]}
                  required
                />
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Data que consta no comprovante de pagamento
                </p>
              </div>

              {/* Forma de Pagamento */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  Forma de Pagamento *
                </label>
                <select
                  value={formaPagamentoBaixa}
                  onChange={(e) => {
                    setFormaPagamentoBaixa(e.target.value);
                    setDadosCartaoBaixa({
                      bandeira: '',
                      autorizacao: '',
                      nsu: '',
                    });
                  }}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638] focus:border-transparent"
                  required
                >
                  <option value="">Selecione...</option>
                  {FORMAS_PAGAMENTO.map((fp) => (
                    <option key={fp.id} value={fp.id}>
                      {fp.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dados do cartão (se cartão de crédito ou débito) */}
              {(formaPagamentoBaixa === 'cartao_credito' ||
                formaPagamentoBaixa === 'cartao_debito') && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-bold text-yellow-800">
                    Dados do Cartão
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-0.5">
                      Bandeira *
                    </label>
                    <input
                      type="text"
                      value={dadosCartaoBaixa.bandeira}
                      onChange={(e) =>
                        setDadosCartaoBaixa((prev) => ({
                          ...prev,
                          bandeira: e.target.value,
                        }))
                      }
                      placeholder="Ex: Visa, Mastercard, Elo..."
                      className="w-full border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#000638]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-0.5">
                        Nº Autorização *
                      </label>
                      <input
                        type="text"
                        value={dadosCartaoBaixa.autorizacao}
                        onChange={(e) =>
                          setDadosCartaoBaixa((prev) => ({
                            ...prev,
                            autorizacao: e.target.value,
                          }))
                        }
                        placeholder="Nº autorização"
                        className="w-full border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#000638]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-0.5">
                        NSU *
                      </label>
                      <input
                        type="text"
                        value={dadosCartaoBaixa.nsu}
                        onChange={(e) =>
                          setDadosCartaoBaixa((prev) => ({
                            ...prev,
                            nsu: e.target.value,
                          }))
                        }
                        placeholder="NSU"
                        className="w-full border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#000638]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Upload do comprovante */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  Comprovante de Pagamento *
                </label>
                <div
                  className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-[#000638] transition-colors"
                  onClick={() =>
                    document
                      .getElementById('comprovante-input-franquias')
                      .click()
                  }
                >
                  {previewComprovante ? (
                    <div className="space-y-2">
                      {comprovanteBaixa?.type?.startsWith('image/') ? (
                        <img
                          src={previewComprovante}
                          alt="Preview"
                          className="max-h-40 mx-auto rounded-lg"
                        />
                      ) : (
                        <div className="flex items-center justify-center gap-2 text-[#000638]">
                          <FileText size={32} />
                          <span className="font-medium">
                            {comprovanteBaixa?.name}
                          </span>
                        </div>
                      )}
                      <p className="text-xs text-gray-500">
                        Clique para trocar o arquivo
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 text-gray-400">
                      <UploadSimple size={32} className="mx-auto" />
                      <p className="text-sm">
                        Clique para anexar o comprovante
                      </p>
                      <p className="text-xs">Imagens (JPG, PNG) ou PDF</p>
                    </div>
                  )}
                </div>
                <input
                  id="comprovante-input-franquias"
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={handleComprovanteChange}
                />
              </div>

              {/* Observação */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  Observação (opcional)
                </label>
                <textarea
                  value={observacaoBaixa}
                  onChange={(e) => setObservacaoBaixa(e.target.value)}
                  placeholder="Ex: Pagamento via PIX em 20/02..."
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638] focus:border-transparent"
                  rows={3}
                />
              </div>

              {/* Botões */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={fecharModalBaixa}
                  className="px-4 py-2 text-sm font-bold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleEnviarBaixa}
                  disabled={
                    loadingBaixa ||
                    !comprovanteBaixa ||
                    !dataPagamentoBaixa ||
                    !formaPagamentoBaixa ||
                    ((formaPagamentoBaixa === 'cartao_credito' ||
                      formaPagamentoBaixa === 'cartao_debito') &&
                      (!dadosCartaoBaixa.bandeira ||
                        !dadosCartaoBaixa.autorizacao ||
                        !dadosCartaoBaixa.nsu))
                  }
                  className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-[#000638] rounded-lg hover:bg-[#fe0000] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingBaixa ? (
                    <>
                      <Spinner size={16} className="animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <PaperPlaneRight size={16} weight="bold" />
                      Enviar Solicitação
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notificação */}
      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}
    </div>
  );
};

export default InadimplentesFranquias;
