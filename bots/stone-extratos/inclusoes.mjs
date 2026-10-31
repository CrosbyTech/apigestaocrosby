// =============================================================================
// Inclusão de Pix na Stone (botão APROVAR da Liberação de Pagamento).
//
// Mesma sequência da tela de transferência do portal: cria o Pix pendente, confere
// o que a Stone devolveu (valor e documento do recebedor) e confirma. Quem não é
// aprovador cai em "foi pra aprovação"; o dinheiro só sai quando o Fábio aprova.
//
// O bot NUNCA resolve o desafio da Stone (senha, PIN, código): se ela pedir, para
// e marca "bloqueado". Depois do confirm enviado sem resposta clara, marca
// "verificar" e não repete, para não correr o risco de pagar em dobro.
// =============================================================================
import crypto from 'node:crypto';

const chaveIdem = ({ liberacao_id, valor_centavos, chave_pix }, etapa) =>
  crypto.createHash('sha256').update(`${liberacao_id}|${valor_centavos}|${chave_pix}|${etapa}`).digest('hex').slice(0, 40);

const curto = (r) => String(r?.texto || '').replace(/\s+/g, ' ').slice(0, 200);
const pediuDesafio = (r) => /challenge|verification/i.test(`${r?.texto || ''}`);

/** Dígitos visíveis do documento (a Stone mascara CPF) têm que estar no documento esperado. */
export function documentoConfere(esperado, recebido) {
  const visiveis = String(recebido ?? '').replace(/[.\-/\s]/g, '').split(/\D+/).filter((p) => p.length >= 3);
  return visiveis.every((p) => String(esperado).includes(p));
}

/**
 * @param stone instância logada (criarPix / confirmarPix)
 * @param item linha de stone_inclusoes
 * @param contas lista do portal (id, owner_document)
 * @returns { status, stonePagamentoId?, recebedorNome?, recebedorDoc?, erro? }
 */
export async function incluirPix(stone, item, contas) {
  const conta = contas.find((c) => c.id === item.stone_account_id);
  if (!conta) return { status: 'bloqueado', erro: `Conta ${item.conta_final} não aparece para este usuário no portal.` };
  if (!String(conta.owner_document || '').replace(/\D/g, '').endsWith(item.conta_final)) return { status: 'erro', erro: `Conta do portal não termina em ${item.conta_final}.` };

  const criado = await stone.criarPix({
    accountId: item.stone_account_id,
    chave: item.chave_pix,
    valorCentavos: item.valor_centavos,
    descricao: item.descricao,
    idempotencia: chaveIdem(item, 'criar'),
  });
  if (criado.status === 403) return { status: 'bloqueado', erro: `Stone recusou criar o Pix (403): ${curto(criado)}` };
  if (criado.status >= 300 || !criado.json?.id) return { status: 'erro', erro: `Stone não criou o Pix (${criado.status}): ${curto(criado)}` };

  const pix = criado.json;
  const entidade = pix.target?.entity || {};
  const resultado = { stonePagamentoId: pix.id, recebedorNome: entidade.name || null, recebedorDoc: entidade.document || null };
  // conferência antes de confirmar: daqui para a frente o pagamento vai para o Fábio
  if (pix.amount != null && Number(pix.amount) !== item.valor_centavos) return { ...resultado, status: 'erro', erro: `Valor devolvido pela Stone (${pix.amount}) difere do título (${item.valor_centavos}).` };
  if (['cpf', 'cnpj'].includes(item.chave_tipo) && !documentoConfere(item.chave_pix, entidade.document)) return { ...resultado, status: 'erro', erro: `Documento do recebedor (${entidade.document}) não bate com a chave.` };

  let confirmado;
  try {
    confirmado = await stone.confirmarPix({ id: pix.id, valorCentavos: item.valor_centavos, descricao: item.descricao, idempotencia: chaveIdem(item, 'confirmar') });
  } catch (e) {
    return { ...resultado, status: 'verificar', erro: `Sem resposta da Stone ao confirmar (${e.message}): confira no portal antes de repetir.` };
  }
  if (confirmado.status < 300) return { ...resultado, status: 'incluido' };
  if (pediuDesafio(confirmado)) return { ...resultado, status: 'bloqueado', erro: 'A Stone pediu senha ou código para confirmar: o bot não resolve isso.' };
  if (confirmado.status === 401 || confirmado.status === 403) return { ...resultado, status: 'bloqueado', erro: `Stone recusou confirmar (${confirmado.status}): ${curto(confirmado)}` };
  if (confirmado.status >= 500) return { ...resultado, status: 'verificar', erro: `Stone ${confirmado.status} ao confirmar: confira no portal antes de repetir.` };
  return { ...resultado, status: 'erro', erro: `Stone recusou confirmar (${confirmado.status}): ${curto(confirmado)}` };
}
