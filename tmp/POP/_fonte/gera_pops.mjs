// Gera os 3 POPs em PDF (HTML → PDF pelo Chrome). Prints em scratchpad/prints.
import puppeteer from 'file:///C:/Users/yagom/apigestaocrosby/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import fs from 'node:fs';

const PRINTS = 'C:/Users/yagom/AppData/Local/Temp/claude/af7426cb677bf6db/a9986a76-d8f3-4913-949a-e558f11b5c92/scratchpad/prints';
const SAIDA = 'C:/Users/yagom/apigestaocrosby/tmp/POP';
fs.mkdirSync(SAIDA, { recursive: true });
const DATA = '11/11/2026';

// ─── peças de montagem ───────────────────────────────────────────────────────
let nFig = 0;
const fig = (arquivo, legenda, largura = 100) => {
  if (!fs.existsSync(`${PRINTS}/${arquivo}.jpg`)) throw new Error(`print não existe: ${arquivo}`);
  nFig += 1;
  return `<figure style="width:${largura}%"><img src="file:///${PRINTS}/${arquivo}.jpg"><figcaption><b>Figura ${nFig}.</b> ${legenda}</figcaption></figure>`;
};
const lado = (figura, texto) => `<div class="lado"><div class="lado-fig">${figura}</div><div class="lado-txt">${texto}</div></div>`;
const passos = (lista) => `<ol class="passos">${lista.map((p) => `<li>${p}</li>`).join('')}</ol>`;
const itens = (lista) => `<ul>${lista.map((p) => `<li>${p}</li>`).join('')}</ul>`;
const aviso = (tipo, titulo, html) => `<div class="aviso ${tipo}"><p class="aviso-t">${titulo}</p>${html}</div>`;
const atencao = (html) => aviso('atencao', 'Atenção', html);
const dica = (html) => aviso('dica', 'Dica', html);
const exemplo = (html) => aviso('exemplo', 'Exemplo', html);
const tabela = (cab, linhas, larguras = []) =>
  `<table><thead><tr>${cab.map((c, i) => `<th${larguras[i] ? ` style="width:${larguras[i]}"` : ''}>${c}</th>`).join('')}</tr></thead><tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
let nSec = 0;
const sec = (titulo, html) => {
  nSec += 1;
  return `<section><h2><span>${nSec}</span>${titulo}</h2>${html}</section>`;
};
const sub = (titulo, html) => `<div class="sub"><h3>${titulo}</h3>${html}</div>`;
const quebra = '<div class="quebra"></div>';

const CSS = `
@page { size: A4; margin: 15mm 14mm 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.4pt; line-height: 1.5; color: #1c2333; margin: 0; }
.capa { border-radius: 10px; background: #000638; color: #fff; padding: 20px 22px; margin-bottom: 12px; }
.capa .cod { font-size: 9pt; letter-spacing: .14em; text-transform: uppercase; opacity: .75; margin: 0; }
.capa h1 { font-size: 21pt; line-height: 1.2; margin: 4px 0 6px; }
.capa .subt { margin: 0; font-size: 10.5pt; opacity: .9; }
.ficha { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid #d5dae6; border-radius: 8px; overflow: hidden; margin-bottom: 14px; font-size: 9pt; }
.ficha div { padding: 6px 9px; border-right: 1px solid #d5dae6; }
.ficha div:last-child { border-right: 0; }
.ficha b { display: block; font-size: 7.6pt; text-transform: uppercase; letter-spacing: .06em; color: #6b7386; }
h2 { font-size: 13.5pt; color: #000638; margin: 18px 0 7px; padding-bottom: 4px; border-bottom: 2px solid #000638; break-after: avoid; display: flex; align-items: center; gap: 8px; }
h2 span { display: inline-grid; place-items: center; min-width: 24px; height: 24px; border-radius: 6px; background: #000638; color: #fff; font-size: 10.5pt; padding: 0 5px; }
h3 { font-size: 11pt; color: #000638; margin: 12px 0 4px; break-after: avoid; }
p { margin: 5px 0; }
ul, ol { margin: 5px 0; padding-left: 20px; }
li { margin: 2.5px 0; }
ol.passos { list-style: none; counter-reset: p; padding-left: 0; }
ol.passos > li { counter-increment: p; position: relative; padding: 5px 8px 5px 34px; margin: 4px 0; background: #f4f6fb; border-radius: 7px; break-inside: avoid; }
ol.passos > li::before { content: counter(p); position: absolute; left: 7px; top: 5px; width: 19px; height: 19px; border-radius: 50%; background: #000638; color: #fff; font-size: 8.6pt; font-weight: 700; display: grid; place-items: center; }
figure { margin: 9px auto; break-inside: avoid; }
figure img { width: 100%; display: block; border: 1px solid #c9cfdd; border-radius: 6px; }
figcaption { font-size: 8.4pt; color: #5a6275; margin-top: 3px; text-align: center; }
.lado { display: flex; gap: 12px; align-items: flex-start; margin: 8px 0; break-inside: avoid; }
.lado-fig { flex: 0 0 40%; }
.lado-fig figure { margin: 0; width: 100% !important; }
.lado-txt { flex: 1; }
.lado-txt > :first-child { margin-top: 0; }
.aviso { border-radius: 7px; padding: 7px 10px; margin: 8px 0; break-inside: avoid; border-left: 4px solid; font-size: 9.8pt; }
.aviso p { margin: 3px 0; } .aviso ul { margin: 3px 0; }
.aviso-t { font-weight: 700; font-size: 8.4pt; text-transform: uppercase; letter-spacing: .07em; margin: 0 0 2px !important; }
.atencao { background: #fff4e5; border-color: #e08a00; } .atencao .aviso-t { color: #a35f00; }
.dica { background: #eaf6ef; border-color: #1f9d55; } .dica .aviso-t { color: #157a41; }
.exemplo { background: #eef2ff; border-color: #3b5bdb; } .exemplo .aviso-t { color: #2f48b0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9.3pt; break-inside: auto; }
th { background: #000638; color: #fff; text-align: left; padding: 5px 7px; font-size: 8.6pt; }
td { border: 1px solid #d5dae6; padding: 5px 7px; vertical-align: top; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) td { background: #f7f8fc; }
.quebra { break-before: page; }
.tela { font-weight: 700; color: #000638; }
kbd { font-family: inherit; font-size: 8.8pt; font-weight: 700; background: #000638; color: #fff; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
kbd.v { background: #07875a; } kbd.c { background: #fff; color: #000638; border: 1px solid #000638; } kbd.r { background: #c92a2a; }
.resumo { border: 1px solid #000638; border-radius: 8px; padding: 8px 12px; margin: 8px 0 4px; break-inside: avoid; }
.resumo p { margin: 2px 0; }
.sub { break-inside: auto; }
.mini { font-size: 8.8pt; color: #5a6275; }
`;

const pagina = ({ codigo, titulo, subtitulo, publico, corpo }) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${codigo} — ${titulo}</title><style>${CSS}</style></head><body>
<div class="capa"><p class="cod">Procedimento Operacional Padrão · ${codigo}</p><h1>${titulo}</h1><p class="subt">${subtitulo}</p></div>
<div class="ficha"><div><b>Sistema</b>HeadCoach Crosby</div><div><b>Quem usa</b>${publico}</div><div><b>Versão</b>1.0 · ${DATA}</div><div><b>Elaboração</b>Tecnologia Crosby</div></div>
${corpo}
</body></html>`;

// ─── blocos comuns aos dois POPs de faturamento ──────────────────────────────
const blocoCaixa = () =>
  sec(
    'Antes de começar: caixa aberto e portal ligado',
    `<p>O faturamento faz duas coisas de uma vez: <b>emite a NF-e</b> pela empresa 99 (série 3) e <b>grava a venda no TOTVS</b> (documento interno + contas a receber) na <b>empresa 990</b>. Para a segunda parte funcionar, o caixa precisa estar aberto.</p>
    ${sub(
      'Abrir e fechar o caixa (todo dia)',
      passos([
        'No início do expediente, abra no TOTVS o <b>caixa do terminal 1 da empresa 990</b>, com a <b>data de hoje</b>.',
        'Fature normalmente durante o dia. Cada faturamento entra nesse caixa com a forma de pagamento informada.',
        'No fim do expediente, <b>feche o caixa</b> no TOTVS. No dia seguinte, abra um caixa novo com a data do dia.',
      ]) +
        atencao(
          '<p>O TOTVS só recebe com o caixa aberto <b>na data de hoje</b>. Caixa fechado, ou aberto com a data de ontem, faz a nota sair mas a venda ficar como <b>TOTVS pendente</b>. A correção é abrir o caixa e usar <kbd>Tentar de novo</kbd> na aba Transações (seção de problemas, no fim deste POP).</p>',
        ),
    )}
    ${sub(
      'Conferir o portal RFID',
      itens([
        'Portal ligado na tomada e na rede, com as antenas no lugar.',
        'Nada com etiqueta perto do portal além das peças do pedido que vai ser faturado (ele lê tudo o que estiver no alcance).',
        'O computador da expedição com o <b>PDV HeadCoach</b> aberto e o usuário logado.',
      ]),
    )}`,
  );

const blocoConferencia = (imgConf, imgPortal) =>
  `${sub(
    'Ligar o portal e conferir as peças',
    lado(
      fig(imgPortal, 'Cartão Portal RFID: ligar, potência, limpar e digitação de peça sem etiqueta.'),
      passos([
        'Clique em <kbd class="v">LIGAR PORTAL</kbd>. O aviso muda de “desconectado” para conectado.',
        'Passe as peças do pedido pelo portal. Cada etiqueta lida é conferida contra o pedido na hora.',
        'Peça <b>sem etiqueta</b>: digite o SKU ou o código de barras no campo e aperte <kbd>+1</kbd> (ou Enter).',
        '<kbd class="c">Potência</kbd> ajusta o alcance das antenas; <kbd class="c">Limpar leituras</kbd> zera tudo o que foi lido neste pedido.',
      ]),
    ) +
      fig(imgConf, 'Produtos do pedido: lido / pedido em cada linha, com o botão “tirar 1”.') +
      tabela(
        ['O que aparece na linha', 'O que significa', 'O que fazer'],
        [
          ['<b>1/1 · ok</b> (verde)', 'A quantidade lida bate com o pedido.', 'Nada.'],
          ['<b>0/1 · falta 1</b>', 'A peça do pedido ainda não foi lida.', 'Passar a peça. Se ela não existe, ver “Peça em falta”.'],
          ['<b>+1 a mais</b> (vermelho)', 'Foi lida mais peça do que o pedido tem.', 'Tirar a peça a mais com <kbd class="c">tirar 1</kbd>.'],
          ['Bloco <b>“Lidas que NÃO estão no pedido”</b>', 'O portal leu uma peça de outro pedido.', 'Tirar com <kbd class="c">tirar 1</kbd>. Ela nunca entra na nota.'],
          ['“etiqueta(s) que o TOTVS não reconheceu”', 'Etiqueta sem cadastro.', 'Digitar o SKU da peça no campo manual.'],
        ],
        ['30%', '35%', '35%'],
      ) +
      sub(
        'Tirar peças uma a uma',
        itens([
          '<kbd class="c">tirar 1</kbd> tira <b>uma</b> peça daquele produto e deixa as outras leituras como estão.',
          'O ícone de lixeira, ao lado, tira <b>todas</b> as peças daquele produto.',
          'O <b>x</b> em cada etiqueta roxa tira exatamente aquela etiqueta.',
          'A etiqueta tirada à mão <b>não volta sozinha</b>, mesmo com a peça ainda perto do portal. Se tirou por engano, use <kbd class="c">Voltar a ler</kbd> no aviso que aparece embaixo da lista.',
        ]),
      ) +
      atencao('<p><b>Só as peças conferidas entram na nota.</b> O que falta ou sobra fica registrado no faturamento, mas não vai para a NF-e.</p>'),
  )}`;

const blocoTransportePagamento = (imgTransp, imgPag, imgTotvs, brejinho = false) =>
  `${sub(
    'Transporte',
    fig(imgTransp, 'Transportadora, frete, volumes e peso do pedido.') +
      itens([
        'A transportadora já vem do pedido. Opções: <b>Correios, LATAM, Azul, BEE Tecnologia, Baraúnas Entregas, taxistas</b> cadastrados, <b>Outro (pesquisar no TOTVS)</b> e <b>Retirada (sem transportadora)</b>.',
        'Com transportadora, preencha <b>frete, volumes e peso</b>. Eles vão para a NF-e e para a minuta.',
        'Em “Outro”, pesquise o taxista ou a transportadora pelo nome ou código do TOTVS.',
        'Retirada: a nota sai “sem frete”.',
      ]),
  )}
  ${sub(
    'Pagamento',
    fig(imgPag, 'Formas de pagamento. A primeira forma acompanha sozinha o total da nota.') +
      itens([
        `A forma de pagamento ${brejinho ? 'é informada na hora do faturamento' : 'já vem do pedido (Pix, cartão, boleto)'}. A primeira linha é <b>automática</b>: o valor acompanha o total da nota.`,
        '<kbd class="c">+ forma</kbd> acrescenta outra forma (pagamento dividido). A soma tem que fechar com o <b>Total da NF-e</b>.',
        '<b>Cartão:</b> escolha a <b>operadora</b> e o <b>parcelamento</b> da lista (vem do cadastro do TOTVS) e confira NSU e autorização.',
        '<b>Boleto:</b> informe o número de parcelas e o <b>vencimento de cada uma</b>. Depois do faturamento sai a duplicata para o cliente assinar.',
        '<b>Credev e Adiantamento:</b> a faixa azul mostra o saldo do cliente no TOTVS (empresa 99). O botão <kbd>usar</kbd> acrescenta a forma com o valor disponível. Não deixa usar mais que o saldo.',
        '<b>Saldo bônus:</b> crédito de peça em falta de outro pedido. Aparece numa faixa verde quando o cliente tem saldo; <kbd class="v">usar</kbd> acrescenta a forma.',
        'Os <b>comprovantes</b> anexados ao pedido no Dryland ficam em links logo abaixo.',
      ]),
  )}
  ${sub(
    'TOTVS (documento interno)',
    lado(
      fig(imgTotvs, 'Operação, data, terminal e modo de recebimento no TOTVS.'),
      itens([
        '<b>Operação:</b> já vem pelo canal — 511 varejo, 7807 franquias, 7808 multimarcas, 7809 revendedores.',
        '<b>Terminal:</b> o do caixa aberto (padrão 1).',
        '<b>Transação com data diferente:</b> para venda de outro dia. A transação sai com a data de hoje e a data real vai na observação.',
        '<b>Recebimento no TOTVS:</b> “Pela forma de pagamento” é o normal. “Como fatura” lança títulos a prazo, sem movimento de caixa (usar só quando orientado pelo financeiro).',
      ]),
    ),
  )}`;

const blocoFaturar = (imgConfirmar) =>
  `${sub(
    'Faturar e emitir a nota',
    passos([
      'Confira o quadro de totais: peças conferidas, desconto, frete e <b>Total da NF-e</b>.',
      'Se o botão <kbd class="v">FATURAR</kbd> estiver apagado, a lista em laranja logo abaixo diz o que falta (cliente, vendedor, pagamento que não fecha, cartão sem operadora, vencimento do boleto…).',
      'Clique em <kbd class="v">FATURAR</kbd>. Abre a janela de confirmação com o número da próxima nota, cliente, cenário fiscal, transporte e pagamento.',
      'Confira e clique em <kbd class="v">Emitir NF-e e gravar no TOTVS</kbd>. Leva até 1 minuto. <b>A nota é real</b> (SEFAZ, produção).',
      'No resultado aparecem a <b>NF-e autorizada</b> (número e chave), os botões <kbd>DANFE</kbd> e <kbd class="c">XML</kbd> e a <b>transação do TOTVS</b>.',
      'Imprima o DANFE e siga para o próximo pedido em <kbd>Faturar outro pedido</kbd>.',
    ]) + lado(fig(imgConfirmar, 'Janela de confirmação antes de emitir.'), `<p><b>Confira sempre antes de emitir:</b></p>${itens(['cliente certo e com endereço;', 'quantidade de peças e total;', 'transportadora e frete;', 'forma de pagamento e parcelas;', 'crédito de peça em falta, se houver.'])}<p>Se o resultado mostrar “TOTVS ainda não recebeu”, a nota já saiu: resolva a causa (quase sempre o caixa) e use <kbd>Tentar de novo</kbd>. <b>Não fature o pedido outra vez.</b></p>`),
  )}`;

const blocoFalta = (img) =>
  sec(
    'Peça em falta e saldo bônus',
    `<p>Às vezes o pedido tem 6 peças e na hora de bipar só existem 5. Se o cliente <b>preferir ficar com o crédito</b> da peça que faltou:</p>
    ${lado(
      fig(img, 'Opção de crédito no quadro de totais (aparece quando falta peça).'),
      passos([
        'Confira as peças que existem. A que faltou fica como “falta 1”.',
        'No quadro de totais, marque <b>“Peça em falta: o cliente ficou com crédito de R$ …”</b>.',
        'Confira a conta que aparece: <b>Nota + crédito = valor pago no pedido</b>.',
        'Fature normalmente.',
      ]),
    )}
    <p><b>O que o sistema faz sozinho:</b></p>
    ${itens([
      'a peça que faltou <b>não entra na NF-e</b> nem na transação do TOTVS;',
      'o valor dela vira <b>saldo bônus</b> do cliente no HeadCoach;',
      'abre um <b>chamado no Dryland para o Financeiro</b> com o cliente, o pedido, a nota, a transação e o valor;',
      'na aba Transações a venda ganha o selo “crédito R$ …” e um cartão com o número do chamado.',
    ])}
    ${exemplo('<p>Pedido RV1288, pago em Pix: R$ 143,14 por 3 peças. Só 2 existem. Nota de R$ 104,23 + crédito de R$ 38,91 = R$ 143,14. O cliente fica com R$ 38,91 de saldo bônus.</p>')}
    ${sub(
      'Usar o saldo bônus em outro faturamento',
      passos([
        'Abra o pedido novo do mesmo cliente. Se ele tem saldo, aparece a faixa verde <b>“Saldo bônus do cliente (HeadCoach)”</b> acima das formas de pagamento.',
        'Clique em <kbd class="v">usar</kbd>. Entra a forma <b>Saldo bônus</b> com o valor disponível (até o total da nota).',
        'Complete o restante com a outra forma de pagamento e fature.',
      ]),
    )}
    ${atencao(
      itens([
        'O crédito só vale para pedido <b>já pago</b> em Pix, cartão ou dinheiro. Com boleto, basta faturar o valor das peças que existem.',
        'Se o cliente <b>não</b> quiser crédito (vai esperar a peça, por exemplo), não marque a opção: fale com o comercial antes de faturar.',
        'Se a nota for cancelada, o bônus gasto nela volta para o cliente e o crédito que ela gerou é cancelado.',
      ]),
    )}`,
  );

const blocoTransacoes = () =>
  sec(
    'Depois do faturamento: aba Transações',
    `<p>Tudo o que foi faturado fica na aba <kbd>Transações</kbd>, no topo da tela de Faturamento.</p>
    ${fig('trans-1-lista', 'Aba Transações: quadros de resumo (clicáveis) e a lista de faturamentos do período.')}
    ${tabela(
      ['Cor da linha / quadro', 'Situação', 'Significado'],
      [
        ['Verde', '<b>Faturado</b>', 'Nota autorizada e venda recebida no TOTVS. Está tudo certo.'],
        ['Laranja', '<b>TOTVS pendente</b>', 'A nota saiu, mas o TOTVS ainda não recebeu. Abrir a linha e usar “Tentar de novo”.'],
        ['Vermelho', '<b>NF-e com problema</b>', 'A nota foi rejeitada ou não chegou a sair. O motivo aparece no cartão da nota.'],
        ['Cinza', '<b>Cancelado</b>', 'Nota cancelada. Se aparecer “cancelar 99/…” ou “cancelar 990/…”, falta cancelar a transação no TOTVS.'],
      ],
      ['20%', '22%', '58%'],
    )}
    <p>Clique num quadro para <b>filtrar</b> só aquela situação. A busca aceita pedido, cliente, número da nota, transação ou quem emitiu.</p>
    ${quebra}
    ${sub(
      'Abrir um faturamento',
      `<p>Clique na linha. No topo aparece a <b>trilha</b> do faturamento (NF-e → TOTVS → Duplicata → Minuta → Crédito), com o que já foi feito em verde e o que falta em laranja.</p>
      ${fig('trans-2-detalhe-boleto', 'Detalhe de uma venda em boleto: nota, TOTVS, pagamento, duplicata, minuta, transporte e peças.', 96)}
      ${tabela(
        ['Cartão', 'O que tem', 'Ações'],
        [
          ['<b>Nota fiscal</b>', 'Número, série, chave e situação.', '<kbd>DANFE</kbd>, <kbd class="c">XML</kbd> e <kbd class="r">Cancelar NF-e</kbd>.'],
          ['<b>TOTVS</b>', 'Transação, empresa, operação e data.', '<kbd>Tentar de novo</kbd> quando está pendente (pode trocar terminal ou operação).'],
          ['<b>Pagamento</b>', 'Formas, parcelas, NSU, vencimentos do boleto e comprovantes.', '—'],
          ['<b>Duplicata</b>', 'Só em venda com boleto. Situação da assinatura.', 'Ver o documento, enviar, conferir assinatura, reenviar.'],
          ['<b>Minuta</b>', 'Etiqueta dos Correios ou AWB da LATAM / Azul.', 'Pedir a minuta e imprimir a etiqueta.'],
          ['<b>Transporte e emissão</b>', 'Transportadora, frete, volumes, quem emitiu e quando.', '—'],
          ['<b>Peças da nota</b>', 'Cada peça com SKU, CFOP, valor e as etiquetas RFID lidas.', '—'],
        ],
        ['20%', '45%', '35%'],
      )}`,
    )}
    ${sub(
      'Duplicata (venda com boleto)',
      itens([
        'Sai <b>sozinha</b> logo depois do faturamento: o cliente recebe no WhatsApp o link para assinar.',
        'Situações: <b>sendo enviada</b> → <b>enviada · aguardando assinatura</b> → <b>assinada</b>.',
        'O sistema confere a assinatura a cada 10 minutos. <kbd class="c">Conferir assinatura</kbd> confere na hora.',
        '<kbd>Enviar duplicata</kbd> aparece quando o envio falhou. <kbd class="c">Reenviar</kbd> gera um documento novo e manda outra mensagem.',
        '<kbd class="c">Ver o documento</kbd> abre o PDF da duplicata.',
      ]) + atencao('<p>Venda com boleto só tem a <b>minuta liberada depois que o cliente assinar a duplicata</b>.</p>'),
    )}
    ${sub(
      'Minuta (etiqueta e AWB)',
      passos([
        'Abra o faturamento na aba Transações e vá ao cartão <b>Minuta</b>.',
        'Escolha <kbd class="c">Correios PAC</kbd>, <kbd class="c">Correios SEDEX</kbd> ou <kbd class="c">Azul</kbd>. Para a <b>LATAM</b>, preencha antes altura, largura e comprimento da caixa (cm) e clique em <kbd class="c">LATAM</kbd>.',
        'Aguarde: o robô emite em <b>até 10 minutos</b>. O cartão mostra “minuta … na fila”.',
        'Quando sair, aparecem o código de rastreio ou o AWB e o botão <kbd>Etiqueta dos Correios</kbd> ou <kbd>Minuta da Azul (PDF)</kbd> para imprimir.',
      ]) +
        itens(['BEE, Baraúnas e taxistas <b>não têm minuta</b>.', 'Se aparecer “minuta parada”, o motivo vem escrito em vermelho. Corrija (endereço, dimensões) e peça de novo.']),
    )}
    ${sub(
      'Pedido FATURADO não fatura de novo',
      `<p>Nota emitida = pedido <b>FATURADO</b>. Na lista de pedidos ele aparece com o selo “FATURADO · NF …” e sem o botão de faturar; se for aberto, mostra o aviso vermelho abaixo.</p>
      ${fig('fat-11-bloqueio', 'Pedido já faturado: aviso vermelho e botão FATURAR travado.', 92)}
      <p>Para faturar o mesmo pedido outra vez é preciso fazer <b>as duas coisas</b>:</p>
      ${passos([
        'Na aba Transações, abrir o faturamento e clicar em <kbd class="r">Cancelar NF-e</kbd>, com a justificativa (mínimo de 15 letras). <b>Não tem volta.</b>',
        '<b>Cancelar a transação no TOTVS</b> (empresa e número aparecem no cartão TOTVS). O HeadCoach não cancela a transação por conta própria.',
      ])}
      ${atencao('<p>O cancelamento da NF-e tem prazo curto na SEFAZ (em geral 24 horas). Percebeu o erro, cancele no mesmo dia.</p>')}`,
    )}`,
  );

const blocoProblemas = (extra = []) =>
  sec(
    'Problemas comuns',
    tabela(
      ['O que aconteceu', 'Causa mais provável', 'O que fazer'],
      [
        ['Venda ficou “TOTVS pendente”', 'Caixa do terminal 1 da empresa 990 fechado ou com data de outro dia.', 'Abrir o caixa com a data de hoje e clicar em <b>Tentar de novo</b> na aba Transações.'],
        ['“Escolha a operadora e o parcelamento do cartão”', 'Cartão sem a linha do cadastro do TOTVS escolhida.', 'Selecionar operadora e parcelamento na forma de pagamento.'],
        ['“Pagamento não fecha com o total da nota”', 'Soma das formas diferente do total.', 'Ajustar os valores. A primeira forma é automática.'],
        ['“Cliente sem endereço completo no TOTVS”', 'Cadastro do cliente incompleto.', 'Completar o endereço no cadastro do cliente no TOTVS e reabrir o pedido.'],
        ['Aviso de DIFAL não conferido', 'Venda para fora do RN a consumidor final de um estado ainda não conferido.', 'Chamar o fiscal antes de faturar.'],
        ['Peça aparece como “a mais” ou fora do pedido', 'O portal leu peça de outro pedido.', 'Tirar com <b>tirar 1</b> e afastar a peça do portal.'],
        ['Etiqueta não reconhecida', 'Etiqueta sem cadastro no TOTVS.', 'Digitar o SKU ou o código de barras.'],
        ['Botão FATURAR apagado na lista (“em separação”)', 'A separação ainda não foi finalizada no Dryland.', 'Finalizar a separação no Dryland e atualizar a lista.'],
        ['Duplicata “não enviada”', 'Falha no envio pelo WhatsApp ou na geração do documento.', 'Abrir a venda em Transações e clicar em <b>Enviar duplicata</b>.'],
        ['Minuta não aparece', 'Robô ainda na fila, ou duplicata sem assinatura (boleto).', 'Aguardar até 10 minutos; conferir a assinatura da duplicata.'],
        ['Precisei parar no meio', '—', 'Usar <b>Salvar para continuar depois</b>; o pedido fica em <b>Em andamento</b>.'],
        ...extra,
      ],
      ['27%', '33%', '40%'],
    ) + '<p class="mini">Dúvida que não está aqui: abrir chamado para a Tecnologia pelo Dryland ou falar com o Yago.</p>',
  );

// ════════════════════════════════════════════════════════════════════════════
// POP 01 — Pedido de Venda e Faturamento
// ════════════════════════════════════════════════════════════════════════════
function pop01() {
  nFig = 0;
  nSec = 0;
  const corpo = [
    `<div class="resumo"><p><b>Objetivo:</b> faturar os pedidos de venda da expedição (varejo, revenda, multimarcas e franquias) pelo HeadCoach, do pedido separado até a nota impressa, a minuta e a duplicata.</p>
    <p><b>Onde fica:</b> menu <span class="tela">Expedição → Pedido de Venda</span> e <span class="tela">Expedição → Faturamento</span>.</p>
    <p><b>Resultado esperado:</b> NF-e autorizada (empresa 99), venda recebida no TOTVS (empresa 990) e pedido marcado como FATURADO.</p></div>`,
    sec(
      'Visão geral do processo',
      tabela(
        ['Etapa', 'Onde', 'Quem faz'],
        [
          ['1. Cliente compra e paga', 'Site / vendedor', 'Comercial'],
          ['2. Pedido é separado', 'Dryland (tela Separar)', 'Separação'],
          ['3. Pedido aparece como “a faturar”', 'HeadCoach → Pedido de Venda', 'Automático (a cada 5 minutos)'],
          ['4. Conferência no portal e faturamento', 'HeadCoach → Faturamento', 'Expedição'],
          ['5. NF-e + venda no TOTVS', 'Automático', 'HeadCoach'],
          ['6. Duplicata (boleto) e minuta', 'HeadCoach → Transações', 'Automático / Expedição'],
          ['7. Despacho', 'Expedição', 'Expedição'],
        ],
        ['36%', '36%', '28%'],
      ),
    ),
    blocoCaixa(),
    sec(
      'Página Pedido de Venda: ver os pedidos',
      `<p>Mostra todas as vendas da fila de faturamento do Dryland, de todos os canais, com pagamento, comprovantes, nota e a situação da separação.</p>
      ${fig('pv-1-lista', 'Pedido de Venda em lista: quadros de totais, filtros e a tabela de pedidos.')}
      ${itens([
        '<b>Quadros do topo:</b> vendas, valor, a faturar, faturadas, aguardando separação, em separação, separados e com comprovante.',
        '<b>Filtros:</b> busca (pedido, cliente, vendedor, nota, NSU), canal, situação do faturamento, situação da separação e período.',
        '<b>Coluna Separação:</b> “Aguardando separação”, “Em separação” (com a barra de progresso) ou “Separado”.',
        '<b>Coluna Faturamento:</b> a situação do pedido na fila do Dryland (a faturar, aguardando minuta, pedido faturado, pedido enviado…).',
        '<kbd>Atualizar do Dryland</kbd> busca na hora. Sem clicar, a cópia é feita sozinha a cada 5 minutos.',
      ])}
      ${sub(
        'Ver o pedido completo',
        `<p>Clique em <kbd>Detalhar</kbd> na linha do pedido.</p>
        ${fig('pv-2-detalhe', 'Detalhe do pedido: cliente, venda, pagamento, comprovante e peças da separação.', 78)}
        ${itens(['<b>Cliente:</b> nome, código, CPF/CNPJ, telefone e entrega.', '<b>Venda:</b> pedido do site, vendedor, loja, pedido e transação no TOTVS, data da separação.', '<b>Pagamento:</b> forma, valor, descontos, NSU ou identificador do Pix.', '<b>Comprovante</b> de pagamento anexado e as <b>peças</b> da separação, com o que já foi separado.'])}`,
      )}
      ${sub(
        'Outras visões',
        `${fig('pv-3-kanban', 'Visão Kanban: os pedidos em colunas pela situação da separação.', 80)}
        ${fig('pv-4-painel', 'Visão Painel: resumo da expedição (o que falta separar, faturar, minutar e enviar).', 80)}`,
      )}`,
    ),
    sec(
      'Quais pedidos podem ser faturados',
      `${tabela(
        ['Condição', 'Como conferir'],
        [
          ['Situação <b>“a faturar”</b> na fila do Dryland', 'Coluna Faturamento da página Pedido de Venda.'],
          ['<b>Separação finalizada</b> (“Separado”)', 'Coluna Separação. O botão FATURAR só fica ativo nesse caso.'],
          ['<b>Ainda não faturado</b>', 'Pedido faturado mostra “FATURADO · NF …” e não tem o botão.'],
          ['É <b>venda</b>, não transferência', 'Transferência entre lojas não aparece aqui: vai para Transferências de Mercadoria (POP 03).'],
        ],
        ['45%', '55%'],
      )}
      <p>Para mandar faturar, clique em <kbd class="v">FATURAR</kbd> na linha do pedido (ou dentro do Detalhar). O HeadCoach abre a tela de Faturamento já com o pedido.</p>
      ${atencao('<p>As peças que valem são as da <b>separação do Dryland</b> (tela Separar · Loja Virtual Max). Se o card do Painel estiver diferente da separação, a tela avisa e usa a separação.</p>')}`,
    ),
    sec(
      'Página Faturamento: passo a passo',
      `${sub(
        'Escolher o pedido',
        `<p>Em <span class="tela">Expedição → Faturamento</span> aparece a lista “Pedidos a faturar”. Os botões no topo filtram por tipo (Multimarcas, Revendedor, Franquia, Varejo) e mostram quantos pedidos e peças há em cada um.</p>
        ${fig('fat-1-lista', 'Lista de pedidos a faturar. Pedido já faturado fica no fim, com o selo FATURADO.', 84)}
        ${itens(['<kbd class="v">FATURAR</kbd> abre o pedido.', 'Botão apagado: a separação ainda não terminou no Dryland.', '<kbd class="c">Em andamento</kbd> lista os faturamentos salvos para continuar depois.'])}`,
      )}
      ${sub(
        'Conferir cliente, vendedor e fiscal',
        `${fig('fat-2-pedido-topo', 'Pedido aberto: cliente, vendedor e cenário fiscal à esquerda; portal à direita.')}
        ${itens([
          '<b>Empresa</b> é sempre a 99. <b>Cliente</b> e <b>vendedor</b> vêm do pedido; confira.',
          'A faixa abaixo mostra CPF/CNPJ, inscrição estadual, cidade e o <b>cenário fiscal</b> calculado: dentro do RN (CFOP 5101/5102), fora do RN com IE (6101/6102) ou fora do RN para consumidor final (6107/6108 + DIFAL).',
          'Se o pedido já tem transação aberta pelo Dryland no TOTVS, aparece um aviso amarelo: confira e marque “Conferi e quero faturar mesmo assim”.',
        ])}`,
      )}
      ${blocoConferencia('fat-3-conferencia', 'fat-4-portal')}
      ${blocoTransportePagamento('fat-5-transporte', 'fat-6-pagamento', 'fat-7-totvs')}
      ${fig('fat-9-pagina', 'A tela completa de um pedido em conferência (2 de 3 peças lidas).', 94)}
      ${blocoFaturar('fat-10-confirmar')}
      ${dica('<p>Precisa parar no meio (faltou peça, o cliente vai confirmar algo)? Clique em <kbd class="c">Em andamento</kbd> → <kbd class="c">Salvar para continuar depois</kbd>. As leituras, o pagamento e o transporte ficam guardados e o pedido volta do ponto em que parou.</p>')}`,
    ),
    blocoFalta('fat-8-resumo-credito'),
    blocoTransacoes(),
    blocoProblemas(),
    sec(
      'Resumo de bolso',
      passos([
        'Caixa do terminal 1 da empresa 990 <b>aberto com a data de hoje</b>.',
        'Pedido de Venda → pedido “a faturar” e “Separado” → <kbd class="v">FATURAR</kbd>.',
        'Conferir cliente e vendedor → <kbd class="v">LIGAR PORTAL</kbd> → passar as peças.',
        'Conferir transporte e pagamento.',
        '<kbd class="v">FATURAR</kbd> → conferir → <kbd class="v">Emitir NF-e e gravar no TOTVS</kbd>.',
        'Imprimir o DANFE. Em Transações: pedir a minuta e acompanhar a duplicata.',
        'Fim do dia: <b>fechar o caixa</b> no TOTVS.',
      ]),
    ),
  ].join('\n');
  return pagina({
    codigo: 'POP 01 · Expedição',
    titulo: 'Pedido de Venda e Faturamento',
    subtitulo: 'Do pedido separado à nota fiscal emitida, com minuta, duplicata e acompanhamento das transações',
    publico: 'Expedição e faturamento',
    corpo,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// POP 02 — Expedição Brejinho
// ════════════════════════════════════════════════════════════════════════════
function pop02() {
  nFig = 0;
  nSec = 0;
  const corpo = [
    `<div class="resumo"><p><b>Objetivo:</b> acompanhar e faturar os pedidos das franquias (remessas dos pedidos do showroom) que saem da expedição do Brejinho.</p>
    <p><b>Onde fica:</b> menu <span class="tela">Expedição → Expedição Brejinho → Pedidos</span> e <span class="tela">→ Faturamento</span>.</p>
    <p><b>Resultado esperado:</b> NF-e autorizada (empresa 99), venda recebida no TOTVS (empresa 990), duplicata enviada quando há boleto e minuta emitida.</p></div>`,
    sec(
      'Visão geral do processo',
      tabela(
        ['Situação do pedido', 'O que significa', 'Onde muda'],
        [
          ['<b>Aguardando cliente</b>', 'A franquia ainda vai confirmar a remessa.', 'Dryland'],
          ['<b>Em separação</b>', 'As peças estão sendo separadas.', 'Dryland'],
          ['<b>Aguardando pagamento</b>', 'Separado e pronto: <b>é aqui que se fatura</b>.', 'Dryland → faturar no HeadCoach'],
          ['<b>Pendência financeira</b>', 'Travado pelo financeiro. Não faturar.', 'Dryland'],
          ['<b>Faturado</b>', 'Nota emitida.', 'Automático'],
          ['<b>Cancelado</b>', 'Remessa cancelada.', 'Dryland'],
        ],
        ['28%', '44%', '28%'],
      ) + atencao('<p>A página de Pedidos é <b>só de leitura</b>: mudar a situação de um pedido ou os dados dele continua sendo feito no Dryland. No HeadCoach se acompanha e se fatura.</p>'),
    ),
    blocoCaixa(),
    sec(
      'Página Pedidos: acompanhar as remessas',
      `${fig('brj-1-kanban', 'Pedidos do Brejinho em Kanban: uma coluna por situação, com quantidade e valor.')}
      ${itens([
        '<b>Quadros do topo:</b> em aberto, aguardando cliente, em separação, aguardando pagamento, pendência financeira, faturado e cancelado. Clicar num quadro filtra por ele.',
        '<b>Filtros:</b> busca (pedido, franquia, transação, nota), UF, showroom e período. “ver arquivados” inclui os antigos.',
        '<kbd>Kanban</kbd> e <kbd class="c">Lista</kbd> trocam a visão. <kbd>Atualizar do Dryland</kbd> busca na hora.',
        '<kbd class="c">Abrir no Dryland</kbd> leva para a tela de lá, onde se muda a situação.',
        'Cada card é uma <b>remessa</b> de um pedido do showroom: número do pedido, franquia, data, UF, showroom, peças e valor.',
      ])}
      ${fig('brj-3-lista', 'A mesma página em Lista.', 88)}
      ${sub(
        'Ver o pedido completo',
        `<p>Clique em <kbd>Detalhar</kbd> no card.</p>
        ${fig('brj-2-detalhe', 'Detalhe da remessa: pedido, pagamento, expedição, peças e histórico no Dryland.', 82)}
        ${itens(['<b>Pedido:</b> número do pedido de venda no TOTVS, showroom, valor e quantidade de peças.', '<b>Pagamento</b> e <b>expedição:</b> condição, transação do TOTVS, transportadora e datas.', '<b>Peças da remessa:</b> vêm da transação do TOTVS do card.', '<b>Histórico:</b> cada mudança de situação feita no Dryland.'])}`,
      )}`,
    ),
    sec(
      'Quais pedidos podem ser faturados',
      `${tabela(
        ['Condição', 'Como conferir'],
        [
          ['Situação <b>“Aguardando pagamento”</b>', 'Só os cards dessa coluna têm o botão <b>FATURAR</b>.'],
          ['<b>Ainda não faturado</b>', 'Pedido faturado mostra “FATURADO · NF …” e não deixa faturar de novo.'],
          ['Sem <b>pendência financeira</b>', 'Pedido nessa coluna não tem botão: aguardar o financeiro liberar no Dryland.'],
        ],
        ['45%', '55%'],
      )}
      <p>Para mandar faturar, clique em <kbd class="v">FATURAR</kbd> no card (ou escolha o pedido direto na página Faturamento).</p>`,
    ),
    sec(
      'Página Faturamento — Brejinho: passo a passo',
      `${sub(
        'Escolher o pedido',
        `${fig('fatbrj-1-lista', 'Pedidos do Brejinho aguardando pagamento, prontos para faturar.', 70)}
        <p>Clique em <kbd class="v">FATURAR</kbd> na linha. Confira <b>cliente</b> (a franquia), <b>vendedor</b> e o <b>cenário fiscal</b> que a tela calcula pelo estado da franquia.</p>`,
      )}
      ${blocoConferencia('fatbrj-2-conferencia', 'fat-4-portal')}
      ${sub(
        'Desconto no faturamento',
        lado(
          fig('fatbrj-3-desconto-10', 'Desconto de 10% aplicado: aparece nos totais e vai na NF-e.'),
          `${passos([
            'No cartão <b>Descontos do pedido</b>, digite o percentual de desconto.',
            'O desconto é aplicado em todas as peças e aparece no quadro de totais (“% dado neste faturamento”).',
            '<b>Até 20%:</b> liberado para quem tem acesso à tela.',
            '<b>Acima de 20%:</b> precisa da senha de um <b>owner, admin ou financeiro</b>. A tela pede o e-mail e a senha do HeadCoach de quem autoriza.',
          ])}
          ${fig('fatbrj-5-senha', 'Autorização de desconto acima de 20%.', 100)}
          <p>O desconto e quem liberou ficam registrados na venda e na observação da transação do TOTVS.</p>`,
        ),
      )}
      ${blocoTransportePagamento('fat-5-transporte', 'fatbrj-6-pagamento', 'fat-7-totvs', true)}
      ${fig('fatbrj-7-pagina', 'A tela completa de um pedido do Brejinho em conferência, com desconto.', 94)}
      ${blocoFaturar('fat-10-confirmar')}
      ${dica('<p>Precisa parar no meio? <kbd class="c">Em andamento</kbd> → <kbd class="c">Salvar para continuar depois</kbd>. O pedido volta do ponto em que parou, com as leituras, o desconto e o pagamento.</p>')}`,
    ),
    blocoFalta('fat-8-resumo-credito'),
    blocoTransacoes(),
    blocoProblemas([['“Desconto passa de 20%: precisa da senha…”', 'Desconto acima do limite livre.', 'Pedir a um owner, admin ou financeiro para digitar e-mail e senha na janela de autorização.']]),
    sec(
      'Resumo de bolso',
      passos([
        'Caixa do terminal 1 da empresa 990 <b>aberto com a data de hoje</b>.',
        'Expedição Brejinho → Pedidos → coluna <b>Aguardando pagamento</b> → <kbd class="v">FATURAR</kbd>.',
        'Conferir a franquia e o vendedor → <kbd class="v">LIGAR PORTAL</kbd> → passar as peças.',
        'Desconto (se houver), transporte e pagamento.',
        '<kbd class="v">FATURAR</kbd> → conferir → <kbd class="v">Emitir NF-e e gravar no TOTVS</kbd>.',
        'Imprimir o DANFE. Em Transações: acompanhar a duplicata e pedir a minuta.',
        'Fim do dia: <b>fechar o caixa</b> no TOTVS.',
      ]),
    ),
  ].join('\n');
  return pagina({
    codigo: 'POP 02 · Expedição',
    titulo: 'Expedição Brejinho: Pedidos e Faturamento',
    subtitulo: 'Acompanhar as remessas das franquias e faturar com nota fiscal, desconto, duplicata e minuta',
    publico: 'Expedição Brejinho',
    corpo,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// POP 03 — Transferências de Mercadoria
// ════════════════════════════════════════════════════════════════════════════
function pop03() {
  nFig = 0;
  nSec = 0;
  const corpo = [
    `<div class="resumo"><p><b>Objetivo:</b> transferir mercadoria entre as empresas do grupo pelo HeadCoach, com leitura no portal RFID e a operação certa do TOTVS, sem digitar item por item.</p>
    <p><b>Onde fica:</b> menu <span class="tela">Expedição → Transferências</span> (também em Solicitações Crosby → Transferências de Mercadoria).</p>
    <p><b>Resultado esperado:</b> transação de transferência gerada no TOTVS com as peças lidas e finalizada no caixa (TRAFP005).</p></div>`,
    sec(
      'Visão geral do processo',
      `${tabela(
        ['Etapa', 'Onde', 'Situação da solicitação'],
        [
          ['1. Nasce a solicitação', 'Automática (pedido de transferência do Dryland) ou avulsa', '<b>Pronta p/ Transferência RFID</b>'],
          ['2. Leitura das peças e geração da transação', 'HeadCoach → aba Transferência RFID', '<b>No caixa (TRAFP005)</b>'],
          ['3. Finalizar a transação', 'TOTVS → TRAFP005', '<b>Concluída</b>'],
          ['4. Acompanhar a mercadoria', 'HeadCoach → coluna Local', 'Origem → Em trânsito → Destino'],
        ],
        ['34%', '38%', '28%'],
      )}
      <p>A página tem três abas: <kbd>Solicitações</kbd>, <kbd>Transferência RFID</kbd> e <kbd>Transações</kbd>.</p>`,
    ),
    sec(
      'Regra da operação (POP de transferências entre empresas)',
      `<p>A operação do TOTVS <b>não é escolhida pelo operador</b>: o HeadCoach define pela empresa de origem e de destino e trava. O que a regra não prevê, a tela não deixa gerar.</p>
      ${tabela(
        ['Operação', 'Nome no TOTVS', 'Quando é usada'],
        [
          ['<b>7272</b>', 'TRANSFERÊNCIA CR X CR', 'Origem e destino do <b>mesmo grupo</b> (mesma raiz de CNPJ).'],
          ['<b>7273</b>', 'VENDA FABIO X CR', 'Do grupo <b>Crosby</b> para o grupo <b>Fábio</b>.'],
          ['<b>7280</b>', 'VENDA CR X IRMÃOS', 'Quando a origem ou o destino é dos <b>Irmãos</b> (Irmãos CR / Irmãos Varejo).'],
        ],
        ['14%', '32%', '54%'],
      )}
      ${itens([
        'O <b>cliente</b> da transação é a própria filial de destino (a pessoa da empresa no TOTVS).',
        'O <b>CFOP</b> sai sozinho: transferência 5152 (mesmo estado) ou 6152 (outro estado); venda entre grupos 5102 ou 6102.',
        'Combinação fora da regra aparece desabilitada, com o aviso para validar com o setor responsável.',
      ])}`,
    ),
    sec(
      'Aba Solicitações',
      `${fig('transf-1-solicitacoes', 'Solicitações de transferência. As marcadas DRYLAND são os pedidos de transferência entre lojas da expedição.')}
      ${itens([
        '<b>Quadros do topo:</b> prontas para RFID, no caixa, concluídas, canceladas e total de peças.',
        '<b>Filtros:</b> situação (Abertas, Todas…) e busca por empresa, solicitante, número ou referência (TR…, TRU…).',
        '<kbd>Atualizar</kbd> relê na hora os pedidos de transferência do Dryland.',
        '<kbd class="c">Transferência avulsa</kbd> abre a leitura sem solicitação (para transferir algo que não veio de pedido).',
      ])}
      ${sub(
        'Solicitações que vêm do Dryland',
        `<p>Os pedidos de <b>transferência entre lojas</b> que a expedição recebe pelo Dryland (os <b>TR</b> e os unificados <b>TRU-LOJA-BJ / TRU-LOJA-MAX</b>) não aparecem mais no Faturamento: entram aqui sozinhos, como solicitação, com o selo <b>DRYLAND</b>.</p>
        ${itens([
          '<b>Origem:</b> empresa 99 (expedição). O estoque de saída (Brejinho ou MAX/CREDEV) vem escrito na observação.',
          '<b>Destino:</b> a loja do pedido. Se aparecer <b>“a definir”</b> em laranja, a loja não está na regra do POP: confira o destino antes de gerar.',
          'Um TR que já entrou num pedido unificado (TRU) não aparece sozinho, para não transferir duas vezes.',
          'Se o pedido sair da fila do Dryland antes de ser começado aqui, a solicitação é cancelada sozinha, com o motivo.',
        ])}`,
      )}
      ${sub(
        'Ver as peças da solicitação',
        `<p>Clique em <kbd class="c">abrir</kbd> na linha.</p>
        ${fig('transf-2-detalhe', 'Detalhe da solicitação: operação, peças, observação do pedido e a lista de peças.', 80)}
        ${itens(['Mostra a operação, a quantidade e o valor, a observação do pedido e a <b>lista de peças</b> (referência, cor, tamanho, quantidade e de qual pedido veio).', '<b>Observação interna:</b> anotação da equipe, salva ao sair do campo.', '<kbd>Fazer a transferência RFID</kbd> leva direto para a leitura.'])}`,
      )}
      ${sub(
        'Onde está a mercadoria (coluna Local)',
        `<p>O selo da coluna <b>Local</b> alterna entre <b>ORIGEM → EM TRÂNSITO → DESTINO</b> a cada clique. Só altera quem é owner, admin, financeiro ou do setor DP; os demais apenas veem.</p>`,
      )}
      ${sub('Cancelar uma solicitação', `<p>Use o ícone de proibido na linha (ou <kbd class="r">Cancelar</kbd> dentro do detalhe) e informe o motivo. A solicitação cancelada pode ser reaberta pelo detalhe.</p>`)}`,
    ),
    sec(
      'Aba Transferência RFID: gerar a transferência',
      `${fig('transf-3-rfid', 'Transferência RFID aberta a partir de uma solicitação: origem e destino já preenchidos.')}
      ${passos([
        'Na aba Solicitações, clique em <kbd>RFID</kbd> na linha. A leitura abre com a <b>empresa de origem</b> e a <b>empresa de destino</b> já preenchidas, e a faixa azul mostra a solicitação e as peças do pedido.',
        'Confira a <b>operação</b> que a tela definiu (7272, 7273 ou 7280) e escolha o <b>vendedor</b>.',
        'Clique em <kbd class="v">LIGAR PORTAL</kbd> e passe as peças. Cada etiqueta é uma peça. Peça sem etiqueta: digite o código.',
        'Confira a lista lida contra as peças do pedido (em “Ver as peças do pedido”).',
        'Clique em <kbd class="v">GERAR TRANSFERÊNCIA</kbd>. O HeadCoach confere a regra de novo e cria a transação no TOTVS, <b>em andamento</b>.',
        'A solicitação passa para <b>No caixa (TRAFP005)</b>, com o número da transação.',
      ])}
      ${sub(
        'Finalizar no TOTVS',
        passos([
          'No TOTVS, abra o <b>TRAFP005</b>.',
          'Use <b>Continuar Transação</b> e informe o número gerado pelo HeadCoach.',
          '<b>Encerrar</b> e <b>Receber</b> a transação no caixa.',
          'De volta ao HeadCoach, a transação muda para <b>ATENDIDA</b> e a solicitação para <b>Concluída</b> (a tela consulta o TOTVS sozinha; se não mudar, consulte pela aba Transações).',
        ]),
      )}
      ${atencao(
        itens([
          'A transferência <b>só existe no estoque depois de finalizada no TRAFP005</b>. Transação “em andamento” ainda não moveu nada.',
          'O preço das peças segue a tabela do cliente (a filial de destino); sem tabela, a de atacado.',
          'Uma leitura em andamento fica salva por usuário: dá para sair e continuar depois.',
        ]),
      )}
      ${dica('<p><kbd class="c">Desvincular TRF-…</kbd>, no topo, solta a leitura da solicitação e vira transferência avulsa.</p>')}`,
    ),
    sec(
      'Aba Transações: acompanhar',
      `${fig('transf-4-transacoes', 'Transações de transferência geradas no período, com a situação no TOTVS.', 72)}
      ${itens([
        '<b>Quadros:</b> transações, em andamento (aguardando o caixa), atendidas, canceladas, peças e total transferido.',
        '<b>Filtros:</b> período e busca por empresa, número da transação ou cliente.',
        'Clique numa transação para ver as peças e as etiquetas e para <b>consultar a situação no TOTVS</b> na hora.',
      ])}
      ${tabela(
        ['Situação no TOTVS', 'Significado'],
        [
          ['<b>Em andamento</b>', 'Gerada pelo HeadCoach, esperando o caixa finalizar no TRAFP005.'],
          ['<b>ATENDIDA</b>', 'Finalizada: o estoque foi transferido.'],
          ['<b>CANCELADA</b>', 'Cancelada no TOTVS.'],
        ],
        ['30%', '70%'],
      )}`,
    ),
    sec(
      'Problemas comuns',
      tabela(
        ['O que aconteceu', 'Causa mais provável', 'O que fazer'],
        [
          ['Destino aparece “a definir”', 'A loja do pedido não está entre as filiais da regra do POP.', 'Confirmar com o responsável qual empresa é o destino antes de gerar.'],
          ['Destino desabilitado / “o POP não prevê…”', 'A combinação origem × destino não está na regra.', 'Não prosseguir: validar com o setor responsável.'],
          ['Solicitação não muda para Concluída', 'A transação ainda não foi finalizada no TRAFP005.', 'Finalizar no TOTVS e consultar a situação na aba Transações.'],
          ['Peça lida a mais', 'O portal leu peça que não é da transferência.', 'Tirar a peça da lista e afastá-la do portal.'],
          ['Pedido do Dryland não apareceu', 'A cópia ainda não rodou.', 'Clicar em <b>Atualizar</b> na aba Solicitações.'],
          ['Solicitação cancelada sozinha', 'O pedido saiu da fila “a faturar” do Dryland (faturado por lá, cancelado ou unificado).', 'Conferir o motivo no detalhe; reabrir se for o caso.'],
        ],
        ['27%', '36%', '37%'],
      ) + '<p class="mini">Dúvida que não está aqui: abrir chamado para a Tecnologia pelo Dryland ou falar com o Yago.</p>',
    ),
    sec(
      'Resumo de bolso',
      passos([
        'Expedição → Transferências → aba <b>Solicitações</b>.',
        '<kbd class="c">abrir</kbd> para ver as peças → <kbd>RFID</kbd> para começar.',
        'Conferir origem, destino e operação → <kbd class="v">LIGAR PORTAL</kbd> → passar as peças.',
        '<kbd class="v">GERAR TRANSFERÊNCIA</kbd>.',
        'TOTVS → <b>TRAFP005</b> → Continuar Transação → Encerrar → Receber.',
        'Conferir a solicitação como <b>Concluída</b> e atualizar o <b>Local</b> da mercadoria.',
      ]),
    ),
  ].join('\n');
  return pagina({
    codigo: 'POP 03 · Expedição',
    titulo: 'Transferências de Mercadoria',
    subtitulo: 'Solicitações, leitura no portal RFID e transação de transferência entre empresas no TOTVS',
    publico: 'Expedição e lojas',
    corpo,
  });
}

// ─── gera ────────────────────────────────────────────────────────────────────
const docs = [
  ['POP-01-Pedido-de-Venda-e-Faturamento', pop01],
  ['POP-02-Expedicao-Brejinho', pop02],
  ['POP-03-Transferencias-de-Mercadoria', pop03],
];
const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox', '--allow-file-access-from-files'] });
for (const [nome, fn] of docs) {
  const html = fn();
  const tmp = `${PRINTS}/_${nome}.html`;
  fs.writeFileSync(tmp, html, 'utf8');
  const page = await browser.newPage();
  await page.goto(`file:///${tmp}`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  await page.pdf({
    path: `${SAIDA}/${nome}.pdf`,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-family:Segoe UI,Arial;font-size:7.5pt;color:#6b7386;padding:0 14mm;display:flex;justify-content:space-between"><span>${nome.replace(/-/g, ' ')} · HeadCoach Crosby · uso interno</span><span>página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
    margin: { top: '15mm', bottom: '16mm', left: '14mm', right: '14mm' },
  });
  await page.close();
  console.log(`ok ${nome}.pdf ${(fs.statSync(`${SAIDA}/${nome}.pdf`).size / 1024 / 1024).toFixed(2)} MB`);
}
await browser.close();
