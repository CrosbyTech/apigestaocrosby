import React, { useState, useEffect } from 'react';
import {
  ShoppingCart,
  Funnel,
  Spinner,
  CurrencyDollar,
  Receipt,
  ChartBar,
  Tag,
  ArrowCounterClockwise,
  X,
  Storefront,
} from '@phosphor-icons/react';
import PageTitle from '../components/ui/PageTitle';
import FiltroEmpresa from '../components/FiltroEmpresa';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '../components/ui/cards';
import useApiClient from '../hooks/useApiClient';

// ─── helpers ─────────────────────────────────────────────────────────────────
const formatBRL = (v) =>
  typeof v === 'number'
    ? v.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : v !== undefined && v !== null
      ? String(v)
      : '—';

const formatInt = (v) =>
  typeof v === 'number'
    ? v.toLocaleString('pt-BR')
    : v !== undefined && v !== null
      ? String(v)
      : '—';

const isMonetary = (key) =>
  /value|amount|total|gross|net|discount|ticket|receita|faturamento|preco|price/i.test(
    key,
  );

const isQuantity = (key) =>
  /quantity|qty|count|amount/i.test(key) && !isMonetary(key);

function MetricCard({
  title,
  value,
  icon: Icon,
  color = 'text-blue-600',
  bg = 'bg-blue-50',
}) {
  return (
    <Card className="flex-1 min-w-[160px]">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-full ${bg} shrink-0`}>
          <Icon size={20} className={color} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500 font-medium truncate">{title}</p>
          <p className="text-base font-bold text-[#000638] truncate">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function RawDataCard({ data }) {
  if (!data || typeof data !== 'object') return null;
  const entries = Object.entries(data).filter(
    ([, v]) => v !== null && v !== undefined && typeof v !== 'object',
  );
  if (entries.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-[#000638]">
          Detalhes retornados pela API
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2">
          {entries.map(([key, val]) => (
            <div key={key}>
              <dt className="text-xs text-gray-400 capitalize">
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </dt>
              <dd className="text-sm font-semibold text-[#000638]">
                {isMonetary(key)
                  ? `R$ ${formatBRL(Number(val))}`
                  : formatInt(Number.isFinite(Number(val)) ? Number(val) : val)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

// ─── componente principal ─────────────────────────────────────────────────────
export default function PainelVendas() {
  const apiClient = useApiClient();

  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [totals, setTotals] = useState(null);
  const [sellers, setSellers] = useState(null);
  const [modalSellers, setModalSellers] = useState(null);

  // pré-preencher datas (mês atual)
  useEffect(() => {
    const hoje = new Date();
    const primeiro = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    setDataInicio(primeiro.toISOString().split('T')[0]);
    setDataFim(hoje.toISOString().split('T')[0]);
  }, []);

  const handleBuscar = async () => {
    if (!dataInicio || !dataFim) {
      setErro('Informe as datas de início e fim.');
      return;
    }
    setLoading(true);
    setErro('');
    setTotals(null);
    setSellers(null);
    try {
      const filtroempresa =
        empresasSelecionadas.length > 0
          ? empresasSelecionadas.map((e) => parseInt(e.cd_empresa))
          : [];

      const body = {
        filtroempresa,
        datemin: `${dataInicio}T00:00:00.000Z`,
        datemax: `${dataFim}T23:59:59.999Z`,
      };

      const [totalsResult, sellersResult] = await Promise.all([
        apiClient.totvs.salePanelTotals(body),
        apiClient.totvs.salePanelSellers(body),
      ]);

      if (totalsResult && totalsResult.success !== false) {
        const payload = totalsResult.data ?? totalsResult;
        setTotals(payload);
      }

      if (sellersResult && sellersResult.success !== false) {
        const payload = sellersResult.data ?? sellersResult;
        setSellers(payload);
      }

      if (
        (!totalsResult || totalsResult.success === false) &&
        (!sellersResult || sellersResult.success === false)
      ) {
        setErro(
          totalsResult?.message ||
            sellersResult?.message ||
            'Erro ao buscar dados.',
        );
      }
    } catch (err) {
      setErro(err.message || 'Erro ao conectar com a API.');
    } finally {
      setLoading(false);
    }
  };

  const handleLimpar = () => {
    setTotals(null);
    setSellers(null);
    setModalSellers(null);
    setErro('');
  };

  // ─── cards de destaque ────────────────────────────────────────────────────
  const cards = totals
    ? [
        totals.netValue !== undefined && {
          title: 'Faturamento Líquido',
          value: `R$ ${formatBRL(totals.netValue)}`,
          icon: CurrencyDollar,
          color: 'text-emerald-600',
          bg: 'bg-emerald-50',
        },
        totals.grossValue !== undefined && {
          title: 'Faturamento Bruto',
          value: `R$ ${formatBRL(totals.grossValue)}`,
          icon: ChartBar,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
        },
        totals.discountValue !== undefined && {
          title: 'Descontos',
          value: `R$ ${formatBRL(totals.discountValue)}`,
          icon: Tag,
          color: 'text-orange-500',
          bg: 'bg-orange-50',
        },
        totals.quantity !== undefined && {
          title: 'Qtd. Transações',
          value: formatInt(totals.quantity),
          icon: Receipt,
          color: 'text-purple-600',
          bg: 'bg-purple-50',
        },
        totals.averageTicket !== undefined && {
          title: 'Ticket Médio',
          value: `R$ ${formatBRL(totals.averageTicket)}`,
          icon: ShoppingCart,
          color: 'text-cyan-600',
          bg: 'bg-cyan-50',
        },
      ].filter(Boolean)
    : [];

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2 gap-4">
      <PageTitle
        title="Painel de Vendas"
        subtitle="Faturamento total • TOTVS Moda"
        icon={ShoppingCart}
        iconColor="text-blue-600"
      />

      {/* Filtros */}
      <div className="bg-white p-3 rounded-lg shadow-md border border-[#000638]/10">
        <span className="text-sm font-bold text-[#000638] flex items-center gap-1 mb-2">
          <Funnel size={16} weight="bold" />
          Filtros
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
          {/* Filtro empresa */}
          <div>
            <FiltroEmpresa
              empresasSelecionadas={empresasSelecionadas}
              onSelectEmpresas={setEmpresasSelecionadas}
            />
          </div>

          {/* Data início */}
          <div>
            <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
              Data Início
            </label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
            />
          </div>

          {/* Data fim */}
          <div>
            <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
              Data Fim
            </label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
            />
          </div>

          {/* Buscar */}
          <div>
            <button
              onClick={handleBuscar}
              disabled={loading || !dataInicio || !dataFim}
              className="flex gap-1 items-center justify-center bg-[#000638] text-white px-4 py-1.5 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-8 text-xs font-bold shadow-md tracking-wide uppercase w-full mt-4"
            >
              {loading ? (
                <>
                  <Spinner size={12} className="animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <ChartBar size={12} />
                  Buscar
                </>
              )}
            </button>
          </div>

          {/* Limpar */}
          {(totals || sellers) && (
            <div>
              <button
                onClick={handleLimpar}
                className="flex gap-1 items-center justify-center border border-gray-300 text-gray-600 px-4 py-1.5 rounded-lg hover:bg-gray-100 transition-colors h-8 text-xs font-semibold w-full mt-4"
              >
                <ArrowCounterClockwise size={12} />
                Limpar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Erro */}
      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
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
      {!loading && !totals && !sellers && !erro && (
        <div className="flex justify-center items-center py-16 text-gray-400 text-sm">
          Selecione o período e clique em "Buscar" para ver o faturamento total.
        </div>
      )}

      {/* Resultados */}
      {!loading && totals && (
        <>
          {/* Cards de destaque */}
          {cards.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {cards.map((c) => (
                <MetricCard key={c.title} {...c} />
              ))}
            </div>
          )}

          {/* Detalhes completos da API */}
          <RawDataCard data={totals} />

          {/* Se vier array de itens */}
          {Array.isArray(totals) && totals.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#000638]">
                  Itens retornados ({totals.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-[#000638]/5">
                      {Object.keys(totals[0]).map((k) => (
                        <th
                          key={k}
                          className="px-3 py-2 font-semibold text-[#000638] whitespace-nowrap border-b"
                        >
                          {k.replace(/([A-Z])/g, ' $1').trim()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {totals.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b last:border-0 hover:bg-gray-50 transition-colors"
                      >
                        {Object.entries(row).map(([k, v]) => (
                          <td
                            key={k}
                            className="px-3 py-2 text-gray-700 whitespace-nowrap"
                          >
                            {isMonetary(k) && typeof v === 'number'
                              ? `R$ ${formatBRL(v)}`
                              : v !== null && v !== undefined
                                ? String(v)
                                : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Se não houver nada reconhecível */}
          {cards.length === 0 &&
            !(Array.isArray(totals) && totals.length > 0) &&
            Object.entries(totals).filter(
              ([, v]) => v !== null && typeof v !== 'object',
            ).length === 0 && (
              <Card>
                <CardContent className="p-4 text-sm text-gray-500">
                  <pre className="overflow-x-auto text-xs">
                    {JSON.stringify(totals, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
        </>
      )}

      {/* Cards resumo de vendedores */}
      {!loading &&
        sellers &&
        Array.isArray(sellers.branches) &&
        sellers.branches.length > 0 &&
        (() => {
          const VAREJO_CODES = new Set([
            5, 55, 65, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 500, 550,
            650, 870, 880, 890, 891, 910, 920, 930, 940, 950, 960, 970, 980,
          ]);
          const EXCLUDED_SELLERS = new Set([
            59, 40, 20, 161, 241, 25, 165, 15, 779, 65, 177, 259, 21, 26,
          ]);

          const varejoBranches = sellers.branches
            .filter((b) => VAREJO_CODES.has(b.branch_code))
            .map((b) => {
              const filteredRows =
                b.dataRow?.filter(
                  (s) => !EXCLUDED_SELLERS.has(s.seller_code),
                ) || [];
              return {
                ...b,
                dataRow: filteredRows,
                invoiceValue: filteredRows.reduce(
                  (sum, s) => sum + (s.seller_sale_value || 0),
                  0,
                ),
                invoiceQuantity: filteredRows.reduce(
                  (sum, s) => sum + (s.seller_sale_qty || 0),
                  0,
                ),
              };
            })
            .filter((b) => b.dataRow.length > 0);

          // Vendedora fixa no VAREJO: 59 - KHRISTIANNA - JOAO PESSOA - INT
          const FIXED_VAREJO_SELLER = {
            seller_code: 59,
            seller_name: 'KHRISTIANNA - JOAO PESSOA - INT',
            seller_sale_qty: 0,
            seller_sale_value: 0,
          };
          // Procurar dados reais dessa vendedora em todas as branches
          for (const b of sellers.branches) {
            const found = b.dataRow?.find((s) => s.seller_code === 59);
            if (found) {
              FIXED_VAREJO_SELLER.seller_sale_qty += found.seller_sale_qty || 0;
              FIXED_VAREJO_SELLER.seller_sale_value +=
                found.seller_sale_value || 0;
            }
          }
          // Adicionar como branch virtual se tiver vendas, ou mesmo assim mostrar
          const hasFixedSeller = varejoBranches.some((b) =>
            b.dataRow?.some((s) => s.seller_code === 59),
          );
          if (!hasFixedSeller) {
            varejoBranches.push({
              branch_code: 2,
              branch_name: 'JOÃO PESSOA - ',
              dataRow: [FIXED_VAREJO_SELLER],
              invoiceQuantity: FIXED_VAREJO_SELLER.seller_sale_qty,
              invoiceValue: FIXED_VAREJO_SELLER.seller_sale_value,
              itemQuantity: 0,
            });
          }

          const outrasBranches = sellers.branches
            .filter((b) => !VAREJO_CODES.has(b.branch_code))
            .map((b) => {
              const filteredRows =
                b.dataRow?.filter(
                  (s) => !EXCLUDED_SELLERS.has(s.seller_code),
                ) || [];
              return {
                ...b,
                dataRow: filteredRows,
                invoiceValue: filteredRows.reduce(
                  (sum, s) => sum + (s.seller_sale_value || 0),
                  0,
                ),
                invoiceQuantity: filteredRows.reduce(
                  (sum, s) => sum + (s.seller_sale_qty || 0),
                  0,
                ),
              };
            })
            .filter((b) => b.dataRow.length > 0);

          const totalVarejoValue = varejoBranches.reduce(
            (sum, b) => sum + (b.invoiceValue || 0),
            0,
          );
          const totalVarejoQty = varejoBranches.reduce(
            (sum, b) => sum + (b.invoiceQuantity || 0),
            0,
          );

          // Vendedor fixo FRANQUIA: 40 - JHEMYSON
          const franquiaSeller = {
            seller_code: 40,
            seller_name: 'JHEMYSON',
            seller_sale_qty: 0,
            seller_sale_value: 0,
          };
          for (const b of sellers.branches) {
            const found = b.dataRow?.find((s) => s.seller_code === 40);
            if (found) {
              franquiaSeller.seller_sale_qty += found.seller_sale_qty || 0;
              franquiaSeller.seller_sale_value += found.seller_sale_value || 0;
            }
          }
          const franquiaBranch = {
            branch_code: 0,
            branch_name: 'FRANQUIA',
            dataRow: [franquiaSeller],
            invoiceQuantity: franquiaSeller.seller_sale_qty,
            invoiceValue: franquiaSeller.seller_sale_value,
            itemQuantity: 0,
          };

          // Vendedor fixo B2 BUSINESS: 20 - MARCIO SILVERIO
          const b2Seller = {
            seller_code: 20,
            seller_name: 'MARCIO SILVERIO',
            seller_sale_qty: 0,
            seller_sale_value: 0,
          };
          for (const b of sellers.branches) {
            const found = b.dataRow?.find((s) => s.seller_code === 20);
            if (found) {
              b2Seller.seller_sale_qty += found.seller_sale_qty || 0;
              b2Seller.seller_sale_value += found.seller_sale_value || 0;
            }
          }
          const b2Branch = {
            branch_code: 0,
            branch_name: 'B2 BUSINESS',
            dataRow: [b2Seller],
            invoiceQuantity: b2Seller.seller_sale_qty,
            invoiceValue: b2Seller.seller_sale_value,
            itemQuantity: 0,
          };

          // Vendedores fixos REVENDA
          const REVENDA_CODES = [161, 241, 25, 165, 15, 779];
          const revendaSellers = REVENDA_CODES.map((code) => {
            const s = {
              seller_code: code,
              seller_name: '',
              seller_sale_qty: 0,
              seller_sale_value: 0,
            };
            for (const b of sellers.branches) {
              const found = b.dataRow?.find((r) => r.seller_code === code);
              if (found) {
                if (!s.seller_name) s.seller_name = found.seller_name;
                s.seller_sale_qty += found.seller_sale_qty || 0;
                s.seller_sale_value += found.seller_sale_value || 0;
              }
            }
            return s;
          }).filter((s) => s.seller_sale_qty > 0);
          const revendaBranch = {
            branch_code: 0,
            branch_name: 'REVENDA',
            dataRow: revendaSellers,
            invoiceQuantity: revendaSellers.reduce(
              (sum, s) => sum + s.seller_sale_qty,
              0,
            ),
            invoiceValue: revendaSellers.reduce(
              (sum, s) => sum + s.seller_sale_value,
              0,
            ),
            itemQuantity: 0,
          };

          // Vendedores fixos MULTIMARCAS
          const MULTIMARCAS_CODES = [65, 177, 259, 21];
          const multimarcasSellers = MULTIMARCAS_CODES.map((code) => {
            const s = {
              seller_code: code,
              seller_name: '',
              seller_sale_qty: 0,
              seller_sale_value: 0,
            };
            for (const b of sellers.branches) {
              const found = b.dataRow?.find((r) => r.seller_code === code);
              if (found) {
                if (!s.seller_name) s.seller_name = found.seller_name;
                s.seller_sale_qty += found.seller_sale_qty || 0;
                s.seller_sale_value += found.seller_sale_value || 0;
              }
            }
            return s;
          }).filter((s) => s.seller_sale_qty > 0);
          const multimarcasBranch = {
            branch_code: 0,
            branch_name: 'MULTIMARCAS',
            dataRow: multimarcasSellers,
            invoiceQuantity: multimarcasSellers.reduce(
              (sum, s) => sum + s.seller_sale_qty,
              0,
            ),
            invoiceValue: multimarcasSellers.reduce(
              (sum, s) => sum + s.seller_sale_value,
              0,
            ),
            itemQuantity: 0,
          };

          // Vendedor fixo B2M INBOUND: 26 - DAVID ALMEIDA
          const b2mSeller = {
            seller_code: 26,
            seller_name: 'DAVID ALMEIDA',
            seller_sale_qty: 0,
            seller_sale_value: 0,
          };
          for (const b of sellers.branches) {
            const found = b.dataRow?.find((s) => s.seller_code === 26);
            if (found) {
              b2mSeller.seller_sale_qty += found.seller_sale_qty || 0;
              b2mSeller.seller_sale_value += found.seller_sale_value || 0;
            }
          }
          const b2mBranch = {
            branch_code: 0,
            branch_name: 'B2M INBOUND',
            dataRow: [b2mSeller],
            invoiceQuantity: b2mSeller.seller_sale_qty,
            invoiceValue: b2mSeller.seller_sale_value,
            itemQuantity: 0,
          };

          return (
            <div className="flex flex-wrap gap-3">
              {varejoBranches.length > 0 && (
                <Card
                  className="flex-1 min-w-[200px] cursor-pointer hover:ring-2 hover:ring-[#000638]/30 transition-all"
                  onClick={() =>
                    setModalSellers({
                      title: 'Varejo',
                      branches: varejoBranches,
                    })
                  }
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-full bg-emerald-50 shrink-0">
                      <Storefront size={20} className="text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 font-medium">
                        Varejo
                      </p>
                      <p className="text-base font-bold text-[#000638]">
                        R$ {formatBRL(totalVarejoValue)}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {formatInt(totalVarejoQty)} vendas &bull;{' '}
                        {varejoBranches.length} empresa(s)
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {outrasBranches.map((branch) => (
                <Card
                  key={branch.branch_code}
                  className="flex-1 min-w-[200px] cursor-pointer hover:ring-2 hover:ring-[#000638]/30 transition-all"
                  onClick={() =>
                    setModalSellers({
                      title: `${branch.branch_name} (${branch.branch_code})`,
                      branches: [branch],
                    })
                  }
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-full bg-blue-50 shrink-0">
                      <Storefront size={20} className="text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 font-medium truncate">
                        {branch.branch_name} ({branch.branch_code})
                      </p>
                      <p className="text-base font-bold text-[#000638]">
                        R$ {formatBRL(branch.invoiceValue)}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {formatInt(branch.invoiceQuantity)} vendas
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {franquiaSeller.seller_sale_qty > 0 && (
                <Card
                  className="flex-1 min-w-[200px] cursor-pointer hover:ring-2 hover:ring-[#000638]/30 transition-all"
                  onClick={() =>
                    setModalSellers({
                      title: 'Franquia',
                      branches: [franquiaBranch],
                    })
                  }
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-full bg-orange-50 shrink-0">
                      <Storefront size={20} className="text-orange-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 font-medium">
                        Franquia
                      </p>
                      <p className="text-base font-bold text-[#000638]">
                        R$ {formatBRL(franquiaSeller.seller_sale_value)}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {formatInt(franquiaSeller.seller_sale_qty)} vendas
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {b2Seller.seller_sale_qty > 0 && (
                <Card
                  className="flex-1 min-w-[200px] cursor-pointer hover:ring-2 hover:ring-[#000638]/30 transition-all"
                  onClick={() =>
                    setModalSellers({
                      title: 'B2 Business',
                      branches: [b2Branch],
                    })
                  }
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-full bg-purple-50 shrink-0">
                      <Storefront size={20} className="text-purple-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 font-medium">
                        B2 Business
                      </p>
                      <p className="text-base font-bold text-[#000638]">
                        R$ {formatBRL(b2Seller.seller_sale_value)}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {formatInt(b2Seller.seller_sale_qty)} vendas
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {revendaSellers.length > 0 && (
                <Card
                  className="flex-1 min-w-[200px] cursor-pointer hover:ring-2 hover:ring-[#000638]/30 transition-all"
                  onClick={() =>
                    setModalSellers({
                      title: 'Revenda',
                      branches: [revendaBranch],
                    })
                  }
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-full bg-cyan-50 shrink-0">
                      <Storefront size={20} className="text-cyan-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 font-medium">
                        Revenda
                      </p>
                      <p className="text-base font-bold text-[#000638]">
                        R$ {formatBRL(revendaBranch.invoiceValue)}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {formatInt(revendaBranch.invoiceQuantity)} vendas
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {multimarcasSellers.length > 0 && (
                <Card
                  className="flex-1 min-w-[200px] cursor-pointer hover:ring-2 hover:ring-[#000638]/30 transition-all"
                  onClick={() =>
                    setModalSellers({
                      title: 'Multimarcas',
                      branches: [multimarcasBranch],
                    })
                  }
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-full bg-indigo-50 shrink-0">
                      <Storefront size={20} className="text-indigo-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 font-medium">
                        Multimarcas
                      </p>
                      <p className="text-base font-bold text-[#000638]">
                        R$ {formatBRL(multimarcasBranch.invoiceValue)}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {formatInt(multimarcasBranch.invoiceQuantity)} vendas
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {b2mSeller.seller_sale_qty > 0 && (
                <Card
                  className="flex-1 min-w-[200px] cursor-pointer hover:ring-2 hover:ring-[#000638]/30 transition-all"
                  onClick={() =>
                    setModalSellers({
                      title: 'B2M Inbound',
                      branches: [b2mBranch],
                    })
                  }
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-full bg-rose-50 shrink-0">
                      <Storefront size={20} className="text-rose-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 font-medium">
                        B2M Inbound
                      </p>
                      <p className="text-base font-bold text-[#000638]">
                        R$ {formatBRL(b2mSeller.seller_sale_value)}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {formatInt(b2mSeller.seller_sale_qty)} vendas
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })()}

      {/* Modal de detalhes dos vendedores */}
      {modalSellers && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setModalSellers(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h2 className="text-sm font-bold text-[#000638] uppercase tracking-wide">
                {modalSellers.title}
              </h2>
              <button
                onClick={() => setModalSellers(null)}
                className="p-1 rounded hover:bg-gray-100 transition-colors"
              >
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            <div className="overflow-y-auto p-5 space-y-4">
              {modalSellers.branches.map((branch) => (
                <div key={branch.branch_code}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-[#000638]">
                      {branch.branch_name} ({branch.branch_code})
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {branch.dataRow.length} vendedor(es) &bull; R${' '}
                      {formatBRL(branch.invoiceValue)}
                    </span>
                  </div>
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-[#000638]/5">
                        <th className="px-3 py-1.5 font-semibold text-[#000638] border-b">
                          Código
                        </th>
                        <th className="px-3 py-1.5 font-semibold text-[#000638] border-b">
                          Vendedor
                        </th>
                        <th className="px-3 py-1.5 font-semibold text-[#000638] border-b text-right">
                          Qtd. Vendas
                        </th>
                        <th className="px-3 py-1.5 font-semibold text-[#000638] border-b text-right">
                          Valor Vendas
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {branch.dataRow.map((s, i) => (
                        <tr
                          key={i}
                          className="border-b last:border-0 hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-3 py-1.5 text-gray-700">
                            {s.seller_code}
                          </td>
                          <td className="px-3 py-1.5 text-gray-700">
                            {s.seller_name || '—'}
                          </td>
                          <td className="px-3 py-1.5 text-gray-700 text-right">
                            {formatInt(s.seller_sale_qty)}
                          </td>
                          <td className="px-3 py-1.5 text-gray-700 text-right">
                            R$ {formatBRL(s.seller_sale_value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
