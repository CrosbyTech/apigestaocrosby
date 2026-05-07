import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  ShoppingBag,
  Storefront,
  Buildings,
  MapPin,
  ChartBar,
  ChartPieSlice,
  Calendar,
  ListChecks,
  ArrowsClockwise,
  Spinner,
  X,
  Question,
  ArrowSquareOut,
  Tag,
  CurrencyDollar,
  CheckCircle,
  Warning,
  UserCircle,
  UserCirclePlus,
} from '@phosphor-icons/react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
  LineChart,
  Line,
} from 'recharts';
import { API_BASE_URL } from '../../config/constants';

const API_KEY = import.meta.env.VITE_API_KEY || '';

const fmtNum = (v) => (v || 0).toLocaleString('pt-BR');
const fmtPct = (v) => `${(v || 0).toFixed(1)}%`;
const fmtData = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
};

const COLORS = {
  varejo: '#6366f1',
  revenda: '#10b981',
  multimarcas: '#f59e0b',
  sem_categoria: '#cbd5e1',
};

const CHART_PALETTE = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
  '#f97316', '#14b8a6', '#a855f7', '#3b82f6',
];

// ─── KPI Card ───────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, color, label, value, subtitle, accent, onClick, active }) {
  const El = onClick ? 'button' : 'div';
  return (
    <El
      onClick={onClick}
      className={`bg-white border rounded-lg p-4 flex flex-col gap-1 text-left transition ${
        active
          ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-md'
          : 'border-gray-200'
      } ${
        onClick
          ? 'hover:border-indigo-300 hover:shadow-md cursor-pointer'
          : ''
      }`}
      style={accent ? { borderLeft: `4px solid ${accent}` } : {}}
    >
      <div className="flex items-center gap-2 text-gray-500">
        {Icon && (
          <span
            className="rounded-md p-1.5"
            style={{ backgroundColor: `${color}15`, color }}
          >
            <Icon size={16} weight="bold" />
          </span>
        )}
        <span className="text-[11px] font-bold uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-[#000638] tabular-nums">
        {value}
      </div>
      {subtitle && (
        <div className="text-[11px] text-gray-500">{subtitle}</div>
      )}
    </El>
  );
}

// ─── Card wrapper ───────────────────────────────────────────────────────────
function Card({ title, icon: Icon, children, right }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon size={18} weight="bold" className="text-[#000638]" />}
        <h3 className="text-sm font-bold text-[#000638] flex-1">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-md px-2.5 py-1.5 text-xs">
      {label && <div className="font-bold text-[#000638] mb-0.5">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="text-gray-600 tabular-nums">
          {p.name}: <strong>{fmtNum(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

// ─── Modal de detalhe ───────────────────────────────────────────────────────
function DetalheModal({ open, onClose, titulo, filter, value }) {
  const [leads, setLeads] = useState(null);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    if (!open || !filter) return;
    setLoading(true);
    setErro('');
    setLeads(null);
    setBusca('');
    const params = new URLSearchParams({ filter, value: value || '' });
    fetch(`${API_BASE_URL}/api/crm/dashboard-overview-leads?${params}`, {
      headers: { 'x-api-key': API_KEY },
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j.success) {
          setErro(j.message || 'Erro ao carregar');
          return;
        }
        setLeads(j.data?.leads || []);
        setTotal(j.data?.total || 0);
        setTruncated(j.data?.truncated || false);
      })
      .catch((e) => setErro(e.message || 'Erro de rede'))
      .finally(() => setLoading(false));
  }, [open, filter, value]);

  const filtered = useMemo(() => {
    if (!leads) return [];
    if (!busca.trim()) return leads;
    const q = busca.trim().toLowerCase();
    return leads.filter(
      (l) =>
        l.nome?.toLowerCase().includes(q) ||
        l.telefone?.includes(q) ||
        l.vendedor?.toLowerCase().includes(q) ||
        l.cidade?.toLowerCase().includes(q),
    );
  }, [leads, busca]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div>
            <h2 className="text-base font-bold text-[#000638]">{titulo}</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {loading
                ? 'Carregando...'
                : `${fmtNum(total)} leads${truncated ? ` (mostrando ${leads?.length || 0})` : ''}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 p-1"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, telefone, vendedor ou cidade..."
            className="w-full text-xs border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#000638]/20"
          />
        </div>
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-12 text-center text-gray-400">
              <Spinner size={28} className="animate-spin mx-auto mb-2" />
              Carregando leads...
            </div>
          ) : erro ? (
            <div className="p-8 text-center text-red-600 text-sm">{erro}</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              Nenhum lead encontrado.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-gray-500 uppercase text-[10px]">
                  <th className="px-3 py-2 font-semibold">Nome</th>
                  <th className="px-3 py-2 font-semibold">Telefone</th>
                  <th className="px-3 py-2 font-semibold">Vendedor</th>
                  <th className="px-3 py-2 font-semibold">Canal</th>
                  <th className="px-3 py-2 font-semibold">UF</th>
                  <th className="px-3 py-2 font-semibold">Cidade</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Criado</th>
                  <th className="px-3 py-2 font-semibold w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-[#000638]">
                      {l.nome || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 tabular-nums">
                      {l.telefone || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {l.vendedor || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-500">
                      {l.canal || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {l.estado || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {l.cidade || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 lowercase">
                      {l.status || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-500 tabular-nums">
                      {fmtData(l.dataCriacao)}
                    </td>
                    <td className="px-3 py-2">
                      {l.clickupUrl && (
                        <a
                          href={l.clickupUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-500 hover:text-indigo-700"
                          title="Abrir no ClickUp"
                        >
                          <ArrowSquareOut size={14} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Botão de Sync Compras ──────────────────────────────────────────────────
// Dispara /sync-leads-compras e exibe o resultado em modal.
// Cron diário às 09:24 BRT também executa automaticamente.
function SyncComprasButton({ onSyncComplete }) {
  const [running, setRunning] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState(null);
  const [erro, setErro] = useState('');
  const [pollTimer, setPollTimer] = useState(null);

  // Verifica status periodicamente quando running
  useEffect(() => {
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [pollTimer]);

  const startSync = async (dryRun = false) => {
    setRunning(true);
    setErro('');
    setResult(null);
    setShowResult(true);

    try {
      // Dispara em background
      const r = await fetch(`${API_BASE_URL}/api/crm/sync-leads-compras`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ dryRun }),
      });
      const j = await r.json();
      if (!j.success) {
        throw new Error(j.message || 'Erro ao iniciar sync');
      }

      // Polling de status a cada 3s
      const poll = setInterval(async () => {
        try {
          const sr = await fetch(`${API_BASE_URL}/api/crm/sync-leads-compras-status`, {
            headers: { 'x-api-key': API_KEY },
          });
          const sj = await sr.json();
          const status = sj.data;
          if (!status?.running && status?.result) {
            clearInterval(poll);
            setPollTimer(null);
            setResult(status.result);
            setRunning(false);
            if (!dryRun && status.result.leads_atualizados > 0) {
              onSyncComplete?.();
            }
          }
        } catch (e) {
          console.warn('[sync-status] erro:', e.message);
        }
      }, 3000);
      setPollTimer(poll);
    } catch (e) {
      setErro(e.message || 'Erro de rede');
      setRunning(false);
    }
  };

  return (
    <>
      <button
        onClick={() => startSync(false)}
        disabled={running}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-60 disabled:cursor-wait"
        title="Cruza leads do CRM com notas fiscais e marca como comprou no ClickUp (cron automático às 09:24)"
      >
        {running ? (
          <>
            <Spinner size={13} className="animate-spin" />
            Sincronizando...
          </>
        ) : (
          <>
            <CurrencyDollar size={14} weight="bold" />
            Sincronizar Compras
          </>
        )}
      </button>

      {showResult && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !running && setShowResult(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <div>
                <h3 className="text-base font-bold text-[#000638]">
                  Sincronização de Compras
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Cruza leads do ClickUp (sem status &quot;comprou&quot;) com
                  notas fiscais e atualiza no ClickUp
                </p>
              </div>
              {!running && (
                <button
                  onClick={() => setShowResult(false)}
                  className="text-gray-400 hover:text-gray-700 p-1"
                >
                  <X size={20} />
                </button>
              )}
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {erro && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
                  {erro}
                </div>
              )}
              {running && !result && (
                <div className="text-center py-8 text-gray-500 text-sm">
                  <Spinner size={28} className="animate-spin mx-auto mb-3" />
                  Processando... pode levar 30-60s.
                  <div className="text-[11px] text-gray-400 mt-2">
                    Etapas: carregar leads → buscar pessoas → agregar NFs →
                    atualizar ClickUp
                  </div>
                </div>
              )}
              {result && !result.error && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <StatBox label="Total leads" value={result.total_leads} />
                    <StatBox
                      label="Sem &quot;comprou&quot;"
                      value={result.leads_sem_comprou}
                    />
                    <StatBox
                      label="Com telefone"
                      value={result.leads_com_telefone}
                    />
                    <StatBox
                      label="Match no ERP"
                      value={result.leads_com_match}
                      color="indigo"
                    />
                    <StatBox
                      label="Compraram pós-CRM"
                      value={result.leads_com_compra_pos_auto}
                      color="emerald"
                    />
                    <StatBox
                      label="✅ Atualizados no ClickUp"
                      value={result.leads_atualizados}
                      color="green"
                    />
                    {result.leads_falhou > 0 && (
                      <StatBox
                        label="⚠️ Falhou"
                        value={result.leads_falhou}
                        color="red"
                      />
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 text-center">
                    Concluído em {result.duration_human}
                  </div>
                  {result.samples?.length > 0 && (
                    <div className="border-t border-gray-100 pt-3">
                      <div className="text-xs font-semibold text-gray-600 mb-2">
                        Amostra ({result.samples.length}):
                      </div>
                      <div className="space-y-1 max-h-64 overflow-auto">
                        {result.samples.map((s, i) => (
                          <div
                            key={i}
                            className="text-[11px] flex items-center gap-2 p-2 rounded bg-gray-50"
                          >
                            {s.ok === false ? (
                              <Warning size={14} className="text-red-500 shrink-0" />
                            ) : (
                              <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                            )}
                            <div className="flex-1 truncate">
                              <span className="font-semibold">{s.task_name}</span>
                              <span className="text-gray-400 mx-1">·</span>
                              <span className="text-gray-600">
                                cd {s.person_code} ({s.person_name})
                              </span>
                              <span className="text-gray-400 mx-1">·</span>
                              <span className="text-emerald-700 font-bold">
                                R$ {(s.ltv_pos_auto || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                              {s.error && (
                                <span className="text-red-600 ml-2">
                                  · {s.error}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {result?.error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
                  {result.error}
                </div>
              )}
            </div>
            {!running && (
              <div className="border-t border-gray-100 p-3 flex justify-end">
                <button
                  onClick={() => setShowResult(false)}
                  className="px-4 py-1.5 text-xs rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700"
                >
                  Fechar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StatBox({ label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    green: 'bg-green-100 text-green-800 border border-green-300',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <div className={`rounded-md p-2.5 ${colors[color]}`}>
      <div className="text-[10px] font-semibold uppercase opacity-75 leading-tight">
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums">
        {(value || 0).toLocaleString('pt-BR')}
      </div>
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────
export default function PainelGeral() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [reloadAt, setReloadAt] = useState(0);
  const [modalSel, setModalSel] = useState(null); // { titulo, filter, value }
  // Modo de clique nos cards: 'detalhar' (modal) ou 'filtrar' (re-filtra painel)
  const [clickMode, setClickMode] = useState(() => {
    if (typeof window === 'undefined') return 'detalhar';
    return localStorage.getItem('painel:clickMode') || 'detalhar';
  });
  // Filtro de canal ativo (quando clickMode='filtrar' ou setado por chip)
  const [canalFiltro, setCanalFiltro] = useState(null); // { canal, label } | null

  // Salva clickMode no localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('painel:clickMode', clickMode);
    }
  }, [clickMode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErro('');
    const params = new URLSearchParams();
    if (reloadAt > 0) params.set('force', '1');
    if (canalFiltro?.canal) params.set('canal', canalFiltro.canal);
    const qs = params.toString();
    fetch(
      `${API_BASE_URL}/api/crm/dashboard-overview${qs ? `?${qs}` : ''}`,
      { headers: { 'x-api-key': API_KEY } },
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.success) {
          setErro(j.message || 'Erro ao carregar');
          return;
        }
        setData(j.data);
      })
      .catch((e) => !cancelled && setErro(e.message || 'Erro de rede'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reloadAt, canalFiltro]);

  const openModal = (titulo, filter, value) =>
    setModalSel({ titulo, filter, value });
  const closeModal = () => setModalSel(null);

  // Clique em canal (Varejo/Revenda/Multimarcas/Sem Categoria/Outra)
  // Comportamento depende do clickMode escolhido pelo usuário
  const onCanalClick = (canal, label) => {
    if (clickMode === 'filtrar') {
      // Toggle: clicar de novo no mesmo canal limpa o filtro
      if (canalFiltro?.canal === canal) setCanalFiltro(null);
      else setCanalFiltro({ canal, label });
    } else {
      // Modo detalhar: abre modal com lista de leads
      const filterMap = {
        varejo: 'canal',
        revenda: 'canal',
        multimarcas: 'canal',
        sem_categoria: 'sem_categoria',
      };
      if (canal.startsWith('outra:')) {
        openModal(`Leads em "${label}"`, 'outra_categoria', canal.slice(6));
      } else {
        openModal(`Leads de ${label}`, filterMap[canal] || 'canal', canal);
      }
    }
  };

  // ── Datasets para charts ──
  const canalChartData = useMemo(() => {
    if (!data?.por_canal) return [];
    const labels = {
      varejo: 'Varejo',
      revenda: 'Revenda',
      multimarcas: 'Multimarcas',
      sem_categoria: 'Sem categoria',
    };
    const items = Object.entries(data.por_canal)
      .filter(([_, v]) => v > 0)
      .map(([k, v]) => ({ name: labels[k] || k, total: v, key: k }));
    // Adiciona outras categorias agregadas como "Outros" se houver
    const outras = data.outras_categorias || [];
    const outrosTotal = outras.reduce((s, x) => s + x.total, 0);
    if (outrosTotal > 0) {
      items.push({ name: 'Outros', total: outrosTotal, key: 'outros' });
    }
    return items;
  }, [data]);

  const statusChartData = useMemo(() => {
    if (!data?.por_status) return [];
    return data.por_status.slice(0, 12);
  }, [data]);

  const vendedorChartData = useMemo(() => {
    if (!data?.por_vendedor) return [];
    return data.por_vendedor
      .slice(0, 12)
      .map((v) => ({ name: v.nome, total: v.total, modulo: v.modulo }));
  }, [data]);

  const estadoChartData = useMemo(
    () => (data?.top_estados || []).slice(0, 10),
    [data],
  );
  const cidadeChartData = useMemo(
    () => (data?.top_cidades || []).slice(0, 10),
    [data],
  );
  const mesChartData = useMemo(() => data?.por_mes || [], [data]);

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-12 flex flex-col items-center justify-center gap-3">
        <Spinner size={28} className="text-[#000638] animate-spin" />
        <p className="text-sm text-gray-500">Carregando painel geral...</p>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-sm text-red-700">{erro}</p>
        <button
          onClick={() => setReloadAt(Date.now())}
          className="mt-3 px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-700"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!data || data.enabled === false) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
        <p className="text-sm text-amber-700">
          {data?.message || 'Dashboard não disponível.'}
        </p>
      </div>
    );
  }

  const total = data.total || 0;
  const canal = data.por_canal || {};
  const passo = data.passo_a_passo || {};
  const recentes = data.recentes || {};
  const cadastros = data.cadastros || {};
  const outrasCategorias = data.outras_categorias || [];
  const outrasTotal = outrasCategorias.reduce((s, x) => s + x.total, 0);

  return (
    <div className="space-y-4">
      {/* Header com timestamp + toggle + sync compras */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-[#000638]">
            Painel Geral — CRM 26
          </h2>
          <p className="text-[11px] text-gray-500">
            {fmtNum(total)} leads
            {canalFiltro && (
              <span className="ml-1">
                · filtrado por <span className="font-semibold">{canalFiltro.label}</span>
              </span>
            )}
            {data.loaded_at && !canalFiltro && (
              <span className="ml-1">
                · atualizado{' '}
                {new Date(data.loaded_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle de modo de clique */}
          <div className="inline-flex items-center bg-gray-100 rounded-lg p-0.5 text-[11px]">
            <button
              onClick={() => setClickMode('detalhar')}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                clickMode === 'detalhar'
                  ? 'bg-white text-[#000638] shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              title="Ao clicar num card, abre lista de leads"
            >
              👁️ Detalhar
            </button>
            <button
              onClick={() => setClickMode('filtrar')}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                clickMode === 'filtrar'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              title="Ao clicar num card, filtra todo o painel por aquele canal"
            >
              🎯 Filtrar
            </button>
          </div>

          {/* Chip de filtro ativo */}
          {canalFiltro && (
            <button
              onClick={() => setCanalFiltro(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-medium"
              title="Limpar filtro"
            >
              <span className="text-[11px]">Filtro: {canalFiltro.label}</span>
              <X size={12} weight="bold" />
            </button>
          )}

          <SyncComprasButton onSyncComplete={() => setReloadAt(Date.now())} />
          <button
            onClick={() => setReloadAt(Date.now())}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-gray-300 hover:bg-gray-50 text-gray-700"
            title="Recarregar painel"
          >
            <ArrowsClockwise size={14} />
            Atualizar
          </button>
        </div>
      </div>

      {/* KPIs principais — todos clicáveis */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 xl:grid-cols-9 gap-3">
        <KpiCard
          icon={Users}
          color="#000638"
          label="Total de Leads"
          value={fmtNum(total)}
          subtitle={`${fmtNum(recentes.ult_30d || 0)} nos últimos 30d`}
        />
        <KpiCard
          icon={Storefront}
          color={COLORS.varejo}
          label="Varejo"
          value={fmtNum(canal.varejo)}
          subtitle={total ? `${((canal.varejo / total) * 100).toFixed(1)}%` : ''}
          accent={COLORS.varejo}
          onClick={() => onCanalClick('varejo', 'Varejo')}
          active={canalFiltro?.canal === 'varejo'}
        />
        <KpiCard
          icon={ShoppingBag}
          color={COLORS.revenda}
          label="Revenda"
          value={fmtNum(canal.revenda)}
          subtitle={total ? `${((canal.revenda / total) * 100).toFixed(1)}%` : ''}
          accent={COLORS.revenda}
          onClick={() => onCanalClick('revenda', 'Revenda')}
          active={canalFiltro?.canal === 'revenda'}
        />
        <KpiCard
          icon={Buildings}
          color={COLORS.multimarcas}
          label="Multimarcas"
          value={fmtNum(canal.multimarcas)}
          subtitle={
            total ? `${((canal.multimarcas / total) * 100).toFixed(1)}%` : ''
          }
          accent={COLORS.multimarcas}
          onClick={() => onCanalClick('multimarcas', 'Multimarcas')}
          active={canalFiltro?.canal === 'multimarcas'}
        />
        <KpiCard
          icon={Question}
          color="#94a3b8"
          label="Sem Categoria"
          value={fmtNum(canal.sem_categoria)}
          subtitle={
            total
              ? `${((canal.sem_categoria / total) * 100).toFixed(1)}% — não classificados`
              : ''
          }
          accent="#94a3b8"
          onClick={() => onCanalClick('sem_categoria', 'Sem Categoria')}
          active={canalFiltro?.canal === 'sem_categoria'}
        />
        <KpiCard
          icon={ListChecks}
          color="#10b981"
          label="No Passo a Passo"
          value={fmtNum(passo.com_safra)}
          subtitle={`${fmtPct(passo.pct_com_safra)} dos leads`}
          accent="#10b981"
          onClick={() => openModal('Leads no passo a passo', 'safra', '')}
        />
        <KpiCard
          icon={UserCircle}
          color="#0ea5e9"
          label="Cadastros Abertos"
          value={fmtNum(cadastros.abertos)}
          subtitle={
            cadastros.phone_map_loaded
              ? `${fmtPct(cadastros.pct_abertos)} viraram cliente${
                  cadastros.abertos_fracos
                    ? ` · +${fmtNum(cadastros.abertos_fracos)} match fraco`
                    : ''
                }`
              : 'aguardando ERP'
          }
          accent="#0ea5e9"
          onClick={() =>
            openModal(
              'Leads que viraram cadastro no ERP',
              'cadastro_aberto',
              '',
            )
          }
        />
        <KpiCard
          icon={UserCirclePlus}
          color="#a855f7"
          label="Cadastros do Passo a Passo"
          value={fmtNum(cadastros.do_passo_a_passo)}
          subtitle={
            passo.com_safra > 0
              ? `${fmtPct(cadastros.pct_passo_a_passo)} dos com safra`
              : '—'
          }
          accent="#a855f7"
          onClick={() =>
            openModal(
              'Cadastros abertos com Passo a Passo (com safra)',
              'cadastro_passo',
              '',
            )
          }
        />
        <KpiCard
          icon={Calendar}
          color="#ef4444"
          label="Últimos 7 dias"
          value={fmtNum(recentes.ult_7d)}
          subtitle={`${fmtNum(recentes.ult_90d)} nos últimos 90d`}
          accent="#ef4444"
          onClick={() =>
            openModal('Leads dos últimos 7 dias', 'recente7', '')
          }
        />
      </div>

      {/* Outras categorias (se houver) */}
      {outrasCategorias.length > 0 && (
        <Card title={`Outras Categorias (${fmtNum(outrasTotal)} leads)`} icon={Tag}>
          <div className="flex flex-wrap gap-2">
            {outrasCategorias.map((c) => (
              <button
                key={c.name}
                onClick={() =>
                  onCanalClick(`outra:${c.name}`, c.name)
                }
                className={`px-3 py-1.5 text-xs rounded-full transition border ${
                  canalFiltro?.canal === `outra:${c.name}`
                    ? 'bg-indigo-600 text-white border-indigo-700 shadow-sm'
                    : 'bg-gray-100 hover:bg-indigo-100 text-gray-700 hover:text-indigo-700 border-gray-200 hover:border-indigo-300'
                }`}
              >
                {c.name} <span className="font-bold ml-1">{fmtNum(c.total)}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Linha 1: Vendedor + Canal pizza */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card title="Leads por Vendedor (top 12)" icon={ChartBar}>
            {vendedorChartData.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">
                Sem dados de vendedor.
              </p>
            ) : (
              <ResponsiveContainer
                width="100%"
                height={Math.max(260, vendedorChartData.length * 28)}
              >
                <BarChart
                  data={vendedorChartData}
                  layout="vertical"
                  margin={{ top: 6, right: 30, left: 10, bottom: 6 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    width={140}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
                  <Bar
                    dataKey="total"
                    radius={[0, 6, 6, 0]}
                    cursor="pointer"
                    onClick={(d) =>
                      openModal(`Leads de ${d.name}`, 'vendedor', d.name)
                    }
                  >
                    {vendedorChartData.map((_, i) => (
                      <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
        <Card title="Distribuição por Canal" icon={ChartPieSlice}>
          {canalChartData.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Sem dados de canal.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={canalChartData}
                  dataKey="total"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  cursor="pointer"
                  onClick={(d) => {
                    if (d.key === 'outros') return;
                    onCanalClick(d.key, d.name);
                  }}
                  label={({ name, percent }) =>
                    percent > 0.04 ? `${name} ${(percent * 100).toFixed(0)}%` : ''
                  }
                  labelLine={false}
                >
                  {canalChartData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={
                        COLORS[entry.key] ||
                        CHART_PALETTE[i % CHART_PALETTE.length]
                      }
                    />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Linha 2: Estado + Cidade */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Top 10 Estados" icon={MapPin}>
          {estadoChartData.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Sem dados de estado.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={estadoChartData}
                layout="vertical"
                margin={{ top: 6, right: 30, left: 10, bottom: 6 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  width={50}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
                <Bar
                  dataKey="total"
                  fill="#10b981"
                  radius={[0, 6, 6, 0]}
                  cursor="pointer"
                  onClick={(d) =>
                    openModal(`Leads do estado ${d.name}`, 'estado', d.name)
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Top 10 Cidades" icon={MapPin}>
          {cidadeChartData.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Sem dados de cidade.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={cidadeChartData}
                layout="vertical"
                margin={{ top: 6, right: 30, left: 10, bottom: 6 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  width={150}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
                <Bar
                  dataKey="total"
                  fill="#f59e0b"
                  radius={[0, 6, 6, 0]}
                  cursor="pointer"
                  onClick={(d) =>
                    openModal(`Leads de ${d.name}`, 'cidade', d.name)
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Linha 3: Status + Mês */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Status do Funil" icon={ChartBar}>
          {statusChartData.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Sem dados de status.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={statusChartData}
                margin={{ top: 6, right: 16, left: 0, bottom: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  angle={-30}
                  textAnchor="end"
                  height={70}
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
                <Bar
                  dataKey="total"
                  radius={[6, 6, 0, 0]}
                  cursor="pointer"
                  onClick={(d) =>
                    openModal(`Leads em "${d.name}"`, 'status', d.name)
                  }
                >
                  {statusChartData.map((_, i) => (
                    <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Leads por Mês (últimos 12)" icon={Calendar}>
          {mesChartData.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Sem dados de criação.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart
                data={mesChartData}
                margin={{ top: 6, right: 16, left: 0, bottom: 6 }}
                onClick={(e) => {
                  const point = e?.activePayload?.[0]?.payload;
                  if (point?.mes) {
                    openModal(`Leads de ${point.mes}`, 'mes', point.mes);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#000638"
                  strokeWidth={2.5}
                  dot={{ fill: '#000638', r: 4, cursor: 'pointer' }}
                  activeDot={{ r: 6, cursor: 'pointer' }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Linha 4: Passo a Passo + Origem */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          title="Passo a Passo (campo Safra)"
          icon={ListChecks}
          right={
            <span className="text-[11px] text-gray-500">
              {fmtNum(passo.com_safra)} de {fmtNum(total)} ·{' '}
              {fmtPct(passo.pct_com_safra)}
            </span>
          }
        >
          {(passo.por_safra || []).length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Nenhum lead com campo Safra preenchido.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={passo.por_safra.slice(0, 10)}
                layout="vertical"
                margin={{ top: 6, right: 30, left: 10, bottom: 6 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  width={120}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
                <Bar
                  dataKey="total"
                  fill="#10b981"
                  radius={[0, 6, 6, 0]}
                  cursor="pointer"
                  onClick={(d) =>
                    openModal(`Leads na safra "${d.name}"`, 'safra', d.name)
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Origem dos Leads" icon={ChartPieSlice}>
          {(data.por_origem || []).length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Sem dados de origem.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={data.por_origem.slice(0, 8)}
                  dataKey="total"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  cursor="pointer"
                  onClick={(d) =>
                    openModal(`Leads da origem "${d.name}"`, 'origem', d.name)
                  }
                  label={({ name, percent }) =>
                    percent > 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : ''
                  }
                  labelLine={false}
                >
                  {data.por_origem.slice(0, 8).map((_, i) => (
                    <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Modal de detalhe */}
      <DetalheModal
        open={!!modalSel}
        onClose={closeModal}
        titulo={modalSel?.titulo}
        filter={modalSel?.filter}
        value={modalSel?.value}
      />
    </div>
  );
}
