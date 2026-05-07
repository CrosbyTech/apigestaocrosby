import React, { useState, useEffect } from 'react';
import { Target, Calendar, Plus } from '@phosphor-icons/react';
import useMetasSemanais from '../hooks/useMetasSemanais';
import MetasSemanaisModal from './MetasSemanaisModal';

const MetasSemanaisView = ({ mes, tipo, entidades }) => {
  const {
    loading,
    error,
    gerarSemanasDoMes,
    buscarMetasSemanaisAgrupadas,
    buscarMetasMensaisCalculadas,
  } = useMetasSemanais();

  const [semanas, setSemanas] = useState([]);
  const [metasSemanais, setMetasSemanais] = useState({});
  const [metasMensais, setMetasMensais] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [entidadeSelecionada, setEntidadeSelecionada] = useState(null);

  useEffect(() => {
    if (mes) {
      carregarDados();
    }
  }, [mes]);

  const carregarDados = async () => {
    // Carregar semanas do mês
    const semanasDoMes = gerarSemanasDoMes(mes);
    setSemanas(semanasDoMes);

    // Carregar metas semanais
    const resultadoSemanais = await buscarMetasSemanaisAgrupadas(mes);
    if (resultadoSemanais.success) {
      setMetasSemanais(resultadoSemanais.data);
    }

    // Carregar metas mensais calculadas
    const resultadoMensais = await buscarMetasMensaisCalculadas(mes, mes, tipo);
    if (resultadoMensais.success) {
      const agrupado = {};
      resultadoMensais.data.forEach((meta) => {
        const chave = `${meta.tipo}-${meta.nome}`;
        agrupado[chave] = meta;
      });
      setMetasMensais(agrupado);
    }
  };

  const formatBRL = (num) => {
    const n = Number(num);
    if (isNaN(n)) return 'R$ 0,00';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const obterCoresCampo = (campo) => {
    const cores = {
      bronze: {
        bg: 'bg-amber-100',
        text: 'text-amber-700',
        border: 'border-amber-200',
      },
      prata: {
        bg: 'bg-gray-100',
        text: 'text-gray-700',
        border: 'border-gray-200',
      },
      ouro: {
        bg: 'bg-yellow-100',
        text: 'text-yellow-700',
        border: 'border-yellow-200',
      },
      diamante: {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        border: 'border-blue-200',
      },
    };
    return cores[campo] || cores.bronze;
  };

  const renderCardSemana = (semana, entidade) => {
    const chave = `${tipo}-${entidade.nome || entidade.nome_fantasia}`;
    const metasEntidade = metasSemanais[chave];
    const metasSemana = metasEntidade?.semanas[semana.numero]?.metas || {};

    const campos = ['bronze', 'prata', 'ouro', 'diamante'];
    const totalSemana = campos.reduce((total, campo) => {
      return total + (metasSemana[campo] || 0);
    }, 0);

    return (
      <div
        key={semana.numero}
        className="bg-white border border-gray-200 rounded-lg p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="font-bold text-gray-800">{semana.label}</h4>
            <p className="text-xs text-gray-600">{semana.periodo}</p>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-green-600">
              {formatBRL(totalSemana)}
            </div>
            <div className="text-xs text-gray-500">Total</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {campos.map((campo) => {
            const valor = metasSemana[campo] || 0;
            const cores = obterCoresCampo(campo);

            return (
              <div
                key={campo}
                className={`${cores.bg} ${cores.border} border rounded-lg p-2`}
              >
                <div
                  className="text-xs font-semibold uppercase mb-1"
                  style={{ color: cores.text.replace('text-', '#') }}
                >
                  {campo}
                </div>
                <div className={`text-sm font-bold ${cores.text}`}>
                  {formatBRL(valor)}
                </div>
              </div>
            );
          })}
        </div>

        {totalSemana === 0 && (
          <div className="mt-3 text-center">
            <button
              onClick={() => abrirModal(entidade)}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 mx-auto"
            >
              <Plus size={12} />
              Configurar Metas
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderResumoMensal = (entidade) => {
    const chave = `${tipo}-${entidade.nome || entidade.nome_fantasia}`;
    const metaMensal = metasMensais[chave];

    if (!metaMensal) {
      return (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-center text-gray-500">
            <Target size={24} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">Nenhuma meta configurada</p>
          </div>
        </div>
      );
    }

    const campos = ['bronze', 'prata', 'ouro', 'diamante'];
    const totalMensal = campos.reduce((total, campo) => {
      return total + (metaMensal[campo] || 0);
    }, 0);

    return (
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="font-bold text-blue-800">Meta Mensal Total</h4>
            <p className="text-sm text-blue-600">Calculada automaticamente</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">
              {formatBRL(totalMensal)}
            </div>
            <div className="text-xs text-blue-500">Soma das semanas</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {campos.map((campo) => {
            const valor = metaMensal[campo] || 0;
            const cores = obterCoresCampo(campo);

            return (
              <div
                key={campo}
                className={`${cores.bg} ${cores.border} border rounded-lg p-2`}
              >
                <div
                  className="text-xs font-semibold uppercase mb-1"
                  style={{ color: cores.text.replace('text-', '#') }}
                >
                  {campo}
                </div>
                <div className={`text-sm font-bold ${cores.text}`}>
                  {formatBRL(valor)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const abrirModal = (entidade) => {
    setEntidadeSelecionada(entidade);
    setShowModal(true);
  };

  const fecharModal = () => {
    setShowModal(false);
    setEntidadeSelecionada(null);
    carregarDados(); // Recarregar dados após salvar
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <span className="text-gray-600">Carregando metas semanais...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Calendar size={20} className="text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-800">
              Metas Semanais - {mes}
            </h3>
            <p className="text-sm text-gray-600">
              Configure metas por semana que se somam para formar a meta mensal
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Nova Meta
        </button>
      </div>

      {/* Lista de Entidades */}
      <div className="space-y-6">
        {entidades.map((entidade) => (
          <div
            key={entidade.nome || entidade.nome_fantasia}
            className="bg-white rounded-lg border border-gray-200 p-6"
          >
            {/* Header da Entidade */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-lg font-bold text-gray-800">
                  {entidade.nome || entidade.nome_fantasia}
                </h4>
                <p className="text-sm text-gray-600">
                  {tipo === 'lojas' ? 'Loja' : 'Vendedor'}
                </p>
              </div>
              <button
                onClick={() => abrirModal(entidade)}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
              >
                <Plus size={14} />
                Configurar
              </button>
            </div>

            {/* Resumo Mensal */}
            <div className="mb-6">{renderResumoMensal(entidade)}</div>

            {/* Semanas */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {semanas.map((semana) => renderCardSemana(semana, entidade))}
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      <MetasSemanaisModal
        isOpen={showModal}
        onClose={fecharModal}
        mes={mes}
        tipo={tipo}
        entidades={entidades}
        onMetasSalvas={carregarDados}
      />
    </div>
  );
};

export default MetasSemanaisView;
