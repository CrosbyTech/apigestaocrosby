import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Clock,
  WhatsappLogo,
  CaretDown,
  CaretUp,
  Spinner,
  Users,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { formatPhone, cleanPhone } from './constants';
import { API_BASE_URL } from '../../config/constants';

const API_KEY = import.meta.env.VITE_API_KEY || '';

// ═══════════════════════════════════════════════════════════════════════════
// UltimoContatoView — quadro por vendedor com leads do CRM e última conversa
// no WhatsApp (Evolution + UAzapi sob demanda).
// ═══════════════════════════════════════════════════════════════════════════

function dias(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
}

function fmtData(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('pt-BR');
}

function statusColor(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s.includes('fechado') || s === 'closed' || s === 'comprou')
    return 'bg-emerald-100 text-emerald-700';
  if (s === 'sql') return 'bg-blue-100 text-blue-700';
  if (s.includes('1') && s.includes('contato'))
    return 'bg-indigo-100 text-indigo-700';
  if (s.includes('mql')) return 'bg-cyan-100 text-cyan-700';
  if (s.includes('perdido')) return 'bg-red-100 text-red-600';
  return 'bg-gray-100 text-gray-600';
}

// Inicial do nome para avatar
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
}

// Lead pertence ao módulo selecionado?
// Aceita por:
//   1) Categoria do Lead (canalDetalhe — ClickUp)
//   2) Módulo cadastrado do vendedor (vendedorModulo)
// Qualquer um dos dois batendo já inclui.
function leadEnoModulo(lead, modulo) {
  const canal = String(lead.canalDetalhe || '').toLowerCase();
  const vMod = String(lead.vendedorModulo || '').toLowerCase();

  const matchCanal = (() => {
    if (!canal) return false;
    if (modulo === 'multimarcas')
      return canal.includes('multimarcas') || canal.includes('multimarca') || canal.includes('b2m');
    if (modulo === 'revenda')
      return canal.includes('revenda') || canal.includes('revend') || canal.includes('b2r') || canal.includes('atacado');
    if (modulo === 'varejo')
      return canal.includes('varejo') || canal.includes('b2c') || canal.includes('consumidor');
    return false;
  })();

  const matchVendedor = vMod === modulo;
  // Sem nenhum dado de canal/módulo → mostra (cabe ao usuário filtrar)
  if (!canal && !vMod) return true;
  return matchCanal || matchVendedor;
}

// Card por vendedor
function VendedorCard({
  vendedor,
  leads,
  phoneStatus,
  uazapiContacts,
  uazapiLoading,
  onExpand,
  onChatLead,
}) {
  const [aberto, setAberto] = useState(false);

  const handleToggle = useCallback(() => {
    const willOpen = !aberto;
    setAberto(willOpen);
    if (willOpen) onExpand();
  }, [aberto, onExpand]);

  // Resumo: contagem por status
  const resumo = useMemo(() => {
    const m = {};
    for (const l of leads) {
      const key = l.status || 'Sem status';
      m[key] = (m[key] || 0) + 1;
    }
    return m;
  }, [leads]);

  // Leads enriquecidos com último contato (Evolution + UAzapi)
  const leadsEnriquecidos = useMemo(() => {
    return leads
      .map((l) => {
        const phone = cleanPhone(l.telefone);
        const phone55 = phone.startsWith('55') ? phone : '55' + phone;
        const evo = phoneStatus?.[phone55];
        const tsEvolution = evo?.last_ts || 0;
        const evolutionInst = evo?.last_inst || null;
        const ua = uazapiContacts?.[phone] || uazapiContacts?.[phone55];
        const tsUazapi = ua?.last_ts || 0;
        const uaInst = ua?.instance || null;
        let lastTs = 0;
        let lastProvider = null;
        let lastInst = null;
        if (tsEvolution > tsUazapi) {
          lastTs = tsEvolution;
          lastProvider = 'evolution';
          lastInst = evolutionInst;
        } else if (tsUazapi > 0) {
          lastTs = tsUazapi;
          lastProvider = 'uazapi';
          lastInst = uaInst;
        }
        return {
          ...l,
          _lastTs: lastTs,
          _lastProvider: lastProvider,
          _lastInst: lastInst,
          _diasSemContato: lastTs ? dias(lastTs) : null,
        };
      })
      .sort((a, b) => {
        // Sem contato primeiro, depois mais antigos
        const sa = a._lastTs || 0;
        const sb = b._lastTs || 0;
        if (sa === 0 && sb === 0) return 0;
        if (sa === 0) return -1;
        if (sb === 0) return 1;
        return sa - sb; // mais antigo (menor ts) primeiro
      });
  }, [leads, phoneStatus, uazapiContacts]);

  return (
    <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 shrink-0 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold flex items-center justify-center">
            {initials(vendedor.nome)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">
              {vendedor.nome}
            </div>
            <div className="text-[10px] text-gray-500 flex flex-wrap gap-1 mt-0.5">
              {Object.entries(resumo).map(([s, c]) => (
                <span
                  key={s}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${statusColor(s)}`}
                >
                  {s}: {c}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold tabular-nums text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">
            {leads.length}
          </span>
          {aberto ? (
            <CaretUp size={12} className="text-gray-400" />
          ) : (
            <CaretDown size={12} className="text-gray-400" />
          )}
        </div>
      </button>

      {aberto && (
        <div className="border-t border-gray-100">
          {uazapiLoading && (
            <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 text-amber-700 text-[11px] flex items-center gap-2">
              <Spinner size={12} className="animate-spin" />
              Buscando último contato no UAzapi… (pode levar alguns segundos)
            </div>
          )}
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 uppercase tracking-wide text-[10px]">
                    Lead
                  </th>
                  <th className="text-left px-2 py-2 font-medium text-gray-500 uppercase tracking-wide text-[10px]">
                    Status
                  </th>
                  <th className="text-left px-2 py-2 font-medium text-gray-500 uppercase tracking-wide text-[10px]">
                    Categoria
                  </th>
                  <th className="text-left px-2 py-2 font-medium text-gray-500 uppercase tracking-wide text-[10px]">
                    Último Contato
                  </th>
                  <th className="text-right px-2 py-2 font-medium text-gray-500 uppercase tracking-wide text-[10px]">
                    Dias
                  </th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {leadsEnriquecidos.map((l) => (
                  <tr
                    key={l.id}
                    className="border-t border-gray-50 hover:bg-blue-50/30"
                  >
                    <td className="px-3 py-2 max-w-[180px]">
                      <div className="font-medium text-gray-800 truncate">
                        {l.nome || 'Sem nome'}
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono">
                        {formatPhone(l.telefone) || '—'}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${statusColor(l.status)}`}
                      >
                        {l.status || '—'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-gray-600 text-[11px]">
                      {l.canalDetalhe || '—'}
                    </td>
                    <td className="px-2 py-2 text-gray-700 text-[11px] whitespace-nowrap">
                      {l._lastTs ? (
                        <span className="flex items-center gap-1">
                          {fmtData(l._lastTs)}
                          {l._lastProvider === 'uazapi' && (
                            <span className="text-[9px] text-purple-600 font-medium">
                              · uazapi
                            </span>
                          )}
                          {l._lastProvider === 'evolution' && (
                            <span className="text-[9px] text-emerald-600 font-medium">
                              · evolution
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400">sem contato</span>
                      )}
                    </td>
                    <td
                      className={`px-2 py-2 text-right text-[11px] font-bold tabular-nums whitespace-nowrap ${
                        l._diasSemContato == null
                          ? 'text-gray-400'
                          : l._diasSemContato > 30
                            ? 'text-red-600'
                            : l._diasSemContato > 15
                              ? 'text-amber-600'
                              : 'text-gray-700'
                      }`}
                    >
                      {l._diasSemContato == null
                        ? '—'
                        : `${l._diasSemContato}d`}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {onChatLead && cleanPhone(l.telefone) && (
                        <button
                          onClick={() =>
                            onChatLead({
                              telefone: l.telefone,
                              nome: l.nome,
                              inst: l._lastInst || l.vendedorEvolutionInst,
                              provider: l._lastProvider || 'evolution',
                            })
                          }
                          className="px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 rounded border border-emerald-200 inline-flex items-center gap-1"
                          title="Ver conversa"
                        >
                          <WhatsappLogo size={11} weight="bold" />
                          Conversa
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-gray-400 py-6">
                      Sem leads neste vendedor.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────
export default function UltimoContatoView({
  data,
  modulo,
  phoneStatus,
  onChatLead,
}) {
  // uazapiContacts: { phone55: { last_ts, instance } } — preenche on-demand
  const [uazapiContacts, setUazapiContacts] = useState({});
  const [uazapiLoading, setUazapiLoading] = useState({}); // { vendedorClickupId: bool }
  const [uazapiFetched, setUazapiFetched] = useState({}); // { vendedorClickupId: true }

  // Agrupa leads por vendedor (filtra pela Categoria do Lead = canal de vendas).
  // Leads sem vendedor caem num grupo "Sem vendedor".
  // Para VAREJO: agrupa por LOJA (campo "Enviar Contato" da ClickUp) e
  // só considera tasks cujo valor desse campo começa com "Loja".
  const grupos = useMemo(() => {
    if (!data?.canais) return [];
    const map = {};
    const SEM_VENDEDOR_KEY = '__sem_vendedor__';
    const isLoja = (s) => /^\s*loja\b/i.test(String(s || ''));
    for (const c of data.canais) {
      for (const t of c.tarefas || []) {
        if (!leadEnoModulo(t, modulo)) continue;
        let key;
        if (modulo === 'varejo') {
          const contato = (t.enviarContato || '').trim();
          if (!isLoja(contato)) continue; // só lojas
          key = contato;
        } else {
          key = t.vendedorClickupId || SEM_VENDEDOR_KEY;
        }
        if (!map[key]) {
          map[key] = {
            clickupId: key,
            nome:
              modulo === 'varejo'
                ? key
                : key === SEM_VENDEDOR_KEY
                  ? 'Sem vendedor'
                  : t.vendedor || 'Sem nome',
            modulo: t.vendedorModulo || modulo,
            evolutionInst: t.vendedorEvolutionInst || '',
            leads: [],
          };
        }
        map[key].leads.push(t);
      }
    }
    return Object.values(map).sort((a, b) => b.leads.length - a.leads.length);
  }, [data, modulo]);

  // Quando o usuário expande um vendedor, busca UAzapi para os telefones daquele vendedor
  const expandirVendedor = useCallback(
    async (vendedor) => {
      if (uazapiFetched[vendedor.clickupId]) return; // já buscou
      const phones = vendedor.leads
        .map((l) => cleanPhone(l.telefone))
        .filter((p) => p && p.length >= 10);
      if (phones.length === 0) return;
      setUazapiLoading((prev) => ({ ...prev, [vendedor.clickupId]: true }));
      try {
        const r = await fetch(`${API_BASE_URL}/api/crm/uazapi-last-contacts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
          },
          body: JSON.stringify({ phones }),
        });
        const json = await r.json();
        const respMap = json.data ?? json ?? {};
        setUazapiContacts((prev) => ({ ...prev, ...respMap }));
        setUazapiFetched((prev) => ({ ...prev, [vendedor.clickupId]: true }));
      } catch (err) {
        console.warn('[uazapi-last-contacts] falhou:', err.message);
      } finally {
        setUazapiLoading((prev) => ({ ...prev, [vendedor.clickupId]: false }));
      }
    },
    [uazapiFetched],
  );

  if (!data?.canais || grupos.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
        <Users size={40} className="mx-auto text-gray-300 mb-2" />
        <p className="text-sm text-gray-500">
          Nenhum lead encontrado neste módulo.
        </p>
        <p className="text-[11px] text-gray-400 mt-1">
          Carregue os leads do ClickUp e selecione um módulo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-medium text-gray-900">
          Último Contato por Vendedor
        </h2>
        <p className="text-[11px] text-gray-500">
          Módulo <span className="font-medium uppercase">{modulo || '—'}</span>{' '}
          · {grupos.length} vendedores · {grupos.reduce((s, g) => s + g.leads.length, 0)} leads
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {grupos.map((v) => (
          <VendedorCard
            key={v.clickupId}
            vendedor={v}
            leads={v.leads}
            phoneStatus={phoneStatus}
            uazapiContacts={uazapiContacts}
            uazapiLoading={!!uazapiLoading[v.clickupId]}
            onExpand={() => expandirVendedor(v)}
            onChatLead={onChatLead}
          />
        ))}
      </div>
    </div>
  );
}
