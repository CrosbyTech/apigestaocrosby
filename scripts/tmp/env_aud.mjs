import 'dotenv/config';
import fs from 'fs';
import { enviarMidia } from '../../services/whatsappContasPagar.js';
const file = fs.readFileSync('tmp/Auditoria_pagos_via_conciliacao_11-11-2026.xlsx').toString('base64');
const text = `Titia, conferi o Contas a Pagar × baixas pela conciliação:

*Corrigido:* muitos pagos via conciliação apareciam EM ABERTO na Consulta porque a Liberação não trazia parcela/fornecedor. Agora o HeadCoach completa pela cópia do TOTVS: os títulos que aparecem PAGO (com data e valor) passaram de 423 para *560*.

*Para você revisar* (planilha anexa):
• *Possíveis duplicidades* (46): título pago via conciliação × outro título EM ABERTO do mesmo fornecedor e valor (venc. ±20 dias). Ex.: Pluxee 2309202601 pago numa empresa e em aberto na 98.
• *Título em 2 conciliações* (17): mesma duplicata usada por duas saídas (ex.: Kleiton Dantas 72462099 em 16/10 e 30/10) — uma pode estar errada; outras são pagamento parcial (Felipe 3.000 + 2.000 = 5.000).
• *Pago acima do valor* (14).
• *Não aparece PAGO* (43) e *Sem duplicata TOTVS* (30: pró-labore, consórcio etc. da Liberação, que não existem no contas a pagar do TOTVS).
Nada foi baixado nem apagado no TOTVS. Me diz quais ajustar.
— Theo`;
const r = await enviarMidia({ number: '120363432001142287@g.us', type: 'document', file, docName: 'Auditoria_pagos_via_conciliacao_11-11-2026.xlsx', text, replyid: '558496220140:3EB02CDB121FC83FCDE7BF', trackId: 'theo' });
console.log(r?.resposta?.messageid || r?.resposta?.id || JSON.stringify(r).slice(0, 150));
process.exit(0);
