import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import FiltroEstados from '../components/filters/FiltroEstados';
import FiltroClientes from '../components/filters/FiltroClientes';
import FiltroRepresentantes from '../components/filters/FiltroRepresentantes';
import useApiClient from '../hooks/useApiClient';
import { useAuth } from '../components/AuthContext';
import useClassificacoesInadimplentes from '../hooks/useClassificacoesInadimplentes';
import { supabase, supabaseAdmin } from '../lib/supabase';
import PageTitle from '../components/ui/PageTitle';
import { TotvsURL } from '../config/constants';
import Notification from '../components/ui/Notification';
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
  Filler,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar, Pie, Line } from 'react-chartjs-2';
import {
  ChartBar,
  CalendarBlank,
  MagnifyingGlass,
  ArrowClockwise,
  CircleNotch,
  Users,
  CurrencyDollar,
  MapPin,
  Receipt,
  Clock,
  Warning,
  Handshake,
  ChatCircleDots,
  FileText,
  Gavel,
  TrendUp,
  ArrowUp,
  ArrowDown,
  ChartLineUp,
  ListBullets,
  Smiley,
  ClockClockwise,
  CheckCircle,
  Trash,
  UploadSimple,
  PaperclipHorizontal,
  PaperPlaneRight,
  Image,
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
  PointElement,
  LineElement,
  Filler,
  ChartDataLabels,
);

const InadimplentesMultimarcas = () => {
  const apiClient = useApiClient();
  const { user } = useAuth();
  const {
    salvarClassificacao,
    buscarClassificacoes,
    deletarClassificacao,
    buscarHistorico,
    salvarObservacao,
    buscarObservacoes,
    deletarObservacao,
  } = useClassificacoesInadimplentes();

  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  // Datas padrão: início em 01-04-2024 e fim no dia atual
  const [filtroDataInicial, setFiltroDataInicial] = useState('2024-04-01');
  const hojeStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const [filtroDataFinal, setFiltroDataFinal] = useState(hojeStr);
  const [filtroClientes, setFiltroClientes] = useState([]); // array de cd_cliente selecionados
  const [filtroEstados, setFiltroEstados] = useState([]); // array de siglas selecionadas
  const [filtroRepresentantes, setFiltroRepresentantes] = useState([]); // array de representantes selecionados

  // Estado para o modal de detalhes do cliente
  const [modalAberto, setModalAberto] = useState(false);
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [faturasSelecionadas, setFaturasSelecionadas] = useState([]);
  const [faturasAVencer, setFaturasAVencer] = useState([]);
  const [loadingFaturasModal, setLoadingFaturasModal] = useState(false);

  // Estado para o modal de lista de clientes filtrados
  const [modalListaAberto, setModalListaAberto] = useState(false);
  const [tituloModalLista, setTituloModalLista] = useState('');
  const [clientesFiltradosModal, setClientesFiltradosModal] = useState([]);

  // Estado para o modal de histórico
  const [modalHistoricoAberto, setModalHistoricoAberto] = useState(false);
  const [historicoSelecionado, setHistoricoSelecionado] = useState([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);

  // Estado para Feeling e Status de cada cliente (valores salvos)
  const [clienteFeeling, setClienteFeeling] = useState({}); // { cd_cliente: 'POSSÍVEL PAGAMENTO' | 'ATRASO' }
  const [clienteStatus, setClienteStatus] = useState({}); // { cd_cliente: 'ACORDO' | 'ACORDO EM ANDAMENTO' | 'COBRANÇA' | 'PROTESTADO' }
  const [clienteRepresentante, setClienteRepresentante] = useState({}); // { cd_cliente: 'Nome do Representante' }

  // Estados para controle de edição
  const [editandoFeeling, setEditandoFeeling] = useState(null); // cd_cliente em edição
  const [editandoStatus, setEditandoStatus] = useState(null); // cd_cliente em edição
  const [editandoRepresentante, setEditandoRepresentante] = useState(null); // cd_cliente em edição
  const [tempFeeling, setTempFeeling] = useState(''); // valor temporário do select
  const [tempStatus, setTempStatus] = useState(''); // valor temporário do select
  const [tempRepresentante, setTempRepresentante] = useState(''); // valor temporário do input

  // Estados para modal de observações
  const [modalObservacoesAberto, setModalObservacoesAberto] = useState(false);
  const [clienteObservacoes, setClienteObservacoes] = useState(null); // cliente selecionado para observações
  const [observacoesList, setObservacoesList] = useState([]); // lista de observações do cliente
  const [novaObservacao, setNovaObservacao] = useState(''); // texto da nova observação
  const [loadingObservacoes, setLoadingObservacoes] = useState(false);

  // Estados para controle de ordenação
  const [ordenarPor, setOrdenarPor] = useState(null); // coluna atual de ordenação
  const [direcaoOrdenacao, setDirecaoOrdenacao] = useState('asc'); // 'asc' ou 'desc'

  // Estado para valores a vencer (agrupados por cliente)
  const [valoresAVencer, setValoresAVencer] = useState({});

  // Estados para modal de solicitação de baixa
  const [modalBaixaAberto, setModalBaixaAberto] = useState(false);
  const [faturaBaixa, setFaturaBaixa] = useState(null);
  const [comprovanteBaixa, setComprovanteBaixa] = useState(null);
  const [previewComprovante, setPreviewComprovante] = useState(null);
  const [observacaoBaixa, setObservacaoBaixa] = useState('');
  const [loadingBaixa, setLoadingBaixa] = useState(false);

  // Estado para alternar entre LISTA e DASHBOARD
  const [viewMode, setViewMode] = useState('lista');

  // Estados para timeline (evolução)
  const [timeline, setTimeline] = useState([]);
  const [timelineRep, setTimelineRep] = useState([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  // Helper para parsear datas sem fuso
  const parseDateNoTZ = (isoDate) => {
    if (!isoDate) return null;
    try {
      const str = String(isoDate).substring(0, 10);
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
    } catch {
      return null;
    }
  };

  const formatCurrency = (value) =>
    (value || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });

  // ======================== TIMELINE SUPABASE ========================
  const carregarTimeline = useCallback(async () => {
    setLoadingTimeline(true);
    try {
      const [resPrincipal, resRep] = await Promise.all([
        supabase
          .from('inadimplencia_mtm_timeline')
          .select(
            'data, valor_total, qtd_clientes, qtd_titulos, valor_atrasados, valor_inadimplentes',
          )
          .order('data', { ascending: true }),
        supabase
          .from('inadimplencia_mtm_representantes_timeline')
          .select('data, representante, valor_total, qtd_clientes')
          .order('data', { ascending: true }),
      ]);
      if (resPrincipal.error) throw resPrincipal.error;
      if (resRep.error) throw resRep.error;
      setTimeline(resPrincipal.data || []);
      setTimelineRep(resRep.data || []);
    } catch (err) {
      console.error('Erro ao carregar timeline MTM:', err);
    } finally {
      setLoadingTimeline(false);
    }
  }, []);

  const salvarTimelineHoje = useCallback(
    async (
      valorTotal,
      qtdClientes,
      qtdTitulos,
      representantes = [],
      valorAtrasados = 0,
      valorInadimplentes = 0,
    ) => {
      try {
        const hoje = new Date().toISOString().split('T')[0];

        // Salvar snapshot principal
        const { error: errPrincipal } = await supabase
          .from('inadimplencia_mtm_timeline')
          .upsert(
            {
              data: hoje,
              valor_total: valorTotal,
              qtd_clientes: qtdClientes,
              qtd_titulos: qtdTitulos,
              valor_atrasados: valorAtrasados,
              valor_inadimplentes: valorInadimplentes,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'data' },
          );
        if (errPrincipal) throw errPrincipal;

        // Salvar snapshot por representante
        if (representantes.length > 0) {
          const registros = representantes.map((rep) => ({
            data: hoje,
            representante: rep.representante,
            valor_total: rep.valorTotal,
            qtd_clientes: rep.qtdClientes,
            updated_at: new Date().toISOString(),
          }));
          const { error: errRep } = await supabase
            .from('inadimplencia_mtm_representantes_timeline')
            .upsert(registros, { onConflict: 'data,representante' });
          if (errRep) throw errRep;
        }

        console.log('✅ Timeline MTM salva para', hoje);
        await carregarTimeline();
      } catch (err) {
        console.error('Erro ao salvar timeline MTM:', err);
      }
    },
    [carregarTimeline],
  );

  // Carregar timeline ao montar
  useEffect(() => {
    carregarTimeline();
  }, [carregarTimeline]);

  // Função para ordenar colunas
  const ordenarColuna = (coluna) => {
    if (ordenarPor === coluna) {
      // Se já está ordenando por esta coluna, inverte a direção
      setDirecaoOrdenacao(direcaoOrdenacao === 'asc' ? 'desc' : 'asc');
    } else {
      // Nova coluna, começa com ascendente
      setOrdenarPor(coluna);
      setDirecaoOrdenacao('asc');
    }
  };

  // Handlers para iniciar edição
  const iniciarEdicaoFeeling = (cdCliente, e) => {
    e.stopPropagation();
    setEditandoFeeling(cdCliente);
    setTempFeeling(clienteFeeling[cdCliente] || '');
  };

  const iniciarEdicaoStatus = (cdCliente, e) => {
    e.stopPropagation();
    setEditandoStatus(cdCliente);
    setTempStatus(clienteStatus[cdCliente] || '');
  };

  // Handlers para salvar
  const salvarFeeling = async (cdCliente, e) => {
    e.stopPropagation();
    if (!tempFeeling) return;

    // Atualizar estado local
    setClienteFeeling((prev) => ({
      ...prev,
      [cdCliente]: tempFeeling,
    }));
    setEditandoFeeling(null);
    setTempFeeling('');

    // SALVAR NO SUPABASE
    const cliente = clientesAgrupados.find((c) => c.cd_cliente === cdCliente);

    if (cliente && user) {
      const classificacao = {
        cd_cliente: cliente.cd_cliente,
        nm_cliente: cliente.nm_cliente,
        valor_total: cliente.valor_total,
        ds_siglaest: cliente.ds_uf?.trim() || null,
        situacao: cliente.situacao,
        feeling: tempFeeling,
        status: clienteStatus[cdCliente] || null,
        usuario: user.email || user.id,
      };

      const { success, error } = await salvarClassificacao(classificacao);

      if (success) {
        setNotification({
          type: 'success',
          message: 'Feeling salvo com sucesso!',
        });
        setTimeout(() => setNotification(null), 3000);
      } else {
        setNotification({
          type: 'error',
          message: `Erro ao salvar: ${error}`,
        });
      }
    }
  };

  const salvarStatus = async (cdCliente, e) => {
    e.stopPropagation();
    if (!tempStatus) return;

    // Atualizar estado local
    setClienteStatus((prev) => ({
      ...prev,
      [cdCliente]: tempStatus,
    }));
    setEditandoStatus(null);
    setTempStatus('');

    // SALVAR NO SUPABASE
    const cliente = clientesAgrupados.find((c) => c.cd_cliente === cdCliente);

    if (cliente && user) {
      const classificacao = {
        cd_cliente: cliente.cd_cliente,
        nm_cliente: cliente.nm_cliente,
        valor_total: cliente.valor_total,
        ds_siglaest: cliente.ds_uf?.trim() || null,
        situacao: cliente.situacao,
        feeling: clienteFeeling[cdCliente] || null,
        status: tempStatus,
        usuario: user.email || user.id,
      };

      const { success, error } = await salvarClassificacao(classificacao);

      if (success) {
        setNotification({
          type: 'success',
          message: 'Status salvo com sucesso!',
        });
        setTimeout(() => setNotification(null), 3000);
      } else {
        setNotification({
          type: 'error',
          message: `Erro ao salvar: ${error}`,
        });
      }
    }
  };

  // Handlers para cancelar
  const cancelarEdicaoFeeling = (e) => {
    e.stopPropagation();
    setEditandoFeeling(null);
    setTempFeeling('');
  };

  const cancelarEdicaoStatus = (e) => {
    e.stopPropagation();
    setEditandoStatus(null);
    setTempStatus('');
  };

  const cancelarEdicaoRepresentante = (e) => {
    e.stopPropagation();
    setEditandoRepresentante(null);
    setTempRepresentante('');
  };

  // Handler para iniciar edição do representante
  const iniciarEdicaoRepresentante = (cdCliente, e) => {
    e.stopPropagation();
    setEditandoRepresentante(cdCliente);
    setTempRepresentante(clienteRepresentante[cdCliente] || '');
  };

  // Handler para salvar representante
  const salvarRepresentante = async (cdCliente, e) => {
    e.stopPropagation();
    if (!tempRepresentante) return;

    // Atualizar estado local
    setClienteRepresentante((prev) => ({
      ...prev,
      [cdCliente]: tempRepresentante,
    }));
    setEditandoRepresentante(null);
    setTempRepresentante('');

    // SALVAR NO SUPABASE
    const cliente = clientesAgrupados.find((c) => c.cd_cliente === cdCliente);

    if (cliente && user) {
      const classificacao = {
        cd_cliente: cliente.cd_cliente,
        nm_cliente: cliente.nm_cliente,
        valor_total: cliente.valor_total,
        ds_siglaest: cliente.ds_uf?.trim() || null,
        situacao: cliente.situacao,
        feeling: clienteFeeling[cdCliente] || null,
        status: clienteStatus[cdCliente] || null,
        representante: tempRepresentante,
        usuario: user.email || user.id,
      };

      const { success, error } = await salvarClassificacao(classificacao);

      if (success) {
        setNotification({
          type: 'success',
          message: 'Representante salvo com sucesso!',
        });
        setTimeout(() => setNotification(null), 3000);
      } else {
        setNotification({
          type: 'error',
          message: `Erro ao salvar: ${error}`,
        });
      }
    }
  };

  // Handler para abrir modal de observações
  const abrirModalObservacoes = async (cliente, e) => {
    e.stopPropagation();
    setClienteObservacoes(cliente);
    setModalObservacoesAberto(true);
    setLoadingObservacoes(true);

    // Buscar observações do cliente
    const { success, data } = await buscarObservacoes(cliente.cd_cliente);
    if (success) {
      setObservacoesList(data || []);
    } else {
      setObservacoesList([]);
    }
    setLoadingObservacoes(false);
  };

  // Handler para fechar modal de observações
  const fecharModalObservacoes = () => {
    setModalObservacoesAberto(false);
    setClienteObservacoes(null);
    setObservacoesList([]);
    setNovaObservacao('');
  };

  // Handler para adicionar nova observação
  const adicionarObservacao = async () => {
    if (!novaObservacao.trim() || !clienteObservacoes) return;

    setLoadingObservacoes(true);

    const observacao = {
      cd_cliente: clienteObservacoes.cd_cliente,
      nm_cliente: clienteObservacoes.nm_cliente,
      observacao: novaObservacao.trim(),
      usuario: user?.email || user?.id || 'Usuário',
    };

    const { success, data } = await salvarObservacao(observacao);

    if (success) {
      // Adicionar nova observação no final da lista (ordem de envio)
      setObservacoesList((prev) => [...prev, data[0]]);
      setNovaObservacao('');
      setNotification({
        type: 'success',
        message: 'Observação adicionada com sucesso!',
      });
      setTimeout(() => setNotification(null), 3000);
    } else {
      setNotification({
        type: 'error',
        message: 'Erro ao adicionar observação',
      });
    }

    setLoadingObservacoes(false);
  };

  // Handler para excluir observação
  const excluirObservacao = async (idObservacao) => {
    if (!confirm('Tem certeza que deseja excluir esta observação?')) return;

    setLoadingObservacoes(true);

    try {
      const { success } = await deletarObservacao(idObservacao);

      if (success) {
        // Remover a observação da lista
        setObservacoesList((prev) =>
          prev.filter((obs) => obs.id !== idObservacao),
        );
        setNotification({
          type: 'success',
          message: 'Observação excluída com sucesso!',
        });
        setTimeout(() => setNotification(null), 3000);
      } else {
        setNotification({
          type: 'error',
          message: 'Erro ao excluir observação',
        });
      }
    } catch (error) {
      console.error('Erro ao excluir observação:', error);
      setNotification({
        type: 'error',
        message: 'Erro ao excluir observação',
      });
    } finally {
      setLoadingObservacoes(false);
    }
  };

  // Verificar se o usuário pode excluir a observação (120 segundos)
  const podeExcluirObservacao = (observacao) => {
    if (!user) return false;
    if (observacao.usuario !== user.email && observacao.usuario !== user.id)
      return false;

    const dataObservacao = new Date(observacao.data_criacao);
    const agora = new Date();
    const diferencaSegundos = (agora - dataObservacao) / 1000;

    return diferencaSegundos <= 120; // 120 segundos = 2 minutos
  };

  // Handler para abrir WhatsApp do cliente (usa nr_telefone já enriquecido via TOTVS)
  const abrirWhatsApp = (cliente, e) => {
    e.stopPropagation();

    const telefone = cliente.nr_telefone || '';

    if (!telefone) {
      setNotification({
        type: 'error',
        message: 'Telefone não encontrado para este cliente',
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    // Limpar telefone (remover caracteres especiais)
    const telefoneClean = telefone.replace(/\D/g, '');

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
    const mensagemPadrao = `Olá, tudo bem? *${cliente.nm_cliente}*
Somos da área de Recuperação de Créditos da Crosby.
Consta em nosso sistema a existência de pendências financeiras em aberto em seu cadastro.
Entramos em contato para alinhar e verificar a melhor forma de regularização.

Segue a lista dos títulos em aberto:

${listaFaturas}

*Observação:* Caso os pagamentos já tenham sido realizados, pedimos gentilmente que desconsidere esta mensagem e nos envie o comprovante para atualização em nosso sistema.

Atenciosamente,
Crosby`;

    // Codificar a mensagem para URL
    const mensagemCodificada = encodeURIComponent(mensagemPadrao);

    // Abrir WhatsApp com mensagem pré-definida
    const whatsappUrl = `https://wa.me/55${telefoneClean}?text=${mensagemCodificada}`;
    window.open(whatsappUrl, '_blank');
  };

  // Funções para determinar classes CSS dos badges
  const getFeelingBadgeClass = (feeling) => {
    switch (feeling) {
      case 'POSSÍVEL PAGAMENTO':
        return 'bg-green-100 text-green-800';
      case 'ATRASO':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'ACORDO':
        return 'bg-blue-100 text-blue-800';
      case 'ACORDO EM ANDAMENTO':
        return 'bg-cyan-100 text-cyan-800';
      case 'COBRANÇA':
        return 'bg-purple-100 text-purple-800';
      case 'PROTESTADO':
        return 'bg-red-100 text-red-800';
      case 'PAGO PENDENTE DE BAIXA':
        return 'bg-green-100 text-green-800';
      case 'LOJA FECHADA (Tentando ACORDO)':
        return 'bg-orange-100 text-orange-800';
      case 'ACORDO CONCLUÍDO':
        return 'bg-emerald-100 text-emerald-800';
      case 'NOTIFICAÇÃO JURÍDICA':
        return 'bg-yellow-100 text-yellow-800';
      case 'EM AÇÃO JUDICIAL':
        return 'bg-red-200 text-red-900';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  // Funções para abrir modal de lista com filtros específicos
  const abrirModalLista = (titulo, clientesFiltrados) => {
    setTituloModalLista(titulo);
    setClientesFiltradosModal(clientesFiltrados);
    setModalListaAberto(true);
  };

  const fecharModalLista = () => {
    setModalListaAberto(false);
    setClientesFiltradosModal([]);
    setTituloModalLista('');
  };

  // Handlers para abrir modal por situação
  const abrirModalAtrasados = () => {
    const clientes = clientesAgrupados.filter((c) => c.situacao === 'ATRASADO');
    abrirModalLista('Clientes Atrasados (até 31 dias)', clientes);
  };

  const abrirModalInadimplentes = () => {
    const clientes = clientesAgrupados.filter(
      (c) => c.situacao === 'INADIMPLENTE',
    );
    abrirModalLista('Clientes Inadimplentes (acima de 31 dias)', clientes);
  };

  // Handlers para abrir modal por feeling
  const abrirModalFeelingAtraso = () => {
    const clientes = clientesAgrupados.filter(
      (c) => clienteFeeling[c.cd_cliente] === 'ATRASO',
    );
    abrirModalLista('Clientes com Feeling: Atraso', clientes);
  };

  const abrirModalFeelingPossivelPagamento = () => {
    const clientes = clientesAgrupados.filter(
      (c) => clienteFeeling[c.cd_cliente] === 'POSSÍVEL PAGAMENTO',
    );
    abrirModalLista('Clientes com Feeling: Possível Pagamento', clientes);
  };

  // Handlers para abrir modal por status
  const abrirModalStatusAcordo = () => {
    const clientes = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'ACORDO',
    );
    abrirModalLista('Clientes com Status: Acordo', clientes);
  };

  const abrirModalStatusAcordoAndamento = () => {
    const clientes = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'ACORDO EM ANDAMENTO',
    );
    abrirModalLista('Clientes com Status: Acordo em Andamento', clientes);
  };

  const abrirModalStatusCobranca = () => {
    const clientes = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'COBRANÇA',
    );
    abrirModalLista('Clientes com Status: Cobrança', clientes);
  };

  const abrirModalStatusProtestado = () => {
    const clientes = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'PROTESTADO',
    );
    abrirModalLista('Clientes com Status: Protestado', clientes);
  };

  // Handlers para os novos status
  const abrirModalStatusPagoPendente = () => {
    const clientes = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'PAGO PENDENTE DE BAIXA',
    );
    abrirModalLista('Clientes com Status: Pago Pendente de Baixa', clientes);
  };

  const abrirModalStatusLojaFechada = () => {
    const clientes = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'LOJA FECHADA (Tentando ACORDO)',
    );
    abrirModalLista(
      'Clientes com Status: Loja Fechada (Tentando Acordo)',
      clientes,
    );
  };

  const abrirModalStatusAcordoConcluido = () => {
    const clientes = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'ACORDO CONCLUÍDO',
    );
    abrirModalLista('Clientes com Status: Acordo Concluído', clientes);
  };

  const abrirModalStatusNotificacaoJuridica = () => {
    const clientes = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'NOTIFICAÇÃO JURÍDICA',
    );
    abrirModalLista('Clientes com Status: Notificação Jurídica', clientes);
  };

  const abrirModalStatusAcaoJudicial = () => {
    const clientes = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'EM AÇÃO JUDICIAL',
    );
    abrirModalLista('Clientes com Status: Em Ação Judicial', clientes);
  };

  // Handlers para matriz cruzada (Situação x Status)
  const abrirModalMatriz = (titulo, clientes) => {
    abrirModalLista(titulo, clientes);
  };

  // Buscar dados da API via TOTVS
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
      // PASSO 1: Buscar códigos dos clientes MULTIMARCAS (classificação TOTVS)
      // ============================================================
      console.log('🔍 Buscando clientes MULTIMARCAS...');
      const respMultimarcas = await fetch(`${TotvsURL}multibrand-clients`);
      if (!respMultimarcas.ok) {
        const errData = await respMultimarcas.json().catch(() => ({}));
        throw new Error(
          errData.message ||
            `Erro ao buscar multimarcas: HTTP ${respMultimarcas.status}`,
        );
      }
      const resultMultimarcas = await respMultimarcas.json();
      const multimarcas = resultMultimarcas.data || [];

      if (multimarcas.length === 0) {
        console.warn('⚠️ Nenhum cliente multimarcas encontrado.');
        setDados([]);
        setValoresAVencer({});
        return;
      }

      // Montar mapa de multimarcas para enriquecer depois (nome, fantasia)
      const multimarcasMap = {};
      multimarcas.forEach((m) => {
        multimarcasMap[String(m.code)] = m;
      });

      // Códigos separados por vírgula para query param
      const codigosMultimarcas = multimarcas.map((m) => m.code).join(',');
      console.log(`📋 ${multimarcas.length} clientes multimarcas encontrados`);

      // ============================================================
      // PASSO 2: Buscar contas a receber APENAS dos clientes multimarcas
      // ============================================================
      const paramsVencidas = new URLSearchParams({
        dt_inicio: dataIni,
        dt_fim: dataFim,
        modo: 'vencimento',
        situacao: '1',
        status: 'Vencido',
        cd_cliente: codigosMultimarcas,
      });

      const paramsAVencer = new URLSearchParams({
        dt_inicio: amanhaStr,
        dt_fim: umAnoFrenteStr,
        modo: 'vencimento',
        situacao: '1',
        status: 'Em Aberto',
        cd_cliente: codigosMultimarcas,
      });

      console.log(
        '🔍 Buscando inadimplentes (apenas multimarcas) via TOTVS...',
      );

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
        `📊 Faturas multimarcas — vencidas: ${faturasVencidas.length}, A vencer: ${faturasAVencerTodas.length}`,
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

      // Enriquecer faturas vencidas com dados de pessoa + dados do cache de multimarcas
      const dadosEnriquecidos = vencidasFiltradas.map((item) => {
        const pessoa = pessoasMap[String(item.cd_cliente)] || {};
        const multimarca = multimarcasMap[String(item.cd_cliente)] || {};
        return {
          ...item,
          nm_cliente:
            pessoa.name ||
            multimarca.name ||
            item.nm_cliente ||
            item.nr_cpfcnpj ||
            `Cliente ${item.cd_cliente}`,
          nm_fantasia:
            pessoa.fantasyName ||
            multimarca.fantasyName ||
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
        '📊 Dados inadimplentes multimarcas via TOTVS:',
        dadosEnriquecidos.length,
      );
      setDados(dadosEnriquecidos);

      // CARREGAR CLASSIFICAÇÕES DO SUPABASE
      if (dadosEnriquecidos.length > 0) {
        const { success, data: classificacoesSalvas } =
          await buscarClassificacoes();

        if (success && classificacoesSalvas) {
          const feelingMap = {};
          const statusMap = {};
          const representanteMap = {};

          classificacoesSalvas.forEach((c) => {
            if (c.feeling) {
              feelingMap[c.cd_cliente] = c.feeling;
            }
            if (c.status) {
              statusMap[c.cd_cliente] = c.status;
            }
            if (c.representante) {
              representanteMap[c.cd_cliente] = c.representante;
            }
          });

          setClienteFeeling(feelingMap);
          setClienteStatus(statusMap);
          setClienteRepresentante(representanteMap);
          console.log('✅ Classificações carregadas do Supabase:', {
            feeling: Object.keys(feelingMap).length,
            status: Object.keys(statusMap).length,
            representante: Object.keys(representanteMap).length,
          });
        }
      }
    } catch (error) {
      console.error('❌ Erro ao buscar dados de inadimplentes:', error);
      setDados([]);
      setNotification({
        type: 'error',
        message: `Erro ao carregar dados: ${error.message}`,
      });
    } finally {
      setLoading(false);
    }
  };

  // Carregar dados iniciais
  useEffect(() => {
    fetchDados();
  }, []);

  // Dados filtrados (tipo documento e vencimento já filtrados no backend)
  const dadosFiltrados = useMemo(() => {
    return dados.filter((item) => {
      const matchCliente =
        filtroClientes.length === 0 ||
        filtroClientes.includes(String(item.cd_cliente));
      const uf = item.ds_uf?.trim() || '';
      const matchEstado =
        filtroEstados.length === 0 || filtroEstados.includes(uf);
      const rep = clienteRepresentante[item.cd_cliente] || '';
      const matchRepresentante =
        filtroRepresentantes.length === 0 || filtroRepresentantes.includes(rep);
      return matchCliente && matchEstado && matchRepresentante;
    });
  }, [
    dados,
    filtroClientes,
    filtroEstados,
    filtroRepresentantes,
    clienteRepresentante,
  ]);

  // Lista de estados disponíveis para o select
  const estadosDisponiveis = useMemo(() => {
    const setEstados = new Set();
    dados.forEach((d) => {
      if (d.ds_uf) setEstados.add(d.ds_uf.trim());
    });
    return Array.from(setEstados).filter(Boolean).sort();
  }, [dados]);

  // Lista de clientes disponíveis (únicos por cd_cliente)
  const clientesDisponiveis = useMemo(() => {
    const map = new Map();
    (dados || []).forEach((d) => {
      if (d.cd_cliente) {
        const key = String(d.cd_cliente);
        if (!map.has(key)) {
          map.set(key, { cd_cliente: key, nm_cliente: d.nm_cliente || key });
        }
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      a.nm_cliente > b.nm_cliente ? 1 : -1,
    );
  }, [dados]);

  // Lista de representantes disponíveis (únicos)
  const representantesDisponiveis = useMemo(() => {
    const set = new Set();
    Object.values(clienteRepresentante).forEach((rep) => {
      if (rep) set.add(rep);
    });
    return Array.from(set).sort();
  }, [clienteRepresentante]);

  // (filtros de cliente/estado foram externalizados para componentes)

  // Agrupar clientes por cd_cliente
  const clientesAgrupados = useMemo(() => {
    const agrupado = dadosFiltrados.reduce((acc, item) => {
      const cdCliente = item.cd_cliente;
      if (!acc[cdCliente]) {
        acc[cdCliente] = {
          cd_cliente: cdCliente,
          nm_cliente: item.nm_cliente,
          nm_fantasia: item.nm_fantasia || '',
          nr_telefone: item.nr_telefone || '',
          ds_uf: item.ds_uf || '',
          valor_total: 0,
          faturas: [],
        };
      }
      acc[cdCliente].valor_total += parseFloat(item.vl_fatura) || 0;
      acc[cdCliente].faturas.push(item);
      return acc;
    }, {});

    // Calcular situação de cada cliente (INADIMPLENTE se atraso > 60 dias)
    const resultado = Object.values(agrupado).map((cliente) => {
      const diasAtrasoMax = (cliente.faturas || []).reduce((max, fatura) => {
        if (!fatura.dt_vencimento) return max;
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const [datePart] = String(fatura.dt_vencimento).split('T');
        const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10));
        const venc = new Date(y, m - 1, d);
        venc.setHours(0, 0, 0, 0);
        const diff = Math.floor((hoje - venc) / (1000 * 60 * 60 * 24));
        return Math.max(max, diff);
      }, 0);

      const situacao = diasAtrasoMax > 60 ? 'INADIMPLENTE' : 'ATRASADO';

      return {
        ...cliente,
        diasAtrasoMax,
        situacao,
        feeling: clienteFeeling[cliente.cd_cliente] || null,
        status: clienteStatus[cliente.cd_cliente] || null,
        representante: clienteRepresentante[cliente.cd_cliente] || null,
        valor_a_vencer: valoresAVencer[cliente.cd_cliente] || 0,
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
            valorA = (a.nm_cliente || '').toLowerCase();
            valorB = (b.nm_cliente || '').toLowerCase();
            break;
          case 'ds_uf':
            valorA = (a.ds_uf || '').trim().toLowerCase();
            valorB = (b.ds_uf || '').trim().toLowerCase();
            break;
          case 'valor_total':
            valorA = parseFloat(a.valor_total) || 0;
            valorB = parseFloat(b.valor_total) || 0;
            break;
          case 'situacao':
            valorA = (a.situacao || '').toLowerCase();
            valorB = (b.situacao || '').toLowerCase();
            break;
          case 'feeling':
            valorA = (a.feeling || '').toLowerCase();
            valorB = (b.feeling || '').toLowerCase();
            break;
          case 'status':
            valorA = (a.status || '').toLowerCase();
            valorB = (b.status || '').toLowerCase();
            break;
          case 'representante':
            valorA = (a.representante || '').toLowerCase();
            valorB = (b.representante || '').toLowerCase();
            break;
          case 'valor_a_vencer':
            valorA = parseFloat(a.valor_a_vencer) || 0;
            valorB = parseFloat(b.valor_a_vencer) || 0;
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
  }, [
    dadosFiltrados,
    clienteFeeling,
    clienteStatus,
    clienteRepresentante,
    valoresAVencer,
    ordenarPor,
    direcaoOrdenacao,
  ]);

  // Resumo de dívida por representante
  const resumoPorRepresentante = useMemo(() => {
    const mapa = {};
    clientesAgrupados.forEach((cliente) => {
      const rep = cliente.representante || 'SEM REPRESENTANTE';
      if (!mapa[rep]) {
        mapa[rep] = {
          representante: rep,
          qtdClientes: 0,
          valorTotal: 0,
          valorAVencer: 0,
        };
      }
      mapa[rep].qtdClientes += 1;
      mapa[rep].valorTotal += cliente.valor_total || 0;
      mapa[rep].valorAVencer += cliente.valor_a_vencer || 0;
    });
    return Object.values(mapa).sort((a, b) => b.valorTotal - a.valorTotal);
  }, [clientesAgrupados]);

  // Auto-salvar timeline quando dados carregam (apenas se há dados e não há filtros aplicados)
  useEffect(() => {
    if (
      clientesAgrupados.length > 0 &&
      filtroClientes.length === 0 &&
      filtroEstados.length === 0 &&
      filtroRepresentantes.length === 0 &&
      resumoPorRepresentante.length > 0
    ) {
      const valorTotal = clientesAgrupados.reduce(
        (acc, c) => acc + c.valor_total,
        0,
      );
      const qtdClientes = clientesAgrupados.length;
      const qtdTitulos = clientesAgrupados.reduce(
        (acc, c) => acc + (c.faturas?.length || 0),
        0,
      );
      const atrasados = clientesAgrupados.filter(
        (c) => c.situacao === 'ATRASADO',
      );
      const inadimplentes = clientesAgrupados.filter(
        (c) => c.situacao === 'INADIMPLENTE',
      );
      const valorAtrasados = atrasados.reduce(
        (acc, c) => acc + c.valor_total,
        0,
      );
      const valorInadimplentes = inadimplentes.reduce(
        (acc, c) => acc + c.valor_total,
        0,
      );
      salvarTimelineHoje(
        valorTotal,
        qtdClientes,
        qtdTitulos,
        resumoPorRepresentante,
        valorAtrasados,
        valorInadimplentes,
      );
    }
  }, [
    clientesAgrupados,
    resumoPorRepresentante,
    filtroClientes,
    filtroEstados,
    filtroRepresentantes,
    salvarTimelineHoje,
  ]);

  // ======================== CHART DATA MEMOS ========================

  // Gráfico: Evolução do Valor Total da Inadimplência
  const chartTimelineValor = useMemo(() => {
    if (!timeline.length) return null;
    return {
      labels: timeline.map((t) => {
        const d = parseDateNoTZ(t.data);
        return d
          ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
          : t.data;
      }),
      datasets: [
        {
          label: 'Valor Total Inadimplência',
          data: timeline.map((t) => parseFloat(t.valor_total) || 0),
          borderColor: '#fe0000',
          backgroundColor: 'rgba(254, 0, 0, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#fe0000',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointHoverRadius: 7,
        },
      ],
    };
  }, [timeline]);

  // Gráfico: Evolução da Quantidade de Clientes
  const chartTimelineClientes = useMemo(() => {
    if (!timeline.length) return null;
    return {
      labels: timeline.map((t) => {
        const d = parseDateNoTZ(t.data);
        return d
          ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
          : t.data;
      }),
      datasets: [
        {
          label: 'Qtd Clientes Inadimplentes',
          data: timeline.map((t) => parseInt(t.qtd_clientes) || 0),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#3b82f6',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointHoverRadius: 7,
        },
      ],
    };
  }, [timeline]);

  // Gráfico: Evolução Atrasados vs Inadimplentes
  const chartTimelineAtrasadosInadimplentes = useMemo(() => {
    if (!timeline.length) return null;
    // Filtrar apenas entradas que têm dados de atrasados/inadimplentes
    const dados = timeline.filter(
      (t) =>
        (parseFloat(t.valor_atrasados) || 0) > 0 ||
        (parseFloat(t.valor_inadimplentes) || 0) > 0,
    );
    if (!dados.length) return null;
    return {
      labels: dados.map((t) => {
        const d = parseDateNoTZ(t.data);
        return d
          ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
          : t.data;
      }),
      datasets: [
        {
          label: 'Atrasados (≤ 60 dias)',
          data: dados.map((t) => parseFloat(t.valor_atrasados) || 0),
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#f59e0b',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointHoverRadius: 7,
        },
        {
          label: 'Inadimplentes (> 60 dias)',
          data: dados.map((t) => parseFloat(t.valor_inadimplentes) || 0),
          borderColor: '#fe0000',
          backgroundColor: 'rgba(254, 0, 0, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#fe0000',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointHoverRadius: 7,
        },
      ],
    };
  }, [timeline]);

  // Gráfico: Evolução por Representante (top 5 por último valor)
  const CORES_REPRESENTANTES = [
    '#000638',
    '#fe0000',
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#84cc16',
    '#f97316',
    '#6366f1',
    '#14b8a6',
  ];

  const chartTimelineRepresentantes = useMemo(() => {
    if (!timelineRep.length) return null;

    // Pegar datas únicas ordenadas
    const datasUnicas = [...new Set(timelineRep.map((t) => t.data))].sort();
    const labels = datasUnicas.map((d) => {
      const dt = parseDateNoTZ(d);
      return dt
        ? dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        : d;
    });

    // Pegar nomes únicos de representantes e ordenar pelo valor na última data
    const ultimaData = datasUnicas[datasUnicas.length - 1];
    const dadosUltimaData = timelineRep.filter((t) => t.data === ultimaData);
    const repsOrdenados = dadosUltimaData
      .sort(
        (a, b) =>
          (parseFloat(b.valor_total) || 0) - (parseFloat(a.valor_total) || 0),
      )
      .map((t) => t.representante);

    // Montar datasets
    const datasets = repsOrdenados.map((rep, idx) => {
      const cor = CORES_REPRESENTANTES[idx % CORES_REPRESENTANTES.length];
      return {
        label: rep,
        data: datasUnicas.map((data) => {
          const entry = timelineRep.find(
            (t) => t.data === data && t.representante === rep,
          );
          return entry ? parseFloat(entry.valor_total) || 0 : 0;
        }),
        borderColor: cor,
        backgroundColor: cor + '1A',
        fill: false,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: cor,
        pointBorderColor: '#fff',
        pointBorderWidth: 1,
        pointHoverRadius: 6,
      };
    });

    return { labels, datasets };
  }, [timelineRep]);

  // Chart: Evolução qtd clientes por representante
  const chartTimelineRepClientes = useMemo(() => {
    if (!timelineRep.length) return null;

    const datasUnicas = [...new Set(timelineRep.map((t) => t.data))].sort();
    const labels = datasUnicas.map((d) => {
      const dt = parseDateNoTZ(d);
      return dt
        ? dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        : d;
    });

    const ultimaData = datasUnicas[datasUnicas.length - 1];
    const dadosUltimaData = timelineRep.filter((t) => t.data === ultimaData);
    const repsOrdenados = dadosUltimaData
      .sort(
        (a, b) =>
          (parseInt(b.qtd_clientes) || 0) - (parseInt(a.qtd_clientes) || 0),
      )
      .map((t) => t.representante);

    const datasets = repsOrdenados.map((rep, idx) => {
      const cor = CORES_REPRESENTANTES[idx % CORES_REPRESENTANTES.length];
      return {
        label: rep,
        data: datasUnicas.map((data) => {
          const entry = timelineRep.find(
            (t) => t.data === data && t.representante === rep,
          );
          return entry ? parseInt(entry.qtd_clientes) || 0 : 0;
        }),
        borderColor: cor,
        backgroundColor: cor + '1A',
        fill: false,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: cor,
        pointBorderColor: '#fff',
        pointBorderWidth: 1,
        pointHoverRadius: 6,
      };
    });

    return { labels, datasets };
  }, [timelineRep]);

  // Opções dos gráficos de linha
  const lineOptionsValor = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: {
        display: true,
        color: '#000638',
        font: { weight: 'bold', size: 9 },
        formatter: (v) => formatCurrency(v),
        anchor: 'end',
        align: 'top',
        offset: 4,
      },
      tooltip: {
        callbacks: { label: (ctx) => formatCurrency(ctx.raw) },
      },
    },
    scales: {
      x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      y: {
        ticks: { font: { size: 10 }, callback: (v) => formatCurrency(v) },
        grid: { color: 'rgba(0,0,0,0.05)' },
      },
    },
  };

  const lineOptionsClientes = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: {
        display: true,
        color: '#000638',
        font: { weight: 'bold', size: 10 },
        formatter: (v) => v,
        anchor: 'end',
        align: 'top',
        offset: 4,
      },
      tooltip: {
        callbacks: { label: (ctx) => `${ctx.raw} clientes` },
      },
    },
    scales: {
      x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      y: {
        ticks: { font: { size: 10 }, stepSize: 1 },
        grid: { color: 'rgba(0,0,0,0.05)' },
      },
    },
  };

  const lineOptionsRepresentantes = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: { font: { size: 10 }, boxWidth: 12, padding: 8 },
      },
      datalabels: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
        },
      },
    },
    scales: {
      x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      y: {
        ticks: { font: { size: 10 }, callback: (v) => formatCurrency(v) },
        grid: { color: 'rgba(0,0,0,0.05)' },
      },
    },
  };

  const lineOptionsRepClientes = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: { font: { size: 10 }, boxWidth: 12, padding: 8 },
      },
      datalabels: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${ctx.raw} clientes`,
        },
      },
    },
    scales: {
      x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      y: {
        ticks: { font: { size: 10 }, stepSize: 1 },
        grid: { color: 'rgba(0,0,0,0.05)' },
      },
    },
  };

  const lineOptionsAtrasadosInadimplentes = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: { font: { size: 11 }, boxWidth: 14, padding: 12 },
      },
      datalabels: {
        display: true,
        color: (ctx) => (ctx.datasetIndex === 0 ? '#f59e0b' : '#fe0000'),
        font: { weight: 'bold', size: 9 },
        formatter: (v) => formatCurrency(v),
        anchor: 'end',
        align: 'top',
        offset: 4,
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
        },
      },
    },
    scales: {
      x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      y: {
        ticks: { font: { size: 10 }, callback: (v) => formatCurrency(v) },
        grid: { color: 'rgba(0,0,0,0.05)' },
      },
    },
  };

  // Calcular variações percentuais em relação ao primeiro dia da timeline
  const variacoes = useMemo(() => {
    const calcVar = (primeiro, ultimo) => {
      if (!primeiro || primeiro === 0) return null;
      return ((ultimo - primeiro) / Math.abs(primeiro)) * 100;
    };

    if (timeline.length < 2) {
      return {
        valor: null,
        clientes: null,
        atrasados: null,
        inadimplentes: null,
      };
    }

    const primeiro = timeline[0];
    const ultimo = timeline[timeline.length - 1];

    return {
      valor: calcVar(
        parseFloat(primeiro.valor_total) || 0,
        parseFloat(ultimo.valor_total) || 0,
      ),
      clientes: calcVar(
        parseInt(primeiro.qtd_clientes) || 0,
        parseInt(ultimo.qtd_clientes) || 0,
      ),
      atrasados: calcVar(
        parseFloat(primeiro.valor_atrasados) || 0,
        parseFloat(ultimo.valor_atrasados) || 0,
      ),
      inadimplentes: calcVar(
        parseFloat(primeiro.valor_inadimplentes) || 0,
        parseFloat(ultimo.valor_inadimplentes) || 0,
      ),
      primeiraData: primeiro.data,
    };
  }, [timeline]);

  // Calcular métricas
  const metricas = useMemo(() => {
    const totalClientes = clientesAgrupados.length;
    const valorTotal = clientesAgrupados.reduce(
      (acc, cliente) => acc + cliente.valor_total,
      0,
    );
    const jurosTotal = dadosFiltrados.reduce(
      (acc, item) => acc + (parseFloat(item.vl_juros) || 0),
      0,
    );
    const valorCorrigidoTotal = dadosFiltrados.reduce(
      (acc, item) => acc + (parseFloat(item.vl_corrigido) || 0),
      0,
    );

    // Métricas por Situação
    const atrasados = clientesAgrupados.filter(
      (c) => c.situacao === 'ATRASADO',
    );
    const inadimplentes = clientesAgrupados.filter(
      (c) => c.situacao === 'INADIMPLENTE',
    );

    const qtdAtrasados = atrasados.length;
    const valorAtrasados = atrasados.reduce((acc, c) => acc + c.valor_total, 0);
    const qtdInadimplentes = inadimplentes.length;
    const valorInadimplentes = inadimplentes.reduce(
      (acc, c) => acc + c.valor_total,
      0,
    );

    // Métricas por Feeling
    const feelingAtraso = clientesAgrupados.filter(
      (c) => clienteFeeling[c.cd_cliente] === 'ATRASO',
    );
    const feelingPossivelPagamento = clientesAgrupados.filter(
      (c) => clienteFeeling[c.cd_cliente] === 'POSSÍVEL PAGAMENTO',
    );

    const qtdFeelingAtraso = feelingAtraso.length;
    const valorFeelingAtraso = feelingAtraso.reduce(
      (acc, c) => acc + c.valor_total,
      0,
    );
    const qtdFeelingPossivelPagamento = feelingPossivelPagamento.length;
    const valorFeelingPossivelPagamento = feelingPossivelPagamento.reduce(
      (acc, c) => acc + c.valor_total,
      0,
    );

    // Métricas por Status
    const statusAcordo = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'ACORDO',
    );
    const statusAcordoAndamento = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'ACORDO EM ANDAMENTO',
    );
    const statusCobranca = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'COBRANÇA',
    );
    const statusProtestado = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'PROTESTADO',
    );

    const qtdAcordo = statusAcordo.length;
    const valorAcordo = statusAcordo.reduce((acc, c) => acc + c.valor_total, 0);
    const qtdAcordoAndamento = statusAcordoAndamento.length;
    const valorAcordoAndamento = statusAcordoAndamento.reduce(
      (acc, c) => acc + c.valor_total,
      0,
    );
    const qtdCobranca = statusCobranca.length;
    const valorCobranca = statusCobranca.reduce(
      (acc, c) => acc + c.valor_total,
      0,
    );
    const qtdProtestado = statusProtestado.length;
    const valorProtestado = statusProtestado.reduce(
      (acc, c) => acc + c.valor_total,
      0,
    );

    // Métricas para os novos status
    const statusPagoPendente = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'PAGO PENDENTE DE BAIXA',
    );
    const statusLojaFechada = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'LOJA FECHADA (Tentando ACORDO)',
    );
    const statusAcordoConcluido = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'ACORDO CONCLUÍDO',
    );
    const statusNotificacaoJuridica = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'NOTIFICAÇÃO JURÍDICA',
    );
    const statusAcaoJudicial = clientesAgrupados.filter(
      (c) => clienteStatus[c.cd_cliente] === 'EM AÇÃO JUDICIAL',
    );

    const qtdPagoPendente = statusPagoPendente.length;
    const valorPagoPendente = statusPagoPendente.reduce(
      (acc, c) => acc + c.valor_total,
      0,
    );
    const qtdLojaFechada = statusLojaFechada.length;
    const valorLojaFechada = statusLojaFechada.reduce(
      (acc, c) => acc + c.valor_total,
      0,
    );
    const qtdAcordoConcluido = statusAcordoConcluido.length;
    const valorAcordoConcluido = statusAcordoConcluido.reduce(
      (acc, c) => acc + c.valor_total,
      0,
    );
    const qtdNotificacaoJuridica = statusNotificacaoJuridica.length;
    const valorNotificacaoJuridica = statusNotificacaoJuridica.reduce(
      (acc, c) => acc + c.valor_total,
      0,
    );
    const qtdAcaoJudicial = statusAcaoJudicial.length;
    const valorAcaoJudicial = statusAcaoJudicial.reduce(
      (acc, c) => acc + c.valor_total,
      0,
    );

    return {
      totalClientes,
      valorTotal,
      jurosTotal,
      valorCorrigidoTotal,
      // Situação
      qtdAtrasados,
      valorAtrasados,
      qtdInadimplentes,
      valorInadimplentes,
      // Feeling
      qtdFeelingAtraso,
      valorFeelingAtraso,
      qtdFeelingPossivelPagamento,
      valorFeelingPossivelPagamento,
      // Status
      qtdAcordo,
      valorAcordo,
      qtdAcordoAndamento,
      valorAcordoAndamento,
      qtdCobranca,
      valorCobranca,
      qtdProtestado,
      valorProtestado,
      // Novos Status
      qtdPagoPendente,
      valorPagoPendente,
      qtdLojaFechada,
      valorLojaFechada,
      qtdAcordoConcluido,
      valorAcordoConcluido,
      qtdNotificacaoJuridica,
      valorNotificacaoJuridica,
      qtdAcaoJudicial,
      valorAcaoJudicial,
    };
  }, [clientesAgrupados, dadosFiltrados, clienteFeeling, clienteStatus]);

  // Matriz cruzada: Situação x Status
  const matrizSituacaoStatus = useMemo(() => {
    const matriz = {
      atrasadosAcordo: clientesAgrupados.filter(
        (c) =>
          c.situacao === 'ATRASADO' && clienteStatus[c.cd_cliente] === 'ACORDO',
      ),
      atrasadosAcordoAndamento: clientesAgrupados.filter(
        (c) =>
          c.situacao === 'ATRASADO' &&
          clienteStatus[c.cd_cliente] === 'ACORDO EM ANDAMENTO',
      ),
      atrasadosCobranca: clientesAgrupados.filter(
        (c) =>
          c.situacao === 'ATRASADO' &&
          clienteStatus[c.cd_cliente] === 'COBRANÇA',
      ),
      atrasadosProtestado: clientesAgrupados.filter(
        (c) =>
          c.situacao === 'ATRASADO' &&
          clienteStatus[c.cd_cliente] === 'PROTESTADO',
      ),

      inadimplentesAcordo: clientesAgrupados.filter(
        (c) =>
          c.situacao === 'INADIMPLENTE' &&
          clienteStatus[c.cd_cliente] === 'ACORDO',
      ),
      inadimplentesAcordoAndamento: clientesAgrupados.filter(
        (c) =>
          c.situacao === 'INADIMPLENTE' &&
          clienteStatus[c.cd_cliente] === 'ACORDO EM ANDAMENTO',
      ),
      inadimplentesCobranca: clientesAgrupados.filter(
        (c) =>
          c.situacao === 'INADIMPLENTE' &&
          clienteStatus[c.cd_cliente] === 'COBRANÇA',
      ),
      inadimplentesProtestado: clientesAgrupados.filter(
        (c) =>
          c.situacao === 'INADIMPLENTE' &&
          clienteStatus[c.cd_cliente] === 'PROTESTADO',
      ),
    };

    return {
      atrasadosAcordo: {
        clientes: matriz.atrasadosAcordo,
        qtd: matriz.atrasadosAcordo.length,
        valor: matriz.atrasadosAcordo.reduce(
          (acc, c) => acc + c.valor_total,
          0,
        ),
      },
      atrasadosAcordoAndamento: {
        clientes: matriz.atrasadosAcordoAndamento,
        qtd: matriz.atrasadosAcordoAndamento.length,
        valor: matriz.atrasadosAcordoAndamento.reduce(
          (acc, c) => acc + c.valor_total,
          0,
        ),
      },
      atrasadosCobranca: {
        clientes: matriz.atrasadosCobranca,
        qtd: matriz.atrasadosCobranca.length,
        valor: matriz.atrasadosCobranca.reduce(
          (acc, c) => acc + c.valor_total,
          0,
        ),
      },
      atrasadosProtestado: {
        clientes: matriz.atrasadosProtestado,
        qtd: matriz.atrasadosProtestado.length,
        valor: matriz.atrasadosProtestado.reduce(
          (acc, c) => acc + c.valor_total,
          0,
        ),
      },
      inadimplentesAcordo: {
        clientes: matriz.inadimplentesAcordo,
        qtd: matriz.inadimplentesAcordo.length,
        valor: matriz.inadimplentesAcordo.reduce(
          (acc, c) => acc + c.valor_total,
          0,
        ),
      },
      inadimplentesAcordoAndamento: {
        clientes: matriz.inadimplentesAcordoAndamento,
        qtd: matriz.inadimplentesAcordoAndamento.length,
        valor: matriz.inadimplentesAcordoAndamento.reduce(
          (acc, c) => acc + c.valor_total,
          0,
        ),
      },
      inadimplentesCobranca: {
        clientes: matriz.inadimplentesCobranca,
        qtd: matriz.inadimplentesCobranca.length,
        valor: matriz.inadimplentesCobranca.reduce(
          (acc, c) => acc + c.valor_total,
          0,
        ),
      },
      inadimplentesProtestado: {
        clientes: matriz.inadimplentesProtestado,
        qtd: matriz.inadimplentesProtestado.length,
        valor: matriz.inadimplentesProtestado.reduce(
          (acc, c) => acc + c.valor_total,
          0,
        ),
      },
    };
  }, [clientesAgrupados, clienteStatus]);

  // Dados para gráfico por estado
  const dadosPorEstado = useMemo(() => {
    const agrupado = dadosFiltrados.reduce((acc, item) => {
      const estado = item.ds_uf?.trim() || 'Não informado';
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
    const valoresPorEstado = estados.map((estado) => agrupado[estado].valor);

    return {
      estados,
      clientesPorEstado,
      valoresPorEstado,
    };
  }, [dadosFiltrados]);

  // Configuração do gráfico geral
  // Top clientes por valor inadimplente (top 10) com dias de atraso máximos
  const topClientes = useMemo(() => {
    if (!clientesAgrupados || clientesAgrupados.length === 0) return [];
    const sorted = [...clientesAgrupados]
      .sort((a, b) => b.valor_total - a.valor_total)
      .slice(0, 10);
    return sorted.map((c) => {
      const diasMax = (c.faturas || []).reduce((max, f) => {
        if (!f.dt_vencimento) return max;
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const [datePart] = String(f.dt_vencimento).split('T');
        const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10));
        const venc = new Date(y, m - 1, d);
        venc.setHours(0, 0, 0, 0);
        const diff = Math.floor((hoje - venc) / (1000 * 60 * 60 * 24));
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

  // Configuração do gráfico por estado
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

  // Funções do modal
  const abrirModal = async (cliente) => {
    setClienteSelecionado(cliente);
    setFaturasSelecionadas(cliente.faturas);
    setFaturasAVencer([]);
    setModalAberto(true);
    setLoadingFaturasModal(true);

    // Buscar faturas a vencer do cliente via TOTVS
    try {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const amanhaStr = amanha.toISOString().split('T')[0];
      const umAnoFrente = new Date();
      umAnoFrente.setFullYear(umAnoFrente.getFullYear() + 1);
      const umAnoFrenteStr = umAnoFrente.toISOString().split('T')[0];

      const params = new URLSearchParams({
        dt_inicio: amanhaStr,
        dt_fim: umAnoFrenteStr,
        modo: 'vencimento',
        situacao: '1',
        status: 'Em Aberto',
        cd_cliente: String(cliente.cd_cliente),
      });

      const response = await fetch(
        `${TotvsURL}accounts-receivable/filter?${params.toString()}`,
      );
      if (response.ok) {
        const result = await response.json();
        const items = result.data?.items || [];
        // Filtrar apenas faturas (tp_documento = 1)
        const faturas = items.filter(
          (item) => item.tp_documento === 1 || item.tp_documento === '1',
        );
        setFaturasAVencer(faturas);
      }
    } catch (error) {
      console.error('Erro ao buscar faturas a vencer:', error);
    } finally {
      setLoadingFaturasModal(false);
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
      // 1. Upload do comprovante no Supabase Storage
      const fileExt = comprovanteBaixa.name.split('.').pop();
      const fileName = `${faturaBaixa.cd_empresa}_${faturaBaixa.cd_cliente}_${faturaBaixa.nr_fat || faturaBaixa.nr_fatura}_${Date.now()}.${fileExt}`;
      const filePath = `comprovantes/${fileName}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from('comprovantes_baixa')
        .upload(filePath, comprovanteBaixa, { upsert: false });

      if (uploadError)
        throw new Error(`Erro no upload: ${uploadError.message}`);

      // 2. Obter URL pública
      const { data: urlData } = supabaseAdmin.storage
        .from('comprovantes_baixa')
        .getPublicUrl(filePath);

      const comprovanteUrl = urlData?.publicUrl;

      // 3. Salvar solicitação no banco
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

  // Funções do modal de histórico
  const abrirModalHistorico = async (cdCliente) => {
    setLoadingHistorico(true);
    setModalHistoricoAberto(true);
    setHistoricoSelecionado([]);

    const { success, data } = await buscarHistorico(cdCliente);

    if (success && data) {
      setHistoricoSelecionado(data);
    } else {
      setNotification({
        type: 'error',
        message: 'Erro ao carregar histórico',
      });
      setTimeout(() => setNotification(null), 3000);
    }

    setLoadingHistorico(false);
  };

  const fecharModalHistorico = () => {
    setModalHistoricoAberto(false);
    setHistoricoSelecionado([]);
  };

  return (
    <div className="w-full max-w-7xl mx-auto py-6 px-4 space-y-6">
      <PageTitle
        title="Inadimplencia Multimarcas"
        subtitle="Acompanhe os clientes inadimplentes e suas métricas"
        icon={ChartBar}
        iconColor="text-purple-600"
      />

      {/* Filtros */}
      <div className="bg-white p-6 rounded-lg shadow-sm border mb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchDados();
          }}
        >
          <div className="text-sm font-semibold text-[#000638] mb-2">
            Configurações para análise de Inadimplência Multimarcas
          </div>
          <span className="text-xs text-gray-500 mt-1">
            Filtros para consulta de clientes inadimplentes
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-3 mt-4">
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
            <div className="col-span-1">
              <FiltroRepresentantes
                representantes={representantesDisponiveis}
                selected={filtroRepresentantes}
                onChange={setFiltroRepresentantes}
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
                <>
                  <CircleNotch size={16} className="animate-spin" />
                  Carregando...
                </>
              ) : (
                <>
                  <ChartBar size={16} />
                  Buscar Dados
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Toggle LISTA / DASHBOARD */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setViewMode('lista')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wide transition-colors shadow-md ${
            viewMode === 'lista'
              ? 'bg-[#000638] text-white'
              : 'bg-white text-[#000638] border border-[#000638]/30 hover:bg-gray-50'
          }`}
        >
          <ListBullets size={16} weight="bold" />
          Lista
        </button>
        <button
          onClick={() => setViewMode('dashboard')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wide transition-colors shadow-md ${
            viewMode === 'dashboard'
              ? 'bg-[#000638] text-white'
              : 'bg-white text-[#000638] border border-[#000638]/30 hover:bg-gray-50'
          }`}
        >
          <ChartLineUp size={16} weight="bold" />
          Dashboard
        </button>
      </div>

      {/* ======================== VIEW: DASHBOARD ======================== */}
      {viewMode === 'dashboard' && (
        <div className="space-y-6">
          {loadingTimeline ? (
            <div className="flex items-center justify-center py-12">
              <CircleNotch size={32} className="animate-spin text-[#000638]" />
              <span className="ml-2 text-sm text-gray-500">
                Carregando evolução...
              </span>
            </div>
          ) : (
            <>
              {/* Gráfico: Evolução do Valor Total */}
              <Card className="shadow-lg rounded-xl bg-white">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <ChartLineUp size={18} className="text-red-600" />
                    <CardTitle className="text-sm font-bold text-[#000638]">
                      Evolução do Valor Total da Inadimplência MTM
                    </CardTitle>
                    {variacoes.valor !== null && (
                      <span
                        className={`ml-auto flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${variacoes.valor > 0 ? 'bg-red-100 text-red-700' : variacoes.valor < 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {variacoes.valor > 0 ? (
                          <ArrowUp size={14} weight="bold" />
                        ) : variacoes.valor < 0 ? (
                          <ArrowDown size={14} weight="bold" />
                        ) : null}
                        {variacoes.valor > 0 ? '+' : ''}
                        {variacoes.valor.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Acompanhe se o valor total está subindo ou caindo ao longo
                    dos dias{' '}
                    {variacoes.primeiraData
                      ? `(ref. ${variacoes.primeiraData})`
                      : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div style={{ height: 350 }}>
                    {chartTimelineValor ? (
                      <Line
                        data={chartTimelineValor}
                        options={lineOptionsValor}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                        Sem dados de evolução ainda. Os snapshots são salvos
                        automaticamente.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Gráfico: Evolução da Quantidade de Clientes */}
              <Card className="shadow-lg rounded-xl bg-white">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Users size={18} className="text-blue-600" />
                    <CardTitle className="text-sm font-bold text-[#000638]">
                      Evolução da Quantidade de Clientes Inadimplentes
                    </CardTitle>
                    {variacoes.clientes !== null && (
                      <span
                        className={`ml-auto flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${variacoes.clientes > 0 ? 'bg-red-100 text-red-700' : variacoes.clientes < 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {variacoes.clientes > 0 ? (
                          <ArrowUp size={14} weight="bold" />
                        ) : variacoes.clientes < 0 ? (
                          <ArrowDown size={14} weight="bold" />
                        ) : null}
                        {variacoes.clientes > 0 ? '+' : ''}
                        {variacoes.clientes.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Acompanhe se a quantidade de clientes está subindo ou caindo{' '}
                    {variacoes.primeiraData
                      ? `(ref. ${variacoes.primeiraData})`
                      : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div style={{ height: 350 }}>
                    {chartTimelineClientes ? (
                      <Line
                        data={chartTimelineClientes}
                        options={lineOptionsClientes}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                        Sem dados de evolução ainda.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Gráfico: Evolução por Representante - Valor */}
              <Card className="shadow-lg rounded-xl bg-white">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <TrendUp size={18} className="text-purple-600" />
                    <CardTitle className="text-sm font-bold text-[#000638]">
                      Evolução da Inadimplência por Representante (Valor)
                    </CardTitle>
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Valor inadimplente de cada representante ao longo do tempo
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div style={{ height: 400 }}>
                    {chartTimelineRepresentantes ? (
                      <Line
                        data={chartTimelineRepresentantes}
                        options={lineOptionsRepresentantes}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                        Sem dados de evolução por representante ainda.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Gráfico: Evolução Atrasados vs Inadimplentes */}
              <Card className="shadow-lg rounded-xl bg-white">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Warning size={18} className="text-yellow-600" />
                    <CardTitle className="text-sm font-bold text-[#000638]">
                      Evolução Atrasados vs Inadimplentes
                    </CardTitle>
                    <div className="ml-auto flex items-center gap-2">
                      {variacoes.atrasados !== null && (
                        <span
                          className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${variacoes.atrasados > 0 ? 'bg-orange-100 text-orange-700' : variacoes.atrasados < 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                        >
                          {variacoes.atrasados > 0 ? (
                            <ArrowUp size={14} weight="bold" />
                          ) : variacoes.atrasados < 0 ? (
                            <ArrowDown size={14} weight="bold" />
                          ) : null}
                          Atr. {variacoes.atrasados > 0 ? '+' : ''}
                          {variacoes.atrasados.toFixed(1)}%
                        </span>
                      )}
                      {variacoes.inadimplentes !== null && (
                        <span
                          className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${variacoes.inadimplentes > 0 ? 'bg-red-100 text-red-700' : variacoes.inadimplentes < 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                        >
                          {variacoes.inadimplentes > 0 ? (
                            <ArrowUp size={14} weight="bold" />
                          ) : variacoes.inadimplentes < 0 ? (
                            <ArrowDown size={14} weight="bold" />
                          ) : null}
                          Inad. {variacoes.inadimplentes > 0 ? '+' : ''}
                          {variacoes.inadimplentes.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Atrasados (≤ 60 dias) vs Inadimplentes ({'>'} 60 dias) —
                    acompanhe a gravidade da carteira{' '}
                    {variacoes.primeiraData
                      ? `(ref. ${variacoes.primeiraData})`
                      : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div style={{ height: 350 }}>
                    {chartTimelineAtrasadosInadimplentes ? (
                      <Line
                        data={chartTimelineAtrasadosInadimplentes}
                        options={lineOptionsAtrasadosInadimplentes}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                        Sem dados de evolução atrasados/inadimplentes ainda. Os
                        dados começarão a ser coletados a partir de hoje.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Gráfico: Evolução por Representante - Quantidade de Clientes */}
              <Card className="shadow-lg rounded-xl bg-white">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Users size={18} className="text-green-600" />
                    <CardTitle className="text-sm font-bold text-[#000638]">
                      Evolução Clientes por Representante
                    </CardTitle>
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Quantidade de clientes inadimplentes de cada representante
                    ao longo do tempo
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div style={{ height: 400 }}>
                    {chartTimelineRepClientes ? (
                      <Line
                        data={chartTimelineRepClientes}
                        options={lineOptionsRepClientes}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                        Sem dados de evolução por representante ainda.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ======================== VIEW: LISTA (conteúdo original) ======================== */}
      {viewMode === 'lista' && (
        <>
          {/* Cards de Resumo */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-blue-600" />
                  <CardTitle className="text-sm font-bold text-blue-700">
                    Total de Clientes
                  </CardTitle>
                  {variacoes.clientes !== null && (
                    <span
                      className={`ml-auto flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${variacoes.clientes > 0 ? 'bg-red-100 text-red-700' : variacoes.clientes < 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                    >
                      {variacoes.clientes > 0 ? (
                        <ArrowUp size={14} weight="bold" />
                      ) : variacoes.clientes < 0 ? (
                        <ArrowDown size={14} weight="bold" />
                      ) : null}
                      {variacoes.clientes > 0 ? '+' : ''}
                      {variacoes.clientes.toFixed(1)}%
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-base font-extrabold text-blue-600 mb-0.5">
                  {metricas.totalClientes}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Clientes inadimplentes{' '}
                  {variacoes.primeiraData
                    ? `(ref. ${variacoes.primeiraData})`
                    : ''}
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
                  {variacoes.valor !== null && (
                    <span
                      className={`ml-auto flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${variacoes.valor > 0 ? 'bg-red-100 text-red-700' : variacoes.valor < 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                    >
                      {variacoes.valor > 0 ? (
                        <ArrowUp size={14} weight="bold" />
                      ) : variacoes.valor < 0 ? (
                        <ArrowDown size={14} weight="bold" />
                      ) : null}
                      {variacoes.valor > 0 ? '+' : ''}
                      {variacoes.valor.toFixed(1)}%
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-base font-extrabold text-green-600 mb-0.5">
                  {formatarMoeda(metricas.valorTotal)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Valor em aberto{' '}
                  {variacoes.primeiraData
                    ? `(ref. ${variacoes.primeiraData})`
                    : ''}
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Handshake size={18} className="text-purple-600" />
                  <CardTitle className="text-sm font-bold text-purple-700">
                    Valor Total - Acordos
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-base font-extrabold text-purple-600 mb-0.5">
                  {formatarMoeda(
                    metricas.valorTotal -
                      (matrizSituacaoStatus.atrasadosAcordo.valor +
                        matrizSituacaoStatus.atrasadosAcordoAndamento.valor +
                        matrizSituacaoStatus.inadimplentesAcordo.valor +
                        matrizSituacaoStatus.inadimplentesAcordoAndamento
                          .valor),
                  )}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Valor em aberto - Acordos - Acordos em Andamento
                </CardDescription>
              </CardContent>
            </Card>

            {/* Juros e Valor Corrigido removidos por solicitação */}
          </div>

          {/* Sessão Situação */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
              <span className="w-1 h-4 bg-[#000638] rounded"></span>
              Por Situação
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalAtrasados}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Clock size={18} className="text-yellow-600" />
                    <CardTitle className="text-sm font-bold text-yellow-700">
                      Atrasados
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-yellow-600 mb-0.5">
                    {metricas.qtdAtrasados} cliente
                    {metricas.qtdAtrasados !== 1 ? 's' : ''}
                  </div>
                  <div className="text-sm font-semibold text-gray-700 mb-1">
                    {formatarMoeda(metricas.valorAtrasados)}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Até 31 dias de atraso
                  </CardDescription>
                </CardContent>
              </Card>

              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalInadimplentes}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Warning size={18} className="text-red-600" />
                    <CardTitle className="text-sm font-bold text-red-700">
                      Inadimplentes
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-red-600 mb-0.5">
                    {metricas.qtdInadimplentes} cliente
                    {metricas.qtdInadimplentes !== 1 ? 's' : ''}
                  </div>
                  <div className="text-sm font-semibold text-gray-700 mb-1">
                    {formatarMoeda(metricas.valorInadimplentes)}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Acima de 31 dias de atraso
                  </CardDescription>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Sessão Feeling */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
              <span className="w-1 h-4 bg-[#000638] rounded"></span>
              Por Feeling
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalFeelingAtraso}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <ChatCircleDots size={18} className="text-orange-600" />
                    <CardTitle className="text-sm font-bold text-orange-700">
                      Atraso
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-orange-600 mb-0.5">
                    {metricas.qtdFeelingAtraso} cliente
                    {metricas.qtdFeelingAtraso !== 1 ? 's' : ''}
                  </div>
                  <div className="text-sm font-semibold text-gray-700 mb-1">
                    {formatarMoeda(metricas.valorFeelingAtraso)}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Clientes marcados com atraso
                  </CardDescription>
                </CardContent>
              </Card>

              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalFeelingPossivelPagamento}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <TrendUp size={18} className="text-green-600" />
                    <CardTitle className="text-sm font-bold text-green-700">
                      Possível Pagamento
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-green-600 mb-0.5">
                    {metricas.qtdFeelingPossivelPagamento} cliente
                    {metricas.qtdFeelingPossivelPagamento !== 1 ? 's' : ''}
                  </div>
                  <div className="text-sm font-semibold text-gray-700 mb-1">
                    {formatarMoeda(metricas.valorFeelingPossivelPagamento)}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Clientes com possibilidade de pagamento
                  </CardDescription>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Sessão Status */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
              <span className="w-1 h-4 bg-[#000638] rounded"></span>
              Por Status
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalStatusAcordo}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Handshake size={18} className="text-blue-600" />
                    <CardTitle className="text-sm font-bold text-blue-700">
                      Acordo
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-blue-600 mb-0.5">
                    {metricas.qtdAcordo}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    {metricas.qtdAcordo !== 1 ? 'Clientes' : 'Cliente'} -{' '}
                    {formatarMoeda(metricas.valorAcordo)}
                  </CardDescription>
                </CardContent>
              </Card>

              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalStatusAcordoAndamento}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <FileText size={18} className="text-cyan-600" />
                    <CardTitle className="text-sm font-bold text-cyan-700">
                      Acordo em Andamento
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-cyan-600 mb-0.5">
                    {metricas.qtdAcordoAndamento}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    {metricas.qtdAcordoAndamento !== 1 ? 'Clientes' : 'Cliente'}{' '}
                    - {formatarMoeda(metricas.valorAcordoAndamento)}
                  </CardDescription>
                </CardContent>
              </Card>

              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalStatusCobranca}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CurrencyDollar size={18} className="text-purple-600" />
                    <CardTitle className="text-sm font-bold text-purple-700">
                      Cobrança
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-purple-600 mb-0.5">
                    {metricas.qtdCobranca}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    {metricas.qtdCobranca !== 1 ? 'Clientes' : 'Cliente'} -{' '}
                    {formatarMoeda(metricas.valorCobranca)}
                  </CardDescription>
                </CardContent>
              </Card>

              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalStatusProtestado}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Gavel size={18} className="text-red-600" />
                    <CardTitle className="text-sm font-bold text-red-700">
                      Protestado
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-red-600 mb-0.5">
                    {metricas.qtdProtestado}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    {metricas.qtdProtestado !== 1 ? 'Clientes' : 'Cliente'} -{' '}
                    {formatarMoeda(metricas.valorProtestado)}
                  </CardDescription>
                </CardContent>
              </Card>

              {/* Novos cards de status */}
              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalStatusPagoPendente}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={18} className="text-green-600" />
                    <CardTitle className="text-sm font-bold text-green-700">
                      Pago Pendente de Baixa
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-green-600 mb-0.5">
                    {metricas.qtdPagoPendente}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    {metricas.qtdPagoPendente !== 1 ? 'Clientes' : 'Cliente'} -{' '}
                    {formatarMoeda(metricas.valorPagoPendente)}
                  </CardDescription>
                </CardContent>
              </Card>

              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalStatusLojaFechada}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Warning size={18} className="text-orange-600" />
                    <CardTitle className="text-sm font-bold text-orange-700">
                      Loja Fechada (Tentando Acordo)
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-orange-600 mb-0.5">
                    {metricas.qtdLojaFechada}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    {metricas.qtdLojaFechada !== 1 ? 'Clientes' : 'Cliente'} -{' '}
                    {formatarMoeda(metricas.valorLojaFechada)}
                  </CardDescription>
                </CardContent>
              </Card>

              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalStatusAcordoConcluido}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Smiley size={18} className="text-emerald-600" />
                    <CardTitle className="text-sm font-bold text-emerald-700">
                      Acordo Concluído
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-emerald-600 mb-0.5">
                    {metricas.qtdAcordoConcluido}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    {metricas.qtdAcordoConcluido !== 1 ? 'Clientes' : 'Cliente'}{' '}
                    - {formatarMoeda(metricas.valorAcordoConcluido)}
                  </CardDescription>
                </CardContent>
              </Card>

              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalStatusNotificacaoJuridica}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <FileText size={18} className="text-yellow-600" />
                    <CardTitle className="text-sm font-bold text-yellow-700">
                      Notificação Jurídica
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-yellow-600 mb-0.5">
                    {metricas.qtdNotificacaoJuridica}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    {metricas.qtdNotificacaoJuridica !== 1
                      ? 'Clientes'
                      : 'Cliente'}{' '}
                    - {formatarMoeda(metricas.valorNotificacaoJuridica)}
                  </CardDescription>
                </CardContent>
              </Card>

              <Card
                className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white cursor-pointer"
                onClick={abrirModalStatusAcaoJudicial}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Gavel size={18} className="text-red-700" />
                    <CardTitle className="text-sm font-bold text-red-800">
                      Em Ação Judicial
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-4">
                  <div className="text-base font-extrabold text-red-700 mb-0.5">
                    {metricas.qtdAcaoJudicial}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    {metricas.qtdAcaoJudicial !== 1 ? 'Clientes' : 'Cliente'} -{' '}
                    {formatarMoeda(metricas.valorAcaoJudicial)}
                  </CardDescription>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Matriz: Situação x Status */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
              <span className="w-1 h-4 bg-[#000638] rounded"></span>
              Cruzamento: Situação x Status
            </h3>
            <Card className="shadow-lg rounded-xl bg-white">
              <CardContent className="p-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-gray-300">
                        <th className="px-4 py-3 text-left font-bold text-[#000638]">
                          Situação / Status
                        </th>
                        <th className="px-4 py-3 text-center font-bold text-blue-700">
                          Acordo
                        </th>
                        <th className="px-4 py-3 text-center font-bold text-cyan-700">
                          Acordo em Andamento
                        </th>
                        <th className="px-4 py-3 text-center font-bold text-[#000638] bg-gray-100">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Linha ATRASADOS */}
                      <tr className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 font-bold text-yellow-700 bg-yellow-50">
                          <div className="flex items-center gap-2">
                            <Clock size={16} />
                            ATRASADOS
                          </div>
                        </td>
                        <td
                          className="px-4 py-3 text-center cursor-pointer hover:bg-blue-50 transition-colors"
                          onClick={() =>
                            abrirModalMatriz(
                              'Atrasados - Acordo',
                              matrizSituacaoStatus.atrasadosAcordo.clientes,
                            )
                          }
                        >
                          <div className="font-bold text-blue-600">
                            {matrizSituacaoStatus.atrasadosAcordo.qtd}
                          </div>
                          <div className="text-xs text-gray-600">
                            {formatarMoeda(
                              matrizSituacaoStatus.atrasadosAcordo.valor,
                            )}
                          </div>
                        </td>
                        <td
                          className="px-4 py-3 text-center cursor-pointer hover:bg-cyan-50 transition-colors"
                          onClick={() =>
                            abrirModalMatriz(
                              'Atrasados - Acordo em Andamento',
                              matrizSituacaoStatus.atrasadosAcordoAndamento
                                .clientes,
                            )
                          }
                        >
                          <div className="font-bold text-cyan-600">
                            {matrizSituacaoStatus.atrasadosAcordoAndamento.qtd}
                          </div>
                          <div className="text-xs text-gray-600">
                            {formatarMoeda(
                              matrizSituacaoStatus.atrasadosAcordoAndamento
                                .valor,
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3 text-center font-bold bg-yellow-50 border-l-2 border-yellow-300">
                          <div className="text-base text-blue-700">
                            {metricas.qtdAtrasados -
                              (matrizSituacaoStatus.atrasadosAcordo.qtd +
                                matrizSituacaoStatus.atrasadosAcordoAndamento
                                  .qtd)}
                          </div>
                          <div className="text-sm font-semibold text-gray-700 mt-1">
                            {formatarMoeda(
                              metricas.valorAtrasados -
                                (matrizSituacaoStatus.atrasadosAcordo.valor +
                                  matrizSituacaoStatus.atrasadosAcordoAndamento
                                    .valor),
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-1 italic">
                            Total - Acordos
                          </div>
                        </td>
                      </tr>

                      {/* Linha INADIMPLENTES */}
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-bold text-red-700 bg-red-50">
                          <div className="flex items-center gap-2">
                            <Warning size={16} />
                            INADIMPLENTES
                          </div>
                        </td>
                        <td
                          className="px-4 py-3 text-center cursor-pointer hover:bg-blue-50 transition-colors"
                          onClick={() =>
                            abrirModalMatriz(
                              'Inadimplentes - Acordo',
                              matrizSituacaoStatus.inadimplentesAcordo.clientes,
                            )
                          }
                        >
                          <div className="font-bold text-blue-600">
                            {matrizSituacaoStatus.inadimplentesAcordo.qtd}
                          </div>
                          <div className="text-xs text-gray-600">
                            {formatarMoeda(
                              matrizSituacaoStatus.inadimplentesAcordo.valor,
                            )}
                          </div>
                        </td>
                        <td
                          className="px-4 py-3 text-center cursor-pointer hover:bg-cyan-50 transition-colors"
                          onClick={() =>
                            abrirModalMatriz(
                              'Inadimplentes - Acordo em Andamento',
                              matrizSituacaoStatus.inadimplentesAcordoAndamento
                                .clientes,
                            )
                          }
                        >
                          <div className="font-bold text-cyan-600">
                            {
                              matrizSituacaoStatus.inadimplentesAcordoAndamento
                                .qtd
                            }
                          </div>
                          <div className="text-xs text-gray-600">
                            {formatarMoeda(
                              matrizSituacaoStatus.inadimplentesAcordoAndamento
                                .valor,
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center font-bold bg-red-50 border-l-2 border-red-300">
                          <div className="text-base text-red-700">
                            {metricas.qtdInadimplentes -
                              (matrizSituacaoStatus.inadimplentesAcordo.qtd +
                                matrizSituacaoStatus
                                  .inadimplentesAcordoAndamento.qtd)}
                          </div>
                          <div className="text-sm font-semibold text-gray-700 mt-1">
                            {formatarMoeda(
                              metricas.valorInadimplentes -
                                (matrizSituacaoStatus.inadimplentesAcordo
                                  .valor +
                                  matrizSituacaoStatus
                                    .inadimplentesAcordoAndamento.valor),
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-1 italic">
                            Total - Acordos
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-xs text-gray-500 italic">
                  💡 Clique em qualquer célula para ver a lista detalhada de
                  clientes
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Resumo por Representante */}
          {resumoPorRepresentante.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                <span className="w-1 h-4 bg-[#000638] rounded"></span>
                Dívida por Representante
              </h3>
              <Card className="shadow-lg rounded-xl bg-white">
                <CardContent className="p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b-2 border-gray-300">
                          <th className="px-4 py-3 text-left font-bold text-[#000638]">
                            Representante
                          </th>
                          <th className="px-4 py-3 text-center font-bold text-[#000638]">
                            Clientes
                          </th>
                          <th className="px-4 py-3 text-right font-bold text-red-700">
                            Valor Vencido
                          </th>
                          <th className="px-4 py-3 text-right font-bold text-yellow-700">
                            Valor a Vencer
                          </th>
                          <th className="px-4 py-3 text-right font-bold text-[#000638]">
                            Total Geral
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {resumoPorRepresentante.map((item) => (
                          <tr
                            key={item.representante}
                            className="border-b hover:bg-gray-50 cursor-pointer transition-colors"
                            onClick={() => {
                              if (item.representante !== 'SEM REPRESENTANTE') {
                                setFiltroRepresentantes([item.representante]);
                              }
                            }}
                          >
                            <td className="px-4 py-3 font-semibold text-[#000638]">
                              <div className="flex items-center gap-2">
                                <Users size={14} className="text-indigo-500" />
                                {item.representante}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center font-bold text-blue-600">
                              {item.qtdClientes}
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-red-600">
                              {formatarMoeda(item.valorTotal)}
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-yellow-600">
                              {formatarMoeda(item.valorAVencer)}
                            </td>
                            <td className="px-4 py-3 text-right font-extrabold text-[#000638]">
                              {formatarMoeda(
                                item.valorTotal + item.valorAVencer,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-400 bg-gray-50">
                          <td className="px-4 py-3 font-extrabold text-[#000638]">
                            TOTAL
                          </td>
                          <td className="px-4 py-3 text-center font-extrabold text-blue-700">
                            {resumoPorRepresentante.reduce(
                              (s, i) => s + i.qtdClientes,
                              0,
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-extrabold text-red-700">
                            {formatarMoeda(
                              resumoPorRepresentante.reduce(
                                (s, i) => s + i.valorTotal,
                                0,
                              ),
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-extrabold text-yellow-700">
                            {formatarMoeda(
                              resumoPorRepresentante.reduce(
                                (s, i) => s + i.valorAVencer,
                                0,
                              ),
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-extrabold text-[#000638]">
                            {formatarMoeda(
                              resumoPorRepresentante.reduce(
                                (s, i) => s + i.valorTotal + i.valorAVencer,
                                0,
                              ),
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="mt-3 text-xs text-gray-500 italic">
                    💡 Clique em um representante para filtrar a tabela
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Gráficos */}
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

          {/* Tabela */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt size={18} className="text-[#000638]" />
                  <CardTitle className="text-sm font-bold text-[#000638]">
                    Lista de Clientes Inadimplentes
                  </CardTitle>
                </div>
                <button
                  onClick={() => abrirModalHistorico(null)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#000638] text-white text-xs font-medium rounded hover:bg-[#fe0000] transition-colors"
                  title="Ver histórico completo de alterações"
                >
                  <ClockClockwise size={16} weight="bold" />
                  Log
                </button>
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
                              <span>
                                {direcaoOrdenacao === 'asc' ? '↑' : '↓'}
                              </span>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => ordenarColuna('nm_cliente')}
                          title="Clique para ordenar"
                        >
                          <div className="flex items-center gap-1">
                            Nome Cliente
                            {ordenarPor === 'nm_cliente' && (
                              <span>
                                {direcaoOrdenacao === 'asc' ? '↑' : '↓'}
                              </span>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => ordenarColuna('ds_uf')}
                          title="Clique para ordenar"
                        >
                          <div className="flex items-center gap-1">
                            Estado
                            {ordenarPor === 'ds_uf' && (
                              <span>
                                {direcaoOrdenacao === 'asc' ? '↑' : '↓'}
                              </span>
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
                              <span>
                                {direcaoOrdenacao === 'asc' ? '↑' : '↓'}
                              </span>
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
                              <span>
                                {direcaoOrdenacao === 'asc' ? '↑' : '↓'}
                              </span>
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
                              <span>
                                {direcaoOrdenacao === 'asc' ? '↑' : '↓'}
                              </span>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => ordenarColuna('feeling')}
                          title="Clique para ordenar"
                        >
                          <div className="flex items-center gap-1">
                            Feeling
                            {ordenarPor === 'feeling' && (
                              <span>
                                {direcaoOrdenacao === 'asc' ? '↑' : '↓'}
                              </span>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => ordenarColuna('status')}
                          title="Clique para ordenar"
                        >
                          <div className="flex items-center gap-1">
                            Status
                            {ordenarPor === 'status' && (
                              <span>
                                {direcaoOrdenacao === 'asc' ? '↑' : '↓'}
                              </span>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => ordenarColuna('representante')}
                          title="Clique para ordenar"
                        >
                          <div className="flex items-center gap-1">
                            Representante
                            {ordenarPor === 'representante' && (
                              <span>
                                {direcaoOrdenacao === 'asc' ? '↑' : '↓'}
                              </span>
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
                            colSpan={11}
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
                              {cliente.nm_cliente || 'N/A'}
                            </td>
                            <td className="px-4 py-3">
                              <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-1 rounded">
                                {cliente.ds_uf?.trim() || 'N/A'}
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
                              {editandoFeeling === cliente.cd_cliente ? (
                                <div className="flex items-center gap-2">
                                  <select
                                    value={tempFeeling}
                                    onChange={(e) =>
                                      setTempFeeling(e.target.value)
                                    }
                                    className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <option value="">Selecione...</option>
                                    <option value="POSSÍVEL PAGAMENTO">
                                      POSSÍVEL PAGAMENTO
                                    </option>
                                    <option value="ATRASO">ATRASO</option>
                                  </select>
                                  <button
                                    onClick={(e) =>
                                      salvarFeeling(cliente.cd_cliente, e)
                                    }
                                    className="bg-green-500 hover:bg-green-600 text-white text-xs px-2 py-1 rounded transition-colors"
                                  >
                                    Salvar
                                  </button>
                                  <button
                                    onClick={cancelarEdicaoFeeling}
                                    className="bg-gray-400 hover:bg-gray-500 text-white text-xs px-2 py-1 rounded transition-colors"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <span
                                  onClick={(e) =>
                                    iniciarEdicaoFeeling(cliente.cd_cliente, e)
                                  }
                                  className={`text-xs font-semibold px-2 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity ${getFeelingBadgeClass(
                                    cliente.feeling,
                                  )}`}
                                >
                                  {cliente.feeling || '---'}
                                </span>
                              )}
                            </td>
                            <td
                              className="px-4 py-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {editandoStatus === cliente.cd_cliente ? (
                                <div className="flex items-center gap-2">
                                  <select
                                    value={tempStatus}
                                    onChange={(e) =>
                                      setTempStatus(e.target.value)
                                    }
                                    className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <option value="">Selecione...</option>
                                    <option value="ACORDO">ACORDO</option>
                                    <option value="ACORDO EM ANDAMENTO">
                                      ACORDO EM ANDAMENTO
                                    </option>
                                    <option value="COBRANÇA">COBRANÇA</option>
                                    <option value="PROTESTADO">
                                      PROTESTADO
                                    </option>
                                    <option value="PAGO PENDENTE DE BAIXA">
                                      PAGO PENDENTE DE BAIXA
                                    </option>
                                    <option value="LOJA FECHADA (Tentando ACORDO)">
                                      LOJA FECHADA (Tentando ACORDO)
                                    </option>
                                    <option value="ACORDO CONCLUÍDO">
                                      ACORDO CONCLUÍDO
                                    </option>
                                    <option value="NOTIFICAÇÃO JURÍDICA">
                                      NOTIFICAÇÃO JURÍDICA
                                    </option>
                                    <option value="EM AÇÃO JUDICIAL">
                                      EM AÇÃO JUDICIAL
                                    </option>
                                  </select>
                                  <button
                                    onClick={(e) =>
                                      salvarStatus(cliente.cd_cliente, e)
                                    }
                                    className="bg-green-500 hover:bg-green-600 text-white text-xs px-2 py-1 rounded transition-colors"
                                  >
                                    Salvar
                                  </button>
                                  <button
                                    onClick={cancelarEdicaoStatus}
                                    className="bg-gray-400 hover:bg-gray-500 text-white text-xs px-2 py-1 rounded transition-colors"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <span
                                  onClick={(e) =>
                                    iniciarEdicaoStatus(cliente.cd_cliente, e)
                                  }
                                  className={`text-xs font-semibold px-2 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity ${getStatusBadgeClass(
                                    cliente.status,
                                  )}`}
                                >
                                  {cliente.status || '---'}
                                </span>
                              )}
                            </td>
                            {/* Coluna Representante */}
                            <td
                              className="px-4 py-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {editandoRepresentante === cliente.cd_cliente ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={tempRepresentante}
                                    onChange={(e) =>
                                      setTempRepresentante(e.target.value)
                                    }
                                    className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-32"
                                    placeholder="Nome do representante"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <button
                                    onClick={(e) =>
                                      salvarRepresentante(cliente.cd_cliente, e)
                                    }
                                    className="bg-green-500 hover:bg-green-600 text-white text-xs px-2 py-1 rounded transition-colors"
                                  >
                                    Salvar
                                  </button>
                                  <button
                                    onClick={cancelarEdicaoRepresentante}
                                    className="bg-gray-400 hover:bg-gray-500 text-white text-xs px-2 py-1 rounded transition-colors"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <span
                                  onClick={(e) =>
                                    iniciarEdicaoRepresentante(
                                      cliente.cd_cliente,
                                      e,
                                    )
                                  }
                                  className="text-xs font-semibold px-2 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity bg-purple-100 text-purple-800"
                                >
                                  {cliente.representante || '---'}
                                </span>
                              )}
                            </td>
                            {/* Coluna Observações */}
                            <td
                              className="px-4 py-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={(e) =>
                                  abrirModalObservacoes(cliente, e)
                                }
                                className="bg-[#000638] hover:bg-[#fe0000] text-white text-xs font-medium px-3 py-1 rounded transition-colors"
                              >
                                OBS
                              </button>
                            </td>
                            {/* Coluna Contato */}
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
        </>
      )}

      {/* Modal de Lista de Clientes Filtrados */}
      {modalListaAberto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-6xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {tituloModalLista}
              </h3>
              <button
                onClick={fecharModalLista}
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

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                  <tr>
                    <th className="px-4 py-3">Código</th>
                    <th className="px-4 py-3">Nome Cliente</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Valor Total</th>
                    <th className="px-4 py-3">Dias Atraso</th>
                  </tr>
                </thead>
                <tbody>
                  {clientesFiltradosModal.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-gray-500"
                      >
                        Nenhum cliente encontrado nesta categoria
                      </td>
                    </tr>
                  ) : (
                    clientesFiltradosModal.map((cliente, index) => (
                      <tr
                        key={index}
                        className="bg-white border-b hover:bg-blue-50 cursor-pointer transition-colors"
                        onClick={() => {
                          fecharModalLista();
                          abrirModal(cliente);
                        }}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {cliente.cd_cliente || 'N/A'}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {cliente.nm_cliente || 'N/A'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-1 rounded">
                            {cliente.ds_uf?.trim() || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-green-600">
                          {formatarMoeda(cliente.valor_total)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-1 rounded">
                            {cliente.diasAtrasoMax || 0} dias
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={fecharModalLista}
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

      {/* Modal de Histórico de Alterações */}
      {modalHistoricoAberto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg p-6 max-w-7xl w-full max-h-[90vh] overflow-y-auto mx-4">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <ClockClockwise
                  size={24}
                  weight="bold"
                  className="text-[#000638]"
                />
                <h3 className="text-lg font-semibold text-gray-900">
                  Histórico Completo de Alterações
                </h3>
              </div>
              <button
                onClick={fecharModalHistorico}
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
              Registro de todas as alterações de classificação realizadas
            </p>

            {loadingHistorico ? (
              <div className="flex justify-center items-center py-8">
                <CircleNotch
                  size={32}
                  className="animate-spin text-[#000638]"
                />
              </div>
            ) : historicoSelecionado.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <ClockClockwise size={48} className="mx-auto mb-2 opacity-50" />
                <p>Nenhuma alteração de classificação foi registrada ainda</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                    <tr>
                      <th className="px-4 py-3">Data/Hora</th>
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Valor</th>
                      <th className="px-4 py-3">Situação</th>
                      <th className="px-4 py-3">Feeling</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Usuário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historicoSelecionado.map((item, index) => (
                      <tr
                        key={index}
                        className="bg-white border-b hover:bg-gray-50"
                      >
                        <td className="px-4 py-3 text-xs">
                          {new Date(item.data_alteracao).toLocaleString(
                            'pt-BR',
                            {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            },
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          <div className="text-xs font-bold">
                            {item.cd_cliente}
                          </div>
                          <div className="text-xs text-gray-600">
                            {item.nm_cliente}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-green-600">
                          {formatarMoeda(item.valor_total)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-semibold px-2 py-1 rounded ${
                              item.situacao === 'INADIMPLENTE'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {item.situacao || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-semibold px-2 py-1 rounded ${getFeelingBadgeClass(
                              item.feeling,
                            )}`}
                          >
                            {item.feeling || '---'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-semibold px-2 py-1 rounded ${getStatusBadgeClass(
                              item.status,
                            )}`}
                          >
                            {item.status || '---'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="flex items-center gap-1">
                            <Users size={14} className="text-gray-400" />
                            <span className="text-gray-700">
                              {item.usuario}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                onClick={fecharModalHistorico}
                className="px-4 py-2 bg-[#000638] text-white rounded hover:bg-[#fe0000] transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes das Faturas */}
      {modalAberto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-6xl max-h-[90vh] overflow-y-auto w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Detalhes das Faturas - {clienteSelecionado?.nm_cliente}
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
              <h4 className="text-md font-semibold text-red-700 mb-3 flex items-center gap-2">
                <Warning size={20} weight="bold" className="text-red-600" />
                Faturas Vencidas ({faturasSelecionadas.length})
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-white uppercase bg-red-600">
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
                          Nenhuma fatura vencida encontrada
                        </td>
                      </tr>
                    ) : (
                      faturasSelecionadas.map((fatura, index) => (
                        <tr
                          key={index}
                          className="bg-red-50 border-b border-red-100"
                        >
                          <td className="px-4 py-3">
                            {fatura.cd_empresa || 'N/A'}
                          </td>
                          <td className="px-4 py-3 font-medium">
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
              <h4 className="text-md font-semibold text-orange-700 mb-3 flex items-center gap-2">
                <Clock size={20} weight="bold" className="text-orange-600" />
                Faturas a Vencer (
                {loadingFaturasModal ? '...' : faturasAVencer.length})
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-white uppercase bg-orange-500">
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
                    {loadingFaturasModal ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="px-4 py-4 text-center text-gray-500"
                        >
                          <div className="flex items-center justify-center gap-2">
                            <CircleNotch
                              size={18}
                              className="animate-spin text-orange-500"
                            />
                            Carregando faturas a vencer...
                          </div>
                        </td>
                      </tr>
                    ) : faturasAVencer.length === 0 ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="px-4 py-4 text-center text-gray-500"
                        >
                          Nenhuma fatura a vencer encontrada
                        </td>
                      </tr>
                    ) : (
                      faturasAVencer.map((fatura, index) => {
                        const hoje = new Date();
                        hoje.setHours(0, 0, 0, 0);
                        const [datePart] = String(fatura.dt_vencimento).split(
                          'T',
                        );
                        const [y, m, d] = datePart
                          .split('-')
                          .map((n) => parseInt(n, 10));
                        const venc = new Date(y, m - 1, d);
                        venc.setHours(0, 0, 0, 0);
                        const diasParaVencer = Math.ceil(
                          (venc - hoje) / (1000 * 60 * 60 * 24),
                        );
                        return (
                          <tr
                            key={index}
                            className="bg-orange-50 border-b border-orange-100"
                          >
                            <td className="px-4 py-3">
                              {fatura.cd_empresa || 'N/A'}
                            </td>
                            <td className="px-4 py-3 font-medium">
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
                                {fatura.nm_portador ||
                                  fatura.cd_portador ||
                                  '--'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`text-xs font-medium px-2 py-1 rounded ${
                                  diasParaVencer <= 7
                                    ? 'bg-red-100 text-red-800'
                                    : diasParaVencer <= 30
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : 'bg-green-100 text-green-800'
                                }`}
                              >
                                {diasParaVencer}{' '}
                                {diasParaVencer === 1 ? 'dia' : 'dias'}
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
                    document.getElementById('comprovante-input').click()
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
                  id="comprovante-input"
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

export default InadimplentesMultimarcas;
