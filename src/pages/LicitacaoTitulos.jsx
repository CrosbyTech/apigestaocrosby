import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../components/AuthContext';
import { supabase } from '../lib/supabase';
import ClientePerfilModal from '../components/ClientePerfilModal';
import { TotvsURL } from '../config/constants';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import PageTitle from '../components/ui/PageTitle';
import {
  Receipt,
  Spinner,
  CurrencyDollar,
  CaretLeft,
  CaretRight,
  CaretUp,
  CaretDown,
  CaretUpDown,
  FileArrowDown,
  Eye,
  FilePdf,
  X,
  ArrowRight,
  Gavel,
  CheckSquare,
  Square,
  PaperPlaneTilt,
  CheckCircle,
  UserCircle,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const LicitacaoTitulos = () => {
  const { user } = useAuth();
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);

  // Paginação
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina] = useState(20);

  // Ordenação
  const [ordenacao, setOrdenacao] = useState({
    campo: 'dt_vencimento',
    direcao: 'asc',
  });

  // Modal de detalhes
  const [obsModalAberto, setObsModalAberto] = useState(false);
  const [faturaSelecionada, setFaturaSelecionada] = useState(null);

  // DANFE
  const [danfeLoading, setDanfeLoading] = useState(false);
  const [danfeError, setDanfeError] = useState('');

  // Modal perfil do cliente
  const [perfilModalAberto, setPerfilModalAberto] = useState(false);
  const [clientePerfilData, setClientePerfilData] = useState(null);

  // Busca de NFs
  const [notasFiscaisBuscadas, setNotasFiscaisBuscadas] = useState([]);
  const [notasFiscaisLoading, setNotasFiscaisLoading] = useState(false);
  const [notasFiscaisError, setNotasFiscaisError] = useState('');

  // Seleção de títulos para remessa
  const [titulosSelecionados, setTitulosSelecionados] = useState(new Set());
  const [remessaLoading, setRemessaLoading] = useState(false);
  const [titulosJaRemessados, setTitulosJaRemessados] = useState({});
  // { titulo_key: { user_nome, nr_remessa } }

  // Filtro de datas (input date)
  const calcDataPadrao = (dias) => {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  };
  const [dataInicio, setDataInicio] = useState(() => calcDataPadrao(5));
  const [dataFim, setDataFim] = useState(() => calcDataPadrao(90));

  // Helpers de data
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

  const formatDateBR = (isoDate) => {
    const d = parseDateNoTZ(isoDate);
    if (!d) return '--';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  // CSS customizado
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

  // Ordenação
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

  // Portadores alvo: 748 (SICREDI), 1020, 1098
  const PORTADORES_LICITACAO = [748, 1020, 1098];

  // Filiais (empresas próprias, cd_empresa < 5999)
  const [filiaisCodigos, setFiliaisCodigos] = useState([]);

  // Buscar filiais ao montar
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
            .filter((code) => !isNaN(code) && code >= 1 && code <= 990);
          setFiliaisCodigos(codigos);
        }
      } catch (error) {
        console.error('Erro ao carregar filiais:', error);
        setFiliaisCodigos([1, 2, 6, 100, 101, 99, 990, 200, 400, 4, 850, 85]);
      }
    };
    buscarFiliais();
  }, []);

  // Carregar dados quando filiais estiverem prontas
  useEffect(() => {
    if (filiaisCodigos.length > 0) {
      buscarDados();
    }
  }, [filiaisCodigos]);

  // Buscar todas as faturas via rota /accounts-receivable/filter
  const buscarDados = async () => {
    setLoading(true);
    setPaginaAtual(1);
    try {
      const params = new URLSearchParams({
        dt_inicio: dataInicio,
        dt_fim: dataFim,
        modo: 'vencimento',
        status: 'Em Aberto',
        situacao: '1',
        tp_documento: '1',
        cd_portador: PORTADORES_LICITACAO.join(','),
        branches: filiaisCodigos.filter((c) => c >= 1 && c <= 990).join(','),
      });

      const response = await fetch(
        `${TotvsURL}accounts-receivable/filter?${params.toString()}`,
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      let todosOsDados = result.data?.items || [];

      // Filtrar: remover títulos cancelados, com data de liquidação, data de pagamento ou valor pago
      todosOsDados = todosOsDados.filter((item) => {
        // Apenas títulos com situação Normal
        const situacao = item.tp_situacao;
        const isNormal =
          situacao === 'NORMAL' ||
          situacao === 'N' ||
          situacao === 1 ||
          situacao === 0;
        if (!isNormal) return false;
        // Verificar data de liquidação
        const dtLiq = item.dt_liq ? String(item.dt_liq).trim() : '';
        const temLiquidacao =
          dtLiq !== '' &&
          !dtLiq.startsWith('1900') &&
          !dtLiq.startsWith('0001');
        // Verificar data de pagamento
        const dtPag = item.dt_pagamento ? String(item.dt_pagamento).trim() : '';
        const temDtPagamento =
          dtPag !== '' &&
          !dtPag.startsWith('1900') &&
          !dtPag.startsWith('0001');
        // Verificar valor pago
        const vlPago = parseFloat(item.vl_pago) || 0;
        const temPagamento = vlPago > 0;
        // Verificar tipo de baixa (dischargeType > 0 = baixada)
        const tpBaixa = parseInt(item.tp_baixa) || 0;
        const temBaixa = tpBaixa > 0;
        return !temLiquidacao && !temDtPagamento && !temPagamento && !temBaixa;
      });

      // Buscar nomes dos clientes via batch-lookup
      const codigosUnicos = [
        ...new Set(
          todosOsDados
            .map((item) => parseInt(item.cd_cliente))
            .filter((c) => !isNaN(c) && c > 0),
        ),
      ];

      if (codigosUnicos.length > 0) {
        try {
          const lookupResp = await fetch(`${TotvsURL}persons/batch-lookup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personCodes: codigosUnicos }),
          });
          if (lookupResp.ok) {
            const lookupResult = await lookupResp.json();
            const pessoas = lookupResult.data || {};
            todosOsDados = todosOsDados.map((item) => {
              const pessoa = pessoas[item.cd_cliente];
              if (pessoa) {
                return {
                  ...item,
                  nm_cliente:
                    pessoa.fantasyName || pessoa.name || item.nm_cliente,
                };
              }
              return item;
            });
          }
        } catch (err) {
          console.error('Erro ao buscar nomes dos clientes:', err);
        }
      }

      // Remover clientes específicos (internos/excluídos da licitação)
      const CLIENTES_EXCLUIDOS = [
        'RICARDO RANGEL',
        'FABIO FERREIRA',
        'FELIPE FERREIRA',
        'ALLYSON AIRES SALVIANO PESSOA',
        'IGOR HENRIQUE DE SOUZA',
        'FELIPE CAMILO CASTRO DE MEDEIROS',
        'KLEILTON JOSE SOBREIRA QUEIROZ',
        'CROSBY SHOPPING RECIFE',
        'ANTIGA IMPERATRIZ',
        'CROSBY SHOPPING CIDADE JARDIM',
      ];
      todosOsDados = todosOsDados.filter((item) => {
        const nome = (item.nm_cliente || '').toUpperCase();
        return !CLIENTES_EXCLUIDOS.some((excl) => nome.includes(excl));
      });

      // Remover títulos da empresa 101
      todosOsDados = todosOsDados.filter(
        (item) => parseInt(item.cd_empresa) !== 101,
      );

      setDados(todosOsDados);
      setDadosCarregados(true);
    } catch (err) {
      console.error('Erro ao buscar dados:', err);
      alert(`Erro ao buscar dados: ${err.message}`);
      setDados([]);
      setDadosCarregados(false);
    } finally {
      setLoading(false);
    }
  };

  // Gerar DANFE a partir de invoice
  const gerarDanfeInvoice = async (invoice) => {
    try {
      setDanfeLoading(true);
      setDanfeError('');

      const cd_pessoa = parseInt(faturaSelecionada?.cd_cliente) || 0;
      const dataInvoice = invoice.invoiceDate
        ? invoice.invoiceDate.split('T')[0]
        : '';
      if (!dataInvoice) throw new Error('Data da nota fiscal não disponível');

      const payload = {
        filter: {
          branchCodeList: [parseInt(invoice.branchCode)],
          personCodeList: [cd_pessoa],
          invoiceCode: parseInt(invoice.invoiceCode),
          invoiceDate: dataInvoice,
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
        abrirPDFDanfe(base64, invoice.invoiceCode);
      } else {
        throw new Error('DANFE não retornada pela API');
      }
    } catch (error) {
      console.error('Erro ao gerar DANFE:', error);
      setDanfeError(error.message || 'Erro ao gerar DANFE');
      alert(`Erro ao gerar DANFE: ${error.message}`);
    } finally {
      setDanfeLoading(false);
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
      console.error('Erro ao abrir DANFE:', error);
      alert('Erro ao abrir a DANFE.');
    }
  };

  // Buscar NFs do cliente na data da fatura (busca progressiva)
  const buscarNotasFiscaisFatura = async (fatura) => {
    setNotasFiscaisLoading(true);
    setNotasFiscaisError('');
    setNotasFiscaisBuscadas([]);
    try {
      const cd_cliente = parseInt(fatura.cd_cliente) || 0;
      const dtEmissao = fatura.dt_emissao
        ? fatura.dt_emissao.split('T')[0]
        : '';
      if (!dtEmissao || !cd_cliente) {
        setNotasFiscaisError('Dados da fatura incompletos para buscar NFs');
        return;
      }

      // branchCodeList aceita apenas códigos entre 1 e 99
      const cdEmpresa = parseInt(fatura.cd_empresa);
      const branchCodes =
        !isNaN(cdEmpresa) && cdEmpresa >= 1 && cdEmpresa <= 99
          ? [cdEmpresa]
          : filiaisCodigos.length > 0
            ? filiaisCodigos.filter((c) => c >= 1 && c <= 99)
            : [1, 2, 5, 6, 11, 55, 65, 75, 85];

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

      for (const margem of [0, 1, 2, 3]) {
        const items = await buscarComMargem(margem);
        if (items.length > 0) {
          setNotasFiscaisBuscadas(items);
          return;
        }
      }

      setNotasFiscaisBuscadas([]);
    } catch (error) {
      console.error('Erro ao buscar NFs da fatura:', error);
      setNotasFiscaisError(error.message || 'Erro ao buscar notas fiscais');
    } finally {
      setNotasFiscaisLoading(false);
    }
  };

  // Gerar DANFE a partir de NF buscada
  const gerarDanfeNFBuscada = async (nf) => {
    try {
      setDanfeLoading(true);
      setDanfeError('');

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
      console.error('Erro ao gerar DANFE:', error);
      setDanfeError(error.message || 'Erro ao gerar DANFE');
      alert(`Erro ao gerar DANFE: ${error.message}`);
    } finally {
      setDanfeLoading(false);
    }
  };

  // Abrir modal de detalhes
  const abrirObsFatura = (fatura) => {
    setObsModalAberto(true);
    setFaturaSelecionada(fatura);
    setNotasFiscaisBuscadas([]);
    setNotasFiscaisError('');

    const temInvoice =
      fatura.invoice &&
      Array.isArray(fatura.invoice) &&
      fatura.invoice.length > 0;
    const isEmpresa101 = parseInt(fatura.cd_empresa) === 101;
    if (!temInvoice && !isEmpresa101) {
      buscarNotasFiscaisFatura(fatura);
    }
  };

  // Exportar Excel
  const handleExportExcel = () => {
    if (dadosProcessados.length === 0) {
      alert('Não há dados para exportar!');
      return;
    }
    try {
      const dadosParaExportar = dadosProcessados.map((item) => ({
        Cliente: item.nm_cliente || '',
        'CPF/CNPJ': item.nr_cpfcnpj || '',
        Portador: item.nm_portador || '',
        'Nº Fatura': item.nr_fat || '',
        Parcela: item.nr_parcela || '',
        Emissão:
          formatDateBR(item.dt_emissao) === '--'
            ? ''
            : formatDateBR(item.dt_emissao),
        Vencimento:
          formatDateBR(item.dt_vencimento) === '--'
            ? ''
            : formatDateBR(item.dt_vencimento),
        'Valor Fatura': parseFloat(item.vl_fatura) || 0,
      }));
      const ws = XLSX.utils.json_to_sheet(dadosParaExportar);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Licitação de Títulos');
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const data = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      saveAs(data, `licitacao-titulos-${hoje}.xlsx`);
    } catch (error) {
      console.error('Erro ao exportar Excel:', error);
      alert('Erro ao exportar arquivo Excel.');
    }
  };

  // Dados processados (com ordenação)
  const dadosProcessados = useMemo(() => {
    let dadosFiltrados = [...dados];
    if (ordenacao.campo) {
      dadosFiltrados.sort((a, b) => {
        let valorA = a[ordenacao.campo];
        let valorB = b[ordenacao.campo];
        if (ordenacao.campo.includes('dt_')) {
          valorA = valorA ? new Date(valorA) : new Date(0);
          valorB = valorB ? new Date(valorB) : new Date(0);
        }
        if (
          ordenacao.campo.includes('vl_') ||
          ordenacao.campo.includes('nr_')
        ) {
          valorA = parseFloat(valorA) || 0;
          valorB = parseFloat(valorB) || 0;
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
    return dadosFiltrados;
  }, [dados, ordenacao]);

  const dadosPaginados = useMemo(() => {
    const startIndex = (paginaAtual - 1) * itensPorPagina;
    return dadosProcessados.slice(startIndex, startIndex + itensPorPagina);
  }, [dadosProcessados, paginaAtual, itensPorPagina]);

  const totalPages = Math.ceil(dadosProcessados.length / itensPorPagina);

  // Paginação
  const irParaPagina = (pagina) => setPaginaAtual(pagina);
  const paginaAnterior = () => {
    if (paginaAtual > 1) setPaginaAtual(paginaAtual - 1);
  };
  const proximaPagina = () => {
    if (paginaAtual < totalPages) setPaginaAtual(paginaAtual + 1);
  };

  // Totais
  const calcularTotais = () => {
    return dadosProcessados.reduce(
      (acc, item) => {
        const valorFatura = parseFloat(item.vl_fatura) || 0;
        acc.valorTotal += valorFatura;
        acc.quantidade += 1;
        return acc;
      },
      { valorTotal: 0, quantidade: 0 },
    );
  };
  const totais = calcularTotais();

  useEffect(() => {
    setPaginaAtual(1);
  }, [dados, ordenacao]);

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

  // Abrir modal perfil do cliente
  const abrirPerfilCliente = (item) => {
    setClientePerfilData({
      code: item.cd_cliente,
      nome: item.nm_cliente,
      cnpj: item.nr_cpfcnpj,
    });
    setPerfilModalAberto(true);
  };

  // Gerar chave \u00fanica para o t\u00edtulo
  const gerarTituloKey = (item) =>
    `${item.cd_empresa}_${item.cd_cliente}_${item.nr_fat}_${item.nr_parcela || 1}`;

  // Buscar t\u00edtulos j\u00e1 remessados ao carregar dados
  const buscarTitulosRemessados = async () => {
    try {
      const { data, error } = await supabase
        .from('solicitacoes_remessa_titulos')
        .select('titulo_key, remessa_id');
      if (error) throw error;
      if (!data || data.length === 0) {
        setTitulosJaRemessados({});
        return;
      }
      // Buscar info das remessas
      const remessaIds = [...new Set(data.map((t) => t.remessa_id))];
      const { data: remessas } = await supabase
        .from('solicitacoes_remessa')
        .select('id, nr_remessa, user_nome, status')
        .in('id', remessaIds);
      const remessaMap = {};
      (remessas || []).forEach((r) => {
        remessaMap[r.id] = r;
      });
      const mapa = {};
      data.forEach((t) => {
        const rem = remessaMap[t.remessa_id];
        // Títulos de remessas REPROVADAS ficam disponíveis para re-seleção
        if (rem?.status === 'REPROVADA') return;
        mapa[t.titulo_key] = {
          user_nome: rem?.user_nome || '--',
          nr_remessa: rem?.nr_remessa || '--',
          status: rem?.status || 'EM ANALISE',
        };
      });
      setTitulosJaRemessados(mapa);
    } catch (err) {
      console.error('Erro ao buscar t\u00edtulos remessados:', err);
    }
  };

  // Buscar t\u00edtulos remessados quando dados carregarem
  useEffect(() => {
    if (dados.length > 0) {
      buscarTitulosRemessados();
    }
  }, [dados]);

  // Toggle sele\u00e7\u00e3o de t\u00edtulo
  const toggleSelecionarTitulo = (item) => {
    const key = gerarTituloKey(item);
    if (titulosJaRemessados[key]) return; // j\u00e1 remessado
    setTitulosSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Selecionar/desselecionar todos
  const toggleSelecionarTodos = () => {
    const titulosDisponiveis = dadosProcessados.filter(
      (item) => !titulosJaRemessados[gerarTituloKey(item)],
    );
    if (titulosSelecionados.size === titulosDisponiveis.length) {
      setTitulosSelecionados(new Set());
    } else {
      setTitulosSelecionados(
        new Set(titulosDisponiveis.map((item) => gerarTituloKey(item))),
      );
    }
  };

  // Solicitar remessa
  const solicitarRemessa = async () => {
    if (titulosSelecionados.size === 0) {
      alert('Selecione pelo menos um t\u00edtulo para solicitar remessa.');
      return;
    }
    if (
      !window.confirm(
        `Confirma a solicita\u00e7\u00e3o de remessa com ${titulosSelecionados.size} t\u00edtulo(s)?`,
      )
    ) {
      return;
    }
    setRemessaLoading(true);
    try {
      const titulosSelecionadosList = dadosProcessados.filter((item) =>
        titulosSelecionados.has(gerarTituloKey(item)),
      );
      const vlTotal = titulosSelecionadosList.reduce(
        (acc, item) => acc + (parseFloat(item.vl_fatura) || 0),
        0,
      );

      // Criar remessa
      const { data: remessa, error: errRemessa } = await supabase
        .from('solicitacoes_remessa')
        .insert({
          user_id: user?.id,
          user_nome: user?.name || user?.email || 'Usu\u00e1rio',
          user_email: user?.email,
          vl_total: vlTotal,
          qt_titulos: titulosSelecionadosList.length,
        })
        .select()
        .single();

      if (errRemessa) throw errRemessa;

      // Inserir t\u00edtulos
      const titulos = titulosSelecionadosList.map((item) => ({
        remessa_id: remessa.id,
        cd_empresa: parseInt(item.cd_empresa) || null,
        cd_cliente: parseInt(item.cd_cliente) || null,
        nm_cliente: item.nm_cliente || '',
        nr_cpfcnpj: item.nr_cpfcnpj || '',
        nr_fat: parseInt(item.nr_fat) || null,
        nr_parcela: parseInt(item.nr_parcela) || 1,
        cd_portador: parseInt(item.cd_portador) || null,
        nm_portador: item.nm_portador || '',
        vl_fatura: parseFloat(item.vl_fatura) || 0,
        dt_emissao: item.dt_emissao ? item.dt_emissao.split('T')[0] : null,
        dt_vencimento: item.dt_vencimento
          ? item.dt_vencimento.split('T')[0]
          : null,
        titulo_key: gerarTituloKey(item),
      }));

      const { error: errTitulos } = await supabase
        .from('solicitacoes_remessa_titulos')
        .insert(titulos);

      if (errTitulos) throw errTitulos;

      alert(`Remessa #${remessa.nr_remessa} criada com sucesso!`);
      setTitulosSelecionados(new Set());
      buscarTitulosRemessados();
    } catch (err) {
      console.error('Erro ao solicitar remessa:', err);
      if (err.message?.includes('duplicate') || err.code === '23505') {
        alert(
          'Erro: Um ou mais t\u00edtulos j\u00e1 foram inclu\u00eddos em outra remessa.',
        );
        buscarTitulosRemessados();
      } else {
        alert(`Erro ao solicitar remessa: ${err.message}`);
      }
    } finally {
      setRemessaLoading(false);
    }
  };

  // Valor total selecionado
  const valorTotalSelecionado = useMemo(() => {
    return dadosProcessados
      .filter((item) => titulosSelecionados.has(gerarTituloKey(item)))
      .reduce((acc, item) => acc + (parseFloat(item.vl_fatura) || 0), 0);
  }, [dadosProcessados, titulosSelecionados]);

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Licitação de Títulos"
        subtitle="Titulos para operação de antecipação financeira"
        icon={Gavel}
        iconColor="text-amber-600"
      />

      {/* Filtros */}
      <div className="mb-4">
        <div className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full max-w-7xl mx-auto border border-[#000638]/10">
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Gavel size={18} weight="bold" />
              Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Títulos a vencer no período selecionado
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Vencimento De
              </label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-40 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Vencimento Até
              </label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-40 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <button
              onClick={buscarDados}
              disabled={loading}
              className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase"
            >
              {loading ? (
                <>
                  <Spinner size={10} className="animate-spin" />
                  <span>Carregando...</span>
                </>
              ) : (
                <>
                  <Receipt size={10} />
                  <span>Buscar</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Cards de Resumo */}
      {dadosProcessados.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-2 gap-2 mb-6 max-w-7xl mx-auto">
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Receipt size={14} className="text-blue-600" />
                <CardTitle className="text-xs font-bold text-blue-700">
                  Títulos Encontrados
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-blue-600 mb-0.5 break-words">
                {totais.quantidade}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Total de títulos no período
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-red-600" />
                <CardTitle className="text-xs font-bold text-red-700">
                  Valor Total
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-red-600 mb-0.5 break-words">
                {totais.valorTotal.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Valor total dos títulos
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white rounded-lg shadow-md border border-[#000638]/10 max-w-7xl mx-auto w-full">
        <div className="p-3 border-b border-[#000638]/10 flex justify-between items-center">
          <h2 className="text-sm font-bold text-[#000638] font-barlow">
            Licitação de Títulos
          </h2>
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-600">
              {dadosCarregados
                ? `${dadosProcessados.length} registros encontrados`
                : 'Carregando...'}
            </div>
            {dadosProcessados.length > 0 && (
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-1 bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 transition-colors font-medium text-xs"
              >
                <FileArrowDown size={12} /> BAIXAR EXCEL
              </button>
            )}
            {titulosSelecionados.size > 0 && (
              <button
                onClick={solicitarRemessa}
                disabled={remessaLoading}
                className="flex items-center gap-1 bg-amber-600 text-white px-3 py-1 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold text-xs animate-pulse"
              >
                {remessaLoading ? (
                  <>
                    <Spinner size={12} className="animate-spin" />
                    <span>Enviando...</span>
                  </>
                ) : (
                  <>
                    <PaperPlaneTilt size={12} weight="bold" />
                    <span>SOLICITAR REMESSA ({titulosSelecionados.size})</span>
                  </>
                )}
              </button>
            )}
            {dadosCarregados && (
              <button
                onClick={buscarDados}
                disabled={loading}
                className="flex items-center gap-1 bg-[#000638] text-white px-2 py-1 rounded-lg hover:bg-[#fe0000] transition-colors font-medium text-xs"
              >
                {loading ? (
                  <Spinner size={12} className="animate-spin" />
                ) : (
                  <ArrowRight size={12} />
                )}
                Atualizar
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
                  Carregando títulos... Isso pode levar alguns segundos.
                </span>
              </div>
            </div>
          ) : !dadosCarregados ? (
            <div className="flex justify-center items-center py-12">
              <div className="flex items-center gap-3">
                <Spinner size={18} className="animate-spin text-blue-600" />
                <span className="text-sm text-gray-600">
                  Carregando títulos...
                </span>
              </div>
            </div>
          ) : dados.length === 0 ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="text-gray-500 text-sm mb-2">
                  Nenhum título encontrado
                </div>
                <div className="text-gray-400 text-xs">
                  Não há títulos com portador 748, 1020 ou 1098 com vencimento
                  entre 5 e 90 dias
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-[350px] md:max-w-[700px] lg:max-w-[900px] xl:max-w-[1100px] 2xl:max-w-[1300px] mx-auto overflow-x-auto">
              <table className="border-collapse rounded-lg overflow-hidden shadow-lg extrato-table">
                <thead className="bg-[#000638] text-white text-sm uppercase tracking-wider">
                  <tr>
                    <th className="px-2 py-2 text-center w-10">
                      <button
                        onClick={toggleSelecionarTodos}
                        className="flex items-center justify-center mx-auto hover:opacity-80 transition-opacity"
                        title="Selecionar/Desselecionar todos"
                      >
                        {titulosSelecionados.size > 0 &&
                        titulosSelecionados.size ===
                          dadosProcessados.filter(
                            (i) => !titulosJaRemessados[gerarTituloKey(i)],
                          ).length ? (
                          <CheckSquare
                            size={16}
                            weight="fill"
                            className="text-amber-400"
                          />
                        ) : (
                          <Square size={16} className="text-white/70" />
                        )}
                      </button>
                    </th>
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
                      onClick={() => handleSort('nr_cpfcnpj')}
                    >
                      <div className="flex items-center justify-center">
                        CPF/CNPJ{getSortIcon('nr_cpfcnpj')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('cd_empresa')}
                    >
                      <div className="flex items-center justify-center">
                        Empresa{getSortIcon('cd_empresa')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('dt_emissao')}
                    >
                      <div className="flex items-center justify-center">
                        Emissão{getSortIcon('dt_emissao')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('dt_vencimento')}
                    >
                      <div className="flex items-center justify-center">
                        Vencimento{getSortIcon('dt_vencimento')}
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
                    <th className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center">
                        Detalhar
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('tp_situacao')}
                    >
                      <div className="flex items-center justify-center">
                        Situação{getSortIcon('tp_situacao')}
                      </div>
                    </th>
                    <th className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center">
                        Remessa
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {dadosPaginados.map((item, index) => {
                    const tituloKey = gerarTituloKey(item);
                    const jaRemessado = titulosJaRemessados[tituloKey];
                    const estaSelecionado = titulosSelecionados.has(tituloKey);
                    return (
                      <tr
                        key={index}
                        className={`text-sm transition-colors ${
                          jaRemessado
                            ? 'bg-amber-50 opacity-70'
                            : estaSelecionado
                              ? 'bg-blue-50 border-l-4 border-blue-500'
                              : ''
                        }`}
                      >
                        <td className="text-center px-2 py-2">
                          {jaRemessado ? (
                            <CheckCircle
                              size={18}
                              weight="fill"
                              className="text-amber-500 mx-auto"
                              title={`Remessa #${jaRemessado.nr_remessa} - ${jaRemessado.user_nome}`}
                            />
                          ) : (
                            <button
                              onClick={() => toggleSelecionarTitulo(item)}
                              className="flex items-center justify-center mx-auto hover:opacity-80 transition-opacity"
                            >
                              {estaSelecionado ? (
                                <CheckSquare
                                  size={18}
                                  weight="fill"
                                  className="text-blue-600"
                                />
                              ) : (
                                <Square size={18} className="text-gray-400" />
                              )}
                            </button>
                          )}
                        </td>
                        <td className="text-left px-2 py-2">
                          <button
                            onClick={() => abrirPerfilCliente(item)}
                            className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left"
                            title="Ver perfil do cliente"
                          >
                            {item.nm_cliente || '--'}
                          </button>
                        </td>
                        <td className="text-center text-gray-900 px-2 py-2">
                          {item.nr_cpfcnpj || '--'}
                        </td>
                        <td className="text-center text-gray-900 px-2 py-2">
                          {item.cd_empresa || '--'}
                        </td>
                        <td className="text-center text-gray-900 px-2 py-2">
                          {formatDateBR(item.dt_emissao)}
                        </td>
                        <td className="text-center text-gray-900 px-2 py-2">
                          {formatDateBR(item.dt_vencimento)}
                        </td>
                        <td className="text-center font-semibold text-green-600 px-2 py-2">
                          {(parseFloat(item.vl_fatura) || 0).toLocaleString(
                            'pt-BR',
                            { style: 'currency', currency: 'BRL' },
                          )}
                        </td>
                        <td className="text-center px-2 py-2">
                          <button
                            onClick={() => abrirObsFatura(item)}
                            className="flex items-center justify-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs mx-auto font-medium"
                          >
                            <Eye size={14} weight="bold" /> Detalhar
                          </button>
                        </td>
                        <td className="text-center px-2 py-2">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              item.tp_situacao === 'NORMAL' ||
                              item.tp_situacao === 'N' ||
                              item.tp_situacao === 1 ||
                              item.tp_situacao === 0
                                ? 'bg-green-100 text-green-700'
                                : item.tp_situacao === 'CANCELADA' ||
                                    item.tp_situacao === 'C' ||
                                    item.tp_situacao === 3
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {item.tp_situacao === 'NORMAL' ||
                            item.tp_situacao === 'N' ||
                            item.tp_situacao === 1 ||
                            item.tp_situacao === 0
                              ? 'NORMAL'
                              : item.tp_situacao === 'CANCELADA' ||
                                  item.tp_situacao === 'C' ||
                                  item.tp_situacao === 3
                                ? 'CANCELADA'
                                : item.tp_situacao || '--'}
                          </span>
                        </td>
                        <td className="text-center px-2 py-2">
                          {jaRemessado ? (
                            <div className="flex flex-col items-center">
                              <span className="text-xs font-bold text-amber-700">
                                #{jaRemessado.nr_remessa}
                              </span>
                              <span className="text-[10px] text-amber-600 flex items-center gap-0.5">
                                <UserCircle size={10} />
                                {jaRemessado.user_nome}
                              </span>
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 ${
                                  jaRemessado.status === 'APROVADA'
                                    ? 'bg-green-100 text-green-700'
                                    : jaRemessado.status === 'REPROVADA'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-yellow-100 text-yellow-700'
                                }`}
                              >
                                {jaRemessado.status}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">--</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-4 text-center text-sm text-gray-600">
                Total de {dadosProcessados.length} registros
              </div>

              {/* Barra de seleção */}
              {titulosSelecionados.size > 0 && (
                <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckSquare
                      size={18}
                      weight="fill"
                      className="text-blue-600"
                    />
                    <span className="text-sm font-semibold text-blue-800">
                      {titulosSelecionados.size} título(s) selecionado(s)
                    </span>
                    <span className="text-sm font-bold text-blue-600">
                      Total:{' '}
                      {valorTotalSelecionado.toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setTitulosSelecionados(new Set())}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      Limpar seleção
                    </button>
                    <button
                      onClick={solicitarRemessa}
                      disabled={remessaLoading}
                      className="flex items-center gap-1 bg-amber-600 text-white px-4 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold text-xs"
                    >
                      {remessaLoading ? (
                        <Spinner size={12} className="animate-spin" />
                      ) : (
                        <PaperPlaneTilt size={14} weight="bold" />
                      )}
                      SOLICITAR REMESSA
                    </button>
                  </div>
                </div>
              )}

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

      {/* Modal de Detalhes */}
      {obsModalAberto && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          style={{ zIndex: 99999 }}
        >
          <div className="bg-white rounded-lg p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                Detalhes do Título
              </h2>
              <button
                onClick={() => setObsModalAberto(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            {/* Info da Fatura */}
            {faturaSelecionada && (
              <div className="bg-gray-50 p-4 rounded-lg mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">
                  Informações do Título
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Cliente:</span>
                    <p className="font-medium">
                      {faturaSelecionada.nm_cliente}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">CPF/CNPJ:</span>
                    <p className="font-medium">
                      {faturaSelecionada.nr_cpfcnpj}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Nº Fatura:</span>
                    <p className="font-medium">{faturaSelecionada.nr_fat}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Portador:</span>
                    <p className="font-medium">
                      {faturaSelecionada.nm_portador ||
                        faturaSelecionada.cd_portador}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Emissão:</span>
                    <p className="font-medium">
                      {formatDateBR(faturaSelecionada.dt_emissao)}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Vencimento:</span>
                    <p className="font-medium">
                      {formatDateBR(faturaSelecionada.dt_vencimento)}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Valor:</span>
                    <p className="font-medium text-green-600">
                      {(
                        parseFloat(faturaSelecionada.vl_fatura) || 0
                      ).toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Empresa:</span>
                    <p className="font-medium">
                      {faturaSelecionada.cd_empresa}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Notas Fiscais */}
            <div className="border border-gray-200 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Receipt size={20} className="text-purple-600" /> Notas Fiscais
                Relacionadas
              </h3>
              <div className="min-h-[150px]">
                {parseInt(faturaSelecionada?.cd_empresa) === 101 ? (
                  <div className="bg-amber-50 border border-amber-300 rounded-lg p-5 text-center">
                    <p className="text-sm font-semibold text-amber-800">
                      ESSA FATURA É REFERENTE A UM CRÉDITO LIBERADO AO CLIENTE,
                      VERIFIQUE NA ABA DE NOTAS FISCAIS TODAS AS NOTAS FISCAIS
                      CUJA A FORMA DE PAGAMENTO FOI &quot;ADIANTAMENTO&quot;
                    </p>
                    <button
                      onClick={() => {
                        setObsModalAberto(false);
                        navigate('/nf-clientes-confianca');
                      }}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
                    >
                      Ir para Notas Fiscais{' '}
                      <ArrowRight size={16} weight="bold" />
                    </button>
                  </div>
                ) : faturaSelecionada?.invoice &&
                  faturaSelecionada.invoice.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border border-gray-200 rounded-lg">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                            Filial
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase">
                            Nº NF
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase">
                            Sequência
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase">
                            Data
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase">
                            Ações
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {faturaSelecionada.invoice.map((inv, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {inv.branchCode || '--'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center font-bold text-[#000638]">
                              {inv.invoiceCode || '--'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center text-gray-900">
                              {inv.invoiceSequence || '--'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center text-gray-900">
                              {formatDateBR(inv.invoiceDate)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => gerarDanfeInvoice(inv)}
                                disabled={danfeLoading}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors mx-auto"
                              >
                                <FileArrowDown size={18} weight="bold" />{' '}
                                {danfeLoading ? 'Gerando...' : 'Gerar DANFE'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : notasFiscaisLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="flex items-center gap-3">
                      <Spinner
                        size={18}
                        className="animate-spin text-purple-600"
                      />
                      <span className="text-sm text-gray-600">
                        Buscando notas fiscais relacionadas...
                      </span>
                    </div>
                  </div>
                ) : notasFiscaisError ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                    <p className="text-sm text-red-600">{notasFiscaisError}</p>
                  </div>
                ) : notasFiscaisBuscadas.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border border-gray-200 rounded-lg">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                            Filial
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase">
                            Nº NF
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase">
                            Data
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase">
                            Valor
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase">
                            Ações
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {notasFiscaisBuscadas.map((nf, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {nf.branchCode || '--'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center font-bold text-[#000638]">
                              {nf.invoiceCode || nf.transactionCode || '--'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center text-gray-900">
                              {formatDateBR(
                                nf.invoiceDate || nf.transactionDate,
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-center text-green-600 font-semibold">
                              {(
                                parseFloat(nf.totalValue || nf.netValue) || 0
                              ).toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => gerarDanfeNFBuscada(nf)}
                                disabled={danfeLoading}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors mx-auto"
                              >
                                <FileArrowDown size={18} weight="bold" />{' '}
                                {danfeLoading ? 'Gerando...' : 'Gerar DANFE'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 text-center">
                    <p className="text-sm text-gray-600">
                      Nenhuma nota fiscal encontrada para esta fatura
                    </p>
                  </div>
                )}
              </div>
            </div>

            {danfeError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-red-600">{danfeError}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Perfil do Cliente */}
      <ClientePerfilModal
        isOpen={perfilModalAberto}
        onClose={() => setPerfilModalAberto(false)}
        clienteCode={clientePerfilData?.code}
        clienteNome={clientePerfilData?.nome}
        clienteCnpj={clientePerfilData?.cnpj}
      />
    </div>
  );
};

export default LicitacaoTitulos;
