import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/cards';
import LoadingSpinner from '../ui/LoadingSpinner';
import {
  FileText,
  Plus,
  Trash,
  MagnifyingGlass,
  CheckCircle,
  Clock,
  XCircle,
  Warning,
  Eye,
  CaretDown,
  Copy,
  PaperPlaneRight,
} from '@phosphor-icons/react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const STATUS_MAP = {
  APPROVED: { label: 'Aprovado', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  PENDING: { label: 'Pendente', color: 'bg-amber-100 text-amber-700', icon: Clock },
  REJECTED: { label: 'Rejeitado', color: 'bg-red-100 text-red-700', icon: XCircle },
  DISABLED: { label: 'Desativado', color: 'bg-gray-100 text-gray-500', icon: Warning },
};

const CATEGORY_COLORS = {
  MARKETING: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  UTILITY: 'bg-blue-50 text-blue-700 border-blue-200',
  AUTHENTICATION: 'bg-amber-50 text-amber-700 border-amber-200',
};

const WhatsAppTemplates = ({ accounts }) => {
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [form, setForm] = useState({
    name: '',
    category: 'MARKETING',
    language: 'pt_BR',
    headerType: '',
    headerText: '',
    body: '',
    footerText: '',
    buttons: [],
  });

  useEffect(() => {
    if (accounts?.length && !selectedAccount) {
      setSelectedAccount(accounts[0]);
    }
  }, [accounts, selectedAccount]);

  const fetchTemplates = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterCategory) params.set('category', filterCategory);

      const res = await fetch(`${API_BASE}/api/meta/templates/${selectedAccount.id}?${params.toString()}`);
      const json = await res.json();
      if (json.success) setTemplates(json.data || []);
    } catch (err) {
      console.error('Erro ao buscar templates:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, filterStatus, filterCategory]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleCreate = async () => {
    if (!selectedAccount || !form.name || !form.body) return;
    setCreating(true);
    try {
      const components = [];

      if (form.headerType === 'TEXT' && form.headerText) {
        components.push({ type: 'HEADER', format: 'TEXT', text: form.headerText });
      } else if (form.headerType && form.headerType !== 'TEXT') {
        components.push({ type: 'HEADER', format: form.headerType });
      }

      components.push({ type: 'BODY', text: form.body });

      if (form.footerText) {
        components.push({ type: 'FOOTER', text: form.footerText });
      }

      if (form.buttons.length > 0) {
        components.push({
          type: 'BUTTONS',
          buttons: form.buttons.map(b => {
            if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.value };
            if (b.type === 'URL') return { type: 'URL', text: b.text, url: b.value };
            return { type: 'QUICK_REPLY', text: b.text };
          }),
        });
      }

      const payload = {
        name: form.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        category: form.category,
        language: form.language,
        components,
      };

      const res = await fetch(`${API_BASE}/api/meta/templates/${selectedAccount.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (json.success) {
        setShowForm(false);
        setForm({ name: '', category: 'MARKETING', language: 'pt_BR', headerType: '', headerText: '', body: '', footerText: '', buttons: [] });
        fetchTemplates();
      } else {
        alert(`Erro: ${json.message}`);
      }
    } catch (err) {
      alert(`Erro ao criar template: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (templateName) => {
    if (!selectedAccount || !confirm(`Excluir template "${templateName}"?`)) return;
    try {
      await fetch(`${API_BASE}/api/meta/templates/${selectedAccount.id}/${templateName}`, { method: 'DELETE' });
      fetchTemplates();
    } catch (err) {
      alert(`Erro ao excluir: ${err.message}`);
    }
  };

  const addButton = () => {
    if (form.buttons.length >= 3) return;
    setForm(prev => ({ ...prev, buttons: [...prev.buttons, { type: 'QUICK_REPLY', text: '', value: '' }] }));
  };

  const updateButton = (index, field, value) => {
    setForm(prev => {
      const buttons = [...prev.buttons];
      buttons[index] = { ...buttons[index], [field]: value };
      return { ...prev, buttons };
    });
  };

  const removeButton = (index) => {
    setForm(prev => ({ ...prev, buttons: prev.buttons.filter((_, i) => i !== index) }));
  };

  const filtered = templates.filter(t => {
    if (search && !t.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const extractBodyText = (t) => {
    const body = t.components?.find(c => c.type === 'BODY');
    return body?.text || '';
  };

  return (
    <div className="space-y-6">
      {/* Barra de ações */}
      <Card className="shadow-md rounded-xl bg-white">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            {/* Conta */}
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

            {/* Busca */}
            <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Buscar</label>
              <div className="relative">
                <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Nome do template..."
                  className="w-full bg-[#f8f9fb] border border-[#000638]/20 rounded-lg pl-9 pr-4 py-2 text-sm text-[#000638] focus:ring-2 focus:ring-[#000638]/30 outline-none"
                />
              </div>
            </div>

            {/* Filtro Status */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</label>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="appearance-none bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-4 py-2 text-sm font-medium text-[#000638] focus:ring-2 focus:ring-[#000638]/30 outline-none"
              >
                <option value="">Todos</option>
                <option value="APPROVED">Aprovados</option>
                <option value="PENDING">Pendentes</option>
                <option value="REJECTED">Rejeitados</option>
              </select>
            </div>

            {/* Filtro Categoria */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Categoria</label>
              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                className="appearance-none bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-4 py-2 text-sm font-medium text-[#000638] focus:ring-2 focus:ring-[#000638]/30 outline-none"
              >
                <option value="">Todas</option>
                <option value="MARKETING">Marketing</option>
                <option value="UTILITY">Utilidade</option>
                <option value="AUTHENTICATION">Autenticação</option>
              </select>
            </div>

            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-4 py-2 bg-[#000638] text-white rounded-lg text-sm font-semibold hover:bg-[#000638]/90 transition-all ml-auto"
            >
              <Plus size={16} weight="bold" />
              Novo Template
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Formulário de criação */}
      {showForm && (
        <Card className="shadow-lg rounded-xl bg-white border-2 border-[#000638]/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-[#000638]">Criar Template</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Nome *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="meu_template"
                  className="w-full bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Categoria *</label>
                <select
                  value={form.category}
                  onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                >
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utilidade</option>
                  <option value="AUTHENTICATION">Autenticação</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Idioma</label>
                <select
                  value={form.language}
                  onChange={e => setForm(prev => ({ ...prev, language: e.target.value }))}
                  className="w-full bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                >
                  <option value="pt_BR">Português (BR)</option>
                  <option value="en_US">English (US)</option>
                  <option value="es">Español</option>
                </select>
              </div>
            </div>

            {/* Header */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Cabeçalho (opcional)</label>
              <div className="flex gap-2">
                <select
                  value={form.headerType}
                  onChange={e => setForm(prev => ({ ...prev, headerType: e.target.value }))}
                  className="bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                >
                  <option value="">Nenhum</option>
                  <option value="TEXT">Texto</option>
                  <option value="IMAGE">Imagem</option>
                  <option value="VIDEO">Vídeo</option>
                  <option value="DOCUMENT">Documento</option>
                </select>
                {form.headerType === 'TEXT' && (
                  <input
                    value={form.headerText}
                    onChange={e => setForm(prev => ({ ...prev, headerText: e.target.value }))}
                    placeholder="Texto do cabeçalho"
                    className="flex-1 bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                  />
                )}
              </div>
            </div>

            {/* Body */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Corpo da mensagem *</label>
              <textarea
                value={form.body}
                onChange={e => setForm(prev => ({ ...prev, body: e.target.value }))}
                rows={4}
                placeholder="Olá {{1}}, temos uma oferta especial para você! Use o código {{2}} e ganhe desconto."
                className="w-full bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">Use {'{{1}}'}, {'{{2}}'}, etc. para variáveis dinâmicas</p>
            </div>

            {/* Footer */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Rodapé (opcional)</label>
              <input
                value={form.footerText}
                onChange={e => setForm(prev => ({ ...prev, footerText: e.target.value }))}
                placeholder="Responda SAIR para não receber mais mensagens"
                className="w-full bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
              />
            </div>

            {/* Buttons */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-500">Botões (máx. 3)</label>
                {form.buttons.length < 3 && (
                  <button onClick={addButton} className="text-xs text-[#000638] font-semibold hover:underline flex items-center gap-1">
                    <Plus size={12} weight="bold" /> Adicionar
                  </button>
                )}
              </div>
              {form.buttons.map((btn, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <select
                    value={btn.type}
                    onChange={e => updateButton(i, 'type', e.target.value)}
                    className="bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                  >
                    <option value="QUICK_REPLY">Resposta Rápida</option>
                    <option value="URL">URL</option>
                    <option value="PHONE_NUMBER">Telefone</option>
                  </select>
                  <input
                    value={btn.text}
                    onChange={e => updateButton(i, 'text', e.target.value)}
                    placeholder="Texto do botão"
                    className="flex-1 bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                  />
                  {btn.type !== 'QUICK_REPLY' && (
                    <input
                      value={btn.value || ''}
                      onChange={e => updateButton(i, 'value', e.target.value)}
                      placeholder={btn.type === 'URL' ? 'https://...' : '+55...'}
                      className="flex-1 bg-[#f8f9fb] border border-[#000638]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#000638]/30 outline-none"
                    />
                  )}
                  <button onClick={() => removeButton(i)} className="text-red-500 hover:text-red-700 p-2">
                    <Trash size={16} weight="bold" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCreate}
                disabled={creating || !form.name || !form.body}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#000638] text-white rounded-lg text-sm font-semibold hover:bg-[#000638]/90 transition-all disabled:opacity-50"
              >
                <PaperPlaneRight size={16} weight="bold" />
                {creating ? 'Enviando...' : 'Enviar para Aprovação'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-all"
              >
                Cancelar
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de templates */}
      {loading ? (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(t => {
            const statusInfo = STATUS_MAP[t.status] || STATUS_MAP.PENDING;
            const StatusIcon = statusInfo.icon;
            const catColor = CATEGORY_COLORS[t.category] || CATEGORY_COLORS.MARKETING;
            const bodyText = extractBodyText(t);

            return (
              <Card key={t.id || t.name} className="shadow-md rounded-xl bg-white hover:shadow-lg transition-shadow group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-[#000638] truncate">{t.name}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">{t.language}</p>
                    </div>
                    <div className="flex gap-1.5 ml-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${statusInfo.color}`}>
                        <StatusIcon size={12} weight="bold" />
                        {statusInfo.label}
                      </span>
                    </div>
                  </div>

                  <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold border ${catColor} mb-3`}>
                    {t.category}
                  </span>

                  {bodyText && (
                    <div className="bg-[#f8f9fb] rounded-lg p-3 mb-3">
                      <p className="text-xs text-gray-600 line-clamp-3 whitespace-pre-wrap">{bodyText}</p>
                    </div>
                  )}

                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setPreviewTemplate(previewTemplate?.name === t.name ? null : t)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-all"
                    >
                      <Eye size={14} /> Preview
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(t.name)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-all"
                    >
                      <Copy size={14} /> Copiar
                    </button>
                    <button
                      onClick={() => handleDelete(t.name)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100 transition-all ml-auto"
                    >
                      <Trash size={14} /> Excluir
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {!loading && filtered.length === 0 && (
            <div className="col-span-full text-center py-16">
              <FileText size={48} className="text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-400 font-medium">Nenhum template encontrado</p>
            </div>
          )}
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setPreviewTemplate(null)}>
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b">
              <h3 className="text-base font-bold text-[#000638]">Preview: {previewTemplate.name}</h3>
            </div>
            <div className="p-5">
              {/* WhatsApp-style bubble */}
              <div className="bg-[#dcf8c6] rounded-xl p-4 shadow-sm max-w-[85%] ml-auto">
                {previewTemplate.components?.map((c, i) => {
                  if (c.type === 'HEADER' && c.format === 'TEXT') {
                    return <p key={i} className="text-sm font-bold text-gray-800 mb-1">{c.text}</p>;
                  }
                  if (c.type === 'HEADER' && c.format !== 'TEXT') {
                    return <div key={i} className="bg-gray-200 rounded-lg h-32 flex items-center justify-center mb-2 text-xs text-gray-500">[{c.format}]</div>;
                  }
                  if (c.type === 'BODY') {
                    return <p key={i} className="text-sm text-gray-800 whitespace-pre-wrap">{c.text}</p>;
                  }
                  if (c.type === 'FOOTER') {
                    return <p key={i} className="text-xs text-gray-500 mt-2">{c.text}</p>;
                  }
                  if (c.type === 'BUTTONS') {
                    return (
                      <div key={i} className="mt-3 space-y-1.5">
                        {c.buttons?.map((b, j) => (
                          <div key={j} className="bg-white/80 text-center py-2 rounded-lg text-sm text-blue-600 font-medium border border-gray-200">
                            {b.text}
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
            <div className="p-4 border-t">
              <button onClick={() => setPreviewTemplate(null)} className="w-full py-2.5 bg-[#000638] text-white rounded-lg text-sm font-semibold hover:bg-[#000638]/90 transition-all">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppTemplates;
