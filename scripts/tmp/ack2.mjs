import 'dotenv/config';
import { enviarTexto } from '../../services/whatsappContasPagar.js';
const r = await enviarTexto({ number: '120363411253432671@g.us', replyid: '558496220140:3EB0534B63D1F9715B6B5B', trackId: 'bruce', text: 'Beleza, como você já baixou os três no sistema, eu foco só em achar a causa de cada um não ter subido e corrigir pra não repetir. Estou olhando os pedidos na Pagar.me agora; já te trago o diagnóstico.\n— Bruce' });
console.log('ack:', r.resposta?.messageid);
process.exit(0);
