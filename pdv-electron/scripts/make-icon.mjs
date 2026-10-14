// Gera build/icon.png (256x256) e build/icon.ico a partir do wordmark da Crosby.
// Ícone = logo branca centralizada sobre fundo azul-marinho (#000638).
// Uso: node scripts/make-icon.mjs
import Jimp from 'jimp';
import pngToIco from 'png-to-ico';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..');
const LOGO = path.join(root, 'renderer', 'assets', 'crosby-branca.png');
const OUT_PNG = path.join(root, 'build', 'icon.png');
const OUT_ICO = path.join(root, 'build', 'icon.ico');

const SIZE = 256;
const NAVY = 0x000638ff;

const bg = new Jimp(SIZE, SIZE, NAVY);
const logo = await Jimp.read(LOGO);

// escala a logo pra ocupar ~82% da largura, mantendo proporção
const targetW = Math.round(SIZE * 0.82);
logo.resize(targetW, Jimp.AUTO);
const x = Math.round((SIZE - logo.bitmap.width) / 2);
const y = Math.round((SIZE - logo.bitmap.height) / 2);
bg.composite(logo, x, y);

await bg.writeAsync(OUT_PNG);
const ico = await pngToIco(OUT_PNG);
fs.writeFileSync(OUT_ICO, ico);

console.log('✅ icon.png e icon.ico gerados em build/');
