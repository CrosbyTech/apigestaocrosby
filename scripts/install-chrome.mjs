import { rmSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const cacheDir = '.cache/puppeteer';

if (existsSync(cacheDir)) {
  console.log('🧹 Removendo cache incompleto do Puppeteer...');
  rmSync(cacheDir, { recursive: true, force: true });
}

console.log('📦 Instalando Chrome para o Puppeteer...');
execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
