// Gera a documentação da API HeadCoach em arquivo, a partir das mesmas
// declarações que criam as rotas (routes/headcoachApi):
//   docs/API-HEADCOACH.md               guia em texto, para programador ou IA
//   docs/api-headcoach.openapi.json     especificação OpenAPI 3 (importa no Postman, Insomnia, Swagger…)
// Rodar na raiz do repositório sempre que um recurso mudar:
//   node scripts/gerar-docs-api-headcoach.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// as rotas não são chamadas aqui: só as declarações são lidas (o banco não é consultado)
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
const { MODULOS } = await import('../routes/headcoachApi/index.js');
const { montarOpenApi, montarGuia } = await import('../routes/headcoachApi/_engine.js');

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVIDOR = 'https://apigestaocrosby-bw2v.onrender.com';
const spec = montarOpenApi(MODULOS, { servidor: SERVIDOR });
const cabecalho = [
  '<!-- Arquivo GERADO por scripts/gerar-docs-api-headcoach.mjs — não edite à mão. -->',
  '',
  `Servidor de produção: \`${SERVIDOR}\``,
  '',
  `Página interativa (Swagger): \`${SERVIDOR}/api/headcoach/docs\` · OpenAPI: \`${SERVIDOR}/api/headcoach/openapi.json\``,
  '',
  'Exemplo:',
  '',
  '```',
  `curl -H "X-API-Key: <chave>" "${SERVIDOR}/api/headcoach/transaction/v1/transactions?branchCodeList=95&startDate=2026-11-17&endDate=2026-11-17&expand=items,payments"`,
  '```',
  '',
].join('\n');
const guia = montarGuia(MODULOS);
const [titulo, ...resto] = guia.split('\n');
fs.writeFileSync(path.join(raiz, 'docs', 'API-HEADCOACH.md'), `${titulo}\n\n${cabecalho}${resto.join('\n')}\n`);
fs.writeFileSync(path.join(raiz, 'docs', 'api-headcoach.openapi.json'), `${JSON.stringify(spec, null, 2)}\n`);
const rotas = MODULOS.reduce((s, m) => s + m.rotas.length, 0);
console.log(`ok: ${MODULOS.length} módulos, ${rotas} rotas, ${Object.keys(spec.components.schemas).length} esquemas → docs/API-HEADCOACH.md e docs/api-headcoach.openapi.json`);
process.exit(0);
