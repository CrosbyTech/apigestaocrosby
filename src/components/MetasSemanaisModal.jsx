import React, { useState, useEffect } from 'react';
import { X, Calendar, Target } from '@phosphor-icons/react';
import useMetasSemanais from '../hooks/useMetasSemanais';

const MetasSemanaisModal = ({
  isOpen,
  onClose,
  mes,
  tipo,
  entidades, // Array de lojas ou vendedores
  onMetasSalvas,
}) => {
  const {
    loading,
    error,
    gerarSemanasDoMes,
    buscarMetasSemanaisAgrupadas,
    salvarMetasSemanais,
    recalcularMetasMensais,
  } = useMetasSemanais();

  const [semanas, setSemanas] = useState([]);
  const [metasExistentes, setMetasExistentes] = useState({});
  const [metasEditadas, setMetasEditadas] = useState({});
  const [entidadeSelecionada, setEntidadeSelecionada] = useState(null);
  const [semanaSelecionada, setSemanaSelecionada] = useState(null);

  // Carregar semanas do mês
  useEffect(() => {
    if (isOpen && mes) {
      const semanasDoMes = gerarSemanasDoMes(mes);
      setSemanas(semanasDoMes);
    }
  }, [isOpen, mes, gerarSemanasDoMes]);

  // Carregar metas existentes
  useEffect(() => {
    if (isOpen && mes) {
      carregarMetasExistentes();
    }
  }, [isOpen, mes]);

  const carregarMetasExistentes = async () => {
    const resultado = await buscarMetasSemanaisAgrupadas(mes);
    if (resultado.success) {
      setMetasExistentes(resultado.data);
    }
  };

  const formatBRL = (num) => {
    const n = Number(num);
    if (isNaN(n)) return 'R$ 0,00';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const toNumber = (value) => {
    if (value === '' || value === null || value === undefined) return 0;
    const withoutCurrency = String(value).replace(/R\$\s*/g, '');
    const normalized = withoutCurrency.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return isNaN(n) ? 0 : n;
  };

  const sanitizeInput = (value) => {
    return String(value ?? '').replace(/[^0-9,\.]/g, '');
  };

  const obterChaveMeta = (entidade, semana, campo) => {
    return `${entidade}-${semana}-${campo}`;
  };

  const obterValorMeta = (entidade, semana, campo) => {
    const chave = obterChaveMeta(entidade, semana, campo);
    return (
      metasEditadas[chave] ||
      metasExistentes[`${tipo}-${entidade}`]?.semanas[semana]?.metas[campo] ||
      0
    );
  };

  const atualizarMeta = (entidade, semana, campo, valor) => {
    const chave = obterChaveMeta(entidade, semana, campo);
    setMetasEditadas((prev) => ({
      ...prev,
      [chave]: valor,
    }));
  };

  const calcularTotalSemana = (entidade, semana) => {
    const campos = ['bronze', 'prata', 'ouro', 'diamante'];
    return campos.reduce((total, campo) => {
      return total + (obterValorMeta(entidade, semana, campo) || 0);
    }, 0);
  };

  const calcularTotalMes = (entidade) => {
    return semanas.reduce((total, semana) => {
      return total + calcularTotalSemana(entidade, semana.numero);
    }, 0);
  };

  const salvarMetas = async () => {
    if (!entidadeSelecionada) return;

    const metasParaSalvar = [];

    semanas.forEach((semana) => {
      const campos = ['bronze', 'prata', 'ouro', 'diamante'];
      const metasSemana = {};

      campos.forEach((campo) => {
        const valor = obterValorMeta(entidadeSelecionada, semana.numero, campo);
        if (valor > 0) {
          metasSemana[campo] = valor;
        }
      });

      if (Object.keys(metasSemana).length > 0) {
        metasParaSalvar.push({
          tipo: tipo,
          nome: entidadeSelecionada,
          semana_inicio: semana.inicio,
          semana_fim: semana.fim,
          metas: metasSemana,
          mes_referencia: mes,
          numero_semana: semana.numero,
          usuario: 'Usuário', // TODO: Obter do contexto de auth
        });
      }
    });

    if (metasParaSalvar.length > 0) {
      const resultado = await salvarMetasSemanais(metasParaSalvar);

      if (resultado.success) {
        // Recalcular metas mensais
        await recalcularMetasMensais(mes, tipo, entidadeSelecionada);

        // Notificar componente pai
        if (onMetasSalvas) {
          onMetasSalvas();
        }

        // Fechar modal
        onClose();
      }
    }
  };

  const renderInputMeta = (entidade, semana, campo, cor) => {
    const valor = obterValorMeta(entidade, semana, campo);
    const chave = obterChaveMeta(entidade, semana, campo);

    return (
      <div className="flex flex-col">
        <label className="text-xs font-semibold mb-1" style={{ color: cor }}>
          {campo.charAt(0).toUpperCase() + campo.slice(1)}
        </label>
        <input
          type="text"
          inputMode="numeric"
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="0,00"
          value={
            valor > 0
              ? valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
              : ''
          }
          onChange={(e) => {
            const valorNumerico = toNumber(e.target.value);
            atualizarMeta(entidade, semana, campo, valorNumerico);
          }}
        />
      </div>
    );
  };

  const renderSemana = (semana) => {
    if (!entidadeSelecionada) return null;

    const totalSemana = calcularTotalSemana(entidadeSelecionada, semana.numero);

    return (
      <div key={semana.numero} className="bg-gray-50 p-4 rounded-lg border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="font-bold text-gray-800">{semana.label}</h4>
            <p className="text-xs text-gray-600">{semana.periodo}</p>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-green-600">
              {formatBRL(totalSemana)}
            </div>
            <div className="text-xs text-gray-500">Total da Semana</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {renderInputMeta(
            entidadeSelecionada,
            semana.numero,
            'bronze',
            '#d97706',
          )}
          {renderInputMeta(
            entidadeSelecionada,
            semana.numero,
            'prata',
            '#6b7280',
          )}
          {renderInputMeta(
            entidadeSelecionada,
            semana.numero,
            'ouro',
            '#d97706',
          )}
          {renderInputMeta(
            entidadeSelecionada,
            semana.numero,
            'diamante',
            '#2563eb',
          )}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose}></div>

      <div className="relative bg-white rounded-lg shadow-xl border border-gray-200 w-full max-w-6xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Target size={20} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-800">
                Metas Semanais - {mes}
              </h3>
              <p className="text-sm text-gray-600">
                Configure as metas semanais que se somarão para formar a meta
                mensal
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Seletor de Entidade */}
        <div className="p-4 border-b border-gray-200">
          <label className="block text-sm font-semibold mb-2 text-gray-700">
            Selecionar {tipo === 'lojas' ? 'Loja' : 'Vendedor'}
          </label>
          <select
            value={entidadeSelecionada || ''}
            onChange={(e) => setEntidadeSelecionada(e.target.value)}
            className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="">
              Selecione uma {tipo === 'lojas' ? 'loja' : 'vendedor'}
            </option>
            {entidades.map((entidade) => (
              <option
                key={entidade.nome || entidade.nome_fantasia}
                value={entidade.nome || entidade.nome_fantasia}
              >
                {entidade.nome || entidade.nome_fantasia}
              </option>
            ))}
          </select>
        </div>

        {/* Conteúdo Principal */}
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {entidadeSelecionada ? (
            <div className="space-y-4">
              {/* Resumo do Mês */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-blue-800">
                      Meta Mensal Total
                    </h4>
                    <p className="text-sm text-blue-600">
                      {entidadeSelecionada}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-blue-600">
                      {formatBRL(calcularTotalMes(entidadeSelecionada))}
                    </div>
                    <div className="text-xs text-blue-500">
                      Soma das {semanas.length} semanas
                    </div>
                  </div>
                </div>
              </div>

              {/* Semanas */}
              <div className="space-y-4">
                {semanas.map((semana) => renderSemana(semana))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <Calendar size={48} className="text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">
                Selecione uma {tipo === 'lojas' ? 'loja' : 'vendedor'} para
                configurar as metas
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={salvarMetas}
            disabled={loading || !entidadeSelecionada}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Salvando...' : 'Salvar Metas'}
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="absolute bottom-4 left-4 right-4 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MetasSemanaisModal;
