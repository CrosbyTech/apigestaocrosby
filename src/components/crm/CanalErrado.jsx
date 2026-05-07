import React, { useMemo, useState } from 'react';
import {
  WhatsappLogo,
  Link as LinkIcon,
  Warning,
  ArrowRight,
  CheckCircle,
  MagnifyingGlass,
  ArrowsLeftRight,
  CaretRight,
} from '@phosphor-icons/react';
import { formatPhone, cleanPhone, instLabel } from './constants';

// ═══════════════════════════════════════════════════════════════════════════
// CanalErrado — Detecta leads possivelmente classificados em canal incorreto
// Combina 3 sinais (Tier 1/2/3) e ranqueia por confiança.
// ═══════════════════════════════════════════════════════════════════════════

// Mapeamento canal canônico de cada instância WhatsApp
const INST_CANAL_LOCAL = {
  // Closers / equipes por módulo
  prosp: 'todos',
  anderson: 'revenda',
  heyridan: 'revenda',
  cleiton: 'revenda',
  michel: 'revenda',
  yago: 'revenda',
  felipepb: 'revenda',
  jucelino: 'revenda',
  baatacado: 'revenda',
  'cleiton pb 1': 'revenda',
  'cleiton pb 2': 'revenda',
  Jason: 'revenda',
  // Multimarcas / Inbound
  walter: 'multimarcas',
  renato: 'multimarcas',
  arthur: 'multimarcas',
  david: 'multimarcas', // inbound david
  rafael: 'multimarcas', // inbound rafael
  hunter: 'multimarcas',
  mtm: 'multimarcas',
  // Business
  marcio: 'business',
  // Varejo (lojas)
  midway: 'varejo',
  cidadejardim: 'varejo',
  shoppingcidadejardim: 'varejo',
  ayrtonsenna: 'varejo',
  canguaretama: 'varejo',
  novacruz: 'varejo',
  parnamirim: 'varejo',
  recife: 'varejo',
  teresina: 'varejo',
  imperatriz: 'varejo',
  guararapes: 'varejo',
  patos: 'varejo',
  joaopessoa: 'varejo',
};

// Mapeamento vendedorModulo → canal canônico
const MODULO_CANAL = {
  multimarcas: 'multimarcas',
  inbound_david: 'multimarcas',
  inbound_rafael: 'multimarcas',
  revenda: 'revenda',
  varejo: 'varejo',
  business: 'business',
  franquia: 'franquia',
};

// Detecta canal canônico de um string (canalDetalhe do ClickUp)
function detectCanalCanonico(s) {
  const c = String(s || '').toLowerCase();
  if (!c) return null;
  if (c.includes('multimarca') || c.includes('b2m') || c.includes('inbound'))
    return 'multimarcas';
  if (c.includes('revenda') || c.includes('revend') || c.includes('b2r') || c.includes('atacado'))
    return 'revenda';
  if (c.includes('varejo') || c.includes('b2c') || c.includes('consumidor'))
    return 'varejo';
  if (c.includes('business') || c.includes('b2b')) return 'business';
  if (c.includes('franqu')) return 'franquia';
  return null;
}

// Palavras-chave por canal para análise de origem
const KEYWORDS_CANAL = {
  revenda: ['revenda', 'revendedor', 'atacado'],
  multimarcas: ['multimarca', 'multimarcas'],
  business: ['b2b', 'business', 'corporativo'],
  franquia: ['franquia', 'franqueado'],
  varejo: ['varejo', 'consumidor final'],
};

// Cores e ícones por canal
const CANAL_META = {
  varejo: { label: 'Varejo', color: '#3b82f6', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
  multimarcas: { label: 'Multimarcas', color: '#f59e0b', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
  revenda: { label: 'Revenda', color: '#10b981', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
  business: { label: 'Business', color: '#64748b', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700' },
  franquia: { label: 'Franquia', color: '#8b5cf6', bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700' },
};

// ─── Detecção de canal incorreto ─────────────────────────────────────────────
function analisarLead(lead, phoneStatus) {
  const canalAtual = detectCanalCanonico(lead.canalDetalhe);
  if (!canalAtual) return null; // Sem categoria — não dá pra comparar

  const sugestoes = [];

  // ─── Tier 1: vendedor é de outro canal (sinal mais forte) ──
  const vendedorModulo = String(lead.vendedorModulo || '').toLowerCase();
  const canalVendedor = MODULO_CANAL[vendedorModulo];
  if (canalVendedor && canalVendedor !== canalAtual && lead.vendedor) {
    sugestoes.push({
      tier: 1,
      canalSugerido: canalVendedor,
      motivo: `Vendedor "${lead.vendedor}" pertence ao canal ${CANAL_META[canalVendedor]?.label || canalVendedor}`,
    });
  }

  // ─── Tier 2: instância que conversa com o lead é de outro canal ──
  const clean = cleanPhone(lead.telefone);
  const ps = phoneStatus?.[clean];
  if (ps && Array.isArray(ps.instances) && ps.instances.length > 0) {
    for (const inst of ps.instances) {
      const c = INST_CANAL_LOCAL[String(inst).toLowerCase()];
      if (c && c !== 'todos' && c !== canalAtual) {
        // Só adiciona se ainda não estiver na lista
        if (!sugestoes.find((s) => s.canalSugerido === c)) {
          sugestoes.push({
            tier: 2,
            canalSugerido: c,
            motivo: `Instância "${instLabel(inst) || inst}" (${CANAL_META[c]?.label || c}) está conversando com o lead`,
          });
        }
      }
    }
  }

  // ─── Tier 3: palavras-chave em origem ──
  const origem = String(lead.origem || '').toLowerCase();
  if (origem) {
    for (const [canal, keywords] of Object.entries(KEYWORDS_CANAL)) {
      if (canal === canalAtual) continue;
      if (keywords.some((k) => origem.includes(k))) {
        if (!sugestoes.find((s) => s.canalSugerido === canal)) {
          sugestoes.push({
            tier: 3,
            canalSugerido: canal,
            motivo: `Origem "${lead.origem}" sugere "${CANAL_META[canal]?.label || canal}"`,
          });
        }
      }
    }
  }

  if (sugestoes.length === 0) return null;
  // Ordena por tier (1=maior confiança)
  sugestoes.sort((a, b) => a.tier - b.tier);
  return {
    canalAtual,
    sugestoes,
    melhorTier: sugestoes[0].tier,
  };
}

// ─── Helper iniciais ─────────────────────────────────────────────────────────
function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
}
function avatarColor(s) {
  if (!s) return '#94a3b8';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const palette = [
    '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
  ];
  return palette[Math.abs(h) % palette.length];
}

// ─── Badge de tier ───────────────────────────────────────────────────────────
function TierBadge({ tier }) {
  const cfg = {
    1: { label: 'Alta', cls: 'bg-red-100 text-red-700 border border-red-200' },
    2: { label: 'Média', cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
    3: { label: 'Baixa', cls: 'bg-gray-100 text-gray-600 border border-gray-200' },
  }[tier] || { label: 'Baixa', cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${cfg.cls}`}>
      Confiança {cfg.label}
    </span>
  );
}

// ─── Card de lead suspeito ───────────────────────────────────────────────────
function LeadSuspeitoCard({ item, onChatLead, onCorrigir }) {
  const { lead, analise } = item;
  const sug = analise.sugestoes[0]; // primeira/melhor sugestão
  const canalAtualMeta = CANAL_META[analise.canalAtual] || { label: analise.canalAtual, color: '#94a3b8' };
  const canalSugMeta = CANAL_META[sug.canalSugerido] || { label: sug.canalSugerido, color: '#94a3b8' };
  const cor = avatarColor(lead.nome);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 hover:shadow-md transition">
      {/* Topo: nome + ações */}
      <div className="flex items-start gap-2.5 mb-3">
        <span
          className="shrink-0 w-9 h-9 rounded-full text-white text-xs font-bold flex items-center justify-center shadow-sm"
          style={{ background: cor }}
        >
          {initials(lead.nome)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-[#000638] truncate">
            {lead.nome || 'Sem nome'}
          </div>
          <div className="text-[10px] text-gray-500 font-mono mt-0.5">
            {formatPhone(lead.telefone) || '—'}
          </div>
          {lead.vendedor && (
            <div className="text-[10px] text-gray-400 mt-0.5">
              Atribuído a <span className="font-semibold">{lead.vendedor}</span>
            </div>
          )}
        </div>
        <TierBadge tier={analise.melhorTier} />
      </div>

      {/* Setinha: canal atual → sugerido */}
      <div className="flex items-center gap-2 mb-2">
        <div className={`flex-1 px-2 py-1 rounded-lg ${canalAtualMeta.bg || 'bg-gray-50'} ${canalAtualMeta.border || 'border-gray-200'} border`}>
          <div className="text-[8px] uppercase tracking-wider text-gray-500">Atual</div>
          <div className={`text-xs font-bold ${canalAtualMeta.text || 'text-gray-700'}`}>
            {canalAtualMeta.label}
          </div>
        </div>
        <CaretRight size={14} className="text-gray-300 shrink-0" weight="bold" />
        <div className={`flex-1 px-2 py-1 rounded-lg ${canalSugMeta.bg || 'bg-gray-50'} ${canalSugMeta.border || 'border-gray-200'} border-2 border-dashed`}>
          <div className="text-[8px] uppercase tracking-wider text-gray-500">Sugerido</div>
          <div className={`text-xs font-bold ${canalSugMeta.text || 'text-gray-700'}`}>
            {canalSugMeta.label}
          </div>
        </div>
      </div>

      {/* Motivo principal */}
      <div className="flex items-start gap-1.5 text-[11px] text-gray-700 bg-amber-50 border border-amber-100 rounded-md p-1.5 mb-2">
        <Warning size={11} className="text-amber-600 mt-0.5 shrink-0" />
        <span>{sug.motivo}</span>
      </div>

      {/* Múltiplas sugestões (se >1) */}
      {analise.sugestoes.length > 1 && (
        <details className="mb-2 group">
          <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-700">
            +{analise.sugestoes.length - 1} outro
            {analise.sugestoes.length === 2 ? '' : 's'} sinal
            {analise.sugestoes.length === 2 ? '' : 'is'}
          </summary>
          <div className="mt-1.5 space-y-1">
            {analise.sugestoes.slice(1).map((s, i) => (
              <div key={i} className="text-[10px] text-gray-600 pl-3 border-l-2 border-gray-100">
                <span className="font-semibold text-gray-800">{CANAL_META[s.canalSugerido]?.label || s.canalSugerido}:</span>{' '}
                {s.motivo}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Ações */}
      <div className="flex items-center gap-1 pt-2 border-t border-gray-100">
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
          >
            <WhatsappLogo size={11} weight="bold" />
            Conversa
          </button>
        )}
        {lead.clickupUrl && (
          <a
            href={lead.clickupUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-purple-700 hover:bg-purple-50 rounded-md border border-purple-200"
          >
            <LinkIcon size={11} weight="bold" />
            ClickUp
          </a>
        )}
        {onCorrigir && (
          <button
            onClick={() => onCorrigir(lead, sug.canalSugerido)}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-white rounded-md transition shadow-sm"
            style={{ background: canalSugMeta.color }}
          >
            <ArrowsLeftRight size={11} weight="bold" />
            Corrigir
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
export default function CanalErrado({ data, modulo, phoneStatus, onChatLead }) {
  const [busca, setBusca] = useState('');
  const [filtroCanal, setFiltroCanal] = useState('todos');
  const [filtroTier, setFiltroTier] = useState('todos');

  // Extrai leads do formato { canais: [{ tarefas: [...] }] }
  const todosLeads = useMemo(() => {
    if (!data?.canais) return [];
    return data.canais.flatMap((c) => c.tarefas || []);
  }, [data]);

  // Analisa cada lead
  const suspeitos = useMemo(() => {
    const out = [];
    for (const lead of todosLeads) {
      const analise = analisarLead(lead, phoneStatus || {});
      if (analise) out.push({ lead, analise });
    }
    out.sort((a, b) => a.analise.melhorTier - b.analise.melhorTier);
    return out;
  }, [todosLeads, phoneStatus]);

  // Filtros aplicados
  const filtrados = useMemo(() => {
    return suspeitos.filter((item) => {
      if (filtroTier !== 'todos' && item.analise.melhorTier !== Number(filtroTier))
        return false;
      if (
        filtroCanal !== 'todos' &&
        item.analise.canalAtual !== filtroCanal
      )
        return false;
      if (busca) {
        const q = busca.toLowerCase();
        const m = `${item.lead.nome || ''} ${item.lead.telefone || ''} ${item.lead.vendedor || ''}`.toLowerCase();
        if (!m.includes(q)) return false;
      }
      return true;
    });
  }, [suspeitos, filtroCanal, filtroTier, busca]);

  // Stats
  const stats = useMemo(() => {
    const t1 = suspeitos.filter((s) => s.analise.melhorTier === 1).length;
    const t2 = suspeitos.filter((s) => s.analise.melhorTier === 2).length;
    const t3 = suspeitos.filter((s) => s.analise.melhorTier === 3).length;
    return { total: suspeitos.length, t1, t2, t3 };
  }, [suspeitos]);

  // Canais que aparecem nos suspeitos (pra montar pills)
  const canaisDisponiveis = useMemo(() => {
    const set = new Set();
    for (const s of suspeitos) set.add(s.analise.canalAtual);
    return [...set];
  }, [suspeitos]);

  const totalLeads = todosLeads.length;
  const pctSuspeitos = totalLeads > 0 ? ((stats.total / totalLeads) * 100).toFixed(1) : '0';

  // Ação de corrigir (chama backend pra mover canal no ClickUp)
  const corrigir = (lead, canalSugerido) => {
    // TODO: integrar com endpoint que move o canal no ClickUp
    // Por enquanto, abre o ClickUp pra correção manual
    if (lead.clickupUrl) {
      window.open(lead.clickupUrl, '_blank');
      return;
    }
    alert(
      `Para mover este lead manualmente para "${CANAL_META[canalSugerido]?.label || canalSugerido}", abra-o no ClickUp e altere a categoria.`,
    );
  };

  // Empty state — nenhum suspeito
  if (suspeitos.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
        <CheckCircle size={48} weight="duotone" className="mx-auto text-emerald-400 mb-3" />
        <p className="text-base font-semibold text-[#000638]">
          Tudo certo!
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Nenhum lead com canal suspeito detectado em {totalLeads}{' '}
          {totalLeads === 1 ? 'lead analisado' : 'leads analisados'}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header com sumário */}
      <div className="bg-gradient-to-br from-[#000638] to-[#1a1f5a] text-white rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-blue-200">
            Detecção de canal incorreto
          </p>
          <p className="text-[11px] text-blue-200/80 mt-0.5">
            {stats.total} de {totalLeads} leads ({pctSuspeitos}%) com sinais de
            classificação errada
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-red-300">{stats.t1}</div>
            <div className="text-[10px] uppercase tracking-wide text-red-200">Alta</div>
          </div>
          <div className="w-px h-10 bg-blue-300/30" />
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-amber-300">{stats.t2}</div>
            <div className="text-[10px] uppercase tracking-wide text-amber-200">Média</div>
          </div>
          <div className="w-px h-10 bg-blue-300/30" />
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-blue-200">{stats.t3}</div>
            <div className="text-[10px] uppercase tracking-wide text-blue-200">Baixa</div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <MagnifyingGlass
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Buscar nome, telefone, vendedor..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400"
          />
        </div>
        <select
          value={filtroTier}
          onChange={(e) => setFiltroTier(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white text-gray-700 focus:outline-none focus:border-indigo-400"
        >
          <option value="todos">Todas confianças</option>
          <option value="1">Alta confiança</option>
          <option value="2">Média confiança</option>
          <option value="3">Baixa confiança</option>
        </select>
        <select
          value={filtroCanal}
          onChange={(e) => setFiltroCanal(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white text-gray-700 focus:outline-none focus:border-indigo-400"
        >
          <option value="todos">Todos canais atuais</option>
          {canaisDisponiveis.map((c) => (
            <option key={c} value={c}>
              {CANAL_META[c]?.label || c}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-gray-400 tabular-nums px-2 py-1 bg-gray-50 rounded-md">
          {filtrados.length} de {suspeitos.length}
        </span>
      </div>

      {/* Cards */}
      {filtrados.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-xs text-gray-400">
            Nenhum lead corresponde aos filtros aplicados
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtrados.map((item, idx) => (
            <LeadSuspeitoCard
              key={`${item.lead.id || idx}`}
              item={item}
              onChatLead={onChatLead}
              onCorrigir={corrigir}
            />
          ))}
        </div>
      )}

      {/* Legenda */}
      <details className="bg-gray-50 border border-gray-200 rounded-xl p-3 group">
        <summary className="text-[11px] font-semibold text-gray-600 cursor-pointer hover:text-gray-900">
          Como o sistema detecta canais errados?
        </summary>
        <div className="mt-2.5 text-[11px] text-gray-600 space-y-1.5">
          <div>
            <span className="font-bold text-red-600">Alta confiança:</span> O
            vendedor atribuído pertence a outro canal.{' '}
            <span className="text-gray-500">
              Ex: lead em &quot;Multimarcas&quot; mas vendedor é da equipe de Revenda.
            </span>
          </div>
          <div>
            <span className="font-bold text-amber-600">Média confiança:</span>{' '}
            Uma instância WhatsApp de outro canal está em conversa com o lead.{' '}
            <span className="text-gray-500">
              Ex: lead &quot;Varejo&quot; recebendo mensagens da instância da loja.
            </span>
          </div>
          <div>
            <span className="font-bold text-gray-700">Baixa confiança:</span> O
            campo Origem contém palavras-chave de outro canal.{' '}
            <span className="text-gray-500">
              Ex: origem = &quot;Anúncio Multimarcas&quot;.
            </span>
          </div>
        </div>
      </details>
    </div>
  );
}
