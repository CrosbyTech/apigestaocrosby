import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ClipboardText,
  ShoppingCart,
  Wrench,
  CheckCircle,
  Spinner,
  Storefront,
  User,
  Warning,
  PaperPlaneTilt,
} from '@phosphor-icons/react';
import { supabase } from '../lib/supabase';
import { API_BASE_URL } from '../config/constants';

const TIPOS = [
  {
    id: 'compras',
    label: 'Solicitação de Compras',
    icon: ShoppingCart,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    selectedBg: 'bg-blue-600',
  },
  {
    id: 'reparos',
    label: 'Solicitação de Reparos',
    icon: Wrench,
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    selectedBg: 'bg-orange-600',
  },
];

const NIVEIS = [
  {
    id: 'leve',
    label: 'Leve',
    color: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-200',
    selectedBg: 'bg-green-600',
  },
  {
    id: 'medio',
    label: 'Médio',
    color: 'text-yellow-700',
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    selectedBg: 'bg-yellow-500',
  },
  {
    id: 'alto',
    label: 'Alto',
    color: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    selectedBg: 'bg-orange-600',
  },
  {
    id: 'urgente',
    label: 'Urgente',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    selectedBg: 'bg-red-600',
  },
];

const FormularioSolicitacoes = () => {
  const [empresas, setEmpresas] = useState([]);
  const [empresasLoading, setEmpresasLoading] = useState(true);
  const [empresaSelecionada, setEmpresaSelecionada] = useState(null);
  const [empresaSearch, setEmpresaSearch] = useState('');
  const [empresaDropdownOpen, setEmpresaDropdownOpen] = useState(false);
  const empresaRef = useRef(null);

  const [solicitante, setSolicitante] = useState('');
  const [tipo, setTipo] = useState('');
  const [nivel, setNivel] = useState('');
  const [descricao, setDescricao] = useState('');
  const [observacao, setObservacao] = useState('');

  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    const buscarEmpresas = async () => {
      setEmpresasLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/api/totvs/branches`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        let lista = [];
        if (result?.data?.data && Array.isArray(result.data.data)) {
          lista = result.data.data;
        } else if (Array.isArray(result?.data)) {
          lista = result.data;
        }
        lista.sort((a, b) => parseInt(a.cd_empresa) - parseInt(b.cd_empresa));
        setEmpresas(lista);
      } catch (err) {
        console.error('Erro ao buscar empresas:', err);
        setEmpresas([]);
      } finally {
        setEmpresasLoading(false);
      }
    };
    buscarEmpresas();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (empresaRef.current && !empresaRef.current.contains(e.target)) {
        setEmpresaDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const empresasFiltradas = useMemo(() => {
    const termo = empresaSearch.trim().toLowerCase();
    if (!termo) return empresas;
    return empresas.filter(
      (e) =>
        String(e.cd_empresa).toLowerCase().includes(termo) ||
        (e.nm_grupoempresa || '').toLowerCase().includes(termo),
    );
  }, [empresas, empresaSearch]);

  const resetForm = () => {
    setEmpresaSelecionada(null);
    setEmpresaSearch('');
    setSolicitante('');
    setTipo('');
    setNivel('');
    setDescricao('');
    setObservacao('');
    setErro(null);
  };

  const validar = () => {
    if (!empresaSelecionada) return 'Selecione a loja.';
    if (!solicitante.trim()) return 'Informe o nome do solicitante.';
    if (!tipo) return 'Selecione o tipo de solicitação.';
    if (!nivel) return 'Selecione o nível de urgência.';
    if (!descricao.trim()) return 'Descreva o que precisa.';
    return null;
  };

  const handleEnviar = async (e) => {
    e.preventDefault();
    const erroValidacao = validar();
    if (erroValidacao) {
      setErro(erroValidacao);
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      const { error } = await supabase.from('solicitacoes_crosby').insert([
        {
          cd_empresa: parseInt(empresaSelecionada.cd_empresa),
          nm_empresa: empresaSelecionada.nm_grupoempresa || null,
          solicitante: solicitante.trim(),
          tipo_solicitacao: tipo,
          nivel_urgencia: nivel,
          descricao: descricao.trim(),
          observacao: observacao.trim() || null,
          status: 'pendente',
          data_solicitacao: new Date().toISOString(),
        },
      ]);
      if (error) throw error;
      setEnviado(true);
    } catch (err) {
      console.error('Erro ao enviar solicitação:', err);
      setErro(
        err?.message ||
          'Erro ao enviar solicitação. Tente novamente em instantes.',
      );
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f4f6fb] to-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border">
          <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <CheckCircle size={40} weight="fill" className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-[#000638] mb-2">
            Solicitação enviada!
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            Sua solicitação foi registrada e será analisada pela equipe Crosby.
            Você será notificado(a) sobre o andamento.
          </p>
          <button
            onClick={() => {
              resetForm();
              setEnviado(false);
            }}
            className="w-full px-4 py-2.5 bg-[#000638] text-white rounded-lg font-bold hover:bg-[#fe0000] transition-colors text-sm"
          >
            Enviar nova solicitação
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f4f6fb] to-white py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Cabeçalho */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-blue-50 to-blue-100 shadow-sm mb-3">
            <ClipboardText
              size={28}
              weight="light"
              className="text-[#000638]"
            />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#000638] tracking-tight">
            Formulário de Solicitações
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Preencha o formulário para abrir uma solicitação de compra ou
            reparo.
          </p>
        </div>

        <form
          onSubmit={handleEnviar}
          className="bg-white rounded-2xl shadow-lg border p-6 md:p-8 space-y-6"
        >
          {/* Loja */}
          <div ref={empresaRef} className="relative">
            <label className="text-xs font-bold text-[#000638] flex items-center gap-1.5 mb-1.5">
              <Storefront size={14} weight="bold" />
              Loja *
            </label>
            <button
              type="button"
              onClick={() => setEmpresaDropdownOpen((o) => !o)}
              disabled={empresasLoading}
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm text-left flex items-center justify-between focus:outline-none focus:border-[#000638] disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:border-[#000638]/40"
            >
              <span
                className={
                  empresaSelecionada
                    ? 'text-[#000638] font-semibold'
                    : 'text-gray-400'
                }
              >
                {empresasLoading
                  ? 'Carregando lojas...'
                  : empresaSelecionada
                    ? `${empresaSelecionada.cd_empresa} - ${empresaSelecionada.nm_grupoempresa}`
                    : 'Selecione a loja'}
              </span>
              <svg
                className={`w-4 h-4 transition-transform ${empresaDropdownOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {empresaDropdownOpen && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                <div className="p-2 border-b">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Buscar loja..."
                    value={empresaSearch}
                    onChange={(e) => setEmpresaSearch(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#000638]"
                  />
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {empresasFiltradas.length === 0 ? (
                    <div className="p-3 text-sm text-gray-400 text-center">
                      Nenhuma loja encontrada
                    </div>
                  ) : (
                    empresasFiltradas.map((emp) => (
                      <button
                        key={emp.cd_empresa}
                        type="button"
                        onClick={() => {
                          setEmpresaSelecionada(emp);
                          setEmpresaDropdownOpen(false);
                          setEmpresaSearch('');
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors ${
                          empresaSelecionada?.cd_empresa === emp.cd_empresa
                            ? 'bg-blue-50 font-semibold'
                            : ''
                        }`}
                      >
                        <span className="text-[#000638]">{emp.cd_empresa}</span>
                        <span className="text-gray-700">
                          {' '}
                          - {emp.nm_grupoempresa}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Solicitante */}
          <div>
            <label className="text-xs font-bold text-[#000638] flex items-center gap-1.5 mb-1.5">
              <User size={14} weight="bold" />
              Solicitante *
            </label>
            <input
              type="text"
              value={solicitante}
              onChange={(e) => setSolicitante(e.target.value)}
              maxLength={120}
              placeholder="Nome de quem está solicitando"
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#000638] transition-colors"
            />
          </div>

          {/* Tipo de solicitação */}
          <div>
            <label className="text-xs font-bold text-[#000638] mb-1.5 block">
              Tipo de Solicitação *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TIPOS.map((t) => {
                const Icon = t.icon;
                const selected = tipo === t.id;
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setTipo(t.id)}
                    className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 transition-all text-sm font-semibold ${
                      selected
                        ? `${t.selectedBg} text-white border-transparent shadow-md`
                        : `${t.bg} ${t.color} ${t.border} hover:shadow`
                    }`}
                  >
                    <Icon size={20} weight={selected ? 'fill' : 'bold'} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Nível de urgência */}
          <div>
            <label className="text-xs font-bold text-[#000638] mb-1.5 block">
              Nível de Urgência *
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {NIVEIS.map((n) => {
                const selected = nivel === n.id;
                return (
                  <button
                    type="button"
                    key={n.id}
                    onClick={() => setNivel(n.id)}
                    className={`px-3 py-2.5 rounded-lg border-2 transition-all text-sm font-bold ${
                      selected
                        ? `${n.selectedBg} text-white border-transparent shadow-md`
                        : `${n.bg} ${n.color} ${n.border} hover:shadow`
                    }`}
                  >
                    {n.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label className="text-xs font-bold text-[#000638] mb-1.5 block">
              Descrição *
            </label>
            <textarea
              rows={4}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descreva o que precisa (1 tipo de item por solicitação)"
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#000638] transition-colors resize-y"
            />
          </div>

          {/* Observação */}
          <div>
            <label className="text-xs font-bold text-[#000638] mb-1.5 block">
              Observação
            </label>
            <textarea
              rows={3}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Informações adicionais (opcional)"
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#000638] transition-colors resize-y"
            />
          </div>

          {/* Erro */}
          {erro && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
              <Warning
                size={18}
                weight="bold"
                className="flex-shrink-0 mt-0.5"
              />
              <span>{erro}</span>
            </div>
          )}

          {/* Botão enviar */}
          <button
            type="submit"
            disabled={enviando}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#000638] text-white font-bold hover:bg-[#fe0000] transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm"
          >
            {enviando ? (
              <>
                <Spinner size={18} className="animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <PaperPlaneTilt size={18} weight="bold" />
                Enviar Solicitação
              </>
            )}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-4">
          HEADCOACH · Gestão Crosby
        </p>
      </div>
    </div>
  );
};

export default FormularioSolicitacoes;
