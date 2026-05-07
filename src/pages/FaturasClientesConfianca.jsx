import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
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
  Funnel,
  Spinner,
  CurrencyDollar,
  CaretLeft,
  CaretRight,
  CaretUp,
  CaretDown,
  CaretUpDown,
  FileArrowDown,
  Eye,
  CheckCircle,
  FilePdf,
  X,
  MagnifyingGlass,
  ArrowRight,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const FaturasClientesAntecipacao = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [status, setStatus] = useState('todos');

  // Campo de busca por nome/CNPJ
  const [termoBusca, setTermoBusca] = useState('');
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [clientesEncontrados, setClientesEncontrados] = useState([]);
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [showDropdownCliente, setShowDropdownCliente] = useState(false);

  // Estados para paginação
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina] = useState(20);

  // Estados para ordenação
  const [ordenacao, setOrdenacao] = useState({ campo: null, direcao: 'asc' });

  // Estados para modal de detalhes
  const [obsModalAberto, setObsModalAberto] = useState(false);
  const [boletoBase64, setBoletoBase64] = useState('');
  const [boletoLoading, setBoletoLoading] = useState(false);
  const [boletoError, setBoletoError] = useState('');
  const [faturaSelecionada, setFaturaSelecionada] = useState(null);

  // Estados para DANFE
  const [danfeLoading, setDanfeLoading] = useState(false);
  const [danfeError, setDanfeError] = useState('');

  // Estados para busca de NFs (quando invoice[] não existe)
  const [notasFiscaisBuscadas, setNotasFiscaisBuscadas] = useState([]);
  const [notasFiscaisLoading, setNotasFiscaisLoading] = useState(false);
  const [notasFiscaisError, setNotasFiscaisError] = useState('');

  // Estado para armazenar códigos das filiais
  const [filiaisCodigos, setFiliaisCodigos] = useState([]);

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
          if (codigos.length > 0) {
            setFiliaisCodigos(codigos);
          }
        }
      } catch (error) {
        // erro silencioso
      }
    };
    buscarFiliais();
  }, []);

  // Buscar clientes por nome via Supabase (pes_pessoa)
  const buscarClientes = async () => {
    if (!termoBusca || termoBusca.trim().length < 3) return;

    setBuscandoCliente(true);
    setClientesEncontrados([]);
    setShowDropdownCliente(true);

    try {
      const termo = termoBusca.trim();
      const params = new URLSearchParams();
      params.append('nome', termo);
      params.append('fantasia', termo);

      const resp = await fetch(
        `${TotvsURL}clientes/search-name?${params.toString()}`,
      );
      const json = await resp.json();
      if (json.success && json.data?.clientes) {
        setClientesEncontrados(json.data.clientes);
      }
    } catch (error) {
      // erro silencioso
    } finally {
      setBuscandoCliente(false);
    }
  };

  const selecionarCliente = (cliente) => {
    setClienteSelecionado(cliente);
    setTermoBusca(
      cliente.fantasy_name || cliente.nm_pessoa || cliente.cpf || '',
    );
    setShowDropdownCliente(false);
  };

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

  // Dados processados
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

  // Buscar faturas
  const buscarDados = async () => {
    if (!clienteSelecionado) {
      alert('Selecione um cliente para consultar!');
      return;
    }

    setLoading(true);
    setPaginaAtual(1);
    try {
      const branchCodeList =
        filiaisCodigos.length > 0
          ? filiaisCodigos
          : [
              1, 2, 5, 6, 11, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94,
              95, 96, 97, 98, 99, 100, 101,
            ];

      const customerCode = parseInt(clienteSelecionado.code);
      const customerCpfCnpj = clienteSelecionado.cpf || '';

      const filter = { branchCodeList };

      if (customerCode && !isNaN(customerCode)) {
        filter.customerCodeList = [customerCode];
      } else if (customerCpfCnpj) {
        filter.customerCpfCnpjList = [customerCpfCnpj.replace(/\D/g, '')];
      }

      if (status === 'em_aberto' || status === 'vencidos') {
        filter.hasOpenInvoices = true;
      }

      const response = await fetch(
        `${TotvsURL}accounts-receivable/search-all`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filter,
            expand: 'invoice,calculateValue',
            order: '-expiredDate',
            maxPages: 20,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      let todosOsDados = result.data?.items || [];

      // Mapear dados TOTVS
      todosOsDados = todosOsDados.map((item) => ({
        ...item,
        cd_empresa: item.branchCode,
        cd_cliente: item.customerCode,
        nm_cliente:
          item.customerName ||
          clienteSelecionado.fantasy_name ||
          clienteSelecionado.nm_pessoa ||
          item.customerCpfCnpj,
        nr_cpfcnpj: item.customerCpfCnpj,
        nr_fatura: item.receivableCode,
        nr_fat: item.receivableCode,
        nr_parcela: item.installmentCode,
        dt_vencimento: item.expiredDate,
        dt_liq: item.paymentDate || item.settlementDate,
        dt_emissao: item.issueDate,
        vl_fatura: item.installmentValue,
        vl_pago: item.paidValue || 0,
        vl_liquido: item.netValue,
        vl_desconto: item.discountValue,
        vl_juros: item.interestValue,
        vl_multa: item.assessmentValue,
        cd_barras: item.barCode,
        linha_digitavel: item.digitableLine,
        nosso_numero: item.ourNumber,
        tp_situacao: item.status,
        tp_documento: item.documentType,
        tp_cobranca: item.chargeType,
        cd_portador: item.bearerCode,
        nm_portador: item.bearerName,
        cancelado: item.canceled,
        dias_atraso: item.calculatedValues?.daysLate,
        vl_corrigido: item.calculatedValues?.correctedValue,
        invoice: item.invoice,
      }));

      // Filtrar: DOCUMENTO = FATURA e SITUAÇÃO = NORMAL
      todosOsDados = todosOsDados.filter((item) => {
        const isFatura =
          item.tp_documento === 'FATURA' ||
          item.tp_documento === 1 ||
          String(item.tp_documento).toUpperCase().includes('FATURA');
        const isNormal =
          item.tp_situacao === 'NORMAL' ||
          item.tp_situacao === 1 ||
          item.tp_situacao === 0 ||
          String(item.tp_situacao).toUpperCase() === 'NORMAL';
        return isFatura && isNormal;
      });

      // Filtro de status
      if (status !== 'todos') {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        todosOsDados = todosOsDados.filter((item) => {
          const temDataLiquidacao = item.dt_liq && item.dt_liq !== null;
          const dataVencimento = item.dt_vencimento
            ? new Date(item.dt_vencimento)
            : null;
          const temPagamento = item.vl_pago && item.vl_pago > 0;
          if (temDataLiquidacao && temPagamento) return status === 'pagos';
          if (status === 'pagos') return false;
          if (status === 'vencidos')
            return dataVencimento && dataVencimento < hoje;
          if (status === 'em_aberto')
            return !dataVencimento || dataVencimento >= hoje;
          return true;
        });
      }

      setDados(todosOsDados);
      setDadosCarregados(true);
    } catch (err) {
      alert(`Erro ao buscar dados: ${err.message}`);
      setDados([]);
      setDadosCarregados(false);
    } finally {
      setLoading(false);
    }
  };

  const handleFiltrar = (e) => {
    e.preventDefault();
    buscarDados();
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
      alert('Erro ao abrir a DANFE.');
    }
  };

  // Buscar NFs do cliente na data da fatura (busca progressiva: mesmo dia, ±1, ±2, ±3)
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
          setNotasFiscaisBuscadas(items);
          return;
        }
      }

      setNotasFiscaisBuscadas([]);
    } catch (error) {
      setNotasFiscaisError(error.message || 'Erro ao buscar notas fiscais');
    } finally {
      setNotasFiscaisLoading(false);
    }
  };

  // Gerar DANFE a partir de NF buscada (tem transactionCode direto)
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
    setBoletoBase64('');
    setBoletoError('');
    setNotasFiscaisBuscadas([]);
    setNotasFiscaisError('');

    // Se não tem invoice[] direto, buscar NFs (exceto empresa 101 que é crédito)
    const temInvoice =
      fatura.invoice &&
      Array.isArray(fatura.invoice) &&
      fatura.invoice.length > 0;
    const isEmpresa101 = parseInt(fatura.cd_empresa) === 101;
    if (!temInvoice && !isEmpresa101) {
      buscarNotasFiscaisFatura(fatura);
    }
  };

  // Buscar boleto
  const buscarBoleto = async () => {
    if (!faturaSelecionada) return;
    try {
      setBoletoLoading(true);
      setBoletoError('');
      setBoletoBase64('');

      const payload = {
        branchCode: parseInt(faturaSelecionada.cd_empresa) || 0,
        customerCode: faturaSelecionada.cd_cliente || '',
        receivableCode: parseInt(faturaSelecionada.nr_fat) || 0,
        installmentNumber: parseInt(faturaSelecionada.nr_parcela) || 0,
      };

      const response = await fetch(`${TotvsURL}bank-slip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Erro ao buscar boleto');
      }

      const data = await response.json();
      let base64 = '';
      if (typeof data === 'string') base64 = data;
      else if (data.data?.base64)
        base64 =
          typeof data.data.base64 === 'string'
            ? data.data.base64
            : data.data.base64.content || '';
      else if (data.data && typeof data.data === 'string') base64 = data.data;
      else if (data.base64)
        base64 =
          typeof data.base64 === 'string'
            ? data.base64
            : data.base64.content || '';

      if (base64 && typeof base64 === 'string') {
        setBoletoBase64(base64);
        abrirPDF(base64);
      } else {
        throw new Error('Formato de resposta inválido');
      }
    } catch (error) {
      setBoletoError(error.message || 'Erro ao buscar boleto');
    } finally {
      setBoletoLoading(false);
    }
  };

  const abrirPDF = (base64String) => {
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
        link.download = `boleto-${faturaSelecionada?.nr_fat || 'fatura'}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      alert('Erro ao abrir o boleto.');
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
        Liquidação:
          formatDateBR(item.dt_liq) === '--' ? '' : formatDateBR(item.dt_liq),
        'Valor Fatura': parseFloat(item.vl_fatura) || 0,
        'Valor Pago': parseFloat(item.vl_pago) || 0,
      }));
      const ws = XLSX.utils.json_to_sheet(dadosParaExportar);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Faturas Antecipação');
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const data = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      saveAs(data, `faturas-antecipacao-${hoje}.xlsx`);
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

  // Totais
  const calcularTotais = () => {
    return dadosProcessados.reduce(
      (acc, item) => {
        const valorFatura = parseFloat(item.vl_fatura) || 0;
        const valorPago = parseFloat(item.vl_pago) || 0;
        const temDataLiquidacao =
          item.dt_liq && item.dt_liq !== null && item.dt_liq !== '';
        acc.valorFaturado += valorFatura;
        acc.valorPago += valorPago;
        if (!temDataLiquidacao) {
          const saldo = valorFatura - valorPago;
          if (saldo > 0) acc.valorAPagar += saldo;
        }
        return acc;
      },
      { valorFaturado: 0, valorPago: 0, valorAPagar: 0 },
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

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Faturas - Antecipação"
        subtitle="Consulta de faturas de clientes Antecipação"
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
              <Funnel size={18} weight="bold" />
              Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Pesquise por Nome, Nome Fantasia ou CNPJ
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
            <div className="lg:col-span-2 relative">
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Cliente (Nome / CNPJ)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={termoBusca}
                  onChange={(e) => {
                    setTermoBusca(e.target.value);
                    setClienteSelecionado(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      buscarClientes();
                    }
                  }}
                  placeholder="Digite o nome, nome fantasia ou CNPJ..."
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 pr-8 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                />
                <button
                  type="button"
                  onClick={buscarClientes}
                  disabled={
                    buscandoCliente ||
                    !termoBusca ||
                    termoBusca.trim().length < 3
                  }
                  className="absolute right-2 top-1/3 -translate-y-1/2 text-[#000638] hover:text-[#000638]/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {buscandoCliente ? (
                    <Spinner size={14} className="animate-spin" />
                  ) : (
                    <MagnifyingGlass size={14} />
                  )}
                </button>
              </div>
              {clienteSelecionado && (
                <div className="mt-1 text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle size={12} />
                  Selecionado:{' '}
                  {clienteSelecionado.fantasy_name ||
                    clienteSelecionado.nm_pessoa}{' '}
                  (Cód: {clienteSelecionado.code})
                </div>
              )}
              {showDropdownCliente && clientesEncontrados.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {clientesEncontrados.map((cli, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => selecionarCliente(cli)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 text-xs border-b border-gray-100 last:border-b-0"
                    >
                      <div className="font-medium text-gray-900">
                        {cli.fantasy_name || cli.nm_pessoa || '--'}
                      </div>
                      <div className="text-gray-500">
                        Cód: {cli.code} | CPF/CNPJ: {cli.cpf || '--'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {showDropdownCliente &&
                !buscandoCliente &&
                clientesEncontrados.length === 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-xs text-gray-500 text-center">
                    Nenhum cliente encontrado
                  </div>
                )}
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Situação
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="todos">TODOS</option>
                <option value="em_aberto">A PAGAR</option>
                <option value="pagos">PAGOS</option>
                <option value="vencidos">VENCIDOS</option>
              </select>
            </div>
            <div className="flex items-center gap-2 ">
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
                    <Receipt size={10} />
                    <span>Buscar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Cards de Resumo */}
      {dadosProcessados.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-2 mb-6 max-w-7xl mx-auto">
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-blue-600" />
                <CardTitle className="text-xs font-bold text-blue-700">
                  Valor Total
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-blue-600 mb-0.5 break-words">
                {totais.valorFaturado.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Valor total faturado
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Receipt size={14} className="text-green-600" />
                <CardTitle className="text-xs font-bold text-green-700">
                  Valor Pago
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-green-600 mb-0.5 break-words">
                {totais.valorPago.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Valor total pago
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-red-600" />
                <CardTitle className="text-xs font-bold text-red-700">
                  Valor a Pagar
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-red-600 mb-0.5 break-words">
                {totais.valorAPagar.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Valor pendente
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white rounded-lg shadow-md border border-[#000638]/10 max-w-7xl mx-auto w-full">
        <div className="p-3 border-b border-[#000638]/10 flex justify-between items-center">
          <h2 className="text-sm font-bold text-[#000638] font-barlow">
            Faturas - Antecipação
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
                  Clique em "Buscar" para carregar as informações
                </div>
                <div className="text-gray-400 text-xs">
                  Pesquise um cliente por nome, nome fantasia ou CNPJ
                </div>
              </div>
            </div>
          ) : dados.length === 0 ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="text-gray-500 text-sm mb-2">
                  Nenhum dado encontrado
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
                        Nº Fatura{getSortIcon('nr_fat')}
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
                      onClick={() => handleSort('dt_liq')}
                    >
                      <div className="flex items-center justify-center">
                        Liquidação{getSortIcon('dt_liq')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('vl_fatura')}
                    >
                      <div className="flex items-center justify-center">
                        Valor Fatura{getSortIcon('vl_fatura')}
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-center cursor-pointer hover:bg-[#000638]/80 transition-colors"
                      onClick={() => handleSort('vl_pago')}
                    >
                      <div className="flex items-center justify-center">
                        Valor Pago{getSortIcon('vl_pago')}
                      </div>
                    </th>
                    <th className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center">
                        Detalhar
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {dadosPaginados.map((item, index) => (
                    <tr key={index} className="text-sm transition-colors">
                      <td className="text-left text-gray-900 px-2 py-2">
                        {item.nm_cliente || '--'}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {item.nr_fat || '--'}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {item.nr_parcela || '--'}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {formatDateBR(item.dt_emissao)}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {formatDateBR(item.dt_vencimento)}
                      </td>
                      <td className="text-center text-gray-900 px-2 py-2">
                        {formatDateBR(item.dt_liq)}
                      </td>
                      <td className="text-center font-semibold text-green-600 px-2 py-2">
                        {(parseFloat(item.vl_fatura) || 0).toLocaleString(
                          'pt-BR',
                          { style: 'currency', currency: 'BRL' },
                        )}
                      </td>
                      <td className="text-center font-semibold text-blue-600 px-2 py-2">
                        {(parseFloat(item.vl_pago) || 0).toLocaleString(
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

      {/* Modal de Detalhes */}
      {obsModalAberto && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          style={{ zIndex: 99999 }}
        >
          <div className="bg-white rounded-lg p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                Detalhes da Fatura
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
                  Informações da Fatura
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Cliente:</span>
                    <p className="font-medium">
                      {faturaSelecionada.nm_cliente}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Nº Fatura:</span>
                    <p className="font-medium">{faturaSelecionada.nr_fat}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Parcela:</span>
                    <p className="font-medium">
                      {faturaSelecionada.nr_parcela}
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

            {/* Notas Fiscais (Invoice) */}
            <div className="border border-gray-200 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Receipt size={20} className="text-purple-600" /> Notas Fiscais
                Relacionadas
              </h3>
              <div className="min-h-[150px]">
                {/* Caso 0: Empresa 101 - Crédito */}
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
                        navigate('/nf-clientes-antecipacao');
                      }}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
                    >
                      Ir para Notas Fiscais{' '}
                      <ArrowRight size={16} weight="bold" />
                    </button>
                  </div>
                ) : /* Caso 1: Fatura tem invoice[] direto */
                faturaSelecionada?.invoice &&
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
                  /* Caso 2: Buscando NFs */
                  <div className="flex items-center justify-center py-6">
                    <div className="flex items-center gap-3">
                      <Spinner
                        size={18}
                        className="animate-spin text-purple-600"
                      />
                      <span className="text-sm text-gray-600">
                        Buscando notas fiscais do cliente...
                      </span>
                    </div>
                  </div>
                ) : notasFiscaisError ? (
                  <div className="bg-red-50 border border-red-200 rounded p-4">
                    <p className="text-sm text-red-600">{notasFiscaisError}</p>
                  </div>
                ) : notasFiscaisBuscadas.length > 0 ? (
                  /* Caso 3: NFs encontradas via busca */
                  <div className="overflow-x-auto">
                    <div className="mb-2 text-xs text-amber-600 bg-amber-50 p-2 rounded">
                      NFs encontradas por busca na data de emissão (±3 dias)
                    </div>
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
                              {nf.invoiceCode || '--'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center text-gray-900">
                              {formatDateBR(
                                nf.invoiceDate || nf.transactionDate,
                              )}
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
                  <div className="text-sm text-gray-500 text-center py-8">
                    Nenhuma nota fiscal encontrada para esta fatura.
                  </div>
                )}
              </div>
            </div>

            {/* Boleto */}
            <div className="mt-6 border border-gray-200 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FilePdf size={20} className="text-red-600" /> Boleto Bancário
              </h3>
              <button
                onClick={buscarBoleto}
                disabled={boletoLoading}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm"
              >
                {boletoLoading ? (
                  <>
                    <Spinner size={16} className="animate-spin" /> Gerando
                    Boleto...
                  </>
                ) : (
                  <>
                    <FilePdf size={16} /> Gerar Boleto
                  </>
                )}
              </button>
              {boletoError && (
                <p className="mt-2 text-sm text-red-600">{boletoError}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FaturasClientesAntecipacao;
