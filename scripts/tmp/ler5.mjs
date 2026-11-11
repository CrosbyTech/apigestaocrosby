import 'dotenv/config';
import { buscarMensagens } from '../../services/whatsappContasPagar.js';
for (const chat of ['120363432001142287@g.us', '120363411253432671@g.us']) {
  const { mensagens } = await buscarMensagens({ chatid: chat, limit: 15 });
  console.log('==', chat);
  for (const m of mensagens.filter(m => m.em > '2026-11-05T00:50').sort((a,b)=>a.em.localeCompare(b.em))) console.log(m.em, m.id, m.deMim?'MIM':'', m.trackId||'', (m.remetentePn||'').slice(0,14), m.temMidia, '|', (m.texto||'').replace(/\n/g,' ').slice(0,200));
}
process.exit(0);
