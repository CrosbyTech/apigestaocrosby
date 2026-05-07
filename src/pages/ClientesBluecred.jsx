import React, { useEffect, useState, useCallback } from 'react';
import {
  User,
  CheckCircle,
  Clock,
  WarningCircle,
  ArrowClockwise,
  FileText,
  Spinner,
  WhatsappLogo,
  Signature,
  XCircle,
} from '@phosphor-icons/react';
import PageTitle from '../components/ui/PageTitle';
import { API_BASE_URL } from '../config/constants';

// ─── helpers ────────────────────────────────────────────────────────────────
const formatFiscal = (v) => {
  if (!v) return '—';
  const n = String(v).replace(/\D/g, '');
  if (n.length === 14)
    return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (n.length === 11)
    return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return v;
};

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// ─── badge de status ─────────────────────────────────────────────────────────
function StatusBadge({ status, totalAssinados, totalAssinantes }) {
  if (status === 'concluido') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[11px] font-semibold">
        <CheckCircle size={12} weight="fill" />
        Assinado pelas {totalAssinantes} partes
      </span>
    );
  }
  if (status === 'parcialmente_assinado') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-[11px] font-semibold">
        <Clock size={12} weight="fill" />
        {totalAssinados}/{totalAssinantes} assinatura
        {totalAssinados !== 1 ? 's' : ''}
      </span>
    );
  }
  if (status === 'recusado') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">
        <XCircle size={12} weight="fill" />
        Recusado
      </span>
    );
  }
  // pendente
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px] font-semibold">
      <Clock size={12} />
      Aguardando assinaturas
    </span>
  );
}

// ─── card individual ─────────────────────────────────────────────────────────
function ContratoCard({ contrato }) {
  const {
    cliente_nome,
    cliente_cpf,
    cliente_whatsapp,
    status,
    total_assinados,
    total_assinantes,
    assinaturas,
    created_at,
    autentique_doc_id,
  } = contrato;

  const assinaturasArr = Array.isArray(assinaturas) ? assinaturas : [];

  return (
    <div className="bg-white border border-[#000638]/10 rounded-xl shadow-sm p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* Cabeçalho do card */}
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-full bg-blue-50 shrink-0">
          <User size={22} className="text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[#000638] truncate">
            {cliente_nome || '—'}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {formatFiscal(cliente_cpf)}
          </p>
        </div>
        <StatusBadge
          status={status}
          totalAssinados={total_assinados}
          totalAssinantes={total_assinantes}
        />
      </div>

      {/* Linha separadora */}
      <div className="border-t border-gray-100" />

      {/* Detalhes */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {cliente_whatsapp && (
          <div className="flex items-center gap-1 text-gray-500">
            <WhatsappLogo size={12} className="text-green-600" weight="fill" />
            <span className="truncate">{cliente_whatsapp}</span>
          </div>
        )}
        <div className="flex items-center gap-1 text-gray-400 col-span-2">
          <Clock size={11} />
          Enviado em {formatDate(created_at)}
        </div>
      </div>

      {/* Assinaturas detalhadas */}
      {assinaturasArr.length > 0 && (
        <div className="flex flex-col gap-1">
          {assinaturasArr.map((s, i) => (
            <div
              key={s.public_id || i}
              className="flex items-center gap-2 text-[11px]"
            >
              {s.signed_at ? (
                <CheckCircle
                  size={13}
                  className="text-green-500 shrink-0"
                  weight="fill"
                />
              ) : (
                <Clock size={13} className="text-gray-300 shrink-0" />
              )}
              <span
                className={`truncate ${s.signed_at ? 'text-gray-700 font-medium' : 'text-gray-400'}`}
              >
                {s.name || `Assinante ${i + 1}`}
              </span>
              {s.signed_at && (
                <span className="ml-auto text-gray-400 shrink-0">
                  {formatDate(s.signed_at)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Link Autentique */}
      {autentique_doc_id && (
        <a
          href={`https://app.autentique.com.br/dashboard/documentos/${autentique_doc_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-[#000638]/60 hover:text-[#000638] underline underline-offset-2 truncate"
        >
          Ver no Autentique ↗
        </a>
      )}
    </div>
  );
}

// ─── componente principal ─────────────────────────────────────────────────────
export default function ClientesBluecred() {
  const [contratos, setContratos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('todos');

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/autentique/bluecred/contratos`,
      );
      const json = await res.json();
      if (!json.success)
        throw new Error(json.message || 'Erro ao buscar contratos');
      setContratos(json.data || []);
    } catch (err) {
      setErro(err.message || 'Erro ao conectar com a API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const contratosFiltrados = contratos.filter((c) => {
    if (filtro === 'todos') return true;
    return c.status === filtro;
  });

  const counts = {
    todos: contratos.length,
    pendente: contratos.filter((c) => c.status === 'pendente').length,
    parcialmente_assinado: contratos.filter(
      (c) => c.status === 'parcialmente_assinado',
    ).length,
    concluido: contratos.filter((c) => c.status === 'concluido').length,
    recusado: contratos.filter((c) => c.status === 'recusado').length,
  };

  const tabs = [
    { key: 'todos', label: 'Todos' },
    { key: 'pendente', label: 'Pendentes' },
    { key: 'parcialmente_assinado', label: 'Parciais' },
    { key: 'concluido', label: 'Concluídos' },
    { key: 'recusado', label: 'Recusados' },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col items-stretch py-3 px-2 gap-4">
      <PageTitle
        title="Clientes Bluecred"
        subtitle="Contratos de crédito enviados para assinatura"
        icon={Signature}
        iconColor="text-blue-600"
      />

      {/* Filtros + botão atualizar */}
      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFiltro(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              filtro === t.key
                ? 'bg-[#000638] text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span
                className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                  filtro === t.key ? 'bg-white/20' : 'bg-gray-300/60'
                }`}
              >
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={carregar}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <Spinner size={13} className="animate-spin" />
          ) : (
            <ArrowClockwise size={13} />
          )}
          Atualizar
        </button>
      </div>

      {/* Erro */}
      {erro && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <WarningCircle size={18} />
          {erro}
        </div>
      )}

      {/* Loading */}
      {loading && !erro && (
        <div className="flex justify-center items-center py-16 gap-3 text-gray-500">
          <Spinner size={28} className="animate-spin text-[#000638]" />
          <span>Carregando contratos...</span>
        </div>
      )}

      {/* Vazio */}
      {!loading && !erro && contratosFiltrados.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
          <FileText size={40} />
          <p className="text-sm">Nenhum contrato encontrado.</p>
        </div>
      )}

      {/* Grid de cards */}
      {!loading && contratosFiltrados.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {contratosFiltrados.map((c) => (
            <ContratoCard key={c.id} contrato={c} />
          ))}
        </div>
      )}
    </div>
  );
}
