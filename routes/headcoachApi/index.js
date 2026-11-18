// ============================================================================
// API HEADCOACH — consultas (somente leitura) para o Dryland e outros sistemas.
// Montada em /api/headcoach (ver index.js). Organização igual à do TOTVS Moda:
//     /api/headcoach/<módulo>/v1/<recurso>
// Documentação (aberta, não devolve dado nenhum):
//     GET /api/headcoach/docs          página Swagger
//     GET /api/headcoach/openapi.json  especificação OpenAPI 3
//     GET /api/headcoach/guide         o mesmo conteúdo em texto (Markdown)
// Os recursos exigem a chave de acesso (HEADCOACH_API_KEYS).
// Como acrescentar um recurso: declare-o no arquivo do módulo com
// modulo.recurso({...}) — a rota e a documentação saem da mesma declaração.
// ============================================================================
import express from 'express';
import { exigirChave, montarOpenApi, montarGuia, paginaDocs, BASE } from './_engine.js';
import general from './general.js';
import transaction from './transaction.js';
import fiscal from './fiscal.js';
import accountsReceivable from './accountsReceivable.js';
import customerBalance from './customerBalance.js';
import cashier from './cashier.js';
import billing from './billing.js';
import returns from './returns.js';
import { transfer, goodsReceipt } from './transfer.js';
import stock from './stock.js';
import salePanel from './salePanel.js';

// a ordem daqui é a ordem em que os módulos aparecem na documentação
export const MODULOS = [general, transaction, fiscal, accountsReceivable, customerBalance, cashier, billing, returns, transfer, goodsReceipt, stock, salePanel];

const router = express.Router();

// documentação: aberta
router.get('/docs', (req, res) => res.type('html').send(paginaDocs()));
router.get('/openapi.json', (req, res) => res.json(montarOpenApi(MODULOS)));
router.get('/guide', (req, res) => res.type('text/markdown; charset=utf-8').send(montarGuia(MODULOS)));
// índice dos módulos (com a chave): serve para testar o acesso
router.get('/', exigirChave, (req, res) =>
  res.json({
    name: 'API HeadCoach — consultas',
    client: req.apiCliente,
    docs: `${BASE}/docs`,
    openapi: `${BASE}/openapi.json`,
    guide: `${BASE}/guide`,
    modules: MODULOS.map((m) => ({ module: m.nome, title: m.titulo, description: m.descricao, resources: m.rotas.map((r) => `GET ${BASE}${r.caminho}`) })),
  }),
);

// só leitura: qualquer outro método é recusado
router.use((req, res, next) => (req.method === 'GET' ? next() : res.status(405).json({ code: 'MethodNotAllowed', message: 'Esta API é somente leitura: use GET', detailedMessage: null })));

const protegido = express.Router();
protegido.use(exigirChave);
for (const m of MODULOS) m.registrar(protegido);
protegido.use((req, res) => res.status(404).json({ code: 'NotFound', message: 'Recurso não encontrado', detailedMessage: `Veja a lista em ${BASE}/docs.` }));
router.use(protegido);

export default router;
