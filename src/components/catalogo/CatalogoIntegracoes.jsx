import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/cards';
import LoadingSpinner from '../ui/LoadingSpinner';
import {
  FloppyDisk,
  MetaLogo,
  GoogleChromeLogo,
  Link as LinkIcon,
  Gear,
  WhatsappLogo,
  Copy,
  Check,
  Info,
  ToggleLeft,
  ToggleRight,
} from '@phosphor-icons/react';

const API_BASE_URL = import.meta.env.DEV ? '' : '';

const CatalogoIntegracoes = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Config values
  const [metaPixelId, setMetaPixelId] = useState('');
  const [ga4MeasurementId, setGa4MeasurementId] = useState('');
  const [utmConfig, setUtmConfig] = useState({
    auto_capture: true,
    append_to_whatsapp: true,
    append_to_orcamento: true,
    whatsapp_number: '',
    whatsapp_message_template: 'Olá! Vi o produto {produto} no catálogo. {utm_info}',
    orcamento_message_template: 'Solicito orçamento para {produto}. {utm_info}',
  });

  // UTM Generator
  const [utmForm, setUtmForm] = useState({
    base_url: '',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_term: '',
    utm_content: '',
  });
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('catalogo_configuracoes')
        .select('*')
        .order('chave');

      if (!error && data) {
        for (const row of data) {
          if (row.chave === 'meta_pixel_id') setMetaPixelId(row.valor || '');
          else if (row.chave === 'ga4_measurement_id') setGa4MeasurementId(row.valor || '');
          else if (row.chave === 'utm_config' && typeof row.valor === 'object') {
            setUtmConfig(prev => ({ ...prev, ...row.valor }));
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar configurações:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = [
        { chave: 'meta_pixel_id', valor: metaPixelId, updated_at: new Date().toISOString() },
        { chave: 'ga4_measurement_id', valor: ga4MeasurementId, updated_at: new Date().toISOString() },
        { chave: 'utm_config', valor: utmConfig, updated_at: new Date().toISOString() },
      ];

      for (const item of updates) {
        await supabase
          .from('catalogo_configuracoes')
          .upsert(item, { onConflict: 'chave' });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert('Erro ao salvar: ' + err.message);
    }
    setSaving(false);
  };

  const generateUtmUrl = () => {
    if (!utmForm.base_url) return;

    const params = new URLSearchParams();
    if (utmForm.utm_source) params.set('utm_source', utmForm.utm_source);
    if (utmForm.utm_medium) params.set('utm_medium', utmForm.utm_medium);
    if (utmForm.utm_campaign) params.set('utm_campaign', utmForm.utm_campaign);
    if (utmForm.utm_term) params.set('utm_term', utmForm.utm_term);
    if (utmForm.utm_content) params.set('utm_content', utmForm.utm_content);

    const separator = utmForm.base_url.includes('?') ? '&' : '?';
    setGeneratedUrl(`${utmForm.base_url}${separator}${params.toString()}`);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="md" text="Carregando configurações..." />
      </div>
    );
  }

  const inputClass = 'border border-[#000638]/30 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs';
  const labelClass = 'block text-xs font-semibold mb-1 text-[#000638]';

  return (
    <div className="space-y-6">
      {/* ===== META PIXEL ===== */}
      <Card className="shadow-lg rounded-xl bg-white">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <MetaLogo size={20} weight="bold" className="text-blue-600" />
            <CardTitle className="text-sm font-bold text-[#000638]">Meta Pixel (Facebook)</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <div className="flex items-start gap-3 mb-3 p-3 bg-blue-50 rounded-lg">
            <Info size={16} className="text-blue-600 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-800">
              O Meta Pixel permite rastrear conversões, otimizar anúncios e criar públicos personalizados.
              Insira o ID do Pixel encontrado no Gerenciador de Eventos do Facebook/Meta.
            </p>
          </div>
          <div className="max-w-md">
            <label className={labelClass}>Pixel ID</label>
            <input
              type="text"
              value={metaPixelId}
              onChange={(e) => setMetaPixelId(e.target.value.replace(/\D/g, ''))}
              placeholder="Ex: 1234567890123456"
              className={inputClass}
              maxLength={20}
            />
            <p className="text-[10px] text-gray-400 mt-1">Somente números. Encontre em: Meta Business Suite → Eventos → Pixels</p>
          </div>
        </CardContent>
      </Card>

      {/* ===== GOOGLE ANALYTICS ===== */}
      <Card className="shadow-lg rounded-xl bg-white">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <GoogleChromeLogo size={20} weight="bold" className="text-yellow-600" />
            <CardTitle className="text-sm font-bold text-[#000638]">Google Analytics (GA4)</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <div className="flex items-start gap-3 mb-3 p-3 bg-yellow-50 rounded-lg">
            <Info size={16} className="text-yellow-700 mt-0.5 shrink-0" />
            <p className="text-xs text-yellow-800">
              O GA4 fornece relatórios detalhados de tráfego, comportamento dos usuários e conversões.
              Insira o Measurement ID (ID de acompanhamento) encontrado nas configurações da propriedade GA4.
            </p>
          </div>
          <div className="max-w-md">
            <label className={labelClass}>Measurement ID</label>
            <input
              type="text"
              value={ga4MeasurementId}
              onChange={(e) => setGa4MeasurementId(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
              placeholder="Ex: G-XXXXXXXXXX"
              className={inputClass}
              maxLength={20}
            />
            <p className="text-[10px] text-gray-400 mt-1">Formato: G-XXXXXXXXXX. Encontre em: Google Analytics → Admin → Data Streams</p>
          </div>
        </CardContent>
      </Card>

      {/* ===== UTM CONFIG ===== */}
      <Card className="shadow-lg rounded-xl bg-white">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Gear size={20} weight="bold" className="text-[#000638]" />
            <CardTitle className="text-sm font-bold text-[#000638]">Gestão de UTMs (Rastreamento de Origem)</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <div className="flex items-start gap-3 mb-4 p-3 bg-indigo-50 rounded-lg">
            <Info size={16} className="text-indigo-600 mt-0.5 shrink-0" />
            <p className="text-xs text-indigo-800">
              Os parâmetros UTM serão capturados automaticamente da URL de acesso do catálogo
              (utm_source, utm_medium, utm_campaign, etc.) e podem ser anexados às mensagens
              de WhatsApp e solicitações de orçamento para rastrear a origem dos leads.
            </p>
          </div>

          {/* Toggles */}
          <div className="space-y-3 mb-5">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="text-xs font-semibold text-[#000638]">Captura automática de UTMs</p>
                <p className="text-[10px] text-gray-500">Capturar parâmetros UTM da URL ao acessar o catálogo</p>
              </div>
              <button onClick={() => setUtmConfig(prev => ({ ...prev, auto_capture: !prev.auto_capture }))}>
                {utmConfig.auto_capture
                  ? <ToggleRight size={28} weight="fill" className="text-green-600" />
                  : <ToggleLeft size={28} className="text-gray-400" />}
              </button>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2">
                <WhatsappLogo size={16} weight="fill" className="text-green-600" />
                <div>
                  <p className="text-xs font-semibold text-[#000638]">Anexar UTMs ao WhatsApp</p>
                  <p className="text-[10px] text-gray-500">Incluir dados de rastreamento na mensagem do botão WhatsApp</p>
                </div>
              </div>
              <button onClick={() => setUtmConfig(prev => ({ ...prev, append_to_whatsapp: !prev.append_to_whatsapp }))}>
                {utmConfig.append_to_whatsapp
                  ? <ToggleRight size={28} weight="fill" className="text-green-600" />
                  : <ToggleLeft size={28} className="text-gray-400" />}
              </button>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="text-xs font-semibold text-[#000638]">Anexar UTMs ao Orçamento</p>
                <p className="text-[10px] text-gray-500">Incluir dados de rastreamento na mensagem de solicitação de orçamento</p>
              </div>
              <button onClick={() => setUtmConfig(prev => ({ ...prev, append_to_orcamento: !prev.append_to_orcamento }))}>
                {utmConfig.append_to_orcamento
                  ? <ToggleRight size={28} weight="fill" className="text-green-600" />
                  : <ToggleLeft size={28} className="text-gray-400" />}
              </button>
            </div>
          </div>

          {/* WhatsApp Config */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className={labelClass}>Número do WhatsApp</label>
              <input
                type="text"
                value={utmConfig.whatsapp_number}
                onChange={(e) => setUtmConfig(prev => ({ ...prev, whatsapp_number: e.target.value.replace(/\D/g, '') }))}
                placeholder="Ex: 5511999999999"
                className={inputClass}
                maxLength={15}
              />
              <p className="text-[10px] text-gray-400 mt-1">Com DDI + DDD. Ex: 5511999999999</p>
            </div>
          </div>

          {/* Message Templates */}
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Template da mensagem WhatsApp</label>
              <textarea
                value={utmConfig.whatsapp_message_template}
                onChange={(e) => setUtmConfig(prev => ({ ...prev, whatsapp_message_template: e.target.value }))}
                rows={2}
                className={inputClass + ' resize-y'}
                placeholder="Olá! Vi o produto {produto} no catálogo. {utm_info}"
              />
              <p className="text-[10px] text-gray-400 mt-1">
                Variáveis: <code className="bg-gray-100 px-1 rounded">{'{produto}'}</code> = nome do produto,
                <code className="bg-gray-100 px-1 rounded ml-1">{'{utm_info}'}</code> = dados UTM capturados
              </p>
            </div>
            <div>
              <label className={labelClass}>Template da mensagem de Orçamento</label>
              <textarea
                value={utmConfig.orcamento_message_template}
                onChange={(e) => setUtmConfig(prev => ({ ...prev, orcamento_message_template: e.target.value }))}
                rows={2}
                className={inputClass + ' resize-y'}
                placeholder="Solicito orçamento para {produto}. {utm_info}"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== GERADOR DE LINKS UTM ===== */}
      <Card className="shadow-lg rounded-xl bg-white">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <LinkIcon size={20} weight="bold" className="text-purple-600" />
            <CardTitle className="text-sm font-bold text-[#000638]">Gerador de Links UTM</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <div className="flex items-start gap-3 mb-4 p-3 bg-purple-50 rounded-lg">
            <Info size={16} className="text-purple-600 mt-0.5 shrink-0" />
            <p className="text-xs text-purple-800">
              Crie URLs rastreáveis para suas campanhas. Cole a URL do catálogo e preencha os parâmetros UTM
              para gerar o link que será usado nos anúncios, e-mails ou redes sociais.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div className="md:col-span-2">
              <label className={labelClass}>URL Base do Catálogo *</label>
              <input
                type="url"
                value={utmForm.base_url}
                onChange={(e) => setUtmForm(prev => ({ ...prev, base_url: e.target.value }))}
                placeholder="https://seusite.com.br/catalogo"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>utm_source *</label>
              <input
                type="text"
                value={utmForm.utm_source}
                onChange={(e) => setUtmForm(prev => ({ ...prev, utm_source: e.target.value }))}
                placeholder="Ex: facebook, google, instagram"
                className={inputClass}
              />
              <p className="text-[10px] text-gray-400 mt-0.5">De onde vem o tráfego</p>
            </div>
            <div>
              <label className={labelClass}>utm_medium *</label>
              <input
                type="text"
                value={utmForm.utm_medium}
                onChange={(e) => setUtmForm(prev => ({ ...prev, utm_medium: e.target.value }))}
                placeholder="Ex: cpc, social, email, banner"
                className={inputClass}
              />
              <p className="text-[10px] text-gray-400 mt-0.5">Tipo de mídia</p>
            </div>
            <div>
              <label className={labelClass}>utm_campaign *</label>
              <input
                type="text"
                value={utmForm.utm_campaign}
                onChange={(e) => setUtmForm(prev => ({ ...prev, utm_campaign: e.target.value }))}
                placeholder="Ex: lancamento-inverno-2026"
                className={inputClass}
              />
              <p className="text-[10px] text-gray-400 mt-0.5">Nome da campanha</p>
            </div>
            <div>
              <label className={labelClass}>utm_term</label>
              <input
                type="text"
                value={utmForm.utm_term}
                onChange={(e) => setUtmForm(prev => ({ ...prev, utm_term: e.target.value }))}
                placeholder="Ex: camiseta+polo"
                className={inputClass}
              />
              <p className="text-[10px] text-gray-400 mt-0.5">Termo de busca (opcional)</p>
            </div>
            <div>
              <label className={labelClass}>utm_content</label>
              <input
                type="text"
                value={utmForm.utm_content}
                onChange={(e) => setUtmForm(prev => ({ ...prev, utm_content: e.target.value }))}
                placeholder="Ex: banner-topo, link-rodape"
                className={inputClass}
              />
              <p className="text-[10px] text-gray-400 mt-0.5">Diferenciação de conteúdo (opcional)</p>
            </div>
          </div>

          <button
            onClick={generateUtmUrl}
            disabled={!utmForm.base_url || !utmForm.utm_source}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#000638] text-white rounded-lg text-xs font-medium hover:bg-[#fe0000] transition-colors disabled:opacity-40 disabled:cursor-not-allowed mb-4"
          >
            <LinkIcon size={14} />
            Gerar Link
          </button>

          {generatedUrl && (
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <label className={labelClass}>Link Gerado</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={generatedUrl}
                  readOnly
                  className={inputClass + ' font-mono text-[11px]'}
                />
                <button
                  onClick={copyToClipboard}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#000638] text-white rounded-lg text-xs font-medium hover:bg-[#fe0000] transition-colors shrink-0"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== BOTÃO SALVAR GERAL ===== */}
      <div className="flex justify-end pb-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-[#000638] text-white rounded-lg text-sm font-semibold hover:bg-[#fe0000] transition-colors disabled:opacity-50 shadow-md"
        >
          {saving ? (
            <LoadingSpinner size="sm" />
          ) : saved ? (
            <Check size={18} weight="bold" />
          ) : (
            <FloppyDisk size={18} />
          )}
          {saving ? 'Salvando...' : saved ? 'Salvo com sucesso!' : 'Salvar Configurações'}
        </button>
      </div>
    </div>
  );
};

export default CatalogoIntegracoes;
