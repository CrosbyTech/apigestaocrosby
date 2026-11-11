import 'dotenv/config';
import { buscarMensagens } from '../../services/whatsappContasPagar.js';
const { mensagens } = await buscarMensagens({ chatid: '120363411253432671@g.us', limit: 40 });
const novas = (mensagens || []).filter(m => !m.deMim && m.em > '2026-11-04T13:22:15.000Z').sort((a,b)=>a.em.localeCompare(b.em));
console.log('novas:', novas.length);
for (const m of novas) console.log(' ', m.em, m.id, (m.remetente||m.de||'?').toString().slice(0,16), m.tipo, '\n', (m.texto || '').slice(0, 1500));
process.exit(0);
