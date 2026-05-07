import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import {
  Spinner,
  CheckCircle,
  ShoppingCart,
  CurrencyDollar,
  CalendarBlank,
  Clock,
  Warning,
  ChartLineUp,
  Camera,
  InstagramLogo,
  PencilSimple,
  FileArrowUp,
  FileText,
  Trash,
  DownloadSimple,
  X,
  Storefront,
  Star,
  Phone,
  Envelope,
  MapPin,
  IdentificationCard,
  FolderOpen,
  Buildings,
  ChatText,
  WhatsappLogo,
  Image,
  Microphone,
  VideoCamera,
  File,
  ArrowDown,
  Play,
  Pause,
  MagnifyingGlassPlus,
  CircleNotch,
} from '@phosphor-icons/react';
import { TotvsURL } from '../config/constants';

const BUCKET_NAME = 'clientes-confianca';
const SUPABASE_URL = 'https://dorztqiunewggydvkjnf.supabase.co';
const EvolutionURL = 'https://apigestaocrosby-bw2v.onrender.com/api/evolution/';

const CATEGORIAS_DOCUMENTOS = [
  { key: 'cartao_cnpj', label: 'Cartão CNPJ' },
  { key: 'google_maps', label: 'Google Maps da Loja' },
  { key: 'comprovante_qsa', label: 'Comprovante QSA' },
  { key: 'rg_cpf_socios', label: 'RG e CPF dos Sócios' },
  { key: 'comprovante_endereco', label: 'Comprov. Endereço Empresa' },
  { key: 'score_cnpj', label: 'Score SPC/Serasa CNPJ' },
  { key: 'score_socios', label: 'Score SPC/Serasa Sócios' },
  { key: 'doc_retirada_rastreio', label: 'Doc. Retirada / Rastreio / Taxista' },
  { key: 'declaracao_fiador', label: 'Declaração Resp. e Fiador' },
];

const ClientePerfilModal = ({
  isOpen,
  onClose,
  clienteCode,
  clienteNome,
  clienteCnpj,
}) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [perfil, setPerfil] = useState(null);
  const [instagram, setInstagram] = useState('');
  const [editandoInstagram, setEditandoInstagram] = useState(false);
  const [fotoLoading, setFotoLoading] = useState(false);
  const fotoInputRef = useRef(null);
  const [dadosPessoa, setDadosPessoa] = useState(null);
  const [modalFotoAberta, setModalFotoAberta] = useState(false);
  const [documentos, setDocumentos] = useState([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const docInputRef = useRef(null);
  const [abaDocAtiva, setAbaDocAtiva] = useState(CATEGORIAS_DOCUMENTOS[0].key);
  const [dadosCNPJ, setDadosCNPJ] = useState(null);
  const [coordenadas, setCoordenadas] = useState(null);
  const [abaAtiva, setAbaAtiva] = useState('info');
  const [conversas, setConversas] = useState([]);
  const [loadingConversas, setLoadingConversas] = useState(false);
  const [conversasTotal, setConversasTotal] = useState(0);
  const [conversasPhone, setConversasPhone] = useState('');
  const conversasEndRef = useRef(null);
  const [mediaCache, setMediaCache] = useState({});
  const [loadingMediaId, setLoadingMediaId] = useState(null);
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const audioRef = useRef(null);
  const [lightboxImg, setLightboxImg] = useState(null);

  // Buscar mídia (áudio/imagem/vídeo) via backend proxy
  const fetchMedia = async (msg) => {
    if (mediaCache[msg.id]) return mediaCache[msg.id];
    setLoadingMediaId(msg.id);
    try {
      const resp = await fetch(`${EvolutionURL}media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msg.id }),
      });
      const json = await resp.json();
      if (json.success && json.data?.base64) {
        const result = {
          base64: json.data.base64,
          mimetype: json.data.mimetype,
        };
        setMediaCache((prev) => ({ ...prev, [msg.id]: result }));
        return result;
      }
      // Mídia expirada ou indisponível
      const expiredResult = { expired: true };
      setMediaCache((prev) => ({ ...prev, [msg.id]: expiredResult }));
      return expiredResult;
    } catch (e) {
      console.warn('Erro ao buscar mídia:', e.message);
      return null;
    } finally {
      setLoadingMediaId(null);
    }
  };

  // Tocar áudio
  const handlePlayAudio = async (msg) => {
    // Se já está tocando esse, pausar
    if (playingAudioId === msg.id && audioRef.current) {
      audioRef.current.pause();
      setPlayingAudioId(null);
      return;
    }
    // Parar áudio anterior
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const media = await fetchMedia(msg);
    if (!media || media.expired) return;
    const src = `data:${media.mimetype || 'audio/ogg'};base64,${media.base64}`;
    const audio = new Audio(src);
    audioRef.current = audio;
    setPlayingAudioId(msg.id);
    audio.onended = () => {
      setPlayingAudioId(null);
      audioRef.current = null;
    };
    audio.play().catch(() => setPlayingAudioId(null));
  };

  // Abrir imagem full res no lightbox
  const handleImageClick = async (msg) => {
    const imgData = msg.message?.imageMessage || msg.message?.albumMessage;
    const thumb = imgData?.jpegThumbnail;
    // Mostrar thumbnail imediatamente como placeholder
    if (thumb) setLightboxImg(`data:image/jpeg;base64,${thumb}`);
    const media = await fetchMedia(msg);
    if (media && !media.expired) {
      setLightboxImg(
        `data:${media.mimetype || 'image/jpeg'};base64,${media.base64}`,
      );
    } else if (media?.expired && !thumb) {
      setLightboxImg(null);
    }
  };

  const isAdmin =
    user?.user_metadata?.role === 'owner' ||
    user?.user_metadata?.role === 'admin';

  const dentroDoPrazo = (createdAt) => {
    if (!createdAt) return false;
    const criacao = new Date(createdAt).getTime();
    const agora = Date.now();
    return agora - criacao < 5 * 60 * 1000;
  };

  const podeAlterarPerfil = () => {
    if (isAdmin) return true;
    return perfil?.updated_at ? dentroDoPrazo(perfil.updated_at) : true;
  };

  const podeRemoverDocumento = (doc) => {
    if (isAdmin) return true;
    return dentroDoPrazo(doc.created_at);
  };

  const formatCurrency = (value) =>
    (parseFloat(value) || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });

  const formatDateBR = (dateStr) => {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '--';
    return d.toLocaleDateString('pt-BR');
  };

  const carregarPerfil = async (personCode) => {
    try {
      const { data } = await supabase
        .from('clientes_confianca_perfil')
        .select('*')
        .eq('person_code', personCode)
        .maybeSingle();
      if (data) {
        setPerfil(data);
        setInstagram(data.instagram || '');
      } else {
        setPerfil(null);
        setInstagram('');
      }
    } catch {
      setPerfil(null);
      setInstagram('');
    }
  };

  const carregarDadosPessoa = async (personCode) => {
    try {
      const { data } = await supabase
        .from('pes_pessoa')
        .select(
          'code, nm_pessoa, fantasy_name, cpf, telefone, email, phones, emails, addresses, uf',
        )
        .eq('code', personCode)
        .maybeSingle();
      setDadosPessoa(data || null);
    } catch {
      setDadosPessoa(null);
    }
  };

  const carregarDocumentos = async (personCode) => {
    try {
      const { data } = await supabase
        .from('clientes_confianca_documentos')
        .select('*')
        .eq('person_code', personCode)
        .order('created_at', { ascending: false });
      setDocumentos(data || []);
    } catch {
      setDocumentos([]);
    }
  };

  const carregarConversas = async (phoneTotvs, phoneCnpj) => {
    setLoadingConversas(true);
    setConversas([]);
    setConversasTotal(0);
    setConversasPhone('');
    try {
      // Tentar primeiro o telefone do TOTVS
      const phones = [];
      if (phoneTotvs) {
        const clean = phoneTotvs.replace(/\D/g, '');
        if (clean.length >= 10) phones.push(clean);
      }
      if (phoneCnpj) {
        const clean = phoneCnpj.replace(/\D/g, '');
        if (clean.length >= 10 && !phones.includes(clean)) phones.push(clean);
      }

      for (const phone of phones) {
        try {
          const resp = await fetch(
            `${EvolutionURL}conversations/${phone}?limit=500`,
          );
          if (resp.ok) {
            const json = await resp.json();
            if (json.success && json.data.total > 0) {
              setConversas(json.data.messages);
              setConversasTotal(json.data.total);
              setConversasPhone(json.data.phone);
              return;
            }
          }
        } catch (e) {
          console.warn('Erro ao buscar conversas para', phone, e.message);
        }
      }
    } catch (e) {
      console.warn('Erro geral ao buscar conversas:', e.message);
    } finally {
      setLoadingConversas(false);
    }
  };

  // Buscar tudo ao abrir
  useEffect(() => {
    if (!isOpen || !clienteCode) return;
    setDados(null);
    setPerfil(null);
    setDadosPessoa(null);
    setDocumentos([]);
    setDadosCNPJ(null);
    setCoordenadas(null);
    setAbaAtiva('info');
    setConversas([]);
    setConversasTotal(0);
    setConversasPhone('');
    setErro('');
    setEditandoInstagram(false);
    setModalFotoAberta(false);

    (async () => {
      setLoading(true);
      try {
        const personCode = parseInt(clienteCode);
        const resp = await fetch(`${TotvsURL}person-statistics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personCode }),
        });
        const json = await resp.json();
        if (json.success) {
          setDados(json.data);
          await carregarPerfil(personCode);
          await carregarDadosPessoa(personCode);
          await carregarDocumentos(personCode);
          // Buscar dados do CNPJ via BrasilAPI
          const cnpjRaw = (clienteCnpj || '').replace(/\D/g, '');
          if (cnpjRaw.length === 14) {
            try {
              const respCnpj = await fetch(`${TotvsURL}cnpj/${cnpjRaw}`);
              if (respCnpj.ok) {
                const cnpjResult = await respCnpj.json();
                if (cnpjResult.success) {
                  setDadosCNPJ(cnpjResult.data);
                  const cepRaw = (cnpjResult.data.cep || '').replace(/\D/g, '');
                  if (cepRaw.length === 8) {
                    try {
                      const respCep = await fetch(
                        `https://brasilapi.com.br/api/cep/v2/${cepRaw}`,
                      );
                      if (respCep.ok) {
                        const cepData = await respCep.json();
                        const coords = cepData?.location?.coordinates;
                        if (coords?.latitude && coords?.longitude) {
                          setCoordenadas({
                            latitude: coords.latitude,
                            longitude: coords.longitude,
                          });
                        }
                      }
                    } catch (e) {
                      console.warn('Erro ao buscar coordenadas:', e.message);
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('Erro ao buscar CNPJ:', e.message);
            }
          }
        } else {
          setErro(json.message || 'Erro ao buscar estatísticas');
        }
      } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        setErro('Erro ao conectar com o servidor');
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, clienteCode]);

  const handleUploadFoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !clienteCode) return;
    if (perfil?.foto_path && !podeAlterarPerfil()) {
      alert(
        'O prazo de 5 minutos para alterar a foto expirou. Somente um administrador pode alterá-la.',
      );
      if (fotoInputRef.current) fotoInputRef.current.value = '';
      return;
    }
    setFotoLoading(true);
    try {
      const personCode = parseInt(clienteCode);
      const ext = file.name.split('.').pop();
      const path = `fotos/${personCode}.${ext}`;
      if (perfil?.foto_path) {
        await supabase.storage.from(BUCKET_NAME).remove([perfil.foto_path]);
      }
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      await supabase.from('clientes_confianca_perfil').upsert(
        {
          person_code: personCode,
          foto_path: path,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'person_code' },
      );
      await carregarPerfil(personCode);
    } catch (err) {
      console.error('Erro ao fazer upload da foto:', err);
      alert('Erro ao enviar foto.');
    } finally {
      setFotoLoading(false);
    }
  };

  const salvarInstagram = async () => {
    if (!clienteCode) return;
    if (perfil?.instagram && !podeAlterarPerfil()) {
      alert(
        'O prazo de 5 minutos para alterar o Instagram expirou. Somente um administrador pode alterá-lo.',
      );
      setEditandoInstagram(false);
      setInstagram(perfil.instagram);
      return;
    }
    const personCode = parseInt(clienteCode);
    try {
      await supabase.from('clientes_confianca_perfil').upsert(
        {
          person_code: personCode,
          instagram: instagram.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'person_code' },
      );
      setEditandoInstagram(false);
      await carregarPerfil(personCode);
    } catch (err) {
      console.error('Erro ao salvar Instagram:', err);
    }
  };

  const handleUploadDocumento = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !clienteCode) return;
    setUploadingDoc(true);
    try {
      const personCode = parseInt(clienteCode);
      const uid = crypto.randomUUID?.() || String(Date.now());
      const ext = file.name.split('.').pop();
      const safeName = file.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `documentos/${personCode}/${abaDocAtiva}/${uid}_${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;
      await supabase.from('clientes_confianca_documentos').insert({
        person_code: personCode,
        nome_arquivo: file.name,
        file_path: path,
        tipo: file.type,
        uploaded_by: user?.id || null,
        categoria: abaDocAtiva,
      });
      await carregarDocumentos(personCode);
    } catch (err) {
      console.error('Erro ao fazer upload do documento:', err);
      alert('Erro ao enviar documento.');
    } finally {
      setUploadingDoc(false);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  };

  const removerDocumento = async (doc) => {
    if (!podeRemoverDocumento(doc)) {
      alert(
        'O prazo de 5 minutos para remover este documento expirou. Somente um administrador pode removê-lo.',
      );
      return;
    }
    if (!confirm(`Remover "${doc.nome_arquivo}"?`)) return;
    try {
      await supabase.storage.from(BUCKET_NAME).remove([doc.file_path]);
      await supabase
        .from('clientes_confianca_documentos')
        .delete()
        .eq('id', doc.id);
      await carregarDocumentos(parseInt(clienteCode));
    } catch (err) {
      console.error('Erro ao remover documento:', err);
    }
  };

  const downloadDocumento = async (doc) => {
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(doc.file_path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.nome_arquivo;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erro ao baixar documento:', err);
    }
  };

  const getFotoUrl = () => {
    if (!perfil?.foto_path) return null;
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${perfil.foto_path}`;
  };

  const getInstagramUrl = () => {
    if (!perfil?.instagram) return null;
    const handle = perfil.instagram.replace(/^@/, '').trim();
    return `https://instagram.com/${handle}`;
  };

  const getScoreColor = () => {
    if (!dados) return 'text-gray-400';
    const avg = dados.averageDelay ?? 0;
    if (avg <= 5) return 'text-green-500';
    if (avg <= 15) return 'text-yellow-500';
    if (avg <= 30) return 'text-orange-500';
    return 'text-red-500';
  };

  const getScoreLabel = () => {
    if (!dados) return '--';
    const avg = dados.averageDelay ?? 0;
    if (avg <= 5) return 'Excelente';
    if (avg <= 15) return 'Bom';
    if (avg <= 30) return 'Regular';
    return 'Crítico';
  };

  const MetricRow = ({ label, value, color }) => (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm font-semibold ${color || 'text-gray-900'}`}>
        {value}
      </span>
    </div>
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Modal Foto Ampliada */}
      {modalFotoAberta && getFotoUrl() && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setModalFotoAberta(false)}
        >
          <div
            className="relative max-w-3xl max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setModalFotoAberta(false)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-100 transition-colors z-10"
            >
              <X size={18} className="text-gray-700" weight="bold" />
            </button>
            <img
              src={getFotoUrl()}
              alt="Foto da loja ampliada"
              className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain"
            />
          </div>
        </div>
      )}

      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-[#000638] to-[#001466] rounded-t-xl">
            <div className="flex items-center gap-4">
              <div className="relative group">
                <div
                  className={`w-12 h-12 rounded-full border-2 border-white/50 overflow-hidden bg-white/10 flex items-center justify-center ${getFotoUrl() ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
                  onClick={() => getFotoUrl() && setModalFotoAberta(true)}
                  title={getFotoUrl() ? 'Clique para ampliar' : ''}
                >
                  {getFotoUrl() ? (
                    <img
                      src={getFotoUrl()}
                      alt="Foto da loja"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Storefront size={24} className="text-white/60" />
                  )}
                </div>
                <button
                  onClick={() => fotoInputRef.current?.click()}
                  disabled={fotoLoading}
                  className="absolute -bottom-1 -right-1 w-6 h-6 bg-white rounded-full shadow-md flex items-center justify-center hover:bg-gray-100 transition-colors border border-gray-200"
                >
                  {fotoLoading ? (
                    <Spinner
                      size={10}
                      className="animate-spin text-[#000638]"
                    />
                  ) : (
                    <Camera size={10} className="text-[#000638]" />
                  )}
                </button>
                <input
                  ref={fotoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleUploadFoto}
                  className="hidden"
                />
              </div>
              <div className="text-white">
                <h2 className="text-lg font-bold">
                  {dadosPessoa?.fantasy_name ||
                    clienteNome ||
                    `Cliente ${clienteCode}`}
                </h2>
                <p className="text-xs text-blue-200 mt-0.5">
                  {dadosPessoa?.nm_pessoa ? `${dadosPessoa.nm_pessoa} • ` : ''}
                  Cód: {clienteCode}
                  {clienteCnpj ? ` • CNPJ: ${clienteCnpj}` : ''}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/20 transition-colors"
            >
              <X size={20} className="text-white" />
            </button>
          </div>

          {/* Abas */}
          <div className="flex border-b border-gray-200">
            {[
              {
                key: 'info',
                label: 'Informações',
                icon: <IdentificationCard size={14} />,
              },
              {
                key: 'conversas',
                label: `Conversas${conversasTotal > 0 ? ` (${conversasTotal})` : ''}`,
                icon: <ChatText size={14} />,
              },
              {
                key: 'estatisticas',
                label: 'Estatísticas',
                icon: <ChartLineUp size={14} />,
              },
              {
                key: 'documentos',
                label: `Documentos (${documentos.length})`,
                icon: <FolderOpen size={14} />,
              },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setAbaAtiva(tab.key);
                  if (
                    tab.key === 'conversas' &&
                    conversas.length === 0 &&
                    !loadingConversas
                  ) {
                    const phoneTotvs = dadosPessoa?.telefone;
                    const phoneCnpj = dadosCNPJ?.ddd_telefone_1;
                    carregarConversas(phoneTotvs, phoneCnpj);
                  }
                }}
                className={`flex items-center gap-1.5 px-5 py-3 text-xs font-bold transition-colors border-b-2 ${
                  abaAtiva === tab.key
                    ? 'border-[#000638] text-[#000638]'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Conteúdo da aba */}
          <div className="overflow-auto flex-1 px-6 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner size={32} className="animate-spin text-[#000638]" />
                <span className="ml-3 text-sm text-gray-500">
                  Carregando perfil do cliente...
                </span>
              </div>
            ) : erro ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                <p className="text-sm text-red-600">{erro}</p>
              </div>
            ) : !dados ? null : abaAtiva === 'info' ? (
              <div className="space-y-6">
                {/* Informações de Contato */}
                <div>
                  <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                    <IdentificationCard size={16} />
                    Informações de Contato
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <IdentificationCard
                        size={18}
                        className="text-gray-500 mt-0.5 flex-shrink-0"
                      />
                      <div>
                        <p className="text-[10px] font-bold text-gray-500 uppercase">
                          CNPJ/CPF
                        </p>
                        <p className="text-sm text-gray-900 font-mono">
                          {dadosPessoa?.cpf || clienteCnpj || '--'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <Phone
                        size={18}
                        className="text-gray-500 mt-0.5 flex-shrink-0"
                      />
                      <div>
                        <p className="text-[10px] font-bold text-gray-500 uppercase">
                          Telefone
                        </p>
                        <p className="text-sm text-gray-900">
                          {dadosPessoa?.telefone || '--'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <Envelope
                        size={18}
                        className="text-gray-500 mt-0.5 flex-shrink-0"
                      />
                      <div>
                        <p className="text-[10px] font-bold text-gray-500 uppercase">
                          E-mail
                        </p>
                        <p className="text-sm text-gray-900 break-all">
                          {dadosPessoa?.email || '--'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <MapPin
                        size={18}
                        className="text-gray-500 mt-0.5 flex-shrink-0"
                      />
                      <div>
                        <p className="text-[10px] font-bold text-gray-500 uppercase">
                          Endereço
                        </p>
                        <p className="text-sm text-gray-900">
                          {(() => {
                            const addr = dadosPessoa?.addresses;
                            if (!addr) return dadosPessoa?.uf || '--';
                            const main = Array.isArray(addr)
                              ? addr.find((a) => a.isDefault) || addr[0]
                              : addr;
                            if (!main) return dadosPessoa?.uf || '--';
                            const parts = [
                              main.address || main.street,
                              main.number,
                              main.complement,
                              main.neighborhood || main.district,
                              main.city || main.cityDescription,
                              main.state || main.uf || dadosPessoa?.uf,
                              main.zipCode || main.cep,
                            ].filter(Boolean);
                            return parts.length > 0
                              ? parts.join(', ')
                              : dadosPessoa?.uf || '--';
                          })()}
                        </p>
                      </div>
                    </div>
                    {/* Instagram */}
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg md:col-span-2">
                      <InstagramLogo
                        size={18}
                        className="text-pink-500 mt-0.5 flex-shrink-0"
                      />
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-gray-500 uppercase">
                          Instagram
                        </p>
                        {editandoInstagram ? (
                          <div className="flex items-center gap-2 mt-1">
                            <div className="relative flex-1 max-w-xs">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                                @
                              </span>
                              <input
                                type="text"
                                value={instagram}
                                onChange={(e) => setInstagram(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') salvarInstagram();
                                }}
                                placeholder="usuario"
                                className="border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white"
                              />
                            </div>
                            <button
                              onClick={salvarInstagram}
                              className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                            >
                              <CheckCircle size={16} weight="bold" />
                            </button>
                            <button
                              onClick={() => {
                                setEditandoInstagram(false);
                                setInstagram(perfil?.instagram || '');
                              }}
                              className="p-1.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300 transition-colors"
                            >
                              <X size={16} weight="bold" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {perfil?.instagram ? (
                              <a
                                href={getInstagramUrl()}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-pink-600 hover:text-pink-700 hover:underline transition-colors"
                              >
                                @{perfil.instagram}
                              </a>
                            ) : (
                              <span className="text-sm text-gray-400">
                                Não informado
                              </span>
                            )}
                            <button
                              onClick={() => setEditandoInstagram(true)}
                              className="p-1 text-gray-400 hover:text-[#000638] transition-colors"
                              title="Editar Instagram"
                            >
                              <PencilSimple size={14} weight="bold" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Dados CNPJ - BrasilAPI */}
                {dadosCNPJ && (
                  <div>
                    <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                      <Buildings size={16} />
                      Dados do CNPJ (Receita Federal)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {dadosCNPJ.razao_social && (
                        <div className="p-3 bg-gray-50 rounded-lg md:col-span-2">
                          <p className="text-[10px] font-bold text-gray-500">
                            RAZÃO SOCIAL
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            {dadosCNPJ.razao_social}
                          </p>
                        </div>
                      )}
                      {dadosCNPJ.nome_fantasia && (
                        <div className="p-3 bg-gray-50 rounded-lg md:col-span-2">
                          <p className="text-[10px] font-bold text-gray-500">
                            NOME FANTASIA
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            {dadosCNPJ.nome_fantasia}
                          </p>
                        </div>
                      )}
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-[10px] font-bold text-gray-500">
                          SITUAÇÃO CADASTRAL
                        </p>
                        <p
                          className={`text-sm font-bold ${dadosCNPJ.descricao_situacao_cadastral === 'ATIVA' ? 'text-green-600' : 'text-red-600'}`}
                        >
                          {dadosCNPJ.descricao_situacao_cadastral || '—'}
                        </p>
                        {dadosCNPJ.data_situacao_cadastral && (
                          <p className="text-[10px] text-gray-400 mt-1">
                            Desde{' '}
                            {dadosCNPJ.data_situacao_cadastral
                              .split('-')
                              .reverse()
                              .join('/')}
                          </p>
                        )}
                      </div>
                      {dadosCNPJ.natureza_juridica && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-[10px] font-bold text-gray-500">
                            NATUREZA JURÍDICA
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            {dadosCNPJ.natureza_juridica}
                          </p>
                        </div>
                      )}
                      {dadosCNPJ.data_inicio_atividade && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-[10px] font-bold text-gray-500">
                            DATA DE ABERTURA
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            {dadosCNPJ.data_inicio_atividade
                              .split('-')
                              .reverse()
                              .join('/')}
                          </p>
                        </div>
                      )}
                      {dadosCNPJ.capital_social != null && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-[10px] font-bold text-gray-500">
                            CAPITAL SOCIAL
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            {formatCurrency(dadosCNPJ.capital_social)}
                          </p>
                        </div>
                      )}
                      {dadosCNPJ.porte && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-[10px] font-bold text-gray-500">
                            PORTE
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            {dadosCNPJ.porte}
                          </p>
                        </div>
                      )}
                      {dadosCNPJ.cnae_fiscal_descricao && (
                        <div className="p-3 bg-gray-50 rounded-lg md:col-span-2">
                          <p className="text-[10px] font-bold text-gray-500">
                            CNAE PRINCIPAL
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            {dadosCNPJ.cnae_fiscal} —{' '}
                            {dadosCNPJ.cnae_fiscal_descricao}
                          </p>
                        </div>
                      )}
                      {(dadosCNPJ.logradouro ||
                        dadosCNPJ.bairro ||
                        dadosCNPJ.municipio ||
                        dadosCNPJ.cep) && (
                        <div className="p-3 bg-gray-50 rounded-lg md:col-span-2">
                          <p className="text-[10px] font-bold text-gray-500">
                            ENDEREÇO
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            {[
                              [
                                dadosCNPJ.descricao_tipo_de_logradouro,
                                dadosCNPJ.logradouro,
                                dadosCNPJ.numero,
                                dadosCNPJ.complemento,
                              ]
                                .filter(Boolean)
                                .join(', '),
                              dadosCNPJ.bairro,
                              dadosCNPJ.municipio && dadosCNPJ.uf
                                ? `${dadosCNPJ.municipio}/${dadosCNPJ.uf}`
                                : dadosCNPJ.municipio || dadosCNPJ.uf,
                              dadosCNPJ.cep ? `CEP ${dadosCNPJ.cep}` : '',
                            ]
                              .filter(Boolean)
                              .join(' — ')}
                          </p>
                          <div className="flex gap-2 mt-2">
                            {coordenadas && (
                              <a
                                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coordenadas.latitude},${coordenadas.longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-md transition-colors"
                              >
                                <MapPin size={12} weight="fill" /> Street View
                              </a>
                            )}
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                [
                                  dadosCNPJ.descricao_tipo_de_logradouro,
                                  dadosCNPJ.logradouro,
                                  dadosCNPJ.numero,
                                  dadosCNPJ.bairro,
                                  dadosCNPJ.municipio,
                                  dadosCNPJ.uf,
                                ]
                                  .filter(Boolean)
                                  .join(', '),
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white text-[10px] font-bold rounded-md transition-colors"
                            >
                              <MapPin size={12} /> Google Maps
                            </a>
                          </div>
                        </div>
                      )}
                      {dadosCNPJ.ddd_telefone_1 && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-[10px] font-bold text-gray-500">
                            TELEFONE
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            {dadosCNPJ.ddd_telefone_1}
                          </p>
                        </div>
                      )}
                      {dadosCNPJ.email && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-[10px] font-bold text-gray-500">
                            E-MAIL
                          </p>
                          <p className="text-sm font-bold text-gray-900 lowercase">
                            {dadosCNPJ.email}
                          </p>
                        </div>
                      )}
                      {dadosCNPJ.opcao_pelo_simples != null && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-[10px] font-bold text-gray-500">
                            SIMPLES NACIONAL
                          </p>
                          <p
                            className={`text-sm font-bold ${dadosCNPJ.opcao_pelo_simples ? 'text-green-600' : 'text-gray-900'}`}
                          >
                            {dadosCNPJ.opcao_pelo_simples
                              ? 'Optante'
                              : 'Não optante'}
                          </p>
                        </div>
                      )}
                      {dadosCNPJ.opcao_pelo_mei != null && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-[10px] font-bold text-gray-500">
                            MEI
                          </p>
                          <p
                            className={`text-sm font-bold ${dadosCNPJ.opcao_pelo_mei ? 'text-green-600' : 'text-gray-900'}`}
                          >
                            {dadosCNPJ.opcao_pelo_mei ? 'Sim' : 'Não'}
                          </p>
                        </div>
                      )}
                      {dadosCNPJ.descricao_identificador_matriz_filial && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-[10px] font-bold text-gray-500">
                            TIPO
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            {dadosCNPJ.descricao_identificador_matriz_filial}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* CNAEs Secundários */}
                    {dadosCNPJ.cnaes_secundarios?.length > 0 &&
                      dadosCNPJ.cnaes_secundarios[0].codigo !== 0 && (
                        <div className="mt-4">
                          <p className="text-[10px] font-bold text-gray-500 mb-2">
                            CNAES SECUNDÁRIOS
                          </p>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {dadosCNPJ.cnaes_secundarios.map((cnae, i) => (
                              <p key={i} className="text-xs text-gray-700">
                                <span className="font-mono text-gray-500">
                                  {cnae.codigo}
                                </span>{' '}
                                — {cnae.descricao}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                    {/* Quadro Societário (QSA) */}
                    {dadosCNPJ.qsa?.length > 0 && (
                      <div className="mt-4">
                        <p className="text-[10px] font-bold text-gray-500 mb-2">
                          QUADRO SOCIETÁRIO (QSA)
                        </p>
                        <div className="space-y-2">
                          {dadosCNPJ.qsa.map((socio, i) => (
                            <div
                              key={i}
                              className="p-2 bg-gray-50 rounded-lg flex justify-between items-center"
                            >
                              <div>
                                <p className="text-sm font-bold text-gray-900">
                                  {socio.nome_socio}
                                </p>
                                <p className="text-[10px] text-gray-500">
                                  {socio.qualificacao_socio}
                                </p>
                              </div>
                              {socio.data_entrada_sociedade && (
                                <p className="text-[10px] text-gray-400">
                                  Desde{' '}
                                  {socio.data_entrada_sociedade
                                    .split('-')
                                    .reverse()
                                    .join('/')}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : abaAtiva === 'conversas' ? (
              <div className="flex flex-col h-full">
                {loadingConversas ? (
                  <div className="flex items-center justify-center py-12">
                    <Spinner
                      size={32}
                      className="animate-spin text-green-600"
                    />
                    <span className="ml-3 text-sm text-gray-500">
                      Carregando conversas do WhatsApp...
                    </span>
                  </div>
                ) : conversas.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <WhatsappLogo size={48} className="mb-3 opacity-30" />
                    <p className="text-sm font-medium">
                      Nenhuma conversa encontrada
                    </p>
                    <p className="text-xs mt-1">
                      Não foram encontradas mensagens para o telefone deste
                      cliente.
                    </p>
                    {dadosPessoa?.telefone && (
                      <p className="text-[10px] mt-2 text-gray-300">
                        Telefone consultado: {dadosPessoa.telefone}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Header da conversa */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <WhatsappLogo
                          size={18}
                          className="text-green-600"
                          weight="fill"
                        />
                        <span className="text-xs font-bold text-gray-700">
                          {conversasTotal} mensagens
                        </span>
                        <span className="text-[10px] text-gray-400">
                          • {conversasPhone}
                        </span>
                      </div>
                      {conversasTotal > 500 && (
                        <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                          Exibindo últimas 500
                        </span>
                      )}
                    </div>

                    {/* Área de mensagens */}
                    <div
                      className="flex-1 bg-[#e5ddd5] rounded-lg overflow-y-auto p-4 space-y-1"
                      style={{
                        maxHeight: 'calc(90vh - 220px)',
                        backgroundImage:
                          "url(\"data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z' fill='%23d4cfc4' fill-opacity='.15' fill-rule='evenodd'/%3E%3C/svg%3E\")",
                      }}
                    >
                      {conversas.map((msg, idx) => {
                        const isFromMe = msg.key?.fromMe === true;
                        const msgType = msg.messageType;
                        const prevMsg = idx > 0 ? conversas[idx - 1] : null;

                        // Separador de data
                        const msgDate = msg.msg_ts_tz
                          ? new Date(msg.msg_ts_tz).toLocaleDateString('pt-BR')
                          : '';
                        const prevDate = prevMsg?.msg_ts_tz
                          ? new Date(prevMsg.msg_ts_tz).toLocaleDateString(
                              'pt-BR',
                            )
                          : '';
                        const showDateSep = msgDate && msgDate !== prevDate;

                        // Hora
                        const msgTime = msg.msg_ts_tz
                          ? new Date(msg.msg_ts_tz).toLocaleTimeString(
                              'pt-BR',
                              { hour: '2-digit', minute: '2-digit' },
                            )
                          : '';

                        // Não exibir mensagens de protocolo
                        if (
                          msgType === 'protocolMessage' ||
                          msgType === 'reactionMessage'
                        )
                          return null;

                        // Conteúdo da mensagem
                        let content = null;
                        if (
                          msgType === 'conversation' ||
                          msgType === 'extendedTextMessage' ||
                          msgType === 'editedMessage'
                        ) {
                          content = (
                            <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                              {msg.text_content || ''}
                            </p>
                          );
                        } else if (
                          msgType === 'imageMessage' ||
                          msgType === 'albumMessage'
                        ) {
                          const imgData =
                            msg.message?.imageMessage ||
                            msg.message?.albumMessage;
                          const thumb = imgData?.jpegThumbnail;
                          content = (
                            <div>
                              {thumb ? (
                                <div
                                  className="relative cursor-pointer group"
                                  onClick={() => handleImageClick(msg)}
                                >
                                  <img
                                    src={
                                      mediaCache[msg.id]
                                        ? `data:${mediaCache[msg.id].mimetype || 'image/jpeg'};base64,${mediaCache[msg.id].base64}`
                                        : `data:image/jpeg;base64,${thumb}`
                                    }
                                    alt="imagem"
                                    className="rounded-lg max-w-[220px] max-h-[220px]"
                                    style={{
                                      aspectRatio:
                                        imgData?.width && imgData?.height
                                          ? `${imgData.width}/${imgData.height}`
                                          : undefined,
                                    }}
                                  />
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 rounded-lg transition">
                                    {loadingMediaId === msg.id ? (
                                      <CircleNotch
                                        size={24}
                                        className="text-white animate-spin"
                                      />
                                    ) : (
                                      <MagnifyingGlassPlus
                                        size={24}
                                        className="text-white opacity-0 group-hover:opacity-100 transition"
                                      />
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div
                                  className="flex items-center gap-1.5 text-[13px] cursor-pointer hover:underline"
                                  onClick={() => handleImageClick(msg)}
                                >
                                  <Image size={14} className="opacity-60" />
                                  <span className="italic opacity-75">
                                    Imagem
                                  </span>
                                  {loadingMediaId === msg.id && (
                                    <CircleNotch
                                      size={12}
                                      className="animate-spin"
                                    />
                                  )}
                                </div>
                              )}
                              {msg.text_content && (
                                <p className="text-[13px] mt-1 whitespace-pre-wrap break-words">
                                  {msg.text_content}
                                </p>
                              )}
                            </div>
                          );
                        } else if (
                          msgType === 'audioMessage' ||
                          msgType === 'ptvMessage'
                        ) {
                          const audioData =
                            msg.message?.audioMessage ||
                            msg.message?.ptvMessage;
                          const seconds = audioData?.seconds || 0;
                          const min = Math.floor(seconds / 60);
                          const sec = seconds % 60;
                          let bars = [];
                          try {
                            if (audioData?.waveform) {
                              const raw = atob(audioData.waveform);
                              const all = Array.from(raw, (c) =>
                                c.charCodeAt(0),
                              );
                              const step = Math.max(
                                1,
                                Math.floor(all.length / 32),
                              );
                              bars = all
                                .filter((_, i) => i % step === 0)
                                .slice(0, 32);
                            }
                          } catch {}
                          const isPlaying = playingAudioId === msg.id;
                          const isLoadingThis = loadingMediaId === msg.id;
                          const isExpired = mediaCache[msg.id]?.expired;
                          content = (
                            <div
                              className={`flex items-center gap-2 min-w-[180px] max-w-[260px] select-none ${isExpired ? 'opacity-60' : 'cursor-pointer'}`}
                              onClick={() => !isExpired && handlePlayAudio(msg)}
                            >
                              <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                                {isLoadingThis ? (
                                  <CircleNotch
                                    size={16}
                                    className="text-white animate-spin"
                                  />
                                ) : isPlaying ? (
                                  <Pause
                                    size={16}
                                    className="text-white"
                                    weight="fill"
                                  />
                                ) : (
                                  <Play
                                    size={16}
                                    className="text-white"
                                    weight="fill"
                                  />
                                )}
                              </div>
                              <div className="flex items-end gap-[2px] h-6 flex-1">
                                {bars.length > 0 ? (
                                  bars.map((v, i) => (
                                    <div
                                      key={i}
                                      className={`w-[3px] rounded-full ${isPlaying ? 'bg-emerald-500' : 'bg-emerald-600/50'}`}
                                      style={{
                                        height: `${Math.max(3, (v / 255) * 24)}px`,
                                      }}
                                    />
                                  ))
                                ) : (
                                  <div className="h-[2px] flex-1 bg-gray-300 rounded-full my-auto" />
                                )}
                              </div>
                              <span className="text-[11px] text-gray-500 shrink-0">
                                {isExpired
                                  ? '⏱ expirado'
                                  : `${min}:${String(sec).padStart(2, '0')}`}
                              </span>
                            </div>
                          );
                        } else if (msgType === 'videoMessage') {
                          const vidData = msg.message?.videoMessage;
                          const vidThumb = vidData?.jpegThumbnail;
                          const vidSecs = vidData?.seconds || 0;
                          content = (
                            <div>
                              <div className="relative inline-block">
                                {vidThumb ? (
                                  <img
                                    src={`data:image/jpeg;base64,${vidThumb}`}
                                    alt="vídeo"
                                    className="rounded-lg max-w-[220px] max-h-[220px]"
                                  />
                                ) : (
                                  <div className="w-[160px] h-[90px] bg-gray-200 rounded-lg flex items-center justify-center">
                                    <VideoCamera
                                      size={24}
                                      className="text-gray-400"
                                    />
                                  </div>
                                )}
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
                                    <VideoCamera
                                      size={20}
                                      className="text-white"
                                      weight="fill"
                                    />
                                  </div>
                                </div>
                                {vidSecs > 0 && (
                                  <span className="absolute bottom-1 right-1 text-[10px] text-white bg-black/60 px-1.5 py-0.5 rounded">
                                    {Math.floor(vidSecs / 60)}:
                                    {String(vidSecs % 60).padStart(2, '0')}
                                  </span>
                                )}
                              </div>
                              {msg.text_content && (
                                <p className="text-[13px] mt-1 whitespace-pre-wrap break-words">
                                  {msg.text_content}
                                </p>
                              )}
                            </div>
                          );
                        } else if (msgType === 'documentMessage') {
                          content = (
                            <div className="flex items-center gap-1.5 text-[13px]">
                              <File size={14} className="opacity-60" />
                              <span className="italic opacity-75">
                                Documento
                              </span>
                              {msg.text_content && (
                                <span className="ml-1">{msg.text_content}</span>
                              )}
                            </div>
                          );
                        } else if (msgType === 'stickerMessage') {
                          const stickerData = msg.message?.stickerMessage;
                          const stickerThumb =
                            stickerData?.jpegThumbnail ||
                            stickerData?.pngThumbnail;
                          content = stickerThumb ? (
                            <img
                              src={`data:image/webp;base64,${stickerThumb}`}
                              alt="sticker"
                              className="w-[100px] h-[100px] object-contain"
                            />
                          ) : (
                            <p className="text-[13px] italic opacity-75">
                              Figurinha
                            </p>
                          );
                        } else if (msgType === 'contactMessage') {
                          content = (
                            <div className="flex items-center gap-1.5 text-[13px]">
                              <Phone size={14} className="opacity-60" />
                              <span className="italic opacity-75">Contato</span>
                            </div>
                          );
                        } else if (msgType === 'listMessage') {
                          content = (
                            <p className="text-[13px]">
                              {msg.text_content || 'Lista'}
                            </p>
                          );
                        } else {
                          content = (
                            <p className="text-[13px] italic opacity-75">
                              {msg.text_content || msgType}
                            </p>
                          );
                        }

                        return (
                          <React.Fragment key={msg.id}>
                            {showDateSep && (
                              <div className="flex justify-center my-2">
                                <span className="bg-white/80 text-[10px] font-bold text-gray-500 px-3 py-1 rounded-full shadow-sm">
                                  {msgDate}
                                </span>
                              </div>
                            )}
                            <div
                              className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`relative max-w-[75%] px-3 py-1.5 rounded-lg shadow-sm ${
                                  isFromMe
                                    ? 'bg-[#d9fdd3] text-gray-900'
                                    : 'bg-white text-gray-900'
                                }`}
                              >
                                {!isFromMe && msg.pushName && (
                                  <p className="text-[10px] font-bold text-emerald-700 mb-0.5">
                                    {msg.pushName}
                                  </p>
                                )}
                                {content}
                                <p
                                  className={`text-[9px] mt-0.5 text-right ${isFromMe ? 'text-gray-500' : 'text-gray-400'}`}
                                >
                                  {msgTime}
                                </p>
                              </div>
                            </div>
                          </React.Fragment>
                        );
                      })}
                      <div ref={conversasEndRef} />
                    </div>
                  </>
                )}
              </div>
            ) : abaAtiva === 'estatisticas' ? (
              <div className="space-y-6">
                {/* Score + Stats */}
                <div>
                  <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                    <Star size={16} />
                    Score & Resumo
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="p-3 bg-gray-50 rounded-lg text-center">
                      <Star
                        size={24}
                        className={getScoreColor()}
                        weight="fill"
                      />
                      <p
                        className={`text-lg font-bold mt-1 ${getScoreColor()}`}
                      >
                        {getScoreLabel()}
                      </p>
                      <p className="text-[10px] text-gray-400 uppercase">
                        Score
                      </p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg text-center">
                      <p className="text-lg font-extrabold text-[#000638]">
                        {dados.purchaseQuantity ?? 0}
                      </p>
                      <p className="text-[10px] text-gray-400 uppercase">
                        Compras
                      </p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg text-center">
                      <p className="text-lg font-extrabold text-green-600">
                        {formatCurrency(dados.totalPurchaseValue)}
                      </p>
                      <p className="text-[10px] text-gray-400 uppercase">
                        Total Comprado
                      </p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg text-center">
                      <p className="text-lg font-extrabold text-amber-600">
                        {dados.quantityInstallmentsOpen ?? 0}
                      </p>
                      <p className="text-[10px] text-gray-400 uppercase">
                        Parcelas Abertas
                      </p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg text-center">
                      <p className="text-lg font-extrabold text-red-600">
                        {dados.averageDelay ?? 0}{' '}
                        <span className="text-sm font-normal text-gray-400">
                          dias
                        </span>
                      </p>
                      <p className="text-[10px] text-gray-400 uppercase">
                        Atraso Médio
                      </p>
                    </div>
                  </div>
                </div>

                {/* Seções detalhadas */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Histórico de Compras */}
                  <div>
                    <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                      <ShoppingCart size={16} className="text-blue-600" />
                      Histórico de Compras
                    </h3>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <MetricRow
                        label="Quantidade de Compras"
                        value={dados.purchaseQuantity ?? '--'}
                      />
                      <MetricRow
                        label="Quantidade de Peças"
                        value={dados.purchasePiecesQuantity ?? '--'}
                      />
                      <MetricRow
                        label="Total de Compras"
                        value={formatCurrency(dados.totalPurchaseValue)}
                        color="text-green-600"
                      />
                      <MetricRow
                        label="Média por Compra"
                        value={formatCurrency(dados.averagePurchaseValue)}
                      />
                      <MetricRow
                        label="Maior Compra"
                        value={`${formatCurrency(dados.biggestPurchaseValue)} (${formatDateBR(dados.biggestPurchaseDate)})`}
                        color="text-purple-600"
                      />
                      <MetricRow
                        label="Primeira Compra"
                        value={`${formatCurrency(dados.firstPurchaseValue)} (${formatDateBR(dados.firstPurchaseDate)})`}
                      />
                      <MetricRow
                        label="Última Compra"
                        value={`${formatCurrency(dados.lastPurchaseValue)} (${formatDateBR(dados.lastPurchaseDate)})`}
                        color="text-teal-600"
                      />
                    </div>
                  </div>

                  {/* Parcelas Pagas */}
                  <div>
                    <h3 className="text-sm font-bold text-green-800 mb-3 flex items-center gap-2">
                      <CheckCircle size={16} className="text-green-600" />
                      Parcelas Pagas
                    </h3>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <MetricRow
                        label="Total Pago"
                        value={formatCurrency(dados.totalInstallmentsPaid)}
                        color="text-green-600"
                      />
                      <MetricRow
                        label="Qtd. Parcelas Pagas"
                        value={dados.quantityInstallmentsPaid ?? '--'}
                      />
                      <MetricRow
                        label="Média por Parcela"
                        value={formatCurrency(
                          dados.averageValueInstallmentsPaid,
                        )}
                      />
                      <MetricRow
                        label="Última Fatura Paga"
                        value={`${formatCurrency(dados.lastInvoicePaidValue)} (${formatDateBR(dados.lastInvoicePaidDate)})`}
                        color="text-green-600"
                      />
                    </div>
                  </div>

                  {/* Parcelas em Atraso */}
                  <div>
                    <h3 className="text-sm font-bold text-red-800 mb-3 flex items-center gap-2">
                      <Warning size={16} className="text-red-600" />
                      Parcelas em Atraso
                    </h3>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <MetricRow
                        label="Total em Atraso"
                        value={formatCurrency(dados.totalInstallmentsDelayed)}
                        color="text-red-600"
                      />
                      <MetricRow
                        label="Qtd. Parcelas Atrasadas"
                        value={dados.quantityInstallmentsDelayed ?? '--'}
                      />
                      <MetricRow
                        label="Média de Atraso"
                        value={dados.averageInstallmentDelay ?? '--'}
                      />
                      <MetricRow
                        label="Atraso Médio"
                        value={`${dados.averageDelay ?? 0} dias`}
                        color="text-orange-600"
                      />
                      <MetricRow
                        label="Atraso Máximo"
                        value={`${dados.maximumDelay ?? 0} dias`}
                        color="text-red-700"
                      />
                    </div>
                  </div>

                  {/* Em Aberto & Débitos */}
                  <div>
                    <h3 className="text-sm font-bold text-amber-800 mb-3 flex items-center gap-2">
                      <Clock size={16} className="text-amber-600" />
                      Em Aberto & Débitos
                    </h3>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <MetricRow
                        label="Total em Aberto"
                        value={formatCurrency(dados.totalInstallmentsOpen)}
                        color="text-amber-600"
                      />
                      <MetricRow
                        label="Qtd. Parcelas Abertas"
                        value={dados.quantityInstallmentsOpen ?? '--'}
                      />
                      <MetricRow
                        label="Média em Aberto"
                        value={formatCurrency(dados.averageInstallmentsOpen)}
                      />
                      <MetricRow
                        label="Maior Débito"
                        value={`${formatCurrency(dados.highestDebt)} (${formatDateBR(dados.highestDebtDate)})`}
                        color="text-red-600"
                      />
                      <MetricRow
                        label="Limite Coligado"
                        value={formatCurrency(dados.affiliateLimitAmount)}
                        color="text-blue-600"
                      />
                      <MetricRow
                        label="Último Aviso Cobrança"
                        value={formatDateBR(dados.lastDebtNoticeDate)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Aba Documentos */
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                    <FolderOpen size={16} className="text-purple-600" />
                    Documentos do Cliente
                  </h3>

                  {/* Abas de categorias */}
                  <div className="border-b border-gray-200 overflow-x-auto mb-4">
                    <div className="flex min-w-max">
                      {CATEGORIAS_DOCUMENTOS.map((cat) => {
                        const docsCategoria = documentos.filter(
                          (d) => d.categoria === cat.key,
                        );
                        const temDocs = docsCategoria.length > 0;
                        return (
                          <button
                            key={cat.key}
                            onClick={() => setAbaDocAtiva(cat.key)}
                            className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                              abaDocAtiva === cat.key
                                ? 'border-purple-600 text-purple-700 bg-purple-50/50'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {cat.label}
                            {temDocs ? (
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold bg-green-100 text-green-700">
                                {docsCategoria.length}
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold bg-red-100 text-red-500">
                                0
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Header com nome da categoria e botão de upload */}
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-500">
                      {
                        CATEGORIAS_DOCUMENTOS.find((c) => c.key === abaDocAtiva)
                          ?.label
                      }
                    </p>
                    <button
                      onClick={() => docInputRef.current?.click()}
                      disabled={uploadingDoc}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                    >
                      {uploadingDoc ? (
                        <Spinner size={12} className="animate-spin" />
                      ) : (
                        <FileArrowUp size={14} weight="bold" />
                      )}
                      Anexar Arquivo
                    </button>
                    <input
                      ref={docInputRef}
                      type="file"
                      onChange={handleUploadDocumento}
                      className="hidden"
                    />
                  </div>

                  {/* Lista de documentos da categoria ativa */}
                  {(() => {
                    const docsAtivos = documentos.filter(
                      (d) => d.categoria === abaDocAtiva,
                    );
                    if (docsAtivos.length === 0) {
                      return (
                        <div className="text-center py-6 text-gray-400">
                          <FileText
                            size={32}
                            className="mx-auto mb-2 opacity-30"
                          />
                          <p className="text-xs">
                            Nenhum arquivo anexado nesta categoria
                          </p>
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        {docsAtivos.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3 hover:bg-gray-100 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <FileText
                                size={20}
                                className="text-purple-500 flex-shrink-0"
                              />
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {doc.nome_arquivo}
                                </p>
                                <p className="text-[10px] text-gray-400">
                                  {formatDateBR(doc.created_at)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => downloadDocumento(doc)}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Download"
                              >
                                <DownloadSimple size={16} weight="bold" />
                              </button>
                              {podeRemoverDocumento(doc) && (
                                <button
                                  onClick={() => removerDocumento(doc)}
                                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Remover"
                                >
                                  <Trash size={16} weight="bold" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Resumo geral de todas as categorias */}
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">
                      Resumo de documentos
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIAS_DOCUMENTOS.map((cat) => {
                        const count = documentos.filter(
                          (d) => d.categoria === cat.key,
                        ).length;
                        return (
                          <span
                            key={cat.key}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium ${
                              count > 0
                                ? 'bg-green-50 text-green-700 border border-green-200'
                                : 'bg-red-50 text-red-500 border border-red-200'
                            }`}
                          >
                            {count > 0 ? (
                              <CheckCircle size={10} weight="fill" />
                            ) : (
                              <X size={10} />
                            )}
                            {cat.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-bold rounded-lg transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox para imagem full-res */}
      {lightboxImg && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[999]"
          onClick={() => setLightboxImg(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxImg(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white shadow flex items-center justify-center z-10 hover:bg-gray-100"
            >
              <X size={16} weight="bold" />
            </button>
            <img
              src={lightboxImg}
              alt="imagem ampliada"
              className="rounded-lg max-w-[90vw] max-h-[90vh] object-contain"
            />
            {loadingMediaId && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-2">
                <CircleNotch size={12} className="animate-spin" /> Carregando
                alta resolução...
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ClientePerfilModal;
