import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Phone,
  PhoneCall,
  PhoneDisconnect,
  CheckCircle,
  Cake,
  Wallet,
  Trophy,
  Clock,
  Warning,
  X,
  MagnifyingGlass,
  WhatsappLogo,
  Spinner,
  CalendarBlank,
  ChatCircle,
  Receipt,
  Package,
  CreditCard,
  Storefront,
  ChartLineUp,
} from '@phosphor-icons/react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { API_BASE_URL } from '../../config/constants';
import { formatPhone, cleanPhone, VENDEDORES_POR_MODULO } from './constants';

const API_KEY = import.meta.env.VITE_API_KEY || '';

async function apiPost(endpoint, body) {
  const r = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  return json.data ?? json;
}
async function apiGet(endpoint) {
  const r = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: { 'x-api-key': API_KEY },
  });
  const json = await r.json();
  return json.data ?? json;
}

// ─── Categorias ───────────────────────────────────────────────────────────
const CATEGORIAS = [
  { key: 'ativo', label: 'Ativos', icon: CheckCircle, color: '#10b981', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  { key: 'a_inativar', label: 'A Inativar', icon: Warning, color: '#f59e0b', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  { key: 'inativo', label: 'Inativos', icon: Clock, color: '#ef4444', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  { key: 'aniversariante', label: 'Aniversariantes', icon: Cake, color: '#ec4899', bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
  { key: 'cashback', label: 'Com Cashback', icon: Wallet, color: '#8b5cf6', bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
  { key: 'top', label: 'Top Clientes', icon: Trophy, color: '#f97316', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
];

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtData = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};

const fmtDataSimples = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
};

const initials = (n) => {
  if (!n) return '?';
  const parts = String(n).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
};

const avatarColor = (s) => {
  if (!s) return '#94a3b8';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
  return palette[Math.abs(h) % palette.length];
};

// ─── Modal: registrar ligação ─────────────────────────────────────────────
function RegistrarChamadaModal({ open, cliente, categoria, vendedor, modulo, onClose, onSaved }) {
  const [atendida, setAtendida] = useState(true);
  const [observacao, setObservacao] = useState('');
  const [dataContato, setDataContato] = useState(() => {
    const now = new Date();
    const tz = -now.getTimezoneOffset();
    return new Date(now.getTime() + tz * 60000).toISOString().slice(0, 16);
  });
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (open) {
      setAtendida(true);
      setObservacao('');
      setErro('');
      const now = new Date();
      const tz = -now.getTimezoneOffset();
      setDataContato(new Date(now.getTime() + tz * 60000).toISOString().slice(0, 16));
    }
  }, [open]);

  if (!open || !cliente) return null;

  const handleSave = async () => {
    setLoading(true);
    setErro('');
    try {
      const payload = {
        vendedor_code: vendedor?.code || null,
        vendedor_nome: vendedor?.name || null,
        modulo: modulo || null,
        person_code: cliente.cod || cliente.person_code,
        person_nome: cliente.nome || cliente.person_nome,
        person_telefone: cliente.fone || cliente.person_telefone,
        person_cidade: cliente.cidade || cliente.person_cidade,
        person_uf: cliente.uf || cliente.person_uf,
        categoria,
        atendida,
        observacao,
        data_contato: new Date(dataContato).toISOString(),
      };
      const r = await apiPost('/api/crm/lead-generation/call', payload);
      onSaved && onSaved(r);
      onClose();
    } catch (e) {
      setErro(e.message || 'Erro ao registrar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div>
            <h3 className="text-base font-bold text-[#000638]">Registrar ligação</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">{cliente.nome || cliente.person_nome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Cliente info */}
          <div className="bg-gray-50 rounded-lg p-2.5 text-xs">
            <div className="flex items-center gap-2">
              <span
                className="w-9 h-9 rounded-full text-white font-bold flex items-center justify-center text-xs shadow-sm"
                style={{ background: avatarColor(cliente.nome) }}
              >
                {initials(cliente.nome || cliente.person_nome)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[#000638] truncate">
                  {cliente.nome || cliente.person_nome}
                </div>
                <div className="text-[11px] font-mono text-gray-500 mt-0.5">
                  {formatPhone(cliente.fone || cliente.person_telefone) || '—'}
                </div>
                {cliente.cidade && (
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    📍 {cliente.cidade}
                    {cliente.uf ? ` - ${cliente.uf}` : ''}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Atendida? */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-1.5">
              Cliente atendeu?
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setAtendida(true)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border-2 text-sm font-bold transition ${
                  atendida
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                }`}
              >
                <PhoneCall size={16} weight={atendida ? 'fill' : 'regular'} />
                Sim, atendeu
              </button>
              <button
                onClick={() => setAtendida(false)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border-2 text-sm font-bold transition ${
                  !atendida
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                }`}
              >
                <PhoneDisconnect size={16} weight={!atendida ? 'fill' : 'regular'} />
                Não atendeu
              </button>
            </div>
          </div>

          {/* Data */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-1.5">
              Data do contato
            </label>
            <input
              type="datetime-local"
              value={dataContato}
              onChange={(e) => setDataContato(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>

          {/* Observação */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-1.5">
              Observação
            </label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder={
                atendida
                  ? 'Ex: tem interesse em renovar pedido até o fim do mês'
                  : 'Ex: cair na caixa postal, ligar de novo amanhã'
              }
              rows={3}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none"
            />
          </div>

          {erro && (
            <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 text-xs text-red-700">
              {erro}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 p-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg disabled:opacity-50"
          >
            {loading ? <Spinner size={12} className="animate-spin" /> : <Phone size={12} weight="fill" />}
            {loading ? 'Salvando...' : 'Registrar ligação'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: histórico de ligações de um cliente ───────────────────────────
function HistoricoModal({ open, cliente, onClose }) {
  const [historico, setHistorico] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !cliente) return;
    setLoading(true);
    apiGet(`/api/crm/lead-generation/calls?person_code=${cliente.cod || cliente.person_code}&limit=100`)
      .then((d) => setHistorico(d?.calls || []))
      .catch(() => setHistorico([]))
      .finally(() => setLoading(false));
  }, [open, cliente]);

  if (!open || !cliente) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div>
            <h3 className="text-base font-bold text-[#000638]">Histórico de ligações</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">{cliente.nome || cliente.person_nome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Spinner size={28} className="animate-spin" />
              <span className="text-xs mt-2">Carregando...</span>
            </div>
          ) : historico.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Phone size={36} weight="duotone" className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">Nenhuma ligação registrada</p>
            </div>
          ) : (
            <div className="space-y-2">
              {historico.map((c) => (
                <div key={c.id} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div className="flex items-center gap-2 mb-1.5">
                    {c.atendida ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        <PhoneCall size={10} weight="fill" /> Atendeu
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                        <PhoneDisconnect size={10} weight="fill" /> Não atendeu
                      </span>
                    )}
                    <span className="text-[10px] text-gray-500">
                      {fmtData(c.data_contato)}
                    </span>
                    <span className="ml-auto text-[10px] text-gray-400">
                      por <span className="font-semibold">{c.vendedor_nome}</span>
                    </span>
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">
                    Categoria: {(CATEGORIAS.find((cat) => cat.key === c.categoria) || {}).label || c.categoria}
                  </div>
                  {c.observacao && (
                    <div className="flex items-start gap-1.5 mt-1.5 text-xs text-gray-700 bg-white rounded p-2 border border-gray-100">
                      <ChatCircle size={11} className="text-gray-400 mt-0.5 shrink-0" />
                      <span className="whitespace-pre-wrap">{c.observacao}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal: detalhes da última compra ─────────────────────────────────────
function UltimaCompraModal({ open, cliente, modulo, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!open || !cliente) return;
    const pc = cliente.cod || cliente.person_code;
    if (!pc) return;
    setLoading(true);
    setErro('');
    setData(null);
    apiGet(
      `/api/crm/lead-generation/ultima-compra?person_code=${pc}&modulo=${encodeURIComponent(modulo || '')}`,
    )
      .then((d) => {
        if (d?.found) setData(d.nf);
        else setErro('Nenhuma compra encontrada para esse cliente.');
      })
      .catch((e) => setErro(e.message || 'Erro ao carregar'))
      .finally(() => setLoading(false));
  }, [open, cliente, modulo]);

  if (!open || !cliente) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <Receipt size={20} className="text-indigo-600" weight="duotone" />
            <div>
              <h3 className="text-base font-bold text-[#000638]">Última compra</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {cliente.nome || cliente.person_nome}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Spinner size={28} className="animate-spin" />
              <span className="text-xs mt-2">Carregando...</span>
            </div>
          ) : erro ? (
            <div className="text-center py-12 text-gray-400">
              <Receipt size={36} weight="duotone" className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">{erro}</p>
            </div>
          ) : data ? (
            <div className="space-y-3">
              {/* Resumo */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-emerald-700 font-bold mb-0.5">
                    Valor total
                  </div>
                  <div className="text-sm font-bold text-emerald-700 tabular-nums">
                    {fmtMoeda(data.total_value)}
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-blue-700 font-bold mb-0.5">
                    Data
                  </div>
                  <div className="text-sm font-bold text-blue-700">
                    {fmtDataSimples(data.issue_date)}
                  </div>
                </div>
                <div className="bg-violet-50 border border-violet-200 rounded-lg p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-violet-700 font-bold mb-0.5">
                    Filial
                  </div>
                  <div className="text-sm font-bold text-violet-700 tabular-nums">
                    {data.branch_code || '—'}
                  </div>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-orange-700 font-bold mb-0.5">
                    Itens
                  </div>
                  <div className="text-sm font-bold text-orange-700 tabular-nums">
                    {data.total_quantidade} un
                  </div>
                </div>
              </div>

              {/* Vendedor + NF */}
              <div className="bg-gray-50 rounded-lg p-2.5 text-xs flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Storefront size={14} className="text-gray-500" />
                  <span className="text-gray-500">Vendedor:</span>
                  <span className="font-bold text-[#000638]">
                    {data.dealer_nome || `Vendedor ${data.dealer_code}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">NF:</span>
                  <span className="font-mono font-bold tabular-nums text-[#000638]">
                    #{data.invoice_code}
                  </span>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-500">Operação:</span>
                  <span className="font-mono font-bold tabular-nums text-[#000638]">
                    {data.operation_code}
                  </span>
                </div>
              </div>

              {/* Produtos */}
              {data.produtos && data.produtos.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Package size={14} className="text-indigo-600" weight="duotone" />
                    <h4 className="text-xs font-bold text-[#000638]">
                      Produtos ({data.produtos.length})
                    </h4>
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider text-[9px]">
                        <tr>
                          <th className="text-left px-2.5 py-1.5">SKU</th>
                          <th className="text-left px-2.5 py-1.5">Produto</th>
                          <th className="text-right px-2.5 py-1.5">Qtd</th>
                          <th className="text-right px-2.5 py-1.5">Unit.</th>
                          <th className="text-right px-2.5 py-1.5">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.produtos.slice(0, 50).map((p, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-2.5 py-1.5 font-mono text-gray-500 text-[10px]">
                              {p.sku || '—'}
                            </td>
                            <td className="px-2.5 py-1.5 truncate max-w-[200px]" title={p.nome}>
                              {p.nome}
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums">
                              {p.quantidade}
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-500">
                              {fmtMoeda(p.valor_unitario)}
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums font-bold text-emerald-700">
                              {fmtMoeda(p.valor_liquido)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {data.produtos.length > 50 && (
                    <p className="text-[10px] text-gray-400 mt-1">
                      Mostrando 50 de {data.produtos.length} produtos.
                    </p>
                  )}
                </div>
              )}

              {/* Pagamentos */}
              {data.pagamentos && data.pagamentos.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <CreditCard size={14} className="text-emerald-600" weight="duotone" />
                    <h4 className="text-xs font-bold text-[#000638]">Pagamento</h4>
                  </div>
                  <div className="space-y-1">
                    {data.pagamentos.map((p, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-1.5 text-[11px]"
                      >
                        <span className="font-medium text-gray-700">
                          {p.forma}
                          {p.parcelas > 1 ? ` · ${p.parcelas}x` : ''}
                        </span>
                        <span className="font-bold tabular-nums text-emerald-700">
                          {fmtMoeda(p.valor)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Card de cliente pra ligar ────────────────────────────────────────────
function ClienteCard({ cliente, categoria, onRegistrar, onHistorico, onChatLead, onUltimaCompra, ultimoContato }) {
  const cor = avatarColor(cliente.nome || cliente.person_nome);
  const nome = cliente.nome || cliente.person_nome || 'Sem nome';
  const fone = cliente.fone || cliente.person_telefone;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 hover:border-indigo-300 hover:shadow-md transition">
      <div className="flex items-start gap-2.5 mb-2.5">
        <span
          className="shrink-0 w-9 h-9 rounded-full text-white text-xs font-bold flex items-center justify-center shadow-sm"
          style={{ background: cor }}
        >
          {initials(nome)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[#000638] truncate">{nome}</div>
          <div className="text-[10px] font-mono text-gray-500 mt-0.5">
            {formatPhone(fone) || '—'}
          </div>
          {(cliente.cidade || cliente.person_cidade) && (
            <div className="text-[10px] text-gray-400 mt-0.5 truncate">
              {cliente.cidade || cliente.person_cidade}
              {cliente.uf || cliente.person_uf ? ` - ${cliente.uf || cliente.person_uf}` : ''}
            </div>
          )}
        </div>
      </div>

      {/* Métricas específicas da categoria */}
      <div className="space-y-1 mb-2.5">
        {cliente.ltv != null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">LTV:</span>
            <span className="font-bold text-emerald-600 tabular-nums">{fmtMoeda(cliente.ltv)}</span>
          </div>
        )}
        {cliente.qty != null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">Compras:</span>
            <span className="tabular-nums">{cliente.qty}</span>
          </div>
        )}
        {cliente.diasSemComprar != null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">Sem comprar há:</span>
            <span className="tabular-nums font-semibold">{cliente.diasSemComprar} dias</span>
          </div>
        )}
        {cliente.last_purchase && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">Última compra:</span>
            <span className="tabular-nums text-gray-700">{fmtDataSimples(cliente.last_purchase)}</span>
          </div>
        )}
        {cliente.saldo_cashback != null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">Cashback:</span>
            <span className="font-bold text-violet-600 tabular-nums">{fmtMoeda(cliente.saldo_cashback)}</span>
          </div>
        )}
        {cliente.dt_aniversario && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">Aniversário:</span>
            <span className="font-bold text-pink-600 tabular-nums">{cliente.dt_aniversario}</span>
          </div>
        )}
      </div>

      {/* Último contato */}
      {ultimoContato && (
        <div className="bg-gray-50 rounded-md px-2 py-1.5 mb-2 text-[10px] flex items-center gap-1.5">
          {ultimoContato.atendida ? (
            <PhoneCall size={10} weight="fill" className="text-emerald-600" />
          ) : (
            <PhoneDisconnect size={10} weight="fill" className="text-red-500" />
          )}
          <span className="text-gray-600">
            Último contato:{' '}
            <span className="font-semibold">{fmtData(ultimoContato.data_contato)}</span>
          </span>
        </div>
      )}

      {/* Ações */}
      <div className="flex items-center gap-1 pt-2 border-t border-gray-100">
        <button
          onClick={() => onRegistrar(cliente, categoria)}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-sm"
        >
          <Phone size={11} weight="fill" />
          Ligar
        </button>
        {onUltimaCompra && (
          <button
            onClick={() => onUltimaCompra(cliente)}
            className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 rounded-md border border-indigo-200"
            title="Detalhes da última compra"
          >
            <Receipt size={11} weight="bold" />
          </button>
        )}
        {onChatLead && fone && (
          <button
            onClick={() => onChatLead({ telefone: fone, nome })}
            className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 rounded-md border border-emerald-200"
            title="WhatsApp"
          >
            <WhatsappLogo size={11} weight="bold" />
          </button>
        )}
        <button
          onClick={() => onHistorico(cliente)}
          className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 rounded-md border border-gray-200"
          title="Histórico de ligações"
        >
          <CalendarBlank size={11} weight="bold" />
        </button>
      </div>
    </div>
  );
}

// ─── Gráfico: ligações atendidas por vendedor por dia ────────────────────
function LigacoesAtendidasChart({ modulo, vendedoresDoModulo, refreshKey }) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(14);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    const startStr = start.toISOString().slice(0, 10);
    apiGet(
      `/api/crm/lead-generation/calls?modulo=${encodeURIComponent(modulo)}&atendida=true&start_date=${startStr}&limit=1000`,
    )
      .then((d) => {
        if (alive) setCalls(d?.calls || []);
      })
      .catch(() => alive && setCalls([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [modulo, days, refreshKey]);

  // Agrega: data → { date, [vendedorNome]: count, total }
  const { rows, vendedoresAtivos } = useMemo(() => {
    const byDate = new Map();
    const seenVendCodes = new Set();

    // Inicializa série vazia pros últimos N dias
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDate.set(key, { _date: key, total: 0 });
    }

    // Mapa code → nome (do modulo)
    const codeToName = new Map(
      vendedoresDoModulo.map((v) => [v.code, v.name.split(' ')[0]]),
    );

    for (const c of calls) {
      const dateKey = String(c.data_contato || '').slice(0, 10);
      if (!byDate.has(dateKey)) continue;
      const code = Number(c.vendedor_code);
      // Mostra só vendedores do módulo atual
      if (codeToName.size > 0 && !codeToName.has(code)) continue;
      const nome =
        codeToName.get(code) ||
        (c.vendedor_nome ? c.vendedor_nome.split(' ')[0] : `V${code}`);
      seenVendCodes.add(code);
      const row = byDate.get(dateKey);
      row[nome] = (row[nome] || 0) + 1;
      row.total += 1;
    }

    const rows = [...byDate.values()].map((r) => ({
      ...r,
      label: (() => {
        const [, m, d] = r._date.split('-');
        return `${d}/${m}`;
      })(),
    }));

    const vendedoresAtivos = vendedoresDoModulo.filter((v) =>
      seenVendCodes.has(v.code),
    );

    return { rows, vendedoresAtivos };
  }, [calls, days, vendedoresDoModulo]);

  // Paleta consistente por vendedor
  const PALETA = [
    '#6366f1',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#06b6d4',
    '#ec4899',
    '#84cc16',
    '#f97316',
    '#14b8a6',
    '#e11d48',
    '#0ea5e9',
  ];

  const totalAtendidas = calls.length;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
            <ChartLineUp size={16} className="text-emerald-700" weight="bold" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#000638]">
              Ligações atendidas por dia
            </h3>
            <p className="text-[10px] text-gray-500">
              Acompanhamento por vendedor · últimos {days} dias ·{' '}
              <span className="font-semibold text-emerald-700">
                {totalAtendidas} atendidas
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          {[7, 14, 30].map((n) => (
            <button
              key={n}
              onClick={() => setDays(n)}
              className={`px-2.5 py-1 rounded-md font-bold transition ${
                days === n
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Spinner size={24} className="animate-spin" />
        </div>
      ) : vendedoresAtivos.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <PhoneCall size={32} weight="duotone" className="mx-auto mb-2 text-gray-300" />
          <p className="text-xs">Sem ligações atendidas no período.</p>
        </div>
      ) : (
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickMargin={6}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 10, fill: '#64748b' }}
                width={28}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                }}
                labelStyle={{ fontWeight: 700, color: '#000638' }}
              />
              <Legend
                iconSize={8}
                wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
              />
              {vendedoresAtivos.map((v, i) => {
                const nome = v.name.split(' ')[0];
                return (
                  <Line
                    key={v.code}
                    type="monotone"
                    dataKey={nome}
                    stroke={PALETA[i % PALETA.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
export default function LeadGeneration({ erpData, modulo, vendedoresMap, onChatLead }) {
  const [vendedorSel, setVendedorSel] = useState(null);
  const [categoriaSel, setCategoriaSel] = useState('ativo');
  const [busca, setBusca] = useState('');
  const [showRegistrar, setShowRegistrar] = useState(null); // {cliente, categoria}
  const [showHistorico, setShowHistorico] = useState(null);
  const [showUltimaCompra, setShowUltimaCompra] = useState(null);
  const [topClientes, setTopClientes] = useState([]);
  const [loadingTop, setLoadingTop] = useState(false);
  const [aniversariantes, setAniversariantes] = useState([]);
  const [cashbackList, setCashbackList] = useState([]);
  const [callsByPerson, setCallsByPerson] = useState({}); // person_code → último call
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Vendedores do módulo (canônicos) ──
  const vendedoresDoModulo = useMemo(() => {
    const out = [];
    const codesSet = VENDEDORES_POR_MODULO[modulo];
    if (vendedoresMap?.byTotvsId) {
      for (const [totvsId, info] of Object.entries(vendedoresMap.byTotvsId)) {
        if (info.ativo === false) continue;
        const code = Number(totvsId);
        if (codesSet) {
          if (codesSet.has(code)) out.push({ code, name: info.nome });
        } else if (String(info.modulo || '').toLowerCase() === modulo) {
          out.push({ code, name: info.nome });
        }
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [vendedoresMap, modulo]);

  // Auto-seleciona primeiro vendedor
  useEffect(() => {
    if (!vendedorSel && vendedoresDoModulo.length > 0) {
      setVendedorSel(vendedoresDoModulo[0]);
    }
  }, [vendedoresDoModulo, vendedorSel]);

  // ── Carregar Top Clientes do vendedor selecionado ──
  useEffect(() => {
    if (categoriaSel !== 'top' || !vendedorSel) return;
    setLoadingTop(true);
    apiGet(
      `/api/crm/lead-generation/top-clientes?vendedor_code=${vendedorSel.code}&modulo=${modulo}&limit=50`,
    )
      .then((d) => setTopClientes(d?.clientes || []))
      .catch(() => setTopClientes([]))
      .finally(() => setLoadingTop(false));
  }, [categoriaSel, vendedorSel, modulo, refreshKey]);

  // ── Carregar Aniversariantes do dia ──
  useEffect(() => {
    if (categoriaSel !== 'aniversariante') return;
    apiGet(`/api/crm/aniversariantes-hoje?modulo=${encodeURIComponent(modulo)}`)
      .then((d) => setAniversariantes(d?.clientes || []))
      .catch(() => setAniversariantes([]));
  }, [categoriaSel, modulo, refreshKey]);

  // ── Carregar lista de cashback ──
  // Backend exige `persons: [{code}]`. Geramos a lista a partir da carteira
  // do vendedor selecionado (somente clientes desse vendedor).
  useEffect(() => {
    if (categoriaSel !== 'cashback') return;
    if (!vendedorSel || !erpData?.clientes) {
      setCashbackList([]);
      return;
    }
    const persons = erpData.clientes
      .filter((c) => c.vendedorCode === vendedorSel.code && c.cod)
      .map((c) => ({ code: c.cod }));
    if (persons.length === 0) {
      setCashbackList([]);
      return;
    }
    apiPost('/api/crm/cashback-balances', { persons, modulo })
      .then((d) => {
        // Resposta: { total, clientes: { [code]: {nome, telefone, balance, ...} } }
        const dict = d?.clientes || {};
        const arr = Object.values(dict).map((c) => ({
          cod: c.code,
          nome: c.nome,
          fone: c.telefone,
          saldo_cashback: c.balance,
          ultimo_vendedor: c.ultimo_vendedor,
        }));
        setCashbackList(arr);
      })
      .catch(() => setCashbackList([]));
  }, [categoriaSel, modulo, vendedorSel, erpData?.clientes, refreshKey]);

  // ── Carregar últimas ligações pra colocar timestamps nos cards ──
  useEffect(() => {
    if (!vendedorSel) return;
    apiGet(
      `/api/crm/lead-generation/calls?vendedor_code=${vendedorSel.code}&modulo=${modulo}&limit=500`,
    )
      .then((d) => {
        const map = {};
        for (const c of d?.calls || []) {
          if (!map[c.person_code] || c.data_contato > map[c.person_code].data_contato) {
            map[c.person_code] = c;
          }
        }
        setCallsByPerson(map);
      })
      .catch(() => setCallsByPerson({}));
  }, [vendedorSel, modulo, refreshKey]);

  // ── Lista de clientes da categoria selecionada ──
  const clientesDaCategoria = useMemo(() => {
    if (!vendedorSel) return [];

    if (categoriaSel === 'top') return topClientes;

    if (categoriaSel === 'aniversariante') {
      // filtra aniversariantes pelo vendedor selecionado (via ultimo_vendedor)
      return aniversariantes
        .filter((a) => {
          if (!vendedorSel) return true;
          const dc = a.ultimo_vendedor?.dealer_code;
          // Se temos info do último vendedor, filtra. Caso contrário, mostra
          // (cliente sem histórico recente — qualquer vendedor pode tentar).
          if (dc != null) return Number(dc) === vendedorSel.code;
          return true;
        })
        .map((a) => {
          // Normaliza pro shape esperado pelo ClienteCard
          let dt = null;
          if (a.dt_nascimento) {
            const d = new Date(a.dt_nascimento);
            if (!isNaN(d.getTime())) {
              dt = `${String(d.getDate()).padStart(2, '0')}/${String(
                d.getMonth() + 1,
              ).padStart(2, '0')}`;
              if (a.idade != null) dt += ` (${a.idade} anos)`;
            }
          }
          return {
            cod: a.code,
            nome: a.nome,
            fone: a.telefone,
            dt_aniversario: dt,
            last_purchase: a.last_purchase_date,
            diasSemComprar: a.dias_sem_comprar,
          };
        });
    }

    if (categoriaSel === 'cashback') {
      return cashbackList;
    }

    // ativo / a_inativar / inativo → vem do erpData
    const todosClientes = erpData?.clientes || [];
    return todosClientes.filter((c) => {
      // Status: ativo / a_inativar / inativo
      if (c.statusCarteira !== categoriaSel.replace('a_inativar', 'a_inativar')) {
        // a_inativar no DB pode ser 'a_inativar' (mesmo)
        const target =
          categoriaSel === 'ativo'
            ? 'ativo'
            : categoriaSel === 'inativo'
              ? 'inativo'
              : 'a_inativar';
        if (c.statusCarteira !== target) return false;
      }
      // Filtra pelo vendedor selecionado
      if (vendedorSel && c.vendedorCode !== vendedorSel.code) return false;
      return true;
    });
  }, [erpData, categoriaSel, vendedorSel, topClientes, aniversariantes, cashbackList]);

  // Aplica busca
  const clientesFiltrados = useMemo(() => {
    if (!busca) return clientesDaCategoria;
    const q = busca.toLowerCase();
    return clientesDaCategoria.filter((c) => {
      const nome = (c.nome || c.person_nome || '').toLowerCase();
      const fone = cleanPhone(c.fone || c.person_telefone || '');
      const cidade = (c.cidade || c.person_cidade || '').toLowerCase();
      return (
        nome.includes(q) ||
        fone.includes(cleanPhone(busca)) ||
        cidade.includes(q)
      );
    });
  }, [clientesDaCategoria, busca]);

  // Stats por categoria
  const statsCategoria = useMemo(() => {
    if (!erpData?.clientes || !vendedorSel) return {};
    const out = { ativo: 0, a_inativar: 0, inativo: 0 };
    for (const c of erpData.clientes) {
      if (c.vendedorCode !== vendedorSel.code) continue;
      if (out[c.statusCarteira] !== undefined) out[c.statusCarteira]++;
    }
    out.aniversariante = aniversariantes.filter((a) => {
      if (!vendedorSel) return true;
      const dc = a.ultimo_vendedor?.dealer_code;
      if (dc != null) return Number(dc) === vendedorSel.code;
      return true; // sem info de vendedor — todos contam
    }).length;
    out.cashback = cashbackList.length;
    out.top = topClientes.length;
    return out;
  }, [erpData, vendedorSel, aniversariantes, cashbackList, topClientes]);

  if (!erpData?.clientes) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
        <Phone size={48} weight="duotone" className="mx-auto text-gray-300 mb-3" />
        <p className="text-sm font-semibold text-[#000638]">Carteira não carregada</p>
        <p className="text-xs text-gray-500 mt-1">
          Aguarde o ERP carregar (botão ERP TOTVS no topo) para começar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header com seletor de vendedor */}
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 text-white rounded-xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-emerald-200">
              Lead Generation · {modulo}
            </p>
            <p className="text-base font-bold mt-0.5">
              Carteira de prospecção por ligação
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-emerald-200">Vendedor:</label>
            <select
              value={vendedorSel?.code || ''}
              onChange={(e) => {
                const v = vendedoresDoModulo.find((x) => x.code === Number(e.target.value));
                setVendedorSel(v || null);
              }}
              className="text-xs bg-white text-[#000638] rounded-lg px-3 py-1.5 font-medium focus:outline-none"
            >
              {vendedoresDoModulo.map((v) => (
                <option key={v.code} value={v.code}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Tabs por categoria */}
      <div className="bg-white border border-gray-200 rounded-xl p-3">
        <div className="flex flex-wrap gap-2">
          {CATEGORIAS.map((c) => {
            const Icon = c.icon;
            const isActive = categoriaSel === c.key;
            const count = statsCategoria[c.key] || 0;
            return (
              <button
                key={c.key}
                onClick={() => setCategoriaSel(c.key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition ${
                  isActive
                    ? `${c.bg} ${c.border} ${c.text} shadow-sm`
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <Icon size={14} weight={isActive ? 'fill' : 'regular'} />
                <span className="text-xs font-bold">{c.label}</span>
                <span
                  className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-white/60' : 'bg-gray-100'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Gráfico: ligações atendidas por dia */}
      <LigacoesAtendidasChart
        modulo={modulo}
        vendedoresDoModulo={vendedoresDoModulo}
        refreshKey={refreshKey}
      />

      {/* Busca */}
      <div className="bg-white border border-gray-200 rounded-xl p-3">
        <div className="relative">
          <MagnifyingGlass
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Buscar nome, telefone ou cidade..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
          />
        </div>
      </div>

      {/* Lista de clientes */}
      {(loadingTop && categoriaSel === 'top') ? (
        <div className="bg-white rounded-xl p-12 text-center text-gray-400">
          <Spinner size={28} className="animate-spin mx-auto mb-2" />
          <p className="text-sm">Carregando top clientes...</p>
        </div>
      ) : clientesFiltrados.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-400">
          <Phone size={36} weight="duotone" className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm">Nenhum cliente nessa categoria{busca ? ' com esses filtros' : ''}.</p>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] text-gray-500">
              Mostrando <span className="font-bold tabular-nums">{clientesFiltrados.length}</span>{' '}
              {clientesFiltrados.length === 1 ? 'cliente' : 'clientes'}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {clientesFiltrados.slice(0, 100).map((c) => {
              const pc = c.cod || c.person_code;
              return (
                <ClienteCard
                  key={pc}
                  cliente={c}
                  categoria={categoriaSel}
                  ultimoContato={callsByPerson[pc]}
                  onRegistrar={(cliente, categoria) =>
                    setShowRegistrar({ cliente, categoria })
                  }
                  onHistorico={(cliente) => setShowHistorico(cliente)}
                  onUltimaCompra={(cliente) => setShowUltimaCompra(cliente)}
                  onChatLead={onChatLead}
                />
              );
            })}
          </div>
          {clientesFiltrados.length > 100 && (
            <p className="text-[10px] text-gray-400 text-center mt-3">
              Mostrando os 100 primeiros de {clientesFiltrados.length}. Refine a busca.
            </p>
          )}
        </div>
      )}

      {/* Modais */}
      <RegistrarChamadaModal
        open={!!showRegistrar}
        cliente={showRegistrar?.cliente}
        categoria={showRegistrar?.categoria}
        vendedor={vendedorSel}
        modulo={modulo}
        onClose={() => setShowRegistrar(null)}
        onSaved={() => setRefreshKey((k) => k + 1)}
      />
      <HistoricoModal
        open={!!showHistorico}
        cliente={showHistorico}
        onClose={() => setShowHistorico(null)}
      />
      <UltimaCompraModal
        open={!!showUltimaCompra}
        cliente={showUltimaCompra}
        modulo={modulo}
        onClose={() => setShowUltimaCompra(null)}
      />
    </div>
  );
}
