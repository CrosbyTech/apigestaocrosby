#!/bin/bash
# Script de inicialização para Render (com Chromium para wwebjs)

# Instalar Chromium se não presente
if ! command -v chromium-browser &> /dev/null && ! command -v google-chrome &> /dev/null && ! command -v chromium &> /dev/null; then
  echo "Instalando dependências do Chromium..."
  apt-get update -qq 2>/dev/null
  apt-get install -y -qq chromium gconf-service libgbm-dev libasound2 libatk1.0-0 \
    libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgconf-2-4 \
    libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 \
    libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 \
    libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation \
    libnss3 lsb-release xdg-utils wget 2>/dev/null || true
  echo "Dependências instaladas."
fi

# Exportar path do Chromium para o Puppeteer
if command -v chromium-browser &> /dev/null; then
  export PUPPETEER_EXECUTABLE_PATH=$(which chromium-browser)
elif command -v chromium &> /dev/null; then
  export PUPPETEER_EXECUTABLE_PATH=$(which chromium)
elif command -v google-chrome &> /dev/null; then
  export PUPPETEER_EXECUTABLE_PATH=$(which google-chrome)
fi

echo "Chromium path: $PUPPETEER_EXECUTABLE_PATH"

# Configurar memória do Node.js para 4GB
export NODE_OPTIONS="--max-old-space-size=4096 --optimize-for-size --gc-interval=100"

# Iniciar aplicação
node index.js