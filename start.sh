#!/bin/bash
# Script de inicialização para Render (com Chrome para wwebjs)

# Definir diretório de cache do Puppeteer
export PUPPETEER_CACHE_DIR="$(pwd)/.cache/puppeteer"
echo "Cache dir: $PUPPETEER_CACHE_DIR"

# Instalar Chrome via Puppeteer (baixa a versão exata que o Puppeteer espera)
echo "Instalando Chrome para Puppeteer..."
npx puppeteer browsers install chrome 2>&1
INSTALL_EXIT=$?
if [ $INSTALL_EXIT -ne 0 ]; then
  echo "AVISO: puppeteer browsers install falhou (exit $INSTALL_EXIT), tentando via npx @puppeteer/browsers..."
  npx @puppeteer/browsers install chrome@stable --path "$PUPPETEER_CACHE_DIR" 2>&1 || true
fi

# Localizar o executável do Chrome instalado
CHROME_PATH=$(find "$PUPPETEER_CACHE_DIR" -name "chrome" -type f -executable 2>/dev/null | head -1)
if [ -z "$CHROME_PATH" ]; then
  CHROME_PATH=$(find "$PUPPETEER_CACHE_DIR" -name "google-chrome" -type f -executable 2>/dev/null | head -1)
fi
if [ -z "$CHROME_PATH" ]; then
  # Fallback: procurar em caminhos do sistema
  for p in /usr/bin/google-chrome-stable /usr/bin/google-chrome /usr/bin/chromium-browser /usr/bin/chromium; do
    if [ -x "$p" ]; then
      CHROME_PATH="$p"
      break
    fi
  done
fi

if [ -n "$CHROME_PATH" ]; then
  export PUPPETEER_EXECUTABLE_PATH="$CHROME_PATH"
  echo "Chrome encontrado: $CHROME_PATH"
else
  echo "AVISO: Chrome não encontrado! WhatsApp pode não inicializar."
fi

# Configurar memória do Node.js para 4GB
export NODE_OPTIONS="--max-old-space-size=4096 --optimize-for-size --gc-interval=100"

# Iniciar aplicação
node index.js