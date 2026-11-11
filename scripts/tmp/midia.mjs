import 'dotenv/config';
import fs from 'fs';
import { baixarMidia } from '../../services/whatsappContasPagar.js';
const r = await baixarMidia(process.argv[2]);
if (r.base64) fs.writeFileSync(process.argv[3], Buffer.from(r.base64, "base64")); else { const b = await (await fetch(r.url)).arrayBuffer(); fs.writeFileSync(process.argv[3], Buffer.from(b)); }
console.log(r.mimetype);
process.exit(0);
