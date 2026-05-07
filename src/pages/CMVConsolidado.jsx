import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import useApiClient from '../hooks/useApiClient';
import { usePermissions } from '../hooks/usePermissions';
import PageTitle from '../components/ui/PageTitle';
import PerformanceModal from '../components/ui/PerformanceModal';
import FiltroEmpresa from '../components/FiltroEmpresa';
import { ChartLineUp, Gauge } from '@phosphor-icons/react';

const CMVConsolidado = () => {
  const api = useApiClient();
  const { isAdmin } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [erro, setErro] = useState('');
  const [dados, setDados] = useState([]);
  const [dadosVarejo, setDadosVarejo] = useState([]);
  const [showPerformanceModal, setShowPerformanceModal] = useState(false);
  const [performanceData, setPerformanceData] = useState(null);

  // Evitar race condition entre buscas
  const lastRequestIdRef = useRef(0);

  // Referência para os totais por segmento (usado com cache)
  const totaisPorSegmentoRef = useRef(null);

  // Chave base para localStorage
  const STORAGE_KEY_BASE = 'cmvconsolidado_data';

  const [filtros, setFiltros] = useState({
    dt_inicio: '',
    dt_fim: '',
    empresas: [],
  });

  // Estado para controlar as empresas selecionadas no filtro
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);

  // Filtro de Mês/Ano
  const [filtroMensal, setFiltroMensal] = useState('ANO');
  const [filtroDia, setFiltroDia] = useState(null);

  // Estado para controlar se os dados vieram do cache
  const [dadosFromCache, setDadosFromCache] = useState(false);

  // Função para verificar se uma data é do mês atual
  const isCurrentMonth = (dateString) => {
    if (!dateString) return false;
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();

    const [ano, mes] = dateString.split('-');
    return Number(ano) === anoAtual && Number(mes) === mesAtual;
  };

  // Funções para otimizar o armazenamento no localStorage
  const extractTotalsOnly = (data) => {
    // Salvar apenas os totais calculados, sem os dados brutos
    if (!data) return null;

    return {
      timestamp: data.timestamp,
      periodo: data.periodo,
      // Não salvar os dados brutos de transação
      // dados: [],
      // dadosVarejo: [],
      // Salvar apenas os totais calculados por segmento
      totaisPorSegmento: data.totaisPorSegmento,
    };
  };

  // Função para limpar espaço no localStorage quando a quota é excedida
  const limparEspacoLocalStorage = () => {
    try {
      console.log('Tentando liberar espaço no localStorage...');

      // Obter todas as chaves relacionadas ao nosso app
      const nossasChaves = Object.keys(localStorage)
        .filter((key) => key.startsWith(STORAGE_KEY_BASE))
        .sort(); // Ordenar para remover as mais antigas primeiro

      if (nossasChaves.length <= 1) {
        console.warn('Não há dados suficientes para liberar espaço');
        return false;
      }

      // Remover a metade mais antiga dos dados
      const chavesParaRemover = nossasChaves.slice(
        0,
        Math.ceil(nossasChaves.length / 2),
      );
      console.log(
        `Removendo ${chavesParaRemover.length} chaves antigas para liberar espaço`,
      );

      chavesParaRemover.forEach((key) => {
        localStorage.removeItem(key);
        console.log(`Chave removida: ${key}`);
      });

      return chavesParaRemover.length > 0;
    } catch (error) {
      console.error('Erro ao tentar liberar espaço localStorage:', error);
      return false;
    }
  };

  // Funções para gerenciar o localStorage
  const getStorageKey = useCallback((dataInicio, dataFim) => {
    // Formato: cmvconsolidado_data_AAAAMM (ano e mês da data inicial)
    if (!dataInicio) return null;
    const [ano, mes] = dataInicio.split('-');
    return `${STORAGE_KEY_BASE}_${ano}${mes}`;
  }, []);

  // Helpers de agregação por segmento
  const aggregateTotais = (rows) => {
    let totalLiquido = 0;
    let totalBruto = 0;
    let totalDevolucoes = 0;
    let totalCMV = 0;
    let totalFrete = 0;
    for (const row of rows || []) {
      const qtd = toNumber(row?.qt_faturado) || 1;
      const frete = toNumber(row?.vl_freterat) || 0;
      const liq = toNumber(row?.vl_unitliquido) * qtd + frete;
      const bru = toNumber(row?.vl_unitbruto) * qtd + frete;
      const cmv = toNumber(row?.vl_produto) * qtd;
      const isDev = String(row?.tp_operacao).trim() === 'E';
      if (isDev) {
        totalLiquido -= Math.abs(liq);
        totalBruto -= Math.abs(bru);
        totalDevolucoes += Math.abs(liq);
        totalCMV -= Math.abs(cmv);
      } else {
        totalLiquido += liq;
        totalBruto += bru;
        totalCMV += cmv;
      }
      totalFrete += frete;
    }
    return { totalLiquido, totalBruto, totalDevolucoes, totalCMV, totalFrete };
  };

  const aggregateVarejo = (rows) => {
    // Varejo vem da rota /faturamento: cmv = vl_produto * qt_faturado, vendas com frete incluso
    let totalLiquido = 0;
    let totalBruto = 0;
    let totalDevolucoes = 0;
    let totalCMV = 0;
    let totalFrete = 0;
    for (const row of rows || []) {
      const qtd = toNumber(row?.qt_faturado) || 1;
      const frete = toNumber(row?.vl_freterat) || 0;
      const liq = toNumber(row?.vl_unitliquido) * qtd + frete;
      const bru = toNumber(row?.vl_unitbruto) * qtd + frete;
      const cmv = toNumber(row?.vl_produto) * qtd;
      const isDev = String(row?.tp_operacao).trim() === 'E';
      if (isDev) {
        totalLiquido -= Math.abs(liq);
        totalBruto -= Math.abs(bru);
        totalDevolucoes += Math.abs(liq);
        totalCMV -= Math.abs(cmv);
      } else {
        totalLiquido += liq;
        totalBruto += bru;
        totalCMV += cmv;
      }
      totalFrete += frete;
    }
    return { totalLiquido, totalBruto, totalDevolucoes, totalCMV, totalFrete };
  };

  const cleanOldData = useCallback(() => {
    try {
      // Verificar se localStorage está disponível
      if (typeof localStorage === 'undefined') {
        console.warn('localStorage não está disponível');
        return;
      }

      // Obter data atual
      const hoje = new Date();
      const mesAtual = hoje.getMonth() + 1;
      const anoAtual = hoje.getFullYear();

      // Calcular mês anterior
      let mesAnterior = mesAtual - 1;
      let anoAnterior = anoAtual;

      if (mesAnterior === 0) {
        mesAnterior = 12;
        anoAnterior = anoAtual - 1;
      }

      // Formatar mês anterior com zero à esquerda se necessário
      const mesAnteriorStr =
        mesAnterior < 10 ? `0${mesAnterior}` : `${mesAnterior}`;

      // Chave para o mês anterior
      const keyMesAnterior = `${STORAGE_KEY_BASE}_${anoAnterior}${mesAnteriorStr}`;

      // Remover todos os dados do localStorage exceto o mês atual e o anterior
      Object.keys(localStorage).forEach((key) => {
        if (
          key.startsWith(STORAGE_KEY_BASE) &&
          key !== keyMesAnterior &&
          !key.endsWith(`${anoAtual}${mesAtual < 10 ? '0' : ''}${mesAtual}`)
        ) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error('Erro ao limpar dados antigos do localStorage:', error);
    }
  }, []);

  const saveToLocalStorage = useCallback(
    (dataInicio, dataFim, dados, dadosVarejo) => {
      try {
        // Verificar se localStorage está disponível
        if (typeof localStorage === 'undefined') {
          console.warn('localStorage não está disponível');
          return;
        }

        if (!dataInicio || !dataFim || !dados) return;

        // Não salvar dados do mês atual
        if (isCurrentMonth(dataInicio) || isCurrentMonth(dataFim)) {
          console.log('Não salvando dados do mês atual no localStorage');
          return;
        }

        const key = getStorageKey(dataInicio, dataFim);
        if (!key) return;

        // Dados a serem salvos
        const dadosToSave = {
          timestamp: new Date().getTime(),
          periodo: { dataInicio, dataFim },
          dados,
          dadosVarejo,
          totaisPorSegmento: {
            consolidado: {
              ...aggregateTotais(dados),
              ...aggregateVarejo(dadosVarejo),
            },
            multimarcas: aggregateTotais(
              dados.filter((r) => Number(r?.cd_classificacao) === 2),
            ),
            revenda: aggregateTotais(
              dados.filter((r) => Number(r?.cd_classificacao) === 3),
            ),
            franquia: aggregateTotais(
              dados.filter((r) => Number(r?.cd_classificacao) === 4),
            ),
            varejo: aggregateVarejo(dadosVarejo),
          },
        };

        // Extrair apenas os totais calculados para economizar espaço
        const dadosOtimizados = extractTotalsOnly(dadosToSave);
        const jsonData = JSON.stringify(dadosOtimizados);

        const salvarDados = () => {
          try {
            console.log('Salvando dados no localStorage com a chave:', key);
            localStorage.setItem(key, jsonData);
            console.log('Dados salvos com sucesso!');
            return true;
          } catch (storageError) {
            return false;
          }
        };

        // Tentar salvar os dados
        if (!salvarDados()) {
          // Se falhar, verificar se é erro de quota
          console.warn(
            'Falha ao salvar no localStorage, tentando liberar espaço...',
          );

          // Tentar liberar espaço e salvar novamente
          if (limparEspacoLocalStorage()) {
            if (!salvarDados()) {
              console.error(
                'Não foi possível salvar mesmo após liberar espaço',
              );
            }
          }
        }

        // Limpar dados antigos (manter apenas último mês)
        cleanOldData();
      } catch (error) {
        console.error('Erro ao salvar dados no localStorage:', error);
      }
    },
    [getStorageKey, cleanOldData, isCurrentMonth],
  );

  const getFromLocalStorage = useCallback(
    (dataInicio, dataFim) => {
      try {
        // Verificar se localStorage está disponível
        if (typeof localStorage === 'undefined') {
          console.warn('localStorage não está disponível');
          return null;
        }

        if (!dataInicio || !dataFim) return null;

        // Não carregar dados se o período inclui o mês atual
        if (isCurrentMonth(dataInicio) || isCurrentMonth(dataFim)) {
          console.log('Período inclui o mês atual. Não usando cache.');
          return null;
        }

        const key = getStorageKey(dataInicio, dataFim);
        if (!key) return null;

        console.log('Verificando dados no localStorage com a chave:', key);
        const storedData = localStorage.getItem(key);
        if (!storedData) {
          console.log('Nenhum dado encontrado no localStorage para esta chave');
          return null;
        }

        console.log('Dados encontrados no localStorage!');
        try {
          const parsedData = JSON.parse(storedData);

          // Verificar se os dados são do período correto
          if (
            parsedData.periodo?.dataInicio !== dataInicio ||
            parsedData.periodo?.dataFim !== dataFim
          ) {
            console.log(
              'Período dos dados no cache não corresponde ao solicitado',
            );
            return null;
          }

          return parsedData;
        } catch (parseError) {
          console.error('Erro ao analisar dados do localStorage:', parseError);
          // Remover dados corrompidos
          localStorage.removeItem(key);
          return null;
        }
      } catch (error) {
        console.error('Erro ao recuperar dados do localStorage:', error);
        return null;
      }
    },
    [getStorageKey, isCurrentMonth],
  );

  useEffect(() => {
    // Default: mês atual
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
      .toISOString()
      .split('T')[0];
    setFiltros((f) => ({ ...f, dt_inicio: primeiroDia, dt_fim: ultimoDia }));

    // Limpar dados antigos ao iniciar
    cleanOldData();
  }, [cleanOldData]);

  // Função para fazer requisição com retry
  const fetchWithRetry = async (
    apiCall,
    params,
    name,
    endpoint,
    maxRetries = 2,
    delay = 1000,
  ) => {
    let attempts = 0;
    let lastError;

    while (attempts <= maxRetries) {
      try {
        const routeStart = performance.now();
        const result = await apiCall(params);
        const routeEnd = performance.now();

        const timing = {
          name,
          endpoint,
          duration: Math.round(routeEnd - routeStart),
          success: result.success,
          recordCount: result.data?.length || 0,
          attempts: attempts + 1,
        };

        return { result, timing };
      } catch (error) {
        lastError = error;
        attempts++;
        console.log(
          `Tentativa ${attempts} para ${name} falhou. Tentando novamente em ${delay}ms...`,
        );

        if (attempts <= maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          // Aumentar o delay para a próxima tentativa (backoff exponencial)
          delay *= 2;
        }
      }
    }

    // Se chegou aqui, todas as tentativas falharam
    return {
      result: {
        success: false,
        message: `Falha após ${maxRetries + 1} tentativas: ${
          lastError?.message || 'Erro desconhecido'
        }`,
      },
      timing: {
        name,
        endpoint,
        duration: 0,
        success: false,
        recordCount: 0,
        attempts: attempts,
        error: lastError?.message,
      },
    };
  };

  // Função para adicionar delay entre requisições
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Função para dividir o período em mês atual e meses anteriores
  const dividirPeriodo = (dataInicio, dataFim) => {
    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    const mesAtual = hoje.getMonth() + 1;

    // Primeiro dia do mês atual
    const primeiroDiaMesAtual = `${anoAtual}-${
      mesAtual < 10 ? '0' + mesAtual : mesAtual
    }-01`;

    // Se o período termina antes do mês atual, não precisa dividir
    if (dataFim < primeiroDiaMesAtual) {
      return {
        periodoAnterior: { inicio: dataInicio, fim: dataFim },
        periodoAtual: null,
      };
    }

    // Se o período começa no mês atual ou depois, não precisa dividir
    if (dataInicio >= primeiroDiaMesAtual) {
      return {
        periodoAnterior: null,
        periodoAtual: { inicio: dataInicio, fim: dataFim },
      };
    }

    // Dividir o período
    const ultimoDiaMesAnterior = new Date(anoAtual, mesAtual - 1, 0)
      .toISOString()
      .split('T')[0];

    return {
      periodoAnterior: { inicio: dataInicio, fim: ultimoDiaMesAnterior },
      periodoAtual: { inicio: primeiroDiaMesAtual, fim: dataFim },
    };
  };

  const buscar = async () => {
    try {
      setLoading(true);
      setErro('');
      setDadosFromCache(false);

      // Verificar se o período inclui o mês atual
      const periodos = dividirPeriodo(filtros.dt_inicio, filtros.dt_fim);

      // Se temos apenas período anterior ao mês atual, podemos usar o cache
      if (periodos.periodoAnterior && !periodos.periodoAtual) {
        const cachedData = getFromLocalStorage(
          periodos.periodoAnterior.inicio,
          periodos.periodoAnterior.fim,
        );
        if (cachedData) {
          console.log(
            'Usando dados do cache para o período:',
            periodos.periodoAnterior.inicio,
            'a',
            periodos.periodoAnterior.fim,
          );

          // Verificar se temos apenas os totais ou os dados completos
          if (
            cachedData.totaisPorSegmento &&
            (!cachedData.dados || cachedData.dados.length === 0)
          ) {
            console.log('Usando totais pré-calculados do cache');
            // Usar diretamente os totais calculados
            setDadosFromCache(true);
            setLoadingStatus('');
            setLoading(false);

            // Definir os totais diretamente no estado
            totaisPorSegmentoRef.current = cachedData.totaisPorSegmento;
            return;
          } else {
            // Caso ainda tenha dados completos no cache (versões antigas)
            setDados(cachedData.dados || []);
            setDadosVarejo(cachedData.dadosVarejo || []);
            setDadosFromCache(true);
            setLoadingStatus('');
            setLoading(false);
            return;
          }
        }
      }

      const params = {
        dt_inicio: filtros.dt_inicio,
        dt_fim: filtros.dt_fim,
        // Classificações fixas: 2 (MULTIMARCAS), 3 (REVENDA), 4 (FRANQUIAS)
        cd_classificacao: [2, 3, 4],
      };

      // Usar empresas selecionadas no filtro se houver, senão usar todas as empresas fixas
      const empresasParaUsar =
        empresasSelecionadas.length > 0
          ? empresasSelecionadas.map((emp) => Number(emp.cd_empresa))
          : [1, 2, 6, 11, 31, 75, 85, 92, 99]; // Empresas fixas padrão

      params.cd_empresa = empresasParaUsar;

      // Usar as mesmas empresas para todas as rotas (franquia, multimarcas, revenda)
      const empresasFixas = empresasParaUsar;

      // Lista específica de empresas para a rota de varejo
      const empresasVarejo = empresasParaUsar;

      // Parâmetros para cada rota específica
      const paramsFranquia = {
        dt_inicio: filtros.dt_inicio,
        dt_fim: filtros.dt_fim,
        cd_empresa: empresasFixas,
        cd_classificacao: [4], // Franquia
      };

      const paramsMultimarcas = {
        dt_inicio: filtros.dt_inicio,
        dt_fim: filtros.dt_fim,
        cd_empresa: empresasFixas,
        cd_classificacao: [2], // Multimarcas
      };

      const paramsRevenda = {
        dt_inicio: filtros.dt_inicio,
        dt_fim: filtros.dt_fim,
        cd_empresa: empresasFixas,
        cd_classificacao: [3], // Revenda
      };

      const paramsVarejo = {
        dt_inicio: filtros.dt_inicio,
        dt_fim: filtros.dt_fim,
        cd_empresa: empresasVarejo, // Usar a lista específica de empresas para varejo
      };

      // Controle de corrida
      const reqId = ++lastRequestIdRef.current;

      // Medir tempo de carregamento para administradores
      const startTime = performance.now();
      const routeTimings = [];

      // Fazer requisições sequenciais em vez de paralelas
      console.log('Iniciando requisições sequenciais...');

      // 1. Franquia
      setLoadingStatus('Carregando dados de Franquia (1/4)...');
      const { result: resFranquia, timing: timingFranquia } =
        await fetchWithRetry(
          api.sales.cmvfranquia,
          paramsFranquia,
          'Franquia',
          '/api/sales/cmvfranquia',
        );
      routeTimings.push(timingFranquia);

      // Delay entre requisições
      await sleep(500);

      // 2. Multimarcas
      setLoadingStatus('Carregando dados de Multimarcas (2/4)...');
      const { result: resMultimarcas, timing: timingMultimarcas } =
        await fetchWithRetry(
          api.sales.cmvmultimarcas,
          paramsMultimarcas,
          'Multimarcas',
          '/api/sales/cmvmultimarcas',
        );
      routeTimings.push(timingMultimarcas);

      await sleep(500);

      // 3. Revenda
      setLoadingStatus('Carregando dados de Revenda (3/4)...');
      const { result: resRevenda, timing: timingRevenda } =
        await fetchWithRetry(
          api.sales.cmvrevenda,
          paramsRevenda,
          'Revenda',
          '/api/sales/cmvrevenda',
        );
      routeTimings.push(timingRevenda);

      await sleep(500);

      // 4. Varejo
      setLoadingStatus('Carregando dados de Varejo (4/4)...');
      const { result: resVarejo, timing: timingVarejo } = await fetchWithRetry(
        api.sales.cmvvarejo,
        paramsVarejo,
        'Varejo',
        '/api/sales/cmvvarejo',
      );
      routeTimings.push(timingVarejo);

      setLoadingStatus('Processando dados...');

      const totalTime = Math.round(performance.now() - startTime);

      // Salvar dados de performance para administradores
      if (isAdmin()) {
        setPerformanceData({
          routes: routeTimings,
          total: totalTime,
          timestamp: new Date().toISOString(),
        });
      }

      // Resultados já estão disponíveis diretamente, sem precisar verificar status
      const respFranquia = resFranquia;
      const respMultimarcas = resMultimarcas;
      const respRevenda = resRevenda;
      const respVarejo = resVarejo;

      // Combinar dados de franquia, multimarcas e revenda para o consolidado
      let dadosConsolidados = [];
      let hasError = false;

      if (respFranquia.success) {
        const listaFranquia = Array.isArray(respFranquia?.data?.data)
          ? respFranquia.data.data
          : Array.isArray(respFranquia?.data)
          ? respFranquia.data
          : [];
        dadosConsolidados = dadosConsolidados.concat(listaFranquia);
      } else {
        console.warn('Falha ao carregar franquia:', respFranquia.message);
        hasError = true;
      }

      if (respMultimarcas.success) {
        const listaMultimarcas = Array.isArray(respMultimarcas?.data?.data)
          ? respMultimarcas.data.data
          : Array.isArray(respMultimarcas?.data)
          ? respMultimarcas.data
          : [];
        dadosConsolidados = dadosConsolidados.concat(listaMultimarcas);
      } else {
        console.warn('Falha ao carregar multimarcas:', respMultimarcas.message);
        hasError = true;
      }

      if (respRevenda.success) {
        const listaRevenda = Array.isArray(respRevenda?.data?.data)
          ? respRevenda.data.data
          : Array.isArray(respRevenda?.data)
          ? respRevenda.data
          : [];
        dadosConsolidados = dadosConsolidados.concat(listaRevenda);
      } else {
        console.warn('Falha ao carregar revenda:', respRevenda.message);
        hasError = true;
      }

      if (hasError) {
        setErro(
          'Algumas consultas falharam, mas dados disponíveis serão exibidos',
        );
      }

      if (reqId === lastRequestIdRef.current) {
        setDados(dadosConsolidados);
      }

      if (!respVarejo.success) {
        console.warn('Falha ao carregar varejo:', respVarejo.message);
        setDadosVarejo([]);
      } else {
        const listaVar = Array.isArray(respVarejo?.data?.data)
          ? respVarejo.data.data
          : Array.isArray(respVarejo?.data)
          ? respVarejo.data
          : [];
        if (reqId === lastRequestIdRef.current) {
          setDadosVarejo(listaVar);

          // Salvar dados no localStorage (apenas se não for do mês atual)
          if (dadosConsolidados.length > 0 || listaVar.length > 0) {
            saveToLocalStorage(
              filtros.dt_inicio,
              filtros.dt_fim,
              dadosConsolidados,
              listaVar,
            );
          }
        }
      }
    } catch (e) {
      setErro('Erro ao buscar dados');
      console.error(e);
    } finally {
      setLoadingStatus('');
      setLoading(false);
    }
  };

  // helpers de formatação
  const toNumber = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const n = Number(String(val).trim());
    return Number.isNaN(n) ? 0 : n;
  };

  const formatCurrency = (v) =>
    toNumber(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const formatDate = (d) => {
    if (!d) return '';
    // Evita deslocamento de fuso: usa a parte de data UTC (YYYY-MM-DD)
    const iso = typeof d === 'string' ? d : new Date(d).toISOString();
    const base = iso.includes('T') ? iso.split('T')[0] : iso;
    const [yyyy, mm, dd] = base.split('-');
    if (!yyyy || !mm || !dd) return String(d);
    return `${dd}/${mm}/${yyyy}`;
  };

  const formatQuantity = (q) =>
    toNumber(q).toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });

  // Helpers de data sem fuso horário (igual Contas a Receber)
  const parseDateNoTZ = (isoDate) => {
    if (!isoDate) return null;
    try {
      const [datePart] = String(isoDate).split('T');
      const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10));
      if (!y || !m || !d) return null;
      return new Date(y, m - 1, d);
    } catch {
      return null;
    }
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

  // Função para lidar com mudança de filtro mensal
  const handleFiltroMensalChange = (novoFiltro) => {
    setFiltroMensal(novoFiltro);
    setFiltroDia(null); // Limpar filtro de dia quando mudar o mês
  };

  // Função para aplicar filtro mensal e por dia (igual Contas a Receber)
  const aplicarFiltroMensal = (dados, filtro, diaFiltro = null) => {
    return dados.filter((item) => {
      // Usar dt_transacao como base para o filtro mensal
      const dataTransacao = item.dt_transacao;
      if (!dataTransacao) return false;

      const data = parseDateNoTZ(dataTransacao);
      const ano = data.getFullYear();
      const mes = data.getMonth() + 1; // getMonth() retorna 0-11, então +1
      const dia = data.getDate();

      if (filtro === 'ANO') {
        // Mostrar dados do ano atual
        const anoAtual = new Date().getFullYear();
        return ano === anoAtual;
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

      const mesNumero = mesesMap[filtro];
      if (!mesNumero) return false;

      if (mes !== mesNumero) return false;

      // Se há filtro de dia, aplicar também
      if (diaFiltro !== null) {
        return dia === diaFiltro;
      }

      return true;
    });
  };

  // Filtragem em memória (como "duplicata" em Contas a Pagar)
  const dadosFiltrados = useMemo(() => {
    // Aplicar filtro mensal aos dados
    const dadosFiltrados = aplicarFiltroMensal(dados, filtroMensal, filtroDia);

    return dadosFiltrados;
  }, [dados, filtroMensal, filtroDia]);

  // Aplicar filtro mensal também aos dados do Varejo
  const dadosVarejoFiltrados = useMemo(() => {
    return aplicarFiltroMensal(dadosVarejo || [], filtroMensal, filtroDia);
  }, [dadosVarejo, filtroMensal, filtroDia]);

  const totaisPorSegmento = useMemo(() => {
    // Se temos dados do cache, usar diretamente
    if (totaisPorSegmentoRef.current && dadosFromCache) {
      console.log('Usando totais calculados do cache');
      return totaisPorSegmentoRef.current;
    }

    // Caso contrário, calcular normalmente
    // Classificações fixas: 2 MULTIMARCAS, 3 REVENDA, 4 FRANQUIA
    const byClass = (cls) =>
      (dadosFiltrados || []).filter(
        (r) => Number(r?.cd_classificacao) === Number(cls),
      );
    const multimarcas = aggregateTotais(byClass(2));
    const revenda = aggregateTotais(byClass(3));
    const franquia = aggregateTotais(byClass(4));
    const varejo = aggregateVarejo(dadosVarejoFiltrados);
    // Consolidado = soma dos 4
    const soma = (a, b) => ({
      totalLiquido: a.totalLiquido + b.totalLiquido,
      totalBruto: a.totalBruto + b.totalBruto,
      totalDevolucoes: a.totalDevolucoes + b.totalDevolucoes,
      totalCMV: a.totalCMV + b.totalCMV,
      totalFrete: a.totalFrete + b.totalFrete,
    });
    const consolidado = soma(
      soma(multimarcas, revenda),
      soma(franquia, varejo),
    );
    return { consolidado, multimarcas, franquia, revenda, varejo };
  }, [
    dadosFiltrados,
    dadosVarejoFiltrados,
    dadosFromCache,
    totaisPorSegmentoRef,
  ]);

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      <PageTitle
        title="CMV CONSOLIDADO"
        subtitle="Consulta do CMV Consolidado dos canais MULTIMARCAS, REVENDA, FRANQUIA e VAREJO"
        icon={ChartLineUp}
        iconColor="text-indigo-600"
      />

      <div className="bg-white rounded-lg shadow p-3 mb-4 border border-gray-200">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <div>
            <label className="block text-xs font-semibold mb-1">
              Data Início
            </label>
            <input
              type="date"
              value={filtros.dt_inicio}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, dt_inicio: e.target.value }))
              }
              className="border rounded px-2 py-1.5 w-full text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Data Fim</label>
            <input
              type="date"
              value={filtros.dt_fim}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, dt_fim: e.target.value }))
              }
              className="border rounded px-2 py-1.5 w-full text-xs"
            />
          </div>
          <div>
            <FiltroEmpresa
              empresasSelecionadas={empresasSelecionadas}
              onSelectEmpresas={setEmpresasSelecionadas}
              apenasEmpresa101={false}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={buscar}
              disabled={loading || !filtros.dt_inicio || !filtros.dt_fim}
              className="bg-indigo-600 text-white text-xs px-3 py-2 rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? loadingStatus || 'Buscando...' : 'Buscar'}
            </button>
            {isAdmin() && performanceData && (
              <button
                onClick={() => setShowPerformanceModal(true)}
                className="bg-blue-500 text-white text-xs px-3 py-2 rounded hover:bg-blue-600 flex items-center gap-1"
                title="Ver performance das rotas"
              >
                <Gauge className="w-3 h-3" />
                Performance
              </button>
            )}
          </div>
        </div>
        {erro && <div className="mt-2 text-xs text-red-600">{erro}</div>}
        {dadosFromCache && (
          <div className="mt-2 text-xs text-blue-600 flex items-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 mr-1"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            Dados carregados do cache local
          </div>
        )}
        {isAdmin() && (
          <button
            onClick={() => {
              console.log(
                'Chaves no localStorage:',
                Object.keys(localStorage).filter((k) =>
                  k.startsWith(STORAGE_KEY_BASE),
                ),
              );
              const key = getStorageKey(filtros.dt_inicio, filtros.dt_fim);
              const data = localStorage.getItem(key);
              console.log(
                'Dados para a chave atual:',
                key,
                data ? 'Encontrados' : 'Não encontrados',
              );
            }}
            className="mt-2 text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300"
          >
            Debug localStorage
          </button>
        )}
      </div>

      {/* Filtro por Período - estilo pills (igual Contas a Receber) */}
      <div className="bg-white rounded-lg shadow p-3 mb-4 border border-gray-200">
        <div className="flex flex-wrap gap-1">
          {/* Botão ANO */}
          <button
            onClick={() => handleFiltroMensalChange('ANO')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              filtroMensal === 'ANO'
                ? 'bg-[#000638] text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
            }`}
          >
            ANO
          </button>

          {/* Botões dos meses */}
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
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
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
        <div className="mt-2 text-xs text-gray-500">
          <span className="font-medium">Filtro ativo:</span> {filtroMensal}
          {filtroDia && <span className="ml-1">- Dia {filtroDia}</span>}
          {empresasSelecionadas.length > 0 && (
            <span className="ml-2">
              - Empresas: {empresasSelecionadas.length} selecionada(s)
            </span>
          )}
          <span className="ml-2">
            ({dadosFiltrados.length + dadosVarejoFiltrados.length} registro
            {dadosFiltrados.length + dadosVarejoFiltrados.length !== 1
              ? 's'
              : ''}
            )
          </span>
        </div>

        {/* Filtro por Dia - aparece apenas quando um mês está selecionado */}
        {filtroMensal !== 'ANO' && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-bold text-xs text-[#000638] font-barlow">
                Filtro por Dia - {filtroMensal}
              </h4>
            </div>

            <div className="flex flex-wrap gap-0.5">
              {/* Botão "Todos os Dias" */}
              <button
                onClick={() => setFiltroDia(null)}
                className={`px-2 py-0.5 text-xs font-medium rounded-md transition-colors ${
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
                  className={`px-1.5 py-0.5 text-xs font-medium rounded-md transition-colors ${
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
      {/* Seção CONSOLIDADO */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">
          CONSOLIDADO
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-9 gap-3">
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Receita Liq + Imp</div>
            <div className="text-lg font-semibold text-green-600">
              {formatCurrency(totaisPorSegmento.consolidado.totalLiquido)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Receita Bruta</div>
            <div className="text-lg font-semibold text-blue-600">
              {formatCurrency(totaisPorSegmento.consolidado.totalBruto)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Devoluções</div>
            <div className="text-lg font-semibold text-red-600">
              {formatCurrency(totaisPorSegmento.consolidado.totalDevolucoes)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">CMV</div>
            <div className="text-lg font-semibold">
              {formatCurrency(totaisPorSegmento.consolidado.totalCMV)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">CMV %</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.consolidado.totalLiquido) || 0;
                if (!denom) return '0,00%';
                const perc =
                  (totaisPorSegmento.consolidado.totalCMV / denom) * 100;
                return `${perc.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}%`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Margem %</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.consolidado.totalLiquido) || 0;
                if (!denom) return '0,00%';
                const perc =
                  ((totaisPorSegmento.consolidado.totalLiquido -
                    totaisPorSegmento.consolidado.totalCMV) /
                    denom) *
                  100;
                return `${perc.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}%`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Markup</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.consolidado.totalCMV) || 0;
                if (!denom) return '—';
                const factor =
                  totaisPorSegmento.consolidado.totalLiquido / denom;
                return `${factor.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}x`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Frete</div>
            <div className="text-lg font-semibold">
              {formatCurrency(totaisPorSegmento.consolidado.totalFrete)}
            </div>
          </div>
        </div>
      </div>

      {/* Seção VAREJO */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">VAREJO</h3>
        <div className="grid grid-cols-1 sm:grid-cols-9 gap-3">
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Receita Liq + Imp</div>
            <div className="text-lg font-semibold text-green-600">
              {formatCurrency(totaisPorSegmento.varejo.totalLiquido)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Receita Bruta</div>
            <div className="text-lg font-semibold text-blue-600">
              {formatCurrency(totaisPorSegmento.varejo.totalBruto)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Devoluções</div>
            <div className="text-lg font-semibold text-red-600">
              {formatCurrency(totaisPorSegmento.varejo.totalDevolucoes)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">CMV</div>
            <div className="text-lg font-semibold">
              {formatCurrency(totaisPorSegmento.varejo.totalCMV)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">CMV %</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.varejo.totalLiquido) || 0;
                if (!denom) return '0,00%';
                const perc = (totaisPorSegmento.varejo.totalCMV / denom) * 100;
                return `${perc.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}%`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Margem %</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.varejo.totalLiquido) || 0;
                if (!denom) return '0,00%';
                const perc =
                  ((totaisPorSegmento.varejo.totalLiquido -
                    totaisPorSegmento.varejo.totalCMV) /
                    denom) *
                  100;
                return `${perc.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}%`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Markup</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom = Math.abs(totaisPorSegmento.varejo.totalCMV) || 0;
                if (!denom) return '—';
                const factor = totaisPorSegmento.varejo.totalLiquido / denom;
                return `${factor.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}x`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Frete</div>
            <div className="text-lg font-semibold">
              {formatCurrency(totaisPorSegmento.varejo.totalFrete)}
            </div>
          </div>
        </div>
      </div>

      {/* Seção REVENDA */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">REVENDA</h3>
        <div className="grid grid-cols-1 sm:grid-cols-9 gap-3">
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Receita Liq + Imp</div>
            <div className="text-lg font-semibold text-green-600">
              {formatCurrency(totaisPorSegmento.revenda.totalLiquido)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Receita Bruta</div>
            <div className="text-lg font-semibold text-blue-600">
              {formatCurrency(totaisPorSegmento.revenda.totalBruto)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Devoluções</div>
            <div className="text-lg font-semibold text-red-600">
              {formatCurrency(totaisPorSegmento.revenda.totalDevolucoes)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">CMV</div>
            <div className="text-lg font-semibold">
              {formatCurrency(totaisPorSegmento.revenda.totalCMV)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">CMV %</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.revenda.totalLiquido) || 0;
                if (!denom) return '0,00%';
                const perc = (totaisPorSegmento.revenda.totalCMV / denom) * 100;
                return `${perc.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}%`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Margem %</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.revenda.totalLiquido) || 0;
                if (!denom) return '0,00%';
                const perc =
                  ((totaisPorSegmento.revenda.totalLiquido -
                    totaisPorSegmento.revenda.totalCMV) /
                    denom) *
                  100;
                return `${perc.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}%`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Markup</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom = Math.abs(totaisPorSegmento.revenda.totalCMV) || 0;
                if (!denom) return '—';
                const factor = totaisPorSegmento.revenda.totalLiquido / denom;
                return `${factor.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}x`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Frete</div>
            <div className="text-lg font-semibold">
              {formatCurrency(totaisPorSegmento.revenda.totalFrete)}
            </div>
          </div>
        </div>
      </div>

      {/* Seção FRANQUIA */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">FRANQUIA</h3>
        <div className="grid grid-cols-1 sm:grid-cols-9 gap-3">
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Receita Liq + Imp</div>
            <div className="text-lg font-semibold text-green-600">
              {formatCurrency(totaisPorSegmento.franquia.totalLiquido)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Receita Bruta</div>
            <div className="text-lg font-semibold text-blue-600">
              {formatCurrency(totaisPorSegmento.franquia.totalBruto)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Devoluções</div>
            <div className="text-lg font-semibold text-red-600">
              {formatCurrency(totaisPorSegmento.franquia.totalDevolucoes)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">CMV</div>
            <div className="text-lg font-semibold">
              {formatCurrency(totaisPorSegmento.franquia.totalCMV)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">CMV %</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.franquia.totalLiquido) || 0;
                if (!denom) return '0,00%';
                const perc =
                  (totaisPorSegmento.franquia.totalCMV / denom) * 100;
                return `${perc.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}%`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Margem %</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.franquia.totalLiquido) || 0;
                if (!denom) return '0,00%';
                const perc =
                  ((totaisPorSegmento.franquia.totalLiquido -
                    totaisPorSegmento.franquia.totalCMV) /
                    denom) *
                  100;
                return `${perc.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}%`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Markup</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.franquia.totalCMV) || 0;
                if (!denom) return '—';
                const factor = totaisPorSegmento.franquia.totalLiquido / denom;
                return `${factor.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}x`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Frete</div>
            <div className="text-lg font-semibold">
              {formatCurrency(totaisPorSegmento.franquia.totalFrete)}
            </div>
          </div>
        </div>
      </div>

      {/* Seção MULTIMARCAS */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">
          MULTIMARCAS
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-9 gap-3">
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Receita Liq + Imp</div>
            <div className="text-lg font-semibold text-green-600">
              {formatCurrency(totaisPorSegmento.multimarcas.totalLiquido)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Receita Bruta</div>
            <div className="text-lg font-semibold text-blue-600">
              {formatCurrency(totaisPorSegmento.multimarcas.totalBruto)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Devoluções</div>
            <div className="text-lg font-semibold text-red-600">
              {formatCurrency(totaisPorSegmento.multimarcas.totalDevolucoes)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">CMV</div>
            <div className="text-lg font-semibold">
              {formatCurrency(totaisPorSegmento.multimarcas.totalCMV)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">CMV %</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.multimarcas.totalLiquido) || 0;
                if (!denom) return '0,00%';
                const perc =
                  (totaisPorSegmento.multimarcas.totalCMV / denom) * 100;
                return `${perc.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}%`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Margem %</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.multimarcas.totalLiquido) || 0;
                if (!denom) return '0,00%';
                const perc =
                  ((totaisPorSegmento.multimarcas.totalLiquido -
                    totaisPorSegmento.multimarcas.totalCMV) /
                    denom) *
                  100;
                return `${perc.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}%`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Markup</div>
            <div className="text-lg font-semibold">
              {(() => {
                const denom =
                  Math.abs(totaisPorSegmento.multimarcas.totalCMV) || 0;
                if (!denom) return '—';
                const factor =
                  totaisPorSegmento.multimarcas.totalLiquido / denom;
                return `${factor.toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}x`;
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Frete</div>
            <div className="text-lg font-semibold">
              {formatCurrency(totaisPorSegmento.multimarcas.totalFrete)}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Performance - apenas para administradores */}
      {isAdmin() && (
        <PerformanceModal
          isOpen={showPerformanceModal}
          onClose={() => setShowPerformanceModal(false)}
          performanceData={performanceData}
        />
      )}
    </div>
  );
};

export default CMVConsolidado;
