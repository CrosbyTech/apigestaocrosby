import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import PageTitle from '../components/ui/PageTitle';
import {
  MagnifyingGlass,
  Package,
  Storefront,
  Funnel,
  Spinner,
  X,
  Cube,
  ShoppingCart,
  TrendUp,
  FileArrowDown,
  CheckCircle,
} from '@phosphor-icons/react';
import useApiClient from '../hooks/useApiClient';
import FiltroEmpresa from '../components/FiltroEmpresa';

// Classificação tipo 17 - GRUPO DO PRODUTO
const GRUPOS_PRODUTO = [
  { code: '1', name: 'TRADICIONAL MEIA MALHA' },
  { code: '2', name: 'TRADICIONAL COTTON' },
  { code: '3', name: 'TRADICIONAL CLOUDY' },
  { code: '4', name: 'BERMUDA SARJA' },
  { code: '5', name: 'BERMUDA SARJA TECH' },
  { code: '6', name: 'POLO PIQUET' },
  { code: '7', name: 'POLO SUEDINE' },
  { code: '8', name: 'TRADICIONAL ESTAMPADA' },
  { code: '9', name: 'UV' },
  { code: '10', name: 'TRADICIONAL NEW COTTON' },
  { code: '11', name: 'TRADICIONAL COTTON STORM' },
  { code: '12', name: 'TRADICIONAL WAY' },
  { code: '13', name: 'TRADICIONAL ANTI ODOR' },
  { code: '14', name: 'TRADICIONAL CONFORT WAVE' },
  { code: '15', name: 'TRADICIONAL FEM BABYLOOK' },
  { code: '16', name: 'TRADICIONAL FEM CONFORT' },
  { code: '17', name: 'TRADICIONAL LINHO' },
  { code: '18', name: 'TRADICIONAL DECOTE' },
  { code: '19', name: 'TRADICIONAL ACQUABLOC' },
  { code: '20', name: 'TRADICIONAL FEM ESTAMPADA' },
  { code: '21', name: 'TRADICIONAL FEM TRAVETADA' },
  { code: '22', name: 'TRADICIONAL HEAT' },
  { code: '23', name: 'TRADICIONAL HEAVEN' },
  { code: '24', name: 'TRADICIONAL INF ESTAMPADA' },
  { code: '25', name: 'TRADICIONAL HILOW' },
  { code: '26', name: 'TRADICIONAL INFANTIL' },
  { code: '27', name: 'TRADICIONAL ESTAMPADA ALTO RELEVO' },
  { code: '28', name: 'TRADICIONAL LISTAR' },
  { code: '29', name: 'TRADICIONAL COTTON LISTRADA' },
  { code: '30', name: 'TRADICIONAL LISTRADA MEIA MALHA' },
  { code: '31', name: 'TRADICIONAL MULLE' },
  { code: '32', name: 'TRADICIONAL NEW COTTON MG LONGA' },
  { code: '33', name: 'TRADICIONAL PIMA' },
  { code: '34', name: 'TRADICIONAL PRIEST' },
  { code: '35', name: 'POLO PIMA' },
  { code: '36', name: 'TRADICIONAL STORM' },
  { code: '37', name: 'TRADICIONAL STAR GOLA V' },
  { code: '38', name: 'TRADICIONAL STRONG' },
  { code: '39', name: 'TRADICIONAL TEXTU' },
  { code: '40', name: 'TRADICIONAL VISCOSE' },
  { code: '41', name: 'BONE' },
  { code: '42', name: 'CALCA CHINO' },
  { code: '43', name: 'SOCIAL MG CURTA' },
  { code: '44', name: 'SOCIAL MG LONGA' },
  { code: '45', name: 'POLO GOLA PORTUGUESA' },
  { code: '46', name: 'TACTEL LISO' },
  { code: '47', name: 'TACTEL EST' },
  { code: '48', name: 'TACTEL ANTI ODOR' },
  { code: '49', name: 'CAMISA MOLETON' },
  { code: '50', name: 'REGATA FEM' },
  { code: '51', name: 'REGATA FEM GOLA ALTA' },
  { code: '52', name: 'VESTIDO' },
  { code: '53', name: 'VESTIDO POLO' },
  { code: '54', name: 'POLO INF' },
  { code: '55', name: 'PAPETE' },
  { code: '56', name: 'CASACO MOLETOM' },
  { code: '57', name: 'BERMUDA MOLETOM' },
  { code: '58', name: 'SAPATO' },
  { code: '59', name: 'SUETER' },
  { code: '60', name: 'COPO' },
  { code: '61', name: 'SQUARE' },
  { code: '62', name: 'CARTEIRA' },
  { code: '63', name: 'BIANCA' },
  { code: '64', name: 'BERMUDA JEANS' },
  { code: '65', name: 'CUECA' },
  { code: '66', name: 'CALCA JEANS MASC' },
  { code: '67', name: 'POLO COTTON' },
  { code: '68', name: 'BOLSA REVENDEDOR' },
  { code: '69', name: 'REGATA MASC MEIA MALHA' },
  { code: '70', name: 'REGATA MASC MALHA DIFERENCIADA' },
  { code: '71', name: 'SHORT JEANS' },
  { code: '72', name: 'TACTEL TECH' },
  { code: '73', name: 'SHORT DE LINHO' },
  { code: '74', name: 'TACTEL ECO' },
  { code: '75', name: 'SANDALIA' },
  { code: '76', name: 'MACAQUINHO' },
  { code: '77', name: 'SACOLA' },
  { code: '78', name: 'JAQUETA' },
  { code: '79', name: 'CINTO' },
  { code: '80', name: 'COLETE' },
  { code: '81', name: 'SAIA JEANS' },
  { code: '82', name: 'SAIA ENVELOPE' },
  { code: '83', name: 'CALCA SARJA' },
  { code: '84', name: 'SHORT SARJA' },
  { code: '85', name: 'CALCA JEANS FEM' },
  { code: '86', name: 'CAMISA OVERSIZED' },
  { code: '87', name: 'TRADICIONAL GOLA V 3/4' },
  { code: '88', name: 'TRADICIONAL SUEDINE' },
  { code: '89', name: 'BERMUDA FEMININA ALFAIATARIA' },
  { code: '90', name: 'REGATA FEM GOLA ALTA SUEDINE' },
  { code: '91', name: 'CALCA FEMININA ALFAIATARIA S/ BOLSO' },
  { code: '92', name: 'BERMUDA DE LINHO' },
  { code: '93', name: 'CALCA FEMININA ALFAIATARIA C/ BOLSO' },
  { code: '94', name: 'SOCIAL MG LONGA FEMININA' },
  { code: '95', name: 'SHORT DE LINHO' },
  { code: '96', name: 'ULTRA BLOCK' },
  { code: '97', name: 'COTTON COM SILK' },
  { code: '98', name: 'TRADICIONAL KING ESTAMPADA' },
  { code: '99', name: 'BERMUDA SARJA ULTRA' },
  { code: '100', name: 'BORRACHA LATERAL' },
  { code: '101', name: 'CAMISA DUETTO' },
  { code: '102', name: 'REGATA FEM GOLA ALTA COTTON' },
  { code: '103', name: 'CAMISA DUETTO FEM' },
  { code: '104', name: 'SOCIAL MG CURTA XADREZ' },
  { code: '105', name: 'SOCIAL MG LONGA XADREZ' },
  { code: '106', name: 'SHORT ALFAIATARIA' },
  { code: '107', name: 'POLO ULTRA' },
  { code: '108', name: 'JAQUETA ULTRA' },
  { code: '109', name: 'TRAD KING PIMA' },
  { code: '110', name: 'VESTIDO PIQUET' },
  { code: '111', name: 'POLO KING ULTRA' },
  { code: '112', name: 'POLO FEM ULTRA' },
  { code: '113', name: 'PRODUTO PARA PARCEIROS' },
  { code: '114', name: 'MEIA' },
  { code: '115', name: 'TRADICIONAL KING MEIA MALHA' },
  { code: '116', name: 'COTTON TRADICIONAL INFANTIL' },
  { code: '117', name: 'COTTON TRAD KING' },
  { code: '118', name: 'CLOUDY TRAD KING' },
  { code: '119', name: 'BORDADO NA LATERAL' },
  { code: '120', name: 'BORRACHA E BOTAO LATERAL' },
  { code: '121', name: 'ETIQUETA BORDADA LATERAL' },
  { code: '122', name: 'CLOUDY INFANTIL' },
  { code: '123', name: 'KIT CHURRASCO' },
  { code: '125', name: 'TRADICIONAL PLUS' },
  { code: '126', name: 'COTTON DIFERENCIADA' },
  { code: '127', name: 'POLO TEXTURIZADO' },
  { code: '128', name: 'CAMISA MANEQUIM BLACK FRIDAY' },
  { code: '130', name: 'INFANTIL ULTRA BLOCK' },
  { code: '131', name: 'KING ULTRA BLOCK' },
  { code: '132', name: 'BERMUDA INFANTIL SARJA ULTRA' },
  { code: '133', name: 'TRADICIONAL EMBORRACHADA' },
  { code: '137', name: 'POLO TRICOT' },
  { code: '138', name: 'NECESSAIRE' },
  { code: '139', name: 'FARDAMENTO' },
  { code: '145', name: 'POLO MASC' },
  { code: '150', name: 'NECESSAIRE' },
  { code: '1000', name: 'PECA PILOTO' },
  { code: '1001', name: 'VALOR COMPLEMENTAR' },
  { code: '1003', name: 'TSHIRT DRY BUSNESS' },
];

const Estoque = () => {
  const { totvs } = useApiClient();

  // Estado dos filtros
  const [filters, setFilters] = useState({
    stockCode: '1',
    productName: '',
    productCodeList: '',
    referenceCodeList: '',
    barCodeList: '',
    hasStock: '',
    isSalesOrder: false,
    isTransaction: false,
    isPurchaseOrder: false,
  });

  // Estado para empresas selecionadas (FiltroEmpresa)
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);

  // Estado para grupos selecionados (multi-select)
  const [selectedGrupos, setSelectedGrupos] = useState([]);
  const [showGrupoDropdown, setShowGrupoDropdown] = useState(false);
  const [grupoSearch, setGrupoSearch] = useState('');
  const grupoDropdownRef = useRef(null);

  // Estado da consulta
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState('');
  const [error, setError] = useState(null);
  const [lastSearchTime, setLastSearchTime] = useState(null);
  const [includeBarCodes, setIncludeBarCodes] = useState(false);

  // Fechar dropdown de grupo ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        grupoDropdownRef.current &&
        !grupoDropdownRef.current.contains(event.target)
      ) {
        setShowGrupoDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // CSS customizado para a tabela (padrão do projeto)
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .table-container {
        overflow-x: auto;
        position: relative;
        max-width: 100%;
      }
      .extrato-table {
        border-collapse: collapse;
        width: 100%;
      }
      .extrato-table th,
      .extrato-table td {
        padding: 3px 4px !important;
        border-right: 1px solid #f3f4f6;
        word-wrap: break-word;
        white-space: normal;
        font-size: 9px;
        line-height: 1.2;
      }
      .extrato-table th:last-child,
      .extrato-table td:last-child {
        border-right: none;
      }
      .extrato-table th {
        background-color: #000638;
        color: white;
        font-weight: 600;
        text-transform: uppercase;
        font-size: 8px;
        letter-spacing: 0.05em;
      }
      .extrato-table tbody tr:nth-child(odd) {
        background-color: white;
      }
      .extrato-table tbody tr:nth-child(even) {
        background-color: #f9fafb;
      }
      .extrato-table tbody tr:hover {
        background-color: #f3f4f6;
      }
      .extrato-table thead th:first-child,
      .extrato-table tbody td:first-child {
        position: sticky;
        left: 0;
        z-index: 10;
        background-color: inherit;
      }
      .extrato-table thead th:first-child {
        background-color: #000638;
      }
      .extrato-table tbody tr:nth-child(even) td:first-child {
        background-color: #f9fafb;
      }
      .extrato-table tbody tr:nth-child(odd) td:first-child {
        background-color: white;
      }
      .extrato-table tbody tr:hover td:first-child {
        background-color: #f3f4f6;
      }
    `;
    document.head.appendChild(styleElement);

    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  const handleFilterChange = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const buildRequestBody = useCallback(
    (pageNum, hasStockOverride) => {
      const filter = {};

      if (filters.productName.trim()) {
        filter.productName = filters.productName.trim();
      }

      if (filters.productCodeList.trim()) {
        filter.productCodeList = filters.productCodeList
          .split(',')
          .map((c) => parseInt(c.trim()))
          .filter((c) => !isNaN(c));
      }

      if (filters.referenceCodeList.trim()) {
        filter.referenceCodeList = filters.referenceCodeList
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
      }

      if (filters.barCodeList.trim()) {
        filter.barCodeList = filters.barCodeList
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
      }

      // Classificação tipo 17 - envia códigos selecionados ou TODOS
      const codeList =
        selectedGrupos.length > 0
          ? selectedGrupos
          : GRUPOS_PRODUTO.map((g) => g.code);
      filter.classifications = [{ type: 17, codeList }];

      // branchCode da primeira empresa selecionada (ou 1 como fallback)
      const branchCode =
        empresasSelecionadas.length > 0
          ? parseInt(empresasSelecionadas[0].cd_empresa) || 1
          : 1;

      // hasStock: usa override se fornecido, senão usa o filtro
      const hasStockValue =
        hasStockOverride !== undefined ? hasStockOverride : filters.hasStock;

      if (hasStockValue === 'true' || hasStockValue === true) {
        filter.hasStock = true;
        filter.branchStockCode = branchCode;
        filter.stockCode = parseInt(filters.stockCode) || 1;
      } else if (hasStockValue === 'false' || hasStockValue === false) {
        filter.hasStock = false;
        filter.branchStockCode = branchCode;
        filter.stockCode = parseInt(filters.stockCode) || 1;
      }

      const balanceOption = {
        branchCode: branchCode,
        stockCodeList: [parseInt(filters.stockCode) || 1],
      };

      if (filters.isSalesOrder) balanceOption.isSalesOrder = true;
      if (filters.isTransaction) balanceOption.isTransaction = true;
      if (filters.isPurchaseOrder) balanceOption.isPurchaseOrder = true;

      return {
        filter,
        option: {
          balances: [balanceOption],
        },
        page: pageNum,
        pageSize: 200,
        order: 'productCode',
      };
    },
    [filters, selectedGrupos, empresasSelecionadas],
  );

  // Busca todas as páginas com um hasStock específico (com retry em caso de 502/503)
  const fetchAllPages = useCallback(
    async (hasStockValue, label) => {
      let allItems = [];
      let currentPage = 1;
      let keepFetching = true;
      const MAX_RETRIES = 3;

      while (keepFetching) {
        setLoadingProgress(
          `${label} - página ${currentPage}...${allItems.length > 0 ? ` (${allItems.length} produtos)` : ''}`,
        );

        const body = buildRequestBody(currentPage, hasStockValue);
        console.log(
          `📦 [${label}] Enviando body para product-balances:`,
          JSON.stringify(body, null, 2),
        );

        let result = null;
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            result = await totvs.productBalances(body);
            if (result && result.success !== false) {
              lastError = null;
              break;
            }
            // Se retornou erro mas não é 502/503, não faz retry
            lastError = result?.message || 'Erro ao buscar saldos';
            break;
          } catch (err) {
            lastError = err.message || 'Erro ao conectar com a API';
            const is502or503 =
              lastError.includes('502') ||
              lastError.includes('503') ||
              lastError.includes('Bad Gateway') ||
              lastError.includes('timeout') ||
              lastError.includes('Erro ao buscar saldos');
            if (is502or503 && attempt < MAX_RETRIES) {
              const waitSec = attempt * 3;
              console.warn(
                `⚠️ [${label}] Tentativa ${attempt}/${MAX_RETRIES} falhou (${lastError}). Aguardando ${waitSec}s...`,
              );
              setLoadingProgress(
                `${label} - página ${currentPage} (tentativa ${attempt + 1}/${MAX_RETRIES}, aguardando ${waitSec}s...)`,
              );
              await new Promise((r) => setTimeout(r, waitSec * 1000));
            } else {
              break;
            }
          }
        }

        if (result && result.success !== false) {
          const items = result.data?.data || result.data || [];
          const pageItems = Array.isArray(items) ? items : [];
          allItems = [...allItems, ...pageItems];

          const hasNextPage = result.data?.hasNext || result.hasNext || false;
          if (hasNextPage && pageItems.length > 0) {
            currentPage++;
          } else {
            keepFetching = false;
          }
        } else {
          if (allItems.length === 0) {
            throw new Error(lastError || 'Erro ao buscar saldos');
          }
          // Se já coletou dados anteriores, para sem erro
          console.warn(
            `⚠️ [${label}] Erro na página ${currentPage} mas já temos ${allItems.length} itens. Parando.`,
          );
          keepFetching = false;
        }
      }

      return allItems;
    },
    [buildRequestBody, totvs],
  );

  // Busca códigos de barras via products/search com expand=barCodes
  const fetchBarCodes = useCallback(async () => {
    const branchCode =
      empresasSelecionadas.length > 0
        ? parseInt(empresasSelecionadas[0].cd_empresa) || 1
        : 1;

    const filter = {};

    if (filters.productName.trim()) {
      filter.productName = filters.productName.trim();
    }
    if (filters.productCodeList.trim()) {
      filter.productCodeList = filters.productCodeList
        .split(',')
        .map((c) => parseInt(c.trim()))
        .filter((c) => !isNaN(c));
    }
    if (filters.referenceCodeList.trim()) {
      filter.referenceCodeList = filters.referenceCodeList
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
    }
    if (filters.barCodeList.trim()) {
      filter.barCodeList = filters.barCodeList
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
    }

    const codeList =
      selectedGrupos.length > 0
        ? selectedGrupos
        : GRUPOS_PRODUTO.map((g) => g.code);
    filter.classifications = [{ type: 17, codeList }];

    const hasStockValue =
      filters.hasStock === 'nonzero' ? 'true' : filters.hasStock;
    if (hasStockValue === 'true') {
      filter.hasStock = true;
      filter.branchStockCode = branchCode;
      filter.stockCode = parseInt(filters.stockCode) || 1;
    } else if (hasStockValue === 'false') {
      filter.hasStock = false;
      filter.branchStockCode = branchCode;
      filter.stockCode = parseInt(filters.stockCode) || 1;
    }

    let allItems = [];
    let currentPage = 1;
    let keepFetching = true;

    while (keepFetching) {
      setLoadingProgress(
        `Buscando códigos de barras - página ${currentPage}...${allItems.length > 0 ? ` (${allItems.length} produtos)` : ''}`,
      );

      const body = {
        filter,
        option: { branchInfoCode: branchCode },
        page: currentPage,
        pageSize: 200,
        expand: 'barCodes',
        order: 'productCode',
      };

      let result = null;
      try {
        result = await totvs.productSearch(body);
      } catch (err) {
        console.warn(
          `⚠️ Erro ao buscar barras página ${currentPage}:`,
          err.message,
        );
        break;
      }

      if (result && result.success !== false) {
        const items = result.data?.data || result.data || [];
        const pageItems = Array.isArray(items) ? items : [];
        allItems = [...allItems, ...pageItems];

        if ((result.data?.hasNext || result.hasNext) && pageItems.length > 0) {
          currentPage++;
        } else {
          keepFetching = false;
        }
      } else {
        break;
      }
    }

    // Map productCode -> barCodes[]
    const barCodeMap = {};
    allItems.forEach((item) => {
      if (item.productCode && item.barCodes) {
        barCodeMap[item.productCode] = item.barCodes;
      }
    });
    return barCodeMap;
  }, [filters, selectedGrupos, empresasSelecionadas, totvs]);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData([]);
    setLoadingProgress('Buscando...');
    const startTime = Date.now();

    try {
      let allItems = [];

      if (filters.hasStock === 'nonzero') {
        // hasStock=true traz TODOS com registro de saldo (positivo, zero e negativo)
        // Depois filtra client-side removendo os zerados
        setLoadingProgress('Buscando produtos com registro de saldo...');
        const allWithStock = await fetchAllPages('true', 'Positivo e Negativo');
        // Mantém apenas itens com stock != 0 em pelo menos um balance
        allItems = allWithStock.filter((item) =>
          (item.balances || []).some((b) => (Number(b.stock) || 0) !== 0),
        );
        console.log(
          `✅ Positivo e Negativo: ${allItems.length} itens (de ${allWithStock.length} com registro)`,
        );
      } else {
        // Busca normal (Todos, Sim, Não)
        allItems = await fetchAllPages(undefined, 'Buscando');
      }

      // Buscar códigos de barras se checkbox marcado
      if (includeBarCodes && allItems.length > 0) {
        try {
          const barCodeMap = await fetchBarCodes();
          allItems = allItems.map((item) => ({
            ...item,
            barCodes: barCodeMap[item.productCode] || [],
          }));
        } catch (bcErr) {
          console.warn('⚠️ Erro ao buscar códigos de barras:', bcErr.message);
        }
      }

      setData(allItems);
    } catch (err) {
      console.error('Erro ao buscar saldos:', err);
      setError(err.message || 'Erro ao conectar com a API');
      setData([]);
    } finally {
      setLoading(false);
      setLoadingProgress('');
      setLastSearchTime(Date.now() - startTime);
    }
  }, [
    buildRequestBody,
    totvs,
    filters.hasStock,
    fetchAllPages,
    includeBarCodes,
    fetchBarCodes,
  ]);

  const handleExportCSV = useCallback(() => {
    if (data.length === 0) return;

    const headers = [
      'Código',
      'Produto',
      'SKU',
      'Referência',
      'Cor',
      'Tamanho',
      ...(includeBarCodes ? ['Códigos de Barras'] : []),
      'Empresa',
      'Tipo Saldo',
      'Estoque',
      'Pedido Venda',
      'Entrada',
      'Saída',
      'Disponível',
    ];

    const rows = data.flatMap((item) =>
      (item.balances || []).map((b) => [
        item.productCode || '',
        `"${(item.productName || '').replace(/"/g, '""')}"`,
        item.productSku || '',
        item.referenceCode || '',
        item.colorName || '',
        item.sizeName || '',
        ...(includeBarCodes
          ? [`"${(item.barCodes || []).map((bc) => bc.code).join(', ')}"`]
          : []),
        b.branchCode || '',
        b.stockDescription || b.stockCode || '',
        b.stock ?? '',
        b.salesOrder ?? '',
        b.inputTransaction ?? '',
        b.outputTransaction ?? '',
        b.avaliableStock ?? '',
      ]),
    );

    const csv = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estoque_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  const formatNumber = (num) => {
    if (num == null) return '-';
    return Number(num).toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  };

  const totals = useMemo(() => {
    if (data.length === 0) return null;
    let stock = 0;
    let salesOrder = 0;
    let available = 0;
    let skuCount = 0;

    data.forEach((item) => {
      (item.balances || []).forEach((b) => {
        stock += Number(b.stock) || 0;
        salesOrder += Number(b.salesOrder) || 0;
        available += Number(b.avaliableStock) || 0;
        skuCount++;
      });
    });

    return { stock, salesOrder, available, skuCount };
  }, [data]);

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Consulta de Estoque"
        subtitle="Acompanhe os saldos de produtos via API TOTVS Moda"
        icon={Package}
        iconColor="text-teal-600"
      />

      {/* Formulário de Filtros */}
      <div className="mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
          className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full max-w-4xl mx-auto border border-[#000638]/10"
        >
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" />
              Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Configure os filtros para consultar saldos de produtos
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 mb-3">
            <div className="sm:col-span-2">
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={setEmpresasSelecionadas}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Tipo Saldo
              </label>
              <input
                type="number"
                value={filters.stockCode}
                onChange={(e) =>
                  handleFilterChange('stockCode', e.target.value)
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                placeholder="Ex: 1"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Nome do Produto
              </label>
              <input
                type="text"
                value={filters.productName}
                onChange={(e) =>
                  handleFilterChange('productName', e.target.value)
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
                placeholder="Ex: CAMISA, CALÇA..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Com Estoque
              </label>
              <select
                value={filters.hasStock}
                onChange={(e) => handleFilterChange('hasStock', e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="">Todos</option>
                <option value="true">Sim</option>
                <option value="false">Não</option>
                <option value="nonzero">Positivo e Negativo</option>
              </select>
            </div>
          </div>

          {/* Multi-select Grupo do Produto */}
          <div className="mb-3">
            <div className="flex flex-col relative" ref={grupoDropdownRef}>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Grupo do Produto (Tipo 17)
              </label>

              {/* Botão do dropdown */}
              <button
                type="button"
                onClick={() => setShowGrupoDropdown(!showGrupoDropdown)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-left flex items-center justify-between text-xs"
              >
                <span className="truncate">
                  {selectedGrupos.length === 0
                    ? 'Todos os grupos'
                    : `${selectedGrupos.length} grupo(s) selecionado(s)`}
                </span>
                <svg
                  className={`w-4 h-4 transition-transform ${showGrupoDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {/* Dropdown */}
              {showGrupoDropdown && (
                <div className="w-full absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg mt-1 max-h-100 overflow-hidden">
                  {/* Campo de busca */}
                  <div className="p-3 border-b border-gray-200">
                    <input
                      type="text"
                      placeholder="Buscar grupo..."
                      value={grupoSearch}
                      onChange={(e) => setGrupoSearch(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#000638] text-sm"
                      autoFocus
                    />
                  </div>

                  {/* Botões de ação */}
                  <div className="p-3 border-b border-gray-200 bg-gray-50 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedGrupos(GRUPOS_PRODUTO.map((g) => g.code))
                      }
                      className="text-xs px-2 py-1 bg-[#000638] text-white rounded hover:bg-[#fe0000] transition-colors"
                    >
                      Selecionar Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGrupos([]);
                        setGrupoSearch('');
                      }}
                      className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                    >
                      Limpar
                    </button>
                  </div>

                  {/* Lista de grupos */}
                  <div className="w-full max-h-48 overflow-y-auto">
                    {GRUPOS_PRODUTO.filter((g) => {
                      if (!grupoSearch.trim()) return true;
                      const search = grupoSearch.toLowerCase();
                      return (
                        g.code.includes(search) ||
                        g.name.toLowerCase().includes(search)
                      );
                    }).map((g) => {
                      const isSelected = selectedGrupos.includes(g.code);
                      return (
                        <div
                          key={g.code}
                          className={`px-2 py-2 hover:bg-gray-50 cursor-pointer flex items-center mb-1 ${
                            isSelected ? 'bg-blue-50' : ''
                          }`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedGrupos((prev) =>
                                prev.filter((c) => c !== g.code),
                              );
                            } else {
                              setSelectedGrupos((prev) => [...prev, g.code]);
                            }
                          }}
                        >
                          <div className="flex flex-row w-full">
                            <span className="text-xs font-medium text-gray-900">
                              {g.code} - {g.name}
                            </span>
                          </div>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            className="rounded border-gray-300 text-[#000638] focus:ring-[#000638] mr-1 w-4 h-4"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 mb-3">
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Cód. Produto
              </label>
              <input
                type="text"
                value={filters.productCodeList}
                onChange={(e) =>
                  handleFilterChange('productCodeList', e.target.value)
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
                placeholder="123, 456"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Referências
              </label>
              <input
                type="text"
                value={filters.referenceCodeList}
                onChange={(e) =>
                  handleFilterChange('referenceCodeList', e.target.value)
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
                placeholder="REF001, REF002"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Cód. Barras
              </label>
              <input
                type="text"
                value={filters.barCodeList}
                onChange={(e) =>
                  handleFilterChange('barCodeList', e.target.value)
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
                placeholder="7891234567890"
              />
            </div>
            <div className="sm:col-span-2 flex items-end gap-2">
              <button
                type="submit"
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Spinner size={10} className="animate-spin" />
                    <span>{loadingProgress || 'Buscando...'}</span>
                  </>
                ) : (
                  <>
                    <MagnifyingGlass size={10} />
                    <span>Consultar</span>
                  </>
                )}
              </button>
              {data.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="flex items-center gap-1 bg-white text-[#000638] border border-[#000638]/30 px-3 py-1 rounded-lg hover:bg-[#f8f9fb] transition-colors h-7 text-xs font-bold shadow-sm"
                >
                  <FileArrowDown size={10} />
                  <span>CSV</span>
                </button>
              )}
            </div>
          </div>

          {/* Opções adicionais */}
          <div className="flex flex-wrap gap-4 pt-2 border-t border-[#000638]/10">
            <label className="flex items-center gap-1.5 text-xs text-[#000638] cursor-pointer">
              <input
                type="checkbox"
                checked={filters.isSalesOrder}
                onChange={(e) =>
                  handleFilterChange('isSalesOrder', e.target.checked)
                }
                className="rounded border-[#000638]/30 text-[#000638] focus:ring-[#000638]"
              />
              Pedidos de Venda
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[#000638] cursor-pointer">
              <input
                type="checkbox"
                checked={filters.isTransaction}
                onChange={(e) =>
                  handleFilterChange('isTransaction', e.target.checked)
                }
                className="rounded border-[#000638]/30 text-[#000638] focus:ring-[#000638]"
              />
              Transações Pendentes
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[#000638] cursor-pointer">
              <input
                type="checkbox"
                checked={filters.isPurchaseOrder}
                onChange={(e) =>
                  handleFilterChange('isPurchaseOrder', e.target.checked)
                }
                className="rounded border-[#000638]/30 text-[#000638] focus:ring-[#000638]"
              />
              Pedidos de Compra
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[#000638] cursor-pointer">
              <input
                type="checkbox"
                checked={includeBarCodes}
                onChange={(e) => setIncludeBarCodes(e.target.checked)}
                className="rounded border-[#000638]/30 text-[#000638] focus:ring-[#000638]"
              />
              Incluir Cód. Barras
            </label>
          </div>
        </form>
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <X size={14} className="text-red-500" />
            <span className="text-red-700 text-xs">{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Cards de Resumo */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 max-w-4xl mx-auto">
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Package size={14} className="text-blue-600" />
                <CardTitle className="text-xs font-bold text-blue-700">
                  Saldo Total
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div
                className={`text-sm font-extrabold mb-0.5 break-words ${totals.stock > 0 ? 'text-blue-600' : totals.stock < 0 ? 'text-red-600' : 'text-gray-400'}`}
              >
                {loading ? (
                  <Spinner size={18} className="animate-spin text-blue-600" />
                ) : (
                  formatNumber(totals.stock)
                )}
              </div>
              <CardDescription className="text-xs text-gray-500">
                unidades em estoque
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CheckCircle size={14} className="text-green-600" />
                <CardTitle className="text-xs font-bold text-green-700">
                  Disponível
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div
                className={`text-sm font-extrabold mb-0.5 break-words ${totals.available > 0 ? 'text-green-600' : totals.available < 0 ? 'text-red-600' : 'text-gray-400'}`}
              >
                {loading ? (
                  <Spinner size={18} className="animate-spin text-green-600" />
                ) : (
                  formatNumber(totals.available)
                )}
              </div>
              <CardDescription className="text-xs text-gray-500">
                disponível para venda
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <ShoppingCart size={14} className="text-orange-600" />
                <CardTitle className="text-xs font-bold text-orange-700">
                  Ped. Venda
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div
                className={`text-sm font-extrabold mb-0.5 break-words ${totals.salesOrder > 0 ? 'text-orange-600' : 'text-gray-400'}`}
              >
                {loading ? (
                  <Spinner size={18} className="animate-spin text-orange-600" />
                ) : (
                  formatNumber(totals.salesOrder)
                )}
              </div>
              <CardDescription className="text-xs text-gray-500">
                em pedidos de venda
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Cube size={14} className="text-purple-600" />
                <CardTitle className="text-xs font-bold text-purple-700">
                  SKUs
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-purple-600 mb-0.5 break-words">
                {loading ? (
                  <Spinner size={18} className="animate-spin text-purple-600" />
                ) : (
                  totals.skuCount.toLocaleString('pt-BR')
                )}
              </div>
              <CardDescription className="text-xs text-gray-500">
                linhas de saldo
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Resultados */}
      {data.length > 0 && (
        <div className="bg-white rounded-lg shadow-md border border-[#000638]/10">
          <div className="px-3 py-2 border-b border-[#000638]/10 flex items-center justify-between">
            <span className="text-xs font-bold text-[#000638]">
              {data.length.toLocaleString('pt-BR')} produtos encontrados
            </span>
            {lastSearchTime && (
              <span className="text-xs text-gray-400">
                ({(lastSearchTime / 1000).toFixed(1)}s)
              </span>
            )}
          </div>

          <div className="table-container">
            <table className="extrato-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th>Referência</th>
                  <th>Cor</th>
                  <th>Tamanho</th>
                  {includeBarCodes && <th>Cód. Barras</th>}
                  <th>Empresa</th>
                  <th style={{ textAlign: 'right' }}>Estoque</th>
                  {filters.isSalesOrder && (
                    <th style={{ textAlign: 'right' }}>Ped. Venda</th>
                  )}
                  {filters.isTransaction && (
                    <>
                      <th style={{ textAlign: 'right' }}>Entrada</th>
                      <th style={{ textAlign: 'right' }}>Saída</th>
                    </>
                  )}
                  {filters.isPurchaseOrder && (
                    <th style={{ textAlign: 'right' }}>Ped. Compra</th>
                  )}
                  <th style={{ textAlign: 'right' }}>Disponível</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item, idx) => {
                  const balances = item.balances || [];

                  if (balances.length === 0) {
                    return (
                      <tr key={item.productCode || idx}>
                        <td>{item.productCode}</td>
                        <td>{item.productName}</td>
                        <td>{item.productSku || '-'}</td>
                        <td>{item.referenceCode || '-'}</td>
                        <td>{item.colorName || '-'}</td>
                        <td>{item.sizeName || '-'}</td>
                        {includeBarCodes && (
                          <td
                            style={{
                              maxWidth: '120px',
                              wordBreak: 'break-all',
                              fontSize: '8px',
                            }}
                          >
                            {(item.barCodes || []).length > 0
                              ? (item.barCodes || [])
                                  .map((bc) =>
                                    bc.isMainCode ? `${bc.code}*` : bc.code,
                                  )
                                  .join(', ')
                              : '-'}
                          </td>
                        )}
                        <td
                          colSpan={
                            3 +
                            (filters.isSalesOrder ? 1 : 0) +
                            (filters.isTransaction ? 2 : 0) +
                            (filters.isPurchaseOrder ? 1 : 0)
                          }
                          style={{ textAlign: 'center', color: '#9ca3af' }}
                        >
                          Sem saldo
                        </td>
                      </tr>
                    );
                  }

                  return balances.map((b, bIdx) => (
                    <tr
                      key={`${item.productCode}-${b.branchCode}-${b.stockCode}-${bIdx}`}
                    >
                      {bIdx === 0 ? (
                        <>
                          <td rowSpan={balances.length}>{item.productCode}</td>
                          <td rowSpan={balances.length}>{item.productName}</td>
                          <td rowSpan={balances.length}>
                            {item.productSku || '-'}
                          </td>
                          <td rowSpan={balances.length}>
                            {item.referenceCode || '-'}
                          </td>
                          <td rowSpan={balances.length}>
                            {item.colorName || '-'}
                          </td>
                          <td rowSpan={balances.length}>
                            {item.sizeName || '-'}
                          </td>
                          {includeBarCodes && (
                            <td
                              rowSpan={balances.length}
                              style={{
                                maxWidth: '120px',
                                wordBreak: 'break-all',
                                fontSize: '8px',
                              }}
                            >
                              {(item.barCodes || []).length > 0
                                ? (item.barCodes || [])
                                    .map((bc) =>
                                      bc.isMainCode ? `${bc.code}*` : bc.code,
                                    )
                                    .join(', ')
                                : '-'}
                            </td>
                          )}
                        </>
                      ) : null}
                      <td>{b.branchCode}</td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontWeight: 600,
                          color:
                            (b.stock || 0) > 0
                              ? '#15803d'
                              : (b.stock || 0) < 0
                                ? '#dc2626'
                                : '#9ca3af',
                        }}
                      >
                        {formatNumber(b.stock)}
                      </td>
                      {filters.isSalesOrder && (
                        <td style={{ textAlign: 'right', color: '#ea580c' }}>
                          {formatNumber(b.salesOrder)}
                        </td>
                      )}
                      {filters.isTransaction && (
                        <>
                          <td style={{ textAlign: 'right', color: '#2563eb' }}>
                            {formatNumber(b.inputTransaction)}
                          </td>
                          <td style={{ textAlign: 'right', color: '#d97706' }}>
                            {formatNumber(b.outputTransaction)}
                          </td>
                        </>
                      )}
                      {filters.isPurchaseOrder && (
                        <td style={{ textAlign: 'right', color: '#7c3aed' }}>
                          {formatNumber(b.purchaseOrder)}
                        </td>
                      )}
                      <td
                        style={{
                          textAlign: 'right',
                          fontWeight: 700,
                          color:
                            (b.avaliableStock || 0) > 0
                              ? '#15803d'
                              : (b.avaliableStock || 0) < 0
                                ? '#dc2626'
                                : '#9ca3af',
                        }}
                      >
                        {formatNumber(b.avaliableStock)}
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Estado vazio */}
      {!loading && data.length === 0 && !error && (
        <div className="bg-white rounded-lg shadow-md border border-[#000638]/10 p-12 text-center">
          <Package
            size={48}
            weight="light"
            className="text-gray-300 mx-auto mb-3"
          />
          <h3 className="text-[#000638] font-bold text-sm">
            Nenhuma consulta realizada
          </h3>
          <p className="text-gray-400 text-xs mt-1">
            Configure os filtros e clique em &quot;Consultar&quot; para buscar
            saldos de produtos
          </p>
        </div>
      )}
    </div>
  );
};

export default Estoque;
