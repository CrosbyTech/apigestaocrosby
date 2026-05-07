import React, { useState, useCallback } from 'react';
import {
  Funnel,
  Spinner,
  ChartBar,
  Users,
  CreditCard,
  Storefront,
  WarningCircle,
  ArrowCounterClockwise,
} from '@phosphor-icons/react';
import PageTitle from './ui/PageTitle';
import FiltroEmpresa from './FiltroEmpresa';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from './ui/cards';
import {
  getOperationsFiscalMovement,
  getSellerFiscalMovement,
  getPaymentFiscalMovement,
} from '../services/fiscalMovementService';

// ─── helpers ─────────────────────────────────────────────────────────────────

const formatBRL = (v) =>
  typeof v === 'number'
    ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : v !== undefined && v !== null
      ? String(v)
      : '—';

const today = () => new Date().toISOString().split('T')[0];
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
};

// ─── sub-componentes ──────────────────────────────────────────────────────────

function ResultTable({ rows, columns, emptyText = 'Nenhum dado encontrado.' }) {
  if (!rows || rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 px-2 py-4 text-center">{emptyText}</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap ${col.headerClass ?? ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 text-gray-700 ${col.cellClass ?? ''}`}
                >
                  {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionCard({ title, icon: Icon, iconClass, data, columns }) {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.data)
        ? data.data
        : [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon size={18} className={iconClass} />
          {title}
          {rows.length > 0 && (
            <span className="ml-auto text-xs font-normal text-gray-500">
              {rows.length} {rows.length === 1 ? 'registro' : 'registros'}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResultTable rows={rows} columns={columns} />
      </CardContent>
    </Card>
  );
}

// ─── colunas de cada seção ────────────────────────────────────────────────────

const opColumns = [
  { key: 'operationCode', label: 'Cód. Operação' },
  { key: 'operationDescription', label: 'Operação' },
  { key: 'invoiceQty', label: 'Qtd. NFs' },
  {
    key: 'totalValue',
    label: 'Total (R$)',
    render: (v) => formatBRL(v),
    cellClass: 'font-medium text-right',
    headerClass: 'text-right',
  },
];

const sellerColumns = [
  { key: 'sellerCode', label: 'Cód. Vendedor' },
  { key: 'sellerName', label: 'Vendedor' },
  { key: 'invoiceQty', label: 'Qtd. NFs' },
  {
    key: 'totalValue',
    label: 'Total (R$)',
    render: (v) => formatBRL(v),
    cellClass: 'font-medium text-right',
    headerClass: 'text-right',
  },
];

const paymentColumns = [
  { key: 'paymentCode', label: 'Cód. Pagamento' },
  { key: 'paymentDescription', label: 'Forma de Pagamento' },
  { key: 'invoiceQty', label: 'Qtd. NFs' },
  {
    key: 'totalValue',
    label: 'Total (R$)',
    render: (v) => formatBRL(v),
    cellClass: 'font-medium text-right',
    headerClass: 'text-right',
  },
];

// ─── componente principal ─────────────────────────────────────────────────────

const FaturamentoPanel = () => {
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState([]);
  const [dtInicio, setDtInicio] = useState(firstOfMonth);
  const [dtFim, setDtFim] = useState(today);

  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const [operacoesData, setOperacoesData] = useState(null);
  const [vendedoresData, setVendedoresData] = useState(null);
  const [pagamentosData, setPagamentosData] = useState(null);
  const [hasResult, setHasResult] = useState(false);

  const handleBuscar = useCallback(async () => {
    if (!dtInicio || !dtFim) {
      setErro('Informe as datas inicial e final.');
      return;
    }
    if (filiaisSelecionadas.length === 0) {
      setErro('Selecione pelo menos uma filial.');
      return;
    }

    setErro('');
    setLoading(true);
    setHasResult(false);

    const branchCodes = filiaisSelecionadas.map((f) =>
      Number(f.cd_empresa ?? f.code ?? f),
    );

    try {
      const [opRes, selRes, payRes] = await Promise.all([
        getOperationsFiscalMovement(branchCodes, dtInicio, dtFim),
        getSellerFiscalMovement(branchCodes, dtInicio, dtFim),
        getPaymentFiscalMovement(branchCodes, dtInicio, dtFim),
      ]);

      setOperacoesData(opRes);
      setVendedoresData(selRes);
      setPagamentosData(payRes);
      setHasResult(true);
    } catch (err) {
      console.error('❌ Erro ao buscar movimentação fiscal:', err);
      setErro(
        err.message || 'Erro ao buscar dados. Verifique token e conexão.',
      );
    } finally {
      setLoading(false);
    }
  }, [filiaisSelecionadas, dtInicio, dtFim]);

  const handleLimpar = useCallback(() => {
    setOperacoesData(null);
    setVendedoresData(null);
    setPagamentosData(null);
    setHasResult(false);
    setErro('');
    setDtInicio(firstOfMonth());
    setDtFim(today());
    setFiliaisSelecionadas([]);
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 p-4 gap-6">
      <PageTitle
        title="Faturamento TOTVS"
        subtitle="Movimentação fiscal por operação, vendedor e forma de pagamento"
        icon={Storefront}
        iconColor="text-blue-600"
      />

      {/* ── Filtros ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Funnel size={16} className="text-blue-600" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-4 items-end">
            {/* Filial */}
            <div className="flex flex-col gap-1 min-w-[200px]">
              <label className="text-xs font-semibold text-gray-600">
                Empresa / Filial
              </label>
              <FiltroEmpresa
                empresasSelecionadas={filiaisSelecionadas}
                onSelectEmpresas={setFiliaisSelecionadas}
              />
            </div>

            {/* Data inicial */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">
                Data Inicial
              </label>
              <input
                type="date"
                value={dtInicio}
                onChange={(e) => setDtInicio(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Data final */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">
                Data Final
              </label>
              <input
                type="date"
                value={dtFim}
                onChange={(e) => setDtFim(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Botões */}
            <div className="flex gap-2 pb-0.5">
              <button
                onClick={handleBuscar}
                disabled={loading}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                {loading ? (
                  <Spinner size={16} className="animate-spin" />
                ) : (
                  <ChartBar size={16} />
                )}
                {loading ? 'Buscando...' : 'Buscar'}
              </button>

              {hasResult && (
                <button
                  onClick={handleLimpar}
                  className="flex items-center gap-2 border border-gray-300 hover:bg-gray-100 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  <ArrowCounterClockwise size={16} />
                  Limpar
                </button>
              )}
            </div>
          </div>

          {/* Mensagem de erro */}
          {erro && (
            <div className="mt-3 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              <WarningCircle size={16} className="shrink-0" />
              {erro}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Resultados ── */}
      {hasResult && (
        <div className="flex flex-col gap-4">
          <SectionCard
            title="Por Operação"
            icon={ChartBar}
            iconClass="text-blue-600"
            data={operacoesData}
            columns={opColumns}
          />
          <SectionCard
            title="Por Vendedor"
            icon={Users}
            iconClass="text-emerald-600"
            data={vendedoresData}
            columns={sellerColumns}
          />
          <SectionCard
            title="Por Forma de Pagamento"
            icon={CreditCard}
            iconClass="text-purple-600"
            data={pagamentosData}
            columns={paymentColumns}
          />
        </div>
      )}

      {/* Estado vazio (antes de buscar) */}
      {!hasResult && !loading && !erro && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
          <Storefront size={48} weight="thin" />
          <p className="text-sm">
            Selecione os filtros e clique em <strong>Buscar</strong> para
            visualizar a movimentação fiscal.
          </p>
        </div>
      )}
    </div>
  );
};

export default FaturamentoPanel;
