import React, { memo, forwardRef, useState } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';

/**
 * Componente Input reutilizável com validação e estados
 * Implementa design system consistente e acessibilidade
 */
const Input = memo(forwardRef(({
  type = 'text',
  label,
  placeholder,
  value,
  onChange,
  onBlur,
  onFocus,
  disabled = false,
  required = false,
  error,
  helperText,
  leftIcon,
  rightIcon,
  size = 'md',
  fullWidth = false,
  className = '',
  containerClassName = '',
  id,
  name,
  autoComplete,
  maxLength,
  minLength,
  pattern,
  ...props
}, ref) => {
  const [showPassword, setShowPassword] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Gera ID único se não fornecido
  const inputId = id || `input-${name || Math.random().toString(36).substr(2, 9)}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const helperId = helperText ? `${inputId}-helper` : undefined;

  // Tamanhos
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-3 py-2 text-sm',
    lg: 'px-4 py-3 text-base'
  };

  // Classes base do input
  const baseInputClasses = `
    block w-full rounded-lg border transition-all duration-200
    focus:outline-none focus:ring-2 focus:ring-offset-0
    disabled:opacity-50 disabled:cursor-not-allowed
    ${sizes[size] || sizes.md}
    ${error 
      ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
      : isFocused
      ? 'border-[#000638] focus:border-[#000638] focus:ring-[#000638]'
      : 'border-gray-300 focus:border-[#000638] focus:ring-[#000638]'
    }
    ${disabled ? 'bg-gray-50' : 'bg-white'}
    ${leftIcon ? 'pl-10' : ''}
    ${rightIcon || type === 'password' ? 'pr-10' : ''}
    ${className}
  `;

  // Classes do container
  const containerClasses = `
    ${fullWidth ? 'w-full' : ''}
    ${containerClassName}
  `;

  // Classes do label
  const labelClasses = `
    block text-sm font-medium mb-1
    ${error ? 'text-red-700' : 'text-gray-700'}
    ${required ? "after:content-['*'] after:ml-0.5 after:text-red-500" : ''}
  `;

  // Handler para mudança de foco
  const handleFocus = (e) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  // Toggle para senha
  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  // Tipo atual do input (considerando toggle de senha)
  const currentType = type === 'password' && showPassword ? 'text' : type;

  return (
    <div className={containerClasses}>
      {/* Label */}
      {label && (
        <label 
          htmlFor={inputId} 
          className={labelClasses}
        >
          {label}
        </label>
      )}

      {/* Container do input */}
      <div className="relative">
        {/* Ícone esquerdo */}
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <span className="text-gray-400" aria-hidden="true">
              {leftIcon}
            </span>
          </div>
        )}

        {/* Input */}
        <input
          ref={ref}
          id={inputId}
          name={name}
          type={currentType}
          value={value}
          onChange={onChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          className={baseInputClasses}
          autoComplete={autoComplete}
          maxLength={maxLength}
          minLength={minLength}
          pattern={pattern}
          aria-invalid={!!error}
          aria-describedby={[errorId, helperId].filter(Boolean).join(' ') || undefined}
          {...props}
        />

        {/* Ícone direito ou toggle de senha */}
        {(rightIcon || type === 'password') && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
            {type === 'password' ? (
              <button
                type="button"
                onClick={togglePasswordVisibility}
                className="text-gray-400 hover:text-gray-600 focus:outline-none focus:text-gray-600 transition-colors"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                tabIndex={disabled ? -1 : 0}
              >
                {showPassword ? (
                  <EyeSlash size={20} />
                ) : (
                  <Eye size={20} />
                )}
              </button>
            ) : (
              <span className="text-gray-400" aria-hidden="true">
                {rightIcon}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Texto de ajuda */}
      {helperText && !error && (
        <p id={helperId} className="mt-1 text-sm text-gray-500">
          {helperText}
        </p>
      )}

      {/* Mensagem de erro */}
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {/* Contador de caracteres */}
      {maxLength && value && (
        <div className="mt-1 text-right">
          <span className={`text-xs ${
            value.length > maxLength * 0.9 
              ? 'text-yellow-600' 
              : value.length === maxLength 
              ? 'text-red-600' 
              : 'text-gray-500'
          }`}>
            {value.length}/{maxLength}
          </span>
        </div>
      )}
    </div>
  );
}));

Input.displayName = 'Input';

export default Input;