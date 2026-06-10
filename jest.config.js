/**
 * Configuração mínima do Jest para o backend.
 *
 * O projeto usa ESM (`"type": "module"`) então precisamos rodar o Jest com
 * `NODE_OPTIONS=--experimental-vm-modules` (já configurado no script `test`
 * do package.json) e sem transform.
 */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/__tests__/**/*.test.js'],
  // Evita executar os scripts de jobs / instalação que ficam em pastas
  // como `scripts/`, `jobs/`, `auditor-vendas/`.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.cache/',
    '/.wwebjs_auth/',
    '/.wwebjs_cache/',
  ],
};
