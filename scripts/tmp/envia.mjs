import 'dotenv/config';
import fs from 'fs';
import { enviarMidia, enviarTexto } from '../../services/whatsappContasPagar.js';
const chat = '120363432001142287@g.us';
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const a = await enviarMidia({ number: chat, type: 'document', mimetype: mime, docName: 'Contas_a_Receber_out2026_vencidos_a_vencer.xlsx', file: fs.readFileSync('tmp/Contas_a_Receber_out2026_vencidos_a_vencer.xlsx').toString('base64'), replyid: '558496220140:3EB077ADF9C5DB3D23648A', trackId: 'theo', text: `Mestre, contas a RECEBER dividido:
• Recebidos em outubro (liquidação 01–31/10): 3.137 títulos · R$ 980.723,96 pagos
• Vencidos até outubro (em aberto): 2.235 · R$ 1.732.069,23
• A vencer de novembro em diante (em aberto): 2.443 · R$ 1.185.298,49
— Theo` });
console.log('CR', a.resposta?.messageid || JSON.stringify(a).slice(0, 200));
const b = await enviarMidia({ number: chat, type: 'document', mimetype: mime, docName: 'Contas_a_Pagar_out2026_vencidos_a_vencer.xlsx', file: fs.readFileSync('tmp/Contas_a_Pagar_out2026_vencidos_a_vencer.xlsx').toString('base64'), replyid: '558496220140:3EB0C4B2328B5BF6F83DC6', trackId: 'theo', text: `Mestre, contas a PAGAR dividido:
• Pagos em outubro (liquidação 01–31/10, incl. 5 pagos na Liberação): 391 linhas · R$ 50.041,55
• Vencidos até outubro (não pagos): 453 · R$ 1.697.851,38
• A vencer de novembro em diante: 228 · R$ 479.840,95

⚠️ Outubro está bem abaixo dos outros meses no próprio relatório (set: R$ 365 mil pagos; out: R$ 44,5 mil). Parece que os pagamentos de outubro ainda não foram baixados no TOTVS — por isso caem em "vencidos".
— Theo` });
console.log('CP', b.resposta?.messageid || JSON.stringify(b).slice(0, 200));
process.exit(0);
