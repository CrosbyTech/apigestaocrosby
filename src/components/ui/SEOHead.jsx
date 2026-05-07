import React, { memo, useEffect } from 'react';

/**
 * Componente para gerenciar meta tags e SEO
 * Implementa melhores práticas de SEO e acessibilidade
 */
const SEOHead = memo(({
  title = 'Gestão Crosby',
  description = 'Sistema de gestão empresarial Crosby',
  keywords = 'gestão, ERP, Crosby, franquias, compras, vendas',
  author = 'Crosby',
  robots = 'noindex, nofollow', // Para sistemas internos
  canonical,
  ogImage,
  structuredData
}) => {
  const fullTitle = title.includes('Gestão Crosby') ? title : `${title} | Gestão Crosby`;

  // Effect para atualizar meta tags usando vanilla JavaScript
  useEffect(() => {
    // Atualiza o título da página
    document.title = fullTitle;

    // Função helper para criar ou atualizar meta tag
    const setMetaTag = (name, content, property = false) => {
      if (!content) return;
      
      const attribute = property ? 'property' : 'name';
      let meta = document.querySelector(`meta[${attribute}="${name}"]`);
      
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attribute, name);
        document.head.appendChild(meta);
      }
      
      meta.setAttribute('content', content);
    };

    // Atualiza meta tags básicas
    setMetaTag('description', description);
    setMetaTag('keywords', keywords);
    setMetaTag('author', author);
    setMetaTag('robots', robots);
    setMetaTag('theme-color', '#000638');

    // Open Graph tags
    setMetaTag('og:type', 'website', true);
    setMetaTag('og:title', fullTitle, true);
    setMetaTag('og:description', description, true);
    setMetaTag('og:site_name', 'Gestão Crosby', true);
    
    if (ogImage) {
      setMetaTag('og:image', ogImage, true);
    }

    // Twitter Card tags
    setMetaTag('twitter:card', 'summary_large_image');
    setMetaTag('twitter:title', fullTitle);
    setMetaTag('twitter:description', description);
    
    if (ogImage) {
      setMetaTag('twitter:image', ogImage);
    }

    // Canonical link
    if (canonical) {
      let canonicalLink = document.querySelector('link[rel="canonical"]');
      if (!canonicalLink) {
        canonicalLink = document.createElement('link');
        canonicalLink.setAttribute('rel', 'canonical');
        document.head.appendChild(canonicalLink);
      }
      canonicalLink.setAttribute('href', canonical);
    }

    // Structured Data
    if (structuredData) {
      let scriptTag = document.querySelector('script[type="application/ld+json"]');
      if (!scriptTag) {
        scriptTag = document.createElement('script');
        scriptTag.setAttribute('type', 'application/ld+json');
        document.head.appendChild(scriptTag);
      }
      scriptTag.textContent = JSON.stringify(structuredData);
    }

    // Preconnect links para performance
    const addPreconnect = (href) => {
      if (!document.querySelector(`link[href="${href}"]`)) {
        const link = document.createElement('link');
        link.setAttribute('rel', 'preconnect');
        link.setAttribute('href', href);
        document.head.appendChild(link);
      }
    };

    addPreconnect('https://apigestaocrosby-bw2v.onrender.com');

  }, [fullTitle, description, keywords, author, robots, canonical, ogImage, structuredData]);

  // Este componente não renderiza nada no DOM
  return null;
});

SEOHead.displayName = 'SEOHead';

export default SEOHead;