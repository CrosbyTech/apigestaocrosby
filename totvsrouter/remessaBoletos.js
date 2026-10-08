/**
 * Remessa de Boletos (Pagar.me) — base da página Financeiro › Contas a Receber
 * › Remessa Boletos.
 *
 *   GET  /api/totvs/remessa-boletos/faturas?branches=1,2&dt_inicio=YYYY-MM-DD&dt_fim=YYYY-MM-DD
 *   POST /api/totvs/remessa-boletos/cliente   — corrige endereço/telefone/e-mail no TOTVS
 *
 * Lista as FATURAS (tipo de documento 1) em aberto, a vencer no período, das
 * filiais informadas — já com o cadastro do cliente que a Pagar.me exige para
 * emitir boleto (nome, CPF/CNPJ, endereço completo, telefone, e-mail).
 * `cliente.pendencias` diz o que falta no cadastro TOTVS para o boleto sair.
 */
import express from 'express';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { postTotvs } from '../services/bluecardLimite.js';
import { sanitizePayload } from './cadastroCliente.js';
import {
  PORTADORES_REMESSA,
  boletosAtivosPorTitulo,
  emitirBoleto,
  listarBoletos,
  sincronizarRetorno,
} from '../services/pagarmeBoletos.js';

const router = express.Router();

const TP_DOCUMENTO_FATURA = 1;
const PAGE_SIZE = 100;
const PARALELO = 10;
const LOTE_PESSOAS = 50;

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

async function buscarFaturas(filter) {
  const pagina = (page) =>
    postTotvs('/accounts-receivable/v2/documents/search', {
      filter,
      page,
      pageSize: PAGE_SIZE,
      order: 'expiredDate',
    });
  const primeira = await pagina(1);
  const totalPages = primeira.data?.totalPages || 1;
  let itens = [...(primeira.data?.items || [])];
  for (let ini = 2; ini <= totalPages; ini += PARALELO) {
    const fim = Math.min(ini + PARALELO - 1, totalPages);
    const lote = [];
    for (let p = ini; p <= fim; p++) lote.push(pagina(p));
    for (const r of await Promise.all(lote)) itens = itens.concat(r.data?.items || []);
  }
  return itens;
}

// Endereço/telefone/e-mail do cadastro usados no boleto — a edição altera
// exatamente estes mesmos registros (mesma sequência) no TOTVS.
function escolherContatos(item) {
  return {
    end: (item.addresses || []).find((a) => a.cep && a.address) || (item.addresses || [])[0] || {},
    tel: (item.phones || []).find((t) => t.isDefault) || (item.phones || [])[0] || {},
    mail: (item.emails || []).find((e) => e.isDefault) || (item.emails || [])[0] || {},
  };
}

function montarCliente(item, tipo) {
  const { end, tel, mail } = escolherContatos(item);
  const cliente = {
    codigo: item.code,
    tipo, // 'PJ' | 'PF'
    nome: item.name || '',
    fantasia: item.fantasyName || '',
    documento: soDigitos(tipo === 'PJ' ? item.cnpj : item.cpf),
    email: mail.email || '',
    telefone: soDigitos(tel.number),
    endereco: {
      logradouro: end.address || '',
      numero: end.addressNumber ? String(end.addressNumber) : '',
      complemento: end.complement || '',
      bairro: end.neighborhood || '',
      cidade: end.cityName || '',
      uf: end.stateAbbreviation || '',
      cep: soDigitos(end.cep),
    },
  };
  const pend = [];
  if (!cliente.nome) pend.push('nome');
  if (![11, 14].includes(cliente.documento.length)) pend.push('CPF/CNPJ');
  if (!cliente.endereco.logradouro) pend.push('endereço');
  if (cliente.endereco.cep.length !== 8) pend.push('CEP');
  if (!cliente.endereco.cidade) pend.push('cidade');
  if (!cliente.endereco.uf) pend.push('UF');
  if (cliente.telefone.length < 10) pend.push('telefone');
  cliente.pendencias = pend;
  return cliente;
}

/** { [code]: cliente } — PJ e PF em paralelo, em lotes. PJ tem prioridade. */
async function buscarClientes(codigos) {
  const mapa = {};
  for (let i = 0; i < codigos.length; i += LOTE_PESSOAS) {
    const lote = codigos.slice(i, i + LOTE_PESSOAS);
    const payload = {
      filter: { personCodeList: lote },
      expand: 'addresses,phones,emails',
      page: 1,
      pageSize: lote.length,
    };
    const [pj, pf] = await Promise.all([
      postTotvs('/person/v2/legal-entities/search', payload).catch(() => null),
      postTotvs('/person/v2/individuals/search', payload).catch(() => null),
    ]);
    for (const it of pj?.data?.items || []) mapa[it.code] = montarCliente(it, 'PJ');
    for (const it of pf?.data?.items || []) {
      if (!mapa[it.code]) mapa[it.code] = montarCliente(it, 'PF');
    }
  }
  return mapa;
}

router.get(
  '/remessa-boletos/faturas',
  asyncHandler(async (req, res) => {
    const inicio = Date.now();
    const hoje = new Date().toISOString().slice(0, 10);
    const { branches, dt_inicio = hoje, dt_fim } = req.query;

    const branchCodeList = String(branches || '')
      .split(',')
      .map((b) => parseInt(b.trim(), 10))
      .filter((b) => !isNaN(b) && b > 0);
    if (!branchCodeList.length) {
      return errorResponse(res, 'Informe ao menos uma filial (branches)', 400, 'MISSING_PARAMS');
    }
    if (!dt_fim) {
      return errorResponse(res, 'Parâmetro dt_fim é obrigatório', 400, 'MISSING_PARAMS');
    }
    // "A vencer": nunca antes de hoje.
    const de = dt_inicio < hoje ? hoje : dt_inicio;

    const { items, tabelaAusente } = await carregarFaturas(
      {
        branchCodeList,
        startExpiredDate: `${de}T00:00:00`,
        endExpiredDate: `${dt_fim}T23:59:59`,
      },
      de,
    );

    return successResponse(
      res,
      {
        items,
        total: items.length,
        valorTotal: Number(items.reduce((s, i) => s + i.vl_fatura, 0).toFixed(2)),
        comPendencia: items.filter((i) => i.cliente.pendencias?.length).length,
        portadoresRemessa: PORTADORES_REMESSA,
        tabelaAusente,
        periodo: { de, ate: dt_fim },
        timeMs: Date.now() - inicio,
      },
      'Faturas a vencer para remessa de boletos',
    );
  }),
);

/**
 * Faturas (tipo 1) em aberto que casam com `filtro`, com o cadastro do cliente
 * e o boleto Pagar.me já emitido (`pagarme`), se houver.
 */
async function carregarFaturas(filtro, de) {
  const brutos = await buscarFaturas({
    statusList: [1],
    documentTypeList: [TP_DOCUMENTO_FATURA],
    hasOpenInvoices: true,
    dischargeTypeList: [0],
    ...filtro,
  });

  // O TOTVS às vezes ignora parte do filtro — reaplica localmente.
  const abertos = brutos.filter(
    (t) =>
      t.status === 1 &&
      Number(t.documentType ?? TP_DOCUMENTO_FATURA) === TP_DOCUMENTO_FATURA &&
      !t.paymentDate &&
      !t.settlementDate &&
      String(t.expiredDate || '').slice(0, 10) >= de,
  );

  const codigos = [...new Set(abertos.map((t) => Number(t.customerCode)).filter(Boolean))];
  const [clientes, ativos] = await Promise.all([
    buscarClientes(codigos),
    boletosAtivosPorTitulo(abertos.map((t) => t.receivableCode)),
  ]);

  const items = abertos.map((t) => ({
    cd_empresa: t.branchCode,
    cd_cliente: t.customerCode,
    nr_fatura: t.receivableCode,
    nr_parcela: t.installmentCode ?? 1,
    dt_emissao: (t.issueDate || '').slice(0, 10) || null,
    dt_vencimento: (t.expiredDate || '').slice(0, 10) || null,
    vl_fatura: Number(t.installmentValue || 0),
    cd_portador: t.bearerCode ?? null,
    nm_portador: t.bearerName ?? null,
    // carteira de cobrança no TOTVS: 0 = não está em cobrança, 1 = simples, 2 = descontada
    tp_cobranca: t.chargeType ?? null,
    // já existe boleto registrado no banco do portador para este título
    boleto_registrado: Boolean(t.digitableLine || t.barCode),
    nosso_numero: t.ourNumber ?? null,
    // boleto Pagar.me já emitido pelo HeadCoach (portador "PAGARME" só aqui)
    pagarme: ativos.mapa[`${t.branchCode}-${t.receivableCode}-${t.installmentCode ?? 1}`] || null,
    cliente: clientes[t.customerCode] || {
      codigo: t.customerCode,
      nome: t.customerName || '',
      pendencias: ['cadastro não encontrado'],
    },
  }));
  return { items, tabelaAusente: ativos.tabelaAusente };
}

// POST /remessa-boletos/gerar
// Body: { faturas: [{ cd_empresa, cd_cliente, nr_fatura, nr_parcela }], usuario, remessaId? }
// Relê cada fatura no TOTVS (valor/vencimento/portador não vêm do navegador),
// emite o boleto na Pagar.me e põe a carteira como Simples no TOTVS.
const MAX_POR_CHAMADA = 25;
router.post(
  '/remessa-boletos/gerar',
  asyncHandler(async (req, res) => {
    const { faturas, usuario } = req.body || {};
    if (!Array.isArray(faturas) || faturas.length === 0) {
      return errorResponse(res, 'Informe as faturas da remessa', 400, 'INVALID_PAYLOAD');
    }
    if (faturas.length > MAX_POR_CHAMADA) {
      return errorResponse(res, `Máximo de ${MAX_POR_CHAMADA} faturas por chamada`, 400, 'TOO_MANY');
    }
    const remessaId = String(req.body.remessaId || `R${Date.now()}`);
    const hoje = new Date().toISOString().slice(0, 10);
    const chaveDe = (f) => `${Number(f.cd_empresa)}-${Number(f.nr_fatura)}-${Number(f.nr_parcela || 1)}`;
    const pedidas = new Set(faturas.map(chaveDe));

    const { items, tabelaAusente } = await carregarFaturas(
      {
        branchCodeList: [...new Set(faturas.map((f) => Number(f.cd_empresa)))],
        customerCodeList: [...new Set(faturas.map((f) => Number(f.cd_cliente)))],
        receivableCodeList: [...new Set(faturas.map((f) => Number(f.nr_fatura)))],
      },
      hoje,
    );
    if (tabelaAusente) {
      return errorResponse(
        res,
        'Tabela pagarme_boletos não existe — rode migrations/pagarme_boletos.sql no Supabase',
        503,
        'MIGRATION_PENDING',
      );
    }
    const porChave = new Map(items.filter((i) => pedidas.has(chaveDe(i))).map((i) => [chaveDe(i), i]));

    const resultados = [];
    for (const chave of pedidas) {
      const fatura = porChave.get(chave);
      if (!fatura) {
        resultados.push({ ok: false, chave, motivo: 'fatura não está mais em aberto/a vencer no TOTVS' });
        continue;
      }
      try {
        resultados.push(await emitirBoleto(fatura, { remessaId, usuario }));
      } catch (e) {
        console.error(`❌ [remessa-boletos] ${chave}:`, e.message);
        resultados.push({ ok: false, chave, motivo: e.message });
      }
    }

    const emitidos = resultados.filter((r) => r.ok).length;
    console.log(
      `🧾 [remessa-boletos] remessa ${remessaId}: ${emitidos}/${resultados.length} boleto(s) emitido(s) por ${usuario || '?'}`,
    );
    return successResponse(
      res,
      { remessaId, emitidos, falhas: resultados.length - emitidos, resultados },
      'Remessa processada',
    );
  }),
);

// GET /remessa-boletos/boletos?branches=&dt_inicio=&dt_fim=&modo=vencimento|emissao|pagamento
router.get(
  '/remessa-boletos/boletos',
  asyncHandler(async (req, res) => {
    const branches = String(req.query.branches || '')
      .split(',')
      .map((b) => parseInt(b.trim(), 10))
      .filter((b) => !isNaN(b) && b > 0);
    const dados = await listarBoletos({
      branches,
      dt_inicio: req.query.dt_inicio,
      dt_fim: req.query.dt_fim,
      modo: req.query.modo,
    });
    return successResponse(res, dados, 'Boletos Pagar.me');
  }),
);

// POST /remessa-boletos/sincronizar — consulta a Pagar.me e baixa os pagos no TOTVS
router.post(
  '/remessa-boletos/sincronizar',
  asyncHandler(async (req, res) => {
    const r = await sincronizarRetorno({ retentarErros: req.body?.retentarErros === true });
    return successResponse(res, r, 'Retorno sincronizado');
  }),
);

async function buscarPessoa(codigo, tipo) {
  const resp = await postTotvs(
    tipo === 'PJ' ? '/person/v2/legal-entities/search' : '/person/v2/individuals/search',
    {
      filter: { personCodeList: [Number(codigo)] },
      expand: 'addresses,phones,emails',
      page: 1,
      pageSize: 1,
    },
  );
  return resp.data?.items?.[0] || null;
}

// POST /remessa-boletos/cliente
// Body: { codigo, tipo: 'PJ'|'PF', endereco: { logradouro, numero, complemento,
//         bairro, cidade, uf, cep }, telefone, email }
// Grava no TOTVS (alteração parcial do cadastro) e devolve o cliente relido.
router.post(
  '/remessa-boletos/cliente',
  asyncHandler(async (req, res) => {
    const { codigo, tipo, endereco = {}, telefone, email } = req.body || {};
    if (!codigo || !['PJ', 'PF'].includes(tipo)) {
      return errorResponse(res, 'codigo e tipo (PJ/PF) são obrigatórios', 400, 'INVALID_PAYLOAD');
    }
    const cep = soDigitos(endereco.cep);
    const fone = soDigitos(telefone);
    if (cep && cep.length !== 8) {
      return errorResponse(res, 'CEP deve ter 8 dígitos', 400, 'INVALID_CEP');
    }
    if (fone && fone.length < 10) {
      return errorResponse(res, 'Telefone deve ter DDD + número', 400, 'INVALID_PHONE');
    }

    const atual = await buscarPessoa(codigo, tipo);
    if (!atual) {
      return errorResponse(res, 'Cliente não encontrado no TOTVS', 404, 'CUSTOMER_NOT_FOUND');
    }
    const { end, tel, mail } = escolherContatos(atual);
    const docField = tipo === 'PJ' ? 'cnpj' : 'cpf';

    const payload = sanitizePayload({
      [docField]: soDigitos(atual[docField]),
      name: atual.name,
      branchInsertCode: parseInt(atual.branchInsertCode, 10) || 1,
      insertDate: new Date().toISOString(),
      // TOTVS rejeita addresses sem cep
      addresses: cep
        ? [
            {
              sequenceCode: end.sequenceCode,
              addressType: end.addressType || (tipo === 'PJ' ? 'Commercial' : 'Residential'),
              publicPlace: end.publicPlace,
              address: String(endereco.logradouro || '').trim().toUpperCase(),
              number: String(endereco.numero || '').trim(),
              complement: String(endereco.complemento || '').trim().toUpperCase(),
              neighborhood: String(endereco.bairro || '').trim().toUpperCase(),
              cityName: String(endereco.cidade || '').trim().toUpperCase(),
              stateAbbreviation: String(endereco.uf || '').trim().toUpperCase(),
              cep,
            },
          ]
        : undefined,
      phones: fone
        ? [
            {
              sequence: tel.Sequence ?? tel.sequence,
              typeCode: tel.typeCode || 1,
              number: fone,
              isDefault: true,
            },
          ]
        : undefined,
      emails: String(email || '').trim()
        ? [
            {
              sequence: mail.sequence,
              typeCode: mail.typeCode,
              email: String(email).trim().toLowerCase(),
              isDefault: true,
            },
          ]
        : undefined,
    });

    try {
      await postTotvs(
        tipo === 'PJ' ? '/person/v2/legal-customers' : '/person/v2/individual-customers',
        payload,
      );
    } catch (err) {
      const d = err.response?.data;
      const msg = Array.isArray(d)
        ? d.map((x) => x.message || x.detailedMessage).join('; ')
        : d?.message || d?.detailedMessage || err.message;
      console.error('❌ [remessa-boletos] TOTVS recusou a alteração do cliente', codigo, msg);
      return errorResponse(res, `TOTVS recusou a alteração: ${msg}`, err.response?.status || 502, 'TOTVS_API_ERROR');
    }

    const relido = await buscarPessoa(codigo, tipo);
    return successResponse(
      res,
      { cliente: montarCliente(relido || atual, tipo) },
      'Cadastro atualizado no TOTVS',
    );
  }),
);

export default router;
