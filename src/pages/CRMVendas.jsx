import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  lazy,
  Suspense,
} from 'react';
import {
  ArrowsClockwise,
  Database,
  Spinner,
  MagnifyingGlass,
  ChartBar,
} from '@phosphor-icons/react';
import { API_BASE_URL } from '../config/constants';
import {
  MODULOS,
  TABS,
  SUB_TABS,
  OPERATIONS_POR_MODULO,
  cleanPhone,
} from '../components/crm/constants';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '../components/ui/cards';
import PageTitle from '../components/ui/PageTitle';

// Lazy load dos componentes pesados — só carrega quando a aba é acessada
const FunilView = lazy(() => import('../components/crm/FunilView'));
const RoubarLeads = lazy(() => import('../components/crm/RoubarLeads'));
const CanalErrado = lazy(() => import('../components/crm/CanalErrado'));
const CarteiraView = lazy(() => import('../components/crm/CarteiraView'));
const AnalyticsView = lazy(() => import('../components/crm/AnalyticsView'));
const PerformanceView = lazy(() => import('../components/crm/PerformanceView'));
const UltimoContatoView = lazy(
  () => import('../components/crm/UltimoContatoView'),
);
const TurnoView = lazy(() => import('../components/crm/TurnoView'));
const ChatPanel = lazy(() => import('../components/crm/ChatPanel'));
const ConversaoView = lazy(() => import('../components/crm/ConversaoView'));
const PainelGeral = lazy(() => import('../components/crm/PainelGeral'));
const LeadGeneration = lazy(() => import('../components/crm/LeadGeneration'));

const LazyFallback = () => (
  <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
    <Spinner size={20} className="animate-spin" />
    <span className="text-xs">Carregando módulo...</span>
  </div>
);

const API_KEY = import.meta.env.VITE_API_KEY || '';

async function apiPost(endpoint, body) {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const json = await res.json();
  return json.data ?? json;
}

// Data local em YYYY-MM-DD (evita timezone bug do toISOString quando usuário
// está em UTC-3 e a hora local é noite/madrugada)
function toLocalDateStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function apiGet(endpoint) {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: { 'x-api-key': API_KEY },
  });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const json = await res.json();
  return json.data ?? json;
}

export default function CRMVendas() {
  const [modulo, setModulo] = useState('multimarcas');
  const [tab, setTab] = useState('painel');
  const [subTab, setSubTab] = useState('funil');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [data, setData] = useState(null);
  const [phoneStatus, setPhoneStatus] = useState({});
  // ERP cacheado em localStorage (TTL 30 min) pra acelerar reloads
  const ERP_LS_KEY = 'crm_erp_cache_v1';
  const ERP_LS_TTL = 30 * 60 * 1000;
  const [erpData, setErpData] = useState(() => {
    try {
      const raw = localStorage.getItem(ERP_LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.ts || Date.now() - parsed.ts > ERP_LS_TTL) return null;
      return parsed.data;
    } catch {
      return null;
    }
  });
  // Wrap setErpData pra também salvar em localStorage
  const setErpDataPersist = useCallback((data) => {
    setErpData(data);
    try {
      if (data?.clientes?.length) {
        localStorage.setItem(
          ERP_LS_KEY,
          JSON.stringify({ ts: Date.now(), data }),
        );
      }
    } catch {}
  }, []);
  const [lastUpdate, setLastUpdate] = useState({
    clickup: null,
    evo: null,
    erp: null,
  });
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTel, setChatTel] = useState('');
  const [chatNome, setChatNome] = useState('');
  const [chatInst, setChatInst] = useState('');
  const [chatInstancias, setChatInstancias] = useState([]);
  const [chatProvider, setChatProvider] = useState('evolution');

  const autoLoadedRef = useRef(false);

  useEffect(() => {
    const hoje = new Date();
    const seteDiasAtras = new Date(hoje);
    seteDiasAtras.setDate(hoje.getDate() - 7);
    setDataInicio(toLocalDateStr(seteDiasAtras));
    setDataFim(toLocalDateStr(hoje));
  }, []);

  // Cache de phoneStatus para evitar re-fetch dos mesmos telefones
  const phonesCacheRef = useRef({ key: '', data: null });

  const carregarPhoneStatus = useCallback(async (canais) => {
    const phones = [];
    for (const ch of canais || []) {
      for (const t of ch.tarefas || []) {
        const c = cleanPhone(t.telefone);
        if (c && c.length >= 10) phones.push(c);
      }
    }
    if (phones.length === 0) return;
    const unique = [...new Set(phones)];
    const cacheKey = unique.sort().join(',');
    if (phonesCacheRef.current.key === cacheKey && phonesCacheRef.current.data) {
      setPhoneStatus(phonesCacheRef.current.data);
      return;
    }
    try {
      const ps = await apiPost('/api/crm/inst-check-bulk', { phones: unique });
      phonesCacheRef.current = { key: cacheKey, data: ps || {} };
      setPhoneStatus(ps || {});
      setLastUpdate((p) => ({ ...p, evo: new Date() }));
    } catch (e) {
      console.error('inst-check-bulk falhou:', e);
    }
  }, []);

  const carregarLeads = useCallback(async () => {
    if (!dataInicio || !dataFim) return;
    setLoading(true);
    setErro('');
    try {
      const result = await apiPost('/api/crm/leads', {
        de: dataInicio,
        ate: dataFim,
      });
      setData(result);
      setLastUpdate((p) => ({ ...p, clickup: new Date() }));
      setLoading(false);
      // Busca status WhatsApp em background (não bloqueia exibição dos leads)
      carregarPhoneStatus(result?.canais);
    } catch (err) {
      setErro(err.message || 'Erro ao carregar leads');
      setLoading(false);
    }
  }, [dataInicio, dataFim, carregarPhoneStatus]);

  // Carrega leads automaticamente ao abrir a página
  useEffect(() => {
    if (dataInicio && dataFim && !autoLoadedRef.current && !data) {
      autoLoadedRef.current = true;
      carregarLeads();
    }
  }, [dataInicio, dataFim, data, carregarLeads]);

  const atualizarEvolution = useCallback(async () => {
    if (!data) return;
    // Invalida cache para forçar re-fetch
    phonesCacheRef.current = { key: '', data: null };
    carregarPhoneStatus(data.canais);
  }, [data, carregarPhoneStatus]);

  // ── Auto-refresh em background (sem botão manual) ──
  // ClickUp: a cada 5 min  |  Evolution (status WhatsApp): a cada 2 min
  useEffect(() => {
    if (!dataInicio || !dataFim) return;
    const clickupInterval = setInterval(() => {
      // Não dispara se já está carregando
      if (!loading) carregarLeads();
    }, 5 * 60 * 1000);
    const evoInterval = setInterval(() => {
      if (data && !loading) atualizarEvolution();
    }, 2 * 60 * 1000);
    return () => {
      clearInterval(clickupInterval);
      clearInterval(evoInterval);
    };
  }, [dataInicio, dataFim, data, loading, carregarLeads, atualizarEvolution]);

  const [erpLoading, setErpLoading] = useState(false);
  const [erpProgress, setErpProgress] = useState(null);
  const [erpMeses, setErpMeses] = useState('7d');
  const erpPollRef = useRef(null);
  const [oportunidadesMap, setOportunidadesMap] = useState({});
  const [vendedoresMap, setVendedoresMap] = useState(null);
  const [sellersTotals, setSellersTotals] = useState({
    periodo: [],
    mes: [],
    semana: [],
  });
  const [sellersTotalsGlobal, setSellersTotalsGlobal] = useState([]);
  const [fatSegmentos, setFatSegmentos] = useState(null);
  const [branchesTotals, setBranchesTotals] = useState({
    periodo: [],
    mes: [],
    semana: [],
  });
  const [canalTotals, setCanalTotals] = useState(null); // { invoice_value, invoice_qty, ... }
  const [sellersTotalsLoading, setSellersTotalsLoading] = useState(false);
  const sellersTotalsDatesRef = useRef('');

  const pararPollERP = useCallback(() => {
    if (erpPollRef.current) {
      clearInterval(erpPollRef.current);
      erpPollRef.current = null;
    }
  }, []);

  // Limpa poll ao desmontar componente
  useEffect(() => () => pararPollERP(), [pararPollERP]);

  // Carregar dados do ERP direto da API TOTVS (substitui upload)
  // LAZY: só carrega quando o usuário pedir ou abrir aba que precisa
  const carregarERP = useCallback(
    async (force = false, meses = 3) => {
      pararPollERP();
      setErpLoading(true);
      setErpProgress(null);
      setErro('');
      try {
        let filterParam;
        const val = String(meses);
        if (val === 'thisMonth') {
          filterParam = 'periodo=thisMonth';
        } else if (val === 'lastMonth') {
          filterParam = 'periodo=lastMonth';
        } else if (val.endsWith('d')) {
          filterParam = `dias=${parseInt(val)}`;
        } else {
          filterParam = `meses=${meses}`;
        }
        const url = `/api/crm/erp-data?${filterParam}${force ? '&force=1' : ''}`;
        const result = await apiGet(url);

        // Backend está carregando em background → iniciar polling
        if (result?.loading) {
          erpPollRef.current = setInterval(async () => {
            try {
              const status = await apiGet('/api/crm/erp-status');
              if (status?.progress) setErpProgress(status.progress);
              if (status?.loaded) {
                pararPollERP();
                const data = await apiGet(url);
                // Se o backend retornou loading (ex: key mismatch disparou nova carga),
                // reinicia o polling em vez de definir dados inválidos
                if (data?.loading) {
                  erpPollRef.current = setInterval(async () => {
                    try {
                      const s2 = await apiGet('/api/crm/erp-status');
                      if (s2?.progress) setErpProgress(s2.progress);
                      if (s2?.loaded) {
                        pararPollERP();
                        const d2 = await apiGet(url);
                        if (!d2?.loading) {
                          setErpDataPersist(d2);
                          setErpProgress(null);
                          setLastUpdate((p) => ({ ...p, erp: new Date() }));
                          setErpLoading(false);
                        }
                      }
                    } catch {}
                  }, 5000);
                  return;
                }
                setErpDataPersist(data);
                setErpProgress(null);
                setLastUpdate((p) => ({ ...p, erp: new Date() }));
                setErpLoading(false);
              }
            } catch {
              /* silencioso */
            }
          }, 5000);
          return; // erpLoading permanece true até o poll terminar
        }

        setErpDataPersist(result);
        setLastUpdate((p) => ({ ...p, erp: new Date() }));
      } catch (err) {
        setErro('Erro ao carregar ERP do TOTVS: ' + err.message);
      } finally {
        if (!erpPollRef.current) setErpLoading(false);
      }
    },
    [pararPollERP],
  );

  // Pré-carrega ERP assim que o CRM monta — em background, pra estar pronto
  // antes do usuário clicar em Carteira/Performance/Contato.
  useEffect(() => {
    if (!erpData && !erpLoading) {
      carregarERP(false, 12);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Garante carregamento se o usuário trocar de aba antes do pré-load completar
  useEffect(() => {
    const tabsQueUsamErp = ['carteira', 'performance', 'contato'];
    if (tabsQueUsamErp.includes(tab) && !erpData && !erpLoading) {
      carregarERP(false, 12);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Carrega faturamento TOTVS por vendedor para 3 períodos (filtro, mês, semana)
  const carregarSellersTotals = useCallback(async () => {
    if (!dataInicio || !dataFim) return;
    setSellersTotalsLoading(true);
    try {
      const hoje = new Date();
      const inicioMes = toLocalDateStr(
        new Date(hoje.getFullYear(), hoje.getMonth(), 1),
      );
      const diaSemana = hoje.getDay();
      const offsetSeg = diaSemana === 0 ? 6 : diaSemana - 1;
      const seg = new Date(hoje);
      seg.setDate(seg.getDate() - offsetSeg);
      const inicioSemana = toLocalDateStr(seg);
      const hojeStr = toLocalDateStr(hoje);

      const operations = OPERATIONS_POR_MODULO[modulo] || undefined;
      const buildPayload = (datemin, datemax) => {
        const p = { datemin, datemax, modulo };
        if (operations) p.operations = operations;
        return p;
      };

      // Para revenda e multimarcas: usa canal-totals (TOTVS live com filtro de dealer)
      // que retorna per_seller atualizado (sem sync delay do supabase).
      // Para varejo: usa sellers-totals supabase (com segmentação canal-aware).
      const usaCanalTotals = modulo === 'revenda' || modulo === 'multimarcas' || modulo === 'inbound_david' || modulo === 'inbound_rafael';

      if (usaCanalTotals) {
        const [ctPeriodo, ctMes, ctSemana] = await Promise.all([
          apiPost('/api/crm/canal-totals', {
            datemin: dataInicio, datemax: dataFim, modulo,
          }),
          apiPost('/api/crm/canal-totals', {
            datemin: inicioMes, datemax: hojeStr, modulo,
          }),
          apiPost('/api/crm/canal-totals', {
            datemin: inicioSemana, datemax: hojeStr, modulo,
          }),
        ]);
        sellersTotalsDatesRef.current = `${dataInicio}|${dataFim}|${modulo}`;
        setSellersTotals({
          periodo: ctPeriodo?.per_seller || [],
          mes: ctMes?.per_seller || [],
          semana: ctSemana?.per_seller || [],
        });
        setCanalTotals(ctPeriodo || null);
      } else {
        const [periodo, mes, semana] = await Promise.all([
          apiPost('/api/crm/sellers-totals', buildPayload(dataInicio, dataFim)),
          apiPost('/api/crm/sellers-totals', buildPayload(inicioMes, hojeStr)),
          apiPost('/api/crm/sellers-totals', buildPayload(inicioSemana, hojeStr)),
        ]);
        sellersTotalsDatesRef.current = `${dataInicio}|${dataFim}|${modulo}`;
        setSellersTotals({
          periodo: periodo?.dataRow || periodo || [],
          mes: mes?.dataRow || mes || [],
          semana: semana?.dataRow || semana || [],
        });

        // Canal totals (TOTVS direct) — para varejo
        apiPost('/api/crm/canal-totals', {
          datemin: dataInicio, datemax: dataFim, modulo,
        })
          .then((ct) => setCanalTotals(ct || null))
          .catch((e) => {
            console.warn('[canal-totals] Erro:', e.message);
            setCanalTotals(null);
          });
      }

      // Fetch de segmentos independente — não bloqueia sellers-totals
      apiPost('/api/crm/faturamento-por-segmento', { datemin: dataInicio, datemax: dataFim })
        .then((seg) => setFatSegmentos(seg?.segmentos || null))
        .catch((e) => console.warn('[fat-segmentos] Erro:', e.message));

      // Varejo: também busca faturamento por LOJA (branches) — não toca multimarcas/revenda
      if (modulo === 'varejo') {
        Promise.all([
          apiPost('/api/crm/branches-totals', {
            datemin: dataInicio,
            datemax: dataFim,
            metaType: 'periodo',
          }),
          apiPost('/api/crm/branches-totals', {
            datemin: inicioMes,
            datemax: hojeStr,
            metaType: 'mensal',
          }),
          apiPost('/api/crm/branches-totals', {
            datemin: inicioSemana,
            datemax: hojeStr,
            metaType: 'semanal',
          }),
        ])
          .then(([bp, bm, bs]) => {
            setBranchesTotals({
              periodo: bp?.dataRow || bp || [],
              mes: bm?.dataRow || bm || [],
              semana: bs?.dataRow || bs || [],
              metaPeriodo: bp?.meta || null,
              metaMes: bm?.meta || null,
              metaSemana: bs?.meta || null,
            });
          })
          .catch((e) =>
            console.warn('[branches-totals] Erro:', e.message),
          );
      } else {
        setBranchesTotals({
          periodo: [],
          mes: [],
          semana: [],
          metaPeriodo: null,
          metaMes: null,
          metaSemana: null,
        });
      }
    } catch (e) {
      console.error('sellers-totals erro:', e);
    } finally {
      setSellersTotalsLoading(false);
    }
  }, [dataInicio, dataFim, modulo]);

  // Auto-carrega ao abrir aba performance (se nunca carregou ou datas mudaram)
  useEffect(() => {
    if (
      tab === 'performance' &&
      dataInicio &&
      dataFim &&
      !sellersTotalsLoading
    ) {
      const currentKey = `${dataInicio}|${dataFim}|${modulo}`;
      if (sellersTotalsDatesRef.current !== currentKey) {
        carregarSellersTotals();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dataInicio, dataFim, modulo]);

  // Constrói oportunidadesMap a partir dos leads do ClickUp (por vendedorTotvsId)
  useEffect(() => {
    if (!data?.canais) return;
    const map = {};
    for (const canal of data.canais) {
      for (const t of canal.tarefas || []) {
        const vId = t.vendedorTotvsId;
        if (vId) map[vId] = (map[vId] || 0) + 1;
      }
    }
    setOportunidadesMap(map);
  }, [data]);

  // Busca vendedoresMap do Supabase sob demanda (só nas abas que precisam)
  const vendedoresLoadedRef = useRef(false);
  useEffect(() => {
    const tabsQueUsamVendedores = ['carteira', 'performance', 'lead-gen'];
    if (tabsQueUsamVendedores.includes(tab) && !vendedoresLoadedRef.current) {
      vendedoresLoadedRef.current = true;
      apiGet('/api/crm/vendedores')
        .then((d) => setVendedoresMap(d || null))
        .catch(() => {});
    }
  }, [tab]);

  const onChatLead = useCallback(async (t) => {
    setChatTel(t.telefone);
    setChatNome(t.nome);
    setChatInst(t.inst || '');
    setChatProvider(t.provider || 'evolution');
    setChatInstancias([]);
    try {
      // Endpoint unificado: Evolution (com count) + UAzapi (instâncias com chat)
      const r = await fetch(
        `${API_BASE_URL}/api/crm/lead-instances/${cleanPhone(t.telefone)}`,
        { headers: { 'x-api-key': API_KEY } },
      );
      if (r.ok) {
        const json = await r.json();
        const list = json.data?.instances || json.instances || [];
        setChatInstancias(list);
        // Se nenhuma inst foi pré-definida, escolhe a primeira (mais mensagens)
        if (!t.inst && list.length > 0) {
          setChatInst(list[0].name);
          setChatProvider(list[0].provider || 'evolution');
        }
      }
    } catch {}
    setChatOpen(true);
  }, []);

  const onChatCloser = useCallback(async (t) => {
    setChatTel(t.telefone);
    setChatNome(t.nome);
    setChatInst(t.closerInst || '');
    setChatOpen(true);
  }, []);

  const onAnalise = useCallback(async (t) => {
    try {
      setLoading(true);
      const result = await apiPost('/api/crm/gerar-analise', {
        tel: t.telefone,
        nome: t.nome,
        compras: [],
      });
      alert(JSON.stringify(result?.analise || result, null, 2));
    } catch (e) {
      alert('Erro ao gerar análise: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const formatTime = (d) =>
    d
      ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : null;

  return (
    <div className="w-full max-w-7xl mx-auto p-4 space-y-4">
      {/* ═══ TÍTULO ═══════════════════════════════════════════════════════ */}
      <PageTitle
        icon={ChartBar}
        title="CRM de Vendas"
        subtitle="Gestão de leads e carteira • ClickUp + Evolution + TOTVS"
      />

      {/* ═══ CARD DE CONTROLES ════════════════════════════════════════════ */}
      <Card className="shadow-sm rounded-2xl border border-gray-100 bg-gradient-to-br from-white to-gray-50/50">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Módulos + Painel Geral (modo neutro) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setTab('painel')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  tab === 'painel'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-500/30'
                    : 'text-indigo-600 hover:bg-indigo-50 border border-indigo-200'
                }`}
                title="Painel geral neutro (não filtra por módulo)"
              >
                <ChartBar size={12} weight="bold" />
                Painel Geral
              </button>
              <div className="w-px h-5 bg-gray-200 mx-2" />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mr-1">
                Módulo
              </span>
              {MODULOS.filter((m) =>
                ['multimarcas', 'inbound_david', 'inbound_rafael', 'revenda', 'varejo'].includes(m.key),
              ).map((m) => (
                <button
                  key={m.key}
                  onClick={() => {
                    setModulo(m.key);
                    // Se tava no painel geral, sai pra aba padrão do módulo
                    if (tab === 'painel') setTab('abertura');
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    modulo === m.key && tab !== 'painel'
                      ? 'bg-gradient-to-r from-[#000638] to-[#1a1f5a] text-white shadow-md shadow-[#000638]/30'
                      : 'text-gray-600 hover:text-[#000638] hover:bg-[#000638]/5 border border-gray-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Sync indicators (auto-refresh em background, sem botão manual) */}
            <div className="flex items-center gap-2 flex-wrap">
              {(lastUpdate.clickup || lastUpdate.evo) && (
                <div className="flex items-center gap-2 text-[10px] text-gray-400 px-2 py-1.5">
                  {lastUpdate.clickup && (
                    <span className="flex items-center gap-1" title="ClickUp atualizado automaticamente">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      ClickUp {formatTime(lastUpdate.clickup)}
                    </span>
                  )}
                  {lastUpdate.evo && (
                    <span className="flex items-center gap-1" title="Evolution atualizado automaticamente">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Evolution {formatTime(lastUpdate.evo)}
                    </span>
                  )}
                </div>
              )}
              <select
                value={erpMeses}
                onChange={(e) => {
                  const val = e.target.value;
                  setErpMeses(val);
                  // NOTA: erpMeses é apenas o "label" do filtro do topo.
                  // O cache ERP (Carteira) é SEMPRE carregado com 12 meses
                  // pra preservar a base completa de clientes — vide carregarERP.
                  const hoje = new Date();
                  const hojeStr = toLocalDateStr(hoje);
                  let novoInicio;
                  if (val === 'thisWeek') {
                    const diaSemana = hoje.getDay();
                    const offsetSeg = diaSemana === 0 ? 6 : diaSemana - 1;
                    const seg = new Date(hoje);
                    seg.setDate(seg.getDate() - offsetSeg);
                    novoInicio = toLocalDateStr(seg);
                  } else if (val === 'lastWeek') {
                    // Semana passada: segunda → domingo
                    const diaSemana = hoje.getDay();
                    const offsetSeg = diaSemana === 0 ? 6 : diaSemana - 1;
                    const segAtual = new Date(hoje);
                    segAtual.setDate(segAtual.getDate() - offsetSeg);
                    const domPassado = new Date(segAtual);
                    domPassado.setDate(domPassado.getDate() - 1);
                    const segPassada = new Date(domPassado);
                    segPassada.setDate(segPassada.getDate() - 6);
                    setDataInicio(toLocalDateStr(segPassada));
                    setDataFim(toLocalDateStr(domPassado));
                    return;
                  } else if (val === '7d') {
                    const d = new Date(hoje);
                    d.setDate(d.getDate() - 7);
                    novoInicio = toLocalDateStr(d);
                  } else if (val === '15d') {
                    const d = new Date(hoje);
                    d.setDate(d.getDate() - 15);
                    novoInicio = toLocalDateStr(d);
                  } else if (val === 'thisMonth') {
                    novoInicio = toLocalDateStr(
                      new Date(hoje.getFullYear(), hoje.getMonth(), 1),
                    );
                  } else if (val === 'lastMonth') {
                    novoInicio = toLocalDateStr(
                      new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1),
                    );
                    const fimMesPassado = new Date(
                      hoje.getFullYear(),
                      hoje.getMonth(),
                      0,
                    );
                    setDataFim(toLocalDateStr(fimMesPassado));
                    setDataInicio(novoInicio);
                    return;
                  } else if (val === 'thisYear') {
                    novoInicio = toLocalDateStr(
                      new Date(hoje.getFullYear(), 0, 1),
                    );
                  } else if (val === 'lastYear') {
                    novoInicio = toLocalDateStr(
                      new Date(hoje.getFullYear() - 1, 0, 1),
                    );
                    const fimAnoPassado = new Date(
                      hoje.getFullYear() - 1,
                      11,
                      31,
                    );
                    setDataFim(toLocalDateStr(fimAnoPassado));
                    setDataInicio(novoInicio);
                    return;
                  } else {
                    const meses = parseInt(val) || 3;
                    const d = new Date(
                      hoje.getFullYear(),
                      hoje.getMonth() - meses + 1,
                      1,
                    );
                    novoInicio = toLocalDateStr(d);
                  }
                  setDataInicio(novoInicio);
                  setDataFim(hojeStr);
                }}
                disabled={erpLoading}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-[#000638] disabled:opacity-50"
                title="Período de histórico para ERP"
              >
                <option value="thisWeek">Esta semana</option>
                <option value="lastWeek">Semana passada</option>
                <option value="7d">7 dias</option>
                <option value="15d">15 dias</option>
                <option value="thisMonth">Este mês</option>
                <option value="lastMonth">Último mês</option>
                <option value="3">3 meses</option>
                <option value="6">6 meses</option>
                <option value="12">12 meses</option>
                <option value="thisYear">Este ano</option>
                <option value="lastYear">Ano passado</option>
              </select>
              <button
                onClick={() => carregarERP(true, 12)}
                disabled={erpLoading}
                className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-[#000638] px-3 py-1.5 rounded-lg border border-gray-200 hover:border-[#000638]/30 hover:bg-[#000638]/5 disabled:opacity-50 transition-colors"
                title="Atualizar ERP (TOTVS)"
              >
                {erpLoading ? (
                  <Spinner size={13} className="animate-spin" />
                ) : (
                  <Database size={13} />
                )}
                {erpLoading
                  ? erpProgress?.step
                    ? `Carregando: ${erpProgress.step}${erpProgress.total > 0 ? ` (${erpProgress.page}/${erpProgress.total})` : ''}`
                    : 'Carregando ERP...'
                  : 'ERP TOTVS'}
                {erpData && !erpLoading && (
                  <span className="text-[10px] text-gray-400">
                    {erpData.totalClientes?.toLocaleString('pt-BR')}c ·{' '}
                    {erpData.totalTransacoes?.toLocaleString('pt-BR')}tx
                  </span>
                )}
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0 pb-4 px-4">
          {/* Tabs + filtros de data — escondidos no Painel Geral (modo neutro) */}
          {tab !== 'painel' && (
            <div className="flex items-center justify-between flex-wrap gap-3 border-t border-gray-100 pt-3">
              <div className="flex items-center gap-0.5 -mb-px">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`relative px-3 py-2 text-xs font-semibold transition-colors ${
                      tab === t.key
                        ? 'text-[#000638] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#000638] after:rounded-full'
                        : 'text-gray-500 hover:text-[#000638]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={dataInicio}
                  onChange={(e) => setDataInicio(e.target.value)}
                  className="text-xs border border-[#000638]/30 rounded-lg px-2 py-1.5 text-gray-700 bg-[#f8f9fb] focus:outline-none focus:ring-2 focus:ring-[#000638]/20"
                />
                <span className="text-gray-300 text-xs">—</span>
                <input
                  type="date"
                  value={dataFim}
                  onChange={(e) => setDataFim(e.target.value)}
                  className="text-xs border border-[#000638]/30 rounded-lg px-2 py-1.5 text-gray-700 bg-[#f8f9fb] focus:outline-none focus:ring-2 focus:ring-[#000638]/20"
                />
                <button
                  onClick={() => {
                    carregarLeads();
                    if (tab === 'performance') carregarSellersTotals();
                  }}
                  disabled={loading || !dataInicio || !dataFim}
                  className="flex items-center gap-1.5 bg-[#000638] hover:bg-[#fe0000] text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {loading ? (
                    <Spinner size={12} className="animate-spin" />
                  ) : (
                    <MagnifyingGlass size={12} />
                  )}
                  Pesquisar
                </button>
              </div>
            </div>
          )}

          {/* Sub-tabs CRM Abertura */}
          {tab === 'abertura' && (
            <div className="flex items-center gap-1 mt-2">
              {SUB_TABS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSubTab(s.key)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    subTab === s.key
                      ? 'bg-[#000638]/10 text-[#000638]'
                      : 'text-gray-500 hover:text-[#000638] hover:bg-[#000638]/5'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Erro */}
          {erro && (
            <div className="mt-3 bg-red-50 border border-red-100 text-red-600 px-3 py-2 rounded-lg text-xs">
              {erro}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ LOADING ═══════════════════════════════════════════════════════ */}
      {/* Painel Geral tem seu próprio loading — não bloqueia aqui */}
      {loading && !data && tab !== 'painel' && (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Spinner size={20} className="animate-spin" />
          <span className="text-xs">Carregando...</span>
        </div>
      )}

      {/* ═══ CONTEÚDO ══════════════════════════════════════════════════════ */}
      <div className="min-h-[400px]">
        <Suspense fallback={<LazyFallback />}>
          {tab === 'painel' && <PainelGeral />}
          {tab === 'abertura' && subTab === 'funil' && (
            <FunilView
              data={data}
              modulo={modulo}
              phoneStatus={phoneStatus}
              onChatLead={onChatLead}
              onChatCloser={onChatCloser}
              onAnalise={onAnalise}
              vendedoresMap={vendedoresMap}
            />
          )}
          {tab === 'abertura' && subTab === 'roubar' && (
            <RoubarLeads
              modulo={modulo}
              onChatLead={onChatLead}
              data={data}
              vendedoresMap={vendedoresMap}
              onRefreshLeads={carregarLeads}
            />
          )}
          {tab === 'abertura' && subTab === 'canal' && (
            <CanalErrado
              data={data}
              modulo={modulo}
              phoneStatus={phoneStatus}
              onChatLead={onChatLead}
            />
          )}
          {tab === 'carteira' && (
            <CarteiraView
              erpData={erpData}
              modulo={modulo}
              onChatLead={onChatLead}
              oportunidadesMap={oportunidadesMap}
              vendedoresMap={vendedoresMap}
              erpLoading={erpLoading}
              erpProgress={erpProgress}
            />
          )}
          {tab === 'lead-gen' && (
            <LeadGeneration
              erpData={erpData}
              modulo={modulo}
              vendedoresMap={vendedoresMap}
              onChatLead={onChatLead}
            />
          )}
          {tab === 'performance' && (
            <PerformanceView
              erpData={erpData}
              modulo={modulo}
              vendedoresMap={vendedoresMap}
              sellersTotals={sellersTotals}
              sellersTotalsGlobal={sellersTotalsGlobal}
              fatSegmentos={fatSegmentos}
              branchesTotals={branchesTotals}
              canalTotals={canalTotals}
              sellersTotalsLoading={sellersTotalsLoading}
              onRefreshSellers={carregarSellersTotals}
              periodoLabel={`${dataInicio?.split('-').reverse().join('/')} — ${dataFim?.split('-').reverse().join('/')}`}
              dataInicio={dataInicio}
              dataFim={dataFim}
            />
          )}
          {tab === 'contato' && (
            <UltimoContatoView
              data={data}
              modulo={modulo}
              phoneStatus={phoneStatus}
              onChatLead={onChatLead}
            />
          )}
          {tab === 'turno' && (
            <TurnoView
              data={data}
              modulo={modulo}
              phoneStatus={phoneStatus}
              vendedoresMap={vendedoresMap}
            />
          )}
          {tab === 'conversao' && <ConversaoView modulo={modulo} />}
          {tab === 'analytics' && (
            <AnalyticsView
              dataInicio={dataInicio}
              dataFim={dataFim}
              modulo={modulo}
            />
          )}
        </Suspense>
      </div>

      {/* ═══ CHAT PANEL ════════════════════════════════════════════════════ */}
      <Suspense fallback={null}>
        <ChatPanel
          open={chatOpen}
          tel={chatTel}
          nome={chatNome}
          defaultInst={chatInst}
          defaultProvider={chatProvider}
          instancias={chatInstancias}
          onClose={() => setChatOpen(false)}
        />
      </Suspense>
    </div>
  );
}
