import { useState, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../config/constants';

/**
 * Custom Hook para gerenciar autocomplete de nomes fantasia
 * Encapsula lógica de busca, debounce e seleção múltipla
 */
export const useAutocompleteFranquias = () => {
  // Estados do autocomplete
  const [nmFantasia, setNmFantasia] = useState('');
  const [sugestoes, setSugestoes] = useState([]);
  const [showSugestoes, setShowSugestoes] = useState(false);
  const [nmFantasiaSelecionados, setNmFantasiaSelecionados] = useState([]);
  const [loadingSugestoes, setLoadingSugestoes] = useState(false);

  // Ref para controlar debounce
  const debounceRef = useRef(null);

  /**
   * Sanitiza input do usuário para prevenir XSS
   * @param {string} input - Input do usuário
   * @returns {string} Input sanitizado
   */
  const sanitizeInput = useCallback((input) => {
    if (typeof input !== 'string') return '';
    
    return input
      .trim()
      .replace(/[<>]/g, '') // Remove caracteres perigosos
      .slice(0, 100); // Limita tamanho
  }, []);

  /**
   * Busca sugestões de nomes fantasia com debounce
   * @param {string} texto - Texto para busca
   */
  const fetchSugestoes = useCallback(async (texto) => {
    const textoSanitizado = sanitizeInput(texto);
    
    if (!textoSanitizado || textoSanitizado.length < 1) {
      setSugestoes([]);
      setShowSugestoes(false);
      setLoadingSugestoes(false);
      return;
    }

    setLoadingSugestoes(true);

    try {
      const encodedText = encodeURIComponent(textoSanitizado);
      const response = await fetch(`${API_BASE_URL}/autocomplete/nm_fantasia?q=${encodedText}`);
      
      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status}`);
      }
      
      const data = await response.json();
      const sugestoesArray = Array.isArray(data) ? data : [];
      
      setSugestoes(sugestoesArray);
      setShowSugestoes(sugestoesArray.length > 0);
    } catch (error) {
      console.error('Erro ao buscar sugestões:', error);
      setSugestoes([]);
      setShowSugestoes(false);
    } finally {
      setLoadingSugestoes(false);
    }
  }, [sanitizeInput]);

  /**
   * Função com debounce para evitar muitas requisições
   * @param {string} texto - Texto para busca
   */
  const debouncedFetchSugestoes = useCallback((texto) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      fetchSugestoes(texto);
    }, 300); // 300ms de debounce
  }, [fetchSugestoes]);

  /**
   * Handler para mudança no input
   * @param {Event} e - Evento de mudança
   */
  const handleChangeNmFantasia = useCallback((e) => {
    const value = sanitizeInput(e.target.value);
    setNmFantasia(value);
    debouncedFetchSugestoes(value);
  }, [sanitizeInput, debouncedFetchSugestoes]);

  /**
   * Handler para foco no input
   */
  const handleFocus = useCallback(() => {
    if (nmFantasia.trim()) {
      fetchSugestoes(nmFantasia);
    }
  }, [nmFantasia, fetchSugestoes]);

  /**
   * Handler para perda de foco com delay para permitir clique
   */
  const handleBlur = useCallback(() => {
    setTimeout(() => setShowSugestoes(false), 150);
  }, []);

  /**
   * Toggle de seleção de sugestão
   * @param {string} sugestao - Sugestão a ser toggled
   */
  const handleSugestaoToggle = useCallback((sugestao) => {
    if (!sugestao || typeof sugestao !== 'string') return;

    setNmFantasiaSelecionados(prev => {
      const isSelected = prev.includes(sugestao);
      
      if (isSelected) {
        return prev.filter(nm => nm !== sugestao);
      } else {
        // Limita a 5 seleções para evitar sobrecarga
        if (prev.length >= 5) {
          console.warn('Máximo de 5 franquias podem ser selecionadas');
          return prev;
        }
        return [...prev, sugestao];
      }
    });
  }, []);

  /**
   * Remove um item selecionado
   * @param {string} nm - Nome a ser removido
   */
  const handleRemoveSelecionado = useCallback((nm) => {
    setNmFantasiaSelecionados(prev => prev.filter(n => n !== nm));
  }, []);

  /**
   * Limpa todas as seleções
   */
  const limparSelecoes = useCallback(() => {
    setNmFantasiaSelecionados([]);
    setNmFantasia('');
    setSugestoes([]);
    setShowSugestoes(false);
  }, []);

  /**
   * Valida se há pelo menos uma seleção
   * @returns {boolean} True se válido
   */
  const isValid = useCallback(() => {
    return nmFantasiaSelecionados.length > 0;
  }, [nmFantasiaSelecionados]);

  // Cleanup do debounce no unmount
  const cleanup = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
  }, []);

  return {
    // Estados
    nmFantasia,
    sugestoes,
    showSugestoes,
    nmFantasiaSelecionados,
    loadingSugestoes,
    
    // Handlers
    handleChangeNmFantasia,
    handleFocus,
    handleBlur,
    handleSugestaoToggle,
    handleRemoveSelecionado,
    
    // Utilitários
    limparSelecoes,
    isValid,
    cleanup
  };
};