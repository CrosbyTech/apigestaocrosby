import React, { useState, useMemo, useEffect } from 'react';
import useApiClient from '../hooks/useApiClient';
import { useAuth } from '../components/AuthContext';
import PageTitle from '../components/ui/PageTitle';
import { TotvsURL } from '../config/constants';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '../components/ui/cards';
import {
  Spinner,
  MagnifyingGlass,
  ChartBar,
  CaretDown,
  Buildings,
  CurrencyDollar,
  Trophy,
  ShoppingCart,
  Tote,
  Funnel,
} from '@phosphor-icons/react';

// ==========================================
// HELPERS
// ==========================================
const formatBRL = (value) =>
  typeof value === 'number'
    ? value.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '-';

// ==========================================
// COMPONENTE PRINCIPAL
// ==========================================
const RankingFaturamento = () => {
  const apiClient = useApiClient();
  const { user } = useAuth();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [branchTotals, setBranchTotals] = useState([]);
  const [meta, setMeta] = useState(null);
  const [filterType, setFilterType] = useState('todas'); // 'todas' | 'franquia' | 'filial'

  // Mapas de empresas
  const [branchNames, setBranchNames] = useState({});
  const [branchGroupMap, setBranchGroupMap] = useState({});

  // ==========================================
  // FETCH: Nomes das empresas
  // ==========================================
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const response = await fetch(`${TotvsURL}branches`);
        if (response.ok) {
          const result = await response.json();
          let empresas = [];
          if (result.success && result.data) {
            empresas = result.data.data || result.data;
            if (!Array.isArray(empresas)) empresas = [];
          }
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
          setBranchNames(nameMap);
          setBranchGroupMap(groupMap);
        }
      } catch (err) {
        // silently fail
      }
    };
    fetchBranches();
  }, []);

  // ==========================================
  // FETCH: Buscar totais por filial (endpoint analítico)
  // ==========================================
  const handleSearch = async () => {
    if (!startDate || !endDate) {
      setError('Informe as datas de início e fim.');
      return;
    }

    setLoading(true);
    setError('');
    setBranchTotals([]);
    setMeta(null);

    try {
      const result = await apiClient.totvs.salePanelRankingFaturamento({
        datemin: startDate,
        datemax: endDate,
      });

      const raw = result?.data ?? result;
      const items = Array.isArray(raw)
        ? raw
        : raw?.dataRow || raw?.items || raw?.data || [];

      setBranchTotals(items);
      setMeta({ total: raw?.total, totalLastYear: raw?.totalLastYear });

      if (items.length === 0) {
        setError('Nenhum dado encontrado para o período informado.');
      }
    } catch (err) {
      setError(err.message || 'Erro desconhecido.');
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // AGRUPAMENTO: Mapear totais por filial
  // ==========================================
  const { grouped, grandTotal } = useMemo(() => {
    if (branchTotals.length === 0) {
      return {
        grouped: [],
        grandTotal: { totalValue: 0, ticketMedio: 0, pa: 0, saidaCount: 0 },
      };
    }

    // Agrupar filiais com o mesmo nome antes de mapear
    const mergedMap = {};
    branchTotals.forEach((item) => {
      const code = item.branch_code ?? item.branch ?? item.branchCode ?? 0;
      const name =
        item.branch_name ||
        item.branchName ||
        branchGroupMap[code] ||
        branchNames[code] ||
        `Empresa ${code}`;
      const key = name.trim().toUpperCase();

      if (!mergedMap[key]) {
        mergedMap[key] = {
          name,
          codes: new Set(),
          invoice_value: 0,
          invoice_qty: 0,
          itens_qty: 0,
        };
      }
      mergedMap[key].codes.add(String(code));
      mergedMap[key].invoice_value += Number(
        item.invoice_value ?? item.netValue ?? 0,
      );
      mergedMap[key].invoice_qty += Number(
        item.invoice_qty ?? item.quantity ?? 0,
      );
      mergedMap[key].itens_qty += Number(
        item.itens_qty ?? item.quantityPiece ?? 0,
      );
    });

    const groups = Object.values(mergedMap)
      .map((m) => {
        const totalValue = m.invoice_value;
        const saidaCount = m.invoice_qty;
        const saidaQuantity = m.itens_qty;
        const ticketMedio = saidaCount > 0 ? totalValue / saidaCount : 0;
        const pa = saidaCount > 0 ? saidaQuantity / saidaCount : 0;
        const firstCode = [...m.codes][0];

        return {
          grupoKey: firstCode,
          branchCode: firstCode,
          branchCodes: m.codes,
          branchName: m.name,
          totalValue,
          saidaValue: totalValue,
          entradaValue: 0,
          saidaCount,
          saidaQuantity,
          entradaQuantity: 0,
          ticketMedio,
          pa,
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue);

    const grandTotal = groups.reduce(
      (acc, g) => {
        acc.totalValue += g.totalValue;
        acc.saidaValue += g.saidaValue;
        acc.entradaValue += g.entradaValue;
        acc.saidaCount += g.saidaCount;
        acc.saidaQuantity += g.saidaQuantity;
        return acc;
      },
      {
        totalValue: 0,
        saidaValue: 0,
        entradaValue: 0,
        saidaCount: 0,
        saidaQuantity: 0,
      },
    );
    grandTotal.ticketMedio =
      grandTotal.saidaCount > 0
        ? grandTotal.totalValue / grandTotal.saidaCount
        : 0;
    grandTotal.pa =
      grandTotal.saidaCount > 0
        ? grandTotal.saidaQuantity / grandTotal.saidaCount
        : 0;

    return { grouped: groups, grandTotal };
  }, [branchTotals, branchNames, branchGroupMap]);

  // ==========================================
  // FILTRO: Franquia / Filial
  // ==========================================
  const filteredGrouped = useMemo(() => {
    if (filterType === 'todas') return grouped;
    if (filterType === 'franquia') {
      return grouped.filter((g) =>
        g.branchName.toUpperCase().includes('FRANQUIA'),
      );
    }
    if (filterType === 'filial') {
      const EXCLUIR_FILIAL = new Set([98, 980]);
      return grouped.filter((g) => {
        const name = g.branchName.toUpperCase();
        if (!name.includes('CROSBY') || name.includes('FRANQUIA')) return false;
        const codes = [...(g.branchCodes || [])];
        return !codes.every((c) => EXCLUIR_FILIAL.has(Number(c)));
      });
    }
    return grouped;
  }, [grouped, filterType]);

  // ==========================================
  // TOTAIS: Calculados a partir do filtro de tipo
  // ==========================================
  const filteredTotal = useMemo(() => {
    let saidaValue = 0,
      entradaValue = 0,
      saidaCount = 0,
      saidaQuantity = 0;
    filteredGrouped.forEach((g) => {
      saidaValue += g.saidaValue;
      entradaValue += g.entradaValue;
      saidaCount += g.saidaCount;
      saidaQuantity += g.saidaQuantity;
    });
    const totalValue = saidaValue - entradaValue;
    const ticketMedio = saidaCount > 0 ? totalValue / saidaCount : 0;
    const pa = saidaCount > 0 ? saidaQuantity / saidaCount : 0;
    return { totalValue, ticketMedio, pa, saidaCount };
  }, [filteredGrouped]);

  // ==========================================
  // HELPERS UI
  // ==========================================

  // Ícone de posição: bolinha azul com número branco
  const getPositionBadge = (position) => (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#000638] text-white text-xs font-bold">
      {position + 1}
    </span>
  );

  const top1 = filteredGrouped.length > 0 ? filteredGrouped[0] : null;

  // ==========================================
  // RENDER
  // ==========================================
  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2 sm:px-4 font-barlow">
      {/* Page Title */}
      <PageTitle
        title="Ranking de Faturamento"
        subtitle="Acompanhe o desempenho das lojas em tempo real"
        icon={Trophy}
        iconColor="text-yellow-600"
      />

      {/* Filtros */}
      <div className="flex flex-col bg-white p-3 sm:p-4 rounded-xl shadow-md w-full mx-auto border border-[#000638]/10 mb-4">
        <span className="text-sm sm:text-base font-bold text-[#000638] flex items-center gap-1.5 mb-0.5 font-barlow">
          <Funnel size={16} weight="bold" />
          Filtros
        </span>
        <span className="text-xs text-gray-500 mb-3 font-barlow">
          Selecione o período para gerar o ranking
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
          <div>
            <label className="block text-xs font-semibold mb-0.5 text-[#000638] font-barlow">
              Data Início
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-[#000638]/30 rounded-lg px-2.5 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs font-barlow"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-0.5 text-[#000638] font-barlow">
              Data Fim
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-[#000638]/30 rounded-lg px-2.5 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs font-barlow"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSearch}
              disabled={loading}
              className="flex items-center justify-center gap-2 bg-[#000638] text-white px-4 py-2 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-bold shadow-md tracking-wide uppercase w-full sm:w-auto font-barlow"
            >
              {loading ? (
                <Spinner size={14} className="animate-spin" />
              ) : (
                <MagnifyingGlass size={14} weight="bold" />
              )}
              {loading ? 'Buscando...' : 'Buscar'}
            </button>
          </div>
        </div>

        {/* Filtro Franquia / Filial */}
        {grouped.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-100">
            <span className="text-xs font-semibold text-[#000638] mr-1 flex items-center gap-1 font-barlow">
              <Buildings size={14} weight="bold" />
              Tipo:
            </span>
            {[
              { key: 'todas', label: 'Todas' },
              { key: 'filial', label: 'Filial' },
              { key: 'franquia', label: 'Franquia' },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setFilterType(opt.key)}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all duration-150 font-barlow ${
                  filterType === opt.key
                    ? 'bg-[#000638] text-white shadow-md'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-xs sm:text-sm text-red-700 font-barlow">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16 sm:py-20 text-gray-400">
          <Spinner size={36} className="animate-spin mb-3" />
          <p className="text-sm font-medium font-barlow">
            Carregando dados das lojas...
          </p>
          <p className="text-xs text-gray-300 mt-1 font-barlow">
            Isso pode levar alguns segundos
          </p>
        </div>
      )}

      {/* DASHBOARD */}
      {!loading && filteredGrouped.length > 0 && (
        <>
          {/* Cards de Resumo */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 rounded-xl bg-white">
              <CardHeader className="pb-1 pt-2.5 px-2.5 sm:px-3">
                <div className="flex items-center gap-1.5">
                  <CurrencyDollar
                    size={14}
                    weight="bold"
                    className="text-green-600"
                  />
                  <CardTitle className="text-[10px] sm:text-xs font-bold text-green-700 font-barlow">
                    Faturamento Total
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-2.5 sm:px-3 pb-2.5">
                <div className="text-sm sm:text-base font-extrabold text-green-600 break-words font-barlow">
                  R$ {formatBRL(filteredTotal.totalValue)}
                </div>
                <CardDescription className="text-[10px] sm:text-xs text-gray-500 font-barlow hidden sm:block">
                  Saída - Entrada
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 rounded-xl bg-white">
              <CardHeader className="pb-1 pt-2.5 px-2.5 sm:px-3">
                <div className="flex items-center gap-1.5">
                  <ShoppingCart
                    size={14}
                    weight="bold"
                    className="text-blue-600"
                  />
                  <CardTitle className="text-[10px] sm:text-xs font-bold text-blue-700 font-barlow">
                    Ticket Médio
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-2.5 sm:px-3 pb-2.5">
                <div className="text-sm sm:text-base font-extrabold text-blue-600 break-words font-barlow">
                  R$ {formatBRL(filteredTotal.ticketMedio)}
                </div>
                <CardDescription className="text-[10px] sm:text-xs text-gray-500 font-barlow hidden sm:block">
                  Valor médio por venda
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 rounded-xl bg-white">
              <CardHeader className="pb-1 pt-2.5 px-2.5 sm:px-3">
                <div className="flex items-center gap-1.5">
                  <Tote size={14} weight="bold" className="text-purple-600" />
                  <CardTitle className="text-[10px] sm:text-xs font-bold text-purple-700 font-barlow">
                    PA
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-2.5 sm:px-3 pb-2.5">
                <div className="text-sm sm:text-base font-extrabold text-purple-600 break-words font-barlow">
                  {filteredTotal.pa.toFixed(2)}
                </div>
                <CardDescription className="text-[10px] sm:text-xs text-gray-500 font-barlow hidden sm:block">
                  Peças por atendimento
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 rounded-xl bg-white">
              <CardHeader className="pb-1 pt-2.5 px-2.5 sm:px-3">
                <div className="flex items-center gap-1.5">
                  <Buildings
                    size={14}
                    weight="bold"
                    className="text-[#000638]"
                  />
                  <CardTitle className="text-[10px] sm:text-xs font-bold text-[#000638] font-barlow">
                    Lojas
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-2.5 sm:px-3 pb-2.5">
                <div className="text-sm sm:text-base font-extrabold text-[#000638] break-words font-barlow">
                  {filteredGrouped.length}
                </div>
                <CardDescription className="text-[10px] sm:text-xs text-gray-500 font-barlow hidden sm:block">
                  {filteredTotal.saidaCount} vendas
                  {meta?.queryTime
                    ? ` | ${(meta.queryTime / 1000).toFixed(1)}s`
                    : ''}
                  {meta?.fromCache ? ' (cache)' : ''}
                </CardDescription>
              </CardContent>
            </Card>
          </div>

          {/* TOP 1 — Destaque */}
          {top1 && (
            <div className="relative mb-4 bg-gradient-to-r from-yellow-50 via-amber-50 to-yellow-50 border-2 border-yellow-300 rounded-xl shadow-lg p-3 sm:p-4 overflow-hidden">
              <div className="absolute top-0 right-0 w-24 sm:w-32 h-24 sm:h-32 opacity-5 pointer-events-none">
                <Trophy size={128} weight="fill" />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="flex-shrink-0 w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-md">
                    <Trophy
                      size={20}
                      weight="fill"
                      className="text-white sm:hidden"
                    />
                    <Trophy
                      size={28}
                      weight="fill"
                      className="text-white hidden sm:block"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-yellow-700 bg-yellow-200 px-2 py-0.5 rounded-full font-barlow">
                      TOP 1
                    </span>
                    <h3 className="text-sm sm:text-lg font-bold text-[#000638] truncate mt-0.5 font-barlow">
                      {top1.branchName}
                    </h3>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto">
                  <div className="text-xs text-gray-600 font-barlow">
                    TM:{' '}
                    <strong className="text-blue-700">
                      R$ {formatBRL(top1.ticketMedio)}
                    </strong>
                  </div>
                  <div className="text-xs text-gray-600 font-barlow">
                    PA:{' '}
                    <strong className="text-purple-700">
                      {top1.pa.toFixed(2)}
                    </strong>
                  </div>
                  <div className="text-xs text-gray-600 font-barlow">
                    Vendas:{' '}
                    <strong className="text-gray-700">{top1.saidaCount}</strong>
                  </div>
                  <div className="sm:ml-2">
                    <p className="text-lg sm:text-2xl font-extrabold text-green-700 font-barlow">
                      R$ {formatBRL(top1.totalValue)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* RANKING */}
          <div className="bg-white rounded-xl shadow-md border border-[#000638]/10 w-full overflow-hidden">
            {/* Header */}
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-[#000638]/10 flex items-center gap-2">
              <ChartBar size={16} weight="bold" className="text-[#000638]" />
              <h2 className="text-xs sm:text-sm font-bold text-[#000638] font-barlow">
                Ranking por Loja
              </h2>
              <span className="ml-auto text-[10px] sm:text-xs text-gray-400 font-barlow hidden sm:inline">
                Clique para ver detalhes
              </span>
            </div>

            {/* Desktop table header */}
            <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2 bg-[#000638] text-white text-[10px] font-bold uppercase tracking-wider font-barlow">
              <div className="col-span-1 text-center">#</div>
              <div className="col-span-4">Loja</div>
              <div className="col-span-2 text-right">Faturamento</div>
              <div className="col-span-2 text-right">Ticket Médio</div>
              <div className="col-span-1 text-right">PA</div>
              <div className="col-span-2 text-right">Vendas</div>
            </div>

            {/* Rows */}
            {filteredGrouped.map((group, index) => (
              <div
                key={group.grupoKey}
                className={`w-full transition-all duration-150 border-b border-gray-100 last:border-b-0 ${
                  index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                }`}
              >
                {/* Mobile card layout */}
                <div className="md:hidden p-3 flex items-start gap-2.5">
                  <div className="flex-shrink-0 mt-0.5">
                    {getPositionBadge(index)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-xs font-semibold truncate font-barlow ${index < 3 ? 'text-[#000638]' : 'text-gray-700'}`}
                    >
                      {group.branchName}
                    </p>
                    <p
                      className={`text-sm font-bold font-mono mt-0.5 ${group.totalValue >= 0 ? 'text-green-700' : 'text-red-600'}`}
                    >
                      R$ {formatBRL(group.totalValue)}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-gray-500 font-barlow">
                      <span>
                        TM:{' '}
                        <strong className="text-blue-700">
                          R$ {formatBRL(group.ticketMedio)}
                        </strong>
                      </span>
                      <span>
                        PA:{' '}
                        <strong className="text-purple-700">
                          {group.pa.toFixed(1)}
                        </strong>
                      </span>
                      <span>
                        Vendas:{' '}
                        <strong className="text-gray-700">
                          {group.saidaCount}
                        </strong>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Desktop row layout */}
                <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-sm">
                  <div className="col-span-1 text-center">
                    {getPositionBadge(index)}
                  </div>
                  <div className="col-span-4 text-left truncate">
                    <span
                      className={`font-semibold font-barlow ${index < 3 ? 'text-[#000638]' : 'text-gray-700'}`}
                    >
                      {group.branchName}
                    </span>
                  </div>
                  <div className="col-span-2 text-right">
                    <span
                      className={`font-bold font-mono text-xs ${group.totalValue >= 0 ? 'text-green-700' : 'text-red-600'}`}
                    >
                      R$ {formatBRL(group.totalValue)}
                    </span>
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-blue-700 font-mono font-medium text-xs">
                      R$ {formatBRL(group.ticketMedio)}
                    </span>
                  </div>
                  <div className="col-span-1 text-right">
                    <span className="text-purple-700 font-mono font-medium text-xs">
                      {group.pa.toFixed(1)}
                    </span>
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-gray-600 font-mono text-xs">
                      {group.saidaCount}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && branchTotals.length === 0 && !error && (
        <div className="text-center py-16 sm:py-20 text-gray-400">
          <Trophy
            size={48}
            weight="light"
            className="mx-auto mb-3 opacity-30"
          />
          <p className="text-xs sm:text-sm font-medium font-barlow">
            Selecione o período e clique em Buscar para gerar o ranking.
          </p>
        </div>
      )}
    </div>
  );
};

export default RankingFaturamento;
