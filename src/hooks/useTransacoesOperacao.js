import React, { useState } from 'react';

// Este hook encapsula o controle do modal e a busca das transações
export function useTransacoesOperacao(api) {
  const [modalAberto, setModalAberto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transacoes, setTransacoes] = useState([]);
  const [operacao, setOperacao] = useState(null);
  const [erro, setErro] = useState('');
  const [detalhesAberto, setDetalhesAberto] = useState(false);
  const [detalhesLoading, setDetalhesLoading] = useState(false);
  const [detalhesItens, setDetalhesItens] = useState([]);
  const [detalhesErro, setDetalhesErro] = useState('');

  const abrirModal = async (cd_operacao, filtrosExtras = {}) => {
    setOperacao(cd_operacao);
    setModalAberto(true);
    setLoading(true);
    setErro('');
    try {
      const params = { cd_operacao, ...filtrosExtras };
      const result = await api.transacoesPorOperacao(params);
      const extracted =
        (result && result.data && result.data.transacoes) ||
        result?.transacoes ||
        result?.data ||
        result ||
        [];

      // Normalizar para array
      const transacoesArray = Array.isArray(extracted)
        ? extracted
        : extracted && extracted.transacoes
        ? extracted.transacoes
        : [];

      // Agregar transações por nr_transacao quando existir
      const agrupadasMap = new Map();
      const naoAgrupadas = [];
      for (const t of transacoesArray) {
        const qtFaturado = Number(t.qt_faturado) || 0;
        const valorUnitLiquido = (Number(t.vl_unitliquido) || 0) * qtFaturado;
        const valorUnitBruto = (Number(t.vl_unitbruto) || 0) * qtFaturado;

        const hasNr =
          t.nr_transacao !== undefined &&
          t.nr_transacao !== null &&
          String(t.nr_transacao).trim() !== '';

        if (hasNr) {
          const key = String(t.nr_transacao);
          const existing = agrupadasMap.get(key);
          if (existing) {
            // Somar valores unitários
            existing.vl_unitliquido_total =
              (Number(existing.vl_unitliquido_total) || 0) + valorUnitLiquido;
            existing.vl_unitbruto_total =
              (Number(existing.vl_unitbruto_total) || 0) + valorUnitBruto;
            existing.nr_itens = (Number(existing.nr_itens) || 0) + 1;
          } else {
            agrupadasMap.set(key, {
              nr_transacao: t.nr_transacao,
              dt_transacao: t.dt_transacao,
              cd_empresa: t.cd_empresa,
              nm_grupoempresa: t.nm_grupoempresa,
              vl_unitliquido_total: valorUnitLiquido,
              vl_unitbruto_total: valorUnitBruto,
              nr_itens: 1,
            });
          }
        } else {
          // Sem nr_transacao: manter como entrada separada
          naoAgrupadas.push({
            nr_transacao: t.nr_transacao || 'N/A',
            dt_transacao: t.dt_transacao,
            cd_empresa: t.cd_empresa,
            nm_grupoempresa: t.nm_grupoempresa,
            vl_unitliquido_total: valorUnitLiquido,
            vl_unitbruto_total: valorUnitBruto,
            nr_itens: 1,
          });
        }
      }

      const agrupadas = Array.from(agrupadasMap.values()).concat(naoAgrupadas);
      setTransacoes(agrupadas);
    } catch (e) {
      setErro(e.message || 'Erro ao buscar transações');
      setTransacoes([]);
    } finally {
      setLoading(false);
    }
  };

  const detalharTransacao = async (nr_transacao, filtrosExtras = {}) => {
    setDetalhesAberto(true);
    setDetalhesLoading(true);
    setDetalhesErro('');
    try {
      const params = { nr_transacao, ...filtrosExtras };
      const result = await api.transacoesPorNr(params);
      const extracted =
        (result && result.data && result.data.transacoes) ||
        result?.transacoes ||
        result?.data ||
        result ||
        [];
      const itens = Array.isArray(extracted)
        ? extracted
        : extracted.transacoes || [];
      setDetalhesItens(itens);
    } catch (e) {
      setDetalhesErro(e.message || 'Erro ao buscar detalhes da transação');
      setDetalhesItens([]);
    } finally {
      setDetalhesLoading(false);
    }
  };

  const fecharDetalhes = () => {
    setDetalhesAberto(false);
    setDetalhesItens([]);
    setDetalhesErro('');
    setDetalhesLoading(false);
  };

  const fecharModal = () => {
    setModalAberto(false);
    setTransacoes([]);
    setOperacao(null);
    setErro('');
  };

  // Retorna apenas dados e funções, não JSX
  return {
    abrirModal,
    fecharModal,
    detalharTransacao,
    fecharDetalhes,
    modalAberto,
    loading,
    transacoes,
    operacao,
    erro,
    detalhesAberto,
    detalhesLoading,
    detalhesItens,
    detalhesErro,
  };
}
