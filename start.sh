#!/bin/bash
# Script de inicialização para Render (com Chrome para wwebjs)

# Instalar Chrome via Puppeteer (baixa a versão exata que o Puppeteer espera)
echo "Verificando Chrome para Puppeteer..."
npx puppeteer browsers install chrome 2>&1 || true
echo "Chrome instalado."

# Configurar memória do Node.js para 4GB
export NODE_OPTIONS="--max-old-space-size=4096 --optimize-for-size --gc-interval=100"

# Iniciar aplicação
node index.js