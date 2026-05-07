import React, { useEffect, useState, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { exportarPDF } from '../utils/exportarPDF';
import { supabase } from '../lib/supabase';
import { API_BASE_URL } from '../config/constants';
import CENTROS_CUSTO from '../config/centrosCusto.json';
import { useAuth } from '../components/AuthContext';
import PageTitle from '../components/ui/PageTitle';
import {
  gerarArquivoRemessaSicredi,
  proximoNomeArquivoRemessa,
} from '../utils/cnab240Sicredi';
import {
  CurrencyDollar,
  CheckCircle,
  Warning,
  Spinner,
  FloppyDisk,
  Trash,
  Funnel,
  Receipt,
  Clock,
  XCircle,
  Stamp,
  Bank,
  FileXls,
  FilePdf,
  Info,
  ChatCircleText,
  Wallet,
  MagnifyingGlass,
  X,
  PlusCircle,
  PencilSimple,
  ArrowsLeftRight,
  ArrowUp,
  ArrowDown,
  ArrowsDownUp,
} from '@phosphor-icons/react';

const BANCOS = [
  'SICREDI CROSBY',
  'SICREDI FÁBIO',
  'STONE',
  'ITAU FLAVIO',
  'CAIXA IRMAOS',
  'MENTORE',
];

const FORMAS_PAGAMENTO = [
  { value: 'PIX', label: 'PIX', detalheLabel: 'Chave PIX', campo: 'chave_pix' },
  {
    value: 'BOLETO',
    label: 'Boleto',
    detalheLabel: 'Código de Barras',
    campo: 'codigo_barras',
  },
  {
    value: 'DEBITO',
    label: 'Débito',
    detalheLabel: 'Link de Pagamento',
    campo: 'link_pagamento',
  },
  {
    value: 'CREDITO',
    label: 'Crédito',
    detalheLabel: 'Link de Pagamento',
    campo: 'link_pagamento',
  },
];

const STATUS_CONFIG = {
  PENDENTE: {
    label: 'Pendente',
    color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    icon: Clock,
  },
  APROVADO: {
    label: 'Aprovado',
    color: 'bg-blue-100 text-blue-800 border-blue-300',
    icon: CheckCircle,
  },
  PAGO: {
    label: 'Pago',
    color: 'bg-green-100 text-green-800 border-green-300',
    icon: CheckCircle,
  },
  CANCELADO: {
    label: 'Cancelado',
    color: 'bg-red-100 text-red-800 border-red-300',
    icon: XCircle,
  },
  TRANSFERENCIA: {
    label: 'Entre Contas',
    color: 'bg-purple-100 text-purple-800 border-purple-300',
    icon: ArrowsLeftRight,
  },
};

const fmtBRL = (v) =>
  parseFloat(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

const fmtDate = (d) => {
  if (!d) return '—';
  const [y, m, day] = String(d).split('T')[0].split('-');
  return `${day}/${m}/${y}`;
};

const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const BANCOS_SALDO = [
  'SICREDI CROSBY',
  'SICREDI FÁBIO',
  'STONE',
  'ITAU FLAVIO',
  'CAIXA IRMAOS',
  'MENTORE',
];

// ─── Modal de Saldo Bancário ──────────────────────────
const ModalSaldoBancario = ({ onClose, onSaved, userEmail }) => {
  const [valores, setValores] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('saldo_bancario').select('*');
      const map = {};
      (data || []).forEach((r) => {
        map[r.banco] = r.valor;
      });
      setValores(map);
      setLoading(false);
    };
    load();
  }, []);

  const total = BANCOS_SALDO.reduce(
    (s, b) => s + parseFloat(valores[b] || 0),
    0,
  );

  const handleSalvar = async () => {
    setSaving(true);
    const now = new Date().toISOString();
    const rows = BANCOS_SALDO.map((banco) => ({
      banco,
      valor: parseFloat(valores[banco] || 0),
      updated_at: now,
      updated_by: userEmail || null,
    }));
    const { error } = await supabase
      .from('saldo_bancario')
      .upsert(rows, { onConflict: 'banco' });
    setSaving(false);
    if (error) {
      alert('Erro ao salvar: ' + error.message);
      return;
    }
    onSaved(rows);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 p-5 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2">
            <Wallet size={16} weight="bold" className="text-teal-600" />
            Saldo Bancário
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
          >
            <X size={18} weight="bold" />
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size={20} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-2.5">
            {BANCOS_SALDO.map((banco) => (
              <div key={banco} className="flex items-center gap-3">
                <label className="text-xs font-semibold text-gray-700 w-36 shrink-0 flex items-center gap-1">
                  <Bank size={11} className="text-[#000638]" />
                  {banco}
                </label>
                <div className="relative flex-1">
                  <span className="absolute left-2 top-1/3 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                    R$
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valores[banco] ?? ''}
                    onChange={(e) =>
                      setValores((p) => ({ ...p, [banco]: e.target.value }))
                    }
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs pl-7 focus:ring-1 focus:ring-teal-500"
                    placeholder="0,00"
                  />
                </div>
                <span className="text-xs font-semibold text-teal-700 w-24 text-right">
                  {fmtBRL(parseFloat(valores[banco] || 0))}
                </span>
              </div>
            ))}
            <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">
                Total
              </span>
              <span className="text-base font-bold text-teal-700">
                {fmtBRL(total)}
              </span>
            </div>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 text-xs font-semibold py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving || loading}
            className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-1"
          >
            {saving ? (
              <Spinner size={12} className="animate-spin" />
            ) : (
              <FloppyDisk size={12} weight="bold" />
            )}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Modal de detalhes do pagamento ──────────────────
const ModalInfoPagamento = ({ item, onClose }) => {
  const formaCfg = FORMAS_PAGAMENTO.find(
    (f) => f.value === item.forma_pagamento,
  );
  const detalhe = item.chave_pix || item.codigo_barras || item.link_pagamento;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 p-5 w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm text-gray-800">
            Detalhes do Pagamento
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
          >
            <XCircle size={18} weight="bold" />
          </button>
        </div>
        <div className="space-y-3">
          {item.banco_pagamento && (
            <div>
              <p className="text-[10px] font-bold uppercase text-gray-400 mb-0.5">
                Banco
              </p>
              <p className="text-sm text-gray-800 font-semibold flex items-center gap-1">
                <Bank size={13} className="text-[#000638]" />
                {item.banco_pagamento}
              </p>
            </div>
          )}
          {item.forma_pagamento && (
            <div>
              <p className="text-[10px] font-bold uppercase text-gray-400 mb-0.5">
                Forma de Pagamento
              </p>
              <span className="inline-block text-xs px-2 py-0.5 rounded bg-[#000638] text-white font-semibold">
                {formaCfg?.label || item.forma_pagamento}
              </span>
            </div>
          )}
          {detalhe && (
            <div>
              <p className="text-[10px] font-bold uppercase text-gray-400 mb-0.5">
                {formaCfg?.detalheLabel || 'Detalhe'}
              </p>
              <p className="text-xs text-gray-800 font-mono break-all bg-gray-50 rounded p-2 border border-gray-100">
                {detalhe}
              </p>
            </div>
          )}
          {item.observacao && (
            <div>
              <p className="text-[10px] font-bold uppercase text-gray-400 mb-0.5">
                Observação
              </p>
              <p className="text-sm text-gray-700 italic">{item.observacao}</p>
            </div>
          )}
          {!item.banco_pagamento &&
            !item.forma_pagamento &&
            !detalhe &&
            !item.observacao && (
              <p className="text-sm text-gray-400 text-center py-2">
                Nenhum detalhe registrado.
              </p>
            )}
        </div>
        {item.pago_em && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <p className="text-[10px] text-gray-400">
              Pago em {fmtDateTime(item.pago_em)}
              {item.pago_por ? ` · ${item.pago_por}` : ''}
            </p>
          </div>
        )}
        <button
          onClick={onClose}
          className="mt-4 w-full bg-[#000638] text-white text-xs font-semibold py-2 rounded-lg hover:bg-[#001060] transition-colors"
        >
          Fechar
        </button>
      </div>
    </div>
  );
};

// ─── Modal Transferência entre Contas ────────────────
const ModalTransferencia = ({ onClose, onSalvo, userEmail }) => {
  const [bancoOrigem, setBancoOrigem] = useState('');
  const [bancoDestino, setBancoDestino] = useState('');
  const [valor, setValor] = useState('');
  const [formaPgto, setFormaPgto] = useState('');
  const [detalhe, setDetalhe] = useState('');
  const [dataTransf, setDataTransf] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);

  const formaCfg = FORMAS_PAGAMENTO.find((f) => f.value === formaPgto);

  const handleSalvar = async () => {
    if (!bancoOrigem) {
      alert('Selecione o banco de origem.');
      return;
    }
    if (!bancoDestino) {
      alert('Selecione o banco de destino.');
      return;
    }
    if (bancoOrigem === bancoDestino) {
      alert('Origem e destino devem ser bancos diferentes.');
      return;
    }
    if (!valor || isNaN(parseFloat(valor)) || parseFloat(valor) <= 0) {
      alert('Informe um valor válido.');
      return;
    }
    if (!dataTransf) {
      alert('Informe a data da transferência.');
      return;
    }
    setSaving(true);
    const patch = {
      chave_pix: null,
      codigo_barras: null,
      link_pagamento: null,
    };
    if (formaCfg) patch[formaCfg.campo] = detalhe || null;
    const row = {
      status: 'TRANSFERENCIA',
      nm_empresa: 'Transferência',
      nm_fornecedor: `${bancoOrigem} → ${bancoDestino}`,
      dt_emissao: dataTransf,
      dt_vencimento: dataTransf,
      vl_duplicata: parseFloat(valor),
      banco_pagamento: bancoOrigem,
      forma_pagamento: formaPgto || null,
      observacao: obs.trim() || null,
      enviado_por: userEmail || null,
      enviado_em: new Date().toISOString(),
      dados_completos: {
        transferencia_entre_contas: true,
        banco_origem: bancoOrigem,
        banco_destino: bancoDestino,
      },
      ...patch,
    };
    const { data, error } = await supabase
      .from('pagamentos_liberacao')
      .insert([row])
      .select()
      .single();
    setSaving(false);
    if (error) {
      alert('Erro ao salvar: ' + error.message);
      return;
    }
    onSalvo(data);
    onClose();
  };

  const inputCls =
    'w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-purple-500';
  const labelCls = 'text-[10px] font-bold uppercase text-gray-500 mb-0.5 block';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-purple-200 p-5 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2">
            <ArrowsLeftRight
              size={16}
              weight="bold"
              className="text-purple-600"
            />
            Transferência Entre Contas
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Banco Origem *</label>
            <select
              className={`${inputCls} bg-white`}
              value={bancoOrigem}
              onChange={(e) => setBancoOrigem(e.target.value)}
            >
              <option value="">— Selecione —</option>
              {BANCOS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Banco Destino *</label>
            <select
              className={`${inputCls} bg-white`}
              value={bancoDestino}
              onChange={(e) => setBancoDestino(e.target.value)}
            >
              <option value="">— Selecione —</option>
              {BANCOS.filter((b) => b !== bancoOrigem).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {bancoOrigem && bancoDestino && (
            <div className="col-span-2 flex items-center justify-center gap-2 bg-purple-50 rounded-lg py-2 border border-purple-100">
              <span className="text-xs font-bold text-purple-700">
                {bancoOrigem}
              </span>
              <ArrowsLeftRight
                size={14}
                weight="bold"
                className="text-purple-500"
              />
              <span className="text-xs font-bold text-purple-700">
                {bancoDestino}
              </span>
            </div>
          )}

          <div>
            <label className={labelCls}>Valor *</label>
            <div className="relative">
              <span className="absolute left-2 top-1/3 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                R$
              </span>
              <input
                className={`${inputCls} pl-7`}
                type="number"
                step="0.01"
                min="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Data da Transferência *</label>
            <input
              className={inputCls}
              type="date"
              value={dataTransf}
              onChange={(e) => setDataTransf(e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>Forma de Pagamento</label>
            <select
              className={`${inputCls} bg-white`}
              value={formaPgto}
              onChange={(e) => {
                setFormaPgto(e.target.value);
                setDetalhe('');
              }}
            >
              <option value="">— Forma —</option>
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>
              {formaCfg?.detalheLabel || 'Chave / Código'}
            </label>
            <input
              className={inputCls}
              value={detalhe}
              disabled={!formaCfg}
              onChange={(e) => setDetalhe(e.target.value)}
              placeholder={
                formaCfg ? formaCfg.detalheLabel : 'Selecione a forma'
              }
            />
          </div>

          <div className="col-span-2">
            <label className={labelCls}>Observação</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={2}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Observações adicionais"
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 text-xs font-semibold py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving}
            className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-1"
          >
            {saving ? (
              <Spinner size={12} className="animate-spin" />
            ) : (
              <FloppyDisk size={12} weight="bold" />
            )}
            Registrar Transferência
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Modal adicionar duplicata manual ────────────────
const CAMPOS_FORM_INICIAL = {
  nm_fornecedor: '',
  cd_fornecedor: '',
  dt_emissao: '',
  dt_vencimento: '',
  vl_duplicata: '',
  ds_despesaitem: '',
  cd_ccusto: '',
  banco_pagamento: '',
  forma_pagamento: '',
  detalhe: '',
  observacao: '',
};

const TIPOS_BUSCA_FORN = [
  { value: 'nome', label: 'Nome' },
  { value: 'fantasia', label: 'Fantasia' },
  { value: 'cnpj_cpf', label: 'CPF/CNPJ' },
  { value: 'codigo', label: 'Código' },
];

const ModalAdicionarDuplicata = ({ onClose, onSalvo, userEmail }) => {
  const [form, setForm] = useState(CAMPOS_FORM_INICIAL);
  const [saving, setSaving] = useState(false);

  // busca fornecedor
  const [tipoBusca, setTipoBusca] = useState('nome');
  const [termoBusca, setTermoBusca] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState([]);
  const [fornSelecionado, setFornSelecionado] = useState(null);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const formaCfg = FORMAS_PAGAMENTO.find(
    (f) => f.value === form.forma_pagamento,
  );

  const buscarFornecedor = async () => {
    const termo = termoBusca.trim();
    if (!termo) {
      alert('Digite um valor para buscar.');
      return;
    }
    if (tipoBusca === 'codigo') {
      const code = parseInt(termo, 10);
      if (isNaN(code) || code <= 0) {
        alert('Código inválido.');
        return;
      }
      setFornSelecionado({
        cd_pessoa: code,
        nm_pessoa: `Fornecedor Cód. ${code}`,
        nm_fantasia: null,
        cpf: null,
      });
      setForm((p) => ({
        ...p,
        nm_fornecedor: `Fornecedor Cód. ${code}`,
        cd_fornecedor: String(code),
      }));
      setResultados([]);
      return;
    }
    setBuscando(true);
    setResultados([]);
    try {
      let qp = '';
      if (tipoBusca === 'nome') qp = `nome=${encodeURIComponent(termo)}`;
      else if (tipoBusca === 'fantasia')
        qp = `fantasia=${encodeURIComponent(termo)}`;
      else if (tipoBusca === 'cnpj_cpf')
        qp = `cnpj=${encodeURIComponent(termo.replace(/\D/g, ''))}`;
      const res = await fetch(
        `${API_BASE_URL}/api/totvs/clientes/search-name?${qp}`,
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      const lista = (data?.data?.clientes || []).map((f) => ({
        cd_pessoa: f.code,
        nm_pessoa: f.nm_pessoa,
        nm_fantasia: f.fantasy_name || null,
        cpf: f.cpf || null,
      }));
      if (lista.length === 0) alert('Nenhum fornecedor encontrado.');
      else if (lista.length === 1) selecionarForn(lista[0]);
      else setResultados(lista);
    } catch {
      alert('Erro ao buscar fornecedor.');
    } finally {
      setBuscando(false);
    }
  };

  const selecionarForn = (f) => {
    setFornSelecionado(f);
    setForm((p) => ({
      ...p,
      nm_fornecedor: f.nm_pessoa,
      cd_fornecedor: String(f.cd_pessoa),
    }));
    setResultados([]);
    setTermoBusca('');
  };

  const handleSalvar = async () => {
    if (!form.nm_fornecedor.trim()) {
      alert('Informe o fornecedor.');
      return;
    }
    if (!form.dt_vencimento) {
      alert('Informe o vencimento.');
      return;
    }
    if (!form.vl_duplicata || isNaN(parseFloat(form.vl_duplicata))) {
      alert('Informe um valor válido.');
      return;
    }
    setSaving(true);
    const now = new Date().toISOString();
    const patch = {
      chave_pix: null,
      codigo_barras: null,
      link_pagamento: null,
    };
    if (formaCfg) patch[formaCfg.campo] = form.detalhe || null;

    const row = {
      status: 'PENDENTE',
      nm_empresa: 'Manual',
      nm_fornecedor: form.nm_fornecedor.trim(),
      cd_fornecedor: form.cd_fornecedor.trim() || null,
      dt_emissao: form.dt_emissao || null,
      dt_vencimento: form.dt_vencimento,
      vl_duplicata: parseFloat(form.vl_duplicata),
      ds_despesaitem: form.ds_despesaitem.trim() || null,
      cd_ccusto: form.cd_ccusto.trim() || null,
      banco_pagamento: form.banco_pagamento || null,
      forma_pagamento: form.forma_pagamento || null,
      observacao: form.observacao.trim() || null,
      enviado_por: userEmail || null,
      enviado_em: now,
      dados_completos: { inserido_manualmente: true },
      ...patch,
    };
    const { data, error } = await supabase
      .from('pagamentos_liberacao')
      .insert([row])
      .select()
      .single();
    setSaving(false);
    if (error) {
      alert('Erro ao salvar: ' + error.message);
      return;
    }
    onSalvo(data);
    onClose();
  };

  const inputCls =
    'w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-[#000638]';
  const labelCls = 'text-[10px] font-bold uppercase text-gray-500 mb-0.5 block';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 p-5 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2">
            <PlusCircle size={16} weight="bold" className="text-orange-500" />
            Adicionar Duplicata Manual
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Busca de fornecedor TOTVS */}
          <div className="col-span-2 bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p className="text-[10px] font-bold uppercase text-gray-500 mb-2 flex items-center gap-1">
              <MagnifyingGlass size={11} />
              Buscar fornecedor no TOTVS
            </p>
            <div className="flex gap-1.5 mb-2">
              <select
                value={tipoBusca}
                onChange={(e) => {
                  setTipoBusca(e.target.value);
                  setResultados([]);
                }}
                className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:ring-1 focus:ring-[#000638] w-28 shrink-0"
              >
                {TIPOS_BUSCA_FORN.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                value={termoBusca}
                onChange={(e) => setTermoBusca(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && buscarFornecedor()}
                placeholder={`Buscar por ${TIPOS_BUSCA_FORN.find((t) => t.value === tipoBusca)?.label.toLowerCase()}...`}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-[#000638]"
              />
              <button
                onClick={buscarFornecedor}
                disabled={buscando}
                className="flex items-center gap-1 bg-[#000638] hover:bg-[#001060] disabled:opacity-50 text-white text-xs font-semibold px-2.5 py-1 rounded transition-colors"
              >
                {buscando ? (
                  <Spinner size={11} className="animate-spin" />
                ) : (
                  <MagnifyingGlass size={11} weight="bold" />
                )}
                Buscar
              </button>
            </div>

            {/* Resultados */}
            {resultados.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-36 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="bg-[#000638] text-white">
                    <tr>
                      <th className="px-2 py-1 text-left">Cód.</th>
                      <th className="px-2 py-1 text-left">Nome</th>
                      <th className="px-2 py-1 text-left">Fantasia</th>
                      <th className="px-2 py-1 text-left">CPF/CNPJ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultados.map((f) => (
                      <tr
                        key={f.cd_pessoa}
                        onClick={() => selecionarForn(f)}
                        className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                      >
                        <td className="px-2 py-1 font-mono text-gray-600">
                          {f.cd_pessoa}
                        </td>
                        <td className="px-2 py-1 font-semibold text-gray-800">
                          {f.nm_pessoa}
                        </td>
                        <td className="px-2 py-1 text-gray-500">
                          {f.nm_fantasia || '—'}
                        </td>
                        <td className="px-2 py-1 text-gray-500">
                          {f.cpf || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Fornecedor selecionado */}
            {fornSelecionado && (
              <div className="mt-1.5 flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5">
                <CheckCircle
                  size={13}
                  weight="bold"
                  className="text-green-600 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-green-800 truncate">
                    {fornSelecionado.nm_pessoa}
                  </p>
                  {fornSelecionado.nm_fantasia && (
                    <p className="text-[10px] text-green-600 truncate">
                      {fornSelecionado.nm_fantasia}
                    </p>
                  )}
                </div>
                <span className="ml-auto text-[10px] text-green-700 font-mono shrink-0">
                  Cód. {fornSelecionado.cd_pessoa}
                </span>
                <button
                  onClick={() => {
                    setFornSelecionado(null);
                    setForm((p) => ({
                      ...p,
                      nm_fornecedor: '',
                      cd_fornecedor: '',
                    }));
                  }}
                  className="text-gray-400 hover:text-red-500 shrink-0"
                >
                  <X size={12} weight="bold" />
                </button>
              </div>
            )}
          </div>

          <div className="col-span-2">
            <label className={labelCls}>Fornecedor *</label>
            <input
              className={inputCls}
              value={form.nm_fornecedor}
              onChange={(e) => set('nm_fornecedor', e.target.value)}
              placeholder="Nome do fornecedor (ou use a busca acima)"
            />
          </div>
          <div>
            <label className={labelCls}>Código Fornecedor</label>
            <input
              className={inputCls}
              value={form.cd_fornecedor}
              onChange={(e) => set('cd_fornecedor', e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div>
            <label className={labelCls}>Valor *</label>
            <input
              className={inputCls}
              type="number"
              step="0.01"
              min="0"
              value={form.vl_duplicata}
              onChange={(e) => set('vl_duplicata', e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div>
            <label className={labelCls}>Emissão</label>
            <input
              className={inputCls}
              type="date"
              value={form.dt_emissao}
              onChange={(e) => set('dt_emissao', e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Vencimento *</label>
            <input
              className={inputCls}
              type="date"
              value={form.dt_vencimento}
              onChange={(e) => set('dt_vencimento', e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Despesa / Item</label>
            <input
              className={inputCls}
              value={form.ds_despesaitem}
              onChange={(e) => set('ds_despesaitem', e.target.value)}
              placeholder="Descrição da despesa"
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Centro de Custo</label>
            <input
              className={inputCls}
              value={form.cd_ccusto}
              onChange={(e) => set('cd_ccusto', e.target.value)}
              placeholder="Código do C.C."
            />
          </div>
          <div>
            <label className={labelCls}>Banco</label>
            <select
              className={`${inputCls} bg-white`}
              value={form.banco_pagamento}
              onChange={(e) => set('banco_pagamento', e.target.value)}
            >
              <option value="">— Banco —</option>
              {BANCOS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Forma de Pagamento</label>
            <select
              className={`${inputCls} bg-white`}
              value={form.forma_pagamento}
              onChange={(e) => {
                set('forma_pagamento', e.target.value);
                set('detalhe', '');
              }}
            >
              <option value="">— Forma —</option>
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>
              {formaCfg?.detalheLabel || 'Detalhe Pgto'}
            </label>
            <input
              className={inputCls}
              value={form.detalhe}
              disabled={!formaCfg}
              onChange={(e) => set('detalhe', e.target.value)}
              placeholder={
                formaCfg ? formaCfg.detalheLabel : 'Selecione a forma primeiro'
              }
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Observação</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={2}
              value={form.observacao}
              onChange={(e) => set('observacao', e.target.value)}
              placeholder="Observações adicionais"
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 text-xs font-semibold py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving}
            className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-1"
          >
            {saving ? (
              <Spinner size={12} className="animate-spin" />
            ) : (
              <FloppyDisk size={12} weight="bold" />
            )}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Modal Detalhe Completo da Duplicata ─────────────
const ModalDetalheDuplicata = ({
  item,
  onClose,
  onSave,
  isAdmin,
  isFinanceiro,
}) => {
  const [status, setStatus] = useState(item.status || 'PENDENTE');
  const [vlDuplicata, setVlDuplicata] = useState(
    item.vl_duplicata != null ? String(item.vl_duplicata) : '',
  );
  const [vlReal, setVlReal] = useState(
    item.vl_real != null ? String(item.vl_real) : '',
  );
  const [banco, setBanco] = useState(item.banco_pagamento || '');
  const [forma, setForma] = useState(item.forma_pagamento || '');
  const [detalhe, setDetalhe] = useState(
    item.chave_pix || item.codigo_barras || item.link_pagamento || '',
  );
  const [obs, setObs] = useState(item.observacao || '');
  const [dtPagamento, setDtPagamento] = useState(item.dt_pagamento || '');
  const [saving, setSaving] = useState(false);

  const formaCfg = FORMAS_PAGAMENTO.find((f) => f.value === forma);
  const podeAlterarStatus = isAdmin || isFinanceiro;

  // Snapshot original (campos extras vindos de Contas a Pagar)
  const dc = item.dados_completos || {};

  const camposInfo = [
    { label: 'Empresa', value: item.nm_empresa || dc.nm_empresa },
    { label: 'Cód. Empresa', value: item.cd_empresa || dc.cd_empresa },
    { label: 'Fornecedor', value: item.nm_fornecedor },
    { label: 'Cód. Fornecedor', value: item.cd_fornecedor },
    { label: 'CNPJ/CPF', value: dc.nr_cnpj || dc.nr_cpfcnpj || dc.cnpj },
    { label: 'Nº Duplicata', value: item.nr_duplicata },
    { label: 'Parcela', value: item.nr_parcela },
    { label: 'Portador', value: item.nr_portador },
    {
      label: 'Centro de Custo',
      value: (() => {
        const c = item.cd_ccusto || dc.cd_ccusto;
        return c
          ? `${c}${CENTROS_CUSTO[String(c)] ? ' - ' + CENTROS_CUSTO[String(c)] : ''}`
          : null;
      })(),
    },
    { label: 'Despesa Item', value: item.ds_despesaitem || dc.ds_despesaitem },
    { label: 'Cód. Despesa', value: item.cd_despesaitem || dc.cd_despesaitem },
    {
      label: 'Emissão',
      value: item.dt_emissao ? fmtDate(item.dt_emissao) : null,
    },
    {
      label: 'Vencimento',
      value: item.dt_vencimento ? fmtDate(item.dt_vencimento) : null,
    },
    {
      label: 'Valor Original',
      value:
        dc.vl_original != null
          ? fmtBRL(dc.vl_original)
          : item.vl_duplicata != null
            ? fmtBRL(item.vl_duplicata)
            : null,
    },
    { label: 'Histórico', value: dc.ds_historico || dc.historico },
    {
      label: 'Observação Original',
      value: dc.observacao_original || dc.ds_obs,
    },
  ].filter((c) => c.value !== undefined && c.value !== null && c.value !== '');

  const handleSalvar = async () => {
    setSaving(true);
    const patch = {
      banco_pagamento: banco || null,
      forma_pagamento: forma || null,
      chave_pix: null,
      codigo_barras: null,
      link_pagamento: null,
      observacao: obs.trim() || null,
      vl_duplicata:
        vlDuplicata !== '' && !isNaN(parseFloat(vlDuplicata))
          ? parseFloat(vlDuplicata)
          : item.vl_duplicata,
      vl_real:
        vlReal !== '' && !isNaN(parseFloat(vlReal)) ? parseFloat(vlReal) : null,
    };
    if (formaCfg) patch[formaCfg.campo] = detalhe || null;

    // Se mudou status, deixamos o handler superior (onSave) cuidar das transições
    const statusMudou = status !== item.status;
    const dtPagamentoMudou =
      (dtPagamento || null) !== (item.dt_pagamento || null);

    await onSave({
      patchSimples: patch,
      statusMudou,
      novoStatus: status,
      dtPagamentoMudou,
      novaDtPagamento: dtPagamento || null,
    });
    setSaving(false);
    onClose();
  };

  const inputCls =
    'w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-[#000638]';
  const labelCls = 'text-[10px] font-bold uppercase text-gray-500 mb-0.5 block';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-3xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2">
            <Info size={16} weight="bold" className="text-[#000638]" />
            Detalhes da Duplicata
            <span className="text-xs font-normal text-gray-500">
              · {item.nm_fornecedor}
            </span>
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Bloco: Informações originais (somente leitura) */}
          <div>
            <p className="text-[11px] font-bold uppercase text-gray-700 mb-2 flex items-center gap-1">
              <Receipt size={12} weight="bold" className="text-[#000638]" />
              Informações da Duplicata
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-gray-50 rounded-lg p-3 border border-gray-200">
              {camposInfo.map((c) => (
                <div key={c.label}>
                  <p className="text-[9px] font-bold uppercase text-gray-400 mb-0.5">
                    {c.label}
                  </p>
                  <p className="text-xs text-gray-800 font-semibold break-words">
                    {String(c.value)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Bloco: Edição */}
          <div>
            <p className="text-[11px] font-bold uppercase text-gray-700 mb-2 flex items-center gap-1">
              <PencilSimple
                size={12}
                weight="bold"
                className="text-orange-500"
              />
              Editar
            </p>
            <div className="grid grid-cols-2 gap-3">
              {podeAlterarStatus && (
                <div>
                  <label className={labelCls}>Status</label>
                  <select
                    className={`${inputCls} bg-white`}
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="PENDENTE">Pendente</option>
                    <option value="APROVADO">Aprovado</option>
                    <option value="PAGO">Pago</option>
                    {item.status === 'CANCELADO' && (
                      <option value="CANCELADO">Cancelado</option>
                    )}
                    {item.status === 'TRANSFERENCIA' && (
                      <option value="TRANSFERENCIA">Entre Contas</option>
                    )}
                  </select>
                </div>
              )}

              <div>
                <label className={labelCls}>Data de Pagamento</label>
                <input
                  className={inputCls}
                  type="date"
                  value={dtPagamento}
                  onChange={(e) => setDtPagamento(e.target.value)}
                />
              </div>

              <div>
                <label className={labelCls}>Valor da Duplicata</label>
                <input
                  className={inputCls}
                  type="number"
                  step="0.01"
                  min="0"
                  value={vlDuplicata}
                  onChange={(e) => setVlDuplicata(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Valor Real (pago)</label>
                <input
                  className={inputCls}
                  type="number"
                  step="0.01"
                  min="0"
                  value={vlReal}
                  onChange={(e) => setVlReal(e.target.value)}
                  placeholder="Opcional"
                />
              </div>

              <div>
                <label className={labelCls}>Banco</label>
                <select
                  className={`${inputCls} bg-white`}
                  value={banco}
                  onChange={(e) => setBanco(e.target.value)}
                >
                  <option value="">— Banco —</option>
                  {BANCOS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Forma de Pagamento</label>
                <select
                  className={`${inputCls} bg-white`}
                  value={forma}
                  onChange={(e) => {
                    setForma(e.target.value);
                    setDetalhe('');
                  }}
                >
                  <option value="">— Forma —</option>
                  {FORMAS_PAGAMENTO.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className={labelCls}>
                  {formaCfg?.detalheLabel || 'Detalhe Pgto'}
                </label>
                <input
                  className={inputCls}
                  value={detalhe}
                  disabled={!formaCfg}
                  onChange={(e) => setDetalhe(e.target.value)}
                  placeholder={
                    formaCfg
                      ? formaCfg.detalheLabel
                      : 'Selecione a forma primeiro'
                  }
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Observação</label>
                <textarea
                  className={`${inputCls} resize-none`}
                  rows={3}
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="Observações..."
                />
              </div>
            </div>
          </div>

          {/* Auditoria */}
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">
              Auditoria
            </p>
            <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-600">
              {item.created_at && (
                <p>
                  <span className="font-bold">Inclusão:</span>{' '}
                  {fmtDateTime(item.created_at)}
                </p>
              )}
              {item.aprovado_em && (
                <p>
                  <span className="font-bold">Aprovado:</span>{' '}
                  {fmtDateTime(item.aprovado_em)} · {item.aprovado_por}
                </p>
              )}
              {item.pago_em && (
                <p>
                  <span className="font-bold">Pago em:</span>{' '}
                  {fmtDateTime(item.pago_em)} · {item.pago_por}
                </p>
              )}
              {item.dt_pagamento && (
                <p>
                  <span className="font-bold">Dt. Pagto:</span>{' '}
                  {fmtDate(item.dt_pagamento)}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-3 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="border border-gray-300 text-gray-600 text-xs font-semibold px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving}
            className="bg-[#000638] hover:bg-[#001060] disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1"
          >
            {saving ? (
              <Spinner size={12} className="animate-spin" />
            ) : (
              <FloppyDisk size={12} weight="bold" />
            )}
            Salvar Alterações
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Cabeçalho ordenável ──────────────────────────────
// ─── Modal: Pagar Selecionados ─────────────────────────────
const ModalPagarSelecionados = ({ titulos, onConfirmar, onClose }) => {
  const hoje = new Date().toISOString().slice(0, 10);
  const [datas, setDatas] = useState(() => {
    const m = {};
    titulos.forEach((t) => {
      m[t.id] = t.dt_pagamento || hoje;
    });
    return m;
  });
  const [dataGlobal, setDataGlobal] = useState(hoje);

  const aplicarParaTodos = () => {
    if (!dataGlobal) return;
    setDatas((prev) => {
      const next = { ...prev };
      titulos.forEach((t) => {
        next[t.id] = dataGlobal;
      });
      return next;
    });
  };

  const total = titulos.reduce(
    (acc, t) => acc + parseFloat(t.vl_real ?? t.vl_duplicata ?? 0),
    0,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="text-base font-bold text-gray-800">
              Confirmar Pagamento
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {titulos.length} título(s) · Total:{' '}
              <span className="font-bold text-green-700">{fmtBRL(total)}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Aplicar data global */}
        <div className="px-5 py-3 bg-gray-50 border-b flex items-center gap-3">
          <span className="text-xs font-bold text-gray-600 whitespace-nowrap">
            Aplicar mesma data a todos:
          </span>
          <input
            type="date"
            value={dataGlobal}
            onChange={(e) => setDataGlobal(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-green-500"
          />
          <button
            onClick={aplicarParaTodos}
            className="flex items-center gap-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-bold px-3 py-1 rounded transition-colors"
          >
            Aplicar a todos
          </button>
        </div>

        {/* Lista de títulos */}
        <div className="overflow-y-auto flex-1 px-5 py-3 divide-y divide-gray-100">
          {titulos.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-gray-800 truncate">
                  {t.nm_fornecedor || '—'}
                </div>
                <div className="text-[10px] text-gray-500 flex gap-2 mt-0.5 flex-wrap">
                  <span>
                    {t.nr_duplicata}
                    {t.nr_parcela ? `/${t.nr_parcela}` : ''}
                  </span>
                  {t.banco_pagamento && (
                    <span className="text-[#000638] font-semibold">
                      {t.banco_pagamento}
                    </span>
                  )}
                  <span className="font-semibold text-green-700">
                    {fmtBRL(t.vl_real ?? t.vl_duplicata)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="text-[9px] font-bold text-gray-500 uppercase whitespace-nowrap">
                  Dt. Pag.
                </label>
                <input
                  type="date"
                  value={datas[t.id] || hoje}
                  onChange={(e) =>
                    setDatas((prev) => ({ ...prev, [t.id]: e.target.value }))
                  }
                  className="border border-gray-300 rounded px-1.5 py-1 text-xs focus:ring-1 focus:ring-green-500 w-[130px]"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirmar(datas)}
            className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg transition-colors"
          >
            <CheckCircle size={15} weight="bold" />
            Confirmar Pagamento
          </button>
        </div>
      </div>
    </div>
  );
};

const ThSortable = ({ label, coluna, ordenacao, onSort, className = '' }) => {
  const ativo = ordenacao.coluna === coluna;
  return (
    <th
      className={`px-2 py-2 text-left text-[10px] font-bold uppercase cursor-pointer select-none group ${className}`}
      onClick={() => onSort(coluna)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span
          className={`transition-opacity ${ativo ? 'opacity-100' : 'opacity-30 group-hover:opacity-70'}`}
        >
          {ativo ? (
            ordenacao.dir === 'asc' ? (
              <ArrowUp size={10} weight="bold" />
            ) : (
              <ArrowDown size={10} weight="bold" />
            )
          ) : (
            <ArrowsDownUp size={10} weight="bold" />
          )}
        </span>
      </span>
    </th>
  );
};

// ─── Linha da tabela ──────────────────────────────────
const LinhaTitulo = React.memo(
  ({
    item,
    isAdmin,
    isFinanceiro,
    selecionado,
    onToggleSelect,
    onSalvar,
    onExcluir,
    onMudarStatus,
    onAbrirModal,
    onAbrirDetalhe,
    onToggleBaixado,
    showBaixado,
  }) => {
    const [forma, setForma] = useState(item.forma_pagamento || '');
    const [banco, setBanco] = useState(item.banco_pagamento || '');
    const [detalhe, setDetalhe] = useState(
      item.chave_pix || item.codigo_barras || item.link_pagamento || '',
    );
    const [obs, setObs] = useState(item.observacao || '');
    const [vlReal, setVlReal] = useState(
      item.vl_real != null ? String(item.vl_real) : '',
    );
    const [dtPagamentoLinha, setDtPagamentoLinha] = useState(
      item.dt_pagamento ||
        (item.status === 'APROVADO'
          ? new Date().toISOString().slice(0, 10)
          : ''),
    );
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [showDetalhePopover, setShowDetalhePopover] = useState(false);
    const [showObsPopover, setShowObsPopover] = useState(false);
    const [showVlRealPopover, setShowVlRealPopover] = useState(false);
    const [showAcaoPopover, setShowAcaoPopover] = useState(false);
    const [juros, setJuros] = useState('');
    const [parcial, setParcial] = useState('');
    const [detalheRascunho, setDetalheRascunho] = useState(detalhe);
    const [obsRascunho, setObsRascunho] = useState(obs);

    const formaCfg = FORMAS_PAGAMENTO.find((f) => f.value === forma);
    const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.PENDENTE;
    const StatusIcon = statusCfg.icon;

    const marcarDirty = () => setDirty(true);

    const handleSalvar = async () => {
      setSaving(true);
      const patch = {
        banco_pagamento: banco || null,
        forma_pagamento: forma || null,
        chave_pix: null,
        codigo_barras: null,
        link_pagamento: null,
        observacao: obs || null,
        vl_real:
          vlReal !== '' && !isNaN(parseFloat(vlReal))
            ? parseFloat(vlReal)
            : null,
      };
      if (formaCfg) patch[formaCfg.campo] = detalhe || null;

      await onSalvar(item.id, patch);
      setDirty(false);
      setSaving(false);
    };

    const podeEditar = item.status !== 'PAGO' && item.status !== 'CANCELADO';

    // Datas de auditoria por status
    const linhasAuditoria = [
      { label: 'Inclusão', value: fmtDateTime(item.created_at) },
      item.aprovado_em && {
        label: 'Aprovado',
        value: `${fmtDateTime(item.aprovado_em)} · ${item.aprovado_por || ''}`,
      },
      item.pago_em && {
        label: 'Pago',
        value: `${fmtDateTime(item.pago_em)} · ${item.pago_por || ''}`,
      },
      item.dt_pagamento && {
        label: 'Dt. Pagamento',
        value: fmtDate(item.dt_pagamento),
      },
      item.cancelado_em && {
        label: 'Cancelado',
        value: `${fmtDateTime(item.cancelado_em)} · ${item.cancelado_por || ''}`,
      },
    ].filter(Boolean);

    const isManual = !!item.dados_completos?.inserido_manualmente;
    const isTransferencia = item.status === 'TRANSFERENCIA';

    return (
      <tr
        className={`border-b border-gray-100 ${
          selecionado
            ? 'bg-blue-50'
            : isManual && !isTransferencia
              ? 'bg-orange-50 hover:bg-orange-100'
              : 'hover:bg-gray-50'
        } ${isManual && !isTransferencia ? 'border-l-2 border-l-orange-400' : ''}`}
      >
        <td className="px-2 py-2 text-center">
          {(isAdmin || isFinanceiro) &&
            (item.status === 'PENDENTE' || item.status === 'APROVADO') && (
              <input
                type="checkbox"
                checked={selecionado}
                onChange={() => onToggleSelect(item.id)}
                className="w-4 h-4 accent-[#000638]"
              />
            )}
        </td>
        <td className="px-2 py-2 text-xs">
          {isTransferencia ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-purple-100 text-purple-800 border-purple-300">
              <ArrowsLeftRight size={11} weight="bold" />
              Entre Contas
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusCfg.color}`}
            >
              <StatusIcon size={11} weight="bold" />
              {statusCfg.label}
            </span>
          )}
          {isManual && !isTransferencia && (
            <span className="mt-1 flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-300 font-bold w-fit">
              <PencilSimple size={8} weight="bold" />
              Manual
            </span>
          )}
        </td>

        {/* Baixado (inline ao lado de status) */}
        <td className="px-2 py-2 text-center">
          {item.status === 'PAGO' && !isTransferencia && (
            <label
              className="inline-flex flex-col items-center gap-1 cursor-pointer"
              title={
                item.baixado
                  ? `Baixado${item.baixado_por ? ' por ' + item.baixado_por : ''}${item.baixado_em ? ' em ' + new Date(item.baixado_em).toLocaleString('pt-BR') : ''}`
                  : 'Marcar como baixado no TOTVS'
              }
            >
              <input
                type="checkbox"
                checked={!!item.baixado}
                onChange={() => onToggleBaixado(item.id, !item.baixado)}
                className="w-4 h-4 accent-emerald-600 cursor-pointer"
              />
              <span
                className={`text-[9px] font-bold leading-none ${
                  item.baixado ? 'text-emerald-600' : 'text-gray-400'
                }`}
              >
                {item.baixado ? 'SIM' : 'Não'}
              </span>
            </label>
          )}
        </td>
        <td className="px-5 py-5 text-xs">
          <div className="">
            <div className="flex items-center text-gray-500">
              <span className="text-[9px] font-bold uppercase w-14 shrink-0 text-gray-400">
                Venc. - {fmtDate(item.dt_vencimento) || '—'}
              </span>
            </div>
            {item.dt_pagamento && (
              <div className="flex items-center ">
                <span className="text-[9px] font-bold uppercase w-14 shrink-0 text-green-800">
                  Pgto. - {fmtDate(item.dt_pagamento)}
                </span>
              </div>
            )}
          </div>
        </td>
        <td className="px-2 py-2 text-xs font-semibold text-green-700">
          {fmtBRL(item.vl_duplicata)}
        </td>
        <td className="px-2 py-2 text-xs w-28">
          {podeEditar && !isTransferencia ? (
            <div className="relative flex items-center gap-1">
              {vlReal ? (
                <span className="text-xs font-bold text-blue-700 truncate max-w-[70px]">
                  {fmtBRL(vlReal)}
                </span>
              ) : (
                <span className="text-[10px] text-gray-400">—</span>
              )}
              <button
                onClick={() => {
                  const base = parseFloat(item.vl_duplicata || 0);
                  const currentReal = vlReal !== '' ? parseFloat(vlReal) : null;
                  // Reverse-engineer juros/parcial from existing vl_real
                  setJuros('');
                  setParcial(currentReal != null ? String(currentReal) : '');
                  setShowVlRealPopover((v) => !v);
                  setShowDetalhePopover(false);
                  setShowObsPopover(false);
                }}
                className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300 transition-colors"
                title="Juros / Parcial"
              >
                <PlusCircle size={11} weight="bold" />
              </button>
              {showVlRealPopover && (
                <div className="absolute z-30 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-3 w-60">
                  <p className="text-[10px] font-bold text-gray-600 uppercase mb-2">
                    Ajuste de Valor
                  </p>
                  <div className="space-y-2 mb-3">
                    <div>
                      <label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">
                        Parcial (substitui)
                      </label>
                      <div className="relative">
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
                          R$
                        </span>
                        <input
                          autoFocus
                          type="number"
                          step="0.01"
                          min="0"
                          value={parcial}
                          onChange={(e) => setParcial(e.target.value)}
                          placeholder={String(item.vl_duplicata)}
                          className="w-full border border-gray-300 rounded pl-6 pr-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">
                        Juros (soma)
                      </label>
                      <div className="relative">
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
                          R$
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={juros}
                          onChange={(e) => setJuros(e.target.value)}
                          placeholder="0,00"
                          className="w-full border border-gray-300 rounded pl-6 pr-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                  {/* Preview */}
                  {(parcial || juros) && (
                    <div className="bg-blue-50 rounded px-2 py-1 mb-2 text-[10px] text-blue-700 font-semibold">
                      Valor real:{' '}
                      {fmtBRL(
                        (parcial !== ''
                          ? parseFloat(parcial)
                          : parseFloat(item.vl_duplicata || 0)) +
                          (juros !== '' ? parseFloat(juros) : 0),
                      )}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => {
                        setVlReal('');
                        marcarDirty();
                        setShowVlRealPopover(false);
                      }}
                      className="flex-1 border border-gray-300 text-gray-500 text-[10px] font-semibold py-1 rounded hover:bg-gray-50"
                    >
                      Limpar
                    </button>
                    <button
                      onClick={() => {
                        const base =
                          parcial !== ''
                            ? parseFloat(parcial)
                            : parseFloat(item.vl_duplicata || 0);
                        const j = juros !== '' ? parseFloat(juros) : 0;
                        const resultado = base + j;
                        setVlReal(String(resultado));
                        marcarDirty();
                        setShowVlRealPopover(false);
                      }}
                      className="flex-1 bg-blue-600 text-white text-[10px] font-semibold py-1 rounded hover:bg-blue-700"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span
              className={
                item.vl_real != null
                  ? 'font-bold text-blue-700'
                  : 'text-gray-400 text-[10px]'
              }
            >
              {item.vl_real != null ? fmtBRL(item.vl_real) : '—'}
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-xs">
          <div
            className="font-medium text-gray-800 truncate max-w-[180px]"
            title={item.nm_fornecedor}
          >
            {item.nm_fornecedor || '—'}
          </div>
          <div className="text-[10px] text-gray-500">
            Cód. {item.cd_fornecedor || '—'}
          </div>
        </td>
        <td
          className="px-2 py-2 text-xs text-gray-700 truncate max-w-[160px]"
          title={item.ds_despesaitem}
        >
          {item.ds_despesaitem || '—'}
        </td>
        <td className="px-2 py-2 text-xs text-gray-600">
          {item.cd_ccusto ? (
            <div
              title={`${item.cd_ccusto} - ${CENTROS_CUSTO[String(item.cd_ccusto)] || ''}`}
            >
              <span className="font-mono text-[9px] text-gray-400">
                {item.cd_ccusto}
              </span>
              {CENTROS_CUSTO[String(item.cd_ccusto)] && (
                <div className="text-[10px] font-semibold text-gray-700 leading-tight truncate max-w-[90px]">
                  {CENTROS_CUSTO[String(item.cd_ccusto)]}
                </div>
              )}
            </div>
          ) : (
            <span className="text-gray-400 text-[10px]">—</span>
          )}
        </td>
        <td className="px-2 py-2 text-xs text-gray-700">
          {item.nr_duplicata || '—'}
          {item.nr_parcela ? `/${item.nr_parcela}` : ''}
        </td>
        <td className="px-2 py-2">
          {podeEditar && !isTransferencia ? (
            <select
              value={banco}
              onChange={(e) => {
                setBanco(e.target.value);
                marcarDirty();
              }}
              className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:ring-1 focus:ring-[#000638]"
            >
              <option value="">— Banco —</option>
              {BANCOS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          ) : (
            <div>
              {item.banco_pagamento ? (
                <div className="flex items-center gap-1 text-xs font-semibold text-gray-700">
                  <Bank size={11} className="text-[#000638]" />
                  {item.banco_pagamento}
                </div>
              ) : (
                <span className="text-[10px] text-gray-400">—</span>
              )}
            </div>
          )}
        </td>
        <td className="px-2 py-2">
          {podeEditar && !isTransferencia ? (
            <select
              value={forma}
              onChange={(e) => {
                setForma(e.target.value);
                setDetalhe('');
                marcarDirty();
              }}
              className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs bg-white focus:ring-1 focus:ring-[#000638]"
            >
              <option value="">— Forma —</option>
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          ) : (
            <div>
              {item.forma_pagamento ? (
                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-semibold border border-gray-200">
                  {FORMAS_PAGAMENTO.find(
                    (f) => f.value === item.forma_pagamento,
                  )?.label || item.forma_pagamento}
                </span>
              ) : (
                <span className="text-[10px] text-gray-400">—</span>
              )}
            </div>
          )}
        </td>
        <td className="px-2 py-2">
          {podeEditar && !isTransferencia ? (
            <div className="relative">
              <button
                onClick={() => {
                  setDetalheRascunho(detalhe);
                  setShowDetalhePopover((v) => !v);
                  setShowObsPopover(false);
                }}
                disabled={!formaCfg}
                className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
                  !formaCfg
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : detalhe
                      ? 'bg-green-50 text-green-700 border-green-300 hover:bg-green-100'
                      : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'
                }`}
              >
                <Info size={10} weight="bold" />
                {formaCfg ? formaCfg.label : 'Forma'}
                {detalhe && (
                  <span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                )}
              </button>
              {showDetalhePopover && formaCfg && (
                <div className="absolute z-30 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-3 w-64">
                  <p className="text-[10px] font-bold text-gray-600 uppercase mb-1.5">
                    {formaCfg.detalheLabel}
                  </p>
                  <input
                    autoFocus
                    value={detalheRascunho}
                    onChange={(e) => setDetalheRascunho(e.target.value)}
                    placeholder={formaCfg.detalheLabel}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-[#000638] mb-2"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setShowDetalhePopover(false);
                      if (e.key === 'Enter') {
                        setDetalhe(detalheRascunho);
                        marcarDirty();
                        setShowDetalhePopover(false);
                      }
                    }}
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setShowDetalhePopover(false)}
                      className="flex-1 border border-gray-300 text-gray-600 text-[10px] font-semibold py-1 rounded hover:bg-gray-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => {
                        setDetalhe(detalheRascunho);
                        marcarDirty();
                        setShowDetalhePopover(false);
                      }}
                      className="flex-1 bg-[#000638] text-white text-[10px] font-semibold py-1 rounded hover:bg-[#001060]"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              {item.chave_pix || item.codigo_barras || item.link_pagamento ? (
                <button
                  onClick={() => onAbrirModal(item)}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                >
                  <Info size={10} weight="bold" />
                  Detalhe
                </button>
              ) : (
                <span className="text-gray-400 text-xs">—</span>
              )}
            </div>
          )}
        </td>
        <td className="px-2 py-2">
          {podeEditar && !isTransferencia ? (
            <div className="relative">
              <button
                onClick={() => {
                  setObsRascunho(obs);
                  setShowObsPopover((v) => !v);
                  setShowDetalhePopover(false);
                }}
                className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
                  obs
                    ? 'bg-orange-50 text-orange-700 border-orange-300 hover:bg-orange-100'
                    : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'
                }`}
              >
                <ChatCircleText size={10} weight="bold" />
                OBS
                {obs && (
                  <span className="ml-1 w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
                )}
              </button>
              {showObsPopover && (
                <div className="absolute z-30 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-3 w-64">
                  <p className="text-[10px] font-bold text-gray-600 uppercase mb-1.5">
                    Observação
                  </p>
                  <textarea
                    autoFocus
                    rows={3}
                    value={obsRascunho}
                    onChange={(e) => setObsRascunho(e.target.value)}
                    placeholder="Adicione uma observação..."
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-[#000638] resize-none mb-2"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setShowObsPopover(false);
                    }}
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setShowObsPopover(false)}
                      className="flex-1 border border-gray-300 text-gray-600 text-[10px] font-semibold py-1 rounded hover:bg-gray-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => {
                        setObs(obsRascunho);
                        marcarDirty();
                        setShowObsPopover(false);
                      }}
                      className="flex-1 bg-[#000638] text-white text-[10px] font-semibold py-1 rounded hover:bg-[#001060]"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              {item.observacao ? (
                <button
                  onClick={() => onAbrirModal(item)}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors"
                >
                  <ChatCircleText size={10} weight="bold" />
                  Obs
                </button>
              ) : (
                <span className="text-gray-400 text-xs">—</span>
              )}
            </div>
          )}
        </td>
        {/* ── Coluna AÇÕES: salvar + botão AÇÃO ── */}
        <td className="px-2 py-2">
          <div className="flex items-center gap-1 justify-center relative">
            {/* Salvar */}
            {podeEditar && (
              <button
                onClick={handleSalvar}
                disabled={saving || !dirty}
                className="flex items-center justify-center bg-[#000638] hover:bg-[#001060] disabled:opacity-40 text-white text-[10px] font-semibold w-7 h-7 rounded transition-colors"
                title="Salvar alterações"
              >
                {saving ? (
                  <Spinner size={11} className="animate-spin" />
                ) : (
                  <FloppyDisk size={11} weight="bold" />
                )}
              </button>
            )}

            {/* Botão AÇÃO */}
            {(isAdmin || isFinanceiro) && !isTransferencia && (
              <div className="relative">
                <button
                  onClick={() => setShowAcaoPopover((v) => !v)}
                  className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold px-2 h-7 rounded transition-colors"
                  title="Ações disponíveis"
                >
                  AÇÃO
                </button>

                {showAcaoPopover && (
                  <>
                    {/* overlay transparente para fechar */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowAcaoPopover(false)}
                    />
                    <div className="absolute z-50 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl p-3 w-60">
                      <p className="text-[10px] font-bold text-gray-500 uppercase mb-2 border-b pb-1">
                        Ações — {item.nr_duplicata}
                        {item.nr_parcela ? `/${item.nr_parcela}` : ''}
                      </p>

                      <div className="flex flex-col gap-1.5">
                        {/* Data de pagamento (APROVADO) */}
                        {item.status === 'APROVADO' && (
                          <div className="flex items-center gap-2 bg-green-50 rounded px-2 py-1.5 border border-green-200">
                            <label className="text-[9px] font-bold text-green-700 whitespace-nowrap">
                              DT. PAG.
                            </label>
                            <input
                              type="date"
                              value={dtPagamentoLinha}
                              onChange={(e) =>
                                setDtPagamentoLinha(e.target.value)
                              }
                              className="flex-1 border border-green-300 rounded px-1 py-0.5 text-[10px] focus:ring-1 focus:ring-green-500 bg-white"
                            />
                          </div>
                        )}

                        {/* APROVAR */}
                        {item.status === 'PENDENTE' && (
                          <button
                            onClick={() => {
                              const extra = {
                                banco_pagamento: banco || null,
                                forma_pagamento: forma || null,
                                chave_pix: null,
                                codigo_barras: null,
                                link_pagamento: null,
                                observacao: obs || null,
                              };
                              if (formaCfg)
                                extra[formaCfg.campo] = detalhe || null;
                              onMudarStatus(item.id, 'APROVADO', extra);
                              setShowAcaoPopover(false);
                            }}
                            className="flex items-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors"
                          >
                            <Stamp size={12} weight="bold" />
                            Aprovar
                          </button>
                        )}

                        {/* PAGAR */}
                        {item.status === 'APROVADO' && (
                          <button
                            onClick={() => {
                              const extra = {
                                banco_pagamento: banco || null,
                                forma_pagamento: forma || null,
                                chave_pix: null,
                                codigo_barras: null,
                                link_pagamento: null,
                                observacao: obs || null,
                                vl_real:
                                  vlReal !== '' && !isNaN(parseFloat(vlReal))
                                    ? parseFloat(vlReal)
                                    : null,
                                dt_pagamento:
                                  dtPagamentoLinha ||
                                  new Date().toISOString().slice(0, 10),
                              };
                              if (formaCfg)
                                extra[formaCfg.campo] = detalhe || null;
                              onMudarStatus(item.id, 'PAGO', extra);
                              setShowAcaoPopover(false);
                            }}
                            className="flex items-center gap-2 w-full bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors"
                          >
                            <CheckCircle size={12} weight="bold" />
                            Pagar
                          </button>
                        )}

                        {/* Voltar para APROVADO (se PAGO) */}
                        {item.status === 'PAGO' && (
                          <button
                            onClick={() => {
                              onMudarStatus(item.id, 'APROVADO');
                              setShowAcaoPopover(false);
                            }}
                            className="flex items-center gap-2 w-full bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs font-bold px-3 py-1.5 rounded border border-blue-300 transition-colors"
                          >
                            <Stamp size={12} weight="bold" />
                            Voltar para Aprovado
                          </button>
                        )}

                        {/* Voltar para PENDENTE (se APROVADO ou PAGO) */}
                        {(item.status === 'APROVADO' ||
                          item.status === 'PAGO') && (
                          <button
                            onClick={() => {
                              onMudarStatus(item.id, 'PENDENTE');
                              setShowAcaoPopover(false);
                            }}
                            className="flex items-center gap-2 w-full bg-yellow-50 hover:bg-yellow-100 text-yellow-800 text-xs font-bold px-3 py-1.5 rounded border border-yellow-300 transition-colors"
                          >
                            <Clock size={12} weight="bold" />
                            Voltar para Pendente
                          </button>
                        )}

                        {/* EXCLUIR */}
                        {item.status !== 'PAGO' &&
                          item.status !== 'CANCELADO' && (
                            <button
                              onClick={() => {
                                onExcluir(item.id);
                                setShowAcaoPopover(false);
                              }}
                              className="flex items-center gap-2 w-full bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold px-3 py-1.5 rounded border border-red-200 transition-colors mt-1"
                            >
                              <Trash size={12} weight="bold" />
                              Excluir
                            </button>
                          )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </td>

        {/* ── Coluna DETALHAR ── */}
        <td className="px-2 py-2 text-center">
          {!isTransferencia && (
            <button
              onClick={() => onAbrirDetalhe(item)}
              className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-bold px-2 py-1 rounded border border-gray-300 transition-colors mx-auto"
              title="Ver detalhes completos"
            >
              <Info size={10} weight="bold" />
              Detalhar
            </button>
          )}
        </td>
      </tr>
    );
  },
);
LinhaTitulo.displayName = 'LinhaTitulo';

// ─── Página principal ──────────────────────────────────
const LiberacaoPagamento = () => {
  const { user, hasAnyRole } = useAuth() || {};
  const isAdmin = hasAnyRole?.(['owner', 'admin']) || false;
  const isFinanceiro = hasAnyRole?.(['user']) || false;

  const [titulos, setTitulos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('PENDENTE');
  const [selecionados, setSelecionados] = useState(new Set());
  const [processando, setProcessando] = useState(false);
  const [processandoId, setProcessandoId] = useState(null);
  const [modalItem, setModalItem] = useState(null);
  // Saldo bancário
  const [saldos, setSaldos] = useState([]);
  const [showModalSaldo, setShowModalSaldo] = useState(false);
  const [showModalTransferencia, setShowModalTransferencia] = useState(false);
  // Filtros extras (PAGO)
  const [filtroFornecedor, setFiltroFornecedor] = useState('');
  const [filtroBancoFiltro, setFiltroBancoFiltro] = useState('');
  const [filtroValorMin, setFiltroValorMin] = useState('');
  const [filtroValorMax, setFiltroValorMax] = useState('');
  const [filtroSoManuais, setFiltroSoManuais] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState('TODOS'); // TODOS | PAGAMENTO | TRANSFERENCIA
  const [filtroInclusao, setFiltroInclusao] = useState('TODOS'); // TODOS | TOTVS | MANUAL
  const [filtroForma, setFiltroForma] = useState(''); // '' | PIX | BOLETO | DEBITO | CREDITO
  const [filtroPagamentoDe, setFiltroPagamentoDe] = useState('');
  const [filtroPagamentoAte, setFiltroPagamentoAte] = useState('');
  const [filtroBaixado, setFiltroBaixado] = useState(''); // '' | 'SIM' | 'NAO'
  const [showModalAdicionar, setShowModalAdicionar] = useState(false);
  const [modalDetalhe, setModalDetalhe] = useState(null);
  const [ordenacao, setOrdenacao] = useState({ coluna: null, dir: 'asc' });
  // Modal de pagamento em lote
  const [modalPagarSelecionados, setModalPagarSelecionados] = useState(false);

  const toggleOrdem = useCallback((coluna) => {
    setOrdenacao((prev) =>
      prev.coluna === coluna
        ? { coluna, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { coluna, dir: 'asc' },
    );
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    const { data, error } = await supabase
      .from('pagamentos_liberacao')
      .select('*')
      .order('dt_vencimento', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) setErro(error.message);
    else setTitulos(data || []);
    setLoading(false);
  }, []);

  const carregarSaldos = useCallback(async () => {
    const { data } = await supabase.from('saldo_bancario').select('*');
    setSaldos(data || []);
  }, []);

  useEffect(() => {
    carregar();
    carregarSaldos();
  }, [carregar, carregarSaldos]);

  const titulosFiltrados = useMemo(() => {
    // Filtro por Tipo (Pagamento vs Entre Contas)
    let lista;
    if (filtroTipo === 'TRANSFERENCIA') {
      lista = titulos.filter((t) => t.status === 'TRANSFERENCIA');
    } else if (filtroTipo === 'PAGAMENTO') {
      lista = titulos.filter((t) => t.status !== 'TRANSFERENCIA');
    } else {
      // TODOS: respeita filtroStatus
      lista =
        filtroStatus === 'TODOS'
          ? titulos.filter((t) => t.status !== 'TRANSFERENCIA')
          : titulos.filter((t) => t.status === filtroStatus);
    }
    // Se tipo for PAGAMENTO e tiver filtro de status, aplica também
    if (filtroTipo === 'PAGAMENTO' && filtroStatus !== 'TODOS') {
      lista = lista.filter((t) => t.status === filtroStatus);
    }
    if (filtroFornecedor.trim()) {
      const q = filtroFornecedor.toLowerCase();
      lista = lista.filter((t) =>
        (t.nm_fornecedor || '').toLowerCase().includes(q),
      );
    }
    if (filtroBancoFiltro) {
      lista = lista.filter((t) => t.banco_pagamento === filtroBancoFiltro);
    }
    if (filtroValorMin !== '') {
      lista = lista.filter(
        (t) => parseFloat(t.vl_duplicata || 0) >= parseFloat(filtroValorMin),
      );
    }
    if (filtroValorMax !== '') {
      lista = lista.filter(
        (t) => parseFloat(t.vl_duplicata || 0) <= parseFloat(filtroValorMax),
      );
    }
    if (filtroForma) {
      lista = lista.filter((t) => t.forma_pagamento === filtroForma);
    }
    // Filtro por data de pagamento (apenas faz sentido em PAGO)
    if (filtroPagamentoDe) {
      lista = lista.filter((t) => {
        const d = t.dt_pagamento || (t.pago_em ? t.pago_em.slice(0, 10) : null);
        return d && d >= filtroPagamentoDe;
      });
    }
    if (filtroPagamentoAte) {
      lista = lista.filter((t) => {
        const d = t.dt_pagamento || (t.pago_em ? t.pago_em.slice(0, 10) : null);
        return d && d <= filtroPagamentoAte;
      });
    }
    if (filtroInclusao === 'MANUAL') {
      lista = lista.filter((t) => !!t.dados_completos?.inserido_manualmente);
    } else if (filtroInclusao === 'TOTVS') {
      lista = lista.filter(
        (t) =>
          !t.dados_completos?.inserido_manualmente &&
          !t.dados_completos?.transferencia_entre_contas,
      );
    }
    if (filtroBaixado === 'SIM') {
      lista = lista.filter((t) => !!t.baixado);
    } else if (filtroBaixado === 'NAO') {
      lista = lista.filter((t) => !t.baixado);
    }
    // Ordenação
    if (ordenacao.coluna) {
      const { coluna, dir } = ordenacao;
      lista = [...lista].sort((a, b) => {
        let va, vb;
        if (coluna === 'vl_duplicata') {
          va = parseFloat(a.vl_duplicata || 0);
          vb = parseFloat(b.vl_duplicata || 0);
        } else if (coluna === 'nm_fornecedor') {
          va = (a.nm_fornecedor || '').toLowerCase();
          vb = (b.nm_fornecedor || '').toLowerCase();
        } else if (coluna === 'dt_vencimento') {
          va = a.dt_vencimento || '';
          vb = b.dt_vencimento || '';
        } else if (coluna === 'ds_historico') {
          va = (a.ds_historico || '').toLowerCase();
          vb = (b.ds_historico || '').toLowerCase();
        } else if (coluna === 'banco_pagamento') {
          va = (a.banco_pagamento || '').toLowerCase();
          vb = (b.banco_pagamento || '').toLowerCase();
        } else if (coluna === 'forma_pagamento') {
          va = (a.forma_pagamento || '').toLowerCase();
          vb = (b.forma_pagamento || '').toLowerCase();
        } else {
          return 0;
        }
        if (va < vb) return dir === 'asc' ? -1 : 1;
        if (va > vb) return dir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return lista;
  }, [
    titulos,
    filtroStatus,
    filtroTipo,
    filtroFornecedor,
    filtroBancoFiltro,
    filtroForma,
    filtroValorMin,
    filtroValorMax,
    filtroInclusao,
    filtroSoManuais,
    filtroPagamentoDe,
    filtroPagamentoAte,
    filtroBaixado,
    ordenacao,
  ]);

  const { totalSaldo, bancosSaldoCount } = useMemo(
    () => ({
      totalSaldo: saldos.reduce((s, r) => s + parseFloat(r.valor || 0), 0),
      bancosSaldoCount: saldos.filter((r) => parseFloat(r.valor || 0) > 0)
        .length,
    }),
    [saldos],
  );

  const temFiltroExtra =
    filtroFornecedor ||
    filtroBancoFiltro ||
    filtroForma ||
    filtroValorMin ||
    filtroValorMax ||
    filtroSoManuais ||
    filtroTipo !== 'TODOS' ||
    filtroInclusao !== 'TODOS' ||
    filtroPagamentoDe ||
    filtroPagamentoAte;

  const limparFiltros = () => {
    setFiltroFornecedor('');
    setFiltroBancoFiltro('');
    setFiltroForma('');
    setFiltroValorMin('');
    setFiltroValorMax('');
    setFiltroSoManuais(false);
    setFiltroTipo('TODOS');
    setFiltroInclusao('TODOS');
    setFiltroStatus('TODOS');
    setFiltroPagamentoDe('');
    setFiltroPagamentoAte('');
  };

  const resumo = useMemo(() => {
    const agg = {
      PENDENTE: 0,
      APROVADO: 0,
      PAGO: 0,
      CANCELADO: 0,
      total: 0,
      valor: 0,
    };
    titulos.forEach((t) => {
      agg[t.status] = (agg[t.status] || 0) + 1;
      agg.total++;
      if (t.status !== 'CANCELADO' && t.status !== 'TRANSFERENCIA')
        agg.valor += parseFloat(t.vl_duplicata || 0);
    });
    return agg;
  }, [titulos]);

  const valorSelecionado = useMemo(() => {
    let v = 0;
    selecionados.forEach((id) => {
      const t = titulos.find((x) => x.id === id);
      if (t && t.status !== 'TRANSFERENCIA')
        v += parseFloat(t.vl_real != null ? t.vl_real : t.vl_duplicata || 0);
    });
    return v;
  }, [selecionados, titulos]);

  const { valorAprovados, qtdAprovados } = useMemo(() => {
    const aprovados = titulos.filter((t) => t.status === 'APROVADO');
    return {
      qtdAprovados: aprovados.length,
      valorAprovados: aprovados.reduce(
        (acc, t) =>
          acc + parseFloat(t.vl_real != null ? t.vl_real : t.vl_duplicata || 0),
        0,
      ),
    };
  }, [titulos]);

  const toggleSelect = useCallback((id) => {
    setSelecionados((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const selecionarTodosVisiveis = () => {
    const selecionaveis = titulosFiltrados.filter(
      (t) => t.status === 'PENDENTE' || t.status === 'APROVADO',
    );
    if (selecionados.size === selecionaveis.length && selecionaveis.length > 0)
      setSelecionados(new Set());
    else setSelecionados(new Set(selecionaveis.map((t) => t.id)));
  };

  const salvarTitulo = useCallback(async (id, patch) => {
    const { error } = await supabase
      .from('pagamentos_liberacao')
      .update(patch)
      .eq('id', id);
    if (error) alert('Erro ao salvar: ' + error.message);
    else {
      setTitulos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    }
  }, []);

  const excluirTitulo = useCallback(async (id) => {
    if (!window.confirm('Confirmar exclusão deste título?')) return;
    const { error } = await supabase
      .from('pagamentos_liberacao')
      .delete()
      .eq('id', id);
    if (error) alert('Erro: ' + error.message);
    else {
      setTitulos((prev) => prev.filter((t) => t.id !== id));
      setSelecionados((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }, []);

  const aprovarTitulo = useCallback(
    async (id, extraData = {}) => {
      if (!window.confirm('Confirmar aprovação deste título?')) return;
      setProcessandoId(id);
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('pagamentos_liberacao')
        .update({
          status: 'APROVADO',
          aprovado_por: user?.email || null,
          aprovado_em: now,
          ...extraData,
        })
        .eq('id', id);
      setProcessandoId(null);
      if (error) alert('Erro ao aprovar: ' + error.message);
      else
        setTitulos((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: 'APROVADO',
                  aprovado_por: user?.email,
                  aprovado_em: now,
                  ...extraData,
                }
              : t,
          ),
        );
    },
    [user],
  );

  // Helper: ajusta saldo bancário em + ou - delta
  const ajustarSaldoBanco = useCallback(
    async (banco, delta, now) => {
      if (!banco || !delta) return;
      const { data: row } = await supabase
        .from('saldo_bancario')
        .select('valor')
        .eq('banco', banco)
        .maybeSingle();
      const novoSaldo = parseFloat(row?.valor || 0) + delta;
      await supabase.from('saldo_bancario').upsert(
        {
          banco,
          valor: novoSaldo,
          updated_at: now,
          updated_by: user?.email || null,
        },
        { onConflict: 'banco' },
      );
      setSaldos((prev) => {
        const existe = prev.some((r) => r.banco === banco);
        if (existe)
          return prev.map((r) =>
            r.banco === banco ? { ...r, valor: novoSaldo } : r,
          );
        return [...prev, { banco, valor: novoSaldo }];
      });
    },
    [user],
  );

  // Mudança de status (forward ou backward) com ajuste de saldo automático.
  // novoStatus: 'PENDENTE' | 'APROVADO' | 'PAGO'
  // extra pode incluir: dt_pagamento, banco_pagamento, forma_pagamento, etc.
  const mudarStatusTitulo = useCallback(
    async (id, novoStatus, extra = {}, opts = {}) => {
      const titulo = titulos.find((t) => t.id === id);
      if (!titulo) return;
      const oldStatus = titulo.status;
      if (oldStatus === novoStatus) return;
      const labels = {
        PENDENTE: 'Pendente',
        APROVADO: 'Aprovado',
        PAGO: 'Pago',
      };
      if (
        !opts.skipConfirm &&
        !window.confirm(
          `Mover este título de ${labels[oldStatus] || oldStatus} para ${labels[novoStatus] || novoStatus}?`,
        )
      )
        return;
      setProcessandoId(id);
      const now = new Date().toISOString();
      const patch = { status: novoStatus, ...extra };

      if (novoStatus === 'PENDENTE') {
        patch.aprovado_em = null;
        patch.aprovado_por = null;
        patch.pago_em = null;
        patch.pago_por = null;
        patch.dt_pagamento = null;
      } else if (novoStatus === 'APROVADO') {
        patch.aprovado_em = titulo.aprovado_em || now;
        patch.aprovado_por = titulo.aprovado_por || user?.email || null;
        patch.pago_em = null;
        patch.pago_por = null;
        patch.dt_pagamento = null;
      } else if (novoStatus === 'PAGO') {
        patch.aprovado_em = titulo.aprovado_em || now;
        patch.aprovado_por = titulo.aprovado_por || user?.email || null;
        patch.pago_em = now;
        patch.pago_por = user?.email || null;
        patch.dt_pagamento =
          extra.dt_pagamento ||
          titulo.dt_pagamento ||
          new Date().toISOString().slice(0, 10);
      }

      const { error } = await supabase
        .from('pagamentos_liberacao')
        .update(patch)
        .eq('id', id);
      if (error) {
        setProcessandoId(null);
        alert('Erro ao alterar status: ' + error.message);
        return;
      }

      // Ajuste de saldo bancário
      const banco = patch.banco_pagamento ?? titulo.banco_pagamento;
      const valorBase = parseFloat(
        patch.vl_real ?? titulo.vl_real ?? titulo.vl_duplicata ?? 0,
      );
      if (banco && valorBase) {
        if (oldStatus === 'PAGO' && novoStatus !== 'PAGO') {
          await ajustarSaldoBanco(banco, +valorBase, now);
        } else if (oldStatus !== 'PAGO' && novoStatus === 'PAGO') {
          await ajustarSaldoBanco(banco, -valorBase, now);
        }
      }

      setProcessandoId(null);
      setTitulos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    },
    [titulos, user, ajustarSaldoBanco],
  );

  // Mudança de status em lote
  const mudarStatusSelecionados = useCallback(
    async (novoStatus, dtPagamento) => {
      const ids = Array.from(selecionados).filter((id) => {
        const t = titulos.find((x) => x.id === id);
        return t && t.status !== novoStatus && t.status !== 'TRANSFERENCIA';
      });
      if (ids.length === 0) {
        alert('Nenhum título elegível selecionado.');
        return;
      }
      const labels = {
        PENDENTE: 'Pendente',
        APROVADO: 'Aprovado',
        PAGO: 'Pago',
      };
      if (
        !window.confirm(
          `Mover ${ids.length} título(s) para ${labels[novoStatus]}?`,
        )
      )
        return;
      setProcessando(true);
      const now = new Date().toISOString();
      for (const id of ids) {
        const titulo = titulos.find((t) => t.id === id);
        if (!titulo) continue;
        const oldStatus = titulo.status;
        const patch = { status: novoStatus };
        if (novoStatus === 'PENDENTE') {
          patch.aprovado_em = null;
          patch.aprovado_por = null;
          patch.pago_em = null;
          patch.pago_por = null;
          patch.dt_pagamento = null;
        } else if (novoStatus === 'APROVADO') {
          patch.aprovado_em = titulo.aprovado_em || now;
          patch.aprovado_por = titulo.aprovado_por || user?.email || null;
          patch.pago_em = null;
          patch.pago_por = null;
          patch.dt_pagamento = null;
        } else if (novoStatus === 'PAGO') {
          patch.aprovado_em = titulo.aprovado_em || now;
          patch.aprovado_por = titulo.aprovado_por || user?.email || null;
          patch.pago_em = now;
          patch.pago_por = user?.email || null;
          patch.dt_pagamento =
            titulo.dt_pagamento ||
            dtPagamento ||
            new Date().toISOString().slice(0, 10);
        }
        const { error } = await supabase
          .from('pagamentos_liberacao')
          .update(patch)
          .eq('id', id);
        if (error) {
          alert(
            `Erro no título ${titulo.nm_fornecedor || id}: ${error.message}`,
          );
          continue;
        }
        const banco = titulo.banco_pagamento;
        const valorBase = parseFloat(
          titulo.vl_real != null ? titulo.vl_real : titulo.vl_duplicata || 0,
        );
        if (banco && valorBase) {
          if (oldStatus === 'PAGO' && novoStatus !== 'PAGO') {
            await ajustarSaldoBanco(banco, +valorBase, now);
          } else if (oldStatus !== 'PAGO' && novoStatus === 'PAGO') {
            await ajustarSaldoBanco(banco, -valorBase, now);
          }
        }
        setTitulos((prev) =>
          prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        );
      }
      setProcessando(false);
      setSelecionados(new Set());
    },
    [selecionados, titulos, user, ajustarSaldoBanco],
  );

  const aprovarSelecionados = useCallback(async () => {
    if (selecionados.size === 0) {
      alert('Selecione pelo menos um título.');
      return;
    }
    if (
      !window.confirm(`Confirmar aprovação de ${selecionados.size} título(s)?`)
    )
      return;
    setProcessando(true);
    const ids = Array.from(selecionados);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('pagamentos_liberacao')
      .update({
        status: 'APROVADO',
        aprovado_por: user?.email || null,
        aprovado_em: now,
      })
      .in('id', ids);
    setProcessando(false);
    if (error) {
      alert('Erro ao aprovar: ' + error.message);
      return;
    }
    setSelecionados(new Set());
    setTitulos((prev) =>
      prev.map((t) =>
        ids.includes(t.id)
          ? {
              ...t,
              status: 'APROVADO',
              aprovado_por: user?.email,
              aprovado_em: now,
            }
          : t,
      ),
    );
  }, [selecionados, user]);

  // Recebe mapa { id: 'YYYY-MM-DD' } vindo do ModalPagarSelecionados
  const pagarSelecionados = useCallback(
    async (datasMap) => {
      const hoje = new Date().toISOString().slice(0, 10);
      const ids = Array.from(selecionados).filter((id) => {
        const t = titulos.find((x) => x.id === id);
        return t?.status === 'APROVADO';
      });
      if (ids.length === 0) return;
      setModalPagarSelecionados(false);
      setProcessando(true);
      const now = new Date().toISOString();
      for (const id of ids) {
        const t = titulos.find((x) => x.id === id);
        if (!t) continue;
        const patch = {
          status: 'PAGO',
          pago_por: user?.email || null,
          pago_em: now,
          dt_pagamento: (datasMap && datasMap[id]) || hoje,
        };
        const { error } = await supabase
          .from('pagamentos_liberacao')
          .update(patch)
          .eq('id', id);
        if (error) {
          alert(`Erro: ${error.message}`);
          continue;
        }
        setTitulos((prev) =>
          prev.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        );
      }
      // Deduzir saldo por banco
      const porBanco = {};
      ids.forEach((id) => {
        const t = titulos.find((x) => x.id === id);
        if (!t?.banco_pagamento) return;
        const v = parseFloat(t.vl_real ?? t.vl_duplicata ?? 0);
        porBanco[t.banco_pagamento] = (porBanco[t.banco_pagamento] || 0) + v;
      });
      for (const [banco, vlPago] of Object.entries(porBanco)) {
        await ajustarSaldoBanco(banco, -vlPago, now);
      }
      setProcessando(false);
      setSelecionados(new Set());
    },
    [selecionados, titulos, user, ajustarSaldoBanco],
  );

  const toggleBaixado = useCallback(
    async (id, novoBaixado) => {
      const patch = {
        baixado: novoBaixado,
        baixado_por: novoBaixado ? user?.email || null : null,
        baixado_em: novoBaixado ? new Date().toISOString() : null,
      };
      const { error } = await supabase
        .from('pagamentos_liberacao')
        .update(patch)
        .eq('id', id);
      if (error) {
        alert('Erro ao salvar: ' + error.message);
        return;
      }
      setTitulos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    },
    [user],
  );

  const gerarRemessaSicredi = useCallback(() => {
    // Filtra selecionados: APROVADO + PIX
    const elegiveis = Array.from(selecionados)
      .map((id) => titulos.find((t) => t.id === id))
      .filter(
        (t) => t && t.status === 'APROVADO' && t.forma_pagamento === 'PIX',
      );

    if (elegiveis.length === 0) {
      alert(
        'Nenhum título selecionado com status APROVADO e forma de pagamento PIX.',
      );
      return;
    }

    // Valida chaves PIX
    const semChave = elegiveis.filter(
      (t) => !t.chave_pix || !String(t.chave_pix).trim(),
    );
    if (semChave.length > 0) {
      alert(
        `${semChave.length} título(s) sem Chave PIX preenchida. Preencha antes de gerar a remessa.`,
      );
      return;
    }

    if (
      !window.confirm(
        `Gerar arquivo de remessa SICREDI com ${elegiveis.length} título(s) PIX?`,
      )
    )
      return;

    try {
      const conteudo = gerarArquivoRemessaSicredi(elegiveis, {
        dataPagamento: new Date(),
        dataGeracao: new Date(),
      });
      const nome = proximoNomeArquivoRemessa();
      const blob = new Blob([conteudo], { type: 'text/plain;charset=latin1' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Erro ao gerar remessa: ' + err.message);
    }
  }, [selecionados, titulos]);

  const marcarPagoTitulo = useCallback(
    async (id, extraData = {}) => {
      if (!window.confirm('Confirmar pagamento deste título?')) return;
      setProcessandoId(id);
      const now = new Date().toISOString();
      const titulo = titulos.find((t) => t.id === id);
      const patch = {
        status: 'PAGO',
        pago_por: user?.email || null,
        pago_em: now,
        ...extraData,
        dt_pagamento:
          extraData.dt_pagamento ||
          titulo?.dt_pagamento ||
          new Date().toISOString().slice(0, 10),
      };
      const { error } = await supabase
        .from('pagamentos_liberacao')
        .update(patch)
        .eq('id', id);
      if (error) {
        setProcessandoId(null);
        alert('Erro ao marcar como pago: ' + error.message);
        return;
      }
      // Deduzir do saldo bancário
      const banco = extraData.banco_pagamento ?? titulo?.banco_pagamento;
      if (banco) {
        const vlPago = parseFloat(
          extraData.vl_real ?? titulo?.vl_real ?? titulo?.vl_duplicata ?? 0,
        );
        const { data: saldoRow } = await supabase
          .from('saldo_bancario')
          .select('valor')
          .eq('banco', banco)
          .maybeSingle();
        const novoSaldo = parseFloat(saldoRow?.valor || 0) - vlPago;
        await supabase.from('saldo_bancario').upsert(
          {
            banco,
            valor: novoSaldo,
            updated_at: now,
            updated_by: user?.email,
          },
          { onConflict: 'banco' },
        );
        setSaldos((prev) => {
          const existe = prev.some((r) => r.banco === banco);
          if (existe)
            return prev.map((r) =>
              r.banco === banco ? { ...r, valor: novoSaldo } : r,
            );
          return [...prev, { banco, valor: novoSaldo }];
        });
      }
      setProcessandoId(null);
      setTitulos((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                status: 'PAGO',
                pago_por: user?.email,
                pago_em: now,
                ...extraData,
              }
            : t,
        ),
      );
    },
    [user, titulos],
  );

  const adicionarTransferencia = useCallback((novoItem) => {
    setTitulos((prev) => [novoItem, ...prev]);
  }, []);

  const adicionarDuplicata = useCallback((novoItem) => {
    setTitulos((prev) => [novoItem, ...prev]);
  }, []);

  const exportarExcel = useCallback(() => {
    const rows = titulosFiltrados.map((t) => ({
      Status: t.status,
      Empresa: t.nm_empresa || '',
      Fornecedor: t.nm_fornecedor || '',
      'Cód. Fornecedor': t.cd_fornecedor || '',
      Duplicata: t.nr_duplicata || '',
      Parcela: t.nr_parcela || '',
      Vencimento: fmtDate(t.dt_vencimento),
      Valor: parseFloat(t.vl_duplicata || 0),
      'Valor Real': t.vl_real != null ? parseFloat(t.vl_real) : '',
      Despesa: t.ds_despesaitem || '',
      'C. Custo': t.cd_ccusto || '',
      Banco: t.banco_pagamento || '',
      'Forma Pgto': t.forma_pagamento || '',
      'Detalhe Pgto': t.chave_pix || t.codigo_barras || t.link_pagamento || '',
      Observação: t.observacao || '',
      'Enviado por': t.enviado_por || '',
      'Enviado em': t.enviado_em ? fmtDateTime(t.enviado_em) : '',
      'Aprovado por': t.aprovado_por || '',
      'Aprovado em': t.aprovado_em ? fmtDateTime(t.aprovado_em) : '',
      'Pago por': t.pago_por || '',
      'Pago em': t.pago_em ? fmtDateTime(t.pago_em) : '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pagamentos');
    XLSX.writeFile(
      wb,
      `liberacao-pagamento-${filtroStatus.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }, [titulosFiltrados, filtroStatus]);

  const exportarPdf = useCallback(() => {
    // Colunas: Status | Fornecedor | Cód. Forn. | Duplicata | Parcela | Vencimento | Valor | Valor Real | Despesa | C. Custo | Observação
    const colunas = [
      'Status',
      'Fornecedor',
      'Cód. Forn.',
      'Duplicata',
      'Parcela',
      'Vencimento',
      'Valor (R$)',
      'Vlr. Real (R$)',
      'Despesa',
      'C. Custo',
    ];
    const colStyles = [
      { cellWidth: 18 }, // Status
      { cellWidth: 55 }, // Fornecedor
      { cellWidth: 18 }, // Cód. Forn.
      { cellWidth: 24 }, // Duplicata
      { cellWidth: 14 }, // Parcela
      { cellWidth: 24 }, // Vencimento
      { cellWidth: 26 }, // Valor
      { cellWidth: 26 }, // Valor Real
      { cellWidth: 'auto' }, // Despesa — ocupa o restante
      { cellWidth: 16 }, // C. Custo
    ];
    const linhas = titulosFiltrados.map((t) => [
      t.status,
      t.nm_fornecedor || '',
      t.cd_fornecedor || '',
      t.nr_duplicata || '',
      t.nr_parcela || '',
      fmtDate(t.dt_vencimento),
      parseFloat(t.vl_duplicata || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
      }),
      t.vl_real != null
        ? parseFloat(t.vl_real).toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
          })
        : '',
      t.ds_despesaitem || '',
      t.cd_ccusto || '',
    ]);
    exportarPDF(
      colunas,
      linhas,
      `liberacao-pagamento-${filtroStatus.toLowerCase()}`,
      `Liberação de Pagamento — ${filtroStatus}`,
      colStyles,
    );
  }, [titulosFiltrados, filtroStatus]);

  const CardStat = ({ label, value, cor, Icon, onClick }) => (
    <button
      onClick={onClick}
      className={`flex-1 min-w-[140px] bg-white rounded-xl shadow border ${cor} p-3 text-left hover:shadow-md transition-shadow`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} weight="bold" />
        <span className="text-[10px] font-bold uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-xl font-bold">{value}</div>
    </button>
  );

  return (
    <div className="p-4 sm:p-6 bg-gray-50 min-h-screen">
      <PageTitle
        title="Liberação de Pagamento"
        subtitle="Aprove e registre os pagamentos dos títulos enviados de Contas a Pagar"
        icon={CurrencyDollar}
        iconColor="text-[#000638]"
      />

      {/* Cards de resumo */}
      <div className="flex flex-wrap gap-3 mb-4">
        <CardStat
          label="Pendentes"
          value={resumo.PENDENTE}
          cor="border-yellow-200 text-yellow-700"
          Icon={Clock}
          onClick={() => setFiltroStatus('PENDENTE')}
        />
        <CardStat
          label="Aprovados"
          value={resumo.APROVADO}
          cor="border-blue-200 text-blue-700"
          Icon={CheckCircle}
          onClick={() => setFiltroStatus('APROVADO')}
        />
        <CardStat
          label="Pagos"
          value={resumo.PAGO}
          cor="border-green-200 text-green-700"
          Icon={CheckCircle}
          onClick={() => setFiltroStatus('PAGO')}
        />
        <CardStat
          label="Cancelados"
          value={resumo.CANCELADO}
          cor="border-red-200 text-red-700"
          Icon={XCircle}
          onClick={() => setFiltroStatus('CANCELADO')}
        />
        <div className="flex-1 min-w-[180px] bg-[#000638] text-white rounded-xl shadow p-3">
          <div className="flex items-center gap-2 mb-1">
            <Receipt size={16} weight="bold" />
            <span className="text-[10px] font-bold uppercase tracking-wide">
              Valor Total (ativos)
            </span>
          </div>
          <div className="text-lg font-bold">{fmtBRL(resumo.valor)}</div>
        </div>
      </div>

      {/* Card Saldo Bancário + Cards de seleção */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* Saldo Bancário */}
        <button
          onClick={() => setShowModalSaldo(true)}
          className="flex-1 min-w-[260px] bg-white rounded-xl shadow border border-teal-200 p-4 text-left hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-teal-50 rounded-lg group-hover:bg-teal-100 transition-colors">
              <Wallet size={20} weight="bold" className="text-teal-600" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-teal-600 mb-0.5">
                Saldo Bancário
                <span className="ml-2 text-gray-400 font-normal normal-case">
                  · {bancosSaldoCount} banco(s)
                </span>
              </p>
              <p className="text-2xl font-bold text-gray-800">
                {fmtBRL(totalSaldo)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BANCOS_SALDO.map((b) => {
              const s = saldos.find((r) => r.banco === b);
              const v = parseFloat(s?.valor || 0);
              return (
                <span
                  key={b}
                  className={`inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded-full border font-semibold ${
                    v > 0
                      ? 'bg-teal-50 text-teal-700 border-teal-200'
                      : 'bg-gray-50 text-gray-400 border-gray-200'
                  }`}
                >
                  <Bank size={8} />
                  {b}: {fmtBRL(v)}
                </span>
              );
            })}
          </div>
        </button>

        {/* Títulos Aprovados */}
        <div className="flex-1 min-w-[200px] bg-white rounded-xl shadow border border-blue-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Stamp size={18} weight="bold" className="text-blue-600" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-blue-600 mb-0.5">
                Títulos Aprovados
              </p>
              <p className="text-2xl font-bold text-gray-800">
                {fmtBRL(valorAprovados)}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 font-medium">
            {qtdAprovados} título(s) aguardando pagamento
          </p>
        </div>

        {/* Títulos Selecionados */}
        <div className="flex-1 min-w-[200px] bg-white rounded-xl shadow border border-purple-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-purple-50 rounded-lg">
              <Receipt size={18} weight="bold" className="text-purple-600" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-purple-600 mb-0.5">
                Títulos Selecionados
              </p>
              <p className="text-2xl font-bold text-gray-800">
                {fmtBRL(valorSelecionado)}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 font-medium">
            {selecionados.size} título(s) marcado(s)
          </p>
        </div>

        {/* Saldo Restante */}
        {(() => {
          const saldoRestante = totalSaldo - valorAprovados - valorSelecionado;
          const positivo = saldoRestante >= 0;
          return (
            <div
              className={`flex-1 min-w-[200px] rounded-xl shadow border p-4 ${
                positivo
                  ? 'bg-white border-green-200'
                  : 'bg-red-50 border-red-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className={`p-2 rounded-lg ${positivo ? 'bg-green-50' : 'bg-red-100'}`}
                >
                  <CurrencyDollar
                    size={18}
                    weight="bold"
                    className={positivo ? 'text-green-600' : 'text-red-600'}
                  />
                </div>
                <div>
                  <p
                    className={`text-[10px] font-bold uppercase tracking-wide mb-0.5 ${
                      positivo ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    Saldo Restante
                  </p>
                  <p
                    className={`text-2xl font-bold ${
                      positivo ? 'text-gray-800' : 'text-red-700'
                    }`}
                  >
                    {fmtBRL(saldoRestante)}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 font-medium">
                Saldo Bancário − Aprovados − Selecionados
              </p>
            </div>
          );
        })()}
      </div>

      {/* Painel de Filtros */}
      <div className="bg-white rounded-xl shadow border border-gray-200 p-4 mb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Funnel size={14} weight="bold" className="text-[#000638]" />
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
              Filtros
            </span>
            {temFiltroExtra && (
              <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">
                ativos
              </span>
            )}
          </div>
          {temFiltroExtra && (
            <button
              onClick={limparFiltros}
              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-semibold"
            >
              <X size={11} weight="bold" /> Limpar filtros
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {/* Status */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-gray-500">
              Status
            </label>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:ring-1 focus:ring-[#000638] h-[30px]"
            >
              <option value="TODOS">Todos</option>
              <option value="PENDENTE">Pendente</option>
              <option value="APROVADO">Aprovado</option>
              <option value="PAGO">Pago</option>
              <option value="CANCELADO">Cancelado</option>
            </select>
          </div>

          {/* Tipo */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-gray-500">
              Tipo
            </label>
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:ring-1 focus:ring-[#000638] h-[30px]"
            >
              <option value="TODOS">Todos</option>
              <option value="PAGAMENTO">Pagamento</option>
              <option value="TRANSFERENCIA">Entre Contas</option>
            </select>
          </div>

          {/* Inclusão */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-gray-500">
              Inclusão
            </label>
            <select
              value={filtroInclusao}
              onChange={(e) => setFiltroInclusao(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:ring-1 focus:ring-[#000638] h-[30px]"
            >
              <option value="TODOS">Todos</option>
              <option value="TOTVS">TOTVS</option>
              <option value="MANUAL">Manual</option>
            </select>
          </div>

          {/* Banco */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-gray-500">
              Banco
            </label>
            <select
              value={filtroBancoFiltro}
              onChange={(e) => setFiltroBancoFiltro(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:ring-1 focus:ring-[#000638] h-[30px]"
            >
              <option value="">Todos</option>
              {BANCOS_SALDO.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* Forma de Pagamento */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-gray-500">
              Forma Pgto
            </label>
            <select
              value={filtroForma}
              onChange={(e) => setFiltroForma(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:ring-1 focus:ring-[#000638] h-[30px]"
            >
              <option value="">Todas</option>
              <option value="PIX">PIX</option>
              <option value="BOLETO">Boleto</option>
              <option value="DEBITO">Débito</option>
              <option value="CREDITO">Crédito</option>
            </select>
          </div>

          {/* Fornecedor */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-gray-500">
              Fornecedor
            </label>
            <input
              type="text"
              value={filtroFornecedor}
              onChange={(e) => setFiltroFornecedor(e.target.value)}
              placeholder="Nome do fornecedor..."
              className="border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-[#000638] h-[30px]"
            />
          </div>

          {/* Valor */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-gray-500">
              Valor (R$)
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={filtroValorMin}
                onChange={(e) => setFiltroValorMin(e.target.value)}
                placeholder="Mín"
                min="0"
                className="border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-[#000638] h-[30px] w-full"
              />
              <span className="text-gray-400 text-xs">—</span>
              <input
                type="number"
                value={filtroValorMax}
                onChange={(e) => setFiltroValorMax(e.target.value)}
                placeholder="Máx"
                min="0"
                className="border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-[#000638] h-[30px] w-full"
              />
            </div>
          </div>
        </div>

        {/* Filtro de data de pagamento (visível na aba Pagos) */}
        {(filtroStatus === 'PAGO' ||
          filtroPagamentoDe ||
          filtroPagamentoAte) && (
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase text-green-700">
                Data Pagto (de)
              </label>
              <input
                type="date"
                value={filtroPagamentoDe}
                onChange={(e) => setFiltroPagamentoDe(e.target.value)}
                className="border border-green-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-green-500 h-[30px] bg-green-50"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase text-green-700">
                Data Pagto (até)
              </label>
              <input
                type="date"
                value={filtroPagamentoAte}
                onChange={(e) => setFiltroPagamentoAte(e.target.value)}
                className="border border-green-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-green-500 h-[30px] bg-green-50"
              />
            </div>
            {(filtroPagamentoDe || filtroPagamentoAte) && (
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setFiltroPagamentoDe('');
                    setFiltroPagamentoAte('');
                  }}
                  className="text-[10px] text-red-500 hover:text-red-700 font-semibold flex items-center gap-1"
                >
                  <X size={10} weight="bold" /> Limpar datas
                </button>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase text-emerald-700">
                Baixado
              </label>
              <select
                value={filtroBaixado}
                onChange={(e) => setFiltroBaixado(e.target.value)}
                className="border border-emerald-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-emerald-500 h-[30px] bg-emerald-50"
              >
                <option value="">Todos</option>
                <option value="SIM">Baixado</option>
                <option value="NAO">Não baixado</option>
              </select>
            </div>
          </div>
        )}

        <div className="mt-2.5 text-[10px] text-gray-400 font-medium">
          {titulosFiltrados.length} registro(s) encontrado(s)
        </div>
      </div>

      {/* Barra de ações acima da tabela */}
      <div className="bg-white rounded-xl shadow border border-gray-200 px-3 py-2 mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={exportarExcel}
          disabled={titulosFiltrados.length === 0}
          className="flex items-center gap-1.5 bg-green-700 hover:bg-green-800 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
        >
          <FileXls size={14} weight="bold" />
          Exportar Excel
        </button>

        <button
          onClick={exportarPdf}
          disabled={titulosFiltrados.length === 0}
          className="flex items-center gap-1.5 bg-red-700 hover:bg-red-800 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
        >
          <FilePdf size={14} weight="bold" />
          Exportar PDF
        </button>

        <button
          onClick={() => setShowModalTransferencia(true)}
          className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
        >
          <ArrowsLeftRight size={14} weight="bold" />
          Transferência
        </button>

        <button
          onClick={() => setShowModalAdicionar(true)}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
        >
          <PlusCircle size={14} weight="bold" />
          Adicionar Duplicata
        </button>

        {(isAdmin || isFinanceiro) && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={selecionarTodosVisiveis}
              className="text-xs px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded font-semibold"
            >
              {selecionados.size > 0 ? 'Limpar seleção' : 'Selecionar todos'}
            </button>
            {selecionados.size > 0 && (
              <>
                <span className="text-xs text-gray-500">
                  {selecionados.size} selecionado(s)
                </span>
                {(isAdmin || isFinanceiro) &&
                  Array.from(selecionados).some(
                    (id) =>
                      titulos.find((t) => t.id === id)?.status === 'PENDENTE',
                  ) && (
                    <button
                      onClick={aprovarSelecionados}
                      disabled={processando}
                      className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors"
                    >
                      {processando ? (
                        <Spinner size={12} className="animate-spin" />
                      ) : (
                        <Stamp size={12} weight="bold" />
                      )}
                      APROVAR SELECIONADOS
                    </button>
                  )}
                {Array.from(selecionados).some(
                  (id) =>
                    titulos.find((t) => t.id === id)?.status === 'APROVADO',
                ) && (
                  <button
                    onClick={() => setModalPagarSelecionados(true)}
                    disabled={processando}
                    className="flex items-center gap-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors"
                  >
                    {processando ? (
                      <Spinner size={12} className="animate-spin" />
                    ) : (
                      <CheckCircle size={12} weight="bold" />
                    )}
                    PAGAR SELECIONADOS
                  </button>
                )}
                {/* Voltar para PENDENTE em lote */}
                {Array.from(selecionados).some((id) => {
                  const s = titulos.find((t) => t.id === id)?.status;
                  return s === 'APROVADO' || s === 'PAGO';
                }) && (
                  <button
                    onClick={() => mudarStatusSelecionados('PENDENTE')}
                    disabled={processando}
                    className="flex items-center gap-1 bg-yellow-100 hover:bg-yellow-200 disabled:opacity-50 text-yellow-800 text-xs font-bold px-3 py-1.5 rounded border border-yellow-300 transition-colors"
                    title="Voltar para Pendente (estorna saldo se necessário)"
                  >
                    <Clock size={12} weight="bold" />
                    PENDENTE
                  </button>
                )}
                {/* Voltar para APROVADO em lote */}
                {Array.from(selecionados).some(
                  (id) => titulos.find((t) => t.id === id)?.status === 'PAGO',
                ) && (
                  <button
                    onClick={() => mudarStatusSelecionados('APROVADO')}
                    disabled={processando}
                    className="flex items-center gap-1 bg-blue-100 hover:bg-blue-200 disabled:opacity-50 text-blue-800 text-xs font-bold px-3 py-1.5 rounded border border-blue-300 transition-colors"
                    title="Voltar para Aprovado (estorna saldo)"
                  >
                    <Stamp size={12} weight="bold" />
                    APROVADO
                  </button>
                )}
                {Array.from(selecionados).some((id) => {
                  const t = titulos.find((x) => x.id === id);
                  return (
                    t?.status === 'APROVADO' && t?.forma_pagamento === 'PIX'
                  );
                }) && (
                  <button
                    onClick={gerarRemessaSicredi}
                    disabled={processando}
                    className="flex items-center gap-1 bg-[#000638] hover:bg-[#001a5c] disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors"
                    title="Gera arquivo CNAB 240 SICREDI com os aprovados + PIX selecionados"
                  >
                    <FileXls size={12} weight="bold" />
                    GERAR REMESSA SICREDI
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Spinner size={20} className="animate-spin mr-2" />
            Carregando...
          </div>
        ) : erro ? (
          <div className="p-5 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm flex items-center gap-2">
            <Warning size={16} />
            {erro}
          </div>
        ) : titulosFiltrados.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            Nenhum título encontrado com este filtro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1700px] w-full table-fixed">
              <thead className="bg-[#000638] text-white">
                <tr>
                  <th className="px-2 py-2 text-center text-[10px] font-bold uppercase w-10">
                    Sel.
                  </th>
                  <th className="px-2 py-2 text-left text-[10px] font-bold uppercase w-24">
                    Status
                  </th>
                  {filtroStatus === 'PAGO' && (
                    <th className="px-2 py-2 text-center text-[10px] font-bold uppercase w-16 text-emerald-300">
                      Baixado
                    </th>
                  )}
                  <ThSortable
                    label="Data"
                    coluna="dt_vencimento"
                    ordenacao={ordenacao}
                    onSort={toggleOrdem}
                    className="w-36"
                  />
                  <ThSortable
                    label="Valor"
                    coluna="vl_duplicata"
                    ordenacao={ordenacao}
                    onSort={toggleOrdem}
                    className="w-28"
                  />
                  <th className="px-2 py-2 text-left text-[10px] font-bold uppercase w-28 text-blue-300">
                    Valor Real
                  </th>
                  <ThSortable
                    label="Fornecedor"
                    coluna="nm_fornecedor"
                    ordenacao={ordenacao}
                    onSort={toggleOrdem}
                    className="w-44"
                  />
                  <ThSortable
                    label="Despesa"
                    coluna="ds_historico"
                    ordenacao={ordenacao}
                    onSort={toggleOrdem}
                    className="w-32"
                  />
                  <th className="px-2 py-2 text-left text-[10px] font-bold uppercase w-24">
                    C. Custo
                  </th>
                  <th className="px-2 py-2 text-left text-[10px] font-bold uppercase w-28">
                    Duplicata
                  </th>
                  <ThSortable
                    label="Banco"
                    coluna="banco_pagamento"
                    ordenacao={ordenacao}
                    onSort={toggleOrdem}
                    className="w-36"
                  />
                  <ThSortable
                    label="Forma Pgto"
                    coluna="forma_pagamento"
                    ordenacao={ordenacao}
                    onSort={toggleOrdem}
                    className="w-24"
                  />
                  <th className="px-2 py-2 text-left text-[10px] font-bold uppercase w-32">
                    Detalhe Pgto
                  </th>
                  <th className="px-2 py-2 text-left text-[10px] font-bold uppercase w-32">
                    Observação
                  </th>
                  <th className="px-2 py-2 text-center text-[10px] font-bold uppercase w-24">
                    Ações
                  </th>
                  <th className="px-2 py-2 text-center text-[10px] font-bold uppercase w-20">
                    Detalhar
                  </th>
                </tr>
              </thead>
              <tbody>
                {titulosFiltrados.map((item) => (
                  <LinhaTitulo
                    key={item.id}
                    item={item}
                    isAdmin={isAdmin}
                    isFinanceiro={isFinanceiro}
                    selecionado={selecionados.has(item.id)}
                    onToggleSelect={toggleSelect}
                    onSalvar={salvarTitulo}
                    onExcluir={excluirTitulo}
                    onMudarStatus={mudarStatusTitulo}
                    onAbrirModal={setModalItem}
                    onAbrirDetalhe={setModalDetalhe}
                    onToggleBaixado={toggleBaixado}
                    showBaixado={filtroStatus === 'PAGO'}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalItem && (
        <ModalInfoPagamento
          item={modalItem}
          onClose={() => setModalItem(null)}
        />
      )}

      {modalPagarSelecionados &&
        (() => {
          const titulosAprovados = Array.from(selecionados)
            .map((id) => titulos.find((t) => t.id === id))
            .filter((t) => t?.status === 'APROVADO');
          return (
            <ModalPagarSelecionados
              titulos={titulosAprovados}
              onConfirmar={pagarSelecionados}
              onClose={() => setModalPagarSelecionados(false)}
            />
          );
        })()}

      {modalDetalhe && (
        <ModalDetalheDuplicata
          item={modalDetalhe}
          isAdmin={isAdmin}
          isFinanceiro={isFinanceiro}
          onClose={() => setModalDetalhe(null)}
          onSave={async ({
            patchSimples,
            statusMudou,
            novoStatus,
            dtPagamentoMudou,
            novaDtPagamento,
          }) => {
            // 1) salva campos editáveis
            await salvarTitulo(modalDetalhe.id, patchSimples);
            // 2) se status mudou, executa transição com saldo
            if (statusMudou) {
              await mudarStatusTitulo(
                modalDetalhe.id,
                novoStatus,
                novoStatus === 'PAGO' && novaDtPagamento
                  ? { dt_pagamento: novaDtPagamento }
                  : {},
                { skipConfirm: true },
              );
            } else if (dtPagamentoMudou) {
              // ajusta apenas a data de pagamento sem mudar status
              await salvarTitulo(modalDetalhe.id, {
                dt_pagamento: novaDtPagamento,
              });
            }
          }}
        />
      )}

      {showModalTransferencia && (
        <ModalTransferencia
          onClose={() => setShowModalTransferencia(false)}
          onSalvo={adicionarTransferencia}
          userEmail={user?.email}
        />
      )}

      {showModalAdicionar && (
        <ModalAdicionarDuplicata
          onClose={() => setShowModalAdicionar(false)}
          onSalvo={adicionarDuplicata}
          userEmail={user?.email}
        />
      )}

      {showModalSaldo && (
        <ModalSaldoBancario
          onClose={() => setShowModalSaldo(false)}
          onSaved={(rows) => setSaldos(rows)}
          userEmail={user?.email}
        />
      )}

      <p className="mt-3 text-[10px] text-gray-400 flex items-center gap-1">
        <CheckCircle size={11} />
        As alterações de banco / forma de pagamento / observações são salvas
        individualmente ao clicar no ícone de disquete.
        {isAdmin || isFinanceiro
          ? ' Financeiro/Admin pode Aprovar, Pagar e Excluir títulos.'
          : ' Somente Financeiro/Admin pode aprovar, pagar e excluir.'}
      </p>
    </div>
  );
};

export default LiberacaoPagamento;
