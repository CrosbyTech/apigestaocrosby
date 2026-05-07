import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/cards';
import LoadingSpinner from '../ui/LoadingSpinner';
import {
  Rocket,
  Plus,
  UploadSimple,
  Users,
  PaperPlaneRight,
  Eye,
  XCircle,
  CheckCircle,
  Clock,
  CaretDown,
  FileText,
  Trash,
  ArrowClockwise,
  Warning,
} from '@phosphor-icons/react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const STATUS_COLORS = {
  active: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-blue-100 text-blue-700',
  paused: 'bg-amber-100 text-amber-700',
  canceled: 'bg-gray-100 text-gray-500',
};

const WhatsAppCampaigns = ({ accounts }) => {
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [campaignDetail, setCampaignDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({
    campaignName: '',
    templateName: '',
    templateCategory: 'MARKETING',
    templateLanguage: 'pt_BR',
    contacts: [],
    scheduledAt: '',
    dailyTierLimit: 1000,
  });

  const [csvPreview, setCsvPreview] = useState([]);

  useEffect(() => {
    if (accounts?.length && !selectedAccount) {
      setSelectedAccount(accounts[0]);
    }
  }, [accounts, selectedAccount]);

  const fetchCampaigns = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/meta/campaigns?accountId=${selectedAccount.id}`);
      const json = await res.json();
      if (json.success) setCampaigns(json.data || []);
    } catch (err) {
      console.error('Erro ao buscar campanhas:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount]);

  const fetchTemplates = useCallback(async () => {
    if (!selectedAccount) return;
    try {
      const res = await fetch(`${API_BASE}/api/meta/templates/${selectedAccount.id}?status=APPROVED`);
      const json = await res.json();
      if (json.success) setTemplates(json.data || []);
    } catch (err) {
      console.error('Erro ao buscar templates:', err);
    }
  }, [selectedAccount]);

  useEffect(() => {
    fetchCampaigns();
    fetchTemplates();
  }, [fetchCampaigns, fetchTemplates]);

  const handleCSVUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) return;

      const headers = lines[0].split(/[;,]/).map(h => h.trim().toLowerCase());
      const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('telefone') || h.includes('celular') || h.includes('whatsapp'));
      const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('nome'));

      if (phoneIdx === -1) {
        alert('CSV deve conter coluna "telefone", "phone", "celular" ou "whatsapp"');
        return;
      }

      const contacts = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(/[;,]/).map(c => c.trim());
        const phone = cols[phoneIdx]?.replace(/\D/g, '');
        if (phone && phone.length >= 10) {
          contacts.push({
            phone,
            name: nameIdx >= 0 ? cols[nameIdx] : '',
          });
        }
      }

      setForm(prev => ({ ...prev, contacts }));
      setCsvPreview(contacts.slice(0, 5));
    };
    reader.readAsText(file);
  };

  const handleCreate = async () => {
    if (!selectedAccount || !form.templateName || !form.contacts.length) return;
    setCreating(true);
    try {
      const payload = {
        accountId: selectedAccount.id,
        campaignName: form.campaignName || `Campanha ${new Date().toLocaleDateString('pt-BR')}`,
        templateName: form.templateName,
        templateLanguage: form.templateLanguage,
        templateCategory: form.templateCategory,
        contacts: form.contacts,
        scheduledAt: form.scheduledAt || undefined,
        dailyTierLimit: form.dailyTierLimit,
      };

      const res = await fetch(`${API_BASE}/api/meta/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (json.success) {
        setShowForm(false);
        setForm({ campaignName: '', templateName: '', templateCategory: 'MARKETING', templateLanguage: 'pt_BR', contacts: [], scheduledAt: '', dailyTierLimit: 1000 });
        setCsvPreview([]);
        fetchCampaigns();
      } else {
        alert(`Erro: ${json.message}`);
      }
    } catch (err) {
      alert(`Erro ao criar campanha: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = async (campaignId) => {
    if (!confirm('Cancelar mensagens pendentes desta campanha?')) return;
    try {
      await fetch(`${API_BASE}/api/meta/campaigns/${campaignId}/cancel`, { method: 'POST' });
      fetchCampaigns();
    } catch (err) {
      alert(`Erro: ${err.message}`);
    }
  };

  const loadDetail = async (campaignId) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/meta/campaigns/${campaignId}`);
      const json = await res.json();
      if (json.success) setCampaignDetail(json.data);
    } catch (err) {
      console.error(err);
    } finally {
      setDetailLoading(false);
    }
  };

  const getCampaignStatus = (c) => {
    if (c.canceled > 0 && c.pending === 0 && c.sent === 0) return 'canceled';
    if (c.pending > 0) return 'active';
    return 'completed';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="shadow-md rounded-xl bg-white">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
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

            <button onClick={fetchCampaigns} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-all disabled:opacity-50">
              <ArrowClockwise size={16} weight="bold" />
              Atualizar
            </button>

            <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-[#000638] text-white rounded-lg text-sm font-semibold hover:bg-[#000638]/90 transition-all ml-auto">
              <Plus size={16} weight="bold" />
              Nova Campanha
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Formulário de campanha */}
      {showForm && (
        <Card className="shadow-lg rounded-xl bg-white border-2 border-[#000638]/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-[#000638] flex items-center gap-2">
              <Rocket size={20} weight="bold" />
              Nova Campanha
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Nome da Campanha</label>
                <input
                  value={form.campaignName}
                  onChange={e => setForm(prev => ({ ...prev, campaignName: e.target.value }))}
                  placeholder="Ex: Promoção Janeiro 2026"
                  className="w-full bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Template Aprovado *</label>
                <select
                  value={form.templateName}
                  onChange={e => {
                    const t = templates.find(t => t.name === e.target.value);
                    setForm(prev => ({
                      ...prev,
                      templateName: e.target.value,
                      templateCategory: t?.category || 'MARKETING',
                      templateLanguage: t?.language || 'pt_BR',
                    }));
                  }}
                  className="w-full bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                >
                  <option value="">Selecione...</option>
                  {templates.map(t => (
                    <option key={t.name} value={t.name}>{t.name} ({t.category})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Agendamento (opcional)</label>
                <input
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={e => setForm(prev => ({ ...prev, scheduledAt: e.target.value }))}
                  className="w-full bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Limite Diário (tier)</label>
                <input
                  type="number"
                  value={form.dailyTierLimit}
                  onChange={e => setForm(prev => ({ ...prev, dailyTierLimit: Number(e.target.value) }))}
                  className="w-full bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                />
              </div>
            </div>

            {/* Upload CSV */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">Contatos *</label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[#000638]/20 rounded-xl p-6 text-center cursor-pointer hover:border-[#000638]/40 transition-colors"
              >
                <UploadSimple size={32} className="text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500 font-medium">
                  {form.contacts.length > 0
                    ? `${form.contacts.length} contatos carregados`
                    : 'Clique para enviar CSV'}
                </p>
                <p className="text-xs text-gray-400 mt-1">CSV com colunas: telefone, nome (opcional)</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleCSVUpload}
                className="hidden"
              />
            </div>

            {/* Preview dos contatos */}
            {csvPreview.length > 0 && (
              <div className="bg-[#f8f9fb] rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-500 mb-2">Preview (primeiros 5 de {form.contacts.length})</p>
                <div className="space-y-1">
                  {csvPreview.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs text-gray-700">
                      <span className="font-mono bg-white px-2 py-0.5 rounded">{c.phone}</span>
                      <span>{c.name || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCreate}
                disabled={creating || !form.templateName || !form.contacts.length}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#000638] text-white rounded-lg text-sm font-semibold hover:bg-[#000638]/90 transition-all disabled:opacity-50"
              >
                <PaperPlaneRight size={16} weight="bold" />
                {creating ? 'Enfileirando...' : `Disparar para ${form.contacts.length} contatos`}
              </button>
              <button onClick={() => { setShowForm(false); setCsvPreview([]); }} className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-all">
                Cancelar
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de campanhas */}
      {loading ? (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-16">
          <Rocket size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400 font-medium">Nenhuma campanha encontrada</p>
          <p className="text-xs text-gray-300 mt-1">Crie sua primeira campanha clicando no botão acima</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => {
            const status = getCampaignStatus(c);
            const successRate = c.total > 0 ? (((c.delivered + c.read + c.replied) / c.total) * 100).toFixed(1) : 0;
            const isExpanded = campaignDetail?.campaignId === c.campaignId;

            return (
              <Card key={c.campaignId} className="shadow-md rounded-xl bg-white hover:shadow-lg transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-[#000638]">{c.campaignName}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {c.templateName} · {new Date(c.scheduledAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[status]}`}>
                      {status === 'active' ? 'Em andamento' : status === 'completed' ? 'Concluída' : status === 'paused' ? 'Pausada' : 'Cancelada'}
                    </span>
                  </div>

                  {/* Progress bars */}
                  <div className="grid grid-cols-5 gap-2 mb-3">
                    {[
                      { label: 'Enviadas', value: c.sent, color: 'bg-blue-500' },
                      { label: 'Entregues', value: c.delivered, color: 'bg-emerald-500' },
                      { label: 'Lidas', value: c.read, color: 'bg-indigo-500' },
                      { label: 'Respondidas', value: c.replied, color: 'bg-purple-500' },
                      { label: 'Falharam', value: c.failed, color: 'bg-red-500' },
                    ].map(item => (
                      <div key={item.label} className="text-center">
                        <p className="text-lg font-bold text-[#000638]">{item.value}</p>
                        <p className="text-xs text-gray-400">{item.label}</p>
                        <div className="w-full bg-gray-100 rounded-full h-1 mt-1">
                          <div className={`h-1 rounded-full ${item.color}`} style={{ width: `${c.total > 0 ? (item.value / c.total) * 100 : 0}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><Users size={14} /> {c.total} contatos</span>
                      <span className="flex items-center gap-1"><CheckCircle size={14} className="text-emerald-500" /> {successRate}% sucesso</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => isExpanded ? setCampaignDetail(null) : loadDetail(c.campaignId)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-all"
                      >
                        <Eye size={14} /> {isExpanded ? 'Fechar' : 'Detalhes'}
                      </button>
                      {status === 'active' && (
                        <button
                          onClick={() => handleCancel(c.campaignId)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100 transition-all"
                        >
                          <XCircle size={14} /> Cancelar
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Detalhe expandido */}
                  {isExpanded && campaignDetail && (
                    <div className="mt-4 pt-4 border-t">
                      {detailLoading ? (
                        <div className="flex justify-center py-4"><LoadingSpinner /></div>
                      ) : (
                        <div className="max-h-64 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-[#f8f9fb] sticky top-0">
                              <tr>
                                <th className="text-left p-2 font-semibold text-gray-500">Telefone</th>
                                <th className="text-left p-2 font-semibold text-gray-500">Nome</th>
                                <th className="text-left p-2 font-semibold text-gray-500">Status</th>
                                <th className="text-left p-2 font-semibold text-gray-500">Enviado em</th>
                                <th className="text-left p-2 font-semibold text-gray-500">Erro</th>
                              </tr>
                            </thead>
                            <tbody>
                              {campaignDetail.messages?.slice(0, 100).map(m => (
                                <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                                  <td className="p-2 font-mono">{m.phone_number}</td>
                                  <td className="p-2">{m.contact_name || '—'}</td>
                                  <td className="p-2">
                                    <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                                      m.status === 'sent' || m.status === 'delivered' || m.status === 'read' || m.status === 'replied'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : m.status === 'failed' ? 'bg-red-100 text-red-700'
                                        : m.status === 'canceled' ? 'bg-gray-100 text-gray-500'
                                        : 'bg-amber-100 text-amber-700'
                                    }`}>{m.status}</span>
                                  </td>
                                  <td className="p-2 text-gray-400">{m.sent_at ? new Date(m.sent_at).toLocaleString('pt-BR') : '—'}</td>
                                  <td className="p-2 text-red-500 truncate max-w-[150px]">{m.last_error || ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {campaignDetail.messages?.length > 100 && (
                            <p className="text-xs text-gray-400 text-center py-2">Exibindo 100 de {campaignDetail.messages.length} mensagens</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WhatsAppCampaigns;
