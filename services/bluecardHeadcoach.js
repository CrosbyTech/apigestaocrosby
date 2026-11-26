// ============================================================================
// BLUECARD × HEADCOACH (sem TOTVS) — Yago, 25/11/2026.
//
// Nas lojas que vendem só pelo HeadCoach (utils/lojasHeadcoach.js) a venda do
// crediário BlueCard fecha no PDV Crosby: fica em pdv_vendas (pagamento com a
// forma 'bluecard') e as parcelas em hc_cr_titulos (portador BLUECARD). Nada
// disso aparece no TOTVS — e a integração só olhava para lá: a liberação da
// compra "expirava" sem achar a venda e o BlueCard cancelava uma compra que
// tinha sido vendida de verdade (4 casos entre 18 e 23/11/2026).
//
// Este serviço é o lado HeadCoach da integração:
//   • acha a venda do PDV Crosby que corresponde a uma compra aprovada no app
//     (mesmo CPF/cliente, mesmo valor em BlueCard, feita depois da aprovação);
//   • AMARRA a compra à transação (pdv_vendas.pedido_info.bluecard) e põe as
//     parcelas do contas a receber no calendário do BlueCard (os vencimentos e
//     valores que o cliente aceitou no app — vêm no evento compra.aprovada);
//   • espelha as parcelas em bluecard_titulos com o identificador
//     "HC-<fatura>-<parcela>" (o do TOTVS é "TOTVS-<título>-<parcela>").
// Quem chama: o vigia das liberações (jobs/bluecard-limite.job.js).
// ============================================================================
import supabase from '../config/supabase.js';
import { BASE_FATURA } from './hcContasReceber.js';

const digitos = (v) => String(v || '').replace(/\D/g, '');
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const cents = (v) => Math.round(Number(v || 0) * 100);
// diferença aceita entre o valor aprovado no app e o valor em BlueCard na venda (arredondamento)
export const TOLERANCIA_CENTS = 5;
// a venda pode ser gravada instantes antes de o aviso de aprovação chegar: folga na busca
const FOLGA_MS = 30 * 60 * 1000;

/** Identificador do título do HeadCoach para o BlueCard: HC-<fatura>-<parcela>. */
export const externoIdHc = (fatura, parcela) => `HC-${fatura}-${parcela}`;
/** "HC-9000000627-2" → { fatura: 9000000627, parcela: 2 } (null se não for do HeadCoach). */
export function lerExternoIdHc(externoId) {
  const m = /^HC-(\d+)-(\d+)$/.exec(String(externoId || '').trim());
  return m ? { fatura: Number(m[1]), parcela: Number(m[2]), vendaId: Number(m[1]) - BASE_FATURA } : null;
}

const valorBluecardDaVenda = (v) => round2((v.pdv_venda_pagamentos || []).filter((p) => p.forma === 'bluecard').reduce((s, p) => s + Number(p.valor || 0), 0));

/**
 * Vendas do PDV Crosby pagas (no todo ou em parte) com BlueCard por este cliente desde `desdeIso`.
 * Devolve só as que NÃO estão canceladas, com o valor em BlueCard e a compra já amarrada (se houver).
 */
export async function vendasBluecardDoCliente({ cpf, customerCode = null, desdeIso }) {
  const doc = digitos(cpf);
  const desde = new Date(new Date(desdeIso).getTime() - FOLGA_MS).toISOString();
  const filtros = [doc ? `cliente_cpf_cnpj.eq.${doc}` : null, Number(customerCode) > 0 ? `cliente_code.eq.${Number(customerCode)}` : null].filter(Boolean);
  if (!filtros.length) return [];
  const { data, error } = await supabase
    .from('pdv_vendas')
    .select('id, empresa, status, total, criado_em, cliente_code, cliente_cpf_cnpj, pedido_info, pdv_venda_pagamentos(forma, valor, parcelas), pdv_notas_fiscais(numero, serie, modelo, status)')
    .eq('origem', 'pdv')
    .gte('criado_em', desde)
    .or(filtros.join(','))
    .order('id');
  if (error) throw new Error(`vendas do PDV Crosby: ${error.message}`);
  return (data || [])
    .filter((v) => v.status !== 'cancelada' && (v.pdv_venda_pagamentos || []).some((p) => p.forma === 'bluecard'))
    .map((v) => ({
      id: v.id,
      empresa: Number(v.empresa),
      status: v.status,
      criadoEm: v.criado_em,
      fatura: BASE_FATURA + Number(v.id),
      valorCents: cents(valorBluecardDaVenda(v)),
      parcelas: Math.max(1, ...(v.pdv_venda_pagamentos || []).filter((p) => p.forma === 'bluecard').map((p) => Number(p.parcelas) || 1)),
      compraId: v.pedido_info?.bluecard?.compraId || null,
      pedidoInfo: v.pedido_info || {},
      nota: (v.pdv_notas_fiscais || []).find((n) => n.status === 'autorizada') || null,
    }));
}

/**
 * Qual venda corresponde a esta liberação? A que já está amarrada à compra; senão, a de mesmo
 * valor em BlueCard ainda sem compra (a mais antiga). `usadas` = ids já casados nesta passada.
 */
export function casarVenda(lib, vendas, usadas = new Set()) {
  const livres = vendas.filter((v) => !usadas.has(v.id));
  return (
    livres.find((v) => v.compraId && v.compraId === lib.compra_id) ||
    livres.find((v) => !v.compraId && Math.abs(v.valorCents - Number(lib.valor_cents)) <= TOLERANCIA_CENTS) ||
    null
  );
}

// os vencimentos que o cliente aceitou no app (evento compra.aprovada): [{ numero, vencimento, valor_cents }]
async function vencimentosDaCompra(compraId) {
  const { data } = await supabase
    .from('bluecard_eventos')
    .select('payload')
    .eq('evento', 'compra.aprovada')
    .eq('payload->compra->>id', compraId)
    .order('id', { ascending: false })
    .limit(1);
  const lista = data?.[0]?.payload?.compra?.vencimentos;
  return Array.isArray(lista) ? lista.filter((x) => /^\d{4}-\d{2}-\d{2}/.test(String(x?.vencimento || '')) && Number(x?.valor_cents) > 0).sort((a, b) => Number(a.numero) - Number(b.numero)) : [];
}

/**
 * Põe as parcelas BlueCard da venda (contas a receber do HeadCoach) no calendário do app: mesmas datas
 * e valores que o cliente aceitou. Só mexe quando TODAS estão em aberto, a quantidade bate e a soma
 * fecha com o que a venda já tinha (o valor da venda não muda). Devolve os títulos como ficaram.
 */
export async function alinharParcelas(vendaId, compraId) {
  const ler = async () => {
    const { data, error } = await supabase.from('hc_cr_titulos').select('id, empresa, fatura, parcela, valor, valor_liquido, vencimento, situacao, observacao').eq('venda_id', vendaId).eq('portador', 'BLUECARD').order('parcela');
    if (error) throw new Error(`títulos da venda ${vendaId}: ${error.message}`);
    return data || [];
  };
  let titulos = await ler();
  const venc = await vencimentosDaCompra(compraId);
  if (!titulos.length || !venc.length) return { titulos, alinhadas: false, motivo: !titulos.length ? 'venda ainda sem títulos' : 'compra sem os vencimentos no evento' };
  const abertos = titulos.every((t) => t.situacao === 'aberto');
  const somaTit = titulos.reduce((s, t) => s + cents(t.valor), 0);
  const somaVenc = venc.reduce((s, x) => s + Number(x.valor_cents), 0);
  if (!abertos || titulos.length !== venc.length || Math.abs(somaTit - somaVenc) > TOLERANCIA_CENTS) {
    return { titulos, alinhadas: false, motivo: !abertos ? 'há parcela já baixada' : titulos.length !== venc.length ? `a venda tem ${titulos.length} parcela(s) e a compra ${venc.length}` : 'os valores não fecham com a compra' };
  }
  const jaIguais = titulos.every((t, i) => String(t.vencimento).slice(0, 10) === String(venc[i].vencimento).slice(0, 10) && cents(t.valor) === Number(venc[i].valor_cents));
  if (jaIguais) return { titulos, alinhadas: true, mudou: false };
  const agora = new Date().toISOString();
  // a diferença de centavos entre a soma do app e a da venda fica na última parcela (o total da venda manda)
  const sobra = somaTit - somaVenc;
  for (let i = 0; i < titulos.length; i += 1) {
    const valor = round2((Number(venc[i].valor_cents) + (i === titulos.length - 1 ? sobra : 0)) / 100);
    const de = `era ${String(titulos[i].vencimento).slice(0, 10)} · R$ ${Number(titulos[i].valor).toFixed(2)}`;
    const { error } = await supabase
      .from('hc_cr_titulos')
      .update({ vencimento: String(venc[i].vencimento).slice(0, 10), valor, valor_liquido: valor, observacao: `BlueCard · parcela no calendário do app (${de})`.slice(0, 250), atualizado_em: agora })
      .eq('id', titulos[i].id)
      .eq('situacao', 'aberto');
    if (error) throw new Error(`alinhar a parcela ${titulos[i].parcela}: ${error.message}`);
  }
  titulos = await ler();
  return { titulos, alinhadas: true, mudou: true };
}

/**
 * Amarra a compra aprovada no BlueCard à venda do PDV Crosby: grava a compra na transação, alinha
 * as parcelas ao calendário do app e espelha os títulos em bluecard_titulos (HC-<fatura>-<parcela>).
 * Pode ser chamada de novo (não duplica nada). Devolve { fatura, titulos, alinhamento }.
 */
export async function vincularCompraAVenda(lib, venda, { por = 'vigia do BlueCard' } = {}) {
  const agora = new Date().toISOString();
  const info = { ...(venda.pedidoInfo || {}) };
  if (info.bluecard?.compraId !== lib.compra_id) {
    info.bluecard = { compraId: lib.compra_id, valorCents: Number(lib.valor_cents), aprovadaEm: lib.liberado_em || null, vinculadaEm: agora, por };
    const { error } = await supabase.from('pdv_vendas').update({ pedido_info: info }).eq('id', venda.id);
    if (error) throw new Error(`amarrar a compra à venda ${venda.id}: ${error.message}`);
  }
  const alinhamento = await alinharParcelas(venda.id, lib.compra_id).catch((e) => ({ titulos: [], alinhadas: false, motivo: e.message }));
  const titulos = alinhamento.titulos || [];
  for (const t of titulos) {
    const { error } = await supabase.from('bluecard_titulos').upsert(
      {
        externo_id: externoIdHc(t.fatura, t.parcela),
        compra_id: lib.compra_id,
        documento: String(t.fatura),
        cpf: digitos(lib.cpf),
        parcela: Number(t.parcela),
        de: titulos.length,
        valor_cents: cents(t.valor),
        vencimento: String(t.vencimento).slice(0, 10),
        totvs_branch_code: Number(t.empresa) || venda.empresa, // a loja da venda (não há título no TOTVS)
        totvs_receivable_code: null,
        totvs_installment_code: null,
        status: t.situacao === 'pago' ? 'pago' : t.situacao === 'cancelado' ? 'cancelado' : 'aberto',
        atualizado_em: agora,
      },
      { onConflict: 'externo_id' },
    );
    if (error) console.warn(`⚠️ [bluecard] espelho do título ${externoIdHc(t.fatura, t.parcela)}: ${error.message}`);
  }
  return { fatura: venda.fatura, titulos, alinhamento };
}

// ─── consultas que o BlueCard faz (GET /faturas e GET /vendas) ───────────────
const dia = (v) => (v ? String(v).slice(0, 10) : null);
const filtroCliente = (cpf, customerCode) =>
  [digitos(cpf) ? `cliente_cpf_cnpj.eq.${digitos(cpf)}` : null, Number(customerCode) > 0 ? `cliente_code.eq.${Number(customerCode)}` : null].filter(Boolean).join(',');

/**
 * Parcelas BlueCard do cliente no contas a receber do HeadCoach, no MESMO formato dos títulos
 * de GET /api/bluecard/faturas (datas AAAA-MM-DD, filial = código da loja).
 */
export async function titulosHeadcoachDoCliente({ cpf, customerCode = null, desde = null, incluirCancelados = false }) {
  const filtro = filtroCliente(cpf, customerCode);
  if (!filtro) return [];
  let qy = supabase
    .from('hc_cr_titulos')
    .select('empresa, fatura, parcela, valor, valor_pago, emissao, vencimento, situacao, data_pagamento')
    .eq('portador', 'BLUECARD')
    .or(filtro)
    .order('fatura', { ascending: false })
    .order('parcela')
    .limit(1000);
  if (desde) qy = qy.gte('emissao', dia(new Date(desde).toISOString()));
  const { data, error } = await qy;
  if (error) throw new Error(`títulos do HeadCoach: ${error.message}`);
  return (data || [])
    .filter((t) => incluirCancelados || t.situacao !== 'cancelado')
    .map((t) => ({
      externo_id: externoIdHc(t.fatura, t.parcela),
      documento: String(t.fatura),
      parcela: Number(t.parcela),
      valor_cents: cents(t.valor),
      emitido_em: dia(t.emissao),
      vencimento: dia(t.vencimento),
      status: t.situacao === 'pago' ? 'pago' : 'aberto',
      pago_em: t.situacao === 'pago' ? dia(t.data_pagamento) : null,
      valor_pago_cents: t.situacao === 'pago' ? cents(t.valor_pago || t.valor) : null,
      filial: Number(t.empresa),
      situacao: t.situacao === 'cancelado' ? 'cancelado' : 'normal',
      linha_digitavel: null,
      codigo_barras: null,
      pix_copia_e_cola: null,
      origem: 'headcoach',
    }));
}

// forma de pagamento do PDV Crosby → nome que a rota /vendas já usa (o app só distingue BLUECARD e CREDEV)
const FORMA_VENDA = { bluecard: 'BLUECARD', pix: 'PIX', dinheiro: 'DINHEIRO', credito: 'CARTAO_CREDITO', debito: 'CARTAO_DEBITO', credito_loja: 'CREDEV', adiantamento: 'ADIANTAMENTO', vale_troca: 'CREDEV' };

/** Vendas do cliente feitas pelo PDV Crosby (nota autorizada), no formato de GET /api/bluecard/vendas. */
export async function vendasHeadcoachDoCliente({ cpf, customerCode = null, desde }) {
  const filtro = filtroCliente(cpf, customerCode);
  if (!filtro) return [];
  const { data, error } = await supabase
    .from('pdv_vendas')
    .select('id, empresa, tipo_venda, operacao, status, total, criado_em, pdv_venda_pagamentos(forma, valor, parcelas, bandeira, troco), pdv_notas_fiscais(numero, serie, status, dh_autorizacao)')
    .eq('origem', 'pdv')
    .eq('status', 'autorizada')
    .neq('tipo_venda', 'troca')
    .gte('criado_em', `${dia(desde)}T00:00:00-03:00`)
    .or(filtro)
    .order('id', { ascending: false })
    .limit(1000);
  if (error) throw new Error(`vendas do HeadCoach: ${error.message}`);
  const horaBr = (iso) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString();
  return (data || []).map((v) => {
    const nota = (v.pdv_notas_fiscais || []).find((n) => n.status === 'autorizada') || null;
    const pagamentos = (v.pdv_venda_pagamentos || [])
      .map((p) => ({ forma: FORMA_VENDA[p.forma] || String(p.forma || '').toUpperCase(), valor_cents: cents(Number(p.valor || 0) - (p.forma === 'dinheiro' ? Number(p.troco || 0) : 0)), parcelas: Number(p.parcelas) || 1, titulo: p.forma === 'bluecard' ? String(BASE_FATURA + Number(v.id)) : null, portador: p.forma === 'bluecard' ? 'BLUECARD' : null, bandeira: p.bandeira || null }))
      .filter((p) => p.valor_cents > 0);
    const valorBluecard = pagamentos.filter((p) => p.forma === 'BLUECARD').reduce((s, p) => s + p.valor_cents, 0);
    const totalPago = pagamentos.reduce((s, p) => s + p.valor_cents, 0);
    const local = horaBr(v.criado_em);
    return {
      documento: String(nota?.numero ?? v.id),
      // identificador único da venda para o app (número; não colide com a sequência do TOTVS)
      sequencia: BASE_FATURA + Number(v.id),
      data: local.slice(0, 10),
      hora: local.slice(11, 19),
      filial: Number(v.empresa),
      operacao: v.operacao ?? null,
      condicao_pagamento: valorBluecard > 0 ? 'BLUECARD' : null,
      valor_total_cents: cents(v.total) || totalPago,
      pagamentos,
      titulo_bluecard: valorBluecard > 0 ? String(BASE_FATURA + Number(v.id)) : null,
      titulos_bluecard: valorBluecard > 0 ? [String(BASE_FATURA + Number(v.id))] : [],
      valor_bluecard_cents: valorBluecard,
      valor_extra_cents: Math.max(0, totalPago - valorBluecard),
      usou_bluecard: valorBluecard > 0,
      origem: 'headcoach',
    };
  });
}

// ─── pagamentos ──────────────────────────────────────────────────────────────
/**
 * Parcela paga pelo cliente no app (evento pagamento.pix): se ela é do contas a receber do
 * HeadCoach, a baixa é feita AQUI, na hora — não vira solicitação de baixa no TOTVS.
 * `p` = parcela do evento ({ titulo, numero, valor_cents, vencimento, compra_documento });
 * devolve null quando a parcela não é do HeadCoach (segue o caminho do TOTVS).
 */
export async function baixarParcelaPagaNoApp(p, { cpf, dataPagamento, jurosCents = 0, referencia = null, nsu = null }) {
  const id = lerExternoIdHc(p?.titulo);
  let titulo = null;
  if (id) {
    const { data } = await supabase.from('hc_cr_titulos').select('*').eq('fatura', id.fatura).eq('parcela', id.parcela).eq('portador', 'BLUECARD').maybeSingle();
    titulo = data || null;
  }
  // parcela sem o identificador (o app ainda não tinha recebido): pela fatura da compra + número, ou pelo vencimento + valor
  if (!titulo && Number(p?.compra_documento) >= BASE_FATURA) {
    const { data } = await supabase.from('hc_cr_titulos').select('*').eq('fatura', Number(p.compra_documento)).eq('parcela', Number(p.numero) || 1).eq('portador', 'BLUECARD').maybeSingle();
    titulo = data || null;
  }
  if (!titulo && !p?.titulo && digitos(cpf)) {
    const { data } = await supabase.from('hc_cr_titulos').select('*').eq('portador', 'BLUECARD').eq('cliente_cpf_cnpj', digitos(cpf)).eq('situacao', 'aberto').eq('vencimento', dia(p?.vencimento)).order('id');
    titulo = (data || []).find((t) => Math.abs(cents(t.valor) - Number(p?.valor_cents || 0)) <= TOLERANCIA_CENTS) || null;
  }
  if (!titulo) return null;
  const externo = externoIdHc(titulo.fatura, titulo.parcela);
  if (titulo.situacao !== 'aberto') return { externoId: externo, resultado: titulo.situacao === 'pago' ? 'titulo_ja_baixado' : 'titulo_cancelado', tituloId: titulo.id };
  const juros = round2(Number(jurosCents || 0) / 100);
  const recebido = round2(Number(titulo.valor) + juros);
  const agora = new Date().toISOString();
  const por = 'BlueCard · Pix pago no app';
  const { data: atual, error } = await supabase
    .from('hc_cr_titulos')
    .update({ situacao: 'pago', data_pagamento: dataPagamento, data_liquidacao: dataPagamento, valor_pago: recebido, valor_liquido: recebido, juros, multa: 0, desconto: 0, baixado_por: por, baixado_em: agora })
    .eq('id', titulo.id)
    .eq('situacao', 'aberto')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`baixar ${externo}: ${error.message}`);
  if (!atual) return { externoId: externo, resultado: 'titulo_ja_baixado', tituloId: titulo.id };
  await supabase.from('hc_cr_baixas').insert({
    titulo_id: titulo.id,
    data_pagamento: dataPagamento,
    valor_titulo: round2(titulo.valor),
    juros,
    multa: 0,
    desconto: 0,
    valor_recebido: recebido,
    forma_recebimento: 'Pix (Pagar.me · app BlueCard)',
    conta: null,
    observacao: [referencia ? `Cobrança ${referencia}` : null, nsu ? `NSU ${nsu}` : null].filter(Boolean).join(' · ') || null,
    por_id: null,
    por,
  });
  // espelho: pago e JÁ conhecido pelo BlueCard (foi ele quem avisou) — o job não manda o pagamento de volta
  await supabase.from('bluecard_titulos').update({ status: 'pago', pago_em: new Date(`${dataPagamento}T12:00:00-03:00`).toISOString(), valor_pago_cents: cents(recebido), meio: 'pix', notificado_bluecard_em: agora, atualizado_em: agora }).eq('externo_id', externo);
  console.log(`💵 [bluecard] Pix pago no app: baixa da fatura ${titulo.fatura}/${titulo.parcela} no HeadCoach · R$ ${recebido.toFixed(2)}${juros ? ` (encargos ${juros.toFixed(2)})` : ''}`);
  return { externoId: externo, resultado: 'baixado_headcoach', tituloId: titulo.id, valor: recebido };
}

/**
 * Espelho × contas a receber do HeadCoach: parcela baixada (ou cancelada) na tela do Contas a Receber
 * passa para bluecard_titulos — é de lá que o job avisa o BlueCard (POST /api/v1/pagamentos).
 * Devolve quantas ficaram pagas.
 */
export async function sincronizarPagamentosHeadcoach() {
  const { data: abertos, error } = await supabase.from('bluecard_titulos').select('externo_id, valor_cents').eq('status', 'aberto').is('totvs_receivable_code', null).limit(2000);
  if (error) throw new Error(`espelho do HeadCoach: ${error.message}`);
  const meus = (abertos || []).map((e) => ({ e, id: lerExternoIdHc(e.externo_id) })).filter((x) => x.id);
  if (!meus.length) return { abertos: 0, pagos: 0, cancelados: 0 };
  const faturas = [...new Set(meus.map((x) => x.id.fatura))];
  const titulos = [];
  for (let i = 0; i < faturas.length; i += 200) {
    const { data, error: e2 } = await supabase.from('hc_cr_titulos').select('fatura, parcela, valor, valor_pago, situacao, data_pagamento, baixado_em').in('fatura', faturas.slice(i, i + 200));
    if (e2) throw new Error(`títulos do HeadCoach: ${e2.message}`);
    titulos.push(...(data || []));
  }
  let pagos = 0;
  let cancelados = 0;
  const agora = new Date().toISOString();
  for (const { e, id } of meus) {
    const t = titulos.find((x) => Number(x.fatura) === id.fatura && Number(x.parcela) === id.parcela);
    if (!t || t.situacao === 'aberto') continue;
    if (t.situacao === 'pago') {
      const pagoEm = t.data_pagamento ? new Date(`${dia(t.data_pagamento)}T12:00:00-03:00`).toISOString() : t.baixado_em || agora;
      const { error: e3 } = await supabase.from('bluecard_titulos').update({ status: 'pago', pago_em: pagoEm, valor_pago_cents: cents(t.valor_pago || t.valor) || Number(e.valor_cents), meio: 'baixa_headcoach', atualizado_em: agora }).eq('externo_id', e.externo_id).eq('status', 'aberto');
      if (!e3) pagos += 1;
    } else if (t.situacao === 'cancelado') {
      const { error: e3 } = await supabase.from('bluecard_titulos').update({ status: 'cancelado', atualizado_em: agora }).eq('externo_id', e.externo_id).eq('status', 'aberto');
      if (!e3) cancelados += 1;
    }
  }
  return { abertos: meus.length, pagos, cancelados };
}

// ─── transações para o BlueCard conciliar o dia (GET /api/bluecard/transacoes) ──
/**
 * Transações do PDV Crosby pagas (no todo ou em parte) com BlueCard, por PERÍODO (data da venda,
 * horário de Brasília) e, se quiser, por CPF ou pela compra do BlueCard. Cada uma traz a compra do
 * BlueCard, a nota, os itens, a loja, o vendedor e a situação:
 *   pendente  — venda gravada, nota ainda não autorizada
 *   fechada   — nota autorizada
 *   cancelada — transação cancelada (nota cancelada na SEFAZ)
 *   devolvida / devolvida_parcial — houve troca/devolução de peças desta venda (`devolucao`)
 */
export async function transacoesBluecard({ desde, ate, cpf = null, compraId = null, limite = 1000 }) {
  let qy = supabase
    .from('pdv_vendas')
    .select(
      'id, empresa, empresa_nome, tipo_venda, status, total, subtotal, desconto, qtd_pecas, cliente_code, cliente_nome, cliente_cpf_cnpj, vendedor_code, vendedor_nome, criado_em, atualizado_em, pedido_info, pdv_venda_pagamentos(forma, valor, parcelas, troco), pdv_venda_itens(seq, product_code, sku, nome, quantidade, valor_unit, desconto_unit, total), pdv_notas_fiscais(modelo, numero, serie, chave, status, dh_autorizacao, cancel_em)',
    )
    .eq('origem', 'pdv')
    .neq('tipo_venda', 'troca')
    .gte('criado_em', `${dia(desde)}T00:00:00-03:00`)
    .lte('criado_em', `${dia(ate)}T23:59:59.999-03:00`)
    .order('id')
    .limit(Math.min(Number(limite) || 1000, 5000));
  if (digitos(cpf)) qy = qy.eq('cliente_cpf_cnpj', digitos(cpf));
  if (compraId) qy = qy.eq('pedido_info->bluecard->>compraId', String(compraId));
  const { data, error } = await qy;
  if (error) throw new Error(`transações do HeadCoach: ${error.message}`);
  const vendas = (data || []).filter((v) => (v.pdv_venda_pagamentos || []).some((p) => p.forma === 'bluecard'));
  if (!vendas.length) return [];

  // títulos das vendas e trocas que devolveram peças delas (pela chave da nota de origem)
  const ids = vendas.map((v) => v.id);
  const titulos = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: t } = await supabase.from('hc_cr_titulos').select('venda_id, fatura, parcela, valor, vencimento, situacao, data_pagamento, valor_pago').in('venda_id', ids.slice(i, i + 200)).eq('portador', 'BLUECARD').order('parcela');
    titulos.push(...(t || []));
  }
  const chaves = vendas.flatMap((v) => (v.pdv_notas_fiscais || []).filter((n) => n.chave).map((n) => String(n.chave)));
  const clientes = [...new Set(vendas.map((v) => Number(v.cliente_code)).filter(Boolean))];
  let trocas = [];
  if (chaves.length && clientes.length) {
    const { data: tr } = await supabase
      .from('pdv_vendas')
      .select('id, status, total, criado_em, nf_referenciada, pedido_info')
      .eq('tipo_venda', 'troca')
      .in('cliente_code', clientes)
      .gte('criado_em', `${dia(desde)}T00:00:00-03:00`)
      .limit(2000);
    trocas = (tr || []).filter((t) => t.status === 'autorizada');
  }
  const horaBr = (iso) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00') : null);

  return vendas.map((v) => {
    const nota = (v.pdv_notas_fiscais || []).find((n) => n.status === 'autorizada') || (v.pdv_notas_fiscais || []).find((n) => n.status === 'cancelada') || null;
    const pg = v.pdv_venda_pagamentos || [];
    const valorBluecard = round2(pg.filter((p) => p.forma === 'bluecard').reduce((s, p) => s + Number(p.valor || 0), 0));
    // o que voltou em troca: as peças da troca que referenciam a nota desta venda
    let devolvidoCents = 0;
    const devolucoes = [];
    if (nota?.chave) {
      for (const t of trocas) {
        if (!String(t.nf_referenciada || '').includes(nota.chave)) continue;
        const itens = (t.pedido_info?.troca?.itens || []).flatMap((i) => (i.notas || []).filter((n) => String(n.chave) === String(nota.chave)).map((n) => ({ codigo: String(i.productCode), quantidade: Number(n.quantidade) || 0, valor_cents: cents(n.valorUnit) })));
        const valor = itens.length ? itens.reduce((s, i) => s + i.quantidade * i.valor_cents, 0) : cents(t.total);
        devolvidoCents += valor;
        devolucoes.push({ transacao: t.id, em: horaBr(t.criado_em), valor_cents: valor, itens });
      }
    }
    const total = cents(v.total);
    const status = v.status === 'cancelada' || nota?.status === 'cancelada' ? 'cancelada' : v.status !== 'autorizada' ? 'pendente' : devolvidoCents >= total && total > 0 ? 'devolvida' : devolvidoCents > 0 ? 'devolvida_parcial' : 'fechada';
    const b = v.pedido_info?.bluecard || null;
    return {
      transacao: v.id,
      fatura: String(BASE_FATURA + Number(v.id)),
      compra_id: b?.compraId || null,
      compra_documento: b?.documento || null,
      status,
      data: horaBr(v.criado_em),
      loja: { codigo: Number(v.empresa), nome: v.empresa_nome || null },
      vendedor: { codigo: v.vendedor_code ?? null, nome: v.vendedor_nome || null },
      cliente: { cpf: digitos(v.cliente_cpf_cnpj) || null, nome: v.cliente_nome || null, codigo: v.cliente_code ?? null },
      valor_total_cents: total,
      valor_bluecard_cents: cents(valorBluecard),
      parcelas: Math.max(1, ...pg.filter((p) => p.forma === 'bluecard').map((p) => Number(p.parcelas) || 1)),
      pagamentos: pg.filter((p) => Number(p.valor) > 0).map((p) => ({ forma: FORMA_VENDA[p.forma] || String(p.forma || '').toUpperCase(), valor_cents: cents(Number(p.valor) - (p.forma === 'dinheiro' ? Number(p.troco || 0) : 0)), parcelas: Number(p.parcelas) || 1 })),
      nota: nota ? { modelo: Number(nota.modelo) === 65 ? 'NFC-e' : 'NF-e', numero: nota.numero, serie: nota.serie, chave: nota.chave || null, emitida_em: horaBr(nota.dh_autorizacao), status: nota.status, cancelada_em: horaBr(nota.cancel_em) } : null,
      itens: (v.pdv_venda_itens || []).sort((a, c) => Number(a.seq) - Number(c.seq)).map((i) => ({ codigo: String(i.product_code), sku: i.sku || null, descricao: i.nome, quantidade: Number(i.quantidade), valor_cents: cents(Number(i.valor_unit) - Number(i.desconto_unit || 0)), total_cents: cents(i.total) })),
      titulos: titulos.filter((t) => t.venda_id === v.id).map((t) => ({ externo_id: externoIdHc(t.fatura, t.parcela), parcela: Number(t.parcela), valor_cents: cents(t.valor), vencimento: dia(t.vencimento), status: t.situacao === 'pago' ? 'pago' : t.situacao === 'cancelado' ? 'cancelado' : 'aberto', pago_em: t.situacao === 'pago' ? dia(t.data_pagamento) : null })),
      devolucao: devolucoes.length ? { valor_cents: devolvidoCents, trocas: devolucoes } : null,
      cancelada_no_app: b?.canceladaNoApp || null,
      atualizada_em: horaBr(v.atualizado_em),
    };
  });
}
