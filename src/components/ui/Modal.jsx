import React, { memo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import Button from './Button';

/**
 * Componente Modal reutilizável com acessibilidade completa
 * Implementa focus trap, escape key, backdrop click
 */
const Modal = memo(
  ({
    isOpen = false,
    onClose,
    title,
    children,
    size = 'md',
    closeOnBackdrop = true,
    closeOnEscape = true,
    showCloseButton = true,
    footer,
    className = '',
    overlayClassName = '',
    preventBodyScroll = true,
    ...props
  }) => {
    const modalRef = useRef(null);
    const previousFocusRef = useRef(null);
    const firstFocusableRef = useRef(null);
    const lastFocusableRef = useRef(null);

    // Tamanhos do modal
    const sizes = {
      xs: 'max-w-xs',
      sm: 'max-w-sm',
      md: 'max-w-md',
      lg: 'max-w-lg',
      xl: 'max-w-xl',
      '2xl': 'max-w-2xl',
      '3xl': 'max-w-3xl',
      '4xl': 'max-w-4xl',
      '5xl': 'max-w-5xl',
      '6xl': 'max-w-6xl',
      full: 'max-w-full mx-4',
    };

    // Elementos focáveis
    const getFocusableElements = useCallback(() => {
      if (!modalRef.current) return [];

      const focusableSelectors = [
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'a[href]',
        '[tabindex]:not([tabindex="-1"])',
      ];

      return modalRef.current.querySelectorAll(focusableSelectors.join(', '));
    }, []);

    // Focus trap
    const handleTabKey = useCallback(
      (e) => {
        const focusableElements = getFocusableElements();
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement?.focus();
          }
        }
      },
      [getFocusableElements],
    );

    // Handler para teclas
    const handleKeyDown = useCallback(
      (e) => {
        if (e.key === 'Escape' && closeOnEscape) {
          onClose?.();
        } else if (e.key === 'Tab') {
          handleTabKey(e);
        }
      },
      [closeOnEscape, onClose, handleTabKey],
    );

    // Handler para clique no backdrop
    const handleBackdropClick = useCallback(
      (e) => {
        if (e.target === e.currentTarget && closeOnBackdrop) {
          onClose?.();
        }
      },
      [closeOnBackdrop, onClose],
    );

    // Efeitos para acessibilidade
    useEffect(() => {
      if (isOpen) {
        // Salva o elemento com foco atual
        previousFocusRef.current = document.activeElement;

        // Previne scroll do body
        if (preventBodyScroll) {
          document.body.style.overflow = 'hidden';
        }

        // Adiciona listeners
        document.addEventListener('keydown', handleKeyDown);

        // Foca no modal
        setTimeout(() => {
          const focusableElements = getFocusableElements();
          if (focusableElements.length > 0) {
            focusableElements[0].focus();
          } else {
            modalRef.current?.focus();
          }
        }, 100);
      } else {
        // Restaura scroll do body
        if (preventBodyScroll) {
          document.body.style.overflow = '';
        }

        // Remove listeners
        document.removeEventListener('keydown', handleKeyDown);

        // Restaura foco anterior
        if (previousFocusRef.current) {
          previousFocusRef.current.focus();
        }
      }

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        if (preventBodyScroll) {
          document.body.style.overflow = '';
        }
      };
    }, [isOpen, handleKeyDown, getFocusableElements, preventBodyScroll]);

    // Não renderiza se não estiver aberto
    if (!isOpen) return null;

    // Classes do overlay
    const overlayClasses = `
    fixed inset-0 z-50 overflow-y-auto
    bg-black bg-opacity-50 backdrop-blur-sm
    flex items-center justify-center p-4
    transition-opacity duration-300
    ${overlayClassName}
  `;

    // Classes do modal
    const modalClasses = `
    relative bg-white rounded-lg shadow-xl
    w-full ${sizes[size] || sizes.md}
    max-h-[90vh] overflow-hidden
    transform transition-all duration-300
    ${className}
  `;

    const modalContent = (
      <div
        className={overlayClasses}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        {...props}
      >
        <div className={modalClasses} tabIndex={-1}>
          {/* Header */}
          {(title || showCloseButton) && (
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              {title && (
                <h2
                  id="modal-title"
                  className="text-lg font-semibold text-gray-900"
                >
                  {title}
                </h2>
              )}

              {showCloseButton && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="ml-auto"
                  aria-label="Fechar modal"
                >
                  x
                </Button>
              )}
            </div>
          )}

          {/* Content */}
          <div className="p-4 overflow-y-auto max-h-[calc(90vh-8rem)]">
            {children}
          </div>

          {/* Footer */}
          {footer && (
            <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50">
              {footer}
            </div>
          )}
        </div>
      </div>
    );

    // Renderiza no portal
    return createPortal(modalContent, document.body);
  },
);

Modal.displayName = 'Modal';

export default Modal;
