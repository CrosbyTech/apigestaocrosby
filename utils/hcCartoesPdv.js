// ============================================================
// Vendas em cartão do PDV Crosby (HeadCoach) no formato do batimento Stone
//
// O batimento (services/stoneBatimento.js) casa a venda da Stone com um
// "título" do sistema por NSU, autorização e valor. No TOTVS o título vem do
// contas a receber; no HeadCoach cada PAGAMENTO em cartão da venda
// (pdv_venda_pagamentos, forma credito/debito) faz esse papel.
//
// Identidade: filial = empresa da venda, titulo = −(id do pagamento). O
// número negativo nunca bate com um título do TOTVS e cabe na tabela dos
// vínculos manuais (stone_conciliacao_vinculos.titulo é BIGINT).
// ============================================================

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

export const FORMAS_CARTAO = ['credito', 'debito'];

const BANDEIRAS = [
  [/master|maestro/i, 'Mastercard'],
  [/visa|electron/i, 'Visa'],
  [/\belo\b/i, 'Elo'],
  [/amex|american/i, 'Amex'],
  [/hiper/i, 'Hipercard'],
];

// "mastercard" → "Mastercard"; vazio, "outros", "apple pay"… → null
export function bandeiraCanonica(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  for (const [re, nome] of BANDEIRAS) if (re.test(t)) return nome;
  return null;
}

// Dia da venda no fuso das lojas (UTC−3, sem horário de verão)
export function diaLocal(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Janela de criado_em (UTC) que cobre os dias locais [inicioIso, fimIso]
export function janelaUtc(inicioIso, fimIso) {
  const fim = new Date(`${fimIso}T03:00:00.000Z`);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { de: `${inicioIso}T03:00:00.000Z`, ate: fim.toISOString() };
}

// O faturamento da expedição grava em qual maquininha/link o cartão passou
// (PAGARME, REDE…). Sem essa informação a venda é do PDV da loja, que só
// passa cartão na Stone.
// Identificador da Pagar.me (link de pagamento): 10 dígitos começando com 46.
// O NSU da Stone tem 14 dígitos e a autorização 6 caracteres, então não há
// como confundir. O caixa digita esse número no campo do NSU ou no da
// autorização quando o cliente paga pelo link dentro da loja.
export const ehIdPagarme = (v) => /^46\d{8}$/.test(String(v ?? '').trim());

export function ehDaStone(pagamento) {
  const operadora = String(pagamento?.cartao_totvs?.operadora || '').trim();
  if (operadora) return /^STONE/i.test(operadora);
  const cnpj = String(pagamento?.adquirente_cnpj || '').replace(/\D/g, '');
  // 16.501.555 = Stone Instituição de Pagamento
  if (cnpj) return cnpj.startsWith('16501555');
  if (ehIdPagarme(pagamento?.nsu) || ehIdPagarme(pagamento?.autorizacao)) return false;
  return true;
}

export const ehTituloHeadcoach = (t) => t?.origem === 'headcoach' || Number(t?.titulo) < 0;
export const idDoPagamento = (titulo) => Math.abs(Number(titulo));

const STATUS_VENDA = {
  autorizada: 'Normal',
  cancelada: 'Cancelado',
  rejeitada: 'Nota rejeitada',
};

/**
 * Um pagamento em cartão do PDV Crosby → registro que o batimento entende
 * (mesmos campos de agruparTitulos, em services/totvsCartoesStone.js).
 */
export function tituloDoPagamento(pagamento, venda, nota = null) {
  const empresa = Number(venda.empresa);
  const titulo = -Number(pagamento.id);
  const tipoConta = pagamento.forma === 'debito' ? 'Débito' : 'Crédito';
  const bandeira = bandeiraCanonica(pagamento.bandeira) || bandeiraCanonica(pagamento.cartao_totvs?.bandeira);
  const daStone = ehDaStone(pagamento);
  const operadora =
    String(pagamento.cartao_totvs?.operadora || '').trim().toUpperCase() ||
    (!daStone && (ehIdPagarme(pagamento.nsu) || ehIdPagarme(pagamento.autorizacao)) ? 'PAGARME (LINK)' : '');
  const valor = round2(Number(pagamento.valor || 0) - Number(pagamento.troco || 0));
  const parcelas = pagamento.forma === 'debito' ? 1 : Math.max(1, Number(pagamento.parcelas || pagamento.cartao_totvs?.parcelas || 1));
  const status = String(venda.status || '').toLowerCase();
  return {
    origem: 'headcoach',
    chave: `${empresa}|${titulo}`,
    filial: empresa,
    titulo,
    pagamentoId: Number(pagamento.id),
    vendaId: venda.id,
    cliente: venda.cliente_code ?? null,
    cpfCnpj: venda.cliente_cpf_cnpj || null,
    nf: nota?.numero ?? null,
    nfData: nota?.dh_emissao ? diaLocal(nota.dh_emissao) : null,
    nfModelo: nota?.modelo ?? null,
    transacao: venda.id,
    transacaoTotvs: venda.totvs_transacao_code ?? null,
    nomeCliente: venda.cliente_nome || null,
    vendedor: venda.vendedor_nome || null,
    canal: venda.origem || null,
    nsu: pagamento.nsu ? String(pagamento.nsu).trim() : null,
    autorizacao: pagamento.autorizacao ? String(pagamento.autorizacao).trim() : null,
    portadorStone: daStone,
    dataEmissao: diaLocal(venda.criado_em) || (venda.data_caixa ? String(venda.data_caixa).slice(0, 10) : null),
    dataCaixa: venda.data_caixa ? String(venda.data_caixa).slice(0, 10) : null,
    portador: `HEADCOACH - ${operadora || (daStone ? 'STONE' : 'CARTÃO')} ${bandeira ? bandeira.toUpperCase() : ''} (${tipoConta === 'Débito' ? 'D' : 'C'})`.replace(/\s+/g, ' '),
    portadorCodigo: pagamento.cartao_totvs?.portador ?? null,
    bandeira: bandeira || 'Outros',
    bandeiraDesconhecida: !bandeira,
    tipoConta,
    tipoDocumento: tipoConta === 'Débito' ? 5 : 4,
    status: STATUS_VENDA[status] || venda.status || '—',
    statusId: status === 'cancelada' ? 3 : 1,
    cancelado: status === 'cancelada',
    parcelas,
    valor,
    valorPago: 0,
    totalVenda: round2(venda.total || 0),
    primeiroVencimento: null,
    ultimoVencimento: null,
    dataPagamento: null,
    parcelasDetalhe: [],
  };
}

/**
 * Venda do HeadCoach que também foi lançada no TOTVS (espelho) aparece dos
 * dois lados. Quando o título do TOTVS daquela transação está na busca, ele
 * representa a venda e o registro do HeadCoach sai, para não sobrar em
 * duplicidade como "só no sistema".
 */
export function semEspelhadasNoTotvs(titulosHc, titulosTotvs) {
  const noTotvs = new Set(
    (titulosTotvs || []).filter((t) => !ehTituloHeadcoach(t) && t.transacao != null).map((t) => `${t.filial}|${t.transacao}`),
  );
  return (titulosHc || []).filter((t) => !(t.transacaoTotvs != null && noTotvs.has(`${t.filial}|${t.transacaoTotvs}`)));
}
