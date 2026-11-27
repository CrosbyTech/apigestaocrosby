// =============================================================================
// Minha Claro Empresas — abre o Chrome do robô.
//
// Abre o Chrome instalado, com um perfil só do robô (perfil-chrome/) e uma porta
// de depuração local, já na página da Claro. O LOGIN É FEITO À MÃO nessa janela:
// o robô nunca digita e-mail, senha, código nem captcha, e nada disso é gravado.
// Depois do login, os outros scripts desta pasta se ligam a esse mesmo Chrome
// (porta local) para listar os contratos e baixar as faturas.
// A sessão fica guardada no perfil: enquanto a Claro não derrubar, não precisa
// entrar de novo.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PASTA = path.dirname(fileURLToPath(import.meta.url));
export const PORTA = Number(process.env.CLARO_BOT_PORTA) || 9391;
export const URL_CLARO = 'https://minhaclaroempresas.claro.com.br/';

const chrome = process.env.BOT_CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));

async function jaAberto() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORTA}/json/version`);
    return r.ok;
  } catch {
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (await jaAberto()) {
    console.log(`O Chrome do robô já está aberto (porta ${PORTA}).`);
    process.exit(0);
  }
  if (!chrome) {
    console.log('Não achei o Chrome instalado. Informe o caminho em BOT_CHROME.');
    process.exit(1);
  }
  const perfil = path.join(PASTA, 'perfil-chrome');
  fs.mkdirSync(perfil, { recursive: true });
  const p = spawn(chrome, [`--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, '--no-first-run', '--no-default-browser-check', '--window-size=1366,900', URL_CLARO], { detached: true, stdio: 'ignore' });
  p.unref();
  for (let i = 0; i < 30 && !(await jaAberto()); i += 1) await new Promise((r) => setTimeout(r, 500));
  console.log((await jaAberto()) ? `Chrome do robô aberto (porta ${PORTA}). Faça o login da Claro na janela.` : 'O Chrome abriu, mas a porta de depuração não respondeu.');
  process.exit(0);
}
