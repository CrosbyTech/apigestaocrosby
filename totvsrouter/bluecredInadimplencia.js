// Inadimplência BlueCred — clientes do crediário com FATURA vencida no TOTVS.
//
// QUEM É CLIENTE BLUECRED: o mesmo conjunto do card BLUECRED do Painel de
// Vendas (getBlueCredPersonCodes): CPFs de bluecred_contratos + quem já
// comprou pelo app Crosby BlueCard. Reusar a função evita duas listas que
// divergem na primeira correção.
//
// O QUE CONTA COMO VENCIDO: título em aberto (sem baixa, dischargeType 0,
// status 1 = normal), documentType 1 (FATURA — crediário), vencimento antes
// de HOJE no fuso da loja. Cheque/cartão/PIX ficam de fora — mesma régua da
// página de Inadimplência Multimarcas. Empresas: só filiais próprias, como o
// card BLUECRED do Painel (sem franquias, 98/980 e 551).
//
// Cada título sai com PORTADOR (cd/nm — SICREDI, SAFRA…) e NOME DA FILIAL,
// e a resposta traz `por_filial` (clientes inadimplentes e valor por loja)
// para o filtro de empresa da tela.
//
// Rota: GET /api/totvs/bluecred/inadimplencia?refresh=1
import express from 'express';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { postTotvs } from '../services/bluecardLimite.js';
import { getBranchesWithNames } from './totvsHelper.js';
import { getBlueCredPersonCodes, getBlueCredCpfOrigens } from './painelVendas.js';

const router = express.Router();

const DOC_FATURA = 1;
// Mesma régua de empresas do card BLUECRED do Painel: só filiais próprias
// (código < 5999, fora 98/980) e sem a 551 (PARNAMIRIM TEMPORARIA, pedido do
// gestor). Franquia (>= 6000) tem crediário próprio — não é BlueCred.
const FILIAIS_FORA = new Set([98, 980, 551]);
const filialBluecred = (bc) => Number(bc) < 5999 && !FILIAIS_FORA.has(Number(bc));
const DIAS_INADIMPLENTE = 60; // > 60 dias = inadimplente (mesmo corte da MTM)
// Clientes de TESTE da integração — fora de qualquer relatório de cobrança.
// 3591 = Felipe (dono do projeto BlueCard); as vendas dele são testes do app.
const CLIENTES_TESTE = new Set([3591]);

// Rota pesada (AR por cliente + pessoas). 10 min de cache no processo.
const CACHE_TTL = 10 * 60 * 1000;
let cache = { ts: 0, data: null };

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// "Hoje" no fuso da loja: comparar vencimento com a data UTC do servidor
// faria a parcela que vence hoje contar como vencida às 21h de ontem.
const hojeLoja = () =>
  new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Fortaleza' });
const diasEntre = (deYmd, ateYmd) =>
  Math.round(
    (Date.parse(`${ateYmd}T12:00:00Z`) - Date.parse(`${deYmd}T12:00:00Z`)) /
      86_400_000,
  );

async function titulosAbertosDe(customerCodes) {
  const itens = [];
  for (let i = 0; i < customerCodes.length; i += 30) {
    const chunk = customerCodes.slice(i, i + 30);
    let page = 1;
    let totalPages = 1;
    do {
      const r = await postTotvs('/accounts-receivable/v2/documents/search', {
        filter: {
          customerCodeList: chunk,
          statusList: [1],
          hasOpenInvoices: true,
          dischargeTypeList: [0],
        },
        page,
        pageSize: 100,
      });
      itens.push(...(r.data?.items || []));
      totalPages = r.data?.totalPages || 1;
      page++;
    } while (page <= totalPages && page <= 20);
  }
  return itens;
}

async function pessoasDe(personCodes) {
  const mapa = new Map();
  for (let i = 0; i < personCodes.length; i += 50) {
    const r = await postTotvs('/person/v2/individuals/search', {
      filter: { personCodeList: personCodes.slice(i, i + 50) },
      expand: 'phones',
      page: 1,
      pageSize: 50,
    });
    for (const p of r.data?.items || []) {
      const fones = Array.isArray(p.phones) ? p.phones : [];
      const principal = fones.find((f) => f.isDefault) || fones[0];
      mapa.set(Number(p.code), {
        nome: p.name || '',
        cpf: p.cpf || '',
        telefone: principal?.number ? String(principal.number).replace(/\D/g, '') : '',
      });
    }
  }
  return mapa;
}

// código da filial → nome (CROSBY SHOPPING MIDWAY…). Cache do helper (30 min).
async function nomesDasFiliais(token) {
  try {
    const lista = await getBranchesWithNames(token);
    return new Map((lista || []).map((b) => [Number(b.code), String(b.name || '')]));
  } catch {
    return new Map();
  }
}

router.get(
  '/bluecred/inadimplencia',
  asyncHandler(async (req, res) => {
    req.setTimeout(300000);
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    if (!refresh && cache.data && Date.now() - cache.ts < CACHE_TTL) {
      return successResponse(res, { ...cache.data, cached: true }, 'OK (cache)');
    }

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_UNAVAILABLE');
    }

    const t0 = Date.now();
    const [codes, nomesFilial] = await Promise.all([
      getBlueCredPersonCodes(tokenData.access_token),
      nomesDasFiliais(tokenData.access_token),
    ]);
    const nomeFilial = (bc) => nomesFilial.get(Number(bc)) || `Filial ${bc}`;
    // Origem do cliente: NOVO = comprou pelo app BlueCard (projeto do Felipe);
    // ANTIGO = só tem o contrato do HeadCoach. Quem está nos dois conta como
    // novo (é ativo no app), com em_ambas_origens=true para a tela explicar.
    const { cpfsContratos, cpfsApp } = getBlueCredCpfOrigens();
    const origemDe = (cpf) => {
      const d = String(cpf || '').replace(/[^0-9]/g, '');
      const app = cpfsApp.has(d);
      const contrato = cpfsContratos.has(d);
      return {
        origem: app ? 'novo' : contrato ? 'antigo' : 'desconhecido',
        em_ambas_origens: app && contrato,
      };
    };
    const hoje = hojeLoja();

    const brutos = codes.length ? await titulosAbertosDe(codes) : [];
    const abertos = brutos.filter(
      (t) =>
        !CLIENTES_TESTE.has(Number(t.customerCode)) &&
        !t.paymentDate &&
        !t.settlementDate &&
        Number(t.status) === 1 &&
        Number(t.documentType) === DOC_FATURA &&
        filialBluecred(t.branchCode),
    );

    const custCodes = [...new Set(abertos.map((t) => Number(t.customerCode)))];
    const pessoas = custCodes.length ? await pessoasDe(custCodes) : new Map();

    // Agrupa por cliente; cada título vira uma linha do detalhe (no formato
    // do accounts-receivable/filter, que é o que os modais da MTM esperam).
    const porCliente = new Map();
    for (const t of abertos) {
      const cod = Number(t.customerCode);
      const venc = String(t.expiredDate || '').slice(0, 10);
      const vencido = Boolean(venc) && venc < hoje;
      const atraso = vencido ? Math.max(0, diasEntre(venc, hoje)) : 0;
      const valor = Number(t.installmentValue || 0);
      const p = pessoas.get(cod) || {};

      let c = porCliente.get(cod);
      if (!c) {
        c = {
          cd_cliente: cod,
          nm_cliente: p.nome || t.customerCpfCnpj || `Cliente ${cod}`,
          nr_cpfcnpj: p.cpf || t.customerCpfCnpj || '',
          nr_telefone: p.telefone || '',
          qtd_vencidas: 0,
          qtd_a_vencer: 0,
          valor_vencido: 0,
          valor_a_vencer: 0,
          maior_atraso_dias: 0,
          filiais: new Set(),
          titulos: [],
        };
        porCliente.set(cod, c);
      }
      const bc = Number(t.branchCode);
      c.filiais.add(bc);
      c.titulos.push({
        cd_empresa: bc,
        nm_empresa: nomeFilial(bc),
        cd_cliente: cod,
        nr_fatura: t.receivableCode,
        nr_fat: t.receivableCode,
        nr_parcela: t.installmentCode ?? 1,
        dt_emissao: String(t.issueDate || '').slice(0, 10) || null,
        dt_vencimento: venc || null,
        dias_atraso: atraso,
        vl_fatura: r2(valor),
        vl_juros: r2(t.interestValue),
        vl_multa: r2(t.assessmentValue),
        vl_liquido: r2(t.netValue ?? valor),
        cd_portador: t.bearerCode ?? null,
        nm_portador: t.bearerName || null,
        linha_digitavel: t.digitableLine || null,
        cd_barras: t.barCode || null,
        nosso_numero: t.ourNumber || null,
        tp_documento: Number(t.documentType),
        tp_cobranca: t.chargeType ?? null,
        situacao: vencido ? 'vencido' : 'a_vencer',
      });
      if (vencido) {
        c.qtd_vencidas++;
        c.valor_vencido += valor;
        if (atraso > c.maior_atraso_dias) c.maior_atraso_dias = atraso;
      } else {
        c.qtd_a_vencer++;
        c.valor_a_vencer += valor;
      }
    }

    // Só quem tem ao menos uma fatura VENCIDA entra na lista
    const clientes = [...porCliente.values()]
      .filter((c) => c.qtd_vencidas > 0)
      .map((c) => {
        const filiais = [...c.filiais].sort((a, b) => a - b);
        return {
          ...c,
          ...origemDe(c.nr_cpfcnpj),
          filiais,
          filiais_nomes: filiais.map(nomeFilial),
          valor_vencido: r2(c.valor_vencido),
          valor_a_vencer: r2(c.valor_a_vencer),
          valor_total: r2(c.valor_vencido + c.valor_a_vencer),
          situacao: c.maior_atraso_dias > DIAS_INADIMPLENTE ? 'inadimplente' : 'vencido',
          titulos: c.titulos.sort((a, b) =>
            String(a.dt_vencimento).localeCompare(String(b.dt_vencimento)),
          ),
        };
      })
      .sort((a, b) => b.valor_vencido - a.valor_vencido);

    // Por filial: quantos clientes inadimplentes e quanto vencido em cada
    // loja (o cliente conta em cada loja onde tem título VENCIDO).
    const porFilial = new Map();
    for (const c of clientes) {
      for (const t of c.titulos) {
        if (t.situacao !== 'vencido') continue;
        let f = porFilial.get(t.cd_empresa);
        if (!f) {
          f = {
            cd_empresa: t.cd_empresa,
            nm_empresa: t.nm_empresa,
            clientes: new Set(),
            titulos: 0,
            valor_vencido: 0,
          };
          porFilial.set(t.cd_empresa, f);
        }
        f.clientes.add(c.cd_cliente);
        f.titulos++;
        f.valor_vencido += t.vl_fatura;
      }
    }
    const por_filial = [...porFilial.values()]
      .map((f) => ({ ...f, clientes: f.clientes.size, valor_vencido: r2(f.valor_vencido) }))
      .sort((a, b) => b.clientes - a.clientes || b.valor_vencido - a.valor_vencido);

    const soma = (arr, k) => r2(arr.reduce((s, c) => s + (c[k] || 0), 0));
    const ate60 = clientes.filter((c) => c.situacao === 'vencido');
    const acima60 = clientes.filter((c) => c.situacao === 'inadimplente');
    const resumo = {
      total_clientes: clientes.length,
      valor_vencido: soma(clientes, 'valor_vencido'),
      valor_a_vencer: soma(clientes, 'valor_a_vencer'),
      valor_total: soma(clientes, 'valor_total'),
      titulos_vencidos: clientes.reduce((s, c) => s + c.qtd_vencidas, 0),
      // quantos inadimplentes são do app (novos) e quantos do contrato antigo
      novos: clientes.filter((c) => c.origem === 'novo').length,
      antigos: clientes.filter((c) => c.origem === 'antigo').length,
      origem_desconhecida: clientes.filter((c) => c.origem === 'desconhecido').length,
      ate_60: { clientes: ate60.length, valor: soma(ate60, 'valor_vencido') },
      acima_60: { clientes: acima60.length, valor: soma(acima60, 'valor_vencido') },
    };

    const data = {
      hoje,
      gerado_em: new Date().toISOString(),
      dias_inadimplente: DIAS_INADIMPLENTE,
      // contexto: quantos clientes BlueCred existem e quantos estão em dia
      clientes_bluecred: codes.length,
      clientes_com_aberto_em_dia: porCliente.size - clientes.length,
      resumo,
      por_filial,
      clientes,
    };
    cache = { ts: Date.now(), data };

    console.log(
      `[bluecred/inadimplencia] ${codes.length} clientes · ${abertos.length} faturas abertas · ` +
        `${clientes.length} com vencida (R$ ${resumo.valor_vencido}) em ${por_filial.length} filial(is) · ${Date.now() - t0}ms`,
    );
    return successResponse(res, data, `${clientes.length} cliente(s) com fatura vencida`);
  }),
);

// ─────────────────────────────────────────────────────────────────────
// GET /api/totvs/bluecred/clientes
// TODOS os clientes BlueCred (códigos TOTVS + CPF + origem), com ou sem
// título vencido. É o que o Dashboard e as Metas de Inadimplência usam para
// incluir o canal BlueCard no mesmo pipeline das demais (MTM/FRQ/REV):
// buscam o contas a receber por código de cliente e marcam o canal.
// Exclui os clientes de teste (3591).
// ─────────────────────────────────────────────────────────────────────
router.get(
  '/bluecred/clientes',
  asyncHandler(async (req, res) => {
    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(res, 'Token TOTVS indisponível', 503, 'TOKEN_UNAVAILABLE');
    }
    const codes = (await getBlueCredPersonCodes(tokenData.access_token)).filter(
      (c) => !CLIENTES_TESTE.has(Number(c)),
    );
    const { cpfsContratos, cpfsApp } = getBlueCredCpfOrigens();
    return successResponse(
      res,
      {
        total: codes.length,
        codes,
        // as duas fontes, para quem quiser marcar novo/antigo sem outra chamada
        cpfs_app: [...cpfsApp],
        cpfs_contratos: [...cpfsContratos],
        clientes_teste: [...CLIENTES_TESTE],
      },
      `${codes.length} clientes BlueCred`,
    );
  }),
);

export default router;
