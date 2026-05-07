import React, { useMemo, useState, useEffect } from 'react';
import {
  Users,
  TrendUp,
  CheckCircle,
  CaretDown,
  CaretUp,
  ChartBar,
  Spinner,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { API_BASE_URL } from '../../config/constants';

const API_KEY = import.meta.env.VITE_API_KEY || '';

// ═══════════════════════════════════════════════════════════════════════════
// ConversaoView — taxa de conversão por vendedor no canal selecionado.
// Fonte: data.canais.tarefas (ClickUp).
// ═══════════════════════════════════════════════════════════════════════════

// Status considerados "fechado" (fonte da verdade — bate com isClosedClickupStatus do backend)
const CLOSED_STATUS_RE = /(fechado|comprou|closed)/i;
// Status considerados "perdidos" / "descartados" — não entram no denominador
const LOST_STATUS_RE = /(invalido|inválido|desqualific|perdido|descart|spam)/i;

function isClosed(status) {
  return CLOSED_STATUS_RE.test(String(status || ''));
}
function isLost(status) {
  return LOST_STATUS_RE.test(String(status || ''));
}

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
  if (!canal && !vMod) return false;
  return matchCanal || vMod === modulo;
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
}

function fmtPct(n) {
  if (!isFinite(n)) return '0%';
  return `${n.toFixed(1)}%`;
}

// Card por vendedor
function VendedorCard({ vendedor, ranking, cross }) {
  const [aberto, setAberto] = useState(false);

  const taxa = vendedor.qualificados > 0
    ? (vendedor.fechados / vendedor.qualificados) * 100
    : 0;
  const taxaTotal = vendedor.total > 0
    ? (vendedor.fechados / vendedor.total) * 100
    : 0;
  // Métricas do cruzamento TOTVS
  const externalSales = cross?.external_closed ?? 0;
  const crmSales = cross?.crm_validated ?? 0;
  const externalRevenue = cross?.external_revenue ?? 0;
  const crmOpenings = cross?.crm_openings ?? 0;
  const externalOpenings = cross?.external_openings ?? 0;
  const externalOpeningsRevenue = cross?.external_openings_revenue ?? 0;
  // Conversão real (aberturas) = (CRM aberturas + fora aberturas) / (qualificados + fora aberturas)
  const totalReais = crmOpenings + externalOpenings;
  const baseReal = vendedor.qualificados + externalOpenings;
  const taxaReal = baseReal > 0 ? (totalReais / baseReal) * 100 : 0;

  // Cor da taxa (verde alto, âmbar médio, cinza baixo)
  const taxaColor =
    taxa >= 30
      ? 'text-emerald-600 bg-emerald-50'
      : taxa >= 15
        ? 'text-amber-600 bg-amber-50'
        : taxa > 0
          ? 'text-gray-600 bg-gray-50'
          : 'text-gray-400 bg-gray-50';

  return (
    <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
      <button
        onClick={() => setAberto((x) => !x)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
              {initials(vendedor.nome)}
            </div>
            {ranking <= 3 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#000638] text-white text-[9px] font-bold flex items-center justify-center">
                {ranking}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">
              {vendedor.nome}
            </div>
            <div className="text-[11px] text-gray-500">
              {vendedor.total} clientes · {vendedor.fechados} fechados
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className={`px-2.5 py-1 rounded-md text-sm font-bold ${taxaColor}`}>
            {fmtPct(taxa)}
          </div>
          {aberto ? (
            <CaretUp size={14} className="text-gray-400" />
          ) : (
            <CaretDown size={14} className="text-gray-400" />
          )}
        </div>
      </button>

      {aberto && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
          {/* Métricas CRM */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-white rounded-md p-2">
              <div className="text-[10px] text-gray-500 uppercase font-medium">
                Total CRM
              </div>
              <div className="text-lg font-bold text-gray-900 tabular-nums">
                {vendedor.total}
              </div>
            </div>
            <div className="bg-white rounded-md p-2">
              <div className="text-[10px] text-blue-600 uppercase font-medium">
                Comprou (CRM)
              </div>
              <div className="text-lg font-bold text-blue-700 tabular-nums">
                {vendedor.fechados}
              </div>
            </div>
            <div className="bg-white rounded-md p-2">
              <div className="text-[10px] text-emerald-600 uppercase font-medium">
                Aberturas (CRM)
              </div>
              <div className="text-lg font-bold text-emerald-700 tabular-nums">
                {crmOpenings}
              </div>
              <div className="text-[9px] text-gray-400">
                1ª compra atribuída
              </div>
            </div>
            <div className="bg-white rounded-md p-2">
              <div className="text-[10px] text-purple-600 uppercase font-medium">
                Aberturas Fora CRM
              </div>
              <div className="text-lg font-bold text-purple-700 tabular-nums">
                {externalOpenings}
              </div>
              <div className="text-[9px] text-gray-400">
                {externalOpeningsRevenue > 0 && (
                  <>
                    R${' '}
                    {externalOpeningsRevenue.toLocaleString('pt-BR', {
                      maximumFractionDigits: 0,
                    })}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Vendas (qualquer NF) — info complementar */}
          <div className="bg-white rounded-md p-2 grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <div className="text-gray-500 uppercase font-medium">
                Vendas CRM
              </div>
              <div className="text-sm font-bold text-gray-700 tabular-nums">
                {crmSales}
                <span className="ml-1 text-gray-400 font-normal">clientes</span>
              </div>
              <div className="text-gray-400">
                {cross?.crm_validated_nfs || 0} NFs
                {cross?.crm_validated_revenue > 0 && (
                  <>
                    {' '}· R${' '}
                    {cross.crm_validated_revenue.toLocaleString('pt-BR', {
                      maximumFractionDigits: 0,
                    })}
                  </>
                )}
              </div>
            </div>
            <div>
              <div className="text-gray-500 uppercase font-medium">
                Vendas Fora CRM
              </div>
              <div className="text-sm font-bold text-gray-700 tabular-nums">
                {externalSales}
                <span className="ml-1 text-gray-400 font-normal">clientes</span>
              </div>
              <div className="text-gray-400">
                {cross?.external_nfs || 0} NFs
                {externalRevenue > 0 && (
                  <>
                    {' '}· R${' '}
                    {externalRevenue.toLocaleString('pt-BR', {
                      maximumFractionDigits: 0,
                    })}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Conversão real (aberturas no TOTVS) */}
          {(crmOpenings > 0 || externalOpenings > 0) && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-md p-2">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[11px] text-emerald-800 font-bold">
                  Conversão REAL (aberturas validadas no TOTVS)
                </span>
                <span className="text-base font-bold text-emerald-700 tabular-nums">
                  {fmtPct(taxaReal)}
                </span>
              </div>
              <div className="text-[10px] text-emerald-700">
                {totalReais} aberturas reais ({crmOpenings} CRM +{' '}
                {externalOpenings} fora) / {baseReal} oportunidades
                (qualificados + aberturas fora)
              </div>
              <div className="h-1.5 bg-emerald-100 rounded-full overflow-hidden mt-1.5">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${Math.min(taxaReal, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Conversão (apenas ClickUp) */}
          <div className="bg-white rounded-md p-2">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[11px] text-gray-600 font-medium">
                Conversão (apenas ClickUp)
              </span>
              <span className="text-xs text-gray-500">
                qualificados: <span className="font-bold">{vendedor.qualificados}</span>
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${Math.min(taxa, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-gray-500 mt-1">
              <span>
                Sobre qualificados:{' '}
                <span className="font-bold text-gray-700">{fmtPct(taxa)}</span>
              </span>
              <span>
                Sobre total:{' '}
                <span className="font-bold text-gray-700">{fmtPct(taxaTotal)}</span>
              </span>
            </div>
          </div>

          {/* Breakdown por status */}
          {Object.keys(vendedor.byStatus).length > 0 && (
            <div className="bg-white rounded-md p-2">
              <div className="text-[10px] text-gray-500 uppercase font-medium mb-1.5">
                Por status
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(vendedor.byStatus)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => {
                    const fechado = isClosed(status);
                    const perdido = isLost(status);
                    const cls = fechado
                      ? 'bg-emerald-100 text-emerald-700'
                      : perdido
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-700';
                    return (
                      <span
                        key={status}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}
                      >
                        {status}: {count}
                      </span>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────
export default function ConversaoView({ modulo }) {
  // Busca o histórico COMPLETO de leads (não filtra por período)
  const [allData, setAllData] = useState(null);
  const [crossMap, setCrossMap] = useState({}); // byVendedor map do TOTVS
  const [loading, setLoading] = useState(false);
  const [loadingCross, setLoadingCross] = useState(false);
  const [erro, setErro] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErro('');
    const controller = new AbortController();
    // 5 min de timeout pra acomodar carga inicial do ClickUp
    const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    fetch(`${API_BASE_URL}/api/crm/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ allHistory: true }),
      signal: controller.signal,
    })
      .then(async (r) => {
        const text = await r.text();
        if (!text) throw new Error('Resposta vazia do servidor');
        try {
          return JSON.parse(text);
        } catch {
          throw new Error(
            `Resposta inválida (status ${r.status}): ${text.slice(0, 200)}`,
          );
        }
      })
      .then((j) => {
        if (cancelled) return;
        if (j?.success === false) {
          throw new Error(j.message || 'Erro do servidor');
        }
        setAllData(j.data || j);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e.name === 'AbortError') {
          setErro(
            'Demorou demais (5 min). O ClickUp pode estar lento. Tente novamente.',
          );
        } else {
          setErro(e.message || 'Erro ao carregar leads');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
        clearTimeout(timeoutId);
      });
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [reloadKey]);

  const data = allData;

  // Quando os leads carregam (e módulo muda), dispara o cruzamento com TOTVS
  // — só os leads desse módulo (pra reduzir dados). On-demand por módulo.
  useEffect(() => {
    if (!data?.canais) return;
    const leadsToSend = [];
    for (const c of data.canais) {
      for (const t of c.tarefas || []) {
        if (!leadEnoModulo(t, modulo)) continue;
        leadsToSend.push({
          phone: t.telefone,
          vendedor_clickup_id: t.vendedorClickupId,
          vendedor_totvs_id: t.vendedorTotvsId,
          vendedor_name: t.vendedor,
          status: t.status,
        });
      }
    }
    if (leadsToSend.length === 0) {
      setCrossMap({});
      return;
    }
    setLoadingCross(true);
    fetch(`${API_BASE_URL}/api/crm/conversao-cruzada`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ leads: leadsToSend }),
    })
      .then((r) => r.json())
      .then((j) => setCrossMap((j.data || j)?.byVendedor || {}))
      .catch((e) => console.warn('[conversao-cruzada]', e.message))
      .finally(() => setLoadingCross(false));
  }, [data, modulo]);

  // Agrupa leads por vendedor (ou por LOJA quando varejo, usando o
  // campo "Enviar Contato" do ClickUp).
  // Para varejo, considera APENAS opções cujo nome começa com "Loja"
  // (ignora opções como "Revenda", "Multimarcas Inbound", "SDR" etc.).
  const vendedores = useMemo(() => {
    if (!data?.canais) return [];
    const map = {};
    const SEM_KEY = modulo === 'varejo' ? '__sem_loja__' : '__sem_vendedor__';
    const SEM_LABEL =
      modulo === 'varejo' ? 'Sem vendedor' : 'Sem vendedor';
    const isLoja = (s) => /^\s*loja\b/i.test(String(s || ''));
    for (const c of data.canais) {
      for (const t of c.tarefas || []) {
        if (!leadEnoModulo(t, modulo)) continue;
        let key;
        if (modulo === 'varejo') {
          const contato = (t.enviarContato || '').trim();
          // Filtro forte: só conta se o nome começa com "Loja"
          if (!isLoja(contato)) continue;
          key = contato;
        } else {
          key = t.vendedorClickupId || SEM_KEY;
        }
        if (!map[key]) {
          map[key] = {
            clickupId: key,
            nome:
              key === SEM_KEY
                ? SEM_LABEL
                : modulo === 'varejo'
                  ? key
                  : t.vendedor || 'Sem nome',
            total: 0,
            fechados: 0,
            perdidos: 0,
            qualificados: 0,
            byStatus: {},
          };
        }
        const v = map[key];
        v.total += 1;
        const status = t.status || 'Sem status';
        v.byStatus[status] = (v.byStatus[status] || 0) + 1;
        if (isClosed(status)) {
          v.fechados += 1;
          v.qualificados += 1;
        } else if (isLost(status)) {
          v.perdidos += 1;
        } else {
          v.qualificados += 1;
        }
      }
    }
    // Ordena por taxa de conversão sobre qualificados (desc), com mínimo de leads
    return Object.values(map).sort((a, b) => {
      const ta = a.qualificados > 0 ? a.fechados / a.qualificados : 0;
      const tb = b.qualificados > 0 ? b.fechados / b.qualificados : 0;
      if (tb !== ta) return tb - ta;
      return b.total - a.total;
    });
  }, [data, modulo]);

  // Totais agregados do canal
  const totais = useMemo(() => {
    return vendedores.reduce(
      (acc, v) => {
        acc.total += v.total;
        acc.fechados += v.fechados;
        acc.perdidos += v.perdidos;
        acc.qualificados += v.qualificados;
        const cross = crossMap[v.clickupId];
        if (cross) {
          acc.crm_openings += cross.crm_openings || 0;
          acc.external_openings += cross.external_openings || 0;
          acc.external_openings_revenue += cross.external_openings_revenue || 0;
        }
        return acc;
      },
      {
        total: 0,
        fechados: 0,
        perdidos: 0,
        qualificados: 0,
        crm_openings: 0,
        external_openings: 0,
        external_openings_revenue: 0,
      },
    );
  }, [vendedores, crossMap]);

  const taxaCanal =
    totais.qualificados > 0
      ? (totais.fechados / totais.qualificados) * 100
      : 0;
  const totalReais = totais.crm_openings + totais.external_openings;
  const baseReal = totais.qualificados + totais.external_openings;
  const taxaReal = baseReal > 0 ? (totalReais / baseReal) * 100 : 0;

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
        <Spinner size={32} className="mx-auto text-gray-400 animate-spin mb-2" />
        <p className="text-sm text-gray-500">
          Carregando histórico completo de leads do ClickUp…
        </p>
        <p className="text-[11px] text-gray-400 mt-1">
          Pode levar alguns segundos pra muitos leads.
        </p>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center space-y-3">
        <p className="text-sm text-red-700">{erro}</p>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 inline-flex items-center gap-1.5"
        >
          <ArrowsClockwise size={12} />
          Tentar novamente
        </button>
        <p className="text-[11px] text-red-500">
          O backend cacheia o resultado por 10 min. A 2ª tentativa deve ser
          rápida.
        </p>
      </div>
    );
  }

  if (!data?.canais || vendedores.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
        <ChartBar size={40} className="mx-auto text-gray-300 mb-2" />
        <p className="text-sm text-gray-500">
          Nenhum lead encontrado neste módulo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header com totais do canal */}
      <div className="bg-[#000638] text-white rounded-lg p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendUp size={16} weight="duotone" />
              <span className="text-sm font-medium">Taxa de Conversão</span>
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                disabled={loading}
                className="text-blue-200 hover:text-white p-1 rounded transition-colors disabled:opacity-40"
                title="Recarregar histórico"
              >
                <ArrowsClockwise size={12} />
              </button>
            </div>
            <p className="text-xs text-blue-100">
              Histórico completo · Módulo{' '}
              <span className="font-medium uppercase">{modulo || '—'}</span> ·{' '}
              {vendedores.length} vendedores · {totais.total} clientes
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-[10px] text-blue-200 uppercase font-medium">
                Total
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {totais.total}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-emerald-300 uppercase font-medium">
                Fechados
              </div>
              <div className="text-2xl font-bold tabular-nums text-emerald-200">
                {totais.fechados}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-red-300 uppercase font-medium">
                Perdidos
              </div>
              <div className="text-2xl font-bold tabular-nums text-red-200">
                {totais.perdidos}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-purple-300 uppercase font-medium">
                Aberturas Fora CRM
              </div>
              <div className="text-2xl font-bold tabular-nums text-purple-200">
                {totais.external_openings}
              </div>
              {totais.external_openings_revenue > 0 && (
                <div className="text-[10px] text-purple-300">
                  R${' '}
                  {totais.external_openings_revenue.toLocaleString('pt-BR', {
                    maximumFractionDigits: 0,
                  })}
                </div>
              )}
            </div>
            <div className="text-right border-l border-blue-700 pl-4">
              <div className="text-[10px] text-blue-200 uppercase font-medium">
                Conversão (CRM)
              </div>
              <div className="text-2xl font-bold tabular-nums text-yellow-300">
                {fmtPct(taxaCanal)}
              </div>
              <div className="text-[10px] text-blue-200">
                sobre qualificados
              </div>
            </div>
            {(totais.crm_openings > 0 || totais.external_openings > 0) && (
              <div className="text-right border-l border-blue-700 pl-4">
                <div className="text-[10px] text-emerald-300 uppercase font-medium">
                  Conversão REAL
                </div>
                <div className="text-3xl font-bold tabular-nums text-emerald-200">
                  {fmtPct(taxaReal)}
                </div>
                <div className="text-[10px] text-emerald-300">
                  c/ aberturas · {totalReais}/{baseReal}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Aviso de cruzamento em andamento */}
      {loadingCross && (
        <div className="bg-amber-50 border border-amber-100 text-amber-700 text-xs px-3 py-2 rounded-md flex items-center gap-2">
          <Spinner size={12} className="animate-spin" />
          Cruzando com TOTVS… (validando vendas reais e identificando fechamentos
          fora do CRM)
        </div>
      )}

      {/* Cards por vendedor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {vendedores.map((v, idx) => (
          <VendedorCard
            key={v.clickupId}
            vendedor={v}
            ranking={idx + 1}
            cross={crossMap[v.clickupId]}
          />
        ))}
      </div>

      <div className="text-[10px] text-gray-400 text-right">
        <strong>Conversão</strong> = fechados / qualificados (exclui perdidos).{' '}
        Status considerados: fechados ({CLOSED_STATUS_RE.source}), perdidos (
        {LOST_STATUS_RE.source}).
      </div>
    </div>
  );
}
