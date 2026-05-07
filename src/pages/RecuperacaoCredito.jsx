import React, { useState, useEffect, useMemo, useRef } from 'react';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { supabaseAdmin } from '../lib/supabase';
import PageTitle from '../components/ui/PageTitle';
import Notification from '../components/ui/Notification';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  MagnifyingGlass,
  WhatsappLogo,
  Users,
  CurrencyDollar,
  Warning,
  Buildings,
  Storefront,
  ArrowUp,
  ArrowDown,
  SortAscending,
  SortDescending,
  X,
  Receipt,
  FileText,
  CircleNotch,
  Scales,
  Paperclip,
  Phone,
  Envelope,
  MapPin,
  DownloadSimple,
  Trash,
  ChatText,
  Image,
  Microphone,
  VideoCamera,
  File,
  Play,
  Pause,
  MagnifyingGlassPlus,
  Spinner,
} from '@phosphor-icons/react';
import { TotvsURL } from '../config/constants';

const EvolutionURL = 'https://apigestaocrosby-bw2v.onrender.com/api/evolution/';
const BUCKET_NAME = 'clientes-confianca';

const CLIENTES_BLOQUEADOS = [
  'IAGO REGIS',
  'JU STORE',
  'DULCIDALVA',
  'JOSELIO ELIAS ALVES',
  'FRANCISCO SEVERINO',
  'EVERALDA',
  'ADAUREA',
  'MAURICIO',
  'ROSIEDJ',
  'TREND',
  'MAROS VINICIUS',
  'MARCOS VINICIUS',
  'FILIPE MEDEIROS',
  'GISELLE PATRICIA',
  'LEVE MAIS',
  'MENDOCA DEMINITO',
  'MENDONCA DEMINITO',
  'CASCIA MATOS',
  'FABIO JUNIOR',
  'RAYENE TAVARES',
  'SABRINA TELES',
  'I AM DANTAS',
  'I A M DANTAS',
  'I M A DANTAS',
  'I M DANTAS',
  'JOSIMAR',
  'FELIPE MEDEIROS',
  'ROSILENE MARIA',
  'MARIA DAS DORES',
  'G A P DA SILVA',
  'MARIA DE FATIMA',
  'I M DE A DANTAS',
];

const isClienteBloqueado = (nome) => {
  const nomeUpper = (nome || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return CLIENTES_BLOQUEADOS.some((bloq) => {
    const bloqNorm = bloq.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return nomeUpper.includes(bloqNorm);
  });
};

const STATUS_OPTIONS = [
  {
    value: 'PROTESTO',
    label: 'Protesto',
    color: 'bg-red-100 text-red-700 border-red-200',
  },
  {
    value: 'NEJ',
    label: 'NEJ',
    color: 'bg-amber-100 text-amber-700 border-amber-200',
  },
  {
    value: 'EM_NEGOCIACAO',
    label: 'Em Negociação',
    color: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  {
    value: 'NJ',
    label: 'NJ',
    color: 'bg-purple-100 text-purple-700 border-purple-200',
  },
  {
    value: 'PAGO',
    label: 'Pago',
    color: 'bg-green-100 text-green-700 border-green-200',
  },
  {
    value: 'BLOQUEADO',
    label: 'Bloqueado',
    color: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  },
];

const getStatusStyle = (status) => {
  const found = STATUS_OPTIONS.find((s) => s.value === status);
  return found ? found.color : 'bg-gray-100 text-gray-600 border-gray-200';
};

const getStatusLabel = (status) => {
  const found = STATUS_OPTIONS.find((s) => s.value === status);
  return found ? found.label : '—';
};

const formatarMoeda = (valor) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    valor || 0,
  );

const formatarCNPJ = (cnpj) => {
  if (!cnpj) return '—';
  const limpo = String(cnpj).replace(/\D/g, '');
  if (limpo.length === 14) {
    return limpo.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5',
    );
  }
  if (limpo.length === 11) {
    return limpo.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return cnpj;
};

const formatarData = (data) => {
  if (!data) return 'N/A';
  const [datePart] = String(data).split('T');
  const [y, m, d] = datePart.split('-');
  if (!y || !m || !d) return 'N/A';
  return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
};

const RecuperacaoCredito = () => {
  const [loading, setLoading] = useState(false);
  const [clientes, setClientes] = useState([]);
  const [notification, setNotification] = useState(null);
  const [busca, setBusca] = useState('');
  const [ordenarPor, setOrdenarPor] = useState('valor_total');
  const [direcaoOrdenacao, setDirecaoOrdenacao] = useState('desc');
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [filtroOrigem, setFiltroOrigem] = useState('TODOS');
  const [filtroSicredi, setFiltroSicredi] = useState(false);
  const [filiaisCodigos, setFiliaisCodigos] = useState([]);
  const [danfeLoading, setDanfeLoading] = useState(null);
  const [nfBuscando, setNfBuscando] = useState(null);
  const [nfResultados, setNfResultados] = useState({});
  const [notificacaoModal, setNotificacaoModal] = useState(null);
  const [gerandoNotificacao, setGerandoNotificacao] = useState(false);
  const [statusClientes, setStatusClientes] = useState({});
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [anexosClientes, setAnexosClientes] = useState({});
  const [detalhesCliente, setDetalhesCliente] = useState(null);
  const [dadosPessoa, setDadosPessoa] = useState(null);
  const [estatisticas, setEstatisticas] = useState(null);
  const [dadosCNPJ, setDadosCNPJ] = useState(null);
  const [coordenadas, setCoordenadas] = useState(null);
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);
  const [uploadingAnexo, setUploadingAnexo] = useState(false);
  const [abaDetalhe, setAbaDetalhe] = useState('info');
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
  const [conversasDateStart, setConversasDateStart] = useState('');
  const [conversasDateEnd, setConversasDateEnd] = useState('');
  const [instanceCards, setInstanceCards] = useState([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [phoneModalMessages, setPhoneModalMessages] = useState([]);
  const [loadingPhoneModal, setLoadingPhoneModal] = useState(false);
  const [phoneModalTotal, setPhoneModalTotal] = useState(0);

  const hojeStr = new Date().toISOString().slice(0, 10);

  // Buscar filiais ao carregar
  useEffect(() => {
    const buscarFiliais = async () => {
      try {
        const response = await fetch(`${TotvsURL}branches`);
        if (response.ok) {
          const result = await response.json();
          let empresasArray = [];
          if (result.success && result.data) {
            if (result.data.data && Array.isArray(result.data.data)) {
              empresasArray = result.data.data;
            } else if (Array.isArray(result.data)) {
              empresasArray = result.data;
            }
          }
          const codigos = empresasArray
            .map((branch) => parseInt(branch.cd_empresa))
            .filter((code) => !isNaN(code) && code > 0);
          if (codigos.length > 0) setFiliaisCodigos(codigos);
        }
      } catch (err) {
        // silencioso
      }
    };
    buscarFiliais();
  }, []);

  const fetchDados = async () => {
    try {
      setLoading(true);

      // Datas: buscar vencidas desde 2024-01-01 até hoje
      const dataIni = '2024-01-01';
      const dataFim = hojeStr;

      // ==============================================
      // PASSO 1: Buscar clientes MTM e Franquias em paralelo
      // ==============================================
      const [respMTM, respFranquias] = await Promise.all([
        fetch(`${TotvsURL}multibrand-clients`),
        fetch(`${TotvsURL}franchise-clients`),
      ]);

      if (!respMTM.ok)
        throw new Error(`Erro ao buscar multimarcas: HTTP ${respMTM.status}`);
      if (!respFranquias.ok)
        throw new Error(
          `Erro ao buscar franquias: HTTP ${respFranquias.status}`,
        );

      const resultMTM = await respMTM.json();
      const resultFranquias = await respFranquias.json();

      const clientesMTM = resultMTM.data || [];
      const clientesFranquia = resultFranquias.data || [];

      // Mapas para enriquecer e identificar origem
      const origemMap = {};
      const clientesMap = {};

      clientesMTM.forEach((m) => {
        const code = String(m.code);
        origemMap[code] = 'MULTIMARCAS';
        clientesMap[code] = m;
      });
      clientesFranquia.forEach((f) => {
        const code = String(f.code);
        if (!origemMap[code]) origemMap[code] = 'FRANQUIA';
        else origemMap[code] = 'MULTIMARCAS / FRANQUIA';
        if (!clientesMap[code]) clientesMap[code] = f;
      });

      const todosCodigos = [
        ...new Set([
          ...clientesMTM.map((m) => m.code),
          ...clientesFranquia.map((f) => f.code),
        ]),
      ];

      if (todosCodigos.length === 0) {
        setClientes([]);
        return;
      }

      const codigosStr = todosCodigos.join(',');

      // ==============================================
      // PASSO 2: Buscar faturas vencidas
      // ==============================================
      const params = new URLSearchParams({
        dt_inicio: dataIni,
        dt_fim: dataFim,
        modo: 'vencimento',
        situacao: '1',
        status: 'Vencido',
        cd_cliente: codigosStr,
      });

      const respFaturas = await fetch(
        `${TotvsURL}accounts-receivable/filter?${params.toString()}`,
      );

      if (!respFaturas.ok)
        throw new Error(`Erro ao buscar faturas: HTTP ${respFaturas.status}`);

      const resultFaturas = await respFaturas.json();
      const faturas = (resultFaturas.data?.items || []).filter(
        (item) => item.tp_documento === 1 || item.tp_documento === '1',
      );

      // ==============================================
      // PASSO 3: Enriquecer com dados de pessoa (telefone, UF)
      // ==============================================
      const codigosUnicos = [
        ...new Set(faturas.map((f) => f.cd_cliente).filter(Boolean)),
      ];

      let pessoasMap = {};
      if (codigosUnicos.length > 0) {
        try {
          const respPessoas = await fetch(`${TotvsURL}persons/batch-lookup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personCodes: codigosUnicos }),
          });
          if (respPessoas.ok) {
            const dataPessoas = await respPessoas.json();
            pessoasMap = dataPessoas?.data || {};
          }
        } catch (err) {
          console.warn('Erro ao buscar dados de pessoas:', err.message);
        }
      }

      // ==============================================
      // PASSO 4: Agrupar por cliente e filtrar >60 dias
      // ==============================================
      const agrupado = {};
      faturas.forEach((item) => {
        const cd = String(item.cd_cliente);
        if (!agrupado[cd]) {
          const pessoa = pessoasMap[cd] || {};
          const cache = clientesMap[cd] || {};
          agrupado[cd] = {
            cd_cliente: cd,
            nm_cliente:
              pessoa.name || cache.name || item.nm_cliente || `Cliente ${cd}`,
            nm_fantasia:
              pessoa.fantasyName || cache.fantasyName || item.nm_fantasia || '',
            nr_telefone: pessoa.phone || '',
            nr_cpfcnpj: item.nr_cpfcnpj || '',
            ds_uf: pessoa.uf || item.ds_uf || '',
            origem: origemMap[cd] || '—',
            valor_total: 0,
            faturas: [],
          };
        }
        // Captura o CNPJ da primeira fatura que tiver
        if (!agrupado[cd].nr_cpfcnpj && item.nr_cpfcnpj) {
          agrupado[cd].nr_cpfcnpj = item.nr_cpfcnpj;
        }
        agrupado[cd].valor_total += parseFloat(item.vl_fatura) || 0;
        agrupado[cd].faturas.push(item);
      });

      // Calcular dias de atraso e filtrar apenas INADIMPLENTES (>60 dias)
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const inadimplentes = Object.values(agrupado)
        .map((cliente) => {
          const diasAtrasoMax = (cliente.faturas || []).reduce(
            (max, fatura) => {
              if (!fatura.dt_vencimento) return max;
              const [datePart] = String(fatura.dt_vencimento).split('T');
              const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10));
              const venc = new Date(y, m - 1, d);
              venc.setHours(0, 0, 0, 0);
              const diff = Math.floor((hoje - venc) / (1000 * 60 * 60 * 24));
              return Math.max(max, diff);
            },
            0,
          );

          return { ...cliente, diasAtrasoMax };
        })
        .filter((c) => c.diasAtrasoMax > 60);

      setClientes(inadimplentes);
    } catch (error) {
      console.error('Erro ao buscar dados:', error);
      setNotification({
        type: 'error',
        message: `Erro ao carregar dados: ${error.message}`,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDados();
    carregarStatusClientes();
    carregarAnexosClientes();
  }, []);

  // ══════════════════════════════════════════════
  // FUNÇÕES DE STATUS
  // ══════════════════════════════════════════════
  const carregarStatusClientes = async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from('recuperacao_credito_status')
        .select('*');
      if (error) throw error;
      const map = {};
      (data || []).forEach((item) => {
        map[item.cd_cliente] = item.status;
      });
      setStatusClientes(map);
    } catch (err) {
      console.warn('Erro ao carregar status:', err.message);
    }
  };

  const atualizarStatus = async (cd_cliente, novoStatus, nm_cliente) => {
    try {
      const { error } = await supabaseAdmin
        .from('recuperacao_credito_status')
        .upsert(
          {
            cd_cliente,
            nm_cliente: nm_cliente || '',
            status: novoStatus,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'cd_cliente' },
        );
      if (error) throw error;
      setStatusClientes((prev) => ({ ...prev, [cd_cliente]: novoStatus }));
    } catch (err) {
      setNotification({
        type: 'error',
        message: `Erro ao atualizar status: ${err.message}`,
      });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  // ══════════════════════════════════════════════
  // FUNÇÕES DE ANEXOS
  // ══════════════════════════════════════════════
  const carregarAnexosClientes = async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from('recuperacao_credito_anexos')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const map = {};
      (data || []).forEach((item) => {
        if (!map[item.cd_cliente]) map[item.cd_cliente] = [];
        map[item.cd_cliente].push(item);
      });
      setAnexosClientes(map);
    } catch (err) {
      console.warn('Erro ao carregar anexos:', err.message);
    }
  };

  const handleUploadAnexo = async (cd_cliente, file) => {
    if (!file) return;
    setUploadingAnexo(true);
    try {
      const uid = crypto.randomUUID().slice(0, 8);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `recuperacao-credito/${cd_cliente}/${uid}_${safeName}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .upload(storagePath, file, { upsert: false });
      if (uploadError) throw uploadError;

      const { error: dbError } = await supabaseAdmin
        .from('recuperacao_credito_anexos')
        .insert({
          cd_cliente,
          nome_arquivo: file.name,
          file_path: storagePath,
          tipo: file.type || 'application/octet-stream',
        });
      if (dbError) throw dbError;

      await carregarAnexosClientes();
      setNotification({
        type: 'success',
        message: 'Arquivo anexado com sucesso!',
      });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      setNotification({
        type: 'error',
        message: `Erro ao anexar arquivo: ${err.message}`,
      });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setUploadingAnexo(false);
    }
  };

  const downloadAnexo = async (anexo) => {
    try {
      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .download(anexo.file_path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = anexo.nome_arquivo;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotification({
        type: 'error',
        message: `Erro ao baixar arquivo: ${err.message}`,
      });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const removerAnexo = async (anexo) => {
    if (!window.confirm(`Remover o arquivo "${anexo.nome_arquivo}"?`)) return;
    try {
      const { error: storageError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .remove([anexo.file_path]);
      if (storageError) throw storageError;

      const { error: dbError } = await supabaseAdmin
        .from('recuperacao_credito_anexos')
        .delete()
        .eq('id', anexo.id);
      if (dbError) throw dbError;

      await carregarAnexosClientes();
      setNotification({
        type: 'success',
        message: 'Arquivo removido com sucesso!',
      });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      setNotification({
        type: 'error',
        message: `Erro ao remover arquivo: ${err.message}`,
      });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  // ══════════════════════════════════════════════
  // DETALHES DO CLIENTE (estilo ClientesConfianca)
  // ══════════════════════════════════════════════
  const buscarDetalhesCliente = async (cliente) => {
    setDetalhesCliente(cliente);
    setAbaDetalhe('info');
    setDadosPessoa(null);
    setEstatisticas(null);
    setDadosCNPJ(null);
    setCoordenadas(null);
    setConversas([]);
    setConversasTotal(0);
    setConversasPhone('');
    setMediaCache({});
    setInstanceCards([]);
    setSelectedInstance(null);
    setPhoneModalMessages([]);
    setConversasDateStart('');
    setConversasDateEnd('');
    setLoadingDetalhes(true);
    try {
      const personCode = parseInt(cliente.cd_cliente);

      // Buscar dados da pessoa (pes_pessoa)
      const { data: pessoaData } = await supabaseAdmin
        .from('pes_pessoa')
        .select(
          'code, nm_pessoa, fantasy_name, cpf, telefone, email, phones, emails, addresses, uf',
        )
        .eq('code', personCode)
        .single();
      if (pessoaData) setDadosPessoa(pessoaData);

      // Buscar estatísticas via API TOTVS
      try {
        const respStats = await fetch(`${TotvsURL}person-statistics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personCode }),
        });
        if (respStats.ok) {
          const statsResult = await respStats.json();
          if (statsResult.success) setEstatisticas(statsResult.data);
        }
      } catch (err) {
        console.warn('Erro ao buscar estatísticas:', err.message);
      }

      // Buscar dados do CNPJ via BrasilAPI
      const cnpjRaw = (cliente.nr_cpfcnpj || '').replace(/\D/g, '');
      if (cnpjRaw.length === 14) {
        try {
          const respCnpj = await fetch(`${TotvsURL}cnpj/${cnpjRaw}`);
          if (respCnpj.ok) {
            const cnpjResult = await respCnpj.json();
            if (cnpjResult.success) {
              setDadosCNPJ(cnpjResult.data);
              // Buscar coordenadas via BrasilAPI CEP v2 (direto, com CORS)
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
                  console.warn('Erro ao buscar coordenadas do CEP:', e.message);
                }
              }
            }
          }
        } catch (err) {
          console.warn('Erro ao buscar CNPJ na BrasilAPI:', err.message);
        }
      }
      // Conversas serão carregadas manualmente via aba Conversas
    } catch (err) {
      console.warn('Erro ao buscar dados do cliente:', err.message);
    } finally {
      setLoadingDetalhes(false);
    }
  };

  // ══════════════════════════════════════════════
  // CONVERSAS WHATSAPP (Evolution API)
  // ══════════════════════════════════════════════
  const getConversasPhones = () => {
    const phones = [];
    const phoneTotvs = detalhesCliente?.nr_telefone || dadosPessoa?.telefone;
    const phoneCnpj = dadosCNPJ?.ddd_telefone_1;
    if (phoneTotvs) {
      const clean = String(phoneTotvs).replace(/\D/g, '');
      if (clean.length >= 10) phones.push(clean);
    }
    if (phoneCnpj) {
      const clean = String(phoneCnpj).replace(/\D/g, '');
      if (clean.length >= 10 && !phones.includes(clean)) phones.push(clean);
    }
    return phones;
  };

  const buscarInstancias = async () => {
    const phones = getConversasPhones();
    if (phones.length === 0) return;
    setLoadingInstances(true);
    setInstanceCards([]);
    setConversasPhone('');
    try {
      for (const phone of phones) {
        const qs = new URLSearchParams();
        if (conversasDateStart) qs.set('startDate', conversasDateStart);
        if (conversasDateEnd) qs.set('endDate', conversasDateEnd);
        const resp = await fetch(`${EvolutionURL}instances/${phone}?${qs}`);
        if (resp.ok) {
          const json = await resp.json();
          if (json.success && json.data.instances.length > 0) {
            setInstanceCards(json.data.instances);
            setConversasPhone(json.data.phone);
            return;
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao buscar instâncias:', e.message);
    } finally {
      setLoadingInstances(false);
    }
  };

  const abrirConversaInstancia = async (instance) => {
    setSelectedInstance(instance);
    setLoadingPhoneModal(true);
    setPhoneModalMessages([]);
    setPhoneModalTotal(0);
    setMediaCache({});
    try {
      const qs = new URLSearchParams({
        limit: '500',
        instanceId: instance.instanceId,
      });
      if (conversasDateStart) qs.set('startDate', conversasDateStart);
      if (conversasDateEnd) qs.set('endDate', conversasDateEnd);
      const resp = await fetch(
        `${EvolutionURL}conversations/${conversasPhone}?${qs}`,
      );
      if (resp.ok) {
        const json = await resp.json();
        if (json.success) {
          setPhoneModalMessages(json.data.messages);
          setPhoneModalTotal(json.data.total);
        }
      }
    } catch (e) {
      console.warn('Erro ao buscar conversas da instância:', e.message);
    } finally {
      setLoadingPhoneModal(false);
    }
  };

  const fetchMediaRC = async (msg) => {
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

  const handlePlayAudioRC = async (msg) => {
    if (playingAudioId === msg.id && audioRef.current) {
      audioRef.current.pause();
      setPlayingAudioId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const media = await fetchMediaRC(msg);
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

  const handleImageClickRC = async (msg) => {
    const imgData = msg.message?.imageMessage || msg.message?.albumMessage;
    const thumb = imgData?.jpegThumbnail;
    if (thumb) setLightboxImg(`data:image/jpeg;base64,${thumb}`);
    const media = await fetchMediaRC(msg);
    if (media && !media.expired) {
      setLightboxImg(
        `data:${media.mimetype || 'image/jpeg'};base64,${media.base64}`,
      );
    } else if (media?.expired && !thumb) {
      setLightboxImg(null);
    }
  };

  const getEndereco = (pessoa) => {
    if (!pessoa?.addresses) return '';
    try {
      const addrs =
        typeof pessoa.addresses === 'string'
          ? JSON.parse(pessoa.addresses)
          : pessoa.addresses;
      if (!Array.isArray(addrs) || addrs.length === 0) return '';
      const addr = addrs.find((a) => a.isDefault) || addrs[0];
      const parts = [
        addr.street,
        addr.number ? `nº ${addr.number}` : '',
        addr.complement,
        addr.neighborhood,
        addr.city,
        addr.state,
        addr.zipCode ? `CEP: ${addr.zipCode}` : '',
      ].filter(Boolean);
      return parts.join(', ');
    } catch {
      return '';
    }
  };

  // Filtrar por busca textual
  const clientesFiltrados = useMemo(() => {
    let resultado = [...clientes];

    if (busca.trim()) {
      const termo = busca.toLowerCase();
      resultado = resultado.filter(
        (c) =>
          (c.nm_cliente || '').toLowerCase().includes(termo) ||
          (c.nm_fantasia || '').toLowerCase().includes(termo) ||
          (c.nr_cpfcnpj || '').includes(termo) ||
          (c.cd_cliente || '').includes(termo),
      );
    }

    // Filtro por origem
    if (filtroOrigem !== 'TODOS') {
      resultado = resultado.filter((c) => c.origem === filtroOrigem);
    }

    // Filtro por Sicredi (portador 748)
    if (filtroSicredi) {
      resultado = resultado.filter((c) =>
        (c.faturas || []).some(
          (f) =>
            String(f.cd_portador) === '748' ||
            (f.nm_portador || '').toUpperCase().includes('SICREDI'),
        ),
      );
    }

    // Filtro por status
    if (filtroStatus !== 'TODOS') {
      resultado = resultado.filter((c) => {
        const statusEfetivo = isClienteBloqueado(c.nm_cliente)
          ? 'BLOQUEADO'
          : statusClientes[c.cd_cliente] || '';
        return statusEfetivo === filtroStatus;
      });
    }

    // Ordenação
    resultado.sort((a, b) => {
      let valorA, valorB;
      switch (ordenarPor) {
        case 'nm_cliente':
          valorA = (a.nm_cliente || '').toLowerCase();
          valorB = (b.nm_cliente || '').toLowerCase();
          break;
        case 'valor_total':
          valorA = a.valor_total || 0;
          valorB = b.valor_total || 0;
          break;
        case 'diasAtrasoMax':
          valorA = a.diasAtrasoMax || 0;
          valorB = b.diasAtrasoMax || 0;
          break;
        case 'origem':
          valorA = (a.origem || '').toLowerCase();
          valorB = (b.origem || '').toLowerCase();
          break;
        default:
          return 0;
      }
      if (valorA < valorB) return direcaoOrdenacao === 'asc' ? -1 : 1;
      if (valorA > valorB) return direcaoOrdenacao === 'asc' ? 1 : -1;
      return 0;
    });

    return resultado;
  }, [
    clientes,
    busca,
    ordenarPor,
    direcaoOrdenacao,
    filtroOrigem,
    filtroSicredi,
    filtroStatus,
    statusClientes,
  ]);

  // Métricas
  const metricas = useMemo(() => {
    const total = clientesFiltrados.length;
    const valorTotal = clientesFiltrados.reduce(
      (sum, c) => sum + (c.valor_total || 0),
      0,
    );
    const mtm = clientesFiltrados.filter(
      (c) => c.origem === 'MULTIMARCAS',
    ).length;
    const franquia = clientesFiltrados.filter(
      (c) => c.origem === 'FRANQUIA',
    ).length;
    return { total, valorTotal, mtm, franquia };
  }, [clientesFiltrados]);

  const handleOrdenar = (coluna) => {
    if (ordenarPor === coluna) {
      setDirecaoOrdenacao((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrdenarPor(coluna);
      setDirecaoOrdenacao('desc');
    }
  };

  const SortIcon = ({ coluna }) => {
    if (ordenarPor !== coluna) return null;
    return direcaoOrdenacao === 'asc' ? (
      <SortAscending size={14} className="inline ml-1" />
    ) : (
      <SortDescending size={14} className="inline ml-1" />
    );
  };

  // Buscar notas fiscais relacionadas a uma fatura
  const buscarNFsFatura = async (fatura) => {
    const faturaKey = `${fatura.cd_cliente}_${fatura.nr_fat || fatura.nr_fatura}_${fatura.nr_parcela || ''}`;
    setNfBuscando(faturaKey);
    try {
      const cd_cliente = parseInt(fatura.cd_cliente) || 0;
      const dtEmissao = fatura.dt_emissao
        ? fatura.dt_emissao.split('T')[0]
        : '';
      if (!dtEmissao || !cd_cliente) {
        setNotification({
          type: 'error',
          message: 'Dados da fatura incompletos para buscar NFs',
        });
        setTimeout(() => setNotification(null), 3000);
        return;
      }

      const branchCodes = filiaisCodigos.filter((c) => c >= 1 && c <= 99);

      const buscarComMargem = async (margem) => {
        const startDate = new Date(dtEmissao);
        startDate.setDate(startDate.getDate() - margem);
        const endDate = new Date(dtEmissao);
        endDate.setDate(endDate.getDate() + margem);

        const payload = {
          filter: {
            branchCodeList: branchCodes,
            personCodeList: [cd_cliente],
            eletronicInvoiceStatusList: ['Authorized'],
            startIssueDate: `${startDate.toISOString().slice(0, 10)}T00:00:00`,
            endIssueDate: `${endDate.toISOString().slice(0, 10)}T23:59:59`,
          },
          page: 1,
          pageSize: 100,
          expand: 'person',
        };

        const response = await fetch(`${TotvsURL}invoices-search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) throw new Error('Erro ao buscar notas fiscais');
        const data = await response.json();
        return data.data?.items || data.items || [];
      };

      // Busca progressiva: mesmo dia → ±1 → ±2 → ±3
      for (const margem of [0, 1, 2, 3]) {
        const items = await buscarComMargem(margem);
        if (items.length > 0) {
          // Pegar a primeira NF encontrada e gerar DANFE
          await gerarDanfeNF(items[0]);
          return;
        }
      }

      setNotification({
        type: 'error',
        message: 'Nenhuma nota fiscal encontrada para esta fatura',
      });
      setTimeout(() => setNotification(null), 4000);
    } catch (error) {
      setNotification({
        type: 'error',
        message: `Erro ao buscar NF: ${error.message}`,
      });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setNfBuscando(null);
    }
  };

  // Gerar DANFE a partir de NF
  const gerarDanfeNF = async (nf) => {
    try {
      setDanfeLoading(nf.invoiceCode || nf.transactionCode);

      const dataTransacao = nf.transactionDate
        ? nf.transactionDate.split('T')[0]
        : nf.invoiceDate
          ? nf.invoiceDate.split('T')[0]
          : '';
      if (!dataTransacao) throw new Error('Data da NF não disponível');

      const payload = {
        filter: {
          branchCodeList: [nf.branchCode],
          personCodeList: [nf.personCode],
          transactionBranchCode: nf.transactionBranchCode || nf.branchCode,
          transactionCode: nf.transactionCode,
          transactionDate: dataTransacao,
        },
      };

      const response = await fetch(`${TotvsURL}danfe-from-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Erro ao gerar DANFE');
      }

      const data = await response.json();
      let base64 = '';
      if (data.success && data.data)
        base64 = data.data.danfePdfBase64 || data.data.base64 || '';
      else if (data.danfePdfBase64) base64 = data.danfePdfBase64;

      if (base64) {
        abrirPDFDanfe(base64, nf.invoiceCode || nf.transactionCode);
      } else {
        throw new Error('DANFE não retornada pela API');
      }
    } catch (error) {
      setNotification({
        type: 'error',
        message: `Erro ao gerar DANFE: ${error.message}`,
      });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setDanfeLoading(null);
    }
  };

  const abrirPDFDanfe = (base64String, nrTransacao) => {
    try {
      const base64 = base64String.replace(/^data:application\/pdf;base64,/, '');
      const binaryString = window.atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++)
        bytes[i] = binaryString.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const newWindow = window.open(url, '_blank');
      if (newWindow) {
        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = `danfe-transacao-${nrTransacao}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      setNotification({ type: 'error', message: 'Erro ao abrir a DANFE.' });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const meses = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];

  const abrirNotificacaoModal = (cliente) => {
    const hoje = new Date();
    const faturasList = (cliente.faturas || [])
      .map((f) => {
        const nrFat = f.nr_fat || f.nr_fatura || '';
        return nrFat;
      })
      .filter(Boolean);
    const descricao =
      faturasList.length > 0
        ? `notas fiscais nº ${faturasList.join(', ')}`
        : 'mercadorias fornecidas';

    setNotificacaoModal({
      cliente,
      razao_social: cliente.nm_cliente || '',
      cnpj: formatarCNPJ(cliente.nr_cpfcnpj),
      endereco: cliente.ds_endereco || '',
      valor: formatarMoeda(cliente.valor_total),
      descricao_origem: descricao,
      dia: String(hoje.getDate()),
      mes: meses[hoje.getMonth()],
      whatsapp: '84 99135-2193',
    });
  };

  const gerarNotificacaoDocx = async () => {
    if (!notificacaoModal) return;
    setGerandoNotificacao(true);
    try {
      // ─── Carregar imagens do cabeçalho, rodapé e assinatura ───
      const loadImageAsDataURL = async (url) => {
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      };

      const [fundoPaginaImg, assinaturaImg] = await Promise.all([
        loadImageAsDataURL('/tanaka-cabecalho.png.png'),
        loadImageAsDataURL('/tanaka-assinatura.png.jpg'),
      ]);

      // ─── Gerar PDF com jsPDF (auto-ajuste de fonte para caber em 1 página) ───
      let fontSize = 11;
      let pdf;
      let out;

      const gerarConteudoPDF = (fs) => {
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const mL = 25;
        const cW = pageW - mL - 25;
        const lh = fs * 0.5; // line height proporcional
        const bottomLimit = pageH - 35; // espaço do rodapé
        let y = 0;

        // Helper: renderizar parágrafo com **negrito** e justificado
        const renderParagraph = (text, indentFirst = true) => {
          doc.setFontSize(fs);
          const firstIndent = indentFirst ? 15 : 0;
          const parts = text.split(/(\*\*.*?\*\*)/);
          const segments = parts
            .filter((p) => p)
            .map((p) => {
              if (p.startsWith('**') && p.endsWith('**'))
                return { text: p.slice(2, -2), bold: true };
              return { text: p, bold: false };
            });
          const words = [];
          for (const seg of segments) {
            for (const w of seg.text.split(/\s+/).filter(Boolean)) {
              words.push({ text: w, bold: seg.bold });
            }
          }
          const lines = [];
          let curLine = [],
            curW = 0,
            isFirst = true;
          for (const word of words) {
            doc.setFont('times', word.bold ? 'bold' : 'normal');
            const ww = doc.getTextWidth(word.text);
            const sp = curLine.length > 0 ? doc.getTextWidth(' ') : 0;
            const maxW = isFirst ? cW - firstIndent : cW;
            if (curW + sp + ww > maxW && curLine.length > 0) {
              lines.push({ words: curLine, width: curW, indented: isFirst });
              curLine = [word];
              curW = ww;
              isFirst = false;
            } else {
              curW += sp + ww;
              curLine.push(word);
            }
          }
          if (curLine.length > 0)
            lines.push({
              words: curLine,
              width: curW,
              indented: isFirst,
              isLast: true,
            });
          for (const line of lines) {
            if (y > bottomLimit) {
              doc.addPage();
              y = 30;
            }
            const lx = mL + (line.indented ? firstIndent : 0);
            const lmw = line.indented ? cW - firstIndent : cW;
            const extra =
              !line.isLast && line.words.length > 1
                ? (lmw - line.width) / (line.words.length - 1)
                : 0;
            let cx = lx;
            for (let i = 0; i < line.words.length; i++) {
              doc.setFont('times', line.words[i].bold ? 'bold' : 'normal');
              doc.text(line.words[i].text, cx, y);
              cx += doc.getTextWidth(line.words[i].text);
              if (i < line.words.length - 1)
                cx += doc.getTextWidth(' ') + extra;
            }
            y += lh;
          }
          y += lh * 0.4;
        };

        // ─── Fundo da página ───
        if (fundoPaginaImg)
          doc.addImage(fundoPaginaImg, 'PNG', 0, 0, pageW, pageH);
        y = 30;

        // ─── Título ───
        doc.setTextColor(0, 0, 0);
        doc.setFont('times', 'bold');
        doc.setFontSize(fs + 3);
        doc.text('NOTIFICAÇÃO EXTRAJUDICIAL', pageW / 2, y, {
          align: 'center',
        });
        const tw = doc.getTextWidth('NOTIFICAÇÃO EXTRAJUDICIAL');
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.5);
        doc.line(pageW / 2 - tw / 2, y + 1.5, pageW / 2 + tw / 2, y + 1.5);

        // ─── Data e destinatário ───
        y += lh * 2;
        doc.setFont('times', 'normal');
        doc.setFontSize(fs);
        doc.text(
          `Natal/RN, ${notificacaoModal.dia} de ${notificacaoModal.mes} de ${new Date().getFullYear()}.`,
          mL,
          y,
        );
        y += lh;
        const destLines = doc.splitTextToSize(
          `À ${notificacaoModal.razao_social}`,
          cW,
        );
        doc.text(destLines, mL, y);
        y += destLines.length * lh;
        doc.text(`CNPJ: ${notificacaoModal.cnpj}`, mL, y);
        y += lh;
        if (notificacaoModal.endereco) {
          const endLines = doc.splitTextToSize(
            `Endereço: ${notificacaoModal.endereco}`,
            cW,
          );
          doc.text(endLines, mL, y);
          y += endLines.length * lh;
        }
        doc.setFont('times', 'bold');
        doc.text('Ref.: Inadimplemento de obrigação comercial', mL, y);
        y += lh * 1.5;
        doc.setFont('times', 'normal');
        doc.text('Prezado(a) Senhor(a),', mL, y);
        y += lh * 1.8;

        // ─── Corpo ───
        renderParagraph(
          `A empresa **CROSBY CR VESTUÁRIO LTDA**, pessoa jurídica de direito privado, inscrita no CNPJ sob nº **17.177.680/0001-16**, com sede na Rua São José, nº 2189, Lote 61, Lagoa Nova, Natal/RN, CEP: 59.063-150, vem, por meio da presente, **NOTIFICAR** Vossa Senhoria acerca da existência de débito decorrente de operações comerciais realizadas entre as partes.`,
        );
        renderParagraph(
          `Conforme apurado em nossos registros, permanece em aberto o valor de **R$ ${notificacaoModal.valor}**, referente a ${notificacaoModal.descricao_origem}, conforme demonstrativo detalhado que segue em anexo.`,
        );
        renderParagraph(
          `O inadimplemento da obrigação caracteriza violação contratual e enseja a incidência das penalidades legais cabíveis, nos termos dos artigos 389 e 395 do Código Civil, incluindo perdas e danos, juros, correção monetária e honorários advocatícios.`,
        );
        renderParagraph(
          `Diante disso, fica Vossa Senhoria **NOTIFICADO(A)** a promover a quitação integral do débito no prazo improrrogável de **72 (setenta e duas) horas**, contadas do recebimento desta notificação.`,
        );
        renderParagraph(
          `Fica desde já consignado que o não adimplemento no prazo acima estipulado ensejará a adoção imediata das medidas judiciais cabíveis, incluindo o ajuizamento de **ação de execução ou cobrança**, conforme o caso, com a incidência de atualização monetária do débito; juros de mora; **honorários advocatícios**; custas processuais e demais implicações legais, sem prejuízo de eventual **protesto do título e/ou inscrição nos órgãos de proteção ao crédito (SPC/Serasa)**.`,
        );
        renderParagraph(
          `Caso o pagamento já tenha sido realizado, solicitamos o envio do respectivo comprovante para imediata regularização.`,
        );
        renderParagraph(
          `Ressaltamos que permanecemos à disposição para eventual composição amigável, a fim de evitar a adoção das **medidas judiciais acima descritas**, através do contato de whatsapp **${notificacaoModal.whatsapp}** e e-mail "felipetanakaadvocacia@gmail".`,
        );

        // ─── Fecho e assinatura ───
        y += lh;
        doc.setFont('times', 'normal');
        doc.setFontSize(fs);
        doc.text('Atenciosamente,', pageW / 2, y, { align: 'center' });
        y += lh * 1.5;

        if (assinaturaImg) {
          const assW = 45;
          const assH = 22;
          const assX = (pageW - assW) / 2;
          if (y + assH + 15 > bottomLimit) {
            doc.addPage();
            y = 30;
          }
          doc.addImage(assinaturaImg, 'JPEG', assX, y, assW, assH);
          y += assH + 3;
        }

        doc.setFont('times', 'bold');
        doc.setFontSize(fs);
        doc.text('CROSBY CR VESTUÁRIO LTDA', pageW / 2, y, { align: 'center' });
        y += lh;
        doc.setFont('times', 'normal');
        doc.text('P/P', pageW / 2, y, { align: 'center' });

        // Aplicar fundo nas páginas extras
        const totalPages = doc.internal.getNumberOfPages();
        if (fundoPaginaImg && totalPages > 1) {
          for (let p = 2; p <= totalPages; p++) {
            doc.setPage(p);
            doc.addImage(fundoPaginaImg, 'PNG', 0, 0, pageW, pageH);
          }
        }

        return { doc, pages: totalPages };
      };

      // Tentar gerar — se não couber em 1 página, reduz a fonte
      let result = gerarConteudoPDF(fontSize);
      while (result.pages > 1 && fontSize > 8) {
        fontSize -= 0.5;
        result = gerarConteudoPDF(fontSize);
      }
      pdf = result.doc;
      out = pdf.output('blob');

      const nomeCliente = notificacaoModal.razao_social
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z\s]/g, '')
        .replace(/\s+/g, '_')
        .toLowerCase()
        .replace(/_+$/, '');
      const nomeAmigavel = `notificacaoextrajudicial_${nomeCliente}`;
      const nomeArquivo = `${nomeAmigavel}.pdf`;
      const storagePath = `notificacoes/${nomeArquivo}`;

      // Upload para Supabase Storage
      const { error: uploadError } = await supabaseAdmin.storage
        .from('clientes-confianca')
        .upload(storagePath, out, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadError)
        throw new Error(`Erro no upload: ${uploadError.message}`);

      const mensagemCaption =
        `⚖️ *NOTIFICAÇÃO EXTRAJUDICIAL*\n\n` +
        `Prezado(a) representante legal de *${notificacaoModal.razao_social}*,\n\n` +
        `Pelo presente, fica V.Sa. formalmente NOTIFICADO(A) acerca da existência de débito vencido e não quitado no valor de *${notificacaoModal.valor}*, decorrente de operações comerciais realizadas com a empresa CROSBY CR VESTUÁRIO LTDA.\n\n` +
        `Concedemos o prazo improrrogável de *72 (setenta e duas) horas* para a quitação integral, sob pena de adoção das medidas judiciais cabíveis, incluindo *ação de execução*, *protesto do título* e *inscrição nos órgãos de proteção ao crédito (SPC/Serasa)*.\n\n` +
        `📎 Segue em anexo a Notificação Extrajudicial completa para ciência e providências.\n\n`;

      const cliente = notificacaoModal.cliente;
      const telefone = (cliente.nr_telefone || '').replace(/\D/g, '');

      if (!telefone) {
        throw new Error('Telefone não encontrado para este cliente');
      }

      // Enviar documento direto via WhatsApp (backend wwebjs)
      const envioRes = await fetch(
        'https://apigestaocrosby-bw2v.onrender.com/api/whatsapp/send-document',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telefone,
            nomeArquivo,
            mensagem: mensagemCaption,
          }),
        },
      );

      const envioData = await envioRes.json();
      let whatsappOnline = true;

      if (!envioRes.ok) {
        // Fallback: se WhatsApp offline, abre wa.me com link de download
        if (envioData.fallback) {
          whatsappOnline = false;
          const linkPublico = `${window.location.origin}/notificacao?doc=${nomeAmigavel}`;
          const mensagemFallback =
            mensagemCaption + `\n\nBaixe o documento:\n${linkPublico}`;
          const msg = encodeURIComponent(mensagemFallback);
          window.open(`https://wa.me/55${telefone}?text=${msg}`, '_blank');
          setNotification({
            type: 'success',
            message:
              'WhatsApp offline — link enviado via wa.me como alternativa.',
          });
        } else {
          throw new Error(envioData.error || 'Erro ao enviar via WhatsApp');
        }
      } else {
        setNotification({
          type: 'success',
          message: 'Notificação enviada com sucesso!',
        });
      }

      // ═════════════════════════════════════════════════════════════
      // REGISTRAR SOLICITAÇÃO DE NFs (sob demanda do cliente)
      // ═════════════════════════════════════════════════════════════
      try {
        const faturas = cliente.faturas || [];
        // Deduplicar por nr_fat/nr_fatura (mesma NF com parcelas diferentes)
        const nfMap = new Map();
        for (const f of faturas) {
          const nrFat = String(f.nr_fat || f.nr_fatura || '').trim();
          if (nrFat && !nfMap.has(nrFat)) {
            nfMap.set(nrFat, f);
          }
        }

        const uniqueDates = [
          ...new Set(
            [...nfMap.values()]
              .map((f) => (f.dt_emissao || '').split('T')[0])
              .filter(Boolean),
          ),
        ];

        if (uniqueDates.length > 0 && whatsappOnline) {
          const cd_cliente = parseInt(cliente.cd_cliente);
          if (cd_cliente) {
            await fetch(
              'https://apigestaocrosby-bw2v.onrender.com/api/whatsapp/register-nf-request',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  telefone,
                  personCode: cd_cliente,
                  branchCodeList: filiaisCodigos.filter(
                    (c) => c >= 1 && c <= 99,
                  ),
                  issueDates: uniqueDates,
                  razaoSocial: notificacaoModal.razao_social,
                  valor: notificacaoModal.valor,
                  nomeCliente,
                }),
              },
            );
          }
        }
      } catch (nfError) {
        console.warn('Erro ao registrar solicitação de NFs:', nfError);
        // Não impede o sucesso da notificação
      }

      setTimeout(() => setNotification(null), 5000);
      setNotificacaoModal(null);
    } catch (error) {
      setNotification({
        type: 'error',
        message: `Erro ao gerar notificação: ${error.message}`,
      });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setGerandoNotificacao(false);
    }
  };

  const exportarPDF = () => {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });
    const pageW = doc.internal.pageSize.getWidth();
    const mL = 10;
    let y = 15;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Recuperação de Crédito', pageW / 2, y, { align: 'center' });
    y += 5;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Gerado em ${new Date().toLocaleDateString('pt-BR')} — ${clientesFiltrados.length} clientes — Total: ${formatarMoeda(metricas.valorTotal)}`,
      pageW / 2,
      y,
      { align: 'center' },
    );
    y += 8;

    const cols = [
      { header: 'Cliente', width: 65 },
      { header: 'Nome Fantasia', width: 50 },
      { header: 'CNPJ/CPF', width: 38 },
      { header: 'Origem', width: 25 },
      { header: 'Valor Inadimplente', width: 35 },
      { header: 'Dias Atraso', width: 22 },
      { header: 'Status', width: 28 },
    ];

    // Header
    doc.setFillColor(0, 6, 56);
    doc.rect(
      mL,
      y,
      cols.reduce((s, c) => s + c.width, 0),
      7,
      'F',
    );
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    let xH = mL;
    cols.forEach((col) => {
      doc.text(col.header, xH + 2, y + 5);
      xH += col.width;
    });
    y += 7;

    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);

    clientesFiltrados.forEach((c, i) => {
      if (y > doc.internal.pageSize.getHeight() - 15) {
        doc.addPage();
        y = 15;
      }
      if (i % 2 === 0) {
        doc.setFillColor(245, 245, 245);
        doc.rect(
          mL,
          y,
          cols.reduce((s, col) => s + col.width, 0),
          6,
          'F',
        );
      }
      const statusEfetivo = isClienteBloqueado(c.nm_cliente)
        ? 'BLOQUEADO'
        : statusClientes[c.cd_cliente] || '';
      const statusLabel =
        getStatusLabel(statusEfetivo) ||
        (statusEfetivo === 'BLOQUEADO' ? 'Bloqueado' : '—');
      const row = [
        c.nm_cliente || '',
        c.nm_fantasia || '—',
        formatarCNPJ(c.nr_cpfcnpj),
        c.origem || '—',
        formatarMoeda(c.valor_total),
        `${c.diasAtrasoMax} dias`,
        statusLabel,
      ];
      let x = mL;
      row.forEach((val, idx) => {
        const txt = doc.splitTextToSize(String(val), cols[idx].width - 3);
        doc.text(txt[0] || '', x + 2, y + 4);
        x += cols[idx].width;
      });
      y += 6;
    });

    doc.save(
      `recuperacao-credito-${new Date().toISOString().slice(0, 10)}.pdf`,
    );
  };

  const exportarExcel = () => {
    const dados = clientesFiltrados.map((c) => {
      const statusEfetivo = isClienteBloqueado(c.nm_cliente)
        ? 'BLOQUEADO'
        : statusClientes[c.cd_cliente] || '';
      const statusLabel =
        getStatusLabel(statusEfetivo) ||
        (statusEfetivo === 'BLOQUEADO' ? 'Bloqueado' : '—');
      return {
        Código: c.cd_cliente,
        Cliente: c.nm_cliente || '',
        'Nome Fantasia': c.nm_fantasia || '—',
        'CNPJ/CPF': formatarCNPJ(c.nr_cpfcnpj),
        UF: c.ds_uf || '—',
        Origem: c.origem || '—',
        'Valor Inadimplente': c.valor_total || 0,
        'Dias Atraso': c.diasAtrasoMax || 0,
        Status: statusLabel,
        Telefone: c.nr_telefone || '—',
      };
    });
    const ws = XLSX.utils.json_to_sheet(dados);
    // Ajustar larguras das colunas
    ws['!cols'] = [
      { wch: 10 },
      { wch: 40 },
      { wch: 30 },
      { wch: 20 },
      { wch: 5 },
      { wch: 15 },
      { wch: 18 },
      { wch: 12 },
      { wch: 15 },
      { wch: 18 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Recuperação de Crédito');
    XLSX.writeFile(
      wb,
      `recuperacao-credito-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  const abrirWhatsApp = (cliente) => {
    const telefone = cliente.nr_telefone || '';
    if (!telefone) {
      setNotification({
        type: 'error',
        message: 'Telefone não encontrado para este cliente',
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const telefoneClean = telefone.replace(/\D/g, '');

    const listaFaturas = (cliente.faturas || [])
      .map((fatura) => {
        const numeroFatura = fatura.nr_fat || fatura.nr_fatura || 'N/A';
        const vencimento = fatura.dt_vencimento
          ? new Date(fatura.dt_vencimento).toLocaleDateString('pt-BR')
          : 'N/A';
        const valor = formatarMoeda(fatura.vl_fatura || 0);
        return `*Fatura:* ${numeroFatura}\n*Vencimento:* ${vencimento}\n*Valor:* ${valor}`;
      })
      .join('\n\n');

    const mensagemPadrao = `Olá, tudo bem? *${cliente.nm_cliente}*
Somos da área de Recuperação de Créditos da Crosby.
Consta em nosso sistema a existência de pendências financeiras em aberto em seu cadastro.
Entramos em contato para alinhar e verificar a melhor forma de regularização.

Segue a lista dos títulos em aberto:

${listaFaturas}

*Observação:* Caso os pagamentos já tenham sido realizados, pedimos gentilmente que desconsidere esta mensagem e nos envie o comprovante para atualização em nosso sistema.

Atenciosamente,
Crosby`;

    const mensagemCodificada = encodeURIComponent(mensagemPadrao);
    const whatsappUrl = `https://wa.me/55${telefoneClean}?text=${mensagemCodificada}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <PageTitle
        title="Recuperação de Crédito"
        subtitle="Clientes inadimplentes (> 60 dias) — Multimarcas e Franquias"
      />

      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      {loading ? (
        <LoadingSpinner size="lg" text="Carregando clientes inadimplentes..." />
      ) : (
        <>
          {/* Cards de resumo */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-blue-600" />
                  <CardTitle className="text-sm font-bold text-blue-700">
                    Total de Clientes
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-2xl font-extrabold text-blue-600">
                  {metricas.total}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CurrencyDollar size={18} className="text-red-600" />
                  <CardTitle className="text-sm font-bold text-red-700">
                    Valor Total Inadimplente
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-2xl font-extrabold text-red-600">
                  {formatarMoeda(metricas.valorTotal)}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Buildings size={18} className="text-purple-600" />
                  <CardTitle className="text-sm font-bold text-purple-700">
                    Multimarcas
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-2xl font-extrabold text-purple-600">
                  {metricas.mtm}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Storefront size={18} className="text-amber-600" />
                  <CardTitle className="text-sm font-bold text-amber-700">
                    Franquias
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-2xl font-extrabold text-amber-600">
                  {metricas.franquia}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filtros e busca */}
          <div className="flex flex-wrap justify-center items-center gap-3 pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <div className="relative flex-1 max-w-md">
              <MagnifyingGlass
                size={18}
                className="absolute left-3 top-1/3 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Buscar por nome, fantasia, CNPJ ou código..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
              />
            </div>

            {/* Filtro Origem */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              {['TODOS', 'MULTIMARCAS', 'FRANQUIA'].map((op) => (
                <button
                  key={op}
                  onClick={() => setFiltroOrigem(op)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                    filtroOrigem === op
                      ? 'bg-[#000638] text-white shadow'
                      : 'text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {op === 'TODOS'
                    ? 'Todos'
                    : op === 'MULTIMARCAS'
                      ? 'Multimarcas'
                      : 'Franquias'}
                </button>
              ))}
            </div>

            {/* Filtro Sicredi */}
            <button
              onClick={() => setFiltroSicredi((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                filtroSicredi
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              SICREDI
            </button>

            {/* Filtro Status */}
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-300 bg-white text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="TODOS">Todos os Status</option>
              <option value="">Sem Status</option>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <span className="text-sm text-gray-500">
              {clientesFiltrados.length} cliente
              {clientesFiltrados.length !== 1 ? 's' : ''}
            </span>

            <div className="flex items-center gap-1.5 ml-auto">
              <button
                onClick={exportarPDF}
                disabled={clientesFiltrados.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-red-300 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Baixar PDF"
              >
                <DownloadSimple size={14} />
                PDF
              </button>
              <button
                onClick={exportarExcel}
                disabled={clientesFiltrados.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-green-300 bg-white text-green-600 hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Baixar Excel"
              >
                <DownloadSimple size={14} />
                Excel
              </button>
            </div>
          </div>

          {/* Tabela */}
          <Card className="shadow-lg rounded-xl bg-white overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#000638] text-white">
                    <tr>
                      <th
                        className="px-4 py-0.5 text-left cursor-pointer hover:bg-[#000d5c] select-none"
                        onClick={() => handleOrdenar('nm_cliente')}
                      >
                        Cliente <SortIcon coluna="nm_cliente" />
                      </th>
                      <th className="px-4 py-0.5 text-left">Nome Fantasia</th>
                      <th className="px-4 py-0.5 text-left">CNPJ/CPF</th>
                      <th
                        className="px-4 py-0.5 text-left cursor-pointer hover:bg-[#000d5c] select-none"
                        onClick={() => handleOrdenar('origem')}
                      >
                        Origem <SortIcon coluna="origem" />
                      </th>
                      <th
                        className="px-4 py-0.5 text-right cursor-pointer hover:bg-[#000d5c] select-none"
                        onClick={() => handleOrdenar('valor_total')}
                      >
                        Valor <SortIcon coluna="valor_total" />
                      </th>
                      <th
                        className="px-4 py-0.5 text-center cursor-pointer hover:bg-[#000d5c] select-none"
                        onClick={() => handleOrdenar('diasAtrasoMax')}
                      >
                        Atraso <SortIcon coluna="diasAtrasoMax" />
                      </th>
                      <th className="px-4 py-0.5 text-center">Status</th>
                      <th className="px-4 py-0.5 text-center">Anexos</th>
                      <th className="px-4 py-0.5 text-center">WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {clientesFiltrados.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="px-4 py-12 text-center text-gray-400"
                        >
                          {clientes.length === 0
                            ? 'Nenhum cliente inadimplente encontrado.'
                            : 'Nenhum resultado para a busca.'}
                        </td>
                      </tr>
                    ) : (
                      clientesFiltrados.map((cliente, index) => {
                        const isChumbado = isClienteBloqueado(
                          cliente.nm_cliente,
                        );
                        return (
                          <tr
                            key={cliente.cd_cliente}
                            className={`transition-colors ${
                              isChumbado
                                ? 'bg-yellow-100 border-l-4 border-l-yellow-400'
                                : index % 2 === 0
                                  ? 'bg-white hover:bg-blue-50'
                                  : 'bg-gray-50/50 hover:bg-blue-50'
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="font-semibold text-gray-900 text-xs flex items-center gap-1.5">
                                <button
                                  onClick={() => buscarDetalhesCliente(cliente)}
                                  className="text-left hover:text-blue-600 hover:underline transition-colors"
                                >
                                  {cliente.nm_cliente}
                                </button>
                                {(cliente.faturas || []).some(
                                  (f) =>
                                    String(f.cd_portador) === '748' ||
                                    (f.nm_portador || '')
                                      .toUpperCase()
                                      .includes('SICREDI'),
                                ) && (
                                  <span
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-600 text-white flex-shrink-0"
                                    title="Possui títulos na SICREDI"
                                  >
                                    SICREDI
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-400">
                                Cód: {cliente.cd_cliente}{' '}
                                {cliente.ds_uf ? `• ${cliente.ds_uf}` : ''}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-700">
                              {cliente.nm_fantasia || '—'}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-700 font-mono">
                              {formatarCNPJ(cliente.nr_cpfcnpj)}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                  cliente.origem === 'MULTIMARCAS'
                                    ? 'bg-purple-100 text-purple-700'
                                    : cliente.origem === 'FRANQUIA'
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-blue-100 text-blue-700'
                                }`}
                              >
                                {cliente.origem}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-red-600 text-xs">
                              {formatarMoeda(cliente.valor_total)}
                            </td>
                            <td className="px-4 py-3 text-center whitespace-nowrap">
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                                  cliente.diasAtrasoMax > 120
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-orange-100 text-orange-700'
                                }`}
                              >
                                {cliente.diasAtrasoMax} dias
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {isChumbado ? (
                                <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-yellow-100 text-yellow-700 border border-yellow-300">
                                  BLOQUEADO
                                </span>
                              ) : (
                                <select
                                  value={
                                    statusClientes[cliente.cd_cliente] || ''
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    atualizarStatus(
                                      cliente.cd_cliente,
                                      e.target.value,
                                      cliente.nm_cliente,
                                    );
                                  }}
                                  className={`text-[10px] font-bold px-2 py-1 rounded-lg border cursor-pointer transition-colors ${getStatusStyle(statusClientes[cliente.cd_cliente])}`}
                                >
                                  <option value="">Selecionar...</option>
                                  {STATUS_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <label
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-bold rounded cursor-pointer transition-colors"
                                  title="Anexar arquivo"
                                >
                                  <Paperclip size={12} />
                                  <input
                                    type="file"
                                    className="hidden"
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      handleUploadAnexo(
                                        cliente.cd_cliente,
                                        e.target.files[0],
                                      );
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                                {(anexosClientes[cliente.cd_cliente] || [])
                                  .length > 0 && (
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] font-extrabold">
                                    {anexosClientes[cliente.cd_cliente].length}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isChumbado) abrirWhatsApp(cliente);
                                }}
                                disabled={isChumbado}
                                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                                  isChumbado
                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                    : 'bg-green-500 hover:bg-green-600 text-white'
                                }`}
                                title={
                                  isChumbado
                                    ? 'Ação indisponível para empresa própria'
                                    : cliente.nr_telefone
                                      ? `Enviar WhatsApp: ${cliente.nr_telefone}`
                                      : 'Telefone não encontrado'
                                }
                              >
                                <WhatsappLogo size={16} weight="fill" />
                                Enviar
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Modal de Detalhes do Cliente */}
      {detalhesCliente && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDetalhesCliente(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-[#000638] to-[#001466] rounded-t-xl">
              <div className="text-white">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  {detalhesCliente.nm_cliente}
                  {(detalhesCliente.faturas || []).some(
                    (f) =>
                      String(f.cd_portador) === '748' ||
                      (f.nm_portador || '').toUpperCase().includes('SICREDI'),
                  ) && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-600 text-white">
                      SICREDI
                    </span>
                  )}
                </h2>
                <p className="text-xs text-blue-200 mt-0.5">
                  {detalhesCliente.nm_fantasia
                    ? `${detalhesCliente.nm_fantasia} • `
                    : ''}
                  Cód: {detalhesCliente.cd_cliente} • CNPJ:{' '}
                  {formatarCNPJ(detalhesCliente.nr_cpfcnpj)} • Valor Total:{' '}
                  <span className="font-bold text-red-300">
                    {formatarMoeda(detalhesCliente.valor_total)}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={statusClientes[detalhesCliente.cd_cliente] || ''}
                  onChange={(e) =>
                    atualizarStatus(
                      detalhesCliente.cd_cliente,
                      e.target.value,
                      detalhesCliente.nm_cliente,
                    )
                  }
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border cursor-pointer ${getStatusStyle(statusClientes[detalhesCliente.cd_cliente])}`}
                >
                  <option value="">Status...</option>
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setDetalhesCliente(null)}
                  className="p-1 rounded-lg hover:bg-white/20 transition-colors"
                >
                  <X size={20} className="text-white" />
                </button>
              </div>
            </div>

            {/* Abas */}
            <div className="flex border-b border-gray-200">
              {[
                {
                  key: 'info',
                  label: 'Informações',
                  icon: <Users size={14} />,
                },
                {
                  key: 'resumo',
                  label: 'Resumo Cliente',
                  icon: <Scales size={14} />,
                },
                {
                  key: 'faturas',
                  label: `Faturas (${detalhesCliente.faturas?.length || 0})`,
                  icon: <Receipt size={14} />,
                },
                {
                  key: 'conversas',
                  label: 'Conversas',
                  icon: <ChatText size={14} />,
                },
                {
                  key: 'anexos',
                  label: `Anexos (${(anexosClientes[detalhesCliente.cd_cliente] || []).length})`,
                  icon: <Paperclip size={14} />,
                },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setAbaDetalhe(tab.key)}
                  className={`flex items-center gap-1.5 px-5 py-3 text-xs font-bold transition-colors border-b-2 ${
                    abaDetalhe === tab.key
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
              {loadingDetalhes ? (
                <div className="flex items-center justify-center py-12">
                  <CircleNotch
                    size={32}
                    className="animate-spin text-blue-600"
                  />
                  <span className="ml-3 text-sm text-gray-500">
                    Carregando dados do cliente...
                  </span>
                </div>
              ) : abaDetalhe === 'info' ? (
                <div className="space-y-6">
                  {/* Informações de Contato */}
                  <div>
                    <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                      <Users size={16} />
                      Informações de Contato
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <FileText
                          size={18}
                          className="text-gray-500 mt-0.5 flex-shrink-0"
                        />
                        <div>
                          <p className="text-[10px] font-bold text-gray-500 uppercase">
                            CNPJ/CPF
                          </p>
                          <p className="text-sm text-gray-900 font-mono">
                            {formatarCNPJ(
                              dadosPessoa?.cpf || detalhesCliente.nr_cpfcnpj,
                            )}
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
                            {dadosPessoa?.telefone ||
                              detalhesCliente.nr_telefone ||
                              '—'}
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
                          <p className="text-sm text-gray-900">
                            {dadosPessoa?.email || '—'}
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
                            UF
                          </p>
                          <p className="text-sm text-gray-900">
                            {dadosPessoa?.uf || detalhesCliente.ds_uf || '—'}
                          </p>
                        </div>
                      </div>
                      {getEndereco(dadosPessoa) && (
                        <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg md:col-span-2">
                          <MapPin
                            size={18}
                            className="text-gray-500 mt-0.5 flex-shrink-0"
                          />
                          <div>
                            <p className="text-[10px] font-bold text-gray-500 uppercase">
                              Endereço
                            </p>
                            <p className="text-sm text-gray-900">
                              {getEndereco(dadosPessoa)}
                            </p>
                          </div>
                        </div>
                      )}
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
                              {formatarMoeda(dadosCNPJ.capital_social)}
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
                                  <MapPin size={12} weight="fill" />
                                  Street View
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
                                <MapPin size={12} />
                                Google Maps
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
              ) : abaDetalhe === 'resumo' ? (
                <div className="space-y-6">
                  {/* Resumo Financeiro */}
                  <div>
                    <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                      <CurrencyDollar size={16} />
                      Resumo Financeiro
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3 bg-red-50 rounded-lg text-center">
                        <p className="text-[10px] font-bold text-red-500 uppercase">
                          Valor Inadimplente
                        </p>
                        <p className="text-lg font-extrabold text-red-600">
                          {formatarMoeda(detalhesCliente.valor_total)}
                        </p>
                      </div>
                      <div className="p-3 bg-orange-50 rounded-lg text-center">
                        <p className="text-[10px] font-bold text-orange-500 uppercase">
                          Maior Atraso
                        </p>
                        <p className="text-lg font-extrabold text-orange-600">
                          {detalhesCliente.diasAtrasoMax} dias
                        </p>
                      </div>
                      <div className="p-3 bg-blue-50 rounded-lg text-center">
                        <p className="text-[10px] font-bold text-blue-500 uppercase">
                          Qtd. Faturas
                        </p>
                        <p className="text-lg font-extrabold text-blue-600">
                          {detalhesCliente.faturas?.length || 0}
                        </p>
                      </div>
                      <div className="p-3 bg-purple-50 rounded-lg text-center">
                        <p className="text-[10px] font-bold text-purple-500 uppercase">
                          Origem
                        </p>
                        <p className="text-sm font-extrabold text-purple-600">
                          {detalhesCliente.origem}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Estatísticas TOTVS */}
                  {estatisticas && (
                    <div>
                      <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                        <Scales size={16} />
                        Estatísticas do Cliente
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {estatisticas.purchaseQuantity != null && (
                          <div className="p-3 bg-gray-50 rounded-lg">
                            <p className="text-[10px] font-bold text-gray-500">
                              COMPRAS REALIZADAS
                            </p>
                            <p className="text-sm font-bold text-gray-900">
                              {estatisticas.purchaseQuantity}
                            </p>
                          </div>
                        )}
                        {estatisticas.totalPurchaseValue != null && (
                          <div className="p-3 bg-gray-50 rounded-lg">
                            <p className="text-[10px] font-bold text-gray-500">
                              TOTAL COMPRADO
                            </p>
                            <p className="text-sm font-bold text-gray-900">
                              {formatarMoeda(estatisticas.totalPurchaseValue)}
                            </p>
                          </div>
                        )}
                        {estatisticas.averageDelay != null && (
                          <div className="p-3 bg-gray-50 rounded-lg">
                            <p className="text-[10px] font-bold text-gray-500">
                              ATRASO MÉDIO
                            </p>
                            <p className="text-sm font-bold text-gray-900">
                              {estatisticas.averageDelay} dias
                            </p>
                          </div>
                        )}
                        {estatisticas.maximumDelay != null && (
                          <div className="p-3 bg-gray-50 rounded-lg">
                            <p className="text-[10px] font-bold text-gray-500">
                              ATRASO MÁXIMO
                            </p>
                            <p className="text-sm font-bold text-gray-900">
                              {estatisticas.maximumDelay} dias
                            </p>
                          </div>
                        )}
                        {estatisticas.totalInstallmentsOpen != null && (
                          <div className="p-3 bg-gray-50 rounded-lg">
                            <p className="text-[10px] font-bold text-gray-500">
                              PARCELAS EM ABERTO
                            </p>
                            <p className="text-sm font-bold text-gray-900">
                              {estatisticas.totalInstallmentsOpen}
                            </p>
                          </div>
                        )}
                        {estatisticas.highestDebt != null && (
                          <div className="p-3 bg-gray-50 rounded-lg">
                            <p className="text-[10px] font-bold text-gray-500">
                              MAIOR DÉBITO
                            </p>
                            <p className="text-sm font-bold text-gray-900">
                              {formatarMoeda(estatisticas.highestDebt)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : abaDetalhe === 'conversas' ? (
                <div className="flex flex-col h-full">
                  {/* Filtro de período */}
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg space-y-3">
                    {/* Botões de período rápido */}
                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        { label: '7 dias', days: 7 },
                        { label: '15 dias', days: 15 },
                        { label: '30 dias', days: 30 },
                        { label: '60 dias', days: 60 },
                        { label: '90 dias', days: 90 },
                      ].map((p) => {
                        const end = new Date();
                        const start = new Date();
                        start.setDate(end.getDate() - p.days);
                        const startStr = start.toISOString().slice(0, 10);
                        const endStr = end.toISOString().slice(0, 10);
                        const isActive =
                          conversasDateStart === startStr &&
                          conversasDateEnd === endStr;
                        return (
                          <button
                            key={p.days}
                            onClick={() => {
                              setConversasDateStart(startStr);
                              setConversasDateEnd(endStr);
                            }}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                              isActive
                                ? 'bg-green-600 text-white border-green-600'
                                : 'bg-white text-gray-600 border-gray-300 hover:border-green-400 hover:text-green-700'
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => {
                          setConversasDateStart('');
                          setConversasDateEnd('');
                        }}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                          conversasDateStart &&
                          ![
                            ...[7, 15, 30, 60, 90].map((d) => {
                              const e = new Date();
                              const s = new Date();
                              s.setDate(e.getDate() - d);
                              return s.toISOString().slice(0, 10);
                            }),
                          ].includes(conversasDateStart)
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-green-400 hover:text-green-700'
                        }`}
                      >
                        Personalizado
                      </button>
                    </div>
                    {/* Inputs de data (sempre visíveis) */}
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">
                          Data Início
                        </label>
                        <input
                          type="date"
                          value={conversasDateStart}
                          onChange={(e) =>
                            setConversasDateStart(e.target.value)
                          }
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">
                          Data Fim
                        </label>
                        <input
                          type="date"
                          value={conversasDateEnd}
                          onChange={(e) => setConversasDateEnd(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                      </div>
                      <button
                        onClick={buscarInstancias}
                        disabled={loadingInstances}
                        className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 shrink-0"
                      >
                        {loadingInstances ? (
                          <CircleNotch size={16} className="animate-spin" />
                        ) : (
                          <MagnifyingGlass size={16} />
                        )}
                        Buscar
                      </button>
                    </div>
                  </div>

                  {/* Loading */}
                  {loadingInstances && (
                    <div className="flex items-center justify-center py-12">
                      <Spinner
                        size={32}
                        className="animate-spin text-green-600"
                      />
                      <span className="ml-3 text-sm text-gray-500">
                        Buscando instâncias...
                      </span>
                    </div>
                  )}

                  {/* Cards das instâncias */}
                  {!loadingInstances && instanceCards.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {instanceCards.map((inst) => (
                        <div
                          key={inst.instanceId}
                          onClick={() => abrirConversaInstancia(inst)}
                          className="p-4 bg-white border border-gray-200 rounded-xl cursor-pointer hover:shadow-lg hover:border-green-400 transition-all group"
                        >
                          <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center group-hover:bg-green-200 transition">
                              <WhatsappLogo
                                size={22}
                                className="text-green-600"
                                weight="fill"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-gray-900 truncate">
                                {inst.instanceName || 'Instância'}
                              </p>
                              <p className="text-[10px] text-gray-400">
                                {inst.instanceId?.slice(0, 8)}...
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-gray-500">
                            <span className="font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                              {inst.messageCount} mensagens
                            </span>
                            <span>
                              {inst.lastMessage
                                ? new Date(inst.lastMessage).toLocaleDateString(
                                    'pt-BR',
                                  )
                                : ''}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Estado vazio */}
                  {!loadingInstances && instanceCards.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                      <WhatsappLogo size={48} className="mb-3 opacity-30" />
                      <p className="text-sm font-medium">
                        Selecione um período e clique em Buscar
                      </p>
                      <p className="text-xs mt-1">
                        As conversas serão agrupadas por instância (número).
                      </p>
                      {(detalhesCliente?.nr_telefone ||
                        dadosPessoa?.telefone) && (
                        <p className="text-[10px] mt-3 text-gray-300">
                          Tel:{' '}
                          {detalhesCliente?.nr_telefone ||
                            dadosPessoa?.telefone}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : abaDetalhe === 'faturas' ? (
                <div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-bold text-gray-600">
                          Fatura
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-bold text-gray-600">
                          Emissão
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-bold text-gray-600">
                          Vencimento
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-bold text-gray-600">
                          Portador
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-bold text-gray-600">
                          Valor
                        </th>
                        <th className="px-4 py-2 text-center text-xs font-bold text-gray-600">
                          NF
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(detalhesCliente.faturas || [])
                        .sort((a, b) => {
                          const da = a.dt_vencimento || '';
                          const db = b.dt_vencimento || '';
                          return da < db ? -1 : da > db ? 1 : 0;
                        })
                        .map((fatura, i) => (
                          <tr
                            key={i}
                            className={
                              i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                            }
                          >
                            <td className="px-4 py-2 text-xs font-medium text-gray-900">
                              {fatura.nr_fat || fatura.nr_fatura || 'N/A'}
                              {fatura.nr_parcela
                                ? ` / ${fatura.nr_parcela}`
                                : ''}
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-700">
                              {formatarData(fatura.dt_emissao)}
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-700">
                              {formatarData(fatura.dt_vencimento)}
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-700">
                              {fatura.nm_portador || fatura.cd_portador || '—'}
                            </td>
                            <td className="px-4 py-2 text-xs text-right font-bold text-red-600">
                              {formatarMoeda(fatura.vl_fatura)}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <button
                                onClick={() => buscarNFsFatura(fatura)}
                                disabled={
                                  nfBuscando !== null || danfeLoading !== null
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-[10px] font-bold rounded transition-colors"
                                title="Gerar Nota Fiscal (DANFE)"
                              >
                                {nfBuscando ===
                                `${fatura.cd_cliente}_${fatura.nr_fat || fatura.nr_fatura}_${fatura.nr_parcela || ''}` ? (
                                  <CircleNotch
                                    size={12}
                                    className="animate-spin"
                                  />
                                ) : (
                                  <FileText size={12} />
                                )}
                                NF
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-300">
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-2 text-xs font-bold text-gray-700 text-right"
                        >
                          Total ({detalhesCliente.faturas?.length || 0} faturas)
                        </td>
                        <td className="px-4 py-2 text-xs text-right font-extrabold text-red-700">
                          {formatarMoeda(detalhesCliente.valor_total)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                /* Aba Anexos */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-700">
                      Arquivos anexados
                    </h3>
                    <label className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#000638] hover:bg-[#001466] text-white text-xs font-bold rounded-lg cursor-pointer transition-colors">
                      <Paperclip size={14} />
                      Anexar Arquivo
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          handleUploadAnexo(
                            detalhesCliente.cd_cliente,
                            e.target.files[0],
                          );
                          e.target.value = '';
                        }}
                        disabled={uploadingAnexo}
                      />
                    </label>
                  </div>

                  {uploadingAnexo && (
                    <div className="flex items-center gap-2 text-sm text-blue-600">
                      <CircleNotch size={16} className="animate-spin" />
                      Enviando arquivo...
                    </div>
                  )}

                  {(anexosClientes[detalhesCliente.cd_cliente] || []).length ===
                  0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">
                      Nenhum arquivo anexado a este cliente.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(anexosClientes[detalhesCliente.cd_cliente] || []).map(
                        (anexo) => (
                          <div
                            key={anexo.id}
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <FileText
                                size={18}
                                className="text-blue-600 flex-shrink-0"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-gray-900 truncate">
                                  {anexo.nome_arquivo}
                                </p>
                                <p className="text-[10px] text-gray-500">
                                  {new Date(
                                    anexo.created_at,
                                  ).toLocaleDateString('pt-BR')}{' '}
                                  às{' '}
                                  {new Date(
                                    anexo.created_at,
                                  ).toLocaleTimeString('pt-BR', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => downloadAnexo(anexo)}
                                className="p-1.5 rounded hover:bg-blue-100 text-blue-600 transition-colors"
                                title="Baixar"
                              >
                                <DownloadSimple size={14} />
                              </button>
                              <button
                                onClick={() => removerAnexo(anexo)}
                                className="p-1.5 rounded hover:bg-red-100 text-red-600 transition-colors"
                                title="Remover"
                              >
                                <Trash size={14} />
                              </button>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <span className="text-xs text-gray-500">
                {detalhesCliente.faturas?.length || 0} faturas • Maior atraso:{' '}
                {detalhesCliente.diasAtrasoMax} dias
                {isClienteBloqueado(detalhesCliente.nm_cliente) && (
                  <span className="ml-2 text-yellow-600 font-bold">
                    • BLOQUEADO
                  </span>
                )}
              </span>
              <div className="flex gap-2">
                {!isClienteBloqueado(detalhesCliente.nm_cliente) && (
                  <>
                    <button
                      onClick={() => {
                        abrirNotificacaoModal(detalhesCliente);
                      }}
                      className="inline-flex items-center gap-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      <Scales size={16} weight="fill" />
                      Notificação Extrajudicial
                    </button>
                    <button
                      onClick={() => abrirWhatsApp(detalhesCliente)}
                      className="inline-flex items-center gap-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      <WhatsappLogo size={16} weight="fill" />
                      WhatsApp
                    </button>
                  </>
                )}
                <button
                  onClick={() => setDetalhesCliente(null)}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-bold rounded-lg transition-colors"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* Modal iPhone — conversa da instância */}
      {selectedInstance && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[998]"
          onClick={() => setSelectedInstance(null)}
        >
          <div className="relative mx-4" onClick={(e) => e.stopPropagation()}>
            {/* Frame iPhone */}
            <div className="w-[375px] max-w-[calc(100vw-2rem)] h-[720px] max-h-[calc(100vh-2rem)] bg-black rounded-[50px] p-3 shadow-2xl relative">
              {/* Notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[120px] h-[30px] bg-black rounded-b-2xl z-10" />
              {/* Screen */}
              <div
                className="w-full h-full bg-[#e5ddd5] rounded-[38px] overflow-hidden flex flex-col"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z' fill='%23d4cfc4' fill-opacity='.15' fill-rule='evenodd'/%3E%3C/svg%3E\")",
                }}
              >
                {/* Header WhatsApp */}
                <div className="bg-[#075e54] pt-10 pb-3 px-4 flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setSelectedInstance(null)}
                    className="text-white hover:text-gray-200"
                  >
                    <X size={20} weight="bold" />
                  </button>
                  <div className="w-9 h-9 rounded-full bg-gray-300 flex items-center justify-center">
                    <WhatsappLogo
                      size={20}
                      className="text-white"
                      weight="fill"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-bold truncate">
                      {selectedInstance.instanceName}
                    </p>
                    <p className="text-green-200 text-[10px]">
                      {phoneModalTotal} mensagens • {conversasPhone}
                    </p>
                  </div>
                </div>

                {/* Mensagens */}
                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                  {loadingPhoneModal ? (
                    <div className="flex items-center justify-center py-12">
                      <Spinner
                        size={24}
                        className="animate-spin text-green-600"
                      />
                      <span className="ml-2 text-xs text-gray-500">
                        Carregando...
                      </span>
                    </div>
                  ) : phoneModalMessages.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                      <p className="text-xs text-gray-400">
                        Nenhuma mensagem encontrada
                      </p>
                    </div>
                  ) : (
                    phoneModalMessages.map((msg, idx) => {
                      const isFromMe = msg.key?.fromMe === true;
                      const msgType = msg.messageType;
                      const prevMsg =
                        idx > 0 ? phoneModalMessages[idx - 1] : null;
                      const msgDate = msg.msg_ts_tz
                        ? new Date(msg.msg_ts_tz).toLocaleDateString('pt-BR')
                        : '';
                      const prevDate = prevMsg?.msg_ts_tz
                        ? new Date(prevMsg.msg_ts_tz).toLocaleDateString(
                            'pt-BR',
                          )
                        : '';
                      const showDateSep = msgDate && msgDate !== prevDate;
                      const msgTime = msg.msg_ts_tz
                        ? new Date(msg.msg_ts_tz).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '';
                      if (
                        msgType === 'protocolMessage' ||
                        msgType === 'reactionMessage'
                      )
                        return null;

                      let content = null;
                      if (
                        msgType === 'conversation' ||
                        msgType === 'extendedTextMessage' ||
                        msgType === 'editedMessage'
                      ) {
                        content = (
                          <p className="text-[12px] leading-relaxed whitespace-pre-wrap break-words">
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
                                onClick={() => handleImageClickRC(msg)}
                              >
                                <img
                                  src={
                                    mediaCache[msg.id]?.base64
                                      ? `data:${mediaCache[msg.id].mimetype || 'image/jpeg'};base64,${mediaCache[msg.id].base64}`
                                      : `data:image/jpeg;base64,${thumb}`
                                  }
                                  alt="imagem"
                                  className="rounded-lg max-w-[180px] max-h-[180px]"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 rounded-lg transition">
                                  {loadingMediaId === msg.id ? (
                                    <CircleNotch
                                      size={20}
                                      className="text-white animate-spin"
                                    />
                                  ) : (
                                    <MagnifyingGlassPlus
                                      size={20}
                                      className="text-white opacity-0 group-hover:opacity-100 transition"
                                    />
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div
                                className="flex items-center gap-1 text-[12px] cursor-pointer hover:underline"
                                onClick={() => handleImageClickRC(msg)}
                              >
                                <Image size={12} className="opacity-60" />
                                <span className="italic opacity-75">
                                  Imagem
                                </span>
                              </div>
                            )}
                            {msg.text_content && (
                              <p className="text-[12px] mt-1 whitespace-pre-wrap break-words">
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
                          msg.message?.audioMessage || msg.message?.ptvMessage;
                        const seconds = audioData?.seconds || 0;
                        const isExpired = mediaCache[msg.id]?.expired;
                        content = (
                          <div
                            className={`flex items-center gap-2 min-w-[140px] max-w-[200px] select-none ${isExpired ? 'opacity-60' : 'cursor-pointer'}`}
                            onClick={() => !isExpired && handlePlayAudioRC(msg)}
                          >
                            <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                              {loadingMediaId === msg.id ? (
                                <CircleNotch
                                  size={14}
                                  className="text-white animate-spin"
                                />
                              ) : playingAudioId === msg.id ? (
                                <Pause
                                  size={14}
                                  className="text-white"
                                  weight="fill"
                                />
                              ) : (
                                <Play
                                  size={14}
                                  className="text-white"
                                  weight="fill"
                                />
                              )}
                            </div>
                            <div className="h-[2px] flex-1 bg-gray-300 rounded-full" />
                            <span className="text-[10px] text-gray-500 shrink-0">
                              {isExpired
                                ? '⏱'
                                : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
                            </span>
                          </div>
                        );
                      } else if (msgType === 'videoMessage') {
                        const vidData = msg.message?.videoMessage;
                        const vidThumb = vidData?.jpegThumbnail;
                        content = (
                          <div className="relative inline-block">
                            {vidThumb ? (
                              <img
                                src={`data:image/jpeg;base64,${vidThumb}`}
                                alt="vídeo"
                                className="rounded-lg max-w-[180px] max-h-[180px]"
                              />
                            ) : (
                              <div className="w-[140px] h-[80px] bg-gray-200 rounded-lg flex items-center justify-center">
                                <VideoCamera
                                  size={20}
                                  className="text-gray-400"
                                />
                              </div>
                            )}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center">
                                <VideoCamera
                                  size={18}
                                  className="text-white"
                                  weight="fill"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      } else if (msgType === 'documentMessage') {
                        content = (
                          <div className="flex items-center gap-1 text-[12px]">
                            <File size={12} className="opacity-60" />
                            <span className="italic opacity-75">Documento</span>
                          </div>
                        );
                      } else if (msgType === 'stickerMessage') {
                        const stickerThumb =
                          msg.message?.stickerMessage?.jpegThumbnail;
                        content = stickerThumb ? (
                          <img
                            src={`data:image/webp;base64,${stickerThumb}`}
                            className="w-[80px] h-[80px] object-contain"
                            alt="sticker"
                          />
                        ) : (
                          <span className="text-[12px] italic">Figurinha</span>
                        );
                      } else {
                        content = (
                          <p className="text-[12px] italic opacity-75">
                            {msg.text_content || msgType}
                          </p>
                        );
                      }

                      return (
                        <React.Fragment key={msg.id}>
                          {showDateSep && (
                            <div className="flex justify-center my-2">
                              <span className="bg-white/80 text-[9px] font-bold text-gray-500 px-2 py-0.5 rounded-full shadow-sm">
                                {msgDate}
                              </span>
                            </div>
                          )}
                          <div
                            className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`relative max-w-[80%] px-2.5 py-1 rounded-lg shadow-sm ${isFromMe ? 'bg-[#d9fdd3]' : 'bg-white'}`}
                            >
                              {!isFromMe && msg.pushName && (
                                <p className="text-[9px] font-bold text-emerald-700 mb-0.5">
                                  {msg.pushName}
                                </p>
                              )}
                              {content}
                              <p
                                className={`text-[8px] mt-0.5 text-right ${isFromMe ? 'text-gray-500' : 'text-gray-400'}`}
                              >
                                {msgTime}
                              </p>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })
                  )}
                  <div ref={conversasEndRef} />
                </div>

                {/* Bottom bar (home indicator) */}
                <div className="h-6 bg-[#f0f0f0] flex items-center justify-center shrink-0 rounded-b-[38px]">
                  <div className="w-[120px] h-[4px] bg-gray-400 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição da Notificação Extrajudicial */}
      {notificacaoModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={() => setNotificacaoModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-[#000638] flex items-center gap-2">
                <Scales size={20} className="text-amber-600" />
                Notificação Extrajudicial
              </h2>
              <button
                onClick={() => setNotificacaoModal(null)}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div className="overflow-auto flex-1 px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">
                  Razão Social do Devedor
                </label>
                <input
                  type="text"
                  value={notificacaoModal.razao_social}
                  onChange={(e) =>
                    setNotificacaoModal((prev) => ({
                      ...prev,
                      razao_social: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">
                    CNPJ
                  </label>
                  <input
                    type="text"
                    value={notificacaoModal.cnpj}
                    onChange={(e) =>
                      setNotificacaoModal((prev) => ({
                        ...prev,
                        cnpj: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">
                    Valor Total
                  </label>
                  <input
                    type="text"
                    value={notificacaoModal.valor}
                    onChange={(e) =>
                      setNotificacaoModal((prev) => ({
                        ...prev,
                        valor: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">
                  Endereço
                </label>
                <input
                  type="text"
                  value={notificacaoModal.endereco}
                  onChange={(e) =>
                    setNotificacaoModal((prev) => ({
                      ...prev,
                      endereco: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">
                  Descrição / Origem
                </label>
                <textarea
                  value={notificacaoModal.descricao_origem}
                  onChange={(e) =>
                    setNotificacaoModal((prev) => ({
                      ...prev,
                      descricao_origem: e.target.value,
                    }))
                  }
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">
                    Dia
                  </label>
                  <input
                    type="text"
                    value={notificacaoModal.dia}
                    onChange={(e) =>
                      setNotificacaoModal((prev) => ({
                        ...prev,
                        dia: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">
                    Mês
                  </label>
                  <input
                    type="text"
                    value={notificacaoModal.mes}
                    onChange={(e) =>
                      setNotificacaoModal((prev) => ({
                        ...prev,
                        mes: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">
                    WhatsApp Contato
                  </label>
                  <input
                    type="text"
                    value={notificacaoModal.whatsapp}
                    onChange={(e) =>
                      setNotificacaoModal((prev) => ({
                        ...prev,
                        whatsapp: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setNotificacaoModal(null)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-bold rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={gerarNotificacaoDocx}
                disabled={gerandoNotificacao}
                className="inline-flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-xs font-bold rounded-lg transition-colors"
              >
                {gerandoNotificacao ? (
                  <CircleNotch size={16} className="animate-spin" />
                ) : (
                  <WhatsappLogo size={16} weight="fill" />
                )}
                Gerar e Enviar via WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecuperacaoCredito;
