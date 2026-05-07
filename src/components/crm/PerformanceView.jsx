import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  Trophy,
  TrendUp,
  CurrencyDollar,
  Spinner,
  MagnifyingGlass,
  CaretUp,
  CaretDown,
  ArrowsClockwise,
  ChartBar,
  CaretRight,
  Table,
  ShoppingCart,
  Package,
  Eye,
  X,
  User,
  CalendarBlank,
  ListBullets,
  UserPlus,
} from '@phosphor-icons/react';
import { COLORS, VENDEDORES_POR_MODULO } from './constants';

// Em DEV usa origin (Vite proxy /api → localhost:4100). Em PROD usa fallback.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV
    ? window.location.origin
    : 'https://apigestaocrosby-bw2v.onrender.com');
const API_KEY = import.meta.env.VITE_API_KEY || 'crosby2025';

async function apiPostLocal(endpoint, body) {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const json = await res.json();
  return json.data ?? json;
}

// ═══════════════════════════════════════════════════════════════════════════
// PerformanceView — Rankings de vendedores
// Exibe 6 cards (top 3 cada) de cadastros e faturamento por período.
// Também mostra resumo de clientes inativados nos últimos 30 dias.
// ═══════════════════════════════════════════════════════════════════════════

// Formata valor em BRL
function fmtMoeda(v) {
  return (v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// Formata inteiros
function fmtNum(v) {
  return (v || 0).toLocaleString('pt-BR');
}

// Formata data ISO → DD/MM/YYYY
function fmtData(iso) {
  if (!iso) return '--';
  try {
    const [datePart] = String(iso).split('T');
    const [y, m, d] = datePart.split('-');
    return `${d}/${m}/${y}`;
  } catch {
    return '--';
  }
}

// ─── Card KPI resumo ────────────────────────────────────────────────────────
// Paleta por cor (string-token): aplica cor consistente em ícone, valor e barra
const KPI_COLOR_TOKENS = {
  green: {
    iconBg: 'bg-emerald-100',
    iconText: 'text-emerald-600',
    value: 'text-emerald-600',
    accent: 'from-emerald-400',
  },
  blue: {
    iconBg: 'bg-blue-100',
    iconText: 'text-blue-600',
    value: 'text-blue-600',
    accent: 'from-blue-400',
  },
  purple: {
    iconBg: 'bg-violet-100',
    iconText: 'text-violet-600',
    value: 'text-violet-600',
    accent: 'from-violet-400',
  },
  indigo: {
    iconBg: 'bg-indigo-100',
    iconText: 'text-indigo-600',
    value: 'text-indigo-600',
    accent: 'from-indigo-400',
  },
  amber: {
    iconBg: 'bg-amber-100',
    iconText: 'text-amber-600',
    value: 'text-amber-700',
    accent: 'from-amber-400',
  },
  rose: {
    iconBg: 'bg-rose-100',
    iconText: 'text-rose-600',
    value: 'text-rose-600',
    accent: 'from-rose-400',
  },
  sky: {
    iconBg: 'bg-sky-100',
    iconText: 'text-sky-600',
    value: 'text-sky-600',
    accent: 'from-sky-400',
  },
};

function KpiCard({ label, valor, sub, icone: Icone, cor, color, onClick, loading }) {
  const clickable = typeof onClick === 'function' && !loading;
  const tokens = (color && KPI_COLOR_TOKENS[color]) || null;
  return (
    <div
      className={`bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-1 relative overflow-hidden ${
        clickable
          ? 'cursor-pointer hover:border-[#000638]/40 hover:shadow-md hover:-translate-y-0.5 transition'
          : ''
      } ${loading ? 'animate-pulse' : ''}`}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      {/* Faixa colorida lateral */}
      {tokens && (
        <span
          className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${tokens.accent} to-transparent`}
        />
      )}
      {loading && (
        <div
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
          style={{
            backgroundSize: '200% 100%',
            animation: 'kpi-loading-bar 1.4s ease-in-out infinite',
          }}
        />
      )}
      <div className="flex items-center gap-2 text-gray-500">
        {Icone && (
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${
              tokens ? tokens.iconBg : 'bg-gray-100'
            }`}
          >
            <Icone
              size={14}
              weight="bold"
              className={`${tokens ? tokens.iconText : cor || 'text-gray-500'} ${loading ? 'animate-spin' : ''}`}
            />
          </span>
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </span>
        {clickable && (
          <CaretRight size={10} className="ml-auto text-gray-300" />
        )}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 mt-1">
          <Spinner size={16} className="animate-spin text-[#000638]/50" />
          <div className="h-5 w-14 bg-gray-200 rounded animate-pulse" />
        </div>
      ) : (
        <span
          className={`text-xl font-bold tabular-nums ${
            tokens ? tokens.value : 'text-[#000638]'
          }`}
        >
          {valor}
        </span>
      )}
      {loading ? (
        <div className="h-2.5 w-24 bg-gray-100 rounded mt-0.5 animate-pulse" />
      ) : (
        sub && <span className="text-[10px] text-gray-400">{sub}</span>
      )}
      <style>{`
        @keyframes kpi-loading-bar {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Modal de Reativações do período ────────────────────────────────────────
function ReativacaoModal({ data, dataInicio, dataFim, onClose }) {
  const [busca, setBusca] = useState('');
  const customers = data?.customers || [];
  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        (c.person_name || '').toUpperCase().includes(q) ||
        String(c.person_code || '').includes(q) ||
        (c.seller_name || '').toUpperCase().includes(q),
    );
  }, [customers, busca]);
  const totalValor = filtrados.reduce((s, c) => s + (c.value || 0), 0);
  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-sm font-bold text-[#000638] flex items-center gap-2">
              <ArrowsClockwise size={16} className="text-amber-600" />
              Reativações do período
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {dataInicio?.split('-').reverse().join('/')} —{' '}
              {dataFim?.split('-').reverse().join('/')} ·{' '}
              {filtrados.length} clientes ·{' '}
              {fmtMoeda(totalValor)} em vendas de retorno · ≥{' '}
              {data?.days_inactive_threshold || 60} dias inativos
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={16} className="text-gray-500" />
          </button>
        </div>
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <MagnifyingGlass
              size={12}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente ou código..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#000638]"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtrados.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">
              Nenhuma reativação encontrada.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-gray-500 font-semibold w-[40px]">
                    #
                  </th>
                  <th className="text-left px-3 py-2 text-gray-500 font-semibold">
                    Cliente
                  </th>
                  <th className="text-left px-3 py-2 text-gray-500 font-semibold">
                    Vendedor
                  </th>
                  <th className="text-center px-3 py-2 text-gray-500 font-semibold">
                    Última compra
                  </th>
                  <th className="text-center px-3 py-2 text-gray-500 font-semibold">
                    Voltou em
                  </th>
                  <th className="text-right px-3 py-2 text-gray-500 font-semibold">
                    Dias inativo
                  </th>
                  <th className="text-right px-3 py-2 text-gray-500 font-semibold">
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtrados.map((c, i) => (
                  <tr key={c.person_code || i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-400 font-mono">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-gray-800 truncate max-w-[220px]">
                        {c.person_name}
                      </div>
                      {c.person_code && (
                        <div className="text-[10px] text-gray-400">
                          #{c.person_code} · br{c.branch_code}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-[180px]">
                      {c.seller_name || '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600">
                      <span className="inline-flex items-center gap-1">
                        <CalendarBlank size={11} className="text-gray-400" />
                        {fmtData(c.last_purchase_before)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-gray-700">
                      <span className="inline-flex items-center gap-1">
                        <CalendarBlank size={11} className="text-gray-400" />
                        {fmtData(c.first_purchase_in_period)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-block bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold px-1.5 py-0.5 rounded">
                        {c.days_inactive}d
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-600">
                      {fmtMoeda(c.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200 sticky bottom-0">
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-right font-bold text-gray-700">
                    TOTAL ({filtrados.length} clientes)
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-[#000638]">
                    {fmtMoeda(totalValor)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal de TODAS as aberturas do período ─────────────────────────────────
function AperturasModal({
  openingsData,
  sellersTotals,
  dataInicio,
  dataFim,
  onClose,
}) {
  // Mapa sellerCode → { name, branch_name, branch_code }
  const sellerInfo = useMemo(() => {
    const map = {};
    for (const s of sellersTotals || []) {
      const code = Number(s.seller_code);
      if (!map[code]) {
        map[code] = {
          name: s.seller_name || `Vend. ${code}`,
          branch_code: s.branch_code,
          branch_name: s.branch_name || s.branch_short || '',
          branch_short: s.branch_short || '',
        };
      }
    }
    return map;
  }, [sellersTotals]);

  // Flatten: para cada opening, gera 1 linha com cliente + opener + loja
  const linhas = useMemo(() => {
    if (!openingsData?.sellers) return [];
    const seen = new Map();
    for (const s of openingsData.sellers) {
      const sellerCode = Number(s.seller_code);
      const info = sellerInfo[sellerCode] || {};
      for (const c of s.clients || []) {
        const key = c.person_code || `${sellerCode}-${c.person_name}`;
        // Se um cliente foi atribuído a mais de um vendedor (raro, com nova lógica),
        // mantém só o primeiro encontrado.
        if (seen.has(key)) continue;
        seen.set(key, {
          person_code: c.person_code,
          person_name: c.person_name || 'Sem nome',
          first_purchase_date: c.first_purchase_date,
          first_purchase_value: Number(c.first_purchase_value) || 0,
          canal: c.canal,
          match_source: c.match_source,
          seller_code: sellerCode,
          seller_name: info.name || `Vend. ${sellerCode}`,
          branch_name: info.branch_name || '—',
          branch_short: info.branch_short || '',
        });
      }
    }
    return Array.from(seen.values()).sort(
      (a, b) =>
        String(b.first_purchase_date || '').localeCompare(
          String(a.first_purchase_date || ''),
        ) || b.first_purchase_value - a.first_purchase_value,
    );
  }, [openingsData, sellerInfo]);

  const [filterLoja, setFilterLoja] = useState('todas');
  const [filterCRM, setFilterCRM] = useState('todos'); // 'todos' | 'crm' | 'sem_crm'
  const [busca, setBusca] = useState('');
  const [sortCol, setSortCol] = useState('first_purchase_date');
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'

  const toggleSort = (col) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      // Padrões: numéricos / data → desc, texto → asc
      const numericOrDate = ['first_purchase_value', 'first_purchase_date'];
      setSortDir(numericOrDate.includes(col) ? 'desc' : 'asc');
    }
  };

  const SortIcon = ({ col }) => {
    if (sortCol !== col) {
      return <CaretDown size={9} className="opacity-20" />;
    }
    return sortDir === 'asc' ? (
      <CaretUp size={9} className="text-[#000638]" />
    ) : (
      <CaretDown size={9} className="text-[#000638]" />
    );
  };

  const lojas = useMemo(() => {
    const set = new Set();
    for (const r of linhas) {
      if (r.branch_name && r.branch_name !== '—') set.add(r.branch_name);
    }
    return ['todas', ...Array.from(set).sort()];
  }, [linhas]);

  const totalCRM = useMemo(
    () => linhas.filter((r) => r.match_source === 'clickup_phone').length,
    [linhas],
  );

  const linhasFiltradas = useMemo(() => {
    const q = busca.trim().toUpperCase();
    const filtered = linhas.filter((r) => {
      if (filterLoja !== 'todas' && r.branch_name !== filterLoja) return false;
      const isCRM = r.match_source === 'clickup_phone';
      if (filterCRM === 'crm' && !isCRM) return false;
      if (filterCRM === 'sem_crm' && isCRM) return false;
      if (!q) return true;
      return (
        (r.person_name || '').toUpperCase().includes(q) ||
        String(r.person_code || '').includes(q) ||
        (r.seller_name || '').toUpperCase().includes(q)
      );
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      return String(av || '').localeCompare(String(bv || '')) * dir;
    });
    return filtered;
  }, [linhas, filterLoja, filterCRM, busca, sortCol, sortDir]);

  const totalValor = linhasFiltradas.reduce(
    (s, r) => s + (r.first_purchase_value || 0),
    0,
  );

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-sm font-bold text-[#000638] flex items-center gap-2">
              <UserPlus size={16} className="text-emerald-600" />
              Aberturas do período
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {dataInicio?.split('-').reverse().join('/')} —{' '}
              {dataFim?.split('-').reverse().join('/')} ·{' '}
              {linhasFiltradas.length} clientes ·{' '}
              {fmtMoeda(totalValor)} em primeiras compras
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Filtros */}
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlass
              size={12}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente, código ou vendedor..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#000638]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-semibold text-gray-400">
              Loja:
            </span>
            <select
              value={filterLoja}
              onChange={(e) => setFilterLoja(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#000638]"
            >
              {lojas.map((l) => (
                <option key={l} value={l}>
                  {l === 'todas' ? `Todas (${lojas.length - 1})` : l}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-semibold text-gray-400">
              Origem:
            </span>
            <select
              value={filterCRM}
              onChange={(e) => setFilterCRM(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#000638]"
            >
              <option value="todos">Todos ({linhas.length})</option>
              <option value="crm">Apenas CRM ({totalCRM})</option>
              <option value="sem_crm">
                Sem CRM ({linhas.length - totalCRM})
              </option>
            </select>
          </div>
        </div>

        {/* Tabela */}
        <div className="flex-1 overflow-y-auto">
          {linhasFiltradas.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">
              Nenhuma abertura encontrada.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-gray-500 font-semibold w-[40px]">
                    #
                  </th>
                  <th
                    className="text-left px-3 py-2 text-gray-500 font-semibold cursor-pointer select-none hover:text-[#000638]"
                    onClick={() => toggleSort('person_name')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Cliente <SortIcon col="person_name" />
                    </span>
                  </th>
                  <th
                    className="text-left px-3 py-2 text-gray-500 font-semibold cursor-pointer select-none hover:text-[#000638]"
                    onClick={() => toggleSort('branch_name')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Loja <SortIcon col="branch_name" />
                    </span>
                  </th>
                  <th
                    className="text-left px-3 py-2 text-gray-500 font-semibold cursor-pointer select-none hover:text-[#000638]"
                    onClick={() => toggleSort('seller_name')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Vendedor <SortIcon col="seller_name" />
                    </span>
                  </th>
                  <th
                    className="text-center px-3 py-2 text-gray-500 font-semibold cursor-pointer select-none hover:text-[#000638]"
                    onClick={() => toggleSort('first_purchase_date')}
                  >
                    <span className="inline-flex items-center gap-1 justify-center">
                      1ª Compra <SortIcon col="first_purchase_date" />
                    </span>
                  </th>
                  <th
                    className="text-right px-3 py-2 text-gray-500 font-semibold cursor-pointer select-none hover:text-[#000638]"
                    onClick={() => toggleSort('first_purchase_value')}
                  >
                    <span className="inline-flex items-center gap-1 justify-end">
                      Valor <SortIcon col="first_purchase_value" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {linhasFiltradas.map((r, i) => (
                  <tr
                    key={`${r.person_code}-${i}`}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-3 py-2 text-gray-400 font-mono">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-800 truncate max-w-[180px]">
                          {r.person_name}
                        </span>
                        {r.match_source === 'clickup_phone' && (
                          <span
                            className="inline-flex items-center gap-0.5 bg-sky-50 text-sky-700 border border-sky-200 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                            title="Cliente atribuído via match de telefone com lead do ClickUp (CRM)"
                          >
                            CRM
                          </span>
                        )}
                      </div>
                      {r.person_code && (
                        <div className="text-[10px] text-gray-400">
                          #{r.person_code}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.branch_short && (
                        <span className="inline-block bg-gray-100 text-gray-600 text-[9px] font-mono px-1.5 py-0.5 rounded mr-1.5">
                          {r.branch_short}
                        </span>
                      )}
                      {r.branch_name}
                    </td>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-[200px]">
                      {r.seller_name}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600">
                      <span className="inline-flex items-center gap-1">
                        <CalendarBlank size={11} className="text-gray-400" />
                        {fmtData(r.first_purchase_date)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-600">
                      {fmtMoeda(r.first_purchase_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {linhasFiltradas.length > 0 && (
                <tfoot className="bg-gray-50 border-t border-gray-200 sticky bottom-0">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right font-bold text-gray-700">
                      TOTAL ({linhasFiltradas.length} clientes)
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-[#000638]">
                      {fmtMoeda(totalValor)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal de clientes do vendedor ──────────────────────────────────────────
function SellerCustomersModal({ seller, dataInicio, dataFim, onClose }) {
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [totalNFs, setTotalNFs] = useState(0);
  const [totalNFsGross, setTotalNFsGross] = useState(0);
  const [totalCredev, setTotalCredev] = useState(0);
  const [expanded, setExpanded] = useState(null); // person_code do cliente expandido

  React.useEffect(() => {
    if (!seller) return;
    setLoading(true);
    setErro('');
    setExpanded(null);
    apiPostLocal('/api/crm/seller-customers', {
      sellerCode: seller.seller_code,
      datemin: dataInicio,
      datemax: dataFim,
    })
      .then((data) => {
        setClientes(data.clientes || []);
        setTotalNFs(data.totalNFs || 0);
        setTotalNFsGross(data.totalNFsGross || data.totalNFs || 0);
        setTotalCredev(data.totalCredev || 0);
      })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false));
  }, [seller, dataInicio, dataFim]);

  const credevValueTotal = clientes.reduce(
    (s, c) => s + (c.credev_value || 0),
    0,
  );
  const faturamentoLiquido = clientes.reduce(
    (s, c) => s + (c.total_value || 0),
    0,
  );

  if (!seller) return null;

  const toggleExpand = (key) =>
    setExpanded((prev) => (prev === key ? null : key));

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-sm font-bold text-[#000638] flex items-center gap-2">
              <User size={16} />
              Clientes de {seller.seller_name}
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {dataInicio?.split('-').reverse().join('/')} —{' '}
              {dataFim?.split('-').reverse().join('/')}
              {!loading &&
                ` · ${clientes.length} clientes · ${totalNFs} vendas`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
              <Spinner size={18} className="animate-spin" />
              <span className="text-xs">Buscando clientes...</span>
            </div>
          ) : erro ? (
            <p className="text-xs text-red-500 py-8 text-center">{erro}</p>
          ) : clientes.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">
              Nenhum cliente encontrado neste período.
            </p>
          ) : (
            <div className="space-y-0">
              {/* Totalizador */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="bg-[#000638]/5 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-[#000638]">
                    {clientes.length}
                  </div>
                  <div className="text-[10px] text-gray-500">Clientes</div>
                </div>
                <div className="bg-[#000638]/5 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-[#000638]">
                    {totalNFs}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Vendas
                    {totalCredev > 0 && (
                      <span className="text-gray-400">
                        {' '}
                        ({totalNFsGross} − {totalCredev})
                      </span>
                    )}
                  </div>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-red-600">
                    −{fmtMoeda(credevValueTotal)}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    CREDEV
                    {totalCredev > 0 && (
                      <span className="text-gray-400"> · {totalCredev} NF</span>
                    )}
                  </div>
                </div>
                <div className="bg-[#000638]/5 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-[#000638]">
                    {fmtMoeda(faturamentoLiquido)}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Faturamento líquido
                  </div>
                </div>
              </div>

              {/* Lista de clientes */}
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-500 font-semibold">
                      #
                    </th>
                    <th className="text-left px-3 py-2 text-gray-500 font-semibold">
                      Cliente
                    </th>
                    <th className="text-right px-3 py-2 text-gray-500 font-semibold">
                      Faturamento
                    </th>
                    <th className="text-center px-3 py-2 text-gray-500 font-semibold">
                      Últ. Compra
                    </th>
                    <th className="text-right px-3 py-2 text-gray-500 font-semibold">
                      Vendas
                    </th>
                    <th className="text-right px-3 py-2 text-gray-500 font-semibold">
                      Peças
                    </th>
                    <th className="text-right px-3 py-2 text-gray-500 font-semibold">
                      TM
                    </th>
                    <th className="text-center px-3 py-2 text-gray-500 font-semibold w-[40px]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {clientes.map((c, i) => {
                    const key = c.person_code || i;
                    const isExpanded = expanded === key;
                    return (
                      <React.Fragment key={key}>
                        <tr
                          className={`hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-blue-50/50' : ''}`}
                        >
                          <td className="px-3 py-2 text-gray-400 font-mono">
                            {i + 1}
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-gray-800 truncate max-w-[180px]">
                              {c.person_name}
                            </div>
                            <div className="text-[10px] text-gray-400">
                              {c.person_code && <span>#{c.person_code}</span>}
                              {c.person_code && c.person_cpf_cnpj && (
                                <span> · </span>
                              )}
                              {c.person_cpf_cnpj && (
                                <span>{c.person_cpf_cnpj}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-[#000638]">
                            {fmtMoeda(c.total_value)}
                            {c.credev_value > 0 && (
                              <div className="text-[10px] font-medium text-red-500">
                                CREDEV −{fmtMoeda(c.credev_value)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center text-gray-600">
                            <span className="inline-flex items-center gap-1">
                              <CalendarBlank
                                size={11}
                                className="text-gray-400"
                              />
                              {fmtData(c.last_purchase)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">
                            {c.total_qty}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">
                            {fmtNum(c.total_items)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {c.total_qty > 0
                              ? fmtMoeda(c.total_value / c.total_qty)
                              : '-'}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <button
                              onClick={() => toggleExpand(key)}
                              className={`p-1 rounded transition-colors ${isExpanded ? 'bg-[#000638] text-white' : 'hover:bg-[#000638]/10 text-gray-400 hover:text-[#000638]'}`}
                              title="Ver detalhes das compras"
                            >
                              <ListBullets size={13} />
                            </button>
                          </td>
                        </tr>
                        {/* Detalhes expandidos — NFs + Produtos */}
                        {isExpanded && c.invoices && c.invoices.length > 0 && (
                          <tr>
                            <td colSpan={8} className="p-0">
                              <div className="bg-gradient-to-b from-blue-50/80 to-white px-6 py-3 border-y border-blue-100">
                                <p className="text-[10px] font-bold text-[#000638] uppercase tracking-wide mb-2">
                                  Notas Fiscais ({c.invoices.length})
                                </p>
                                <div className="space-y-2">
                                  {c.invoices.map((inv, j) => (
                                    <div
                                      key={`${inv.invoice_code}-${j}`}
                                      className="bg-white rounded-lg border border-gray-100 p-2.5"
                                    >
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-3">
                                          <span className="text-[10px] font-mono text-gray-500">
                                            NF {inv.invoice_code}
                                          </span>
                                          <span className="text-[10px] text-gray-400 flex items-center gap-1">
                                            <CalendarBlank size={10} />{' '}
                                            {fmtData(inv.issue_date)}
                                          </span>
                                          {inv.operation_name && (
                                            <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                                              {inv.operation_name}
                                            </span>
                                          )}
                                        </div>
                                        <span className="text-[11px] font-bold text-[#000638]">
                                          {fmtMoeda(inv.total_value)}
                                        </span>
                                      </div>
                                      {/* Produtos */}
                                      {inv.produtos &&
                                        inv.produtos.length > 0 && (
                                          <div className="mt-1.5 border-t border-gray-50 pt-1.5">
                                            <table className="w-full text-[10px]">
                                              <thead>
                                                <tr className="text-gray-400">
                                                  <th className="text-left py-0.5 font-medium">
                                                    Produto
                                                  </th>
                                                  <th className="text-right py-0.5 font-medium w-[50px]">
                                                    Qtd
                                                  </th>
                                                  <th className="text-right py-0.5 font-medium w-[80px]">
                                                    Unit.
                                                  </th>
                                                  <th className="text-right py-0.5 font-medium w-[80px]">
                                                    Total
                                                  </th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {inv.produtos.map((p, k) => (
                                                  <tr
                                                    key={k}
                                                    className="text-gray-600"
                                                  >
                                                    <td
                                                      className="py-0.5 truncate max-w-[250px]"
                                                      title={`${p.code} - ${p.name}`}
                                                    >
                                                      <span className="text-gray-400 font-mono mr-1">
                                                        {p.code}
                                                      </span>
                                                      {p.name}
                                                    </td>
                                                    <td className="text-right py-0.5">
                                                      {p.qty}
                                                    </td>
                                                    <td className="text-right py-0.5">
                                                      {fmtMoeda(p.unit_value)}
                                                    </td>
                                                    <td className="text-right py-0.5 font-semibold">
                                                      {fmtMoeda(p.total_value)}
                                                    </td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tabela completa faturamento TOTVS por vendedor ─────────────────────────
function SellersTotalsTable({
  sellersTotals,
  loading,
  vendedoresDoModulo,
  vendedoresMap,
  periodoLabel,
  onRefresh,
  dataInicio,
  dataFim,
  openingsMap,
  reativacoesMap,
}) {
  const [busca, setBusca] = useState('');
  const [sortCol, setSortCol] = useState('invoice_value');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState(null);
  const [lojaFiltro, setLojaFiltro] = useState('todas'); // 'todas' | branch_code

  // Lista única de lojas presentes (pra montar o filtro)
  const lojasUnicas = useMemo(() => {
    if (!sellersTotals || !Array.isArray(sellersTotals)) return [];
    const map = new Map();
    for (const s of sellersTotals) {
      if (!s.branch_code) continue;
      if (!map.has(s.branch_code)) {
        map.set(s.branch_code, {
          code: s.branch_code,
          name: s.branch_name,
          short: s.branch_short,
        });
      }
    }
    return [...map.values()].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'pt-BR'),
    );
  }, [sellersTotals]);

  const filtrados = useMemo(() => {
    if (!sellersTotals || !Array.isArray(sellersTotals)) return [];
    let list = sellersTotals.filter(
      (s) => s.seller_name && s.invoice_value > 0,
    );
    // Filtra por módulo: só vendedores do módulo selecionado
    if (vendedoresDoModulo && vendedoresDoModulo.size > 0) {
      list = list.filter((s) => vendedoresDoModulo.has(Number(s.seller_code)));
    }
    // Filtra por loja
    if (lojaFiltro !== 'todas') {
      const branchCode = Number(lojaFiltro);
      list = list.filter((s) => Number(s.branch_code) === branchCode);
    }
    // Injeta aberturas, reativações e flag inativo no objeto do vendedor
    list = list.map((s) => {
      const vInfo = vendedoresMap?.byTotvsId?.[s.seller_code];
      const inativo = vInfo && vInfo.ativo === false;
      return {
        ...s,
        openings: openingsMap?.[Number(s.seller_code)] ?? 0,
        reativacoes: reativacoesMap?.[Number(s.seller_code)] ?? 0,
        _inativo: inativo,
      };
    });
    if (busca.trim()) {
      const q = busca.toLowerCase();
      list = list.filter((s) => s.seller_name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      const va = a[sortCol] ?? 0;
      const vb = b[sortCol] ?? 0;
      if (typeof va === 'string')
        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? va - vb : vb - va;
    });
    return list;
  }, [
    sellersTotals,
    busca,
    sortCol,
    sortAsc,
    vendedoresDoModulo,
    openingsMap,
    reativacoesMap,
    vendedoresMap,
    lojaFiltro,
  ]);

  const totais = useMemo(() => {
    if (!filtrados.length) return null;
    return {
      invoice_qty: filtrados.reduce((s, r) => s + (r.invoice_qty || 0), 0),
      invoice_value: filtrados.reduce((s, r) => s + (r.invoice_value || 0), 0),
      itens_qty: filtrados.reduce((s, r) => s + (r.itens_qty || 0), 0),
      openings: filtrados.reduce((s, r) => s + (r.openings || 0), 0),
      reativacoes: filtrados.reduce((s, r) => s + (r.reativacoes || 0), 0),
    };
  }, [filtrados]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else {
      setSortCol(col);
      setSortAsc(false);
    }
  };

  const SortIcon = ({ col }) =>
    sortCol === col ? (
      sortAsc ? (
        <CaretUp size={10} weight="bold" />
      ) : (
        <CaretDown size={10} weight="bold" />
      )
    ) : null;

  return (
    <div>
      <div className="overflow-hidden">
        {/* Filtros: busca + loja */}
        <div className="p-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <MagnifyingGlass
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder="Buscar vendedor..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#000638]"
            />
          </div>
          {lojasUnicas.length > 1 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500 uppercase font-medium">
                Loja:
              </span>
              <select
                value={lojaFiltro}
                onChange={(e) => setLojaFiltro(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#000638]"
              >
                <option value="todas">Todas ({lojasUnicas.length})</option>
                {lojasUnicas.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.short ? `[${l.short}] ` : ''}
                    {l.name}
                  </option>
                ))}
              </select>
              {lojaFiltro !== 'todas' && (
                <button
                  onClick={() => setLojaFiltro('todas')}
                  className="text-[10px] text-gray-400 hover:text-gray-700 px-1"
                  title="Limpar filtro de loja"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
            <Spinner size={18} className="animate-spin" />
            <span className="text-xs">Carregando faturamento TOTVS...</span>
          </div>
        ) : !filtrados.length ? (
          <p className="text-xs text-gray-400 py-8 text-center">
            Sem dados de faturamento.
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 sticky top-0 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 text-gray-500 font-semibold">
                    #
                  </th>
                  <th
                    className="text-left px-3 py-2 text-gray-600 font-semibold cursor-pointer hover:text-[#000638] select-none"
                    onClick={() => toggleSort('seller_name')}
                  >
                    Vendedor <SortIcon col="seller_name" />
                  </th>
                  <th
                    className="text-left px-3 py-2 text-gray-600 font-semibold cursor-pointer hover:text-[#000638] select-none"
                    onClick={() => toggleSort('branch_name')}
                  >
                    Loja <SortIcon col="branch_name" />
                  </th>
                  <th
                    className="text-right px-3 py-2 text-[#000638] font-semibold cursor-pointer hover:text-[#000638] select-none bg-[#000638]/[0.04]"
                    onClick={() => toggleSort('invoice_value')}
                  >
                    Faturamento <SortIcon col="invoice_value" />
                  </th>
                  <th
                    className="text-right px-3 py-2 text-gray-500 font-semibold cursor-pointer hover:text-[#000638] select-none"
                    onClick={() => toggleSort('invoice_qty')}
                  >
                    Vendas <SortIcon col="invoice_qty" />
                  </th>
                  <th
                    className="text-right px-3 py-2 text-gray-500 font-semibold cursor-pointer hover:text-[#000638] select-none"
                    onClick={() => toggleSort('itens_qty')}
                  >
                    Peças <SortIcon col="itens_qty" />
                  </th>
                  <th
                    className="text-right px-3 py-2 text-gray-500 font-semibold cursor-pointer hover:text-[#000638] select-none"
                    onClick={() => toggleSort('tm')}
                  >
                    TM <SortIcon col="tm" />
                  </th>
                  <th
                    className="text-right px-3 py-2 text-gray-500 font-semibold cursor-pointer hover:text-[#000638] select-none"
                    onClick={() => toggleSort('pa')}
                  >
                    PA <SortIcon col="pa" />
                  </th>
                  <th
                    className="text-right px-3 py-2 text-gray-500 font-semibold cursor-pointer hover:text-[#000638] select-none"
                    onClick={() => toggleSort('pmpv')}
                  >
                    PMPV <SortIcon col="pmpv" />
                  </th>
                  <th
                    className="text-right px-3 py-2 text-gray-500 font-semibold cursor-pointer hover:text-[#000638] select-none"
                    onClick={() => toggleSort('openings')}
                  >
                    <span className="flex items-center justify-end gap-1">
                      <UserPlus size={11} /> Aberturas{' '}
                      <SortIcon col="openings" />
                    </span>
                  </th>
                  <th
                    className="text-right px-3 py-2 text-gray-500 font-semibold cursor-pointer hover:text-[#000638] select-none"
                    onClick={() => toggleSort('reativacoes')}
                  >
                    <span className="flex items-center justify-end gap-1">
                      <ArrowsClockwise size={11} /> Reativações{' '}
                      <SortIcon col="reativacoes" />
                    </span>
                  </th>
                  <th className="text-center px-3 py-2 text-gray-500 font-semibold w-[60px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtrados.map((s, idx) => (
                  <tr
                    key={s.seller_code}
                    className={`transition-colors ${
                      idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
                    } hover:bg-[#000638]/[0.04]`}
                  >
                    <td className="px-3 py-2 text-gray-400 font-mono">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2 font-semibold text-gray-800 max-w-[200px] truncate">
                      {s.seller_name}
                      {s._inativo && (
                        <span className="text-gray-400 font-normal text-[10px] ml-1">
                          (inativo)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                      {s.branch_name ? (
                        <span className="inline-flex items-center gap-1">
                          {s.branch_short && (
                            <span className="font-mono text-[9px] text-gray-400 bg-gray-100 px-1 py-0.5 rounded">
                              {s.branch_short}
                            </span>
                          )}
                          <span className="text-[11px]">{s.branch_name}</span>
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-[#000638] bg-[#000638]/[0.025]">
                      {fmtMoeda(s.invoice_value)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {fmtNum(s.invoice_qty)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {fmtNum(s.itens_qty)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {fmtMoeda(s.tm)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {(s.pa || 0).toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {fmtMoeda(s.pmpv)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.openings > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold text-[11px]">
                          <UserPlus size={10} /> {s.openings}
                        </span>
                      ) : (
                        <span className="text-gray-300">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.reativacoes > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-bold text-[11px]">
                          <ArrowsClockwise size={10} /> {s.reativacoes}
                        </span>
                      ) : (
                        <span className="text-gray-300">0</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <button
                        onClick={() => setSelectedSeller(s)}
                        className="p-1 rounded hover:bg-[#000638]/10 text-gray-400 hover:text-[#000638] transition-colors"
                        title="Ver clientes"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {totais && (
                <tfoot className="bg-gray-100 border-t-2 border-gray-300 sticky bottom-0">
                  <tr className="font-bold">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-gray-800">
                      TOTAL ({filtrados.length} vendedores)
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right text-[#000638] bg-[#000638]/[0.04]">
                      {fmtMoeda(totais.invoice_value)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {fmtNum(totais.invoice_qty)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {fmtNum(totais.itens_qty)}
                    </td>
                    <td className="px-3 py-2" colSpan={3} />
                    <td className="px-3 py-2 text-right">
                      {totais.openings > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold text-[11px]">
                          <UserPlus size={10} /> {totais.openings}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {totais.reativacoes > 0 ? (
                        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-bold text-[11px]">
                          <ArrowsClockwise size={10} /> {totais.reativacoes}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {selectedSeller && (
        <SellerCustomersModal
          seller={selectedSeller}
          dataInicio={dataInicio}
          dataFim={dataFim}
          onClose={() => setSelectedSeller(null)}
        />
      )}
    </div>
  );
}

// ─── Card de Meta de Loja (varejo) ──────────────────────────────────────────
function tierAlcancado(realizado, meta) {
  if (!meta) return null;
  if (realizado >= meta.diamante) return 'DIAMANTE';
  if (realizado >= meta.ouro) return 'OURO';
  if (realizado >= meta.prata) return 'PRATA';
  if (realizado >= meta.bronze) return 'BRONZE';
  return null;
}
const TIER_META = {
  DIAMANTE: { emoji: '💎', barColor: 'bg-cyan-500', badge: 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200' },
  OURO:     { emoji: '🥇', barColor: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
  PRATA:    { emoji: '🥈', barColor: 'bg-slate-400', badge: 'bg-slate-50 text-slate-700 ring-1 ring-slate-300' },
  BRONZE:   { emoji: '🥉', barColor: 'bg-orange-400', badge: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
};

function BranchMetaCard({ titulo, branches, metaInfo }) {
  const sorted = useMemo(() => {
    return (branches || []).slice().sort((a, b) => {
      const oa = a.meta?.ouro || 0;
      const ob = b.meta?.ouro || 0;
      const pa = oa > 0 ? a.invoice_value / oa : -1;
      const pb = ob > 0 ? b.invoice_value / ob : -1;
      return pb - pa;
    });
  }, [branches]);

  const totals = useMemo(() => {
    let real = 0;
    let bronze = 0, prata = 0, ouro = 0, diamante = 0;
    for (const b of sorted) {
      real += b.invoice_value;
      bronze += b.meta?.bronze || 0;
      prata += b.meta?.prata || 0;
      ouro += b.meta?.ouro || 0;
      diamante += b.meta?.diamante || 0;
    }
    return { real, bronze, prata, ouro, diamante };
  }, [sorted]);

  const totalTier = tierAlcancado(totals.real, totals);
  const pctTotal = totals.ouro > 0 ? (totals.real / totals.ouro) * 100 : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#000638] to-[#1e1b4b] text-white px-3 py-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">{titulo}</h3>
          {metaInfo?.label && (
            <p className="text-[10px] text-blue-200 font-mono">
              {metaInfo.label}
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wide text-blue-200">
            Total
          </div>
          <div className="text-sm font-bold tabular-nums">
            {fmtMoeda(totals.real)}
          </div>
          {totals.ouro > 0 && (
            <div className="text-[10px] text-blue-200">
              <span
                className={
                  pctTotal >= 100
                    ? 'text-emerald-300 font-bold'
                    : 'text-blue-200'
                }
              >
                {pctTotal.toFixed(0)}%
              </span>{' '}
              da OURO
              {totalTier && (
                <span className="ml-1">{TIER_META[totalTier].emoji}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-gray-400 py-6 text-center">Sem dados</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {sorted.map((b) => {
            const meta = b.meta;
            const real = b.invoice_value;
            const tier = tierAlcancado(real, meta);
            const pctOuro = meta?.ouro > 0 ? (real / meta.ouro) * 100 : 0;
            // Bar normalizado pra DIAMANTE (escada completa)
            const max = meta?.diamante || 0;
            const pctBar = max > 0 ? Math.min((real / max) * 100, 100) : 0;
            const bronzePct = max > 0 ? (meta.bronze / max) * 100 : 0;
            const prataPct = max > 0 ? (meta.prata / max) * 100 : 0;
            const ouroPct = max > 0 ? (meta.ouro / max) * 100 : 0;
            const tierCfg = tier ? TIER_META[tier] : null;

            // Próximo tier + valor faltando
            let nextTier = null;
            let nextTierValue = 0;
            if (max > 0) {
              if (real < meta.bronze) {
                nextTier = 'BRONZE';
                nextTierValue = meta.bronze;
              } else if (real < meta.prata) {
                nextTier = 'PRATA';
                nextTierValue = meta.prata;
              } else if (real < meta.ouro) {
                nextTier = 'OURO';
                nextTierValue = meta.ouro;
              } else if (real < meta.diamante) {
                nextTier = 'DIAMANTE';
                nextTierValue = meta.diamante;
              }
            }
            const falta = nextTierValue - real;
            const nextCfg = nextTier ? TIER_META[nextTier] : null;

            const pctColor =
              pctOuro >= 100
                ? 'text-emerald-600'
                : pctOuro >= 70
                  ? 'text-amber-600'
                  : pctOuro >= 40
                    ? 'text-blue-600'
                    : 'text-gray-500';

            return (
              <div key={b.seller_code} className="px-3 py-3">
                {/* Linha 1: nome + tier badge */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-[9px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded shrink-0 font-bold">
                    {b.short_name}
                  </span>
                  <span className="text-sm font-bold text-gray-900 truncate flex-1">
                    {b.seller_name}
                  </span>
                  {tierCfg ? (
                    <span
                      className={`flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${tierCfg.badge}`}
                    >
                      <span className="text-sm leading-none">{tierCfg.emoji}</span>
                      {tier}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-400 italic">
                      aguardando bronze
                    </span>
                  )}
                </div>

                {/* Linha 2: Realizado em destaque + % */}
                <div className="flex items-baseline justify-between mb-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-bold text-gray-900 tabular-nums">
                      {fmtMoeda(real)}
                    </span>
                  </div>
                  <span className={`text-lg font-bold tabular-nums ${pctColor}`}>
                    {pctOuro.toFixed(0)}%
                  </span>
                </div>

                {/* Linha 3: Barra com zonas de tier (background) + fill (foreground) */}
                {max > 0 && (
                  <>
                    <div className="relative h-3 rounded-full overflow-hidden flex bg-gray-100">
                      {/* Zonas (cores de fundo por faixa) */}
                      <div
                        className="bg-orange-50"
                        style={{ width: `${bronzePct}%` }}
                      />
                      <div
                        className="bg-slate-50"
                        style={{ width: `${prataPct - bronzePct}%` }}
                      />
                      <div
                        className="bg-yellow-50"
                        style={{ width: `${ouroPct - prataPct}%` }}
                      />
                      <div
                        className="bg-cyan-50"
                        style={{ width: `${100 - ouroPct}%` }}
                      />
                      {/* Linhas separadoras */}
                      <div
                        className="absolute inset-y-0 w-px bg-gray-300"
                        style={{ left: `${bronzePct}%` }}
                      />
                      <div
                        className="absolute inset-y-0 w-px bg-gray-300"
                        style={{ left: `${prataPct}%` }}
                      />
                      <div
                        className="absolute inset-y-0 w-px bg-gray-300"
                        style={{ left: `${ouroPct}%` }}
                      />
                      {/* Fill (progresso) */}
                      <div
                        className={`absolute inset-y-0 left-0 transition-all ${
                          tierCfg ? tierCfg.barColor : 'bg-blue-400'
                        }`}
                        style={{ width: `${pctBar}%` }}
                      />
                    </div>

                    {/* Eixo de tiers (emojis posicionados) */}
                    <div className="relative h-3 mt-0.5 text-xs">
                      <div
                        className="absolute -translate-x-1/2"
                        style={{ left: `${bronzePct}%` }}
                        title={`BRONZE ${fmtMoeda(meta.bronze)}`}
                      >
                        🥉
                      </div>
                      <div
                        className="absolute -translate-x-1/2"
                        style={{ left: `${prataPct}%` }}
                        title={`PRATA ${fmtMoeda(meta.prata)}`}
                      >
                        🥈
                      </div>
                      <div
                        className="absolute -translate-x-1/2"
                        style={{ left: `${ouroPct}%` }}
                        title={`OURO ${fmtMoeda(meta.ouro)}`}
                      >
                        🥇
                      </div>
                      <div
                        className="absolute -translate-x-full right-0"
                        title={`DIAMANTE ${fmtMoeda(meta.diamante)}`}
                      >
                        💎
                      </div>
                    </div>

                    {/* Valores dos tiers em mini-tabela */}
                    <div className="grid grid-cols-4 gap-1 mt-1 text-[9px] text-gray-500 font-mono">
                      <span
                        className={`text-center ${real >= meta.bronze ? 'text-orange-600 font-bold' : ''}`}
                      >
                        {fmtMoeda(meta.bronze)}
                      </span>
                      <span
                        className={`text-center ${real >= meta.prata ? 'text-slate-600 font-bold' : ''}`}
                      >
                        {fmtMoeda(meta.prata)}
                      </span>
                      <span
                        className={`text-center ${real >= meta.ouro ? 'text-yellow-700 font-bold' : ''}`}
                      >
                        {fmtMoeda(meta.ouro)}
                      </span>
                      <span
                        className={`text-center ${real >= meta.diamante ? 'text-cyan-700 font-bold' : ''}`}
                      >
                        {fmtMoeda(meta.diamante)}
                      </span>
                    </div>

                    {/* Próximo tier */}
                    {nextCfg && (
                      <div className="mt-1.5 text-[10px] text-gray-600 flex items-center justify-center gap-1">
                        <span>Faltam</span>
                        <span className="font-bold text-gray-800 tabular-nums">
                          {fmtMoeda(falta)}
                        </span>
                        <span>para</span>
                        <span className="font-bold">
                          {nextCfg.emoji} {nextTier}
                        </span>
                      </div>
                    )}
                    {!nextTier && (
                      <div className="mt-1.5 text-[10px] text-cyan-700 font-bold text-center">
                        💎 META DIAMANTE BATIDA!
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Card de ranking ────────────────────────────────────────────────────────
function RankingCard({ titulo, icone: Icone, entries, tipoValor }) {
  const top = entries[0]?.valor || 0;
  const total = entries.reduce((s, e) => s + (e.valor || 0), 0);

  const medalha = (idx) => {
    if (idx === 0) return '🥇';
    if (idx === 1) return '🥈';
    if (idx === 2) return '🥉';
    return null;
  };
  const barColor = (idx) => {
    if (idx === 0) return 'bg-yellow-400';
    if (idx === 1) return 'bg-slate-400';
    if (idx === 2) return 'bg-orange-400';
    return 'bg-blue-300';
  };
  const rowBg = (idx) => {
    if (idx === 1) return 'bg-slate-50/60';
    if (idx === 2) return 'bg-orange-50/60';
    return '';
  };

  const fmtVal = (v) =>
    tipoValor === 'moeda' ? fmtMoeda(v) : fmtNum(v);

  const top1 = entries[0];
  const rest = entries.slice(1);

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-[#000638] to-[#1e1b4b] text-white">
        <div className="flex items-center gap-2">
          {Icone && <Icone size={14} />}
          <h3 className="text-[12px] font-semibold">{titulo}</h3>
        </div>
        {total > 0 && (
          <span className="text-[10px] font-mono tabular-nums text-blue-100">
            Σ {fmtVal(total)}
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 py-6 text-center">Sem dados</p>
      ) : (
        <div className="p-2.5 space-y-2">
          {/* TOP 1 — destaque dourado estilo Ranking de Faturamento */}
          {top1 && (
            <div
              className={`relative rounded-lg p-3 bg-gradient-to-br from-yellow-50 via-amber-50 to-yellow-100 border-2 border-yellow-300 shadow-sm ${
                /\(inativo\)/i.test(top1.vendedor) ? 'opacity-70' : ''
              }`}
            >
              <div className="absolute -top-2 left-3">
                <span className="bg-yellow-400 text-[#5a3a00] text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full shadow">
                  TOP 1
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-yellow-400 flex items-center justify-center text-lg shadow-inner shrink-0">
                  <Trophy size={18} weight="fill" className="text-yellow-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-yellow-700 font-bold mb-0.5">
                    Líder
                  </div>
                  <div className="text-sm font-extrabold text-[#000638] truncate">
                    {top1.vendedor}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base font-extrabold text-emerald-700 tabular-nums">
                    {fmtVal(top1.valor)}
                  </div>
                  {total > 0 && (
                    <div className="text-[10px] text-yellow-700/70 tabular-nums">
                      {((top1.valor / total) * 100).toFixed(0)}% do total
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Demais posições — lista compacta */}
          {rest.map((e, i) => {
            const idx = i + 1;
            const pct = top > 0 ? (e.valor / top) * 100 : 0;
            const inativo = /\(inativo\)/i.test(e.vendedor);
            return (
              <div
                key={e.vendedor}
                className={`px-2 py-1.5 rounded ${rowBg(idx)} ${inativo ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {medalha(idx) ? (
                      <span className="text-sm leading-none shrink-0">
                        {medalha(idx)}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-gray-400 w-4 text-right shrink-0">
                        {idx + 1}
                      </span>
                    )}
                    <span
                      className={`text-xs truncate ${
                        idx < 3 ? 'font-bold text-gray-900' : 'font-medium text-gray-700'
                      }`}
                    >
                      {e.vendedor}
                    </span>
                  </div>
                  <span className="text-xs font-bold tabular-nums whitespace-nowrap text-gray-800">
                    {fmtVal(e.valor)}
                  </span>
                </div>
                <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 ${barColor(idx)} rounded-full transition-all`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                {pct > 0 && (
                  <div className="text-[9px] text-gray-400 text-right mt-0.5 tabular-nums">
                    {pct.toFixed(0)}% do líder
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Card de ranking de Aberturas (com expand de clientes) ──────────────────
function OpeningsRankingCard({ titulo, entries, vendedoresMap }) {
  const [expanded, setExpanded] = useState(null); // vendedor name or null

  const getOpenerLabel = (openerCodes, currentSellerCode) => {
    if (!openerCodes || openerCodes.length === 0) return null;
    // Se o vendedor atual está entre os openers, não precisa mostrar
    if (openerCodes.includes(currentSellerCode)) return null;
    const names = openerCodes.map((code) => {
      const info = vendedoresMap?.byTotvsId?.[code];
      const nome = info?.nome || `Vend. ${code}`;
      return info && info.ativo === false ? `${nome} (inativo)` : nome;
    });
    return names.join(', ');
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={16} className="text-[#000638]" />
        <h3 className="text-sm font-bold text-[#000638]">{titulo}</h3>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">Sem dados</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e, idx) => (
            <div key={e.vendedor}>
              <div
                className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() =>
                  setExpanded(expanded === e.vendedor ? null : e.vendedor)
                }
              >
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                  style={{ background: COLORS[idx % COLORS.length] }}
                >
                  {idx + 1}
                </span>
                <span className="text-xs font-semibold text-gray-800 truncate flex-1">
                  {e.vendedor}
                </span>
                <span className="text-xs font-bold text-[#000638]">
                  {e.valor}
                </span>
                <CaretRight
                  size={12}
                  className={`text-gray-400 transition-transform ${expanded === e.vendedor ? 'rotate-90' : ''}`}
                />
              </div>

              {expanded === e.vendedor && e.clients && e.clients.length > 0 && (
                <div className="ml-8 mt-1 mb-1 border-l-2 border-blue-200 pl-3 space-y-1">
                  {e.clients.map((c) => {
                    const opener = getOpenerLabel(
                      c.opener_codes,
                      e.seller_code,
                    );
                    return (
                      <div
                        key={c.person_code}
                        className="flex items-center gap-2 py-1 flex-wrap"
                      >
                        <User size={12} className="text-gray-400 shrink-0" />
                        <span className="text-[11px] text-gray-600 truncate">
                          {c.person_name}
                        </span>
                        <span className="text-[10px] text-gray-400 shrink-0">
                          #{c.person_code}
                        </span>
                        {c.first_purchase_date && (
                          <span className="text-[10px] text-blue-500 shrink-0">
                            {new Date(
                              c.first_purchase_date + 'T00:00:00',
                            ).toLocaleDateString('pt-BR')}
                          </span>
                        )}
                        {c.first_purchase_value > 0 && (
                          <span className="text-[10px] font-semibold text-green-600 shrink-0">
                            {c.first_purchase_value.toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </span>
                        )}
                        {c.match_source === 'clickup_phone' && (
                          <span className="text-[10px] text-sky-600 shrink-0 font-medium">
                            via ClickUp/telefone
                          </span>
                        )}
                        {opener && (
                          <span className="text-[10px] text-orange-500 shrink-0">
                            aberto por {opener}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tabela faturamento por segmento (visual tipo Power BI) ─────────────────
// Mapeia operation_code → segmento
const OP_SEGMENTO = {
  // Varejo
  510: 'varejo',
  545: 'varejo',
  546: 'varejo',
  521: 'varejo',
  522: 'varejo',
  548: 'varejo',
  // Revendedor
  7236: 'revenda',
  9122: 'revenda',
  5102: 'revenda',
  7242: 'revenda',
  // Franquia
  7234: 'franquia',
  7240: 'franquia',
  7802: 'franquia',
  // Multimarcas
  7235: 'multimarcas',
  7241: 'multimarcas',
  // Bazar
  887: 'bazar',
};

const SEGMENTO_LABEL = {
  varejo: 'VAREJO',
  revenda: 'REVENDEDOR',
  franquia: 'FRANQUIA',
  multimarcas: 'MULTIMARCA',
  business: 'BUSINESS',
  bazar: 'BAZAR',
  showroom: 'SHOWROOM',
  novidadesfranquia: 'NOVIDADES FRANQUIA',
  inbound: 'B2M INBOUND',
  ricardoeletro: 'RICARDO ELETRO',
};

function FaturamentoPorSegmento({ nfsBySegmento, periodoLabel, loading }) {
  const rows = useMemo(() => {
    if (!nfsBySegmento || !Object.keys(nfsBySegmento).length) return [];
    const total = Object.values(nfsBySegmento).reduce((a, b) => a + b, 0);
    if (total <= 0) return [];
    return Object.entries(nfsBySegmento)
      .filter(([, val]) => val > 0)
      .map(([key, val]) => ({
        key,
        label: SEGMENTO_LABEL[key] || key.toUpperCase(),
        value: val,
        pct: (val / total) * 100,
      }))
      .sort((a, b) => b.value - a.value);
  }, [nfsBySegmento]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.value, 0), [rows]);
  const maxValue = rows[0]?.value || 1;

  if (loading)
    return (
      <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
        <Spinner size={16} className="animate-spin" />
        <span className="text-xs">Carregando segmentos...</span>
      </div>
    );
  if (!rows.length) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <ChartBar size={15} className="text-[#000638]" />
        <span className="text-sm font-bold text-[#000638]">
          Faturamento por Segmento
        </span>
        <span className="text-[10px] text-gray-400 ml-1">
          {periodoLabel ? `(${periodoLabel})` : ''}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-3 py-2 text-gray-400 font-medium w-6">
                #
              </th>
              <th className="text-left px-3 py-2 text-gray-500 font-semibold">
                Ds. Tipo Cliente
              </th>
              <th className="text-left px-3 py-2 text-gray-500 font-semibold min-w-[180px]">
                Total ▼
              </th>
              <th className="text-right px-3 py-2 text-gray-500 font-semibold w-[80px]">
                %
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, idx) => {
              const barValuePct = (row.value / maxValue) * 100;
              return (
                <tr
                  key={row.key}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-3 py-2.5 text-gray-400 font-mono text-[11px]">
                    {idx + 1}.
                  </td>
                  <td className="px-3 py-2.5 font-bold text-gray-800 whitespace-nowrap">
                    {row.label}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {/* Blue bar */}
                      <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden relative">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${barValuePct}%`,
                            background:
                              'linear-gradient(90deg, #3b6fe0 0%, #4e83f5 100%)',
                          }}
                        />
                        <span className="absolute inset-0 flex items-center px-2 text-[11px] font-semibold text-white mix-blend-overlay pointer-events-none select-none">
                          {fmtMoeda(row.value)}
                        </span>
                      </div>
                      <span className="text-[11px] font-bold text-[#000638] whitespace-nowrap min-w-[90px] text-right">
                        {fmtMoeda(row.value)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      {/* Orange bar */}
                      <div className="w-16 h-5 bg-gray-100 rounded overflow-hidden relative">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${row.pct}%`,
                            background:
                              'linear-gradient(90deg, #e08f3b 0%, #f5a84e 100%)',
                          }}
                        />
                      </div>
                      <span className="text-[11px] font-semibold text-gray-700 whitespace-nowrap w-[46px] text-right">
                        {row.pct.toFixed(2)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-gray-200 bg-gray-50">
            <tr className="font-bold">
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-gray-700 text-xs">
                Total global
              </td>
              <td className="px-3 py-2.5">
                <span className="text-xs font-bold text-[#000638]">
                  {fmtMoeda(total)}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right">
                <span className="text-xs font-bold text-gray-700">100%</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────
export default function PerformanceView({
  erpData,
  modulo,
  vendedoresMap,
  sellersTotals,
  sellersTotalsGlobal,
  fatSegmentos,
  branchesTotals,
  canalTotals,
  sellersTotalsLoading,
  onRefreshSellers,
  periodoLabel,
  dataInicio,
  dataFim,
}) {
  // Conjunto canônico (ID de constants.js) — fonte da verdade da equipe do canal.
  // Quando definido (multimarcas/revenda), tem prioridade — exclui vendedores
  // legados/inválidos como "GERAL".
  const canonicoDoModuloSet = useMemo(() => {
    const setCfg = VENDEDORES_POR_MODULO[modulo];
    return setCfg instanceof Set ? setCfg : null;
  }, [modulo]);

  // Base preferencial: vendedores realmente retornados no faturamento do módulo.
  const sellerCodesFromTotalsSet = useMemo(() => {
    const set = new Set();
    const arr = sellersTotals?.periodo;
    if (Array.isArray(arr)) {
      for (const seller of arr) {
        const code = Number(seller?.seller_code);
        if (
          !Number.isNaN(code) &&
          seller?.seller_name &&
          seller?.invoice_value > 0
        ) {
          set.add(code);
        }
      }
    }
    return set;
  }, [sellersTotals]);

  // Fallback: cadastro de integração por módulo.
  const vendedoresDoModuloSet = useMemo(() => {
    const set = new Set();
    if (vendedoresMap?.byTotvsId) {
      for (const [totvsId, info] of Object.entries(vendedoresMap.byTotvsId)) {
        if (info.modulo === modulo) set.add(Number(totvsId));
      }
    }
    return set;
  }, [vendedoresMap, modulo]);

  const sellerCodesAtivosDoModuloSet = useMemo(() => {
    // Prioridade: set canônico (constants) > totals retornados > cadastro Supabase
    if (canonicoDoModuloSet && canonicoDoModuloSet.size > 0) {
      return canonicoDoModuloSet;
    }
    if (sellerCodesFromTotalsSet.size > 0) return sellerCodesFromTotalsSet;
    return vendedoresDoModuloSet;
  }, [canonicoDoModuloSet, sellerCodesFromTotalsSet, vendedoresDoModuloSet]);

  // ─── Aberturas de cadastro ─────────────────────────────────────────────────
  const [openingsData, setOpeningsData] = useState(null);
  const [openingsLoading, setOpeningsLoading] = useState(false);
  const [aperturasModalOpen, setAperturasModalOpen] = useState(false);
  const [reativacaoData, setReativacaoData] = useState(null);
  const [reativacaoLoading, setReativacaoLoading] = useState(false);
  const [reativacaoModalOpen, setReativacaoModalOpen] = useState(false);

  useEffect(() => {
    if (!dataInicio || !dataFim || !modulo) {
      setReativacaoData(null);
      return;
    }
    setReativacaoLoading(true);
    apiPostLocal('/api/crm/canal-reactivations', {
      datemin: dataInicio,
      datemax: dataFim,
      modulo,
    })
      .then((d) => setReativacaoData(d))
      .catch((e) => console.warn('[reativacao] erro:', e.message))
      .finally(() => setReativacaoLoading(false));
  }, [dataInicio, dataFim, modulo]);

  useEffect(() => {
    if (!dataInicio || !dataFim || sellerCodesAtivosDoModuloSet.size === 0) {
      setOpeningsData(null);
      return;
    }
    setOpeningsLoading(true);
    apiPostLocal('/api/crm/seller-openings', {
      sellerCodes: [...sellerCodesAtivosDoModuloSet],
      datemin: dataInicio,
      datemax: dataFim,
    })
      .then((data) => setOpeningsData(data))
      .catch((e) => console.warn('[openings] Erro:', e.message))
      .finally(() => setOpeningsLoading(false));
  }, [dataInicio, dataFim, sellerCodesAtivosDoModuloSet]);

  // Mapa sellerCode -> openings (para tabela)
  const openingsMap = useMemo(() => {
    if (!openingsData?.sellers) return {};
    const map = {};
    for (const s of openingsData.sellers) map[s.seller_code] = s.openings;
    return map;
  }, [openingsData]);

  // Mapa sellerCode -> reativações (para tabela)
  const reativacoesMap = useMemo(() => {
    if (!reativacaoData?.customers) return {};
    const map = {};
    for (const c of reativacaoData.customers) {
      const sc = c.seller_code;
      if (sc == null) continue;
      map[sc] = (map[sc] || 0) + 1;
    }
    return map;
  }, [reativacaoData]);

  // Filtra sellers-totals por módulo e gera rankings para múltiplas métricas
  const rankings = useMemo(() => {
    const filtrar = (arr) => {
      if (!arr || !Array.isArray(arr)) return [];
      let list = arr.filter((s) => s.seller_name && s.invoice_value > 0);
      if (sellerCodesAtivosDoModuloSet.size > 0) {
        list = list.filter((s) =>
          sellerCodesAtivosDoModuloSet.has(Number(s.seller_code)),
        );
      }
      return list;
    };

    const toRank = (list, campo) =>
      list
        .map((s) => {
          const vInfo = vendedoresMap?.byTotvsId?.[s.seller_code];
          const inativo = vInfo && vInfo.ativo === false;
          const nome = inativo ? `${s.seller_name} (inativo)` : s.seller_name;
          return { vendedor: nome, valor: s[campo] || 0 };
        })
        .filter((e) => e.valor > 0)
        .sort((a, b) => b.valor - a.valor);

    const periodo = filtrar(sellersTotals?.periodo);
    const mes = filtrar(sellersTotals?.mes);
    const semana = filtrar(sellersTotals?.semana);

    return {
      fatPeriodo: toRank(periodo, 'invoice_value'),
      fatMes: toRank(mes, 'invoice_value'),
      fatSemana: toRank(semana, 'invoice_value'),
      vendasPeriodo: toRank(periodo, 'invoice_qty'),
      vendasMes: toRank(mes, 'invoice_qty'),
      vendasSemana: toRank(semana, 'invoice_qty'),
      tmPeriodo: toRank(periodo, 'tm'),
      tmMes: toRank(mes, 'tm'),
      tmSemana: toRank(semana, 'tm'),
      paPeriodo: toRank(periodo, 'pa'),
      paMes: toRank(mes, 'pa'),
      paSemana: toRank(semana, 'pa'),
    };
  }, [sellersTotals, sellerCodesAtivosDoModuloSet, vendedoresMap]);

  // ── Rankings de LOJAS (varejo only) — não afeta multimarcas/revenda ──
  const branchesRankings = useMemo(() => {
    if (modulo !== 'varejo' || !branchesTotals) {
      return {
        fatPeriodo: [],
        fatMes: [],
        fatSemana: [],
        vendasPeriodo: [],
        vendasMes: [],
        vendasSemana: [],
      };
    }
    const toRank = (list, campo) =>
      (Array.isArray(list) ? list : [])
        .map((b) => ({
          vendedor: b.seller_name || `Filial ${b.seller_code}`,
          valor: b[campo] || 0,
        }))
        .filter((e) => e.valor > 0)
        .sort((a, b) => b.valor - a.valor);
    return {
      fatPeriodo: toRank(branchesTotals.periodo, 'invoice_value'),
      fatMes: toRank(branchesTotals.mes, 'invoice_value'),
      fatSemana: toRank(branchesTotals.semana, 'invoice_value'),
      vendasPeriodo: toRank(branchesTotals.periodo, 'invoice_qty'),
      vendasMes: toRank(branchesTotals.mes, 'invoice_qty'),
      vendasSemana: toRank(branchesTotals.semana, 'invoice_qty'),
    };
  }, [modulo, branchesTotals]);

  // Ranking de aberturas (derivado do openingsData)
  const openingsRanking = useMemo(() => {
    if (!openingsData?.sellers) return [];
    return openingsData.sellers
      .filter((s) => s.openings > 0)
      .map((s) => {
        const info = vendedoresMap?.byTotvsId?.[s.seller_code];
        const nomeBase = info?.nome || `Vend. ${s.seller_code}`;
        const nome =
          info && info.ativo === false ? `${nomeBase} (inativo)` : nomeBase;
        return {
          vendedor: nome,
          seller_code: s.seller_code,
          valor: s.openings,
          clients: s.clients || [],
        };
      })
      .sort((a, b) => b.valor - a.valor);
  }, [openingsData, vendedoresMap]);

  const [tabelaAberta, setTabelaAberta] = useState(false);

  // Totais gerais do período (filtrados por módulo)
  // Para VAREJO: usa branchesTotals (TOTVS direct, mesma fonte do Ranking de Faturamento)
  // Para outros módulos: usa sellersTotals (Supabase com segmentação por canal)
  const totaisGerais = useMemo(() => {
    // Lista de vendedores pra qtdVendedores e tabela detalhada (sempre via sellers-totals)
    const sellerArr = sellersTotals?.periodo;
    const sellersList = Array.isArray(sellerArr)
      ? sellerArr.filter((s) => s.seller_name && s.invoice_value > 0)
      : [];
    const sellersFiltered =
      sellerCodesAtivosDoModuloSet.size > 0
        ? sellersList.filter((s) =>
            sellerCodesAtivosDoModuloSet.has(Number(s.seller_code)),
          )
        : sellersList;

    // Totais agregados vêm do canal-totals (TOTVS direct, mesma fonte do Ranking)
    // — aplica para varejo, revenda e multimarcas.
    if (canalTotals && canalTotals.modulo === modulo) {
      return {
        faturamento: canalTotals.invoice_value || 0,
        vendas: canalTotals.invoice_qty || 0,
        pecas: canalTotals.itens_qty || 0,
        tm: canalTotals.tm || 0,
        pa: canalTotals.pa || 0,
        qtdVendedores: sellersFiltered.length,
        dados: sellersFiltered,
      };
    }

    // Outros módulos: agregação a partir de sellers-totals
    if (!sellersFiltered.length) return null;
    const faturamento = sellersFiltered.reduce(
      (s, r) => s + (r.invoice_value || 0),
      0,
    );
    const vendas = sellersFiltered.reduce(
      (s, r) => s + (r.invoice_qty || 0),
      0,
    );
    const pecas = sellersFiltered.reduce((s, r) => s + (r.itens_qty || 0), 0);
    const tm = vendas > 0 ? faturamento / vendas : 0;
    const pa = vendas > 0 ? pecas / vendas : 0;
    return {
      faturamento,
      vendas,
      pecas,
      tm,
      pa,
      qtdVendedores: sellersFiltered.length,
      dados: sellersFiltered,
    };
  }, [
    modulo,
    canalTotals,
    sellerCodesAtivosDoModuloSet,
    sellersTotals,
  ]);

  return (
    <div className="space-y-4">
      {/* KPI Cards resumo */}
      {sellersTotalsLoading ? (
        <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
          <Spinner size={18} className="animate-spin" />
          <span className="text-xs">Carregando indicadores...</span>
        </div>
      ) : totaisGerais ? (
        <>
          <div className="flex items-center gap-2 mb-1">
            <ChartBar size={16} className="text-[#000638]" />
            <h2 className="text-sm font-bold text-[#000638]">Resumo Geral</h2>
            <span className="text-[10px] text-gray-400">
              {periodoLabel
                ? `(${periodoLabel})`
                : `(Ano ${new Date().getFullYear()})`}
            </span>
            {onRefreshSellers && (
              <button
                onClick={onRefreshSellers}
                disabled={sellersTotalsLoading}
                className="ml-auto flex items-center gap-1 text-[10px] text-gray-500 hover:text-[#000638] px-2 py-1 rounded border border-gray-200 hover:border-[#000638]/30 disabled:opacity-50 transition-colors"
                title="Atualizar"
              >
                <ArrowsClockwise
                  size={12}
                  className={sellersTotalsLoading ? 'animate-spin' : ''}
                />
                Atualizar
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <KpiCard
              label="Faturamento"
              valor={fmtMoeda(totaisGerais.faturamento)}
              sub={`${totaisGerais.qtdVendedores} vendedores`}
              icone={CurrencyDollar}
              color="green"
            />
            <KpiCard
              label="Vendas"
              valor={fmtNum(totaisGerais.vendas)}
              sub="total de notas"
              icone={ShoppingCart}
              color="indigo"
            />
            <KpiCard
              label="Peças"
              valor={fmtNum(totaisGerais.pecas)}
              sub="itens vendidos"
              icone={Package}
              color="sky"
            />
            <KpiCard
              label="Ticket Médio"
              valor={fmtMoeda(totaisGerais.tm)}
              sub="fat / vendas"
              icone={CurrencyDollar}
              color="blue"
            />
            <KpiCard
              label="PA"
              valor={totaisGerais.pa.toFixed(1)}
              sub="peças / atendimento"
              icone={TrendUp}
              color="purple"
            />
            <KpiCard
              label="Aberturas"
              valor={fmtNum(openingsData?.total ?? 0)}
              sub="novos clientes"
              icone={UserPlus}
              color="rose"
              loading={openingsLoading}
              onClick={
                !openingsLoading && (openingsData?.total ?? 0) > 0
                  ? () => setAperturasModalOpen(true)
                  : undefined
              }
            />
            <KpiCard
              label="Reativações"
              valor={fmtNum(reativacaoData?.count ?? 0)}
              sub="60+ dias inativos"
              icone={ArrowsClockwise}
              color="amber"
              loading={reativacaoLoading}
              onClick={
                !reativacaoLoading && (reativacaoData?.count ?? 0) > 0
                  ? () => setReativacaoModalOpen(true)
                  : undefined
              }
            />
          </div>
        </>
      ) : null}

      {/* Tabela completa de faturamento (colapsável) */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setTabelaAberta(!tabelaAberta)}
          className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <CaretRight
            size={14}
            weight="bold"
            className={`text-[#000638] transition-transform ${tabelaAberta ? 'rotate-90' : ''}`}
          />
          <Table size={14} className="text-[#000638]" />
          <span className="text-sm font-bold text-[#000638]">
            Detalhes por Vendedor
          </span>
          <span className="text-[10px] text-gray-400">
            {periodoLabel
              ? `(${periodoLabel})`
              : `(Ano ${new Date().getFullYear()})`}
          </span>
          {totaisGerais && (
            <span className="text-[10px] text-gray-400 ml-auto">
              {totaisGerais.qtdVendedores} vendedores ·{' '}
              {fmtMoeda(totaisGerais.faturamento)}
            </span>
          )}
        </button>
        {tabelaAberta && (
          <SellersTotalsTable
            sellersTotals={sellersTotals?.periodo}
            loading={sellersTotalsLoading}
            vendedoresDoModulo={sellerCodesAtivosDoModuloSet}
            vendedoresMap={vendedoresMap}
            periodoLabel={periodoLabel}
            onRefresh={onRefreshSellers}
            dataInicio={dataInicio}
            dataFim={dataFim}
            openingsMap={openingsMap}
            reativacoesMap={reativacoesMap}
          />
        )}
      </div>

      {/* Faturamento por LOJA com Meta — só varejo */}
      {modulo === 'varejo' && (
        <>
          <div>
            <h2 className="text-sm font-bold text-[#000638] mb-2 flex items-center gap-2">
              <CurrencyDollar size={16} /> Faturamento por Loja vs Meta
              <span className="text-[10px] font-normal text-gray-400 ml-1">
                (B2C · BRONZE 3% · PRATA 4% · OURO 5% · DIAMANTE 6%)
              </span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <BranchMetaCard
                titulo={periodoLabel ? 'Período' : 'Período Atual'}
                branches={branchesTotals?.periodo || []}
                metaInfo={branchesTotals?.metaPeriodo}
              />
              <BranchMetaCard
                titulo="Mês"
                branches={branchesTotals?.mes || []}
                metaInfo={branchesTotals?.metaMes}
              />
              <BranchMetaCard
                titulo="Semana"
                branches={branchesTotals?.semana || []}
                metaInfo={branchesTotals?.metaSemana}
              />
            </div>
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#000638] mb-2 flex items-center gap-2">
              <TrendUp size={16} /> Quantidade de Vendas por Loja
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <RankingCard
                titulo="Lojas — Período"
                icone={Trophy}
                entries={branchesRankings.vendasPeriodo}
                tipoValor="numero"
              />
              <RankingCard
                titulo="Lojas — Mês"
                icone={Trophy}
                entries={branchesRankings.vendasMes}
                tipoValor="numero"
              />
              <RankingCard
                titulo="Lojas — Semana"
                icone={Trophy}
                entries={branchesRankings.vendasSemana}
                tipoValor="numero"
              />
            </div>
          </div>
        </>
      )}

      {/* Rankings de Faturamento */}
      <div>
        <h2 className="text-sm font-bold text-[#000638] mb-2 flex items-center gap-2">
          <CurrencyDollar size={16} />{' '}
          {modulo === 'varejo' ? 'Faturamento por Vendedor' : 'Faturamento'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RankingCard
            titulo={
              periodoLabel
                ? 'Faturamento Período'
                : `Faturamento ${new Date().getFullYear()}`
            }
            icone={Trophy}
            entries={rankings.fatPeriodo}
            tipoValor="moeda"
          />
          <RankingCard
            titulo="Faturamento Mês"
            icone={Trophy}
            entries={rankings.fatMes}
            tipoValor="moeda"
          />
          <RankingCard
            titulo="Faturamento Semana"
            icone={Trophy}
            entries={rankings.fatSemana}
            tipoValor="moeda"
          />
        </div>
      </div>

      {/* Rankings de Qtd Vendas */}
      <div>
        <h2 className="text-sm font-bold text-[#000638] mb-2 flex items-center gap-2">
          <TrendUp size={16} /> Quantidade de Vendas
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RankingCard
            titulo={
              periodoLabel
                ? 'Vendas Período'
                : `Vendas ${new Date().getFullYear()}`
            }
            icone={Trophy}
            entries={rankings.vendasPeriodo}
            tipoValor="num"
          />
          <RankingCard
            titulo="Vendas Mês"
            icone={Trophy}
            entries={rankings.vendasMes}
            tipoValor="num"
          />
          <RankingCard
            titulo="Vendas Semana"
            icone={Trophy}
            entries={rankings.vendasSemana}
            tipoValor="num"
          />
        </div>
      </div>

      {/* Rankings de Ticket Médio */}
      <div>
        <h2 className="text-sm font-bold text-[#000638] mb-2 flex items-center gap-2">
          <TrendUp size={16} /> Ticket Médio
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RankingCard
            titulo={
              periodoLabel ? 'TM Período' : `TM ${new Date().getFullYear()}`
            }
            icone={Trophy}
            entries={rankings.tmPeriodo}
            tipoValor="moeda"
          />
          <RankingCard
            titulo="TM Mês"
            icone={Trophy}
            entries={rankings.tmMes}
            tipoValor="moeda"
          />
          <RankingCard
            titulo="TM Semana"
            icone={Trophy}
            entries={rankings.tmSemana}
            tipoValor="moeda"
          />
        </div>
      </div>

      {/* Rankings de PA */}
      <div>
        <h2 className="text-sm font-bold text-[#000638] mb-2 flex items-center gap-2">
          <TrendUp size={16} /> Peças por Atendimento (PA)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RankingCard
            titulo={
              periodoLabel ? 'PA Período' : `PA ${new Date().getFullYear()}`
            }
            icone={Trophy}
            entries={rankings.paPeriodo}
            tipoValor="num"
          />
          <RankingCard
            titulo="PA Mês"
            icone={Trophy}
            entries={rankings.paMes}
            tipoValor="num"
          />
          <RankingCard
            titulo="PA Semana"
            icone={Trophy}
            entries={rankings.paSemana}
            tipoValor="num"
          />
        </div>
      </div>

      {/* Ranking de Aberturas de Cadastro */}
      {openingsRanking.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-[#000638] mb-2 flex items-center gap-2">
            <UserPlus size={16} /> Aberturas de Cadastro
            <span className="text-[10px] text-gray-400 font-normal">
              {openingsData?.meta?.jason_openings > 0
                ? `(novos clientes no período · ${fmtNum(openingsData.meta.jason_openings)} Jason)`
                : '(novos clientes no período)'}
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <OpeningsRankingCard
              titulo={
                periodoLabel
                  ? 'Aberturas Período'
                  : `Aberturas ${new Date().getFullYear()}`
              }
              entries={openingsRanking}
              vendedoresMap={vendedoresMap}
            />
          </div>
        </div>
      )}

      {aperturasModalOpen && (
        <AperturasModal
          openingsData={openingsData}
          sellersTotals={sellersTotals?.periodo || []}
          dataInicio={dataInicio}
          dataFim={dataFim}
          onClose={() => setAperturasModalOpen(false)}
        />
      )}

      {reativacaoModalOpen && (
        <ReativacaoModal
          data={reativacaoData}
          dataInicio={dataInicio}
          dataFim={dataFim}
          onClose={() => setReativacaoModalOpen(false)}
        />
      )}
    </div>
  );
}
