import React, { useState, useMemo, useCallback } from 'react';
import {
  Calendar,
  CaretDown,
  CaretRight,
  FileArrowDown,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { getCategoriaPorCodigo } from '../../config/categoriasDespesas';
import {
  formatarData,
  criarDataSemFusoHorario,
  agruparDadosIdenticos,
  TABLE_CLASSES,
  TABLE_HEADER_CLASSES,
  getStickyColStyle,
} from './utils';

const ORDEM_CATEGORIAS = [
  'CUSTO DAS MERCADORIAS VENDIDAS',
  'DESPESAS OPERACIONAIS',
  'DESPESAS COM PESSOAL',
  'ALUGUÉIS E ARRENDAMENTOS',
  'IMPOSTOS, TAXAS E CONTRIBUIÇÕES',
  'DESPESAS GERAIS',
  'DESPESAS FINANCEIRAS',
  'OUTRAS DESPESAS OPERACIONAIS',
  'DESPESAS C/ VENDAS',
  'ATIVOS',
  'SEM CLASSIFICAÇÃO',
];

const classificarDespesa = (cdDespesa) => {
  const codigo = parseInt(cdDespesa) || 0;
  const categoriaExcecao = getCategoriaPorCodigo(codigo);
  if (categoriaExcecao) return categoriaExcecao;
  if (codigo >= 1000 && codigo <= 1999) return 'CUSTO DAS MERCADORIAS VENDIDAS';
  if (codigo >= 2000 && codigo <= 2999) return 'DESPESAS OPERACIONAIS';
  if (codigo >= 3000 && codigo <= 3999) return 'DESPESAS COM PESSOAL';
  if (codigo >= 4001 && codigo <= 4999) return 'ALUGUÉIS E ARRENDAMENTOS';
  if (codigo >= 5000 && codigo <= 5999)
    return 'IMPOSTOS, TAXAS E CONTRIBUIÇÕES';
  if (codigo >= 6000 && codigo <= 6999) return 'DESPESAS GERAIS';
  if (codigo >= 7000 && codigo <= 7999) return 'DESPESAS FINANCEIRAS';
  if (codigo >= 9000 && codigo <= 9999) return 'DESPESAS C/ VENDAS';
  return 'SEM CLASSIFICAÇÃO';
};

const DESPESAS_VERMELHAS = new Set([
  'ALUGUEIS DE IMOVEIS',
  'AGUA E ESGOTO',
  'ENERGIA ELETRICA',
  'TELEFONE',
  'INTERNET',
]);

const DESPESAS_AMARELAS = new Set([
  'IMPOSTOS',
  'FGTS',
  'SALARIOS E ORDENADOS',
  'SOFTWARE E SISTEMA',
  'RESCISAO CONTRATO DE TRABALHO',
  'FERIAS',
  'SERVICOS PRESTADOS POR TERCEIROS',
]);

const getCorDespesa = (nome) => {
  const upper = (nome || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (DESPESAS_VERMELHAS.has(upper)) return 'red';
  if (DESPESAS_AMARELAS.has(upper)) return 'yellow';
  return null;
};

const DespesasPorCategoria = React.memo(
  ({
    dados,
    totalContas,
    linhasSelecionadas,
    toggleLinhaSelecionada,
    filtroMensal,
    setFiltroMensal,
    dadosOriginais,
    filtroDia,
    setFiltroDia,
    handleFiltroMensalChange,
    obterDiasDoMes,
    abrirModalDetalhes,
    getSortIcon,
    handleSort,
  }) => {
    const [categoriasExpandidas, setCategoriasExpandidas] = useState(new Set());
    const [todosExpandidos, setTodosExpandidos] = useState(false);
    const [filtroCor, setFiltroCor] = useState(new Set()); // vazio = TODOS

    // Memoizar agrupamento de dados por categoria (4 níveis: Categoria > Despesa > Fornecedor > Centro de Custo > Duplicatas)
    const dadosAgrupados = useMemo(() => {
      const categorias = {};
      const dadosAgr = agruparDadosIdenticos(dados);

      dadosAgr.forEach((grupo, index) => {
        const item = grupo.item;
        const cdDespesa = item.cd_despesaitem;
        const nomeDespesa = item.ds_despesaitem || 'SEM DESCRIÇÃO';
        const nomeFornecedor = item.nm_fornecedor || 'SEM FORNECEDOR';
        const cdCcusto = item.cd_ccusto || 'SEM C.CUSTO';
        const vlDuplicata = parseFloat(item.vl_duplicata || 0);
        const categoria = classificarDespesa(cdDespesa);

        if (!categorias[categoria]) {
          categorias[categoria] = {
            nome: categoria,
            despesas: {},
            total: 0,
            quantidade: 0,
          };
        }
        if (!categorias[categoria].despesas[nomeDespesa]) {
          categorias[categoria].despesas[nomeDespesa] = {
            nome: nomeDespesa,
            fornecedores: {},
            total: 0,
            quantidade: 0,
          };
        }

        const desp = categorias[categoria].despesas[nomeDespesa];
        if (!desp.fornecedores[nomeFornecedor]) {
          desp.fornecedores[nomeFornecedor] = {
            nome: nomeFornecedor,
            centrosCusto: {},
            total: 0,
            quantidade: 0,
          };
        }

        const forn = desp.fornecedores[nomeFornecedor];
        if (!forn.centrosCusto[cdCcusto]) {
          forn.centrosCusto[cdCcusto] = {
            codigo: cdCcusto,
            nome: item.ds_ccusto || cdCcusto,
            duplicatas: [],
            total: 0,
            quantidade: 0,
          };
        }

        const cc = forn.centrosCusto[cdCcusto];
        cc.duplicatas.push({ grupo, indiceOriginal: index });
        cc.total += vlDuplicata;
        cc.quantidade += 1;

        forn.total += vlDuplicata;
        forn.quantidade += 1;
        desp.total += vlDuplicata;
        desp.quantidade += 1;
        categorias[categoria].total += vlDuplicata;
        categorias[categoria].quantidade += 1;
      });

      return ORDEM_CATEGORIAS.filter((cat) => categorias[cat]).map((cat) => {
        const c = categorias[cat];
        c.despesasArray = Object.values(c.despesas)
          .map((despesa) => {
            despesa.fornecedoresArray = Object.values(despesa.fornecedores)
              .map((forn) => {
                forn.centrosCustoArray = Object.values(forn.centrosCusto).sort(
                  (a, b) => b.total - a.total,
                );
                return forn;
              })
              .sort((a, b) => b.total - a.total);
            return despesa;
          })
          .sort((a, b) => b.total - a.total);
        return c;
      });
    }, [dados]);

    // Filtrar categorias por cor de despesa
    const dadosFiltradosPorCor = useMemo(() => {
      if (filtroCor.size === 0) return dadosAgrupados;
      return dadosAgrupados
        .map((cat) => {
          const despFiltradas = cat.despesasArray.filter((d) => {
            const cor = getCorDespesa(d.nome);
            return filtroCor.has(cor);
          });
          if (despFiltradas.length === 0) return null;
          return { ...cat, despesasArray: despFiltradas };
        })
        .filter(Boolean);
    }, [dadosAgrupados, filtroCor]);

    const toggleFiltroCor = useCallback((cor) => {
      setFiltroCor((prev) => {
        const n = new Set(prev);
        n.has(cor) ? n.delete(cor) : n.add(cor);
        return n;
      });
    }, []);

    // Memoizar cálculo mensal
    const dadosMensais = useMemo(() => {
      const meses = [
        'JAN',
        'FEV',
        'MAR',
        'ABR',
        'MAI',
        'JUN',
        'JUL',
        'AGO',
        'SET',
        'OUT',
        'NOV',
        'DEZ',
      ];
      const result = { ANO: dadosOriginais.length };
      meses.forEach((mes, index) => {
        const numeroMes = index + 1;
        result[mes] = dadosOriginais.filter((item) => {
          if (!item.dt_vencimento) return false;
          const data = criarDataSemFusoHorario(item.dt_vencimento);
          return data.getMonth() + 1 === numeroMes;
        }).length;
      });
      return result;
    }, [dadosOriginais]);

    const toggleCategoria = useCallback((nome) => {
      setCategoriasExpandidas((prev) => {
        const n = new Set(prev);
        n.has(nome) ? n.delete(nome) : n.add(nome);
        return n;
      });
    }, []);

    const toggleDespesa = useCallback((cat, desp) => {
      const chave = `${cat}|${desp}`;
      setCategoriasExpandidas((prev) => {
        const n = new Set(prev);
        n.has(chave) ? n.delete(chave) : n.add(chave);
        return n;
      });
    }, []);

    const toggleFornecedor = useCallback((cat, desp, forn) => {
      const chave = `${cat}|${desp}|${forn}`;
      setCategoriasExpandidas((prev) => {
        const n = new Set(prev);
        n.has(chave) ? n.delete(chave) : n.add(chave);
        return n;
      });
    }, []);

    const toggleCentroCusto = useCallback((cat, desp, forn, cc) => {
      const chave = `${cat}|${desp}|${forn}|${cc}`;
      setCategoriasExpandidas((prev) => {
        const n = new Set(prev);
        n.has(chave) ? n.delete(chave) : n.add(chave);
        return n;
      });
    }, []);

    const toggleTodosTopicos = useCallback(() => {
      if (todosExpandidos) {
        setCategoriasExpandidas(new Set());
        setTodosExpandidos(false);
      } else {
        setCategoriasExpandidas(
          new Set(dadosFiltradosPorCor.map((c) => c.nome)),
        );
        setTodosExpandidos(true);
      }
    }, [todosExpandidos, dadosFiltradosPorCor]);

    const exportarDadosUltimaLinha = useCallback(() => {
      if (!dadosAgrupados || dadosAgrupados.length === 0) {
        alert('Nenhum dado disponível para exportar');
        return;
      }
      const dadosParaExportar = [];
      dadosAgrupados.forEach((cat) => {
        cat.despesasArray.forEach((desp) => {
          desp.fornecedoresArray.forEach((forn) => {
            forn.centrosCustoArray.forEach((cc) => {
              cc.duplicatas.forEach((dup) => {
                const d = dup.grupo.item;
                dadosParaExportar.push({
                  Categoria: cat.nome,
                  Despesa: desp.nome,
                  Fornecedor: forn.nome,
                  'Centro de Custo': cc.codigo,
                  'Desc. Centro Custo': cc.nome,
                  Duplicata: d.nr_duplicata,
                  Valor: parseFloat(d.vl_duplicata || 0),
                  Vencimento: formatarData(d.dt_vencimento),
                  'Código Fornecedor': d.cd_fornecedor || '',
                  'Nome Fornecedor': d.nm_fornecedor || '',
                  'Despesa Item': d.ds_despesaitem || '',
                  Empresa: d.nm_empresa
                    ? `${d.cd_empresa} - ${d.nm_empresa}`
                    : d.cd_empresa || '',
                  Portador: d.nr_portador || '',
                  Emissão: formatarData(d.dt_emissao),
                  Entrada: formatarData(d.dt_entrada),
                  Liquidação: formatarData(d.dt_liq),
                  Situação: d.tp_situacao || '',
                  Estágio: d.tp_estagio || '',
                  Juros: parseFloat(d.vl_juros || 0),
                  Acréscimo: parseFloat(d.vl_acrescimo || 0),
                  Desconto: parseFloat(d.vl_desconto || 0),
                  Pago: parseFloat(d.vl_pago || 0),
                  Aceite: d.in_aceite || '',
                  Parcela: d.nr_parcela || '',
                  '% Rateio': d.perc_rateio || '',
                  'Vl Rateio': d.vl_rateio || '',
                  Observação: d.ds_observacao || '',
                  Previsão: d.tp_previsaoreal || '',
                });
              });
            });
          });
        });
      });
      if (dadosParaExportar.length === 0) return;
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(dadosParaExportar);
      XLSX.utils.book_append_sheet(wb, ws, 'Contas a Pagar');
      const fileName = `contas_a_pagar_${new Date().toISOString().split('T')[0]}.xlsx`;
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(
        new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        fileName,
      );
    }, [dadosAgrupados]);

    const fmt = (v) =>
      v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return (
      <div className="space-y-4">
        {/* Filtros Mensais */}
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex items-center gap-1 mb-3">
            <Calendar size={10} className="text-[#000638]" />
            <h3 className="font-bold text-sm text-[#000638]">
              Filtro por Período (Data Vencimento)
            </h3>
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => handleFiltroMensalChange('ANO')}
              className={`px-4 py-2 text-[0.7rem] font-medium rounded-md transition-colors ${
                filtroMensal === 'ANO'
                  ? 'bg-[#000638] text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
              }`}
            >
              ANO
            </button>
            {[
              'JAN',
              'FEV',
              'MAR',
              'ABR',
              'MAI',
              'JUN',
              'JUL',
              'AGO',
              'SET',
              'OUT',
              'NOV',
              'DEZ',
            ].map((mes) => (
              <button
                key={mes}
                onClick={() => handleFiltroMensalChange(mes)}
                className={`px-2 py-2 text-[0.7rem] font-medium rounded-md transition-colors ${
                  filtroMensal === mes
                    ? 'bg-[#000638] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
                }`}
              >
                {mes}
              </button>
            ))}
          </div>
          <div className="mt-3 text-xs text-gray-500">
            <span className="font-medium">Filtro ativo:</span> {filtroMensal}
            {filtroDia && <span className="ml-1">- Dia {filtroDia}</span>}
            <span className="ml-2">
              ({dados.length} registro{dados.length !== 1 ? 's' : ''})
            </span>
          </div>
          {filtroMensal !== 'ANO' && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center gap-1 mb-3">
                <Calendar size={14} className="text-[#000638]" />
                <h4 className="font-bold text-sm text-[#000638]">
                  Filtro por Dia - {filtroMensal}
                </h4>
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setFiltroDia(null)}
                  className={`px-0.5 py-0.5 text-xs font-medium rounded-md transition-colors ${
                    filtroDia === null
                      ? 'bg-[#000638] text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
                  }`}
                >
                  TODOS
                </button>
                {Array.from(
                  { length: obterDiasDoMes(filtroMensal) },
                  (_, i) => i + 1,
                ).map((dia) => (
                  <button
                    key={dia}
                    onClick={() => setFiltroDia(dia)}
                    className={`px-0.5 py-0.5 text-xs font-medium rounded-md transition-colors ${
                      filtroDia === dia
                        ? 'bg-[#000638] text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
                    }`}
                  >
                    {dia}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Categorias */}
        <div className="space-y-2">
          {dadosFiltradosPorCor.length > 0 && (
            <div className="flex justify-between items-center flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleTodosTopicos}
                  className="text-xs text-gray-500 hover:text-gray-700 px-0.5 py-0.5 rounded transition-colors flex items-center gap-1"
                >
                  {todosExpandidos ? (
                    <>
                      <span>−</span>
                      <span>Colapsar tudo</span>
                    </>
                  ) : (
                    <>
                      <span>+</span>
                      <span>Expandir tudo</span>
                    </>
                  )}
                </button>
                <div className="flex items-center gap-1 ml-2">
                  <span className="text-xs text-gray-500 font-medium">
                    Tipo:
                  </span>
                  <button
                    onClick={() => setFiltroCor(new Set())}
                    className={`text-xs px-2 py-1 rounded transition-colors font-medium ${
                      filtroCor.size === 0
                        ? 'bg-[#000638] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    TODOS
                  </button>
                  <button
                    onClick={() => toggleFiltroCor('red')}
                    className={`text-xs px-2 py-1 rounded transition-colors font-medium flex items-center gap-1 ${
                      filtroCor.has('red')
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                    VERMELHO
                  </button>
                  <button
                    onClick={() => toggleFiltroCor('yellow')}
                    className={`text-xs px-2 py-1 rounded transition-colors font-medium flex items-center gap-1 ${
                      filtroCor.has('yellow')
                        ? 'bg-yellow-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                    AMARELO
                  </button>
                </div>
              </div>
              <button
                onClick={exportarDadosUltimaLinha}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium"
              >
                <FileArrowDown size={14} />
                BAIXAR EXCEL
              </button>
            </div>
          )}

          {dadosFiltradosPorCor.map((categoria, ci) => {
            const catExpanded = categoriasExpandidas.has(categoria.nome);
            return (
              <div
                key={`cat-${ci}`}
                className="border border-gray-200 rounded-lg overflow-hidden"
              >
                <div
                  className="bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors px-2 py-1.5 flex items-center justify-between"
                  onClick={() => toggleCategoria(categoria.nome)}
                >
                  <div className="flex items-center space-x-2">
                    {catExpanded ? (
                      <CaretDown size={10} className="text-gray-600" />
                    ) : (
                      <CaretRight size={10} className="text-gray-600" />
                    )}
                    <div>
                      <h3 className="font-medium text-xs text-gray-800">
                        {categoria.nome}
                      </h3>
                      <div className="flex items-center space-x-3 text-xs text-gray-600">
                        <span>{categoria.quantidade} conta(s)</span>
                        <span>{categoria.despesasArray.length} despesa(s)</span>
                        <span className="font-medium text-red-600">
                          {fmt(categoria.total)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {catExpanded && (
                  <div className="bg-white border-t border-gray-100">
                    {categoria.despesasArray.map((despesa, di) => {
                      const despKey = `${categoria.nome}|${despesa.nome}`;
                      const despExpanded = categoriasExpandidas.has(despKey);
                      const corDespesa = getCorDespesa(despesa.nome);
                      return (
                        <div
                          key={`desp-${di}`}
                          className={`border-b border-gray-100 last:border-b-0 ${
                            corDespesa === 'red'
                              ? 'border-l-4 border-l-red-500'
                              : corDespesa === 'yellow'
                                ? 'border-l-4 border-l-yellow-400'
                                : ''
                          }`}
                        >
                          <div
                            className={`hover:bg-gray-50 cursor-pointer transition-colors px-4 py-1.5 flex items-center justify-between ${
                              corDespesa === 'red'
                                ? 'bg-red-50'
                                : corDespesa === 'yellow'
                                  ? 'bg-yellow-50'
                                  : ''
                            }`}
                            onClick={() =>
                              toggleDespesa(categoria.nome, despesa.nome)
                            }
                          >
                            <div className="flex items-center space-x-2">
                              {despExpanded ? (
                                <CaretDown
                                  size={10}
                                  className="text-gray-500"
                                />
                              ) : (
                                <CaretRight
                                  size={10}
                                  className="text-gray-500"
                                />
                              )}
                              <div>
                                <h4 className="font-medium text-xs flex items-center gap-1.5">
                                  {corDespesa && (
                                    <span
                                      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                                        corDespesa === 'red'
                                          ? 'bg-red-500'
                                          : 'bg-yellow-400'
                                      }`}
                                    />
                                  )}
                                  <span
                                    className={
                                      corDespesa === 'red'
                                        ? 'text-red-700'
                                        : corDespesa === 'yellow'
                                          ? 'text-yellow-700'
                                          : 'text-gray-700'
                                    }
                                  >
                                    {despesa.nome}
                                  </span>
                                </h4>
                                <div className="flex items-center space-x-3 text-xs text-gray-500">
                                  <span>{despesa.quantidade} conta(s)</span>
                                  <span>
                                    {despesa.fornecedoresArray.length}{' '}
                                    fornecedor(es)
                                  </span>
                                  <span className="font-medium text-red-500">
                                    {fmt(despesa.total)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {despExpanded && (
                            <div className="bg-white border-t border-gray-50">
                              {despesa.fornecedoresArray.map((forn, fi) => {
                                const fornKey = `${categoria.nome}|${despesa.nome}|${forn.nome}`;
                                const fornExpanded =
                                  categoriasExpandidas.has(fornKey);
                                return (
                                  <div
                                    key={`forn-${fi}`}
                                    className="border-b border-gray-50 last:border-b-0"
                                  >
                                    <div
                                      className="hover:bg-gray-50 cursor-pointer transition-colors px-6 py-1.5 flex items-center justify-between"
                                      onClick={() =>
                                        toggleFornecedor(
                                          categoria.nome,
                                          despesa.nome,
                                          forn.nome,
                                        )
                                      }
                                    >
                                      <div className="flex items-center space-x-2">
                                        {fornExpanded ? (
                                          <CaretDown
                                            size={10}
                                            className="text-gray-400"
                                          />
                                        ) : (
                                          <CaretRight
                                            size={10}
                                            className="text-gray-400"
                                          />
                                        )}
                                        <div>
                                          <h5 className="font-medium text-xs text-gray-600">
                                            {forn.nome}
                                          </h5>
                                          <div className="flex items-center space-x-3 text-xs text-gray-400">
                                            <span>
                                              {forn.quantidade} conta(s)
                                            </span>
                                            <span>
                                              {forn.centrosCustoArray.length}{' '}
                                              centro(s) de custo
                                            </span>
                                            <span className="font-medium text-red-400">
                                              {fmt(forn.total)}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    {fornExpanded && (
                                      <div className="bg-white border-t border-gray-50">
                                        {forn.centrosCustoArray.map(
                                          (cc, cci) => {
                                            const ccKey = `${categoria.nome}|${despesa.nome}|${forn.nome}|${cc.codigo}`;
                                            const ccExpanded =
                                              categoriasExpandidas.has(ccKey);
                                            return (
                                              <div
                                                key={`cc-${cci}`}
                                                className="border-b border-gray-50 last:border-b-0"
                                              >
                                                <div
                                                  className="hover:bg-gray-50 cursor-pointer transition-colors px-8 py-1.5 flex items-center justify-between"
                                                  onClick={() =>
                                                    toggleCentroCusto(
                                                      categoria.nome,
                                                      despesa.nome,
                                                      forn.nome,
                                                      cc.codigo,
                                                    )
                                                  }
                                                >
                                                  <div className="flex items-center space-x-2">
                                                    {ccExpanded ? (
                                                      <CaretDown
                                                        size={10}
                                                        className="text-gray-300"
                                                      />
                                                    ) : (
                                                      <CaretRight
                                                        size={10}
                                                        className="text-gray-300"
                                                      />
                                                    )}
                                                    <div>
                                                      <h6 className="font-medium text-xs text-gray-500">
                                                        FORNECEDOR: {forn.nome}{' '}
                                                        | C. CUSTO: {cc.codigo}
                                                      </h6>
                                                      <div className="flex items-center space-x-3 text-xs text-gray-400">
                                                        <span>
                                                          {cc.quantidade}{' '}
                                                          duplicata(s)
                                                        </span>
                                                        <span className="font-medium text-red-400">
                                                          {fmt(cc.total)}
                                                        </span>
                                                      </div>
                                                    </div>
                                                  </div>
                                                </div>

                                                {ccExpanded && (
                                                  <div className="bg-white overflow-x-auto">
                                                    <table
                                                      className={TABLE_CLASSES}
                                                    >
                                                      <thead>
                                                        <tr
                                                          className={`${TABLE_HEADER_CLASSES} text-[8px]`}
                                                        >
                                                          <th
                                                            className="px-0.5 py-0.5 text-center text-[8px]"
                                                            style={getStickyColStyle(
                                                              true,
                                                            )}
                                                          >
                                                            Sel
                                                          </th>
                                                          {[
                                                            'Vencimento',
                                                            'Valor',
                                                            'Fornecedor',
                                                            'NM Fornecedor',
                                                            'Despesa',
                                                            'C CUSTO',
                                                            'Empresa',
                                                            'Duplicata',
                                                            'Portador',
                                                            'Emissão',
                                                            'Entrada',
                                                            'Liquidação',
                                                            'Situação',
                                                            'Estágio',
                                                            'Juros',
                                                            'Acréscimo',
                                                            'Desconto',
                                                            'Pago',
                                                            'Aceite',
                                                            'Parcela',
                                                            '% Rateio',
                                                            'Vl Rateio',
                                                            'Observação',
                                                            'Previsão',
                                                          ].map((h) => (
                                                            <th
                                                              key={h}
                                                              className="px-0.5 py-0.5 text-center text-[8px]"
                                                            >
                                                              {h}
                                                            </th>
                                                          ))}
                                                        </tr>
                                                      </thead>
                                                      <tbody>
                                                        {cc.duplicatas.map(
                                                          (dup, idx) => {
                                                            const d =
                                                              dup.grupo.item;
                                                            const idxReal =
                                                              dup.indiceOriginal;
                                                            const isSel =
                                                              linhasSelecionadas.has(
                                                                idxReal,
                                                              );
                                                            const isEven =
                                                              idx % 2 === 0;
                                                            return (
                                                              <tr
                                                                key={`${d.cd_empresa}-${d.nr_duplicata}-${idx}`}
                                                                className={`text-[8px] border-b transition-colors cursor-pointer ${
                                                                  isSel
                                                                    ? 'bg-blue-100 hover:bg-blue-200'
                                                                    : isEven
                                                                      ? 'bg-white hover:bg-gray-100'
                                                                      : 'bg-gray-50 hover:bg-gray-100'
                                                                }`}
                                                                onClick={() =>
                                                                  abrirModalDetalhes(
                                                                    d,
                                                                  )
                                                                }
                                                              >
                                                                <td
                                                                  className="px-0.5 py-0.5 text-center"
                                                                  style={getStickyColStyle(
                                                                    false,
                                                                    isSel,
                                                                    isEven,
                                                                  )}
                                                                >
                                                                  <input
                                                                    type="checkbox"
                                                                    checked={
                                                                      isSel
                                                                    }
                                                                    onChange={(
                                                                      e,
                                                                    ) => {
                                                                      e.stopPropagation();
                                                                      toggleLinhaSelecionada(
                                                                        idxReal,
                                                                      );
                                                                    }}
                                                                    className="rounded w-3 h-3"
                                                                    onClick={(
                                                                      e,
                                                                    ) =>
                                                                      e.stopPropagation()
                                                                    }
                                                                  />
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {formatarData(
                                                                    d.dt_vencimento,
                                                                  )}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-right font-medium text-green-600">
                                                                  {fmt(
                                                                    parseFloat(
                                                                      d.vl_duplicata ||
                                                                        0,
                                                                    ),
                                                                  )}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {d.cd_fornecedor ||
                                                                    ''}
                                                                </td>
                                                                <td
                                                                  className="px-0.5 py-0.5 text-left max-w-32 truncate"
                                                                  title={
                                                                    d.nm_fornecedor
                                                                  }
                                                                >
                                                                  {d.nm_fornecedor ||
                                                                    ''}
                                                                </td>
                                                                <td
                                                                  className="px-0.5 py-0.5 text-left max-w-48 truncate min-w-32"
                                                                  title={
                                                                    d.ds_despesaitem
                                                                  }
                                                                >
                                                                  {d.ds_despesaitem ||
                                                                    ''}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {d.cd_ccusto ||
                                                                    ''}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {d.nm_empresa
                                                                    ? `${d.cd_empresa} - ${d.nm_empresa}`
                                                                    : d.cd_empresa ||
                                                                      ''}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {d.nr_duplicata ||
                                                                    ''}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {d.nr_portador ||
                                                                    ''}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {formatarData(
                                                                    d.dt_emissao,
                                                                  )}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {formatarData(
                                                                    d.dt_entrada,
                                                                  )}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {formatarData(
                                                                    d.dt_liq,
                                                                  )}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {d.tp_situacao ||
                                                                    ''}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {d.tp_estagio ||
                                                                    ''}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-right">
                                                                  {fmt(
                                                                    parseFloat(
                                                                      d.vl_juros ||
                                                                        0,
                                                                    ),
                                                                  )}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-right">
                                                                  {fmt(
                                                                    parseFloat(
                                                                      d.vl_acrescimo ||
                                                                        0,
                                                                    ),
                                                                  )}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-right">
                                                                  {fmt(
                                                                    parseFloat(
                                                                      d.vl_desconto ||
                                                                        0,
                                                                    ),
                                                                  )}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-right">
                                                                  {fmt(
                                                                    parseFloat(
                                                                      d.vl_pago ||
                                                                        0,
                                                                    ),
                                                                  )}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {d.in_aceite ||
                                                                    ''}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {d.nr_parcela ||
                                                                    ''}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-right">
                                                                  {d.perc_rateio
                                                                    ? `${d.perc_rateio}%`
                                                                    : ''}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-right">
                                                                  {fmt(
                                                                    parseFloat(
                                                                      d.vl_rateio ||
                                                                        0,
                                                                    ),
                                                                  )}
                                                                </td>
                                                                <td
                                                                  className="px-0.5 py-0.5 text-left max-w-32 truncate"
                                                                  title={
                                                                    d.ds_observacao
                                                                  }
                                                                >
                                                                  {d.ds_observacao ||
                                                                    ''}
                                                                </td>
                                                                <td className="px-0.5 py-0.5 text-center">
                                                                  {d.tp_previsaoreal ||
                                                                    ''}
                                                                </td>
                                                              </tr>
                                                            );
                                                          },
                                                        )}
                                                      </tbody>
                                                    </table>
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          },
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {dadosFiltradosPorCor.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              {filtroCor.size > 0
                ? 'Nenhuma despesa encontrada para o filtro de cor selecionado'
                : 'Nenhuma despesa encontrada para os filtros selecionados'}
            </div>
          )}
        </div>
      </div>
    );
  },
);

DespesasPorCategoria.displayName = 'DespesasPorCategoria';

export default DespesasPorCategoria;
