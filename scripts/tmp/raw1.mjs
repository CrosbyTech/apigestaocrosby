import 'dotenv/config';
import { buscarMensagens } from '../../services/whatsappContasPagar.js';
const { mensagens } = await buscarMensagens({ chatid: '120363432001142287@g.us', limit: 5 });
const m = mensagens.find((x) => x.id === process.argv[2]);
console.log(JSON.stringify(m, null, 1).slice(0, 3000));
process.exit(0);
