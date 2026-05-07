import React, { useState } from 'react';
import {
  MagnifyingGlass,
  Spinner,
  X,
  FileText,
  IdentificationCard,
  User,
  Phone,
  Envelope,
  MapPin,
  Buildings,
  WarningCircle,
  ClipboardText,
  CheckCircle,
  WhatsappLogo,
  ArrowSquareOut,
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

const formatPhone = (v) => {
  if (!v) return '—';
  const n = String(v).replace(/\D/g, '');
  if (n.length === 11) return n.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (n.length === 10) return n.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return v;
};

const maskInput = (v) => {
  const n = v.replace(/\D/g, '').slice(0, 14);
  if (n.length <= 11)
    return n
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2');
  return n
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
};

// ─── sub-componentes ─────────────────────────────────────────────────────────
function InfoRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-gray-400 uppercase tracking-wide">
        {label}
      </span>
      <span className="text-sm font-medium text-[#000638]">{value || '—'}</span>
    </div>
  );
}

function ClientModal({ client, onClose, onSolicitar, solicitarLoading }) {
  const phones = client.phones || [];
  const emails = client.emails || [];
  const addresses = client.addresses || [];
  const observations = client.observations || [];

  // Monta endereço completo conforme schema TOTVS
  const formatAddress = (a) =>
    [
      [a.publicPlace, a.address].filter(Boolean).join(' '),
      a.addressNumber ? `nº ${a.addressNumber}` : null,
      a.complement,
      a.neighborhood,
      a.cityName && a.stateAbbreviation
        ? `${a.cityName} - ${a.stateAbbreviation}`
        : a.cityName || a.stateAbbreviation,
      a.cep ? `CEP ${a.cep}` : null,
      a.countryName && a.countryName !== 'BRASIL' ? a.countryName : null,
    ]
      .filter(Boolean)
      .join(', ');

  const addressTypeLabel = (a) =>
    a.addressType === 'Commercial'
      ? 'Comercial'
      : a.addressType === 'Residential'
        ? 'Residencial'
        : a.addressType || 'Endereço';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col m-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-full bg-blue-50">
              <User size={18} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#000638] uppercase tracking-wide">
                {client.name || '—'}
              </h2>
              {client.cpf && (
                <p className="text-[10px] text-gray-400">
                  CPF {formatFiscal(client.cpf)}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 transition-colors"
          >
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-5">
          {/* Dados Cadastrais */}
          <div>
            <p className="text-xs font-bold text-[#000638] uppercase mb-2 flex items-center gap-1">
              <IdentificationCard size={14} /> Dados Cadastrais
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-gray-50 p-3 rounded-lg">
              <InfoRow label="Código" value={client.code} />
              <InfoRow label="CPF" value={formatFiscal(client.cpf)} />
              <InfoRow label="Nome" value={client.name} />
              <InfoRow label="Status Cliente" value={client.customerStatus} />
              <InfoRow
                label="Situação"
                value={client.isInactive ? 'Inativo' : 'Ativo'}
              />
              <InfoRow
                label="Data Cadastro"
                value={
                  client.insertDate
                    ? new Date(client.insertDate).toLocaleDateString('pt-BR')
                    : null
                }
              />
              <InfoRow label="RG" value={client.rg} />
              <InfoRow label="Órgão Emissor" value={client.rgFederalAgency} />
              <InfoRow
                label="Data Nascimento"
                value={
                  client.birthDate
                    ? new Date(client.birthDate).toLocaleDateString('pt-BR')
                    : null
                }
              />
              <InfoRow
                label="Sexo"
                value={client.gender !== 'NotInformed' ? client.gender : null}
              />
              <InfoRow
                label="Estado Civil"
                value={
                  client.maritalStatus !== 'NotInformed'
                    ? client.maritalStatus
                    : null
                }
              />
              <InfoRow label="Nacionalidade" value={client.nationality} />
              <InfoRow label="Naturalidade" value={client.homeTown} />
              <InfoRow label="Profissão" value={client.occupation} />
              <InfoRow label="Nome da Mãe" value={client.motherName} />
              <InfoRow label="Nome do Pai" value={client.fatherName} />
              <InfoRow label="Site" value={client.homePage} />
              <InfoRow
                label="Filial Cadastro"
                value={client.branchInsertCode}
              />
            </div>
          </div>

          {/* Telefones */}
          {phones.length > 0 && (
            <div>
              <p className="text-xs font-bold text-[#000638] uppercase mb-2 flex items-center gap-1">
                <Phone size={14} /> Telefones
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {phones.map((p, i) => (
                  <div key={i} className="bg-gray-50 px-3 py-2 rounded-lg">
                    <span className="text-[10px] text-gray-400 block">
                      {p.typeName || `Tel ${i + 1}`}
                      {p.isDefault ? ' • Principal' : ''}
                    </span>
                    <span className="text-sm font-medium text-[#000638]">
                      {formatPhone(p.number)}
                      {p.branchLine ? ` r. ${p.branchLine}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* E-mails */}
          {emails.length > 0 && (
            <div>
              <p className="text-xs font-bold text-[#000638] uppercase mb-2 flex items-center gap-1">
                <Envelope size={14} /> E-mails
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {emails.map((e, i) => (
                  <div key={i} className="bg-gray-50 px-3 py-2 rounded-lg">
                    <span className="text-[10px] text-gray-400 block">
                      {e.typeName || `Email ${i + 1}`}
                      {e.isDefault ? ' • Principal' : ''}
                    </span>
                    <span className="text-sm font-medium text-[#000638] break-all">
                      {e.email || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Endereços */}
          {addresses.length > 0 && (
            <div>
              <p className="text-xs font-bold text-[#000638] uppercase mb-2 flex items-center gap-1">
                <MapPin size={14} /> Endereços
              </p>
              <div className="space-y-2">
                {addresses.map((a, i) => (
                  <div key={i} className="bg-gray-50 px-3 py-2 rounded-lg">
                    <span className="text-[10px] text-gray-400 block mb-0.5">
                      {addressTypeLabel(a)}
                      {a.reference ? ` • ${a.reference}` : ''}
                    </span>
                    <span className="text-sm text-[#000638]">
                      {formatAddress(a) || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Observações */}
          {observations.length > 0 && (
            <div>
              <p className="text-xs font-bold text-[#000638] uppercase mb-2 flex items-center gap-1">
                <Buildings size={14} /> Observações
              </p>
              <div className="space-y-2">
                {observations.map((o, i) => (
                  <div key={i} className="bg-gray-50 px-3 py-2 rounded-lg">
                    <span className="text-[10px] text-gray-400 block">
                      Obs. {i + 1}
                      {o.isMaintenance ? ' • Manutenção' : ''}
                    </span>
                    <span className="text-sm text-[#000638]">
                      {o.observation || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex justify-end">
          <button
            onClick={() => onSolicitar(client)}
            disabled={solicitarLoading}
            className="flex items-center gap-2 bg-[#000638] text-white px-5 py-2 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-bold uppercase tracking-wide shadow-md"
          >
            {solicitarLoading ? (
              <>
                <Spinner size={14} className="animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <ClipboardText size={14} />
                Solicitar Documentação
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── componente principal ────────────────────────────────────────────────────
// ─── Modal de sucesso do Termo de Crédito ───────────────────────────────────
function SuccessModal({ result, onClose }) {
  const { document: doc, cliente } = result;
  const signatario = doc?.signers?.[0];
  const linkAssinatura =
    signatario?.link?.short_link || signatario?.link?.url || null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-green-100">
            <CheckCircle size={28} className="text-green-600" weight="fill" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#000638]">
              Termo enviado!
            </h2>
            <p className="text-xs text-gray-500">
              Documento criado na Autentique
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-gray-700"
          >
            <X size={20} />
          </button>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Cliente</span>
            <span className="font-semibold text-[#000638]">
              {cliente?.name}
            </span>
          </div>
          {cliente?.cpf && (
            <div className="flex justify-between">
              <span className="text-gray-500">CPF/CNPJ</span>
              <span className="font-mono text-[#000638]">{cliente.cpf}</span>
            </div>
          )}
          {cliente?.whatsappPhone && (
            <div className="flex justify-between items-center">
              <span className="text-gray-500">WhatsApp</span>
              <span className="flex items-center gap-1 font-semibold text-green-700">
                <WhatsappLogo size={14} weight="fill" />
                {cliente.whatsappPhone}
              </span>
            </div>
          )}
          {doc?.id && (
            <div className="flex justify-between">
              <span className="text-gray-500">ID Autentique</span>
              <span className="font-mono text-xs text-gray-600 truncate max-w-[180px]">
                {doc.id}
              </span>
            </div>
          )}
        </div>

        <div className="bg-blue-50 rounded-lg px-4 py-3 text-xs text-blue-700 leading-relaxed">
          O cliente receberá o Termo de Crédito via WhatsApp e precisará
          realizar a verificação com <strong>selfie + documento</strong>. Um
          funcionário da Crosby precisará <strong>aprovar manualmente</strong>{' '}
          antes de finalizar.
        </div>

        <div className="flex gap-2 justify-end">
          {linkAssinatura && (
            <a
              href={linkAssinatura}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[#000638] border border-[#000638]/30 px-4 py-2 rounded-lg hover:bg-[#000638]/5 transition-colors font-semibold"
            >
              <ArrowSquareOut size={13} />
              Ver no Autentique
            </a>
          )}
          <button
            onClick={onClose}
            className="text-xs bg-[#000638] text-white px-5 py-2 rounded-lg hover:bg-[#fe0000] transition-colors font-bold uppercase tracking-wide"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DocumentoBluecred() {
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [clientes, setClientes] = useState(null);
  const [modalClient, setModalClient] = useState(null);
  const [solicitarLoading, setSolicitarLoading] = useState(false);
  const [solicitarResult, setSolicitarResult] = useState(null);
  const [solicitarErro, setSolicitarErro] = useState('');

  const handleInput = (e) => setInputValue(maskInput(e.target.value));

  const handleBuscar = async (e) => {
    e.preventDefault();
    const clean = inputValue.replace(/\D/g, '');
    if (clean.length !== 11 && clean.length !== 14) {
      setErro(
        'Informe um CPF válido (11 dígitos) ou CNPJ válido (14 dígitos).',
      );
      return;
    }
    setLoading(true);
    setErro('');
    setClientes(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/totvs/clientes/search-by-fiscal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fiscalNumber: clean }),
        },
      );
      const json = await res.json();
      if (!json.success)
        throw new Error(json.message || 'Erro ao buscar cliente.');
      if (!json.data?.items?.length) {
        setErro('Nenhum cliente encontrado com esse CPF/CNPJ.');
      } else {
        setClientes(json.data.items);
      }
    } catch (err) {
      setErro(err.message || 'Erro ao conectar com a API.');
    } finally {
      setLoading(false);
    }
  };

  const handleSolicitar = async (client) => {
    setSolicitarLoading(true);
    setSolicitarErro('');
    setSolicitarResult(null);
    try {
      const fiscalNumber = String(client.cpf || '').replace(/\D/g, '');
      const telPrimario =
        (client.phones || []).find((p) => p.isDefault)?.number ||
        (client.phones || [])[0]?.number ||
        '';
      const body = { fiscalNumber };
      if (telPrimario) body.phone = telPrimario;

      const res = await fetch(`${API_BASE_URL}/api/autentique/termo-credito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || `Erro ${res.status}`);
      }
      setSolicitarResult(json.data);
    } catch (err) {
      setSolicitarErro(err.message || 'Erro ao enviar o termo de crédito.');
    } finally {
      setSolicitarLoading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-stretch py-3 px-2 gap-4">
      <PageTitle
        title="Documento Bluecred"
        subtitle="Consulta e solicitação de documentação • Varejo"
        icon={FileText}
        iconColor="text-blue-600"
      />

      {/* Busca */}
      <div className="bg-white p-4 rounded-lg shadow-md border border-[#000638]/10">
        <form
          onSubmit={handleBuscar}
          className="flex flex-col sm:flex-row gap-2"
        >
          <div className="flex-1">
            <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
              CNPJ / CPF do cliente
            </label>
            <input
              type="text"
              value={inputValue}
              onChange={handleInput}
              placeholder="000.000.000-00 ou 00.000.000/0000-00"
              className="border border-[#000638]/30 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-sm"
              autoFocus
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 bg-[#000638] text-white px-5 py-2 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-bold uppercase tracking-wide shadow-md h-9"
            >
              {loading ? (
                <>
                  <Spinner size={14} className="animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <MagnifyingGlass size={14} />
                  Buscar
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Erro */}
      {erro && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <WarningCircle size={18} />
          {erro}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center items-center py-16 gap-3 text-gray-500">
          <Spinner size={28} className="animate-spin text-[#000638]" />
          <span>Consultando TOTVS...</span>
        </div>
      )}

      {/* Estado inicial */}
      {!loading && !clientes && !erro && (
        <div className="flex justify-center items-center py-16 text-gray-400 text-sm">
          Informe o CNPJ ou CPF do cliente e clique em "Buscar".
        </div>
      )}

      {/* Resultados — cards */}
      {!loading && clientes && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {clientes.map((c) => (
            <button
              key={c.code}
              onClick={() => setModalClient(c)}
              className="text-left bg-white border border-[#000638]/10 rounded-xl shadow-sm p-4 hover:ring-2 hover:ring-[#000638]/30 hover:shadow-md transition-all flex items-center gap-3"
            >
              <div className="p-2 rounded-full bg-blue-50 shrink-0">
                <User size={22} className="text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#000638] truncate">
                  {c.name || '—'}
                </p>
                {c.fantasyName && c.fantasyName !== c.name && (
                  <p className="text-xs text-gray-500 truncate">
                    {c.fantasyName}
                  </p>
                )}
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {formatFiscal(c.cpf)} &bull; Cód. {c.code}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Modal de detalhes */}
      {modalClient && (
        <ClientModal
          client={modalClient}
          onClose={() => setModalClient(null)}
          onSolicitar={handleSolicitar}
          solicitarLoading={solicitarLoading}
        />
      )}

      {/* Erro do Solicitar */}
      {solicitarErro && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-red-600 text-white rounded-xl px-5 py-3 shadow-xl text-sm font-medium max-w-sm">
          <WarningCircle size={18} weight="fill" />
          {solicitarErro}
          <button
            onClick={() => setSolicitarErro('')}
            className="ml-2 opacity-70 hover:opacity-100"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Modal de sucesso */}
      {solicitarResult && (
        <SuccessModal
          result={solicitarResult}
          onClose={() => {
            setSolicitarResult(null);
            setModalClient(null);
          }}
        />
      )}
    </div>
  );
}
