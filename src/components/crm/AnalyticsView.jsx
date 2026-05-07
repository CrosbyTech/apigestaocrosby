import React, { useEffect, useMemo, useState } from 'react';
import {
  MapPin,
  CurrencyDollar,
  Users,
  UserPlus,
  ShoppingCart,
  X,
  MagnifyingGlass,
  Spinner,
  CaretRight,
  TrendUp,
  TrendDown,
} from '@phosphor-icons/react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
  Cell,
} from 'recharts';
import { API_BASE_URL } from '../../config/constants';

const API_KEY = import.meta.env.VITE_API_KEY || '';

function fmtMoeda(v) {
  return (v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
function fmtNum(v) {
  return (v || 0).toLocaleString('pt-BR');
}

// Modal: clientes de um estado + gráfico de vendedores
function EstadoClientesModal({ estado, onClose }) {
  const [busca, setBusca] = useState('');
  const [sellerFilter, setSellerFilter] = useState(null); // { seller_code, seller_name }
  const [periodTab, setPeriodTab] = useState('atual'); // 'atual' | 'ly'
  // Reseta filtros quando troca de estado
  useEffect(() => {
    setBusca('');
    setSellerFilter(null);
    // Auto-troca pra LY se atual está vazio mas LY tem dados
    if (
      estado &&
      (!estado.all_customers || estado.all_customers.length === 0) &&
      Array.isArray(estado.all_customers_ly) &&
      estado.all_customers_ly.length > 0
    ) {
      setPeriodTab('ly');
    } else {
      setPeriodTab('atual');
    }
  }, [estado?.uf]);
  if (!estado) return null;
  const filtrados = useMemo(() => {
    const sourceArr =
      periodTab === 'ly' ? estado?.all_customers_ly : estado?.all_customers;
    if (!Array.isArray(sourceArr)) return [];
    const q = busca.trim().toUpperCase();
    return sourceArr.filter((c) => {
      // Filtro por vendedor (clicado no gráfico)
      if (sellerFilter) {
        const matchesSeller =
          (sellerFilter.seller_code != null &&
            c.seller_code === sellerFilter.seller_code) ||
          (c.seller_name &&
            sellerFilter.seller_name &&
            c.seller_name === sellerFilter.seller_name);
        if (!matchesSeller) return false;
      }
      if (!q) return true;
      return (
        (c.person_name || '').toUpperCase().includes(q) ||
        String(c.person_code).includes(q) ||
        (c.cidade || '').toUpperCase().includes(q) ||
        (c.seller_name || '').toUpperCase().includes(q)
      );
    });
  }, [estado, busca, sellerFilter]);
  const totalFiltrado = filtrados.reduce((s, c) => s + (c.value || 0), 0);
  const bySellerChart = (estado.by_seller || []).slice(0, 10);
  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-br from-indigo-50 to-blue-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center font-extrabold text-lg">
              {estado.uf}
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#000638]">
                Clientes em {estado.uf}
              </h3>
              <p className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap">
                <span>
                  <span className="font-semibold text-gray-700">Atual:</span>{' '}
                  {estado.customers_count} clientes ·{' '}
                  {fmtMoeda(estado.invoice_value)} ·{' '}
                  {fmtNum(estado.invoice_qty)} NFs
                </span>
                {estado.customers_count_ly > 0 && (
                  <span className="text-gray-400">
                    <span className="font-semibold">LY:</span>{' '}
                    {estado.customers_count_ly} clientes ·{' '}
                    {fmtMoeda(estado.invoice_value_ly)}
                  </span>
                )}
                {estado.aberturas > 0 && (
                  <span className="inline-flex items-center gap-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded">
                    {estado.aberturas} aberturas
                  </span>
                )}
                {estado.reativacoes > 0 && (
                  <span className="inline-flex items-center gap-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded">
                    {estado.reativacoes} reativações
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-indigo-100 rounded-lg"
          >
            <X size={16} className="text-indigo-700" />
          </button>
        </div>
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          {/* Tabs Atual / Ano Passado */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setPeriodTab('atual')}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-md transition ${
                periodTab === 'atual'
                  ? 'bg-white text-[#000638] shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Período atual
              <span className="ml-1 opacity-70">
                ({estado.customers_count})
              </span>
            </button>
            <button
              onClick={() => setPeriodTab('ly')}
              disabled={(estado.customers_count_ly || 0) === 0}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-md transition ${
                periodTab === 'ly'
                  ? 'bg-white text-amber-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              Ano passado
              <span className="ml-1 opacity-70">
                ({estado.customers_count_ly || 0})
              </span>
            </button>
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlass
              size={12}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente, código, cidade ou vendedor..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#000638]"
            />
          </div>
          {sellerFilter && (
            <button
              type="button"
              onClick={() => setSellerFilter(null)}
              className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 text-[11px] font-bold px-2 py-1.5 rounded-lg transition"
              title="Limpar filtro"
            >
              <span className="uppercase tracking-wide">Vendedor:</span>
              <span>{sellerFilter.seller_name}</span>
              <X size={11} weight="bold" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2 text-gray-500 font-semibold w-[40px]">
                  #
                </th>
                <th className="text-left px-3 py-2 text-gray-500 font-semibold">
                  Cliente
                </th>
                <th className="text-left px-3 py-2 text-gray-500 font-semibold">
                  Cidade
                </th>
                <th className="text-left px-3 py-2 text-gray-500 font-semibold">
                  Vendedor
                </th>
                <th className="text-right px-3 py-2 text-gray-500 font-semibold">
                  NFs
                </th>
                <th className="text-right px-3 py-2 text-gray-500 font-semibold">
                  Faturamento
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center">
                    {estado.customers_count_ly > 0 ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="text-rose-600 text-3xl">📉</div>
                        <p className="text-sm font-bold text-gray-700">
                          Sem vendas no período atual em {estado.uf}
                        </p>
                        <p className="text-xs text-gray-500 max-w-md">
                          No <span className="font-semibold">ano passado</span>{' '}
                          essa UF tinha{' '}
                          <span className="font-bold text-amber-700">
                            {estado.customers_count_ly} clientes
                          </span>{' '}
                          com faturamento de{' '}
                          <span className="font-bold text-amber-700">
                            {fmtMoeda(estado.invoice_value_ly)}
                          </span>{' '}
                          em{' '}
                          <span className="font-bold">
                            {fmtNum(estado.invoice_qty_ly)} NFs
                          </span>
                          .
                        </p>
                        <p className="text-[10px] text-gray-400">
                          Toda essa receita foi perdida no período atual (
                          <span className="text-rose-700 font-bold">
                            -100% crescimento
                          </span>
                          ).
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 py-4">
                        <p className="text-sm text-gray-500">
                          Sem vendas em {estado.uf} no período atual nem no ano
                          passado.
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              )}
              {filtrados.map((c, i) => (
                <tr key={c.person_code || i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-400 font-mono">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-semibold text-gray-800 truncate max-w-[200px]">
                        {c.person_name}
                      </span>
                      {c.client_type === 'abertura' && (
                        <span
                          className="inline-block bg-emerald-50 text-emerald-700 border border-emerald-200 text-[8px] font-bold uppercase px-1 py-0.5 rounded"
                          title="Primeira compra na vida no período"
                        >
                          Abertura
                        </span>
                      )}
                      {c.client_type === 'reativacao' && (
                        <span
                          className="inline-block bg-amber-50 text-amber-700 border border-amber-200 text-[8px] font-bold uppercase px-1 py-0.5 rounded"
                          title={
                            c.last_purchase_before
                              ? `Última compra anterior: ${c.last_purchase_before}`
                              : 'Reativação no período'
                          }
                        >
                          Reativação
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      #{c.person_code}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{c.cidade || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 truncate max-w-[150px]">
                    {c.seller_name || '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {fmtNum(c.qty)}
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-emerald-600">
                    {fmtMoeda(c.value)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200 sticky bottom-0 z-10">
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-2 text-right font-bold text-gray-700"
                >
                  TOTAL ({filtrados.length} clientes)
                </td>
                <td className="px-3 py-2 text-right font-bold text-[#000638]">
                  {fmtMoeda(totalFiltrado)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Gráfico: faturamento por vendedor neste estado (clicar filtra a tabela) */}
          {bySellerChart.length > 0 && (
            <div className="border-t border-gray-200 px-4 py-3 bg-gray-50">
              <h4 className="text-[11px] font-bold text-[#000638] uppercase tracking-wide mb-2 flex items-center gap-1">
                <TrendUp size={12} className="text-indigo-600" />
                Faturamento por vendedor em {estado.uf}
                <span className="ml-auto text-[10px] text-gray-400 font-normal normal-case tracking-normal">
                  Clique numa barra pra filtrar a tabela
                </span>
              </h4>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={bySellerChart}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#6b7280' }}
                      tickFormatter={(v) =>
                        v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                      }
                    />
                    <YAxis
                      type="category"
                      dataKey="seller_name"
                      tick={{ fontSize: 10, fill: '#374151' }}
                      width={80}
                    />
                    <Tooltip
                      formatter={(v) => fmtMoeda(v)}
                      contentStyle={{
                        background: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      cursor={{ fill: 'rgba(99, 102, 241, 0.08)' }}
                    />
                    <Bar
                      dataKey="invoice_value"
                      name="Faturamento"
                      radius={[0, 4, 4, 0]}
                      style={{ cursor: 'pointer' }}
                      onClick={(data) => {
                        if (!data) return;
                        const sc = data.seller_code;
                        const sn = data.seller_name;
                        if (sellerFilter && sellerFilter.seller_code === sc) {
                          setSellerFilter(null);
                        } else {
                          setSellerFilter({ seller_code: sc, seller_name: sn });
                        }
                      }}
                    >
                      {bySellerChart.map((s) => (
                        <Cell
                          key={s.seller_code}
                          onClick={() => {
                            if (
                              sellerFilter &&
                              sellerFilter.seller_code === s.seller_code
                            ) {
                              setSellerFilter(null);
                            } else {
                              setSellerFilter({
                                seller_code: s.seller_code,
                                seller_name: s.seller_name,
                              });
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                          fill={
                            sellerFilter &&
                            sellerFilter.seller_code === s.seller_code
                              ? '#4338ca'
                              : sellerFilter
                                ? '#c7d2fe'
                                : '#6366f1'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Botões clicáveis (fallback garantido) */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {bySellerChart.map((s) => {
                  const active =
                    sellerFilter && sellerFilter.seller_code === s.seller_code;
                  return (
                    <button
                      key={s.seller_code}
                      type="button"
                      onClick={() => {
                        if (active) setSellerFilter(null);
                        else
                          setSellerFilter({
                            seller_code: s.seller_code,
                            seller_name: s.seller_name,
                          });
                      }}
                      className={`text-[10px] font-bold px-2 py-1 rounded border transition ${
                        active
                          ? 'bg-indigo-600 text-white border-indigo-700'
                          : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                      }`}
                    >
                      {s.seller_name} · {fmtMoeda(s.invoice_value)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const MODULO_LABEL = {
  varejo: 'Varejo',
  revenda: 'Revenda',
  multimarcas: 'Multimarcas',
  inbound_david: 'MTM Inbound David',
  inbound_rafael: 'MTM Inbound Rafael',
};
const SUPORTADOS = ['varejo', 'revenda', 'multimarcas', 'inbound_david', 'inbound_rafael'];

export default function AnalyticsView({
  dataInicio,
  dataFim,
  modulo = 'revenda',
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [estadoSel, setEstadoSel] = useState(null);
  const [kpiSel, setKpiSel] = useState(null); // 'faturamento' | 'nfs' | 'clientes' | 'aberturas' | 'estados'
  const [tableFilter, setTableFilter] = useState('todos'); // 'todos' | 'comVenda' | 'queda'
  const [sortField, setSortField] = useState('invoice_value');
  const [sortDir, setSortDir] = useState('desc');
  const moduloAtivo = SUPORTADOS.includes(modulo) ? modulo : 'revenda';
  const moduloLabel = MODULO_LABEL[moduloAtivo] || moduloAtivo;

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    let rows = [...data.rows];
    if (tableFilter === 'comVenda') {
      rows = rows.filter((r) => r.invoice_value > 0);
    } else if (tableFilter === 'queda') {
      rows = rows.filter((r) => r.growth_pct != null && r.growth_pct < 0);
    }
    rows.sort((a, b) => {
      let va = a[sortField];
      let vb = b[sortField];
      if (va == null) va = -Infinity;
      if (vb == null) vb = -Infinity;
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return rows;
  }, [data, tableFilter, sortField, sortDir]);

  useEffect(() => {
    if (!dataInicio || !dataFim) return;
    setLoading(true);
    setErro('');
    setEstadoSel(null);
    fetch(`${API_BASE_URL}/api/crm/analytics-por-estado`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify({
        datemin: dataInicio,
        datemax: dataFim,
        modulo: moduloAtivo,
      }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.success === false) {
          setErro(j.message || 'Erro ao carregar analytics');
          setData(null);
        } else setData(j.data || j);
      })
      .catch((e) => setErro(e.message || 'Erro ao carregar analytics'))
      .finally(() => setLoading(false));
  }, [dataInicio, dataFim, moduloAtivo]);

  if (!SUPORTADOS.includes(modulo)) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <MapPin size={40} className="mx-auto text-gray-300 mb-2" />
        <p className="text-sm text-gray-700 font-medium">
          Analytics não disponível para o módulo "{modulo}"
        </p>
        <p className="text-[11px] text-gray-500 mt-1">
          Selecione Varejo, Revenda ou Multimarcas no topo da página.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Breakdown TOTVS direto (Bruto - Devolução = Líquido) */}
      {!loading &&
        data?.source === 'totvs+supabase' &&
        data?.total_value_gross != null && (
          <div className="bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-xl p-3 flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 bg-emerald-500 text-white font-bold px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider">
              ⚡ TOTVS Direto
            </span>
            <span className="text-gray-600">
              <span className="font-semibold">Bruto:</span>{' '}
              <span className="font-mono text-gray-900">
                {fmtMoeda(data.total_value_gross)}
              </span>
            </span>
            <span className="text-gray-400">−</span>
            <span className="text-gray-600">
              <span className="font-semibold">Devolução:</span>{' '}
              <span className="font-mono text-rose-700">
                {fmtMoeda(data.total_devolucao || 0)}
              </span>
            </span>
            <span className="text-gray-400">=</span>
            <span className="text-gray-700">
              <span className="font-bold uppercase text-[10px] tracking-wider">
                Líquido
              </span>{' '}
              <span className="font-mono font-bold text-emerald-700 text-sm">
                {fmtMoeda(data.total_value)}
              </span>
            </span>
            {data.total_value_supabase != null &&
              Math.abs(data.total_value - data.total_value_supabase) > 100 && (
                <span className="ml-auto text-[10px] text-gray-500 italic">
                  Supabase (com sync gap): {fmtMoeda(data.total_value_supabase)}
                </span>
              )}
          </div>
        )}

      {/* KPIs resumo + comparativo ano passado */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Faturamento total"
          valor={loading ? '...' : fmtMoeda(data?.total_value)}
          subValor={
            data?.total_value_ly != null
              ? `LY: ${fmtMoeda(data.total_value_ly)}`
              : null
          }
          growthPct={data?.total_growth_pct}
          icone={CurrencyDollar}
          color="green"
          loading={loading}
          onClick={data ? () => setKpiSel('faturamento') : null}
        />
        <KpiCard
          label="NFs emitidas"
          valor={loading ? '...' : fmtNum(data?.total_qty)}
          subValor={
            data?.total_qty_ly != null
              ? `LY: ${fmtNum(data.total_qty_ly)}`
              : null
          }
          icone={ShoppingCart}
          color="indigo"
          loading={loading}
          onClick={data ? () => setKpiSel('nfs') : null}
        />
        <KpiCard
          label="Clientes únicos"
          valor={loading ? '...' : fmtNum(data?.total_clients)}
          subValor={
            data?.total_clients_ly != null
              ? `LY: ${fmtNum(data.total_clients_ly)}`
              : null
          }
          icone={Users}
          color="blue"
          loading={loading}
          onClick={data ? () => setKpiSel('clientes') : null}
        />
        <KpiCard
          label="Aberturas de cadastro"
          valor={loading ? '...' : fmtNum(data?.total_aberturas_cadastro)}
          subValor={
            data?.total_aberturas_cadastro_ly != null
              ? `LY: ${fmtNum(data.total_aberturas_cadastro_ly)}`
              : null
          }
          growthPct={
            data?.total_aberturas_cadastro_ly > 0
              ? ((data.total_aberturas_cadastro -
                  data.total_aberturas_cadastro_ly) /
                  data.total_aberturas_cadastro_ly) *
                100
              : null
          }
          icone={UserPlus}
          color="amber"
          loading={loading}
          onClick={data ? () => setKpiSel('aberturas') : null}
        />
        <KpiCard
          label="Reativações de cadastro"
          valor={loading ? '...' : fmtNum(data?.total_reativacoes_cadastro)}
          subValor={
            data?.total_reativacoes_cadastro_ly != null
              ? `LY: ${fmtNum(data.total_reativacoes_cadastro_ly)}`
              : null
          }
          icone={UserPlus}
          color="violet"
          loading={loading}
        />
        <KpiCard
          label="Estados (UFs)"
          valor={loading ? '...' : fmtNum(data?.states_count)}
          icone={MapPin}
          color="rose"
          loading={loading}
          onClick={data ? () => setKpiSel('estados') : null}
        />
      </div>

      {/* Gráfico comparativo Ano Atual vs Ano Passado */}
      {!loading && data?.rows && data.rows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-[#000638] to-[#1e1b4b] text-white flex items-center gap-2">
            <TrendUp size={16} />
            <h3 className="text-sm font-bold">
              Comparativo Ano Atual vs Ano Passado
            </h3>
            <span className="text-[10px] text-blue-200 italic">
              · clique nas barras para ver clientes
            </span>
            {data.total_growth_pct != null && (
              <span
                className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  data.total_growth_pct >= 0
                    ? 'bg-emerald-400/20 text-emerald-200'
                    : 'bg-rose-400/20 text-rose-200'
                }`}
              >
                Total: {data.total_growth_pct >= 0 ? '+' : ''}
                {data.total_growth_pct.toFixed(1)}%
              </span>
            )}
          </div>
          {/* Chart 1: Comparativo absoluto (barras horizontais agrupadas por UF) */}
          <div className="p-4" style={{ height: 480 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[...data.rows]
                  .sort(
                    (a, b) =>
                      Math.max(b.invoice_value, b.invoice_value_ly) -
                      Math.max(a.invoice_value, a.invoice_value_ly),
                  )
                  .slice(0, 12)}
                layout="vertical"
                margin={{ top: 5, right: 70, left: 0, bottom: 5 }}
                barCategoryGap="20%"
              >
                <CartesianGrid
                  horizontal={false}
                  strokeDasharray="3 3"
                  stroke="#f0f0f0"
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  tickFormatter={(v) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                  axisLine={{ stroke: '#e5e7eb' }}
                />
                <YAxis
                  type="category"
                  dataKey="uf"
                  tick={{ fontSize: 11, fill: '#374151', fontWeight: 700 }}
                  axisLine={{ stroke: '#e5e7eb' }}
                  width={48}
                />
                <Tooltip
                  formatter={(v, name) => [fmtMoeda(v), name]}
                  labelFormatter={(uf) => `Estado: ${uf}`}
                  cursor={{ fill: 'rgba(99, 102, 241, 0.05)' }}
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    fontSize: 12,
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  iconType="circle"
                />
                <Bar
                  dataKey="invoice_value_ly"
                  name="Ano passado"
                  fill="#94a3b8"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(payload) => payload && setEstadoSel(payload)}
                />
                <Bar
                  dataKey="invoice_value"
                  name="Ano atual"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(payload) => payload && setEstadoSel(payload)}
                  label={{
                    position: 'right',
                    formatter: (v) =>
                      v > 0
                        ? v >= 1000
                          ? `R$ ${(v / 1000).toFixed(0)}k`
                          : `R$ ${v.toFixed(0)}`
                        : '',
                    fontSize: 10,
                    fill: '#374151',
                    fontWeight: 600,
                  }}
                >
                  {[...data.rows]
                    .sort(
                      (a, b) =>
                        Math.max(b.invoice_value, b.invoice_value_ly) -
                        Math.max(a.invoice_value, a.invoice_value_ly),
                    )
                    .slice(0, 12)
                    .map((r) => (
                      <Cell
                        key={r.uf}
                        fill={
                          r.invoice_value === 0
                            ? '#cbd5e1'
                            : r.growth_pct == null
                              ? '#3b82f6'
                              : r.growth_pct >= 0
                                ? '#10b981'
                                : '#f43f5e'
                        }
                        cursor="pointer"
                        onClick={() => setEstadoSel(r)}
                      />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Chart 2: Crescimento por UF — exclui UFs com -100% (sem vendas) */}
          {(() => {
            const semVendas = [...data.rows].filter(
              (r) => r.growth_pct != null && r.growth_pct <= -99.99,
            );
            const comGrowth = [...data.rows]
              .filter((r) => r.growth_pct != null && r.growth_pct > -99.99)
              .sort((a, b) => b.growth_pct - a.growth_pct);

            if (comGrowth.length === 0 && semVendas.length === 0) return null;

            // calcular range Y dinâmico
            const maxAbs = comGrowth.reduce(
              (m, r) => Math.max(m, Math.abs(r.growth_pct)),
              0,
            );
            const yMax = Math.ceil(maxAbs / 10) * 10 + 5;
            const yMin = -yMax;

            return (
              <div className="px-4 pb-4 border-t border-gray-100">
                <div className="flex items-baseline gap-3 mt-3 mb-2">
                  <p className="text-[10px] font-bold uppercase text-gray-500 tracking-wider">
                    Crescimento por UF (%)
                  </p>
                  {semVendas.length > 0 && (
                    <span className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full font-semibold">
                      ⚠️ {semVendas.length}{' '}
                      {semVendas.length === 1 ? 'UF' : 'UFs'} sem vendas no
                      período (queda total):{' '}
                      {semVendas.map((r) => r.uf).join(', ')}
                    </span>
                  )}
                </div>
                {comGrowth.length > 0 ? (
                  <div style={{ height: Math.max(180, comGrowth.length * 28) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={comGrowth}
                        layout="vertical"
                        margin={{ top: 5, right: 60, left: 10, bottom: 5 }}
                        barCategoryGap="20%"
                      >
                        <CartesianGrid
                          horizontal={false}
                          strokeDasharray="3 3"
                          stroke="#f0f0f0"
                        />
                        <XAxis
                          type="number"
                          domain={[yMin, yMax]}
                          tick={{ fontSize: 9, fill: '#6b7280' }}
                          tickFormatter={(v) => `${v.toFixed(0)}%`}
                          axisLine={{ stroke: '#e5e7eb' }}
                        />
                        <YAxis
                          type="category"
                          dataKey="uf"
                          tick={{
                            fontSize: 11,
                            fill: '#374151',
                            fontWeight: 700,
                          }}
                          axisLine={{ stroke: '#e5e7eb' }}
                          width={48}
                        />
                        <Tooltip
                          formatter={(v) => `${v.toFixed(1)}%`}
                          labelFormatter={(uf) => `Estado: ${uf}`}
                          cursor={{ fill: 'rgba(99, 102, 241, 0.05)' }}
                          contentStyle={{
                            background: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: 8,
                            fontSize: 12,
                            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                          }}
                        />
                        <Bar
                          dataKey="growth_pct"
                          name="Crescimento %"
                          radius={[0, 4, 4, 0]}
                          cursor="pointer"
                          onClick={(payload) =>
                            payload && setEstadoSel(payload)
                          }
                          label={{
                            position: 'right',
                            formatter: (v) =>
                              `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
                            fontSize: 11,
                            fill: '#374151',
                            fontWeight: 700,
                          }}
                        >
                          {comGrowth.map((r) => (
                            <Cell
                              key={r.uf}
                              fill={r.growth_pct >= 0 ? '#10b981' : '#f43f5e'}
                              cursor="pointer"
                              onClick={() => setEstadoSel(r)}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 text-center py-4">
                    Sem dados de crescimento neste período (todas UFs estão sem
                    vendas atuais).
                  </p>
                )}
              </div>
            );
          })()}
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-[10px] text-gray-500 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-slate-400" /> Ano passado
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />{' '}
              Crescimento
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500" /> Queda
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" /> Novo (sem
              base anterior)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-slate-300" /> Sem
              movimento atual
            </span>
            <span className="ml-auto">Top 12 UFs ordenado por relevância</span>
          </div>
        </div>
      )}

      {/* Tabela por estado */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-[#000638] to-[#1e1b4b] text-white flex items-center gap-2">
          <MapPin size={16} />
          <h3 className="text-sm font-bold">
            Faturamento de {moduloLabel} por Estado
          </h3>
          <span className="ml-auto text-[10px] text-blue-100">
            {filteredRows.length} de {data?.rows?.length || 0} UFs · clique para
            ver clientes
          </span>
        </div>
        {/* Filtros */}
        {data?.rows && data.rows.length > 0 && (
          <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2 text-xs">
            <span className="text-[10px] uppercase font-semibold text-gray-500 mr-1">
              Filtrar:
            </span>
            {[
              { key: 'todos', label: 'Todos', count: data.rows.length },
              {
                key: 'comVenda',
                label: 'Com vendas no período',
                count: data.rows.filter((r) => r.invoice_value > 0).length,
              },
              {
                key: 'queda',
                label: 'Em queda',
                count: data.rows.filter(
                  (r) => r.growth_pct != null && r.growth_pct < 0,
                ).length,
              },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setTableFilter(opt.key)}
                className={`text-[11px] font-bold px-2 py-1 rounded-md transition ${
                  tableFilter === opt.key
                    ? 'bg-[#000638] text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {opt.label}
                <span className="ml-1 opacity-70">({opt.count})</span>
              </button>
            ))}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-gray-400">
            <Spinner size={18} className="animate-spin" />
            <span className="text-xs">Carregando…</span>
          </div>
        ) : erro ? (
          <p className="text-xs text-red-600 py-6 text-center">{erro}</p>
        ) : !data?.rows?.length ? (
          <p className="text-xs text-gray-400 py-8 text-center">
            Nenhum dado de revenda encontrado no período.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 text-gray-500 font-semibold w-[40px]">
                  #
                </th>
                <th className="text-left px-3 py-2 text-gray-500 font-semibold">
                  UF
                </th>
                {[
                  { key: 'customers_count', label: 'Clientes', align: 'right' },
                  { key: 'invoice_qty', label: 'NFs', align: 'right' },
                  { key: 'invoice_value', label: 'Ano atual', align: 'right' },
                  {
                    key: 'invoice_value_ly',
                    label: 'Ano passado',
                    align: 'right',
                  },
                  { key: 'delta_value', label: 'Δ R$', align: 'right' },
                  { key: 'growth_pct', label: 'Crescimento', align: 'right' },
                ].map(({ key, label, align }) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className={`text-${align} px-3 py-2 text-gray-500 font-semibold cursor-pointer select-none hover:bg-gray-100`}
                  >
                    {label}
                    {sortField === key ? (
                      <span className="ml-1">
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    ) : (
                      <span className="ml-1 text-gray-300">⇅</span>
                    )}
                  </th>
                ))}
                <th className="text-left px-3 py-2 text-gray-500 font-semibold w-[140px]">
                  % do total
                </th>
                <th className="w-[40px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="text-center text-gray-400 py-6 text-xs"
                  >
                    Nenhum estado encontrado com o filtro aplicado.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, i) => (
                  <tr
                    key={r.uf}
                    onClick={() => setEstadoSel(r)}
                    className="hover:bg-indigo-50/40 cursor-pointer transition"
                  >
                    <td className="px-3 py-2 text-gray-400 font-mono">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-block bg-indigo-100 text-indigo-700 font-extrabold text-[11px] uppercase px-2 py-0.5 rounded">
                        {r.uf}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 tabular-nums">
                      {fmtNum(r.customers_count)}
                      {r.customers_count_ly > 0 && (
                        <div className="text-[9px] text-gray-400">
                          LY: {fmtNum(r.customers_count_ly)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 tabular-nums">
                      {fmtNum(r.invoice_qty)}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-600 tabular-nums">
                      {fmtMoeda(r.invoice_value)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 tabular-nums">
                      {fmtMoeda(r.invoice_value_ly)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.delta_value != null && r.delta_value !== 0 ? (
                        <span
                          className={`text-[11px] font-bold ${
                            r.delta_value >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {r.delta_value >= 0 ? '+' : ''}
                          {fmtMoeda(r.delta_value)}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.growth_pct == null ? (
                        r.invoice_value > 0 ? (
                          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded uppercase">
                            Novo
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded border ${
                            r.growth_pct >= 0
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          {r.growth_pct >= 0 ? (
                            <TrendUp size={10} weight="bold" />
                          ) : (
                            <TrendDown size={10} weight="bold" />
                          )}
                          {r.growth_pct >= 0 ? '+' : ''}
                          {r.growth_pct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-indigo-400 to-blue-500"
                            style={{ width: `${Math.min(r.pct, 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-500 tabular-nums w-10 text-right">
                          {r.pct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CaretRight size={12} className="text-gray-400" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-2 text-right font-bold text-gray-700"
                >
                  TOTAL ({filteredRows.length} de {data.states_count} UFs ·{' '}
                  {fmtNum(
                    filteredRows.reduce((s, r) => s + r.customers_count, 0),
                  )}{' '}
                  clientes)
                </td>
                <td className="px-3 py-2 text-right font-bold text-[#000638]">
                  {fmtMoeda(
                    filteredRows.reduce((s, r) => s + r.invoice_value, 0),
                  )}
                </td>
                <td className="px-3 py-2 text-right font-bold text-gray-500">
                  {fmtMoeda(
                    filteredRows.reduce((s, r) => s + r.invoice_value_ly, 0),
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {(() => {
                    const delta = filteredRows.reduce(
                      (s, r) => s + (r.delta_value || 0),
                      0,
                    );
                    return (
                      <span
                        className={`text-[11px] font-bold ${
                          delta >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {delta >= 0 ? '+' : ''}
                        {fmtMoeda(delta)}
                      </span>
                    );
                  })()}
                </td>
                <td className="px-3 py-2 text-right">
                  {data.total_growth_pct != null && (
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded border ${
                        data.total_growth_pct >= 0
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {data.total_growth_pct >= 0 ? (
                        <TrendUp size={10} weight="bold" />
                      ) : (
                        <TrendDown size={10} weight="bold" />
                      )}
                      {data.total_growth_pct >= 0 ? '+' : ''}
                      {data.total_growth_pct.toFixed(1)}%
                    </span>
                  )}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {estadoSel && (
        <EstadoClientesModal
          estado={estadoSel}
          onClose={() => setEstadoSel(null)}
        />
      )}
      {kpiSel && data && (
        <KpiDetailModal
          kpi={kpiSel}
          data={data}
          moduloLabel={moduloLabel}
          onClose={() => setKpiSel(null)}
          onUFClick={(uf) => {
            const row = data.rows.find((r) => r.uf === uf);
            if (row) {
              setKpiSel(null);
              setEstadoSel(row);
            }
          }}
        />
      )}
    </div>
  );
}

function KpiCard({
  label,
  valor,
  subValor,
  growthPct,
  icone: Icone,
  color,
  loading,
  onClick,
}) {
  const COLORS = {
    green: {
      from: 'from-emerald-400',
      bg: 'bg-emerald-100',
      text: 'text-emerald-600',
    },
    blue: { from: 'from-blue-400', bg: 'bg-blue-100', text: 'text-blue-600' },
    indigo: {
      from: 'from-indigo-400',
      bg: 'bg-indigo-100',
      text: 'text-indigo-600',
    },
    rose: { from: 'from-rose-400', bg: 'bg-rose-100', text: 'text-rose-600' },
    amber: {
      from: 'from-amber-400',
      bg: 'bg-amber-100',
      text: 'text-amber-600',
    },
    violet: {
      from: 'from-violet-400',
      bg: 'bg-violet-100',
      text: 'text-violet-600',
    },
  };
  const t = COLORS[color] || COLORS.blue;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-1 relative overflow-hidden text-left ${onClick ? 'cursor-pointer hover:border-indigo-300 hover:shadow-md transition' : ''}`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${t.from} to-transparent`}
      />
      <div className="flex items-center gap-2 text-gray-500">
        <span
          className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${t.bg}`}
        >
          {Icone && (
            <Icone
              size={14}
              weight="bold"
              className={`${t.text} ${loading ? 'animate-spin' : ''}`}
            />
          )}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </span>
        {growthPct != null && !loading && (
          <span
            className={`ml-auto inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border ${
              growthPct >= 0
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}
          >
            {growthPct >= 0 ? (
              <TrendUp size={9} weight="bold" />
            ) : (
              <TrendDown size={9} weight="bold" />
            )}
            {growthPct >= 0 ? '+' : ''}
            {growthPct.toFixed(1)}%
          </span>
        )}
      </div>
      <span className={`text-xl font-bold tabular-nums ${t.text}`}>
        {valor}
      </span>
      {subValor && !loading && (
        <div className="mt-1 flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
            Ano passado
          </span>
          <span className="text-sm font-bold tabular-nums text-gray-700 ml-auto">
            {subValor.replace(/^LY:\s*/, '')}
          </span>
        </div>
      )}
    </Tag>
  );
}

// ─── Modal genérico de detalhes por KPI ─────────────────────────────────────
function KpiDetailModal({ kpi, data, moduloLabel, onClose, onUFClick }) {
  const TITLE_BY_KPI = {
    faturamento: `Faturamento ${moduloLabel} — Detalhes`,
    nfs: 'NFs Emitidas — Detalhes',
    clientes: 'Clientes Únicos — Detalhes',
    aberturas: 'Aberturas de Cadastro — Detalhes',
    estados: 'Estados (UFs) — Detalhes',
  };
  const ICON_BY_KPI = {
    faturamento: CurrencyDollar,
    nfs: ShoppingCart,
    clientes: Users,
    aberturas: UserPlus,
    estados: MapPin,
  };
  const Icon = ICON_BY_KPI[kpi];
  const sortedRows = useMemo(
    () =>
      [...(data?.rows || [])].sort((a, b) => b.invoice_value - a.invoice_value),
    [data],
  );

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-br from-indigo-50 to-blue-50">
          <div className="flex items-center gap-3">
            {Icon && (
              <span className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center">
                <Icon size={20} weight="bold" className="text-indigo-600" />
              </span>
            )}
            <h3 className="text-sm font-bold text-[#000638]">
              {TITLE_BY_KPI[kpi]}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-indigo-100 rounded-lg"
          >
            <X size={16} className="text-indigo-700" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {kpi === 'faturamento' && (
            <FaturamentoDetail data={data} onUFClick={onUFClick} />
          )}
          {kpi === 'nfs' && <NFsDetail data={data} onUFClick={onUFClick} />}
          {kpi === 'clientes' && (
            <ClientesDetail data={data} onUFClick={onUFClick} />
          )}
          {kpi === 'aberturas' && (
            <AberturasDetail data={data} onUFClick={onUFClick} />
          )}
          {kpi === 'estados' && (
            <EstadosDetail data={data} onUFClick={onUFClick} />
          )}
        </div>
      </div>
    </div>
  );
}

function FaturamentoDetail({ data, onUFClick }) {
  return (
    <>
      {/* Cards bruto/credev/liquido */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-gray-500">Bruto</p>
          <p className="text-lg font-bold text-gray-700">
            {fmtMoeda(data.total_value_gross)}
          </p>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-rose-700">
            Credev
          </p>
          <p className="text-lg font-bold text-rose-700">
            -{fmtMoeda(data.total_devolucao || 0)}
          </p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-emerald-700">
            Líquido
          </p>
          <p className="text-lg font-bold text-emerald-700">
            {fmtMoeda(data.total_value)}
          </p>
        </div>
      </div>
      <div className="text-[11px] text-gray-500">
        Comparativo ano passado: {fmtMoeda(data.total_value_ly)}
        {data.total_growth_pct != null && (
          <span
            className={`ml-2 font-bold ${data.total_growth_pct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
          >
            ({data.total_growth_pct >= 0 ? '+' : ''}
            {data.total_growth_pct.toFixed(1)}%)
          </span>
        )}
      </div>
      <div>
        <p className="text-xs font-bold uppercase text-gray-500 mb-2">
          Por estado (clique para ver clientes)
        </p>
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 text-gray-500">UF</th>
              <th className="text-right px-3 py-2 text-gray-500">
                Faturamento
              </th>
              <th className="text-right px-3 py-2 text-gray-500">% do total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[...(data.rows || [])]
              .filter((r) => r.invoice_value > 0)
              .sort((a, b) => b.invoice_value - a.invoice_value)
              .map((r) => (
                <tr
                  key={r.uf}
                  onClick={() => onUFClick(r.uf)}
                  className="hover:bg-indigo-50/40 cursor-pointer"
                >
                  <td className="px-3 py-2 font-semibold">
                    <span className="inline-block bg-indigo-100 text-indigo-700 font-extrabold text-[10px] uppercase px-2 py-0.5 rounded">
                      {r.uf}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-emerald-600 tabular-nums">
                    {fmtMoeda(r.invoice_value)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600 tabular-nums">
                    {r.pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function NFsDetail({ data, onUFClick }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-indigo-700">
            Atual
          </p>
          <p className="text-2xl font-bold text-indigo-700">
            {fmtNum(data.total_qty)}
          </p>
          <p className="text-[10px] text-indigo-700/70 mt-1">NFs emitidas</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-gray-500">
            Ano passado
          </p>
          <p className="text-2xl font-bold text-gray-700">
            {fmtNum(data.total_qty_ly || 0)}
          </p>
        </div>
      </div>
      <div>
        <p className="text-xs font-bold uppercase text-gray-500 mb-2">
          NFs por estado
        </p>
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 text-gray-500">UF</th>
              <th className="text-right px-3 py-2 text-gray-500">NFs Atual</th>
              <th className="text-right px-3 py-2 text-gray-500">NFs LY</th>
              <th className="text-right px-3 py-2 text-gray-500">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[...(data.rows || [])]
              .filter((r) => r.invoice_qty > 0 || r.invoice_qty_ly > 0)
              .sort((a, b) => b.invoice_qty - a.invoice_qty)
              .map((r) => {
                const delta = r.invoice_qty - (r.invoice_qty_ly || 0);
                return (
                  <tr
                    key={r.uf}
                    onClick={() => onUFClick(r.uf)}
                    className="hover:bg-indigo-50/40 cursor-pointer"
                  >
                    <td className="px-3 py-2 font-semibold">
                      <span className="inline-block bg-indigo-100 text-indigo-700 font-extrabold text-[10px] uppercase px-2 py-0.5 rounded">
                        {r.uf}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-indigo-700 tabular-nums">
                      {fmtNum(r.invoice_qty)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 tabular-nums">
                      {fmtNum(r.invoice_qty_ly || 0)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-bold tabular-nums ${delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      {delta >= 0 ? '+' : ''}
                      {delta}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ClientesDetail({ data, onUFClick }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-blue-700">Atual</p>
          <p className="text-2xl font-bold text-blue-700">
            {fmtNum(data.total_clients)}
          </p>
          <p className="text-[10px] text-blue-700/70 mt-1">clientes únicos</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-gray-500">
            Ano passado
          </p>
          <p className="text-2xl font-bold text-gray-700">
            {fmtNum(data.total_clients_ly || 0)}
          </p>
        </div>
      </div>
      <div>
        <p className="text-xs font-bold uppercase text-gray-500 mb-2">
          Clientes por estado (clique para ver lista)
        </p>
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 text-gray-500">UF</th>
              <th className="text-right px-3 py-2 text-gray-500">Atual</th>
              <th className="text-right px-3 py-2 text-gray-500">LY</th>
              <th className="text-right px-3 py-2 text-gray-500">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[...(data.rows || [])]
              .filter((r) => r.customers_count > 0 || r.customers_count_ly > 0)
              .sort((a, b) => b.customers_count - a.customers_count)
              .map((r) => {
                const delta = r.customers_count - (r.customers_count_ly || 0);
                return (
                  <tr
                    key={r.uf}
                    onClick={() => onUFClick(r.uf)}
                    className="hover:bg-indigo-50/40 cursor-pointer"
                  >
                    <td className="px-3 py-2 font-semibold">
                      <span className="inline-block bg-indigo-100 text-indigo-700 font-extrabold text-[10px] uppercase px-2 py-0.5 rounded">
                        {r.uf}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-blue-700 tabular-nums">
                      {fmtNum(r.customers_count)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 tabular-nums">
                      {fmtNum(r.customers_count_ly || 0)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-bold tabular-nums ${delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      {delta >= 0 ? '+' : ''}
                      {delta}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AberturasDetail({ data, onUFClick }) {
  const aberturas = [];
  for (const r of data.rows || []) {
    for (const c of r.all_customers || []) {
      if (c.client_type === 'abertura') aberturas.push({ ...c, uf: r.uf });
    }
  }
  const isTrafego = (cl) => {
    const o = (cl.clickup_lead?.origem || '').toLowerCase();
    return (
      /tr.fego|trafego|paid|ads|google|meta|instagram|facebook/i.test(o) ||
      o === ''
    );
    // se tem lead no CRM mas origem vazia, pode ser qualquer origem — só marca como CRM
  };
  const comCRM = aberturas.filter((c) => c.clickup_lead);
  const comTrafego = aberturas.filter(
    (c) =>
      c.clickup_lead &&
      /tr.fego|trafego|paid|ads|google|meta|instagram|facebook/i.test(
        c.clickup_lead.origem || '',
      ),
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-amber-700">
            Atual
          </p>
          <p className="text-2xl font-bold text-amber-700">
            {fmtNum(data.total_aberturas_cadastro || 0)}
          </p>
          <p className="text-[10px] text-amber-700/70 mt-1">
            novos clientes que compraram
          </p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-gray-500">
            Ano passado
          </p>
          <p className="text-2xl font-bold text-gray-700">
            {fmtNum(data.total_aberturas_cadastro_ly || 0)}
          </p>
        </div>
      </div>
      {(data.ticket_medio_abertura != null ||
        data.total_fat_abertura != null) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <p className="text-[10px] uppercase font-bold text-emerald-700">
              Ticket médio (1ª compra)
            </p>
            <p className="text-2xl font-bold text-emerald-700">
              {data.ticket_medio_abertura != null
                ? fmtMoeda(data.ticket_medio_abertura)
                : '—'}
            </p>
            <p className="text-[10px] text-emerald-700/70 mt-1">
              média por cliente abertura
            </p>
          </div>
          <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-3">
            <p className="text-[10px] uppercase font-bold text-emerald-600">
              Fat. total aberturas
            </p>
            <p className="text-2xl font-bold text-emerald-600">
              {data.total_fat_abertura != null
                ? fmtMoeda(data.total_fat_abertura)
                : '—'}
            </p>
            <p className="text-[10px] text-emerald-600/70 mt-1">
              soma das 1ªs compras
            </p>
          </div>
        </div>
      )}
      {comCRM.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <p className="text-[10px] uppercase font-bold text-purple-700">
              Via CRM (ClickUp)
            </p>
            <p className="text-2xl font-bold text-purple-700">
              {comCRM.length}
            </p>
            <p className="text-[10px] text-purple-700/70 mt-1">
              tinham lead no CRM antes da 1ª compra
            </p>
          </div>
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
            <p className="text-[10px] uppercase font-bold text-rose-700">
              Via Tráfego Pago
            </p>
            <p className="text-2xl font-bold text-rose-700">
              {comTrafego.length}
            </p>
            <p className="text-[10px] text-rose-700/70 mt-1">
              origem identificada como tráfego
            </p>
          </div>
        </div>
      )}
      <div className="text-[11px] text-gray-500">
        <span className="font-semibold">Definição:</span> cliente que comprou no
        período e não tem compra nos 12 meses anteriores (verificado via TOTVS).
      </div>
      {aberturas.length === 0 ? (
        <p className="text-xs text-gray-400 py-6 text-center">
          Nenhuma abertura no período.
        </p>
      ) : (
        <div>
          <p className="text-xs font-bold uppercase text-gray-500 mb-2">
            Lista de aberturas no período ({aberturas.length})
          </p>
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 text-gray-500">Cliente</th>
                <th className="text-left px-3 py-2 text-gray-500">Vendedor</th>
                <th className="text-left px-3 py-2 text-gray-500">Origem</th>
                <th className="text-left px-3 py-2 text-gray-500">UF</th>
                <th className="text-right px-3 py-2 text-gray-500">
                  Faturamento
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {aberturas
                .sort((a, b) => b.value - a.value)
                .map((c) => {
                  const lead = c.clickup_lead;
                  const isTrafegoLead =
                    lead &&
                    /tr.fego|trafego|paid|ads|google|meta|instagram|facebook/i.test(
                      lead.origem || '',
                    );
                  return (
                    <tr
                      key={c.person_code}
                      onClick={() => onUFClick(c.uf)}
                      className="hover:bg-indigo-50/40 cursor-pointer"
                    >
                      <td className="px-3 py-2 font-semibold text-gray-800 truncate max-w-[180px]">
                        {c.person_name}
                        <div className="text-[10px] text-gray-400">
                          #{c.person_code}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[120px] truncate">
                        {c.seller_name ||
                          (c.seller_code ? (
                            `#${c.seller_code}`
                          ) : (
                            <span className="text-gray-300">—</span>
                          ))}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {lead ? (
                          <div className="flex flex-col gap-0.5">
                            {isTrafegoLead ? (
                              <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-700 font-bold text-[10px] uppercase px-2 py-0.5 rounded">
                                📢 Tráfego
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 font-bold text-[10px] uppercase px-2 py-0.5 rounded">
                                CRM
                              </span>
                            )}
                            {lead.origem && (
                              <span className="text-[9px] text-gray-400">
                                {lead.origem}
                              </span>
                            )}
                            <a
                              href={lead.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[9px] text-blue-500 hover:underline"
                            >
                              ver lead ↗
                            </a>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-block bg-amber-100 text-amber-700 font-extrabold text-[10px] uppercase px-2 py-0.5 rounded">
                          {c.uf}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-600 tabular-nums">
                        {fmtMoeda(c.value)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function EstadosDetail({ data, onUFClick }) {
  return (
    <>
      <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 mb-3">
        <p className="text-[10px] uppercase font-bold text-rose-700">
          Estados ativos no período
        </p>
        <p className="text-2xl font-bold text-rose-700">
          {fmtNum(data.states_count || 0)}
        </p>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left px-3 py-2 text-gray-500">UF</th>
            <th className="text-right px-3 py-2 text-gray-500">Faturamento</th>
            <th className="text-right px-3 py-2 text-gray-500">Clientes</th>
            <th className="text-right px-3 py-2 text-gray-500">NFs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {[...(data.rows || [])]
            .filter((r) => r.invoice_value > 0 || r.invoice_value_ly > 0)
            .sort((a, b) => b.invoice_value - a.invoice_value)
            .map((r) => (
              <tr
                key={r.uf}
                onClick={() => onUFClick(r.uf)}
                className="hover:bg-indigo-50/40 cursor-pointer"
              >
                <td className="px-3 py-2 font-semibold">
                  <span className="inline-block bg-indigo-100 text-indigo-700 font-extrabold text-[10px] uppercase px-2 py-0.5 rounded">
                    {r.uf}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-bold text-emerald-600 tabular-nums">
                  {fmtMoeda(r.invoice_value)}
                </td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">
                  {fmtNum(r.customers_count)}
                </td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">
                  {fmtNum(r.invoice_qty)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </>
  );
}
