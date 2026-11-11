import 'dotenv/config';
import { enviarTexto } from '../../services/whatsappContasPagar.js';
const [,, replyid, ...t] = process.argv;
const r = await enviarTexto({ number: '120363432001142287@g.us', replyid, trackId: 'theo', text: t.join(' ') });
console.log(r?.resposta?.messageid || r?.resposta?.id || 'ok');
process.exit(0);
