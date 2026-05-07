import React, { useEffect, useState, useMemo } from 'react';
import {
  ArrowRight,
  Buildings,
  CreditCard,
  MagnifyingGlass,
  Spinner,
  Storefront,
  Wallet,
  WarningCircle,
  CaretDown,
  CaretUp,
} from '@phosphor-icons/react';

const LOCAL_API_BASE_URL = 'http://localhost:4000';
const REMOTE_API_BASE_URL = 'https://apigestaocrosby-bw2v.onrender.com';

const API_BASE_CANDIDATES = import.meta.env.VITE_API_URL
  ? [import.meta.env.VITE_API_URL]
  : window.location.hostname === 'localhost'
    ? [LOCAL_API_BASE_URL, REMOTE_API_BASE_URL]
    : [REMOTE_API_BASE_URL, LOCAL_API_BASE_URL];

const buildUrl = (baseUrl, path) => `${baseUrl}${path}`;

const fetchWithFallback = async (path, options = {}) => {
  let lastError = null;
  let lastResponse = null;

  for (const baseUrl of API_BASE_CANDIDATES) {
    try {
      const response = await fetch(buildUrl(baseUrl, path), options);

      if (response.ok) {
        return response;
      }

      lastResponse = response;
      if ([400, 404, 502, 503, 504].includes(response.status)) {
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  if (lastError) throw lastError;
  throw new Error('Falha ao conectar na API');
};

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');

const isFantasyNameCrosbyFranquia = (fantasyName) => {
  if (!fantasyName) return false;
  return /^F\d+\s*-\s*CROSBY\b/i.test(String(fantasyName).trim());
};

const formatCurrency = (value) =>
  Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

const emptyBalance = {
  code: null,
  name: '',
  cpfCnpj: '',
  maxChangeFilterDate: null,
  values: [],
  totals: {
    limitValue: 0,
    openInvoiceValue: 0,
    refundCreditValue: 0,
    advanceAmountValue: 0,
    dofniValue: 0,
    dofniCheckValue: 0,
    transactionOutValue: 0,
    consignedValue: 0,
    invoicesBehindScheduleValue: 0,
    salesOrderAdvanceValue: 0,
  },
  balanceLimitValue: 0,
};

const DEFAULT_BRANCH_CODES = [
  1, 2, 5, 6, 11, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97,
  98, 99, 100, 101, 870, 880, 890, 900, 910, 920, 930, 940, 950, 960, 970, 980,
  990,
];

const CreditoFranquia = () => {
  const [clientes, setClientes] = useState([]);
  const [clientesFiltrados, setClientesFiltrados] = useState([]);
  const [busca, setBusca] = useState('');
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [saldo, setSaldo] = useState(emptyBalance);
  const [filiaisCodigos, setFiliaisCodigos] = useState([]);
  const [loadingClientes, setLoadingClientes] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingSaldo, setLoadingSaldo] = useState(false);
  const [erro, setErro] = useState('');
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  const filtrarClientes = (texto, listaBase = clientes) => {
    const termo = normalizeText(texto);
    const termoDigitos = normalizeDigits(texto);

    if (!termo && !termoDigitos) {
      return listaBase.slice(0, 20);
    }

    return listaBase
      .filter((cliente) => {
        const code = String(cliente.code || '');
        const name = normalizeText(cliente.name);
        const fantasyName = normalizeText(cliente.fantasyName);
        const cnpj = normalizeDigits(cliente.cnpj);

        return (
          code.includes(termoDigitos || termo) ||
          name.includes(termo) ||
          fantasyName.includes(termo) ||
          (termoDigitos.length > 0 && cnpj.includes(termoDigitos))
        );
      })
      .slice(0, 20);
  };

  const executarBusca = (texto = busca, listaBase = clientes) => {
    setSearchLoading(true);
    setErro('');

    setTimeout(() => {
      setClientesFiltrados(filtrarClientes(texto, listaBase));
      setSearchLoading(false);
    }, 120);
  };

  useEffect(() => {
    const carregarClientes = async () => {
      setLoadingClientes(true);
      setErro('');

      try {
        const response = await fetchWithFallback(
          '/api/totvs/franchise-clients',
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        const lista = Array.isArray(result?.data) ? result.data : [];
        const listaCrosby = lista.filter((cliente) =>
          isFantasyNameCrosbyFranquia(cliente?.fantasyName),
        );

        const listaOrdenada = [...listaCrosby].sort((a, b) => {
          const fantasyA = normalizeText(a.fantasyName || a.name);
          const fantasyB = normalizeText(b.fantasyName || b.name);
          return fantasyA.localeCompare(fantasyB, 'pt-BR');
        });

        setClientes(listaOrdenada);
        setClientesFiltrados(filtrarClientes('', listaOrdenada));
      } catch (error) {
        setErro('Erro ao carregar a lista de franquias');
      } finally {
        setLoadingClientes(false);
      }
    };

    carregarClientes();
  }, []);

  useEffect(() => {
    const carregarFiliais = async () => {
      try {
        const response = await fetchWithFallback('/api/totvs/branches');
        if (!response.ok) {
          setFiliaisCodigos(DEFAULT_BRANCH_CODES);
          return;
        }

        const result = await response.json();
        let empresasArray = [];

        if (result?.success && result?.data) {
          if (Array.isArray(result.data.data)) {
            empresasArray = result.data.data;
          } else if (Array.isArray(result.data)) {
            empresasArray = result.data;
          }
        } else if (Array.isArray(result)) {
          empresasArray = result;
        }

        const codigos = empresasArray
          .map((branch) => parseInt(branch.cd_empresa, 10))
          .filter((code) => !Number.isNaN(code) && code > 0);

        setFiliaisCodigos(codigos.length > 0 ? codigos : DEFAULT_BRANCH_CODES);
      } catch (error) {
        setFiliaisCodigos(DEFAULT_BRANCH_CODES);
      }
    };

    carregarFiliais();
  }, []);

  const consultarSaldo = async (cliente) => {
    setClienteSelecionado(cliente);
    setLoadingSaldo(true);
    setErro('');
    setSortField(null);

    try {
      const response = await fetchWithFallback(
        '/api/totvs/franchise-financial-balance',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerCodeList: [cliente.code],
            branchCodeList:
              filiaisCodigos.length > 0 ? filiaisCodigos : DEFAULT_BRANCH_CODES,
            pageSize: 200,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      const item = result?.data?.items?.[0];

      if (!item) {
        setSaldo({
          ...emptyBalance,
          code: cliente.code,
          name: cliente.name || '',
          cpfCnpj: cliente.cnpj || '',
        });
        return;
      }

      setSaldo({
        ...emptyBalance,
        ...item,
        cpfCnpj: item.cpfCnpj || cliente.cnpj || '',
        balanceLimitValue:
          Number(item.balanceLimitValue || 0) ||
          Number(item?.totals?.limitValue || 0) -
            Number(item?.totals?.openInvoiceValue || 0),
      });
    } catch (error) {
      setErro('Erro ao consultar o saldo financeiro do cliente');
      setSaldo(emptyBalance);
    } finally {
      setLoadingSaldo(false);
    }
  };

  const totais = saldo?.totals || emptyBalance.totals;

  const filiaisComValor = useMemo(() => {
    const filtered = (saldo.values || []).filter(
      (v) =>
        Number(v.refundCreditValue || 0) !== 0 ||
        Number(v.advanceAmountValue || 0) !== 0,
    );

    if (!sortField) return filtered;

    return [...filtered].sort((a, b) => {
      const va = Number(a[sortField] || 0);
      const vb = Number(b[sortField] || 0);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [saldo.values, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field)
      return <CaretDown size={12} className="ml-1 opacity-30" />;
    return sortDir === 'asc' ? (
      <CaretUp size={12} className="ml-1" />
    ) : (
      <CaretDown size={12} className="ml-1" />
    );
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#000638]">
          <Wallet size={20} weight="fill" className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#000638]">
            Crédito Franquia
          </h1>
          <p className="text-sm text-gray-500">
            Consulte CREDEV e Adiantamento das franquias CROSBY
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
        {/* Sidebar - Lista de Franquias */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Search */}
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <input
                type="text"
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    executarBusca();
                  }
                }}
                placeholder="Buscar por nome, CNPJ ou código..."
                className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-700 outline-none transition-all placeholder:text-gray-400 focus:bg-white focus:border-[#000638] focus:ring-2 focus:ring-[#000638]/10"
              />
              <button
                type="button"
                onClick={() => executarBusca()}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#000638] transition-colors"
              >
                {searchLoading ? (
                  <Spinner size={16} className="animate-spin" />
                ) : (
                  <MagnifyingGlass size={16} weight="bold" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between mt-2.5 text-[11px] text-gray-400 font-medium uppercase tracking-wider">
              <span>
                {loadingClientes
                  ? 'Carregando...'
                  : `${clientes.length} franquias`}
              </span>
              <span>{clientesFiltrados.length} resultado(s)</span>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[560px] overflow-y-auto">
            {loadingClientes ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
                <Spinner size={28} className="animate-spin" />
                <span className="text-xs font-medium">
                  Carregando franquias...
                </span>
              </div>
            ) : clientesFiltrados.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
                <Storefront size={32} weight="light" />
                <span className="text-sm">Nenhuma franquia encontrada</span>
              </div>
            ) : (
              clientesFiltrados.map((cliente) => {
                const selecionado = clienteSelecionado?.code === cliente.code;
                const isLoading = selecionado && loadingSaldo;

                return (
                  <button
                    key={cliente.code}
                    type="button"
                    onClick={() => consultarSaldo(cliente)}
                    disabled={isLoading}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-all duration-150 group ${
                      selecionado
                        ? 'bg-[#000638] text-white'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm font-semibold truncate ${selecionado ? 'text-white' : 'text-gray-800'}`}
                        >
                          {cliente.fantasyName || cliente.name || 'Sem nome'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className={`text-xs font-mono ${selecionado ? 'text-blue-200' : 'text-gray-400'}`}
                          >
                            #{cliente.code}
                          </span>
                          <span
                            className={`text-xs ${selecionado ? 'text-gray-300' : 'text-gray-400'}`}
                          >
                            •
                          </span>
                          <span
                            className={`text-xs truncate ${selecionado ? 'text-gray-300' : 'text-gray-400'}`}
                          >
                            {cliente.cnpj || 'Sem CNPJ'}
                          </span>
                        </div>
                      </div>
                      {isLoading ? (
                        <Spinner
                          size={16}
                          className="animate-spin text-white shrink-0"
                        />
                      ) : (
                        <ArrowRight
                          size={14}
                          className={`shrink-0 transition-all ${selecionado ? 'text-white opacity-80' : 'text-gray-300 group-hover:text-[#000638] group-hover:translate-x-0.5'}`}
                        />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="space-y-5">
          {/* Empty State */}
          {!clienteSelecionado && !erro && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-50 mb-4">
                  <Storefront
                    size={32}
                    weight="light"
                    className="text-gray-300"
                  />
                </div>
                <h3 className="text-base font-semibold text-gray-700 mb-1">
                  Selecione uma franquia
                </h3>
                <p className="text-sm text-gray-400 max-w-sm">
                  Escolha uma franquia na lista ao lado para consultar os
                  valores de CREDEV e Adiantamento.
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {erro && (
            <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
              <WarningCircle
                size={18}
                weight="fill"
                className="text-red-500 shrink-0"
              />
              <p className="text-sm text-red-700 font-medium">{erro}</p>
            </div>
          )}

          {/* Loading State */}
          {loadingSaldo && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="relative">
                  <div className="w-12 h-12 rounded-full border-4 border-gray-100 border-t-[#000638] animate-spin" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-700">
                    Consultando TOTVS...
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Buscando saldo de{' '}
                    {clienteSelecionado?.fantasyName || 'cliente'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Results */}
          {clienteSelecionado && !loadingSaldo && (
            <>
              {/* Client Header Bar */}
              <div className="bg-[#000638] rounded-xl px-5 py-4 flex items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 shrink-0">
                    <Buildings size={18} weight="fill" className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-semibold text-sm truncate">
                      {clienteSelecionado.fantasyName ||
                        clienteSelecionado.name}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-blue-200 text-xs font-mono">
                        #{clienteSelecionado.code}
                      </span>
                      <span className="text-gray-400 text-xs">
                        {saldo.cpfCnpj || clienteSelecionado.cnpj || ''}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* CREDEV Card */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 -mr-6 -mt-6 rounded-full bg-emerald-50 opacity-60" />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50">
                        <Wallet
                          size={16}
                          weight="fill"
                          className="text-emerald-600"
                        />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        CREDEV
                      </span>
                    </div>
                    <p className="text-2xl font-bold text-emerald-600 mt-3 tracking-tight">
                      {formatCurrency(totais.refundCreditValue || 0)}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Crédito devolvido consolidado
                    </p>
                  </div>
                </div>

                {/* Adiantamento Card */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 -mr-6 -mt-6 rounded-full bg-amber-50 opacity-60" />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-50">
                        <CreditCard
                          size={16}
                          weight="fill"
                          className="text-amber-600"
                        />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Adiantamento
                      </span>
                    </div>
                    <p className="text-2xl font-bold text-amber-600 mt-3 tracking-tight">
                      {formatCurrency(totais.advanceAmountValue || 0)}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Valor de adiantamento consolidado
                    </p>
                  </div>
                </div>
              </div>

              {/* Branch Detail Table */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-[#000638]">
                      Detalhamento por Filial
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Filiais com valores de CREDEV ou Adiantamento
                    </p>
                  </div>
                  {filiaisComValor.length > 0 && (
                    <span className="inline-flex items-center rounded-full bg-[#000638] px-2.5 py-1 text-[10px] font-bold text-white tracking-wide">
                      {filiaisComValor.length}{' '}
                      {filiaisComValor.length === 1 ? 'filial' : 'filiais'}
                    </span>
                  )}
                </div>

                {filiaisComValor.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-[#000638]">
                          <th className="py-2.5 px-5 text-left text-[10px] font-bold uppercase tracking-wider text-white">
                            Filial
                          </th>
                          <th
                            className="py-2.5 px-5 text-right text-[10px] font-bold uppercase tracking-wider text-white cursor-pointer select-none hover:text-blue-200 transition-colors"
                            onClick={() => handleSort('refundCreditValue')}
                          >
                            <span className="inline-flex items-center">
                              CREDEV
                              <SortIcon field="refundCreditValue" />
                            </span>
                          </th>
                          <th
                            className="py-2.5 px-5 text-right text-[10px] font-bold uppercase tracking-wider text-white cursor-pointer select-none hover:text-blue-200 transition-colors"
                            onClick={() => handleSort('advanceAmountValue')}
                          >
                            <span className="inline-flex items-center">
                              Adiantamento
                              <SortIcon field="advanceAmountValue" />
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filiaisComValor.map((value, idx) => (
                          <tr
                            key={`${saldo.code}-${value.branchCode}`}
                            className={`transition-colors hover:bg-blue-50/40 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                          >
                            <td className="py-2.5 px-5 text-sm font-semibold text-[#000638]">
                              {value.branchCode}
                            </td>
                            <td className="py-2.5 px-5 text-right text-sm tabular-nums">
                              <span
                                className={
                                  Number(value.refundCreditValue || 0) !== 0
                                    ? 'font-semibold text-emerald-600'
                                    : 'text-gray-300'
                                }
                              >
                                {formatCurrency(value.refundCreditValue)}
                              </span>
                            </td>
                            <td className="py-2.5 px-5 text-right text-sm tabular-nums">
                              <span
                                className={
                                  Number(value.advanceAmountValue || 0) !== 0
                                    ? 'font-semibold text-amber-600'
                                    : 'text-gray-300'
                                }
                              >
                                {formatCurrency(value.advanceAmountValue)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {/* Totals Row */}
                      <tfoot>
                        <tr className="border-t-2 border-[#000638] bg-gray-50">
                          <td className="py-3 px-5 text-xs font-bold uppercase tracking-wider text-[#000638]">
                            Total
                          </td>
                          <td className="py-3 px-5 text-right text-sm font-bold text-emerald-700 tabular-nums">
                            {formatCurrency(totais.refundCreditValue || 0)}
                          </td>
                          <td className="py-3 px-5 text-right text-sm font-bold text-amber-700 tabular-nums">
                            {formatCurrency(totais.advanceAmountValue || 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-14 text-gray-400 gap-2">
                    <Wallet size={28} weight="light" />
                    <span className="text-sm">
                      Nenhuma filial com CREDEV ou Adiantamento
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreditoFranquia;
