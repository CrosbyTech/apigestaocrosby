const { join } = require('path');

/**
 * Configuração do Puppeteer — garante que o cache do Chrome
 * seja consistente entre `npm install` (postinstall) e runtime.
 *
 * No Render, o diretório padrão é /opt/render/.cache/puppeteer.
 */
module.exports = {
  cacheDirectory: process.env.PUPPETEER_CACHE_DIR || join(__dirname, '.cache', 'puppeteer'),
};
