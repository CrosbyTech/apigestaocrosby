import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  MagnifyingGlass,
  WhatsappLogo,
  Swap,
  CaretDown,
  CaretUp,
  X,
  CheckCircle,
  XCircle,
  Warning,
  Users,
  Storefront,
  Copy,
  Spinner,
  Check,
  Funnel,
  User,
  ArrowRight,
} from '@phosphor-icons/react';
import {
  formatPhone,
  cleanPhone,
  ALL_INSTANCES,
  instLabel,
} from './constants';
import { API_BASE_URL } from '../../config/constants';

const API_KEY = import.meta.env.VITE_API_KEY || '';

// ─── API helpers ────────────────────────────────────────────────────────────
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
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
  });
  const json = await r.json();
  return json.data ?? json;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function highlightText(text, expr) {
  if (!expr || !text) return text;
  try {
    const regex = new RegExp(`(${expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = String(text).split(regex);
    return parts.map((p, i) =>
      regex.test(p) ? (
        <mark key={i} className="bg-yellow-100 text-gray-900 px-0.5 rounded">{p}</mark>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  } catch {
    return text;
  }
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
}

// Metadados visuais por canal de venda
const CANAL_META = {
  varejo: {
    label: 'Varejo',
    dot: 'bg-blue-500',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
  },
  multimarcas: {
    label: 'Multimarcas',
    dot: 'bg-amber-500',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
  },
  revenda: {
    label: 'Revenda',
    dot: 'bg-emerald-500',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
  },
  franquia: {
    label: 'Franquia',
    dot: 'bg-violet-500',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    text: 'text-violet-700',
  },
  business: {
    label: 'Business',
    dot: 'bg-slate-500',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    text: 'text-slate-700',
  },
  inbound: {
    label: 'Inbound',
    dot: 'bg-fuchsia-500',
    bg: 'bg-fuchsia-50',
    border: 'border-fuchsia-200',
    text: 'text-fuchsia-700',
  },
  outros: {
    label: 'Outros',
    dot: 'bg-gray-400',
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-700',
  },
  sem_canal: {
    label: 'Sem canal',
    dot: 'bg-gray-300',
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-600',
  },
};

const AVATAR_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
  '#f97316', '#14b8a6', '#a855f7', '#3b82f6',
];

// Categorias de instâncias para os quick filters
const INST_GROUPS = {
  closers: ['anderson', 'rafael', 'david', 'walter', 'yago', 'renato', 'arthur', 'marcio', 'atc2318', 'atc1136', 'felipepb', 'michel', 'jucelino', 'baatacado'],
  prosp: ['prosp'],
  lojas: [
    'midway',
    'cidadejardim',
    'shoppingcidadejardim',
    'ayrtonsenna',
    'canguartema',
    'novacruz',
    'parnamirim',
    'recife',
    'teresina',
    'imperatriz',
    'guararapes',
    'patos',
    'joaopessoa',
  ],
};

// ─── Modal de roubo ─────────────────────────────────────────────────────────
function RouboModal({ open, lead, onClose, onConfirm }) {
  const [eu, setEu] = useState('');
  const [alvo, setAlvo] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && lead?.instance) setAlvo(lead.instance);
  }, [open, lead]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!eu || !alvo) return;
    setLoading(true);
    try {
      await onConfirm({ eu, alvo, lead });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-900">Solicitar Transferência</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Pedir o lead para outro vendedor</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Lead info */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center font-medium text-sm">
              {initials(lead?.nome || 'L')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 truncate">{lead?.nome || 'Lead sem nome'}</div>
              <div className="text-[11px] font-mono text-gray-500">{formatPhone(lead?.fone)}</div>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
              Eu sou
            </label>
            <select
              value={eu}
              onChange={(e) => setEu(e.target.value)}
              className="w-full border border-gray-200 rounded-md text-xs px-2 py-2 mt-1 focus:outline-none focus:border-gray-400"
            >
              <option value="">Selecione sua instância...</option>
              {ALL_INSTANCES.map((i) => (
                <option key={i.name} value={i.name}>{i.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
              Quero pegar de
            </label>
            <select
              value={alvo}
              onChange={(e) => setAlvo(e.target.value)}
              className="w-full border border-gray-200 rounded-md text-xs px-2 py-2 mt-1 focus:outline-none focus:border-gray-400"
            >
              <option value="">Selecione o vendedor atual...</option>
              {ALL_INSTANCES.filter((i) => i.name !== eu).map((i) => (
                <option key={i.name} value={i.name}>{i.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs text-gray-600 px-3 py-1.5 rounded-md hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!eu || !alvo || loading}
            className="bg-gray-900 hover:bg-gray-700 text-white text-xs font-medium px-4 py-1.5 rounded-md disabled:opacity-40 flex items-center gap-1.5"
          >
            {loading && <Spinner size={12} className="animate-spin" />}
            Solicitar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Card de instância (selecionável) ──────────────────────────────────────
function InstanceChip({ inst, selected, onToggle }) {
  const isCloser = INST_GROUPS.closers.includes(inst.name);
  const isLoja = INST_GROUPS.lojas.includes(inst.name);
  const tipo = isCloser ? 'C' : isLoja ? 'L' : 'P';
  const tipoColor = isCloser ? 'bg-blue-100 text-blue-700' : isLoja ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700';

  return (
    <button
      onClick={() => onToggle(inst.name)}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all text-left ${
        selected
          ? 'border-gray-900 bg-gray-900 text-white'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <span className={`w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center shrink-0 ${
        selected ? 'bg-white/20 text-white' : tipoColor
      }`}>
        {tipo}
      </span>
      <span className="text-xs font-medium truncate">{inst.label}</span>
      {selected && <Check size={11} weight="bold" className="ml-auto shrink-0" />}
    </button>
  );
}

// ─── Card de resultado de busca ─────────────────────────────────────────────
function LeadResultCard({ lead, expr, onChatLead, onRoubar, hasRoubo }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(cleanPhone(lead.fone));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`bg-white border rounded-lg p-3 transition-all ${
      hasRoubo ? 'border-amber-200 bg-amber-50/30' : 'border-gray-100 hover:border-gray-200'
    }`}>
      <div className="flex items-start gap-3 mb-2">
        <div className="w-9 h-9 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center font-medium text-xs shrink-0">
          {initials(lead.nome)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-gray-900 truncate">
              {lead.nome || 'Lead sem nome'}
            </h4>
            {hasRoubo && (
              <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wider">
                Em disputa
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[11px] font-mono text-gray-500 mt-0.5">
            {formatPhone(lead.fone)}
            <button onClick={handleCopy} className="text-gray-400 hover:text-gray-700 p-0.5">
              {copied ? <Check size={10} weight="bold" className="text-emerald-600" /> : <Copy size={10} />}
            </button>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[10px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
              {instLabel(lead.instance)}
            </span>
            <span className="text-[10px] text-gray-400">
              {lead.msgCount || lead.messages?.length || 0} mensagens
            </span>
          </div>
        </div>
      </div>

      {/* Ações */}
      <div className="flex gap-1 mt-2">
        {onChatLead && (
          <button
            onClick={() =>
              onChatLead({
                telefone: lead.fone,
                nome: lead.nome,
                inst: lead.instance,
                provider: lead.provider || 'evolution',
              })
            }
            className="flex-1 flex items-center justify-center gap-1 text-xs text-gray-700 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 px-2 py-1.5 rounded-md"
          >
            <WhatsappLogo size={12} />
            Ver chat na {instLabel(lead.instance)}
          </button>
        )}
        <button
          onClick={() => onRoubar(lead)}
          disabled={hasRoubo}
          className="flex-1 flex items-center justify-center gap-1 text-xs bg-gray-900 hover:bg-gray-700 text-white px-2 py-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Swap size={12} />
          {hasRoubo ? 'Já solicitado' : 'Solicitar'}
        </button>
      </div>

      {/* Mensagens expansíveis */}
      {lead.messages && lead.messages.length > 0 && (
        <>
          <button
            onClick={() => setExpanded((x) => !x)}
            className="text-[11px] text-gray-500 hover:text-gray-900 mt-2 flex items-center gap-1"
          >
            {expanded ? <CaretUp size={11} /> : <CaretDown size={11} />}
            {expanded ? 'Ocultar' : 'Ver'} mensagens correspondentes
          </button>
          {expanded && (
            <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto border-t border-gray-100 pt-2">
              {lead.messages.slice(0, 10).map((m, idx) => (
                <div
                  key={idx}
                  className={`text-[11px] p-2 rounded-md ${
                    m.fromMe ? 'bg-emerald-50 ml-8' : 'bg-gray-50 mr-8'
                  }`}
                >
                  <div className="text-[9px] text-gray-400 mb-0.5 flex items-center justify-between">
                    <span>{m.fromMe ? 'Eu' : 'Lead'}</span>
                    <span>{m.dataStr || m.date || ''}</span>
                  </div>
                  <div className="text-gray-700">{highlightText(m.texto || m.body, expr)}</div>
                </div>
              ))}
              {lead.messages.length > 10 && (
                <div className="text-[10px] text-gray-400 text-center pt-1">
                  + {lead.messages.length - 10} mensagens não exibidas
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Card de roubo (com ações) ──────────────────────────────────────────────
function RouboCard({ roubo, onAction }) {
  const statusCfg = {
    disputa: { Icone: Warning, cls: 'text-amber-600 bg-amber-50', label: 'Em disputa' },
    cedido: { Icone: CheckCircle, cls: 'text-emerald-600 bg-emerald-50', label: 'Cedido' },
    evitado: { Icone: XCircle, cls: 'text-red-600 bg-red-50', label: 'Evitado' },
  }[roubo.status] || { Icone: Warning, cls: 'text-gray-500 bg-gray-50', label: roubo.status };
  const { Icone } = statusCfg;
  const isDisputa = roubo.status === 'disputa';

  return (
    <div className="bg-white border border-gray-100 rounded-lg p-3 hover:border-gray-200 transition-colors">
      <div className="flex items-start gap-2 mb-2">
        <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center font-medium text-[11px] shrink-0">
          {initials(roubo.nome || 'L')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-gray-900 truncate">
            {roubo.nome || formatPhone(roubo.fone)}
          </div>
          <div className="text-[10px] text-gray-500 font-mono">{formatPhone(roubo.fone)}</div>
        </div>
        <div className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full ${statusCfg.cls}`}>
          <Icone size={10} weight="fill" />
          {statusCfg.label}
        </div>
      </div>
      <div className="text-[11px] text-gray-500 flex items-center gap-1.5 mb-2">
        <span className="font-medium">{instLabel(roubo.de)}</span>
        <span className="text-gray-300">→</span>
        <span className="font-medium">{instLabel(roubo.para)}</span>
      </div>
      {isDisputa && onAction && (
        <div className="flex gap-1 mt-2 pt-2 border-t border-gray-50">
          <button
            onClick={() => onAction(roubo, 'ceder')}
            className="flex-1 text-[11px] text-emerald-700 border border-emerald-200 hover:bg-emerald-50 px-2 py-1 rounded-md"
          >
            Ceder
          </button>
          <button
            onClick={() => onAction(roubo, 'recusar')}
            className="flex-1 text-[11px] text-red-700 border border-red-200 hover:bg-red-50 px-2 py-1 rounded-md"
          >
            Recusar
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
// ─── Modal: transferir lead (roubar) ────────────────────────────────────────
const ROUBAVEL_STATUS = new Set(['sql', '1º contato feito', '1° contato feito']);

function isRoubavel(lead) {
  return ROUBAVEL_STATUS.has(String(lead?.status || '').trim().toLowerCase());
}

function TransferLeadModal({ open, lead, vendedoresOpcoes, onClose, onConfirm, loading, error }) {
  const [destino, setDestino] = useState('');

  useEffect(() => {
    if (!open) setDestino('');
  }, [open, lead?.id]);

  if (!open || !lead) return null;

  const handleConfirm = () => {
    if (!destino) return;
    onConfirm({ taskId: lead.id, deVendedorClickupId: lead.vendedorClickupId, paraVendedorClickupId: destino });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-900">Roubar Lead</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Lead:</span>
              <span className="font-medium text-gray-900 truncate ml-2">{lead.nome || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Telefone:</span>
              <span className="font-mono text-gray-700">{formatPhone(lead.telefone) || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Categoria:</span>
              <span className="text-gray-700">{lead.canalDetalhe || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Status:</span>
              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700 font-medium">
                {lead.status || '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Vendedor atual:</span>
              <span className="font-medium text-gray-900">{lead.vendedor || '—'}</span>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1.5">
              Transferir para:
            </label>
            <select
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              disabled={loading}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Selecione um vendedor...</option>
              {vendedoresOpcoes.map((v) => (
                <option key={v.clickupId} value={v.clickupId}>
                  {v.nome}
                </option>
              ))}
            </select>
            {vendedoresOpcoes.length === 0 && (
              <p className="text-[11px] text-gray-400 mt-1">
                Nenhum outro vendedor no mesmo módulo
              </p>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-xs px-3 py-2 rounded-md flex items-center gap-2">
              <Warning size={14} />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!destino || loading}
            className="px-3 py-1.5 text-xs font-medium bg-[#000638] text-white rounded-md hover:bg-[#000638]/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? <Spinner size={12} className="animate-spin" /> : <ArrowRight size={12} weight="bold" />}
            {loading ? 'Transferindo...' : 'Confirmar roubo'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoubarLeads({ modulo, onChatLead, data, vendedoresMap, onRefreshLeads }) {
  const [expr, setExpr] = useState('');
  const [direcao, setDirecao] = useState('todas');
  const [selecionadas, setSelecionadas] = useState([]);
  const [searchInst, setSearchInst] = useState('');
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [showResults, setShowResults] = useState(false);

  // Lista unificada (Evolution + UAzapi) carregada do backend
  const [instances, setInstances] = useState([]);
  useEffect(() => {
    apiGet('/api/crm/instances')
      .then((d) => setInstances(d?.instances || []))
      .catch(() => setInstances([]));
  }, []);

  const [modalOpen, setModalOpen] = useState(false);
  const [leadModal, setLeadModal] = useState(null);

  const [roubos, setRoubos] = useState([]);
  const [loadingRoubos, setLoadingRoubos] = useState(false);
  const [filtroRoubos, setFiltroRoubos] = useState('todos');

  // ── Roubo direto (transferência ClickUp) ──
  const [vendedorExpandido, setVendedorExpandido] = useState(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferLead, setTransferLead] = useState(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState('');

  // Carregar roubos
  const carregarRoubos = useCallback(async () => {
    setLoadingRoubos(true);
    try {
      const data = await apiGet('/api/crm/roubos');
      setRoubos(Array.isArray(data) ? data : data?.roubos || []);
    } catch (e) {
      setRoubos([]);
    } finally {
      setLoadingRoubos(false);
    }
  }, []);

  useEffect(() => {
    carregarRoubos();
  }, [carregarRoubos]);

  // Lista combinada Evolution + UAzapi (com fallback para o hardcoded enquanto carrega)
  const instLista = useMemo(() => {
    if (instances.length > 0) return instances;
    return ALL_INSTANCES.map((i) => ({ ...i, provider: 'evolution' }));
  }, [instances]);

  // Map name → provider (para enviar ao backend)
  const instProviderMap = useMemo(() => {
    const m = {};
    for (const i of instLista) m[i.name] = i.provider || 'evolution';
    return m;
  }, [instLista]);

  // Filtros de instância
  const instanciasFiltradas = useMemo(() => {
    const q = searchInst.toLowerCase().trim();
    return instLista.filter(
      (i) =>
        !q ||
        (i.label || '').toLowerCase().includes(q) ||
        (i.name || '').toLowerCase().includes(q),
    );
  }, [searchInst, instLista]);

  const toggleInst = useCallback((name) => {
    setSelecionadas((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const selecionarGrupo = useCallback(
    (tipo) => {
      if (tipo === 'todos') {
        setSelecionadas(instLista.map((i) => i.name));
      } else if (tipo === 'limpar') {
        setSelecionadas([]);
      } else if (INST_GROUPS[tipo]) {
        setSelecionadas(INST_GROUPS[tipo]);
      }
    },
    [instLista],
  );

  // Busca
  const buscar = useCallback(async () => {
    if (!expr.trim()) {
      setErro('Digite uma expressão para buscar');
      return;
    }
    if (selecionadas.length === 0) {
      setErro('Selecione pelo menos uma instância');
      return;
    }
    setErro('');
    setLoading(true);
    setShowResults(true);
    try {
      // Envia [{name, provider}] para o backend dispatchar Evolution vs UAzapi
      const instancesPayload = selecionadas.map((name) => ({
        name,
        provider: instProviderMap[name] || 'evolution',
      }));
      const data = await apiPost('/api/crm/buscar-msgs', {
        expr: expr.trim(),
        instances: instancesPayload,
        direcao,
      });
      const lista = Array.isArray(data) ? data : data?.results || data?.leads || [];
      setResultados(lista);
    } catch (e) {
      setErro('Erro ao buscar mensagens');
      setResultados([]);
    } finally {
      setLoading(false);
    }
  }, [expr, selecionadas, direcao, instProviderMap]);

  // Roubo
  const handleRoubar = useCallback((lead) => {
    setLeadModal(lead);
    setModalOpen(true);
  }, []);

  const handleConfirmRoubo = useCallback(async ({ eu, alvo, lead }) => {
    try {
      await apiPost('/api/crm/roubos', {
        action: 'solicitar',
        eu,
        alvo,
        lead: { fone: cleanPhone(lead?.fone), nome: lead?.nome },
      });
      carregarRoubos();
    } catch (e) {
      setErro('Erro ao solicitar transferência');
    }
  }, [carregarRoubos]);

  const handleAcaoRoubo = useCallback(async (roubo, action) => {
    try {
      await apiPost('/api/crm/roubos', { action, id: roubo.id });
      carregarRoubos();
    } catch (e) {
      setErro('Erro ao atualizar disputa');
    }
  }, [carregarRoubos]);

  // Estatísticas
  const stats = useMemo(() => {
    const s = { total: roubos.length, disputa: 0, cedido: 0, evitado: 0 };
    roubos.forEach((r) => {
      if (s[r.status] !== undefined) s[r.status]++;
    });
    return s;
  }, [roubos]);

  // Set de telefones que já têm roubo
  const fonesComRoubo = useMemo(() => {
    return new Set(roubos.filter((r) => r.status === 'disputa').map((r) => cleanPhone(r.fone)));
  }, [roubos]);

  // Roubos filtrados
  const roubosFiltrados = useMemo(() => {
    if (filtroRoubos === 'todos') return roubos;
    return roubos.filter((r) => r.status === filtroRoubos);
  }, [roubos, filtroRoubos]);

  // ── Leads roubáveis organizados por CANAL DE VENDA → VENDEDOR ──
  // Estrutura nested para permitir filtro por canal e visualização clara.
  // Normaliza canalDetalhe em chaves canônicas (varejo / multimarcas / revenda / outros).
  const normalizarCanal = (lead) => {
    const c = String(lead.canalDetalhe || '').toLowerCase();
    if (!c) return 'sem_canal';
    if (c.includes('multimarcas') || c.includes('multimarca') || c.includes('b2m'))
      return 'multimarcas';
    if (c.includes('revenda') || c.includes('revend') || c.includes('b2r') || c.includes('atacado'))
      return 'revenda';
    if (c.includes('varejo') || c.includes('b2c') || c.includes('consumidor'))
      return 'varejo';
    if (c.includes('franqu')) return 'franquia';
    if (c.includes('business') || c.includes('b2b')) return 'business';
    if (c.includes('inbound')) return 'inbound';
    return 'outros';
  };

  const [filtroCanalRoubo, setFiltroCanalRoubo] = useState('todos');

  const leadsPorCanal = useMemo(() => {
    if (!data?.canais) return {};
    const porCanal = {};
    for (const canal of data.canais) {
      for (const t of canal.tarefas || []) {
        if (!isRoubavel(t)) continue;
        if (!t.vendedorClickupId) continue;
        const canalKey = normalizarCanal(t);
        if (!porCanal[canalKey]) porCanal[canalKey] = {};
        const grupo = porCanal[canalKey];
        if (!grupo[t.vendedorClickupId]) {
          grupo[t.vendedorClickupId] = {
            clickupId: t.vendedorClickupId,
            nome: t.vendedor || 'Sem nome',
            modulo: t.vendedorModulo || canalKey,
            leads: [],
          };
        }
        grupo[t.vendedorClickupId].leads.push(t);
      }
    }
    // Ordena vendedores dentro de cada canal por # de leads desc
    const result = {};
    for (const [k, v] of Object.entries(porCanal)) {
      result[k] = Object.values(v).sort((a, b) => b.leads.length - a.leads.length);
    }
    return result;
  }, [data]);

  // Estatísticas por canal
  const totaisPorCanal = useMemo(() => {
    const totals = {};
    for (const [canal, vendedores] of Object.entries(leadsPorCanal)) {
      totals[canal] = vendedores.reduce((s, v) => s + v.leads.length, 0);
    }
    return totals;
  }, [leadsPorCanal]);

  // Lista de canais disponíveis (com leads) para mostrar nas pills
  const canaisDisponiveis = useMemo(() => {
    const lista = ['varejo', 'multimarcas', 'revenda', 'franquia', 'business', 'inbound', 'outros', 'sem_canal'];
    return lista.filter((c) => (leadsPorCanal[c]?.length || 0) > 0);
  }, [leadsPorCanal]);

  // Canais a renderizar (com base no filtro selecionado)
  const canaisRender = useMemo(() => {
    if (filtroCanalRoubo === 'todos') return canaisDisponiveis;
    return canaisDisponiveis.filter((c) => c === filtroCanalRoubo);
  }, [canaisDisponiveis, filtroCanalRoubo]);

  // Lista de vendedores possíveis como destino para o lead atual (mesmo módulo, ≠ atual, ativos)
  const vendedoresOpcoesTransfer = useMemo(() => {
    if (!transferLead || !vendedoresMap?.byClickupId) return [];
    return Object.entries(vendedoresMap.byClickupId)
      .filter(([clickupId, info]) => {
        if (clickupId === transferLead.vendedorClickupId) return false;
        if (info.ativo === false) return false;
        if (info.modulo && info.modulo !== modulo) return false;
        return true;
      })
      .map(([clickupId, info]) => ({ clickupId, nome: info.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [transferLead, vendedoresMap, modulo]);

  const handleAbrirTransfer = useCallback((lead) => {
    setTransferLead(lead);
    setTransferError('');
    setTransferOpen(true);
  }, []);

  const handleConfirmarTransfer = useCallback(
    async ({ taskId, deVendedorClickupId, paraVendedorClickupId }) => {
      setTransferLoading(true);
      setTransferError('');
      try {
        const r = await fetch(`${API_BASE_URL}/api/crm/transferir-lead`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
          body: JSON.stringify({ taskId, deVendedorClickupId, paraVendedorClickupId }),
        });
        const json = await r.json();
        if (!r.ok || json.success === false) {
          throw new Error(json.message || `Erro ${r.status}`);
        }
        setTransferOpen(false);
        setTransferLead(null);
        // Recarrega leads + roubos para refletir a mudança
        if (typeof onRefreshLeads === 'function') onRefreshLeads();
        carregarRoubos();
      } catch (e) {
        setTransferError(e.message || 'Erro ao transferir lead');
      } finally {
        setTransferLoading(false);
      }
    },
    [carregarRoubos, onRefreshLeads],
  );

  return (
    <div className="space-y-5">
      {/* ═══ ESTATÍSTICAS ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total disputas', value: stats.total, color: 'text-gray-900' },
          { label: 'Em disputa', value: stats.disputa, color: 'text-amber-600' },
          { label: 'Cedidos', value: stats.cedido, color: 'text-emerald-600' },
          { label: 'Evitados', value: stats.evitado, color: 'text-red-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
              {s.label}
            </div>
            <div className={`text-2xl font-light tabular-nums mt-1 ${s.color}`}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* ═══ LEADS POR CANAL × VENDEDOR (ROUBO DIRETO) ═══════════════════ */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-bold text-[#000638]">
              Leads disponíveis para roubo
            </h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Em <span className="font-medium">SQL</span> ou{' '}
              <span className="font-medium">1º Contato Feito</span> · separados por canal de venda
            </p>
          </div>
          <span className="text-[11px] text-gray-500 tabular-nums px-2.5 py-1 bg-gray-50 rounded-full">
            {Object.values(totaisPorCanal).reduce((s, n) => s + n, 0)} leads
            roubáveis
          </span>
        </div>

        {/* Pills de filtro por canal */}
        {canaisDisponiveis.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-4 p-1 bg-gray-50 rounded-lg w-fit">
            <button
              onClick={() => setFiltroCanalRoubo('todos')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                filtroCanalRoubo === 'todos'
                  ? 'bg-[#000638] text-white shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Todos
              <span
                className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] tabular-nums ${
                  filtroCanalRoubo === 'todos'
                    ? 'bg-white/20'
                    : 'bg-gray-200 text-gray-700'
                }`}
              >
                {Object.values(totaisPorCanal).reduce((s, n) => s + n, 0)}
              </span>
            </button>
            {canaisDisponiveis.map((c) => {
              const meta = CANAL_META[c] || { label: c, dot: 'bg-gray-400' };
              const isActive = filtroCanalRoubo === c;
              return (
                <button
                  key={c}
                  onClick={() => setFiltroCanalRoubo(c)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-white text-[#000638] shadow border border-gray-200'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] tabular-nums ${
                      isActive
                        ? 'bg-gray-100 text-gray-700'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {totaisPorCanal[c] || 0}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {canaisDisponiveis.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-8 text-center">
            <Users size={32} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              Nenhum lead roubável no período selecionado
            </p>
            <p className="text-[11px] text-gray-400 mt-1">
              Apenas leads em SQL ou 1º Contato Feito aparecem aqui
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {canaisRender.map((canalKey) => {
              const meta = CANAL_META[canalKey] || {
                label: canalKey,
                dot: 'bg-gray-400',
                bg: 'bg-gray-50',
                border: 'border-gray-200',
                text: 'text-gray-700',
              };
              const vendedores = leadsPorCanal[canalKey] || [];
              const totalCanal = totaisPorCanal[canalKey] || 0;
              return (
                <div
                  key={canalKey}
                  className="bg-white border border-gray-200 rounded-xl overflow-hidden"
                >
                  <div
                    className={`${meta.bg} border-b ${meta.border} px-4 py-2.5 flex items-center justify-between`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${meta.dot}`}
                      />
                      <h3
                        className={`text-xs font-bold uppercase tracking-widest ${meta.text}`}
                      >
                        {meta.label}
                      </h3>
                      <span className="text-[10px] text-gray-500">
                        · {vendedores.length} vendedor
                        {vendedores.length === 1 ? '' : 'es'}
                      </span>
                    </div>
                    <span
                      className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-full bg-white border ${meta.border} ${meta.text}`}
                    >
                      {totalCanal} leads
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
                    {vendedores.map((v, idx) => {
                      const expandido = vendedorExpandido === v.clickupId;
                      const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                      return (
                        <div
                          key={v.clickupId}
                          className={`bg-white border rounded-lg overflow-hidden transition-all ${
                            expandido ? 'border-orange-300 shadow-md' : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <button
                            onClick={() =>
                              setVendedorExpandido(
                                expandido ? null : v.clickupId,
                              )
                            }
                            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className="shrink-0 w-9 h-9 rounded-full text-white text-xs font-bold flex items-center justify-center shadow-sm"
                                style={{ background: avatarColor }}
                              >
                                {initials(v.nome)}
                              </div>
                              <div className="min-w-0 text-left">
                                <div className="text-sm font-semibold text-[#000638] truncate">
                                  {v.nome}
                                </div>
                                <div className="text-[10px] text-gray-400 mt-0.5">
                                  Clique para ver os leads
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-base font-bold tabular-nums text-orange-600">
                                {v.leads.length}
                              </span>
                              {expandido ? (
                                <CaretUp size={12} className="text-gray-400" />
                              ) : (
                                <CaretDown size={12} className="text-gray-400" />
                              )}
                            </div>
                          </button>
                          {expandido && (
                            <div className="border-t border-gray-100 bg-gray-50/40 max-h-[400px] overflow-y-auto">
                              {v.leads.map((lead) => (
                                <div
                                  key={lead.id}
                                  className="border-b border-gray-100 last:border-0 px-3 py-2.5 hover:bg-white"
                                >
                                  <div className="flex items-start justify-between gap-2 mb-1.5">
                                    <div className="min-w-0 flex-1">
                                      <div className="text-xs font-semibold text-[#000638] truncate">
                                        {lead.nome || 'Sem nome'}
                                      </div>
                                      <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                                        {formatPhone(lead.telefone) || '—'}
                                      </div>
                                    </div>
                                    <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 uppercase">
                                      {lead.status}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 mt-2">
                                    {onChatLead && (
                                      <button
                                        onClick={() =>
                                          onChatLead({
                                            telefone: lead.telefone,
                                            nome: lead.nome,
                                            inst: lead.vendedorEvolutionInst,
                                          })
                                        }
                                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 rounded-md border border-emerald-200"
                                        title="Ver conversa"
                                      >
                                        <WhatsappLogo size={11} weight="bold" />
                                        Conversa
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleAbrirTransfer(lead)}
                                      className="ml-auto flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-md transition shadow-sm"
                                      title="Pegar este lead pra mim"
                                    >
                                      <Swap size={11} weight="bold" />
                                      Pegar este lead
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ BUSCAR MENSAGENS ══════════════════════════════════════════ */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-gray-900">Buscar Mensagens</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Encontre conversas por palavra-chave em instâncias específicas
            </p>
          </div>
        </div>

        {/* Direção (pílulas) */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-400 font-medium block mb-1.5">
            Direção das mensagens
          </label>
          <div className="flex gap-1 bg-gray-50 p-1 rounded-lg w-fit">
            {[
              { key: 'todas', label: 'Todas' },
              { key: 'recebidas', label: 'Recebidas (lead)' },
              { key: 'enviadas', label: 'Enviadas (eu)' },
            ].map((d) => (
              <button
                key={d.key}
                onClick={() => setDirecao(d.key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  direcao === d.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Instâncias */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
              Instâncias {selecionadas.length > 0 && (
                <span className="text-gray-900 normal-case tracking-normal ml-1">
                  ({selecionadas.length} selecionada{selecionadas.length !== 1 ? 's' : ''})
                </span>
              )}
            </label>
            <div className="flex items-center gap-1">
              <button
                onClick={() => selecionarGrupo('closers')}
                className="text-[10px] text-blue-700 hover:bg-blue-50 px-2 py-0.5 rounded"
                title="Selecionar todos os closers"
              >
                <Users size={10} className="inline mr-0.5" /> Closers
              </button>
              <button
                onClick={() => selecionarGrupo('lojas')}
                className="text-[10px] text-purple-700 hover:bg-purple-50 px-2 py-0.5 rounded"
              >
                <Storefront size={10} className="inline mr-0.5" /> Lojas
              </button>
              <button
                onClick={() => selecionarGrupo('prosp')}
                className="text-[10px] text-emerald-700 hover:bg-emerald-50 px-2 py-0.5 rounded"
              >
                Prosp
              </button>
              <button
                onClick={() => selecionarGrupo('todos')}
                className="text-[10px] text-gray-700 hover:bg-gray-100 px-2 py-0.5 rounded"
              >
                Todos
              </button>
              <button
                onClick={() => selecionarGrupo('limpar')}
                className="text-[10px] text-gray-500 hover:bg-gray-100 px-2 py-0.5 rounded"
              >
                Limpar
              </button>
            </div>
          </div>

          {/* Search das instâncias */}
          <div className="relative mb-2">
            <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Filtrar instâncias..."
              value={searchInst}
              onChange={(e) => setSearchInst(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:border-gray-400"
            />
          </div>

          {/* Grid de instâncias */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 max-h-56 overflow-y-auto p-0.5">
            {instanciasFiltradas.map((i) => (
              <InstanceChip
                key={i.name}
                inst={i}
                selected={selecionadas.includes(i.name)}
                onToggle={toggleInst}
              />
            ))}
            {instanciasFiltradas.length === 0 && (
              <div className="col-span-full text-center text-xs text-gray-400 py-4">
                Nenhuma instância encontrada
              </div>
            )}
          </div>

          {/* Legenda */}
          <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-blue-100 text-blue-700 text-[8px] font-bold flex items-center justify-center">C</span>
              Closer
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-purple-100 text-purple-700 text-[8px] font-bold flex items-center justify-center">L</span>
              Loja
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-emerald-100 text-emerald-700 text-[8px] font-bold flex items-center justify-center">P</span>
              Prospector
            </span>
          </div>
        </div>

        {/* Expressão + botão */}
        <div className="flex gap-2 items-stretch">
          <div className="flex items-center gap-1 border border-gray-200 rounded-md px-2 py-1 flex-1 focus-within:border-gray-400">
            <MagnifyingGlass size={14} className="text-gray-400" />
            <input
              type="text"
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buscar()}
              placeholder='Ex: "comprar", "preço", "interessado"...'
              className="text-xs outline-none flex-1 py-1 bg-transparent"
            />
          </div>
          <button
            onClick={buscar}
            disabled={loading || !expr.trim() || selecionadas.length === 0}
            className="bg-gray-900 hover:bg-gray-700 text-white text-xs font-medium px-4 rounded-md disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {loading ? <Spinner size={12} className="animate-spin" /> : <MagnifyingGlass size={12} />}
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-100 text-red-600 text-xs px-3 py-2 rounded-md flex items-center gap-2">
            <Warning size={14} />
            {erro}
          </div>
        )}
      </div>

      {/* ═══ RESULTADOS DA BUSCA ═══════════════════════════════════════ */}
      {showResults && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-900">
              Resultados {resultados.length > 0 && (
                <span className="text-gray-400 font-normal ml-1">({resultados.length})</span>
              )}
            </h2>
            {resultados.length > 0 && (
              <button
                onClick={() => { setShowResults(false); setResultados([]); }}
                className="text-xs text-gray-500 hover:text-gray-900"
              >
                Limpar resultados
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
              <Spinner size={20} className="animate-spin" />
              <span className="text-xs">Buscando mensagens...</span>
            </div>
          ) : resultados.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-lg p-8 text-center">
              <MagnifyingGlass size={32} className="text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Nenhum resultado encontrado</p>
              <p className="text-xs text-gray-400 mt-1">
                Tente outra expressão ou amplie a seleção de instâncias
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {resultados.map((lead, idx) => (
                <LeadResultCard
                  key={`${lead.instance}-${lead.fone}-${idx}`}
                  lead={lead}
                  expr={expr}
                  onChatLead={onChatLead}
                  onRoubar={handleRoubar}
                  hasRoubo={fonesComRoubo.has(cleanPhone(lead.fone))}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ ROUBOS EXISTENTES ═════════════════════════════════════════ */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-900">
            Disputas {roubos.length > 0 && (
              <span className="text-gray-400 font-normal ml-1">({roubosFiltrados.length})</span>
            )}
          </h2>
          {roubos.length > 0 && (
            <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-md">
              {[
                { key: 'todos', label: 'Todos' },
                { key: 'disputa', label: 'Em disputa' },
                { key: 'cedido', label: 'Cedidos' },
                { key: 'evitado', label: 'Evitados' },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFiltroRoubos(f.key)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                    filtroRoubos === f.key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {loadingRoubos ? (
          <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
            <Spinner size={16} className="animate-spin" />
            <span className="text-xs">Carregando...</span>
          </div>
        ) : roubosFiltrados.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-lg p-8 text-center">
            <Swap size={32} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              {roubos.length === 0 ? 'Nenhuma disputa registrada' : 'Nenhuma disputa neste filtro'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Use a busca acima para encontrar leads e solicitar transferências
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {roubosFiltrados.map((r, i) => (
              <RouboCard
                key={r.id || `${r.fone}-${i}`}
                roubo={r}
                onAction={handleAcaoRoubo}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal de disputa (busca por mensagem) */}
      <RouboModal
        open={modalOpen}
        lead={leadModal}
        onClose={() => setModalOpen(false)}
        onConfirm={handleConfirmRoubo}
      />

      {/* Modal de roubo direto (transferência ClickUp) */}
      <TransferLeadModal
        open={transferOpen}
        lead={transferLead}
        vendedoresOpcoes={vendedoresOpcoesTransfer}
        onClose={() => {
          if (transferLoading) return;
          setTransferOpen(false);
          setTransferLead(null);
          setTransferError('');
        }}
        onConfirm={handleConfirmarTransfer}
        loading={transferLoading}
        error={transferError}
      />
    </div>
  );
}
