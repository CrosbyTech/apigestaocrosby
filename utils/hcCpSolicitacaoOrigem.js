// ============================================================
// Duplicata do Contas a Pagar HeadCoach que nasceu de uma Solicitação Crosby:
// o que a Liberação de Pagamento mostra da solicitação ao abrir os detalhes
// (quem pediu, por quê, observação, aprovações e anexos). Só leitura.
// ============================================================
import { ORIGEM_SOLICITACAO } from './solicitacaoCp.js';

export const veioDeSolicitacao = (t) => t?.origem === ORIGEM_SOLICITACAO && !!t?.origem_ref;

const texto = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};
const lista = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      const j = JSON.parse(v);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
};

/** Anexos da solicitação, na ordem em que interessam a quem vai pagar. */
export function anexosDaSolicitacao(s) {
  const out = [];
  const por = (rotulo, url) => {
    const u = texto(url);
    if (u && /^https?:\/\//i.test(u) && !out.some((a) => a.url === u)) out.push({ rotulo, url: u });
  };
  por('Nota fiscal', s?.nota_fiscal_url);
  por('Anexo do pedido', s?.comprovante_url);
  por('Aprovação do gestor', s?.comprovante_gestor_url);
  por('Aprovação do Fábio', s?.comprovante_fabio_url);
  lista(s?.imagens_exemplo_urls).forEach((u, i) => por(`Imagem ${i + 1}`, typeof u === 'string' ? u : u?.url));
  por('Link de exemplo', s?.link_exemplo);
  por('Comprovante de pagamento', s?.comprovante_pagamento_url);
  return out;
}

/** Resumo da solicitação para a tela (campos vazios ficam nulos). */
export function resumoDaSolicitacao(s) {
  if (!s) return null;
  const contatos = lista(s.contatos_prestadores)
    .map((c) => (typeof c === 'string' ? c : [c?.nome, c?.telefone || c?.contato, c?.valor ? `R$ ${c.valor}` : null].filter(Boolean).join(' · ')))
    .map(texto)
    .filter(Boolean);
  return {
    id: s.id,
    solicitante: texto(s.solicitante),
    setor: texto(s.setor),
    tipo: texto(s.tipo_solicitacao),
    urgencia: texto(s.nivel_urgencia),
    status: texto(s.status),
    dataSolicitacao: s.data_solicitacao || s.created_at || null,
    descricao: texto(s.descricao),
    observacao: texto(s.observacao),
    observacaoConclusao: texto(s.observacao_conclusao),
    marcaModelo: texto(s.marca_modelo),
    recomendacaoFornecedores: texto(s.recomendacao_fornecedores),
    produtoServico: texto(s.produto_servico),
    patrimonio: texto(s.patrimonio),
    fornecedor: texto(s.supplier_name),
    valor: s.valor_total != null ? Number(s.valor_total) : null,
    vencimento: s.dt_vencimento || null,
    formaPagamento: texto(s.forma_pagamento),
    aprovadoGestor: s.aprovado_gestor_em ? { por: texto(s.aprovado_gestor_por_nome), em: s.aprovado_gestor_em } : null,
    aprovadoFinanceiro: s.aprovado_financeiro_em ? { por: texto(s.aprovado_financeiro_por_nome), em: s.aprovado_financeiro_em } : null,
    temNotaFiscal: s.tem_nota_fiscal === true || s.tem_nota_fiscal === 'true',
    nfChamadoDryland: texto(s.nf_chamado_dryland_numero),
    nfEscrituradaEm: s.nf_escriturado_em || null,
    contatos,
    anexos: anexosDaSolicitacao(s),
  };
}
