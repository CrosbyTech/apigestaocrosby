import React, { useState, useMemo, useEffect } from 'react';
import { Clock, Spinner, Sun } from '@phosphor-icons/react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { API_BASE_URL } from '../../config/constants';

const API_KEY = import.meta.env.VITE_API_KEY || '';

// ═══════════════════════════════════════════════════════════════════════════
// TurnoView — Distribuição de mensagens por hora do dia, por vendedor.
// Fonte: Evolution Postgres (instâncias do módulo atual).
// ═══════════════════════════════════════════════════════════════════════════

function fmtHora(h) {
  if (h == null || isNaN(h)) return '—';
  return `${String(h).padStart(2, '0')}h`;
}

// Instâncias compartilhadas (caixas de entrada de equipe) por módulo
// Inclui tanto Evolution quanto UAzapi — o backend (turno-by-seller) resolve
// automaticamente o provider de cada nome.
const SHARED_INSTANCES = {
  multimarcas: [
    { name: 'mtm', label: 'MTM (Equipe)' },
    { name: 'rafael', label: 'Rafael' },
    { name: 'david', label: 'David' },
    { name: 'walter', label: 'Walter' },
    { name: 'renato', label: 'Renato' },
    { name: 'arthur', label: 'Arthur' },
    { name: 'hunter', label: 'Hunter (UAzapi)' },
  ],
  revenda: [
    { name: 'cleiton pb 1', label: 'Cleiton PB 1 (UAzapi)' },
    { name: 'cleiton pb 2', label: 'Cleiton PB 2 (UAzapi)' },
    { name: 'cleiton', label: 'Cleiton' },
    { name: 'anderson', label: 'Anderson' },
    { name: 'michel', label: 'Michel' },
    { name: 'heyridan', label: 'Heyridan' },
    { name: 'yago', label: 'Yago' },
    { name: 'Jason', label: 'Jason (UAzapi)' },
  ],
  varejo: [
    { name: 'joaopessoa', label: 'João Pessoa' },
    { name: 'novacruz', label: 'Nova Cruz' },
    { name: 'canguaretama', label: 'Canguaretama' },
    { name: 'parnamirim', label: 'Parnamirim' },
    { name: 'cidadejardim', label: 'Cidade Jardim (UAzapi)' },
    { name: 'guararapes', label: 'Guararapes (UAzapi)' },
    { name: 'ayrtonsenna', label: 'Ayrton Senna' },
    { name: 'imperatriz', label: 'Imperatriz' },
    { name: 'patos', label: 'Patos (UAzapi)' },
    { name: 'midway', label: 'Midway' },
    { name: 'teresina', label: 'Teresina' },
    { name: 'recife', label: 'Recife (UAzapi)' },
  ],
};

// Cor por turno (manhã/tarde/noite/madrugada)
function turnoColor(h, isPeak) {
  if (isPeak) return '#000638';
  if (h >= 6 && h < 12) return '#f59e0b'; // manhã - amber
  if (h >= 12 && h < 18) return '#eab308'; // tarde - yellow
  if (h >= 18 && h < 22) return '#f97316'; // noite - orange
  return '#6366f1'; // madrugada - indigo
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-md px-2.5 py-1.5 text-xs">
      <div className="font-bold text-[#000638]">{fmtHora(d.hora)}</div>
      <div className="text-gray-600 tabular-nums">
        {d.total.toLocaleString('pt-BR')} mensagens
      </div>
    </div>
  );
}

// Card de gráfico por vendedor
function VendedorChart({ vendedorNome, instance, dist }) {
  const hours = dist?.hours || Array(24).fill(0);
  const total = dist?.total || 0;
  const evolution_total = dist?.evolution_total || 0;
  const uazapi_total = dist?.uazapi_total || 0;
  const peak = dist?.peak;

  // Dataset para recharts: [{hora: 0, total: N}, ...]
  const chartData = useMemo(
    () => hours.map((c, h) => ({ hora: h, total: c })),
    [hours],
  );

  return (
    <div className="bg-white border border-gray-100 rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-sm font-semibold text-gray-900">
            {vendedorNome}
          </div>
          <div className="text-[10px] text-gray-500">
            instância <span className="font-mono">{instance}</span> ·{' '}
            {total.toLocaleString('pt-BR')} mensagens
            {peak != null && (
              <>
                {' '}
                · pico{' '}
                <span className="font-bold text-[#000638]">
                  {fmtHora(peak)}
                </span>
              </>
            )}
          </div>
          {(evolution_total > 0 || uazapi_total > 0) && (
            <div className="text-[10px] text-gray-400 mt-0.5">
              {evolution_total > 0 && (
                <span className="text-emerald-600 font-medium">
                  Evolution {evolution_total.toLocaleString('pt-BR')}
                </span>
              )}
              {evolution_total > 0 && uazapi_total > 0 && ' · '}
              {uazapi_total > 0 && (
                <span className="text-purple-600 font-medium">
                  UAzapi {uazapi_total.toLocaleString('pt-BR')}{' '}
                  <span className="text-gray-400 font-normal">(amostra)</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {total === 0 ? (
        <div className="text-center py-10 text-xs text-gray-400">
          Sem mensagens registradas
        </div>
      ) : (
        <>
          <div className="h-44 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 4, left: -16, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="2 4"
                  stroke="#e5e7eb"
                />
                <XAxis
                  dataKey="hora"
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  tickFormatter={(v) =>
                    v % 3 === 0 || v === peak
                      ? `${String(v).padStart(2, '0')}h`
                      : ''
                  }
                  axisLine={{ stroke: '#e5e7eb' }}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={(v) =>
                    v >= 1000
                      ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
                      : v
                  }
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(0,6,56,0.05)' }}
                  content={<CustomTooltip />}
                />
                <Bar dataKey="total" radius={[2, 2, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell
                      key={d.hora}
                      fill={turnoColor(d.hora, d.hora === peak)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Legenda turno */}
          <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-amber-500" /> Manhã (06–12)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-yellow-500" /> Tarde (12–18)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-orange-500" /> Noite (18–22)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-indigo-500" /> Madrugada (22–06)
            </span>
            <span className="flex items-center gap-1 ml-auto">
              <span className="w-2 h-2 rounded-sm bg-[#000638]" /> Pico
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────
export default function TurnoView({ data, modulo, vendedoresMap }) {
  const [onlyReceived, setOnlyReceived] = useState(false);
  const [dist, setDist] = useState({});
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  // Vendedores do módulo: pega TODOS do vendedoresMap (não depende de ter leads no período)
  // + instâncias compartilhadas (mtm, etc) configuradas em SHARED_INSTANCES
  const vendedores = useMemo(() => {
    const map = {};
    if (vendedoresMap?.byClickupId) {
      for (const [clickupId, info] of Object.entries(vendedoresMap.byClickupId)) {
        if (!info?.evolution_inst) continue;
        if (info.ativo === false) continue;
        if (String(info.modulo || '').toLowerCase() !== modulo) continue;
        map[clickupId] = {
          clickupId,
          nome: info.nome || 'Sem nome',
          instance: info.evolution_inst,
        };
      }
    }
    // Adiciona instâncias compartilhadas (key prefixada para não colidir com clickupId)
    for (const sh of SHARED_INSTANCES[modulo] || []) {
      const key = `__shared:${sh.name}`;
      if (!map[key]) {
        map[key] = {
          clickupId: key,
          nome: sh.label,
          instance: sh.name,
          shared: true,
        };
      }
    }
    return Object.values(map).sort((a, b) => {
      // Equipe (compartilhada) por último
      if (a.shared && !b.shared) return 1;
      if (b.shared && !a.shared) return -1;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
  }, [vendedoresMap, modulo]);

  const instances = useMemo(
    () => [...new Set(vendedores.map((v) => v.instance).filter(Boolean))],
    [vendedores],
  );

  // Carrega distribuição quando instâncias mudam
  useEffect(() => {
    if (instances.length === 0) {
      setDist({});
      return;
    }
    setLoading(true);
    setErro('');
    fetch(`${API_BASE_URL}/api/crm/turno-by-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ instances, onlyReceived }),
    })
      .then((r) => r.json())
      .then((j) => setDist(j.data || j || {}))
      .catch((e) => setErro(e.message || 'Erro ao buscar distribuição'))
      .finally(() => setLoading(false));
  }, [instances, onlyReceived]);

  if (vendedores.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
        <Clock size={40} className="mx-auto text-gray-300 mb-2" />
        <p className="text-sm text-gray-500">
          Nenhum vendedor com instância Evolution configurada para o módulo{' '}
          <span className="font-bold uppercase">{modulo}</span>.
        </p>
      </div>
    );
  }

  // Pico geral (média ponderada)
  const picoGeral = useMemo(() => {
    const totais = Array(24).fill(0);
    for (const v of vendedores) {
      const d = dist?.[v.instance];
      if (!d?.hours) continue;
      for (let h = 0; h < 24; h++) totais[h] += d.hours[h] || 0;
    }
    let max = 0;
    let peak = null;
    for (let h = 0; h < 24; h++) {
      if (totais[h] > max) {
        max = totais[h];
        peak = h;
      }
    }
    return { hours: totais, peak, total: totais.reduce((s, x) => s + x, 0) };
  }, [vendedores, dist]);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-gray-900">
          Horário de Maior Movimento de Conversas
        </h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyReceived}
              onChange={(e) => setOnlyReceived(e.target.checked)}
            />
            Apenas recebidas
          </label>
          <p className="text-[11px] text-gray-500">
            Módulo <span className="font-medium uppercase">{modulo}</span> ·{' '}
            {vendedores.length} vendedores
          </p>
        </div>
      </div>

      {/* Pico geral do módulo + mini chart agregado */}
      <div className="bg-[#000638] text-white rounded-lg p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sun size={16} weight="duotone" />
              <span className="text-sm font-medium">
                Pico geral do módulo
              </span>
            </div>
            {picoGeral.peak !== null ? (
              <p className="text-xs text-blue-100">
                Hora de maior movimento:{' '}
                <span className="font-bold text-white text-2xl tabular-nums">
                  {fmtHora(picoGeral.peak)}
                </span>
                <span className="block text-[11px] text-blue-200 mt-0.5">
                  {picoGeral.total.toLocaleString('pt-BR')} mensagens totais ·{' '}
                  {vendedores.length} vendedores
                </span>
              </p>
            ) : (
              <p className="text-xs text-blue-200">Sem dados</p>
            )}
          </div>
          {picoGeral.peak !== null && (
            <div className="h-20 w-full md:w-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={picoGeral.hours.map((c, h) => ({ hora: h, total: c }))}
                  margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                >
                  <XAxis
                    dataKey="hora"
                    tick={{ fontSize: 9, fill: '#bfdbfe' }}
                    tickFormatter={(v) =>
                      v % 6 === 0 || v === picoGeral.peak
                        ? `${String(v).padStart(2, '0')}h`
                        : ''
                    }
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.08)' }}
                    content={<CustomTooltip />}
                  />
                  <Bar dataKey="total" radius={[2, 2, 0, 0]}>
                    {picoGeral.hours.map((_, h) => (
                      <Cell
                        key={h}
                        fill={
                          h === picoGeral.peak
                            ? '#fbbf24'
                            : 'rgba(191, 219, 254, 0.55)'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6 text-gray-400 gap-2">
          <Spinner size={16} className="animate-spin" />
          <span className="text-xs">Carregando distribuição…</span>
        </div>
      )}

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 rounded-lg">
          {erro}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {vendedores.map((v) => (
          <VendedorChart
            key={v.clickupId}
            vendedorNome={v.nome}
            instance={v.instance}
            dist={dist?.[v.instance]}
          />
        ))}
      </div>
    </div>
  );
}
