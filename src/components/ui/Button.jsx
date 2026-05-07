import React, { memo, forwardRef } from 'react';
import { THEME_COLORS } from '../../config/constants';

/**
 * Componente Button reutilizável com variantes e estados
 * Implementa design system consistente e acessibilidade
 */
const Button = memo(forwardRef(({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  onClick,
  type = 'button',
  className = '',
  loadingText = 'Carregando...',
  ...props
}, ref) => {
  
  // Variantes de estilo
  const variants = {
    primary: 'bg-[#000638] hover:bg-[#fe0000] text-white border-transparent focus:ring-[#000638]',
    secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-900 border-gray-300 focus:ring-gray-500',
    outline: 'bg-transparent hover:bg-[#000638] hover:text-white text-[#000638] border-[#000638] focus:ring-[#000638]',
    ghost: 'bg-transparent hover:bg-gray-100 text-gray-700 border-transparent focus:ring-gray-500',
    danger: 'bg-red-600 hover:bg-red-700 text-white border-transparent focus:ring-red-500',
    success: 'bg-green-600 hover:bg-green-700 text-white border-transparent focus:ring-green-500',
    warning: 'bg-yellow-500 hover:bg-yellow-600 text-white border-transparent focus:ring-yellow-500'
  };

  // Tamanhos
  const sizes = {
    xs: 'px-2 py-1 text-xs',
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
    xl: 'px-8 py-4 text-lg'
  };

  // Classes base
  const baseClasses = `
    inline-flex items-center justify-center
    font-medium rounded-lg border
    transition-all duration-200 ease-in-out
    focus:outline-none focus:ring-2 focus:ring-offset-2
    disabled:opacity-50 disabled:cursor-not-allowed
    disabled:pointer-events-none
    ${fullWidth ? 'w-full' : ''}
    ${variants[variant] || variants.primary}
    ${sizes[size] || sizes.md}
    ${className}
  `;

  // Handler para clique
  const handleClick = (event) => {
    if (disabled || loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  // Componente de loading
  const LoadingSpinner = () => (
    <svg 
      className="animate-spin -ml-1 mr-2 h-4 w-4" 
      xmlns="http://www.w3.org/2000/svg" 
      fill="none" 
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle 
        className="opacity-25" 
        cx="12" 
        cy="12" 
        r="10" 
        stroke="currentColor" 
        strokeWidth="4"
      />
      <path 
        className="opacity-75" 
        fill="currentColor" 
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );

  return (
    <button
      ref={ref}
      type={type}
      className={baseClasses}
      disabled={disabled || loading}
      onClick={handleClick}
      aria-disabled={disabled || loading}
      aria-describedby={loading ? 'loading-description' : undefined}
      {...props}
    >
      {/* Loading spinner */}
      {loading && <LoadingSpinner />}
      
      {/* Left icon */}
      {leftIcon && !loading && (
        <span className="mr-2 flex-shrink-0" aria-hidden="true">
          {leftIcon}
        </span>
      )}
      
      {/* Content */}
      <span className={loading ? 'opacity-70' : ''}>
        {loading ? loadingText : children}
      </span>
      
      {/* Right icon */}
      {rightIcon && !loading && (
        <span className="ml-2 flex-shrink-0" aria-hidden="true">
          {rightIcon}
        </span>
      )}
      
      {/* Screen reader only loading description */}
      {loading && (
        <span id="loading-description" className="sr-only">
          Operação em andamento
        </span>
      )}
    </button>
  );
}));

Button.displayName = 'Button';

export default Button;