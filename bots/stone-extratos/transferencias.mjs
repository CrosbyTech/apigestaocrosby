// =============================================================================
// Transferência ENTRE CONTAS da Stone (botão TRANSFERIR do HeadCoach).
//
// É um Pix da conta de origem para a chave aleatória da conta de destino, pela
// mesma sequência da inclusão de pagamentos (inclusoes.mjs): cria o Pix pendente,
// confere o que a Stone devolveu e confirma. Quem não é aprovador cai em "foi pra
// aprovação"; o dinheiro só sai quando o Fábio aprova no app.
//
// Duas travas a mais do que no pagamento a fornecedor:
//   • o recebedor que a Stone devolve TEM que ser o CNPJ da conta de destino do
//     grupo; se não for (chave trocada, conta errada), o bot NÃO confirma;
//   • "todo o saldo" usa o saldo lido na hora, em centavos inteiros; conta sem
//     saldo não gera Pix.
// Nada aqui lida com senha: o que a Stone pedir no confirmar é tratado (ou não)
// pelo inclusoes.mjs, do jeito que ele já faz.
// =============================================================================
import { incluirPix } from './inclusoes.mjs';

/**
 * @param stone  instância logada
 * @param item   linha de stone_transferencias (processando)
 * @param contas lista do portal (id, owner_document)
 * @returns { status, valorCentavos, stonePagamentoId?, recebedorNome?, recebedorDoc?, erro? }
 */
export async function incluirTransferencia(stone, item, contas) {
  if (!item.destino_chave || !item.destino_cnpj) return { status: 'erro', erro: 'Transferência sem a chave ou o CNPJ da conta de destino.' };
  if (item.origem_account_id === item.destino_account_id) return { status: 'erro', erro: 'Origem e destino são a mesma conta.' };
  let valor = Number(item.valor_centavos);
  if (item.tudo) {
    let saldo;
    try {
      saldo = await stone.saldo(item.origem_account_id);
    } catch (e) {
      return { status: 'erro', erro: `Não consegui ler o saldo da conta ${item.origem_final}: ${e.message}` };
    }
    valor = Math.floor(Number(saldo?.balance));
    if (!(valor > 0)) return { status: 'erro', erro: `A conta ${item.origem_final} está sem saldo para transferir.` };
  }
  if (!Number.isInteger(valor) || valor <= 0) return { status: 'erro', erro: 'Valor da transferência inválido.' };
  const r = await incluirPix(
    stone,
    {
      liberacao_id: `entre-contas-${item.id}`, // só entra na chave de idempotência
      stone_account_id: item.origem_account_id,
      conta_final: item.origem_final,
      chave_pix: item.destino_chave,
      chave_tipo: 'evp',
      valor_centavos: valor,
      descricao: item.descricao || `Entre contas ${item.origem_final} > ${item.destino_final}`,
      recebedor_cnpj_esperado: item.destino_cnpj,
    },
    contas,
  );
  return { ...r, valorCentavos: valor };
}
