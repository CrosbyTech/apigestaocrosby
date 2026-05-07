import React, { useState, useEffect, useRef } from 'react';
import { X, WhatsappLogo, Spinner, PaperPlaneTilt, Eye, EyeSlash } from '@phosphor-icons/react';
import { ALL_INSTANCES, instLabel, formatPhone } from './constants';
import { API_BASE_URL } from '../../config/constants';

const API_KEY = import.meta.env.VITE_API_KEY || '';

// limpa telefone para o endpoint /lead-instances
const cleanPhoneCp = (s) => String(s || '').replace(/\D/g, '');

export default function ChatPanel({ open, tel, nome, defaultInst, defaultProvider, instancias = [], onClose }) {
  const [selectedInst, setSelectedInst] = useState(defaultInst || '');
  const [selectedProvider, setSelectedProvider] = useState(defaultProvider || 'evolution');
  const [mensagens, setMensagens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  // Auto-carregamento de instâncias quando o painel abre (caso não venham via prop)
  const [autoInstancias, setAutoInstancias] = useState([]);
  const [loadingInst, setLoadingInst] = useState(false);
  const [showAll, setShowAll] = useState(false); // permite forçar todas as instâncias
  const bodyRef = useRef(null);

  useEffect(() => {
    if (open && tel && selectedInst) loadMessages();
  }, [open, tel, selectedInst, selectedProvider]);

  // Auto-busca as instâncias com chat para esse telefone (sempre que abre)
  useEffect(() => {
    if (!open || !tel) return;
    // Se vieram via prop (instancias), não refaz
    if (instancias && instancias.length > 0) {
      setAutoInstancias([]);
      return;
    }
    let cancelled = false;
    setLoadingInst(true);
    setAutoInstancias([]);
    setShowAll(false);
    fetch(
      `${API_BASE_URL}/api/crm/lead-instances/${cleanPhoneCp(tel)}`,
      { headers: { 'x-api-key': API_KEY } },
    )
      .then((r) => (r.ok ? r.json() : { data: { instances: [] } }))
      .then((j) => {
        if (cancelled) return;
        const list = j.data?.instances || j.instances || [];
        setAutoInstancias(list);
        // Se há defaults, mantém. Senão, escolhe primeiro
        if (!defaultInst && list.length > 0) {
          setSelectedInst(list[0].name);
          setSelectedProvider(list[0].provider || 'evolution');
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingInst(false));
    return () => {
      cancelled = true;
    };
  }, [open, tel, instancias, defaultInst]);

  useEffect(() => {
    setSelectedInst(defaultInst || '');
    setSelectedProvider(defaultProvider || 'evolution');
  }, [defaultInst, defaultProvider]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [mensagens]);

  async function loadMessages() {
    setLoading(true);
    setErro('');
    setMensagens([]);
    try {
      const url = `${API_BASE_URL}/api/crm/msgs?tel=${encodeURIComponent(tel)}&inst=${encodeURIComponent(selectedInst)}&provider=${encodeURIComponent(selectedProvider)}`;
      const r = await fetch(url, { headers: { 'x-api-key': API_KEY } });
      if (!r.ok) throw new Error('Erro ao buscar mensagens');
      const json = await r.json();
      const data = json.data ?? json;
      setMensagens(data.mensagens || []);
    } catch (err) {
      setErro(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  // Lista de instâncias para o dropdown (Evolution+UAzapi unificado)
  // Prioriza prop `instancias`; senão usa `autoInstancias` (fetch interno).
  // SÓ cai pra ALL_INSTANCES se o usuário clicar em "Mostrar todas".
  const fonteInstancias =
    instancias && instancias.length > 0 ? instancias : autoInstancias;
  const semInstanciasComChat =
    !loadingInst && fonteInstancias.length === 0;
  const opcoesInst = (showAll && semInstanciasComChat)
    ? ALL_INSTANCES.map((i) => ({ name: i.name, provider: 'evolution', count: null }))
    : fonteInstancias.map((raw) => {
        if (typeof raw === 'string') {
          return { name: raw, provider: 'evolution', count: null };
        }
        const name = raw.name || raw.instanceName || '';
        const provider = raw.provider || 'evolution';
        const count = raw.count ?? raw.messageCount ?? null;
        return { name, provider, count };
      });

  const handleInstChange = (e) => {
    const name = e.target.value;
    setSelectedInst(name);
    const found = opcoesInst.find((o) => o.name === name);
    setSelectedProvider(found?.provider || 'evolution');
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Painel lateral */}
      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white p-3 flex items-center gap-2">
          <WhatsappLogo size={24} weight="fill" />
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm truncate">{nome || tel}</h3>
            <p className="text-xs opacity-90 font-mono">{formatPhone(tel)}</p>
          </div>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded">
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* Seletor de instância */}
        <div className="border-b border-gray-200 p-2 bg-gray-50">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[10px] font-semibold text-gray-600">
              INSTÂNCIA
              {loadingInst && (
                <span className="ml-2 text-[10px] text-gray-400">
                  buscando…
                </span>
              )}
              {!loadingInst && fonteInstancias.length > 0 && (
                <span className="ml-2 text-[10px] text-emerald-600 font-normal">
                  · {fonteInstancias.length} com chat
                </span>
              )}
            </label>
            {/* Toggle "Mostrar todas" — só aparece quando não há chats */}
            {!loadingInst && semInstanciasComChat && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded"
                title="Forçar exibição de todas as instâncias"
              >
                {showAll ? <EyeSlash size={11} /> : <Eye size={11} />}
                {showAll ? 'Só com chat' : 'Mostrar todas'}
              </button>
            )}
          </div>
          {!loadingInst && semInstanciasComChat && !showAll ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 text-[11px] text-amber-700">
              Nenhuma instância tem conversa com este telefone.
              <br />
              <span className="text-amber-600">
                Clique em &quot;Mostrar todas&quot; para tentar manualmente.
              </span>
            </div>
          ) : (
            <select
              value={selectedInst}
              onChange={handleInstChange}
              disabled={opcoesInst.length === 0}
              className="w-full border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">Selecione uma instância</option>
              {opcoesInst.map((i) => {
                const label = instLabel(i.name) || i.name;
                const meta = i.provider === 'uazapi' ? '· UAzapi' : '';
                const cnt = i.count ? `(${i.count} msgs)` : '';
                return (
                  <option key={`${i.provider}:${i.name}`} value={i.name}>
                    {`${label} ${cnt} ${meta}`.trim()}
                  </option>
                );
              })}
            </select>
          )}
        </div>

        {/* Body com mensagens */}
        <div
          ref={bodyRef}
          className="flex-1 overflow-y-auto p-3 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDQwIDQwIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIxIiBmaWxsPSIjZGRkIi8+PC9zdmc+')] bg-gray-50"
        >
          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <Spinner size={32} className="animate-spin text-emerald-600" />
              <span className="text-xs text-gray-500">Carregando mensagens...</span>
            </div>
          )}
          {erro && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded text-xs">
              {erro}
            </div>
          )}
          {!loading && !erro && mensagens.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
              <WhatsappLogo size={48} weight="thin" />
              <span className="text-xs">Nenhuma mensagem encontrada</span>
            </div>
          )}
          {!loading && mensagens.length > 0 && (
            <div className="flex flex-col gap-2">
              {mensagens.map((m, i) => {
                const isEu = m.quem === 'EU' || m.fromMe === true;
                return (
                  <div
                    key={i}
                    className={`max-w-[80%] ${isEu ? 'self-end' : 'self-start'}`}
                  >
                    <div
                      className={`p-2 rounded-lg text-xs ${
                        isEu
                          ? 'bg-emerald-100 text-gray-800 rounded-br-none'
                          : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none shadow-sm'
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">
                        {m.texto || '[mídia]'}
                      </div>
                      <div className="text-[9px] text-gray-400 mt-1 text-right">
                        {(() => {
                          if (!m.tempo) return '';
                          // Detecta segundos vs milissegundos
                          // (Evolution retorna segundos; UAzapi pode retornar ms)
                          const ts =
                            Number(m.tempo) < 1e12
                              ? Number(m.tempo) * 1000
                              : Number(m.tempo);
                          const d = new Date(ts);
                          if (isNaN(d.getTime())) return '';
                          // Formato compacto: dd/mm HH:mm
                          return d.toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          });
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-2 bg-white flex gap-2 items-center">
          <span className="text-[10px] text-gray-500 flex-1">
            {mensagens.length} mensagem(ns) • somente leitura
          </span>
          <button
            onClick={loadMessages}
            disabled={loading}
            className="text-[10px] bg-emerald-600 text-white px-3 py-1 rounded hover:bg-emerald-700 disabled:opacity-50"
          >
            Atualizar
          </button>
        </div>
      </div>
    </>
  );
}
