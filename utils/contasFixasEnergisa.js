// Leitura pura (sem rede) da conversa com a Energisa (Gisa) no WhatsApp.
// A conversa da Energisa é toda por texto: menus, botões e listas aceitam a
// resposta digitada. Não há formulário para clicar.

/**
 * Contas da Energisa escritas na observação da Controle de Filiais: uma por
 * linha, "SALA 101: 5/1780082-2". O código do cliente é "região/número-dígito";
 * barra dobrada por engano ("5//1780077-2") é aceita.
 * @returns [{ rotulo: 'SALA 101'|null, codigo: '5/1780082-2' }]
 */
export function lerContasEnergisaDaObservacao(obs) {
  const contas = [];
  for (const m of String(obs ?? '').matchAll(/(?:(SALA\s*\d+)\s*:?\s*)?(?<![\d/])(\d{1,2})\/{1,2}(\d{5,8})-(\d)(?!\d)/gi)) {
    const codigo = `${m[2]}/${m[3]}-${m[4]}`;
    if (!contas.some((c) => c.codigo === codigo)) contas.push({ rotulo: m[1] ? m[1].toUpperCase().replace(/\s+/g, ' ') : null, codigo });
  }
  return contas;
}

/** Texto de uma mensagem, esteja ele solto, num botão, numa lista ou no cartão do Pix. */
export const textoDaMensagem = (m) => String(m?.texto || m?.conteudo?.contentText || m?.conteudo?.description || m?.conteudo?.InteractiveMessage?.body?.text || '');
const linhasDaLista = (m) => (m?.conteudo?.sections || []).flatMap((s) => s.rows || []).map((l) => String(l.title || '').trim());

/**
 * Em que ponto a conversa com a Energisa está, pela última mensagem recebida.
 * @param ultima { texto, tipo, conteudo } (buscarMensagens com comConteudo)
 */
export function passoDaEnergisa(ultima) {
  if (!ultima) return 'aguardando';
  const texto = textoDaMensagem(ultima);
  const lista = linhasDaLista(ultima);
  if (lista.some((l) => /c[oó]digo pix|baixar arquivo da fatura/i.test(l))) return 'opcoes';
  if (lista.some((l) => /faturas e pagamentos/i.test(l))) return 'menu';
  if (/qual tipo de segunda via/i.test(texto)) return 'tipo_via';
  if (/como voc[eê] deseja identificar o im[oó]vel/i.test(texto)) return 'identificar';
  if (/informe o \*?n[uú]mero da UC\*? ou o \*?c[oó]digo do cliente/i.test(texto)) return 'pedir_codigo';
  if (/gostaria de falar sobre esse im[oó]vel/i.test(texto)) return 'confirmar_imovel';
  if (/como voc[eê] quer pagar a sua fatura/i.test(texto)) return 'como_pagar';
  if (/pr[oó]ximas faturas\*? apenas com o QR Code/i.test(texto)) return 'so_qr_pix';
  if (/o que voc[eê] gostaria de fazer agora/i.test(texto)) return 'o_que_fazer';
  if (/posso te ajudar em algo mais/i.test(texto)) return 'algo_mais';
  // propaganda antes do menu para quem volta a falar ("Seja um cliente Pix! … Deseja se cadastrar?")
  if (/deseja se cadastrar/i.test(texto)) return 'oferta_cadastro';
  if (/escala de 0 a 10/i.test(texto)) return 'nota';
  // fim do atendimento (também é o que ela responde quando um "Oi" cai na pesquisa de nota de uma conversa antiga)
  if (/obrigad[ao] pelo contato|estarei aqui sempre que voc[eê] precisar/i.test(texto)) return 'despedida';
  if (/n[aã]o (encontrei|localizei|consegui (encontrar|localizar))|(c[oó]digo|n[uú]mero) (inv[aá]lido|incorreto)/i.test(texto)) return 'dados_recusados';
  if (/n[aã]o (h[aá]|tem|possui)[^.]{0,40}(fatura|conta|d[eé]bito)s?[^.]{0,20}abert|est[aá] em dia|nenhuma fatura/i.test(texto)) return 'sem_fatura';
  if (/n[aã]o entendi|escolha uma das op[çc][oõ]es/i.test(texto)) return 'nao_entendi';
  return 'aguardando';
}

/** "29.65", "29,65", "1.234,56" ou "1234.56" → número. */
export function valorDaEnergisa(s) {
  const v = String(s ?? '').trim();
  if (!/^\d[\d.,]*$/.test(v)) return null;
  const n = v.includes(',') ? Number(v.replace(/\./g, '').replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : null;
}

const MESES = { janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };

/** Código Pix copia e cola que vem dentro do botão "Copiar código Pix". */
export function pixDoBotao(conteudo) {
  for (const b of conteudo?.InteractiveMessage?.NativeFlowMessage?.buttons || []) {
    let p = b.buttonParamsJSON;
    if (typeof p === 'string') {
      try {
        p = JSON.parse(p);
      } catch {
        p = null;
      }
    }
    for (const s of p?.payment_settings || []) {
      const codigo = s?.pix_dynamic_code?.code || s?.pix_static_code?.code;
      if (typeof codigo === 'string' && /^000201/.test(codigo.trim())) return codigo.trim();
    }
  }
  return null;
}

/**
 * Junta o que a Energisa mandou numa conversa de 2ª via.
 * @param mensagens recebidas (não as nossas), em ordem de chegada, com conteudo
 * @returns {{ semFatura, qtd, codigoCliente, uc, endereco, faturas: [{referencia, valor, vencimento}], pix: string[], pdfs: string[] }}
 */
export function lerRespostaEnergisa(mensagens) {
  const out = { semFatura: false, qtd: 0, codigoCliente: null, uc: null, endereco: null, faturas: [], pix: [], pdfs: [] };
  for (const m of mensagens || []) {
    const texto = textoDaMensagem(m);
    if (passoDaEnergisa(m) === 'sem_fatura') out.semFatura = true;
    const end = texto.match(/Endere[çc]o\*?:\s*(.+)/i);
    if (end) out.endereco = end[1].trim();
    const q = texto.match(/\*?(\d+) faturas? em aberto/i);
    if (q) out.qtd = Number(q[1]);
    const cod = texto.match(/C[oó]digo do Cliente:\s*(\d{1,2}\/\d{5,8}-\d)/i);
    if (cod) out.codigoCliente = cod[1];
    const uc = texto.match(/(?:im[oó]vel|N[uú]mero da UC)\*?:?\s*\*?(\d[\d.]{8,}-\d{2})/i);
    if (uc) out.uc = uc[1].replace(/\D/g, '');
    const valor = texto.match(/Valor\*?:\s*R\$\s*([\d.,]+)/i);
    const venc = texto.match(/Vencimento\*?:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    const ref = texto.match(/Refer[êe]ncia\*?:\s*([a-zç]+)\/(\d{4})/i);
    if (valor && venc && valorDaEnergisa(valor[1]) != null) {
      const mes = ref ? MESES[ref[1].toLowerCase()] : null;
      out.faturas.push({ referencia: mes ? `${mes}/${ref[2]}` : null, valor: valorDaEnergisa(valor[1]), vencimento: `${venc[3]}-${venc[2]}-${venc[1]}` });
    }
    const pix = pixDoBotao(m.conteudo);
    if (pix && !out.pix.includes(pix)) out.pix.push(pix);
    if (/document/i.test(m.tipo || '')) out.pdfs.push(m.id);
  }
  return out;
}

/** O endereço que a Energisa mostrou é o da sala pedida? ("SALA 101" × "…, SL 101, JOAO PESSOA/PB") */
export function enderecoEhDaSala(endereco, rotulo) {
  const sala = String(rotulo || '').match(/\d+/)?.[0];
  if (!sala) return true; // conta sem sala no cadastro: não há o que conferir
  return new RegExp(`\\b(SL|SALA|LJ|LOJA)\\.?\\s*0*${sala}\\b`, 'i').test(String(endereco || ''));
}
