// =============================================================================
// Inclusão de Pix na Stone (botão APROVAR da Liberação de Pagamento).
//
// Mesma sequência da tela de transferência do portal: cria o Pix pendente, confere
// o que a Stone devolveu (valor e documento do recebedor) e confirma. Quem não é
// aprovador cai em "foi pra aprovação"; o dinheiro só sai quando o Fábio aprova.
//
// Se a Stone pedir a senha de 6 dígitos (PIN) no confirmar, o bot tenta UMA vez
// com `config.json → stone.senha` (ou STONE_SENHA). Senha errada marca
// "bloqueado" e NÃO repete, para não bloquear a conta. Sem senha configurada,
// também marca "bloqueado" e explica o que fazer.
// Depois do confirm enviado sem resposta clara, marca "verificar" e não repete,
// para não correr o risco de pagar em dobro.
// =============================================================================
import crypto from 'node:crypto';

const chaveIdem = ({ liberacao_id, valor_centavos, chave_pix }, etapa) =>
  crypto.createHash('sha256').update(`${liberacao_id}|${valor_centavos}|${chave_pix}|${etapa}`).digest('hex').slice(0, 40);

const curto = (r) => String(r?.texto || '').replace(/\s+/g, ' ').slice(0, 200);
const desafioDe = (r) => r?.json?.challenge || r?.json?.data?.challenge || null;
const pediuDesafio = (r) => /challenge_required/i.test(`${r?.json?.type || ''} ${r?.texto || ''}`);
const precisaVerificacao = (r) => /needs_verification|verification_required/i.test(`${r?.json?.type || ''} ${r?.texto || ''}`);
const tentativasRestantes = (r) => {
  const n = r?.json?.details?.remainingAttempts ?? r?.json?.details?.remaining_attempts;
  return n == null || !Number.isFinite(Number(n)) ? null : Number(n);
};

/** Dígitos visíveis do documento (a Stone mascara CPF) têm que estar no documento esperado. */
export function documentoConfere(esperado, recebido) {
  const visiveis = String(recebido ?? '').replace(/[.\-/\s]/g, '').split(/\D+/).filter((p) => p.length >= 3);
  return visiveis.every((p) => String(esperado).includes(p));
}

/**
 * @param stone instância logada (criarPix / confirmarPix / resolverDesafio)
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

  if (pediuDesafio(confirmado)) {
    const challenge = desafioDe(confirmado);
    if (!challenge?.id) {
      return { ...resultado, status: 'bloqueado', erro: 'A Stone pediu senha para confirmar, mas não devolveu o id do desafio. Confirme este Pix no portal.' };
    }
    const tipos = challenge.requiredTypes || challenge.required_types || challenge.requiredType;
    const tipo = String((Array.isArray(tipos) ? tipos[0] : tipos) || 'pin').toLowerCase();
    if (typeof stone.log === 'function') stone.log(`desafio da Stone: tipo "${tipo}"`, 'info');

    let solucao;
    try {
      solucao = await stone.resolverDesafio(challenge);
    } catch (e) {
      return { ...resultado, status: 'bloqueado', erro: `A Stone pediu senha para confirmar e não consegui responder (${e.message}). Configure stone.senha no config.json (senha de 6 dígitos do app) e tente de novo.` };
    }

    // Mesma chave de idempotência do primeiro confirm: é assim que o portal faz.
    let tentativa;
    try {
      tentativa = await stone.confirmarPix({ id: pix.id, valorCentavos: item.valor_centavos, descricao: item.descricao, idempotencia: chaveIdem(item, 'confirmar'), desafio: solucao });
    } catch (e) {
      return { ...resultado, status: 'verificar', erro: `Sem resposta da Stone ao enviar a senha (${e.message}): confira no portal antes de repetir.` };
    }
    if (tentativa.status < 300) return { ...resultado, status: 'incluido' };
    if (/bad_challenge_solution/i.test(`${tentativa.json?.type || ''} ${tentativa.texto || ''}`)) {
      const restam = tentativasRestantes(tentativa);
      return {
        ...resultado,
        status: 'bloqueado',
        erro: `A Stone recusou a senha${restam != null ? ` (restam ${restam} tentativa(s))` : ''}. Corrija stone.senha no config.json; o bot não repete sozinho para não bloquear a conta.`,
      };
    }
    if (pediuDesafio(tentativa) || precisaVerificacao(tentativa)) {
      return { ...resultado, status: 'bloqueado', erro: `A Stone pediu outra verificação além da senha (${curto(tentativa)}). Confirme este Pix no portal.` };
    }
    if (tentativa.status === 401 || tentativa.status === 403) return { ...resultado, status: 'bloqueado', erro: `Stone recusou a senha (${tentativa.status}): ${curto(tentativa)}` };
    if (tentativa.status >= 500) return { ...resultado, status: 'verificar', erro: `Stone ${tentativa.status} ao enviar a senha: confira no portal antes de repetir.` };
    return { ...resultado, status: 'erro', erro: `Stone recusou confirmar (${tentativa.status}): ${curto(tentativa)}` };
  }

  if (precisaVerificacao(confirmado)) return { ...resultado, status: 'bloqueado', erro: `A Stone pediu código de verificação para confirmar (${curto(confirmado)}). O bot não tem esse código; confirme este Pix no portal.` };
  if (confirmado.status === 401 || confirmado.status === 403) return { ...resultado, status: 'bloqueado', erro: `Stone recusou confirmar (${confirmado.status}): ${curto(confirmado)}` };
  if (confirmado.status >= 500) return { ...resultado, status: 'verificar', erro: `Stone ${confirmado.status} ao confirmar: confira no portal antes de repetir.` };
  return { ...resultado, status: 'erro', erro: `Stone recusou confirmar (${confirmado.status}): ${curto(confirmado)}` };
}
