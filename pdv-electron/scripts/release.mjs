// Publica uma versão nova do PDV Crosby para os caixas se atualizarem sozinhos.
//
//   npm run release              -> npm run dist + upload
//   npm run release:skip-build   -> só upload do que já está em dist/
//
// Sobe para o bucket PÚBLICO `pdv-updates` do Supabase (projeto principal, o
// mesmo de ../../config/supabase.js — service role, nunca commitar chave aqui):
//   PDV-Crosby-Setup-<versão>.exe, .exe.blockmap (download diferencial) e
//   latest.yml (versão + sha512; é o que o app instalado consulta ao abrir).
// O latest.yml é enviado por ÚLTIMO: um caixa nunca vê uma versão cujo .exe
// ainda não terminou de subir. A URL pública é a de build.publish.url.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
const versao = pkg.version;
const publish = pkg.build?.publish;
const skipBuild = process.argv.includes('--skip-build');

if (!publish || publish.provider !== 'generic' || !publish.url) {
  console.error('❌ build.publish (provider generic + url) não configurado no package.json');
  process.exit(1);
}
// .../storage/v1/object/public/<bucket>[/<prefixo>]
const m = publish.url.match(/^(https:\/\/[^/]+)\/storage\/v1\/object\/public\/([^/]+)\/?(.*)$/);
if (!m) {
  console.error(`❌ build.publish.url não é uma URL pública do Supabase Storage: ${publish.url}`);
  process.exit(1);
}
const [, supabaseUrl, bucket, prefixo] = m;

if (!skipBuild) {
  console.log(`▶ npm run dist (v${versao})`);
  const r = spawnSync('npm run dist', { cwd: raiz, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const dist = path.join(raiz, 'dist');
const nomeExe = `PDV-Crosby-Setup-${versao}.exe`;
const arquivos = [
  { nome: nomeExe, tipo: 'application/octet-stream', cache: '3600' },
  { nome: `${nomeExe}.blockmap`, tipo: 'application/octet-stream', cache: '3600' },
  { nome: 'latest.yml', tipo: 'text/yaml', cache: '0' }, // sempre por último
];
for (const a of arquivos) {
  if (!fs.existsSync(path.join(dist, a.nome))) {
    console.error(`❌ ${a.nome} não existe em dist/. Rode npm run dist (ou confira a versão).`);
    process.exit(1);
  }
}
const yml = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
if (!yml.includes(`version: ${versao}`) || !yml.includes(nomeExe)) {
  console.error(`❌ dist/latest.yml não é da versão ${versao}. Rode npm run dist de novo.`);
  process.exit(1);
}

// cliente admin da API (service role). Importado daqui para não duplicar chave.
const { default: supabase } = await import('../../config/supabase.js');
if (!String(supabase.supabaseUrl || '').startsWith(supabaseUrl)) {
  console.error(
    `❌ build.publish.url aponta para ${supabaseUrl}, mas config/supabase.js usa ${supabase.supabaseUrl}`,
  );
  process.exit(1);
}

// bucket público (criado na primeira publicação; se já existir privado, avisa)
{
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) falhar('listar buckets', error);
  const existente = buckets.find((b) => b.name === bucket);
  if (!existente) {
    console.log(`▶ criando bucket público "${bucket}"`);
    const { error: e } = await supabase.storage.createBucket(bucket, { public: true });
    if (e) falhar('criar bucket', e);
  } else if (!existente.public) {
    console.error(
      `❌ O bucket "${bucket}" existe mas é privado. Marque-o como público no painel do Supabase (Storage → ${bucket} → Edit bucket).`,
    );
    process.exit(1);
  }
}

for (const a of arquivos) {
  const caminho = path.join(dist, a.nome);
  const destino = prefixo ? `${prefixo.replace(/\/$/, '')}/${a.nome}` : a.nome;
  const tamanho = fs.statSync(caminho).size;
  process.stdout.write(`▶ ${a.nome} (${(tamanho / 1024 / 1024).toFixed(1)} MB) ... `);
  const { error } = await supabase.storage
    .from(bucket)
    .upload(destino, fs.readFileSync(caminho), {
      upsert: true,
      contentType: a.tipo,
      cacheControl: a.cache,
    });
  if (error) {
    console.log('');
    if (/exceeded|maximum allowed size|too large|413/i.test(error.message || '')) {
      console.error(
        '   O projeto Supabase limita o tamanho por arquivo (plano Free: 50 MB).\n' +
          '   Aumente em Storage → Settings → Upload file size limit (precisa do plano Pro).',
      );
    }
    falhar(`enviar ${a.nome}`, error);
  }
  console.log('ok');
}

// confere que o que está no ar é o que acabamos de subir
const res = await fetch(`${publish.url.replace(/\/$/, '')}/latest.yml?t=${Date.now()}`);
const online = res.ok ? await res.text() : '';
if (!online.includes(`version: ${versao}`)) {
  console.error(`❌ latest.yml público não bate (HTTP ${res.status}). Conteúdo:\n${online}`);
  process.exit(1);
}
console.log(
  `✅ v${versao} publicada em ${publish.url}\n` +
    '   Os caixas recebem a atualização na próxima abertura (ou em até 6 h, se ficarem abertos).',
);

function falhar(etapa, error) {
  console.error(`❌ Falha ao ${etapa}: ${error.message || JSON.stringify(error)}`);
  process.exit(1);
}
