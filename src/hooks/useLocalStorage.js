import { useState, useEffect, useCallback } from 'react';

/**
 * Hook para gerenciar localStorage com sincronização e validação
 * Implementa serialização segura e handling de erros
 */
export const useLocalStorage = (key, initialValue, options = {}) => {
  const {
    serialize = JSON.stringify,
    deserialize = JSON.parse,
    syncAcrossTabs = true,
    validateValue = () => true,
    onError = console.error
  } = options;

  // Estado interno
  const [storedValue, setStoredValue] = useState(() => {
    try {
      if (typeof window === 'undefined') {
        return initialValue;
      }

      const item = window.localStorage.getItem(key);
      
      if (item === null) {
        return initialValue;
      }

      const parsedValue = deserialize(item);
      
      // Valida o valor antes de usar
      if (!validateValue(parsedValue)) {
        console.warn(`Valor inválido no localStorage para chave "${key}"`);
        return initialValue;
      }

      return parsedValue;
    } catch (error) {
      onError(`Erro ao ler localStorage para chave "${key}":`, error);
      return initialValue;
    }
  });

  /**
   * Atualiza o valor no localStorage e no estado
   */
  const setValue = useCallback((value) => {
    try {
      // Permite que value seja uma função (como useState)
      const valueToStore = value instanceof Function ? value(storedValue) : value;

      // Valida o valor antes de armazenar
      if (!validateValue(valueToStore)) {
        throw new Error('Valor não passa na validação');
      }

      // Atualiza estado
      setStoredValue(valueToStore);

      // Salva no localStorage
      if (typeof window !== 'undefined') {
        if (valueToStore === undefined) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, serialize(valueToStore));
        }
      }
    } catch (error) {
      onError(`Erro ao salvar no localStorage para chave "${key}":`, error);
    }
  }, [key, serialize, storedValue, validateValue, onError]);

  /**
   * Remove o valor do localStorage
   */
  const removeValue = useCallback(() => {
    try {
      setStoredValue(initialValue);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      onError(`Erro ao remover do localStorage para chave "${key}":`, error);
    }
  }, [key, initialValue, onError]);

  /**
   * Recarrega o valor do localStorage
   */
  const reloadValue = useCallback(() => {
    try {
      if (typeof window === 'undefined') {
        return;
      }

      const item = window.localStorage.getItem(key);
      
      if (item === null) {
        setStoredValue(initialValue);
        return;
      }

      const parsedValue = deserialize(item);
      
      if (!validateValue(parsedValue)) {
        console.warn(`Valor inválido no localStorage para chave "${key}"`);
        setStoredValue(initialValue);
        return;
      }

      setStoredValue(parsedValue);
    } catch (error) {
      onError(`Erro ao recarregar do localStorage para chave "${key}":`, error);
      setStoredValue(initialValue);
    }
  }, [key, initialValue, deserialize, validateValue, onError]);

  // Efeito para sincronização entre abas
  useEffect(() => {
    if (!syncAcrossTabs || typeof window === 'undefined') {
      return;
    }

    const handleStorageChange = (e) => {
      if (e.key === key && e.newValue !== serialize(storedValue)) {
        reloadValue();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [key, storedValue, serialize, reloadValue, syncAcrossTabs]);

  return [storedValue, setValue, removeValue, reloadValue];
};

/**
 * Hook simplificado para localStorage com tipos básicos
 */
export const useLocalStorageState = (key, initialValue) => {
  return useLocalStorage(key, initialValue, {
    serialize: (value) => {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    },
    deserialize: (value) => {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
  });
};

/**
 * Hook para configurações do usuário
 */
export const useUserPreferences = (userId) => {
  const key = `user_preferences_${userId}`;
  const defaultPreferences = {
    theme: 'light',
    language: 'pt-BR',
    notifications: true,
    compactMode: false
  };

  const validatePreferences = useCallback((prefs) => {
    if (typeof prefs !== 'object' || prefs === null) {
      return false;
    }
    
    // Validações específicas
    if (prefs.theme && !['light', 'dark'].includes(prefs.theme)) {
      return false;
    }
    
    if (prefs.language && typeof prefs.language !== 'string') {
      return false;
    }

    return true;
  }, []);

  const [preferences, setPreferences, removePreferences] = useLocalStorage(
    key, 
    defaultPreferences,
    { validateValue: validatePreferences }
  );

  const updatePreference = useCallback((key, value) => {
    setPreferences(prev => ({
      ...prev,
      [key]: value
    }));
  }, [setPreferences]);

  const resetPreferences = useCallback(() => {
    setPreferences(defaultPreferences);
  }, [setPreferences, defaultPreferences]);

  return {
    preferences,
    updatePreference,
    resetPreferences,
    removePreferences
  };
};

/**
 * Hook para cache temporário com expiração
 */
export const useTemporaryCache = (key, ttl = 5 * 60 * 1000) => { // 5 minutos padrão
  const cacheKey = `cache_${key}`;
  
  const validateCacheEntry = useCallback((entry) => {
    if (typeof entry !== 'object' || !entry.data || !entry.timestamp) {
      return false;
    }
    
    // Verifica se não expirou
    return Date.now() - entry.timestamp < ttl;
  }, [ttl]);

  const [cacheEntry, setCacheEntry, removeCacheEntry] = useLocalStorage(
    cacheKey,
    null,
    { validateValue: validateCacheEntry }
  );

  const setValue = useCallback((value) => {
    setCacheEntry({
      data: value,
      timestamp: Date.now()
    });
  }, [setCacheEntry]);

  const getValue = useCallback(() => {
    return cacheEntry?.data || null;
  }, [cacheEntry]);

  const isValid = useCallback(() => {
    return cacheEntry !== null && validateCacheEntry(cacheEntry);
  }, [cacheEntry, validateCacheEntry]);

  return {
    value: getValue(),
    setValue,
    removeValue: removeCacheEntry,
    isValid: isValid()
  };
};