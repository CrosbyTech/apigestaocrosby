/**
 * ============================================================
 * AUTENTIQUE API — Integração completa (GraphQL)
 * Endpoint: https://api.autentique.com.br/v2/graphql
 * Docs:     https://docs.autentique.com.br/api/2
 * ============================================================
 *
 * FLUXO ESPECIAL:
 *   POST /api/autentique/termo-credito  — Gera PDF do Termo de Crédito com dados
 *                                          do cliente (TOTVS) e envia para assinatura
 *                                          via WhatsApp com LIVE + MANUAL verification
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import puppeteer from 'puppeteer';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';
import supabase from '../config/supabase.js';

const router = express.Router();

// ─── Configuração ─────────────────────────────────────────────────────────────
const AUTENTIQUE_API_URL = 'https://api.autentique.com.br/v2/graphql';
const AUTENTIQUE_API_KEY =
  process.env.AUTENTIQUE_API_KEY ||
  '52a2018cda387ba2d3fbce56ca4f6e6d8d80997b6049cb62a7a6474ddcb63d2a';

// ─── Helper: executa GraphQL query/mutation (sem arquivo) ─────────────────────
const gql = async (query, variables = {}) => {
  const response = await axios.post(
    AUTENTIQUE_API_URL,
    { query, variables },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AUTENTIQUE_API_KEY}`,
      },
      timeout: 30000,
    },
  );

  if (response.data.errors?.length) {
    const msg = response.data.errors.map((e) => e.message).join(' | ');
    const err = new Error(msg);
    err.gqlErrors = response.data.errors;
    throw err;
  }

  return response.data.data;
};

// =============================================================================
// TERMO DE CRÉDITO — Geração automática de PDF + envio para assinatura
// =============================================================================

// ─── Helper: detecta path do Chrome para Puppeteer ───────────────────────────
// Tenta múltiplas estratégias em ordem:
//   1) PUPPETEER_EXECUTABLE_PATH (env var)
//   2) puppeteer.executablePath() (path padrão do Puppeteer)
//   3) Glob no cache puppeteer (qualquer versão chrome-linux64)
//   4) Paths comuns do sistema (apt-get install google-chrome etc.)
// Pula caminhos que NÃO existem no disco — evita erro "executablePath não encontrado".
// (fs e path importados no topo do arquivo)

const tryFile = (p) => {
  try {
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
};

const findChromeInCache = (cacheDir) => {
  try {
    if (!fs.existsSync(cacheDir)) return null;
    const versions = fs
      .readdirSync(cacheDir)
      .filter((d) => d.startsWith('linux-') || d.startsWith('mac') || d.startsWith('win'))
      .sort()
      .reverse(); // versão mais recente primeiro
    for (const v of versions) {
      const candidates = [
        path.join(cacheDir, v, 'chrome-linux64', 'chrome'),
        path.join(cacheDir, v, 'chrome-mac', 'chrome'),
        path.join(cacheDir, v, 'chrome-mac-x64', 'chrome'),
        path.join(cacheDir, v, 'chrome-mac-arm64', 'chrome'),
        path.join(cacheDir, v, 'chrome-win', 'chrome.exe'),
        path.join(cacheDir, v, 'chrome-win64', 'chrome.exe'),
      ];
      for (const c of candidates) {
        const found = tryFile(c);
        if (found) return found;
      }
    }
  } catch {
    // ignore
  }
  return null;
};

const getChromePath = () => {
  // 1) Env var explícita (deploy controla)
  const envPath = tryFile(process.env.PUPPETEER_EXECUTABLE_PATH);
  if (envPath) {
    console.log(`[Puppeteer] Chrome via PUPPETEER_EXECUTABLE_PATH: ${envPath}`);
    return envPath;
  }

  // 2) puppeteer.executablePath() padrão
  try {
    const resolved = puppeteer.executablePath();
    if (resolved && fs.existsSync(resolved)) {
      console.log(`[Puppeteer] Chrome via puppeteer.executablePath(): ${resolved}`);
      return resolved;
    }
    // Se não existe no disco, NÃO retorna (evita erro de file not found)
    if (resolved) {
      console.warn(
        `[Puppeteer] puppeteer.executablePath()=${resolved} mas arquivo NÃO EXISTE — tentando outros paths...`,
      );
    }
  } catch (err) {
    console.warn(`[Puppeteer] puppeteer.executablePath() falhou: ${err.message}`);
  }

  // 3) Glob no cache Puppeteer (qualquer versão presente)
  const cacheDirs = [
    process.env.PUPPETEER_CACHE_DIR,
    path.resolve(process.cwd(), '.cache', 'puppeteer', 'chrome'),
    path.resolve(process.cwd(), 'backend', '.cache', 'puppeteer', 'chrome'),
    // Render.com padrão
    '/opt/render/project/src/.cache/puppeteer/chrome',
    '/opt/render/project/src/backend/.cache/puppeteer/chrome',
    // Homedir
    path.join(process.env.HOME || '', '.cache', 'puppeteer', 'chrome'),
  ].filter(Boolean);

  for (const dir of cacheDirs) {
    const found = findChromeInCache(dir);
    if (found) {
      console.log(`[Puppeteer] Chrome encontrado no cache: ${found}`);
      return found;
    }
  }

  // 4) Paths comuns do sistema (apt-get etc.)
  const systemPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const p of systemPaths) {
    const found = tryFile(p);
    if (found) {
      console.log(`[Puppeteer] Chrome do sistema: ${found}`);
      return found;
    }
  }

  console.error(
    '[Puppeteer] Chrome NÃO ENCONTRADO em nenhum path. Instale via "npx puppeteer browsers install chrome" ou defina PUPPETEER_EXECUTABLE_PATH.',
  );
  return null;
};

// ─── Helper: formata telefone do TOTVS para E.164 (+55...) ───────────────────
const formatPhone = (raw = '') => {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // Já tem DDI
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  // Adiciona DDI 55 (Brasil)
  return `+55${digits}`;
};

// ─── Helper: formata endereço completo (campos do TOTVS) ─────────────────────
const formatFullAddress = (a) => {
  if (!a) return 'Não informado';
  return [
    [a.publicPlace, a.address].filter(Boolean).join(' '),
    a.addressNumber ? `nº ${a.addressNumber}` : null,
    a.complement || null,
    a.neighborhood || null,
    a.cityName && a.stateAbbreviation
      ? `${a.cityName} - ${a.stateAbbreviation}`
      : a.cityName || null,
    a.cep ? `CEP ${a.cep}` : null,
  ]
    .filter(Boolean)
    .join(', ');
};

// ─── Helper: formata CPF (12345678900 → 123.456.789-00) ──────────────────────
const formatCpf = (cpf = '') => {
  const d = cpf.replace(/\D/g, '');
  if (d.length === 11)
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return cpf;
};

// ─── Helper: gera PDF do Termo de Crédito com Puppeteer ──────────────────────
const gerarTermoPdf = async (cliente) => {
  const hoje = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const endPrincipal = formatFullAddress(
    (cliente.addresses || []).find((a) => a.addressType === 'COMMERCIAL') ||
      (cliente.addresses || [])[0],
  );

  const telefonePrimario =
    (
      (cliente.phones || []).find((p) => p.isDefault) ||
      (cliente.phones || [])[0]
    )?.number || 'Não informado';

  const emailPrimario =
    (
      (cliente.emails || []).find((e) => e.isDefault) ||
      (cliente.emails || [])[0]
    )?.email || 'Não informado';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      color: #111;
      background: #fff;
      padding: 40px 60px;
      line-height: 1.7;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #000;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 16pt;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .header h2 {
      font-size: 13pt;
      font-weight: normal;
      margin-top: 4px;
    }
    .section {
      margin-top: 24px;
    }
    .section-title {
      font-size: 12pt;
      font-weight: bold;
      text-transform: uppercase;
      border-bottom: 1px solid #555;
      padding-bottom: 4px;
      margin-bottom: 12px;
    }
    .data-row {
      display: flex;
      gap: 16px;
      margin-bottom: 8px;
    }
    .data-label {
      font-weight: bold;
      min-width: 140px;
    }
    .data-value {
      flex: 1;
    }
    .clausulas p {
      text-align: justify;
      margin-bottom: 12px;
      text-indent: 2em;
    }
    .clausulas .clausula-title {
      font-weight: bold;
      text-transform: uppercase;
      text-indent: 0;
    }
    .assinatura {
      margin-top: 60px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .assinatura-bloco {
      text-align: center;
      width: 45%;
    }
    .assinatura-linha {
      border-top: 1px solid #000;
      padding-top: 6px;
      margin-top: 50px;
    }
    .rodape {
      margin-top: 40px;
      text-align: center;
      font-size: 9pt;
      color: #555;
      border-top: 1px solid #ccc;
      padding-top: 8px;
    }
  </style>
</head>
<body>

  <div class="header">
    <h1>Crosby</h1>
    <h2>Termo de Concessão de Crédito</h2>
  </div>

  <div class="section">
    <div class="section-title">Dados do Cliente</div>
    <div class="data-row"><span class="data-label">Nome / Razão Social:</span><span class="data-value">${cliente.name || 'Não informado'}</span></div>
    <div class="data-row"><span class="data-label">CPF / CNPJ:</span><span class="data-value">${formatCpf(cliente.cpf || cliente.cnpj || '')}</span></div>
    <div class="data-row"><span class="data-label">Código de cliente:</span><span class="data-value">${cliente.code || 'Não informado'}</span></div>
    <div class="data-row"><span class="data-label">E-mail:</span><span class="data-value">${emailPrimario}</span></div>
    <div class="data-row"><span class="data-label">Telefone:</span><span class="data-value">${telefonePrimario}</span></div>
    <div class="data-row"><span class="data-label">Endereço:</span><span class="data-value">${endPrincipal}</span></div>
  </div>

  <div class="section clausulas">
    <div class="section-title">Cláusulas e Condições</div>

    <p class="clausula-title">Cláusula 1ª — Do Objeto</p>
    <p>O presente Termo tem por objeto a concessão de limite de crédito comercial ao cliente identificado acima, para fins de aquisição de produtos e serviços junto à Crosby, nas condições e limites estabelecidos pela empresa, de acordo com a política de crédito vigente.</p>

    <p class="clausula-title">Cláusula 2ª — Das Condições de Pagamento</p>
    <p>O cliente compromete-se a efetuar o pagamento das compras realizadas dentro dos prazos e condições negociados no momento da venda, respeitando os limites de crédito aprovados e as datas de vencimento das respectivas obrigações.</p>

    <p class="clausula-title">Cláusula 3ª — Da Responsabilidade</p>
    <p>O cliente declara que as informações prestadas à Crosby são verdadeiras e completas, responsabilizando-se civil e criminalmente por quaisquer falsidades. Autoriza, ainda, a consulta a órgãos de proteção ao crédito (SPC, Serasa e similares) para fins de análise e manutenção do presente crédito.</p>

    <p class="clausula-title">Cláusula 4ª — Da Vigência e Revisão</p>
    <p>O crédito ora concedido poderá ser revisto, suspenso ou cancelado a qualquer tempo, a critério exclusivo da Crosby, mediante simples comunicação ao cliente, especialmente em caso de inadimplência, alteração negativa na capacidade de pagamento ou descumprimento das condições estabelecidas neste Termo.</p>

    <p class="clausula-title">Cláusula 5ª — Da Concordância</p>
    <p>Ao assinar o presente instrumento, o cliente declara ter lido, compreendido e concordado integralmente com todas as cláusulas e condições aqui estabelecidas, bem como com a política de crédito e cobrança da Crosby.</p>
  </div>

  <div class="section">
    <p style="text-align:right; margin-top: 16px;">Data: ${hoje}</p>
  </div>

  <div class="assinatura">
    <div class="assinatura-bloco">
      <div class="assinatura-linha">
        ${cliente.name || 'Cliente'}<br>
        CPF: ${formatCpf(cliente.cpf || '')}<br>
        <small>Assinatura do Cliente</small>
      </div>
    </div>
    <div class="assinatura-bloco">
      <div class="assinatura-linha">
        Crosby<br>
        <small>Responsável Comercial</small>
      </div>
    </div>
  </div>

  <div class="rodape">
    Documento gerado eletronicamente em ${hoje} — Crosby © ${new Date().getFullYear()}
  </div>

</body>
</html>`;

  const chromePath = getChromePath();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
    ...(chromePath ? { executablePath: chromePath } : {}),
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '0mm', right: '0mm' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
};

// ─── Helper: faz upload para Autentique via multipart ────────────────────────
const uploadAutentique = async (pdfBuffer, document, signers) => {
  const query = `
    mutation CreateDocumentMutation(
      $document: DocumentInput!,
      $signers: [SignerInput!]!,
      $file: Upload!
    ) {
      createDocument(
        document: $document,
        signers: $signers,
        file: $file
      ) {
        id
        name
        created_at
        signatures {
          public_id
          name
          email
          action { name }
          link { short_link }
          user { id name email }
        }
      }
    }
  `;

  const operations = JSON.stringify({
    query,
    variables: { document, signers, file: null },
  });
  const map = JSON.stringify({ 0: ['variables.file'] });

  const form = new FormData();
  form.append('operations', operations);
  form.append('map', map);
  form.append(
    '0',
    new File([pdfBuffer], 'termo-credito.pdf', { type: 'application/pdf' }),
  );

  const response = await fetch(AUTENTIQUE_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AUTENTIQUE_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });

  const json = await response.json();
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join(' | ');
    const err = new Error(msg);
    err.gqlErrors = json.errors;
    throw err;
  }

  return json.data?.createDocument;
};

/**
 * @route POST /api/autentique/termo-credito
 * @desc  Busca dados do cliente no TOTVS, gera PDF do Termo de Crédito
 *        com as informações preenchidas e envia para assinatura via WhatsApp
 *        com verificação LIVE (selfie + prova de vida + doc com foto) e
 *        aprovação MANUAL por um funcionário.
 *
 * @body {
 *   fiscalNumber: string  — CPF (11 dígitos) ou CNPJ (14 dígitos) do cliente
 *   phone?: string        — Número WhatsApp em formato E.164 (+5511999999999).
 *                           Se não informado, usa o telefone principal do TOTVS.
 * }
 */
router.post(
  '/termo-credito',
  asyncHandler(async (req, res) => {
    const {
      fiscalNumber,
      phone: phoneOverride,
      accountId,         // UUID da conta WhatsApp (whatsapp_accounts) — Meta Cloud API
      templateName,      // Nome do template aprovado (Meta) — opcional
      templateLanguage,  // Código do idioma (default: pt_BR)
    } = req.body;

    // ── 1. Validação ──────────────────────────────────────────────────────────
    if (!fiscalNumber) {
      return errorResponse(
        res,
        'O campo fiscalNumber é obrigatório',
        400,
        'MISSING_FISCAL',
      );
    }
    const clean = String(fiscalNumber).replace(/\D/g, '');
    if (clean.length !== 11 && clean.length !== 14) {
      return errorResponse(
        res,
        'fiscalNumber deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ)',
        400,
        'INVALID_FISCAL',
      );
    }
    const isCNPJ = clean.length === 14;

    // ── 2. Busca dados no TOTVS ───────────────────────────────────────────────
    console.log(`🔍 [TermoCredito] Buscando cliente no TOTVS: ${clean}`);

    const tokenData = await getToken();
    if (!tokenData?.access_token) {
      return errorResponse(
        res,
        'Não foi possível obter token TOTVS',
        503,
        'TOKEN_UNAVAILABLE',
      );
    }

    const endpoint = isCNPJ
      ? `${TOTVS_BASE_URL}/person/v2/legal-entities/search`
      : `${TOTVS_BASE_URL}/person/v2/individuals/search`;

    const expand = 'phones,emails,addresses,observations';
    let cliente = null;

    if (!isCNPJ) {
      // PF — filtro direto por cpfList
      const payload = {
        filter: { cpfList: [clean] },
        expand,
        page: 1,
        pageSize: 10,
      };
      let response;
      try {
        response = await axios.post(endpoint, payload, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${tokenData.access_token}`,
          },
          timeout: 30000,
        });
      } catch (err) {
        if (err.response?.status === 401) {
          const fresh = await getToken(true);
          response = await axios.post(endpoint, payload, {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${fresh.access_token}`,
            },
            timeout: 30000,
          });
        } else throw err;
      }
      cliente = (response.data?.items || [])[0] || null;
    } else {
      // PJ — paginação + filtro local por cnpj
      let currentPage = 1;
      let hasMore = true;
      let token = tokenData.access_token;
      while (hasMore && currentPage <= 30 && !cliente) {
        const payload = {
          filter: {},
          expand,
          page: currentPage,
          pageSize: 500,
          order: 'personCode',
        };
        let response;
        try {
          response = await axios.post(endpoint, payload, {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
            timeout: 60000,
          });
        } catch (err) {
          if (err.response?.status === 401) {
            const fresh = await getToken(true);
            token = fresh.access_token;
            response = await axios.post(endpoint, payload, {
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
              },
              timeout: 60000,
            });
          } else throw err;
        }
        const items = response.data?.items || [];
        hasMore = response.data?.hasNext || false;
        cliente =
          items.find(
            (item) => String(item.cnpj || '').replace(/\D/g, '') === clean,
          ) || null;
        currentPage++;
      }
    }

    if (!cliente) {
      return errorResponse(
        res,
        'Cliente não encontrado no TOTVS com o CPF/CNPJ informado',
        404,
        'CLIENT_NOT_FOUND',
      );
    }

    console.log(
      `✅ [TermoCredito] Cliente encontrado: ${cliente.name} (código ${cliente.code})`,
    );

    // ── 3. Determina telefone para WhatsApp ───────────────────────────────────
    let whatsappPhone = phoneOverride ? formatPhone(phoneOverride) : null;

    if (!whatsappPhone) {
      const telTotvs =
        (cliente.phones || []).find((p) => p.isDefault)?.number ||
        (cliente.phones || [])[0]?.number;
      whatsappPhone = telTotvs ? formatPhone(telTotvs) : null;
    }

    if (!whatsappPhone) {
      return errorResponse(
        res,
        'Nenhum telefone disponível para envio via WhatsApp. Informe o campo "phone" no body.',
        400,
        'MISSING_PHONE',
      );
    }

    // ── 4. Gera o PDF do Termo com Puppeteer ──────────────────────────────────
    console.log(`📄 [TermoCredito] Gerando PDF para ${cliente.name}...`);
    const pdfBuffer = await gerarTermoPdf(cliente);
    console.log(`✅ [TermoCredito] PDF gerado (${pdfBuffer.length} bytes)`);

    // ── 5. Envia para Autentique (SEM delivery WhatsApp do Autentique) ────────
    // Antes: usava `DELIVERY_METHOD_WHATSAPP` do Autentique pra enviar o link
    //        de assinatura — ficava preso ao número do Autentique.
    // Agora: cria documento com delivery EMAIL (placeholder/skip) e pega o
    //        link de assinatura pra enviar via Meta WhatsApp oficial usando
    //        a conta escolhida em `whatsapp_accounts` (param accountId).
    const documentPayload = {
      name: `Termo de Crédito — ${cliente.name}`,
      message: `Olá ${cliente.name.split(' ')[0]}, segue o Termo de Crédito da Crosby para sua assinatura.`,
      refusable: false,
      new_signature_style: true,
      ignore_cpf: false,
      configs: {
        notification_finished: true,
        notification_signed: true,
      },
    };

    // Cliente sem delivery method WhatsApp do Autentique (envio será via Meta)
    const clienteEmail =
      (cliente.emails || []).find((e) => e.isDefault)?.email ||
      (cliente.emails || [])[0]?.email ||
      null;

    const signersPayload = [
      {
        // Signatário 1: cliente
        name: cliente.name,
        ...(clienteEmail ? { email: clienteEmail } : { phone: whatsappPhone }),
        // Se tem email, usa email. Senão, usa whatsapp DO AUTENTIQUE como
        // fallback (caso conta Meta não esteja configurada/falhe).
        delivery_method: clienteEmail
          ? 'DELIVERY_METHOD_EMAIL'
          : 'DELIVERY_METHOD_WHATSAPP',
        action: 'SIGN',
        configs: {
          cpf: clean.length === 11 ? clean : undefined,
        },
      },
      {
        // Signatário 2: representante Crosby
        name: 'FABIO FERREIRA DE LIMA AZEVEDO',
        phone: '+5584987820986',
        delivery_method: 'DELIVERY_METHOD_WHATSAPP',
        action: 'SIGN',
        configs: {
          cpf: '06537964474',
        },
      },
    ];

    console.log(
      `📨 [TermoCredito] Criando documento na Autentique (delivery: ${signersPayload[0].delivery_method}, accountId Meta: ${accountId || 'NENHUM — Autentique vai enviar'})...`,
    );

    let docCriado;
    try {
      docCriado = await uploadAutentique(
        pdfBuffer,
        documentPayload,
        signersPayload,
      );
    } catch (err) {
      console.error('❌ [TermoCredito] Erro Autentique:', err.message);
      console.error(
        '❌ [TermoCredito] GQL Errors:',
        JSON.stringify(err.gqlErrors, null, 2),
      );
      if (err.gqlErrors) {
        return res.status(422).json({
          success: false,
          message: err.message,
          errors: err.gqlErrors,
        });
      }
      throw err;
    }

    console.log(
      `✅ [TermoCredito] Documento criado na Autentique: ${docCriado?.id}`,
    );

    // ── 6. Envia o link via Meta WhatsApp oficial (se accountId fornecido) ────
    // Pega o link de assinatura do cliente (1º signatário)
    const clienteSigner = (docCriado?.signatures || []).find(
      (s) => s.name === cliente.name,
    ) || docCriado?.signatures?.[0];
    const linkAssinatura =
      clienteSigner?.link?.short_link ||
      `https://app.autentique.com.br/assinar/${clienteSigner?.public_id}`;

    let metaResult = null;
    let metaError = null;
    if (accountId) {
      try {
        // Busca conta Meta no Supabase
        const { data: account, error: accErr } = await supabase
          .from('whatsapp_accounts')
          .select('*')
          .eq('id', accountId)
          .single();
        if (accErr || !account) {
          throw new Error(`Conta Meta não encontrada (id=${accountId})`);
        }

        const toNumber = whatsappPhone.replace(/^\+/, ''); // Meta API quer sem '+'
        const META_GRAPH_BASE = 'https://graph.facebook.com/v22.0';
        let metaBody;

        if (templateName) {
          // Envia via template (com 1 variável = link de assinatura)
          metaBody = {
            messaging_product: 'whatsapp',
            to: toNumber,
            type: 'template',
            template: {
              name: templateName,
              language: { code: templateLanguage || 'pt_BR' },
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: cliente.name.split(' ')[0] },
                    { type: 'text', text: linkAssinatura },
                  ],
                },
              ],
            },
          };
        } else {
          // Envia mensagem de texto (só funciona se janela 24h já aberta)
          metaBody = {
            messaging_product: 'whatsapp',
            to: toNumber,
            type: 'text',
            text: {
              body: `Olá ${cliente.name.split(' ')[0]}! 👋\n\nSegue o *Termo de Crédito Crosby* pra sua assinatura eletrônica:\n\n${linkAssinatura}\n\nQualquer dúvida estamos à disposição.`,
            },
          };
        }

        const metaResp = await axios.post(
          `${META_GRAPH_BASE}/${account.phone_id}/messages`,
          metaBody,
          {
            headers: {
              Authorization: `Bearer ${account.access_token}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          },
        );
        metaResult = {
          account_id: account.id,
          account_name: account.name,
          message_id: metaResp.data?.messages?.[0]?.id,
          to: toNumber,
        };
        console.log(
          `📲 [TermoCredito] Enviado via Meta WhatsApp (${account.name}): msg_id=${metaResult.message_id}`,
        );
      } catch (err) {
        metaError = err.response?.data?.error?.message || err.message;
        console.warn(
          `⚠️ [TermoCredito] Falha ao enviar via Meta WhatsApp: ${metaError}`,
        );
      }
    }

    // ── 7. Salva no banco (bluecred_contratos) ────────────────────────────────
    try {
      await supabase.from('bluecred_contratos').insert({
        autentique_doc_id: docCriado.id,
        cliente_nome: cliente.name,
        cliente_cpf: clean,
        cliente_whatsapp: whatsappPhone,
        status: 'pendente',
        total_assinantes: 2,
        total_assinados: 0,
        assinaturas: [],
      });
    } catch (dbErr) {
      console.error(
        '⚠️ [TermoCredito] Falha ao salvar no banco:',
        dbErr.message,
      );
    }

    const successMsg = accountId && metaResult
      ? `Termo de Crédito enviado para ${cliente.name} via Meta WhatsApp "${metaResult.account_name}" (${whatsappPhone})`
      : accountId && metaError
        ? `Documento criado na Autentique. Meta WhatsApp falhou: ${metaError}. Use o link de assinatura.`
        : `Termo de Crédito enviado para ${cliente.name} via Autentique (${whatsappPhone})`;

    successResponse(
      res,
      {
        document: docCriado,
        cliente: {
          name: cliente.name,
          cpf: clean,
          whatsappPhone,
          email: clienteEmail,
        },
        meta: metaResult,
        meta_error: metaError,
        link_assinatura: linkAssinatura,
      },
      successMsg,
    );
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/autentique/bluecred/contratos — lista todos os contratos enviados
// Sincroniza automaticamente com a Autentique os contratos não finalizados.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_FINAIS = ['concluido', 'recusado'];

const calcularStatusContrato = (signatures) => {
  const assinaturas = (signatures || []).map((s) => ({
    public_id: s.public_id,
    name: s.name || s.user_data?.name || s.user?.name || null,
    action: s.action?.name || null,
    signed_at: s.signed?.created_at || null,
  }));
  const totalAssinantes = assinaturas.length || 2;
  const totalAssinados = assinaturas.filter((s) => s.signed_at).length;
  const totalRecusados = (signatures || []).filter(
    (s) => s.rejected?.created_at,
  ).length;

  let status = 'pendente';
  if (totalRecusados > 0) status = 'recusado';
  else if (totalAssinados >= totalAssinantes) status = 'concluido';
  else if (totalAssinados > 0) status = 'parcialmente_assinado';

  return { status, assinaturas, totalAssinados, totalAssinantes };
};

const QUERY_DOC_STATUS = `
  query GetDocument($id: UUID!) {
    document(id: $id) {
      id
      signatures {
        public_id
        name
        action { name }
        user_data { name }
        user { name }
        signed { created_at }
        rejected { created_at }
      }
    }
  }
`;

router.get(
  '/bluecred/contratos',
  asyncHandler(async (_req, res) => {
    // 1. Busca todos do banco
    const { data: contratos, error } = await supabase
      .from('bluecred_contratos')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    // 2. Filtra apenas os não-finalizados para sincronizar
    const pendentes = (contratos || []).filter(
      (c) => !STATUS_FINAIS.includes(c.status),
    );

    if (pendentes.length > 0) {
      await Promise.allSettled(
        pendentes.map(async (contrato) => {
          try {
            const data = await gql(QUERY_DOC_STATUS, {
              id: contrato.autentique_doc_id,
            });
            const sigs = data?.document?.signatures || [];
            const { status, assinaturas, totalAssinados, totalAssinantes } =
              calcularStatusContrato(sigs);

            // Só atualiza se mudou algo
            if (
              status !== contrato.status ||
              totalAssinados !== contrato.total_assinados
            ) {
              await supabase
                .from('bluecred_contratos')
                .update({
                  status,
                  assinaturas,
                  total_assinados: totalAssinados,
                  total_assinantes: totalAssinantes,
                })
                .eq('autentique_doc_id', contrato.autentique_doc_id);

              // Atualiza localmente para retornar dado fresco
              const idx = contratos.findIndex(
                (c) => c.autentique_doc_id === contrato.autentique_doc_id,
              );
              if (idx !== -1) {
                contratos[idx] = {
                  ...contratos[idx],
                  status,
                  assinaturas,
                  total_assinados: totalAssinados,
                  total_assinantes: totalAssinantes,
                };
              }
            }
          } catch (syncErr) {
            console.warn(
              `⚠️ [Bluecred] Falha ao sincronizar doc ${contrato.autentique_doc_id}:`,
              syncErr.message,
            );
          }
        }),
      );
    }

    successResponse(res, contratos, 'Contratos Bluecred listados com sucesso');
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/autentique/webhook — recebe eventos da Autentique
// Configurar URL no painel Autentique: https://<seu-dominio>/api/autentique/webhook
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const payload = req.body;
    const event = payload?.event;
    const doc = payload?.document;

    console.log(`🔔 [Autentique Webhook] Evento: ${event}`, doc?.id);

    if (!doc?.id) {
      return res.status(200).json({ ok: true }); // ack sem erro
    }

    const docId = doc.id;
    const signatures = doc.signatures || [];

    // Conta quantos assinaram
    const assinaturas = signatures.map((s) => ({
      public_id: s.public_id,
      name: s.name,
      action: s.action?.name,
      signed_at: s.signed?.created_at || null,
    }));
    const totalAssinados = assinaturas.filter((s) => s.signed_at).length;
    const totalAssinantes = assinaturas.length || 2;

    let status = 'pendente';
    if (event === 'document_refused' || event === 'document.refused') {
      status = 'recusado';
    } else if (totalAssinados >= totalAssinantes) {
      status = 'concluido';
    } else if (totalAssinados > 0) {
      status = 'parcialmente_assinado';
    }

    const { error } = await supabase
      .from('bluecred_contratos')
      .update({ status, total_assinados: totalAssinados, assinaturas })
      .eq('autentique_doc_id', docId);

    if (error) {
      console.error('❌ [Webhook] Erro ao atualizar DB:', error.message);
    } else {
      console.log(
        `✅ [Webhook] Contrato ${docId} atualizado → status: ${status}`,
      );
    }

    res.status(200).json({ ok: true });
  }),
);

export default router;
