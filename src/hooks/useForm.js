import { useState, useCallback, useRef, useMemo } from 'react';
import { SANITIZATION_PATTERNS } from '../config/constants';

/**
 * Hook customizado para gerenciar formulários
 * Implementa validação, sanitização, estados e otimizações
 */
export const useForm = (initialValues = {}, validationRules = {}, options = {}) => {
  const {
    validateOnChange = false,
    validateOnBlur = true,
    sanitizeOnChange = true,
    debounceValidation = 300,
    resetOnSubmit = false
  } = options;

  // Estados do formulário
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  // Refs para controle
  const debounceTimersRef = useRef({});
  const initialValuesRef = useRef(initialValues);

  /**
   * Sanitiza valor de input para prevenir XSS
   */
  const sanitizeValue = useCallback((value, fieldName = '') => {
    if (typeof value !== 'string') return value;
    
    let sanitized = value;
    
    // Remove caracteres perigosos
    sanitized = sanitized.replace(SANITIZATION_PATTERNS.XSS_CHARS, '');
    
    // Sanitização específica por tipo de campo
    if (fieldName.toLowerCase().includes('email')) {
      sanitized = sanitized.toLowerCase().trim();
    } else if (fieldName.toLowerCase().includes('phone')) {
      sanitized = sanitized.replace(/[^\d\s\-\+\(\)]/g, '');
    } else if (fieldName.toLowerCase().includes('cpf') || fieldName.toLowerCase().includes('cnpj')) {
      sanitized = sanitized.replace(/[^\d]/g, '');
    }
    
    return sanitized;
  }, []);

  /**
   * Valida um campo específico
   */
  const validateField = useCallback((fieldName, value) => {
    const rules = validationRules[fieldName];
    if (!rules) return null;

    // Required validation
    if (rules.required && (!value || value.toString().trim() === '')) {
      return rules.requiredMessage || `${fieldName} é obrigatório`;
    }

    // Skip other validations if empty and not required
    if (!value || value.toString().trim() === '') {
      return null;
    }

    // Min length validation
    if (rules.minLength && value.toString().length < rules.minLength) {
      return rules.minLengthMessage || `${fieldName} deve ter pelo menos ${rules.minLength} caracteres`;
    }

    // Max length validation
    if (rules.maxLength && value.toString().length > rules.maxLength) {
      return rules.maxLengthMessage || `${fieldName} deve ter no máximo ${rules.maxLength} caracteres`;
    }

    // Pattern validation
    if (rules.pattern && !rules.pattern.test(value.toString())) {
      return rules.patternMessage || `${fieldName} tem formato inválido`;
    }

    // Email validation
    if (rules.email) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(value.toString())) {
        return rules.emailMessage || 'Email inválido';
      }
    }

    // Custom validation
    if (rules.custom && typeof rules.custom === 'function') {
      const customError = rules.custom(value, values);
      if (customError) return customError;
    }

    return null;
  }, [validationRules, values]);

  /**
   * Valida todos os campos
   */
  const validateForm = useCallback(() => {
    const newErrors = {};
    let isValid = true;

    Object.keys(validationRules).forEach(fieldName => {
      const error = validateField(fieldName, values[fieldName]);
      if (error) {
        newErrors[fieldName] = error;
        isValid = false;
      }
    });

    setErrors(newErrors);
    return isValid;
  }, [validateField, values, validationRules]);

  /**
   * Valida campo com debounce
   */
  const debouncedValidateField = useCallback((fieldName, value) => {
    if (debounceTimersRef.current[fieldName]) {
      clearTimeout(debounceTimersRef.current[fieldName]);
    }

    debounceTimersRef.current[fieldName] = setTimeout(() => {
      const error = validateField(fieldName, value);
      setErrors(prev => ({
        ...prev,
        [fieldName]: error
      }));
    }, debounceValidation);
  }, [validateField, debounceValidation]);

  /**
   * Atualiza valor de um campo
   */
  const setValue = useCallback((fieldName, value) => {
    const sanitizedValue = sanitizeOnChange ? sanitizeValue(value, fieldName) : value;
    
    setValues(prev => ({
      ...prev,
      [fieldName]: sanitizedValue
    }));

    // Validação em tempo real se habilitada
    if (validateOnChange) {
      debouncedValidateField(fieldName, sanitizedValue);
    }
  }, [sanitizeOnChange, sanitizeValue, validateOnChange, debouncedValidateField]);

  /**
   * Atualiza múltiplos valores
   */
  const setValues = useCallback((newValues) => {
    setValues(prev => {
      const updated = { ...prev };
      Object.entries(newValues).forEach(([key, value]) => {
        updated[key] = sanitizeOnChange ? sanitizeValue(value, key) : value;
      });
      return updated;
    });
  }, [sanitizeOnChange, sanitizeValue]);

  /**
   * Handler para mudança de input
   */
  const handleChange = useCallback((event) => {
    const { name, value, type, checked } = event.target;
    const finalValue = type === 'checkbox' ? checked : value;
    setValue(name, finalValue);
  }, [setValue]);

  /**
   * Handler para blur
   */
  const handleBlur = useCallback((event) => {
    const { name, value } = event.target;
    
    setTouched(prev => ({
      ...prev,
      [name]: true
    }));

    if (validateOnBlur) {
      const error = validateField(name, value);
      setErrors(prev => ({
        ...prev,
        [name]: error
      }));
    }
  }, [validateField, validateOnBlur]);

  /**
   * Reset do formulário
   */
  const reset = useCallback((newInitialValues) => {
    const resetValues = newInitialValues || initialValuesRef.current;
    setValues(resetValues);
    setErrors({});
    setTouched({});
    setIsSubmitting(false);
    
    // Limpa timers de debounce
    Object.values(debounceTimersRef.current).forEach(timer => {
      clearTimeout(timer);
    });
    debounceTimersRef.current = {};
  }, []);

  /**
   * Handler para submit
   */
  const handleSubmit = useCallback((onSubmit) => {
    return async (event) => {
      if (event) {
        event.preventDefault();
      }

      setIsSubmitting(true);
      setSubmitCount(prev => prev + 1);

      // Marca todos os campos como touched
      const allTouched = {};
      Object.keys(validationRules).forEach(key => {
        allTouched[key] = true;
      });
      setTouched(allTouched);

      // Valida formulário
      const isValid = validateForm();

      if (isValid && onSubmit) {
        try {
          await onSubmit(values);
          
          if (resetOnSubmit) {
            reset();
          }
        } catch (error) {
          console.error('Erro no submit:', error);
        }
      }

      setIsSubmitting(false);
    };
  }, [values, validateForm, resetOnSubmit, reset, validationRules]);

  /**
   * Remove erro de um campo específico
   */
  const clearError = useCallback((fieldName) => {
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      return newErrors;
    });
  }, []);

  /**
   * Remove todos os erros
   */
  const clearErrors = useCallback(() => {
    setErrors({});
  }, []);

  /**
   * Verifica se formulário foi alterado
   */
  const isDirty = useMemo(() => {
    return JSON.stringify(values) !== JSON.stringify(initialValuesRef.current);
  }, [values]);

  /**
   * Verifica se formulário é válido
   */
  const isValid = useMemo(() => {
    return Object.keys(errors).length === 0;
  }, [errors]);

  /**
   * Verifica se campo tem erro e foi touched
   */
  const getFieldError = useCallback((fieldName) => {
    return touched[fieldName] ? errors[fieldName] : null;
  }, [touched, errors]);

  /**
   * Verifica se campo é válido
   */
  const isFieldValid = useCallback((fieldName) => {
    return !getFieldError(fieldName);
  }, [getFieldError]);

  /**
   * Props para input
   */
  const getFieldProps = useCallback((fieldName) => ({
    name: fieldName,
    value: values[fieldName] || '',
    onChange: handleChange,
    onBlur: handleBlur,
    'aria-invalid': !isFieldValid(fieldName),
    'aria-describedby': getFieldError(fieldName) ? `${fieldName}-error` : undefined
  }), [values, handleChange, handleBlur, isFieldValid, getFieldError]);

  return {
    // Estados
    values,
    errors,
    touched,
    isSubmitting,
    submitCount,
    
    // Computed
    isDirty,
    isValid,
    
    // Handlers
    setValue,
    setValues,
    handleChange,
    handleBlur,
    handleSubmit,
    
    // Validação
    validateField,
    validateForm,
    clearError,
    clearErrors,
    
    // Utilitários
    reset,
    getFieldError,
    isFieldValid,
    getFieldProps,
    
    // Helpers para campos específicos
    getInputProps: getFieldProps,
    getSelectProps: getFieldProps,
    getTextareaProps: getFieldProps
  };
};