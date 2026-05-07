import React, { useState, useMemo, useEffect } from 'react';
import {
  ArrowLeft,
  WhatsappLogo,
  Link as LinkIcon,
  CheckCircle,
  Clock,
  MagnifyingGlass,
  Trophy,
  Medal,
  UserCircle,
  Question,
  CaretRight,
} from '@phosphor-icons/react';
import {
  COLORS,
  cleanPhone,
  formatPhone,
  getContactStatus,
  instLabel,
  VENDEDORES_POR_MODULO,
} from './constants';

// Cores por categoria para badges
const CATEGORIA_COLORS = {
  Varejo: { bg: 'bg-orange-100', text: 'text-orange-700' },
  Revenda: { bg: 'bg-blue-100', text: 'text-blue-700' },
  Multimarcas: { bg: 'bg-purple-100', text: 'text-purple-700' },
  Business: { bg: 'bg-teal-100', text: 'text-teal-700' },
  Franquia: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
};
function catColor(cat = '') {
  for (const [k, v] of Object.entries(CATEGORIA_COLORS)) {
    if (cat.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return { bg: 'bg-gray-100', text: 'text-gray-600' };
}

// Helper: extrai iniciais do nome (até 2 letras)
function initials(name = '') {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── Card de vendedor (redesign 2026) ────────────────────────────────────────
function CardItem({ item, color, rank, totalGeral, onClick }) {
  const enc = item.enc || 0;
  const conv = item.conv || 0;
  const naoConv = Math.max(0, enc - conv);
  const taxa = enc > 0 ? ((conv / enc) * 100).toFixed(1) : '0.0';
  const taxaNum = parseFloat(taxa);
  const semVendedor = item.nome === 'Sem Vendedor';
  const semLeads = enc === 0;
  const isTop = rank === 1 && enc > 0;
  const isTopThree = rank <= 3 && enc > 0;

  // Categorias ordenadas por encaminhados desc
  const cats = Object.entries(item.porCategoria || {}).sort(
    (a, b) => b[1].enc - a[1].enc,
  );

  // Share do total
  const shareTotal = totalGeral > 0 ? (enc / totalGeral) * 100 : 0;

  return (
    <button
      onClick={onClick}
      disabled={semLeads}
      className={`group relative text-left w-full rounded-xl p-4 transition-all
        ${semLeads
          ? 'bg-gray-50 border border-dashed border-gray-200 cursor-default opacity-60'
          : 'bg-white border border-gray-200 hover:border-indigo-300 hover:shadow-md cursor-pointer'}
        ${isTop ? 'ring-2 ring-amber-300 ring-offset-1' : ''}
        ${semVendedor ? 'border-dashed' : ''}
      `}
    >
      {/* Badge de ranking */}
      {isTopThree && !semVendedor && (
        <div className="absolute -top-2 -right-2 z-10">
          {rank === 1 && (
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-md">
              <Trophy size={14} weight="fill" />
            </span>
          )}
          {rank === 2 && (
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-sm">
              <Medal size={12} weight="fill" />
            </span>
          )}
          {rank === 3 && (
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-orange-300 to-orange-500 text-white shadow-sm">
              <Medal size={12} weight="fill" />
            </span>
          )}
        </div>
      )}

      {/* Header: avatar + nome + lead count */}
      <div className="flex items-center gap-3 mb-3">
        {semVendedor ? (
          <span className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 text-gray-400">
            <Question size={16} weight="bold" />
          </span>
        ) : (
          <span
            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full text-white text-xs font-bold shadow-sm"
            style={{ background: color }}
          >
            {initials(item.nome)}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-semibold truncate ${semVendedor ? 'text-gray-500 italic' : 'text-[#000638]'}`}>
            {item.nome}
          </h3>
          <p className="text-[10px] text-gray-400 tabular-nums">
            {totalGeral > 0
              ? `${shareTotal.toFixed(1)}% do total`
              : 'sem leads'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-2xl font-bold tabular-nums leading-none ${semLeads ? 'text-gray-300' : 'text-[#000638]'}`}>
            {enc}
          </div>
          <div className="text-[9px] uppercase tracking-wide text-gray-400 mt-0.5">leads</div>
        </div>
      </div>

      {/* Breakdown por categoria */}
      {cats.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {cats.map(([cat, stats]) => {
            const cc = catColor(cat);
            const pct = enc > 0 ? (stats.enc / enc) * 100 : 0;
            return (
              <div key={cat} className="flex items-center gap-2">
                <span
                  className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${cc.bg} ${cc.text}`}
                  title={cat}
                >
                  {cat
                    .replace('Multimarcas Inbound', 'MTM Inbound')
                    .replace('Multimarcas Outbound', 'MTM Outbound')
                    .replace('Multimarcas', 'MTM')}
                </span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background: color,
                      opacity: 0.7,
                    }}
                  />
                </div>
                <span className="text-[10px] tabular-nums text-gray-600 shrink-0 w-7 text-right font-medium">
                  {stats.enc}
                </span>
                {stats.conv > 0 && (
                  <span className="text-[9px] tabular-nums text-emerald-600 font-bold shrink-0">
                    {stats.conv}✓
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: conversão + taxa visual */}
      <div className="pt-2.5 border-t border-gray-100">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="flex items-center gap-1 text-emerald-600 font-semibold tabular-nums">
              <CheckCircle size={11} weight="fill" />
              {conv}
            </span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-500 tabular-nums">{naoConv} pend.</span>
          </div>
          <span
            className={`text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full ${
              taxaNum >= 20
                ? 'bg-emerald-50 text-emerald-700'
                : taxaNum >= 5
                  ? 'bg-amber-50 text-amber-700'
                  : taxaNum > 0
                    ? 'bg-gray-100 text-gray-600'
                    : 'bg-gray-50 text-gray-400'
            }`}
          >
            {taxa}%
          </span>
        </div>
        {/* Mini barra de conversão */}
        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              taxaNum >= 20
                ? 'bg-emerald-500'
                : taxaNum >= 5
                  ? 'bg-amber-500'
                  : 'bg-gray-300'
            }`}
            style={{ width: `${Math.min(100, taxaNum)}%` }}
          />
        </div>
      </div>

      {/* Hint de clique */}
      {!semLeads && (
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <CaretRight size={12} className="text-indigo-400" />
        </div>
      )}
    </button>
  );
}

// ─── View de detalhes (lista de leads) ──────────────────────────────────────
function ListView({
  group,
  onBack,
  onChatLead,
  onChatCloser,
  onAnalise,
  phoneStatus,
}) {
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroOrigem, setFiltroOrigem] = useState('');
  const [filtroQual, setFiltroQual] = useState('');
  const [busca, setBusca] = useState('');
  const [filtroContato, setFiltroContato] = useState('');

  const { tasks, statuses, origens, quals } = useMemo(() => {
    const ts = group?.tasks || [];
    const st = new Set(),
      or = new Set(),
      qu = new Set();
    for (const t of ts) {
      if (t.status) st.add(t.status);
      if (t.origem) or.add(t.origem);
      if (t.qualidade) qu.add(t.qualidade);
    }
    return {
      tasks: ts,
      statuses: [...st].sort(),
      origens: [...or].sort(),
      quals: [...qu].sort(),
    };
  }, [group]);

  // Filtrar e deduplicar por telefone
  const filtered = useMemo(() => {
    const seen = {};
    const out = [];
    const q = busca.toLowerCase().trim();

    for (const t of tasks) {
      const key = cleanPhone(t.telefone).slice(-11);
      if (key && key.length >= 10) {
        if (seen[key]) continue;
        seen[key] = true;
      }
      if (filtroStatus && t.status !== filtroStatus) continue;
      if (filtroOrigem && t.origem !== filtroOrigem) continue;
      if (filtroQual && t.qualidade !== filtroQual) continue;
      if (q && !((t.nome || '') + (t.telefone || '')).toLowerCase().includes(q))
        continue;

      const cs = getContactStatus(t.telefone, t.closerInst, phoneStatus);
      if (filtroContato === 'pendente' && cs !== 'pendente') continue;
      if (filtroContato === 'contatado' && cs !== 'contatado') continue;
      if (filtroContato === 'outro' && cs !== 'outro') continue;

      out.push({ ...t, _contactStatus: cs });
    }
    return out.slice(0, 300);
  }, [
    tasks,
    filtroStatus,
    filtroOrigem,
    filtroQual,
    busca,
    filtroContato,
    phoneStatus,
  ]);

  const enc = group?.enc || tasks.length;
  const conv = group?.conv || 0;
  const naoConv = Math.max(0, enc - conv);
  const taxa = enc > 0 ? ((conv / enc) * 100).toFixed(1) : '0.0';

  const statusBadge = (cs) => {
    const base = 'text-[10px] px-2 py-0.5 rounded-full font-medium';
    if (cs === 'contatado')
      return (
        <span className={`${base} bg-emerald-50 text-emerald-700`}>
          Contatado
        </span>
      );
    if (cs === 'outro')
      return (
        <span className={`${base} bg-amber-50 text-amber-700`}>Outro</span>
      );
    return <span className={`${base} bg-gray-50 text-gray-500`}>Pendente</span>;
  };

  // Cor da inicial do vendedor por hash do nome
  const sellerColor = (n) => {
    if (!n) return '#94a3b8';
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
    const palette = [
      '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
      '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
    ];
    return palette[Math.abs(h) % palette.length];
  };
  const initials = (name = '') => {
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Status do funil em cores
  const statusFunilColor = (s = '') => {
    const v = String(s).toLowerCase();
    if (v.includes('comprou') || v.includes('convertido'))
      return 'bg-emerald-100 text-emerald-700';
    if (v.includes('contato') || v.includes('1º'))
      return 'bg-blue-100 text-blue-700';
    if (v.includes('sql')) return 'bg-indigo-100 text-indigo-700';
    if (v.includes('lead')) return 'bg-violet-100 text-violet-700';
    if (v.includes('sem contato') || v.includes('lp'))
      return 'bg-amber-100 text-amber-700';
    if (v.includes('desqual') || v.includes('inval'))
      return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft size={14} /> Voltar
      </button>

      {/* Header com avatar + KPIs */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-[200px]">
          <span
            className="flex items-center justify-center w-12 h-12 rounded-full text-white text-base font-bold shadow"
            style={{ background: sellerColor(group?.nome) }}
          >
            {initials(group?.nome)}
          </span>
          <div>
            <h2 className="text-lg font-bold text-[#000638] leading-tight">
              {group?.nome}
            </h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {tasks.length} lead{tasks.length === 1 ? '' : 's'} no período
            </p>
          </div>
        </div>

        {/* KPIs/filtros clicáveis */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFiltroContato('')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition ${
              !filtroContato
                ? 'bg-[#000638] text-white border-[#000638] shadow'
                : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
            }`}
          >
            <span className="font-bold tabular-nums text-base">{enc}</span>
            <span className="text-[11px] uppercase tracking-wide">Total</span>
          </button>
          <button
            onClick={() => setFiltroContato('contatado')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition ${
              filtroContato === 'contatado'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow'
                : 'bg-white text-emerald-700 border-emerald-200 hover:border-emerald-300'
            }`}
          >
            <CheckCircle size={14} weight="fill" />
            <span className="font-bold tabular-nums text-base">{conv}</span>
            <span className="text-[11px] uppercase tracking-wide">Convertidos</span>
          </button>
          <button
            onClick={() => setFiltroContato('pendente')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition ${
              filtroContato === 'pendente'
                ? 'bg-amber-500 text-white border-amber-500 shadow'
                : 'bg-white text-amber-700 border-amber-200 hover:border-amber-300'
            }`}
          >
            <Clock size={14} weight="fill" />
            <span className="font-bold tabular-nums text-base">{naoConv}</span>
            <span className="text-[11px] uppercase tracking-wide">Pendentes</span>
          </button>
          <div className="flex flex-col items-end gap-0.5 px-3 py-1 bg-gray-50 rounded-lg border border-gray-200">
            <span className="font-bold text-base text-[#000638] tabular-nums leading-none">
              {taxa}%
            </span>
            <span className="text-[9px] uppercase tracking-wider text-gray-500">
              conversão
            </span>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <MagnifyingGlass
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Buscar por nome ou telefone..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
          />
        </div>
        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white text-gray-700 focus:outline-none focus:border-indigo-400"
        >
          <option value="">Todos status</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={filtroOrigem}
          onChange={(e) => setFiltroOrigem(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white text-gray-700 focus:outline-none focus:border-indigo-400"
        >
          <option value="">Todas origens</option>
          {origens.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select
          value={filtroQual}
          onChange={(e) => setFiltroQual(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white text-gray-700 focus:outline-none focus:border-indigo-400"
        >
          <option value="">Todas qualidades</option>
          {quals.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-gray-400 tabular-nums px-2 py-1 bg-gray-50 rounded-md">
          {filtered.length} de {tasks.length}
        </span>
      </div>

      {/* Tabela */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-gray-500">
                <th className="px-3 py-2.5 text-left font-bold text-[10px] uppercase tracking-wider w-10">
                  #
                </th>
                <th className="px-3 py-2.5 text-left font-bold text-[10px] uppercase tracking-wider">
                  Nome
                </th>
                <th className="px-3 py-2.5 text-left font-bold text-[10px] uppercase tracking-wider">
                  Telefone
                </th>
                <th className="px-3 py-2.5 text-left font-bold text-[10px] uppercase tracking-wider">
                  Status do funil
                </th>
                <th className="px-3 py-2.5 text-left font-bold text-[10px] uppercase tracking-wider">
                  Origem
                </th>
                <th className="px-3 py-2.5 text-left font-bold text-[10px] uppercase tracking-wider">
                  Criado
                </th>
                <th className="px-3 py-2.5 text-left font-bold text-[10px] uppercase tracking-wider">
                  Contato
                </th>
                <th className="px-3 py-2.5 text-center font-bold text-[10px] uppercase tracking-wider w-24">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="p-12 text-center text-gray-300 text-xs"
                  >
                    Nenhum lead encontrado com esses filtros
                  </td>
                </tr>
              ) : (
                filtered.map((t, i) => (
                  <tr
                    key={t.id || i}
                    className="border-b border-gray-50 hover:bg-indigo-50/30 transition-colors"
                  >
                    <td className="px-3 py-2 text-gray-300 font-mono tabular-nums text-[10px]">
                      {String(i + 1).padStart(2, '0')}
                    </td>
                    <td className="px-3 py-2 font-semibold text-[#000638]">
                      {t.nome || '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-600 text-[11px] tabular-nums">
                      {formatPhone(t.telefone)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusFunilColor(t.status)}`}
                      >
                        {t.status || 'sem status'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-[11px]">
                      {t.origem || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-[10px] tabular-nums">
                      {t.dataCriacao
                        ? new Date(t.dataCriacao).toLocaleDateString('pt-BR')
                        : '—'}
                    </td>
                    <td className="px-3 py-2">{statusBadge(t._contactStatus)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => onChatLead && onChatLead(t)}
                          title="Abrir conversa (WhatsApp)"
                          className="p-1.5 rounded-lg hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition"
                        >
                          <WhatsappLogo size={14} weight="bold" />
                        </button>
                        {t.clickupUrl && (
                          <a
                            href={t.clickupUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Abrir no ClickUp"
                            className="p-1.5 rounded-lg hover:bg-purple-50 text-gray-400 hover:text-purple-600 transition"
                          >
                            <LinkIcon size={14} weight="bold" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {tasks.length > 300 && filtered.length === 300 && (
          <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 text-[10px] text-gray-500 text-center">
            Mostrando primeiros 300 de {tasks.length} leads. Use os filtros pra
            refinar.
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
export default function FunilView({
  data, // { canais: [{ nome, tarefas: [...] }] }
  modulo, // 'multimarcas' | 'revenda' | etc.
  phoneStatus = {},
  onChatLead,
  onChatCloser,
  onAnalise,
  vendedoresMap,
}) {
  // Guardamos só o NOME do vendedor selecionado — assim quando `data` muda
  // (filtro de data alterado), pegamos automaticamente o card atualizado.
  const [selectedNome, setSelectedNome] = useState(null);

  // Reset do selecionado quando módulo muda (vendedor pode não pertencer ao novo módulo)
  useEffect(() => {
    setSelectedNome(null);
  }, [modulo]);

  // Construir cards agrupados por vendedor com breakdown por categoria
  const cards = useMemo(() => {
    if (!data?.canais) return [];

    // Módulos que filtram por vendedorModulo (vendedores cadastrados no Supabase)
    // Inclui inbound_david/inbound_rafael para que o filtro restritivo de
    // VENDEDORES_POR_MODULO se aplique (apenas David+Thalis ou Rafael).
    const modulosComVendedor = [
      'multimarcas',
      'revenda',
      'business',
      'inbound_david',
      'inbound_rafael',
    ];
    const usaVendedorModulo = modulosComVendedor.includes(modulo);

    const moduloLabels = {
      multimarcas: ['multimarcas'],
      revenda: ['revenda'],
      business: ['business', 'b2b'],
      franquia: ['franquia'],
      varejo: ['varejo', 'sdr'],
      inbound_david: ['multimarcas', 'multimarca', 'b2m', 'inbound'],
      inbound_rafael: ['multimarcas', 'multimarca', 'b2m', 'inbound'],
    };
    const aceitos = moduloLabels[modulo] || [];

    // Coletar tarefas do módulo
    // REGRA: o card de vendedor SÓ deve aparecer se o vendedor pertence ao
    // canal (VENDEDORES_POR_MODULO). Tarefas sem vendedor entram se o
    // canalDetalhe bate com o módulo.
    const matchByCanal = (lead) => {
      const c = String(lead.canalDetalhe || lead._canal || '').toLowerCase();
      if (!c) return false;
      if (modulo === 'inbound_david' || modulo === 'inbound_rafael')
        return c.includes('multimarcas') || c.includes('multimarca') || c.includes('b2m') || c.includes('inbound');
      if (modulo === 'multimarcas')
        return c.includes('multimarcas') || c.includes('multimarca') || c.includes('b2m');
      if (modulo === 'revenda')
        return c.includes('revenda') || c.includes('revend') || c.includes('b2r') || c.includes('atacado');
      if (modulo === 'business') return c.includes('business') || c.includes('b2b');
      return false;
    };

    // Helper: vendedor (clickup_id) pertence ao módulo selecionado?
    const codesPermitidosFunil = VENDEDORES_POR_MODULO[modulo];
    const vendedoresMapPronto =
      !!vendedoresMap?.byClickupId &&
      Object.keys(vendedoresMap.byClickupId).length > 0;
    const inboundDavidSet = VENDEDORES_POR_MODULO.inbound_david;
    const inboundRafaelSet = VENDEDORES_POR_MODULO.inbound_rafael;

    // Nomes em canais especializados (inbound_david/inbound_rafael) — usados
    // como fallback robusto quando o totvs_id não está disponível em vendedoresMap
    const NOMES_INBOUND_DAVID = new Set(['david', 'thalis']);
    const NOMES_INBOUND_RAFAEL = new Set(['rafael']);
    const nomeNormalizado = (s) =>
      String(s || '').trim().toLowerCase().split(/\s+/)[0]; // primeiro nome

    const vendedorPertenceModulo = (lead) => {
      if (!lead.vendedor) return false;

      // Carrega info canônica (totvs_id) se disponível
      const info =
        vendedoresMapPronto && lead.vendedorClickupId
          ? vendedoresMap.byClickupId[lead.vendedorClickupId]
          : null;
      if (info?.ativo === false) return false;
      const totvsId = info?.totvs_id ? Number(info.totvs_id) : null;
      const moduloVendedor = String(
        info?.modulo || lead.vendedorModulo || '',
      ).toLowerCase();
      const nome = nomeNormalizado(lead.vendedor);

      // ─── EXCLUSÕES ────────────────────────────────────────────────────
      // Multimarcas: NÃO mostrar quem está em canais especializados (inbound_*)
      if (modulo === 'multimarcas') {
        // Por totvs_id (preciso, quando disponível)
        if (totvsId) {
          if (inboundDavidSet?.has(totvsId)) return false;
          if (inboundRafaelSet?.has(totvsId)) return false;
        }
        // Por nome (fallback robusto, sempre aplicado)
        if (NOMES_INBOUND_DAVID.has(nome)) return false;
        if (NOMES_INBOUND_RAFAEL.has(nome)) return false;
      }

      // ─── STRICT por canal ────────────────────────────────────────────
      // inbound_david: aceita só David e Thalis
      if (modulo === 'inbound_david') {
        if (totvsId) return inboundDavidSet?.has(totvsId) || false;
        return NOMES_INBOUND_DAVID.has(nome);
      }
      // inbound_rafael: aceita só Rafael
      if (modulo === 'inbound_rafael') {
        if (totvsId) return inboundRafaelSet?.has(totvsId) || false;
        return NOMES_INBOUND_RAFAEL.has(nome);
      }

      // ─── INCLUSÕES (multimarcas/revenda/business) ────────────────────
      // PRIMARY: totvs_id no set canônico
      if (codesPermitidosFunil && totvsId && codesPermitidosFunil.has(totvsId)) {
        return true;
      }
      // FALLBACK: vendedorModulo bate (loading state ou totvs_id missing)
      return moduloVendedor === modulo;
    };

    const todasTarefas = [];
    for (const ch of data.canais) {
      for (const t of ch.tarefas || []) {
        const tagged = { ...t, _canal: ch.nome };
        if (usaVendedorModulo) {
          // CASO 1: Vendedor atribuído → tem que ser do canal (VENDEDORES_POR_MODULO)
          if (t.vendedor && t.vendedorClickupId) {
            if (vendedorPertenceModulo(t)) {
              todasTarefas.push(tagged);
            }
            // Se vendedor não pertence ao módulo, IGNORA (mesmo se canal bate)
            continue;
          }
          // CASO 2: Sem vendedor → aceita se canalDetalhe bate com o módulo
          if (matchByCanal(tagged)) {
            todasTarefas.push(tagged);
          }
        } else {
          // varejo/franquia: filtra por nome do canal
          const nomeCanal = (ch.nome || '').toLowerCase();
          const pertence =
            aceitos.length === 0 || aceitos.some((a) => nomeCanal.includes(a));
          if (pertence) {
            todasTarefas.push(tagged);
          }
        }
      }
    }

    // Agrupar por vendedor
    const vendMap = {};
    for (const t of todasTarefas) {
      const v = t.vendedor || 'Sem Vendedor';
      if (!vendMap[v]) {
        vendMap[v] = { nome: v, tasks: [], enc: 0, conv: 0, porCategoria: {} };
      }
      vendMap[v].tasks.push(t);
      vendMap[v].enc++;

      const stl = (t.status || '').toLowerCase();
      const convertido =
        stl.includes('convertido') ||
        stl.includes('comprou') ||
        stl.includes('venda');
      if (convertido) vendMap[v].conv++;

      const cat = t.canalDetalhe || t._canal || 'Sem Categoria';
      if (!vendMap[v].porCategoria[cat]) {
        vendMap[v].porCategoria[cat] = { enc: 0, conv: 0 };
      }
      vendMap[v].porCategoria[cat].enc++;
      if (convertido) vendMap[v].porCategoria[cat].conv++;
    }

    // Adiciona vendedores do módulo SEM leads no período (cards com 0).
    // Usa o set canônico de VENDEDORES_POR_MODULO (TOTVS codes) — restringe
    // ao time real do canal, ignora vendedores legados marcados no Supabase.
    if (usaVendedorModulo && vendedoresMap?.byClickupId) {
      const codesPermitidos = VENDEDORES_POR_MODULO[modulo];
      for (const info of Object.values(vendedoresMap.byClickupId)) {
        if (!info?.nome) continue;
        if (info.ativo === false) continue;
        const totvsId = Number(info.totvs_id);
        // Só inclui se está no time canônico (quando definido)
        if (codesPermitidos && !codesPermitidos.has(totvsId)) continue;
        // Fallback: módulo cadastrado no Supabase
        if (!codesPermitidos && String(info.modulo || '').toLowerCase() !== modulo) continue;
        if (vendMap[info.nome]) continue; // já está
        vendMap[info.nome] = {
          nome: info.nome,
          tasks: [],
          enc: 0,
          conv: 0,
          porCategoria: {},
        };
      }
    }

    return Object.values(vendMap).sort((a, b) => b.enc - a.enc);
  }, [data, modulo, vendedoresMap]);

  // Reseleciona o vendedor por NOME quando o filtro/data muda → sempre
  // pega os tasks atualizados do useMemo `cards`
  const selected = useMemo(() => {
    if (!selectedNome) return null;
    return cards.find((c) => c.nome === selectedNome) || null;
  }, [selectedNome, cards]);

  if (selected) {
    return (
      <ListView
        group={selected}
        onBack={() => setSelectedNome(null)}
        onChatLead={onChatLead}
        onChatCloser={onChatCloser}
        onAnalise={onAnalise}
        phoneStatus={phoneStatus}
      />
    );
  }

  if (!data?.canais || cards.length === 0) {
    const canaisExistentes = (data?.canais || []).map((c) => c.nome);
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-sm">
          Nenhum lead encontrado para <strong>{modulo}</strong>
        </p>
        {data?.canais ? (
          <p className="text-xs mt-2 text-gray-300">
            Canais disponíveis: {canaisExistentes.join(', ') || 'nenhum'}
          </p>
        ) : (
          <p className="text-xs mt-1 text-gray-300">
            Ajuste o período e clique em Pesquisar
          </p>
        )}
      </div>
    );
  }

  // ── Sumário e separação ativos/zerados ──
  const totalLeads = cards.reduce((s, c) => s + c.enc, 0);
  const totalConv = cards.reduce((s, c) => s + c.conv, 0);
  const taxaGeral = totalLeads > 0 ? ((totalConv / totalLeads) * 100).toFixed(1) : '0.0';
  const semVendedorCard = cards.find((c) => c.nome === 'Sem Vendedor');
  const ativos = cards
    .filter((c) => c.nome !== 'Sem Vendedor' && c.enc > 0)
    .sort((a, b) => b.enc - a.enc);
  const zerados = cards.filter((c) => c.nome !== 'Sem Vendedor' && c.enc === 0);

  return (
    <div className="space-y-4">
      {/* Sumário do canal */}
      <div className="bg-gradient-to-br from-[#000638] to-[#1a1f5a] text-white rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-blue-200">
            Funil de Vendedores · {modulo}
          </p>
          <p className="text-[11px] text-blue-200/80 mt-0.5">
            {ativos.length} vendedor{ativos.length === 1 ? '' : 'es'} ativo
            {ativos.length === 1 ? '' : 's'} no período
          </p>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{totalLeads}</div>
            <div className="text-[10px] uppercase tracking-wide text-blue-200">
              leads
            </div>
          </div>
          <div className="w-px h-10 bg-blue-300/30" />
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-emerald-300">
              {totalConv}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-emerald-200">
              convertidos
            </div>
          </div>
          <div className="w-px h-10 bg-blue-300/30" />
          <div className="text-right">
            <div
              className={`text-2xl font-bold tabular-nums ${
                parseFloat(taxaGeral) >= 20
                  ? 'text-emerald-300'
                  : parseFloat(taxaGeral) >= 5
                    ? 'text-amber-300'
                    : 'text-blue-200'
              }`}
            >
              {taxaGeral}%
            </div>
            <div className="text-[10px] uppercase tracking-wide text-blue-200">
              taxa
            </div>
          </div>
        </div>
      </div>

      {/* Vendedores ativos (com leads) */}
      {ativos.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Trophy size={14} weight="bold" className="text-amber-500" />
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-600">
              Ranking de vendedores
            </h3>
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-[10px] text-gray-400 tabular-nums">
              top → menor
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {ativos.map((c, i) => (
              <CardItem
                key={c.nome}
                item={c}
                color={COLORS[i % COLORS.length]}
                rank={i + 1}
                totalGeral={totalLeads}
                onClick={() => setSelectedNome(c.nome)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sem Vendedor (separado) */}
      {semVendedorCard && semVendedorCard.enc > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Question size={14} weight="bold" className="text-gray-400" />
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-600">
              Sem vendedor atribuído
            </h3>
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-[10px] text-gray-400 tabular-nums">
              precisam de atribuição
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            <CardItem
              item={semVendedorCard}
              color="#94a3b8"
              rank={999}
              totalGeral={totalLeads}
              onClick={() => setSelectedNome(semVendedorCard.nome)}
            />
          </div>
        </div>
      )}

      {/* Vendedores sem leads (cards apagados, colapsado) */}
      {zerados.length > 0 && (
        <details className="group">
          <summary className="flex items-center gap-2 cursor-pointer select-none mb-2">
            <UserCircle size={14} weight="bold" className="text-gray-400" />
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 group-open:text-gray-700">
              Sem leads no período ({zerados.length})
            </h3>
            <div className="flex-1 h-px bg-gray-200" />
            <CaretRight
              size={12}
              className="text-gray-400 transition-transform group-open:rotate-90"
            />
          </summary>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 mt-2">
            {zerados.map((c) => (
              <CardItem
                key={c.nome}
                item={c}
                color="#cbd5e1"
                rank={999}
                totalGeral={totalLeads}
                onClick={() => {}}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
