import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/cards';
import LoadingSpinner from '../ui/LoadingSpinner';
import {
  ChartBar,
  TrendUp,
  Users,
  CheckCircle,
  Eye as EyeIcon,
  CurrencyDollar,
  CaretDown,
  ArrowClockwise,
  Export,
  ChatTeardropText,
} from '@phosphor-icons/react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const COTACAO_DOLAR = 5.8;

const formatCurrency = (value, currency = 'BRL') =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency });

const categoryLabel = (name) => {
  const map = { MARKETING: 'Marketing', UTILITY: 'Utilitário', AUTHENTICATION: 'Autenticação', SERVICE: 'Serviço' };
  return map[name?.toUpperCase()] || name;
};

const WhatsAppReports = ({ accounts, activeAccount }) => {
  const [loading, setLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [templateAnalytics, setTemplateAnalytics] = useState([]);
  const [sortKey, setSortKey] = useState('scheduledAt');
  const [sortDir, setSortDir] = useState('desc');

  const today = new Date().toISOString().split('T')[0];
  const sixMonthsAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 6, 1).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(sixMonthsAgo);
  const [endDate, setEndDate] = useState(today);

  useEffect(() => {
    // Se veio activeAccount do pai, usa ele; senão usa o primeiro da lista
    if (activeAccount) {
      setSelectedAccount(activeAccount);
    } else if (accounts?.length && !selectedAccount) {
      setSelectedAccount(accounts[0]);
    }
  }, [accounts, activeAccount]);

  const fetchData = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    try {
      const [campaignsRes, analyticsRes, templateAnalyticsRes] = await Promise.all([
        fetch(`${API_BASE}/api/meta/campaigns?accountId=${selectedAccount.id}&startDate=${startDate}&endDate=${endDate}`),
        fetch(`${API_BASE}/api/meta/analytics/${selectedAccount.id}?startDate=${startDate}&endDate=${endDate}`),
        fetch(`${API_BASE}/api/meta/template-analytics/${selectedAccount.id}?startDate=${startDate}&endDate=${endDate}`),
      ]);

      const [campaignsJson, analyticsJson, templateAnalyticsJson] = await Promise.all([
        campaignsRes.json(),
        analyticsRes.json(),
        templateAnalyticsRes.json(),
      ]);

      console.log('[DEBUG API] Campanhas:', campaignsJson);
      console.log('[DEBUG API] Analytics:', analyticsJson);
      console.log('[DEBUG API] Template Analytics:', templateAnalyticsJson);

      // Parse flexível — aceita {success,data}, array direto ou objeto direto
      const campaignsData = campaignsJson.data || (Array.isArray(campaignsJson) ? campaignsJson : []);
      setCampaigns(campaignsData);

      const analyticsData = analyticsJson.data || (analyticsJson.analytics || analyticsJson.pricing || analyticsJson.summary ? analyticsJson : null);
      setAnalytics(analyticsData);

      const tplRaw = templateAnalyticsJson.data || templateAnalyticsJson;
      const tplTemplates = tplRaw?.templates || (Array.isArray(tplRaw) ? tplRaw : []);
      setTemplateAnalytics(tplTemplates);
    } catch (err) {
      console.error('[DEBUG API] Erro no fetchData:', err);
      console.error('[DEBUG API] URL base:', API_BASE);
      console.error('[DEBUG API] Conta selecionada:', selectedAccount);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Métricas globais
  const totals = campaigns.reduce((acc, c) => {
    acc.total += c.total;
    acc.sent += c.sent;
    acc.delivered += c.delivered;
    acc.read += c.read;
    acc.replied += c.replied;
    acc.failed += c.failed;
    return acc;
  }, { total: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 });

  // Quando não há campanhas no DB, usar dados da Meta API (analytics.summary)
  const metaSent = analytics?.summary?.sent || analytics?.analytics?.sent || 0;
  const metaDelivered = analytics?.summary?.delivered || analytics?.analytics?.delivered || 0;
  const metaVolume = analytics?.summary?.totalVolume || 0;

  const effectiveSent = totals.sent || metaSent;
  const effectiveDelivered = totals.delivered || metaDelivered;
  const effectiveRead = totals.read || 0;
  const effectiveTotal = totals.total || metaVolume || effectiveSent;

  const deliveryRate = effectiveSent > 0 ? ((effectiveDelivered / effectiveSent) * 100).toFixed(1) : 0;
  const readRate = effectiveDelivered > 0 ? ((effectiveRead / effectiveDelivered) * 100).toFixed(1) : 0;
  const totalCostUSD = analytics?.summary?.totalCost || 0;
  const totalCost = totalCostUSD * COTACAO_DOLAR;

  const sorted = [...campaigns].sort((a, b) => {
    let va = a[sortKey];
    let vb = b[sortKey];
    if (sortKey === 'scheduledAt') {
      va = new Date(va).getTime();
      vb = new Date(vb).getTime();
    }
    if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  // Custo médio por mensagem por categoria (vindo do pricing analytics)
  const costPerMsg = {};
  if (analytics?.pricing?.dataPoints) {
    const byCategory = {};
    for (const p of analytics.pricing.dataPoints) {
      const cat = String(p.pricing_category || '').toLowerCase();
      if (!byCategory[cat]) byCategory[cat] = { cost: 0, volume: 0 };
      byCategory[cat].cost += Number(p.cost || 0);
      byCategory[cat].volume += Number(p.volume || 0);
    }
    for (const [cat, vals] of Object.entries(byCategory)) {
      costPerMsg[cat] = vals.volume > 0 ? vals.cost / vals.volume : 0;
    }
  }

  // Enriquecer templateAnalytics com taxa de leitura vinda das campanhas
  const readByCampaignTemplate = campaigns.reduce((acc, c) => {
    const key = c.templateName || '';
    if (!acc[key]) acc[key] = { delivered: 0, read: 0 };
    acc[key].delivered += c.delivered;
    acc[key].read += c.read;
    return acc;
  }, {});

  // Montar dados da tabela de templates a partir do message_queue (via backend)
  // O backend já retorna sent/delivered/read quando há dados; caso contrário retorna por categoria
  const templateTableData = templateAnalytics
    .filter(t => (t.sent || t.volume || 0) > 0)
    .map(t => {
      const name = t.templateName || t.category || '—';
      const cat = (t.category || 'MARKETING').toUpperCase();
      const sent = Number(t.sent || t.volume || 0);
      const delivered = Number(t.delivered || 0);
      const read = Number(t.read || 0);
      // Custo: vindo do backend (real_cost > estimated_cost > proporcional Meta)
      // Se ainda 0, estimar pelo custo médio da categoria do Meta pricing
      let custo = Number(t.cost || 0);
      if (!custo && sent > 0) {
        const catKey = Object.keys(costPerMsg).find(k => cat.toLowerCase().includes(k)) || '';
        custo = (costPerMsg[catKey] || 0) * sent;
      }
      // Taxa de leitura: prioriza os campos do backend, cai para dados de campanha
      let taxaLeitura = 0;
      if (delivered > 0 && read > 0) {
        taxaLeitura = (read / delivered) * 100;
      } else {
        const campaignRead = readByCampaignTemplate[name];
        if (campaignRead && campaignRead.delivered > 0) {
          taxaLeitura = (campaignRead.read / campaignRead.delivered) * 100;
        }
      }
      return { templateName: name, category: cat, sent, delivered, read, cost: custo * COTACAO_DOLAR, costUSD: custo, taxaLeitura };
    })
    .sort((a, b) => b.sent - a.sent);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const exportCSV = () => {
    const headers = ['Campanha', 'Template', 'Categoria', 'Data', 'Total', 'Enviadas', 'Entregues', 'Lidas', 'Respondidas', 'Falharam', 'Taxa Entrega', 'Taxa Leitura'];
    const rows = sorted.map(c => [
      c.campaignName,
      c.templateName,
      c.templateCategory,
      new Date(c.scheduledAt).toLocaleDateString('pt-BR'),
      c.total,
      c.sent,
      c.delivered,
      c.read,
      c.replied,
      c.failed,
      c.sent > 0 ? ((c.delivered / c.sent) * 100).toFixed(1) + '%' : '0%',
      c.delivered > 0 ? ((c.read / c.delivered) * 100).toFixed(1) + '%' : '0%',
    ]);

    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_campanhas_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card className="shadow-md rounded-xl bg-white">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            {/* Seletor de conta: só mostra se não veio activeAccount do pai */}
            {!activeAccount && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Conta</label>
                <div className="relative">
                  <select
                    value={selectedAccount?.id || ''}
                    onChange={(e) => setSelectedAccount(accounts.find(a => String(a.id) === e.target.value))}
                    className="appearance-none bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-4 py-2 pr-8 text-sm font-medium text-[#000638] focus:ring-2 focus:ring-[#000638]/30 outline-none"
                  >
                    {accounts?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <CaretDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Data Início</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm text-[#000638] focus:ring-2 focus:ring-[#000638]/30 outline-none"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Data Fim</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm text-[#000638] focus:ring-2 focus:ring-[#000638]/30 outline-none"
              />
            </div>

            <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-all disabled:opacity-50">
              <ArrowClockwise size={16} weight="bold" />
              Atualizar
            </button>

            <button onClick={exportCSV} disabled={campaigns.length === 0} className="flex items-center gap-2 px-4 py-2 bg-[#000638] text-white rounded-lg text-sm font-semibold hover:bg-[#000638]/90 transition-all ml-auto disabled:opacity-50">
              <Export size={16} weight="bold" />
              Exportar CSV
            </button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      ) : (
        <>
          {/* KPI Cards - 4 Indicadores Principais */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="shadow-md rounded-xl bg-white border-l-4 border-blue-500">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Total de Mensagens</p>
                    <p className="text-2xl font-bold text-[#000638]">{effectiveTotal.toLocaleString('pt-BR')}</p>
                    <p className="text-xs text-gray-400 mt-1">{campaigns.length > 0 ? `${campaigns.length} campanha${campaigns.length !== 1 ? 's' : ''}` : 'Via Meta API'}</p>
                  </div>
                  <div className="bg-blue-500 p-3 rounded-xl">
                    <ChatTeardropText size={24} weight="bold" className="text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-md rounded-xl bg-white border-l-4 border-emerald-500">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Taxa de Entrega</p>
                    <p className="text-2xl font-bold text-[#000638]">{deliveryRate}%</p>
                    <p className="text-xs text-gray-400 mt-1">{effectiveDelivered.toLocaleString('pt-BR')} de {effectiveSent.toLocaleString('pt-BR')}</p>
                  </div>
                  <div className="bg-emerald-500 p-3 rounded-xl">
                    <CheckCircle size={24} weight="bold" className="text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-md rounded-xl bg-white border-l-4 border-indigo-500">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Taxa de Leitura</p>
                    <p className="text-2xl font-bold text-[#000638]">{readRate}%</p>
                    <p className="text-xs text-gray-400 mt-1">{effectiveRead.toLocaleString('pt-BR')} de {effectiveDelivered.toLocaleString('pt-BR')}</p>
                  </div>
                  <div className="bg-indigo-500 p-3 rounded-xl">
                    <EyeIcon size={24} weight="bold" className="text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-md rounded-xl bg-white border-l-4 border-emerald-600">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Custo Total</p>
                    <p className="text-2xl font-bold text-[#000638]">{formatCurrency(totalCost)}</p>
                    <p className="text-xs text-gray-400 mt-1">{formatCurrency(totalCostUSD, 'USD')} · Câmbio R$ {COTACAO_DOLAR.toFixed(2)}</p>
                  </div>
                  <div className="bg-emerald-600 p-3 rounded-xl">
                    <CurrencyDollar size={24} weight="bold" className="text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela resumo por Template - padrão Meta Insights */}
          <Card className="shadow-md rounded-xl bg-white overflow-hidden">
            <CardHeader className="pb-0">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base font-bold text-[#000638] flex items-center gap-2">
                  <CurrencyDollar size={20} weight="bold" />
                  Resumo por Template
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {templateTableData.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[#f8f9fb] border-b">
                      <tr>
                        <th className="text-left p-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Template</th>
                        <th className="text-left p-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Categoria</th>
                        <th className="text-right p-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Msgs Enviadas</th>
                        <th className="text-right p-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Taxa de Leitura</th>
                        <th className="text-right p-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Custo (USD)</th>
                        <th className="text-right p-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Custo (R$)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {templateTableData.map((t, i) => {
                        const catLower = t.category.toLowerCase();
                        const catBadge = catLower.includes('marketing') ? 'bg-orange-100 text-orange-700' :
                          catLower.includes('utility') ? 'bg-blue-100 text-blue-700' :
                          catLower.includes('auth') ? 'bg-purple-100 text-purple-700' :
                          catLower.includes('service') ? 'bg-indigo-100 text-indigo-700' :
                          'bg-gray-100 text-gray-600';

                        let readBadge = 'bg-gray-100 text-gray-500';
                        if (t.taxaLeitura >= 50) readBadge = 'bg-emerald-100 text-emerald-700';
                        else if (t.taxaLeitura >= 30) readBadge = 'bg-amber-100 text-amber-700';
                        else if (t.taxaLeitura > 0) readBadge = 'bg-red-100 text-red-700';

                        return (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                            <td className="p-3 font-semibold text-[#000638] max-w-[220px] truncate">{t.templateName}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${catBadge}`}>
                                {categoryLabel(t.category)}
                              </span>
                            </td>
                            <td className="p-3 font-semibold text-right">{t.sent.toLocaleString('pt-BR')}</td>
                            <td className="p-3 text-right">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${readBadge}`}>
                                {t.taxaLeitura > 0 ? `${t.taxaLeitura.toFixed(1)}%` : '—'}
                              </span>
                            </td>
                            <td className="p-3 font-medium text-gray-600 text-right">{formatCurrency(t.costUSD, 'USD')}</td>
                            <td className="p-3 font-bold text-emerald-700 text-right">{formatCurrency(t.cost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-[#f8f9fb] border-t-2 border-[#000638]/10">
                      <tr className="font-bold text-[#000638]">
                        <td className="p-3">TOTAL</td>
                        <td className="p-3"></td>
                        <td className="p-3 text-right">{templateTableData.reduce((s, t) => s + t.sent, 0).toLocaleString('pt-BR')}</td>
                        <td className="p-3"></td>
                        <td className="p-3 text-gray-600 text-right">{formatCurrency(templateTableData.reduce((s, t) => s + t.costUSD, 0), 'USD')}</td>
                        <td className="p-3 text-emerald-700 text-right">{formatCurrency(templateTableData.reduce((s, t) => s + t.cost, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8">
                  <ChartBar size={36} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 font-medium">Nenhum dado de template para o período selecionado</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tabela de campanhas */}
          {campaigns.length > 0 ? (
            <Card className="shadow-md rounded-xl bg-white overflow-hidden">
              <CardHeader className="pb-0">
                <CardTitle className="text-base font-bold text-[#000638] flex items-center gap-2">
                  <TrendUp size={20} weight="bold" />
                  Performance por Campanha
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[#f8f9fb] border-b">
                      <tr>
                        {[
                          { key: 'campaignName', label: 'Campanha' },
                          { key: 'templateName', label: 'Template' },
                          { key: 'scheduledAt', label: 'Data' },
                          { key: 'total', label: 'Total' },
                          { key: 'sent', label: 'Enviadas' },
                          { key: 'delivered', label: 'Entregues' },
                          { key: 'read', label: 'Lidas' },
                          { key: 'replied', label: 'Respondidas' },
                          { key: 'failed', label: 'Falharam' },
                        ].map(col => (
                          <th
                            key={col.key}
                            onClick={() => toggleSort(col.key)}
                            className="text-left p-3 font-semibold text-gray-500 cursor-pointer hover:text-[#000638] transition-colors text-xs uppercase tracking-wide select-none"
                          >
                            {col.label} {sortKey === col.key && (sortDir === 'asc' ? '↑' : '↓')}
                          </th>
                        ))}
                        <th className="text-left p-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Entrega</th>
                        <th className="text-left p-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Leitura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(c => {
                        const dr = c.sent > 0 ? ((c.delivered / c.sent) * 100).toFixed(1) : 0;
                        const rr = c.delivered > 0 ? ((c.read / c.delivered) * 100).toFixed(1) : 0;
                        return (
                          <tr key={c.campaignId} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                            <td className="p-3 font-semibold text-[#000638] max-w-[180px] truncate">{c.campaignName}</td>
                            <td className="p-3 text-gray-600">{c.templateName}</td>
                            <td className="p-3 text-gray-500 text-xs">{new Date(c.scheduledAt).toLocaleDateString('pt-BR')}</td>
                            <td className="p-3 font-semibold">{c.total}</td>
                            <td className="p-3">{c.sent}</td>
                            <td className="p-3">{c.delivered}</td>
                            <td className="p-3">{c.read}</td>
                            <td className="p-3">{c.replied}</td>
                            <td className="p-3 text-red-600 font-semibold">{c.failed}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${Number(dr) >= 90 ? 'bg-emerald-100 text-emerald-700' : Number(dr) >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                {dr}%
                              </span>
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${Number(rr) >= 50 ? 'bg-emerald-100 text-emerald-700' : Number(rr) >= 30 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                {rr}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-[#f8f9fb] border-t-2 border-[#000638]/10">
                      <tr className="font-bold text-[#000638]">
                        <td className="p-3">TOTAL</td>
                        <td className="p-3"></td>
                        <td className="p-3"></td>
                        <td className="p-3">{totals.total.toLocaleString('pt-BR')}</td>
                        <td className="p-3">{totals.sent.toLocaleString('pt-BR')}</td>
                        <td className="p-3">{totals.delivered.toLocaleString('pt-BR')}</td>
                        <td className="p-3">{totals.read.toLocaleString('pt-BR')}</td>
                        <td className="p-3">{totals.replied.toLocaleString('pt-BR')}</td>
                        <td className="p-3 text-red-600">{totals.failed.toLocaleString('pt-BR')}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#000638] text-white">{deliveryRate}%</span>
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#000638] text-white">{readRate}%</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-16">
              <ChartBar size={48} className="text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-400 font-medium">Nenhum dado de campanha para exibir</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default WhatsAppReports;
