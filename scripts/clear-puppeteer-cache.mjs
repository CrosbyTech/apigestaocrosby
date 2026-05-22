import { rmSync, existsSync } from 'fs';
import { join } from 'path';

const cacheDir = join(process.cwd(), '.cache', 'puppeteer', 'chrome');

if (existsSync(cacheDir)) {
  console.log(`Removendo cache corrompido do puppeteer: ${cacheDir}`);
  rmSync(cacheDir, { recursive: true, force: true });
  console.log('Cache removido. Reinstalando o Chrome...');
}
