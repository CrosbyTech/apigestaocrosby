import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import {
  Storefront,
  Package,
  TShirt,
  Buildings,
  Tag,
  Presentation,
  Star,
  Briefcase,
  ChartBar,
  ChartPieSlice,
  CurrencyDollar,
  CreditCard,
  MagnifyingGlass,
  Spinner,
  ArrowsClockwise,
  CalendarBlank,
  Export,
  X,
  ArrowUp,
  ArrowDown,
  Minus,
  Receipt,
} from 'phosphor-react';
import PageTitle from '../components/ui/PageTitle';
import {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from '../components/ui/cards';
import { API_BASE_URL } from '../config/constants';

const API_KEY = import.meta.env.VITE_API_KEY || '';

function formatBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatBRLCompact(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return formatBRL(n);
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const json = await res.json();
  return json.data ?? json;
}

const CANAL_CONFIG = {
  varejo: {
    label: 'Varejo',
    icon: Storefront,
    color: '#3b82f6',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    bar: 'bg-blue-500',
  },
  revenda: {
    label: 'Revenda',
    icon: Package,
    color: '#10b981',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    bar: 'bg-emerald-500',
  },
  multimarcas: {
    label: 'Multimarcas',
    icon: TShirt,
    color: '#8b5cf6',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    text: 'text-violet-700',
    bar: 'bg-violet-500',
  },
  franquia: {
    label: 'Franquia',
    icon: Buildings,
    color: '#f59e0b',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    bar: 'bg-amber-500',
  },
  bazar: {
    label: 'Bazar',
    icon: Tag,
    color: '#ef4444',
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    bar: 'bg-red-500',
  },
  showroom: {
    label: 'Showroom',
    icon: Presentation,
    color: '#0ea5e9',
    bg: 'bg-sky-50',
    border: 'border-sky-200',
    text: 'text-sky-700',
    bar: 'bg-sky-500',
  },
  novidadesfranquia: {
    label: 'Novidades Franquia',
    icon: Star,
    color: '#d97706',
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-700',
    bar: 'bg-yellow-500',
  },
  business: {
    label: 'Business',
    icon: Briefcase,
    color: '#64748b',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    text: 'text-slate-700',
    bar: 'bg-slate-500',
  },
  inbound: {
    label: 'B2M Inbound',
    icon: TShirt,
    color: '#7c3aed',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-700',
    bar: 'bg-purple-500',
  },
  inbound_david: {
    label: 'MTM Inbound David',
    icon: TShirt,
    color: '#7c3aed',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-700',
    bar: 'bg-purple-500',
  },
  inbound_rafael: {
    label: 'MTM Inbound Rafael',
    icon: TShirt,
    color: '#a21caf',
    bg: 'bg-fuchsia-50',
    border: 'border-fuchsia-200',
    text: 'text-fuchsia-700',
    bar: 'bg-fuchsia-500',
  },
  ricardoeletro: {
    label: 'Ricardo Eletro',
    icon: Storefront,
    color: '#dc2626',
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    bar: 'bg-red-500',
  },
};

const CANAL_ORDER = [
  'varejo',
  'revenda',
  'multimarcas',
  'inbound_david',
  'inbound_rafael',
  'franquia',
  'bazar',
  'showroom',
  'novidadesfranquia',
  'business',
  'ricardoeletro',
];

// Op codes de devolucao / credev
const CREDEV_OP_CODES = new Set([
  1, 2, 555, 9073, 9402, 9065, 9403, 9062, 9005, 7790, 7245, 20, 1214, 7244,
]);
const isCredev = (t) =>
  t.is_credev === true ||
  CREDEV_OP_CODES.has(t.operation_code) ||
  /credev|devolu/i.test(t.operation_name || '');

// Modal de transacoes por canal
function ModalTransacoes({
  canal,
  datemin,
  datemax,
  onClose,
  custoAds,
  custoWpp,
}) {
  const cfg = CANAL_CONFIG[canal] || {
    label: canal,
    icon: ChartBar,
    color: '#64748b',
    text: 'text-gray-700',
    bar: 'bg-gray-400',
  };
  const Icon = cfg.icon;
  const [dados, setDados] = useState(null);
  const [loadingTx, setLoadingTx] = useState(true);
  const [busca, setBusca] = useState('');
  const [sortField, setSortField] = useState('issue_date');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    const API_KEY = import.meta.env.VITE_API_KEY || '';
    setLoadingTx(true);
    fetch(API_BASE_URL + '/api/crm/transacoes-canal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ canal, datemin, datemax }),
    })
      .then((r) => r.json())
      .then((j) => setDados(j.data ?? j))
      .catch(() => setDados(null))
      .finally(() => setLoadingTx(false));
  }, [canal, datemin, datemax]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const transacoesFiltradas = useMemo(() => {
    if (!dados?.transacoes) return [];
    let list = dados.transacoes;
    if (busca) {
      const b = busca.toLowerCase();
      list = list.filter(
        (t) =>
          (t.person_name || '').toLowerCase().includes(b) ||
          (t.invoice_code || '').toLowerCase().includes(b) ||
          (t.operation_name || '').toLowerCase().includes(b) ||
          String(t.branch_code).includes(b),
      );
    }
    list = [...list].sort((a, b) => {
      let va = a[sortField];
      let vb = b[sortField];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb), 'pt-BR')
        : String(vb).localeCompare(String(va), 'pt-BR');
    });
    return list;
  }, [dados, busca, sortField, sortDir]);

  const exportarCSV = () => {
    if (!transacoesFiltradas.length) return;
    const header = [
      'Data',
      'Filial',
      'NF',
      'Cliente',
      'Cod. Cliente',
      'Operacao',
      'Vendedor',
      'Pagamento',
      'Valor',
    ];
    const rows = transacoesFiltradas.map((t) => [
      t.issue_date,
      t.branch_code,
      t.invoice_code || '-',
      '"' + (t.person_name || '').replace(/"/g, "'") + '"',
      t.person_code,
      '"' + (t.operation_name || '').replace(/"/g, "'") + '"',
      t.vendedor_nome || (t.dealer_code ? String(t.dealer_code) : '') || '',
      '"' +
        (t.payment_method || t.payment_condition || '').replace(/"/g, "'") +
        '"',
      t.total_value.toFixed(2).replace('.', ','),
    ]);
    const csv = [header, ...rows].map((r) => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transacoes-' + canal + '-' + datemin + '-' + datemax + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-gray-100"
          style={{ backgroundColor: cfg.color + '18' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: cfg.color + '25' }}
            >
              <Icon size={20} weight="duotone" style={{ color: cfg.color }} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900 text-base">{cfg.label}</h2>
              <p className="text-xs text-gray-500">
                {datemin} &rarr; {datemax}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {custoAds &&
              (() => {
                // Filtra contas do canal atual pelo campo canal_venda
                const contasDoCanal = Array.isArray(custoAds.accounts)
                  ? custoAds.accounts.filter(
                      (a) =>
                        (a.canal_venda || '').toLowerCase() ===
                        canal.toLowerCase(),
                    )
                  : [];
                const spendCanal =
                  contasDoCanal.length > 0
                    ? contasDoCanal.reduce((s, a) => s + (a.spend || 0), 0)
                    : null;
                return spendCanal !== null ? (
                  <div className="text-right mr-2 border-r border-gray-200 pr-3">
                    <p className="text-xs text-purple-500 font-medium">
                      Tráfego Pago
                    </p>
                    <p className="font-bold text-purple-700 text-sm">
                      R$ {formatBRL(spendCanal)}
                    </p>
                  </div>
                ) : null;
              })()}
            {custoWpp && (
              <span>
                {formatBRL(custoWpp.costBRL ?? custoWpp.cost * 5.8 ?? 0)}
              </span>
            )}
            {dados && (
              <div className="text-right mr-2">
                <p className="text-xs text-gray-500">
                  Total Líquido
                  {dados.credev_total > 0 && (
                    <span className="ml-1 text-orange-500 font-normal">
                      (credev -R$ {formatBRL(dados.credev_total)})
                    </span>
                  )}
                </p>
                <p className="font-bold text-gray-900 text-sm">
                  R$ {formatBRL(dados.total_liquido ?? dados.total)}
                </p>
              </div>
            )}
            <button
              onClick={exportarCSV}
              title="Exportar CSV"
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
            >
              <Export size={18} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
            >
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder="Buscar por cliente, NF, operacao, filial..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              autoFocus
            />
          </div>
          {dados && (
            <p className="text-xs text-gray-400 mt-1.5">
              {transacoesFiltradas.length} de {dados.count} transacoes
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingTx ? (
            <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
              <Spinner size={24} className="animate-spin" />
              <span className="text-sm">Carregando transacoes...</span>
            </div>
          ) : !dados ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Receipt size={40} className="mb-3 opacity-30" />
              <p className="text-sm">Erro ao carregar transacoes.</p>
            </div>
          ) : transacoesFiltradas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Receipt size={40} className="mb-3 opacity-30" />
              <p className="text-sm">Nenhuma transacao encontrada.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b border-gray-200 z-10">
                <tr>
                  {[
                    {
                      label: 'Data',
                      field: 'issue_date',
                      align: 'left',
                      px: 'px-3',
                    },
                    {
                      label: 'Filial',
                      field: 'branch_code',
                      align: 'left',
                      px: 'px-2',
                    },
                    {
                      label: 'NF',
                      field: 'invoice_code',
                      align: 'left',
                      px: 'px-2',
                    },
                    {
                      label: 'Transacao',
                      field: 'transaction_code',
                      align: 'left',
                      px: 'px-2',
                    },
                    {
                      label: 'Cliente',
                      field: 'person_name',
                      align: 'left',
                      px: 'px-3',
                    },
                    {
                      label: 'Operacao',
                      field: 'operation_name',
                      align: 'left',
                      px: 'px-3',
                    },
                    {
                      label: 'Vendedor',
                      field: 'vendedor_nome',
                      align: 'left',
                      px: 'px-3',
                    },
                  ].map(({ label, field, align, px }) => (
                    <th
                      key={field}
                      onClick={() => {
                        if (sortField === field)
                          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                        else {
                          setSortField(field);
                          setSortDir('asc');
                        }
                      }}
                      className={`text-${align} py-3 ${px} text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${sortField === field ? 'text-gray-800' : 'text-gray-400 hover:text-gray-700'}`}
                    >
                      {label}{' '}
                      <span
                        className={
                          sortField === field
                            ? 'text-gray-800'
                            : 'text-gray-300'
                        }
                      >
                        {sortField === field
                          ? sortDir === 'asc'
                            ? '▲'
                            : '▼'
                          : '↕'}
                      </span>
                    </th>
                  ))}
                  <th
                    onClick={() => {
                      if (sortField === 'payment_method')
                        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                      else {
                        setSortField('payment_method');
                        setSortDir('asc');
                      }
                    }}
                    className={`text-left py-3 px-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${sortField === 'payment_method' ? 'text-gray-800' : 'text-gray-400 hover:text-gray-700'}`}
                  >
                    Pagamento{' '}
                    <span
                      className={
                        sortField === 'payment_method'
                          ? 'text-gray-800'
                          : 'text-gray-300'
                      }
                    >
                      {sortField === 'payment_method'
                        ? sortDir === 'asc'
                          ? '▲'
                          : '▼'
                        : '↕'}
                    </span>
                  </th>
                  <th
                    onClick={() => {
                      if (sortField === 'total_value')
                        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                      else {
                        setSortField('total_value');
                        setSortDir('desc');
                      }
                    }}
                    className={`text-right py-3 px-4 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${sortField === 'total_value' ? 'text-gray-800' : 'text-gray-400 hover:text-gray-700'}`}
                  >
                    Valor{' '}
                    <span
                      className={
                        sortField === 'total_value'
                          ? 'text-gray-800'
                          : 'text-gray-300'
                      }
                    >
                      {sortField === 'total_value'
                        ? sortDir === 'asc'
                          ? '▲'
                          : '▼'
                        : '↕'}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {transacoesFiltradas.map((t, i) => {
                  const credev = isCredev(t);
                  return (
                    <tr
                      key={i}
                      className={
                        (credev
                          ? 'bg-orange-50/60'
                          : i % 2 === 0
                            ? 'bg-white'
                            : 'bg-gray-50/50') +
                        ' border-b border-gray-50 hover:bg-blue-50/30 transition-colors'
                      }
                    >
                      <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap text-xs">
                        {t.issue_date}
                      </td>
                      <td className="py-2.5 px-2 text-gray-500 text-xs">
                        {t.branch_code}
                      </td>
                      <td className="py-2.5 px-2 text-gray-500 text-xs font-mono">
                        {t.invoice_code || '\u2014'}
                      </td>
                      <td className="py-2.5 px-2 text-gray-500 text-xs font-mono">
                        {t.transaction_code || '\u2014'}
                      </td>
                      <td className="py-2.5 px-3 max-w-[180px]">
                        <p className="font-medium text-gray-800 truncate">
                          {t.person_name || '\u2014'}
                        </p>
                        <p className="text-xs text-gray-400">
                          #{t.person_code}
                        </p>
                      </td>
                      <td className="py-2.5 px-3 text-xs max-w-[150px] truncate">
                        {credev && (
                          <span className="inline-block mr-1 px-1 py-0.5 rounded text-[9px] font-bold bg-orange-100 text-orange-700 border border-orange-200">
                            CREDEV
                          </span>
                        )}
                        <span className="text-gray-500">
                          {t.operation_name || t.operation_code}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-500 text-xs font-mono">
                        {t.vendedor_nome ? (
                          <span>
                            {t.vendedor_nome}
                            {t.vendedor_ativo === false && (
                              <span className="ml-1 text-gray-400 text-[10px]">
                                (inativo)
                              </span>
                            )}
                          </span>
                        ) : t.dealer_code ? (
                          String(t.dealer_code)
                        ) : (
                          '\u2014'
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-gray-500 text-xs max-w-[120px] truncate">
                        {t.payment_method || t.payment_condition || '\u2014'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-gray-800 whitespace-nowrap">
                        R$ {formatBRL(t.total_value)}
                        {t.credev_amount > 0 && (
                          <div className="text-[10px] text-orange-500 font-normal">
                            bruto R$ {formatBRL(t.total_bruto)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 bg-white border-t-2 border-gray-200">
                <tr>
                  <td
                    colSpan={7}
                    className="py-3 px-4 text-sm font-bold text-gray-700"
                  >
                    Total Líquido ({transacoesFiltradas.length} NFs
                    {transacoesFiltradas.some((t) => t.credev_amount > 0) && (
                      <span className="ml-1 font-normal text-orange-500 text-xs">
                        {' '}
                        · credev -R${' '}
                        {formatBRL(
                          transacoesFiltradas.reduce(
                            (s, t) => s + (t.credev_amount || 0),
                            0,
                          ),
                        )}
                      </span>
                    )}
                    )
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-gray-900">
                    R${' '}
                    {formatBRL(
                      transacoesFiltradas.reduce(
                        (s, t) => s + t.total_value,
                        0,
                      ),
                    )}
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

const CanalCard = React.memo(function CanalCard({
  canal,
  valor,
  percentual,
  rank,
  onClick,
}) {
  const cfg = CANAL_CONFIG[canal] || {
    label: canal,
    icon: ChartBar,
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-700',
  };
  const Icon = cfg.icon;

  return (
    <div
      className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4 flex flex-col gap-2 cursor-pointer hover:shadow-md transition-shadow`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div
          className={`flex items-center gap-2 ${cfg.text} font-semibold text-sm`}
        >
          <Icon size={18} weight="duotone" />
          {cfg.label}
        </div>
        <span className="text-xs text-gray-400 font-medium">#{rank}</span>
      </div>
      <div className="text-2xl font-bold text-gray-800 leading-tight">
        {formatBRLCompact(valor)}
      </div>
      <div className="text-xs text-gray-500">R$ {formatBRL(valor)}</div>
      {/* barra de progresso */}
      <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${cfg.bar}`}
          style={{ width: `${Math.min(percentual, 100)}%` }}
        />
      </div>
      <div className={`text-xs font-semibold ${cfg.text}`}>
        {percentual.toFixed(1)}% do total
      </div>
    </div>
  );
});

// â”€â”€â”€ Componente: barra horizontal do gráfico â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function BarChart({ canais, total }) {
  if (!canais || canais.length === 0) return null;
  const maxVal = Math.max(...canais.map((c) => c.valor));

  return (
    <div className="flex flex-col gap-3">
      {canais.map(({ canal, valor, percentual }) => {
        const cfg = CANAL_CONFIG[canal] || {
          label: canal,
          bar: 'bg-gray-400',
          text: 'text-gray-600',
        };
        const barPct = maxVal > 0 ? (valor / maxVal) * 100 : 0;
        return (
          <div key={canal} className="flex items-center gap-3">
            <div className="w-24 text-right text-xs font-medium text-gray-600 shrink-0">
              {cfg.label}
            </div>
            <div className="flex-1 relative h-7 bg-gray-100 rounded-md overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${cfg.bar} rounded-md transition-all duration-500`}
                style={{ width: `${barPct}%` }}
              />
              <span className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-white mix-blend-normal z-10">
                {formatBRLCompact(valor)}
              </span>
            </div>
            <div className="w-14 text-right text-xs text-gray-500 shrink-0">
              {percentual.toFixed(1)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

// â”€â”€â”€ Componente: pizza SVG simples â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function PieChart({ canais }) {
  if (!canais || canais.length === 0) return null;

  const r = 60;
  const cx = 80;
  const cy = 80;
  let cumAngle = -Math.PI / 2;

  const slices = canais.map(({ canal, percentual }) => {
    const angle = (percentual / 100) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(cumAngle);
    const y1 = cy + r * Math.sin(cumAngle);
    const x2 = cx + r * Math.cos(cumAngle + angle);
    const y2 = cy + r * Math.sin(cumAngle + angle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    const midAngle = cumAngle + angle / 2;
    const lx = cx + (r + 20) * Math.cos(midAngle);
    const ly = cy + (r + 20) * Math.sin(midAngle);
    const cfg = CANAL_CONFIG[canal] || { color: '#9ca3af' };
    cumAngle += angle;
    return { path, color: cfg.color, lx, ly, canal, percentual };
  });

  return (
    <div className="flex items-center gap-6 flex-wrap">
      <svg width="160" height="160" viewBox="0 0 160 160">
        {slices.map(({ path, color, canal }) => (
          <path
            key={canal}
            d={path}
            fill={color}
            stroke="white"
            strokeWidth={2}
          />
        ))}
      </svg>
      <div className="flex flex-col gap-2">
        {canais.map(({ canal, percentual }) => {
          const cfg = CANAL_CONFIG[canal] || { label: canal, color: '#9ca3af' };
          return (
            <div key={canal} className="flex items-center gap-2 text-sm">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: cfg.color }}
              />
              <span className="text-gray-600">{cfg.label}</span>
              <span className="font-semibold text-gray-800 ml-1">
                {percentual.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// â”€â”€â”€ Componente: tabela comparativo ano a ano â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Canais criados em 2026 — sem histórico de ano anterior
const NOVOS_CANAIS = new Set(['inbound_david', 'inbound_rafael']);

function TabelaComparativo({ comp, anoAtual, anoAnterior }) {
  const allCanais = CANAL_ORDER.filter(
    (c) =>
      (comp.atual?.segmentos?.[c] ?? 0) > 0 ||
      (comp.acumulado?.segmentos?.[c] ?? 0) > 0 ||
      (comp.anoCompleto?.segmentos?.[c] ?? 0) > 0,
  );

  const totalAtual = comp.atual?.total || 0;
  const totalAcumulado = comp.acumulado?.total || 0;
  const totalAnoCompleto = comp.anoCompleto?.total || 0;
  const totalDiff = totalAtual - totalAcumulado;
  const totalPct =
    totalAcumulado !== 0 ? (totalDiff / totalAcumulado) * 100 : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-[#000638] text-white">
            <th
              className="text-center py-3 px-4 font-semibold text-xs uppercase tracking-wide"
              colSpan={6}
            >
              Comparativo {anoAnterior} × {anoAtual}
            </th>
          </tr>
          <tr className="bg-[#000638]/80 text-white">
            <th className="text-left py-2 px-4 font-semibold text-xs">Canal</th>
            <th className="text-right py-2 px-4 font-semibold text-xs">
              {anoAnterior} (Ano completo)
            </th>
            <th className="text-right py-2 px-4 font-semibold text-xs">
              {anoAnterior} Acumulado
            </th>
            <th className="text-right py-2 px-4 font-semibold text-xs">
              Real {anoAtual}
            </th>
            <th className="text-right py-2 px-4 font-semibold text-xs">
              Diferença
            </th>
            <th className="text-center py-2 px-4 font-semibold text-xs">
              Comparativo
            </th>
          </tr>
        </thead>
        <tbody>
          {allCanais.map((canal, idx) => {
            const cfg = CANAL_CONFIG[canal] || {
              label: canal,
              icon: ChartBar,
              text: 'text-gray-700',
            };
            const Icon = cfg.icon;
            const isNovo = NOVOS_CANAIS.has(canal);
            const anoCompleto = comp.anoCompleto?.segmentos?.[canal] ?? 0;
            const acumulado = comp.acumulado?.segmentos?.[canal] ?? 0;
            const atual = comp.atual?.segmentos?.[canal] ?? 0;
            const diff = isNovo ? null : atual - acumulado;
            const pct =
              isNovo ? null
              : acumulado !== 0
                ? ((atual - acumulado) / acumulado) * 100
                : atual > 0
                  ? 100
                  : null;
            const isPos = diff !== null && diff > 0;
            const isNeg = diff !== null && diff < 0;
            return (
              <tr
                key={canal}
                className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50/30 transition-colors`}
              >
                <td className="py-3 px-4">
                  <div
                    className={`flex items-center gap-2 font-semibold text-sm ${cfg.text}`}
                  >
                    <Icon size={15} weight="duotone" />
                    {cfg.label}
                  </div>
                </td>
                <td className="py-3 px-4 text-right text-gray-600">
                  {isNovo ? (
                    <span className="text-xs text-gray-400 italic">Novo canal</span>
                  ) : anoCompleto > 0 ? (
                    `R$ ${formatBRL(anoCompleto)}`
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td className="py-3 px-4 text-right text-gray-600">
                  {isNovo ? (
                    <span className="text-xs text-gray-400 italic">Novo canal</span>
                  ) : acumulado > 0 ? (
                    `R$ ${formatBRL(acumulado)}`
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td className="py-3 px-4 text-right font-semibold text-gray-800">
                  {atual > 0 ? (
                    `R$ ${formatBRL(atual)}`
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td
                  className={`py-3 px-4 text-right font-semibold ${isPos ? 'text-emerald-600' : isNeg ? 'text-red-600' : 'text-gray-400'}`}
                >
                  {isNovo ? (
                    <span className="text-gray-300">-</span>
                  ) : diff !== null && diff !== 0 ? (
                    `${isPos ? '+' : ''}R$ ${formatBRL(diff)}`
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  {isNovo ? (
                    <span className="text-gray-300 text-xs text-center block">-</span>
                  ) : pct !== null ? (
                    <div
                      className={`flex items-center justify-center gap-1 px-2 py-1 rounded-full text-xs font-bold w-fit mx-auto ${isPos ? 'bg-emerald-100 text-emerald-700' : isNeg ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {isPos ? (
                        <ArrowUp size={12} weight="bold" />
                      ) : isNeg ? (
                        <ArrowDown size={12} weight="bold" />
                      ) : (
                        <Minus size={12} weight="bold" />
                      )}
                      {Math.abs(pct).toFixed(0)}%
                    </div>
                  ) : (
                    <span className="text-gray-300 text-xs text-center block">
                      -
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
            <td className="py-3 px-4 text-gray-800 text-sm">TOTAL</td>
            <td className="py-3 px-4 text-right text-gray-700">
              {totalAnoCompleto > 0 ? `R$ ${formatBRL(totalAnoCompleto)}` : '-'}
            </td>
            <td className="py-3 px-4 text-right text-gray-700">
              {totalAcumulado > 0 ? `R$ ${formatBRL(totalAcumulado)}` : '-'}
            </td>
            <td className="py-3 px-4 text-right text-gray-900">
              R$ {formatBRL(totalAtual)}
            </td>
            <td
              className={`py-3 px-4 text-right font-bold ${totalDiff > 0 ? 'text-emerald-600' : totalDiff < 0 ? 'text-red-600' : 'text-gray-400'}`}
            >
              {totalDiff !== 0
                ? `${totalDiff > 0 ? '+' : ''}R$ ${formatBRL(totalDiff)}`
                : '-'}
            </td>
            <td className="py-3 px-4">
              {totalPct !== null ? (
                <div
                  className={`flex items-center justify-center gap-1 px-2 py-1 rounded-full text-xs font-bold w-fit mx-auto ${totalDiff > 0 ? 'bg-emerald-100 text-emerald-700' : totalDiff < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}
                >
                  {totalDiff > 0 ? (
                    <ArrowUp size={12} weight="bold" />
                  ) : totalDiff < 0 ? (
                    <ArrowDown size={12} weight="bold" />
                  ) : (
                    <Minus size={12} weight="bold" />
                  )}
                  {Math.abs(totalPct).toFixed(0)}%
                </div>
              ) : (
                '-'
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// â”€â”€â”€ Página principal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function FaturamentoCanal() {
  const hoje = new Date();
  const defaultFim = hoje.toISOString().split('T')[0];
  const defaultInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
    .toISOString()
    .split('T')[0];

  const [dataInicio, setDataInicio] = useState(defaultInicio);
  const [dataFim, setDataFim] = useState(defaultFim);
  const [loading, setLoading] = useState(false);
  const [revalidating, setRevalidating] = useState(false); // stale-while-revalidate em background
  const [loadingComp, setLoadingComp] = useState(false);
  const [loadingPag, setLoadingPag] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState(null);
  const [comp, setComp] = useState(null);
  const [pagamento, setPagamento] = useState(null);
  const [termoBusca, setTermoBusca] = useState('');
  const [aba, setAba] = useState('canal');
  const [modalCanal, setModalCanal] = useState(null);
  const [custoWpp, setCustoWpp] = useState(null); // { cost (USD), conversations }
  const [custoAds, setCustoAds] = useState(null); // { spend (USD) }
  const [erroMeta, setErroMeta] = useState(null); // erros das APIs de custo (WhatsApp/Ads)
  const [vendedores, setVendedores] = useState(null);
  const [loadingVend, setLoadingVend] = useState(false);
  const [rankingFat, setRankingFat] = useState(null);

  const anoAtual = dataInicio
    ? new Date(dataInicio + 'T00:00:00').getFullYear()
    : hoje.getFullYear();
  const anoAnterior = anoAtual - 1;

  const buscar = useCallback(async () => {
    if (!dataInicio || !dataFim) return;
    setErro('');
    setErroMeta(null);
    setCustoWpp(null);
    setCustoAds(null);

    // Stale-while-revalidate: mostra cache local imediatamente, busca fresco em background
    const cacheKey = `fatseg:${dataInicio}:${dataFim}`;
    let hasStale = false;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw);
        setResultado(cached);
        setRevalidating(true);
        hasStale = true;
      }
    } catch {}

    if (!hasStale) setLoading(true);

    // Busca o faturamento principal via faturamento-por-segmento (classifica por
    // dealer + operação — correto para revenda e franquia)
    try {
      const res = await apiPost('/api/crm/faturamento-por-segmento', {
        datemin: dataInicio,
        datemax: dataFim,
      });
      const resultadoFinal = {
        ...res,
        segmentos: res.segmentos ?? res.segmentos_bruto,
        total: res.total_liquido ?? res.total,
      };
      setResultado(resultadoFinal);
      // Salva no localStorage para próxima visita (stale)
      try {
        localStorage.setItem(cacheKey, JSON.stringify(resultadoFinal));
        // Limpa entradas antigas — mantém no máximo 8 chaves fatseg:
        const allKeys = Object.keys(localStorage).filter((k) => k.startsWith('fatseg:'));
        if (allKeys.length > 8) {
          allKeys.slice(0, allKeys.length - 8).forEach((k) => localStorage.removeItem(k));
        }
      } catch {}
    } catch (e) {
      if (!hasStale) {
        let msg =
          'Erro ao buscar faturamento: ' + (e?.message || 'Erro desconhecido');
        if (e?.message?.includes('500')) {
          msg +=
            '\nVerifique se o período selecionado possui dados disponíveis. Caso o erro persista, contate o suporte.';
        }
        setErro(msg);
      }
    } finally {
      setLoading(false);
      setRevalidating(false);
    }

    // Custos de mídia em background — não bloqueiam a exibição do faturamento
    Promise.allSettled([
      apiPost('/api/meta/conversation-costs', {
        startDate: dataInicio,
        endDate: dataFim,
      }),
      apiPost('/api/meta/ads-spend', {
        startDate: dataInicio,
        endDate: dataFim,
      }),
    ]).then(([wpp, ads]) => {
      const metaErros = [];
      if (wpp.status === 'fulfilled') {
        setCustoWpp(wpp.value?.totals ?? null);
      } else {
        console.error(
          '[Forecast] Falha WhatsApp API costs:',
          wpp.reason?.message,
        );
        metaErros.push(
          'WhatsApp API: ' + (wpp.reason?.message ?? 'erro desconhecido'),
        );
      }
      if (ads.status === 'fulfilled') {
        // Se houver contas, mostrar detalhado, senão mostrar totals
        if (
          ads.value?.accounts &&
          Array.isArray(ads.value.accounts) &&
          ads.value.accounts.length > 0
        ) {
          setCustoAds({
            spend: ads.value.totals?.spend ?? 0,
            impressions: ads.value.totals?.impressions ?? 0,
            clicks: ads.value.totals?.clicks ?? 0,
            accounts: ads.value.accounts,
          });
        } else {
          setCustoAds(ads.value?.totals ?? null);
        }
      } else {
        console.error(
          '[Forecast] Falha Tráfego Pago costs:',
          ads.reason?.message,
        );
        metaErros.push(
          'Tráfego Pago: ' + (ads.reason?.message ?? 'erro desconhecido'),
        );
      }
      if (metaErros.length > 0) setErroMeta(metaErros.join(' | '));
    });
  }, [dataInicio, dataFim]);

  const buscarVendedores = useCallback(async () => {
    if (!dataInicio || !dataFim) return;
    setLoadingVend(true);
    setErro('');
    try {
      // Usa o mesmo endpoint TOTVS para todos os canais (sem Supabase)
      const res = await apiPost('/api/totvs/sale-panel/faturamento-por-canal', {
        datemin: dataInicio,
        datemax: dataFim,
      });
      setVendedores([]); // não precisa mais de dados por vendedor individual
      setRankingFat(res ?? null);
    } catch (e) {
      setErro('Erro ao buscar dados: ' + e.message);
    } finally {
      setLoadingVend(false);
    }
  }, [dataInicio, dataFim]);

  const buscarPagamento = useCallback(async () => {
    if (!dataInicio || !dataFim) return;
    setLoadingPag(true);
    setErro('');
    try {
      const res = await apiPost('/api/crm/faturamento-por-pagamento', {
        datemin: dataInicio,
        datemax: dataFim,
      });
      setPagamento(res);
    } catch (e) {
      setErro('Erro ao buscar formas de pagamento: ' + e.message);
    } finally {
      setLoadingPag(false);
    }
  }, [dataInicio, dataFim]);

  const buscarComparativo = useCallback(async () => {
    if (!dataInicio || !dataFim) return;
    setLoadingComp(true);
    setErro('');
    try {
      const acumInicio = subtrairUmAno(dataInicio);
      const acumFim = subtrairUmAno(dataFim);
      const anoCompletoInicio = `${anoAnterior}-01-01`;
      const anoCompletoFim = `${anoAnterior}-12-31`;

      const [atual, acumulado, anoCompleto] = await Promise.all([
        apiPost('/api/totvs/sale-panel/faturamento-por-canal', {
          datemin: dataInicio,
          datemax: dataFim,
        }),
        apiPost('/api/totvs/sale-panel/faturamento-por-canal', {
          datemin: acumInicio,
          datemax: acumFim,
        }),
        apiPost('/api/totvs/sale-panel/faturamento-por-canal', {
          datemin: anoCompletoInicio,
          datemax: anoCompletoFim,
        }),
      ]);

      setComp({ atual, acumulado, anoCompleto, acumInicio, acumFim });
    } catch (e) {
      setErro('Erro ao buscar comparativo: ' + e.message);
    } finally {
      setLoadingComp(false);
    }
  }, [dataInicio, dataFim, anoAnterior]);

  React.useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // aba === 'canal' é carregado pelo effect de mount acima — não duplicar aqui
    if (
      aba === 'comparativo' &&
      !comp &&
      !loadingComp &&
      dataInicio &&
      dataFim
    ) {
      buscarComparativo();
    }
    if (
      aba === 'pagamento' &&
      !pagamento &&
      !loadingPag &&
      dataInicio &&
      dataFim
    ) {
      buscarPagamento();
    }
    if (
      aba === 'vendedores' &&
      !vendedores &&
      !loadingVend &&
      dataInicio &&
      dataFim
    ) {
      buscarVendedores();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba]);

  const canaisOrdenados = useMemo(() => {
    if (!resultado?.segmentos) return [];
    const segs = resultado.segmentos;
    const total = resultado.total || 1;
    return CANAL_ORDER.filter((c) => segs[c] != null && segs[c] > 0)
      .map((canal) => ({
        canal,
        valor: segs[canal],
        percentual: (segs[canal] / total) * 100,
      }))
      .sort((a, b) => b.valor - a.valor)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [resultado]);

  const handleBuscar = () => {
    setResultado(null);
    setComp(null);
    setPagamento(null);
    setVendedores(null);
    setRankingFat(null);
    setCustoWpp(null);
    setCustoAds(null);
    setErroMeta(null);
    // Sempre atualiza o faturamento principal (aba canal)
    buscar();
    if (aba === 'comparativo') buscarComparativo();
    else if (aba === 'vendedores') buscarVendedores();
    else if (aba === 'pagamento') buscarPagamento();
  };

  const ATALHOS = [
    {
      label: 'Este mês',
      fn: () => {
        const h = new Date();
        setDataInicio(
          new Date(h.getFullYear(), h.getMonth(), 1)
            .toISOString()
            .split('T')[0],
        );
        setDataFim(h.toISOString().split('T')[0]);
      },
    },
    {
      label: 'Mês passado',
      fn: () => {
        const h = new Date();
        setDataInicio(
          new Date(h.getFullYear(), h.getMonth() - 1, 1)
            .toISOString()
            .split('T')[0],
        );
        setDataFim(
          new Date(h.getFullYear(), h.getMonth(), 0)
            .toISOString()
            .split('T')[0],
        );
      },
    },
    {
      label: 'Últimos 3 meses',
      fn: () => {
        const h = new Date();
        setDataInicio(
          new Date(h.getFullYear(), h.getMonth() - 2, 1)
            .toISOString()
            .split('T')[0],
        );
        setDataFim(h.toISOString().split('T')[0]);
      },
    },
    {
      label: 'Este ano',
      fn: () => {
        const h = new Date();
        setDataInicio(`${h.getFullYear()}-01-01`);
        setDataFim(h.toISOString().split('T')[0]);
      },
    },
  ];

  const isLoading =
    aba === 'canal'
      ? loading
      : aba === 'comparativo'
        ? loadingComp
        : aba === 'vendedores'
          ? loadingVend
          : loadingPag;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <PageTitle
          title="Forecast"
          subtitle="Análise do faturamento separado por canal de vendas"
          icon={ChartPieSlice}
        />

        {/* â”€â”€ Filtros â”€â”€ */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">
                  Data início
                </label>
                <input
                  type="date"
                  value={dataInicio}
                  onChange={(e) => setDataInicio(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">
                  Data fim
                </label>
                <input
                  type="date"
                  value={dataFim}
                  onChange={(e) => setDataFim(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                {ATALHOS.map(({ label, fn }) => (
                  <button
                    key={label}
                    onClick={fn}
                    className="text-xs px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={handleBuscar}
                disabled={isLoading || !dataInicio || !dataFim}
                className="flex items-center gap-2 px-4 py-2 bg-[#000638] text-white rounded-lg text-sm font-medium hover:bg-[#000638]/90 disabled:opacity-50 transition-colors ml-auto"
              >
                {isLoading ? (
                  <Spinner size={16} className="animate-spin" />
                ) : (
                  <ArrowsClockwise size={16} />
                )}
                {isLoading ? 'Buscando...' : 'Buscar'}
              </button>
            </div>
          </CardContent>
        </Card>

        {/* â”€â”€ Abas â”€â”€ */}
        <div className="flex gap-1 mb-6 bg-white border border-gray-200 rounded-xl p-1 w-fit">
          {[
            { id: 'canal', label: 'Por Canal', icon: ChartPieSlice },
            {
              id: 'comparativo',
              label: `Comparativo × Ano Anterior`,
              icon: CalendarBlank,
            },
            { id: 'pagamento', label: 'Forma de Pagamento', icon: CreditCard },
            { id: 'vendedores', label: 'Métricas por Canal', icon: ChartBar },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setAba(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${aba === id ? 'bg-[#000638] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* â”€â”€ Erro â”€â”€ */}
        {erro && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {erro}
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â• ABA: POR CANAL â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {aba === 'canal' && resultado && !loading && (
          <>
            <Card className="mb-6 bg-[#000638] text-white">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex-1">
                                        <p className="text-xs text-blue-200 font-medium uppercase tracking-wide mb-1">
                      Faturamento Bruto no Período
                      {revalidating && (
                        <span className="ml-2 inline-flex items-center gap-1 opacity-70">
                          <Spinner size={10} className="animate-spin" />
                          atualizando...
                        </span>
                      )}
                    </p>
                    <p className="text-3xl font-bold">
                      R$ {formatBRL(resultado.total || 0)}
                    </p>
                    <p className="text-xs text-blue-300 mt-1">
                      {dataInicio} → {dataFim} &bull; {canaisOrdenados.length}{' '}
                      canal(is)
                    </p>
                  </div>

                  {/* Custos API WhatsApp + Tráfego */}
                  {(custoWpp || custoAds || erroMeta) && (
                    <div className="flex flex-col gap-2 text-right border-l border-blue-700 pl-4">
                      {custoWpp && (
                        <div>
                          <p className="text-xs text-yellow-300 font-medium uppercase tracking-wide">
                            WhatsApp API
                          </p>
                          <p className="text-base font-bold text-yellow-200">
                            R${' '}
                            {formatBRL(
                              custoWpp.costBRL ?? custoWpp.cost * 5.8 ?? 0,
                            )}
                          </p>
                          {(custoWpp.conversations ?? 0) > 0 && (
                            <p className="text-xs text-blue-300">
                              {custoWpp.conversations.toLocaleString('pt-BR')}{' '}
                              conversas
                            </p>
                          )}
                        </div>
                      )}
                      {custoAds && (
                        <div>
                          <p className="text-xs text-purple-300 font-medium uppercase tracking-wide">
                            Tráfego Pago (Meta Ads)
                          </p>
                          <p className="text-base font-bold text-purple-200">
                            R$ {formatBRL(custoAds.spend ?? 0)}
                          </p>
                          {(custoAds.impressions ?? 0) > 0 && (
                            <p className="text-xs text-blue-300">
                              {custoAds.impressions.toLocaleString('pt-BR')}{' '}
                              impressões
                            </p>
                          )}
                          {(custoAds.clicks ?? 0) > 0 && (
                            <p className="text-xs text-green-300">
                              {custoAds.clicks.toLocaleString('pt-BR')} cliques
                            </p>
                          )}
                          {Array.isArray(custoAds.accounts) &&
                            custoAds.accounts.length > 0 && (
                              <details className="mt-1">
                                <summary className="text-xs text-purple-400 cursor-pointer">
                                  Ver contas detalhadas
                                </summary>
                                <ul className="text-xs text-purple-200">
                                  {custoAds.accounts.map((acc) => (
                                    <li
                                      key={acc.ad_account_id}
                                      className="mb-1"
                                    >
                                      <span className="font-semibold">
                                        {acc.name}:
                                      </span>{' '}
                                      R$ {formatBRL(acc.spend ?? 0)}
                                      {acc.impressions
                                        ? ` | ${acc.impressions.toLocaleString('pt-BR')} imp.`
                                        : ''}
                                      {acc.clicks
                                        ? ` | ${acc.clicks.toLocaleString('pt-BR')} cliques`
                                        : ''}
                                      {acc.error ? (
                                        <span className="text-red-400">
                                          {' '}
                                          | Erro: {acc.error}
                                        </span>
                                      ) : (
                                        ''
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                        </div>
                      )}
                      {erroMeta && (
                        <p className="text-xs text-red-300 max-w-[200px] text-right">
                          ⚠️ Custos indisponíveis: {erroMeta}
                        </p>
                      )}
                    </div>
                  )}

                  {resultado.credev_total > 0 && (
                    <div className="flex flex-col gap-2 text-right border-l border-blue-700 pl-4">
                      <div>
                        <p className="text-xs text-red-300 font-medium uppercase tracking-wide">
                          Devoluções (Credev)
                        </p>
                        <p className="text-xl font-bold text-red-300">
                          — R$ {formatBRL(resultado.credev_total)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-emerald-300 font-medium uppercase tracking-wide">
                          Faturamento Líquido
                        </p>
                        <p className="text-xl font-bold text-emerald-300">
                          R${' '}
                          {formatBRL(
                            resultado.total_liquido ??
                              resultado.total - resultado.credev_total,
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                  <CurrencyDollar
                    size={48}
                    className="text-blue-400 opacity-60"
                  />
                </div>
              </CardContent>
            </Card>

            {canaisOrdenados.length > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-6">
                  {canaisOrdenados.map((item) => (
                    <CanalCard
                      key={item.canal}
                      {...item}
                      onClick={() => setModalCanal(item.canal)}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ChartBar size={16} />
                        Comparativo por Canal
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <BarChart canais={canaisOrdenados} />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ChartPieSlice size={16} />
                        Distribuição (%)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <PieChart canais={canaisOrdenados} />
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Tabela Detalhada</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200">
                            {[
                              '#',
                              'Canal',
                              'Faturamento',
                              '% do Total',
                              'Participação',
                            ].map((h, i) => (
                              <th
                                key={h}
                                className={`py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide ${i > 1 ? 'text-right' : 'text-left'}`}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {canaisOrdenados.map(
                            ({ canal, valor, percentual, rank }) => {
                              const cfg = CANAL_CONFIG[canal] || {
                                label: canal,
                                icon: ChartBar,
                                bar: 'bg-gray-400',
                                text: 'text-gray-600',
                              };
                              const Icon = cfg.icon;
                              return (
                                <tr
                                  key={canal}
                                  className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                >
                                  <td className="py-3 px-3 text-gray-400 font-medium">
                                    {rank}
                                  </td>
                                  <td className="py-3 px-3">
                                    <div
                                      className={`flex items-center gap-2 font-medium ${cfg.text}`}
                                    >
                                      <Icon size={16} weight="duotone" />
                                      {cfg.label}
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 text-right font-semibold text-gray-800">
                                    R$ {formatBRL(valor)}
                                  </td>
                                  <td className="py-3 px-3 text-right text-gray-600">
                                    {percentual.toFixed(2)}%
                                  </td>
                                  <td className="py-3 px-3">
                                    <div className="flex items-center justify-end">
                                      <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                          className={`h-full ${cfg.bar} rounded-full`}
                                          style={{ width: `${percentual}%` }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              );
                            },
                          )}
                          <tr className="bg-gray-50 font-semibold">
                            <td className="py-3 px-3 text-gray-400" />
                            <td className="py-3 px-3 text-gray-700">Total</td>
                            <td className="py-3 px-3 text-right text-gray-800">
                              R$ {formatBRL(resultado.total || 0)}
                            </td>
                            <td className="py-3 px-3 text-right text-gray-600">
                              100%
                            </td>
                            <td className="py-3 px-3" />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="text-center py-16 text-gray-400">
                <ChartPieSlice size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">
                  Nenhum faturamento encontrado para o período.
                </p>
              </div>
            )}
          </>
        )}

        {aba === 'canal' && !resultado && !loading && !erro && (
          <div className="text-center py-16 text-gray-400">
            <ChartPieSlice size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Selecione o período e clique em Buscar.</p>
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â• ABA: COMPARATIVO â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {aba === 'comparativo' && comp && !loadingComp && (
          <>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {(() => {
                const totalAtual = comp.atual?.total || 0;
                const totalAcumulado = comp.acumulado?.total || 0;
                const diff = totalAtual - totalAcumulado;
                const isPos = diff >= 0;
                return [
                  {
                    label: `${anoAnterior} Acumulado`,
                    sublabel: `${comp.acumInicio} → ${comp.acumFim}`,
                    valor: totalAcumulado,
                    prefix: 'R$',
                    color: 'text-gray-800',
                  },
                  {
                    label: `Real ${anoAtual}`,
                    sublabel: `${dataInicio} â†’ ${dataFim}`,
                    valor: totalAtual,
                    prefix: 'R$',
                    color: 'text-[#000638]',
                  },
                  {
                    label: 'Diferença',
                    sublabel: 'Real vs Acumulado',
                    valor: diff,
                    prefix: diff > 0 ? '+R$' : 'R$',
                    color: isPos ? 'text-emerald-600' : 'text-red-600',
                    bg: isPos ? 'bg-emerald-50' : 'bg-red-50',
                  },
                  ,
                  {
                    label: 'Credev (Devoluções)',
                    sublabel: 'NFs de devolução do período',
                    valor: comp.atual?.credev_total || 0,
                    prefix: '- R$',
                    color:
                      comp.atual?.credev_total > 0
                        ? 'text-red-600'
                        : 'text-gray-400',
                    bg: comp.atual?.credev_total > 0 ? 'bg-red-50' : undefined,
                  },
                ].map(({ label, sublabel, valor, prefix, color, bg }) => (
                  <Card key={label} className={bg}>
                    <CardContent className="pt-4 pb-4">
                      <p className="text-xs font-medium text-gray-500 mb-1">
                        {label}
                      </p>
                      <p className={`text-xl font-bold ${color}`}>
                        {prefix} {formatBRL(Math.abs(valor))}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">{sublabel}</p>
                    </CardContent>
                  </Card>
                ));
              })()}
            </div>

            <Card>
              <CardContent className="pt-4">
                <TabelaComparativo
                  comp={comp}
                  anoAtual={anoAtual}
                  anoAnterior={anoAnterior}
                />
              </CardContent>
            </Card>
          </>
        )}

        {aba === 'comparativo' && !comp && !loadingComp && !erro && (
          <div className="text-center py-16 text-gray-400">
            <CalendarBlank size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Selecione o período e clique em Buscar.</p>
          </div>
        )}

        {/* ══════════════════ ABA: FORMA DE PAGAMENTO ══════════════════ */}
        {aba === 'pagamento' &&
          pagamento &&
          !loadingPag &&
          (() => {
            const itensFiltrados = (pagamento.items || [])
              .filter(
                (item) =>
                  !termoBusca ||
                  (item.paymentDescription || '')
                    .toLowerCase()
                    .includes(termoBusca.toLowerCase()),
              )
              .sort((a, b) => (b.totalValue || 0) - (a.totalValue || 0));

            const totalGeral = (pagamento.items || []).reduce(
              (s, i) => s + (i.totalValue || 0),
              0,
            );
            const maxValor =
              itensFiltrados.length > 0
                ? Math.max(...itensFiltrados.map((i) => i.totalValue || 0))
                : 1;

            return (
              <>
                <Card className="mb-6 bg-[#000638] text-white">
                  <CardContent className="pt-5 pb-5">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div>
                        <p className="text-xs text-blue-200 font-medium uppercase tracking-wide mb-1">
                          Total por Forma de Pagamento
                        </p>
                        <p className="text-3xl font-bold">
                          R$ {formatBRL(totalGeral)}
                        </p>
                        <p className="text-xs text-blue-300 mt-1">
                          {dataInicio} &rarr; {dataFim} &bull;{' '}
                          {pagamento.items?.length || 0} forma(s) &bull; Credev
                          excluído automaticamente
                        </p>
                      </div>
                      <CreditCard
                        size={48}
                        className="text-blue-400 opacity-60"
                      />
                    </div>
                  </CardContent>
                </Card>

                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <div className="relative flex-1 max-w-xs">
                    <MagnifyingGlass
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                      type="text"
                      placeholder="Filtrar forma de pagamento..."
                      value={termoBusca}
                      onChange={(e) => setTermoBusca(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <Card>
                  <CardContent className="pt-4">
                    {itensFiltrados.length === 0 ? (
                      <p className="text-center text-gray-400 text-sm py-8">
                        Nenhuma forma de pagamento encontrada.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200">
                              {[
                                '#',
                                'Forma de Pagamento',
                                'Qtd. NFs',
                                'Total',
                                '% do Total',
                                'Distribuição',
                              ].map((h, i) => (
                                <th
                                  key={h}
                                  className={`py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide ${i >= 2 ? 'text-right' : 'text-left'}`}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {itensFiltrados.map(
                              (
                                {
                                  paymentCode,
                                  paymentDescription,
                                  invoiceQty,
                                  totalValue,
                                },
                                idx,
                              ) => {
                                const pct =
                                  totalGeral > 0
                                    ? (totalValue / totalGeral) * 100
                                    : 0;
                                const barPct =
                                  maxValor > 0
                                    ? (totalValue / maxValor) * 100
                                    : 0;
                                return (
                                  <tr
                                    key={paymentCode ?? idx}
                                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                  >
                                    <td className="py-3 px-3 text-gray-400 font-medium text-xs">
                                      {idx + 1}
                                    </td>
                                    <td className="py-3 px-3 font-medium text-gray-800">
                                      {paymentDescription ||
                                        `Cód. ${paymentCode}`}
                                    </td>
                                    <td className="py-3 px-3 text-right text-gray-600">
                                      {invoiceQty ?? '-'}
                                    </td>
                                    <td className="py-3 px-3 text-right font-semibold text-gray-800">
                                      R$ {formatBRL(totalValue)}
                                    </td>
                                    <td className="py-3 px-3 text-right text-gray-600">
                                      {pct.toFixed(2)}%
                                    </td>
                                    <td className="py-3 px-3 min-w-[140px]">
                                      <div className="relative h-6 bg-gray-100 rounded overflow-hidden">
                                        <div
                                          className="absolute inset-y-0 left-0 bg-violet-500 rounded transition-all duration-500"
                                          style={{ width: `${barPct}%` }}
                                        />
                                        <span className="absolute inset-0 flex items-center px-1.5 text-xs font-semibold text-white z-10">
                                          {formatBRLCompact(totalValue)}
                                        </span>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              },
                            )}
                            <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                              <td className="py-3 px-3 text-gray-400" />
                              <td className="py-3 px-3 text-gray-700">Total</td>
                              <td className="py-3 px-3 text-right text-gray-700">
                                {itensFiltrados.reduce(
                                  (s, i) => s + (i.invoiceQty || 0),
                                  0,
                                )}
                              </td>
                              <td className="py-3 px-3 text-right text-gray-900">
                                R$ {formatBRL(totalGeral)}
                              </td>
                              <td className="py-3 px-3 text-right text-gray-600">
                                100%
                              </td>
                              <td className="py-3 px-3" />
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            );
          })()}

        {aba === 'pagamento' && !pagamento && !loadingPag && !erro && (
          <div className="text-center py-16 text-gray-400">
            <CreditCard size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Selecione o período e clique em Buscar.</p>
          </div>
        )}

        {/* ══════════════════ ABA: MÉTRICAS POR CANAL ══════════════════ */}
        {aba === 'vendedores' &&
          rankingFat &&
          !loadingVend &&
          (() => {
            // Dados 100% TOTVS: rankingFat = { segmentos, segmentosQty, segmentosItens, total }
            const segs = rankingFat.segmentos || {};
            const segsQty = rankingFat.segmentosQty || {};
            const segsItens = rankingFat.segmentosItens || {};

            const canaisAgg = CANAL_ORDER.filter((c) => (segs[c] ?? 0) > 0)
              .map((canal) => {
                const iv = segs[canal] || 0;
                const iq = segsQty[canal] || 0;
                const iz = segsItens[canal] || 0;
                const tm = iq > 0 ? iv / iq : 0;
                const pa = iq > 0 && iz > 0 ? iz / iq : 0;
                const pmpv = iz > 0 ? iv / iz : 0;
                return {
                  canal,
                  invoice_value: iv,
                  invoice_qty: iq,
                  itens_qty: iz,
                  credev_value: 0,
                  tm,
                  pa,
                  pmpv,
                  _viaTotvs: true,
                };
              })
              .sort((a, b) => b.invoice_value - a.invoice_value);

            const totalGeral = canaisAgg.reduce(
              (s, c) => s + c.invoice_value,
              0,
            );
            const maxVal = canaisAgg[0]?.invoice_value || 1;

            return (
              <>
                <Card className="mb-6 bg-[#000638] text-white">
                  <CardContent className="pt-5 pb-5">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div>
                        <p className="text-xs text-blue-200 font-medium uppercase tracking-wide mb-1">
                          Métricas por Canal (TOTVS)
                        </p>
                        <p className="text-3xl font-bold">
                          R$ {formatBRL(totalGeral)}
                        </p>
                        <p className="text-xs text-blue-300 mt-1">
                          {dataInicio} → {dataFim} &bull; {canaisAgg.length}{' '}
                          canal(is) &bull; TM, PA e PMPV via TOTVS
                        </p>
                      </div>
                      <ChartBar
                        size={48}
                        className="text-blue-400 opacity-60"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200">
                            {[
                              '#',
                              'Canal',
                              'Faturamento',
                              '% Total',
                              'NFs',
                              'Credev',
                              'TM',
                              'PA',
                              'PMPV',
                              'Participação',
                            ].map((h, i) => (
                              <th
                                key={h}
                                className={`py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide ${
                                  i <= 1
                                    ? 'text-left'
                                    : i === 9
                                      ? 'text-left'
                                      : 'text-right'
                                }`}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {canaisAgg.map(
                            (
                              {
                                canal,
                                invoice_value,
                                invoice_qty,
                                credev_value,
                                itens_qty,
                                tm,
                                pa,
                                pmpv,
                                _viaTotvs,
                              },
                              idx,
                            ) => {
                              const cfg = CANAL_CONFIG[canal] || {
                                label: canal,
                                icon: ChartBar,
                                bar: 'bg-gray-400',
                                text: 'text-gray-600',
                                color: '#64748b',
                              };
                              const Icon = cfg.icon;
                              const pct =
                                totalGeral > 0
                                  ? (invoice_value / totalGeral) * 100
                                  : 0;
                              const barPct =
                                maxVal > 0 ? (invoice_value / maxVal) * 100 : 0;
                              return (
                                <tr
                                  key={canal}
                                  className={`border-b border-gray-100 hover:bg-blue-50/30 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}
                                >
                                  <td className="py-3 px-3 text-xs text-gray-400 font-medium">
                                    {idx + 1}
                                  </td>
                                  <td className="py-3 px-3">
                                    <div
                                      className={`flex items-center gap-2 font-semibold text-sm ${cfg.text}`}
                                    >
                                      <Icon size={15} weight="duotone" />
                                      {cfg.label}
                                      {_viaTotvs && (
                                        <span className="text-[10px] font-normal bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">
                                          TOTVS
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 text-right font-semibold text-gray-800">
                                    R$ {formatBRL(invoice_value)}
                                  </td>
                                  <td className="py-3 px-3 text-right text-gray-600 text-xs">
                                    {pct.toFixed(1)}%
                                  </td>
                                  <td className="py-3 px-3 text-right text-gray-600 text-xs">
                                    {invoice_qty}
                                  </td>
                                  <td className="py-3 px-3 text-right text-xs">
                                    {credev_value > 0 ? (
                                      <span className="text-red-500">
                                        — R$ {formatBRL(credev_value)}
                                      </span>
                                    ) : (
                                      <span className="text-gray-300">—</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 text-right text-xs text-gray-700">
                                    {tm > 0
                                      ? `R$ ${formatBRLCompact(tm)}`
                                      : '—'}
                                  </td>
                                  <td className="py-3 px-3 text-right text-xs text-gray-700">
                                    {pa > 0 ? pa.toFixed(2) : '—'}
                                  </td>
                                  <td className="py-3 px-3 text-right text-xs text-gray-700">
                                    {pmpv > 0
                                      ? `R$ ${formatBRLCompact(pmpv)}`
                                      : '—'}
                                  </td>
                                  <td className="py-3 px-3 min-w-[120px]">
                                    <div className="relative h-5 bg-gray-100 rounded overflow-hidden">
                                      <div
                                        className={`absolute inset-y-0 left-0 ${cfg.bar} rounded transition-all duration-500`}
                                        style={{ width: `${barPct}%` }}
                                      />
                                      <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-semibold text-white z-10">
                                        {formatBRLCompact(invoice_value)}
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            },
                          )}
                          <tr className="bg-gray-100 font-semibold border-t-2 border-gray-300">
                            <td className="py-3 px-3 text-gray-400" />
                            <td className="py-3 px-3 text-gray-700">Total</td>
                            <td className="py-3 px-3 text-right text-gray-900">
                              R$ {formatBRL(totalGeral)}
                            </td>
                            <td className="py-3 px-3 text-right text-gray-600 text-xs">
                              100%
                            </td>
                            <td className="py-3 px-3 text-right text-gray-700 text-xs">
                              {canaisAgg.reduce((s, c) => s + c.invoice_qty, 0)}
                            </td>
                            <td className="py-3 px-3 text-right text-xs">
                              {canaisAgg.reduce(
                                (s, c) => s + c.credev_value,
                                0,
                              ) > 0 ? (
                                <span className="text-red-500">
                                  — R${' '}
                                  {formatBRL(
                                    canaisAgg.reduce(
                                      (s, c) => s + c.credev_value,
                                      0,
                                    ),
                                  )}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td colSpan={4} />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            );
          })()}

        {aba === 'vendedores' && !rankingFat && !loadingVend && !erro && (
          <div className="text-center py-16 text-gray-400">
            <ChartBar size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Selecione o período e clique em Buscar.</p>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-3">
            <Spinner size={24} className="animate-spin" />
            <span className="text-sm">Buscando faturamento...</span>
          </div>
        )}
      </div>

      {/* Modal de transações */}
      {modalCanal && (
        <ModalTransacoes
          canal={modalCanal}
          datemin={dataInicio}
          datemax={dataFim}
          onClose={() => setModalCanal(null)}
          custoAds={custoAds}
          custoWpp={custoWpp}
        />
      )}
    </div>
  );
}
