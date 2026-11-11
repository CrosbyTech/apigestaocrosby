import 'dotenv/config';
import { enviarTexto } from '../../services/whatsappContasPagar.js';
const G = '120363432001142287@g.us';
const r1 = await enviarTexto({
  number: G,
  replyid: '558496220140:3EB0933899CD158EC621CB',
  trackId: 'theo',
  text: `Inefável, verifiquei:
• A de R$ 1,78 foi criada certinha ✅
• A de R$ 101,00 (19/10) falhou porque o 81298 ANTONIO PAULINO DA SILVA não está marcado como FORNECEDOR no cadastro de pessoas do TOTVS. Marque ele como fornecedor lá e tente de novo.
Agora a tela já avisa "NÃO é fornecedor no TOTVS" quando isso acontecer.
— Theo`,
});
console.log('r1', r1?.id || r1?.messageid || JSON.stringify(r1).slice(0, 120));
const r2 = await enviarTexto({
  number: G,
  replyid: '558496220140:3EB084757FDFF42CFC5E03',
  trackId: 'theo',
  text: `Titia, pronto! ✅
Na Conciliação, ao clicar em *Justificar* numa saída, agora tem a opção *"Adiantamento a fornecedor (sem nota fiscal ainda)"*: escolhe ela, confere o nome do fornecedor, coloca uma observação se quiser e clica em "Marcar como adiantamento a fornecedor".
Fica gravado separado, e no topo da página tem o botão *"Adiantamentos a fornecedor"* que mostra todos os lançamentos marcados assim (data, fornecedor, valor, empresa/conta, quem marcou), com filtro e Excel.
Atualize a página (Ctrl+F5) pra aparecer.
— Theo`,
});
console.log('r2', r2?.id || r2?.messageid || JSON.stringify(r2).slice(0, 120));
process.exit(0);
