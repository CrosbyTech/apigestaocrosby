import React, { useMemo, useState } from 'react';
import PageTitle from '../components/ui/PageTitle';
import {
  Bank,
  CurrencyDollar,
  Warning,
  Handshake,
  TrendUp,
  TrendDown,
  CheckCircle,
  XCircle,
  Table as TableIcon,
  ChartBar,
  MagnifyingGlass,
  CaretUp,
  CaretDown,
  DownloadSimple,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ComposedChart,
  Area,
  AreaChart,
} from 'recharts';
import emprestimosData from '../emprestimos.json';

// ─── Helpers ──────────────────────────────────────────────────────
const BRL = (v) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(Number(v || 0));

const BRL2 = (v) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(v || 0));

const fmtPct = (v, digits = 2) => `${(Number(v || 0) * 100).toFixed(digits)}%`;

const fmtDate = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
};

const getSaldo = (e) =>
  e.saldo_nominal_atual ??
  e.saldo_nominal_atual_planilha ??
  e.saldo_nominal_planilha_25_02_2026 ??
  e.saldo_com_mora_e_multa_16_03_2026 ??
  e.saldo_com_mora_e_multa_13_03_2026 ??
  e.saldo_capital_16_03_2026 ??
  e.saldo_devedor_extrato_16_03_2026 ??
  0;

const getValorContrato = (e) =>
  e.valor_contrato ?? e.valor_contrato_renegociado ?? 0;

const getPmt = (e) =>
  e.pmt ?? e.pmt_pos_carencia ?? e.pmt_atual ?? e.pmt_planilha ?? 0;

const getTaxa = (e) =>
  e.taxa_am ?? e.taxa_am_renegociada ?? e.taxa_am_estimada_2026 ?? 0;

// Cores por ação
const ACAO_COLORS = {
  PAGAR_NORMAL: '#16a34a',
  RENEGOCIAR: '#2563eb',
  QUITAR: '#7c3aed',
  NAO_PAGAR: '#dc2626',
};
const ACAO_LABELS = {
  PAGAR_NORMAL: 'Pagar Normal',
  RENEGOCIAR: 'Renegociar',
  QUITAR: 'Quitar',
  NAO_PAGAR: 'Não Pagar',
};
const TOMADOR_COLORS = {
  CROSBY: '#000638',
  FABIO: '#0891b2',
  IRMAOS: '#ea580c',
};
const BANCO_COLORS = [
  '#000638',
  '#dc2626',
  '#16a34a',
  '#f59e0b',
  '#7c3aed',
  '#0891b2',
  '#ea580c',
  '#db2777',
  '#0f766e',
  '#6366f1',
];

// ─── Componente Card ──────────────────────────────────────────────
const Card = ({
  icon: Icon,
  label,
  value,
  hint,
  color = 'text-[#000638]',
  bg = 'bg-white',
}) => (
  <div
    className={`${bg} rounded-lg shadow border border-gray-200 p-4 flex flex-col`}
  >
    <div className="flex items-center gap-2 mb-1">
      {Icon && <Icon size={18} className={color} weight="bold" />}
      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
        {label}
      </span>
    </div>
    <div className={`text-xl font-bold ${color}`}>{value}</div>
    {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
  </div>
);

// ─── Aba: Planilha ────────────────────────────────────────────────
const baixarExcel = (dados) => {
  const linhas = dados.map((e) => ({
    ID: e.id,
    Banco: e.banco,
    Tomador: e.tomador,
    'Linha de Crédito': e.linha_credito,
    'Nº Contrato': e.numero_contrato,
    'Valor Original (R$)': getValorContrato(e),
    'Saldo Atual (R$)': getSaldo(e),
    'PMT (R$)': getPmt(e),
    'Qtd Parcelas': e.qtd_parcelas ?? '',
    'Taxa a.m.': getTaxa(e) ? `${(getTaxa(e) * 100).toFixed(4)}%` : '',
    'Vencimento Final': fmtDate(e.vencimento_final),
    Garantia: e.garantia_real || e.garantia || '',
    Ação: ACAO_LABELS[e.acao] || e.acao || '',
    Amortização: e.sistema_amortizacao || '',
    Avalistas: (e.avalistas || []).join(', '),
  }));
  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Empréstimos');
  XLSX.writeFile(
    wb,
    `emprestimos_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
};

const AbaPlanilha = ({ emprestimos }) => {
  const [busca, setBusca] = useState('');
  const [filtroBanco, setFiltroBanco] = useState('TODOS');
  const [filtroTomador, setFiltroTomador] = useState('TODOS');
  const [filtroAcao, setFiltroAcao] = useState('TODOS');
  const [sortKey, setSortKey] = useState('id');
  const [sortDir, setSortDir] = useState('asc');

  const bancos = useMemo(
    () => [...new Set(emprestimos.map((e) => e.banco))].sort(),
    [emprestimos],
  );

  const dadosFiltrados = useMemo(() => {
    let list = emprestimos;
    if (filtroBanco !== 'TODOS')
      list = list.filter((e) => e.banco === filtroBanco);
    if (filtroTomador !== 'TODOS')
      list = list.filter((e) => e.tomador === filtroTomador);
    if (filtroAcao !== 'TODOS')
      list = list.filter((e) => e.acao === filtroAcao);
    if (busca) {
      const q = busca.toLowerCase();
      list = list.filter(
        (e) =>
          String(e.numero_contrato || '')
            .toLowerCase()
            .includes(q) ||
          String(e.linha_credito || '')
            .toLowerCase()
            .includes(q) ||
          String(e.banco || '')
            .toLowerCase()
            .includes(q) ||
          String(e.tomador || '')
            .toLowerCase()
            .includes(q),
      );
    }
    const mult = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      let va, vb;
      if (sortKey === 'saldo') {
        va = getSaldo(a);
        vb = getSaldo(b);
      } else if (sortKey === 'pmt') {
        va = getPmt(a);
        vb = getPmt(b);
      } else if (sortKey === 'taxa') {
        va = getTaxa(a);
        vb = getTaxa(b);
      } else if (sortKey === 'valor') {
        va = getValorContrato(a);
        vb = getValorContrato(b);
      } else {
        va = a[sortKey] ?? '';
        vb = b[sortKey] ?? '';
      }
      if (typeof va === 'number' && typeof vb === 'number')
        return (va - vb) * mult;
      return String(va).localeCompare(String(vb)) * mult;
    });
  }, [
    emprestimos,
    busca,
    filtroBanco,
    filtroTomador,
    filtroAcao,
    sortKey,
    sortDir,
  ]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortHeader = ({ keyName, children, align = 'left' }) => (
    <th
      onClick={() => toggleSort(keyName)}
      className={`px-3 py-2 text-xs font-bold text-[#000638] cursor-pointer select-none whitespace-nowrap text-${align}`}
    >
      <div
        className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}
      >
        {children}
        {sortKey === keyName &&
          (sortDir === 'asc' ? <CaretUp size={10} /> : <CaretDown size={10} />)}
      </div>
    </th>
  );

  const totaisFiltrados = useMemo(() => {
    return dadosFiltrados.reduce(
      (acc, e) => {
        acc.saldo += getSaldo(e);
        acc.pmt += getPmt(e);
        acc.valor += getValorContrato(e);
        return acc;
      },
      { saldo: 0, pmt: 0, valor: 0 },
    );
  }, [dadosFiltrados]);

  return (
    <div className="space-y-3">
      {/* Filtros + Botão Excel */}
      <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-[#000638] uppercase tracking-wide">
            Filtros
          </span>
          <button
            onClick={() => baixarExcel(dadosFiltrados)}
            className="flex items-center gap-1.5 bg-[#1d6f42] hover:bg-[#145c35] text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <DownloadSimple size={14} weight="bold" />
            Baixar Excel
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="relative">
            <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
              Buscar
            </label>
            <div className="relative">
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Contrato, linha, banco…"
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 pr-7 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-xs"
              />
              <MagnifyingGlass
                size={14}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
              Banco
            </label>
            <select
              value={filtroBanco}
              onChange={(e) => setFiltroBanco(e.target.value)}
              className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-xs"
            >
              <option value="TODOS">TODOS</option>
              {bancos.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
              Tomador
            </label>
            <select
              value={filtroTomador}
              onChange={(e) => setFiltroTomador(e.target.value)}
              className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-xs"
            >
              <option value="TODOS">TODOS</option>
              <option value="CROSBY">CROSBY</option>
              <option value="FABIO">FABIO</option>
              <option value="IRMAOS">IRMAOS</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
              Plano de Ação
            </label>
            <select
              value={filtroAcao}
              onChange={(e) => setFiltroAcao(e.target.value)}
              className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-xs"
            >
              <option value="TODOS">TODOS</option>
              <option value="PAGAR_NORMAL">PAGAR NORMAL</option>
              <option value="RENEGOCIAR">RENEGOCIAR</option>
              <option value="QUITAR">QUITAR</option>
              <option value="NAO_PAGAR">NÃO PAGAR</option>
            </select>
          </div>
        </div>
      </div>

      {/* Totais do filtro */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card
          icon={Handshake}
          label="Contratos"
          value={dadosFiltrados.length}
          color="text-[#000638]"
        />
        <Card
          icon={CurrencyDollar}
          label="Valor Original"
          value={BRL(totaisFiltrados.valor)}
          color="text-blue-700"
        />
        <Card
          icon={Warning}
          label="Saldo Atual"
          value={BRL(totaisFiltrados.saldo)}
          color="text-red-700"
        />
        <Card
          icon={TrendUp}
          label="PMT Mensal"
          value={BRL(totaisFiltrados.pmt)}
          color="text-orange-700"
        />
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b-2 border-gray-200 sticky top-0">
            <tr>
              <SortHeader keyName="id">ID</SortHeader>
              <SortHeader keyName="banco">Banco</SortHeader>
              <SortHeader keyName="tomador">Tomador</SortHeader>
              <SortHeader keyName="linha_credito">Linha de Crédito</SortHeader>
              <SortHeader keyName="numero_contrato">Contrato</SortHeader>
              <SortHeader keyName="valor" align="right">
                Valor Original
              </SortHeader>
              <SortHeader keyName="saldo" align="right">
                Saldo Atual
              </SortHeader>
              <SortHeader keyName="pmt" align="right">
                PMT
              </SortHeader>
              <SortHeader keyName="qtd_parcelas" align="right">
                Parc.
              </SortHeader>
              <SortHeader keyName="taxa" align="right">
                Taxa a.m.
              </SortHeader>
              <SortHeader keyName="vencimento_final">Venc. Final</SortHeader>
              <SortHeader keyName="garantia">Garantia</SortHeader>
              <SortHeader keyName="acao">Ação</SortHeader>
              <SortHeader keyName="sistema_amortizacao">Amort.</SortHeader>
            </tr>
          </thead>
          <tbody>
            {dadosFiltrados.map((e) => {
              const saldo = getSaldo(e);
              const valor = getValorContrato(e);
              const overSaldo = saldo > valor; // saldo > valor original = juros acumulados
              return (
                <tr
                  key={e.id}
                  className="border-b border-gray-100 hover:bg-blue-50/40 transition-colors"
                  title={e.observacao || ''}
                >
                  <td className="px-3 py-1.5 font-mono text-gray-600">
                    {e.id}
                  </td>
                  <td className="px-3 py-1.5 font-semibold">{e.banco}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                      style={{
                        backgroundColor: TOMADOR_COLORS[e.tomador] || '#666',
                      }}
                    >
                      {e.tomador}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">{e.linha_credito}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-700">
                    {e.numero_contrato}
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-700">
                    {BRL(valor)}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right font-semibold ${
                      overSaldo ? 'text-red-600' : 'text-gray-800'
                    }`}
                  >
                    {BRL(saldo)}
                  </td>
                  <td className="px-3 py-1.5 text-right">{BRL(getPmt(e))}</td>
                  <td className="px-3 py-1.5 text-right">
                    {e.qtd_parcelas ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {getTaxa(e) ? fmtPct(getTaxa(e)) : '—'}
                  </td>
                  <td className="px-3 py-1.5">{fmtDate(e.vencimento_final)}</td>
                  <td className="px-3 py-1.5 text-[11px]">
                    {e.garantia_real ? (
                      <span className="text-green-700 font-semibold">
                        {e.garantia_real.length > 35
                          ? e.garantia_real.slice(0, 33) + '…'
                          : e.garantia_real}
                      </span>
                    ) : (
                      <span className="text-gray-500">{e.garantia || '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                      style={{
                        backgroundColor: ACAO_COLORS[e.acao] || '#666',
                      }}
                    >
                      {ACAO_LABELS[e.acao] || e.acao}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-600">
                    {e.sistema_amortizacao || '—'}
                  </td>
                </tr>
              );
            })}
            {dadosFiltrados.length === 0 && (
              <tr>
                <td colSpan={14} className="text-center py-8 text-gray-500">
                  Nenhum contrato encontrado com os filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Aba: Dashboard ───────────────────────────────────────────────
const AbaDashboard = ({ emprestimos, meta }) => {
  // 1. KPIs Principais
  const kpis = useMemo(() => {
    const saldoTotal = emprestimos.reduce((s, e) => s + getSaldo(e), 0);
    const valorOriginalTotal = emprestimos.reduce(
      (s, e) => s + getValorContrato(e),
      0,
    );
    const pmtTotal = emprestimos.reduce((s, e) => s + getPmt(e), 0);
    const jurosAcumulados = Math.max(0, saldoTotal - valorOriginalTotal);
    const qtdInadimplentes = emprestimos.filter(
      (e) =>
        e.juros_moratorios_acumulados ||
        e.juros_moratorios_acumulados_mar_2026 ||
        e.juros_mora_acumulados_dez_2025 ||
        String(e.observacao || '')
          .toLowerCase()
          .includes('inadimpl'),
    ).length;
    const taxaMedia =
      emprestimos.reduce((s, e) => s + getTaxa(e), 0) /
      (emprestimos.length || 1);
    const contratosComGarantiaReal = emprestimos.filter(
      (e) => e.garantia_real,
    ).length;
    const valorGarantiaReal = emprestimos
      .filter((e) => e.garantia_real)
      .reduce((s, e) => s + getSaldo(e), 0);
    return {
      saldoTotal,
      valorOriginalTotal,
      pmtTotal,
      jurosAcumulados,
      qtdInadimplentes,
      taxaMedia,
      contratosComGarantiaReal,
      valorGarantiaReal,
    };
  }, [emprestimos]);

  // 2. Por Banco
  const porBanco = useMemo(() => {
    const map = new Map();
    emprestimos.forEach((e) => {
      const cur = map.get(e.banco) || {
        banco: e.banco,
        saldo: 0,
        pmt: 0,
        contratos: 0,
      };
      cur.saldo += getSaldo(e);
      cur.pmt += getPmt(e);
      cur.contratos += 1;
      map.set(e.banco, cur);
    });
    return [...map.values()].sort((a, b) => b.saldo - a.saldo);
  }, [emprestimos]);

  // 3. Por Tomador
  const porTomador = useMemo(() => {
    const map = new Map();
    emprestimos.forEach((e) => {
      const cur = map.get(e.tomador) || {
        tomador: e.tomador,
        saldo: 0,
        pmt: 0,
        contratos: 0,
      };
      cur.saldo += getSaldo(e);
      cur.pmt += getPmt(e);
      cur.contratos += 1;
      map.set(e.tomador, cur);
    });
    return [...map.values()].sort((a, b) => b.saldo - a.saldo);
  }, [emprestimos]);

  // 4. Por Ação
  const porAcao = useMemo(() => {
    const map = new Map();
    emprestimos.forEach((e) => {
      const cur = map.get(e.acao) || {
        acao: e.acao,
        saldo: 0,
        pmt: 0,
        contratos: 0,
      };
      cur.saldo += getSaldo(e);
      cur.pmt += getPmt(e);
      cur.contratos += 1;
      map.set(e.acao, cur);
    });
    return [...map.values()];
  }, [emprestimos]);

  // 5. Por Sistema de Amortização
  const porAmortizacao = useMemo(() => {
    const map = new Map();
    emprestimos.forEach((e) => {
      const k = e.sistema_amortizacao || 'INDEFINIDO';
      const cur = map.get(k) || { tipo: k, saldo: 0, contratos: 0 };
      cur.saldo += getSaldo(e);
      cur.contratos += 1;
      map.set(k, cur);
    });
    return [...map.values()];
  }, [emprestimos]);

  // 6. Ranking Taxas
  const topTaxas = useMemo(
    () =>
      [...emprestimos]
        .filter((e) => getTaxa(e) > 0)
        .sort((a, b) => getTaxa(b) - getTaxa(a))
        .slice(0, 10),
    [emprestimos],
  );

  // 7. Top 10 Saldos
  const topSaldos = useMemo(
    () =>
      [...emprestimos].sort((a, b) => getSaldo(b) - getSaldo(a)).slice(0, 10),
    [emprestimos],
  );

  // 8. Cronograma de Vencimentos por Ano
  const porAnoVencimento = useMemo(() => {
    const map = new Map();
    emprestimos.forEach((e) => {
      if (!e.vencimento_final) return;
      const ano = new Date(e.vencimento_final).getFullYear();
      if (isNaN(ano)) return;
      const cur = map.get(ano) || { ano, saldo: 0, contratos: 0 };
      cur.saldo += getSaldo(e);
      cur.contratos += 1;
      map.set(ano, cur);
    });
    return [...map.values()].sort((a, b) => a.ano - b.ano);
  }, [emprestimos]);

  // 9. PMT Mensal próximos 24 meses
  const pmtProximos24 = useMemo(() => {
    const hoje = new Date(meta?.data_analise || Date.now());
    const meses = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      meses.push({
        mes: key,
        mesLabel: d.toLocaleDateString('pt-BR', {
          month: 'short',
          year: '2-digit',
        }),
        pmt: 0,
      });
    }
    emprestimos.forEach((e) => {
      if (!e.vencimento_final) return;
      const venc = new Date(e.vencimento_final);
      const pmt = getPmt(e);
      if (!pmt) return;
      meses.forEach((m) => {
        const [ano, mesN] = m.mes.split('-').map(Number);
        const ref = new Date(ano, mesN - 1, 1);
        if (ref <= venc) m.pmt += pmt;
      });
    });
    return meses;
  }, [emprestimos, meta]);

  // 10. Mora & Multa Acumulados
  const moraMultaDetalhe = useMemo(() => {
    return emprestimos
      .map((e) => {
        const mora =
          (e.juros_moratorios_acumulados || 0) +
          (e.juros_moratorios_acumulados_mar_2026 || 0) +
          (e.juros_mora_acumulados_dez_2025 || 0);
        const multa =
          (e.multa_contratual_acumulada || 0) +
          (e.multa_acumulada || 0) +
          (e.multa_acumulada_mar_2026 || 0) +
          (e.multa_acumulada_dez_2025 || 0);
        return {
          id: e.id,
          contrato: `${e.banco} ${e.numero_contrato}`,
          tomador: e.tomador,
          mora,
          multa,
          total: mora + multa,
        };
      })
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [emprestimos]);

  const moraMultaTotal = moraMultaDetalhe.reduce((s, x) => s + x.total, 0);

  // 11. Semanal - Próximas 12 semanas (considerando dia_vencimento)
  const proximasSemanas = useMemo(() => {
    const hoje = new Date(meta?.data_analise || Date.now());
    const semanas = [];
    for (let i = 0; i < 12; i++) {
      const start = new Date(hoje);
      start.setDate(hoje.getDate() + i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      semanas.push({
        semana: `Sem ${i + 1}`,
        inicio: start,
        fim: end,
        pmt: 0,
        contratos: 0,
      });
    }
    emprestimos.forEach((e) => {
      const pmt = getPmt(e);
      if (!pmt) return;
      // Dia de vencimento do mês (usa dia_vencimento ou dia da data_inicial_pagamento ou data_inicial_pagamento_pos_carencia)
      let dia =
        e.dia_vencimento ||
        (e.data_inicial_pagamento
          ? new Date(e.data_inicial_pagamento).getDate()
          : null) ||
        (e.data_inicial_pagamento_pos_carencia
          ? new Date(e.data_inicial_pagamento_pos_carencia).getDate()
          : null);
      if (!dia) return;
      semanas.forEach((s) => {
        // Verifica se algum dia no intervalo da semana é o dia de vencimento
        for (
          let d = new Date(s.inicio);
          d <= s.fim;
          d.setDate(d.getDate() + 1)
        ) {
          if (d.getDate() === dia) {
            s.pmt += pmt;
            s.contratos += 1;
            break;
          }
        }
      });
    });
    return semanas.map((s) => ({
      ...s,
      label: `${s.inicio.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      })}`,
    }));
  }, [emprestimos, meta]);

  // 12. Avalistas - exposição
  const porAvalista = useMemo(() => {
    const map = new Map();
    emprestimos.forEach((e) => {
      (e.avalistas || []).forEach((av) => {
        const cur = map.get(av) || { avalista: av, saldo: 0, contratos: 0 };
        cur.saldo += getSaldo(e);
        cur.contratos += 1;
        map.set(av, cur);
      });
    });
    return [...map.values()].sort((a, b) => b.saldo - a.saldo);
  }, [emprestimos]);

  return (
    <div className="space-y-4">
      {/* KPIs PRINCIPAIS */}
      <div>
        <h3 className="text-sm font-bold text-[#000638] mb-2 uppercase tracking-wide">
          Indicadores Principais
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Card
            icon={Bank}
            label="Contratos Ativos"
            value={emprestimos.length}
            color="text-[#000638]"
          />
          <Card
            icon={CurrencyDollar}
            label="Saldo Devedor Total"
            value={BRL(kpis.saldoTotal)}
            hint={`Valor original: ${BRL(kpis.valorOriginalTotal)}`}
            color="text-red-700"
          />
          <Card
            icon={TrendUp}
            label="PMT Mensal Total"
            value={BRL(kpis.pmtTotal)}
            hint="Soma das parcelas contratuais"
            color="text-orange-600"
          />
          <Card
            icon={Warning}
            label="Juros Acumulados"
            value={BRL(kpis.jurosAcumulados)}
            hint={`${fmtPct(
              kpis.jurosAcumulados / (kpis.valorOriginalTotal || 1),
            )} sobre o original`}
            color="text-red-600"
          />
          <Card
            icon={XCircle}
            label="Contratos Inadimplentes"
            value={kpis.qtdInadimplentes}
            hint={`${fmtPct(
              kpis.qtdInadimplentes / (emprestimos.length || 1),
            )} da carteira`}
            color="text-red-700"
          />
          <Card
            icon={ChartBar}
            label="Taxa Média a.m."
            value={fmtPct(kpis.taxaMedia)}
            hint={`≈ ${fmtPct(Math.pow(1 + kpis.taxaMedia, 12) - 1, 1)} a.a.`}
            color="text-blue-700"
          />
          <Card
            icon={CheckCircle}
            label="Com Garantia Real"
            value={`${kpis.contratosComGarantiaReal} contratos`}
            hint={BRL(kpis.valorGarantiaReal)}
            color="text-green-700"
          />
          <Card
            icon={Warning}
            label="Mora + Multa"
            value={BRL(moraMultaTotal)}
            hint={`${moraMultaDetalhe.length} contratos afetados`}
            color="text-red-600"
          />
        </div>
      </div>

      {/* LINHA 1: Por Tomador + Por Ação */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
          <h4 className="text-sm font-bold text-[#000638] mb-2">
            Saldo Devedor por Tomador
          </h4>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={porTomador}
                dataKey="saldo"
                nameKey="tomador"
                innerRadius={50}
                outerRadius={90}
                label={({ tomador, saldo }) => `${tomador}: ${BRL(saldo)}`}
                labelLine={false}
                fontSize={11}
              >
                {porTomador.map((e) => (
                  <Cell
                    key={e.tomador}
                    fill={TOMADOR_COLORS[e.tomador] || '#666'}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(v) => BRL(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
          <h4 className="text-sm font-bold text-[#000638] mb-2">
            Distribuição por Plano de Ação
          </h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={porAcao}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="acao"
                tickFormatter={(v) => ACAO_LABELS[v] || v}
                fontSize={10}
              />
              <YAxis tickFormatter={(v) => BRL(v)} fontSize={10} />
              <Tooltip
                formatter={(v) => BRL(v)}
                labelFormatter={(v) => ACAO_LABELS[v] || v}
              />
              <Bar dataKey="saldo" name="Saldo">
                {porAcao.map((e) => (
                  <Cell key={e.acao} fill={ACAO_COLORS[e.acao] || '#666'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* LINHA 2: Por Banco */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
        <h4 className="text-sm font-bold text-[#000638] mb-2">
          Exposição por Banco (Saldo + PMT)
        </h4>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={porBanco}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="banco" fontSize={11} />
            <YAxis yAxisId="left" tickFormatter={(v) => BRL(v)} fontSize={10} />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v) => BRL(v)}
              fontSize={10}
            />
            <Tooltip formatter={(v) => BRL(v)} />
            <Legend />
            <Bar
              yAxisId="left"
              dataKey="saldo"
              name="Saldo Devedor"
              fill="#000638"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="pmt"
              name="PMT Mensal"
              stroke="#dc2626"
              strokeWidth={2}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* LINHA 3: Cronograma + Próximas Semanas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
          <h4 className="text-sm font-bold text-[#000638] mb-2">
            Cronograma — Saldo a Vencer por Ano
          </h4>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={porAnoVencimento}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="ano" fontSize={11} />
              <YAxis tickFormatter={(v) => BRL(v)} fontSize={10} />
              <Tooltip formatter={(v) => BRL(v)} />
              <Legend />
              <Area
                type="monotone"
                dataKey="saldo"
                name="Saldo vincendo"
                stroke="#000638"
                fill="#000638"
                fillOpacity={0.2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
          <h4 className="text-sm font-bold text-[#000638] mb-2">
            PMT Projetado — Próximas 12 Semanas
          </h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={proximasSemanas}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" fontSize={10} />
              <YAxis tickFormatter={(v) => BRL(v)} fontSize={10} />
              <Tooltip
                formatter={(v, n, p) => [
                  BRL(v),
                  `PMT (${p.payload.contratos} contratos)`,
                ]}
              />
              <Bar dataKey="pmt" name="PMT" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* LINHA 4: PMT 24 meses */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
        <h4 className="text-sm font-bold text-[#000638] mb-2">
          PMT Mensal Projetado — Próximos 24 Meses
        </h4>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={pmtProximos24}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="mesLabel" fontSize={10} />
            <YAxis tickFormatter={(v) => BRL(v)} fontSize={10} />
            <Tooltip formatter={(v) => BRL(v)} />
            <Line
              type="monotone"
              dataKey="pmt"
              name="PMT"
              stroke="#000638"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* LINHA 5: Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Top Taxas */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
          <h4 className="text-sm font-bold text-[#000638] mb-2">
            Top 10 — Maiores Taxas a.m.
          </h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b-2 border-gray-200 text-left text-[#000638]">
                <th className="py-1 px-1">#</th>
                <th className="py-1 px-1">Contrato</th>
                <th className="py-1 px-1 text-right">Saldo</th>
                <th className="py-1 px-1 text-right">Taxa a.m.</th>
              </tr>
            </thead>
            <tbody>
              {topTaxas.map((e, i) => (
                <tr key={e.id} className="border-b border-gray-100">
                  <td className="py-1 px-1 font-mono">{i + 1}</td>
                  <td className="py-1 px-1">
                    <div className="font-semibold">
                      {e.banco} — {e.tomador}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {e.linha_credito}
                    </div>
                  </td>
                  <td className="py-1 px-1 text-right">{BRL(getSaldo(e))}</td>
                  <td className="py-1 px-1 text-right font-bold text-red-700">
                    {fmtPct(getTaxa(e))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top Saldos */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
          <h4 className="text-sm font-bold text-[#000638] mb-2">
            Top 10 — Maiores Saldos
          </h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b-2 border-gray-200 text-left text-[#000638]">
                <th className="py-1 px-1">#</th>
                <th className="py-1 px-1">Contrato</th>
                <th className="py-1 px-1 text-right">Saldo</th>
                <th className="py-1 px-1 text-right">PMT</th>
              </tr>
            </thead>
            <tbody>
              {topSaldos.map((e, i) => (
                <tr key={e.id} className="border-b border-gray-100">
                  <td className="py-1 px-1 font-mono">{i + 1}</td>
                  <td className="py-1 px-1">
                    <div className="font-semibold">
                      {e.banco} — {e.tomador}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {e.linha_credito}
                    </div>
                  </td>
                  <td className="py-1 px-1 text-right font-bold">
                    {BRL(getSaldo(e))}
                  </td>
                  <td className="py-1 px-1 text-right">{BRL(getPmt(e))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* LINHA 6: Amortização + Avalistas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
          <h4 className="text-sm font-bold text-[#000638] mb-2">
            Sistema de Amortização
          </h4>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={porAmortizacao}
                dataKey="saldo"
                nameKey="tipo"
                label={({ tipo, saldo, contratos }) => `${tipo} (${contratos})`}
                outerRadius={90}
                fontSize={11}
              >
                {porAmortizacao.map((e, i) => (
                  <Cell
                    key={e.tipo}
                    fill={BANCO_COLORS[i % BANCO_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(v) => BRL(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
          <h4 className="text-sm font-bold text-[#000638] mb-2">
            Exposição por Avalista
          </h4>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={porAvalista} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                tickFormatter={(v) => BRL(v)}
                fontSize={10}
              />
              <YAxis
                type="category"
                dataKey="avalista"
                fontSize={11}
                width={90}
              />
              <Tooltip formatter={(v) => BRL(v)} />
              <Bar dataKey="saldo" name="Saldo avalizado" fill="#7c3aed" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* LINHA 7: Mora & Multa */}
      {moraMultaDetalhe.length > 0 && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-3">
          <h4 className="text-sm font-bold text-[#000638] mb-2">
            Mora & Multa Acumulados — Contratos Inadimplentes
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2 border-gray-200 text-left text-[#000638]">
                  <th className="py-1 px-2">Contrato</th>
                  <th className="py-1 px-2">Tomador</th>
                  <th className="py-1 px-2 text-right">Juros Mora</th>
                  <th className="py-1 px-2 text-right">Multa</th>
                  <th className="py-1 px-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {moraMultaDetalhe.map((x) => (
                  <tr key={x.id} className="border-b border-gray-100">
                    <td className="py-1 px-2 font-mono">{x.contrato}</td>
                    <td className="py-1 px-2">{x.tomador}</td>
                    <td className="py-1 px-2 text-right text-red-600">
                      {BRL2(x.mora)}
                    </td>
                    <td className="py-1 px-2 text-right text-red-600">
                      {BRL2(x.multa)}
                    </td>
                    <td className="py-1 px-2 text-right font-bold text-red-700">
                      {BRL2(x.total)}
                    </td>
                  </tr>
                ))}
                <tr className="font-bold bg-red-50">
                  <td colSpan={4} className="py-1 px-2 text-right">
                    TOTAL
                  </td>
                  <td className="py-1 px-2 text-right text-red-700">
                    {BRL2(moraMultaTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Página Principal ─────────────────────────────────────────────
const Emprestimos = () => {
  const [aba, setAba] = useState('planilha');

  const { emprestimos = [], metadata = {} } = emprestimosData || {};

  return (
    <div className="p-4 sm:p-6 bg-gray-50 min-h-screen">
      <PageTitle
        title="Empréstimos"
        subtitle="Gestão e análise da carteira de endividamento bancário do grupo"
        icon={Bank}
      />

      {/* Meta informativo */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-900 flex flex-wrap gap-3">
        <span>
          <strong>Data base:</strong> {fmtDate(metadata?.data_base_planilha)}
        </span>
        <span>
          <strong>Análise:</strong> {fmtDate(metadata?.data_analise)}
        </span>
        <span>
          <strong>Contratos:</strong> {emprestimos.length}
        </span>
        <span>
          <strong>Tomadores:</strong>{' '}
          {Object.keys(metadata?.tomadores || {}).join(' / ')}
        </span>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <button
          onClick={() => setAba('planilha')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors border-b-2 ${
            aba === 'planilha'
              ? 'text-[#000638] border-[#000638]'
              : 'text-gray-500 border-transparent hover:text-[#000638]'
          }`}
        >
          <TableIcon size={16} weight="bold" />
          Planilha
        </button>
        <button
          onClick={() => setAba('dashboard')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors border-b-2 ${
            aba === 'dashboard'
              ? 'text-[#000638] border-[#000638]'
              : 'text-gray-500 border-transparent hover:text-[#000638]'
          }`}
        >
          <ChartBar size={16} weight="bold" />
          Dashboard
        </button>
      </div>

      {aba === 'planilha' ? (
        <AbaPlanilha emprestimos={emprestimos} />
      ) : (
        <AbaDashboard emprestimos={emprestimos} meta={metadata} />
      )}
    </div>
  );
};

export default Emprestimos;
