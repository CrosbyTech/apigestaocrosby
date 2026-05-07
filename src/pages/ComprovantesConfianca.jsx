import React, { useState, useEffect, useMemo } from 'react';
import { supabaseAdmin } from '../lib/supabase';
import { useAuth } from '../components/AuthContext';
import PageTitle from '../components/ui/PageTitle';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import {
  Receipt,
  CheckCircle,
  Eye,
  Spinner,
  X,
  Funnel,
  CurrencyDollar,
  FileArrowDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  CaretDown,
  CaretUpDown,
  Image,
  FileText,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  MagnifyingGlass,
  CalendarBlank,
  UploadSimple,
  Trash,
  Check,
  Warning,
  Paperclip,
  DownloadSimple,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const ComprovantesAntecipacao = () => {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(['owner', 'admin']);

  const [solicitacoes, setSolicitacoes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [removendo, setRemovendo] = useState(null);
  const [marcandoBaixa, setMarcandoBaixa] = useState(null);
  const [confirmarRemocao, setConfirmarRemocao] = useState(null);
  const [uploadingAnexo, setUploadingAnexo] = useState(null);

  // Filtros
  const [filtroNome, setFiltroNome] = useState('');
  const [periodo, setPeriodo] = useState({ dt_inicio: '', dt_fim: '' });

  // Paginação
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina] = useState(20);

  // Ordenação
  const [ordenacao, setOrdenacao] = useState({
    campo: 'processado_em',
    direcao: 'desc',
  });

  // Modal comprovante
  const [modalComprovante, setModalComprovante] = useState(null);
  const [zoomImagem, setZoomImagem] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Batida Antecipação
  const [dadosBatida, setDadosBatida] = useState([]);
  const [batidaCarregada, setBatidaCarregada] = useState(false);
  const [loadingBatida, setLoadingBatida] = useState(false);

  const formatarMoeda = (valor) => {
    return (parseFloat(valor) || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  const formatarDataHora = (isoDate) => {
    if (!isoDate) return '--';
    try {
      const str = String(isoDate);
      const [datePart, timePart] = str.split('T');
      const [y, m, d] = datePart.split('-');
      if (!y || !m || !d) return '--';
      const data = `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
      if (timePart) {
        const [h, min] = timePart.split(':');
        return `${data}, ${h}:${min}`;
      }
      return data;
    } catch {
      return '--';
    }
  };

  const formatarData = (isoDate) => {
    if (!isoDate) return '--';
    try {
      const [datePart] = String(isoDate).split('T');
      const [y, m, d] = datePart.split('-');
      if (!y || !m || !d) return '--';
      return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    } catch {
      return '--';
    }
  };

  // CSS
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .extrato-table { border-collapse: collapse; width: 100%; }
      .extrato-table th, .extrato-table td { padding: 6px 8px !important; border-right: 1px solid #f3f4f6; font-size: 12px; line-height: 1.4; }
      .extrato-table th:last-child, .extrato-table td:last-child { border-right: none; }
      .extrato-table th { background-color: #000638; color: white; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
      .extrato-table tbody tr:nth-child(odd) { background-color: white; }
      .extrato-table tbody tr:nth-child(even) { background-color: #f9fafb; }
      .extrato-table tbody tr:hover { background-color: #f3f4f6; }
    `;
    document.head.appendChild(styleElement);
    return () => document.head.removeChild(styleElement);
  }, []);

  // Inicializar período (mês atual)
  useEffect(() => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
      .toISOString()
      .split('T')[0];
    setPeriodo({ dt_inicio: primeiroDia, dt_fim: ultimoDia });
  }, []);

  // Carregar dados
  const carregarDados = async () => {
    setLoading(true);
    setPaginaAtual(1);
    try {
      let query = supabaseAdmin
        .from('solicitacoes_baixa')
        .select('*')
        .eq('status', 'processada')
        .eq('forma_pagamento', 'confianca')
        .order('processado_em', { ascending: false });

      if (periodo.dt_inicio) {
        query = query.gte('processado_em', `${periodo.dt_inicio}T00:00:00`);
      }
      if (periodo.dt_fim) {
        query = query.lte('processado_em', `${periodo.dt_fim}T23:59:59`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setSolicitacoes(data || []);
      setDadosCarregados(true);
    } catch (error) {
      setSolicitacoes([]);
      setDadosCarregados(true);
    } finally {
      setLoading(false);
    }
  };

  const handleFiltrar = (e) => {
    e.preventDefault();
    carregarDados();
  };

  // Filtro por nome e ordenação
  const dadosProcessados = useMemo(() => {
    let filtrados = [...solicitacoes];

    if (filtroNome.trim()) {
      const termo = filtroNome.trim().toLowerCase();
      filtrados = filtrados.filter(
        (s) =>
          (s.nm_cliente || '').toLowerCase().includes(termo) ||
          (s.nr_fat || '').toString().includes(termo),
      );
    }

    if (ordenacao.campo) {
      filtrados.sort((a, b) => {
        let valorA = a[ordenacao.campo];
        let valorB = b[ordenacao.campo];
        if (['vl_fatura'].includes(ordenacao.campo)) {
          valorA = parseFloat(valorA) || 0;
          valorB = parseFloat(valorB) || 0;
        }
        if (
          [
            'processado_em',
            'created_at',
            'dt_pagamento',
            'dt_emissao',
            'dt_vencimento',
          ].includes(ordenacao.campo)
        ) {
          valorA = valorA || '';
          valorB = valorB || '';
        }
        if (typeof valorA === 'string') {
          valorA = valorA.toLowerCase();
          valorB = (valorB || '').toLowerCase();
        }
        if (valorA < valorB) return ordenacao.direcao === 'asc' ? -1 : 1;
        if (valorA > valorB) return ordenacao.direcao === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return filtrados;
  }, [solicitacoes, filtroNome, ordenacao]);

  const dadosPaginados = useMemo(() => {
    const startIndex = (paginaAtual - 1) * itensPorPagina;
    return dadosProcessados.slice(startIndex, startIndex + itensPorPagina);
  }, [dadosProcessados, paginaAtual, itensPorPagina]);

  const totalPages = Math.ceil(dadosProcessados.length / itensPorPagina);

  const handleSort = (campo) => {
    setOrdenacao((prev) => ({
      campo,
      direcao: prev.campo === campo && prev.direcao === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getSortIcon = (campo) => {
    if (ordenacao.campo !== campo)
      return <CaretUpDown size={12} className="opacity-50" />;
    return ordenacao.direcao === 'asc' ? (
      <CaretUp size={12} />
    ) : (
      <CaretDown size={12} />
    );
  };

  // Totais
  const totais = useMemo(() => {
    const valorTotal = dadosProcessados.reduce(
      (acc, item) => acc + (parseFloat(item.vl_fatura) || 0),
      0,
    );
    return { valorTotal, quantidade: dadosProcessados.length };
  }, [dadosProcessados]);

  // Exportar Excel
  const handleExportExcel = () => {
    if (dadosProcessados.length === 0) {
      alert('Não há dados para exportar!');
      return;
    }
    try {
      const dadosParaExportar = dadosProcessados.map((item) => {
        const obj = {
          Cliente: item.nm_cliente || '',
          'Cód. Cliente': item.cd_cliente || '',
          Fatura: item.nr_fat || '',
          Parcela: item.nr_parcela || '',
          'Valor Fatura': parseFloat(item.vl_fatura) || 0,
          'Dt. Emissão': formatarData(item.dt_emissao),
          'Dt. Vencimento': formatarData(item.dt_vencimento),
          'Forma Pagamento': 'Antecipação',
          'Data Pagamento': formatarData(item.dt_pagamento),
        };
        if (batidaCarregada) {
          const tipo = mapaBatida[item.id];
          obj['Batida'] =
            tipo === 'EM_ABERTO'
              ? 'EM ABERTO'
              : tipo === 'RECOMPRA'
                ? 'RECOMPRA'
                : tipo === 'ENCONTRADO'
                  ? 'ENCONTRADO'
                  : '';
        }
        return obj;
      });
      const ws = XLSX.utils.json_to_sheet(dadosParaExportar);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Comprovantes Antecipação');
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const data = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      saveAs(data, `comprovantes-antecipacao-${hoje}.xlsx`);
    } catch (error) {
      alert('Erro ao exportar arquivo Excel.');
    }
  };

  // Paginação
  const irParaPagina = (pagina) => setPaginaAtual(pagina);
  const paginaAnterior = () => {
    if (paginaAtual > 1) setPaginaAtual(paginaAtual - 1);
  };
  const proximaPagina = () => {
    if (paginaAtual < totalPages) setPaginaAtual(paginaAtual + 1);
  };

  useEffect(() => {
    setPaginaAtual(1);
  }, [solicitacoes, ordenacao, filtroNome]);

  const gerarPaginas = () => {
    const totalPaginas = Math.ceil(dadosProcessados.length / itensPorPagina);
    const paginas = [];
    const maxPaginasVisiveis = 5;
    if (totalPaginas <= maxPaginasVisiveis) {
      for (let i = 1; i <= totalPaginas; i++) paginas.push(i);
    } else {
      if (paginaAtual <= 3) {
        for (let i = 1; i <= 4; i++) paginas.push(i);
        paginas.push('...');
        paginas.push(totalPaginas);
      } else if (paginaAtual >= totalPaginas - 2) {
        paginas.push(1);
        paginas.push('...');
        for (let i = totalPaginas - 3; i <= totalPaginas; i++) paginas.push(i);
      } else {
        paginas.push(1);
        paginas.push('...');
        for (let i = paginaAtual - 1; i <= paginaAtual + 1; i++)
          paginas.push(i);
        paginas.push('...');
        paginas.push(totalPaginas);
      }
    }
    return paginas;
  };

  // ==================== BATIDA ANTECIPAÇÃO ====================

  const normalizarNomeCliente = (nome) => {
    if (!nome) return '';
    return String(nome)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[0-9]/g, '')
      .replace(/[^A-Z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const normalizarValor = (valor) => {
    return (parseFloat(valor) || 0).toFixed(2);
  };

  const parseDateNoTZ = (isoDate) => {
    if (!isoDate) return null;
    try {
      const [datePart] = String(isoDate).split('T');
      const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10));
      if (!y || !m || !d) return null;
      return new Date(y, m - 1, d);
    } catch {
      return null;
    }
  };

  const normalizarData = (data) => {
    if (!data) return '';
    const d = parseDateNoTZ(data);
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const parseDataBR = (dataBR) => {
    if (!dataBR) return null;
    const parts = dataBR.split('/');
    if (parts.length !== 3) return null;
    const [dia, mes, ano] = parts;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  };

  const parseValorBR = (valorStr) => {
    if (!valorStr) return 0;
    const valorLimpo = valorStr.replace(/\./g, '').replace(',', '.');
    const valor = parseFloat(valorLimpo);
    return isNaN(valor) ? 0 : valor;
  };

  const parseCSVConfianca = (csvContent) => {
    const lines = csvContent.split('\n');
    if (lines.length < 2) return [];

    const header = lines[0]
      .split(';')
      .map((col) => col.trim().replace(/"/g, ''));
    const columnIndex = {};
    header.forEach((col, idx) => {
      columnIndex[col] = idx;
    });

    const getValue = (values, colName) => {
      const idx = columnIndex[colName];
      return idx !== undefined ? values[idx] : null;
    };

    // Detectar tipo
    const isAberto =
      header.includes('DIAS_ATRA') || header.includes('caVALO_ATUA');

    const registros = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const values = line.split(';').map((val) => val.trim().replace(/"/g, ''));

      const numeDoct = getValue(values, 'NUME_DOCT') || '';
      const [nrFatura, nrParcela] = numeDoct.split('/');
      const sacaId = getValue(values, 'SACA_ID');
      let cpfCnpj = sacaId ? sacaId.replace(/\D/g, '') : '';

      const situacao = (getValue(values, 'SITUACAO') || '').toUpperCase();
      const tipoCart = (getValue(values, 'TIPO_CART') || '').toUpperCase();

      // Classificar: EM_ABERTO ou RECOMPRA
      let classificacao = 'ENCONTRADO';
      if (tipoCart.includes('RECOMPRA')) {
        classificacao = 'RECOMPRA';
      } else if (isAberto || ['COBRANCA', 'A ENVIAR'].includes(situacao)) {
        classificacao = 'EM_ABERTO';
      } else if (situacao === 'BAIXADO') {
        classificacao = 'RECOMPRA';
      }

      registros.push({
        nome: (getValue(values, 'NOME') || '').trim(),
        nomeNormalizado: normalizarNomeCliente(getValue(values, 'NOME')),
        vl_original: parseValorBR(getValue(values, 'VALO_TITU_ORIG')),
        dt_vencimento: parseDataBR(getValue(values, 'DATA_TITU')),
        nr_fatura: nrFatura || numeDoct,
        nr_parcela: nrParcela || '001',
        cpfCnpj,
        situacao,
        tipoCart,
        classificacao,
      });
    }
    return registros;
  };

  const handleUploadBatida = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadingBatida(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target.result;
        const registros = parseCSVConfianca(content);
        setDadosBatida(registros);
        setBatidaCarregada(true);
      } catch (err) {
        alert('Erro ao processar o arquivo CSV. Verifique o formato.');
      } finally {
        setLoadingBatida(false);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const limparBatida = () => {
    setDadosBatida([]);
    setBatidaCarregada(false);
  };

  // Mapa de matching: para cada solicitação, verifica se existe na planilha
  const mapaBatida = useMemo(() => {
    if (!batidaCarregada || dadosBatida.length === 0) return {};

    // Criar mapa de chaves da planilha CSV
    const chavesPlanilha = new Map();
    dadosBatida.forEach((item) => {
      const chave = `${item.nomeNormalizado}|${normalizarValor(item.vl_original)}|${normalizarData(item.dt_vencimento)}`;
      chavesPlanilha.set(chave, item);
    });

    // Para cada solicitação, verificar match
    const mapa = {};
    solicitacoes.forEach((sol) => {
      const valorComTaxa = (parseFloat(sol.vl_fatura) || 0) + 0.98;
      const nomeNorm = normalizarNomeCliente(sol.nm_cliente);
      const valorNorm = normalizarValor(valorComTaxa);
      const dataNorm = normalizarData(sol.dt_vencimento);
      const chave = `${nomeNorm}|${valorNorm}|${dataNorm}`;

      const match = chavesPlanilha.get(chave);
      if (match) {
        mapa[sol.id] = match.classificacao;
      }
    });

    return mapa;
  }, [batidaCarregada, dadosBatida, solicitacoes]);

  // Contadores da batida
  const contadoresBatida = useMemo(() => {
    const vals = Object.values(mapaBatida);
    return {
      emAberto: vals.filter((v) => v === 'EM_ABERTO').length,
      recompra: vals.filter((v) => v === 'RECOMPRA').length,
      encontrados: vals.filter((v) => v === 'ENCONTRADO').length,
      total: vals.length,
    };
  }, [mapaBatida]);

  const getRowBatidaStyle = (solId) => {
    const tipo = mapaBatida[solId];
    if (tipo === 'EM_ABERTO') return { backgroundColor: '#FEF9C3' }; // amarelo
    if (tipo === 'RECOMPRA') return { backgroundColor: '#BBF7D0' }; // verde
    if (tipo === 'ENCONTRADO') return { backgroundColor: '#DBEAFE' }; // azul claro
    return {};
  };

  // ==================== REMOVER TÍTULO (ADMIN) ====================
  const handleRemover = async (solId) => {
    setRemovendo(solId);
    try {
      const { error } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .delete()
        .eq('id', solId);
      if (error) throw error;
      setSolicitacoes((prev) => prev.filter((s) => s.id !== solId));
    } catch (err) {
      alert('Erro ao remover título.');
    } finally {
      setRemovendo(null);
      setConfirmarRemocao(null);
    }
  };

  // ==================== UPLOAD ANEXO ====================
  const BUCKET_ANEXOS = 'anexos_baixa';
  const TIPOS_PERMITIDOS = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const handleUploadAnexo = async (e, sol) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!TIPOS_PERMITIDOS.includes(file.type)) {
      alert('Tipo de arquivo não permitido. Use imagem, PDF ou DOCX.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      alert('Arquivo muito grande. Máximo 10MB.');
      e.target.value = '';
      return;
    }

    setUploadingAnexo(sol.id);
    try {
      // Remover anexo anterior se existir
      if (sol.anexo_path) {
        await supabaseAdmin.storage
          .from(BUCKET_ANEXOS)
          .remove([sol.anexo_path]);
      }

      const uid = crypto.randomUUID?.() || String(Date.now());
      const ext = file.name.split('.').pop();
      const safeName = file.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `anexos/${sol.id}/${uid}_${safeName}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET_ANEXOS)
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabaseAdmin.storage
        .from(BUCKET_ANEXOS)
        .getPublicUrl(path);

      const { error: updateError } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .update({
          anexo_url: urlData.publicUrl,
          anexo_path: path,
          anexo_nome: file.name,
        })
        .eq('id', sol.id);
      if (updateError) throw updateError;

      setSolicitacoes((prev) =>
        prev.map((s) =>
          s.id === sol.id
            ? {
                ...s,
                anexo_url: urlData.publicUrl,
                anexo_path: path,
                anexo_nome: file.name,
              }
            : s,
        ),
      );
    } catch (err) {
      alert('Erro ao enviar anexo. Tente novamente.');
    } finally {
      setUploadingAnexo(null);
      e.target.value = '';
    }
  };

  const handleRemoverAnexo = async (sol) => {
    if (!confirm('Remover este anexo?')) return;
    setUploadingAnexo(sol.id);
    try {
      if (sol.anexo_path) {
        await supabaseAdmin.storage
          .from(BUCKET_ANEXOS)
          .remove([sol.anexo_path]);
      }
      const { error } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .update({ anexo_url: null, anexo_path: null, anexo_nome: null })
        .eq('id', sol.id);
      if (error) throw error;
      setSolicitacoes((prev) =>
        prev.map((s) =>
          s.id === sol.id
            ? { ...s, anexo_url: null, anexo_path: null, anexo_nome: null }
            : s,
        ),
      );
    } catch (err) {
      alert('Erro ao remover anexo.');
    } finally {
      setUploadingAnexo(null);
    }
  };

  // ==================== MARCAR BAIXA ====================
  const handleMarcarBaixa = async (sol) => {
    const novaBaixa = !sol.baixa_confirmada;
    setMarcandoBaixa(sol.id);
    try {
      const { error } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .update({
          baixa_confirmada: novaBaixa,
          baixa_confirmada_em: novaBaixa ? new Date().toISOString() : null,
          baixa_confirmada_por: novaBaixa
            ? user?.name || user?.email || 'Usuário'
            : null,
        })
        .eq('id', sol.id);
      if (error) throw error;
      setSolicitacoes((prev) =>
        prev.map((s) =>
          s.id === sol.id
            ? {
                ...s,
                baixa_confirmada: novaBaixa,
                baixa_confirmada_em: novaBaixa
                  ? new Date().toISOString()
                  : null,
                baixa_confirmada_por: novaBaixa
                  ? user?.name || user?.email || 'Usuário'
                  : null,
              }
            : s,
        ),
      );
    } catch (err) {
      alert('Erro ao marcar baixa.');
    } finally {
      setMarcandoBaixa(null);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Comprovantes - Antecipação"
        subtitle="Solicitações de baixa processadas via Antecipação"
        icon={Receipt}
        iconColor="text-amber-600"
      />

      {/* Filtros */}
      <div className="mb-4">
        <form
          onSubmit={handleFiltrar}
          className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full max-w-7xl mx-auto border border-[#000638]/10"
        >
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" /> Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Selecione o período e clique em "Buscar"
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Buscar por Nome / Fatura
              </label>
              <input
                type="text"
                value={filtroNome}
                onChange={(e) => setFiltroNome(e.target.value)}
                placeholder="Filtrar por nome ou nº fatura..."
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Início
              </label>
              <input
                type="date"
                value={periodo.dt_inicio}
                onChange={(e) =>
                  setPeriodo((prev) => ({ ...prev, dt_inicio: e.target.value }))
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Fim
              </label>
              <input
                type="date"
                value={periodo.dt_fim}
                onChange={(e) =>
                  setPeriodo((prev) => ({ ...prev, dt_fim: e.target.value }))
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div className="flex items-center gap-2 mt-6 sm:mt-0">
              <button
                type="submit"
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Spinner size={10} className="animate-spin" />
                    <span>Carregando...</span>
                  </>
                ) : (
                  <>
                    <MagnifyingGlass size={10} />
                    <span>Buscar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Batida Antecipação - Upload */}
      <div className="mb-4">
        <div className="bg-white p-3 rounded-lg shadow-md w-full max-w-7xl mx-auto border border-[#000638]/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <UploadSimple size={18} weight="bold" /> Batida Antecipação
            </span>
            {batidaCarregada && (
              <button
                onClick={limparBatida}
                className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 font-medium"
              >
                <Trash size={12} /> Limpar Batida
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Importe o CSV da Antecipação (BATIDACONFIANCA) para comparar com os
            comprovantes. Títulos encontrados serão destacados na tabela.
          </p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1.5 rounded-lg hover:bg-[#fe0000] transition-colors cursor-pointer text-xs font-bold shadow-md tracking-wide uppercase">
              <UploadSimple size={12} />
              {loadingBatida ? 'Processando...' : 'Importar CSV'}
              <input
                type="file"
                accept=".csv"
                onChange={handleUploadBatida}
                className="hidden"
                disabled={loadingBatida}
              />
            </label>
            {batidaCarregada && (
              <span className="text-xs text-gray-600">
                {dadosBatida.length} registros importados da planilha
              </span>
            )}
          </div>

          {/* Legenda e contadores */}
          {batidaCarregada && (
            <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-gray-200 pt-3">
              <div className="flex items-center gap-1.5">
                <div
                  className="w-4 h-4 rounded"
                  style={{
                    backgroundColor: '#FEF9C3',
                    border: '1px solid #EAB308',
                  }}
                />
                <span className="text-xs font-medium text-gray-700">
                  EM ABERTO ({contadoresBatida.emAberto})
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div
                  className="w-4 h-4 rounded"
                  style={{
                    backgroundColor: '#BBF7D0',
                    border: '1px solid #22C55E',
                  }}
                />
                <span className="text-xs font-medium text-gray-700">
                  RECOMPRA ({contadoresBatida.recompra})
                </span>
              </div>
              <div className="text-xs font-bold text-[#000638] ml-auto">
                Total encontrados: {contadoresBatida.total} de{' '}
                {dadosProcessados.length}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cards */}
      {dadosProcessados.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6 max-w-7xl mx-auto">
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-green-600" />
                <CardTitle className="text-xs font-bold text-green-700">
                  Valor Total
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-green-600 mb-0.5 break-words">
                {formatarMoeda(totais.valorTotal)}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Soma dos comprovantes
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CheckCircle size={14} className="text-blue-600" />
                <CardTitle className="text-xs font-bold text-blue-700">
                  Quantidade
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-blue-600 mb-0.5 break-words">
                {totais.quantidade}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Total de comprovantes
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white rounded-lg shadow-md border border-[#000638]/10 max-w-7xl mx-auto w-full">
        <div className="p-3 border-b border-[#000638]/10 flex justify-between items-center">
          <h2 className="text-sm font-bold text-[#000638] font-barlow">
            Comprovantes - Antecipação
          </h2>
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-600">
              {dadosCarregados
                ? `${dadosProcessados.length} registros encontrados`
                : 'Nenhum dado carregado'}
            </div>
            {dadosProcessados.length > 0 && (
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-1 bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 transition-colors font-medium text-xs"
              >
                <FileArrowDown size={12} /> BAIXAR EXCEL
              </button>
            )}
          </div>
        </div>

        <div className="p-3">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="flex items-center gap-3">
                <Spinner size={18} className="animate-spin text-blue-600" />
                <span className="text-sm text-gray-600">
                  Carregando dados...
                </span>
              </div>
            </div>
          ) : !dadosCarregados ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="text-gray-500 text-sm mb-2">
                  Clique em "Buscar" para carregar os comprovantes
                </div>
                <div className="text-gray-400 text-xs">
                  Selecione o período desejado
                </div>
              </div>
            </div>
          ) : dadosProcessados.length === 0 ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="text-gray-500 text-sm mb-2">
                  Nenhum comprovante encontrado
                </div>
                <div className="text-gray-400 text-xs">
                  Verifique os filtros selecionados ou tente novamente
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-[350px] md:max-w-[700px] lg:max-w-[900px] xl:max-w-[1100px] 2xl:max-w-[1300px] mx-auto overflow-x-auto">
              <table className="border-collapse rounded-lg overflow-hidden shadow-lg extrato-table">
                <thead className="bg-[#000638] text-white text-sm uppercase tracking-wider">
                  <tr>
                    <th
                      className="px-2 py-2 text-left cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('nm_cliente')}
                    >
                      <div className="flex items-center">
                        Cliente{getSortIcon('nm_cliente')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('nr_fat')}
                    >
                      <div className="flex items-center justify-center">
                        Fatura{getSortIcon('nr_fat')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('nr_parcela')}
                    >
                      <div className="flex items-center justify-center">
                        Parcela{getSortIcon('nr_parcela')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('vl_fatura')}
                    >
                      <div className="flex items-center justify-center">
                        Valor{getSortIcon('vl_fatura')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('dt_emissao')}
                    >
                      <div className="flex items-center justify-center">
                        Dt. Emissão{getSortIcon('dt_emissao')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('dt_vencimento')}
                    >
                      <div className="flex items-center justify-center">
                        Dt. Vencimento{getSortIcon('dt_vencimento')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('dt_pagamento')}
                    >
                      <div className="flex items-center justify-center">
                        Dt. Pagamento{getSortIcon('dt_pagamento')}
                      </div>
                    </th>
                    <th className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center">
                        Comprovante
                      </div>
                    </th>
                    <th className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center">
                        Anexo
                      </div>
                    </th>
                    <th className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center">
                        Baixa
                      </div>
                    </th>
                    {batidaCarregada && (
                      <th className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center">
                          Batida
                        </div>
                      </th>
                    )}
                    {isAdmin && (
                      <th className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center">
                          Ações
                        </div>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {dadosPaginados.map((sol, index) => (
                    <tr
                      key={sol.id || index}
                      className="text-sm transition-colors"
                      style={getRowBatidaStyle(sol.id)}
                    >
                      <td className="text-left text-gray-900 px-2 py-2">
                        {sol.nm_cliente || '--'}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {sol.nr_fat || '--'}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {sol.nr_parcela || '--'}
                      </td>
                      <td className="text-center font-semibold text-green-600 px-2 py-2">
                        {formatarMoeda(sol.vl_fatura)}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {formatarData(sol.dt_emissao)}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {formatarData(sol.dt_vencimento)}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {formatarData(sol.dt_pagamento)}
                      </td>
                      <td className="text-center px-2 py-2">
                        {sol.comprovante_url ? (
                          <button
                            onClick={() => setModalComprovante(sol)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-indigo-700 bg-indigo-50 rounded hover:bg-indigo-100 transition-colors mx-auto"
                          >
                            <Eye size={12} /> Ver
                          </button>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="text-center px-2 py-2">
                        {uploadingAnexo === sol.id ? (
                          <Spinner
                            size={12}
                            className="animate-spin text-blue-600 mx-auto"
                          />
                        ) : sol.anexo_url ? (
                          <div className="inline-flex items-center gap-1">
                            <a
                              href={sol.anexo_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-bold text-blue-700 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                              title={sol.anexo_nome || 'Anexo'}
                            >
                              <DownloadSimple size={10} />
                              <span className="max-w-[60px] truncate">
                                {sol.anexo_nome || 'Anexo'}
                              </span>
                            </a>
                            <button
                              onClick={() => handleRemoverAnexo(sol)}
                              className="p-0.5 text-red-500 hover:text-red-700 transition-colors"
                              title="Remover anexo"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ) : (
                          <label className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-gray-500 bg-gray-50 rounded hover:bg-gray-100 transition-colors cursor-pointer mx-auto border border-dashed border-gray-300">
                            <Paperclip size={12} />
                            <span className="text-[10px]">Anexar</span>
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx"
                              onChange={(e) => handleUploadAnexo(e, sol)}
                              className="hidden"
                            />
                          </label>
                        )}
                      </td>
                      <td className="text-center px-2 py-2">
                        <button
                          onClick={() => handleMarcarBaixa(sol)}
                          disabled={marcandoBaixa === sol.id}
                          className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded transition-colors mx-auto ${
                            sol.baixa_confirmada
                              ? 'text-green-700 bg-green-100 hover:bg-green-200 border border-green-300'
                              : 'text-gray-500 bg-gray-100 hover:bg-gray-200 border border-gray-300'
                          }`}
                          title={
                            sol.baixa_confirmada
                              ? `Baixa confirmada por ${sol.baixa_confirmada_por || '?'} em ${formatarDataHora(sol.baixa_confirmada_em)}`
                              : 'Marcar como baixa confirmada'
                          }
                        >
                          {marcandoBaixa === sol.id ? (
                            <Spinner size={12} className="animate-spin" />
                          ) : sol.baixa_confirmada ? (
                            <>
                              <Check size={12} weight="bold" /> Baixa
                            </>
                          ) : (
                            <>
                              <CheckCircle size={12} /> Dar Baixa
                            </>
                          )}
                        </button>
                      </td>
                      {batidaCarregada && (
                        <td className="text-center px-2 py-2">
                          {mapaBatida[sol.id] === 'EM_ABERTO' && (
                            <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-yellow-200 text-yellow-800 border border-yellow-400">
                              EM ABERTO
                            </span>
                          )}
                          {mapaBatida[sol.id] === 'RECOMPRA' && (
                            <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-green-200 text-green-800 border border-green-400">
                              RECOMPRA
                            </span>
                          )}
                          {mapaBatida[sol.id] === 'ENCONTRADO' && (
                            <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-200 text-blue-800 border border-blue-400">
                              ENCONTRADO
                            </span>
                          )}
                          {!mapaBatida[sol.id] && (
                            <span className="text-[10px] text-gray-400">—</span>
                          )}
                        </td>
                      )}
                      {isAdmin && (
                        <td className="text-center px-2 py-2">
                          {confirmarRemocao === sol.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={() => handleRemover(sol.id)}
                                disabled={removendo === sol.id}
                                className="inline-flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-bold text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
                              >
                                {removendo === sol.id ? (
                                  <Spinner size={10} className="animate-spin" />
                                ) : (
                                  <>Confirmar</>
                                )}
                              </button>
                              <button
                                onClick={() => setConfirmarRemocao(null)}
                                className="inline-flex items-center px-1.5 py-1 text-[10px] font-bold text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmarRemocao(sol.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors mx-auto"
                              title="Remover título"
                            >
                              <Trash size={12} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 text-center text-sm text-gray-600">
                Total de {dadosProcessados.length} registros
              </div>

              {/* Paginação */}
              {dadosProcessados.length > itensPorPagina && (
                <div className="flex flex-col sm:flex-row justify-between items-center mt-6 pt-6 border-t border-gray-200">
                  <div className="text-sm text-gray-600 mb-4 sm:mb-0">
                    Mostrando {(paginaAtual - 1) * itensPorPagina + 1} a{' '}
                    {Math.min(
                      paginaAtual * itensPorPagina,
                      dadosProcessados.length,
                    )}{' '}
                    de {dadosProcessados.length} registros
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={paginaAnterior}
                      disabled={paginaAtual === 1}
                      className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <CaretLeft size={16} /> Anterior
                    </button>
                    <div className="flex items-center gap-1">
                      {gerarPaginas().map((pagina, index) => (
                        <button
                          key={index}
                          onClick={() =>
                            typeof pagina === 'number' && irParaPagina(pagina)
                          }
                          disabled={typeof pagina !== 'number'}
                          className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${pagina === paginaAtual ? 'bg-[#000638] text-white' : typeof pagina === 'number' ? 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50' : 'text-gray-400 cursor-default'}`}
                        >
                          {pagina}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={proximaPagina}
                      disabled={paginaAtual === totalPages}
                      className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Próximo <CaretRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal de Comprovante */}
      {modalComprovante && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4"
          style={{ zIndex: 99999 }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[#000638] text-white p-4 rounded-t-xl flex justify-between items-center">
              <h3 className="text-lg font-bold">
                Comprovante - Fatura {modalComprovante.nr_fat}
              </h3>
              <button
                onClick={() => {
                  setModalComprovante(null);
                  setZoomImagem(false);
                  setZoomLevel(1);
                }}
                className="text-white hover:text-red-300"
              >
                <X size={22} weight="bold" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">Cliente:</span>{' '}
                  <span className="font-semibold">
                    {modalComprovante.nm_cliente}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Fatura:</span>{' '}
                  <span className="font-semibold">
                    {modalComprovante.nr_fat}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Valor:</span>{' '}
                  <span className="font-bold text-red-600">
                    {formatarMoeda(modalComprovante.vl_fatura)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Portador:</span>{' '}
                  <span className="font-semibold">
                    {modalComprovante.nm_portador ||
                      modalComprovante.cd_portador ||
                      '--'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Data Pagamento:</span>{' '}
                  <span className="font-semibold">
                    {formatarData(modalComprovante.dt_pagamento)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Processado Em:</span>{' '}
                  <span className="font-semibold">
                    {formatarDataHora(modalComprovante.processado_em)}
                  </span>
                </div>
                {modalComprovante.processado_por && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Processado Por:</span>{' '}
                    <span className="font-semibold">
                      {modalComprovante.processado_por}
                    </span>
                  </div>
                )}
                {modalComprovante.observacao && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Observação:</span>{' '}
                    <span className="font-medium">
                      {modalComprovante.observacao}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex justify-center">
                {modalComprovante.comprovante_url?.match(
                  /\.(jpg|jpeg|png|gif|webp)/i,
                ) ? (
                  <div className="space-y-3 w-full">
                    {!zoomImagem ? (
                      <div
                        className="relative cursor-pointer"
                        onClick={() => {
                          setZoomImagem(true);
                          setZoomLevel(1);
                        }}
                      >
                        <img
                          src={modalComprovante.comprovante_url}
                          alt="Comprovante"
                          className="max-w-full max-h-[55vh] rounded-lg shadow-lg mx-auto hover:opacity-90 transition-opacity"
                        />
                        <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded">
                          <MagnifyingGlassPlus size={16} />
                        </div>
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <button
                            onClick={() =>
                              setZoomLevel((z) => Math.max(0.5, z - 0.25))
                            }
                            className="p-1 bg-gray-200 rounded hover:bg-gray-300"
                          >
                            <MagnifyingGlassMinus size={16} />
                          </button>
                          <span className="text-xs font-medium">
                            {Math.round(zoomLevel * 100)}%
                          </span>
                          <button
                            onClick={() =>
                              setZoomLevel((z) => Math.min(3, z + 0.25))
                            }
                            className="p-1 bg-gray-200 rounded hover:bg-gray-300"
                          >
                            <MagnifyingGlassPlus size={16} />
                          </button>
                          <button
                            onClick={() => setZoomImagem(false)}
                            className="p-1 bg-red-100 text-red-600 rounded hover:bg-red-200 ml-2"
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <div className="overflow-auto max-h-[65vh] border rounded-lg">
                          <img
                            src={modalComprovante.comprovante_url}
                            alt="Comprovante"
                            style={{
                              transform: `scale(${zoomLevel})`,
                              transformOrigin: 'top left',
                            }}
                            className="transition-transform duration-200"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : modalComprovante.comprovante_url?.match(/\.pdf/i) ? (
                  <div className="text-center space-y-3">
                    <FileText size={48} className="text-red-600 mx-auto" />
                    <p className="text-sm text-gray-600">
                      Comprovante em formato PDF
                    </p>
                    <a
                      href={modalComprovante.comprovante_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors text-sm"
                    >
                      <FileArrowDown size={16} /> Abrir PDF
                    </a>
                  </div>
                ) : modalComprovante.comprovante_url ? (
                  <div className="text-center space-y-3">
                    <Image size={48} className="text-gray-400 mx-auto" />
                    <a
                      href={modalComprovante.comprovante_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                      <Eye size={16} /> Abrir Comprovante
                    </a>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 text-center py-4">
                    Comprovante não disponível.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ComprovantesAntecipacao;
