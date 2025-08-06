#!/bin/bash
# Script de inicialização otimizado para grandes volumes de dados

# Configurar memória do Node.js para 4GB
export NODE_OPTIONS="--max-old-space-size=4096 --optimize-for-size --gc-interval=100"

# Configurar otimizações do V8
export NODE_OPTIONS="$NODE_OPTIONS --experimental-vm-modules --experimental-json-modules"

# Iniciar aplicação
node index.js