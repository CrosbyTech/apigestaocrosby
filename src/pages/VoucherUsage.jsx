import React, { useState, useCallback, useEffect } from 'react';
import useApiClient from '../hooks/useApiClient';
import FiltroEmpresa from '../components/FiltroEmpresa';
import PageTitle from '../components/ui/PageTitle';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '../components/ui/cards';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import {
  Ticket,
  MagnifyingGlass,
  DownloadSimple,
  CircleNotch,
  Receipt,
  Upload,
  X as IconX,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import ModalDetalharTransacao from '../components/ModalDetalharTransacao';
import { useTransacoesOperacao } from '../hooks/useTransacoesOperacao';
import { useAuth } from '../components/AuthContext';

const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'InProgress', label: 'Em andamento' },
  { value: 'Closed', label: 'Encerrado' },
  { value: 'Canceled', label: 'Cancelado' },
];

const STATUS_UPDATE_OPTIONS = [
  { value: '1', label: 'Em andamento' },
  { value: '4', label: 'Encerrado' },
  { value: '6', label: 'Cancelado' },
];

const STATUS_COLORS = {
  'Em andamento': 'bg-green-100 text-green-800',
  Encerrado: 'bg-blue-100 text-blue-800',
  Cancelado: 'bg-red-100 text-red-800',
};

const formatCurrency = (value) =>
  Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  // Extrair ano/mês/dia direto da string para evitar problemas de timezone UTC
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('pt-BR');
};

const toIsoString = (dateValue) => {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const VoucherUsage = () => {
  const { user } = useAuth();
  const { apiCall, apiMutate } = useApiClient();
  // Hook para modal de detalhes de transação
  const {
    detalharTransacao,
    fecharDetalhes,
    detalhesAberto,
    detalhesLoading,
    detalhesItens,
    detalhesErro,
  } = useTransacoesOperacao({
    transacoesPorNr: async (params) => {
      // Adapte para sua API se necessário
      const result = await apiCall('/api/sales/transacoes-por-nr', params);
      return result;
    },
  });

  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [statusVoucher, setStatusVoucher] = useState('');

  const [dados, setDados] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [sortCol, setSortCol] = useState(null); // null | string
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina, setItensPorPagina] = useState(50);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [totalItens, setTotalItens] = useState(0);
  const [phonesMap, setPhonesMap] = useState({});
  const [loadingPhones, setLoadingPhones] = useState(false);
  const [selectedVouchers, setSelectedVouchers] = useState([]);
  const [updatingSelected, setUpdatingSelected] = useState(false);
  const [updateFeedback, setUpdateFeedback] = useState(null);
  const [batchEditForm, setBatchEditForm] = useState({
    description: '',
    voucherType: '',
    status: '',
    startDate: '',
    endDate: '',
    value: '',
    printTemplateCode: '',
  });
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importedRows, setImportedRows] = useState([]);
  const [importFeedback, setImportFeedback] = useState(null);
  const [creatingVouchers, setCreatingVouchers] = useState(false);

  const userRole = user?.role || user?.user_metadata?.role;
  const canSelectMultiple = userRole === 'owner' || userRole === 'admin';

  const getVoucherKey = useCallback(
    (item, idx) =>
      item.id ||
      item.voucherId ||
      item.voucherNumber ||
      `${item.voucherNumber || 'voucher'}-${idx}`,
    [],
  );

  const toggleVoucherSelection = useCallback((voucherKey) => {
    setSelectedVouchers((current) =>
      current.includes(voucherKey)
        ? current.filter((key) => key !== voucherKey)
        : [...current, voucherKey],
    );
  }, []);

  const toggleSelectAllVisible = useCallback(
    (items) => {
      const visibleKeys = items.map((item, idx) => getVoucherKey(item, idx));

      setSelectedVouchers((current) => {
        const allVisibleSelected = visibleKeys.every((key) =>
          current.includes(key),
        );

        if (allVisibleSelected) {
          return current.filter((key) => !visibleKeys.includes(key));
        }

        return [...new Set([...current, ...visibleKeys])];
      });
    },
    [getVoucherKey],
  );

  const clearSelection = useCallback(() => {
    setSelectedVouchers([]);
  }, []);

  const resetBatchEditForm = useCallback(() => {
    setBatchEditForm({
      description: '',
      voucherType: '',
      status: '',
      startDate: '',
      endDate: '',
      value: '',
      printTemplateCode: '',
    });
  }, []);

  useEffect(() => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    const fmt = (d) => d.toISOString().split('T')[0];
    setDataInicio(fmt(primeiroDia));
    setDataFim(fmt(ultimoDia));
  }, []);

  useEffect(() => {
    setSelectedVouchers([]);
  }, [dados, canSelectMultiple]);

  const handleBatchFieldChange = useCallback((field, value) => {
    setBatchEditForm((current) => ({ ...current, [field]: value }));
  }, []);

  const fetchPhones = useCallback(
    async (dataArray) => {
      const codes = [
        ...new Set(dataArray.map((v) => v.customerCode).filter(Boolean)),
      ];
      if (codes.length === 0) return;
      setLoadingPhones(true);
      try {
        const result = await apiMutate(
          '/api/totvs/vouchers/customers/phones',
          'POST',
          { customerCodes: codes },
        );
        if (result?.success && result?.data?.phones) {
          setPhonesMap(result.data.phones);
        }
      } catch (err) {
        console.warn('Não foi possível buscar telefones:', err.message);
      } finally {
        setLoadingPhones(false);
      }
    },
    [apiMutate],
  );

  const abrirWhatsApp = useCallback(
    (item, e) => {
      e.stopPropagation();

      const telefone =
        phonesMap[String(item.customerCode)] || item.phoneNumber || '';

      if (!telefone) {
        alert('Telefone não encontrado para este cliente');
        return;
      }

      const telefoneClean = telefone.replace(/\D/g, '');

      if (!telefoneClean) {
        alert('Telefone não encontrado para este cliente');
        return;
      }

      const nomeCliente = item.customerName || 'Cliente';
      const valor = formatCurrency(item.value || 0);
      const dataFim = formatDate(item.endDate);

      const mensagemPadrao = `Olá, *${nomeCliente}*! Tudo bem? Aqui é da equipe Crosby! ✨\n\nPassando com uma ótima notícia: você tem um Cashback de *${valor}* liberado aqui no seu cadastro! 💸\n\nEsse valor já está prontinho para ser usado como desconto na sua próxima compra com a gente. Só viemos te avisar para não deixar expirar, pois ele é válido até o dia *${dataFim}*, tá bom?\n\nQue tal aproveitar para conferir as novidades? Se quiser ver algumas peças, é só me chamar aqui! 😉`;

      const mensagemCodificada = encodeURIComponent(mensagemPadrao);
      window.open(
        `https://wa.me/55${telefoneClean}?text=${mensagemCodificada}`,
        '_blank',
      );
    },
    [phonesMap],
  );

  const buscar = useCallback(
    async (pagina = 1) => {
      if (!dataInicio || !dataFim) return;
      setLoading(true);
      setErro(null);
      setPaginaAtual(pagina);

      try {
        const params = {
          startDateInitial: dataInicio,
          startDateFinal: dataFim,
          enrich: 'true',
          page: pagina,
          pageSize: itensPorPagina,
        };
        if (statusVoucher) params.status = statusVoucher;

        const branchCodes = empresasSelecionadas.map((emp) =>
          Number(emp.cd_empresa),
        );

        if (branchCodes.length > 0) {
          let allData = [];
          let totalSummary = {
            total: 0,
            totalPages: 1,
            totalValue: 0,
            statusCounts: {},
            queryTime: 0,
          };

          // Busca todas as empresas em paralelo
          const resultados = await Promise.all(
            branchCodes.map((code) =>
              apiCall('/api/totvs/vouchers/search', {
                ...params,
                branchCode: code,
              }),
            ),
          );
          for (const result of resultados) {
            if (result?.success) {
              const dataArray = Array.isArray(result.data) ? result.data : [];
              const sum = result.metadata?.data?.summary || {};
              allData = allData.concat(dataArray);
              totalSummary.total += sum.total || 0;
              totalSummary.totalPages = Math.max(
                totalSummary.totalPages,
                sum.totalPages || 1,
              );
              totalSummary.totalValue += sum.totalValue || 0;
              totalSummary.queryTime = Math.max(
                totalSummary.queryTime,
                sum.queryTime || 0,
              );
              for (const [key, val] of Object.entries(sum.statusCounts || {})) {
                totalSummary.statusCounts[key] =
                  (totalSummary.statusCounts[key] || 0) + val;
              }
            }
          }
          setDados(allData);
          setSummary(totalSummary);
          setTotalPaginas(totalSummary.totalPages);
          setTotalItens(totalSummary.total);
          fetchPhones(allData);
        } else {
          const result = await apiCall('/api/totvs/vouchers/search', params);
          if (result?.success) {
            const dataArray = Array.isArray(result.data) ? result.data : [];
            const sum = result.metadata?.data?.summary || null;
            setDados(dataArray);
            setSummary(sum);
            setTotalPaginas(sum?.totalPages || 1);
            setTotalItens(sum?.total || dataArray.length);
            fetchPhones(dataArray);
          } else {
            setErro(result?.message || 'Erro ao buscar dados');
            setDados([]);
            setSummary(null);
          }
        }
      } catch (err) {
        setErro(err.message || 'Erro ao buscar dados');
        setDados([]);
        setSummary(null);
      } finally {
        setLoading(false);
      }
    },
    [
      dataInicio,
      dataFim,
      empresasSelecionadas,
      statusVoucher,
      itensPorPagina,
      apiCall,
      fetchPhones,
    ],
  );

  const exportarExcel = () => {
    if (dados.length === 0) return;
    const rows = dados.map((d) => ({
      Voucher: d.voucherNumber,
      Status: d.statusLabel,
      Cliente: d.customerCode,
      Nome: d.customerName || '',
      Valor: d.value,
      'Data Início': formatDate(d.startDate),
      'Data Fim': formatDate(d.endDate),
      Filial: d.branchCode,
      Transação: d.lastPurchase?.transactionCode || '',
      'Data Compra': d.lastPurchase
        ? formatDate(d.lastPurchase.transactionDate)
        : '',
      'Desconto %': d.lastPurchase?.discountPercentage || '',
      'Desconto R$': d.lastPurchase?.discountValue || '',
      'Valor Compra': d.lastPurchase?.totalValue || '',
      'Valor Bruto': d.lastPurchase
        ? (d.lastPurchase.totalValueBruto ??
          (d.lastPurchase.totalValue || 0) +
            (d.lastPurchase.discountValue || 0))
        : null,
      'Valor com Desconto': d.lastPurchase?.totalValue ?? null,
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 30 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Vouchers');
    XLSX.writeFile(wb, `vouchers_${dataInicio}_${dataFim}.xlsx`);
  };

  const getSelectedItems = useCallback(
    () =>
      dados.filter((item, idx) =>
        selectedVouchers.includes(getVoucherKey(item, idx)),
      ),
    [dados, getVoucherKey, selectedVouchers],
  );

  const buildVoucherPayload = useCallback(
    (items, overrides = {}) => {
      const effectiveEndDate =
        overrides.endDate === undefined ? null : overrides.endDate;

      return items.map((item) => ({
        voucherNumber: Number(item.voucherNumber),
        description:
          overrides.description ??
          (batchEditForm.description.trim() ||
            item.description ||
            `Voucher ${item.voucherNumber}`),
        voucherType:
          overrides.voucherType ??
          (batchEditForm.voucherType !== ''
            ? Number(batchEditForm.voucherType)
            : Number(item.voucherType)),
        status:
          overrides.status ??
          (batchEditForm.status !== ''
            ? Number(batchEditForm.status)
            : Number(item.status)),
        startDate:
          overrides.startDate ??
          (batchEditForm.startDate
            ? toIsoString(batchEditForm.startDate)
            : item.startDate),
        endDate:
          effectiveEndDate ??
          (batchEditForm.endDate
            ? toIsoString(batchEditForm.endDate)
            : item.endDate),
        value:
          overrides.value ??
          (batchEditForm.value !== ''
            ? Number(batchEditForm.value)
            : Number(item.value)),
        printTemplateCode:
          overrides.printTemplateCode ??
          (batchEditForm.printTemplateCode !== ''
            ? Number(batchEditForm.printTemplateCode)
            : Number(item.printTemplateCode)),
      }));
    },
    [batchEditForm],
  );

  const submitVoucherUpdate = useCallback(
    async (payload, successMessages) => {
      const invalidVoucher = payload.find(
        (item) =>
          !Number.isFinite(item.voucherNumber) ||
          !item.description ||
          !Number.isFinite(item.voucherType) ||
          !Number.isFinite(item.status) ||
          !item.startDate ||
          !item.endDate ||
          !Number.isFinite(item.value) ||
          !Number.isFinite(item.printTemplateCode),
      );

      if (invalidVoucher) {
        setUpdateFeedback({
          type: 'error',
          message: `Preencha os campos obrigatórios para o voucher ${invalidVoucher.voucherNumber}. Se algum dado vier vazio da TOTVS, informe manualmente no painel antes de salvar.`,
        });
        return false;
      }

      setUpdatingSelected(true);
      setUpdateFeedback(null);

      try {
        const result = await apiMutate(
          '/api/totvs/vouchers/update-batch',
          'POST',
          { vouchers: payload },
        );
        const totalFailed = result?.data?.totalFailed || 0;
        const totalUpdated = result?.data?.totalUpdated || 0;

        setUpdateFeedback({
          type: totalFailed > 0 ? 'warning' : 'success',
          message:
            totalFailed > 0
              ? `${totalUpdated} voucher(s) atualizados e ${totalFailed} com falha.`
              : successMessages?.success ||
                `${totalUpdated} voucher(s) atualizados com sucesso.`,
        });

        resetBatchEditForm();
        clearSelection();
        await buscar(paginaAtual);
        return true;
      } catch (err) {
        setUpdateFeedback({
          type: 'error',
          message: err.message || 'Erro ao atualizar vouchers marcados.',
        });
        return false;
      } finally {
        setUpdatingSelected(false);
      }
    },
    [apiMutate, buscar, clearSelection, paginaAtual, resetBatchEditForm],
  );

  const handleBatchUpdate = useCallback(async () => {
    const selectedItems = getSelectedItems();

    if (selectedItems.length === 0) {
      setUpdateFeedback({
        type: 'error',
        message: 'Selecione pelo menos um voucher para alterar.',
      });
      return;
    }

    const payload = buildVoucherPayload(selectedItems);

    await submitVoucherUpdate(payload);
  }, [buildVoucherPayload, getSelectedItems, submitVoucherUpdate]);

  const handleCloseSelected = useCallback(async () => {
    const selectedItems = getSelectedItems();

    if (selectedItems.length === 0) {
      setUpdateFeedback({
        type: 'error',
        message: 'Selecione pelo menos um voucher para encerrar.',
      });
      return;
    }

    const itemsToClose = selectedItems.filter(
      (item) => Number(item.status) !== 4,
    );

    if (itemsToClose.length === 0) {
      setUpdateFeedback({
        type: 'warning',
        message: 'Os vouchers marcados já estão encerrados.',
      });
      return;
    }

    const confirmed = window.confirm(
      `Confirmar encerramento de ${itemsToClose.length} voucher${itemsToClose.length === 1 ? '' : 's'} marcado${itemsToClose.length === 1 ? '' : 's'}?`,
    );

    if (!confirmed) {
      return;
    }

    const nowIso = new Date().toISOString();
    const payload = buildVoucherPayload(itemsToClose, {
      status: 4,
      endDate: nowIso,
    });

    await submitVoucherUpdate(payload, {
      success: `${itemsToClose.length} voucher(s) encerrado(s) com sucesso.`,
    });
  }, [buildVoucherPayload, getSelectedItems, submitVoucherUpdate]);

  const handleImportExcel = useCallback(async (file) => {
    setImportFeedback(null);
    setImportedRows([]);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = e.target.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(worksheet);

          if (rows.length === 0) {
            setImportFeedback({
              type: 'error',
              message: 'O arquivo Excel está vazio.',
            });
            return;
          }

          // Validar linhas
          const validRows = [];
          const errors = [];

          rows.forEach((row, index) => {
            const linhaNum = index + 2; // Começar em 2 porque a primeira linha tem headers
            const errosLinha = [];

            const branchCodeRegistration = Number(row.branchCodeRegistration);
            if (isNaN(branchCodeRegistration) || branchCodeRegistration <= 0) {
              errosLinha.push('branchCodeRegistration inválido');
            }

            const prefixCode = String(row.prefixCode || '').trim();
            if (!prefixCode) {
              errosLinha.push('prefixCode obrigatório');
            }

            const voucherType = Number(row.voucherType);
            if (isNaN(voucherType)) {
              errosLinha.push('voucherType inválido');
            }

            const status = Number(row.status);
            if (isNaN(status)) {
              errosLinha.push('status inválido');
            }

            const startDate = row.startDate
              ? new Date(row.startDate).toISOString()
              : null;
            if (!startDate) {
              errosLinha.push('startDate inválida');
            }

            const endDate = row.endDate
              ? new Date(row.endDate).toISOString()
              : null;
            if (!endDate) {
              errosLinha.push('endDate inválida');
            }

            if (errosLinha.length > 0) {
              errors.push({ linha: linhaNum, mensagens: errosLinha });
              return;
            }

            validRows.push({
              index,
              branchCodeRegistration,
              prefixCode,
              voucherType,
              status,
              startDate,
              endDate,
              description: String(row.description || '').trim(),
              value:
                row.value !== undefined && row.value !== ''
                  ? Number(row.value)
                  : undefined,
              percentage:
                row.percentage !== undefined && row.percentage !== ''
                  ? Number(row.percentage)
                  : undefined,
              quantity:
                row.quantity !== undefined && row.quantity !== ''
                  ? Number(row.quantity)
                  : undefined,
              printTemplateCode:
                row.printTemplateCode !== undefined &&
                row.printTemplateCode !== ''
                  ? Number(row.printTemplateCode)
                  : undefined,
            });
          });

          if (errors.length > 0) {
            const errorMsg = errors
              .map((err) => `Linha ${err.linha}: ${err.mensagens.join(', ')}`)
              .join('\n');
            setImportFeedback({
              type: 'error',
              message: `Erros de validação:\n${errorMsg}`,
            });
            return;
          }

          setImportedRows(validRows);
          setImportFeedback({
            type: 'success',
            message: `${validRows.length} voucher(s) pronto(s) para criar. Revise nos detalhes abaixo.`,
          });
        } catch (err) {
          setImportFeedback({
            type: 'error',
            message: `Erro ao processar arquivo: ${err.message}`,
          });
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      setImportFeedback({
        type: 'error',
        message: `Erro ao ler arquivo: ${err.message}`,
      });
    }
  }, []);

  const submitCreateVouchers = useCallback(async () => {
    if (importedRows.length === 0) {
      setImportFeedback({
        type: 'error',
        message: 'Nenhum voucher para criar.',
      });
      return;
    }

    const confirmed = window.confirm(
      `Confirmar criação de ${importedRows.length} voucher${importedRows.length === 1 ? '' : 's'}?`,
    );

    if (!confirmed) {
      return;
    }

    setCreatingVouchers(true);
    setImportFeedback(null);

    try {
      const payload = {
        vouchers: importedRows.map((row) => {
          const obj = {
            branchCodeRegistration: row.branchCodeRegistration,
            prefixCode: row.prefixCode,
            voucherType: row.voucherType,
            status: row.status,
            startDate: row.startDate,
            endDate: row.endDate,
          };

          if (row.description) obj.description = row.description;
          if (row.value !== undefined) obj.value = row.value;
          if (row.percentage !== undefined) obj.percentage = row.percentage;
          if (row.quantity !== undefined) obj.quantity = row.quantity;
          if (row.printTemplateCode !== undefined)
            obj.printTemplateCode = row.printTemplateCode;

          return obj;
        }),
      };

      const result = await apiMutate(
        '/api/totvs/vouchers/create-batch',
        'POST',
        payload,
      );

      const totalCreated = result?.data?.totalCreated || 0;
      const totalFailed = result?.data?.totalFailed || 0;

      setImportFeedback({
        type: totalFailed > 0 ? 'warning' : 'success',
        message:
          totalFailed > 0
            ? `${totalCreated} voucher(s) criado(s) e ${totalFailed} com falha.`
            : `${totalCreated} voucher(s) criado(s) com sucesso.`,
      });

      if (totalCreated > 0) {
        setImportedRows([]);
        setShowImportPanel(false);
        await buscar(paginaAtual);
      }
    } catch (err) {
      setImportFeedback({
        type: 'error',
        message: `Erro ao criar vouchers: ${err.message}`,
      });
    } finally {
      setCreatingVouchers(false);
    }
  }, [importedRows, apiMutate, buscar, paginaAtual]);

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      <PageTitle
        title="Vouchers"
        subtitle="Consulta de vouchers TOTVS por período, empresa e status"
        icon={Ticket}
        iconColor="text-purple-600"
      />

      {/* Filtros */}
      <Card className="shadow-lg rounded-xl bg-white mb-6">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <MagnifyingGlass size={18} className="text-[#000638]" />
            <CardTitle className="text-sm font-bold text-[#000638]">
              Filtros
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <CardDescription className="text-xs text-gray-500 mb-4">
            Configure os filtros para consulta de vouchers
          </CardDescription>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={setEmpresasSelecionadas}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Início
              </label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Fim
              </label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Status
              </label>
              <select
                value={statusVoucher}
                onChange={(e) => setStatusVoucher(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-transparent select-none">
                .
              </label>
              <button
                onClick={() => buscar(1)}
                disabled={loading || !dataInicio || !dataFim}
                className="flex items-center gap-2 bg-[#000638] text-white px-4 py-1.5 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors w-full justify-center text-sm"
              >
                {loading ? (
                  <>
                    <CircleNotch size={16} className="animate-spin" />
                    Buscando...
                  </>
                ) : (
                  <>
                    <MagnifyingGlass size={16} />
                    Buscar
                  </>
                )}
              </button>
            </div>
          </div>

          {dados.length > 0 && (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {canSelectMultiple ? (
                <div className="flex items-center gap-3 text-xs text-gray-600">
                  <span>
                    {selectedVouchers.length} voucher
                    {selectedVouchers.length === 1 ? '' : 's'} marcado
                    {selectedVouchers.length === 1 ? '' : 's'}
                  </span>
                  {selectedVouchers.length > 0 && (
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="text-[#000638] hover:text-[#fe0000] font-medium transition-colors"
                    >
                      Limpar seleção
                    </button>
                  )}
                </div>
              ) : (
                <div />
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {canSelectMultiple && (
                  <button
                    onClick={() => setShowImportPanel(!showImportPanel)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 font-medium transition-colors text-xs justify-center"
                  >
                    <Upload size={14} />
                    Importar Excel
                  </button>
                )}
                <button
                  onClick={exportarExcel}
                  className="flex items-center gap-2 bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 font-medium transition-colors text-xs justify-center"
                >
                  <DownloadSimple size={14} />
                  Exportar Excel
                </button>
              </div>
            </div>
          )}

          {canSelectMultiple && showImportPanel && (
            <div className="mt-4 rounded-xl border border-blue-300 bg-blue-50 p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold text-[#000638]">
                    Importar vouchers por Excel
                  </h3>
                  <p className="text-xs text-gray-600">
                    Faça upload de um arquivo Excel com as colunas:
                    branchCodeRegistration, prefixCode, voucherType, status,
                    startDate, endDate (opcionais: description, value,
                    percentage, quantity, printTemplateCode)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowImportPanel(false);
                    setImportedRows([]);
                    setImportFeedback(null);
                  }}
                  className="text-gray-600 hover:text-gray-800"
                >
                  <IconX size={20} />
                </button>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-semibold mb-2 text-[#000638]">
                  Selecionar arquivo Excel
                </label>
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleImportExcel(file);
                      }
                    }}
                    disabled={creatingVouchers}
                    className="block flex-1 text-xs text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-[#000638] file:text-white hover:file:bg-[#fe0000]"
                  />
                  <a
                    href="/api/totvs/vouchers/import-template"
                    download="template_vouchers.xlsx"
                    className="flex items-center gap-1 bg-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-300 font-medium transition-colors text-xs"
                  >
                    <DownloadSimple size={14} />
                    Template
                  </a>
                </div>
              </div>

              {importFeedback && (
                <div
                  className={`mb-4 rounded-lg px-3 py-2 text-xs ${
                    importFeedback.type === 'error'
                      ? 'bg-red-100 text-red-700 border border-red-300'
                      : importFeedback.type === 'warning'
                        ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                        : 'bg-green-100 text-green-700 border border-green-300'
                  }`}
                >
                  {importFeedback.message}
                </div>
              )}

              {importedRows.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-xs font-semibold text-[#000638] mb-2">
                    Prévia dos vouchers a criar ({importedRows.length})
                  </h4>
                  <div className="max-h-60 overflow-y-auto border border-blue-200 rounded-lg bg-white">
                    <table className="w-full text-xs">
                      <thead className="bg-blue-100 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-left">#</th>
                          <th className="px-2 py-1 text-left">Prefixo</th>
                          <th className="px-2 py-1 text-left">Filial</th>
                          <th className="px-2 py-1 text-left">Tipo</th>
                          <th className="px-2 py-1 text-left">Status</th>
                          <th className="px-2 py-1 text-left">Valor</th>
                          <th className="px-2 py-1 text-left">Descrição</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importedRows.slice(0, 10).map((row) => (
                          <tr
                            key={row.index}
                            className="border-t border-blue-200 hover:bg-blue-50"
                          >
                            <td className="px-2 py-1">{row.index + 1}</td>
                            <td className="px-2 py-1">{row.prefixCode}</td>
                            <td className="px-2 py-1">
                              {row.branchCodeRegistration}
                            </td>
                            <td className="px-2 py-1">{row.voucherType}</td>
                            <td className="px-2 py-1">{row.status}</td>
                            <td className="px-2 py-1">
                              {row.value !== undefined
                                ? formatCurrency(row.value)
                                : '—'}
                            </td>
                            <td className="px-2 py-1 truncate">
                              {row.description || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {importedRows.length > 10 && (
                      <div className="px-2 py-2 text-xs text-gray-600 bg-blue-50 border-t border-blue-200">
                        ... e {importedRows.length - 10} mais
                      </div>
                    )}
                  </div>
                </div>
              )}

              {importedRows.length > 0 && (
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setImportedRows([]);
                      setImportFeedback(null);
                    }}
                    disabled={creatingVouchers}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 text-xs font-medium transition-colors"
                  >
                    Limpar seleção
                  </button>
                  <button
                    type="button"
                    onClick={submitCreateVouchers}
                    disabled={creatingVouchers}
                    className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors"
                  >
                    {creatingVouchers ? (
                      <>
                        <CircleNotch size={14} className="animate-spin" />
                        Criando vouchers...
                      </>
                    ) : (
                      `Criar ${importedRows.length} voucher${importedRows.length === 1 ? '' : 's'}`
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {canSelectMultiple && selectedVouchers.length > 0 && (
            <div className="mt-4 rounded-xl border border-[#000638]/10 bg-[#f8f9fb] p-4">
              <div className="flex flex-col gap-1 mb-4">
                <h3 className="text-sm font-semibold text-[#000638]">
                  Alterar vouchers marcados
                </h3>
                <p className="text-xs text-gray-500">
                  Preencha apenas os campos que deseja sobrescrever. Campos em
                  branco mantêm o valor atual de cada voucher.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="xl:col-span-2">
                  <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                    Descrição
                  </label>
                  <input
                    type="text"
                    value={batchEditForm.description}
                    onChange={(e) =>
                      handleBatchFieldChange('description', e.target.value)
                    }
                    placeholder="Manter descrição atual"
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] placeholder:text-gray-400 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                    Tipo do voucher
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={batchEditForm.voucherType}
                    onChange={(e) =>
                      handleBatchFieldChange('voucherType', e.target.value)
                    }
                    placeholder="Manter atual"
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] placeholder:text-gray-400 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                    Status
                  </label>
                  <select
                    value={batchEditForm.status}
                    onChange={(e) =>
                      handleBatchFieldChange('status', e.target.value)
                    }
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] text-xs"
                  >
                    <option value="">Manter atual</option>
                    {STATUS_UPDATE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                    Data inicial
                  </label>
                  <input
                    type="datetime-local"
                    value={batchEditForm.startDate}
                    onChange={(e) =>
                      handleBatchFieldChange('startDate', e.target.value)
                    }
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                    Data final
                  </label>
                  <input
                    type="datetime-local"
                    value={batchEditForm.endDate}
                    onChange={(e) =>
                      handleBatchFieldChange('endDate', e.target.value)
                    }
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                    Valor
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={batchEditForm.value}
                    onChange={(e) =>
                      handleBatchFieldChange('value', e.target.value)
                    }
                    placeholder="Manter atual"
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] placeholder:text-gray-400 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                    Template de impressão
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={batchEditForm.printTemplateCode}
                    onChange={(e) =>
                      handleBatchFieldChange(
                        'printTemplateCode',
                        e.target.value,
                      )
                    }
                    placeholder="Manter atual"
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-white text-[#000638] placeholder:text-gray-400 text-xs"
                  />
                </div>
              </div>

              {updateFeedback && (
                <div
                  className={`mt-4 rounded-lg px-3 py-2 text-xs ${
                    updateFeedback.type === 'error'
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : updateFeedback.type === 'warning'
                        ? 'bg-yellow-50 text-yellow-800 border border-yellow-200'
                        : 'bg-green-50 text-green-700 border border-green-200'
                  }`}
                >
                  {updateFeedback.message}
                </div>
              )}

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={handleCloseSelected}
                  disabled={updatingSelected}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors"
                >
                  Encerrar vouchers marcados
                </button>
                <button
                  type="button"
                  onClick={resetBatchEditForm}
                  disabled={updatingSelected}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 text-xs font-medium transition-colors"
                >
                  Limpar campos
                </button>
                <button
                  type="button"
                  onClick={handleBatchUpdate}
                  disabled={updatingSelected}
                  className="flex items-center justify-center gap-2 bg-[#000638] text-white px-4 py-2 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors"
                >
                  {updatingSelected ? (
                    <>
                      <CircleNotch size={14} className="animate-spin" />
                      Salvando alterações...
                    </>
                  ) : (
                    'Salvar alterações nos marcados'
                  )}
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
          {erro}
        </div>
      )}

      {/* Cards de Resumo */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Receipt size={18} className="text-blue-600" />
                <CardTitle className="text-sm font-bold text-blue-700">
                  Total Vouchers
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <div className="text-base font-extrabold text-blue-600 mb-0.5">
                {summary.total}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Vouchers encontrados
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Receipt size={18} className="text-green-600" />
                <CardTitle className="text-sm font-bold text-green-700">
                  Valor Total
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <div className="text-base font-extrabold text-green-600 mb-0.5">
                {formatCurrency(summary.totalValue)}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Soma dos valores dos vouchers
              </CardDescription>
            </CardContent>
          </Card>

          {Object.entries(summary.statusCounts || {}).map(([label, count]) => (
            <Card
              key={label}
              className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white"
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Receipt size={18} className="text-orange-600" />
                  <CardTitle className="text-sm font-bold text-orange-700">
                    {label}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-base font-extrabold text-orange-600 mb-0.5">
                  {count}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Vouchers com status {label.toLowerCase()}
                </CardDescription>
              </CardContent>
            </Card>
          ))}

          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Receipt size={18} className="text-purple-600" />
                <CardTitle className="text-sm font-bold text-purple-700">
                  Valor Total Transações
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <div className="text-base font-extrabold text-purple-600 mb-0.5">
                {formatCurrency(
                  dados.reduce(
                    (sum, v) => sum + (v.lastPurchase?.totalValue || 0),
                    0,
                  ),
                )}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Soma das transações com voucher
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabela */}
      <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Ticket size={18} className="text-[#000638]" />
            <CardTitle className="text-sm font-bold text-[#000638]">
              Lista de Vouchers
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <CardDescription className="text-xs text-gray-500 mb-4">
            Detalhes de todos os vouchers encontrados
          </CardDescription>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="md" text="Carregando vouchers..." />
            </div>
          ) : dados.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Ticket size={48} className="mb-3" />
              <p className="text-lg font-medium">
                {summary === null
                  ? 'Selecione o período e clique em Buscar'
                  : 'Nenhum voucher encontrado'}
              </p>
              <p className="text-sm mt-1">
                Busca vouchers na API TOTVS por período, empresa e status
              </p>
            </div>
          ) : (
            (() => {
              const handleSort = (col) => {
                setSortCol((prev) => {
                  if (prev === col) {
                    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                    return col;
                  }
                  setSortDir('asc');
                  return col;
                });
              };
              const sortIcon = (col) => {
                if (sortCol !== col)
                  return <span className="text-gray-300">↕</span>;
                return (
                  <span className="text-blue-500">
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </span>
                );
              };
              const dadosOrdenados = sortCol
                ? [...dados].sort((a, b) => {
                    let vA, vB;
                    if (sortCol === 'voucher') {
                      vA = a.voucherNumber || '';
                      vB = b.voucherNumber || '';
                    } else if (sortCol === 'status') {
                      vA = a.statusLabel || '';
                      vB = b.statusLabel || '';
                    } else if (sortCol === 'cliente') {
                      vA = a.customerName || '';
                      vB = b.customerName || '';
                    } else if (sortCol === 'valor') {
                      vA = a.value || 0;
                      vB = b.value || 0;
                    } else if (sortCol === 'filial') {
                      vA = a.branchCode || 0;
                      vB = b.branchCode || 0;
                    } else if (sortCol === 'inicio') {
                      vA = a.startDate || '';
                      vB = b.startDate || '';
                    } else if (sortCol === 'fim') {
                      vA = a.endDate || '';
                      vB = b.endDate || '';
                    } else if (sortCol === 'bruto') {
                      vA =
                        (a.lastPurchase?.totalValue || 0) +
                        (a.lastPurchase?.discountValue || 0);
                      vB =
                        (b.lastPurchase?.totalValue || 0) +
                        (b.lastPurchase?.discountValue || 0);
                    } else if (sortCol === 'liquido') {
                      vA = a.lastPurchase?.totalValue ?? -1;
                      vB = b.lastPurchase?.totalValue ?? -1;
                    } else if (sortCol === 'desconto') {
                      vA = a.lastPurchase?.discountPercentage ?? -1;
                      vB = b.lastPurchase?.discountPercentage ?? -1;
                    } else {
                      vA = 0;
                      vB = 0;
                    }
                    if (typeof vA === 'string')
                      return sortDir === 'asc'
                        ? vA.localeCompare(vB)
                        : vB.localeCompare(vA);
                    return sortDir === 'asc' ? vA - vB : vB - vA;
                  })
                : dados;
              const visibleVoucherKeys = dadosOrdenados.map((item, idx) =>
                getVoucherKey(item, idx),
              );
              const allVisibleSelected =
                visibleVoucherKeys.length > 0 &&
                visibleVoucherKeys.every((key) =>
                  selectedVouchers.includes(key),
                );
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                      <tr>
                        {canSelectMultiple && (
                          <th className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={allVisibleSelected}
                              onChange={() =>
                                toggleSelectAllVisible(dadosOrdenados)
                              }
                              aria-label="Selecionar todos os vouchers visíveis"
                              className="h-4 w-4 rounded border-gray-300 text-[#000638] focus:ring-[#000638]"
                            />
                          </th>
                        )}
                        {[
                          ['voucher', 'Voucher'],
                          ['status', 'Status'],
                          ['cliente', 'Cliente'],
                          ['valor', 'Valor'],
                          ['filial', 'Filial'],
                          ['inicio', 'Data Início'],
                          ['fim', 'Data Fim'],
                        ].map(([col, label]) => (
                          <th
                            key={col}
                            className="px-4 py-3 cursor-pointer select-none hover:bg-gray-100 transition-colors"
                            onClick={() => handleSort(col)}
                          >
                            <span className="flex items-center gap-1">
                              {label} {sortIcon(col)}
                            </span>
                          </th>
                        ))}
                        <th className="px-4 py-3">Transação</th>
                        {[
                          ['bruto', 'Valor Bruto'],
                          ['liquido', 'Valor c/ Desconto'],
                          ['desconto', 'Desconto'],
                        ].map(([col, label]) => (
                          <th
                            key={col}
                            className="px-4 py-3 cursor-pointer select-none hover:bg-gray-100 transition-colors"
                            onClick={() => handleSort(col)}
                          >
                            <span className="flex items-center gap-1">
                              {label} {sortIcon(col)}
                            </span>
                          </th>
                        ))}
                        <th className="px-4 py-3 text-center">WhatsApp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dadosOrdenados.map((item, idx) => {
                        const voucherKey = getVoucherKey(item, idx);
                        const isSelected =
                          selectedVouchers.includes(voucherKey);
                        // Valor bruto: se não existir campo, soma valor final + desconto
                        const valorBruto = item.lastPurchase
                          ? (item.lastPurchase.totalValueBruto ??
                            (item.lastPurchase.totalValue || 0) +
                              (item.lastPurchase.discountValue || 0))
                          : null;
                        const valorComDesconto =
                          item.lastPurchase?.totalValue ?? null;
                        return (
                          <tr
                            key={voucherKey}
                            className={`border-b transition-colors ${isSelected ? 'bg-blue-100' : 'bg-white hover:bg-blue-50'}`}
                          >
                            {canSelectMultiple && (
                              <td
                                className="px-4 py-3 text-center"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() =>
                                    toggleVoucherSelection(voucherKey)
                                  }
                                  aria-label={`Selecionar voucher ${item.voucherNumber || idx + 1}`}
                                  className="h-4 w-4 rounded border-gray-300 text-[#000638] focus:ring-[#000638]"
                                />
                              </td>
                            )}
                            <td className="px-4 py-3 font-medium text-gray-900">
                              <span className="bg-purple-100 text-purple-800 text-xs font-medium px-2 py-1 rounded">
                                {item.voucherNumber}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[item.statusLabel] || 'bg-gray-100 text-gray-600'}`}
                              >
                                {item.statusLabel}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900">
                              <div>{item.customerName || '—'}</div>
                              <div className="text-xs text-gray-400">
                                {item.customerCode || '—'}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-medium text-green-600">
                              {formatCurrency(item.value)}
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900">
                              <span className="bg-indigo-100 text-indigo-800 text-xs font-medium px-2 py-1 rounded">
                                {item.branchCode || '—'}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {formatDate(item.startDate)}
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {formatDate(item.endDate)}
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {item.lastPurchase ? (
                                <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-1 rounded">
                                  {item.lastPurchase.transactionCode}
                                </span>
                              ) : item.statusLabel === 'Encerrado' ? (
                                <span className="text-xs text-gray-400">
                                  Não encontrada
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {valorBruto !== null
                                ? formatCurrency(valorBruto)
                                : '—'}
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {valorComDesconto !== null
                                ? formatCurrency(valorComDesconto)
                                : '—'}
                            </td>
                            <td className="px-4 py-3 font-medium">
                              {item.lastPurchase ? (
                                <div>
                                  <div className="text-red-600 font-semibold">
                                    {formatCurrency(
                                      item.lastPurchase.discountValue,
                                    )}
                                  </div>
                                  <div
                                    className={`text-xs font-medium px-1.5 py-0.5 rounded inline-block ${
                                      item.lastPurchase.discountPercentage > 20
                                        ? 'bg-red-100 text-red-700 border border-red-300 animate-pulse'
                                        : 'bg-green-100 text-green-700 border border-green-300'
                                    }`}
                                  >
                                    {item.lastPurchase.discountPercentage.toFixed(
                                      2,
                                    )}
                                    %
                                  </div>
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td
                              className="px-4 py-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {phonesMap[String(item.customerCode)] ||
                              item.phoneNumber ? (
                                <button
                                  onClick={(e) => abrirWhatsApp(item, e)}
                                  className="bg-green-500 hover:bg-green-600 text-white text-xs font-medium px-3 py-1 rounded transition-colors flex items-center gap-1"
                                  title="Abrir WhatsApp"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    className="w-4 h-4"
                                  >
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                                  </svg>
                                </button>
                              ) : (
                                <span className="text-gray-300 text-xs">
                                  {loadingPhones ? '...' : '—'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()
          )}

          {/* Paginação */}
          {!loading && totalPaginas > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100">
              <div className="text-xs text-gray-500">
                Mostrando{' '}
                {Math.min((paginaAtual - 1) * itensPorPagina + 1, totalItens)}–
                {Math.min(paginaAtual * itensPorPagina, totalItens)} de{' '}
                {totalItens} vouchers
              </div>
              <div className="flex items-center gap-1">
                <button
                  disabled={paginaAtual <= 1 || loading}
                  onClick={() => buscar(1)}
                  className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-100 transition-colors"
                >
                  «
                </button>
                <button
                  disabled={paginaAtual <= 1 || loading}
                  onClick={() => buscar(paginaAtual - 1)}
                  className="px-3 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-100 transition-colors"
                >
                  Anterior
                </button>
                <span className="text-xs text-gray-700 px-3">
                  Página <strong>{paginaAtual}</strong> de{' '}
                  <strong>{totalPaginas}</strong>
                </span>
                <button
                  disabled={paginaAtual >= totalPaginas || loading}
                  onClick={() => buscar(paginaAtual + 1)}
                  className="px-3 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-100 transition-colors"
                >
                  Próxima
                </button>
                <button
                  disabled={paginaAtual >= totalPaginas || loading}
                  onClick={() => buscar(totalPaginas)}
                  className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-100 transition-colors"
                >
                  »
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Itens/página:</label>
                <select
                  value={itensPorPagina}
                  onChange={(e) => {
                    setItensPorPagina(Number(e.target.value));
                    buscar(1);
                  }}
                  className="text-xs border border-gray-200 rounded px-1 py-0.5"
                >
                  {[25, 50, 100, 200].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default VoucherUsage;
