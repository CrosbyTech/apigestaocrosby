#!/bin/bash
# Script de inicialização para Render (com Chrome para wwebjs)
set -e

# Garantir que PUPPETEER_CACHE_DIR esteja definido (consistente com .puppeteerrc.cjs)
export PUPPETEER_CACHE_DIR="${PUPPETEER_CACHE_DIR:-$(pwd)/.cache/puppeteer}"

echo "=== Puppeteer Setup ==="
echo "Cache dir: $PUPPETEER_CACHE_DIR"
echo "Node: $(node -v)"
echo "NPM: $(npm -v)"

# Instalar Chrome via Puppeteer (baixa a versão exata que o Puppeteer espera)
echo "Instalando Chrome para Puppeteer..."
npx puppeteer browsers install chrome 2>&1 || {
  echo "AVISO: puppeteer browsers install falhou, tentando via @puppeteer/browsers..."
  npx @puppeteer/browsers install chrome@stable --path "$PUPPETEER_CACHE_DIR" 2>&1 || true
}

# Listar conteúdo do cache para debug
echo "=== Conteúdo do cache ==="
find "$PUPPETEER_CACHE_DIR" -maxdepth 4 -type f -name "chrome" -o -name "google-chrome" 2>/dev/null || echo "(nenhum binário encontrado via find)"
ls -la "$PUPPETEER_CACHE_DIR" 2>/dev/null || echo "(diretório vazio)"

# Usar o próprio puppeteer para resolver o caminho do Chrome (mais confiável)
CHROME_PATH=$(node -e "import('puppeteer').then(p => { try { console.log(p.default.executablePath()); } catch(e) { console.error(e.message); process.exit(1); } })" 2>/dev/null) || true

if [ -z "$CHROME_PATH" ] || [ ! -f "$CHROME_PATH" ]; then
  echo "puppeteer.executablePath() não retornou caminho válido, buscando manualmente..."
  # Buscar em qualquer subdiretório do cache
  CHROME_PATH=$(find "$PUPPETEER_CACHE_DIR" -type f -name "chrome" 2>/dev/null | head -1)
fi

if [ -z "$CHROME_PATH" ] || [ ! -f "$CHROME_PATH" ]; then
  # Fallback: caminhos do sistema
  for p in /usr/bin/google-chrome-stable /usr/bin/google-chrome /usr/bin/chromium-browser /usr/bin/chromium; do
    if [ -x "$p" ]; then
      CHROME_PATH="$p"
      break
    fi
  done
fi

if [ -n "$CHROME_PATH" ] && [ -f "$CHROME_PATH" ]; then
  export PUPPETEER_EXECUTABLE_PATH="$CHROME_PATH"
  echo "Chrome encontrado: $CHROME_PATH"
else
  echo "AVISO: Chrome não encontrado! WhatsApp pode não inicializar."
  echo "Conteúdo completo do cache:"
  find "$PUPPETEER_CACHE_DIR" -type f 2>/dev/null | head -20
fi

echo "=== Iniciando aplicação ==="

# Configurar memória do Node.js para 4GB
export NODE_OPTIONS="--max-old-space-size=4096 --optimize-for-size --gc-interval=100"

# Iniciar aplicação
node index.js