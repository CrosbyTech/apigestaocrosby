// Garante instalação completa do Chrome do Puppeteer.
// Resolve o bug do Render onde o cache restaurado contém a PASTA do chrome
// mas SEM o executável dentro (build falha com:
// "The browser folder exists but the executable is missing").
//
// Estratégia:
//   1. Se a pasta existe mas o binário NÃO → apaga a pasta inteira
//   2. Roda `npx puppeteer browsers install chrome` (vai baixar ou pular se ok)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const CACHE_DIR =
  process.env.PUPPETEER_CACHE_DIR ||
  path.resolve(process.cwd(), '.cache', 'puppeteer');
const CHROME_DIR = path.join(CACHE_DIR, 'chrome');

console.log(`🔍 [install-chrome] Verificando cache em ${CHROME_DIR}`);

function isChromeExecutable(file) {
  // chrome.exe (Windows) ou chrome (Linux/Mac)
  return /chrome(\.exe)?$/i.test(file);
}

function findChromeBinary(dir) {
  if (!fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (isChromeExecutable(e.name)) {
        return full;
      }
    }
  }
  return null;
}

// Se a pasta chrome existe mas binário não, apaga pra forçar reinstall
if (fs.existsSync(CHROME_DIR)) {
  const bin = findChromeBinary(CHROME_DIR);
  if (!bin) {
    console.warn(
      `⚠️  [install-chrome] Pasta ${CHROME_DIR} existe mas SEM executável — limpando para reinstalar`,
    );
    fs.rmSync(CHROME_DIR, { recursive: true, force: true });
  } else {
    console.log(`✅ [install-chrome] Binário encontrado em ${bin}`);
  }
} else {
  console.log(`📂 [install-chrome] Pasta não existe — vai instalar do zero`);
}

// Executa o install (skip se já estiver tudo ok)
try {
  console.log('📦 [install-chrome] Rodando puppeteer browsers install chrome...');
  execSync('npx puppeteer browsers install chrome', {
    stdio: 'inherit',
    env: process.env,
  });
  console.log('✅ [install-chrome] Concluído');
} catch (err) {
  console.error('❌ [install-chrome] Falha na instalação:', err.message);
  // Tenta limpar e instalar de novo
  console.warn('🔄 [install-chrome] Tentando limpar e instalar de novo...');
  try {
    if (fs.existsSync(CHROME_DIR)) {
      fs.rmSync(CHROME_DIR, { recursive: true, force: true });
    }
    execSync('npx puppeteer browsers install chrome', {
      stdio: 'inherit',
      env: process.env,
    });
    console.log('✅ [install-chrome] Concluído (retry)');
  } catch (err2) {
    console.error('❌ [install-chrome] Falha mesmo após retry:', err2.message);
    // Não derruba o build — Puppeteer só é usado pra gerar PDF de termo
    // de crédito. Sem ele, esse fluxo falha mas o resto da API funciona.
    console.warn(
      '⚠️  [install-chrome] Continuando build sem Chrome — fluxo Autentique PDF pode falhar em runtime',
    );
    process.exit(0);
  }
}
