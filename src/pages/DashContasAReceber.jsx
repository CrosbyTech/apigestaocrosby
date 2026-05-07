import React, { useEffect, useState, useMemo, memo } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import FiltroEmpresa from '../components/FiltroEmpresa';
import FiltroFormaPagamento from '../components/FiltroFormaPagamento';
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
  Receipt,
  Calendar,
  Funnel,
  Spinner,
  CurrencyDollar,
  Clock,
  Warning,
  CheckCircle,
  ChartBar,
  ChartPieSlice,
  Users,
  Wallet,
  Bank,
  ArrowsOut,
  X,
  FileArrowDown,
  FilePdf,
} from '@phosphor-icons/react';
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
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar, Pie, Doughnut } from 'react-chartjs-2';

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
  ChartDataLabels,
);

// Mapeamento de tipo de documento para nome
const tiposDocumento = {
  1: 'Fatura',
  2: 'Cheque',
  3: 'Dinheiro',
  4: 'Cartão Crédito',
  5: 'Cartão Débito',
  6: 'Nota Débito',
  7: 'TEF',
  8: 'Cheque TEF',
  9: 'Troco',
  10: 'Adiantamento',
  13: 'Vale',
  14: 'Nota Promissória',
  15: 'Cheque Garantido',
  16: 'TED/DOC',
  17: 'Pré-Autorização TEF',
  18: 'Cheque Presente',
  19: 'TEF/TECBAN',
  20: 'CREDEV',
  21: 'Cartão Próprio',
  22: 'TEF/HYPERCARD',
  23: 'Bônus Desconto',
  25: 'Voucher',
  26: 'PIX',
  27: 'PicPay',
  28: 'Ame',
  29: 'Mercado Pago',
  30: 'Marketplace',
  31: 'Outro Documento',
};

const converterTipoDocumento = (numero) =>
  tiposDocumento[numero] || numero || 'Não informado';

const isBancoSafraPortador = (item) => {
  const portador = (item.nm_portador || '').toUpperCase();
  const codigoPortador = Number(item.cd_portador || 0);
  return codigoPortador === 422 || portador.includes('BANCO SAFRA');
};

const getFormaPagamentoLabel = (item) => {
  const formaBase = converterTipoDocumento(item.tp_documento);
  if (Number(item.tp_documento) === 1 && isBancoSafraPortador(item)) {
    return 'Fatura Banco Safra';
  }
  return formaBase;
};

const formatCurrency = (value) =>
  (value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

// Determina o tipo de carteira efetivo:
// Se o portador contém "SAFRA" ou "DALILA" => DESCONTADA (2), senão usa tp_cobranca
const getCarteiraEfetiva = (item) => {
  const portador = (item.nm_portador || '').toUpperCase();
  if (portador.includes('SAFRA') || portador.includes('DALILA')) return 2;
  return parseInt(item.tp_cobranca) || 0;
};

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

const getPmrData = (item) => {
  const emissao = parseDateNoTZ(item.dt_emissao);
  const liquidacao = parseDateNoTZ(item.dt_liq);
  const valorBase = parseFloat(item.vl_fatura) || 0;
  const valorPago = parseFloat(item.vl_pago) || 0;

  if (!emissao || !liquidacao || valorBase <= 0 || valorPago <= 0.01) {
    return null;
  }

  const dias = Math.max(
    0,
    Math.floor((liquidacao - emissao) / (1000 * 60 * 60 * 24)),
  );

  return {
    dias,
    peso: valorBase,
  };
};

const formatPmr = (pmrDias) => {
  if (pmrDias === null || pmrDias === undefined || Number.isNaN(pmrDias)) {
    return '-';
  }
  return `${pmrDias.toFixed(1).replace('.', ',')} dias`;
};

const CORES = [
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
  '#e11d48',
  '#0ea5e9',
  '#a855f7',
  '#22c55e',
];

const DashContasAReceber = memo(() => {
  const [dados, setDados] = useState([]);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [tipoBuscaData, setTipoBuscaData] = useState('vencimento');
  const [loading, setLoading] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [formasPagamentoSelecionadas, setFormasPagamentoSelecionadas] =
    useState([]);
  const [filtroCarteiraPortador, setFiltroCarteiraPortador] = useState('TODAS');
  const [filtroStatusPortador, setFiltroStatusPortador] = useState('TODOS');
  const [filtroMesPortador, setFiltroMesPortador] = useState('ANO');
  const [portadorExpandido, setPortadorExpandido] = useState(false);
  const [portadorSelecionado, setPortadorSelecionado] = useState(null);
  const [modalFormaPagamento, setModalFormaPagamento] = useState(false);
  const [formaPagSelecionada, setFormaPagSelecionada] = useState(null);
  const [grupoEmpresaSelecionado, setGrupoEmpresaSelecionado] = useState(null);
  const [filtroStatusFormaPag, setFiltroStatusFormaPag] = useState('TODOS');

  // Lista estática de formas de pagamento (disponível antes da busca)
  const dadosFormasPagamento = useMemo(
    () =>
      Object.entries(tiposDocumento).map(([codigo, descricao]) => ({
        codigo,
        descricao,
      })),
    [],
  );

  // Definir datas padrão (mês atual)
  useEffect(() => {
    const hoje = new Date();
    const primeiro = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    setDataInicio(primeiro.toISOString().split('T')[0]);
    setDataFim(hoje.toISOString().split('T')[0]);
  }, []);

  // Classificar item como Pago / Vencido / A Vencer
  // Regra de pago: data de liquidação OU valor pago > 0 (qualquer um basta)
  const getStatus = (item) => {
    if (item.dt_liq || (parseFloat(item.vl_pago) || 0) > 0.01) return 'Pago';
    const dv = parseDateNoTZ(item.dt_vencimento);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (dv && dv < hoje) return 'Vencido';
    return 'A Vencer';
  };

  // ======================== BUSCAR DADOS ========================
  const buscarDados = async () => {
    if (!dataInicio || !dataFim) return;
    if (empresasSelecionadas.length === 0) {
      alert('Selecione pelo menos uma empresa para consultar!');
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('dt_inicio', dataInicio);
      params.append('dt_fim', dataFim);
      params.append('modo', tipoBuscaData);
      params.append('situacao', '1'); // NORMAIS

      // Filtro de formas de pagamento
      if (formasPagamentoSelecionadas.length > 0) {
        const tiposDoc = formasPagamentoSelecionadas
          .map((f) => f.codigo)
          .join(',');
        params.append('tp_documento', tiposDoc);
      }

      const branchCodes = empresasSelecionadas
        .map((e) => e.cd_empresa)
        .join(',');
      params.append('branches', branchCodes);

      const url = `${TotvsURL}accounts-receivable/filter?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      const items = result.data?.items || [];

      // Buscar nomes de clientes
      const codigosClientes = [
        ...new Set(
          items
            .map((i) => i.cd_cliente)
            .filter(Boolean)
            .map(Number)
            .filter((c) => c > 0),
        ),
      ];

      let dadosFinais = items;
      if (codigosClientes.length > 0) {
        try {
          const batchSize = 50;
          const infoPessoas = {};
          for (let i = 0; i < codigosClientes.length; i += batchSize) {
            const batch = codigosClientes.slice(i, i + batchSize);
            const resp = await fetch(`${TotvsURL}persons/batch-lookup`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ personCodes: batch }),
            });
            if (resp.ok) {
              const data = await resp.json();
              const pessoasMap = data?.data || data || {};
              // Resposta: { "12345": { name, fantasyName, phone, uf }, ... }
              for (const [code, pessoa] of Object.entries(pessoasMap)) {
                infoPessoas[String(code).trim()] = {
                  nm_pessoa: pessoa.name || '',
                  nm_fantasia: pessoa.fantasyName || '',
                };
              }
            }
          }

          dadosFinais = items.map((item) => {
            const key = String(item.cd_cliente).trim();
            const pessoa = infoPessoas[key];
            if (pessoa) {
              return {
                ...item,
                nm_cliente: pessoa.nm_pessoa || item.nm_cliente,
                nm_fantasia: pessoa.nm_fantasia || '',
              };
            }
            return item;
          });
        } catch (err) {
          console.error('Erro ao buscar nomes:', err);
        }
      }

      // Garantir que apenas títulos com situação NORMAL (1) ficam no dataset
      dadosFinais = dadosFinais.filter((item) => {
        const sit = parseInt(item.situacao || item.cd_situacao);
        return isNaN(sit) || sit === 1;
      });

      // Excluir Desconto Financeiro (11) e DOFNI (12)
      dadosFinais = dadosFinais.filter((item) => {
        const tp = parseInt(item.tp_documento);
        return tp !== 11 && tp !== 12;
      });

      setDados(dadosFinais);
      setDadosCarregados(true);
    } catch (err) {
      console.error('Erro ao buscar dados:', err);
      alert(`Erro ao buscar dados: ${err.message}`);
      setDados([]);
      setDadosCarregados(false);
    } finally {
      setLoading(false);
    }
  };

  // ======================== MÉTRICAS ========================
  const metricas = useMemo(() => {
    if (!dados.length)
      return {
        recebido: 0,
        aReceber: 0,
        vencido: 0,
        totalFaturado: 0,
        topDevedores: [],
        porformaPagamento: [],
        porPeriodoDias: [],
        carteiraSimples: { qtd: 0, valor: 0 },
        carteiraDescontada: { qtd: 0, valor: 0 },
        porPortador: [],
      };

    let recebido = 0;
    let aReceber = 0;
    let vencido = 0;
    let totalFaturado = 0;

    // Agrupadores
    const devedoresMap = {};
    const formaPagMap = {};
    const periodoMap = {
      '0-15 dias': 0,
      '16-30 dias': 0,
      '31-60 dias': 0,
      '61-90 dias': 0,
      '91-120 dias': 0,
      '121-180 dias': 0,
      '181-360 dias': 0,
      '360+ dias': 0,
    };
    const portadorMap = {};
    let carteiraSimples = { qtd: 0, valor: 0 };
    let carteiraDescontada = { qtd: 0, valor: 0 };

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    dados.forEach((item) => {
      const vlFatura = parseFloat(item.vl_fatura) || 0;
      const vlPago = parseFloat(item.vl_pago) || 0;
      const statusItem = getStatus(item);

      totalFaturado += vlFatura;
      recebido += vlPago;

      if (statusItem === 'Vencido') {
        vencido += vlFatura - vlPago;
      }
      if (statusItem !== 'Pago') {
        aReceber += vlFatura - vlPago;
      }

      // Top devedores — apenas títulos em aberto (não pagos)
      if (statusItem !== 'Pago') {
        const nomeCliente =
          item.nm_fantasia || item.nm_cliente || `Cliente ${item.cd_cliente}`;
        const key = String(item.cd_cliente).trim();
        if (!devedoresMap[key]) {
          devedoresMap[key] = {
            cd_cliente: item.cd_cliente,
            nm_cliente: nomeCliente,
            valor: 0,
            vencido: 0,
            aVencer: 0,
            qtd: 0,
          };
        }
        // Atualizar nome caso venha um mais descritivo depois
        if (
          item.nm_fantasia &&
          devedoresMap[key].nm_cliente !== item.nm_fantasia
        ) {
          devedoresMap[key].nm_cliente = item.nm_fantasia;
        }
        const saldoAberto = vlFatura - vlPago;
        devedoresMap[key].valor += saldoAberto;
        if (statusItem === 'Vencido') {
          devedoresMap[key].vencido += saldoAberto;
        } else {
          devedoresMap[key].aVencer += saldoAberto;
        }
        devedoresMap[key].qtd += 1;
      }

      // Recebido por forma de pagamento (somente itens pagos)
      if (statusItem === 'Pago' && vlPago > 0) {
        const forma = getFormaPagamentoLabel(item);
        if (!formaPagMap[forma]) {
          formaPagMap[forma] = {
            valor: 0,
            qtd: 0,
            somaPonderadaDias: 0,
            somaPesos: 0,
          };
        }
        formaPagMap[forma].valor += vlPago;
        formaPagMap[forma].qtd += 1;
        const pmrData = getPmrData(item);
        if (pmrData) {
          formaPagMap[forma].somaPonderadaDias += pmrData.dias * pmrData.peso;
          formaPagMap[forma].somaPesos += pmrData.peso;
        }
      }

      // Período de dias por valor recebido (dias entre emissão e liquidação)
      if (statusItem === 'Pago' && vlPago > 0) {
        const emissao = parseDateNoTZ(item.dt_emissao);
        const liq = parseDateNoTZ(item.dt_liq) || hoje;
        if (emissao) {
          const dias = Math.max(
            0,
            Math.floor((liq - emissao) / (1000 * 60 * 60 * 24)),
          );
          if (dias <= 15) periodoMap['0-15 dias'] += vlPago;
          else if (dias <= 30) periodoMap['16-30 dias'] += vlPago;
          else if (dias <= 60) periodoMap['31-60 dias'] += vlPago;
          else if (dias <= 90) periodoMap['61-90 dias'] += vlPago;
          else if (dias <= 120) periodoMap['91-120 dias'] += vlPago;
          else if (dias <= 180) periodoMap['121-180 dias'] += vlPago;
          else if (dias <= 360) periodoMap['181-360 dias'] += vlPago;
          else periodoMap['360+ dias'] += vlPago;
        }
      }

      // Carteira Simples (tp_cobranca = 1) e Descontada (tp_cobranca = 2)
      // Regra: BANCO SAFRA é sempre considerado DESCONTADA
      const cobranca = getCarteiraEfetiva(item);
      if (cobranca === 1) {
        carteiraSimples.qtd += 1;
        carteiraSimples.valor += vlFatura;
      } else if (cobranca === 2) {
        carteiraDescontada.qtd += 1;
        carteiraDescontada.valor += vlFatura;
      }

      // Por portador
      const portadorNome =
        item.nm_portador || `Portador ${item.cd_portador || 'N/I'}`;
      if (!portadorMap[portadorNome])
        portadorMap[portadorNome] = { valor: 0, qtd: 0 };
      portadorMap[portadorNome].valor += vlFatura;
      portadorMap[portadorNome].qtd += 1;
    });

    // Top 15 devedores
    const topDevedores = Object.values(devedoresMap)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 15);

    // Formas de pagamento
    const porformaPagamento = Object.entries(formaPagMap)
      .map(([nome, d]) => ({
        nome,
        ...d,
        pmrDias: d.somaPesos > 0 ? d.somaPonderadaDias / d.somaPesos : null,
      }))
      .sort((a, b) => b.valor - a.valor);

    // Período de dias
    const porPeriodoDias = Object.entries(periodoMap).map(([faixa, valor]) => ({
      faixa,
      valor,
    }));

    // Portadores
    const porPortador = Object.entries(portadorMap)
      .map(([nome, d]) => ({ nome, ...d }))
      .sort((a, b) => b.valor - a.valor);

    return {
      recebido,
      aReceber,
      vencido,
      totalFaturado,
      topDevedores,
      porformaPagamento,
      porPeriodoDias,
      carteiraSimples,
      carteiraDescontada,
      porPortador,
    };
  }, [dados]);

  // ======================== GRÁFICOS ========================
  const chartFormaPagamento = useMemo(() => {
    if (!metricas.porformaPagamento.length) return null;
    return {
      labels: metricas.porformaPagamento.map((f) => f.nome),
      datasets: [
        {
          data: metricas.porformaPagamento.map((f) => f.valor),
          backgroundColor: CORES.slice(0, metricas.porformaPagamento.length),
          borderWidth: 1,
          borderColor: '#fff',
        },
      ],
    };
  }, [metricas.porformaPagamento]);

  const chartPeriodoDias = useMemo(() => {
    if (!metricas.porPeriodoDias.length) return null;
    return {
      labels: metricas.porPeriodoDias.map((p) => p.faixa),
      datasets: [
        {
          label: 'Valor Recebido',
          data: metricas.porPeriodoDias.map((p) => p.valor),
          backgroundColor: [
            '#000638',
            '#1e3a8a',
            '#3b82f6',
            '#60a5fa',
            '#f59e0b',
            '#f97316',
            '#ef4444',
            '#b91c1c',
          ],
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    };
  }, [metricas.porPeriodoDias]);

  // Portador filtrado por tipo de carteira, status e mês
  const MESES_MAP = {
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

  const portadorFiltrado = useMemo(() => {
    const portadorMap = {};
    dados.forEach((item) => {
      // Filtro de carteira
      if (filtroCarteiraPortador !== 'TODAS') {
        const cobrancaFiltro = filtroCarteiraPortador === 'SIMPLES' ? 1 : 2;
        const cobranca = getCarteiraEfetiva(item);
        if (cobranca !== cobrancaFiltro) return;
      }

      // Filtro de status
      const statusItem = getStatus(item);
      if (filtroStatusPortador === 'EM ABERTO' && statusItem === 'Pago') return;
      if (filtroStatusPortador === 'VENCIDO' && statusItem !== 'Vencido')
        return;
      if (filtroStatusPortador === 'A VENCER' && statusItem !== 'A Vencer')
        return;
      if (filtroStatusPortador === 'PAGOS' && statusItem !== 'Pago') return;

      // Filtro mensal (baseado na data de vencimento)
      if (filtroMesPortador !== 'ANO') {
        const dv = parseDateNoTZ(item.dt_vencimento);
        if (!dv) return;
        const mesItem = dv.getMonth() + 1;
        if (mesItem !== MESES_MAP[filtroMesPortador]) return;
      }

      // Valor conforme o filtro de status selecionado
      const vlFatura = parseFloat(item.vl_fatura) || 0;
      const vlPago = parseFloat(item.vl_pago) || 0;
      let valorConsiderar = vlFatura; // TODOS: usa valor da fatura (igual aos cards)
      if (filtroStatusPortador === 'PAGOS') {
        valorConsiderar = vlPago;
      } else if (
        filtroStatusPortador === 'EM ABERTO' ||
        filtroStatusPortador === 'VENCIDO' ||
        filtroStatusPortador === 'A VENCER'
      ) {
        valorConsiderar = vlFatura - vlPago;
      }
      const portadorNome =
        item.nm_portador || `Portador ${item.cd_portador || 'N/I'}`;
      if (!portadorMap[portadorNome])
        portadorMap[portadorNome] = { valor: 0, qtd: 0 };
      portadorMap[portadorNome].valor += valorConsiderar;
      portadorMap[portadorNome].qtd += 1;
    });
    return Object.entries(portadorMap)
      .map(([nome, d]) => ({ nome, ...d }))
      .sort((a, b) => b.valor - a.valor);
  }, [dados, filtroCarteiraPortador, filtroStatusPortador, filtroMesPortador]);

  // Títulos detalhados do portador selecionado
  const titulosPortadorSelecionado = useMemo(() => {
    if (!portadorSelecionado) return [];
    return dados
      .filter((item) => {
        const portadorNome =
          item.nm_portador || `Portador ${item.cd_portador || 'N/I'}`;
        if (portadorNome !== portadorSelecionado) return false;

        // Aplicar mesmos filtros ativos
        if (filtroCarteiraPortador !== 'TODAS') {
          const cobrancaFiltro = filtroCarteiraPortador === 'SIMPLES' ? 1 : 2;
          if (getCarteiraEfetiva(item) !== cobrancaFiltro) return false;
        }
        const statusItem = getStatus(item);
        if (filtroStatusPortador === 'EM ABERTO' && statusItem === 'Pago')
          return false;
        if (filtroStatusPortador === 'VENCIDO' && statusItem !== 'Vencido')
          return false;
        if (filtroStatusPortador === 'A VENCER' && statusItem !== 'A Vencer')
          return false;
        if (filtroStatusPortador === 'PAGOS' && statusItem !== 'Pago')
          return false;
        if (filtroMesPortador !== 'ANO') {
          const dv = parseDateNoTZ(item.dt_vencimento);
          if (!dv) return false;
          if (dv.getMonth() + 1 !== MESES_MAP[filtroMesPortador]) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          (parseFloat(b.vl_fatura) || 0) - (parseFloat(a.vl_fatura) || 0),
      );
  }, [
    dados,
    portadorSelecionado,
    filtroCarteiraPortador,
    filtroStatusPortador,
    filtroMesPortador,
  ]);

  // Formas de pagamento agrupadas por grupo de empresa
  const formaPagPorEmpresa = useMemo(() => {
    // Construir mapa cd_empresa → nm_grupoempresa a partir das empresas selecionadas
    const grupoMap = {};
    empresasSelecionadas.forEach((emp) => {
      grupoMap[String(emp.cd_empresa)] =
        emp.nm_grupoempresa || `Empresa ${emp.cd_empresa}`;
    });

    const map = {};
    dados.forEach((item) => {
      const statusItem = getStatus(item);
      if (filtroStatusFormaPag === 'PAGOS' && statusItem !== 'Pago') return;
      if (filtroStatusFormaPag === 'EM ABERTO' && statusItem === 'Pago') return;
      const vlFatura = parseFloat(item.vl_fatura) || 0;
      const vlPago = parseFloat(item.vl_pago) || 0;
      const valorConsiderar =
        filtroStatusFormaPag === 'PAGOS'
          ? vlPago
          : filtroStatusFormaPag === 'EM ABERTO'
            ? vlFatura - vlPago
            : vlFatura;
      if (valorConsiderar <= 0) return;
      const cdEmpresa = String(item.cd_empresa || '');
      const nomeGrupo = grupoMap[cdEmpresa] || `Empresa ${cdEmpresa || 'N/I'}`;
      const forma = getFormaPagamentoLabel(item);
      if (!map[nomeGrupo]) map[nomeGrupo] = {};
      if (!map[nomeGrupo][forma]) {
        map[nomeGrupo][forma] = {
          valor: 0,
          qtd: 0,
          somaPonderadaDias: 0,
          somaPesos: 0,
        };
      }
      map[nomeGrupo][forma].valor += valorConsiderar;
      map[nomeGrupo][forma].qtd += 1;
      const pmrData = getPmrData(item);
      if (pmrData) {
        map[nomeGrupo][forma].somaPonderadaDias += pmrData.dias * pmrData.peso;
        map[nomeGrupo][forma].somaPesos += pmrData.peso;
      }
    });
    return Object.entries(map)
      .map(([grupo, formas]) => ({
        empresa: grupo,
        formas: Object.entries(formas)
          .map(([nome, d]) => ({
            nome,
            ...d,
            pmrDias: d.somaPesos > 0 ? d.somaPonderadaDias / d.somaPesos : null,
          }))
          .sort((a, b) => b.valor - a.valor),
        total: Object.values(formas).reduce((a, f) => a + f.valor, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [dados, filtroStatusFormaPag, empresasSelecionadas]);

  // Métricas de forma de pagamento filtradas para os cards do modal
  const metricasFormaPagFiltrada = useMemo(() => {
    const map = {};
    dados.forEach((item) => {
      const statusItem = getStatus(item);
      if (filtroStatusFormaPag === 'PAGOS' && statusItem !== 'Pago') return;
      if (filtroStatusFormaPag === 'EM ABERTO' && statusItem === 'Pago') return;
      const vlFatura = parseFloat(item.vl_fatura) || 0;
      const vlPago = parseFloat(item.vl_pago) || 0;
      const valorConsiderar =
        filtroStatusFormaPag === 'PAGOS'
          ? vlPago
          : filtroStatusFormaPag === 'EM ABERTO'
            ? vlFatura - vlPago
            : vlFatura;
      if (valorConsiderar <= 0) return;
      const forma = getFormaPagamentoLabel(item);
      if (!map[forma]) {
        map[forma] = {
          valor: 0,
          qtd: 0,
          somaPonderadaDias: 0,
          somaPesos: 0,
        };
      }
      map[forma].valor += valorConsiderar;
      map[forma].qtd += 1;
      const pmrData = getPmrData(item);
      if (pmrData) {
        map[forma].somaPonderadaDias += pmrData.dias * pmrData.peso;
        map[forma].somaPesos += pmrData.peso;
      }
    });
    return Object.entries(map)
      .map(([nome, d]) => ({
        nome,
        ...d,
        pmrDias: d.somaPesos > 0 ? d.somaPonderadaDias / d.somaPesos : null,
      }))
      .sort((a, b) => b.valor - a.valor);
  }, [dados, filtroStatusFormaPag]);

  // Títulos detalhados da forma de pagamento selecionada (filtra por grupo se selecionado)
  const titulosFormaPagSelecionada = useMemo(() => {
    if (!formaPagSelecionada) return [];
    // Construir mapa cd_empresa → nm_grupoempresa
    const grupoMap = {};
    empresasSelecionadas.forEach((emp) => {
      grupoMap[String(emp.cd_empresa)] =
        emp.nm_grupoempresa || `Empresa ${emp.cd_empresa}`;
    });
    return dados
      .filter((item) => {
        const statusItem = getStatus(item);
        if (filtroStatusFormaPag === 'PAGOS' && statusItem !== 'Pago')
          return false;
        if (filtroStatusFormaPag === 'EM ABERTO' && statusItem === 'Pago')
          return false;
        const forma = getFormaPagamentoLabel(item);
        if (forma !== formaPagSelecionada) return false;
        // Filtrar por grupo de empresa se selecionado
        if (grupoEmpresaSelecionado) {
          const cdEmpresa = String(item.cd_empresa || '');
          const nomeGrupo =
            grupoMap[cdEmpresa] || `Empresa ${cdEmpresa || 'N/I'}`;
          if (nomeGrupo !== grupoEmpresaSelecionado) return false;
        }
        const vlFatura = parseFloat(item.vl_fatura) || 0;
        const vlPago = parseFloat(item.vl_pago) || 0;
        const valorConsiderar =
          filtroStatusFormaPag === 'PAGOS'
            ? vlPago
            : filtroStatusFormaPag === 'EM ABERTO'
              ? vlFatura - vlPago
              : vlFatura;
        return valorConsiderar > 0;
      })
      .sort(
        (a, b) =>
          (parseFloat(b.vl_fatura) || 0) - (parseFloat(a.vl_fatura) || 0),
      );
  }, [
    dados,
    formaPagSelecionada,
    grupoEmpresaSelecionado,
    filtroStatusFormaPag,
    empresasSelecionadas,
  ]);

  const chartPortador = useMemo(() => {
    const top10 = portadorFiltrado.slice(0, 10);
    if (!top10.length) return null;
    return {
      labels: top10.map((p) => p.nome),
      datasets: [
        {
          label: 'Valor',
          data: top10.map((p) => p.valor),
          backgroundColor: CORES.slice(0, top10.length),
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    };
  }, [portadorFiltrado]);

  const chartDevedores = useMemo(() => {
    const top10 = metricas.topDevedores.slice(0, 10);
    if (!top10.length) return null;
    return {
      labels: top10.map((d) =>
        d.nm_cliente.length > 25
          ? d.nm_cliente.substring(0, 25) + '…'
          : d.nm_cliente,
      ),
      datasets: [
        {
          label: 'Vencido',
          data: top10.map((d) => d.vencido),
          backgroundColor: '#fe0000',
          borderRadius: 4,
          borderSkipped: false,
        },
        {
          label: 'A Vencer',
          data: top10.map((d) => d.aVencer),
          backgroundColor: '#f59e0b',
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    };
  }, [metricas.topDevedores]);

  // Opções comuns de gráficos
  const barOptions = (title) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: false },
      datalabels: {
        display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
        color: '#fff',
        font: { weight: 'bold', size: 10 },
        formatter: (v) => formatCurrency(v),
        anchor: 'center',
        align: 'center',
        clip: true,
      },
      tooltip: {
        callbacks: {
          label: (ctx) =>
            `${ctx.dataset.label || ''}: ${formatCurrency(ctx.raw)}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 0 },
        grid: { display: false },
      },
      y: {
        ticks: {
          font: { size: 9 },
          callback: (v) => formatCurrency(v),
        },
        grid: { color: 'rgba(0,0,0,0.05)' },
      },
    },
  });

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: { font: { size: 10 }, boxWidth: 12, padding: 8 },
      },
      datalabels: {
        color: '#fff',
        font: { weight: 'bold', size: 10 },
        formatter: (v, ctx) => {
          const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
          const pct = ((v / total) * 100).toFixed(1);
          return pct > 3 ? `${pct}%` : '';
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)}`,
        },
      },
    },
  };

  // ======================== GERAR PDF FORMA PAGAMENTO ========================
  const gerarPDFFormaPagamento = () => {
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = doc.internal.pageSize.getWidth();
      const marginL = 14;
      const marginR = 14;
      const contentW = pageW - marginL - marginR;
      let y = 12;

      // ---- HEADER ----
      doc.setFillColor(0, 6, 56);
      doc.rect(0, 0, pageW, 28, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');

      if (formaPagSelecionada) {
        doc.text(`Títulos - ${formaPagSelecionada}`, marginL, y + 6);
      } else {
        doc.text('Recebido por Forma de Pagamento', marginL, y + 6);
      }

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      const periodoTxt =
        dataInicio && dataFim
          ? `Período: ${new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date(dataFim + 'T00:00:00').toLocaleDateString('pt-BR')}`
          : '';
      const filtroTxt =
        filtroStatusFormaPag !== 'TODOS'
          ? `  |  Filtro: ${filtroStatusFormaPag}`
          : '';
      doc.text(`${periodoTxt}${filtroTxt}`, marginL, y + 13);
      doc.setFontSize(7);
      doc.text(
        `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
        pageW - marginR,
        y + 13,
        { align: 'right' },
      );
      y = 32;

      doc.setTextColor(0, 0, 0);

      if (formaPagSelecionada && titulosFormaPagSelecionada.length > 0) {
        // -------- PDF DOS TÍTULOS DETALHADOS --------
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`${titulosFormaPagSelecionada.length} título(s)`, marginL, y);
        y += 4;

        const fmtDate = (d) => {
          const dt = parseDateNoTZ(d);
          return dt ? dt.toLocaleDateString('pt-BR') : '-';
        };

        const bodyData = titulosFormaPagSelecionada.map((t) => {
          const vlFat = parseFloat(t.vl_fatura) || 0;
          const vlPg = parseFloat(t.vl_pago) || 0;
          return [
            String(t.cd_empresa || ''),
            `${t.cd_cliente || ''} - ${(t.nm_fantasia || t.nm_cliente || '').substring(0, 30)}`,
            String(t.nr_fatura || ''),
            String(t.nr_parcela || '-'),
            fmtDate(t.dt_emissao),
            fmtDate(t.dt_vencimento),
            fmtDate(t.dt_liq),
            (t.nm_portador || '-').substring(0, 18),
            formatCurrency(vlFat),
            formatCurrency(vlPg),
          ];
        });

        const totalFatura = titulosFormaPagSelecionada.reduce(
          (a, t) => a + (parseFloat(t.vl_fatura) || 0),
          0,
        );
        const totalPago = titulosFormaPagSelecionada.reduce(
          (a, t) => a + (parseFloat(t.vl_pago) || 0),
          0,
        );

        autoTable(doc, {
          startY: y,
          head: [
            [
              'Emp',
              'Cliente',
              'Fatura',
              'Parc',
              'Emissão',
              'Vencim.',
              'Liquid.',
              'Portador',
              'Vl Fatura',
              'Vl Pago',
            ],
          ],
          body: bodyData,
          foot: [
            [
              '',
              'TOTAL',
              '',
              '',
              '',
              '',
              '',
              '',
              formatCurrency(totalFatura),
              formatCurrency(totalPago),
            ],
          ],
          styles: {
            fontSize: 6.5,
            cellPadding: 1.5,
            lineColor: [220, 220, 220],
            lineWidth: 0.2,
          },
          headStyles: {
            fillColor: [0, 6, 56],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            halign: 'center',
            fontSize: 7,
          },
          footStyles: {
            fillColor: [240, 240, 245],
            textColor: [0, 6, 56],
            fontStyle: 'bold',
            fontSize: 7,
          },
          alternateRowStyles: { fillColor: [248, 249, 252] },
          columnStyles: {
            0: { halign: 'center', cellWidth: 10 },
            1: { halign: 'left', cellWidth: 42 },
            2: { halign: 'center', cellWidth: 16 },
            3: { halign: 'center', cellWidth: 10 },
            4: { halign: 'center', cellWidth: 18 },
            5: { halign: 'center', cellWidth: 18 },
            6: { halign: 'center', cellWidth: 18 },
            7: { halign: 'left', cellWidth: 22 },
            8: { halign: 'right', cellWidth: 20 },
            9: { halign: 'right', cellWidth: 20 },
          },
          margin: { left: marginL, right: marginR },
          didDrawPage: (data) => {
            // Rodapé em cada página
            const pageCount = doc.internal.getNumberOfPages();
            doc.setFontSize(7);
            doc.setTextColor(150);
            doc.text(
              `Página ${data.pageNumber} de ${pageCount}`,
              pageW - marginR,
              doc.internal.pageSize.getHeight() - 6,
              { align: 'right' },
            );
          },
        });
      } else {
        // -------- PDF DO RESUMO AGRUPADO POR EMPRESA --------

        // Cards resumo geral
        if (metricasFormaPagFiltrada.length > 0) {
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 6, 56);
          doc.text('Resumo por Forma de Pagamento', marginL, y);
          y += 5;

          const cardH = 12;
          const cardCols = 4;
          const cardW = (contentW - (cardCols - 1) * 3) / cardCols;
          let cardX = marginL;
          let cardRow = 0;

          metricasFormaPagFiltrada.forEach((f, i) => {
            if (cardX + cardW > pageW - marginR + 1) {
              cardX = marginL;
              cardRow++;
              y += cardH + 2;
            }
            // Verificar se precisa nova página
            if (y + cardH > doc.internal.pageSize.getHeight() - 15) {
              doc.addPage();
              y = 12;
            }

            const cor = CORES[i % CORES.length];
            const r = parseInt(cor.slice(1, 3), 16);
            const g = parseInt(cor.slice(3, 5), 16);
            const b = parseInt(cor.slice(5, 7), 16);

            doc.setDrawColor(220, 220, 220);
            doc.setFillColor(252, 252, 255);
            doc.roundedRect(cardX, y, cardW, cardH, 1.5, 1.5, 'FD');

            // Bolinha de cor
            doc.setFillColor(r, g, b);
            doc.circle(cardX + 4, y + 4.5, 1.5, 'F');

            doc.setFontSize(6.5);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(60, 60, 60);
            doc.text(f.nome.substring(0, 20), cardX + 8, y + 5);

            doc.setFontSize(7.5);
            doc.setTextColor(37, 99, 235);
            doc.text(formatCurrency(f.valor), cardX + 8, y + 10);

            doc.setFontSize(5.5);
            doc.setTextColor(120, 120, 120);
            doc.text(`${f.qtd} tít.`, cardX + cardW - 3, y + 10, {
              align: 'right',
            });

            cardX += cardW + 3;
          });

          y += cardH + 6;
        }

        // Tabelas por grupo de empresa
        formaPagPorEmpresa.forEach((grupo) => {
          // Verificar espaço - se menos de 40mm, nova página
          if (y > doc.internal.pageSize.getHeight() - 40) {
            doc.addPage();
            y = 12;
          }

          // Header do grupo
          doc.setFillColor(240, 242, 248);
          doc.roundedRect(marginL, y, contentW, 8, 1.5, 1.5, 'F');
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 6, 56);
          doc.text(grupo.empresa, marginL + 3, y + 5.5);
          doc.setTextColor(37, 99, 235);
          doc.setFontSize(7.5);
          doc.text(
            `Total: ${formatCurrency(grupo.total)}`,
            pageW - marginR - 3,
            y + 5.5,
            { align: 'right' },
          );
          y += 10;

          const tableBody = grupo.formas.map((f) => [
            f.nome,
            f.qtd.toLocaleString('pt-BR'),
            formatCurrency(f.valor),
            grupo.total > 0
              ? ((f.valor / grupo.total) * 100).toFixed(1) + '%'
              : '0%',
          ]);

          const totalQtd = grupo.formas.reduce((a, f) => a + f.qtd, 0);

          autoTable(doc, {
            startY: y,
            head: [
              ['Forma de Pagamento', 'Qtd', 'Valor Recebido', '% do Total'],
            ],
            body: tableBody,
            foot: [
              [
                'TOTAL',
                totalQtd.toLocaleString('pt-BR'),
                formatCurrency(grupo.total),
                '100%',
              ],
            ],
            styles: {
              fontSize: 7,
              cellPadding: 2,
              lineColor: [230, 230, 230],
              lineWidth: 0.15,
            },
            headStyles: {
              fillColor: [255, 255, 255],
              textColor: [80, 80, 80],
              fontStyle: 'bold',
              fontSize: 7,
            },
            footStyles: {
              fillColor: [245, 246, 250],
              textColor: [0, 6, 56],
              fontStyle: 'bold',
              fontSize: 7,
            },
            alternateRowStyles: { fillColor: [250, 250, 252] },
            columnStyles: {
              0: { halign: 'left', cellWidth: 60 },
              1: { halign: 'center', cellWidth: 20 },
              2: { halign: 'right', cellWidth: 45 },
              3: { halign: 'right', cellWidth: 25 },
            },
            margin: { left: marginL, right: marginR },
            tableWidth: contentW,
          });

          y = doc.lastAutoTable?.finalY + 6 || y + 20;
        });

        // Rodapé com número de páginas
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(7);
          doc.setTextColor(150);
          doc.text(
            `Página ${i} de ${pageCount}`,
            pageW - marginR,
            doc.internal.pageSize.getHeight() - 6,
            { align: 'right' },
          );
        }
      }

      // Salvar
      const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      const nomeArquivo = formaPagSelecionada
        ? `FormaPgto_${formaPagSelecionada.replace(/[^a-zA-Z0-9]/g, '_')}_${hoje}.pdf`
        : `Recebido_FormaPagamento_${hoje}.pdf`;
      doc.save(nomeArquivo);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
    }
  };

  // ======================== EXPORTAR EXCEL FORMA PAGAMENTO ========================
  const exportarExcelFormaPagamento = () => {
    try {
      const wb = XLSX.utils.book_new();
      const rows = [];
      const merges = [];
      let r = 0;

      // ---- TÍTULO ----
      const periodoTxt =
        dataInicio && dataFim
          ? `Período: ${new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date(dataFim + 'T00:00:00').toLocaleDateString('pt-BR')}`
          : '';
      const filtroTxt =
        filtroStatusFormaPag !== 'TODOS'
          ? ` | Filtro: ${filtroStatusFormaPag}`
          : '';
      rows.push([
        'Recebido por Forma de Pagamento' +
          (filtroTxt ? ` (${filtroStatusFormaPag})` : ''),
      ]);
      merges.push({ s: { r, c: 0 }, e: { r, c: 3 } });
      r++;
      if (periodoTxt) {
        rows.push([periodoTxt]);
        merges.push({ s: { r, c: 0 }, e: { r, c: 3 } });
        r++;
      }
      rows.push([]);
      r++;

      // ---- RESUMO GERAL ----
      rows.push(['RESUMO GERAL']);
      merges.push({ s: { r, c: 0 }, e: { r, c: 3 } });
      r++;
      rows.push(['Forma de Pagamento', 'Quantidade', 'Valor', '% do Total']);
      r++;
      const totalGeralValor = metricasFormaPagFiltrada.reduce(
        (a, f) => a + f.valor,
        0,
      );
      metricasFormaPagFiltrada.forEach((f) => {
        rows.push([
          f.nome,
          f.qtd,
          f.valor,
          totalGeralValor > 0
            ? ((f.valor / totalGeralValor) * 100).toFixed(2) + '%'
            : '0%',
        ]);
        r++;
      });
      const totalGeralQtd = metricasFormaPagFiltrada.reduce(
        (a, f) => a + f.qtd,
        0,
      );
      rows.push(['TOTAL GERAL', totalGeralQtd, totalGeralValor, '100%']);
      r++;
      rows.push([]);
      r++;
      rows.push([]);
      r++;

      // ---- POR GRUPO DE EMPRESA ----
      formaPagPorEmpresa.forEach((grupo) => {
        rows.push([grupo.empresa, '', '', formatCurrency(grupo.total)]);
        merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });
        r++;
        rows.push(['Forma de Pagamento', 'Quantidade', 'Valor', '% do Total']);
        r++;
        grupo.formas.forEach((f) => {
          rows.push([
            f.nome,
            f.qtd,
            f.valor,
            grupo.total > 0
              ? ((f.valor / grupo.total) * 100).toFixed(2) + '%'
              : '0%',
          ]);
          r++;
        });
        const totalGrupoQtd = grupo.formas.reduce((a, f) => a + f.qtd, 0);
        rows.push(['TOTAL', totalGrupoQtd, grupo.total, '100%']);
        r++;
        rows.push([]);
        r++;
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 35 }, { wch: 14 }, { wch: 20 }, { wch: 14 }];
      ws['!merges'] = merges;

      // Formatar colunas de valor como número
      for (let i = 0; i < rows.length; i++) {
        const cellRef = XLSX.utils.encode_cell({ r: i, c: 2 });
        if (ws[cellRef] && typeof ws[cellRef].v === 'number') {
          ws[cellRef].z = '#,##0.00';
        }
      }

      XLSX.utils.book_append_sheet(wb, ws, 'Forma de Pagamento');

      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const filtroLabel =
        filtroStatusFormaPag !== 'TODOS' ? `_${filtroStatusFormaPag}` : '';
      saveAs(
        blob,
        `FormaPagamento${filtroLabel}_${new Date().toISOString().split('T')[0]}.xlsx`,
      );
    } catch (error) {
      console.error('Erro ao exportar Excel:', error);
    }
  };

  // ======================== EXPORTAR EXCEL FORMA PAGAMENTO POR DIA ========================
  const exportarExcelFormaPagamentoPorDia = () => {
    try {
      const wb = XLSX.utils.book_new();
      const rows = [];
      const merges = [];
      let r = 0;

      const periodoTxt =
        dataInicio && dataFim
          ? `Período: ${new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date(dataFim + 'T00:00:00').toLocaleDateString('pt-BR')}`
          : '';
      const filtroTxt =
        filtroStatusFormaPag !== 'TODOS' ? ` (${filtroStatusFormaPag})` : '';
      rows.push(['Forma de Pagamento por Dia' + filtroTxt]);
      merges.push({ s: { r, c: 0 }, e: { r, c: 3 } });
      r++;
      if (periodoTxt) {
        rows.push([periodoTxt]);
        merges.push({ s: { r, c: 0 }, e: { r, c: 3 } });
        r++;
      }
      rows.push([]);
      r++;

      // Agrupar dados por dia e forma de pagamento
      const porDia = {};
      dados.forEach((item) => {
        const statusItem = getStatus(item);
        if (filtroStatusFormaPag === 'PAGOS' && statusItem !== 'Pago') return;
        if (filtroStatusFormaPag === 'EM ABERTO' && statusItem === 'Pago')
          return;
        const vlFatura = parseFloat(item.vl_fatura) || 0;
        const vlPago = parseFloat(item.vl_pago) || 0;
        const valorConsiderar =
          filtroStatusFormaPag === 'PAGOS'
            ? vlPago
            : filtroStatusFormaPag === 'EM ABERTO'
              ? vlFatura - vlPago
              : vlFatura;
        if (valorConsiderar <= 0) return;

        const dtPgto = parseDateNoTZ(item.dt_liq);
        if (!dtPgto) return;
        const diaKey = dtPgto.toISOString().split('T')[0];
        const diaLabel = dtPgto.toLocaleDateString('pt-BR');
        const forma = getFormaPagamentoLabel(item);

        if (!porDia[diaKey])
          porDia[diaKey] = {
            label: diaLabel,
            formas: {},
            total: 0,
            sortDate: dtPgto,
          };
        if (!porDia[diaKey].formas[forma])
          porDia[diaKey].formas[forma] = { valor: 0, qtd: 0 };
        porDia[diaKey].formas[forma].valor += valorConsiderar;
        porDia[diaKey].formas[forma].qtd += 1;
        porDia[diaKey].total += valorConsiderar;
      });

      // Ordenar dias cronologicamente
      const diasOrdenados = Object.entries(porDia).sort(
        (a, b) => a[1].sortDate - b[1].sortDate,
      );

      let totalGeral = 0;
      diasOrdenados.forEach(([, info]) => {
        rows.push([`DIA ${info.label}`, '', '', formatCurrency(info.total)]);
        merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });
        r++;
        rows.push(['Forma de Pagamento', 'Quantidade', 'Valor', '% do Dia']);
        r++;

        const formasOrdenadas = Object.entries(info.formas)
          .map(([nome, d]) => ({ nome, ...d }))
          .sort((a, b) => b.valor - a.valor);

        formasOrdenadas.forEach((f) => {
          rows.push([
            f.nome,
            f.qtd,
            f.valor,
            info.total > 0
              ? ((f.valor / info.total) * 100).toFixed(2) + '%'
              : '0%',
          ]);
          r++;
        });

        const totalDiaQtd = formasOrdenadas.reduce((a, f) => a + f.qtd, 0);
        rows.push(['TOTAL DO DIA', totalDiaQtd, info.total, '100%']);
        r++;
        rows.push([]);
        r++;
        totalGeral += info.total;
      });

      rows.push(['TOTAL GERAL', '', totalGeral, '']);
      merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
      r++;

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 35 }, { wch: 14 }, { wch: 20 }, { wch: 14 }];
      ws['!merges'] = merges;

      for (let i = 0; i < rows.length; i++) {
        const cellRef = XLSX.utils.encode_cell({ r: i, c: 2 });
        if (ws[cellRef] && typeof ws[cellRef].v === 'number') {
          ws[cellRef].z = '#,##0.00';
        }
      }

      XLSX.utils.book_append_sheet(wb, ws, 'Forma Pgto por Dia');

      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const filtroLabel =
        filtroStatusFormaPag !== 'TODOS' ? `_${filtroStatusFormaPag}` : '';
      saveAs(
        blob,
        `FormaPagamento_PorDia${filtroLabel}_${new Date().toISOString().split('T')[0]}.xlsx`,
      );
    } catch (error) {
      console.error('Erro ao exportar Excel por dia:', error);
    }
  };

  // ======================== RENDER ========================
  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Dashboard Contas a Receber"
        subtitle="Visão consolidada de recebimentos, inadimplência e carteiras"
        icon={ChartBar}
        iconColor="text-green-600"
      />

      {/* ============ FILTROS ============ */}
      <div className="mb-4">
        <div className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full border border-[#000638]/10">
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" />
              Filtros
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 ">
            <div>
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={setEmpresasSelecionadas}
                apenasEmpresa101={true}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Tipo de Data
              </label>
              <select
                value={tipoBuscaData}
                onChange={(e) => setTipoBuscaData(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="vencimento">Vencimento</option>
                <option value="emissao">Emissão</option>
                <option value="pagamento">Pagamento</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Início
              </label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
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
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div>
              <FiltroFormaPagamento
                formasPagamentoSelecionadas={formasPagamentoSelecionadas}
                onSelectFormasPagamento={setFormasPagamentoSelecionadas}
                dadosFormasPagamento={dadosFormasPagamento}
              />
            </div>
            <div>
              <button
                onClick={buscarDados}
                className="flex gap-1 bg-[#000638] text-white px-4 py-1.5 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-8 text-xs font-bold shadow-md tracking-wide uppercase w-full justify-center mt-4"
                disabled={loading || !dataInicio || !dataFim}
              >
                {loading ? (
                  <>
                    <Spinner size={12} className="animate-spin" />
                    Carregando...
                  </>
                ) : (
                  <>
                    <Calendar size={12} />
                    Buscar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ============ LOADING ============ */}
      {loading && (
        <div className="flex justify-center items-center py-16">
          <Spinner size={32} className="animate-spin text-[#000638]" />
          <span className="ml-3 text-gray-600">Carregando dados...</span>
        </div>
      )}

      {/* ============ SEM DADOS ============ */}
      {!loading && !dadosCarregados && (
        <div className="flex justify-center items-center py-16 text-gray-500 text-sm">
          Selecione o período e empresa, depois clique em "Buscar"
        </div>
      )}

      {/* ============ DASHBOARD ============ */}
      {!loading && dadosCarregados && (
        <>
          {/* ---- CARDS PRINCIPAIS ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {/* Total Faturado */}
            <Card className="shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CurrencyDollar size={16} className="text-blue-600" />
                  <CardTitle className="text-xs font-bold text-blue-700">
                    Total Faturado
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-lg font-extrabold text-blue-600">
                  {formatCurrency(metricas.totalFaturado)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  {dados.length} título(s) no período
                </CardDescription>
              </CardContent>
            </Card>

            {/* Recebido */}
            <Card className="shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CheckCircle size={16} className="text-green-600" />
                  <CardTitle className="text-xs font-bold text-green-700">
                    Recebido
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-lg font-extrabold text-green-600">
                  {formatCurrency(metricas.recebido)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Valor total recebido
                </CardDescription>
              </CardContent>
            </Card>

            {/* A Receber */}
            <Card className="shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-orange-500" />
                  <CardTitle className="text-xs font-bold text-orange-600">
                    A Receber
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-lg font-extrabold text-orange-500">
                  {formatCurrency(metricas.aReceber)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Saldo pendente
                </CardDescription>
              </CardContent>
            </Card>

            {/* Vencido */}
            <Card className="shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Warning size={16} className="text-red-600" />
                  <CardTitle className="text-xs font-bold text-red-700">
                    Vencido
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-lg font-extrabold text-red-600">
                  {formatCurrency(metricas.vencido)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Títulos vencidos em aberto
                </CardDescription>
              </CardContent>
            </Card>
          </div>

          {/* ---- CARTEIRA SIMPLES & DESCONTADA ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Wallet size={16} className="text-indigo-600" />
                  <CardTitle className="text-sm font-bold text-[#000638]">
                    Carteira Simples
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Quantidade</div>
                    <div className="text-2xl font-extrabold text-indigo-600">
                      {metricas.carteiraSimples.qtd.toLocaleString('pt-BR')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">
                      Valor Total
                    </div>
                    <div className="text-xl font-extrabold text-indigo-600">
                      {formatCurrency(metricas.carteiraSimples.valor)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Receipt size={16} className="text-purple-600" />
                  <CardTitle className="text-sm font-bold text-[#000638]">
                    Carteira Descontada
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Quantidade</div>
                    <div className="text-2xl font-extrabold text-purple-600">
                      {metricas.carteiraDescontada.qtd.toLocaleString('pt-BR')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">
                      Valor Total
                    </div>
                    <div className="text-xl font-extrabold text-purple-600">
                      {formatCurrency(metricas.carteiraDescontada.valor)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ---- GRÁFICOS LINHA 1: Top Devedores + Forma de Pagamento ---- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
            {/* Top Devedores */}
            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-red-600" />
                  <CardTitle className="text-sm font-bold text-[#000638]">
                    Clientes que Mais Devem
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                {chartDevedores ? (
                  <div style={{ height: 350 }}>
                    <Bar
                      data={chartDevedores}
                      options={{
                        ...barOptions('Top Devedores'),
                        plugins: {
                          ...barOptions('Top Devedores').plugins,
                          legend: {
                            display: true,
                            position: 'top',
                            labels: {
                              font: { size: 10 },
                              boxWidth: 12,
                              padding: 8,
                            },
                          },
                          datalabels: { display: false },
                        },
                        scales: {
                          ...barOptions('Top Devedores').scales,
                          x: {
                            ...barOptions('Top Devedores').scales.x,
                            stacked: true,
                          },
                          y: {
                            ...barOptions('Top Devedores').scales.y,
                            stacked: true,
                          },
                        },
                      }}
                    />
                  </div>
                ) : (
                  <div className="text-center text-gray-400 py-12 text-sm">
                    Sem dados de inadimplência
                  </div>
                )}

                {/* Tabela resumo abaixo do gráfico */}
                {metricas.topDevedores.length > 0 && (
                  <div className="mt-3 max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1 font-semibold text-gray-700">
                            Cliente
                          </th>
                          <th className="text-center px-2 py-1 font-semibold text-gray-700">
                            Qtd
                          </th>
                          <th className="text-right px-2 py-1 font-semibold text-red-600">
                            Vencido
                          </th>
                          <th className="text-right px-2 py-1 font-semibold text-orange-500">
                            A Vencer
                          </th>
                          <th className="text-right px-2 py-1 font-semibold text-gray-700">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {metricas.topDevedores.map((d, i) => (
                          <tr
                            key={i}
                            className="border-b border-gray-100 hover:bg-gray-50"
                          >
                            <td className="px-2 py-1 text-gray-800">
                              <span className="font-medium">
                                {d.cd_cliente}
                              </span>{' '}
                              - {d.nm_cliente}
                            </td>
                            <td className="text-center px-2 py-1 text-gray-600">
                              {d.qtd}
                            </td>
                            <td className="text-right px-2 py-1 font-semibold text-red-600">
                              {formatCurrency(d.vencido)}
                            </td>
                            <td className="text-right px-2 py-1 font-semibold text-orange-500">
                              {formatCurrency(d.aVencer)}
                            </td>
                            <td className="text-right px-2 py-1 font-semibold text-gray-800">
                              {formatCurrency(d.valor)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Forma de Pagamento */}
            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ChartPieSlice size={16} className="text-blue-600" />
                    <CardTitle className="text-sm font-bold text-[#000638]">
                      Recebido por Forma de Pagamento
                    </CardTitle>
                  </div>
                  {metricas.porformaPagamento.length > 0 && (
                    <button
                      onClick={() => {
                        setFormaPagSelecionada(null);
                        setGrupoEmpresaSelecionado(null);
                        setFiltroStatusFormaPag(
                          tipoBuscaData === 'pagamento' ? 'PAGOS' : 'TODOS',
                        );
                        setModalFormaPagamento(true);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-md"
                    >
                      <ArrowsOut size={12} />
                      Detalhar
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                {chartFormaPagamento ? (
                  <div style={{ height: 350 }}>
                    <Doughnut data={chartFormaPagamento} options={pieOptions} />
                  </div>
                ) : (
                  <div className="text-center text-gray-400 py-12 text-sm">
                    Sem dados de recebimento
                  </div>
                )}

                {/* Tabela resumo */}
                {metricas.porformaPagamento.length > 0 && (
                  <div className="mt-3 max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1 font-semibold text-gray-700">
                            Forma
                          </th>
                          <th className="text-center px-2 py-1 font-semibold text-gray-700">
                            Qtd
                          </th>
                          <th className="text-right px-2 py-1 font-semibold text-gray-700">
                            Valor
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {metricas.porformaPagamento.map((f, i) => (
                          <tr
                            key={i}
                            className="border-b border-gray-100 hover:bg-gray-50"
                          >
                            <td className="px-2 py-1 text-gray-800 flex items-center gap-1">
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-sm"
                                style={{
                                  backgroundColor: CORES[i % CORES.length],
                                }}
                              />
                              {f.nome}
                            </td>
                            <td className="text-center px-2 py-1 text-gray-600">
                              {f.qtd}
                            </td>
                            <td className="text-right px-2 py-1 font-semibold text-blue-600">
                              {formatCurrency(f.valor)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ---- GRÁFICO: Período de Dias x Valor Recebido ---- */}
          <div className="grid grid-cols-1 gap-3 mb-6">
            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <ChartBar size={16} className="text-[#000638]" />
                  <CardTitle className="text-sm font-bold text-[#000638]">
                    Valor Recebido por Período de Dias (Emissão → Liquidação)
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                {chartPeriodoDias ? (
                  <div style={{ height: 320 }}>
                    <Bar
                      data={chartPeriodoDias}
                      options={barOptions('Período')}
                    />
                  </div>
                ) : (
                  <div className="text-center text-gray-400 py-12 text-sm">
                    Sem dados
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ---- GRÁFICO + TABELA: Por Portador ---- */}
          <div className="grid grid-cols-1 gap-3 mb-6">
            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bank size={16} className="text-teal-600" />
                    <CardTitle className="text-sm font-bold text-[#000638]">
                      Quantidade e Valor por Portador
                    </CardTitle>
                    <button
                      onClick={() => setPortadorExpandido(true)}
                      className="ml-2 p-1 rounded-md hover:bg-gray-100 text-gray-500 hover:text-[#000638] transition-colors"
                      title="Expandir"
                    >
                      <ArrowsOut size={16} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <div className="flex gap-1 mr-2">
                      {['TODAS', 'SIMPLES', 'DESCONTADA'].map((tipo) => (
                        <button
                          key={tipo}
                          onClick={() => setFiltroCarteiraPortador(tipo)}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${
                            filtroCarteiraPortador === tipo
                              ? 'bg-[#000638] text-white shadow-md'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {tipo}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      {[
                        'TODOS',
                        'EM ABERTO',
                        'VENCIDO',
                        'A VENCER',
                        'PAGOS',
                      ].map((st) => (
                        <button
                          key={st}
                          onClick={() => setFiltroStatusPortador(st)}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${
                            filtroStatusPortador === st
                              ? st === 'VENCIDO'
                                ? 'bg-red-600 text-white shadow-md'
                                : st === 'A VENCER'
                                  ? 'bg-orange-500 text-white shadow-md'
                                  : st === 'PAGOS'
                                    ? 'bg-green-600 text-white shadow-md'
                                    : st === 'EM ABERTO'
                                      ? 'bg-blue-600 text-white shadow-md'
                                      : 'bg-[#000638] text-white shadow-md'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {/* Filtro mensal */}
                <div className="flex flex-wrap gap-1 mt-2">
                  {[
                    'ANO',
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
                      onClick={() => setFiltroMesPortador(mes)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${
                        filtroMesPortador === mes
                          ? 'bg-[#000638] text-white shadow-md'
                          : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
                      }`}
                    >
                      {mes}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Gráfico */}
                  <div>
                    {chartPortador ? (
                      <div style={{ height: 340 }}>
                        <Bar
                          data={chartPortador}
                          options={barOptions('Portador')}
                        />
                      </div>
                    ) : (
                      <div className="text-center text-gray-400 py-12 text-sm">
                        Sem dados
                      </div>
                    )}
                  </div>

                  {/* Tabela completa */}
                  <div className="max-h-[350px] overflow-y-auto">
                    {portadorFiltrado.length > 0 ? (
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-1.5 font-semibold text-gray-700">
                              Portador
                            </th>
                            <th className="text-center px-2 py-1.5 font-semibold text-gray-700">
                              Qtd
                            </th>
                            <th className="text-right px-2 py-1.5 font-semibold text-gray-700">
                              Valor
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {portadorFiltrado.map((p, i) => (
                            <tr
                              key={i}
                              className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                              onClick={() => setPortadorSelecionado(p.nome)}
                            >
                              <td className="px-2 py-1 text-gray-800 flex items-center gap-1">
                                <span
                                  className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                  style={{
                                    backgroundColor: CORES[i % CORES.length],
                                  }}
                                />
                                {p.nome}
                              </td>
                              <td className="text-center px-2 py-1 text-gray-600">
                                {p.qtd.toLocaleString('pt-BR')}
                              </td>
                              <td className="text-right px-2 py-1 font-semibold text-teal-600">
                                {formatCurrency(p.valor)}
                              </td>
                            </tr>
                          ))}
                          {/* Totalizador */}
                          <tr className="bg-gray-100 font-bold">
                            <td className="px-2 py-1.5 text-gray-800">TOTAL</td>
                            <td className="text-center px-2 py-1.5 text-gray-800">
                              {portadorFiltrado
                                .reduce((a, p) => a + p.qtd, 0)
                                .toLocaleString('pt-BR')}
                            </td>
                            <td className="text-right px-2 py-1.5 text-teal-700">
                              {formatCurrency(
                                portadorFiltrado.reduce(
                                  (a, p) => a + p.valor,
                                  0,
                                ),
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <div className="text-center text-gray-400 py-12 text-sm">
                        Sem dados de portador
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ---- MODAL DETALHAMENTO TÍTULOS DO PORTADOR ---- */}
          {portadorSelecionado && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[95vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <Bank size={20} className="text-teal-600" />
                    <h2 className="text-lg font-bold text-[#000638]">
                      {portadorSelecionado}
                    </h2>
                    <span className="text-sm text-gray-500 ml-2">
                      {titulosPortadorSelecionado.length} título(s)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const dadosExport = titulosPortadorSelecionado.map(
                          (t) => {
                            const vlFat = parseFloat(t.vl_fatura) || 0;
                            const vlPg = parseFloat(t.vl_pago) || 0;
                            const dt = (d) => {
                              const p = parseDateNoTZ(d);
                              return p ? p.toLocaleDateString('pt-BR') : '';
                            };
                            return {
                              Empresa: t.cd_empresa,
                              'Cód. Cliente': t.cd_cliente,
                              Cliente: t.nm_fantasia || t.nm_cliente || '',
                              Fatura: t.nr_fatura,
                              Parcela: t.nr_parcela || '',
                              Emissão: dt(t.dt_emissao),
                              Vencimento: dt(t.dt_vencimento),
                              Liquidação: dt(t.dt_liq),
                              'Forma Pgto': getFormaPagamentoLabel(t),
                              Portador: t.nm_portador || '',
                              Status: getStatus(t),
                              'Valor Fatura': vlFat,
                              'Valor Pago': vlPg,
                              Saldo: vlFat - vlPg,
                            };
                          },
                        );
                        const ws = XLSX.utils.json_to_sheet(dadosExport);
                        // Ajustar largura das colunas
                        ws['!cols'] = [
                          { wch: 8 },
                          { wch: 12 },
                          { wch: 35 },
                          { wch: 12 },
                          { wch: 8 },
                          { wch: 12 },
                          { wch: 12 },
                          { wch: 12 },
                          { wch: 15 },
                          { wch: 20 },
                          { wch: 10 },
                          { wch: 14 },
                          { wch: 14 },
                          { wch: 14 },
                        ];
                        const wb = XLSX.utils.book_new();
                        XLSX.utils.book_append_sheet(wb, ws, 'Títulos');
                        const excelBuffer = XLSX.write(wb, {
                          bookType: 'xlsx',
                          type: 'array',
                        });
                        const blob = new Blob([excelBuffer], {
                          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        });
                        saveAs(
                          blob,
                          `Portador_${portadorSelecionado.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`,
                        );
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-bold shadow-md"
                      title="Exportar para Excel"
                    >
                      <FileArrowDown size={16} />
                      Excel
                    </button>
                    <button
                      onClick={() => setPortadorSelecionado(null)}
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-red-600 transition-colors"
                      title="Fechar"
                    >
                      <X size={20} weight="bold" />
                    </button>
                  </div>
                </div>
                {/* Tabela de títulos */}
                <div className="flex-1 overflow-auto p-4">
                  {titulosPortadorSelecionado.length > 0 ? (
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-2 font-semibold text-gray-700">
                            Empresa
                          </th>
                          <th className="text-left px-2 py-2 font-semibold text-gray-700">
                            Cliente
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Fatura
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Parcela
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Emissão
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Vencimento
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Liquidação
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Forma Pgto
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Status
                          </th>
                          <th className="text-right px-2 py-2 font-semibold text-gray-700">
                            Valor Fatura
                          </th>
                          <th className="text-right px-2 py-2 font-semibold text-gray-700">
                            Valor Pago
                          </th>
                          <th className="text-right px-2 py-2 font-semibold text-gray-700">
                            Saldo
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {titulosPortadorSelecionado.map((t, i) => {
                          const vlFat = parseFloat(t.vl_fatura) || 0;
                          const vlPg = parseFloat(t.vl_pago) || 0;
                          const saldo = vlFat - vlPg;
                          const status = getStatus(t);
                          const formatDate = (d) => {
                            const dt = parseDateNoTZ(d);
                            return dt ? dt.toLocaleDateString('pt-BR') : '-';
                          };
                          return (
                            <tr
                              key={i}
                              className="border-b border-gray-100 hover:bg-gray-50"
                            >
                              <td className="px-2 py-1.5 text-gray-700">
                                {t.cd_empresa}
                              </td>
                              <td className="px-2 py-1.5 text-gray-800">
                                <span className="font-medium">
                                  {t.cd_cliente}
                                </span>
                                {' - '}
                                {t.nm_fantasia || t.nm_cliente}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-700">
                                {t.nr_fatura}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-700">
                                {t.nr_parcela || '-'}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-600">
                                {formatDate(t.dt_emissao)}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-600">
                                {formatDate(t.dt_vencimento)}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-600">
                                {formatDate(t.dt_liq)}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-600">
                                {getFormaPagamentoLabel(t)}
                              </td>
                              <td className="text-center px-2 py-1.5">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    status === 'Pago'
                                      ? 'bg-green-100 text-green-700'
                                      : status === 'Vencido'
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-orange-100 text-orange-700'
                                  }`}
                                >
                                  {status}
                                </span>
                              </td>
                              <td className="text-right px-2 py-1.5 text-gray-800">
                                {formatCurrency(vlFat)}
                              </td>
                              <td className="text-right px-2 py-1.5 text-green-600">
                                {formatCurrency(vlPg)}
                              </td>
                              <td
                                className={`text-right px-2 py-1.5 font-semibold ${saldo > 0 ? 'text-red-600' : 'text-gray-500'}`}
                              >
                                {formatCurrency(saldo)}
                              </td>
                            </tr>
                          );
                        })}
                        {/* Totalizador */}
                        <tr className="bg-gray-100 font-bold">
                          <td colSpan={9} className="px-2 py-2 text-gray-800">
                            TOTAL
                          </td>
                          <td className="text-right px-2 py-2 text-gray-800">
                            {formatCurrency(
                              titulosPortadorSelecionado.reduce(
                                (a, t) => a + (parseFloat(t.vl_fatura) || 0),
                                0,
                              ),
                            )}
                          </td>
                          <td className="text-right px-2 py-2 text-green-700">
                            {formatCurrency(
                              titulosPortadorSelecionado.reduce(
                                (a, t) => a + (parseFloat(t.vl_pago) || 0),
                                0,
                              ),
                            )}
                          </td>
                          <td className="text-right px-2 py-2 text-red-700">
                            {formatCurrency(
                              titulosPortadorSelecionado.reduce(
                                (a, t) =>
                                  a +
                                  ((parseFloat(t.vl_fatura) || 0) -
                                    (parseFloat(t.vl_pago) || 0)),
                                0,
                              ),
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-center text-gray-400 py-12">
                      Nenhum título encontrado
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---- MODAL DETALHE FORMA DE PAGAMENTO ---- */}
          {modalFormaPagamento && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[95vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <ChartPieSlice size={20} className="text-blue-600" />
                    <h2 className="text-lg font-bold text-[#000638]">
                      {formaPagSelecionada
                        ? `Títulos - ${formaPagSelecionada}${grupoEmpresaSelecionado ? ` (${grupoEmpresaSelecionado})` : ''}`
                        : 'Recebido por Forma de Pagamento'}
                    </h2>
                    {formaPagSelecionada && (
                      <span className="text-sm text-gray-500 ml-2">
                        {titulosFormaPagSelecionada.length} título(s)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Filtros de status */}
                    <div className="flex gap-1">
                      {['TODOS', 'PAGOS', 'EM ABERTO'].map((st) => (
                        <button
                          key={st}
                          disabled={tipoBuscaData === 'pagamento'}
                          onClick={() => {
                            if (tipoBuscaData === 'pagamento') return;
                            setFiltroStatusFormaPag(st);
                            setFormaPagSelecionada(null);
                            setGrupoEmpresaSelecionado(null);
                          }}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                            tipoBuscaData === 'pagamento' && st !== 'PAGOS'
                              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                              : filtroStatusFormaPag === st
                                ? st === 'PAGOS'
                                  ? 'bg-green-600 text-white shadow-md'
                                  : st === 'EM ABERTO'
                                    ? 'bg-blue-600 text-white shadow-md'
                                    : 'bg-[#000638] text-white shadow-md'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                    {formaPagSelecionada && (
                      <>
                        <button
                          onClick={() => {
                            const dadosExport = titulosFormaPagSelecionada.map(
                              (t) => {
                                const vlFat = parseFloat(t.vl_fatura) || 0;
                                const vlPg = parseFloat(t.vl_pago) || 0;
                                const dt = (d) => {
                                  const p = parseDateNoTZ(d);
                                  return p ? p.toLocaleDateString('pt-BR') : '';
                                };
                                return {
                                  Empresa: t.cd_empresa,
                                  'Cód. Cliente': t.cd_cliente,
                                  Cliente: t.nm_fantasia || t.nm_cliente || '',
                                  Fatura: t.nr_fatura,
                                  Parcela: t.nr_parcela || '',
                                  Emissão: dt(t.dt_emissao),
                                  Vencimento: dt(t.dt_vencimento),
                                  Liquidação: dt(t.dt_liq),
                                  'Forma Pgto': getFormaPagamentoLabel(t),
                                  Portador: t.nm_portador || '',
                                  'Valor Fatura': vlFat,
                                  'Valor Pago': vlPg,
                                  Saldo: vlFat - vlPg,
                                };
                              },
                            );
                            const ws = XLSX.utils.json_to_sheet(dadosExport);
                            ws['!cols'] = [
                              { wch: 8 },
                              { wch: 12 },
                              { wch: 35 },
                              { wch: 12 },
                              { wch: 8 },
                              { wch: 12 },
                              { wch: 12 },
                              { wch: 12 },
                              { wch: 15 },
                              { wch: 20 },
                              { wch: 14 },
                              { wch: 14 },
                              { wch: 14 },
                            ];
                            const wb = XLSX.utils.book_new();
                            XLSX.utils.book_append_sheet(wb, ws, 'Títulos');
                            const excelBuffer = XLSX.write(wb, {
                              bookType: 'xlsx',
                              type: 'array',
                            });
                            const blob = new Blob([excelBuffer], {
                              type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            });
                            saveAs(
                              blob,
                              `FormaPgto_${formaPagSelecionada.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`,
                            );
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-bold shadow-md"
                          title="Exportar para Excel"
                        >
                          <FileArrowDown size={16} />
                          Excel
                        </button>
                        <button
                          onClick={gerarPDFFormaPagamento}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-xs font-bold shadow-md"
                          title="Exportar para PDF"
                        >
                          <FilePdf size={16} />
                          PDF
                        </button>
                        <button
                          onClick={() => {
                            setFormaPagSelecionada(null);
                            setGrupoEmpresaSelecionado(null);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-xs font-bold"
                        >
                          Voltar
                        </button>
                      </>
                    )}
                    {!formaPagSelecionada && (
                      <>
                        <button
                          onClick={exportarExcelFormaPagamento}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-bold shadow-md"
                          title="Exportar para Excel"
                        >
                          <FileArrowDown size={16} />
                          Excel
                        </button>
                        <button
                          onClick={exportarExcelFormaPagamentoPorDia}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors text-xs font-bold shadow-md"
                          title="Exportar Excel separado por dia"
                        >
                          <Calendar size={16} />
                          Excel por Dia
                        </button>
                        <button
                          onClick={gerarPDFFormaPagamento}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-xs font-bold shadow-md"
                          title="Exportar para PDF"
                        >
                          <FilePdf size={16} />
                          PDF
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setModalFormaPagamento(false);
                        setFormaPagSelecionada(null);
                        setGrupoEmpresaSelecionado(null);
                      }}
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-red-600 transition-colors"
                      title="Fechar"
                    >
                      <X size={20} weight="bold" />
                    </button>
                  </div>
                </div>

                {/* Conteúdo */}
                <div className="flex-1 overflow-auto p-4">
                  {!formaPagSelecionada ? (
                    // ---- VISÃO AGRUPADA POR EMPRESA ----
                    <div className="space-y-6">
                      {/* Resumo geral */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-4">
                        {metricasFormaPagFiltrada.map((f, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setGrupoEmpresaSelecionado(null);
                              setFormaPagSelecionada(f.nome);
                            }}
                            className="flex flex-col items-start p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all cursor-pointer text-left"
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <span
                                className="inline-block w-3 h-3 rounded-sm"
                                style={{
                                  backgroundColor: CORES[i % CORES.length],
                                }}
                              />
                              <span className="text-xs font-bold text-gray-700 truncate">
                                {f.nome}
                              </span>
                            </div>
                            <span className="text-sm font-extrabold text-blue-600">
                              {formatCurrency(f.valor)}
                            </span>
                            <span className="text-[10px] text-gray-500">
                              {f.qtd} título(s)
                            </span>
                          </button>
                        ))}
                      </div>

                      {/* Tabelas por empresa */}
                      {formaPagPorEmpresa.map((grupo) => (
                        <div
                          key={grupo.empresa}
                          className="bg-gray-50 rounded-xl p-4"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-[#000638]">
                              {grupo.empresa}
                            </h3>
                            <span className="text-xs font-bold text-blue-600">
                              Total: {formatCurrency(grupo.total)}
                            </span>
                          </div>
                          <table className="w-full text-xs">
                            <thead className="bg-white">
                              <tr>
                                <th className="text-left px-3 py-2 font-semibold text-gray-700">
                                  Forma de Pagamento
                                </th>
                                <th className="text-center px-3 py-2 font-semibold text-gray-700">
                                  Qtd
                                </th>
                                <th className="text-right px-3 py-2 font-semibold text-gray-700">
                                  Valor Recebido
                                </th>
                                <th className="text-right px-3 py-2 font-semibold text-gray-700">
                                  % do Total
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {grupo.formas.map((f, i) => (
                                <tr
                                  key={i}
                                  className="border-b border-gray-200 hover:bg-white cursor-pointer transition-colors"
                                  onClick={() => {
                                    setGrupoEmpresaSelecionado(grupo.empresa);
                                    setFormaPagSelecionada(f.nome);
                                  }}
                                >
                                  <td className="px-3 py-2 text-gray-800 flex items-center gap-2">
                                    <span
                                      className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                      style={{
                                        backgroundColor:
                                          CORES[i % CORES.length],
                                      }}
                                    />
                                    {f.nome}
                                  </td>
                                  <td className="text-center px-3 py-2 text-gray-600">
                                    {f.qtd.toLocaleString('pt-BR')}
                                  </td>
                                  <td className="text-right px-3 py-2 font-semibold text-blue-600">
                                    {formatCurrency(f.valor)}
                                  </td>
                                  <td className="text-right px-3 py-2 text-gray-500">
                                    {grupo.total > 0
                                      ? ((f.valor / grupo.total) * 100).toFixed(
                                          1,
                                        ) + '%'
                                      : '0%'}
                                  </td>
                                </tr>
                              ))}
                              <tr className="bg-white font-bold">
                                <td className="px-3 py-2 text-gray-800">
                                  TOTAL
                                </td>
                                <td className="text-center px-3 py-2 text-gray-800">
                                  {grupo.formas
                                    .reduce((a, f) => a + f.qtd, 0)
                                    .toLocaleString('pt-BR')}
                                </td>
                                <td className="text-right px-3 py-2 text-blue-700">
                                  {formatCurrency(grupo.total)}
                                </td>
                                <td className="text-right px-3 py-2 text-gray-700">
                                  100%
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  ) : // ---- VISÃO DETALHADA DE UMA FORMA DE PAGAMENTO ----
                  titulosFormaPagSelecionada.length > 0 ? (
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-2 font-semibold text-gray-700">
                            Empresa
                          </th>
                          <th className="text-left px-2 py-2 font-semibold text-gray-700">
                            Cliente
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Fatura
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Parcela
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Emissão
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Vencimento
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Liquidação
                          </th>
                          <th className="text-center px-2 py-2 font-semibold text-gray-700">
                            Portador
                          </th>
                          <th className="text-right px-2 py-2 font-semibold text-gray-700">
                            Valor Fatura
                          </th>
                          <th className="text-right px-2 py-2 font-semibold text-gray-700">
                            Valor Pago
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {titulosFormaPagSelecionada.map((t, i) => {
                          const vlFat = parseFloat(t.vl_fatura) || 0;
                          const vlPg = parseFloat(t.vl_pago) || 0;
                          const formatDate = (d) => {
                            const dt = parseDateNoTZ(d);
                            return dt ? dt.toLocaleDateString('pt-BR') : '-';
                          };
                          return (
                            <tr
                              key={i}
                              className="border-b border-gray-100 hover:bg-gray-50"
                            >
                              <td className="px-2 py-1.5 text-gray-700">
                                {t.cd_empresa}
                              </td>
                              <td className="px-2 py-1.5 text-gray-800">
                                <span className="font-medium">
                                  {t.cd_cliente}
                                </span>
                                {' - '}
                                {t.nm_fantasia || t.nm_cliente}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-700">
                                {t.nr_fatura}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-700">
                                {t.nr_parcela || '-'}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-600">
                                {formatDate(t.dt_emissao)}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-600">
                                {formatDate(t.dt_vencimento)}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-600">
                                {formatDate(t.dt_liq)}
                              </td>
                              <td className="text-center px-2 py-1.5 text-gray-600">
                                {t.nm_portador || '-'}
                              </td>
                              <td className="text-right px-2 py-1.5 text-gray-800">
                                {formatCurrency(vlFat)}
                              </td>
                              <td className="text-right px-2 py-1.5 text-green-600 font-semibold">
                                {formatCurrency(vlPg)}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-gray-100 font-bold">
                          <td colSpan={8} className="px-2 py-2 text-gray-800">
                            TOTAL
                          </td>
                          <td className="text-right px-2 py-2 text-gray-800">
                            {formatCurrency(
                              titulosFormaPagSelecionada.reduce(
                                (a, t) => a + (parseFloat(t.vl_fatura) || 0),
                                0,
                              ),
                            )}
                          </td>
                          <td className="text-right px-2 py-2 text-green-700">
                            {formatCurrency(
                              titulosFormaPagSelecionada.reduce(
                                (a, t) => a + (parseFloat(t.vl_pago) || 0),
                                0,
                              ),
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-center text-gray-400 py-12">
                      Nenhum título encontrado
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---- MODAL EXPANDIDO: Portador ---- */}
          {portadorExpandido && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[95vh] flex flex-col overflow-hidden">
                {/* Header do modal */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <Bank size={20} className="text-teal-600" />
                    <h2 className="text-lg font-bold text-[#000638]">
                      Quantidade e Valor por Portador
                    </h2>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Filtros de carteira */}
                    <div className="flex gap-1">
                      {['TODAS', 'SIMPLES', 'DESCONTADA'].map((tipo) => (
                        <button
                          key={tipo}
                          onClick={() => setFiltroCarteiraPortador(tipo)}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                            filtroCarteiraPortador === tipo
                              ? 'bg-[#000638] text-white shadow-md'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {tipo}
                        </button>
                      ))}
                    </div>
                    {/* Filtros de status */}
                    <div className="flex gap-1">
                      {[
                        'TODOS',
                        'EM ABERTO',
                        'VENCIDO',
                        'A VENCER',
                        'PAGOS',
                      ].map((st) => (
                        <button
                          key={st}
                          onClick={() => setFiltroStatusPortador(st)}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                            filtroStatusPortador === st
                              ? st === 'VENCIDO'
                                ? 'bg-red-600 text-white shadow-md'
                                : st === 'A VENCER'
                                  ? 'bg-orange-500 text-white shadow-md'
                                  : st === 'PAGOS'
                                    ? 'bg-green-600 text-white shadow-md'
                                    : st === 'EM ABERTO'
                                      ? 'bg-blue-600 text-white shadow-md'
                                      : 'bg-[#000638] text-white shadow-md'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setPortadorExpandido(false)}
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-red-600 transition-colors"
                      title="Fechar"
                    >
                      <X size={20} weight="bold" />
                    </button>
                  </div>
                </div>
                {/* Filtro mensal do modal */}
                <div className="flex flex-wrap gap-1 px-5 py-2 border-b border-gray-100">
                  {[
                    'ANO',
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
                      onClick={() => setFiltroMesPortador(mes)}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                        filtroMesPortador === mes
                          ? 'bg-[#000638] text-white shadow-md'
                          : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
                      }`}
                    >
                      {mes}
                    </button>
                  ))}
                </div>
                {/* Conteúdo do modal */}
                <div className="flex-1 overflow-auto p-5">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
                    {/* Gráfico expandido */}
                    <div>
                      {chartPortador ? (
                        <div style={{ height: 'calc(85vh - 140px)' }}>
                          <Bar
                            data={chartPortador}
                            options={barOptions('Portador')}
                          />
                        </div>
                      ) : (
                        <div className="text-center text-gray-400 py-12">
                          Sem dados
                        </div>
                      )}
                    </div>
                    {/* Tabela expandida */}
                    <div
                      style={{ maxHeight: 'calc(85vh - 140px)' }}
                      className="overflow-y-auto"
                    >
                      {portadorFiltrado.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-3 py-2 font-semibold text-gray-700">
                                Portador
                              </th>
                              <th className="text-center px-3 py-2 font-semibold text-gray-700">
                                Qtd
                              </th>
                              <th className="text-right px-3 py-2 font-semibold text-gray-700">
                                Valor
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {portadorFiltrado.map((p, i) => (
                              <tr
                                key={i}
                                className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                                onClick={() => setPortadorSelecionado(p.nome)}
                              >
                                <td className="px-3 py-2 text-gray-800 flex items-center gap-2">
                                  <span
                                    className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                                    style={{
                                      backgroundColor: CORES[i % CORES.length],
                                    }}
                                  />
                                  {p.nome}
                                </td>
                                <td className="text-center px-3 py-2 text-gray-600">
                                  {p.qtd.toLocaleString('pt-BR')}
                                </td>
                                <td className="text-right px-3 py-2 font-semibold text-teal-600">
                                  {formatCurrency(p.valor)}
                                </td>
                              </tr>
                            ))}
                            <tr className="bg-gray-100 font-bold">
                              <td className="px-3 py-2 text-gray-800">TOTAL</td>
                              <td className="text-center px-3 py-2 text-gray-800">
                                {portadorFiltrado
                                  .reduce((a, p) => a + p.qtd, 0)
                                  .toLocaleString('pt-BR')}
                              </td>
                              <td className="text-right px-3 py-2 text-teal-700">
                                {formatCurrency(
                                  portadorFiltrado.reduce(
                                    (a, p) => a + p.valor,
                                    0,
                                  ),
                                )}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      ) : (
                        <div className="text-center text-gray-400 py-12">
                          Sem dados de portador
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
});

DashContasAReceber.displayName = 'DashContasAReceber';
export default DashContasAReceber;
