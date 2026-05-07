import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../components/AuthContext';
import { supabase } from '../lib/supabase';
import PageTitle from '../components/ui/PageTitle';
import {
  Package,
  Spinner,
  CurrencyDollar,
  CaretLeft,
  CaretRight,
  FileArrowDown,
  X,
  Eye,
  UserCircle,
  CalendarBlank,
  ListNumbers,
  CheckCircle,
  Clock,
  XCircle,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const SolicitacoesRemessa = () => {
  const { user } = useAuth();
  const [remessas, setRemessas] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [modalAberto, setModalAberto] = useState(false);
  const [remessaSelecionada, setRemessaSelecionada] = useState(null);
  const [titulosRemessa, setTitulosRemessa] = useState([]);
  const [titulosLoading, setTitulosLoading] = useState(false);

  // Paginação
  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 15;

  // Helpers de data
  const formatDateBR = (isoDate) => {
    if (!isoDate) return '--';
    try {
      const d = new Date(isoDate);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    } catch {
      return '--';
    }
  };

  const formatDateTimeBR = (isoDate) => {
    if (!isoDate) return '--';
    try {
      const d = new Date(isoDate);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
      return '--';
    }
  };

  // Buscar remessas
  const buscarRemessas = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('solicitacoes_remessa')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRemessas(data || []);
    } catch (err) {
      console.error('Erro ao buscar remessas:', err);
      alert(`Erro ao buscar remessas: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    buscarRemessas();
  }, []);

  // Alterar status da remessa
  const alterarStatus = async (remessaId, novoStatus) => {
    try {
      const { error } = await supabase
        .from('solicitacoes_remessa')
        .update({ status: novoStatus })
        .eq('id', remessaId);

      if (error) throw error;

      // Se reprovada, deletar títulos para liberar titulo_key (UNIQUE) para re-seleção
      if (novoStatus === 'REPROVADA') {
        await supabase
          .from('solicitacoes_remessa_titulos')
          .delete()
          .eq('remessa_id', remessaId);
      }

      // Atualizar estado local
      setRemessas((prev) =>
        prev.map((r) =>
          r.id === remessaId ? { ...r, status: novoStatus } : r,
        ),
      );
      if (remessaSelecionada?.id === remessaId) {
        setRemessaSelecionada((prev) => ({ ...prev, status: novoStatus }));
      }
    } catch (err) {
      console.error('Erro ao alterar status:', err);
      alert(`Erro ao alterar status: ${err.message}`);
    }
  };

  // Abrir modal com títulos da remessa
  const abrirRemessa = async (remessa) => {
    setRemessaSelecionada(remessa);
    setModalAberto(true);
    setTitulosLoading(true);
    try {
      const { data, error } = await supabase
        .from('solicitacoes_remessa_titulos')
        .select('*')
        .eq('remessa_id', remessa.id)
        .order('nm_cliente', { ascending: true });

      if (error) throw error;
      setTitulosRemessa(data || []);
    } catch (err) {
      console.error('Erro ao buscar títulos:', err);
      setTitulosRemessa([]);
    } finally {
      setTitulosLoading(false);
    }
  };

  // Exportar títulos da remessa para Excel
  const exportarExcel = () => {
    if (titulosRemessa.length === 0) {
      alert('Nenhum título para exportar.');
      return;
    }
    try {
      const dadosExport = titulosRemessa.map((t) => ({
        Cliente: t.nm_cliente || '',
        'CPF/CNPJ': t.nr_cpfcnpj || '',
        Portador: t.nm_portador || '',
        'Nº Fatura': t.nr_fat || '',
        Parcela: t.nr_parcela || 1,
        Emissão: formatDateBR(t.dt_emissao),
        Vencimento: formatDateBR(t.dt_vencimento),
        'Valor Fatura': parseFloat(t.vl_fatura) || 0,
      }));
      const ws = XLSX.utils.json_to_sheet(dadosExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        ws,
        `Remessa ${remessaSelecionada?.nr_remessa}`,
      );
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      saveAs(blob, `remessa-${remessaSelecionada?.nr_remessa}-${hoje}.xlsx`);
    } catch (err) {
      console.error('Erro ao exportar:', err);
      alert('Erro ao exportar arquivo Excel.');
    }
  };

  // Paginação
  const remessasPaginadas = useMemo(() => {
    const start = (paginaAtual - 1) * itensPorPagina;
    return remessas.slice(start, start + itensPorPagina);
  }, [remessas, paginaAtual]);

  const totalPages = Math.ceil(remessas.length / itensPorPagina);

  // Badge de status
  const StatusBadge = ({ status }) => {
    const config = {
      APROVADA: {
        bg: 'bg-green-100',
        text: 'text-green-700',
        icon: CheckCircle,
      },
      REPROVADA: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
      'EM ANALISE': {
        bg: 'bg-yellow-100',
        text: 'text-yellow-700',
        icon: Clock,
      },
    };
    const c = config[status] || config['EM ANALISE'];
    const Icon = c.icon;
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${c.bg} ${c.text}`}
      >
        <Icon size={12} weight="bold" />
        {status}
      </span>
    );
  };

  // Totais
  const totais = useMemo(() => {
    return remessas.reduce(
      (acc, r) => {
        acc.valorTotal += parseFloat(r.vl_total) || 0;
        acc.qtTitulos += parseInt(r.qt_titulos) || 0;
        return acc;
      },
      { valorTotal: 0, qtTitulos: 0 },
    );
  }, [remessas]);

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

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Solicitações de Remessa"
        subtitle="Histórico de remessas criadas a partir da Licitação de Títulos"
        icon={Package}
        iconColor="text-amber-600"
      />

      {/* Cards de Resumo */}
      {remessas.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-6 max-w-7xl mx-auto">
          <div className="bg-white shadow-lg rounded-xl p-3 border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <Package size={14} className="text-amber-600" />
              <span className="text-xs font-bold text-amber-700">
                Total de Remessas
              </span>
            </div>
            <div className="text-sm font-extrabold text-amber-600">
              {remessas.length}
            </div>
          </div>
          <div className="bg-white shadow-lg rounded-xl p-3 border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <ListNumbers size={14} className="text-blue-600" />
              <span className="text-xs font-bold text-blue-700">
                Total de Títulos
              </span>
            </div>
            <div className="text-sm font-extrabold text-blue-600">
              {totais.qtTitulos}
            </div>
          </div>
          <div className="bg-white shadow-lg rounded-xl p-3 border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <CurrencyDollar size={14} className="text-green-600" />
              <span className="text-xs font-bold text-green-700">
                Valor Total
              </span>
            </div>
            <div className="text-sm font-extrabold text-green-600">
              {totais.valorTotal.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })}
            </div>
          </div>
        </div>
      )}

      {/* Lista de Remessas */}
      <div className="bg-white rounded-lg shadow-md border border-[#000638]/10 max-w-7xl mx-auto w-full">
        <div className="p-3 border-b border-[#000638]/10 flex justify-between items-center">
          <h2 className="text-sm font-bold text-[#000638] font-barlow">
            Solicitações de Remessa
          </h2>
          <div className="text-xs text-gray-600">
            {remessas.length} remessa(s) encontrada(s)
          </div>
        </div>

        <div className="p-3">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="flex items-center gap-3">
                <Spinner size={18} className="animate-spin text-amber-600" />
                <span className="text-sm text-gray-600">
                  Carregando remessas...
                </span>
              </div>
            </div>
          ) : remessas.length === 0 ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <Package size={48} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500 text-sm mb-1">
                  Nenhuma remessa encontrada
                </p>
                <p className="text-gray-400 text-xs">
                  As remessas criadas na página de Licitação de Títulos
                  aparecerão aqui.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {remessasPaginadas.map((remessa) => (
                <button
                  key={remessa.id}
                  onClick={() => abrirRemessa(remessa)}
                  className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:bg-amber-50 hover:border-amber-300 transition-all text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center group-hover:bg-amber-200 transition-colors">
                        <Package
                          size={20}
                          weight="bold"
                          className="text-amber-700"
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[#000638]">
                            REMESSA #{remessa.nr_remessa}
                          </span>
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                            {remessa.qt_titulos} título(s)
                          </span>
                          <StatusBadge
                            status={remessa.status || 'EM ANALISE'}
                          />
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <UserCircle size={12} />
                            {remessa.user_nome}
                          </span>
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <CalendarBlank size={12} />
                            {formatDateTimeBR(remessa.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-sm font-bold text-green-600">
                          {(parseFloat(remessa.vl_total) || 0).toLocaleString(
                            'pt-BR',
                            {
                              style: 'currency',
                              currency: 'BRL',
                            },
                          )}
                        </div>
                      </div>
                      <Eye
                        size={18}
                        className="text-gray-400 group-hover:text-amber-600 transition-colors"
                      />
                    </div>
                  </div>
                </button>
              ))}

              {/* Paginação */}
              {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-200">
                  <span className="text-sm text-gray-600">
                    Mostrando {(paginaAtual - 1) * itensPorPagina + 1} a{' '}
                    {Math.min(paginaAtual * itensPorPagina, remessas.length)} de{' '}
                    {remessas.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
                      disabled={paginaAtual === 1}
                      className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CaretLeft size={16} /> Anterior
                    </button>
                    <span className="px-3 py-2 text-sm text-gray-700">
                      {paginaAtual} / {totalPages}
                    </span>
                    <button
                      onClick={() =>
                        setPaginaAtual((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={paginaAtual === totalPages}
                      className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* Modal de Detalhes da Remessa */}
      {modalAberto && remessaSelecionada && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          style={{ zIndex: 99999 }}
        >
          <div className="bg-white rounded-lg p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-[#000638]">
                  REMESSA #{remessaSelecionada.nr_remessa}
                </h2>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-sm text-gray-500 flex items-center gap-1">
                    <UserCircle size={14} />
                    {remessaSelecionada.user_nome}
                  </span>
                  <span className="text-sm text-gray-500 flex items-center gap-1">
                    <CalendarBlank size={14} />
                    {formatDateTimeBR(remessaSelecionada.created_at)}
                  </span>
                  <span className="text-sm font-bold text-green-600">
                    {(
                      parseFloat(remessaSelecionada.vl_total) || 0
                    ).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </span>
                  <StatusBadge
                    status={remessaSelecionada.status || 'EM ANALISE'}
                  />
                </div>
                {/* Botões de alteração de status */}
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-xs font-semibold text-gray-500">
                    Alterar status:
                  </span>
                  <button
                    onClick={() =>
                      alterarStatus(remessaSelecionada.id, 'APROVADA')
                    }
                    disabled={remessaSelecionada.status === 'APROVADA'}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <CheckCircle size={14} weight="bold" /> APROVAR
                  </button>
                  <button
                    onClick={() =>
                      alterarStatus(remessaSelecionada.id, 'EM ANALISE')
                    }
                    disabled={remessaSelecionada.status === 'EM ANALISE'}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-yellow-100 text-yellow-700 hover:bg-yellow-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Clock size={14} weight="bold" /> EM ANÁLISE
                  </button>
                  <button
                    onClick={() =>
                      alterarStatus(remessaSelecionada.id, 'REPROVADA')
                    }
                    disabled={remessaSelecionada.status === 'REPROVADA'}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <XCircle size={14} weight="bold" /> REPROVAR
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportarExcel}
                  disabled={titulosRemessa.length === 0}
                  className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-xs"
                >
                  <FileArrowDown size={14} /> BAIXAR EXCEL
                </button>
                <button
                  onClick={() => {
                    setModalAberto(false);
                    setRemessaSelecionada(null);
                    setTitulosRemessa([]);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>
            </div>

            {/* Tabela de Títulos */}
            {titulosLoading ? (
              <div className="flex justify-center items-center py-12">
                <Spinner size={18} className="animate-spin text-amber-600" />
                <span className="text-sm text-gray-600 ml-2">
                  Carregando títulos...
                </span>
              </div>
            ) : titulosRemessa.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                Nenhum título encontrado nesta remessa.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="extrato-table border-collapse rounded-lg overflow-hidden shadow-lg">
                  <thead className="bg-[#000638] text-white text-sm uppercase tracking-wider">
                    <tr>
                      <th className="px-2 py-2 text-left">Cliente</th>
                      <th className="px-2 py-2 text-center">CPF/CNPJ</th>
                      <th className="px-2 py-2 text-center">Portador</th>
                      <th className="px-2 py-2 text-center">Nº Fatura</th>
                      <th className="px-2 py-2 text-center">Emissão</th>
                      <th className="px-2 py-2 text-center">Vencimento</th>
                      <th className="px-2 py-2 text-center">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {titulosRemessa.map((t, idx) => (
                      <tr key={idx} className="text-sm">
                        <td className="text-left px-2 py-2 font-medium text-gray-900">
                          {t.nm_cliente || '--'}
                        </td>
                        <td className="text-center text-gray-900 px-2 py-2">
                          {t.nr_cpfcnpj || '--'}
                        </td>
                        <td className="text-center text-gray-900 px-2 py-2">
                          {t.nm_portador || '--'}
                        </td>
                        <td className="text-center text-gray-900 px-2 py-2">
                          {t.nr_fat || '--'}
                        </td>
                        <td className="text-center text-gray-900 px-2 py-2">
                          {formatDateBR(t.dt_emissao)}
                        </td>
                        <td className="text-center text-gray-900 px-2 py-2">
                          {formatDateBR(t.dt_vencimento)}
                        </td>
                        <td className="text-center font-semibold text-green-600 px-2 py-2">
                          {(parseFloat(t.vl_fatura) || 0).toLocaleString(
                            'pt-BR',
                            {
                              style: 'currency',
                              currency: 'BRL',
                            },
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-100 font-bold text-sm">
                      <td colSpan={6} className="text-right px-2 py-2">
                        Total:
                      </td>
                      <td className="text-center text-green-700 px-2 py-2">
                        {titulosRemessa
                          .reduce(
                            (acc, t) => acc + (parseFloat(t.vl_fatura) || 0),
                            0,
                          )
                          .toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <div className="mt-3 text-center text-sm text-gray-500">
                  {titulosRemessa.length} título(s) nesta remessa
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SolicitacoesRemessa;
