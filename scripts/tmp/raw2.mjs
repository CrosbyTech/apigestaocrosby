import 'dotenv/config';
import { buscarMensagens } from '../../services/whatsappContasPagar.js';
const { mensagens } = await buscarMensagens({ chatid: '120363432001142287@g.us', limit: 100 });
const m = mensagens.find((x) => String(x.id).endsWith(process.argv[2]));
console.log(m ? `${m.em} ${m.trackId || ''} ${m.remetentePn}\n${m.texto}` : 'não achei nas últimas 100');
process.exit(0);
