// Gera o build do HeadCoach (frontend React/Vite) dentro de ./web, que é o que
// o PDV Crosby carrega. Fixa a API de produção: o .env.local do frontend aponta
// para localhost:4100 e, sem isto, o app instalado nasceria sem backend.
// Uso: node scripts/build-web.mjs   (ou HEADCOACH_DIR=/caminho node scripts/build-web.mjs)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.resolve(process.env.HEADCOACH_DIR || path.join(raiz, '..', '..', 'gestaocrosby'));
const saida = path.join(raiz, 'web');
const API = process.env.PDV_API_URL || 'https://apigestaocrosby-bw2v.onrender.com';

if (!fs.existsSync(path.join(frontend, 'package.json'))) {
  console.error(`❌ Frontend do HeadCoach não encontrado em ${frontend}\n   Defina HEADCOACH_DIR com o caminho do repositório gestaocrosby.`);
  process.exit(1);
}

console.log(`▶ vite build em ${frontend}\n  API: ${API}\n  saída: ${saida}`);
// comando como string única: no Windows o npx é um .cmd e precisa de shell,
// e passar args em array com shell:true dispara o aviso DEP0190 do Node.
const r = spawnSync(`npx vite build --outDir "${saida}" --emptyOutDir`, {
  cwd: frontend,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_API_BASE_URL: API, VITE_API_URL: API },
});
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('✅ web/ pronto');
