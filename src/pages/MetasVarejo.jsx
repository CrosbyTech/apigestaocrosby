import React, { useState, useEffect, useRef } from 'react';
import PageTitle from '../components/ui/PageTitle';
import FiltroLoja from '../components/FiltroLoja';
import FiltroVendedor from '../components/FiltroVendedor';
import { Target, TrendUp, Calendar } from '@phosphor-icons/react';
import useApiClient from '../hooks/useApiClient';
import { API_BASE_URL } from '../config/constants';
import useMetas from '../hooks/useMetas';
import useMetasSemanais from '../hooks/useMetasSemanais';
import { useAuth } from '../components/AuthContext';
import Notification from '../components/ui/Notification';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const MetasVarejo = () => {
  const apiClient = useApiClient();
  const {
    salvarMetas,
    buscarMetas,
    buscarLogAlteracoes,
    deletarMetasPorCriterios,
  } = useMetas();
  const {
    gerarSemanasDoMes,
    obterSemanaAnoISO,
    buscarMetasSemanaisAgrupadas,
    buscarMetasMensaisCalculadas,
    salvarMetaSemanalIndividual,
    salvarMetaMensalComCalculoSemanal,
    salvarMetasSemanais,
    deletarMetasSemanaisPorCriterios,
    deletarMetasMensaisCalculadas,
    recalcularMetasMensais,
    calcularMetasSemanaisDeMensal,
    calcularMetaMensalDeSemanais,
    buscarLogAlteracoesSemanais,
  } = useMetasSemanais();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loadingRanking, setLoadingRanking] = useState(false);
  const [dadosLojas, setDadosLojas] = useState([]);
  const [dadosVendedores, setDadosVendedores] = useState([]);
  const [vendedoresSelecionados, setVendedoresSelecionados] = useState([]);
  const [dadosVendedor, setDadosVendedor] = useState([]);
  const [lojasSelecionadas, setLojasSelecionadas] = useState([]);
  const [dadosLoja, setDadosLoja] = useState([]);
  const [tipoLoja, setTipoLoja] = useState('Todos');
  const [rankingTipo, setRankingTipo] = useState('lojas');
  const [ordenacao, setOrdenacao] = useState('faturamento'); // 'faturamento' ou 'nome'
  const [direcaoOrdenacao, setDirecaoOrdenacao] = useState('desc'); // 'desc' ou 'asc'
  const [filtros, setFiltros] = useState({
    dt_inicio: '',
    dt_fim: '',
  });

  // Estados para filtro de mês (igual ao DRE)
  const [filtroMensal, setFiltroMensal] = useState('SET'); // Mês atual por padrão
  const [filtroAno, setFiltroAno] = useState(new Date().getFullYear());

  // Ref para cache dos dados de branches (TOTVS)
  const branchDataRef = useRef({ nameMap: {}, groupMap: {} });

  // Códigos de operação e status usados na API TOTVS (mesmos do RankingFaturamento)
  const INVOICE_STATUS_LIST = ['Normal', 'Issued'];
  const INVOICE_OPERATION_CODES = [
    1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017, 9400,
    9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205, 1101,
    9065, 9064, 9063, 9062, 9061, 9420, 9026,
  ];

  // Buscar branches (empresas) da API TOTVS no mount
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/totvs/branches`);
        if (response.ok) {
          const result = await response.json();
          let empresas =
            result.success && result.data
              ? result.data.data || result.data
              : [];
          if (!Array.isArray(empresas)) empresas = [];
          const nameMap = {};
          const groupMap = {};
          empresas.forEach((emp) => {
            const code = parseInt(emp.cd_empresa);
            const nome =
              emp.nm_grupoempresa ||
              emp.fantasyName ||
              emp.description ||
              `Empresa ${code}`;
            nameMap[code] = nome;
            groupMap[code] = nome;
          });
          branchDataRef.current = { nameMap, groupMap };
        }
      } catch {
        // silently fail — fallback para nomes genéricos
      }
    };
    fetchBranches();
  }, []);

  // Helper: buscar invoices da API TOTVS e agrupar por loja (grupo empresa)
  const buscarInvoicesAgrupadasPorLoja = async (startDate, endDate) => {
    const result = await apiClient.totvs.invoicesSearch({
      startDate,
      endDate,
      invoiceStatusList: INVOICE_STATUS_LIST,
      operationCodeList: INVOICE_OPERATION_CODES,
    });

    if (!result.success) {
      throw new Error(result.message || 'Erro ao buscar invoices TOTVS');
    }

    const items = (result.data?.items || []).filter((inv) => {
      if (!inv.invoiceDate) return false;
      const d = inv.invoiceDate.slice(0, 10);
      return d >= startDate && d <= endDate;
    });

    const { nameMap, groupMap } = branchDataRef.current;
    const map = {};

    items.forEach((inv) => {
      const code = inv.branchCode ?? 0;
      const grupoKey = groupMap[code] || nameMap[code] || `Empresa ${code}`;

      if (!map[grupoKey]) {
        map[grupoKey] = {
          cd_grupoempresa: code,
          pessoa_empresa: code,
          nome_fantasia: grupoKey,
          nm_loja: grupoKey,
          pa_saida: 0,
          pa_entrada: 0,
          transacoes_saida: 0,
          transacoes_entrada: 0,
          _saidaValue: 0,
          _entradaValue: 0,
        };
      }

      const val = Number(inv.totalValue ?? 0);
      const qty = Number(inv.quantity ?? 0);
      const isEntrada =
        String(inv.operationType || '').toLowerCase() === 'input';

      if (isEntrada) {
        map[grupoKey]._entradaValue += val;
        map[grupoKey].pa_entrada += qty;
        map[grupoKey].transacoes_entrada += 1;
      } else {
        map[grupoKey]._saidaValue += val;
        map[grupoKey].pa_saida += qty;
        map[grupoKey].transacoes_saida += 1;
      }
    });

    return Object.values(map).map((g) => ({
      cd_grupoempresa: g.cd_grupoempresa,
      pessoa_empresa: g.pessoa_empresa,
      nome_fantasia: g.nome_fantasia,
      nm_loja: g.nm_loja,
      faturamento: g._saidaValue - g._entradaValue,
      pa_saida: g.pa_saida,
      pa_entrada: g.pa_entrada,
      transacoes_saida: g.transacoes_saida,
      transacoes_entrada: g.transacoes_entrada,
    }));
  };

  // Função para obter dias do mês (igual ao DRE)
  const obterDiasDoMes = (mesNumero, anoNumero) => {
    // Retorna o último dia do mês considerando ano bissexto
    return new Date(anoNumero, mesNumero, 0).getDate();
  };

  // Função para handle do filtro mensal (igual ao DRE)
  const handleFiltroMensalChange = (mesSigla) => {
    console.log('🎯 handleFiltroMensalChange chamada com:', mesSigla);
    setFiltroMensal(mesSigla);
    if (mesSigla === 'ANO') return; // Não altera datas diretamente

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

    const mesNumero = mesesMap[mesSigla];
    if (!mesNumero) return;

    const anoBase = filtroAno;
    const primeiroDia = `${anoBase}-${String(mesNumero).padStart(2, '0')}-01`;
    const ultimoDiaNum = obterDiasDoMes(mesNumero, anoBase);
    const ultimoDia = `${anoBase}-${String(mesNumero).padStart(
      2,
      '0',
    )}-${String(ultimoDiaNum).padStart(2, '0')}`;

    setFiltros((prev) => ({
      ...prev,
      dt_inicio: primeiroDia,
      dt_fim: ultimoDia,
    }));
  };

  // Função para gerar períodos de semanas baseado no mês selecionado - ISO 8601
  const gerarPeriodosSemanas = (mesSigla, ano) => {
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

    const mesNumero = mesesMap[mesSigla];
    if (!mesNumero) return [];

    const primeiroDia = new Date(ano, mesNumero - 1, 1);
    const ultimoDia = new Date(ano, mesNumero, 0); // Último dia do mês

    console.log(`🔍 Gerando semanas ISO 8601 para ${mesSigla}/${ano}:`, {
      primeiroDia: primeiroDia.toISOString().split('T')[0],
      ultimoDia: ultimoDia.toISOString().split('T')[0],
      mesNumero,
    });

    // Usar a função do hook que já implementa ISO 8601
    const mes = `${ano}-${String(mesNumero).padStart(2, '0')}`;
    const semanas = gerarSemanasDoMes(mes);

    console.log(
      `✅ Total de semanas ISO 8601 geradas para ${mesSigla}/${ano}:`,
      semanas.length,
      semanas,
    );
    return semanas;
  };

  // Gera períodos semanais em blocos de 7 dias iniciando na data inicial (ex.: 01→07, 08→14, ...)
  const gerarPeriodosSemanasPorDatas = (inicioStr, fimStr) => {
    if (!inicioStr || !fimStr) return [];

    const toDateOnly = (d) => {
      // Evita deslocamento de timezone ao parsear 'YYYY-MM-DD'
      if (typeof d === 'string') {
        const [y, m, day] = d.split('-').map((v) => parseInt(v, 10));
        return new Date(y, (m || 1) - 1, day || 1);
      }
      const x = new Date(d);
      return new Date(x.getFullYear(), x.getMonth(), x.getDate());
    };

    const inicio = toDateOnly(inicioStr);
    const fim = toDateOnly(fimStr);
    if (inicio > fim) return [];

    const semanas = [];
    let semanaAtual = 1;
    let cursor = new Date(inicio);
    while (cursor <= fim) {
      const inicioSemana = new Date(cursor);
      // Garante primeira semana começando exatamente no primeiro dia do período
      const fimSemana = new Date(inicioSemana);
      fimSemana.setDate(inicioSemana.getDate() + 6);
      if (fimSemana > fim) fimSemana.setTime(fim.getTime());

      semanas.push({
        numero: semanaAtual,
        inicio: toISODateLocal(inicioSemana),
        fim: toISODateLocal(fimSemana),
        numeroAno:
          typeof obterSemanaAnoISO === 'function'
            ? obterSemanaAnoISO(inicioSemana)
            : undefined,
      });

      cursor.setDate(cursor.getDate() + 7);
      semanaAtual += 1;
    }

    return semanas;
  };

  // Função para carregar dados por semana
  const carregarDadosPorSemana = async (periodosSemanas) => {
    const dadosPorSemana = {};

    for (const semana of periodosSemanas) {
      try {
        // Carregar dados de lojas para esta semana via TOTVS invoicesSearch
        let dadosLojasSemana = [];
        try {
          dadosLojasSemana = await buscarInvoicesAgrupadasPorLoja(
            semana.inicio,
            semana.fim,
          );
        } catch {
          dadosLojasSemana = [];
        }

        dadosPorSemana[semana.numero] = {
          lojas: dadosLojasSemana,
          vendedores: [],
          periodo: semana,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        console.error(
          `Erro ao carregar dados da semana ${semana.numero}:`,
          error,
        );
        dadosPorSemana[semana.numero] = {
          lojas: [],
          vendedores: [],
          periodo: semana,
        };
      }
    }

    return dadosPorSemana;
  };
  const [metaValores, setMetaValores] = useState({});
  const [editingMeta, setEditingMeta] = useState({ chave: null, campo: null });
  const [tempValue, setTempValue] = useState('');
  const [showAddMetasModal, setShowAddMetasModal] = useState(false);
  const [lojasSelecionadasMetas, setLojasSelecionadasMetas] = useState([]);

  // Estados para dados por semana
  const [dadosPorSemana, setDadosPorSemana] = useState({});
  const [semanasCalculadas, setSemanasCalculadas] = useState([]);
  const [vendedoresSelecionadosMetas, setVendedoresSelecionadosMetas] =
    useState([]);
  const [metasBulk, setMetasBulk] = useState({
    bronze: '',
    prata: '',
    ouro: '',
    diamante: '',
  });
  const [tipoMetaBulk, setTipoMetaBulk] = useState('MENSAL'); // 'MENSAL' ou 'SEMANAL'
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [tipoLojaModal, setTipoLojaModal] = useState('Todos'); // 'Todos', 'Proprias', 'Franquias'

  // Limpar lojas selecionadas quando o filtro de tipo de loja for alterado
  useEffect(() => {
    if (showAddMetasModal && rankingTipo === 'lojas') {
      setLojasSelecionadasMetas([]);
    }
  }, [tipoLojaModal, showAddMetasModal, rankingTipo]);

  // Estados para modal de zerar metas
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [isResettingMetas, setIsResettingMetas] = useState(false);
  const [resetCountdown, setResetCountdown] = useState(5);
  const [logAlteracoesReal, setLogAlteracoesReal] = useState([]);
  const [logAlteracoesSemanais, setLogAlteracoesSemanais] = useState([]);
  const [salvandoMeta, setSalvandoMeta] = useState(null); // Para controlar qual meta está sendo salva
  const [viewMode, setViewMode] = useState('tabela'); // 'tabela' ou 'dashboard'
  const [dashboardStats, setDashboardStats] = useState({
    bronze: { lojas: 0, vendedores: 0 },
    prata: { lojas: 0, vendedores: 0 },
    ouro: { lojas: 0, vendedores: 0 },
    diamante: { lojas: 0, vendedores: 0 },
    lojaDetalhes: [],
    vendedorDetalhes: [],
  });

  // Estados para modal de detalhes de metas
  const [showModalMetasDetalhes, setShowModalMetasDetalhes] = useState(false);
  const [metasDetalhesData, setMetasDetalhesData] = useState({
    nivel: null, // 'bronze', 'prata', 'ouro', 'diamante'
    tipo: null, // 'lojas', 'vendedores'
    entidades: [], // Lista de lojas/vendedores que atingiram essa meta
  });
  const [tabelaAtiva, setTabelaAtiva] = useState('lojas'); // 'lojas' ou 'vendedores'

  // Estados para metas semanais
  const [visualizacaoTipo, setVisualizacaoTipo] = useState('MENSAL'); // 'MENSAL' ou 'SEMANAL'
  const [semanas, setSemanas] = useState([]);
  const [metasSemanais, setMetasSemanais] = useState({});
  const [metasMensaisCalculadas, setMetasMensaisCalculadas] = useState({});
  const [detalheSelecionado, setDetalheSelecionado] = useState(null); // Para o modal de detalhes
  const [showDetalheModal, setShowDetalheModal] = useState(false); // Controla a exibição do modal de detalhes
  // Paginação - Dashboard Semanal
  const PAGE_SIZE = 15;
  const [pageLojas, setPageLojas] = useState(0);
  const [pageVendedores, setPageVendedores] = useState(0);

  // Estados para notificações e loading
  const [notification, setNotification] = useState({
    visible: false,
    type: 'success',
    message: '',
  });
  const [isApplyingMetas, setIsApplyingMetas] = useState(false);

  // Função para abrir o modal de detalhes
  const abrirModalDetalhes = (detalhes) => {
    setDetalheSelecionado(detalhes);
    setShowDetalheModal(true);
  };

  // Função para mostrar notificações
  const showNotification = (type, message, duration = 4000) => {
    setNotification({ visible: true, type, message });
    setTimeout(() => {
      setNotification((prev) => ({ ...prev, visible: false }));
    }, duration);
  };

  const hideNotification = () => {
    setNotification((prev) => ({ ...prev, visible: false }));
  };

  const formatBRL = (num) => {
    const n = Number(num);
    if (isNaN(n)) return 'R$ 0,00';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  // Formata Date para YYYY-MM-DD respeitando fuso local
  const toISODateLocal = (d) => {
    const date = new Date(d);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Formata data ISO (YYYY-MM-DD) para DD/MM
  const formatDM = (iso) => {
    if (!iso || typeof iso !== 'string') return '';
    const parts = iso.split('-');
    if (parts.length !== 3) return '';
    const [yyyy, mm, dd] = parts;
    return `${dd.padStart(2, '0')}/${mm.padStart(2, '0')}`;
  };

  // Função para calcular dias restantes da semana
  const calcularDiasRestantesSemana = (fimSemana) => {
    const hoje = new Date();
    const fim = new Date(fimSemana);

    // Normalizar as datas para comparar apenas o dia (sem hora)
    const hojeNormalizado = new Date(
      hoje.getFullYear(),
      hoje.getMonth(),
      hoje.getDate(),
    );
    const fimNormalizado = new Date(
      fim.getFullYear(),
      fim.getMonth(),
      fim.getDate(),
    );

    const diffTime = fimNormalizado - hojeNormalizado;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // Se a diferença for negativa, a semana já passou
    // Se for 0, é o último dia da semana
    // Se for positiva, são os dias restantes
    return Math.max(0, diffDays);
  };

  // Calcula quanto falta por dia para bater a meta semanal
  const calcularFaltaPorDia = (faltante, fimSemana) => {
    const falt = Number(faltante) || 0;
    const dias = calcularDiasRestantesSemana(fimSemana);
    if (!dias || dias <= 0 || falt <= 0) return 0;
    return falt / dias;
  };

  // Limpa caracteres inválidos, permite números e separadores "," e "."
  const sanitizeInput = (value) => {
    return String(value ?? '').replace(/[^0-9,\.]/g, '');
  };

  // Converte string para número em reais ("R$ 1.234,56" -> 1234.56)
  const toNumber = (value) => {
    if (value === '' || value === null || value === undefined) return 0;

    // Remover R$ e espaços
    const withoutCurrency = String(value).replace(/R\$\s*/g, '');

    // Remover pontos de milhar e substituir vírgula por ponto
    const normalized = withoutCurrency.replace(/\./g, '').replace(',', '.');

    const n = parseFloat(normalized);
    return isNaN(n) ? 0 : n;
  };

  const iniciarEdicaoMetaSemanal = (chave, tipo, nome, nivel, numeroSemana) => {
    // Buscar valor atual das metas semanais
    const chaveMetaSemanal = `${tipo}-${nome}`;
    const metaSemanal = metasSemanais[chaveMetaSemanal];
    let valorAtual = '';

    // Acessar os dados na estrutura correta: semanas[numero].metas[nivel]
    if (
      metaSemanal &&
      metaSemanal.semanas &&
      metaSemanal.semanas[numeroSemana] &&
      metaSemanal.semanas[numeroSemana].metas &&
      metaSemanal.semanas[numeroSemana].metas[nivel]
    ) {
      valorAtual = String(metaSemanal.semanas[numeroSemana].metas[nivel])
        .replace(/[^0-9,\.]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    }

    setEditingMeta({
      chave,
      campo: nivel,
      tipo,
      nome,
      numeroSemana,
    });
    setTempValue(valorAtual);
  };

  const iniciarEdicaoMeta = (chave) => {
    const atual = metaValores[chave] || '';
    // Converter "R$ 1.234,56" para "1234.56" no input
    const current = String(atual)
      .replace(/[^0-9,\.]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    setEditingMeta({ chave, campo: chave.split('-').pop() });
    setTempValue(current);
  };

  const cancelarEdicaoMeta = () => {
    setEditingMeta({ chave: null, campo: null });
    setTempValue('');
  };

  const confirmarEdicaoMetaSemanal = async () => {
    if (!editingMeta.chave || !tempValue) return;

    const numero = toNumber(tempValue);
    const valorFormatado = formatBRL(numero);

    // Indicar que está salvando
    setSalvandoMeta(editingMeta.chave);

    // Salvar meta semanal
    const mes = filtros.dt_inicio
      ? filtros.dt_inicio.substring(0, 7)
      : new Date().toISOString().substring(0, 7);

    const metaSemanalData = {
      tipo: editingMeta.tipo,
      nome: editingMeta.nome,
      mes: mes,
      semana: editingMeta.numeroSemana,
      nivel: editingMeta.campo,
      valor: numero,
      usuario: user?.name || 'Usuário Anônimo',
    };

    const resultado = await salvarMetaSemanalIndividual(metaSemanalData);

    if (resultado && resultado.success) {
      // Atualizar estado local das metas semanais
      setMetasSemanais((prev) => {
        const chave = `${editingMeta.tipo}-${editingMeta.nome}`;
        const atual = prev[chave] || {};

        // Garantir que a estrutura de semanas existe
        if (!atual.semanas) {
          atual.semanas = {};
        }
        if (!atual.semanas[editingMeta.numeroSemana]) {
          atual.semanas[editingMeta.numeroSemana] = {
            numero: editingMeta.numeroSemana,
            metas: {},
          };
        }
        if (!atual.semanas[editingMeta.numeroSemana].metas) {
          atual.semanas[editingMeta.numeroSemana].metas = {};
        }

        return {
          ...prev,
          [chave]: {
            ...atual,
            semanas: {
              ...atual.semanas,
              [editingMeta.numeroSemana]: {
                ...atual.semanas[editingMeta.numeroSemana],
                metas: {
                  ...atual.semanas[editingMeta.numeroSemana].metas,
                  [editingMeta.campo]: numero,
                },
              },
            },
          },
        };
      });

      // Recalcular metas mensais (soma das semanais)
      await recalcularMetasMensais(mes, editingMeta.tipo, editingMeta.nome);

      // Atualizar estado local com as metas mensais calculadas
      await atualizarMetasMensaisCalculadas(
        mes,
        editingMeta.tipo,
        editingMeta.nome,
      );
    } else {
      console.error('Erro ao salvar meta semanal:', resultado.error);

      // Mostrar mensagem de erro mais específica
      const isNetworkError =
        resultado.error?.includes('conexão') ||
        resultado.error?.includes('internet') ||
        resultado.error?.includes('Failed to fetch');

      if (isNetworkError) {
        alert(
          '❌ Erro de conexão!\n\nVerifique sua internet e tente novamente.\nSe o problema persistir, pode ser um problema temporário do servidor.',
        );
      } else {
        alert(
          `❌ Erro ao salvar meta semanal:\n\n${resultado.error}\n\nTente novamente.`,
        );
      }
    }

    // Finalizar salvamento
    setSalvandoMeta(null);
    setEditingMeta({ chave: null, campo: null });
    setTempValue('');
  };

  const confirmarEdicaoMeta = async () => {
    if (!editingMeta.chave) return;
    const numero = toNumber(tempValue); // já em reais
    const valorFormatado = formatBRL(numero);

    // Indicar que está salvando
    setSalvandoMeta(editingMeta.chave);

    // Atualizar estado local
    setMetaValores((prev) => ({
      ...prev,
      [editingMeta.chave]: valorFormatado,
    }));

    // Parse da chave para obter tipo, nome e campo
    const partes = editingMeta.chave.split('-');
    const tipo = partes[0]; // 'lojas' ou 'vendedores'
    const campo = partes[partes.length - 1]; // 'bronze', 'prata', 'ouro', 'diamante'
    const nome = partes.slice(1, -1).join('-'); // nome da loja/vendedor

    const mes = filtros.dt_inicio
      ? filtros.dt_inicio.substring(0, 7)
      : new Date().toISOString().substring(0, 7);

    // Se estamos na visualização MENSAL, salvar meta mensal e calcular semanais
    if (visualizacaoTipo === 'MENSAL') {
      const resultado = await salvarMetaMensalComCalculoSemanal(
        tipo,
        nome,
        mes,
        campo,
        numero,
        user?.name || 'Usuário Anônimo',
      );

      if (resultado && resultado.success) {
        // Recarregar dados semanais para mostrar os valores calculados
        await carregarDadosSemanais();

        // Salvar também na tabela de metas mensais tradicionais
        await salvarMetaIndividual(editingMeta.chave, valorFormatado);
      } else {
        console.error('❌ Erro ao salvar meta mensal:', resultado.error);
        alert('Erro ao salvar meta mensal. Tente novamente.');
      }
    } else {
      // Se estamos na visualização SEMANAL, salvar apenas a meta semanal
      await salvarMetaIndividual(editingMeta.chave, valorFormatado);
    }

    // Finalizar salvamento
    setSalvandoMeta(null);
    cancelarEdicaoMeta();
  };

  const salvarMetaIndividual = async (chave, valor) => {
    try {
      // Parse da chave: "lojas-NOME-bronze" ou "vendedores-NOME-bronze"
      // Como o nome pode ter hífens, precisamos fazer o split de forma inteligente
      const partes = chave.split('-');
      const tipo = partes[0]; // 'lojas' ou 'vendedores'
      const campo = partes[partes.length - 1]; // 'bronze', 'prata', 'ouro', 'diamante' (sempre o último)
      const nome = partes.slice(1, -1).join('-'); // tudo entre o tipo e o campo

      const mesAtual = filtros.dt_inicio
        ? filtros.dt_inicio.substring(0, 7)
        : new Date().toISOString().substring(0, 7);

      // Preparar dados para salvar
      const metaData = [
        {
          tipo: tipo,
          nome: nome,
          metas: { [campo]: valor },
          mes: mesAtual,
          usuario: user?.name || 'Usuário Anônimo',
        },
      ];

      // Salvar no banco
      const resultado = await salvarMetas(metaData);

      if (resultado && resultado.success) {
        // Recarregar log de alterações
        await carregarLogAlteracoes();
      } else {
        console.error('Erro ao salvar meta individual:', resultado.error);
        // Reverter mudança local em caso de erro
        setMetaValores((prev) => ({ ...prev, [chave]: metaValores[chave] }));
        showNotification('error', 'Erro ao salvar meta. Tente novamente.');
      }
    } catch (error) {
      console.error('Erro ao salvar meta individual:', error);
      // Reverter mudança local em caso de erro
      setMetaValores((prev) => ({ ...prev, [chave]: metaValores[chave] }));

      // Mostrar mensagem mais amigável para o usuário
      if (
        error.message.includes('duplicate key value violates unique constraint')
      ) {
        alert(
          'Esta meta já existe para este período. A meta foi atualizada com sucesso!',
        );
      } else {
        showNotification('error', 'Erro ao salvar meta. Tente novamente.');
      }
    } finally {
      // Sempre finalizar o estado de salvamento
      setSalvandoMeta(null);
    }
  };

  const abrirModalMetas = () => {
    setShowAddMetasModal(true);
  };

  const fecharModalMetas = () => {
    setShowAddMetasModal(false);
    setLojasSelecionadasMetas([]);
    setVendedoresSelecionadosMetas([]);
    setMetasBulk({ bronze: '', prata: '', ouro: '', diamante: '' });
    setShowConfirmModal(false);
    setTipoLojaModal('Todos'); // Resetar filtro de tipo de loja
  };

  const confirmarAplicarMetas = () => {
    setShowConfirmModal(true);
  };

  const aplicarMetasEmLote = async () => {
    setIsApplyingMetas(true);

    // Converter valores informados
    const valoresNumericos = {};
    const valoresFormatados = {};
    ['bronze', 'prata', 'ouro', 'diamante'].forEach((campo) => {
      if (metasBulk[campo] !== '') {
        const n = toNumber(metasBulk[campo]);
        valoresNumericos[campo] = n;
        valoresFormatados[campo] = formatBRL(n);
      }
    });

    // Para metas semanais, não verificar valoresNumericos tradicionais
    if (
      tipoMetaBulk === 'MENSAL' &&
      Object.keys(valoresNumericos).length === 0
    ) {
      setShowConfirmModal(false);
      fecharModalMetas();
      return;
    }

    const mesAtual = filtros.dt_inicio
      ? filtros.dt_inicio.substring(0, 7)
      : new Date().toISOString().substring(0, 7);

    try {
      if (tipoMetaBulk === 'MENSAL') {
        // Lógica para meta MENSAL: salvar mensal e calcular semanais

        const promessas = [];

        if (rankingTipo === 'lojas') {
          if (lojasSelecionadasMetas.length === 0) {
            setShowConfirmModal(false);
            fecharModalMetas();
            return;
          }

          lojasSelecionadasMetas.forEach((loja) => {
            const nomeSel = (
              loja.nome_fantasia ||
              loja.nm_loja ||
              loja.nome ||
              loja.loja ||
              ''
            ).toUpperCase();

            Object.entries(valoresNumericos).forEach(([campo, valor]) => {
              promessas.push(
                salvarMetaMensalComCalculoSemanal(
                  'lojas',
                  nomeSel,
                  mesAtual,
                  campo,
                  valor,
                  user?.name || 'Usuário Anônimo',
                ),
              );
            });
          });
        } else if (rankingTipo === 'vendedores') {
          if (vendedoresSelecionadosMetas.length === 0) {
            setShowConfirmModal(false);
            fecharModalMetas();
            return;
          }

          vendedoresSelecionadosMetas.forEach((vendedor) => {
            const nomeSel = (
              vendedor.nome_vendedor ||
              vendedor.vendedor ||
              vendedor.nm_vendedor ||
              vendedor.nome ||
              ''
            ).toUpperCase();

            Object.entries(valoresNumericos).forEach(([campo, valor]) => {
              promessas.push(
                salvarMetaMensalComCalculoSemanal(
                  'vendedores',
                  nomeSel,
                  mesAtual,
                  campo,
                  valor,
                  user?.name || 'Usuário Anônimo',
                ),
              );
            });
          });
        }

        // Executar todas as operações
        const resultados = await Promise.all(promessas);
        const sucessos = resultados.filter((r) => r.success).length;
        const falhas = resultados.filter((r) => !r.success).length;

        console.log(`🔍 Resultado: ${sucessos} sucessos, ${falhas} falhas`);

        if (sucessos > 0) {
          // Recarregar dados semanais para mostrar os valores calculados
          await carregarDadosSemanais();

          // Atualizar estado local das metas mensais
          setMetaValores((prev) => {
            const atualizados = { ...prev };
            if (rankingTipo === 'lojas') {
              lojasSelecionadasMetas.forEach((loja) => {
                const nomeSel = (
                  loja.nome_fantasia ||
                  loja.nm_loja ||
                  loja.nome ||
                  loja.loja ||
                  ''
                ).toUpperCase();
                Object.entries(valoresFormatados).forEach(([k, v]) => {
                  const chave = `lojas-${nomeSel}-${k}`;
                  atualizados[chave] = v;
                });
              });
            } else if (rankingTipo === 'vendedores') {
              vendedoresSelecionadosMetas.forEach((vendedor) => {
                const nomeSel = (
                  vendedor.nome_vendedor ||
                  vendedor.vendedor ||
                  vendedor.nm_vendedor ||
                  vendedor.nome ||
                  ''
                ).toUpperCase();
                Object.entries(valoresFormatados).forEach(([k, v]) => {
                  const chave = `vendedores-${nomeSel}-${k}`;
                  atualizados[chave] = v;
                });
              });
            }
            return atualizados;
          });

          // Recarregar log de alterações
          await carregarLogAlteracoes();
        }

        if (falhas > 0) {
          alert(
            `❌ ${falhas} metas falharam ao ser salvas. Verifique os logs.`,
          );
        }
      } else if (tipoMetaBulk === 'SEMANAL') {
        // Lógica para meta SEMANAL: aplicar valores específicos por semana

        // Processar valores específicos por semana
        const valoresPorSemana = {};

        semanas.forEach((semana) => {
          valoresPorSemana[semana.numero] = {};
          ['bronze', 'prata', 'ouro', 'diamante'].forEach((nivel) => {
            const chave = `${nivel}_semana_${semana.numero}`;
            if (metasBulk[chave] && metasBulk[chave] !== '') {
              const valorNumerico = toNumber(metasBulk[chave]);
              valoresPorSemana[semana.numero][nivel] = valorNumerico;
            }
          });
        });

        // Verificar se há valores para processar
        const temValores = Object.values(valoresPorSemana).some(
          (semana) => Object.keys(semana).length > 0,
        );

        if (!temValores) {
          showNotification(
            'warning',
            'Nenhum valor foi preenchido para aplicar as metas semanais.',
          );
          setShowConfirmModal(false);
          fecharModalMetas();
          setIsApplyingMetas(false);
          return;
        }

        const promessas = [];

        if (rankingTipo === 'lojas') {
          if (lojasSelecionadasMetas.length === 0) {
            setShowConfirmModal(false);
            fecharModalMetas();
            return;
          }

          lojasSelecionadasMetas.forEach((loja) => {
            const nomeSel = (
              loja.nome_fantasia ||
              loja.nm_loja ||
              loja.nome ||
              loja.loja ||
              ''
            ).toUpperCase();

            // Aplicar valores específicos para cada semana
            Object.entries(valoresPorSemana).forEach(
              ([numeroSemana, valores]) => {
                Object.entries(valores).forEach(([nivel, valor]) => {
                  promessas.push(
                    salvarMetaSemanalIndividual({
                      tipo: 'lojas',
                      nome: nomeSel,
                      mes: mesAtual,
                      semana: parseInt(numeroSemana),
                      nivel: nivel,
                      valor: valor,
                      usuario: user?.name || 'Usuário Anônimo',
                    }),
                  );
                });
              },
            );
          });
        } else if (rankingTipo === 'vendedores') {
          if (vendedoresSelecionadosMetas.length === 0) {
            setShowConfirmModal(false);
            fecharModalMetas();
            return;
          }

          vendedoresSelecionadosMetas.forEach((vendedor) => {
            const nomeSel = (
              vendedor.nome_vendedor ||
              vendedor.vendedor ||
              vendedor.nm_vendedor ||
              vendedor.nome ||
              ''
            ).toUpperCase();

            // Aplicar valores específicos para cada semana
            Object.entries(valoresPorSemana).forEach(
              ([numeroSemana, valores]) => {
                Object.entries(valores).forEach(([nivel, valor]) => {
                  promessas.push(
                    salvarMetaSemanalIndividual({
                      tipo: 'vendedores',
                      nome: nomeSel,
                      mes: mesAtual,
                      semana: parseInt(numeroSemana),
                      nivel: nivel,
                      valor: valor,
                      usuario: user?.name || 'Usuário Anônimo',
                    }),
                  );
                });
              },
            );
          });
        }

        if (promessas.length === 0) {
          showNotification(
            'warning',
            'Nenhuma operação será executada. Verifique se preencheu os campos e selecionou as lojas.',
          );
          setShowConfirmModal(false);
          fecharModalMetas();
          setIsApplyingMetas(false);
          return;
        }

        // Executar todas as operações
        const resultados = await Promise.all(promessas);
        const sucessos = resultados.filter((r) => r.success).length;
        const falhas = resultados.filter((r) => !r.success).length;

        if (sucessos > 0) {
          // Recarregar dados semanais
          await carregarDadosSemanais();

          // Recalcular metas mensais
          await recalcularMetasMensais(mesAtual, rankingTipo);

          // Atualizar estado local com as metas mensais calculadas
          await atualizarMetasMensaisCalculadas(mesAtual, rankingTipo);

          // Recarregar log de alterações
          await carregarLogAlteracoes();

          showNotification(
            'success',
            `${sucessos} metas semanais foram aplicadas com sucesso!`,
          );
        }

        if (falhas > 0) {
          showNotification(
            'error',
            `${falhas} metas falharam ao ser salvas. Verifique os logs no console.`,
          );
        }
      }
    } catch (error) {
      console.error('❌ Erro ao aplicar metas em lote:', error);
      showNotification(
        'error',
        'Erro ao aplicar metas em lote. Tente novamente.',
      );
    } finally {
      setIsApplyingMetas(false);
    }

    setShowConfirmModal(false);
    fecharModalMetas();
  };

  const cancelarAplicarMetas = () => {
    setShowConfirmModal(false);
  };

  // Função para abrir modal de confirmação de zerar metas
  const abrirModalZerarMetas = () => {
    setResetCountdown(5);
    setShowResetConfirmModal(true);

    // Iniciar countdown de 5 segundos
    const interval = setInterval(() => {
      setResetCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Função para cancelar zerar metas
  const cancelarZerarMetas = () => {
    setShowResetConfirmModal(false);
    setResetCountdown(5);
  };

  // Função para zerar metas do período selecionado
  const zerarMetasDoPeriodo = async () => {
    setIsResettingMetas(true);

    try {
      const mesAtual = filtros.dt_inicio
        ? filtros.dt_inicio.substring(0, 7)
        : new Date().toISOString().substring(0, 7);

      console.log('🔍 Zerando metas do período:', mesAtual);

      // Preparar dados para excluir metas
      const metasParaZerar = [];
      const criteriosExclusao = [];

      if (tipoMetaBulk === 'MENSAL') {
        // Excluir metas mensais
        const criteriosMensais = [];

        if (rankingTipo === 'lojas') {
          if (!lojasSelecionadasMetas || lojasSelecionadasMetas.length === 0) {
            throw new Error('Nenhuma loja selecionada para excluir metas.');
          }

          lojasSelecionadasMetas.forEach((loja) => {
            const nomeLoja =
              loja.nome_fantasia ||
              loja.nm_loja ||
              loja.nome ||
              loja.loja ||
              '';

            if (!nomeLoja) {
              console.warn('Loja sem nome válido:', loja);
              return;
            }

            // Criar um critério para excluir todas as metas desta loja
            criteriosMensais.push({
              tipo: 'lojas',
              nome: nomeLoja,
              mes: mesAtual,
            });
          });
        } else {
          if (
            !vendedoresSelecionadosMetas ||
            vendedoresSelecionadosMetas.length === 0
          ) {
            throw new Error('Nenhum vendedor selecionado para excluir metas.');
          }

          vendedoresSelecionadosMetas.forEach((vendedor) => {
            const nomeVendedor =
              vendedor.nome_vendedor ||
              vendedor.vendedor ||
              vendedor.nm_vendedor ||
              vendedor.nome ||
              '';

            if (!nomeVendedor) {
              console.warn('Vendedor sem nome válido:', vendedor);
              return;
            }

            // Criar um critério para excluir todas as metas deste vendedor
            criteriosMensais.push({
              tipo: 'vendedores',
              nome: nomeVendedor,
              mes: mesAtual,
            });
          });
        }

        // Verificar se temos critérios para exclusão
        if (criteriosMensais.length === 0) {
          throw new Error(
            'Nenhum critério válido encontrado para exclusão. Verifique as seleções.',
          );
        }

        console.log(
          `🗑️ Excluindo metas mensais para ${criteriosMensais.length} entidades...`,
        );

        // Excluir metas mensais usando a nova função
        const promessasMetas = criteriosMensais.map((criterio) =>
          deletarMetasPorCriterios(criterio),
        );

        // Excluir também as metas mensais calculadas
        const promessasCalculadas = criteriosMensais.map((criterio) =>
          deletarMetasMensaisCalculadas(criterio),
        );

        // Combinar todas as promessas
        const todasPromessas = [...promessasMetas, ...promessasCalculadas];
        const resultados = await Promise.all(todasPromessas);

        console.log('🔍 Resultados das operações de exclusão:', resultados);

        // Verificar se todas as operações foram bem-sucedidas
        const todasSucesso = resultados.every(
          (resultado) => resultado && resultado.success,
        );

        if (todasSucesso) {
          // Limpar o estado local
          setMetaValores((prev) => {
            const novoEstado = { ...prev };
            criteriosMensais.forEach((criterio) => {
              ['bronze', 'prata', 'ouro', 'diamante'].forEach((nivel) => {
                const chave = `${criterio.tipo}-${criterio.nome}-${nivel}`;
                delete novoEstado[chave];
              });
            });
            return novoEstado;
          });

          // Recarregar dados
          await carregarMetasExistentes();
          await carregarLogAlteracoes();

          setNotification({
            visible: true,
            type: 'success',
            message: 'Metas mensais excluídas com sucesso!',
          });
        } else {
          const erros = resultados
            .filter((resultado) => !resultado || !resultado.success)
            .map((resultado) => resultado?.error || 'Erro desconhecido')
            .join(', ');

          throw new Error(`Erro ao excluir metas mensais: ${erros}`);
        }
      } else {
        // Excluir metas semanais
        // Verificar se temos semanas calculadas
        if (!semanasCalculadas || semanasCalculadas.length === 0) {
          throw new Error(
            'Nenhuma semana disponível para excluir metas semanais. Verifique se o período está correto.',
          );
        }

        if (rankingTipo === 'lojas') {
          if (!lojasSelecionadasMetas || lojasSelecionadasMetas.length === 0) {
            throw new Error('Nenhuma loja selecionada para excluir metas.');
          }

          lojasSelecionadasMetas.forEach((loja) => {
            const nomeLoja =
              loja.nome_fantasia ||
              loja.nm_loja ||
              loja.nome ||
              loja.loja ||
              '';

            if (!nomeLoja) {
              console.warn('Loja sem nome válido:', loja);
              return;
            }

            semanasCalculadas.forEach((semana) => {
              if (!semana || !semana.numero) {
                console.warn('Semana inválida:', semana);
                return;
              }

              // Adicionar um critério para excluir todas as metas desta loja/semana de uma vez
              criteriosExclusao.push({
                mes: mesAtual,
                tipo: 'lojas',
                nome: nomeLoja,
                semana: semana.numero,
              });
            });
          });
        } else {
          if (
            !vendedoresSelecionadosMetas ||
            vendedoresSelecionadosMetas.length === 0
          ) {
            throw new Error('Nenhum vendedor selecionado para excluir metas.');
          }

          vendedoresSelecionadosMetas.forEach((vendedor) => {
            const nomeVendedor =
              vendedor.nome_vendedor ||
              vendedor.vendedor ||
              vendedor.nm_vendedor ||
              vendedor.nome ||
              '';

            if (!nomeVendedor) {
              console.warn('Vendedor sem nome válido:', vendedor);
              return;
            }

            semanasCalculadas.forEach((semana) => {
              if (!semana || !semana.numero) {
                console.warn('Semana inválida:', semana);
                return;
              }

              // Adicionar um critério para excluir todas as metas deste vendedor/semana de uma vez
              criteriosExclusao.push({
                mes: mesAtual,
                tipo: 'vendedores',
                nome: nomeVendedor,
                semana: semana.numero,
              });
            });
          });
        }

        // Verificar se temos critérios para exclusão
        if (criteriosExclusao.length === 0) {
          throw new Error(
            'Nenhum critério válido encontrado para exclusão. Verifique as seleções.',
          );
        }

        console.log(
          `🗑️ Excluindo ${criteriosExclusao.length} metas semanais...`,
        );
        console.log('🔍 Critérios de exclusão:', criteriosExclusao);

        // Excluir metas semanais usando a nova função
        console.log(
          `🗑️ Iniciando exclusão de ${criteriosExclusao.length} metas semanais...`,
        );

        const promessas = criteriosExclusao.map((criterio) =>
          deletarMetasSemanaisPorCriterios(criterio),
        );

        const resultados = await Promise.all(promessas);
        console.log(
          '🔍 Resultados das operações de exclusão de metas semanais:',
          resultados,
        );

        // Verificar se todas as operações foram bem-sucedidas
        const todasSucesso = resultados.every(
          (resultado) => resultado && resultado.success,
        );

        if (todasSucesso) {
          // Limpar o estado local das metas semanais
          setMetasSemanais({});

          // Recarregar dados
          await carregarMetasExistentes();

          // Recarregar dados semanais se a visualização for SEMANAL
          if (visualizacaoTipo === 'SEMANAL') {
            console.log('🔄 Recarregando dados semanais após exclusão...');
            await carregarDadosSemanais();
            console.log('✅ Dados semanais recarregados');
          }

          await carregarLogAlteracoes();

          setNotification({
            visible: true,
            type: 'success',
            message: 'Metas semanais excluídas com sucesso!',
          });
        } else {
          const erros = resultados
            .filter((resultado) => !resultado || !resultado.success)
            .map((resultado) => resultado?.error || 'Erro desconhecido')
            .join(', ');

          throw new Error(`Erro ao excluir metas semanais: ${erros}`);
        }
      }
    } catch (error) {
      console.error('❌ Erro ao excluir metas:', error);
      setNotification({
        visible: true,
        type: 'error',
        message: `Erro ao excluir metas: ${error.message}`,
      });
    } finally {
      setIsResettingMetas(false);
      setShowResetConfirmModal(false);
      setResetCountdown(5);
    }
  };

  const carregarLogAlteracoes = async () => {
    // Carregar logs de metas tradicionais
    const resultado = await buscarLogAlteracoes();
    if (resultado && resultado.success) {
      setLogAlteracoesReal(resultado.data);
    }

    // Carregar logs de metas semanais
    const resultadoSemanais = await buscarLogAlteracoesSemanais();
    if (resultadoSemanais.success) {
      setLogAlteracoesSemanais(resultadoSemanais.data);
    }
  };

  const abrirLogModal = async () => {
    await carregarLogAlteracoes();
    setShowLogModal(true);
  };

  const fecharLogModal = () => {
    setShowLogModal(false);
  };

  // Dados mocados para o log de alterações
  const logAlteracoes = [
    {
      id: 1,
      tipo: 'lojas',
      nome: 'CROSBY SHOPPING MIDWAY',
      campo: 'bronze',
      valorAnterior: 'R$ 0,00',
      valorNovo: 'R$ 50.000,00',
      usuario: 'João Silva',
      data: '2024-01-15 14:30:25',
    },
    {
      id: 2,
      tipo: 'vendedores',
      nome: 'MARIA SANTOS',
      campo: 'prata',
      valorAnterior: 'R$ 25.000,00',
      valorNovo: 'R$ 75.000,00',
      usuario: 'Ana Costa',
      data: '2024-01-14 09:15:42',
    },
    {
      id: 3,
      tipo: 'lojas',
      nome: 'CROSBY VILLA LOBOS',
      campo: 'ouro',
      valorAnterior: 'R$ 0,00',
      valorNovo: 'R$ 100.000,00',
      usuario: 'Pedro Oliveira',
      data: '2024-01-13 16:45:18',
    },
    {
      id: 4,
      tipo: 'vendedores',
      nome: 'CARLOS FERREIRA',
      campo: 'diamante',
      valorAnterior: 'R$ 150.000,00',
      valorNovo: 'R$ 200.000,00',
      usuario: 'João Silva',
      data: '2024-01-12 11:20:35',
    },
    {
      id: 5,
      tipo: 'lojas',
      nome: 'CROSBY IBIRAPUERA',
      campo: 'bronze',
      valorAnterior: 'R$ 30.000,00',
      valorNovo: 'R$ 60.000,00',
      usuario: 'Maria Santos',
      data: '2024-01-11 13:10:50',
    },
  ];

  const renderCellEditorSemanal = (
    tipo,
    nome,
    nivel,
    numeroSemana,
    colorClass = 'text-amber-700',
  ) => {
    const chaveSemanal = `${tipo}-${nome}-${nivel}-semana-${numeroSemana}`;
    const isEditing = editingMeta.chave === chaveSemanal;
    const isSaving = salvandoMeta === chaveSemanal;

    // Buscar valor das metas semanais
    const chaveMetaSemanal = `${tipo}-${nome}`;
    const metaSemanal = metasSemanais[chaveMetaSemanal];
    let valorAtual = '';

    // Acessar os dados na estrutura correta: semanas[numero].metas[nivel]
    if (
      metaSemanal &&
      metaSemanal.semanas &&
      metaSemanal.semanas[numeroSemana] &&
      metaSemanal.semanas[numeroSemana].metas &&
      metaSemanal.semanas[numeroSemana].metas[nivel]
    ) {
      valorAtual = formatBRL(metaSemanal.semanas[numeroSemana].metas[nivel]);
    }

    if (isEditing) {
      return (
        <div className="flex flex-col items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            className="w-16 px-1 py-0.5 border border-blue-400 rounded text-[7px] text-center focus:outline-none focus:ring-1 focus:ring-blue-400 bg-blue-50"
            value={tempValue}
            placeholder="0,00"
            onChange={(e) => setTempValue(sanitizeInput(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirmarEdicaoMetaSemanal();
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="text-[7px] bg-gray-500 text-white px-1 py-0.5 rounded"
            onClick={cancelarEdicaoMeta}
          >
            X
          </button>
        </div>
      );
    }

    return (
      <span
        className={`${colorClass} font-bold cursor-pointer select-none ${
          isSaving ? 'opacity-50' : ''
        }`}
        onClick={() =>
          !isSaving &&
          iniciarEdicaoMetaSemanal(
            chaveSemanal,
            tipo,
            nome,
            nivel,
            numeroSemana,
          )
        }
      >
        {valorAtual || '-'}
      </span>
    );
  };

  const renderCellEditor = (cellKey, colorClass = 'text-amber-700') => {
    const isEditing = editingMeta.chave === cellKey;
    const isSaving = salvandoMeta === cellKey;

    if (isEditing) {
      return (
        <div className="flex flex-col items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            className="w-20 px-2 py-0.5 border border-blue-400 rounded text-[11px] text-center focus:outline-none focus:ring-1 focus:ring-blue-400 bg-blue-50"
            value={tempValue}
            placeholder="0,00"
            onChange={(e) => setTempValue(sanitizeInput(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirmarEdicaoMeta();
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="text-[11px] bg-gray-500 text-white px-2 py-0.5 rounded"
            onClick={cancelarEdicaoMeta}
          >
            Cancelar
          </button>
        </div>
      );
    }

    const exibicao = metaValores[cellKey] || 'R$ 0,00';
    return (
      <span
        className={`${colorClass} font-bold cursor-pointer select-none ${
          isSaving ? 'opacity-50' : ''
        }`}
        onClick={() => !isSaving && iniciarEdicaoMeta(cellKey)}
      >
        {isSaving ? 'Salvando...' : exibicao}
      </span>
    );
  };

  const handleMetaChange = (chave, _campo, valor) => {
    setMetaValores((prev) => ({
      ...prev,
      [chave]: valor,
    }));
  };

  useEffect(() => {
    // Inicializar filtro com mês atual
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1; // 0-11 para 1-12
    const anoAtual = hoje.getFullYear();

    const mesesMap = {
      1: 'JAN',
      2: 'FEV',
      3: 'MAR',
      4: 'ABR',
      5: 'MAI',
      6: 'JUN',
      7: 'JUL',
      8: 'AGO',
      9: 'SET',
      10: 'OUT',
      11: 'NOV',
      12: 'DEZ',
    };

    const mesSigla = mesesMap[mesAtual];
    if (mesSigla) {
      setFiltroMensal(mesSigla);
      setFiltroAno(anoAtual);

      // Definir datas do mês atual
      const primeiroDia = `${anoAtual}-${String(mesAtual).padStart(2, '0')}-01`;
      const ultimoDiaNum = obterDiasDoMes(mesAtual, anoAtual);
      const ultimoDia = `${anoAtual}-${String(mesAtual).padStart(
        2,
        '0',
      )}-${String(ultimoDiaNum).padStart(2, '0')}`;

      setFiltros({
        dt_inicio: primeiroDia,
        dt_fim: ultimoDia,
      });
    }
  }, []);

  // Recalcular estatísticas quando metas, dados ou filtros mudarem
  useEffect(() => {
    if (
      viewMode === 'dashboard' &&
      (dadosLojas.length > 0 || dadosVendedores.length > 0)
    ) {
      // Sempre chamar calcularStatsDashboard - ela agora verifica visualizacaoTipo internamente
      calcularStatsDashboard();
    }
  }, [
    metaValores,
    dadosLojas,
    dadosVendedores,
    viewMode,
    tipoLoja,
    lojasSelecionadas,
    vendedoresSelecionados,
    visualizacaoTipo,
    semanasCalculadas,
    metasSemanais,
  ]);

  // Carregar dados semanais quando visualização mudar para SEMANAL
  useEffect(() => {
    if (visualizacaoTipo === 'SEMANAL' && filtros.dt_inicio) {
      console.log(
        '🔍 Carregando dados semanais - visualização mudou para SEMANAL',
      );
      carregarDadosSemanais();
    }
  }, [visualizacaoTipo, filtros.dt_inicio]);

  // Carregar dados semanais automaticamente quando a página carregar (para debug)
  useEffect(() => {
    if (filtros.dt_inicio) {
      console.log(
        '🔍 Carregando dados semanais automaticamente na inicialização',
      );
      carregarDadosSemanais();
    }
  }, [filtros.dt_inicio]);

  // Função para abrir modal de detalhes de metas
  const abrirModalMetasDetalhes = (nivel, tipo) => {
    const detalhes =
      tipo === 'lojas'
        ? dashboardStats.lojaDetalhes
        : dashboardStats.vendedorDetalhes;

    // Filtrar entidades que atingiram ou ultrapassaram a meta do nível especificado
    const entidadesFiltradas = detalhes
      .filter((entidade) => {
        const metaNivel = entidade.metas[nivel] || 0;
        // Usar faturamentoSemanal se em modo SEMANAL, senão usar faturamento (mensal)
        const faturamentoParaComparar =
          visualizacaoTipo === 'SEMANAL'
            ? entidade.faturamentoSemanal
            : entidade.faturamento;
        return metaNivel > 0 && faturamentoParaComparar >= metaNivel;
      })
      .map((entidade) => ({
        nome: entidade.nome,
        meta: entidade.metas[nivel],
        // Exibir faturamentoSemanal se em modo SEMANAL, senão faturamento (mensal)
        faturamento:
          visualizacaoTipo === 'SEMANAL'
            ? entidade.faturamentoSemanal
            : entidade.faturamento,
        semana: `S${calcularSemanaAtual(
          filtros.dt_inicio
            ? filtros.dt_inicio.substring(0, 7)
            : new Date().toISOString().substring(0, 7),
        )}`,
      }));

    setMetasDetalhesData({
      nivel,
      tipo,
      entidades: entidadesFiltradas,
    });
    setShowModalMetasDetalhes(true);
  };

  // Função para gerar relatório PDF com lojas por semana e nível de meta
  const gerarRelatorioPDF = () => {
    console.log('🔍 Iniciando geração de relatório PDF...');

    if (!dadosPorSemana || Object.keys(dadosPorSemana).length === 0) {
      alert(
        'Nenhum dado disponível para gerar relatório. Por favor, execute a busca primeiro.',
      );
      return;
    }

    const doc = new jsPDF();
    let yPosition = 15;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 12;
    const maxYPosition = pageHeight - 15;

    // Cores e estilos para cada nível
    const nivelConfig = {
      bronze: { color: [184, 134, 11], textColor: [139, 101, 8] },
      prata: { color: [192, 192, 192], textColor: [100, 100, 100] },
      ouro: { color: [255, 215, 0], textColor: [184, 134, 11] },
      diamante: { color: [30, 144, 255], textColor: [0, 102, 204] },
    };

    const niveisEmoji = {
      bronze: '🥉',
      prata: '🥈',
      ouro: '🥇',
      diamante: '💎',
    };

    // Helper: normalizar nomes
    const normalize = (s) =>
      (s || '')
        .toString()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim();

    // Construir mapas de metas semanais
    const metaSemanaisMap = { lojas: new Map(), vendedores: new Map() };
    Object.keys(metasSemanais || {}).forEach((k) => {
      const parts = k.split('-');
      const tipo = parts[0];
      const nome = parts.slice(1).join('-');
      const nk = normalize(nome);
      if (!metaSemanaisMap[tipo]) metaSemanaisMap[tipo] = new Map();
      metaSemanaisMap[tipo].set(nk, metasSemanais[k]);
    });

    // ========== CABEÇALHO ==========
    doc.setFillColor(6, 6, 56); // Azul escuro
    doc.rect(0, 0, pageWidth, 25, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE METAS', margin, 12);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Período: ${filtros.dt_inicio} a ${filtros.dt_fim}`, margin, 20);

    doc.setTextColor(0, 0, 0);
    yPosition = 30;

    // ========== PROCESSAR SEMANAS ==========
    const semanas = Object.keys(dadosPorSemana).sort(
      (a, b) => parseInt(a) - parseInt(b),
    );

    semanas.forEach((semanaKey, semanaIdx) => {
      const dadosSemana = dadosPorSemana[semanaKey];
      const semanaNum = parseInt(semanaKey, 10);

      // Verificar se precisa de nova página
      if (yPosition > maxYPosition - 60) {
        doc.addPage();
        yPosition = 15;
      }

      // ===== CABEÇALHO DA SEMANA =====
      doc.setFillColor(100, 149, 237); // Cornflower blue
      doc.rect(margin, yPosition, pageWidth - margin * 2, 7, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text(`SEMANA ${semanaKey}`, margin + 3, yPosition + 5);

      yPosition += 10;
      doc.setTextColor(0, 0, 0);

      // Processar cada nível de meta
      const niveis = ['bronze', 'prata', 'ouro', 'diamante'];
      let totalLojasNivel = 0;

      niveis.forEach((nivel) => {
        const lojasNivel = [];

        // Filtrar lojas que atingiram esta meta
        dadosSemana.lojas?.forEach((loja) => {
          const nomeFantasia =
            loja.nome_fantasia ||
            loja.nome_loja ||
            loja.loja ||
            loja.nome ||
            '';
          const nk = normalize(nomeFantasia);

          const weeklyObj = metaSemanaisMap.lojas?.get(nk) || null;
          const weeklyMetas = weeklyObj?.semanas?.[semanaNum]?.metas || {};
          const metaNivel = toNumber(weeklyMetas[nivel]) || 0;
          const faturamentoSemanal = Number(loja.faturamento) || 0;

          if (metaNivel > 0 && faturamentoSemanal >= metaNivel) {
            const percentualAtingido = Math.round(
              (faturamentoSemanal / metaNivel) * 100,
            );
            lojasNivel.push({
              loja: nomeFantasia,
              meta: metaNivel,
              metaFormatada: formatBRL(metaNivel),
              faturamento: faturamentoSemanal,
              faturamentoFormatado: formatBRL(faturamentoSemanal),
              percentual: percentualAtingido,
            });
          }
        });

        if (lojasNivel.length > 0) {
          totalLojasNivel += lojasNivel.length;

          // Verificar se precisa de nova página
          if (yPosition > maxYPosition - 40) {
            doc.addPage();
            yPosition = 15;
          }

          // ===== CARD DO NÍVEL =====
          const cardHeight = lojasNivel.length * 8 + 12;
          const config = nivelConfig[nivel];

          // Fundo do card
          doc.setFillColor(...config.color);
          doc.rect(margin, yPosition, pageWidth - margin * 2, 6, 'F');

          // Título do nível
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(11);
          doc.setFont(undefined, 'bold');
          doc.text(
            `${niveisEmoji[nivel]} ${nivel.toUpperCase()} (${
              lojasNivel.length
            } lojas)`,
            margin + 3,
            yPosition + 4.5,
          );

          yPosition += 8;

          // Cabeçalho da tabela
          doc.setTextColor(...config.textColor);
          doc.setFontSize(8);
          doc.setFont(undefined, 'bold');

          const colLoja = margin + 2;
          const colMeta = pageWidth - margin - 60;
          const colFaturamento = pageWidth - margin - 30;
          const colPercentual = pageWidth - margin - 8;

          doc.text('Loja', colLoja, yPosition);
          doc.text('Meta', colMeta, yPosition);
          doc.text('Faturamento', colFaturamento, yPosition);
          doc.text('%', colPercentual, yPosition);

          yPosition += 3;

          // Linha separadora
          doc.setDrawColor(...config.textColor);
          doc.setLineWidth(0.3);
          doc.line(margin + 2, yPosition, pageWidth - margin - 2, yPosition);

          yPosition += 2;

          // Linhas de dados
          doc.setTextColor(0, 0, 0);
          doc.setFontSize(8);
          doc.setFont(undefined, 'normal');

          lojasNivel.forEach((item, idx) => {
            if (yPosition > maxYPosition - 5) {
              doc.addPage();
              yPosition = 15;

              // Repetir cabeçalho na próxima página
              doc.setFillColor(...config.color);
              doc.rect(margin, yPosition, pageWidth - margin * 2, 6, 'F');

              doc.setTextColor(255, 255, 255);
              doc.setFontSize(11);
              doc.setFont(undefined, 'bold');
              doc.text(
                `${niveisEmoji[nivel]} ${nivel.toUpperCase()} (continuação)`,
                margin + 3,
                yPosition + 4.5,
              );

              yPosition += 8;

              doc.setTextColor(...config.textColor);
              doc.setFontSize(8);
              doc.setFont(undefined, 'bold');
              doc.text('Loja', colLoja, yPosition);
              doc.text('Meta', colMeta, yPosition);
              doc.text('Faturamento', colFaturamento, yPosition);
              doc.text('%', colPercentual, yPosition);

              yPosition += 3;
              doc.setDrawColor(...config.textColor);
              doc.setLineWidth(0.3);
              doc.line(
                margin + 2,
                yPosition,
                pageWidth - margin - 2,
                yPosition,
              );

              yPosition += 2;
              doc.setTextColor(0, 0, 0);
              doc.setFontSize(8);
              doc.setFont(undefined, 'normal');
            }

            // Fundo alternado para melhor legibilidade
            if (idx % 2 === 0) {
              doc.setFillColor(240, 240, 240);
              doc.rect(
                margin + 1,
                yPosition - 1.5,
                pageWidth - margin * 2 - 2,
                3.5,
                'F',
              );
            }

            // Dados da loja
            const lojaText =
              item.loja.length > 25
                ? item.loja.substring(0, 22) + '...'
                : item.loja;
            doc.text(lojaText, colLoja, yPosition);
            doc.text(item.metaFormatada, colMeta, yPosition);
            doc.text(item.faturamentoFormatado, colFaturamento, yPosition);

            // Percentual com cor
            const corPercentual =
              item.percentual >= 100
                ? [34, 139, 34]
                : item.percentual >= 80
                  ? [255, 140, 0]
                  : [220, 20, 60];
            doc.setTextColor(...corPercentual);
            doc.setFont(undefined, 'bold');
            doc.text(`${item.percentual}%`, colPercentual, yPosition);
            doc.setTextColor(0, 0, 0);
            doc.setFont(undefined, 'normal');

            yPosition += 3.5;
          });

          yPosition += 2;
        }
      });

      yPosition += 5;
    });

    // ========== RODAPÉ ==========
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    const dataGeracao = new Date().toLocaleString('pt-BR');
    doc.text(`Relatório gerado em: ${dataGeracao}`, margin, pageHeight - 10);

    // Salvar PDF
    doc.save(`relatorio-metas-${new Date().toISOString().slice(0, 10)}.pdf`);
    console.log('✅ PDF gerado com sucesso!');
  };

  // Helper para obter cor do nível
  const getNivelColor = (nivel) => {
    const cores = {
      bronze: [184, 134, 11],
      prata: [192, 192, 192],
      ouro: [255, 215, 0],
      diamante: [30, 144, 255],
    };
    return cores[nivel] || [100, 100, 100];
  };

  const handleBuscar = async () => {
    setLoading(true);
    setLoadingRanking(true);

    try {
      // Gerar períodos de semanas baseado no intervalo de datas selecionado
      const periodosSemanas = gerarPeriodosSemanasPorDatas(
        filtros.dt_inicio,
        filtros.dt_fim,
      );
      setSemanasCalculadas(periodosSemanas);

      console.log('📅 Períodos de semanas gerados:', periodosSemanas);

      // Carregar dados por semana sempre (para usar no dashboard semanal)
      const dadosSemanais = await carregarDadosPorSemana(periodosSemanas);
      setDadosPorSemana(dadosSemanais);

      console.log('📊 Dados por semana carregados e salvos no estado:', {
        totalSemanas: Object.keys(dadosSemanais).length,
        semanas: Object.keys(dadosSemanais),
        detalhesSemanas: Object.keys(dadosSemanais).map((numero) => ({
          semana: numero,
          lojas: dadosSemanais[numero].lojas.length,
          vendedores: dadosSemanais[numero].vendedores.length,
        })),
      });

      // Buscar dados de ranking de lojas e vendedores (usando período das semanas)
      const periodoInicio = periodosSemanas[0]?.inicio || filtros.dt_inicio;
      const periodoFim =
        periodosSemanas[periodosSemanas.length - 1]?.fim || filtros.dt_fim;

      console.log('📅 Período das semanas para busca de dados:', {
        periodoInicio,
        periodoFim,
        semanas: periodosSemanas.length,
        primeiraSemana: periodosSemanas[0],
        ultimaSemana: periodosSemanas[periodosSemanas.length - 1],
      });

      await Promise.all([
        buscarDadosLojas(periodoInicio, periodoFim),
        buscarDadosVendedores(periodoInicio, periodoFim),
      ]);

      // Buscar metas existentes para o período
      await carregarMetasExistentes();

      // Se visualização for SEMANAL, carregar dados semanais
      if (visualizacaoTipo === 'SEMANAL') {
        await carregarDadosSemanais();
      }

      // Calcular estatísticas do dashboard
      setTimeout(() => {
        calcularStatsDashboard();
        setLoading(false);
        setLoadingRanking(false);
      }, 1000);
    } catch (error) {
      console.error('Erro ao buscar dados:', error);
      setLoading(false);
      setLoadingRanking(false);
    }
  };

  const carregarDadosSemanais = async () => {
    if (!filtros.dt_inicio) {
      console.log('❌ Não há data de início para carregar dados semanais');
      return;
    }

    const mes = filtros.dt_inicio.substring(0, 7);
    console.log('🔍 Carregando dados semanais para o mês:', mes);

    // Gerar semanas do mês
    const semanasDoMes = gerarSemanasDoMes(mes);
    console.log('🔍 Semanas geradas:', semanasDoMes);
    setSemanas(semanasDoMes);

    // Buscar metas semanais
    const resultadoSemanais = await buscarMetasSemanaisAgrupadas(mes);
    if (resultadoSemanais.success) {
      console.log('🔍 Metas semanais carregadas:', resultadoSemanais.data);
      setMetasSemanais(resultadoSemanais.data);
    } else {
      console.log(
        '❌ Erro ao carregar metas semanais:',
        resultadoSemanais.error,
      );
    }

    // Buscar metas mensais calculadas
    const resultadoMensais = await buscarMetasMensaisCalculadas(
      mes,
      mes,
      rankingTipo,
    );
    if (resultadoMensais.success) {
      const agrupado = {};
      resultadoMensais.data.forEach((meta) => {
        const chave = `${meta.tipo}-${meta.nome}`;
        agrupado[chave] = meta;
      });
      console.log('🔍 Metas mensais calculadas carregadas:', agrupado);
      setMetasMensaisCalculadas(agrupado);
    } else {
      console.log(
        '❌ Erro ao carregar metas mensais calculadas:',
        resultadoMensais.error,
      );
    }

    // Forçar atualização das metas mensais calculadas após exclusão
    await atualizarMetasMensaisCalculadas(mes);
  };

  const carregarMetasExistentes = async () => {
    if (!filtros.dt_inicio || !filtros.dt_fim) return;

    const mesInicio = filtros.dt_inicio.substring(0, 7);
    const mesFim = filtros.dt_fim.substring(0, 7);

    // Buscar metas tradicionais
    const resultado = await buscarMetas(mesInicio, mesFim);

    if (resultado && resultado.success) {
      const metasExistentes = {};

      resultado.data.forEach((meta) => {
        const chave = `${meta.tipo}-${meta.nome}-${meta.campo}`;
        metasExistentes[chave] = meta.valor;
      });

      setMetaValores(metasExistentes);
    }

    // Buscar e mesclar metas mensais calculadas (soma das semanais)
    await atualizarMetasMensaisCalculadas(mesInicio);
  };

  const atualizarMetasMensaisCalculadas = async (
    mes,
    tipo = null,
    nome = null,
  ) => {
    console.log('🔄 Atualizando metas mensais calculadas:', {
      mes,
      tipo,
      nome,
    });

    try {
      const resultado = await buscarMetasMensaisCalculadas(mes, tipo, nome);

      if (resultado && resultado.success) {
        const metasCalculadas = {};

        resultado.data.forEach((meta) => {
          ['bronze', 'prata', 'ouro', 'diamante'].forEach((nivel) => {
            if (meta[nivel] > 0) {
              const chave = `${meta.tipo}-${meta.nome}-${nivel}`;
              metasCalculadas[chave] = formatBRL(meta[nivel]);
            }
          });
        });

        console.log('📊 Metas calculadas encontradas:', metasCalculadas);

        // Atualizar estado local - mas não sobrescrever valores zerados
        setMetaValores((prev) => {
          const novoEstado = { ...prev };

          // Adicionar apenas metas que existem no resultado
          Object.keys(metasCalculadas).forEach((chave) => {
            novoEstado[chave] = metasCalculadas[chave];
          });

          return novoEstado;
        });

        return metasCalculadas;
      }
    } catch (error) {
      console.error('❌ Erro ao atualizar metas mensais calculadas:', error);
    }

    return {};
  };

  // Função para calcular semana atual do mês
  const calcularSemanaAtual = (mes) => {
    const hoje = new Date();
    const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const diasPassados = Math.floor(
      (hoje - primeiroDiaMes) / (1000 * 60 * 60 * 24),
    );
    return Math.ceil((diasPassados + 1) / 7);
  };

  // Função para calcular dados de todas as semanas de uma loja
  const calcularDadosTodasSemanas = (item, tipo) => {
    // Determinar nome da entidade
    const nome =
      tipo === 'lojas'
        ? item.nome_fantasia || item.nm_loja || item.nome || item.loja || ''
        : item.nome_vendedor ||
          item.vendedor ||
          item.nm_vendedor ||
          item.nome ||
          '';

    // Buscar metas semanais para esta entidade
    const chave = `${tipo}-${nome}`;
    const metasSemanaisEntidade = metasSemanais[chave];

    // Calcular dados para cada semana usando dados reais
    return semanasCalculadas.map((semana) => {
      // Buscar faturamento real desta semana para esta entidade
      const dadosSemana = dadosPorSemana[semana.numero];
      let faturamentoSemanal = 0;

      // Log de verificação dos dados disponíveis
      console.log(
        `🔍 Verificando dados da semana ${semana.numero} para ${nome}:`,
        {
          dadosSemanaExiste: !!dadosSemana,
          dadosPorSemanaKeys: Object.keys(dadosPorSemana),
          dadosSemanaConteudo: dadosSemana
            ? {
                lojas: dadosSemana.lojas?.length || 0,
                vendedores: dadosSemana.vendedores?.length || 0,
                periodo: dadosSemana.periodo,
              }
            : 'Dados não existem',
        },
      );

      console.log(
        `🔍 Calculando semana ${semana.numero} para ${nome} (${tipo}):`,
        {
          dadosSemanaExiste: !!dadosSemana,
          dadosEntidadeExiste:
            dadosSemana &&
            !!dadosSemana[tipo === 'lojas' ? 'lojas' : 'vendedores'],
          totalEntidades: dadosSemana
            ? dadosSemana[tipo === 'lojas' ? 'lojas' : 'vendedores']?.length ||
              0
            : 0,
        },
      );

      if (
        dadosSemana &&
        dadosSemana[tipo === 'lojas' ? 'lojas' : 'vendedores']
      ) {
        const entidadeSemana = dadosSemana[
          tipo === 'lojas' ? 'lojas' : 'vendedores'
        ].find((ent) => {
          const nomeEntidade =
            tipo === 'lojas'
              ? ent.nome_fantasia || ent.nm_loja || ent.nome || ent.loja || ''
              : ent.nome_vendedor ||
                ent.vendedor ||
                ent.nm_vendedor ||
                ent.nome ||
                '';

          // Comparação mais flexível (ignorar case e espaços)
          const nomeLimpo = nome.trim().toLowerCase();
          const nomeEntidadeLimpo = nomeEntidade.trim().toLowerCase();

          return nomeLimpo === nomeEntidadeLimpo;
        });

        console.log(
          `🔍 Buscando entidade "${nome}" na semana ${semana.numero}:`,
          {
            nomeBuscado: nome,
            totalEntidades:
              dadosSemana[tipo === 'lojas' ? 'lojas' : 'vendedores'].length,
            nomesEncontrados: dadosSemana[
              tipo === 'lojas' ? 'lojas' : 'vendedores'
            ]
              .slice(0, 5) // Mostrar mais entidades para debug
              .map((ent) => ({
                nome:
                  tipo === 'lojas'
                    ? ent.nome_fantasia ||
                      ent.nm_loja ||
                      ent.nome ||
                      ent.loja ||
                      ''
                    : ent.nome_vendedor ||
                      ent.vendedor ||
                      ent.nm_vendedor ||
                      ent.nome ||
                      '',
                faturamento: ent.faturamento,
                nomeComparacao: (tipo === 'lojas'
                  ? ent.nome_fantasia ||
                    ent.nm_loja ||
                    ent.nome ||
                    ent.loja ||
                    ''
                  : ent.nome_vendedor ||
                    ent.vendedor ||
                    ent.nm_vendedor ||
                    ent.nome ||
                    ''
                )
                  .trim()
                  .toLowerCase(),
                nomeBuscadoComparacao: nome.trim().toLowerCase(),
              })),
            entidadeEncontrada: !!entidadeSemana,
          },
        );

        if (entidadeSemana) {
          faturamentoSemanal = parseFloat(entidadeSemana.faturamento) || 0;
          console.log(
            `✅ Dados reais encontrados para ${nome} na semana ${semana.numero}:`,
            {
              faturamento: faturamentoSemanal,
              entidade: entidadeSemana,
            },
          );
        } else {
          console.log(
            `❌ Entidade ${nome} não encontrada na semana ${semana.numero}`,
          );
        }
      } else {
        console.log(`❌ Dados da semana ${semana.numero} não disponíveis`);
      }

      // Se não há dados da semana, usar 0 (sem fallback)
      if (faturamentoSemanal === 0) {
        console.log(
          `📊 Sem faturamento para ${nome} na semana ${semana.numero} - usando 0`,
        );
      }

      // Buscar metas da semana
      const metasSemana = metasSemanaisEntidade?.semanas?.[semana.numero] || {
        metas: {},
      };

      // Log de debug das metas semanais
      console.log(`🎯 Metas semanais para ${nome} - Semana ${semana.numero}:`, {
        metasSemana,
        metasDisponiveis: Object.keys(metasSemana.metas || {}),
        valoresMetas: metasSemana.metas,
      });

      // Determinar qual meta foi atingida e qual é a próxima
      const niveis = ['bronze', 'prata', 'ouro', 'diamante'];
      let metaAtingida = 0;
      let proximaMeta = 0;
      let nivelAtingido = 'Abaixo de Bronze';
      let nomeMetaAtingida = '';
      let nomeProximaMeta = '';
      let status = 'sem-meta';

      for (const nivel of niveis) {
        const valorMeta = metasSemana.metas[nivel] || 0;
        if (valorMeta > 0) {
          status = 'com-meta';

          if (faturamentoSemanal >= valorMeta) {
            metaAtingida = valorMeta;
            nivelAtingido = nivel.charAt(0).toUpperCase() + nivel.slice(1);
            nomeMetaAtingida = nivel.charAt(0).toUpperCase() + nivel.slice(1);
          } else {
            if (proximaMeta === 0) {
              proximaMeta = valorMeta;
              nomeProximaMeta = nivel.charAt(0).toUpperCase() + nivel.slice(1);
            }
            break;
          }
        }
      }

      const faltante =
        proximaMeta > 0 ? Math.max(0, proximaMeta - faturamentoSemanal) : 0;

      // Calcular progresso para a próxima meta
      const progresso =
        proximaMeta > 0
          ? Math.min(100, (faturamentoSemanal / proximaMeta) * 100)
          : 0;

      return {
        numero: semana.numero,
        numeroAno: semana.numeroAno,
        inicio: semana.inicio,
        fim: semana.fim,
        faturamento: faturamentoSemanal,
        metaAtingida,
        proximaMeta,
        faltante,
        nivelAtingido,
        nomeMetaAtingida,
        nomeProximaMeta,
        progresso: Math.round(progresso),
        status,
      };
    });
  };

  // Função para calcular dados semanais detalhados para o dashboard (mantida para compatibilidade)
  const calcularDadosSemanaisDashboard = (item, tipo) => {
    const dadosSemanas = calcularDadosTodasSemanas(item, tipo);
    const semanaAtual = calcularSemanaAtual(
      filtros.dt_inicio
        ? filtros.dt_inicio.substring(0, 7)
        : new Date().toISOString().substring(0, 7),
    );

    if (dadosSemanas.length === 0) {
      return {
        semanaAtual: '-',
        metaSemanaAtual: 0,
        metaAtingida: 0,
        proximaMeta: 0,
        faltanteProximaMeta: 0,
        progressoPercentual: 0,
        nivelAtual: 'Abaixo de Bronze',
      };
    }

    const dadosSemanaAtual = dadosSemanas[semanaAtual - 1] || dadosSemanas[0];

    // Obter número da semana do ano (ISO 8601) para a semana atual
    const semanaAnoAtual =
      dadosSemanaAtual.numeroAno || obterSemanaAnoISO(new Date());

    return {
      semanaAtual:
        semanaAtual > 0
          ? `S${semanaAtual}${semanaAnoAtual ? ` (${semanaAnoAtual})` : ''}`
          : '-',
      metaSemanaAtual:
        dadosSemanaAtual.metaAtingida || dadosSemanaAtual.proximaMeta || 0,
      metaAtingida: dadosSemanaAtual.metaAtingida,
      proximaMeta: dadosSemanaAtual.proximaMeta,
      faltanteProximaMeta: dadosSemanaAtual.faltante,
      progressoPercentual: dadosSemanaAtual.metaAtingida > 0 ? 100 : 0,
      nivelAtual: dadosSemanaAtual.nivelAtingido,
      faturamentoSemanal: dadosSemanaAtual.faturamento,
    };
  };

  const calcularStatsDashboard = () => {
    if (!filtros.dt_inicio || !filtros.dt_fim) return;

    console.log('🎯 calcularStatsDashboard chamada:', {
      visualizacaoTipo,
      filtrosDataInicio: filtros.dt_inicio,
      dadosLojasCount: dadosLojas.length,
      dadosVendedoresCount: dadosVendedores.length,
      metaValoresCount: Object.keys(metaValores || {}).length,
      metasSemanaisCount: Object.keys(metasSemanais || {}).length,
    });

    // Helper: normalizar nomes (remove acentos, minuscula, trim)
    const normalize = (s) =>
      (s || '')
        .toString()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim();

    // Construir mapas de metas mensais (metaValores) indexados por tipo -> nomeNormalizado -> niveis
    const metaMonthlyByTypeName = { lojas: new Map(), vendedores: new Map() };
    Object.keys(metaValores || {}).forEach((k) => {
      const parts = k.split('-');
      const tipo = parts[0];
      const nivel = parts[parts.length - 1];
      const nome = parts.slice(1, parts.length - 1).join('-');
      const nk = normalize(nome);
      if (!metaMonthlyByTypeName[tipo]) metaMonthlyByTypeName[tipo] = new Map();
      const map = metaMonthlyByTypeName[tipo];
      if (!map.has(nk)) map.set(nk, {});
      map.get(nk)[nivel] = toNumber(metaValores[k]);
    });

    // Construir mapa de metas semanais (metasSemanais) indexado por tipo -> nomeNormalizado -> objeto
    const metaSemanaisMap = { lojas: new Map(), vendedores: new Map() };
    Object.keys(metasSemanais || {}).forEach((k) => {
      const parts = k.split('-');
      const tipo = parts[0];
      const nome = parts.slice(1).join('-');
      const nk = normalize(nome);
      if (!metaSemanaisMap[tipo]) metaSemanaisMap[tipo] = new Map();
      metaSemanaisMap[tipo].set(nk, metasSemanais[k]);
    });

    // Semana atual usada para metas semanais
    const semanaAtualNum = calcularSemanaAtual(
      filtros.dt_inicio
        ? filtros.dt_inicio.substring(0, 7)
        : new Date().toISOString().substring(0, 7),
    );

    // Inicializar estatísticas
    const stats = {
      bronze: { lojas: 0, vendedores: 0 },
      prata: { lojas: 0, vendedores: 0 },
      ouro: { lojas: 0, vendedores: 0 },
      diamante: { lojas: 0, vendedores: 0 },
      lojaDetalhes: [],
      vendedorDetalhes: [],
    };

    // Função utilitária para processar uma entidade (loja/vendedor)
    const processEntity = (item, tipo) => {
      const nome =
        tipo === 'lojas'
          ? item.nome_fantasia ||
            item.nome_loja ||
            item.loja ||
            item.nm_loja ||
            item.nome ||
            ''
          : item.nome_vendedor ||
            item.vendedor ||
            item.nm_vendedor ||
            item.nome ||
            '';
      const faturamento = Number(item.faturamento) || 0;
      const nk = normalize(nome);

      // Obter metas mensais e semanais para esta entidade
      const monthly =
        (metaMonthlyByTypeName[tipo] && metaMonthlyByTypeName[tipo].get(nk)) ||
        {};
      const weeklyObj =
        (metaSemanaisMap[tipo] && metaSemanaisMap[tipo].get(nk)) || null;
      const weeklyMetas =
        weeklyObj && weeklyObj.semanas && weeklyObj.semanas[semanaAtualNum]
          ? weeklyObj.semanas[semanaAtualNum].metas || {}
          : {};

      // Se visualizacao for semanal, precisamos do faturamento semanal real
      let faturamentoParaComparar = faturamento;
      if (visualizacaoTipo === 'SEMANAL') {
        try {
          const weeklyData = calcularDadosSemanaisDashboard(item, tipo);
          faturamentoParaComparar = weeklyData.faturamentoSemanal || 0;
        } catch (e) {
          faturamentoParaComparar = faturamento;
        }
      }

      // Para cada nivel, verificar se atingiu (usa weekly metas se visualizacao for semanal)
      ['bronze', 'prata', 'ouro', 'diamante'].forEach((nivel) => {
        const metaNum =
          visualizacaoTipo === 'SEMANAL'
            ? toNumber(weeklyMetas[nivel]) || 0
            : monthly[nivel] || 0;
        if (metaNum > 0 && faturamentoParaComparar >= metaNum) {
          stats[nivel][tipo] = (stats[nivel][tipo] || 0) + 1;
        }
      });

      // Calcular meta atual / proxima para detalhes (usar o mesmo faturamentoParaComparar)
      const metaBronze =
        visualizacaoTipo === 'SEMANAL'
          ? toNumber(weeklyMetas.bronze) || 0
          : monthly.bronze || 0;
      const metaPrata =
        visualizacaoTipo === 'SEMANAL'
          ? toNumber(weeklyMetas.prata) || 0
          : monthly.prata || 0;
      const metaOuro =
        visualizacaoTipo === 'SEMANAL'
          ? toNumber(weeklyMetas.ouro) || 0
          : monthly.ouro || 0;
      const metaDiamante =
        visualizacaoTipo === 'SEMANAL'
          ? toNumber(weeklyMetas.diamante) || 0
          : monthly.diamante || 0;

      let metaAtual = 'Abaixo de Bronze';
      let proximaMeta = 'Bronze';
      let valorProximaMeta = metaBronze;
      let percentualAtingido = 0;
      let valorFaltante = 0;

      if (metaDiamante > 0 && faturamentoParaComparar >= metaDiamante) {
        metaAtual = 'Diamante';
        proximaMeta = 'Meta máxima atingida';
        valorProximaMeta = 0;
        percentualAtingido = 100;
        valorFaltante = 0;
      } else if (metaOuro > 0 && faturamentoParaComparar >= metaOuro) {
        metaAtual = 'Ouro';
        proximaMeta = 'Diamante';
        valorProximaMeta = metaDiamante;
        percentualAtingido =
          metaDiamante > 0
            ? Math.min(
                100,
                Math.round((faturamentoParaComparar / metaDiamante) * 100),
              )
            : 0;
        valorFaltante =
          metaDiamante > 0
            ? Math.max(0, metaDiamante - faturamentoParaComparar)
            : 0;
      } else if (metaPrata > 0 && faturamentoParaComparar >= metaPrata) {
        metaAtual = 'Prata';
        proximaMeta = 'Ouro';
        valorProximaMeta = metaOuro;
        percentualAtingido =
          metaOuro > 0
            ? Math.min(
                100,
                Math.round((faturamentoParaComparar / metaOuro) * 100),
              )
            : 0;
        valorFaltante =
          metaOuro > 0 ? Math.max(0, metaOuro - faturamentoParaComparar) : 0;
      } else if (metaBronze > 0 && faturamentoParaComparar >= metaBronze) {
        metaAtual = 'Bronze';
        proximaMeta = 'Prata';
        valorProximaMeta = metaPrata;
        percentualAtingido =
          metaPrata > 0
            ? Math.min(
                100,
                Math.round((faturamentoParaComparar / metaPrata) * 100),
              )
            : 0;
        valorFaltante =
          metaPrata > 0 ? Math.max(0, metaPrata - faturamentoParaComparar) : 0;
      } else {
        metaAtual = 'Abaixo de Bronze';
        proximaMeta = 'Bronze';
        valorProximaMeta = metaBronze;
        percentualAtingido =
          metaBronze > 0
            ? Math.min(
                100,
                Math.round((faturamentoParaComparar / metaBronze) * 100),
              )
            : 0;
        valorFaltante =
          metaBronze > 0
            ? Math.max(0, metaBronze - faturamentoParaComparar)
            : 0;
      }

      return {
        nome,
        faturamento: faturamento, // Sempre faturamento total mensal
        faturamentoSemanal: faturamentoParaComparar, // Faturamento semanal (se aplicável)
        metaAtual,
        proximaMeta,
        valorProximaMeta,
        percentualAtingido,
        valorFaltante,
        metas: {
          bronze: metaBronze,
          prata: metaPrata,
          ouro: metaOuro,
          diamante: metaDiamante,
        },
      };
    };

    // Processar lojas
    dadosLojas.forEach((loja) => {
      const detalhe = processEntity(loja, 'lojas');
      stats.lojaDetalhes.push(detalhe);
    });

    // Processar vendedores
    dadosVendedores.forEach((vendedor) => {
      const detalhe = processEntity(vendedor, 'vendedores');
      stats.vendedorDetalhes.push(detalhe);
    });

    console.log('✅ calcularStatsDashboard resultado final:', {
      visualizacaoTipo,
      lojasPorMeta: {
        bronze: stats.bronze.lojas,
        prata: stats.prata.lojas,
        ouro: stats.ouro.lojas,
        diamante: stats.diamante.lojas,
      },
      vendedoresPorMeta: {
        bronze: stats.bronze.vendedores,
        prata: stats.prata.vendedores,
        ouro: stats.ouro.vendedores,
        diamante: stats.diamante.vendedores,
      },
      totalLojasDetalhes: stats.lojaDetalhes.length,
      totalVendedoresDetalhes: stats.vendedorDetalhes.length,
    });

    setDashboardStats(stats);
  };

  // Função auxiliar para obter nome do mês
  const obterNomeMes = (mesNumero) => {
    const meses = [
      'Janeiro',
      'Fevereiro',
      'Março',
      'Abril',
      'Maio',
      'Junho',
      'Julho',
      'Agosto',
      'Setembro',
      'Outubro',
      'Novembro',
      'Dezembro',
    ];
    return meses[mesNumero - 1] || 'Mês Inválido';
  };

  // Função para encontrar o último mês com dados
  const encontrarUltimoMesComDados = async () => {
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();

    // Tentar buscar dados dos últimos 6 meses
    for (let i = 0; i < 6; i++) {
      const dataTeste = new Date(anoAtual, mesAtual - 1 - i, 1);
      const mesTeste = dataTeste.getMonth() + 1;
      const anoTeste = dataTeste.getFullYear();

      const primeiroDia = `${anoTeste}-${mesTeste
        .toString()
        .padStart(2, '0')}-01`;
      const ultimoDia = new Date(anoTeste, mesTeste, 0)
        .toISOString()
        .split('T')[0];

      try {
        const dadosLojas = await buscarInvoicesAgrupadasPorLoja(
          primeiroDia,
          ultimoDia,
        );
        const temDados = Array.isArray(dadosLojas) && dadosLojas.length > 0;

        if (temDados) {
          return {
            mes: mesTeste,
            ano: anoTeste,
            primeiroDia,
            ultimoDia,
            dadosLojas,
          };
        }
      } catch {
        // prosseguir para o próximo mês
      }
    }

    return null;
  };

  const calcularStatsSemanais = () => {
    if (!semanasCalculadas || semanasCalculadas.length === 0) return;

    // Inicializar estatísticas semanais
    const statsSemanais = {
      bronze: { lojas: 0, vendedores: 0 },
      prata: { lojas: 0, vendedores: 0 },
      ouro: { lojas: 0, vendedores: 0 },
      diamante: { lojas: 0, vendedores: 0 },
    };

    // Calcular para lojas
    if (dashboardStats.lojaDetalhes && dashboardStats.lojaDetalhes.length > 0) {
      dashboardStats.lojaDetalhes.forEach((loja) => {
        // Verificar se a loja tem dados semanais
        if (loja.semanas && loja.semanas.length > 0) {
          // Verificar a semana atual (ou a última semana disponível)
          const semanaAtual = loja.semanas[loja.semanas.length - 1];
          if (semanaAtual && semanaAtual.metaAtingida > 0) {
            // Determinar o nível da meta atingida
            const nomeMeta = semanaAtual.nomeMetaAtingida?.toLowerCase();
            if (nomeMeta) {
              if (nomeMeta.includes('bronze')) {
                statsSemanais.bronze.lojas++;
              } else if (nomeMeta.includes('prata')) {
                statsSemanais.prata.lojas++;
              } else if (nomeMeta.includes('ouro')) {
                statsSemanais.ouro.lojas++;
              } else if (nomeMeta.includes('diamante')) {
                statsSemanais.diamante.lojas++;
              }
            }
          }
        }
      });
    }

    // Calcular para vendedores
    if (
      dashboardStats.vendedorDetalhes &&
      dashboardStats.vendedorDetalhes.length > 0
    ) {
      dashboardStats.vendedorDetalhes.forEach((vendedor) => {
        // Verificar se o vendedor tem dados semanais
        if (vendedor.semanas && vendedor.semanas.length > 0) {
          // Verificar a semana atual (ou a última semana disponível)
          const semanaAtual = vendedor.semanas[vendedor.semanas.length - 1];
          if (semanaAtual && semanaAtual.metaAtingida > 0) {
            // Determinar o nível da meta atingida
            const nomeMeta = semanaAtual.nomeMetaAtingida?.toLowerCase();
            if (nomeMeta) {
              if (nomeMeta.includes('bronze')) {
                statsSemanais.bronze.vendedores++;
              } else if (nomeMeta.includes('prata')) {
                statsSemanais.prata.vendedores++;
              } else if (nomeMeta.includes('ouro')) {
                statsSemanais.ouro.vendedores++;
              } else if (nomeMeta.includes('diamante')) {
                statsSemanais.diamante.vendedores++;
              }
            }
          }
        }
      });
    }

    // Atualizar as estatísticas do dashboard com os dados semanais
    setDashboardStats((prev) => ({
      ...prev,
      bronze: statsSemanais.bronze,
      prata: statsSemanais.prata,
      ouro: statsSemanais.ouro,
      diamante: statsSemanais.diamante,
    }));
  };

  const buscarDadosLojas = async (inicio, fim) => {
    if (!inicio || !fim) return;

    try {
      const dadosArray = await buscarInvoicesAgrupadasPorLoja(inicio, fim);

      // Se não há dados para o período selecionado, buscar do último mês com dados
      if (dadosArray.length === 0) {
        const ultimoMesComDados = await encontrarUltimoMesComDados();

        if (ultimoMesComDados) {
          // Usar os nomes das lojas do último mês, mas com faturamento 0
          const lojasComFaturamentoZero = ultimoMesComDados.dadosLojas
            .reverse()
            .map((loja, index) => ({
              ...loja,
              rank: index + 1,
              faturamento: 0,
              ticket_medio: 0,
              pa: 0,
              pa_saida: 0,
              pa_entrada: 0,
              transacoes_saida: 0,
              nome_fantasia: loja.nome_fantasia,
              nm_loja: loja.nm_loja || loja.nome_fantasia,
              isDadosReferencia: true,
              mesReferencia: ultimoMesComDados.mes,
              anoReferencia: ultimoMesComDados.ano,
            }));

          setDadosLojas(lojasComFaturamentoZero);

          const lojasUnicas = ultimoMesComDados.dadosLojas.reduce(
            (acc, item) => {
              const nomeFantasia = item.nome_fantasia;
              if (
                nomeFantasia &&
                !acc.find((loja) => loja.nome_fantasia === nomeFantasia)
              ) {
                acc.push({
                  cd_loja: item.cd_grupoempresa || item.pessoa_empresa,
                  nome_fantasia: nomeFantasia,
                  nm_loja: nomeFantasia,
                });
              }
              return acc;
            },
            [],
          );
          setDadosLoja(lojasUnicas);
          return;
        } else {
          setDadosLojas([]);
          setNotification({
            type: 'warning',
            title: 'Sem Dados',
            message:
              'Nenhuma loja encontrada para o período selecionado e não há dados de referência disponíveis.',
          });
          return;
        }
      }

      const ordenado = [...dadosArray].sort(
        (a, b) =>
          parseFloat(b.faturamento || 0) - parseFloat(a.faturamento || 0),
      );
      const comRank = ordenado.map((item, index) => ({
        ...item,
        rank: index + 1,
        faturamento: parseFloat(item.faturamento || 0),
        isDadosReferencia: false,
      }));

      setDadosLojas(comRank);

      const lojasUnicas = dadosArray.reduce((acc, item) => {
        const nomeFantasia = item.nome_fantasia;
        if (
          nomeFantasia &&
          !acc.find((loja) => loja.nome_fantasia === nomeFantasia)
        ) {
          acc.push({
            cd_loja: item.cd_grupoempresa || item.pessoa_empresa,
            nome_fantasia: nomeFantasia,
            nm_loja: nomeFantasia,
          });
        }
        return acc;
      }, []);

      setDadosLoja(lojasUnicas);
    } catch (error) {
      console.error('Erro ao buscar dados de lojas:', error);
    }
  };

  // TODO: Rota de ranking de vendedores será reimplementada futuramente
  const buscarDadosVendedores = async () => {
    setDadosVendedores([]);
    setDadosVendedor([]);
  };

  const handleOrdenacao = (campo) => {
    if (campo === ordenacao) {
      setDirecaoOrdenacao(direcaoOrdenacao === 'asc' ? 'desc' : 'asc');
    } else {
      setOrdenacao(campo);
      setDirecaoOrdenacao('asc');
    }
  };

  const dadosOrdenados = () => {
    let dados = rankingTipo === 'lojas' ? dadosLojas : dadosVendedores;

    // Filtrar por tipo de loja
    if (rankingTipo === 'lojas') {
      dados = dados.filter((item) => {
        const nomeFantasia = item.nome_fantasia?.toUpperCase() || '';

        if (tipoLoja === 'Franquias') {
          const isFranquia = nomeFantasia.includes('F0');
          return isFranquia;
        }

        if (tipoLoja === 'Proprias') {
          const isFranquia =
            nomeFantasia.includes('-') || nomeFantasia.includes('- CROSBY');
          return !isFranquia;
        }

        return true; // 'Todos'
      });
    }

    // Filtrar vendedores por tipo de loja
    if (rankingTipo === 'vendedores') {
      dados = dados
        .filter((item) => {
          if (tipoLoja === 'Franquias') {
            return !item.nome_vendedor?.includes('- INT');
          }
          if (tipoLoja === 'Proprias') {
            return item.nome_vendedor?.includes('- INT');
          }
          return true; // 'Todos'
        })
        .filter((item) => {
          // Se são dados de referência, não filtrar por faturamento
          if (item.isDadosReferencia) {
            return true;
          }
          // Para dados reais, filtrar apenas vendedores com faturamento > 0
          return item.faturamento > 0;
        });

      if (vendedoresSelecionados.length > 0) {
        const nomesSel = vendedoresSelecionados.map(
          (v) => v.nome_vendedor || v.vendedor || v.nm_vendedor || v.nome,
        );
        dados = dados.filter((item) =>
          nomesSel.includes(
            item.nome_vendedor ||
              item.vendedor ||
              item.nm_vendedor ||
              item.nome,
          ),
        );
      }
    }

    // Filtrar por lojas selecionadas se houver
    if (rankingTipo === 'lojas' && lojasSelecionadas.length > 0) {
      const lojasSelecionadasNomes = lojasSelecionadas.map(
        (loja) => loja.nome_fantasia,
      );
      console.log('🔍 Lojas selecionadas:', lojasSelecionadasNomes);
      console.log('🔍 Dados antes do filtro:', dados.length);

      dados = dados.filter((item) => {
        const nomeItem = item.nome_fantasia;
        const incluido = lojasSelecionadasNomes.includes(nomeItem);
        console.log(`🔍 Item: ${nomeItem} - Incluído: ${incluido}`);
        return incluido;
      });

      console.log('🔍 Dados após filtro:', dados.length);
    }

    return [...dados].sort((a, b) => {
      let valorA, valorB;

      if (ordenacao === 'faturamento') {
        valorA = parseFloat(a.faturamento || 0);
        valorB = parseFloat(b.faturamento || 0);
      } else if (ordenacao === 'nome') {
        valorA = (
          rankingTipo === 'lojas'
            ? a.nome_fantasia ||
              a.nome_loja ||
              a.loja ||
              a.nm_loja ||
              a.nome ||
              ''
            : a.nome_vendedor || a.vendedor || a.nm_vendedor || a.nome || ''
        ).toLowerCase();
        valorB = (
          rankingTipo === 'lojas'
            ? b.nome_fantasia ||
              b.nome_loja ||
              b.loja ||
              b.nm_loja ||
              b.nome ||
              ''
            : b.nome_vendedor || b.vendedor || b.nm_vendedor || b.nome || ''
        ).toLowerCase();
      }

      if (direcaoOrdenacao === 'asc') {
        return valorA > valorB ? 1 : -1;
      } else {
        return valorA < valorB ? 1 : -1;
      }
    });
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Metas Varejo"
        subtitle="Acompanhamento de metas e objetivos do canal varejo"
        icon={Target}
        iconColor="text-orange-600"
      />

      {/* Filtros */}
      <div className="mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleBuscar();
          }}
          className="bg-white p-3 rounded-lg shadow-md border border-[#000638]/10"
        >
          <div className="mb-2">
            <span className="text-xs font-bold text-[#000638] flex items-center gap-1">
              <Calendar size={10} weight="bold" /> Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Selecione as empresas e período para análise das metas
            </span>
          </div>

          <div
            className="grid grid-cols-2 gap-4 mb-4"
            style={{ overflow: 'visible' }}
          >
            {/* Filtro de Loja */}
            <div className="lg:col-span-1">
              <FiltroLoja
                lojasSelecionadas={lojasSelecionadas}
                onSelectLojas={(novasLojas) => {
                  console.log('🔍 Lojas selecionadas alteradas:', novasLojas);
                  setLojasSelecionadas(novasLojas);
                }}
                dadosLoja={dadosLoja}
              />
            </div>

            {/* Filtro de Vendedores */}
            <div className="lg:col-span-1">
              <FiltroVendedor
                vendedoresSelecionados={vendedoresSelecionados}
                onSelectVendedores={setVendedoresSelecionados}
                dadosVendedor={dadosVendedor}
              />
            </div>

            {/* Data Inicial */}
            <div className="mb-2 lg:col-span-1">
              <label className="block text-xs font-medium mb-1 text-gray-600">
                Data Inicial
              </label>
              <input
                type="date"
                value={filtros.dt_inicio}
                onChange={(e) =>
                  setFiltros((prev) => ({
                    ...prev,
                    dt_inicio: e.target.value,
                  }))
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>

            {/* Data Final */}
            <div className="mb-2 lg:col-span-1">
              <label className="block text-xs font-medium mb-1 text-gray-600">
                Data Final
              </label>
              <input
                type="date"
                value={filtros.dt_fim}
                onChange={(e) =>
                  setFiltros((prev) => ({ ...prev, dt_fim: e.target.value }))
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>

            {/* Filtro de Tipo de Loja */}
            <div className="flex flex-col">
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Tipo de Loja
              </label>
              <select
                value={tipoLoja}
                onChange={(e) => setTipoLoja(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="Todos">Todos</option>
                <option value="Proprias">Próprias</option>
                <option value="Franquias">Franquias</option>
              </select>
            </div>

            {/* Botão de Busca */}
            <div className="flex items-center">
              <button
                type="submit"
                disabled={loading || !filtros.dt_inicio || !filtros.dt_fim}
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase w-full justify-center"
              >
                {loading ? 'Buscando...' : 'Buscar'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Botões de Alternância Tabela/Dashboard */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('tabela')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors text-sm font-medium ${
              viewMode === 'tabela'
                ? 'bg-[#000638] border-[#000638] text-white'
                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <TrendUp size={16} />
            Tabela
          </button>

          <button
            type="button"
            onClick={() => setViewMode('dashboard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors text-sm font-medium ${
              viewMode === 'dashboard'
                ? 'bg-[#000638] border-[#000638] text-white'
                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Target size={16} />
            Dashboard
          </button>
        </div>
      </div>

      {/* Conteúdo baseado no modo selecionado */}
      {viewMode === 'tabela' && (
        <>
          {/* Ranking de Faturamento */}
          {(dadosLojas.length > 0 || dadosVendedores.length > 0) && (
            <div className="bg-white p-3 rounded-lg shadow-md border border-[#000638]/10">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-[#000638] flex items-center gap-1">
                    <TrendUp size={10} weight="bold" /> Ranking de Faturamento
                  </span>
                  <span className="block text-xs text-gray-500 mt-1">
                    Ranking de{' '}
                    {rankingTipo === 'lojas' ? 'lojas' : 'vendedores'}
                  </span>
                  {/* Indicador de dados de referência removido - usuário final não precisa saber */}
                </div>
                <div className="flex items-center gap-2">
                  {/* Filtro de Visualização */}
                  <div className="flex flex-col">
                    <select
                      value={visualizacaoTipo}
                      onChange={(e) => setVisualizacaoTipo(e.target.value)}
                      className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs min-w-[100px]"
                    >
                      <option value="MENSAL">Mensal</option>
                      <option value="SEMANAL">Semanal</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={abrirModalMetas}
                    className="text-xs bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] transition-colors"
                  >
                    {rankingTipo === 'lojas'
                      ? '+ Metas Lojas'
                      : '+ Metas Vendedores'}
                  </button>
                  <button
                    type="button"
                    onClick={abrirLogModal}
                    className="text-xs bg-gray-400 text-white px-2 py-1 rounded-lg hover:bg-gray-500 transition-colors opacity-70"
                    title="Log de Alterações"
                  >
                    Log
                  </button>
                </div>
              </div>

              {/* Seletor de Tipo */}
              <div className="mb-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setRankingTipo('lojas')}
                    className={`flex items-center justify-center px-3 py-1 rounded-lg border transition-colors text-xs ${
                      rankingTipo === 'lojas'
                        ? 'bg-[#000638] border-[#000638] text-white'
                        : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <TrendUp size={12} className="mr-1" />
                    Lojas
                  </button>

                  <button
                    onClick={() => setRankingTipo('vendedores')}
                    className={`flex items-center justify-center px-3 py-1 rounded-lg border transition-colors text-xs ${
                      rankingTipo === 'vendedores'
                        ? 'bg-[#000638] border-[#000638] text-white'
                        : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <TrendUp size={12} className="mr-1" />
                    Vendedores
                  </button>
                </div>
              </div>

              {/* Tabela de Ranking */}
              <div className="overflow-auto max-h-96">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap">
                        #
                      </th>
                      <th
                        className="px-1 py-0.5 text-center text-[11px] cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap"
                        onClick={() => handleOrdenacao('nome')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {rankingTipo === 'lojas' ? 'Loja' : 'Vendedor'}
                          {ordenacao === 'nome' && (
                            <span className="text-xs">
                              {direcaoOrdenacao === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                      </th>
                      <th
                        className="px-1 py-0.5 text-center text-[11px] cursor-pointer hover:bg-gray-100 transition-colors whitespace-nowrap"
                        onClick={() => handleOrdenacao('faturamento')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          Faturamento
                          {ordenacao === 'faturamento' && (
                            <span className="text-xs">
                              {direcaoOrdenacao === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                      </th>
                      <th className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap">
                        Ticket Médio
                      </th>
                      <th className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap">
                        PA
                      </th>
                      {visualizacaoTipo === 'MENSAL' ? (
                        <>
                          <th className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                              Bronze
                            </span>
                          </th>
                          <th className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              Prata
                            </span>
                          </th>
                          <th className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              Ouro
                            </span>
                          </th>
                          <th className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              Diamante
                            </span>
                          </th>
                        </>
                      ) : (
                        // Colunas semanais
                        <>
                          {/* Bronze */}
                          {semanasCalculadas && semanasCalculadas.length > 0 ? (
                            semanasCalculadas.map((semana) => (
                              <th
                                key={`bronze-${semana.numero}`}
                                className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap"
                              >
                                <div className="flex flex-col">
                                  <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                                    Bronze
                                  </span>
                                  <span className="text-[7px] text-gray-600 mt-0.5">
                                    S{semana.numero}
                                    {semana.numeroAno && (
                                      <span className="text-[9px] text-blue-600 ml-1">
                                        ({semana.numeroAno})
                                      </span>
                                    )}
                                    <span className="text-[9px] text-gray-400 ml-1">
                                      {formatDM(semana.inicio)} -{' '}
                                      {formatDM(semana.fim)}
                                    </span>
                                  </span>
                                </div>
                              </th>
                            ))
                          ) : (
                            <th className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap">
                              <span className="text-red-500 text-xs">
                                Sem semanas
                              </span>
                            </th>
                          )}
                          {/* Prata */}
                          {semanasCalculadas && semanasCalculadas.length > 0 ? (
                            semanasCalculadas.map((semana) => (
                              <th
                                key={`prata-${semana.numero}`}
                                className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap"
                              >
                                <div className="flex flex-col">
                                  <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                                    Prata
                                  </span>
                                  <span className="text-[7px] text-gray-600 mt-0.5">
                                    S{semana.numero}
                                    {semana.numeroAno && (
                                      <span className="text-[9px] text-blue-600 ml-1">
                                        ({semana.numeroAno})
                                      </span>
                                    )}
                                    <span className="text-[9px] text-gray-400 ml-1">
                                      {formatDM(semana.inicio)} -{' '}
                                      {formatDM(semana.fim)}
                                    </span>
                                  </span>
                                </div>
                              </th>
                            ))
                          ) : (
                            <th className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap">
                              <span className="text-red-500 text-xs">
                                Sem semanas
                              </span>
                            </th>
                          )}
                          {/* Ouro */}
                          {semanasCalculadas && semanasCalculadas.length > 0 ? (
                            semanasCalculadas.map((semana) => (
                              <th
                                key={`ouro-${semana.numero}`}
                                className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap"
                              >
                                <div className="flex flex-col">
                                  <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                    Ouro
                                  </span>
                                  <span className="text-[7px] text-gray-600 mt-0.5">
                                    S{semana.numero}
                                    {semana.numeroAno && (
                                      <span className="text-[9px] text-blue-600 ml-1">
                                        ({semana.numeroAno})
                                      </span>
                                    )}
                                    <span className="text-[9px] text-gray-400 ml-1">
                                      {formatDM(semana.inicio)} -{' '}
                                      {formatDM(semana.fim)}
                                    </span>
                                  </span>
                                </div>
                              </th>
                            ))
                          ) : (
                            <th className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap">
                              <span className="text-red-500 text-xs">
                                Sem semanas
                              </span>
                            </th>
                          )}
                          {/* Diamante */}
                          {semanasCalculadas && semanasCalculadas.length > 0 ? (
                            semanasCalculadas.map((semana) => (
                              <th
                                key={`diamante-${semana.numero}`}
                                className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap"
                              >
                                <div className="flex flex-col">
                                  <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                    Diamante
                                  </span>
                                  <span className="text-[7px] text-gray-600 mt-0.5">
                                    S{semana.numero}
                                    {semana.numeroAno && (
                                      <span className="text-[9px] text-blue-600 ml-1">
                                        ({semana.numeroAno})
                                      </span>
                                    )}
                                    <span className="text-[9px] text-gray-400 ml-1">
                                      {formatDM(semana.inicio)} -{' '}
                                      {formatDM(semana.fim)}
                                    </span>
                                  </span>
                                </div>
                              </th>
                            ))
                          ) : (
                            <th className="px-1 py-0.5 text-center text-[11px] whitespace-nowrap">
                              <span className="text-red-500 text-xs">
                                Sem semanas
                              </span>
                            </th>
                          )}
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingRanking ? (
                      <tr>
                        <td
                          colSpan={
                            visualizacaoTipo === 'MENSAL'
                              ? 9
                              : 5 + semanasCalculadas.length * 4
                          }
                          className="px-1 py-2 text-center text-[11px] text-gray-500"
                        >
                          Carregando dados...
                        </td>
                      </tr>
                    ) : (
                      dadosOrdenados().map((item) => (
                        <tr key={item.rank} className="hover:bg-gray-50">
                          <td className="px-1 py-1 text-center text-[11px] font-medium whitespace-nowrap">
                            {item.rank}
                          </td>
                          <td className="px-1 py-1 text-center text-[11px] whitespace-nowrap">
                            {rankingTipo === 'lojas'
                              ? item.nome_fantasia ||
                                item.nome_loja ||
                                item.loja ||
                                item.nm_loja ||
                                item.nome ||
                                'N/A'
                              : item.nome_vendedor ||
                                item.vendedor ||
                                item.nm_vendedor ||
                                item.nome ||
                                'N/A'}
                          </td>
                          <td className="px-1 py-1 text-center text-[11px] font-semibold text-green-600 whitespace-nowrap">
                            R$ {item.faturamento.toLocaleString('pt-BR')}
                          </td>
                          <td className="px-1 py-1 text-center text-[11px] whitespace-nowrap">
                            {(() => {
                              const transacoesSaida = Number(
                                rankingTipo === 'lojas'
                                  ? item.transacoes_saida
                                  : item.transacoes_saida,
                              );
                              if (transacoesSaida > 0) {
                                const ticket =
                                  item.faturamento / transacoesSaida;
                                return `R$ ${ticket.toLocaleString('pt-BR', {
                                  minimumFractionDigits: 2,
                                })}`;
                              }
                              return '-';
                            })()}
                          </td>
                          <td className="px-1 py-1 text-center text-[11px] whitespace-nowrap">
                            {(() => {
                              // Se são dados de referência, retornar 0
                              if (item.isDadosReferencia) {
                                return '0,00';
                              }

                              const transacoesSaida =
                                Number(item.transacoes_saida) || 0;
                              if (transacoesSaida === 0) return '-';
                              const paSaida = Number(item.pa_saida) || 0;
                              const paEntrada = Number(item.pa_entrada) || 0;
                              const paCalc = (
                                (paSaida - paEntrada) /
                                transacoesSaida
                              ).toFixed(2);
                              return paCalc;
                            })()}
                          </td>
                          {visualizacaoTipo === 'MENSAL' ? (
                            <>
                              <td className="px-1 py-1 text-center text-[11px] whitespace-nowrap">
                                {renderCellEditor(
                                  `${rankingTipo}-${
                                    item.nome_fantasia ||
                                    item.nome_vendedor ||
                                    item.nome
                                  }-bronze`,
                                  'text-amber-700',
                                )}
                              </td>
                              <td className="px-1 py-1 text-center text-[11px] whitespace-nowrap">
                                {renderCellEditor(
                                  `${rankingTipo}-${
                                    item.nome_fantasia ||
                                    item.nome_vendedor ||
                                    item.nome
                                  }-prata`,
                                  'text-gray-700',
                                )}
                              </td>
                              <td className="px-1 py-1 text-center text-[11px] whitespace-nowrap">
                                {renderCellEditor(
                                  `${rankingTipo}-${
                                    item.nome_fantasia ||
                                    item.nome_vendedor ||
                                    item.nome
                                  }-ouro`,
                                  'text-yellow-700',
                                )}
                              </td>
                              <td className="px-1 py-1 text-center text-[11px] whitespace-nowrap">
                                {renderCellEditor(
                                  `${rankingTipo}-${
                                    item.nome_fantasia ||
                                    item.nome_vendedor ||
                                    item.nome
                                  }-diamante`,
                                  'text-blue-700',
                                )}
                              </td>
                            </>
                          ) : (
                            // Células semanais
                            <>
                              {/* Bronze */}
                              {semanasCalculadas &&
                              semanasCalculadas.length > 0 ? (
                                semanasCalculadas.map((semana) => (
                                  <td
                                    key={`bronze-${semana.numero}`}
                                    className="px-1 py-1 text-center text-[11px] whitespace-nowrap"
                                  >
                                    {renderCellEditorSemanal(
                                      rankingTipo,
                                      item.nome_fantasia ||
                                        item.nome_vendedor ||
                                        item.nome,
                                      'bronze',
                                      semana.numero,
                                      'text-amber-700',
                                    )}
                                  </td>
                                ))
                              ) : (
                                <td className="px-1 py-1 text-center text-[11px] whitespace-nowrap">
                                  <span className="text-red-500 text-xs">
                                    -
                                  </span>
                                </td>
                              )}
                              {/* Prata */}
                              {semanasCalculadas &&
                              semanasCalculadas.length > 0 ? (
                                semanasCalculadas.map((semana) => (
                                  <td
                                    key={`prata-${semana.numero}`}
                                    className="px-1 py-1 text-center text-[11px] whitespace-nowrap"
                                  >
                                    {renderCellEditorSemanal(
                                      rankingTipo,
                                      item.nome_fantasia ||
                                        item.nome_vendedor ||
                                        item.nome,
                                      'prata',
                                      semana.numero,
                                      'text-gray-700',
                                    )}
                                  </td>
                                ))
                              ) : (
                                <td className="px-1 py-1 text-center text-[11px] whitespace-nowrap">
                                  <span className="text-red-500 text-xs">
                                    -
                                  </span>
                                </td>
                              )}
                              {/* Ouro */}
                              {semanasCalculadas &&
                              semanasCalculadas.length > 0 ? (
                                semanasCalculadas.map((semana) => (
                                  <td
                                    key={`ouro-${semana.numero}`}
                                    className="px-1 py-1 text-center text-[11px] whitespace-nowrap"
                                  >
                                    {renderCellEditorSemanal(
                                      rankingTipo,
                                      item.nome_fantasia ||
                                        item.nome_vendedor ||
                                        item.nome,
                                      'ouro',
                                      semana.numero,
                                      'text-yellow-700',
                                    )}
                                  </td>
                                ))
                              ) : (
                                <td className="px-1 py-1 text-center text-[11px] whitespace-nowrap">
                                  <span className="text-red-500 text-xs">
                                    -
                                  </span>
                                </td>
                              )}
                              {/* Diamante */}
                              {semanasCalculadas &&
                              semanasCalculadas.length > 0 ? (
                                semanasCalculadas.map((semana) => (
                                  <td
                                    key={`diamante-${semana.numero}`}
                                    className="px-1 py-1 text-center text-[11px] whitespace-nowrap"
                                  >
                                    {renderCellEditorSemanal(
                                      rankingTipo,
                                      item.nome_fantasia ||
                                        item.nome_vendedor ||
                                        item.nome,
                                      'diamante',
                                      semana.numero,
                                      'text-blue-700',
                                    )}
                                  </td>
                                ))
                              ) : (
                                <td className="px-1 py-1 text-center text-[11px] whitespace-nowrap">
                                  <span className="text-red-500 text-xs">
                                    -
                                  </span>
                                </td>
                              )}
                            </>
                          )}
                        </tr>
                      ))
                    )}

                    {dadosOrdenados().length === 0 && !loadingRanking && (
                      <tr>
                        <td
                          colSpan={
                            visualizacaoTipo === 'MENSAL'
                              ? 9
                              : 5 + semanasCalculadas.length * 4
                          }
                          className="px-1 py-2 text-center text-[11px] text-gray-500"
                        >
                          Nenhum {rankingTipo === 'lojas' ? 'loja' : 'vendedor'}{' '}
                          encontrado
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Modal de Adicionar Metas em Lote */}
          {showAddMetasModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div
                className="absolute inset-0 bg-black/30"
                onClick={fecharModalMetas}
              ></div>
              <div className="relative bg-white rounded-lg shadow-lg border border-gray-200 w-full max-w-md p-4">
                <h3 className="text-sm font-bold text-[#000638] mb-3">
                  Adicionar Metas{' '}
                  {rankingTipo === 'lojas' ? 'Lojas' : 'Vendedores'} (em lote)
                </h3>

                {/* Seletor de Tipo de Meta */}
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-2 text-[#000638]">
                    Tipo de Meta
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTipoMetaBulk('MENSAL')}
                      className={`flex items-center justify-center px-3 py-2 rounded-lg border transition-colors text-xs ${
                        tipoMetaBulk === 'MENSAL'
                          ? 'bg-[#000638] border-[#000638] text-white'
                          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      📅 Mensal
                      <span className="ml-1 text-[10px] opacity-75">
                        (divide automaticamente)
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTipoMetaBulk('SEMANAL')}
                      className={`flex items-center justify-center px-3 py-2 rounded-lg border transition-colors text-xs ${
                        tipoMetaBulk === 'SEMANAL'
                          ? 'bg-[#000638] border-[#000638] text-white'
                          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      📊 Semanal
                      <span className="ml-1 text-[10px] opacity-75">
                        (aplica em todas)
                      </span>
                    </button>
                  </div>
                </div>

                {/* Filtro de Tipo de Loja - apenas para lojas */}
                {rankingTipo === 'lojas' && (
                  <div className="mb-4">
                    <label className="block text-xs font-semibold mb-2 text-[#000638]">
                      Tipo de Loja
                    </label>
                    <select
                      value={tipoLojaModal}
                      onChange={(e) => setTipoLojaModal(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#000638]"
                    >
                      <option value="Todos">🏪 Todas as Lojas</option>
                      <option value="Proprias">🏢 Lojas Próprias</option>
                      <option value="Franquias">🏬 Franquias</option>
                    </select>
                  </div>
                )}

                <div className="space-y-3">
                  {rankingTipo === 'lojas' ? (
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-[#000638]">
                        Selecionar Lojas
                        {tipoLojaModal !== 'Todos' && (
                          <span className="text-gray-500 font-normal ml-1">
                            (
                            {tipoLojaModal === 'Proprias'
                              ? 'Próprias'
                              : 'Franquias'}
                            )
                          </span>
                        )}
                      </label>
                      <FiltroLoja
                        lojasSelecionadas={lojasSelecionadasMetas}
                        onSelectLojas={setLojasSelecionadasMetas}
                        dadosLoja={dadosLoja}
                        tipoLoja={tipoLojaModal}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-[#000638]">
                        Selecionar Vendedores
                      </label>
                      <FiltroVendedor
                        vendedoresSelecionados={vendedoresSelecionadosMetas}
                        onSelectVendedores={setVendedoresSelecionadosMetas}
                        dadosVendedor={dadosVendedor}
                      />
                    </div>
                  )}
                  {tipoMetaBulk === 'MENSAL' ? (
                    // Campos simples para meta mensal
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-amber-700 mb-1">
                          Bronze
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="w-full px-2 py-1 border border-blue-200 rounded text-[12px] bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          placeholder="0,00"
                          value={metasBulk.bronze}
                          onChange={(e) =>
                            setMetasBulk({
                              ...metasBulk,
                              bronze: sanitizeInput(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-700 mb-1">
                          Prata
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="w-full px-2 py-1 border border-blue-200 rounded text-[12px] bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          placeholder="0,00"
                          value={metasBulk.prata}
                          onChange={(e) =>
                            setMetasBulk({
                              ...metasBulk,
                              prata: sanitizeInput(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-yellow-700 mb-1">
                          Ouro
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="w-full px-2 py-1 border border-blue-200 rounded text-[12px] bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          placeholder="0,00"
                          value={metasBulk.ouro}
                          onChange={(e) =>
                            setMetasBulk({
                              ...metasBulk,
                              ouro: sanitizeInput(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-blue-700 mb-1">
                          Diamante
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="w-full px-2 py-1 border border-blue-200 rounded text-[12px] bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          placeholder="0,00"
                          value={metasBulk.diamante}
                          onChange={(e) =>
                            setMetasBulk({
                              ...metasBulk,
                              diamante: sanitizeInput(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    // Tabela com inputs para cada semana quando for meta semanal
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border border-gray-200 rounded-lg">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="px-2 py-1 text-left font-semibold text-gray-700 border-b">
                              Nível
                            </th>
                            {semanasCalculadas &&
                            semanasCalculadas.length > 0 ? (
                              semanasCalculadas.map((semana) => (
                                <th
                                  key={semana.numero}
                                  className="px-1 py-1 text-center font-semibold text-gray-700 border-b border-l"
                                >
                                  S{semana.numero}
                                  {semana.numeroAno && (
                                    <span className="text-[9px] text-blue-600 ml-1">
                                      ({semana.numeroAno})
                                    </span>
                                  )}
                                  <span className="block text-[9px] text-gray-400 mt-0.5">
                                    {formatDM(semana.inicio)} -{' '}
                                    {formatDM(semana.fim)}
                                  </span>
                                </th>
                              ))
                            ) : (
                              <th className="px-1 py-1 text-center font-semibold text-gray-700 border-b border-l">
                                Semanas
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            {
                              nivel: 'bronze',
                              label: 'Bronze',
                              color: 'amber',
                            },
                            { nivel: 'prata', label: 'Prata', color: 'gray' },
                            { nivel: 'ouro', label: 'Ouro', color: 'yellow' },
                            {
                              nivel: 'diamante',
                              label: 'Diamante',
                              color: 'blue',
                            },
                          ].map(({ nivel, label, color }) => (
                            <tr key={nivel}>
                              <td className="px-2 py-1 border-b border-r">
                                <span
                                  className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-medium bg-${color}-100 text-${color}-800`}
                                >
                                  {label}
                                </span>
                              </td>
                              {semanasCalculadas &&
                              semanasCalculadas.length > 0 ? (
                                semanasCalculadas.map((semana) => (
                                  <td
                                    key={`${nivel}-${semana.numero}`}
                                    className="px-1 py-1 border-b border-l"
                                  >
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      className={`w-full px-1 py-0.5 border border-${color}-200 rounded text-[10px] bg-${color}-50 focus:outline-none focus:ring-1 focus:ring-${color}-400 text-center`}
                                      placeholder="0,00"
                                      value={
                                        metasBulk[
                                          `${nivel}_semana_${semana.numero}`
                                        ] || ''
                                      }
                                      onChange={(e) =>
                                        setMetasBulk({
                                          ...metasBulk,
                                          [`${nivel}_semana_${semana.numero}`]:
                                            sanitizeInput(e.target.value),
                                        })
                                      }
                                    />
                                  </td>
                                ))
                              ) : (
                                <td className="px-1 py-1 border-b border-l text-center text-gray-500">
                                  Carregando...
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Descrição explicativa */}
                  <div className="mt-3 p-2 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-600">
                      {tipoMetaBulk === 'MENSAL' ? (
                        <>
                          <strong>📅 Meta Mensal:</strong> O valor será dividido
                          automaticamente pelas {semanasCalculadas.length}{' '}
                          semanas do mês. Exemplo: R$ 10.000 ÷{' '}
                          {semanasCalculadas.length} semanas = R${' '}
                          {Math.round(
                            10000 / semanasCalculadas.length,
                          ).toLocaleString('pt-BR')}{' '}
                          por semana.
                        </>
                      ) : (
                        <>
                          <strong>📊 Meta Semanal:</strong> Configure valores
                          específicos para cada semana de cada nível. Exemplo:
                          Bronze S1=2000, S2=3000, S3=4000, etc.
                        </>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2 mt-2">
                    <div className="flex items-center justify-between w-full">
                      {/* Botão Zerar Metas */}
                      <button
                        type="button"
                        onClick={abrirModalZerarMetas}
                        className="text-xs bg-red-500 text-white px-3 py-1 rounded-lg hover:bg-red-600 transition-colors"
                        title="Excluir todas as metas do período selecionado"
                      >
                        🗑️ Excluir Metas
                      </button>

                      {/* Botões de ação */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={fecharModalMetas}
                          className="text-xs bg-gray-500 text-white px-3 py-1 rounded-lg"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={confirmarAplicarMetas}
                          className="text-xs bg-[#000638] text-white px-3 py-1 rounded-lg"
                        >
                          Aplicar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Modal de Confirmação */}
          {showConfirmModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div
                className="absolute inset-0 bg-black/30"
                onClick={cancelarAplicarMetas}
              ></div>
              <div className="relative bg-white rounded-lg shadow-lg border border-gray-200 w-full max-w-sm p-4">
                <h3 className="text-sm font-bold text-[#000638] mb-3 text-center">
                  Confirmação
                </h3>
                <p className="text-xs text-gray-600 text-center mb-4">
                  Deseja realmente adicionar as metas?
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={cancelarAplicarMetas}
                    className="text-xs bg-gray-500 text-white px-4 py-1 rounded-lg hover:bg-gray-600 transition-colors"
                  >
                    Não
                  </button>
                  <button
                    type="button"
                    onClick={aplicarMetasEmLote}
                    className="text-xs bg-[#000638] text-white px-4 py-1 rounded-lg hover:bg-[#fe0000] transition-colors"
                  >
                    Sim
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal de Confirmação para Zerar Metas */}
          {showResetConfirmModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div
                className="absolute inset-0 bg-black/30"
                onClick={cancelarZerarMetas}
              ></div>
              <div className="relative bg-white rounded-lg shadow-lg border border-red-200 w-full max-w-md p-6">
                <div className="text-center">
                  <div className="text-4xl mb-4">⚠️</div>
                  <h3 className="text-lg font-bold text-red-600 mb-3">
                    ATENÇÃO: Excluir Metas
                  </h3>
                  <p className="text-sm text-gray-700 mb-4">
                    Você está prestes a <strong>EXCLUIR TODAS AS METAS</strong>{' '}
                    do período selecionado.
                  </p>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                    <p className="text-sm text-red-800 font-semibold">
                      ⚠️ Esta ação <strong>NÃO PODE SER DESFEITA</strong>!
                    </p>
                    <p className="text-xs text-red-600 mt-1">
                      Todas as metas serão excluídas permanentemente.
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 mb-4">
                    <p className="text-xs text-gray-600">
                      <strong>Período:</strong> {filtros.dt_inicio} a{' '}
                      {filtros.dt_fim}
                      <br />
                      <strong>Tipo:</strong> {tipoMetaBulk}
                      <br />
                      <strong>Entidades:</strong>{' '}
                      {rankingTipo === 'lojas'
                        ? lojasSelecionadasMetas.length
                        : vendedoresSelecionadosMetas.length}{' '}
                      {rankingTipo === 'lojas' ? 'lojas' : 'vendedores'}{' '}
                      selecionadas
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={cancelarZerarMetas}
                      className="text-sm bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={zerarMetasDoPeriodo}
                      disabled={isResettingMetas || resetCountdown > 0}
                      className="text-sm bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isResettingMetas
                        ? 'Excluindo...'
                        : resetCountdown > 0
                          ? `Confirmar (${resetCountdown}s)`
                          : 'SIM, EXCLUIR METAS'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Modal de Log de Alterações */}
          {showLogModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div
                className="absolute inset-0 bg-black/30"
                onClick={fecharLogModal}
              ></div>
              <div className="relative bg-white rounded-lg shadow-lg border border-gray-200 w-full max-w-4xl p-4 max-h-[80vh] overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-[#000638]">
                    Log de Alterações de Metas
                  </h3>
                  <button
                    type="button"
                    onClick={fecharLogModal}
                    className="text-gray-500 hover:text-gray-700 text-lg font-bold"
                  >
                    ×
                  </button>
                </div>

                <div className="overflow-auto max-h-[60vh]">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold text-gray-700">
                          Tipo
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-700">
                          Nome
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-700">
                          Campo
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-700">
                          Valor
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-700">
                          Mês
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-700">
                          Semana
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-700">
                          Usuário
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-700">
                          Data/Hora
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // Combinar logs tradicionais e semanais
                        const logsCombinados = [];

                        // Adicionar logs tradicionais (metas mensais)
                        logAlteracoesReal.forEach((log) => {
                          logsCombinados.push({
                            ...log,
                            tipo_log: 'mensal',
                            semana: '-',
                          });
                        });

                        // Adicionar logs semanais
                        logAlteracoesSemanais.forEach((log) => {
                          logsCombinados.push({
                            ...log,
                            tipo_log: 'semanal',
                            mes: log.mes_referencia,
                            nome: log.nome,
                            campo: log.campo,
                            valor: `R$ ${log.valor.toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                            })}`,
                            usuario: log.usuario,
                            data_alteracao: log.data_alteracao,
                            semana: `S${log.numero_semana}`,
                          });
                        });

                        // Ordenar por data de alteração (mais recente primeiro)
                        logsCombinados.sort(
                          (a, b) =>
                            new Date(b.data_alteracao) -
                            new Date(a.data_alteracao),
                        );

                        return logsCombinados.length > 0 ? (
                          logsCombinados.map((log, index) => (
                            <tr
                              key={`${log.tipo_log}-${index}`}
                              className="border-b border-gray-100 hover:bg-gray-50"
                            >
                              <td className="px-2 py-2">
                                <div className="flex flex-col gap-1">
                                  <span
                                    className={`px-2 py-1 rounded text-[10px] font-medium ${
                                      log.tipo === 'lojas'
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'bg-green-100 text-green-700'
                                    }`}
                                  >
                                    {log.tipo === 'lojas' ? 'Loja' : 'Vendedor'}
                                  </span>
                                  <span
                                    className={`px-1 py-0.5 rounded text-[11px] font-medium ${
                                      log.tipo_log === 'mensal'
                                        ? 'bg-purple-100 text-purple-700'
                                        : 'bg-orange-100 text-orange-700'
                                    }`}
                                  >
                                    {log.tipo_log === 'mensal'
                                      ? 'Mensal'
                                      : 'Semanal'}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-2 font-medium text-gray-900">
                                {log.nome}
                              </td>
                              <td className="px-2 py-2">
                                <span
                                  className={`px-2 py-1 rounded text-[10px] font-medium ${
                                    log.campo === 'bronze'
                                      ? 'bg-amber-100 text-amber-700'
                                      : log.campo === 'prata'
                                        ? 'bg-gray-100 text-gray-700'
                                        : log.campo === 'ouro'
                                          ? 'bg-yellow-100 text-yellow-700'
                                          : 'bg-blue-100 text-blue-700'
                                  }`}
                                >
                                  {log.campo.charAt(0).toUpperCase() +
                                    log.campo.slice(1)}
                                </span>
                              </td>
                              <td className="px-2 py-2 font-medium text-green-600">
                                {log.valor}
                              </td>
                              <td className="px-2 py-2 text-gray-700">
                                {log.mes}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <span
                                  className={`px-2 py-1 rounded text-[10px] font-medium ${
                                    log.semana === '-'
                                      ? 'bg-gray-100 text-gray-600'
                                      : 'bg-cyan-100 text-cyan-700'
                                  }`}
                                >
                                  {log.semana}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-gray-700">
                                {log.usuario}
                              </td>
                              <td className="px-2 py-2 text-gray-500">
                                {new Date(log.data_alteracao).toLocaleString(
                                  'pt-BR',
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={8}
                              className="px-2 py-4 text-center text-gray-500"
                            >
                              Nenhuma alteração registrada ainda
                            </td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-200">
                  <p className="text-xs text-gray-500 text-center">
                    Total de{' '}
                    {logAlteracoesReal.length + logAlteracoesSemanais.length}{' '}
                    alterações registradas ({logAlteracoesReal.length} mensais +{' '}
                    {logAlteracoesSemanais.length} semanais)
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {viewMode === 'dashboard' && (
        <div className="bg-white p-4 rounded-lg shadow-md border border-[#000638]/10">
          <div className="mb-4 flex justify-between items-center">
            <div>
              <h3 className="text-lg font-bold text-[#000638] mb-2">
                Dashboard de Metas{' '}
                {visualizacaoTipo === 'SEMANAL' ? '- Semanal' : ''}
              </h3>
              <p className="text-sm text-gray-600">
                {visualizacaoTipo === 'SEMANAL'
                  ? `Acompanhamento detalhado de metas por semana para cada ${
                      rankingTipo === 'lojas' ? 'loja' : 'vendedor'
                    }`
                  : 'Acompanhamento de metas atingidas por lojas e vendedores'}
              </p>
              {/* Indicador de dados de referência removido - usuário final não precisa saber */}
            </div>
            <div className="flex items-center gap-2">
              {/* Filtro de Visualização */}
              <div className="flex flex-col">
                <select
                  value={visualizacaoTipo}
                  onChange={(e) => setVisualizacaoTipo(e.target.value)}
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs min-w-[100px]"
                >
                  <option value="MENSAL">Mensal</option>
                  <option value="SEMANAL">Semanal</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (visualizacaoTipo === 'SEMANAL') {
                    calcularStatsSemanais();
                  } else {
                    calcularStatsDashboard();
                  }
                }}
                className="text-xs bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] transition-colors"
              >
                Recalcular Estatísticas
              </button>

              <button
                type="button"
                onClick={gerarRelatorioPDF}
                className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 transition-colors"
              >
                Baixar Relatório
              </button>
            </div>
          </div>

          {visualizacaoTipo === 'SEMANAL' ? (
            // NOVO LAYOUT SEMANAL - Cards individuais para cada loja ou vendedor
            <>
              {/* Cards de Estatísticas Semanais */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {/* Card Bronze Semanal */}
                <div
                  className="bg-white p-4 rounded-lg shadow border border-amber-200 cursor-pointer hover:shadow-lg hover:border-amber-400 transition-all"
                  onClick={() => abrirModalMetasDetalhes('bronze', 'lojas')}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-amber-700">
                        Meta Bronze Semanal
                      </p>
                      <p className="text-xs text-amber-600">
                        Clique para detalhes
                      </p>
                    </div>
                    <div className="text-2xl">🥉</div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Lojas:</span>
                      <span className="font-bold text-amber-700">
                        {dashboardStats.bronze.lojas}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Vendedores:</span>
                      <span className="font-bold text-amber-700">
                        {dashboardStats.bronze.vendedores}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Prata Semanal */}
                <div
                  className="bg-white p-4 rounded-lg shadow border border-gray-200 cursor-pointer hover:shadow-lg hover:border-gray-400 transition-all"
                  onClick={() => abrirModalMetasDetalhes('prata', 'lojas')}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-gray-700">
                        Meta Prata Semanal
                      </p>
                      <p className="text-xs text-gray-600">
                        Clique para detalhes
                      </p>
                    </div>
                    <div className="text-2xl">🥈</div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Lojas:</span>
                      <span className="font-bold text-gray-700">
                        {dashboardStats.prata.lojas}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Vendedores:</span>
                      <span className="font-bold text-gray-700">
                        {dashboardStats.prata.vendedores}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Ouro Semanal */}
                <div
                  onClick={() => abrirModalMetasDetalhes('ouro', 'lojas')}
                  className="bg-white p-4 rounded-lg shadow border border-yellow-200 cursor-pointer hover:shadow-lg hover:border-yellow-400 transition-all"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-yellow-700">
                        Meta Ouro
                      </p>
                      <p className="text-xs text-yellow-600">
                        Clique para detalhes
                      </p>
                    </div>
                    <div className="text-2xl">🥇</div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Lojas:</span>
                      <span className="font-bold text-yellow-700">
                        {dashboardStats.ouro.lojas}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Vendedores:</span>
                      <span className="font-bold text-yellow-700">
                        {dashboardStats.ouro.vendedores}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Diamante Semanal */}
                <div
                  onClick={() => abrirModalMetasDetalhes('diamante', 'lojas')}
                  className="bg-white p-4 rounded-lg shadow border border-blue-200 cursor-pointer hover:shadow-lg hover:border-blue-400 transition-all"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-blue-700">
                        Meta Diamante
                      </p>
                      <p className="text-xs text-blue-600">
                        Clique para detalhes
                      </p>
                    </div>
                    <div className="text-2xl">💎</div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Lojas:</span>
                      <span className="font-bold text-blue-700">
                        {dashboardStats.diamante.lojas}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Vendedores:</span>
                      <span className="font-bold text-blue-700">
                        {dashboardStats.diamante.vendedores}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal de Detalhes de Metas */}
              {showModalMetasDetalhes && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-96 overflow-y-auto">
                    {/* Header */}
                    <div className="sticky top-0 bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                      <h2 className="text-xl font-bold text-gray-800">
                        {metasDetalhesData.nivel === 'bronze' &&
                          '🥉 Detalhes Meta Bronze'}
                        {metasDetalhesData.nivel === 'prata' &&
                          '🥈 Detalhes Meta Prata'}
                        {metasDetalhesData.nivel === 'ouro' &&
                          '🥇 Detalhes Meta Ouro'}
                        {metasDetalhesData.nivel === 'diamante' &&
                          '💎 Detalhes Meta Diamante'}
                      </h2>
                      <button
                        onClick={() => setShowModalMetasDetalhes(false)}
                        className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                      >
                        ×
                      </button>
                    </div>

                    {/* Content */}
                    <div className="p-6">
                      {metasDetalhesData.entidades &&
                      metasDetalhesData.entidades.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-100 border-b border-gray-200">
                                <th className="px-4 py-2 text-left font-semibold text-gray-700">
                                  {metasDetalhesData.tipo === 'lojas'
                                    ? 'Loja'
                                    : 'Vendedor'}
                                </th>
                                <th className="px-4 py-2 text-right font-semibold text-gray-700">
                                  Meta
                                </th>
                                <th className="px-4 py-2 text-right font-semibold text-gray-700">
                                  Faturamento
                                </th>
                                <th className="px-4 py-2 text-right font-semibold text-gray-700">
                                  % Atingido
                                </th>
                                {metasDetalhesData.tipo === 'lojas' && (
                                  <th className="px-4 py-2 text-center font-semibold text-gray-700">
                                    Semana
                                  </th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {metasDetalhesData.entidades.map(
                                (entidade, idx) => {
                                  const percentualAtingido =
                                    entidade.faturamento && entidade.meta
                                      ? Math.round(
                                          (entidade.faturamento /
                                            entidade.meta) *
                                            100,
                                        )
                                      : 0;
                                  return (
                                    <tr
                                      key={idx}
                                      className="border-b border-gray-100 hover:bg-gray-50"
                                    >
                                      <td className="px-4 py-3 text-gray-800">
                                        {entidade.nome}
                                      </td>
                                      <td className="px-4 py-3 text-right text-gray-700">
                                        {formatBRL(entidade.meta)}
                                      </td>
                                      <td className="px-4 py-3 text-right font-semibold text-gray-800">
                                        {formatBRL(entidade.faturamento)}
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                        <span
                                          className={`font-bold ${
                                            percentualAtingido >= 100
                                              ? 'text-green-600'
                                              : percentualAtingido >= 80
                                                ? 'text-blue-600'
                                                : 'text-orange-600'
                                          }`}
                                        >
                                          {percentualAtingido}%
                                        </span>
                                      </td>
                                      {metasDetalhesData.tipo === 'lojas' && (
                                        <td className="px-4 py-3 text-center text-gray-600">
                                          {entidade.semana || '—'}
                                        </td>
                                      )}
                                    </tr>
                                  );
                                },
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-gray-500">
                          Nenhum{' '}
                          {metasDetalhesData.tipo === 'lojas'
                            ? 'loja'
                            : 'vendedor'}{' '}
                          encontrado neste nível de meta.
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-right">
                      <button
                        onClick={() => setShowModalMetasDetalhes(false)}
                        className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                      >
                        Fechar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Botões para alternar entre tabelas semanais */}
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTabelaAtiva('lojas')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors text-sm font-medium ${
                      tabelaAtiva === 'lojas'
                        ? 'bg-[#000638] border-[#000638] text-white'
                        : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Lojas
                  </button>

                  <button
                    type="button"
                    onClick={() => setTabelaAtiva('vendedores')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors text-sm font-medium ${
                      tabelaAtiva === 'vendedores'
                        ? 'bg-[#000638] border-[#000638] text-white'
                        : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Vendedores
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                {tabelaAtiva === 'lojas' ? (
                  // Dashboard Semanal para Lojas
                  dashboardStats.lojaDetalhes &&
                  dashboardStats.lojaDetalhes.length > 0 ? (
                    (() => {
                      const lista = dashboardStats.lojaDetalhes
                        .filter((loja) => {
                          // Filtrar por lojas selecionadas se houver
                          if (lojasSelecionadas.length > 0) {
                            return lojasSelecionadas.some((l) =>
                              (
                                l.nome_fantasia ||
                                l.nome_loja ||
                                l.loja ||
                                l.nm_loja ||
                                l.nome ||
                                ''
                              ).includes(loja.nome),
                            );
                          }
                          return true;
                        })
                        // Filtrar por tipo de loja
                        .filter((loja) => {
                          const nomeLoja = loja.nome;

                          if (tipoLoja === 'Franquias') {
                            // Considerar franquia se o nome contém "F0" (padrão de código de franquia)
                            const isFranquia = nomeLoja.includes('F0');
                            console.log('É franquia?', isFranquia);
                            return isFranquia;
                          }

                          if (tipoLoja === 'Proprias') {
                            // Considerar própria se o nome NÃO contém "F0"
                            const isFranquia =
                              nomeLoja.includes('-') ||
                              nomeLoja.includes('- CROSBY');
                            console.log('É própria?', !isFranquia);
                            return !isFranquia;
                          }

                          return true; // 'Todos'
                        })
                        .sort((a, b) => b.faturamento - a.faturamento); // Ordenar por faturamento

                      const totalPages = Math.max(
                        1,
                        Math.ceil(lista.length / PAGE_SIZE),
                      );
                      const start = pageLojas * PAGE_SIZE;
                      const pageItems = lista.slice(start, start + PAGE_SIZE);

                      const rendered = pageItems.map((loja, index) => {
                        const dadosSemanas = calcularDadosTodasSemanas(
                          loja,
                          'lojas',
                        );

                        return (
                          <div
                            key={index}
                            className="bg-gray-50 p-4 rounded-lg border border-gray-200"
                          >
                            {/* Header da Loja */}
                            <div className="mb-4 flex items-center justify-between">
                              <div>
                                <h4 className="text-lg font-bold text-[#000638]">
                                  {loja.nome}
                                </h4>
                                <p className="text-sm text-gray-600">
                                  Faturamento Total:{' '}
                                  {formatBRL(loja.faturamento)}
                                </p>
                              </div>
                              <div className="text-right">
                                <div className="text-2xl font-bold text-green-600">
                                  {formatBRL(loja.faturamento)}
                                </div>
                                <div className="text-xs text-gray-500">
                                  Faturamento Mensal
                                </div>
                              </div>
                            </div>

                            {/* Tabela de Dados Semanais */}
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      Semana
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      Faturamento Semanal
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      Meta Atual
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      Próxima Meta
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      Progresso
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      Falta
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {dadosSemanas.map((semana, semanaIndex) => (
                                    <tr
                                      key={semanaIndex}
                                      className="hover:bg-gray-50"
                                    >
                                      {/* Semana */}
                                      <td className="px-4 py-4 whitespace-nowrap">
                                        <span className="inline-flex items-center px-2 py-1 rounded-full text-sm font-medium bg-cyan-100 text-cyan-800">
                                          S{semana.numero}
                                          {semana.numeroAno && (
                                            <>
                                              <span className="text-[10px] text-blue-600 ml-1">
                                                ({semana.numeroAno})
                                              </span>
                                              <span className="text-[10px] text-gray-500 ml-1">
                                                {formatDM(semana.inicio)} -{' '}
                                                {formatDM(semana.fim)}
                                              </span>
                                            </>
                                          )}
                                        </span>
                                      </td>

                                      {/* Faturamento Semanal */}
                                      <td className="px-4 py-4 whitespace-nowrap">
                                        <span className="text-sm font-semibold text-green-600">
                                          {formatBRL(semana.faturamento)}
                                        </span>
                                      </td>

                                      {/* Meta Atual */}
                                      <td className="px-4 py-4 whitespace-nowrap">
                                        {semana.metaAtingida > 0 ? (
                                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                                            {semana.nomeMetaAtingida}
                                          </span>
                                        ) : (
                                          <span className="text-sm text-gray-400">
                                            -
                                          </span>
                                        )}
                                      </td>

                                      {/* Próxima Meta */}
                                      <td className="px-4 py-4 whitespace-nowrap">
                                        {semana.proximaMeta > 0 ? (
                                          <div>
                                            <div className="text-sm font-semibold text-gray-800">
                                              {semana.nomeProximaMeta}
                                            </div>
                                            <div className="text-sm text-gray-600">
                                              {formatBRL(semana.proximaMeta)}
                                            </div>
                                          </div>
                                        ) : (
                                          <span className="text-sm text-gray-400">
                                            -
                                          </span>
                                        )}
                                      </td>

                                      {/* Progresso */}
                                      <td className="px-4 py-4 whitespace-nowrap">
                                        {semana.proximaMeta > 0 ? (
                                          <div className="flex items-center space-x-2">
                                            <div className="flex-1 bg-gray-200 rounded-full h-2 w-20">
                                              <div
                                                className="bg-yellow-500 h-2 rounded-full transition-all duration-300"
                                                style={{
                                                  width: `${semana.progresso}%`,
                                                }}
                                              ></div>
                                            </div>
                                            <span className="text-sm font-medium text-gray-800">
                                              {semana.progresso}%
                                            </span>
                                          </div>
                                        ) : (
                                          <span className="text-sm text-gray-400">
                                            -
                                          </span>
                                        )}
                                      </td>

                                      {/* Falta */}
                                      <td className="px-4 py-4 whitespace-nowrap">
                                        <div className="flex flex-col">
                                          {semana.faltante > 0 ? (
                                            <span className="text-sm font-semibold text-gray-800">
                                              {formatBRL(semana.faltante)}
                                            </span>
                                          ) : semana.metaAtingida > 0 ? (
                                            <span className="text-sm font-medium text-green-600">
                                              ✓ Atingida
                                            </span>
                                          ) : (
                                            <span className="text-sm text-gray-400">
                                              -
                                            </span>
                                          )}
                                          <span className="text-[10px] text-blue-600 mt-1">
                                            {calcularDiasRestantesSemana(
                                              semana.fim,
                                            )}{' '}
                                            dias restantes
                                          </span>
                                          {semana.faltante > 0 && (
                                            <span className="text-[11px] text-gray-600">
                                              ≈{' '}
                                              {formatBRL(
                                                calcularFaltaPorDia(
                                                  semana.faltante,
                                                  semana.fim,
                                                ),
                                              )}{' '}
                                              por dia
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      });

                      return (
                        <>
                          {rendered}
                          {/* Paginação Lojas */}
                          <div className="flex items-center justify-between mt-3">
                            <button
                              type="button"
                              className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-50"
                              onClick={() =>
                                setPageLojas((p) => Math.max(0, p - 1))
                              }
                              disabled={pageLojas === 0}
                            >
                              Anterior
                            </button>
                            <div className="flex items-center gap-1">
                              {Array.from({ length: totalPages }, (_, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => setPageLojas(i)}
                                  className={`px-2 py-1 text-xs rounded border ${
                                    i === pageLojas
                                      ? 'bg-[#000638] text-white border-[#000638]'
                                      : 'border-gray-300'
                                  }`}
                                >
                                  {i + 1}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-50"
                              onClick={() =>
                                setPageLojas((p) =>
                                  Math.min(totalPages - 1, p + 1),
                                )
                              }
                              disabled={pageLojas >= totalPages - 1}
                            >
                              Próxima
                            </button>
                          </div>
                        </>
                      );
                    })()
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-gray-500">
                        Nenhuma loja encontrada com dados disponíveis.
                      </p>
                    </div>
                  )
                ) : // Dashboard Semanal para Vendedores
                dashboardStats.vendedorDetalhes &&
                  dashboardStats.vendedorDetalhes.length > 0 ? (
                  (() => {
                    const lista = dashboardStats.vendedorDetalhes
                      .filter((vendedor) => {
                        // Filtrar por vendedores selecionados se houver
                        if (vendedoresSelecionados.length > 0) {
                          return vendedoresSelecionados.some((v) =>
                            (
                              v.nome_vendedor ||
                              v.vendedor ||
                              v.nm_vendedor ||
                              v.nome ||
                              ''
                            ).includes(vendedor.nome),
                          );
                        }
                        return true;
                      })
                      // Filtrar por tipo de loja (vendedores de franquias vs próprias)
                      .filter((vendedor) => {
                        const nomeVendedor = vendedor.nome;

                        if (tipoLoja === 'Franquias') {
                          // Vendedores de franquias não têm "- INT" no nome
                          return !nomeVendedor.includes('- INT');
                        }

                        if (tipoLoja === 'Proprias') {
                          // Vendedores de lojas próprias têm "- INT" no nome
                          return nomeVendedor.includes('- INT');
                        }

                        return true; // 'Todos'
                      })
                      .sort((a, b) => b.faturamento - a.faturamento); // Ordenar por faturamento

                    const totalPages = Math.max(
                      1,
                      Math.ceil(lista.length / PAGE_SIZE),
                    );
                    const start = pageVendedores * PAGE_SIZE;
                    const pageItems = lista.slice(start, start + PAGE_SIZE);

                    const rendered = pageItems.map((vendedor, index) => {
                      const dadosSemanas = calcularDadosTodasSemanas(
                        vendedor,
                        'vendedores',
                      );

                      return (
                        <div
                          key={index}
                          className="bg-gray-50 p-4 rounded-lg border border-gray-200"
                        >
                          {/* Header do Vendedor */}
                          <div className="mb-4 flex items-center justify-between">
                            <div>
                              <h4 className="text-lg font-bold text-[#000638]">
                                {vendedor.nome}
                              </h4>
                              <p className="text-sm text-gray-600">
                                Faturamento Total:{' '}
                                {formatBRL(vendedor.faturamento)}
                              </p>
                            </div>
                            <div className="text-right">
                              <div className="text-2xl font-bold text-green-600">
                                {formatBRL(vendedor.faturamento)}
                              </div>
                              <div className="text-xs text-gray-500">
                                Faturamento Mensal
                              </div>
                            </div>
                          </div>

                          {/* Tabela de Dados Semanais */}
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Semana
                                  </th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Faturamento Semanal
                                  </th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Meta Atual
                                  </th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Próxima Meta
                                  </th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Progresso
                                  </th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Falta
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {dadosSemanas.map((semana, semanaIndex) => (
                                  <tr
                                    key={semanaIndex}
                                    className="hover:bg-gray-50"
                                  >
                                    {/* Semana */}
                                    <td className="px-4 py-4 whitespace-nowrap">
                                      <span className="inline-flex items-center px-2 py-1 rounded-full text-sm font-medium bg-cyan-100 text-cyan-800">
                                        S{semana.numero}
                                        {semana.numeroAno && (
                                          <>
                                            <span className="text-[10px] text-blue-600 ml-1">
                                              ({semana.numeroAno})
                                            </span>
                                            <span className="text-[10px] text-gray-500 ml-1">
                                              {formatDM(semana.inicio)} -{' '}
                                              {formatDM(semana.fim)}
                                            </span>
                                          </>
                                        )}
                                      </span>
                                    </td>

                                    {/* Faturamento Semanal */}
                                    <td className="px-4 py-4 whitespace-nowrap">
                                      <span className="text-sm font-semibold text-green-600">
                                        {formatBRL(semana.faturamento)}
                                      </span>
                                    </td>

                                    {/* Meta Atual */}
                                    <td className="px-4 py-4 whitespace-nowrap">
                                      {semana.metaAtingida > 0 ? (
                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                                          {semana.nomeMetaAtingida}
                                        </span>
                                      ) : (
                                        <span className="text-sm text-gray-400">
                                          -
                                        </span>
                                      )}
                                    </td>

                                    {/* Próxima Meta */}
                                    <td className="px-4 py-4 whitespace-nowrap">
                                      {semana.proximaMeta > 0 ? (
                                        <div>
                                          <div className="text-sm font-semibold text-gray-800">
                                            {semana.nomeProximaMeta}
                                          </div>
                                          <div className="text-sm text-gray-600">
                                            {formatBRL(semana.proximaMeta)}
                                          </div>
                                        </div>
                                      ) : (
                                        <span className="text-sm text-gray-400">
                                          -
                                        </span>
                                      )}
                                    </td>

                                    {/* Progresso */}
                                    <td className="px-4 py-4 whitespace-nowrap">
                                      {semana.proximaMeta > 0 ? (
                                        <div className="flex items-center space-x-2">
                                          <div className="flex-1 bg-gray-200 rounded-full h-2 w-20">
                                            <div
                                              className="bg-yellow-500 h-2 rounded-full transition-all duration-300"
                                              style={{
                                                width: `${semana.progresso}%`,
                                              }}
                                            ></div>
                                          </div>
                                          <span className="text-sm font-medium text-gray-800">
                                            {semana.progresso}%
                                          </span>
                                        </div>
                                      ) : (
                                        <span className="text-sm text-gray-400">
                                          -
                                        </span>
                                      )}
                                    </td>

                                    {/* Falta */}
                                    <td className="px-4 py-4 whitespace-nowrap">
                                      <div className="flex flex-col">
                                        {semana.faltante > 0 ? (
                                          <span className="text-sm font-semibold text-gray-800">
                                            {formatBRL(semana.faltante)}
                                          </span>
                                        ) : semana.metaAtingida > 0 ? (
                                          <span className="text-sm font-medium text-green-600">
                                            ✓ Atingida
                                          </span>
                                        ) : (
                                          <span className="text-sm text-gray-400">
                                            -
                                          </span>
                                        )}
                                        <span className="text-[10px] text-blue-600 mt-1">
                                          {calcularDiasRestantesSemana(
                                            semana.fim,
                                          )}{' '}
                                          dias restantes
                                        </span>
                                        {semana.faltante > 0 && (
                                          <span className="text-[10px] text-gray-600">
                                            ≈{' '}
                                            {formatBRL(
                                              calcularFaltaPorDia(
                                                semana.faltante,
                                                semana.fim,
                                              ),
                                            )}{' '}
                                            por dia
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    });

                    return (
                      <>
                        {rendered}
                        {/* Paginação Vendedores */}
                        <div className="flex items-center justify-between mt-3">
                          <button
                            type="button"
                            className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-50"
                            onClick={() =>
                              setPageVendedores((p) => Math.max(0, p - 1))
                            }
                            disabled={pageVendedores === 0}
                          >
                            Anterior
                          </button>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: totalPages }, (_, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setPageVendedores(i)}
                                className={`px-2 py-1 text-xs rounded border ${
                                  i === pageVendedores
                                    ? 'bg-[#000638] text-white border-[#000638]'
                                    : 'border-gray-300'
                                }`}
                              >
                                {i + 1}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-50"
                            onClick={() =>
                              setPageVendedores((p) =>
                                Math.min(totalPages - 1, p + 1),
                              )
                            }
                            disabled={pageVendedores >= totalPages - 1}
                          >
                            Próxima
                          </button>
                        </div>
                      </>
                    );
                  })()
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-500">
                      Nenhum vendedor encontrado com dados disponíveis.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            // LAYOUT MENSAL ORIGINAL
            <>
              {/* Cards de Metas */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {/* Card Bronze */}
                <div className="bg-white p-4 rounded-lg shadow border border-amber-200">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-amber-700">
                        Meta Bronze
                      </p>
                      <p className="text-xs text-amber-600">
                        Faturamento atingido
                      </p>
                    </div>
                    <div className="text-2xl">🥉</div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Lojas:</span>
                      <span className="font-bold text-amber-700">
                        {dashboardStats.bronze.lojas}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Vendedores:</span>
                      <span className="font-bold text-amber-700">
                        {dashboardStats.bronze.vendedores}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Prata */}
                <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-gray-700">
                        Meta Prata
                      </p>
                      <p className="text-xs text-gray-600">
                        Faturamento atingido
                      </p>
                    </div>
                    <div className="text-2xl">🥈</div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Lojas:</span>
                      <span className="font-bold text-gray-700">
                        {dashboardStats.prata.lojas}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Vendedores:</span>
                      <span className="font-bold text-gray-700">
                        {dashboardStats.prata.vendedores}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Ouro */}
                <div className="bg-white p-4 rounded-lg shadow border border-yellow-200">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-yellow-700">
                        Meta Ouro
                      </p>
                      <p className="text-xs text-yellow-600">
                        Faturamento atingido
                      </p>
                    </div>
                    <div className="text-2xl">🥇</div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Lojas:</span>
                      <span className="font-bold text-yellow-700">
                        {dashboardStats.ouro.lojas}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Vendedores:</span>
                      <span className="font-bold text-yellow-700">
                        {dashboardStats.ouro.vendedores}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Diamante */}
                <div className="bg-white p-4 rounded-lg shadow border border-blue-200">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-blue-700">
                        Meta Diamante
                      </p>
                      <p className="text-xs text-blue-600">
                        Faturamento atingido
                      </p>
                    </div>
                    <div className="text-2xl">💎</div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Lojas:</span>
                      <span className="font-bold text-blue-700">
                        {dashboardStats.diamante.lojas}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Vendedores:</span>
                      <span className="font-bold text-blue-700">
                        {dashboardStats.diamante.vendedores}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Botões para alternar entre tabelas */}
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTabelaAtiva('lojas')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors text-sm font-medium ${
                      tabelaAtiva === 'lojas'
                        ? 'bg-[#000638] border-[#000638] text-white'
                        : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Lojas
                  </button>

                  <button
                    type="button"
                    onClick={() => setTabelaAtiva('vendedores')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors text-sm font-medium ${
                      tabelaAtiva === 'vendedores'
                        ? 'bg-[#000638] border-[#000638] text-white'
                        : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Vendedores
                  </button>
                </div>
              </div>

              {/* Tabela de Progresso de Metas - LOJAS */}
              {tabelaAtiva === 'lojas' && (
                <div className="mb-6">
                  <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-bold text-[#000638]">
                          Progresso de Metas por Loja
                        </p>
                        <p className="text-xs text-gray-600">
                          Acompanhamento detalhado do progresso para a próxima
                          meta
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Loja
                            </th>
                            {visualizacaoTipo === 'SEMANAL' ? (
                              <>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Semana Atual
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Faturamento Semanal
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Meta da Semana
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Meta Atingida
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Próxima Meta
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Falta para Próxima
                                </th>
                              </>
                            ) : (
                              <>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Faturamento
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Meta Atual
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Próxima Meta
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Progresso
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Falta
                                </th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {dashboardStats.lojaDetalhes &&
                          dashboardStats.lojaDetalhes.length > 0 ? (
                            dashboardStats.lojaDetalhes
                              .filter((loja) => {
                                // Filtrar por lojas selecionadas se houver
                                if (lojasSelecionadas.length > 0) {
                                  return lojasSelecionadas.some((l) =>
                                    (
                                      l.nome_fantasia ||
                                      l.nome_loja ||
                                      l.loja ||
                                      l.nm_loja ||
                                      l.nome ||
                                      ''
                                    ).includes(loja.nome),
                                  );
                                }
                                return true;
                              })
                              // Filtrar por tipo de loja
                              .filter((loja) => {
                                const nomeLoja = loja.nome;

                                if (tipoLoja === 'Franquias') {
                                  // Considerar franquia se o nome contém "F0" (padrão de código de franquia)
                                  const isFranquia = nomeLoja.includes('F0');
                                  console.log('É franquia?', isFranquia);
                                  return isFranquia;
                                }

                                if (tipoLoja === 'Proprias') {
                                  // Considerar própria se o nome NÃO contém "F0"
                                  const isFranquia =
                                    nomeLoja.includes('-') ||
                                    nomeLoja.includes('- CROSBY');
                                  console.log('É própria?', !isFranquia);
                                  return !isFranquia;
                                }

                                return true; // 'Todos'
                              })
                              .sort((a, b) => b.faturamento - a.faturamento) // Ordenar por faturamento
                              .map((loja, index) => (
                                <tr
                                  key={index}
                                  className="hover:bg-gray-50 cursor-pointer"
                                  onClick={() => {
                                    console.log(
                                      'Clique na linha da loja:',
                                      loja.nome,
                                    );
                                    // Encontrar dados completos da loja nos dadosLojas
                                    const lojaCompleta = dadosLojas.find(
                                      (l) => {
                                        const nomeLoja =
                                          l.nome_fantasia ||
                                          l.nome_loja ||
                                          l.loja ||
                                          l.nm_loja ||
                                          l.nome ||
                                          '';
                                        return nomeLoja === loja.nome;
                                      },
                                    );
                                    console.log(
                                      'Dados completos da loja:',
                                      lojaCompleta,
                                    );

                                    // Combinar dados da loja com detalhes de metas
                                    const detalhes = {
                                      ...loja,
                                      tipo: 'loja',
                                      dadosCompletos: lojaCompleta || {},
                                    };
                                    console.log(
                                      'Detalhes a serem enviados:',
                                      detalhes,
                                    );
                                    abrirModalDetalhes(detalhes);
                                  }}
                                >
                                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                                    {loja.nome}
                                  </td>
                                  {visualizacaoTipo === 'SEMANAL' ? (
                                    <>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              loja,
                                              'lojas',
                                            );
                                          return (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-cyan-100 text-cyan-800">
                                              {dadosSemanais.semanaAtual}
                                            </span>
                                          );
                                        })()}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs font-medium text-green-600">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              loja,
                                              'lojas',
                                            );
                                          return formatBRL(
                                            dadosSemanais.faturamentoSemanal,
                                          );
                                        })()}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              loja,
                                              'lojas',
                                            );
                                          return dadosSemanais.metaSemanaAtual >
                                            0
                                            ? formatBRL(
                                                dadosSemanais.metaSemanaAtual,
                                              )
                                            : '-';
                                        })()}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              loja,
                                              'lojas',
                                            );
                                          return dadosSemanais.metaAtingida >
                                            0 ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                              {formatBRL(
                                                dadosSemanais.metaAtingida,
                                              )}
                                            </span>
                                          ) : (
                                            '-'
                                          );
                                        })()}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              loja,
                                              'lojas',
                                            );
                                          return dadosSemanais.proximaMeta >
                                            0 ? (
                                            <div className="flex flex-col">
                                              <span className="text-xs font-medium text-orange-600">
                                                {formatBRL(
                                                  dadosSemanais.proximaMeta,
                                                )}
                                              </span>
                                            </div>
                                          ) : (
                                            '-'
                                          );
                                        })()}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              loja,
                                              'lojas',
                                            );
                                          return dadosSemanais.faltanteProximaMeta >
                                            0 ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                              {formatBRL(
                                                dadosSemanais.faltanteProximaMeta,
                                              )}
                                            </span>
                                          ) : dadosSemanais.proximaMeta > 0 ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                              ✓ Atingida
                                            </span>
                                          ) : (
                                            '-'
                                          );
                                        })()}
                                      </td>
                                    </>
                                  ) : (
                                    <>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs font-medium text-green-600">
                                        {formatBRL(loja.faturamento)}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        <span
                                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                                      ${
                                        loja.metaAtual === 'Diamante'
                                          ? 'bg-blue-100 text-blue-800'
                                          : loja.metaAtual === 'Ouro'
                                            ? 'bg-yellow-100 text-yellow-800'
                                            : loja.metaAtual === 'Prata'
                                              ? 'bg-gray-100 text-gray-800'
                                              : loja.metaAtual === 'Bronze'
                                                ? 'bg-amber-100 text-amber-800'
                                                : 'bg-gray-100 text-gray-800'
                                      }`}
                                        >
                                          {loja.metaAtual}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="flex flex-col">
                                          <span className="text-xs font-medium">
                                            {loja.proximaMeta}
                                          </span>
                                          {loja.valorProximaMeta > 0 && (
                                            <span className="text-xs text-gray-500">
                                              {formatBRL(loja.valorProximaMeta)}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="flex items-center">
                                          <div className="w-full bg-gray-200 rounded-full h-2.5 mr-2">
                                            <div
                                              className={`h-2.5 rounded-full ${
                                                loja.metaAtual === 'Diamante'
                                                  ? 'bg-blue-600'
                                                  : loja.metaAtual === 'Ouro'
                                                    ? 'bg-yellow-500'
                                                    : loja.metaAtual === 'Prata'
                                                      ? 'bg-gray-500'
                                                      : loja.metaAtual ===
                                                          'Bronze'
                                                        ? 'bg-amber-500'
                                                        : 'bg-blue-600'
                                              }`}
                                              style={{
                                                width: `${loja.percentualAtingido}%`,
                                              }}
                                            ></div>
                                          </div>
                                          <span className="text-xs font-medium">
                                            {loja.percentualAtingido}%
                                          </span>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                                        {loja.valorFaltante > 0
                                          ? formatBRL(loja.valorFaltante)
                                          : 'Meta atingida'}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              ))
                          ) : (
                            <tr>
                              <td
                                colSpan={visualizacaoTipo === 'SEMANAL' ? 7 : 6}
                                className="px-3 py-4 text-center text-sm text-gray-500"
                              >
                                Nenhum dado disponível. Verifique se existem
                                metas cadastradas e faturamento no período.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabela de Progresso de Metas - VENDEDORES */}
              {tabelaAtiva === 'vendedores' && (
                <div className="mb-6">
                  <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-bold text-[#000638]">
                          Progresso de Metas por Vendedor
                        </p>
                        <p className="text-xs text-gray-600">
                          Acompanhamento detalhado do progresso para a próxima
                          meta
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Vendedor
                            </th>
                            {visualizacaoTipo === 'SEMANAL' ? (
                              <>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Semana Atual
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Faturamento Semanal
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Meta da Semana
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Meta Atingida
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Próxima Meta
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Falta para Próxima
                                </th>
                              </>
                            ) : (
                              <>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Faturamento
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Meta Atual
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Próxima Meta
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Progresso
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Falta
                                </th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {dashboardStats.vendedorDetalhes &&
                          dashboardStats.vendedorDetalhes.length > 0 ? (
                            dashboardStats.vendedorDetalhes
                              .filter((vendedor) => {
                                // Filtrar por vendedores selecionados se houver
                                if (vendedoresSelecionados.length > 0) {
                                  return vendedoresSelecionados.some((v) =>
                                    (
                                      v.nome_vendedor ||
                                      v.vendedor ||
                                      v.nm_vendedor ||
                                      v.nome ||
                                      ''
                                    ).includes(vendedor.nome),
                                  );
                                }
                                return true;
                              })
                              // Filtrar por tipo de loja (para vendedores)
                              .filter((vendedor) => {
                                const nomeVendedor = vendedor.nome;

                                if (tipoLoja === 'Franquias') {
                                  // Vendedores de franquias não têm "- INT" no nome
                                  return !nomeVendedor.includes('- INT');
                                }

                                if (tipoLoja === 'Proprias') {
                                  // Vendedores de lojas próprias têm "- INT" no nome
                                  return nomeVendedor.includes('- INT');
                                }

                                return true; // 'Todos'
                              })
                              .sort((a, b) => b.faturamento - a.faturamento) // Ordenar por faturamento
                              .map((vendedor, index) => (
                                <tr
                                  key={index}
                                  className="hover:bg-gray-50 cursor-pointer"
                                  onClick={() => {
                                    console.log(
                                      'Clique na linha do vendedor:',
                                      vendedor.nome,
                                    );
                                    // Encontrar dados completos do vendedor nos dadosVendedores
                                    const vendedorCompleto =
                                      dadosVendedores.find((v) => {
                                        const nomeVendedor =
                                          v.nome_vendedor ||
                                          v.vendedor ||
                                          v.nm_vendedor ||
                                          v.nome ||
                                          '';
                                        return nomeVendedor === vendedor.nome;
                                      });
                                    console.log(
                                      'Dados completos do vendedor:',
                                      vendedorCompleto,
                                    );

                                    // Combinar dados do vendedor com detalhes de metas
                                    const detalhes = {
                                      ...vendedor,
                                      tipo: 'vendedor',
                                      dadosCompletos: vendedorCompleto || {},
                                    };
                                    console.log(
                                      'Detalhes a serem enviados:',
                                      detalhes,
                                    );
                                    abrirModalDetalhes(detalhes);
                                  }}
                                >
                                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                                    {vendedor.nome}
                                  </td>
                                  {visualizacaoTipo === 'SEMANAL' ? (
                                    <>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              vendedor,
                                              'vendedores',
                                            );
                                          return (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-cyan-100 text-cyan-800">
                                              {dadosSemanais.semanaAtual}
                                            </span>
                                          );
                                        })()}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs font-medium text-green-600">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              vendedor,
                                              'vendedores',
                                            );
                                          return formatBRL(
                                            dadosSemanais.faturamentoSemanal,
                                          );
                                        })()}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              vendedor,
                                              'vendedores',
                                            );
                                          return dadosSemanais.metaSemanaAtual >
                                            0
                                            ? formatBRL(
                                                dadosSemanais.metaSemanaAtual,
                                              )
                                            : '-';
                                        })()}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              vendedor,
                                              'vendedores',
                                            );
                                          return dadosSemanais.metaAtingida >
                                            0 ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                              {formatBRL(
                                                dadosSemanais.metaAtingida,
                                              )}
                                            </span>
                                          ) : (
                                            '-'
                                          );
                                        })()}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              vendedor,
                                              'vendedores',
                                            );
                                          return dadosSemanais.proximaMeta >
                                            0 ? (
                                            <div className="flex flex-col">
                                              <span className="text-xs font-medium text-orange-600">
                                                {formatBRL(
                                                  dadosSemanais.proximaMeta,
                                                )}
                                              </span>
                                            </div>
                                          ) : (
                                            '-'
                                          );
                                        })()}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                                        {(() => {
                                          const dadosSemanais =
                                            calcularDadosSemanaisDashboard(
                                              vendedor,
                                              'vendedores',
                                            );
                                          return dadosSemanais.faltanteProximaMeta >
                                            0 ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                              {formatBRL(
                                                dadosSemanais.faltanteProximaMeta,
                                              )}
                                            </span>
                                          ) : dadosSemanais.proximaMeta > 0 ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                              ✓ Atingida
                                            </span>
                                          ) : (
                                            '-'
                                          );
                                        })()}
                                      </td>
                                    </>
                                  ) : (
                                    <>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs font-medium text-green-600">
                                        {formatBRL(vendedor.faturamento)}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        <span
                                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                                      ${
                                        vendedor.metaAtual === 'Diamante'
                                          ? 'bg-blue-100 text-blue-800'
                                          : vendedor.metaAtual === 'Ouro'
                                            ? 'bg-yellow-100 text-yellow-800'
                                            : vendedor.metaAtual === 'Prata'
                                              ? 'bg-gray-100 text-gray-800'
                                              : vendedor.metaAtual === 'Bronze'
                                                ? 'bg-amber-100 text-amber-800'
                                                : 'bg-gray-100 text-gray-800'
                                      }`}
                                        >
                                          {vendedor.metaAtual}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="flex flex-col">
                                          <span className="text-xs font-medium">
                                            {vendedor.proximaMeta}
                                          </span>
                                          {vendedor.valorProximaMeta > 0 && (
                                            <span className="text-xs text-gray-500">
                                              {formatBRL(
                                                vendedor.valorProximaMeta,
                                              )}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        <div className="flex items-center">
                                          <div className="w-full bg-gray-200 rounded-full h-2.5 mr-2">
                                            <div
                                              className={`h-2.5 rounded-full ${
                                                vendedor.metaAtual ===
                                                'Diamante'
                                                  ? 'bg-blue-600'
                                                  : vendedor.metaAtual ===
                                                      'Ouro'
                                                    ? 'bg-yellow-500'
                                                    : vendedor.metaAtual ===
                                                        'Prata'
                                                      ? 'bg-gray-500'
                                                      : vendedor.metaAtual ===
                                                          'Bronze'
                                                        ? 'bg-amber-500'
                                                        : 'bg-blue-600'
                                              }`}
                                              style={{
                                                width: `${vendedor.percentualAtingido}%`,
                                              }}
                                            ></div>
                                          </div>
                                          <span className="text-xs font-medium">
                                            {vendedor.percentualAtingido}%
                                          </span>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                                        {vendedor.valorFaltante > 0
                                          ? formatBRL(vendedor.valorFaltante)
                                          : 'Meta atingida'}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              ))
                          ) : (
                            <tr>
                              <td
                                colSpan={visualizacaoTipo === 'SEMANAL' ? 7 : 6}
                                className="px-3 py-4 text-center text-sm text-gray-500"
                              >
                                Nenhum dado disponível. Verifique se existem
                                metas cadastradas e faturamento no período.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 text-center">
                  * Dados baseados nas metas definidas e faturamento do período
                  selecionado ({filtros.dt_inicio} a {filtros.dt_fim})
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Loading Spinner para aplicação de metas */}
      {isApplyingMetas && (
        <LoadingSpinner
          overlay={true}
          size="lg"
          color="blue"
          text="Aplicando metas..."
        />
      )}

      {/* Notificação */}
      <Notification
        visible={notification.visible}
        type={notification.type}
        message={notification.message}
        onClose={hideNotification}
        duration={4000}
      />
    </div>
  );
};

export default MetasVarejo;
