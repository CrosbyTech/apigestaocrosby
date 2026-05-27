import { rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const baseDir = process.env.PUPPETEER_CACHE_DIR || join(process.cwd(), '.cache', 'puppeteer');
const chromeDir = join(baseDir, 'chrome');

if (existsSync(chromeDir)) {
  // Verifica se alguma versão tem o executável. Se não, a cache está corrompida.
  let hasExecutable = false;
  try {
    for (const version of readdirSync(chromeDir)) {
      const exec = join(chromeDir, version, 'chrome-linux64', 'chrome');
      if (existsSync(exec)) {
        hasExecutable = true;
        break;
      }
    }
  } catch (_) {}

  if (!hasExecutable) {
    console.log(`Cache corrompida detectada (pasta existe mas sem executável): ${chromeDir}`);
    rmSync(chromeDir, { recursive: true, force: true });
    console.log('Cache removida. O puppeteer irá baixar o Chrome novamente.');
  } else {
    console.log('Cache do Chrome OK, pulando limpeza.');
  }
}
