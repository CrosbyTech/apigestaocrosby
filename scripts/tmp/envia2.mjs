import 'dotenv/config';
import fs from 'fs';
import { enviarMidia, enviarTexto } from '../../services/whatsappContasPagar.js';
const chat = '120363432001142287@g.us';
const a = await enviarMidia({ number: chat, type: 'document', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docName: 'Saidas_pendentes_out2026_despesas_para_validar.xlsx', file: fs.readFileSync('tmp/Saidas_pendentes_out2026_despesas_para_validar.xlsx').toString('base64'), trackId: 'theo', text: `Titia, me ajuda a validar? 💛
São as *48 saídas pendentes de outubro* (fora as tarifas). Pra cada uma eu sugeri o *fornecedor* e a *despesa do TOTVS* pelo histórico do fornecedor (ou pelo tipo do gasto). Ex.:
• Elite Consultores → 6017 Assistência Contábil
• Facebook (cartão Stone) → 6031 Propaganda e Anúncios
• iFood → 6053 Material de Copa e Cozinha
• Caixa Econômica → 3014 FGTS
• Tribunal de Justiça → 6019 Despesas Legais e Judiciais
14 ficaram sem sugestão (ex.: Lenivaldo, Paschoalotto, estornos Pagar.me).
Na planilha tem duas colunas no fim: "despesa correta?" e "se não, qual código?". Pode me responder aqui mesmo, do jeito que for mais fácil.
— Theo` });
console.log('titia', a.resposta?.messageid);
const b = await enviarTexto({ number: chat, replyid: '558496220140:3EB08C3F867661302AC87A', trackId: 'theo', text: `Pronto, Inefável (sobe no deploy; Ctrl+F5). Na janela "Saídas pendentes":
• *Todas* as pendentes aparecem e qualquer linha pode ser marcada.
• Colunas *Fornecedor (cód.)* e *Despesa (cód.)* editáveis, já vindo com a sugestão do TOTVS (ao digitar outro código, mostra o nome).
• *Baixar Excel* = todas as linhas da tela com esses campos.
• *Criar duplicatas* usa o fornecedor e a despesa de cada linha.
Mandei a planilha pra Titia validar as despesas. Depois que ela confirmar, você cria.
— Theo` });
console.log('joao', b.resposta?.messageid);
process.exit(0);
