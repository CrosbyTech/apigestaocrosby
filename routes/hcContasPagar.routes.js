// ============================================================================
// /api/hc/contas-pagar — HEADCOACH › CONTAS A PAGAR (services/hcContasPagar.js).
// Exige login; o módulo é só para owner, admin e financeiro.
//   GET  /opcoes                        empresas, formas, tipos de documento, despesas, portadores, centros de custo
//   GET  /fornecedores?q=               busca no cadastro local (código, CPF/CNPJ ou nome)
//   GET  /titulos?empresa&campoData&de&ate&situacao&fornecedor&duplicata&documentoFiscal&despesa&centroCusto&portador&forma&previsao&origem&escrituracao
//                                       situacao: aberto | vencido | a_vencer | parcial | pago (inclui o já pago das parciais) | cancelado
//   POST /titulos                       inclui a duplicata (uma ou várias parcelas)
//   GET  /titulos/:id                   detalhe (parcelas do mesmo lote, baixas, link do anexo)
//   PUT  /titulos/:id                   altera (só em aberto)
//   POST /titulos/:id/baixar            { dataPagamento, valorPago?, juros, multa, desconto, formaPagamento, conta, observacao, senha }  (sem estorno)
//                                       valorPago em branco = tudo o que falta; menor = BAIXA PARCIAL (continua em aberto pelo restante)
//   POST /titulos/:id/cancelar          { motivo, senha }  (só em aberto)
//   POST /titulos/escrituracao          { ids, escrituracao: pendente | escriturada | null }  troca o status de escrituração da nota fiscal (null = tira a marca)
//   — Liberação de Pagamento (HEADCOACH › FINANCEIRO): pendente → previsão → aprovado → incluído → pago —
//   GET  /liberacoes/opcoes             empresas, etapas, bancos e formas
//   GET  /liberacoes/saldos             saldo bancário (total, por banco, contas Stone, Pagar.me) e a hora da última atualização
//   GET  /liberacoes?empresa&de&ate     tudo o que está em andamento + pagos do período (de/ate = data do pagamento)
//   POST /liberacoes                    { ids (duplicatas), dataPrevista? }  LIBERAR PARA PAGAMENTO (entra como pendente)
//   PUT  /liberacoes/:id                { dataPrevista, banco, formaPagamento, valor, observacao, chavePix, codigoBarras }
//                                       chavePix / codigoBarras são gravados na duplicata (não mudam depois de incluída no banco)
//   POST /liberacoes/status             { ids, status: pendente|previsao|aprovado|incluido, dataPrevista? }
//                                       ao APROVAR, a que tem banco "STONE 0000" e chave Pix vai para o bot incluir na Stone
//   POST /liberacoes/incluir-stone      { ids }  reenvia ao bot as aprovadas cuja inclusão não chegou à Stone
//   POST /liberacoes/banco              { ids, banco }  o mesmo banco para várias liberações de uma vez (vazio = limpar)
//   POST /liberacoes/pagar              DESLIGADO em 27/11/2026 (Yago): todo pagamento tem de estar ligado a uma linha do extrato —
//                                       a baixa sai pela baixa automática ou casando a saída do banco (abaixo)
//   GET  /liberacoes/saidas-sem-baixa?de  saídas dos bancos sem baixa nem inclusão, com as duplicatas em aberto que podem casar e a
//                                       sugestão de fornecedor/despesa para gerar a duplicata; traz também as baixas sem linha do extrato
//   POST /liberacoes/saidas-sem-baixa/casar  { lancamentoId, tituloId }  concilia a saída com a duplicata e dá a baixa
//                                       (valor igual quita; maior = juros e multa; menor = parcial; previsão passa a valer a saída)
//   POST /liberacoes/saidas-sem-baixa/gerar  { lancamentoId, fornecedorCode, despesaCode, centroCustoCode? }  cria a duplicata pela saída, já baixada
//   POST /liberacoes/devolver           { ids, motivo }  volta para o contas a pagar
//   POST /liberacoes/baixa-automatica   { confirmar?, ids?, escolhidas?, senha? }  confere as INCLUÍDAS nos extratos (hoje e 30 dias para trás);
//                                       sem confirmar = só mostra o que achou (casadas + sugestoes + semSaida); com confirmar + senha = grava a
//                                       baixa das ids e das escolhidas [{ id, lancamentoId }] (sugestões que o usuário marcou e aprovou)
//   POST /totvs/liberar                 { itens } títulos da Consulta antiga (TOTVS) → cria a duplicata aqui (em aberto) e manda para a Liberação de Pagamento do HeadCoach
//   POST /solicitacoes/:id/enviar       Solicitação Crosby aprovada (ou no status Nota Fiscal: a duplicata nasce NÃO ESCRITURADA) → duplicata no contas a pagar (financeiro ou setor FINANCEIRO)
//   POST /solicitacoes/:id/liberar      Solicitação Crosby (enviada ou Nota Fiscal) → Liberação de Pagamento do HeadCoach (cria a duplicata se ainda não existir)
// ============================================================================
import express from 'express';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/auth.js';
import { enviarSolicitacaoAoCp, liberarSolicitacaoParaPagamento } from '../services/solicitacaoContasPagar.js';
import { opcoesDaLiberacao, listarLiberacoes, liberarTitulos, mudarStatus, editarLiberacao, devolverLiberacoes, reenviarAoBot, definirBanco } from '../services/hcCpLiberacao.js';
import { baixaAutomatica } from '../services/hcCpBaixaAutomatica.js';
import { saidasSemBaixa, casarSaida, gerarDuplicataDaSaida } from '../services/hcCpSaidasSemBaixa.js';
import { enviarDoTotvsParaLiberacao } from '../services/hcCpDoTotvs.js';
import { mudarEscrituracao, sincronizarEscrituracaoDasSolicitacoes } from '../services/hcCpEscrituracao.js';
import { montarSaldos } from '../services/relatorioSaldosWhatsapp.js';
import { CpError, opcoes, buscarFornecedores, listarTitulos, criarTitulos, duplicatasDoFornecedor, detalheTitulo, editarTitulo, baixarTitulo, cancelarTitulo } from '../services/hcContasPagar.js';

const router = express.Router();
router.use(requireAuth);

const rota = (fn, msg) =>
  asyncHandler(async (req, res) => {
    try {
      const r = await fn(req);
      return successResponse(res, r, typeof msg === 'function' ? msg(r) : msg);
    } catch (err) {
      if (err instanceof CpError) return errorResponse(res, err.message, err.status, err.code);
      console.error('[hc/contas-pagar]', err);
      return errorResponse(res, err.message || 'Erro no contas a pagar', 500, 'HC_CP');
    }
  });

router.get('/opcoes', rota((req) => opcoes(req.user), 'Opções'));
router.get('/fornecedores', rota(async (req) => ({ fornecedores: await buscarFornecedores(req.user, req.query?.q) }), 'Fornecedores'));
router.get('/duplicatas', rota((req) => duplicatasDoFornecedor(req.user, req.query || {}), 'Duplicatas do fornecedor'));
router.get(
  '/titulos',
  rota(async (req) => {
    await sincronizarEscrituracaoDasSolicitacoes(); // chamado de escrituração concluído → a duplicata já aparece ESCRITURADA
    return listarTitulos(req.user, req.query || {});
  }, 'Duplicatas'),
);
router.post('/titulos', rota((req) => criarTitulos(req.user, req.body || {}), (r) => `${r.titulos.length} duplicata(s) incluída(s)`));
router.get('/titulos/:id', rota((req) => detalheTitulo(req.user, req.params.id), 'Duplicata'));
router.put('/titulos/:id', rota((req) => editarTitulo(req.user, req.params.id, req.body || {}), 'Duplicata alterada'));
router.post('/titulos/:id/baixar', rota((req) => baixarTitulo(req.user, req.params.id, req.body || {}), (r) => (r.baixaParcial ? `Baixa parcial lançada — falta pagar R$ ${Number(r.faltaPagar).toFixed(2).replace('.', ',')}` : 'Duplicata baixada')));
router.post('/titulos/:id/cancelar', rota((req) => cancelarTitulo(req.user, req.params.id, req.body || {}), 'Duplicata cancelada'));
// Consulta antiga do Contas a Pagar: o "Enviar para Pagamento" cria a duplicata aqui e libera na Liberação do HeadCoach
router.post(
  '/totvs/liberar',
  rota(
    (req) => enviarDoTotvsParaLiberacao(req.user, req.body || {}),
    (r) => `${r.liberadas} título(s) na Liberação de Pagamento HeadCoach${r.criadas ? ` · ${r.criadas} duplicata(s) criada(s) no Contas a Pagar HeadCoach` : ''}${r.jaExistiam ? ` · ${r.jaExistiam} já existia(m) lá` : ''}${r.ignoradas.length ? ` · ${r.ignoradas.length} ficou(aram) de fora (${r.ignoradas[0].rotulo}: ${r.ignoradas[0].motivo})` : ''}`,
  ),
);
// Solicitações Crosby: o "Enviar ao Contas a Pagar HC" (no lugar do antigo envio ao TOTVS)
router.post('/solicitacoes/:id/enviar', rota((req) => enviarSolicitacaoAoCp(req.user, req.params.id), (r) => (r.jaEnviada ? `Esta solicitação já estava no contas a pagar (duplicata ${r.rotulo})` : `Solicitação enviada ao contas a pagar — duplicata ${r.rotulo}${r.escrituracao === 'pendente' ? ' · marcada como NÃO ESCRITURADA' : ''}`)));
// Solicitações Crosby: o "Liberar para Pagamento" cai na Liberação de Pagamento do HeadCoach
router.post('/solicitacoes/:id/liberar', rota((req) => liberarSolicitacaoParaPagamento(req.user, req.params.id), (r) => (r.jaLiberada ? `Esta solicitação já estava na Liberação de Pagamento (duplicata ${r.rotulo})` : `Solicitação liberada para pagamento — duplicata ${r.rotulo} na Liberação de Pagamento HeadCoach`)));

// ─── Liberação de Pagamento ──────────────────────────────────────────────────
const tantas = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const comIgnoradas = (texto, r) => (r.ignoradas?.length ? `${texto} · ${tantas(r.ignoradas.length, 'ficou de fora', 'ficaram de fora')} (${r.ignoradas[0].rotulo}: ${r.ignoradas[0].motivo}${r.ignoradas.length > 1 ? '…' : ''})` : texto);
// Escrituração da nota fiscal: troca o status de uma ou várias duplicatas
router.post('/titulos/escrituracao', rota((req) => mudarEscrituracao(req.user, req.body || {}), (r) => comIgnoradas(`${tantas(r.alteradas, 'duplicata marcada', 'duplicatas marcadas')} como ${r.escrituracao === 'escriturada' ? 'ESCRITURADA' : r.escrituracao === 'pendente' ? 'NÃO ESCRITURADA' : 'sem marca de escrituração'}`, r)));
router.get('/liberacoes/opcoes', rota((req) => opcoesDaLiberacao(req.user), 'Opções da liberação'));
router.get(
  '/liberacoes',
  rota(async (req) => {
    await sincronizarEscrituracaoDasSolicitacoes();
    return listarLiberacoes(req.user, req.query || {});
  }, 'Liberação de pagamento'),
);
// saldo bancário do card da tela (só o financeiro; o acesso é conferido como nas opções)
router.get(
  '/liberacoes/saldos',
  rota(async (req) => {
    await opcoesDaLiberacao(req.user);
    return montarSaldos();
  }, 'Saldo bancário'),
);
router.post('/liberacoes', rota((req) => liberarTitulos(req.user, req.body || {}), (r) => comIgnoradas(`${tantas(r.liberadas, 'duplicata liberada', 'duplicatas liberadas')} para pagamento`, r)));
const resumoDoBot = (i) => (!i ? '' : [i.naFila ? ` · ${tantas(i.naFila, 'foi para o bot incluir na Stone (Pix)', 'foram para o bot incluir na Stone (Pix)')}` : '', i.manuais?.length ? ` · ${tantas(i.manuais.length, 'fica para incluir à mão', 'ficam para incluir à mão')} (${i.manuais[0].motivo})` : '', i.comErro?.length ? ` · ${i.comErro.length} com erro (${i.comErro[0].motivo})` : '', i.falha ? ` · a fila do bot falhou: ${i.falha}` : ''].join(''));
router.post('/liberacoes/status', rota((req) => mudarStatus(req.user, req.body || {}), (r) => comIgnoradas(`${tantas(r.alteradas, 'liberação movida', 'liberações movidas')}`, r) + resumoDoBot(r.inclusao)));
router.post('/liberacoes/banco', rota((req) => definirBanco(req.user, req.body || {}), (r) => comIgnoradas(`${r.banco ? `Banco ${r.banco}` : 'Banco limpo'} em ${tantas(r.alteradas, 'liberação', 'liberações')}`, r)));
router.post('/liberacoes/incluir-stone', rota((req) => reenviarAoBot(req.user, req.body || {}), (r) => `Envio ao bot${resumoDoBot(r.inclusao) || ' · nada novo para enviar'}`));
// PAGAR manual DESLIGADO (Yago, 27/11/2026): "todo pagamento deve ser linkado a uma linha e dado baixa automática"
router.post('/liberacoes/pagar', (_req, res) => errorResponse(res, 'O pagamento manual foi desligado: a baixa sai pela Baixa automática (aba Incluídos) ou casando a saída do banco com a duplicata.', 410, 'PAGAR_MANUAL_DESLIGADO'));
// Saídas do banco sem baixa nem inclusão: casar com uma duplicata em aberto ou gerar a duplicata
router.get('/liberacoes/saidas-sem-baixa', rota((req) => saidasSemBaixa(req.user, req.query || {}), (r) => `${tantas(r.saidas.length, 'saída do banco sem baixa', 'saídas do banco sem baixa')}`));
const comoCasou = (r) => (r.tipo === 'acrescimo' ? ` com R$ ${Number(r.juros).toFixed(2).replace('.', ',')} de juros e multa` : r.tipo === 'parcial' ? ` · baixa parcial, faltam R$ ${Number(r.resta).toFixed(2).replace('.', ',')}` : r.tipo === 'previsao' ? ' · a previsão passou a valer o valor da saída' : '');
router.post('/liberacoes/saidas-sem-baixa/casar', rota((req) => casarSaida(req.user, req.body || {}), (r) => `Saída casada com ${r.titulo.fornecedor} ${r.titulo.rotulo}: baixa de R$ ${Number(r.pago).toFixed(2).replace('.', ',')}${comoCasou(r)}${r.aviso ? ` · ATENÇÃO: ${r.aviso}` : ''}`));
router.post('/liberacoes/saidas-sem-baixa/gerar', rota((req) => gerarDuplicataDaSaida(req.user, req.body || {}), (r) => `Duplicata ${r.duplicata} de ${r.fornecedor} gerada pela saída, já baixada e conciliada`));
router.post('/liberacoes/devolver', rota((req) => devolverLiberacoes(req.user, req.body || {}), (r) => comIgnoradas(`${tantas(r.devolvidas, 'devolvida', 'devolvidas')} ao contas a pagar`, r)));
router.post(
  '/liberacoes/baixa-automatica',
  rota(
    (req) => baixaAutomatica(req.user, req.body || {}),
    (r) =>
      r.simulacao
        ? `${tantas(r.casadas.length, 'pagamento achado', 'pagamentos achados')} nos extratos de ${r.incluidas} incluída(s)${r.sugestoes?.length ? ` · ${tantas(r.sugestoes.length, 'sugestão para você conferir', 'sugestões para você conferir')}` : ''}`
        : comIgnoradas(`${tantas(r.pagas, 'duplicata baixada', 'duplicatas baixadas')} pelo extrato · R$ ${Number(r.valorPago).toFixed(2).replace('.', ',')}`, r),
  ),
);
router.put('/liberacoes/:id', rota((req) => editarLiberacao(req.user, req.params.id, req.body || {}), (r) => (r.aviso ? `Liberação alterada · ${r.aviso}` : 'Liberação alterada')));

export default router;
