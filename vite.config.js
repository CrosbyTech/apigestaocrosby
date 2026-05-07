import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4100',
        changeOrigin: true,
        timeout: 600000, // 10 min — rotas pesadas como top-customers
        proxyTimeout: 600000,
      },
    },
    watch: {
      // Ignora arquivos transitórios do backend (WhatsApp wwebjs gera lockfiles
      // que somem entre o lstat() e o open() — quebra o FSWatcher do Vite)
      ignored: [
        '**/backend/**',
        '**/.wwebjs_auth/**',
        '**/.wwebjs_cache/**',
        '**/.cache/**',
        '**/node_modules/**',
        '**/dist/**',
      ],
    },
  },
  build: {
    outDir: 'dist',
  },
});
