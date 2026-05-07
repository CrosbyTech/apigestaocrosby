import { useState, useEffect, useCallback } from 'react';
import { BREAKPOINTS } from '../config/constants';

/**
 * Custom Hook para gerenciar responsividade
 * Fornece informações sobre breakpoints e dimensões da tela
 */
export const useResponsive = () => {
  // Estado para dimensões da tela
  const [screenSize, setScreenSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768
  });

  // Estado para breakpoint atual
  const [currentBreakpoint, setCurrentBreakpoint] = useState('lg');

  // Função para determinar o breakpoint baseado na largura
  const getBreakpoint = useCallback((width) => {
    if (width < 640) return 'xs';
    if (width < 768) return 'sm';
    if (width < 1024) return 'md';
    if (width < 1280) return 'lg';
    if (width < 1536) return 'xl';
    return '2xl';
  }, []);

  // Handlers para mudança de tamanho da tela
  const handleResize = useCallback(() => {
    const newWidth = window.innerWidth;
    const newHeight = window.innerHeight;
    
    setScreenSize({
      width: newWidth,
      height: newHeight
    });
    
    setCurrentBreakpoint(getBreakpoint(newWidth));
  }, [getBreakpoint]);

  // Effect para configurar listener de resize
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Configuração inicial
    handleResize();

    // Adiciona listener com debounce
    let timeoutId;
    const debouncedHandleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleResize, 100);
    };

    window.addEventListener('resize', debouncedHandleResize);
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', debouncedHandleResize);
      clearTimeout(timeoutId);
    };
  }, [handleResize]);

  // Funções helper para verificar breakpoints
  const isXs = currentBreakpoint === 'xs';
  const isSm = currentBreakpoint === 'sm';
  const isMd = currentBreakpoint === 'md';
  const isLg = currentBreakpoint === 'lg';
  const isXl = currentBreakpoint === 'xl';
  const is2Xl = currentBreakpoint === '2xl';

  // Funções helper para ranges
  const isMobile = isXs || isSm;
  const isTablet = isMd;
  const isDesktop = isLg || isXl || is2Xl;
  const isSmallScreen = isXs || isSm || isMd;
  const isLargeScreen = isXl || is2Xl;

  // Função para verificar se está acima de um breakpoint
  const isAbove = useCallback((breakpoint) => {
    const breakpointOrder = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
    const currentIndex = breakpointOrder.indexOf(currentBreakpoint);
    const targetIndex = breakpointOrder.indexOf(breakpoint);
    return currentIndex > targetIndex;
  }, [currentBreakpoint]);

  // Função para verificar se está abaixo de um breakpoint
  const isBelow = useCallback((breakpoint) => {
    const breakpointOrder = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
    const currentIndex = breakpointOrder.indexOf(currentBreakpoint);
    const targetIndex = breakpointOrder.indexOf(breakpoint);
    return currentIndex < targetIndex;
  }, [currentBreakpoint]);

  // Configurações responsivas para componentes
  const getResponsiveConfig = useCallback((config) => {
    if (typeof config === 'object' && config !== null) {
      // Retorna configuração baseada no breakpoint atual
      return config[currentBreakpoint] || config.default || config;
    }
    return config;
  }, [currentBreakpoint]);

  // Configurações de grid responsivo
  const getGridCols = useCallback((colsConfig = { xs: 1, sm: 2, md: 3, lg: 4, xl: 5, '2xl': 6 }) => {
    return getResponsiveConfig(colsConfig);
  }, [getResponsiveConfig]);

  // Configurações de padding/margin responsivo
  const getSpacing = useCallback((spacingConfig = { xs: 2, sm: 4, md: 6, lg: 8 }) => {
    return getResponsiveConfig(spacingConfig);
  }, [getResponsiveConfig]);

  // Orientação da tela
  const isLandscape = screenSize.width > screenSize.height;
  const isPortrait = screenSize.height > screenSize.width;

  return {
    // Dimensões
    screenSize,
    
    // Breakpoint atual
    currentBreakpoint,
    
    // Verificações de breakpoint
    isXs,
    isSm,
    isMd,
    isLg,
    isXl,
    is2Xl,
    
    // Categorias de dispositivo
    isMobile,
    isTablet,
    isDesktop,
    isSmallScreen,
    isLargeScreen,
    
    // Orientação
    isLandscape,
    isPortrait,
    
    // Funções utilitárias
    isAbove,
    isBelow,
    getResponsiveConfig,
    getGridCols,
    getSpacing,
    
    // Configurações pré-definidas
    containerClass: isSmallScreen ? 'px-4' : isTablet ? 'px-6' : 'px-8',
    maxWidthClass: isSmallScreen ? 'max-w-full' : isTablet ? 'max-w-4xl' : 'max-w-7xl',
    textSizeClass: isSmallScreen ? 'text-sm' : isTablet ? 'text-base' : 'text-lg'
  };
};