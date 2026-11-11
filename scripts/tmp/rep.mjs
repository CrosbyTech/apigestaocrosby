import 'dotenv/config';
import { enviarTexto } from '../../services/whatsappContasPagar.js';
const chat = '120363432001142287@g.us';
const a = await enviarTexto({ number: chat, replyid: '558496220140:3EB0933899CD158EC621CB', trackId: 'theo', text: `Vendo o erro agora, Inefável. Já te retorno.
— Theo` });
const b = await enviarTexto({ number: chat, replyid: '558496220140:3EB084757FDFF42CFC5E03', trackId: 'theo', text: `Bom dia, Titia! 💛 Vou criar no Justificar a opção *Adiantamento a fornecedor* (separada) e uma lista pra você ver todos os lançamentos marcados assim. Te aviso quando estiver pronto.
— Theo` });
console.log(a.resposta?.messageid, b.resposta?.messageid);
process.exit(0);
