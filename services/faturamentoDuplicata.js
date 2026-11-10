// ============================================================================
// DUPLICATA DO FATURAMENTO DA EXPEDIÇÃO — o HeadCoach envia a MESMA duplicata
// que o robô do Dryland (_duplicata_watcher.py) envia quando a nota sai pelo
// TOTVS. Aqui a nota é emitida pelo HeadCoach, então o robô de lá não acha a NF
// nem os boletos no TOTVS e não consegue montar o documento — por isso o envio
// é feito daqui (Yago, 10/11/2026).
//
// Igual ao Dryland:
//   • documento "DUPLICATA / CONFIRMAÇÃO DE COMPRA A PRAZO" em papel timbrado
//     (modelo de _duplicata_modelo.mjs, copiado), PDF por Chrome/puppeteer;
//   • Autentique: um signatário (o cliente), entrega por LINK (o Autentique não
//     avisa ninguém), assinatura manuscrita + rubrica + data na 1ª página;
//   • WhatsApp pela UAZAPI, do mesmo número do Dryland ((84) 9138-2078), com o
//     MESMO texto; o número do cliente é conferido antes em /chat/check.
// Diferente (decisão do Yago): a coluna "Número do Boleto" leva NF/parcela,
// porque na nota do HeadCoach o boleto ainda não existe na hora da emissão.
//
// Depois do envio o HeadCoach grava no card do Dryland duplicata_link/_doc/
// _enviada_em/_zap/_chip — com isso o Painel do frete mostra a duplicata, o
// robô de lá NÃO manda outra e é ele quem faz o lembrete de 3 h e o alerta de
// 24 h, como em qualquer duplicata. A assinatura é conferida aqui (job) e
// gravada no card (duplicata_assinada_em), que é o que libera a expedição.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { buscarClienteFiscal, buscarEmitente } from './pdvFiscal.js';
import { drylandRpc } from './pedidosVendaDryland.js';
import { agoraDryland, ehCardDaFila, editarCardDryland, lerCardDryland, esquecerCacheCards } from './drylandCard.js';
import { launchPuppeteer, autentiqueCredenciais } from '../routes/autentique.routes.js';

export class DuplicataError extends Error {
  constructor(message, code = 'DUPLICATA_ERROR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMBRADO = path.join(RAIZ, 'assets', 'duplicata', 'timbrado_crosby.jpg');
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const so = (v) => String(v ?? '').replace(/\D/g, '');
const brl = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dbr = (v) => {
  if (!v) return '';
  const s = String(v).slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : String(v);
};
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fmtCnpj = (v) => {
  const n = so(v);
  return n.length === 14 ? `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}` : String(v ?? '');
};
const fmtDoc = (v) => {
  const n = so(v);
  if (n.length === 14) return fmtCnpj(n);
  if (n.length === 11) return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
  return String(v ?? '');
};

// ─── dados ──────────────────────────────────────────────────────────────────
async function carregar(vendaId) {
  const { data: venda, error } = await supabase.from('pdv_vendas').select('*').eq('id', vendaId).maybeSingle();
  if (error) throw new DuplicataError(error.message, 'DB_ERROR', 500);
  if (!venda) throw new DuplicataError('Venda não encontrada', 'NOT_FOUND', 404);
  const [{ data: pagamentos }, { data: notas }, { data: fat }, { data: dup }] = await Promise.all([
    supabase.from('pdv_venda_pagamentos').select('*').eq('venda_id', vendaId).order('id'),
    supabase.from('pdv_notas_fiscais').select('id, numero, serie, chave, status, dh_emissao, dh_autorizacao').eq('venda_id', vendaId).order('id', { ascending: false }),
    supabase.from('pedidos_venda_faturamentos').select('id, chave, numero_site').eq('venda_id', vendaId).maybeSingle(),
    supabase.from('faturamento_duplicatas').select('*').eq('venda_id', vendaId).maybeSingle(),
  ]);
  return { venda, pagamentos: pagamentos || [], nota: (notas || []).find((n) => n.status === 'autorizada') || null, fat: fat || null, dup: dup || null };
}

// Só venda com boleto tem duplicata (o Dryland: forma_pagamento contém BOLETO)
export const temBoleto = (venda, pagamentos) => (pagamentos || []).some((p) => p.forma === 'boleto') && (venda?.cobranca?.parcelas || []).length > 0;

/** Tudo que entra no documento e na mensagem. */
export async function dadosDaDuplicata(vendaId) {
  const { venda, pagamentos, nota, fat, dup } = await carregar(vendaId);
  if (!nota) throw new DuplicataError('A NF-e ainda não foi autorizada', 'SEM_NOTA');
  if (!temBoleto(venda, pagamentos)) throw new DuplicataError('Esta venda não tem boleto — não há duplicata', 'SEM_BOLETO');
  const [cliente, emit] = await Promise.all([buscarClienteFiscal(venda.cliente_code), buscarEmitente(venda.empresa)]);
  const nome = String(cliente?.nome || venda.cliente_nome || '').trim();
  if (!nome) throw new DuplicataError('Não achei a razão social do comprador — não gero a duplicata com o campo em branco', 'SEM_COMPRADOR');
  const e = cliente?.endereco || null;
  const parcelas = venda.cobranca.parcelas.map((p, i) => ({
    n: String(i + 1).padStart(2, '0'),
    // decisão do Yago: sem boleto registrado na hora da nota, vai NF/parcela
    numero: `${nota.numero}/${i + 1}`,
    venc: String(p.vencimento).slice(0, 10),
    valor: round2(p.valor),
  }));
  // telefone: o card do Dryland (whats_cliente / telefone) e o de-para fixo dele têm prioridade
  const card = fat?.chave && ehCardDaFila(fat.chave) ? await lerCardDryland(fat.chave).catch(() => null) : null;
  const d = card?.dados || {};
  let telefone = d.whats_cliente || d.telefone || cliente?.fone || null;
  try {
    const fixos = await drylandRpc('duplicata_zap_fixo_listar', {});
    const fixo = (Array.isArray(fixos) ? fixos : []).find((x) => String(x.codigo_cliente) === String(venda.cliente_code))?.zap;
    if (fixo) telefone = fixo;
  } catch {
    /* de-para indisponível: segue com o telefone do card/cadastro */
  }
  const boleto = pagamentos.find((p) => p.forma === 'boleto');
  return {
    venda,
    nota,
    fat,
    dup,
    card,
    // documento
    cnpjVendedor: fmtCnpj(emit?.cnpj || venda.empresa_cnpj || '17177680001007'),
    nome,
    doc: fmtDoc(cliente?.cnpj || cliente?.cpf || venda.cliente_cpf_cnpj),
    endereco: e ? [e.xLgr, e.nro, e.xCpl, e.xBairro].filter(Boolean).join(', ') : '',
    cidade: e?.xMun ? `${e.xMun}/${e.UF || ''}` : '',
    nf: nota.numero,
    emissao: String(nota.dh_emissao || nota.dh_autorizacao || venda.data_caixa || '').slice(0, 10),
    total: round2(venda.total),
    parcelas,
    // mensagem
    nomeMensagem: d.nome_cliente || d.nf_cliente || nome,
    telefone,
    valorPedido: d.valor_pedido != null && d.valor_pedido !== '' ? d.valor_pedido : venda.total,
    parcelamento: d.parcelamento || String(parcelas.length),
    formaPagamento: d.forma_pagamento || 'BOLETO',
    valorBoleto: round2(boleto?.valor || 0),
  };
}

// ─── documento (modelo copiado de _duplicata_modelo.mjs do Dryland) ──────────
export function htmlDaDuplicata(dados) {
  const timbrado = `data:image/jpeg;base64,${fs.readFileSync(TIMBRADO).toString('base64')}`;
  const total = dados.parcelas.reduce((s, p) => s + (p.valor || 0), 0);
  const linha = (rot, val) => `<tr><th>${rot}</th><td>${esc(val)}</td></tr>`;
  // diferença entre o que os boletos somam e o valor da compra = taxa por boleto
  const taxa = Math.max(0, total - Number(dados.total || 0));
  const taxaUnit = dados.parcelas.length ? taxa / dados.parcelas.length : 0;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Duplicata ${esc(dados.nf)}</title><style>
  @page{size:A4;margin:0}
  html,body{margin:0;padding:0}
  body{font-family:"Times New Roman",Times,serif;font-size:10.5pt;color:#000;line-height:1.22}
  .pagina{position:relative;width:210mm;height:297mm;overflow:hidden}
  img.timbre{position:absolute;top:0;left:0;width:210mm;height:297mm}
  .folha{position:relative;height:297mm;box-sizing:border-box;padding:32mm 22mm 26mm 22mm}
  h1{font-size:14pt;text-align:center;margin:0 0 12px;font-weight:bold}
  h2{font-size:11pt;font-weight:bold;margin:11px 0 4px}
  table{width:100%;border-collapse:collapse;margin-bottom:3px}
  th,td{border:1px dotted #666;padding:4px 8px;vertical-align:middle}
  th{width:34%;text-align:center;font-weight:bold}
  td{text-align:center}
  table.bol th,table.bol td{text-align:center;width:auto}
  table.bol thead th{font-weight:bold}
  .decl{margin-top:4px}
  .decl p{text-align:center;margin:7px 30px}
  .nota-taxa{margin-top:6px;font-size:10.5px;color:#333;line-height:1.45;text-align:justify}
  .assin{position:absolute;left:22mm;right:22mm;bottom:20mm;text-align:center}
  .assin .l{border-top:1px solid #000;width:320px;margin:0 auto;padding-top:4px}
</style></head><body><div class="pagina"><img class="timbre" src="${timbrado}"><div class="folha">
<h1>DUPLICATA / CONFIRMAÇÃO DE COMPRA A PRAZO</h1>

<h2>DADOS DO VENDEDOR:</h2>
<table>
  ${linha('Razão Social:', 'FERREIRA COMERCIO E CONFECCOES LTDA')}
  ${linha('Nome Fantasia:', 'CROSBY')}
  ${linha('CNPJ:', dados.cnpjVendedor)}
</table>

<h2>DADOS DO COMPRADOR</h2>
<table>
  ${linha('Razão Social/Comprador:', dados.nome)}
  ${linha('CNPJ/CPF:', dados.doc)}
  ${linha('Endereço:', dados.endereco)}
  ${linha('Cidade/UF:', dados.cidade)}
</table>

<h2>DADOS DA VENDA:</h2>
<table>
  ${linha('Número da Nota Fiscal:', dados.nf)}
  ${linha('Data de Emissão:', dbr(dados.emissao))}
  ${linha('Valor Total da Compra:', brl(dados.total))}
</table>

<h2>RELAÇÃO DOS BOLETOS:</h2>
<table class="bol">
  <thead><tr><th>Parcela</th><th>Número do Boleto</th><th>Vencimento</th><th>Valor</th></tr></thead>
  <tbody>
    ${dados.parcelas.map((p) => `<tr><td>${esc(p.n)}</td><td>${esc(p.numero)}</td><td>${dbr(p.venc)}</td><td>${brl(p.valor)}</td></tr>`).join('') || '<tr><td colspan="4">Nenhuma parcela encontrada</td></tr>'}
    <tr><td colspan="3"><b>Valor Total dos Boletos:</b></td><td><b>${brl(total)}</b></td></tr>
  </tbody>
</table>
${taxa > 0.004 ? `<div class="nota-taxa">Os boletos acima já possuem a taxa de emissão de
  ${brl(taxaUnit)} por boleto, cobrada pelo banco.</div>` : ''}

<h2>DECLARAÇÃO:</h2>
<div class="decl">
  <p>Declaro que recebi e conferi as mercadorias constantes na Nota Fiscal acima identificada, bem como
     estou ciente e de acordo com as condições de pagamento descritas nos boletos relacionados neste documento.</p>
  <p>Reconheço a realização da compra e assumo integral responsabilidade pelo pagamento das parcelas
     nos respectivos vencimentos.</p>
</div>
<div class="assin"><div class="l">Assinatura do Comprador</div></div>
</div></div></body></html>`;
}

export async function pdfDaDuplicata(dados) {
  const { browser } = await launchPuppeteer();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123 });
    await page.setContent(htmlDaDuplicata(dados), { waitUntil: 'load' });
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
  } finally {
    await browser.close().catch(() => {});
  }
}

// ─── mensagem (texto do _duplicata_watcher.py, sem tirar nem pôr) ────────────
export function textoDaDuplicata(dados, link) {
  return (
    `Olá, *${dados.nomeMensagem}*! Faturamento concluído ✅\n\n` +
    `📄 NF: ${dados.nf || '—'}\n` +
    `💰 Valor: ${brl(dados.valorPedido)}\n` +
    `🔢 Parcelas: ${dados.parcelamento || '1'}x\n` +
    `💳 Pagamento: ${dados.formaPagamento || 'BOLETO'}\n\n` +
    '⚠️ O *envio só é aprovado após a assinatura* da duplicata:\n' +
    `🔗 ${link}\n\n` +
    '🤖 _Mensagem automática. Em caso de dúvidas, entre em contato com o seu vendedor._'
  );
}

// ─── WhatsApp: os mesmos chips do robô do Dryland ───────────────────────────
// principal (84) 9138-2078 → fallback (88) 9362-9653 → (84) 9606-3204
const CHIPS = String(process.env.DUPLICATA_WA_NUMEROS || '558491382078,558893629653,558496063204')
  .split(',')
  .map((n) => so(n))
  .filter(Boolean);
const mesmoNumero = (a, b) => so(a).slice(-8) === so(b).slice(-8) && so(a).slice(-10, -8) === so(b).slice(-10, -8);

/** Chips conectados, na ordem principal → fallback. [{ nome, base, token }] */
export async function chipsDaDuplicata() {
  // 1) instância dita no ambiente
  if (process.env.DUPLICATA_WA_BASE_URL && process.env.DUPLICATA_WA_TOKEN) {
    return [{ nome: process.env.DUPLICATA_WA_NOME || 'duplicata', base: process.env.DUPLICATA_WA_BASE_URL.replace(/\/+$/, ''), token: process.env.DUPLICATA_WA_TOKEN }];
  }
  // 2) acha pelo número nos servidores da UAZAPI que o HeadCoach já conhece
  const servidores = [
    [process.env.DUPLICATA_WA_BASE_URL, process.env.DUPLICATA_WA_ADMIN_TOKEN],
    [process.env.WHATSAPP_CP_BASE_URL, process.env.WHATSAPP_CP_ADMIN_TOKEN],
    [process.env.UAZAPI_BASE_URL, process.env.UAZAPI_ADMIN_TOKEN],
  ].filter(([b, t]) => b && t);
  const achados = [];
  for (const [b, adm] of servidores) {
    const base = b.replace(/\/+$/, '');
    try {
      const { data } = await axios.get(`${base}/instance/all`, { headers: { admintoken: adm }, timeout: 20000 });
      const insts = Array.isArray(data) ? data : data?.instances || [];
      for (const numero of CHIPS) {
        const x = insts.find((i) => i.owner && mesmoNumero(i.owner, numero));
        if (x?.token && x.status === 'connected' && !achados.some((a) => a.numero === numero)) achados.push({ numero, nome: x.name || numero, base, token: x.token });
      }
    } catch {
      /* servidor fora ou sem permissão: tenta o próximo */
    }
  }
  return CHIPS.map((n) => achados.find((a) => a.numero === n)).filter(Boolean);
}

async function uaz(chip, rota, body) {
  const { data } = await axios.post(`${chip.base}${rota}`, body, { headers: { token: chip.token, 'Content-Type': 'application/json' }, timeout: 60000 });
  return data;
}

// JID real do WhatsApp (só os dígitos), ou null se o número não existe
async function jidValido(numero, chips) {
  let n = so(numero);
  if (n.length === 10 || n.length === 11) n = `55${n}`;
  for (const chip of chips) {
    try {
      const r = await uaz(chip, '/chat/check', { numbers: [n] });
      const item = Array.isArray(r) ? r[0] || {} : {};
      if (item.isInWhatsapp && item.jid) return String(item.jid).split('@')[0];
      return null; // o chip respondeu: o número é que não existe
    } catch {
      /* tenta o próximo chip */
    }
  }
  return undefined; // nenhum chip respondeu
}

// E.164 para o Autentique (repõe o 9 do celular, como o _autentique_enviar.py)
function foneAutentique(t) {
  let n = so(t);
  if (n.length === 10 || n.length === 11) n = `55${n}`;
  if (n.length === 12 && n.startsWith('55') && '6789'.includes(n[4])) n = `${n.slice(0, 4)}9${n.slice(4)}`;
  return `+${n}`;
}

// ─── Autentique ─────────────────────────────────────────────────────────────
const CRIAR = `mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
  createDocument(document: $document, signers: $signers, file: $file) {
    id name
    signatures { public_id name delivery_method link { short_link } }
  }
}`;

async function autentiqueCriar(pdf, titulo, quem, fone) {
  const { url, chave } = autentiqueCredenciais();
  if (!chave) throw new DuplicataError('Autentique não configurado (AUTENTIQUE_API_KEY)', 'AUTENTIQUE_SEM_CHAVE', 500);
  const telefone = foneAutentique(fone);
  if (telefone.length < 13) throw new DuplicataError(`Telefone incompleto para a assinatura: ${telefone}`, 'TELEFONE_INCOMPLETO');
  const variaveis = {
    document: { name: titulo, refusable: true, show_audit_page: true, configs: { signature_appearance: 'HANDWRITING', notification_finished: false, notification_signed: false } },
    signers: [
      {
        name: quem,
        phone: telefone,
        delivery_method: 'DELIVERY_METHOD_LINK',
        action: 'SIGN',
        positions: [
          { x: '38.0', y: '88.5', z: 1, element: 'SIGNATURE' },
          { x: '85.0', y: '95.5', z: 1, element: 'INITIALS' },
          { x: '38.0', y: '93.5', z: 1, element: 'DATE' },
        ],
      },
    ],
    file: null,
  };
  const form = new FormData();
  form.append('operations', JSON.stringify({ query: CRIAR, variables: variaveis }));
  form.append('map', JSON.stringify({ 0: ['variables.file'] }));
  form.append('0', new Blob([pdf], { type: 'application/pdf' }), `duplicata-nf-${titulo.replace(/[^0-9]+/g, ' ').trim().split(' ')[0] || 'nf'}.pdf`);
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${chave}` }, body: form, signal: AbortSignal.timeout(180000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new DuplicataError(`Autentique recusou: ${JSON.stringify(j.errors || j).slice(0, 220)}`, 'AUTENTIQUE_RECUSOU', 502);
  const doc = j.data?.createDocument || {};
  const link = (doc.signatures || []).map((s) => s.link?.short_link).find(Boolean) || null;
  if (!doc.id) throw new DuplicataError('Autentique não devolveu o documento', 'AUTENTIQUE_SEM_DOC', 502);
  if (!link) throw new DuplicataError(`Documento criado mas sem link de assinatura (doc ${doc.id})`, 'AUTENTIQUE_SEM_LINK', 502);
  return { id: doc.id, link };
}

async function autentiqueAssinatura(docId) {
  const { url, chave } = autentiqueCredenciais();
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'query($id: UUID!){ document(id: $id){ files { signed } signatures { name signed { created_at } } } }', variables: { id: docId } }),
    signal: AbortSignal.timeout(60000),
  });
  if (r.status === 429) return { limitado: true };
  const j = await r.json().catch(() => ({}));
  const doc = j.data?.document || {};
  // o e-mail da conta aparece como signatário em todo documento e nunca assina: só conta quem assinou
  const ass = (doc.signatures || []).filter((a) => a.name && a.signed?.created_at);
  if (!ass.length) return { assinou: false };
  const quando = ass.map((a) => String(a.signed.created_at)).sort().pop();
  return { assinou: true, url: doc.files?.signed || null, quando };
}

// ─── estado ─────────────────────────────────────────────────────────────────
async function gravar(vendaId, patch) {
  const { error } = await supabase.from('faturamento_duplicatas').upsert({ venda_id: vendaId, ...patch, atualizado_em: new Date().toISOString() }, { onConflict: 'venda_id' });
  if (error) console.warn(`⚠️ [duplicata] não gravei o estado da venda ${vendaId}: ${error.message}`);
}

// A nota emitida pelo HeadCoach vai para o card do Dryland (é dela que os robôs de
// minuta precisam). Quando a venda tem boleto, a nota só é gravada JUNTO com o
// desfecho da duplicata: card com nf_numero + BOLETO e sem duplicata_link faria
// o robô do Dryland tentar mandar a duplicata dele.
export async function gravarNotaNoCard({ venda, nota, fat }, extra = {}, por = 'HeadCoach') {
  if (!fat?.chave || !ehCardDaFila(fat.chave) || !nota) return false;
  // card que já tem nota emitida FORA do HeadCoach (pedido que o TOTVS já tinha
  // faturado) não é sobrescrito — o robô de lá também não reescreve nf_chave
  const atual = (await lerCardDryland(fat.chave, { forcar: true }).catch(() => null))?.dados || {};
  if (atual.nf_chave && String(atual.nf_chave) !== String(nota.chave) && !atual.nf_headcoach) {
    throw new Error(`o card do Dryland já tem a NF ${atual.nf_numero || '?'} emitida fora do HeadCoach — não sobrescrevo (pedido faturado duas vezes?)`);
  }
  await editarCardDryland(
    fat.chave,
    {
      nf_numero: String(nota.numero),
      nf_serie: String(nota.serie),
      nf_chave: nota.chave,
      nf_cliente: venda.cliente_nome || null,
      nf_emitida: true,
      totvs_atendida_em: agoraDryland(),
      nf_headcoach: true,
      headcoach_venda: venda.id,
      ...extra,
    },
    por,
  );
  esquecerCacheCards();
  return true;
}

/**
 * Gera e envia a duplicata da venda (NF-e autorizada, pagamento em boleto).
 * Não reenvia sozinho: com a duplicata já enviada, só `forcar` gera outra.
 */
export async function enviarDuplicata(vendaId, { por = null, forcar = false } = {}) {
  const base = await carregar(vendaId);
  if (!base.nota) throw new DuplicataError('A NF-e ainda não foi autorizada', 'SEM_NOTA');
  if (!temBoleto(base.venda, base.pagamentos)) return { naoSeAplica: true, motivo: 'venda sem boleto' };
  if (base.dup && ['enviada', 'assinada'].includes(base.dup.status) && !forcar) return { jaEnviada: true, duplicata: base.dup };
  if (base.dup?.status === 'assinada') throw new DuplicataError('A duplicata desta venda já foi assinada', 'JA_ASSINADA');
  // outra chamada já está enviando (faturar + "Tentar de novo" em seguida)
  if (base.dup?.status === 'enviando' && Date.now() - new Date(base.dup.atualizado_em).getTime() < 10 * 60 * 1000) return { emAndamento: true };
  await gravar(vendaId, { faturamento_id: base.fat?.id || null, chave: base.fat?.chave || null, nf_numero: base.nota.numero, status: 'enviando', criado_por: por });

  // o card do Dryland já tem duplicata do robô de lá (pedido que o TOTVS já tinha
  // faturado): não manda outra para o cliente
  if (base.fat?.chave && ehCardDaFila(base.fat.chave)) {
    const dc = (await lerCardDryland(base.fat.chave, { forcar: true }).catch(() => null))?.dados || {};
    if ((dc.duplicata_link || dc.duplicata_assinada_em) && !dc.duplicata_headcoach) {
      const msg = `O card do Dryland já tem duplicata ${dc.duplicata_assinada_em ? 'assinada' : 'enviada'} pelo robô de lá (NF ${dc.nf_numero || '?'}) — não envio outra. Confira se o pedido não foi faturado duas vezes.`;
      await gravar(vendaId, { faturamento_id: base.fat?.id || null, chave: base.fat?.chave || null, nf_numero: base.nota.numero, status: 'erro', erro: msg, criado_por: por });
      throw new DuplicataError(msg, 'JA_TEM_DUPLICATA', 409);
    }
  }

  const quem = `HeadCoach${por ? ` (${por})` : ''}`;
  const falhar = async (err) => {
    const msg = String(err.message || err).slice(0, 300);
    await gravar(vendaId, { faturamento_id: base.fat?.id || null, chave: base.fat?.chave || null, nf_numero: base.nota.numero, status: 'erro', erro: msg, criado_por: por });
    // marca no card que quem cuida é o HeadCoach: o robô do Dryland não tenta por conta própria
    // (o texto não pode conter os trechos que ele trata como erro passageiro)
    try {
      await gravarNotaNoCard(base, { duplicata_erro: 'HEADCOACH cuida desta duplicata - envio pendente no HeadCoach', duplicata_erro_em: agoraDryland(), duplicata_headcoach: true }, quem);
    } catch (e) {
      console.warn(`⚠️ [duplicata] venda ${vendaId}: não gravei no card do Dryland: ${e.message}`);
    }
    throw err instanceof DuplicataError ? err : new DuplicataError(msg, 'DUPLICATA_FALHOU', 502);
  };

  try {
    const dados = await dadosDaDuplicata(vendaId);
    if (!dados.telefone) throw new DuplicataError('Cliente sem WhatsApp no pedido nem no cadastro — não há para onde mandar a duplicata', 'SEM_TELEFONE');
    const chips = await chipsDaDuplicata();
    if (!chips.length) {
      throw new DuplicataError(
        'WhatsApp da duplicata não configurado ou desconectado: não achei o número (84) 9138-2078 nos servidores da UAZAPI que o HeadCoach conhece. Configure DUPLICATA_WA_BASE_URL + DUPLICATA_WA_TOKEN (ou DUPLICATA_WA_ADMIN_TOKEN) no Render.',
        'WHATSAPP_NAO_CONFIGURADO',
      );
    }
    const destino = await jidValido(dados.telefone, chips);
    if (destino === undefined) throw new DuplicataError('Nenhum chip respondeu à conferência do número do cliente', 'WHATSAPP_FORA');
    if (!destino) throw new DuplicataError(`O número ${dados.telefone} não tem WhatsApp — confira o telefone do cliente`, 'NUMERO_SEM_WHATSAPP');

    // documento já criado numa tentativa em que só o WhatsApp falhou: usa o mesmo link
    const jaCriado = !forcar && base.dup?.doc_id && base.dup?.link && Number(base.dup.nf_numero) === Number(base.nota.numero) ? { id: base.dup.doc_id, link: base.dup.link } : null;
    const doc = jaCriado || (await autentiqueCriar(await pdfDaDuplicata(dados), `Duplicata NF ${dados.nf} - ${dados.nomeMensagem}`, dados.nomeMensagem, destino));
    const texto = textoDaDuplicata(dados, doc.link);

    let usado = null;
    let mensagemId = null;
    let erroEnvio = null;
    for (const chip of chips) {
      try {
        const r = await uaz(chip, '/send/text', { number: destino, text: texto });
        mensagemId = r?.messageid || r?.id || null;
        usado = chip;
        break;
      } catch (e) {
        erroEnvio = String(e.response?.data?.error || e.response?.data?.message || e.message).slice(0, 110);
      }
    }
    if (!usado) {
      // documento criado e mensagem não saiu: guarda o link para o reenvio não criar outro à toa
      await gravar(vendaId, { doc_id: doc.id, link: doc.link });
      throw new DuplicataError(`Documento criado, mas a mensagem não saiu pelo WhatsApp: ${erroEnvio || 'sem chip'}`, 'WHATSAPP_NAO_ENVIOU', 502);
    }

    const agora = new Date().toISOString();
    await gravar(vendaId, {
      faturamento_id: base.fat?.id || null,
      chave: base.fat?.chave || null,
      nf_numero: base.nota.numero,
      cliente_nome: dados.nome,
      telefone: destino,
      doc_id: doc.id,
      link: doc.link,
      status: 'enviada',
      erro: null,
      enviada_em: agora,
      chip: usado.nome,
      mensagem_id: mensagemId,
      mensagem: texto,
      criado_por: por,
    });
    try {
      await gravarNotaNoCard(
        base,
        { duplicata_link: doc.link, duplicata_doc: doc.id, duplicata_enviada_em: agoraDryland(), duplicata_zap: destino, duplicata_chip: usado.nome, duplicata_erro: null, duplicata_headcoach: true },
        quem,
      );
    } catch (e) {
      console.warn(`⚠️ [duplicata] venda ${vendaId}: enviada, mas não gravei no card do Dryland: ${e.message}`);
    }
    console.log(`✅ [duplicata] venda ${vendaId} NF ${dados.nf}: enviada para ${destino} pelo ${usado.nome} — ${doc.link}`);
    return { enviada: true, link: doc.link, docId: doc.id, telefone: destino, chip: usado.nome };
  } catch (err) {
    return falhar(err);
  }
}

/** Confere no Autentique as duplicatas enviadas e ainda sem assinatura. */
export async function conferirAssinaturas({ vendaId = null } = {}) {
  let q = supabase.from('faturamento_duplicatas').select('*').eq('status', 'enviada').not('doc_id', 'is', null).order('enviada_em', { ascending: false }).limit(60);
  if (vendaId) q = q.eq('venda_id', vendaId);
  const { data } = await q;
  let assinadas = 0;
  for (const d of data || []) {
    const r = await autentiqueAssinatura(d.doc_id).catch(() => ({ assinou: false }));
    if (r.limitado) break; // limite do Autentique: continua na próxima passada
    if (!r.assinou) {
      await new Promise((ok) => setTimeout(ok, 1200));
      continue;
    }
    const quando = r.quando ? new Date(r.quando) : new Date();
    await gravar(d.venda_id, { status: 'assinada', assinada_em: quando.toISOString(), assinada_url: r.url || null });
    if (d.chave && ehCardDaFila(d.chave)) {
      try {
        await editarCardDryland(d.chave, { duplicata_assinada_em: agoraDryland(quando), duplicata_assinada_detectada_em: agoraDryland(), duplicata_assinada_url: r.url || null }, 'HeadCoach (duplicata)');
        esquecerCacheCards();
      } catch (e) {
        console.warn(`⚠️ [duplicata] venda ${d.venda_id}: assinada, mas não gravei no card do Dryland: ${e.message}`);
      }
    }
    assinadas += 1;
    console.log(`✍️ [duplicata] venda ${d.venda_id} NF ${d.nf_numero}: ASSINADA em ${quando.toISOString()}`);
    await new Promise((ok) => setTimeout(ok, 1200));
  }
  return { conferidas: (data || []).length, assinadas };
}

export async function duplicatasDasVendas(vendaIds) {
  if (!vendaIds?.length) return new Map();
  const { data } = await supabase.from('faturamento_duplicatas').select('*').in('venda_id', vendaIds);
  return new Map((data || []).map((d) => [d.venda_id, d]));
}
