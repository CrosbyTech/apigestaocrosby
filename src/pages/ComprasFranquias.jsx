import React, { useState, useMemo, useEffect } from 'react';
import useApiClient from '../hooks/useApiClient';
import LoadingSpinner from '../components/LoadingSpinner';
import PageTitle from '../components/ui/PageTitle';
import * as XLSX from 'xlsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import {
  Receipt,
  Funnel,
  TrendDown,
  ShoppingCart,
  TrendUp,
  ArrowUp,
  ArrowDown,
  X,
  Star,
  FileArrowDown,
  CalendarBlank,
  ListBullets,
} from '@phosphor-icons/react';

const LOJAS_DESTAQUE = [
  'BELO HORIZONTE',
  'JOAO CAMARA',
  'JOÃO CÂMARA',
  'SANTA CRUZ',
  'SAO JOSE DE MIPIBU',
  'SÃO JOSÉ DE MIPIBU',
  'GOIANINHA',
  'CEARA MIRIM',
  'CEARÁ MIRIM',
  'CARAUBAS',
  'CARAÚBAS',
  'CIDADE VERDE',
  'PASSA E FICA',
  'ACU',
  'AÇU',
  'MOSSORO CENTRO',
  'MOSSORÓ CENTRO',
  'CAMPESTRE',
  'GRAVATA',
  'GRAVATÁ',
  'TIMBAUBA',
  'TIMBAÚBA',
  'PIEDADE',
  'GOIANA',
  'IGARASSU',
  'CARPINA',
  'MAMANGUAPE',
  'GUARABIRA',
  'SAO JOAO DO RIO DO PEIXE',
  'SÃO JOÃO DO RIO DO PEIXE',
  'ITAPOROROCA',
  'CAJAZEIRAS',
  'ALAGOA GRANDE',
  'MANGABEIRA',
  'BOA VISTA',
  'PLANALTO',
  'AMARANTE',
  'ABEL CABRAL',
  'MANAIRA',
  'MANAÍRA',
  'VITORIA DE SANTO ANTAO',
  'VITÓRIA DE SANTO ANTÃO',
  'BELEM',
  'BELÉM',
  'MOSSORO NOVA BETANIA',
  'MOSSORÓ NOVA BETÂNIA',
  'SOUSA',
  'MONTEIRO',
  'SAO PAULO DO POTENGI',
  'SÃO PAULO DO POTENGI',
  'ARARIPINA',
  'COSTA DOURADA',
  'PATIO RORAIMA',
  'PÁTIO RORAIMA',
  'ACAILANDIA',
  'AÇAILÂNDIA',
  'AÇAILANDIA',
  'NATAL SHOPPING',
  'AMAPA GARDEN',
  'AMAPÁ GARDEN',
  'PETROLINA INTEGRACAO',
  'PETROLINA INTEGRAÇÃO',
  'QUIXADA',
  'QUIXADÁ',
  'AREIA BRANCA',
  'PINHEIRO',
  'PATIO BELEM',
  'PÁTIO BELÉM',
];

const isLojaDestaque = (nome) => {
  if (!nome) return false;
  const upper = nome.toUpperCase();
  return LOJAS_DESTAQUE.some((loja) => upper.includes(loja));
};

const ComprasFranquias = () => {
  const api = useApiClient();

  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

  const [dataInicio, setDataInicio] = useState(
    firstDay.toISOString().split('T')[0],
  );
  const [dataFim, setDataFim] = useState(today.toISOString().split('T')[0]);

  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [groupedRows, setGroupedRows] = useState([]);
  const [sortField, setSortField] = useState('nm_fantasia');
  const [sortDirection, setSortDirection] = useState('asc');
  const [viewMensal, setViewMensal] = useState(false);

  // Mapa personCode → array de invoices brutas
  const [invoicesMap, setInvoicesMap] = useState({});

  // Modal
  const [modalData, setModalData] = useState(null);

  // Mapa de branchCode → nome empresa (para coluna "Empresa Fat")
  const [branchNames, setBranchNames] = useState({});

  const formatBRL = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(Number(value) || 0);
  };

  // Carregar nomes das empresas (branches) uma vez
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const result = await api.apiCall('/api/totvs/branches');
        let empresas = [];
        if (result && result.data) {
          empresas = Array.isArray(result.data)
            ? result.data
            : result.data.data || [];
        }
        const nameMap = {};
        empresas.forEach((emp) => {
          const code = parseInt(emp.cd_empresa);
          nameMap[code] =
            emp.nm_grupoempresa || emp.fantasyName || `Empresa ${code}`;
        });
        setBranchNames(nameMap);
      } catch (err) {
        console.warn('Erro ao carregar nomes das empresas:', err);
      }
    };
    fetchBranches();
  }, []);

  const buscar = async () => {
    if (!dataInicio || !dataFim) {
      setError('Selecione data início e fim');
      return;
    }

    setError('');
    setLoading(true);
    setGroupedRows([]);

    try {
      // 1) Buscar clientes franquia do TOTVS
      setLoadingMsg('Buscando clientes franquia...');
      const franchiseResult = await api.totvs.franchiseClients();

      let franchiseClients = [];
      if (franchiseResult && franchiseResult.data) {
        franchiseClients = Array.isArray(franchiseResult.data)
          ? franchiseResult.data
          : franchiseResult.data.data || [];
      } else if (Array.isArray(franchiseResult)) {
        franchiseClients = franchiseResult;
      }

      if (franchiseClients.length === 0) {
        setError('Nenhum cliente franquia encontrado');
        setLoading(false);
        return;
      }

      const personCodes = franchiseClients.map((c) => c.code).filter(Boolean);

      // Mapear código → dados da franquia
      const franchiseMap = {};
      franchiseClients.forEach((c) => {
        franchiseMap[c.code] = {
          name: c.name || '',
          fantasyName: c.fantasyName || '',
          cnpj: c.cnpj || '',
        };
      });

      // 2) Buscar notas fiscais para esses clientes no período
      // Usar branchCodes de 1 a 99 (empresas reais, não códigos altos 870+)
      let validBranches = Object.keys(branchNames)
        .map(Number)
        .filter((c) => c >= 1 && c <= 99);

      // Se branches ainda não carregou, buscar agora
      if (validBranches.length === 0) {
        try {
          const brResult = await api.apiCall('/api/totvs/branches');
          let emps = [];
          if (brResult?.data) {
            emps = Array.isArray(brResult.data)
              ? brResult.data
              : brResult.data.data || [];
          }
          validBranches = emps
            .map((e) => parseInt(e.cd_empresa))
            .filter((c) => c >= 1 && c <= 99);
        } catch (e) {
          console.warn('Erro ao buscar branches:', e);
        }
      }

      setLoadingMsg(
        `Buscando notas fiscais para ${personCodes.length} franquias...`,
      );

      const personCodesSet = new Set(personCodes);

      // Dividir período em chunks mensais para evitar 400 da API TOTVS
      const chunks = [];
      const start = new Date(dataInicio);
      const end = new Date(dataFim);
      let chunkStart = new Date(start);
      while (chunkStart <= end) {
        const chunkEnd = new Date(chunkStart);
        chunkEnd.setMonth(chunkEnd.getMonth() + 1);
        chunkEnd.setDate(chunkEnd.getDate() - 1);
        const finalEnd = chunkEnd > end ? end : chunkEnd;
        chunks.push({
          startDate: chunkStart.toISOString().slice(0, 10),
          endDate: finalEnd.toISOString().slice(0, 10),
        });
        chunkStart = new Date(finalEnd);
        chunkStart.setDate(chunkStart.getDate() + 1);
      }

      let invoices = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        setLoadingMsg(`Buscando notas fiscais (${i + 1}/${chunks.length})...`);
        try {
          const invoicesResult = await api.totvs.invoicesSearch({
            startDate: chunk.startDate,
            endDate: chunk.endDate,
            branchCodeList:
              validBranches.length > 0 ? validBranches : undefined,
            invoiceStatusList: ['Issued'],
          });

          let items = [];
          if (invoicesResult?.success && invoicesResult?.data?.items) {
            items = invoicesResult.data.items;
          } else if (invoicesResult?.data?.items) {
            items = invoicesResult.data.items;
          } else if (Array.isArray(invoicesResult?.items)) {
            items = invoicesResult.items;
          }
          invoices = invoices.concat(items);
        } catch (chunkErr) {
          console.warn(
            `Erro no chunk ${chunk.startDate} - ${chunk.endDate}:`,
            chunkErr,
          );
        }
      }

      // Filtrar pela data exata e apenas clientes franquia
      const filtered = invoices.filter((inv) => {
        if (!inv.invoiceDate) return false;
        if (!personCodesSet.has(inv.personCode)) return false;
        const d = inv.invoiceDate.slice(0, 10);
        return d >= dataInicio && d <= dataFim;
      });

      // 3) Agrupar por cliente (personCode) somando entradas e saídas
      const grupos = {};
      const invMap = {};
      filtered.forEach((inv) => {
        const personCode = inv.personCode;
        const franchise = franchiseMap[personCode];
        const clienteNome =
          franchise?.fantasyName ||
          franchise?.name ||
          inv.personName ||
          `Cliente ${personCode}`;

        if (!grupos[personCode]) {
          grupos[personCode] = {
            personCode,
            nm_fantasia: clienteNome,
            nm_grupoempresa:
              branchNames[inv.branchCode] || `Empresa ${inv.branchCode}`,
            total_devolucao: 0,
            total_compras: 0,
            qtd_vendas: 0,
            qtd_devolucoes: 0,
          };
          invMap[personCode] = [];
        }

        invMap[personCode].push(inv);

        const val = Number(inv.totalValue ?? 0);
        const isEntrada =
          String(inv.operationType || '').toLowerCase() === 'input';

        if (isEntrada) {
          grupos[personCode].total_devolucao += val;
          grupos[personCode].qtd_devolucoes += 1;
        } else {
          grupos[personCode].total_compras += val;
          grupos[personCode].qtd_vendas += 1;
        }
      });

      setInvoicesMap(invMap);

      const grouped = Object.values(grupos).map((g) => ({
        ...g,
        total_liquido: g.total_compras - g.total_devolucao,
      }));

      setGroupedRows(grouped);

      if (grouped.length === 0) {
        setError(
          'Nenhuma nota fiscal encontrada para franquias no período selecionado',
        );
      }
    } catch (err) {
      console.error('Erro buscar ComprasFranquias', err);
      setError(err.message || 'Erro ao buscar dados');
      setGroupedRows([]);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  // Ordenação da tabela
  const sortedRows = useMemo(() => {
    const sorted = [...groupedRows].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (
        sortField === 'total_devolucao' ||
        sortField === 'total_compras' ||
        sortField === 'total_liquido' ||
        sortField === 'qtd_vendas' ||
        sortField === 'qtd_devolucoes'
      ) {
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
      } else {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }

      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });
    return sorted;
  }, [groupedRows, sortField, sortDirection]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Cálculos de totais para os cards
  const totalDevolucoes = groupedRows.reduce(
    (s, g) => s + (Number(g.total_devolucao) || 0),
    0,
  );
  const totalCompras = groupedRows.reduce(
    (s, g) => s + (Number(g.total_compras) || 0),
    0,
  );
  const totalLiquido = groupedRows.reduce(
    (s, g) => s + (Number(g.total_liquido) || 0),
    0,
  );

  const exportarExcel = () => {
    const rows = sortedRows.map((r) => ({
      Destaque: isLojaDestaque(r.nm_fantasia) ? '★' : '',
      'Empresa Fat': r.nm_grupoempresa || '-',
      'Nome Fantasia': r.nm_fantasia || '-',
      Devoluções: Number(r.total_devolucao) || 0,
      Compras: Number(r.total_compras) || 0,
      Líquido: Number(r.total_liquido) || 0,
    }));

    // Linha de totais
    rows.push({
      Destaque: '',
      'Empresa Fat': '',
      'Nome Fantasia': 'TOTAL',
      Devoluções: totalDevolucoes,
      Compras: totalCompras,
      Líquido: totalLiquido,
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    // Larguras das colunas
    ws['!cols'] = [
      { wch: 10 },
      { wch: 30 },
      { wch: 35 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
    ];

    // Formatar colunas numéricas como moeda
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = 1; R <= range.e.r; R++) {
      for (let C = 3; C <= 5; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[addr]) {
          ws[addr].z = '#,##0.00';
        }
      }
    }

    // Destacar lojas com fundo amarelo
    for (let R = 1; R < range.e.r; R++) {
      const destaqueCell = XLSX.utils.encode_cell({ r: R, c: 0 });
      if (ws[destaqueCell]?.v === '★') {
        for (let C = 0; C <= 5; C++) {
          const cell = XLSX.utils.encode_cell({ r: R, c: C });
          if (ws[cell]) {
            ws[cell].s = {
              fill: { fgColor: { rgb: 'FFFDE68A' } },
              font: { bold: true },
            };
          }
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Compras Franquias');

    const periodo = `${dataInicio.replace(/-/g, '')}_${dataFim.replace(/-/g, '')}`;
    XLSX.writeFile(wb, `compras_franquias_${periodo}.xlsx`);
  };

  const exportarExcelMensal = () => {
    // Linha 1: cabeçalho com meses mesclados (colspan 2)
    const header1 = ['Destaque', 'Franquia'];
    mesesColunas.forEach((m) => {
      header1.push(m.label);
      header1.push('');
    });
    header1.push('TOTAIS');
    header1.push('');

    // Linha 2: sub-cabeçalhos DEV / COMPRA
    const header2 = ['', ''];
    mesesColunas.forEach(() => {
      header2.push('DEV');
      header2.push('COMPRA');
    });
    header2.push('TOTAL DEV');
    header2.push('TOTAL COMPRA');

    const dataRows = sortedRows.map((r) => {
      const meses = dadosMensais[r.personCode] || {};
      const row = [
        isLojaDestaque(r.nm_fantasia) ? '★' : '',
        r.nm_fantasia || '-',
      ];
      mesesColunas.forEach((m) => {
        const d = meses[m.key];
        row.push(d ? d.devolucao : 0);
        row.push(d ? d.compras : 0);
      });
      row.push(Number(r.total_devolucao) || 0);
      row.push(Number(r.total_compras) || 0);
      return row;
    });

    // Linha de totais
    const totalRow = ['', 'TOTAL'];
    mesesColunas.forEach((m) => {
      let devSum = 0;
      let compraSum = 0;
      sortedRows.forEach((r) => {
        const d = (dadosMensais[r.personCode] || {})[m.key];
        if (d) {
          devSum += d.devolucao;
          compraSum += d.compras;
        }
      });
      totalRow.push(devSum);
      totalRow.push(compraSum);
    });
    totalRow.push(totalDevolucoes);
    totalRow.push(totalCompras);
    dataRows.push(totalRow);

    const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...dataRows]);

    // Mesclar células dos meses na linha 1 (row 0)
    const merges = [];
    for (let i = 0; i < mesesColunas.length; i++) {
      const col = 2 + i * 2;
      merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + 1 } });
    }
    // Mesclar TOTAIS na linha 1
    const totCol = 2 + mesesColunas.length * 2;
    merges.push({ s: { r: 0, c: totCol }, e: { r: 0, c: totCol + 1 } });
    ws['!merges'] = merges;

    // Larguras das colunas
    const colWidths = [{ wch: 10 }, { wch: 35 }];
    mesesColunas.forEach(() => {
      colWidths.push({ wch: 14 });
      colWidths.push({ wch: 14 });
    });
    colWidths.push({ wch: 16 });
    colWidths.push({ wch: 16 });
    ws['!cols'] = colWidths;

    // Formatar colunas numéricas como moeda (dados começam na linha 2)
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = 2; R <= range.e.r; R++) {
      for (let C = 2; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[addr] && typeof ws[addr].v === 'number') {
          ws[addr].z = '#,##0.00';
        }
      }
    }

    // Destacar lojas (dados começam na linha 2, última é totais)
    for (let R = 2; R < range.e.r; R++) {
      const destaqueCell = XLSX.utils.encode_cell({ r: R, c: 0 });
      if (ws[destaqueCell]?.v === '★') {
        for (let C = 0; C <= range.e.c; C++) {
          const cell = XLSX.utils.encode_cell({ r: R, c: C });
          if (ws[cell]) {
            ws[cell].s = {
              fill: { fgColor: { rgb: 'FFFDE68A' } },
              font: { bold: true },
            };
          }
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Detalhamento Mensal');

    const periodo = `${dataInicio.replace(/-/g, '')}_${dataFim.replace(/-/g, '')}`;
    XLSX.writeFile(wb, `compras_franquias_mensal_${periodo}.xlsx`);
  };

  const MESES_LABEL = [
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

  // Colunas de meses no intervalo selecionado
  const mesesColunas = useMemo(() => {
    if (!dataInicio || !dataFim) return [];
    const cols = [];
    const start = new Date(dataInicio + 'T00:00:00');
    const end = new Date(dataFim + 'T00:00:00');
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      cols.push({
        key: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`,
        label: `${MESES_LABEL[cur.getMonth()]} ${String(cur.getFullYear()).slice(2)}`,
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    return cols;
  }, [dataInicio, dataFim]);

  // Dados mensais: { personCode: { '2025-01': { compras, devolucao, liquido }, ... } }
  const dadosMensais = useMemo(() => {
    const resultado = {};
    Object.entries(invoicesMap).forEach(([personCode, invs]) => {
      resultado[personCode] = {};
      invs.forEach((inv) => {
        if (!inv.invoiceDate) return;
        const mesKey = inv.invoiceDate.slice(0, 7); // '2025-01'
        if (!resultado[personCode][mesKey]) {
          resultado[personCode][mesKey] = { compras: 0, devolucao: 0 };
        }
        const val = Number(inv.totalValue ?? 0);
        const isEntrada =
          String(inv.operationType || '').toLowerCase() === 'input';
        if (isEntrada) {
          resultado[personCode][mesKey].devolucao += val;
        } else {
          resultado[personCode][mesKey].compras += val;
        }
      });
    });
    return resultado;
  }, [invoicesMap]);

  return (
    <div className="w-full max-w-[1400px] mx-auto py-6 px-4">
      <PageTitle
        title="Compras Franquias"
        subtitle="Análise de compras e devoluções por franquia (dados TOTVS)"
        icon={Receipt}
        iconColor="text-purple-600"
      />
      {/* Filtros */}
      <div className="mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            buscar();
          }}
          className="bg-white p-3 rounded-lg shadow-lg border border-[#000638]/10"
        >
          <div className="mb-2">
            <span className="text-sm font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={16} weight="bold" />
              Filtros
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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

            <div className="items-center hidden lg:flex">
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1.5 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed font-bold transition-colors shadow-md tracking-wide uppercase text-xs w-full justify-center"
              >
                <Funnel size={14} weight="bold" />
                {loading ? 'Buscando...' : 'Buscar'}
              </button>
            </div>
          </div>
        </form>
      </div>
      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-6">
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <LoadingSpinner />
          {loadingMsg && (
            <p className="text-sm text-gray-500 font-medium">{loadingMsg}</p>
          )}
        </div>
      ) : groupedRows.length > 0 ? (
        <>
          {/* Cards de Resumo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {/* Devoluções */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <TrendDown size={20} className="text-red-600" />
                  <CardTitle className="text-sm font-bold text-red-700">
                    Devoluções
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-lg font-extrabold text-red-600 mb-0.5">
                  {formatBRL(totalDevolucoes)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Total devolvido
                </CardDescription>
              </CardContent>
            </Card>

            {/* Compras */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <ShoppingCart size={20} className="text-green-600" />
                  <CardTitle className="text-sm font-bold text-green-700">
                    Compras
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-lg font-extrabold text-green-600 mb-0.5">
                  {formatBRL(totalCompras)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Total comprado
                </CardDescription>
              </CardContent>
            </Card>

            {/* Líquido */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <TrendUp size={20} className="text-blue-600" />
                  <CardTitle className="text-sm font-bold text-blue-700">
                    Líquido
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-lg font-extrabold text-blue-600 mb-0.5">
                  {formatBRL(totalLiquido)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Compras - Devoluções
                </CardDescription>
              </CardContent>
            </Card>
          </div>

          {/* Tabela de Dados */}
          <Card className="shadow-lg rounded-xl bg-white">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt size={24} className="text-indigo-600" />
                  <CardTitle className="text-lg font-bold text-[#000638]">
                    Detalhamento por Franquia
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={viewMensal ? exportarExcelMensal : exportarExcel}
                    className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors text-xs font-bold shadow-md"
                  >
                    <FileArrowDown size={16} weight="bold" />
                    Exportar Excel
                  </button>
                  <button
                    onClick={() => setViewMensal(!viewMensal)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold shadow-md ${
                      viewMensal
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                        : 'bg-gray-200 text-[#000638] hover:bg-gray-300'
                    }`}
                  >
                    {viewMensal ? (
                      <ListBullets size={16} weight="bold" />
                    ) : (
                      <CalendarBlank size={16} weight="bold" />
                    )}
                    {viewMensal ? 'Visão Consolidada' : 'Detalhar Mensal'}
                  </button>
                </div>
              </div>
              <CardDescription className="text-xs text-gray-500">
                Clique na linha para ver as notas • Total de {sortedRows.length}{' '}
                franquia(s)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {viewMensal ? (
                /* ===== TABELA MENSAL ===== */
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead className="text-xs text-white uppercase bg-[#000638]">
                      {/* Linha 1: Nome do mês (colspan 2) */}
                      <tr>
                        <th
                          rowSpan={2}
                          className="px-3 py-2 text-left sticky left-0 bg-[#000638] z-10 min-w-[200px] border-r border-white/20"
                        >
                          Franquia
                        </th>
                        {mesesColunas.map((m) => (
                          <th
                            key={m.key}
                            colSpan={2}
                            className="px-2 py-2 text-center whitespace-nowrap border-l border-white/20"
                          >
                            {m.label}
                          </th>
                        ))}
                        <th
                          rowSpan={2}
                          className="px-3 py-2 text-right min-w-[110px] bg-[#1a1f5e] border-l border-white/20"
                        >
                          TOTAL DEV
                        </th>
                        <th
                          rowSpan={2}
                          className="px-3 py-2 text-right min-w-[110px] bg-[#1a1f5e] border-l border-white/20"
                        >
                          TOTAL COMPRA
                        </th>
                      </tr>
                      {/* Linha 2: DEV / COMPRA por mês */}
                      <tr>
                        {mesesColunas.map((m) => (
                          <React.Fragment key={m.key}>
                            <th className="px-2 py-1 text-right whitespace-nowrap text-red-300 border-l border-white/20 text-[10px] min-w-[90px]">
                              Dev
                            </th>
                            <th className="px-2 py-1 text-right whitespace-nowrap text-green-300 text-[10px] min-w-[90px]">
                              Compra
                            </th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((r, idx) => {
                        const destaque = isLojaDestaque(r.nm_fantasia);
                        const meses = dadosMensais[r.personCode] || {};
                        return (
                          <tr
                            key={r.personCode || idx}
                            onClick={() => setModalData(r)}
                            className={`border-b hover:bg-blue-50 transition-colors cursor-pointer ${
                              destaque
                                ? 'bg-yellow-50 border-l-4 border-l-yellow-400'
                                : idx % 2 === 0
                                  ? 'bg-white'
                                  : 'bg-gray-50'
                            }`}
                          >
                            <td className="px-3 py-2 font-medium text-gray-900 sticky left-0 bg-inherit z-10 border-r border-gray-200">
                              <span className="flex items-center gap-1">
                                {destaque && (
                                  <Star
                                    size={14}
                                    weight="fill"
                                    className="text-yellow-500 flex-shrink-0"
                                  />
                                )}
                                {r.nm_fantasia || '-'}
                              </span>
                            </td>
                            {mesesColunas.map((m) => {
                              const d = meses[m.key];
                              const dev = d ? d.devolucao : 0;
                              const compra = d ? d.compras : 0;
                              return (
                                <React.Fragment key={m.key}>
                                  <td
                                    className={`px-2 py-2 text-right whitespace-nowrap border-l border-gray-100 ${
                                      dev > 0
                                        ? 'text-red-600 font-semibold'
                                        : 'text-gray-300'
                                    }`}
                                  >
                                    {dev > 0 ? formatBRL(dev) : '-'}
                                  </td>
                                  <td
                                    className={`px-2 py-2 text-right whitespace-nowrap ${
                                      compra > 0
                                        ? 'text-green-600 font-semibold'
                                        : 'text-gray-300'
                                    }`}
                                  >
                                    {compra > 0 ? formatBRL(compra) : '-'}
                                  </td>
                                </React.Fragment>
                              );
                            })}
                            <td className="px-3 py-2 text-right font-bold text-red-600 bg-red-50/50 whitespace-nowrap border-l border-gray-200">
                              {formatBRL(r.total_devolucao)}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-green-600 bg-green-50/50 whitespace-nowrap">
                              {formatBRL(r.total_compras)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[#000638] text-white font-bold">
                        <td className="px-3 py-3 sticky left-0 bg-[#000638] z-10 border-r border-white/20">
                          TOTAL
                        </td>
                        {mesesColunas.map((m) => {
                          const totDev = sortedRows.reduce((sum, r) => {
                            const d = (dadosMensais[r.personCode] || {})[m.key];
                            return sum + (d ? d.devolucao : 0);
                          }, 0);
                          const totCompra = sortedRows.reduce((sum, r) => {
                            const d = (dadosMensais[r.personCode] || {})[m.key];
                            return sum + (d ? d.compras : 0);
                          }, 0);
                          return (
                            <React.Fragment key={m.key}>
                              <td className="px-2 py-3 text-right whitespace-nowrap text-red-300 border-l border-white/20">
                                {formatBRL(totDev)}
                              </td>
                              <td className="px-2 py-3 text-right whitespace-nowrap text-green-300">
                                {formatBRL(totCompra)}
                              </td>
                            </React.Fragment>
                          );
                        })}
                        <td className="px-3 py-3 text-right whitespace-nowrap bg-[#1a1f5e] border-l border-white/20">
                          {formatBRL(totalDevolucoes)}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap bg-[#1a1f5e]">
                          {formatBRL(totalCompras)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                /* ===== TABELA CONSOLIDADA (ORIGINAL) ===== */
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-white uppercase bg-[#000638]">
                      <tr>
                        <th
                          className="px-4 py-3 text-left cursor-pointer hover:bg-[#fe0000] transition-colors"
                          onClick={() => handleSort('nm_grupoempresa')}
                        >
                          <div className="flex items-center gap-1">
                            Empresa Fat
                            {sortField === 'nm_grupoempresa' && (
                              <span>
                                {sortDirection === 'asc' ? (
                                  <ArrowUp size={14} weight="bold" />
                                ) : (
                                  <ArrowDown size={14} weight="bold" />
                                )}
                              </span>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-4 py-3 text-left cursor-pointer hover:bg-[#fe0000] transition-colors"
                          onClick={() => handleSort('nm_fantasia')}
                        >
                          <div className="flex items-center gap-1">
                            Nome Fantasia
                            {sortField === 'nm_fantasia' && (
                              <span>
                                {sortDirection === 'asc' ? (
                                  <ArrowUp size={14} weight="bold" />
                                ) : (
                                  <ArrowDown size={14} weight="bold" />
                                )}
                              </span>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-4 py-3 text-right cursor-pointer hover:bg-[#fe0000] transition-colors"
                          onClick={() => handleSort('total_devolucao')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            Devoluções
                            {sortField === 'total_devolucao' && (
                              <span>
                                {sortDirection === 'asc' ? (
                                  <ArrowUp size={14} weight="bold" />
                                ) : (
                                  <ArrowDown size={14} weight="bold" />
                                )}
                              </span>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-4 py-3 text-right cursor-pointer hover:bg-[#fe0000] transition-colors"
                          onClick={() => handleSort('total_compras')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            Compras
                            {sortField === 'total_compras' && (
                              <span>
                                {sortDirection === 'asc' ? (
                                  <ArrowUp size={14} weight="bold" />
                                ) : (
                                  <ArrowDown size={14} weight="bold" />
                                )}
                              </span>
                            )}
                          </div>
                        </th>
                        <th
                          className="px-4 py-3 text-right cursor-pointer hover:bg-[#fe0000] transition-colors"
                          onClick={() => handleSort('total_liquido')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            Líquido
                            {sortField === 'total_liquido' && (
                              <span>
                                {sortDirection === 'asc' ? (
                                  <ArrowUp size={14} weight="bold" />
                                ) : (
                                  <ArrowDown size={14} weight="bold" />
                                )}
                              </span>
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center text-gray-500"
                          >
                            Nenhum registro encontrado
                          </td>
                        </tr>
                      ) : (
                        sortedRows.map((r, idx) => {
                          const destaque = isLojaDestaque(r.nm_fantasia);
                          return (
                            <tr
                              key={r.personCode || idx}
                              onClick={() => setModalData(r)}
                              className={`border-b hover:bg-blue-50 transition-colors cursor-pointer ${
                                destaque
                                  ? 'bg-yellow-50 border-l-4 border-l-yellow-400'
                                  : idx % 2 === 0
                                    ? 'bg-white'
                                    : 'bg-gray-50'
                              }`}
                            >
                              <td className="px-4 py-3 font-medium text-gray-900">
                                {r.nm_grupoempresa || '-'}
                              </td>
                              <td className="px-4 py-3 font-medium text-gray-900">
                                <span className="flex items-center gap-1">
                                  {destaque && (
                                    <Star
                                      size={14}
                                      weight="fill"
                                      className="text-yellow-500 flex-shrink-0"
                                    />
                                  )}
                                  {r.nm_fantasia || '-'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-red-600">
                                {formatBRL(r.total_devolucao)}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-green-600">
                                {formatBRL(r.total_compras)}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-blue-600">
                                {formatBRL(r.total_liquido)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
      {/* Modal de Notas Fiscais */}
      {modalData && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setModalData(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold text-[#000638]">
                  {modalData.nm_fantasia}
                </h2>
                <p className="text-xs text-gray-500">
                  {modalData.nm_grupoempresa} • Cód: {modalData.personCode}
                </p>
              </div>
              <button
                onClick={() => setModalData(null)}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            {/* Resumo */}
            <div className="grid grid-cols-3 gap-3 px-6 py-3 bg-gray-50 border-b border-gray-200">
              <div className="text-center">
                <p className="text-xs text-gray-500">Devoluções</p>
                <p className="text-sm font-bold text-red-600">
                  {formatBRL(modalData.total_devolucao)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Compras</p>
                <p className="text-sm font-bold text-green-600">
                  {formatBRL(modalData.total_compras)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Líquido</p>
                <p className="text-sm font-bold text-blue-600">
                  {formatBRL(modalData.total_liquido)}
                </p>
              </div>
            </div>

            {/* Conteúdo scrollável */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">
              {(() => {
                const invs = invoicesMap[modalData.personCode] || [];
                const vendas = invs.filter(
                  (i) =>
                    String(i.operationType || '').toLowerCase() !== 'input',
                );
                const devolucoes = invs.filter(
                  (i) =>
                    String(i.operationType || '').toLowerCase() === 'input',
                );

                const formatDate = (d) => {
                  if (!d) return '-';
                  const dt = d.slice(0, 10).split('-');
                  return `${dt[2]}/${dt[1]}/${dt[0]}`;
                };

                const renderTable = (items, tipo) => (
                  <div>
                    <h3
                      className={`text-sm font-bold mb-2 flex items-center gap-2 ${
                        tipo === 'venda' ? 'text-green-700' : 'text-red-700'
                      }`}
                    >
                      {tipo === 'venda' ? (
                        <ShoppingCart size={16} />
                      ) : (
                        <TrendDown size={16} />
                      )}
                      {tipo === 'venda'
                        ? `Compras (${items.length})`
                        : `Devoluções (${items.length})`}
                    </h3>
                    {items.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">
                        Nenhuma nota encontrada
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead
                            className={`text-white ${
                              tipo === 'venda' ? 'bg-green-700' : 'bg-red-700'
                            }`}
                          >
                            <tr>
                              <th className="px-3 py-2 text-left">Nº NF</th>
                              <th className="px-3 py-2 text-left">Série</th>
                              <th className="px-3 py-2 text-left">
                                Data Emissão
                              </th>
                              <th className="px-3 py-2 text-left">Operação</th>
                              <th className="px-3 py-2 text-right">Valor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((inv, i) => (
                              <tr
                                key={`${inv.invoiceCode}-${inv.serialCode}-${i}`}
                                className={`border-b ${
                                  i % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                                }`}
                              >
                                <td className="px-3 py-2 font-medium">
                                  {inv.invoiceCode || '-'}
                                </td>
                                <td className="px-3 py-2">
                                  {inv.serialCode || '-'}
                                </td>
                                <td className="px-3 py-2">
                                  {formatDate(inv.invoiceDate)}
                                </td>
                                <td className="px-3 py-2">
                                  {inv.operatioName || inv.operationType || '-'}
                                </td>
                                <td
                                  className={`px-3 py-2 text-right font-semibold ${
                                    tipo === 'venda'
                                      ? 'text-green-600'
                                      : 'text-red-600'
                                  }`}
                                >
                                  {formatBRL(inv.totalValue)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr
                              className={`font-bold ${
                                tipo === 'venda'
                                  ? 'bg-green-50 text-green-700'
                                  : 'bg-red-50 text-red-700'
                              }`}
                            >
                              <td colSpan={4} className="px-3 py-2 text-right">
                                Total:
                              </td>
                              <td className="px-3 py-2 text-right">
                                {formatBRL(
                                  items.reduce(
                                    (s, i) => s + (Number(i.totalValue) || 0),
                                    0,
                                  ),
                                )}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                );

                return (
                  <>
                    {renderTable(vendas, 'venda')}
                    {renderTable(devolucoes, 'devolucao')}
                  </>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setModalData(null)}
                className="px-4 py-1.5 bg-[#000638] text-white rounded-lg hover:bg-[#fe0000] transition-colors text-xs font-bold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}{' '}
    </div>
  );
};

export default ComprasFranquias;
