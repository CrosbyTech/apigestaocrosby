import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/cards';
import LoadingSpinner from '../ui/LoadingSpinner';
import {
  ChartLineUp,
  ChatCircleDots,
  Megaphone,
  Wrench,
  ShieldCheck,
  Handshake,
  ArrowUp,
  ArrowDown,
  CurrencyDollar,
  CalendarBlank,
  CaretDown,
} from '@phosphor-icons/react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const USD_TO_BRL = 5.70; // Taxa de câmbio USD→BRL (Meta cobra em USD)

const fmtBRL = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUSD = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const StatCard = ({ label, value, icon: Icon, color, subtitle, trend, extraInfo }) => (
  <Card className="shadow-md rounded-xl bg-white hover:shadow-lg transition-shadow">
    <CardContent className="p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-[#000638] mt-1">{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
          {extraInfo && <p className="text-[10px] text-gray-400 mt-0.5">{extraInfo}</p>}
        </div>
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon size={22} weight="bold" className="text-white" />
        </div>
      </div>
      {trend !== undefined && (
        <div className="flex items-center gap-1 mt-3">
          {trend >= 0 ? (
            <ArrowUp size={14} className="text-emerald-500" weight="bold" />
          ) : (
            <ArrowDown size={14} className="text-red-500" weight="bold" />
          )}
          <span className={`text-xs font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {Math.abs(trend)}%
          </span>
          <span className="text-xs text-gray-400">vs período anterior</span>
        </div>
      )}
    </CardContent>
  </Card>
);

const CategoryBar = ({ label, value, total, color }) => {
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-500 font-semibold">{value.toLocaleString('pt-BR')} <span className="text-xs text-gray-400">({pct}%)</span></span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2.5">
        <div className={`h-2.5 rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const WhatsAppDashboard = ({ accounts }) => {
  const [loading, setLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [period, setPeriod] = useState('7d');
  const [analytics, setAnalytics] = useState(null);
  const [queueStatus, setQueueStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (accounts?.length && !selectedAccount) {
      setSelectedAccount(accounts[0]);
    }
  }, [accounts, selectedAccount]);

  const getDateRange = useCallback(() => {
    const end = new Date();
    const start = new Date();
    if (period === '7d') start.setDate(end.getDate() - 7);
    else if (period === '30d') start.setDate(end.getDate() - 30);
    else if (period === '90d') start.setDate(end.getDate() - 90);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    };
  }, [period]);

  const fetchData = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    setError(null);
    try {
      const { startDate, endDate } = getDateRange();

      const [analyticsRes, queueRes] = await Promise.all([
        fetch(`${API_BASE}/api/meta/analytics/${selectedAccount.id}?startDate=${startDate}&endDate=${endDate}`).then(r => r.json()),
        fetch(`${API_BASE}/api/meta/queue/status?accountId=${selectedAccount.id}`).then(r => r.json()),
      ]);

      if (analyticsRes.success) setAnalytics(analyticsRes.data);
      if (queueRes.success) setQueueStatus(queueRes.data);
    } catch (err) {
      console.error('Erro ao carregar analytics:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, getDateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const summary = analytics?.summary || { sent: 0, delivered: 0, marketing: 0, utility: 0, authentication: 0, service: 0, totalVolume: 0, totalCost: 0 };
  const queue = queueStatus || { pending: 0, processing: 0, sent: 0, delivered: 0, failed: 0, total: 0 };

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card className="shadow-md rounded-xl bg-white">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Seletor de conta */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Conta</label>
              <div className="relative">
                <select
                  value={selectedAccount?.id || ''}
                  onChange={(e) => {
                    const acc = accounts.find(a => String(a.id) === e.target.value);
                    setSelectedAccount(acc);
                  }}
                  className="appearance-none bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-4 py-2 pr-8 text-sm font-medium text-[#000638] focus:ring-2 focus:ring-[#000638]/30 focus:border-[#000638] outline-none"
                >
                  {accounts?.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
                <CaretDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* Seletor de período */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Período</label>
              <div className="flex gap-1.5">
                {[
                  { key: '7d', label: '7 dias' },
                  { key: '30d', label: '30 dias' },
                  { key: '90d', label: '90 dias' },
                ].map(p => (
                  <button
                    key={p.key}
                    onClick={() => setPeriod(p.key)}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      period === p.key
                        ? 'bg-[#000638] text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ml-auto flex items-end">
              <button
                onClick={fetchData}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-[#000638] text-white rounded-lg text-sm font-semibold hover:bg-[#000638]/90 transition-all disabled:opacity-50"
              >
                <CalendarBlank size={16} weight="bold" />
                Atualizar
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <Card className="shadow-md rounded-xl bg-red-50 border border-red-200">
          <CardContent className="p-4">
            <p className="text-sm text-red-700 font-medium">Erro ao carregar dados: {error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Enviadas"
              value={summary.sent.toLocaleString('pt-BR')}
              icon={ChatCircleDots}
              color="bg-[#000638]"
              subtitle={`${summary.delivered.toLocaleString('pt-BR')} entregues`}
            />
            <StatCard
              label="Marketing"
              value={summary.marketing.toLocaleString('pt-BR')}
              icon={Megaphone}
              color="bg-emerald-500"
              subtitle="Campanhas promocionais"
            />
            <StatCard
              label="Utilidade"
              value={summary.utility.toLocaleString('pt-BR')}
              icon={Wrench}
              color="bg-blue-500"
              subtitle="Notificações transacionais"
            />
            <StatCard
              label="Custo Total"
              value={fmtBRL(summary.totalCost * USD_TO_BRL)}
              icon={CurrencyDollar}
              color="bg-amber-500"
              subtitle={`${summary.totalVolume.toLocaleString('pt-BR')} msgs tarifadas`}
              extraInfo={fmtUSD(summary.totalCost)}
            />
          </div>

          {/* Detalhamento e Fila */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Distribuição por Categoria */}
            <Card className="shadow-md rounded-xl bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold text-[#000638] flex items-center gap-2">
                  <ChartLineUp size={20} weight="bold" />
                  Distribuição por Categoria
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-0 space-y-4">
                <CategoryBar label="Marketing" value={summary.marketing} total={summary.totalVolume} color="bg-emerald-500" />
                <CategoryBar label="Utilidade" value={summary.utility} total={summary.totalVolume} color="bg-blue-500" />
                <CategoryBar label="Autenticação" value={summary.authentication} total={summary.totalVolume} color="bg-amber-500" />
                <CategoryBar label="Serviço" value={summary.service} total={summary.totalVolume} color="bg-purple-500" />
                <div className="pt-3 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-[#000638]">Total</span>
                    <span className="text-lg font-bold text-[#000638]">{summary.totalVolume.toLocaleString('pt-BR')}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Status da Fila */}
            <Card className="shadow-md rounded-xl bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold text-[#000638] flex items-center gap-2">
                  <Handshake size={20} weight="bold" />
                  Status da Fila de Disparo
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Pendentes', value: queue.pending + (queue.retrying || 0), color: 'text-amber-600 bg-amber-50' },
                    { label: 'Processando', value: queue.processing, color: 'text-blue-600 bg-blue-50' },
                    { label: 'Enviadas', value: queue.sent, color: 'text-emerald-600 bg-emerald-50' },
                    { label: 'Entregues', value: queue.delivered, color: 'text-green-600 bg-green-50' },
                    { label: 'Lidas', value: queue.read || 0, color: 'text-indigo-600 bg-indigo-50' },
                    { label: 'Respondidas', value: queue.replied || 0, color: 'text-purple-600 bg-purple-50' },
                    { label: 'Falharam', value: queue.failed, color: 'text-red-600 bg-red-50' },
                    { label: 'Canceladas', value: queue.canceled || 0, color: 'text-gray-600 bg-gray-50' },
                  ].map(item => (
                    <div key={item.label} className={`rounded-xl p-3 ${item.color.split(' ')[1]}`}>
                      <p className="text-xs font-medium text-gray-500">{item.label}</p>
                      <p className={`text-xl font-bold ${item.color.split(' ')[0]}`}>{(item.value || 0).toLocaleString('pt-BR')}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t flex items-center justify-between">
                  <span className="text-sm font-bold text-[#000638]">Total na Fila</span>
                  <span className="text-lg font-bold text-[#000638]">{queue.total.toLocaleString('pt-BR')}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

export default WhatsAppDashboard;
