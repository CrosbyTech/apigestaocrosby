import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  WhatsappLogo,
  MagnifyingGlass,
  Warning,
  CheckCircle,
  XCircle,
  Users,
  X,
  TrendUp,
  ShoppingCart,
  CalendarBlank,
  CurrencyDollar,
  Cake,
  Spinner,
} from '@phosphor-icons/react';
import {
  COLORS,
  formatPhone,
  cleanPhone,
  ALL_INSTANCES,
  instLabel,
  VENDEDORES_POR_MODULO,
} from './constants';
import { API_BASE_URL } from '../../config/constants';

const ANIV_API_KEY = import.meta.env.VITE_API_KEY || '';

// ═══════════════════════════════════════════════════════════════════════════
// CarteiraView — Visão da carteira de clientes por vendedor
// Exibe cards com Ativos / A Inativar / Inativos / LTV Total e permite
// abrir detalhes com lista filtrável.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Modal de resumo da carteira (clientes consolidados) ────────────────────
function CarteiraSummaryModal({ titulo, accent, items, columns, onClose }) {
  const [busca, setBusca] = useState('');
  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase();
    if (!q) return items;
    return items.filter((it) =>
      columns.some((col) => {
        const v = col.search ? col.search(it) : (it[col.key] ?? '');
        return String(v).toUpperCase().includes(q);
      }),
    );
  }, [items, busca, columns]);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-center justify-between px-5 py-4 border-b border-gray-200 ${accent || ''}`}
        >
          <div>
            <h3 className="text-sm font-bold text-[#000638]">{titulo}</h3>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {filtrados.length} {filtrados.length === 1 ? 'item' : 'itens'}
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
              placeholder="Buscar..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#000638]"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtrados.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">
              Nenhum item encontrado.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-gray-500 font-semibold w-[40px]">
                    #
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-3 py-2 text-gray-500 font-semibold ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtrados.map((it, i) => (
                  <tr key={it.id || i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-400 font-mono">
                      {i + 1}
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'} ${col.cellClass || 'text-gray-700'}`}
                      >
                        {col.render ? col.render(it) : (it[col.key] ?? '—')}
                      </td>
                    ))}
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

// Regras de inatividade (em dias) — conforme especificação do módulo
const REGRAS_INATIVIDADE = {
  revenda: { alerta: 60, inativo: 90 },
  multimarcas: { alerta: 180, inativo: 210 },
  varejo: { alerta: 180, inativo: 210 },
  business: { alerta: 90, inativo: 120 },
  franquia: { alerta: 90, inativo: 120 },
};

// Retorna dias desde a última transação do cliente
function diasDesdeUltimaCompra(transacoes = []) {
  if (!transacoes || transacoes.length === 0) return Infinity;
  const datas = transacoes
    .map((t) => new Date(t.dtStr || t.data || t.dt || 0).getTime())
    .filter((t) => t > 0);
  if (datas.length === 0) return Infinity;
  const ultima = Math.max(...datas);
  const diffMs = Date.now() - ultima;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Classifica o status do cliente conforme regra do módulo
function classificarStatus(cliente, modulo) {
  // Usa diasSemComprar pré-calculado pelo backend; fallback para cálculo local
  const dias =
    cliente.diasSemComprar ?? diasDesdeUltimaCompra(cliente.transacoes);
  const regras = REGRAS_INATIVIDADE[modulo] || REGRAS_INATIVIDADE.revenda;
  if (dias === null || dias === undefined || !isFinite(dias)) return 'inativo';
  if (dias >= regras.inativo) return 'inativo';
  if (dias >= regras.alerta) return 'aInativar';
  return 'ativo';
}

// Calcula LTV total (soma de valores das transações)
function calcLTV(transacoes = []) {
  return transacoes.reduce(
    (acc, t) => acc + Number(t.total || t.vlFat || t.valor || t.vlr || 0),
    0,
  );
}

// Calcula ticket médio
function calcTicketMedio(transacoes = []) {
  if (!transacoes || transacoes.length === 0) return 0;
  return calcLTV(transacoes) / transacoes.length;
}

// Formata valor como moeda BRL
function fmtMoeda(v) {
  return (v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

// Formata tempo de cadastro em formato amigável
function fmtTempoCadastro(dtStr) {
  if (!dtStr) return '—';
  const dt = new Date(dtStr);
  if (isNaN(dt.getTime())) return '—';
  const dias = Math.floor((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24));
  if (dias < 30) return `${dias}d`;
  if (dias < 365) return `${Math.floor(dias / 30)} meses`;
  return `${Math.floor(dias / 365)} anos`;
}

// ─── Badge de status ────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = {
    ativo: { label: 'Ativo', cls: 'bg-green-100 text-green-700' },
    aInativar: { label: 'A Inativar', cls: 'bg-yellow-100 text-yellow-700' },
    inativo: { label: 'Inativo', cls: 'bg-red-100 text-red-700' },
  }[status] || { label: '—', cls: 'bg-gray-100 text-gray-500' };

  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

// ─── Card por vendedor ──────────────────────────────────────────────────────
function VendedorCard({
  vendedor,
  clientes,
  color,
  oportunidades,
  primeiraCompra,
  inativo,
  onClick,
}) {
  const stats = useMemo(() => {
    let ativos = 0;
    let aInativar = 0;
    let inativos = 0;
    let ltv = 0;
    clientes.forEach((c) => {
      if (c._status === 'ativo') ativos += 1;
      else if (c._status === 'aInativar') aInativar += 1;
      else if (c._status === 'inativo') inativos += 1;
      ltv += c._ltv || 0;
    });
    return { ativos, aInativar, inativos, ltv };
  }, [clientes]);

  return (
    <div
      onClick={onClick}
      className={`relative rounded-lg p-3 cursor-pointer transition-all ${
        inativo
          ? 'bg-gray-50 border border-gray-300 hover:bg-gray-100 hover:border-gray-400'
          : 'bg-white border border-gray-200 hover:shadow-md hover:border-[#000638]/30'
      }`}
    >
      {inativo && (
        <>
          <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-gray-400 to-transparent rounded-l-lg" />
          <span
            className="absolute top-2 right-2 inline-flex items-center gap-1 bg-gray-200 text-gray-600 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border border-gray-300"
            title="Vendedor desligado/inativo"
          >
            <XCircle size={10} weight="fill" />
            INATIVO
          </span>
        </>
      )}
      <div
        className={`flex items-center gap-2 mb-3 ${inativo ? 'pr-16' : ''}`}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${inativo ? 'opacity-40' : ''}`}
          style={{ background: color }}
        />
        <h3
          className={`text-sm font-bold truncate ${
            inativo ? 'text-gray-500 line-through' : 'text-[#000638]'
          }`}
        >
          {vendedor}
        </h3>
        <span className="text-[10px] text-gray-400 ml-auto">
          {clientes.length} clientes
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <div className="text-xl font-bold text-green-600">{stats.ativos}</div>
          <div className="text-[10px] text-gray-500 uppercase">Ativos</div>
        </div>
        <div>
          <div className="text-xl font-bold text-yellow-600">
            {stats.aInativar}
          </div>
          <div className="text-[10px] text-gray-500 uppercase">A Inativar</div>
        </div>
        <div>
          <div className="text-xl font-bold text-red-600">{stats.inativos}</div>
          <div className="text-[10px] text-gray-500 uppercase">Inativos</div>
        </div>
      </div>

      {/* Oportunidades + Primeira compra */}
      {(oportunidades > 0 || primeiraCompra > 0) && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {oportunidades > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
              {oportunidades} oportunidade{oportunidades !== 1 ? 's' : ''}
            </span>
          )}
          {primeiraCompra > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              {primeiraCompra} 1ª compra{primeiraCompra !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <span className="text-[10px] text-gray-500 uppercase font-semibold">
          LTV Total
        </span>
        <span className="text-sm font-bold text-[#000638]">
          {fmtMoeda(stats.ltv)}
        </span>
      </div>
    </div>
  );
}

// ─── Analytics de um cliente específico ────────────────────────────────────
function ClienteAnalytics({ cliente, modulo, onClose }) {
  // Agrupa transações por NF (mesma data+hora+canal+filial = mesma NF)
  const nfsAgrupadas = useMemo(() => {
    const grupos = {};
    for (const t of cliente.transacoes || []) {
      const key = `${t.dtStr || t.mes}__${t.canal || ''}__${t.branchCode || ''}`;
      if (!grupos[key]) {
        grupos[key] = {
          dtStr: t.dtStr,
          mes: t.mes || (t.dtStr ? t.dtStr.slice(0, 7) : ''),
          total: 0,
        };
      }
      grupos[key].total += t.total || t.vlFat || 0;
    }
    return Object.values(grupos);
  }, [cliente.transacoes]);

  const porMes = useMemo(() => {
    const map = {};
    for (const nf of nfsAgrupadas) {
      const mes = nf.mes;
      if (!mes) continue;
      if (!map[mes]) map[mes] = { mes, total: 0, qtd: 0 };
      map[mes].total += nf.total;
      map[mes].qtd += 1; // 1 NF por entrada agrupada
    }
    return Object.values(map).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [nfsAgrupadas]);

  const maxMes = useMemo(
    () => Math.max(...porMes.map((m) => m.total), 1),
    [porMes],
  );

  const ltv = cliente._ltv ?? calcLTV(cliente.transacoes);
  const nTx = nfsAgrupadas.length; // nº de compras = nº de NFs distintas
  const ticket = nTx > 0 ? ltv / nTx : 0;
  const dias =
    cliente.diasSemComprar ?? diasDesdeUltimaCompra(cliente.transacoes);
  const statusCliente = classificarStatus(cliente, modulo);

  const fmtMes = (m) => {
    const [y, mo] = m.split('-');
    return `${mo}/${y.slice(2)}`;
  };

  const kpis = [
    {
      label: 'LTV Total',
      value: fmtMoeda(ltv),
      icon: TrendUp,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Ticket Médio',
      value: fmtMoeda(ticket),
      icon: CurrencyDollar,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Nº Compras',
      value: nTx,
      icon: ShoppingCart,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
    },
    {
      label: 'Dias s/ comprar',
      value: isFinite(dias) ? dias : '—',
      icon: CalendarBlank,
      color:
        statusCliente === 'ativo'
          ? 'text-green-600'
          : statusCliente === 'aInativar'
            ? 'text-yellow-600'
            : 'text-red-600',
      bg:
        statusCliente === 'ativo'
          ? 'bg-green-50'
          : statusCliente === 'aInativar'
            ? 'bg-yellow-50'
            : 'bg-red-50',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-[#000638]">
          <div>
            <p className="text-white font-bold text-sm">{cliente.nome}</p>
            <p className="text-gray-300 text-[11px]">
              {cliente.cidade || '—'} {cliente.uf ? `· ${cliente.uf}` : ''} ·{' '}
              <StatusBadge status={statusCliente} />
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-300 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {kpis.map((k) => (
              <div
                key={k.label}
                className={`${k.bg} rounded-lg p-3 flex flex-col gap-1`}
              >
                <k.icon size={16} className={k.color} />
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                <p className="text-[10px] text-gray-500 uppercase font-semibold">
                  {k.label}
                </p>
              </div>
            ))}
          </div>

          {/* Gráfico de barras por mês */}
          {porMes.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-700 mb-2 uppercase">
                Faturamento por mês
              </p>
              <div className="flex items-end gap-1 h-28 bg-gray-50 rounded-lg p-2">
                {porMes.map((m) => {
                  const pct = Math.round((m.total / maxMes) * 100);
                  return (
                    <div
                      key={m.mes}
                      className="flex flex-col items-center flex-1 gap-0.5 group"
                      title={`${fmtMes(m.mes)}: ${fmtMoeda(m.total)} (${m.qtd} compras)`}
                    >
                      <span className="text-[9px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {fmtMoeda(m.total)}
                      </span>
                      <div
                        className="w-full rounded-t-sm bg-[#000638] transition-all"
                        style={{ height: `${Math.max(pct, 4)}%` }}
                      />
                      <span className="text-[8px] text-gray-400">
                        {fmtMes(m.mes)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tabela das transações — agrupadas por NF (data+hora+canal+filial) */}
          {(cliente.transacoes || []).length > 0 && (() => {
            const grupos = {};
            for (const t of cliente.transacoes || []) {
              // chave única por NF: data+hora exata + canal + filial
              const key = `${t.dtStr || t.mes}__${t.canal || ''}__${t.branchCode || ''}`;
              if (!grupos[key]) {
                grupos[key] = {
                  dtStr: t.dtStr,
                  mes: t.mes,
                  canal: t.canal,
                  branchCode: t.branchCode,
                  qtd: 0,
                  total: 0,
                  itens: 0,
                };
              }
              grupos[key].qtd += t.quantity || 1;
              grupos[key].total += t.total || t.vlFat || 0;
              grupos[key].itens += 1;
            }
            const linhas = Object.values(grupos).sort((a, b) =>
              (b.dtStr || '').localeCompare(a.dtStr || ''),
            );
            return (
              <div>
                <p className="text-xs font-bold text-gray-700 mb-2 uppercase">
                  Histórico de compras{' '}
                  <span className="text-gray-400 font-normal normal-case">
                    ({linhas.length} compras · {cliente.transacoes.length} itens)
                  </span>
                </p>
                <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5">Data</th>
                        <th className="text-left px-2 py-1.5">Canal</th>
                        <th className="text-right px-2 py-1.5">Itens</th>
                        <th className="text-right px-2 py-1.5">Qtd</th>
                        <th className="text-right px-2 py-1.5">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((g, i) => (
                        <tr
                          key={i}
                          className="border-t border-gray-50 hover:bg-gray-50"
                        >
                          <td className="px-2 py-1 text-gray-600">
                            {g.dtStr
                              ? new Date(g.dtStr).toLocaleDateString('pt-BR')
                              : g.mes || '—'}
                          </td>
                          <td className="px-2 py-1 text-gray-600 capitalize">
                            {g.canal || '—'}
                          </td>
                          <td className="px-2 py-1 text-right text-gray-500">
                            {g.itens}
                          </td>
                          <td className="px-2 py-1 text-right text-gray-600">
                            {g.qtd}
                          </td>
                          <td className="px-2 py-1 text-right font-semibold text-[#000638]">
                            {fmtMoeda(g.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {!cliente.transacoes?.length && (
            <p className="text-sm text-gray-400 text-center py-4">
              Sem histórico de transações no período carregado.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Detalhes: tabela de clientes do vendedor ───────────────────────────────
function DetalheVendedor({
  vendedor,
  clientes,
  onBack,
  onChatLead,
  initialFiltro = 'todos',
  modulo,
}) {
  const [filtroStatus, setFiltroStatus] = useState(initialFiltro);
  const [busca, setBusca] = useState('');
  const [clienteSel, setClienteSel] = useState(null);
  const [pagina, setPagina] = useState(1);
  const [sortField, setSortField] = useState('ultimaCompra');
  const [sortDir, setSortDir] = useState('desc');
  const PAGE_SIZE = 50;

  // Reset página ao mudar filtros ou ordenação
  useEffect(() => { setPagina(1); }, [filtroStatus, busca, sortField, sortDir]);

  const toggleSort = useCallback((field) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  }, []);

  const filtrados = useMemo(() => {
    let list = clientes.filter((c) => {
      if (filtroStatus !== 'todos' && c._status !== filtroStatus) return false;
      if (busca) {
        const b = busca.toLowerCase();
        if (
          !(c.nome || '').toLowerCase().includes(b) &&
          !(c.cidade || '').toLowerCase().includes(b) &&
          !cleanPhone(c.fone).includes(cleanPhone(busca))
        )
          return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      let va, vb;
      if (sortField === 'ultimaCompra') {
        va = a.ultimaCompra ? new Date(a.ultimaCompra).getTime() : 0;
        vb = b.ultimaCompra ? new Date(b.ultimaCompra).getTime() : 0;
      } else if (sortField === 'dtCadastroStr') {
        va = a.dtCadastroStr ? new Date(a.dtCadastroStr).getTime() : 0;
        vb = b.dtCadastroStr ? new Date(b.dtCadastroStr).getTime() : 0;
      } else {
        va = a[sortField];
        vb = b[sortField];
      }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb), 'pt-BR')
        : String(vb).localeCompare(String(va), 'pt-BR');
    });
    return list;
  }, [clientes, filtroStatus, busca, sortField, sortDir]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      {/* Modal de analytics do cliente */}
      {clienteSel && (
        <ClienteAnalytics
          cliente={clienteSel}
          modulo={modulo}
          onClose={() => setClienteSel(null)}
        />
      )}

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={onBack}
          className="bg-[#000638] text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-[#fe0000] flex items-center gap-1"
        >
          <ArrowLeft size={14} /> Voltar
        </button>
        <h2 className="text-sm font-bold text-[#000638]">
          Carteira — {vendedor}
        </h2>
        <span className="text-[10px] text-gray-400 ml-auto">
          {filtrados.length} de {clientes.length} clientes
        </span>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {['todos', 'ativo', 'aInativar', 'inativo'].map((s) => (
          <button
            key={s}
            onClick={() => setFiltroStatus(s)}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg ${
              filtroStatus === s
                ? 'bg-[#000638] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === 'todos'
              ? 'Todos'
              : s === 'aInativar'
                ? 'A Inativar'
                : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-1 ml-auto">
          <MagnifyingGlass size={14} className="text-gray-400" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar..."
            className="text-xs outline-none w-40"
          />
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600 uppercase text-[10px]">
            <tr>
              {[
                {label:'Código',field:'cod',align:'left'},
                {label:'Cliente',field:'nome',align:'left'},
                {label:'Telefone',field:'fone',align:'left'},
                {label:'Cidade',field:'cidade',align:'left'},
                {label:'Status',field:'_status',align:'left'},
                {label:'Última Compra',field:'ultimaCompra',align:'left'},
                {label:'Tempo Cadastro',field:'dtCadastroStr',align:'left'},
                {label:'LTV Total',field:'_ltv',align:'right'},
                {label:'Ticket Médio',field:'_ticket',align:'right'},
              ].map(({label,field,align}) => (
                <th key={field} onClick={() => toggleSort(field)}
                    className={`text-${align} px-2 py-2 cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap`}>
                  {label}{sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th className="text-center px-2 py-2">Analytics</th>
              <th className="text-center px-2 py-2">Ação</th>
            </tr>
          </thead>
          <tbody>
            {filtrados
              .slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE)
              .map((c) => (
                <tr
                  key={c.cod}
                  className="border-t border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-2 py-2 font-mono text-gray-500 text-[10px]">
                    {c.cod || '—'}
                  </td>
                  <td className="px-2 py-2 font-semibold text-gray-800 max-w-[220px]">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="truncate">{c.nome}</span>
                      {c.clientType === 'abertura' && (
                        <span
                          className="inline-block bg-emerald-50 text-emerald-700 border border-emerald-200 text-[8px] font-bold uppercase px-1 py-0.5 rounded"
                          title="Cliente novo no período carregado"
                        >
                          Abertura
                        </span>
                      )}
                      {c.clientType === 'reativacao' && (
                        <span
                          className="inline-block bg-amber-50 text-amber-700 border border-amber-200 text-[8px] font-bold uppercase px-1 py-0.5 rounded"
                          title="Cliente reativado (≥60 dias sem comprar)"
                        >
                          Reativação
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 font-mono text-gray-600">
                    {formatPhone(c.fone)}
                  </td>
                  <td className="px-2 py-2 text-gray-600">{c.cidade || '—'}</td>
                  <td className="px-2 py-2">
                    <StatusBadge status={c._status} />
                  </td>
                  <td className="px-2 py-2 text-gray-600">
                    {c.ultimaCompra
                      ? new Date(c.ultimaCompra).toLocaleDateString('pt-BR')
                      : '—'}
                  </td>
                  <td className="px-2 py-2 text-gray-600">
                    {fmtTempoCadastro(c.dtCadastroStr)}
                  </td>
                  <td className="px-2 py-2 text-right font-bold text-[#000638]">
                    {fmtMoeda(c._ltv)}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700">
                    {fmtMoeda(c._ticket)}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => setClienteSel(c)}
                      className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-1 rounded hover:bg-blue-100 border border-blue-200"
                      title="Ver histórico de compras"
                    >
                      <TrendUp size={12} className="inline mr-0.5" />
                      Ver
                    </button>
                  </td>
                  <td className="px-2 py-2 text-center">
                    {onChatLead && cleanPhone(c.fone) && (
                      <button
                        onClick={() =>
                          onChatLead({ fone: c.fone, nome: c.nome })
                        }
                        className="bg-[#000638] text-white text-xs font-bold px-2 py-1 rounded hover:bg-[#fe0000]"
                        title="Abrir chat"
                      >
                        <WhatsappLogo size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center text-gray-400 py-6">
                  Nenhum cliente encontrado com os filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {filtrados.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 px-1">
          <span className="text-[10px] text-gray-400">
            {(pagina - 1) * PAGE_SIZE + 1}–
            {Math.min(pagina * PAGE_SIZE, filtrados.length)} de{' '}
            {filtrados.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina === 1}
              className="text-xs px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
            >
              ← Anterior
            </button>
            <button
              onClick={() =>
                setPagina((p) =>
                  Math.min(Math.ceil(filtrados.length / PAGE_SIZE), p + 1),
                )
              }
              disabled={pagina >= Math.ceil(filtrados.length / PAGE_SIZE)}
              className="text-xs px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
            >
              Próxima →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cashback Ativo (clientes c/ saldo TOTVS, última compra ≤ 15 dias) ────
function CashbackSection({ erpData, onChatLead }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);

  // Clientes com última compra nos últimos 15 dias
  const candidatos = useMemo(() => {
    const list = erpData?.clientes || [];
    const limite = Date.now() - 15 * 86400000;
    const out = [];
    for (const c of list) {
      const datas = (c.transacoes || [])
        .map((t) => new Date(t.data || t.dt || t.dtStr || 0).getTime())
        .filter((t) => t > 0);
      if (!datas.length) continue;
      const last = Math.max(...datas);
      if (last >= limite) {
        out.push({ code: c.cod, nome: c.nome, fone: c.fone, lastTs: last });
      }
    }
    return out;
  }, [erpData]);

  useEffect(() => {
    if (candidatos.length === 0) {
      setData(null);
      return;
    }
    setLoading(true);
    setErro('');
    fetch(`${API_BASE_URL}/api/crm/cashback-balances`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANIV_API_KEY,
      },
      body: JSON.stringify({
        persons: candidatos.map((c) => ({ code: c.code })),
        modulo: 'revenda',
      }),
    })
      .then((r) => r.json())
      .then((j) => setData(j.data || j))
      .catch((e) => setErro(e.message || 'Erro ao carregar cashback'))
      .finally(() => setLoading(false));
  }, [candidatos]);

  const lista = useMemo(() => {
    const map = data?.clientes || {};
    const arr = Object.values(map);
    // Enriquece com fone/lastTs — usa telefone do response (Supabase) com fallback no candidato
    const candMap = new Map(candidatos.map((c) => [c.code, c]));
    const enriched = arr.map((c) => ({
      ...c,
      fone: c.telefone || candMap.get(c.code)?.fone || '',
      lastTs: candMap.get(c.code)?.lastTs,
    }));
    if (!busca) return enriched.sort((a, b) => b.balance - a.balance);
    const q = busca.toLowerCase();
    return enriched
      .filter(
        (c) =>
          (c.nome || '').toLowerCase().includes(q) ||
          cleanPhone(c.fone || '').includes(cleanPhone(q)) ||
          String(c.cpf).includes(q),
      )
      .sort((a, b) => b.balance - a.balance);
  }, [data, candidatos, busca]);

  const total = lista.length;
  const totalSaldo = lista.reduce((s, c) => s + (c.balance || 0), 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        disabled={loading || total === 0}
        className={`w-full bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3 text-left transition ${
          loading || total === 0
            ? 'opacity-80 cursor-default'
            : 'hover:shadow-md hover:border-emerald-400 hover:-translate-y-0.5 cursor-pointer'
        }`}
      >
        <div className="w-9 h-9 rounded-full bg-emerald-200 text-emerald-700 flex items-center justify-center text-base font-bold shrink-0">
          $
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-1">
            💰 Cashback Ativo (últimos 15 dias)
            {!loading && total > 0 && (
              <span className="text-emerald-400 text-[10px]">›</span>
            )}
          </h3>
          <p className="text-[11px] text-emerald-700 truncate">
            {loading
              ? 'Consultando TOTVS…'
              : `${total} cliente${total === 1 ? '' : 's'} · R$ ${totalSaldo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} em saldo`}
            {' · '}
            <span className="text-emerald-600">
              {candidatos.length} candidatos consultados
            </span>
          </p>
        </div>
        {loading && (
          <Spinner size={14} className="animate-spin text-emerald-600 shrink-0" />
        )}
      </button>

      {aberto && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setAberto(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-emerald-100 bg-gradient-to-br from-emerald-50 to-teal-50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-emerald-200 text-emerald-700 flex items-center justify-center text-base font-bold">
                  $
                </div>
                <div>
                  <h3 className="text-sm font-bold text-emerald-900">
                    💰 Cashback Ativo (últimos 15 dias)
                  </h3>
                  <p className="text-[11px] text-emerald-700">
                    {total} cliente{total === 1 ? '' : 's'} · R${' '}
                    {totalSaldo.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    em saldo · {candidatos.length} candidatos consultados
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAberto(false)}
                className="p-1.5 hover:bg-emerald-100 rounded-lg"
              >
                <X size={16} className="text-emerald-700" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-gray-100">
              <div className="relative">
                <MagnifyingGlass
                  size={12}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400"
                />
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Filtrar por nome, telefone ou CPF..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-emerald-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {erro && (
                <div className="text-xs text-red-600 mb-2">{erro}</div>
              )}
              {total === 0 && candidatos.length > 0 ? (
                <p className="text-xs text-emerald-700 py-8 text-center">
                  Nenhum dos {candidatos.length} clientes recentes possui saldo
                  de cashback ativo no TOTVS.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {lista.map((c) => (
                    <div
                      key={c.code}
                      className="bg-white border border-emerald-100 rounded-lg p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-gray-800 truncate">
                            {c.nome}
                          </div>
                          <div className="text-[10px] text-gray-500 font-mono">
                            {cleanPhone(c.fone)
                              ? formatPhone(c.fone)
                              : 'Sem telefone'}
                          </div>
                          <div className="text-[10px] text-gray-400">
                            #{c.code} · CPF {c.cpf?.slice(0, 3)}.***.
                            {c.cpf?.slice(-2)}
                          </div>
                        </div>
                        {onChatLead && (
                          <button
                            onClick={() =>
                              onChatLead({
                                telefone: c.fone || '',
                                nome: c.nome,
                              })
                            }
                            className={`p-1.5 rounded-md ${
                              cleanPhone(c.fone)
                                ? 'text-emerald-600 hover:bg-emerald-50'
                                : 'text-gray-400 hover:bg-gray-100'
                            }`}
                            title={
                              cleanPhone(c.fone)
                                ? 'Abrir chat'
                                : 'Buscar conversas pelo nome'
                            }
                          >
                            <WhatsappLogo size={14} weight="bold" />
                          </button>
                        )}
                      </div>
                      <div className="mt-1.5 pt-1.5 border-t border-emerald-50 flex items-baseline justify-between">
                        <span className="text-[10px] text-emerald-600 uppercase font-medium">
                          Saldo
                        </span>
                        <span className="text-sm font-bold text-emerald-700 tabular-nums">
                          R${' '}
                          {c.balance.toLocaleString('pt-BR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                      {c.ultimo_vendedor && (
                        <div className="text-[10px] text-emerald-700 flex items-center gap-1 mt-0.5">
                          <span className="text-emerald-400">↳</span>
                          <span className="font-medium truncate">
                            {c.ultimo_vendedor.dealer_name}
                          </span>
                        </div>
                      )}
                      {c.lastTs && (
                        <div className="text-[9px] text-gray-400 text-right">
                          Última compra:{' '}
                          {new Date(c.lastTs).toLocaleDateString('pt-BR')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Aniversariantes do dia (só Revenda Carteira) ──────────────────────────
function AniversariantesSection({ onChatLead, branch }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    setLoading(true);
    const url = branch
      ? `${API_BASE_URL}/api/crm/aniversariantes-hoje?branch=${branch}`
      : `${API_BASE_URL}/api/crm/aniversariantes-hoje`;
    fetch(url, {
      headers: { 'x-api-key': ANIV_API_KEY },
    })
      .then((r) => r.json())
      .then((j) => setData(j.data || j))
      .catch((e) => setErro(e.message || 'Erro ao carregar'))
      .finally(() => setLoading(false));
  }, [branch]);

  const lista = useMemo(() => {
    const arr = data?.clientes || [];
    if (!busca) return arr;
    const q = busca.toLowerCase();
    return arr.filter(
      (c) =>
        (c.nome || '').toLowerCase().includes(q) ||
        cleanPhone(c.telefone).includes(cleanPhone(q)) ||
        String(c.code).includes(q),
    );
  }, [data, busca]);

  const total = data?.total || 0;
  const dataLabel = data?.date
    ? new Date(data.date + 'T12:00:00').toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
      })
    : '';

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        disabled={loading || total === 0}
        className={`w-full bg-gradient-to-br from-pink-50 to-purple-50 border border-pink-200 rounded-xl px-4 py-3 flex items-center gap-3 text-left transition ${
          loading || total === 0
            ? 'opacity-80 cursor-default'
            : 'hover:shadow-md hover:border-pink-400 hover:-translate-y-0.5 cursor-pointer'
        }`}
      >
        <div className="w-9 h-9 rounded-full bg-pink-200 text-pink-700 flex items-center justify-center shrink-0">
          <Cake size={18} weight="duotone" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-pink-900 flex items-center gap-1">
            🎂 Aniversariantes do dia
            {!loading && total > 0 && (
              <span className="text-pink-400 text-[10px]">›</span>
            )}
          </h3>
          <p className="text-[11px] text-pink-700 truncate">
            {dataLabel} · <span className="font-bold">{total}</span> cliente
            {total === 1 ? '' : 's'}
          </p>
        </div>
        {loading && (
          <Spinner size={14} className="animate-spin text-pink-600 shrink-0" />
        )}
      </button>

      {aberto && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setAberto(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-pink-100 bg-gradient-to-br from-pink-50 to-purple-50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-pink-200 text-pink-700 flex items-center justify-center">
                  <Cake size={18} weight="duotone" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-pink-900">
                    🎂 Aniversariantes do dia
                  </h3>
                  <p className="text-[11px] text-pink-700">
                    {dataLabel} · <span className="font-bold">{total}</span>{' '}
                    cliente{total === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAberto(false)}
                className="p-1.5 hover:bg-pink-100 rounded-lg"
              >
                <X size={16} className="text-pink-700" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-gray-100">
              <div className="relative">
                <MagnifyingGlass
                  size={12}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-pink-400"
                />
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Filtrar por nome, telefone ou código..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-pink-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pink-400"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {erro && <div className="text-xs text-red-600 mb-2">{erro}</div>}
              {lista.length === 0 ? (
                <p className="text-xs text-pink-600 text-center py-8">
                  Nenhum cliente encontrado.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {lista.map((c) => (
                    <div
                      key={c.code}
                      className="bg-white border border-pink-100 rounded-lg p-2"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                          {c.idade ?? '?'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-gray-800 truncate flex items-center gap-1">
                            <span className="truncate">{c.nome}</span>
                            {c.status && (
                              <span
                                className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded border shrink-0 ${
                                  c.status === 'ativo'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : c.status === 'aInativar'
                                      ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                                      : 'bg-rose-50 text-rose-700 border-rose-200'
                                }`}
                                title={
                                  c.dias_sem_comprar != null
                                    ? `${c.dias_sem_comprar} dias sem comprar`
                                    : ''
                                }
                              >
                                {c.status === 'ativo'
                                  ? 'ATIVO'
                                  : c.status === 'aInativar'
                                    ? 'A INATIVAR'
                                    : 'INATIVO'}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-500 font-mono">
                            {formatPhone(c.telefone)} · #{c.code}
                            {c.dias_sem_comprar != null && (
                              <span className="text-gray-400">
                                {' · '}
                                {c.dias_sem_comprar}d sem compra
                              </span>
                            )}
                          </div>
                        </div>
                        {onChatLead && cleanPhone(c.telefone) && (
                          <button
                            onClick={() =>
                              onChatLead({
                                telefone: c.telefone,
                                nome: c.nome,
                              })
                            }
                            className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50 shrink-0"
                            title="Abrir chat"
                          >
                            <WhatsappLogo size={14} weight="bold" />
                          </button>
                        )}
                      </div>
                      {c.ultimo_vendedor && (
                        <div className="mt-1 pt-1 border-t border-pink-50 text-[10px] text-pink-700 flex items-center gap-1">
                          <span className="text-pink-400">↳</span>
                          <span className="font-medium">
                            {c.ultimo_vendedor.dealer_name}
                          </span>
                          {c.ultimo_vendedor.issue_date && (
                            <span className="text-gray-400 ml-auto">
                              {new Date(
                                c.ultimo_vendedor.issue_date,
                              ).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────
export default function CarteiraView({
  erpData,
  modulo,
  onChatLead,
  oportunidadesMap = {},
  vendedoresMap,
  erpLoading,
  erpProgress,
}) {
  const [filtroGeral, setFiltroGeral] = useState('todos');
  const [summaryModal, setSummaryModal] = useState(null); // 'todos' | 'ativo' | 'aInativar' | 'inativo' | 'oportunidades'
  const [vendedorSel, setVendedorSel] = useState(null);

  // Agrupa clientes por vendedor do módulo, considerando a última compra
  // com CADA vendedor para classificar status (ativo/a inativar/inativo).
  const porVendedor = useMemo(() => {
    const todosClientes = erpData?.clientes || [];
    const backendSellersMap = erpData?.sellersMap || {};
    const noventaDiasAtras = Date.now() - 90 * 86400000;
    const regras = REGRAS_INATIVIDADE[modulo] || REGRAS_INATIVIDADE.revenda;

    // Mapa robusto de sellerCode → nome (do backend + vendedores array)
    const sellerNameMap = {};
    for (const [k, v] of Object.entries(backendSellersMap)) {
      if (v?.name) sellerNameMap[String(k)] = v.name;
    }
    (erpData?.vendedores || []).forEach((v) => {
      if (v.code && v.name) sellerNameMap[String(v.code)] = v.name;
    });

    // Constrói sets dinâmicos por módulo a partir do vendedoresMap (Supabase)
    const vendedoresPorModuloDinamico = {};
    if (vendedoresMap?.byTotvsId) {
      for (const [totvsId, info] of Object.entries(vendedoresMap.byTotvsId)) {
        if (info.modulo) {
          if (!vendedoresPorModuloDinamico[info.modulo])
            vendedoresPorModuloDinamico[info.modulo] = new Set();
          vendedoresPorModuloDinamico[info.modulo].add(Number(totvsId));
        }
      }
    }
    // Fallback para o hardcoded se vendedoresMap não carregou
    let vendedoresModulo =
      vendedoresPorModuloDinamico[modulo] || VENDEDORES_POR_MODULO[modulo];

    // Multimarcas: SEMPRE remove os inbound (David=26, Thalis=69, Rafael=21),
    // mesmo se o Supabase tagueou eles como 'multimarcas'. Esses vendedores
    // têm canais próprios (inbound_david / inbound_rafael) e não devem
    // aparecer na carteira de Multimarcas geral.
    if (modulo === 'multimarcas' && vendedoresModulo) {
      const INBOUND_EXCLUSO = new Set([21, 26, 69]);
      vendedoresModulo = new Set(
        [...vendedoresModulo].filter((c) => !INBOUND_EXCLUSO.has(Number(c))),
      );
    }

    // Filiais válidas pra varejo (mesma lista do CANAL_CONFIG.varejo backend).
    // Vendedor só conta como "do varejo" se transacionou em uma dessas branches.
    const VAREJO_BRANCHES = new Set([
      2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97,
    ]);

    // Helper: verifica se uma transação pertence ao canal do módulo
    const txPertenceAoModulo = (tx) => {
      if (modulo === 'varejo') {
        // Restrição forte: tx deve ser do canal varejo E da branch varejo
        const branch = Number(tx.branchCode || tx.branch_code || tx.branch);
        if (!VAREJO_BRANCHES.has(branch)) return false;
        return tx.canal === 'varejo';
      }
      if (modulo === 'revenda') return tx.canal !== 'varejo';
      // business/franquia/multimarcas: não-varejo
      return tx.canal !== 'varejo';
    };

    // Conjunto de TODOS os sellers conhecidos em canais não-varejo
    // (revenda, multimarcas, inbound_*, business, franquia). Usado pra
    // excluir esses sellers da carteira de varejo, mesmo que tenham
    // alguma venda esporádica em filial varejo.
    const sellersNaoVarejo = new Set();
    for (const [mod, set] of Object.entries(vendedoresPorModuloDinamico)) {
      if (mod === 'varejo') continue;
      for (const id of set) sellersNaoVarejo.add(Number(id));
    }
    // Inclui também os hardcoded (caso vendedoresMap não cubra tudo)
    for (const [mod, set] of Object.entries(VENDEDORES_POR_MODULO)) {
      if (mod === 'varejo' || !set) continue;
      for (const id of set) sellersNaoVarejo.add(Number(id));
    }

    // Helper: verifica se um sellerCode pertence ao módulo
    const sellerDoModulo = (sc) => {
      const code = Number(sc);
      if (modulo === 'varejo') {
        // Exclui sellers que pertencem a outros canais (revenda, MTM, etc.)
        return !sellersNaoVarejo.has(code);
      }
      if (vendedoresModulo) return vendedoresModulo.has(code);
      // business/franquia sem lista definida: exclui vendedores de outros módulos
      const allKnown = new Set();
      for (const s of Object.values(vendedoresPorModuloDinamico)) {
        for (const id of s) allKnown.add(id);
      }
      return !allKnown.has(code);
    };

    // Classifica status com base em dias sem comprar
    const classificarPorDias = (dias) => {
      if (dias === null || dias === undefined || !isFinite(dias))
        return 'inativo';
      if (dias >= regras.inativo) return 'inativo';
      if (dias >= regras.alerta) return 'aInativar';
      return 'ativo';
    };

    const grupos = {};
    const seenByVendedor = {};

    todosClientes.forEach((c) => {
      const txs = c.transacoes || [];
      const personKey = c.cod || c.code || c.personCode;

      // Filtra transações que pertencem ao canal do módulo
      // e agrupa por vendedor (sellerCode)
      const txBySeller = {};
      txs.forEach((tx) => {
        if (!txPertenceAoModulo(tx)) return;
        const sc = tx.sellerCode || c.vendedorCode;
        if (!sc) return;
        if (!sellerDoModulo(sc)) return;
        if (!txBySeller[sc]) txBySeller[sc] = [];
        txBySeller[sc].push(tx);
      });

      // Se não teve transações no módulo, tenta incluir pelo vendedorCode principal
      // ATENÇÃO: pra varejo, NÃO aplica o fallback — sem lista canônica de
      // vendedores varejo, o fallback inclui vendedores de outros canais (revenda
      // atacado, MTM, etc.) que tiveram alguma compra mas não fazem parte do
      // varejo. Cliente sem transação varejo no período é simplesmente ignorado.
      if (Object.keys(txBySeller).length === 0) {
        if (modulo === 'varejo') return;
        const mainSc = c.vendedorCode;
        if (mainSc && sellerDoModulo(mainSc)) {
          txBySeller[mainSc] = []; // sem transações no módulo → será classificado como inativo
        } else {
          return;
        }
      }

      // Para cada vendedor do módulo com quem o cliente transacionou
      for (const [sellerCode, sellerTxs] of Object.entries(txBySeller)) {
        const sellerCodeNum = Number(sellerCode);

        const sellerName =
          sellerNameMap[String(sellerCodeNum)] || `Vendedor ${sellerCodeNum}`;

        const dedupKey = `${sellerCodeNum}::${personKey}`;
        if (seenByVendedor[dedupKey]) continue;
        seenByVendedor[dedupKey] = true;

        // Calcula última compra COM ESTE vendedor (no canal do módulo)
        const ultimaTxVendedor = sellerTxs.reduce(
          (best, t) =>
            !best || (t.dtStr || '') > (best.dtStr || '') ? t : best,
          null,
        );
        const diasSemComprarVendedor = ultimaTxVendedor?.dtStr
          ? Math.floor(
              (Date.now() - new Date(ultimaTxVendedor.dtStr).getTime()) /
                86400000,
            )
          : Infinity;

        const status = classificarPorDias(diasSemComprarVendedor);

        // LTV e ticket médio COM ESTE vendedor (no canal do módulo)
        const ltvVendedor = sellerTxs.reduce(
          (s, t) => s + (t.total || t.vlFat || 0),
          0,
        );
        const ticketVendedor =
          sellerTxs.length > 0 ? ltvVendedor / sellerTxs.length : 0;

        const enriquecido = {
          ...c,
          _status: status,
          _ltv: ltvVendedor,
          _ticket: ticketVendedor,
          diasSemComprar: diasSemComprarVendedor,
          ultimaCompra: ultimaTxVendedor?.dtStr || null,
          transacoes: c.transacoes,
        };

        if (!grupos[sellerName])
          grupos[sellerName] = {
            clientes: [],
            vendedorCode: sellerCodeNum,
            primeiraCompra: 0,
          };
        grupos[sellerName].clientes.push(enriquecido);

        const dtCad = c.dtCadastroStr || c.insert_date;
        const isNovo = dtCad && new Date(dtCad).getTime() >= noventaDiasAtras;
        if (isNovo) grupos[sellerName].primeiraCompra += 1;
      }
    });

    // Garante card pra cada vendedor ativo do canal mesmo sem clientes
    // (ex: David ativo no inbound_david mas sem cliente no período).
    // Dedup por vendedorCode pra não criar card duplicado quando o nome
    // do TOTVS difere do Supabase (ex: "THALIS GOMES" vs "Thalis").
    if (vendedoresModulo) {
      const codesComGrupo = new Set(
        Object.values(grupos).map((g) => Number(g.vendedorCode)),
      );
      for (const code of vendedoresModulo) {
        const codeNum = Number(code);
        if (codesComGrupo.has(codeNum)) continue;
        const info = vendedoresMap?.byTotvsId?.[codeNum];
        const sellerName =
          info?.nome || sellerNameMap[String(codeNum)] || `Vendedor ${codeNum}`;
        grupos[sellerName] = {
          clientes: [],
          vendedorCode: codeNum,
          primeiraCompra: 0,
        };
      }
    }

    return grupos;
  }, [erpData, modulo, vendedoresMap]);

  // Aplica filtro geral (Todos/Ativos/A Inativar/Inativos)
  const porVendedorFiltrado = useMemo(() => {
    if (filtroGeral === 'todos') return porVendedor;
    const out = {};
    Object.entries(porVendedor).forEach(([v, grupo]) => {
      const f = grupo.clientes.filter((c) => c._status === filtroGeral);
      if (f.length > 0) out[v] = { ...grupo, clientes: f };
    });
    return out;
  }, [porVendedor, filtroGeral]);

  // Totais agregados de TODOS os vendedores (para resumo no topo)
  // Também monta listas planas pra alimentar os modais
  const { totaisCarteira, todosClientesFlat, oportunidadesPorVendedor } = useMemo(() => {
    let total = 0,
      ativos = 0,
      aInativar = 0,
      inativos = 0,
      oportunidades = 0;
    const flat = [];
    const oportPorVend = [];
    for (const [vendName, grupo] of Object.entries(porVendedor)) {
      total += grupo.clientes.length;
      for (const c of grupo.clientes) {
        if (c._status === 'ativo') ativos += 1;
        else if (c._status === 'aInativar') aInativar += 1;
        else if (c._status === 'inativo') inativos += 1;
        flat.push({ ...c, _vendedor: vendName });
      }
      const cnt = oportunidadesMap[String(grupo.vendedorCode)] || 0;
      oportunidades += cnt;
      if (cnt > 0)
        oportPorVend.push({
          vendedor: vendName,
          vendedorCode: grupo.vendedorCode,
          oportunidades: cnt,
          totalClientes: grupo.clientes.length,
        });
    }
    return {
      totaisCarteira: { total, ativos, aInativar, inativos, oportunidades },
      todosClientesFlat: flat,
      oportunidadesPorVendedor: oportPorVend.sort(
        (a, b) => b.oportunidades - a.oportunidades,
      ),
    };
  }, [porVendedor, oportunidadesMap]);

  // Callback de clique no card
  const handleClickCard = useCallback((vendedor) => {
    setVendedorSel(vendedor);
  }, []);

  // Placeholder se não houver dados
  if (!erpData || !erpData.clientes || erpData.clientes.length === 0) {
    const loading = erpLoading;
    const pct = erpProgress?.total
      ? Math.round((erpProgress.page / erpProgress.total) * 100)
      : null;
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
        <Users size={40} className="mx-auto text-gray-300 mb-2" />
        {loading ? (
          <>
            <p className="text-sm text-gray-700 font-medium">
              Sincronizando ERP do TOTVS…
            </p>
            {erpProgress && (
              <>
                <p className="text-xs text-gray-500 mt-1">
                  Etapa: <span className="font-mono">{erpProgress.step}</span>
                  {pct != null && <> · {pct}%</>}
                  {erpProgress.total > 0 && (
                    <>
                      {' '}
                      ({erpProgress.page}/{erpProgress.total})
                    </>
                  )}
                </p>
                {pct != null && (
                  <div className="mt-3 max-w-sm mx-auto h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#000638] transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </>
            )}
            <p className="text-[11px] text-gray-400 mt-2">
              Pode levar alguns minutos na primeira vez. A página atualiza
              sozinha.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500">
            ERP ainda não carregado. Clique em <strong>TOTVS</strong> no topo
            para sincronizar.
          </p>
        )}
      </div>
    );
  }

  // View de detalhes de um vendedor selecionado
  if (vendedorSel) {
    return (
      <DetalheVendedor
        vendedor={vendedorSel}
        clientes={porVendedor[vendedorSel]?.clientes || []}
        onBack={() => setVendedorSel(null)}
        onChatLead={onChatLead}
        initialFiltro={filtroGeral !== 'todos' ? filtroGeral : 'todos'}
        modulo={modulo}
      />
    );
  }

  // Lista de vendedores (cards)
  const vendedores = Object.keys(porVendedorFiltrado).sort();

  return (
    <div className="space-y-3">
      {/* Aniversariantes + Cashback (só revenda) — lado a lado, abrem popup */}
      {modulo === 'revenda' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <AniversariantesSection onChatLead={onChatLead} branch={99} />
          <CashbackSection erpData={erpData} onChatLead={onChatLead} />
        </div>
      )}

      {/* Resumo da carteira (todos os vendedores) — clique abre modal */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          {
            key: 'todos',
            label: 'Total',
            valor: totaisCarteira.total,
            from: 'from-[#000638]',
            iconBg: 'bg-[#000638]/10',
            text: 'text-[#000638]',
            dot: null,
            iconEl: (
              <Users size={16} weight="bold" className="text-[#000638]" />
            ),
          },
          {
            key: 'ativo',
            label: 'Ativos',
            valor: totaisCarteira.ativos,
            from: 'from-emerald-400',
            iconBg: 'bg-emerald-100',
            text: 'text-emerald-600',
            iconEl: (
              <CheckCircle
                size={16}
                weight="bold"
                className="text-emerald-600"
              />
            ),
          },
          {
            key: 'aInativar',
            label: 'A Inativar',
            valor: totaisCarteira.aInativar,
            from: 'from-yellow-400',
            iconBg: 'bg-yellow-100',
            text: 'text-yellow-700',
            iconEl: (
              <Warning
                size={16}
                weight="bold"
                className="text-yellow-600"
              />
            ),
          },
          {
            key: 'inativo',
            label: 'Inativos',
            valor: totaisCarteira.inativos,
            from: 'from-rose-400',
            iconBg: 'bg-rose-100',
            text: 'text-rose-600',
            iconEl: (
              <XCircle
                size={16}
                weight="bold"
                className="text-rose-600"
              />
            ),
          },
          {
            key: 'oportunidades',
            label: 'Oportunidades',
            valor: totaisCarteira.oportunidades,
            from: 'from-blue-400',
            iconBg: 'bg-blue-100',
            text: 'text-blue-600',
            iconEl: (
              <TrendUp
                size={16}
                weight="bold"
                className="text-blue-600"
              />
            ),
          },
        ].map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={c.valor === 0}
            onClick={() => c.valor > 0 && setSummaryModal(c.key)}
            className={`bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 relative overflow-hidden text-left transition ${
              c.valor === 0
                ? 'cursor-not-allowed opacity-70'
                : 'cursor-pointer hover:border-[#000638]/40 hover:shadow-md hover:-translate-y-0.5'
            }`}
          >
            <span
              className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${c.from} to-transparent`}
            />
            <span
              className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${c.iconBg}`}
            >
              {c.iconEl ? (
                c.iconEl
              ) : (
                <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1">
                {c.label}
                {c.valor > 0 && (
                  <span className="text-gray-300 text-[9px]">›</span>
                )}
              </div>
              <div
                className={`text-xl font-extrabold tabular-nums ${c.text}`}
              >
                {c.valor.toLocaleString('pt-BR')}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Filtros do topo */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'todos', label: 'Todos' },
          { key: 'ativo', label: 'Ativos' },
          { key: 'aInativar', label: 'A Inativar' },
          { key: 'inativo', label: 'Inativos' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltroGeral(f.key)}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg ${
              filtroGeral === f.key
                ? 'bg-[#000638] text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-[#000638]/30'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Grid de cards por vendedor */}
      {vendedores.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-center">
          <p className="text-sm text-gray-500">
            Nenhum vendedor encontrado com o filtro selecionado.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {vendedores.map((v, idx) => {
            const grupo = porVendedorFiltrado[v];
            const ops = oportunidadesMap[String(grupo.vendedorCode)] || 0;
            const vInfo = vendedoresMap?.byTotvsId?.[grupo.vendedorCode];
            const inativo = vInfo && vInfo.ativo === false;
            return (
              <VendedorCard
                key={v}
                vendedor={v}
                clientes={grupo.clientes}
                color={COLORS[idx % COLORS.length]}
                oportunidades={ops}
                primeiraCompra={grupo.primeiraCompra || 0}
                inativo={inativo}
                onClick={() => handleClickCard(v)}
              />
            );
          })}
        </div>
      )}

      {/* Modal de resumo (clica num card de totais → abre lista) */}
      {summaryModal && (() => {
        const fmtMoeda = (v) =>
          (v || 0).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          });
        const STATUS_LABELS = {
          ativo: { txt: 'Ativo', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
          aInativar: { txt: 'A Inativar', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
          inativo: { txt: 'Inativo', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
        };
        let titulo = '', items = [], columns = [];
        if (summaryModal === 'oportunidades') {
          titulo = `Oportunidades por vendedor — ${totaisCarteira.oportunidades} no total`;
          items = oportunidadesPorVendedor;
          columns = [
            { key: 'vendedor', label: 'Vendedor', cellClass: 'font-semibold text-gray-800' },
            { key: 'totalClientes', label: 'Clientes na carteira', align: 'right' },
            {
              key: 'oportunidades',
              label: 'Oportunidades',
              align: 'right',
              render: (it) => (
                <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-bold text-[11px]">
                  {it.oportunidades}
                </span>
              ),
            },
          ];
        } else {
          const tituloMap = {
            todos: `Todos os clientes — ${totaisCarteira.total}`,
            ativo: `Clientes ativos — ${totaisCarteira.ativos}`,
            aInativar: `Clientes a inativar — ${totaisCarteira.aInativar}`,
            inativo: `Clientes inativos — ${totaisCarteira.inativos}`,
          };
          titulo = tituloMap[summaryModal];
          items = todosClientesFlat
            .filter((c) =>
              summaryModal === 'todos' ? true : c._status === summaryModal,
            )
            .sort((a, b) => (b._ltv || 0) - (a._ltv || 0));
          columns = [
            {
              key: 'cliente',
              label: 'Cliente',
              cellClass: 'font-semibold text-gray-800',
              search: (c) => c.nome || c.fantasyName || c.codigo || '',
              render: (c) => (
                <div>
                  <div className="font-semibold text-gray-800 truncate max-w-[260px]">
                    {c.nome || c.fantasyName || 'Sem nome'}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    #{c.codigo || c.code}
                  </div>
                </div>
              ),
            },
            {
              key: 'vendedor',
              label: 'Vendedor',
              search: (c) => c._vendedor,
              render: (c) => (
                <span className="text-gray-700 truncate max-w-[180px] inline-block">
                  {c._vendedor}
                </span>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              align: 'center',
              search: (c) => STATUS_LABELS[c._status]?.txt || '',
              render: (c) => {
                const s = STATUS_LABELS[c._status];
                if (!s) return '—';
                return (
                  <span
                    className={`inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${s.cls}`}
                  >
                    {s.txt}
                  </span>
                );
              },
            },
            {
              key: 'ultimaCompra',
              label: 'Última compra',
              align: 'center',
              render: (c) => c.ultimaCompra || '—',
            },
            {
              key: 'diasSemComprar',
              label: 'Dias',
              align: 'right',
              render: (c) =>
                c.diasSemComprar != null ? `${c.diasSemComprar}d` : '—',
            },
            {
              key: 'ltv',
              label: 'LTV',
              align: 'right',
              cellClass: 'font-bold text-emerald-600',
              render: (c) => fmtMoeda(c._ltv),
            },
          ];
        }
        return (
          <CarteiraSummaryModal
            titulo={titulo}
            items={items}
            columns={columns}
            onClose={() => setSummaryModal(null)}
          />
        );
      })()}
    </div>
  );
}
