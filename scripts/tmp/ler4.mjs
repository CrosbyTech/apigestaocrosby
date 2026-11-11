import 'dotenv/config';
import { buscarMensagens } from '../../services/whatsappContasPagar.js';
const { mensagens } = await buscarMensagens({ chatid: '120363432001142287@g.us', limit: 6 });
const m = mensagens.find(m => m.id === process.argv[2]);
console.log(m.texto);
process.exit(0);
