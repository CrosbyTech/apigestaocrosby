import 'dotenv/config';
import { buscarMensagens } from '../../services/whatsappContasPagar.js';
// mensagens novas = depois da última resposta do Theo (trackId 'theo')
const { mensagens } = await buscarMensagens({ chatid: '120363432001142287@g.us', limit: 40 });
const ord = (mensagens || []).sort((a, b) => a.em.localeCompare(b.em));
let ult = -1;
ord.forEach((m, i) => { if (m.trackId === 'theo') ult = i; });
for (const m of ord.slice(ult + 1)) console.log(m.em, m.id, m.deMim ? 'MIM' : '', m.trackId || '', (m.remetentePn || '').slice(0, 14), m.temMidia, '\n', (m.texto || '').slice(0, 1500));
process.exit(0);
