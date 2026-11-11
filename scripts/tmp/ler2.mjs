import 'dotenv/config';
import { buscarMensagens } from '../../services/whatsappContasPagar.js';
for (const chat of ['120363411253432671@g.us','120363432001142287@g.us']) {
  const { mensagens } = await buscarMensagens({ chatid: chat, limit: 15 });
  console.log('=== ', chat);
  for (const m of (mensagens||[]).sort((a,b)=>a.em.localeCompare(b.em))) console.log(' ', m.em, m.id, m.deMim?'MIM':'', m.trackId||'', (m.remetentePn||m.remetente||'').toString().slice(0,16), '|', (m.texto||'').replace(/\n/g,' ').slice(0,300));
}
process.exit(0);
