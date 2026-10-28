// Publica uma versão nova do app Android "Balanço RFID".
//
//   node scripts/release.mjs                    -> sobe a versão (+1), compila e publica
//   node scripts/release.mjs --manter-versao    -> compila e publica a versão atual
//   node scripts/release.mjs --notas "texto"    -> texto mostrado no aviso de atualização
//   node scripts/release.mjs --obrigatoria      -> o app não deixa adiar a atualização
//
// Sobe para o bucket PÚBLICO `pdv-updates` do Supabase (o mesmo do PDV de
// desktop), na pasta balanco-rfid/:
//   Balanco-RFID-<versão>.apk   o APK desta versão
//   Balanco-RFID.apk            cópia de nome fixo = link "Baixar Balanço RFID"
//                               do menu Tecnologia do HeadCoach
//   apk-latest.json             { versionCode, versionName, url, ... } — é o que
//                               o app consulta ao abrir. Enviado por ÚLTIMO.
//
// Precisa: JDK 17 + Android SDK (padrão em C:/Users/yagom/dev-tools, ou JAVA_HOME
// e local.properties) e a chave de assinatura (keystore.properties + keystore/).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'pdv-updates';
const PASTA = 'balanco-rfid';
const args = process.argv.slice(2);
const manter = args.includes('--manter-versao');
const obrigatoria = args.includes('--obrigatoria');
const iNotas = args.indexOf('--notas');
const notas = iNotas >= 0 ? args[iNotas + 1] || '' : '';

function falhar(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(raiz, 'keystore.properties'))) {
  falhar('keystore.properties não encontrado — sem a chave de assinatura o Android não aceita a atualização. Restaure o backup (ver README.md).');
}

// ─── versão ──────────────────────────────────────────────────────────────────
const arqVersao = path.join(raiz, 'version.properties');
const props = Object.fromEntries(
  fs
    .readFileSync(arqVersao, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => l.split('=').map((x) => x.trim())),
);
let versionCode = parseInt(props.versionCode, 10);
let versionName = props.versionName;
if (!manter) {
  const [maj, min, pat] = versionName.split('.').map((n) => parseInt(n, 10) || 0);
  versionCode += 1;
  versionName = `${maj}.${min}.${pat + 1}`;
  fs.writeFileSync(arqVersao, `versionCode=${versionCode}\nversionName=${versionName}\n`);
}
console.log(`▶ Balanço RFID v${versionName} (versionCode ${versionCode})`);

// ─── build ───────────────────────────────────────────────────────────────────
const env = { ...process.env };
if (!env.JAVA_HOME && fs.existsSync('C:/Users/yagom/dev-tools/jdk17')) env.JAVA_HOME = 'C:\\Users\\yagom\\dev-tools\\jdk17';
const gradlew = path.join(raiz, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const r = spawnSync(`"${gradlew}" assembleRelease --console=plain`, { cwd: raiz, stdio: 'inherit', shell: true, env });
if (r.status !== 0) falhar('build do Gradle falhou');

const apk = path.join(raiz, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!fs.existsSync(apk)) falhar(`APK não gerado em ${apk}`);
const bytes = fs.readFileSync(apk);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

// ─── upload ──────────────────────────────────────────────────────────────────
const { default: supabase } = await import('../../config/supabase.js');
const base = `${String(supabase.supabaseUrl).replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${PASTA}`;
const nomeVersao = `Balanco-RFID-${versionName}.apk`;

{
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) falhar(`listar buckets: ${error.message}`);
  const b = buckets.find((x) => x.name === BUCKET);
  if (!b) {
    const { error: e } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (e) falhar(`criar bucket: ${e.message}`);
  } else if (!b.public) falhar(`o bucket "${BUCKET}" é privado — marque como público no Supabase`);
}

const manifesto = {
  app: 'balanco-rfid',
  versionCode,
  versionName,
  url: `${base}/${nomeVersao}`,
  tamanho: bytes.length,
  sha256,
  obrigatoria,
  notas,
  publicadoEm: new Date().toISOString(),
};
const envios = [
  { destino: nomeVersao, corpo: bytes, tipo: 'application/vnd.android.package-archive', cache: '3600' },
  { destino: 'Balanco-RFID.apk', corpo: bytes, tipo: 'application/vnd.android.package-archive', cache: '0' },
  { destino: 'apk-latest.json', corpo: Buffer.from(JSON.stringify(manifesto, null, 2)), tipo: 'application/json', cache: '0' }, // sempre por último
];
for (const e of envios) {
  process.stdout.write(`▶ ${PASTA}/${e.destino} (${(e.corpo.length / 1024).toFixed(0)} KB) ... `);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${PASTA}/${e.destino}`, e.corpo, { upsert: true, contentType: e.tipo, cacheControl: e.cache });
  if (error) {
    console.log('');
    falhar(`enviar ${e.destino}: ${error.message}`);
  }
  console.log('ok');
}

// confere o que está no ar
const res = await fetch(`${base}/apk-latest.json?t=${Date.now()}`);
const online = res.ok ? await res.json() : null;
if (online?.versionCode !== versionCode) falhar(`apk-latest.json público não bate (HTTP ${res.status})`);
console.log(`✅ v${versionName} publicada.\n   Download: ${base}/Balanco-RFID.apk\n   Os coletores recebem o aviso de atualização na próxima abertura do app.`);
