/**
 * ============================================================
 * AUTENTIQUE API — Integração completa (GraphQL)
 * Endpoint: https://api.autentique.com.br/v2/graphql
 * Docs:     https://docs.autentique.com.br/api/2
 * ============================================================
 *
 * QUERIES (leitura):
 *   GET  /api/autentique/me                          — Dados do usuário atual
 *   GET  /api/autentique/documents                   — Listar documentos (limit, page)
 *   GET  /api/autentique/document/:id                — Buscar documento específico
 *   GET  /api/autentique/documents/folder/:folder_id — Documentos de uma pasta
 *   GET  /api/autentique/organization                — Organização atual
 *   GET  /api/autentique/organizations               — Todas as organizações
 *   GET  /api/autentique/folders                     — Listar pastas (limit, page, type)
 *   GET  /api/autentique/email-templates             — Listar modelos de e-mail
 *
 * MUTATIONS (escrita):
 *   POST   /api/autentique/documents                       — Criar documento (multipart: file + JSON)
 *   POST   /api/autentique/documents/:id/sign              — Assinar documento
 *   PUT    /api/autentique/documents/:id                   — Editar documento
 *   POST   /api/autentique/documents/:id/transfer          — Transferir documento para org/grupo
 *   POST   /api/autentique/documents/:id/move              — Mover documento para pasta
 *   POST   /api/autentique/documents/:id/signers           — Adicionar signatário
 *   DELETE /api/autentique/documents/:id/signers/:pub_id   — Remover signatário
 *   POST   /api/autentique/folders                         — Criar pasta
 *
 * FLUXO ESPECIAL:
 *   POST /api/autentique/termo-credito  — Gera PDF do Termo de Crédito com dados
 *                                          do cliente (TOTVS) e envia para assinatura
 *                                          via WhatsApp com LIVE + MANUAL verification
 */

import express from 'express';
import axios from 'axios';
import multer from 'multer';
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

// Multer em memória para receber arquivos do frontend e repassá-los à Autentique
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

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

// ─── Helper: trata erros da Autentique e responde ─────────────────────────────
const handleError = (res, error) => {
  console.error('❌ Autentique API error:', error.message);

  if (error.gqlErrors) {
    return res.status(422).json({
      success: false,
      message: error.message,
      errors: error.gqlErrors,
    });
  }

  if (error.response) {
    return res.status(error.response.status || 400).json({
      success: false,
      message: error.response.data?.message || error.message,
      details: error.response.data,
    });
  }

  return res.status(500).json({
    success: false,
    message: error.message || 'Erro na integração com Autentique',
  });
};

// =============================================================================
// QUERIES
// =============================================================================

/**
 * @route GET /api/autentique/me
 * @desc  Retorna dados do usuário dono do token (nome, email, CPF, créditos, organização)
 */
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    try {
      const data = await gql(`
        query {
          me {
            id
            name
            email
            phone
            cpf
            cnpj
            birthday
            subscription {
              has_premium_features
              documents
              credits
            }
            organization {
              id
              uuid
              name
              cnpj
            }
          }
        }
      `);
      successResponse(res, data.me, 'Dados do usuário obtidos com sucesso');
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route GET /api/autentique/documents
 * @query limit (default 60) — itens por página
 * @query page  (default 1)  — número da página
 * @desc  Lista documentos paginados do usuário
 */
router.get(
  '/documents',
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 60;
    const page = parseInt(req.query.page) || 1;

    try {
      const data = await gql(
        `
        query ListDocuments($limit: Int, $page: Int) {
          documents(limit: $limit, page: $page) {
            total
            data {
              id
              name
              refusable
              sortable
              qualified
              sandbox
              created_at
              deleted_at
              files { original signed pades }
              signatures {
                public_id
                name
                email
                created_at
                action { name }
                link { short_link }
                user { id name email }
                viewed { created_at }
                signed { created_at }
                rejected { created_at }
              }
            }
          }
        }
      `,
        { limit, page },
      );
      successResponse(res, data.documents, 'Documentos listados com sucesso');
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route GET /api/autentique/document/:id
 * @desc  Busca um documento específico com status completo de todas as assinaturas
 */
router.get(
  '/document/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id) {
      return errorResponse(
        res,
        'ID do documento é obrigatório',
        400,
        'MISSING_ID',
      );
    }

    try {
      const data = await gql(
        `
        query GetDocument($id: UUID!) {
          document(id: $id) {
            id
            name
            refusable
            sortable
            qualified
            sandbox
            created_at
            deleted_at
            deadline_at
            files { original signed pades }
            signatures {
              public_id
              name
              email
              created_at
              action { name }
              link { short_link }
              user { id name email phone }
              user_data { name email phone }
              email_events {
                sent
                opened
                delivered
                refused
                reason
              }
              viewed {
                ip port reason created_at
                geolocation {
                  country countryISO state stateISO city zipcode latitude longitude
                }
              }
              signed {
                ip port reason created_at
                geolocation {
                  country countryISO state stateISO city zipcode latitude longitude
                }
              }
              rejected {
                ip port reason created_at
                geolocation {
                  country countryISO state stateISO city zipcode latitude longitude
                }
              }
              signed_unapproved {
                ip port reason created_at
              }
              biometric_approved {
                ip port reason created_at
              }
              biometric_rejected {
                ip port reason created_at
              }
            }
          }
        }
      `,
        { id },
      );
      successResponse(res, data.document, 'Documento encontrado com sucesso');
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route GET /api/autentique/documents/folder/:folder_id
 * @query limit (default 60)
 * @query page  (default 1)
 * @desc  Lista documentos de uma pasta específica
 */
router.get(
  '/documents/folder/:folder_id',
  asyncHandler(async (req, res) => {
    const { folder_id } = req.params;
    const limit = parseInt(req.query.limit) || 60;
    const page = parseInt(req.query.page) || 1;

    try {
      const data = await gql(
        `
        query DocumentsByFolder($folder_id: UUID!, $limit: Int, $page: Int) {
          documentsByFolder(folder_id: $folder_id, limit: $limit, page: $page) {
            has_more_pages
            data {
              id
              name
              qualified
              sandbox
              created_at
              deleted_at
            }
          }
        }
      `,
        { folder_id, limit, page },
      );
      successResponse(
        res,
        data.documentsByFolder,
        'Documentos da pasta obtidos com sucesso',
      );
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route GET /api/autentique/organization
 * @desc  Retorna dados da organização atual do usuário
 */
router.get(
  '/organization',
  asyncHandler(async (req, res) => {
    try {
      const data = await gql(`
        query {
          organization {
            id
            uuid
            name
            cnpj
          }
        }
      `);
      successResponse(res, data.organization, 'Organização obtida com sucesso');
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route GET /api/autentique/organizations
 * @desc  Retorna todas as organizações do usuário
 */
router.get(
  '/organizations',
  asyncHandler(async (req, res) => {
    try {
      const data = await gql(`
        query {
          organizations {
            id
            uuid
            name
            cnpj
          }
        }
      `);
      successResponse(
        res,
        data.organizations,
        'Organizações obtidas com sucesso',
      );
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route GET /api/autentique/folders
 * @query limit (default 60)
 * @query page  (default 1)
 * @query type  (DEFAULT | GROUP | ORGANIZATION — default: DEFAULT)
 * @desc  Lista pastas do usuário
 */
router.get(
  '/folders',
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 60;
    const page = parseInt(req.query.page) || 1;
    const type = req.query.type || 'DEFAULT';

    const VALID_TYPES = ['DEFAULT', 'GROUP', 'ORGANIZATION'];
    if (!VALID_TYPES.includes(type)) {
      return errorResponse(
        res,
        `Tipo de pasta inválido. Valores aceitos: ${VALID_TYPES.join(', ')}`,
        400,
        'INVALID_FOLDER_TYPE',
      );
    }

    try {
      const data = await gql(
        `
        query ListFolders($limit: Int, $page: Int, $type: FolderTypeEnum) {
          folders(limit: $limit, page: $page, type: $type) {
            total
            data {
              id
              name
              slug
              context
              path
              children_counter
              created_at
              updated_at
            }
          }
        }
      `,
        { limit, page, type },
      );
      successResponse(res, data.folders, 'Pastas listadas com sucesso');
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route GET /api/autentique/email-templates
 * @query limit (default 60)
 * @query page  (default 1)
 * @desc  Lista modelos de e-mail personalizados da conta
 */
router.get(
  '/email-templates',
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 60;
    const page = parseInt(req.query.page) || 1;

    try {
      const data = await gql(
        `
        query ListEmailTemplates($limit: Int, $page: Int) {
          emailTemplates(limit: $limit, page: $page) {
            has_more_pages
            data {
              id
              name
              type
              email {
                text
                sender
                colors
                template
              }
            }
          }
        }
      `,
        { limit, page },
      );
      successResponse(
        res,
        data.emailTemplates,
        'Modelos de e-mail listados com sucesso',
      );
    } catch (err) {
      handleError(res, err);
    }
  }),
);

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * @route POST /api/autentique/documents
 * @desc  Cria um novo documento para assinatura
 *
 * Envio via multipart/form-data:
 *   - file         (File, obrigatório) — PDF do documento
 *   - document     (JSON string, obrigatório) — configurações do documento
 *   - signers      (JSON string, obrigatório) — array de signatários
 *   - organization_id (string, opcional)
 *   - folder_id       (string, opcional)
 *   - type            (string, opcional) — DEFAULT | WHATSAPP_FLOW
 *
 * Exemplo de "document" JSON:
 * {
 *   "name": "Contrato",
 *   "message": "Por favor assine",
 *   "reminder": "WEEKLY",
 *   "sortable": false,
 *   "refusable": true,
 *   "qualified": false,
 *   "deadline_at": "2026-12-31T23:59:59Z",
 *   "ignore_cpf": false,
 *   "new_signature_style": true,
 *   "footer": "BOTTOM",
 *   "cc": [{ "email": "gestor@empresa.com" }],
 *   "configs": {
 *     "notification_finished": true,
 *     "notification_signed": true,
 *     "signature_appearance": "ELETRONIC"
 *   },
 *   "locale": { "country": "BR", "language": "pt-BR", "timezone": "America/Sao_Paulo" }
 * }
 *
 * Exemplo de "signers" JSON:
 * [
 *   { "email": "cliente@empresa.com", "action": "SIGN" },
 *   { "phone": "+5511999999999", "delivery_method": "DELIVERY_METHOD_WHATSAPP", "action": "SIGN" }
 * ]
 *
 * Ações disponíveis para signatários:
 *   SIGN | APPROVE | RECOGNIZE | SIGN_AS_A_WITNESS | ACKNOWLEDGE_RECEIPT |
 *   ENDORSE_IN_BLACK | ENDORSE_IN_WHITE
 *
 * Métodos de entrega:
 *   DELIVERY_METHOD_EMAIL | DELIVERY_METHOD_WHATSAPP | DELIVERY_METHOD_SMS | DELIVERY_METHOD_LINK
 */
router.post(
  '/documents',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return errorResponse(
        res,
        'Arquivo PDF é obrigatório',
        400,
        'MISSING_FILE',
      );
    }

    let document, signers;
    try {
      document =
        typeof req.body.document === 'string'
          ? JSON.parse(req.body.document)
          : req.body.document;
      signers =
        typeof req.body.signers === 'string'
          ? JSON.parse(req.body.signers)
          : req.body.signers;
    } catch {
      return errorResponse(
        res,
        'Os campos "document" e "signers" devem ser JSON válidos',
        400,
        'INVALID_JSON',
      );
    }

    if (!document || !signers || !Array.isArray(signers)) {
      return errorResponse(
        res,
        'Os campos "document" (objeto) e "signers" (array) são obrigatórios',
        400,
        'MISSING_FIELDS',
      );
    }

    const organization_id = req.body.organization_id
      ? parseInt(req.body.organization_id)
      : undefined;
    const folder_id = req.body.folder_id || undefined;
    const type = req.body.type || 'DEFAULT';

    // Mutation GraphQL
    const query = `
      mutation CreateDocumentMutation(
        $document: DocumentInput!,
        $signers: [SignerInput!]!,
        $file: Upload!
      ) {
        createDocument(
          document: $document,
          signers: $signers,
          file: $file,
          ${organization_id ? 'organization_id: ' + organization_id + ',' : ''}
          ${folder_id ? 'folder_id: "' + folder_id + '",' : ''}
          type: ${type}
        ) {
          id
          name
          refusable
          sortable
          created_at
          signatures {
            public_id
            name
            email
            created_at
            action { name }
            link { short_link }
            user { id name email }
          }
        }
      }
    `;

    // Montar multipart seguindo GraphQL multipart request spec
    // https://github.com/jaydenseric/graphql-multipart-request-spec
    const operations = JSON.stringify({
      query,
      variables: {
        document,
        signers,
        file: null,
      },
    });

    const map = JSON.stringify({ 0: ['variables.file'] });

    // Usar FormData nativa do Node 18+ com File
    const form = new FormData();
    form.append('operations', operations);
    form.append('map', map);
    form.append(
      '0',
      new File([req.file.buffer], req.file.originalname, {
        type: req.file.mimetype,
      }),
    );

    try {
      const response = await fetch(AUTENTIQUE_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AUTENTIQUE_API_KEY}`,
        },
        body: form,
        signal: AbortSignal.timeout(60000),
      });

      const json = await response.json();

      if (json.errors?.length) {
        const msg = json.errors.map((e) => e.message).join(' | ');
        return res.status(422).json({
          success: false,
          message: msg,
          errors: json.errors,
        });
      }

      successResponse(
        res,
        json.data?.createDocument,
        'Documento criado com sucesso',
      );
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route POST /api/autentique/documents/:id/sign
 * @desc  Assina o documento com o usuário dono do token
 *        (só funciona se o usuário for um dos signatários)
 */
router.post(
  '/documents/:id/sign',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      const data = await gql(
        `
        mutation SignDocument($id: UUID!) {
          signDocument(id: $id)
        }
      `,
        { id },
      );
      successResponse(
        res,
        { signed: data.signDocument },
        'Documento assinado com sucesso',
      );
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route PUT /api/autentique/documents/:id
 * @desc  Edita configurações de um documento já criado
 * @body  Objeto com campos editáveis do documento (todos opcionais):
 * {
 *   name, message, reminder, sortable, footer, refusable,
 *   new_signature_style, show_audit_page, ignore_cpf,
 *   email_template_id, deadline_at, reply_to,
 *   cc: [{ email }],
 *   expiration: { days_before, notify_at },
 *   configs: { notification_finished, notification_signed, signature_appearance }
 * }
 */
router.put(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const document = req.body;

    if (!id) {
      return errorResponse(
        res,
        'ID do documento é obrigatório',
        400,
        'MISSING_ID',
      );
    }

    try {
      const data = await gql(
        `
        mutation UpdateDocument($id: UUID!, $document: UpdateDocumentInput!) {
          updateDocument(id: $id, document: $document) {
            id
            name
            message
            reminder
            refusable
            sortable
            stop_on_rejected
            new_signature_style
            show_audit_page
            expiration_at
            deadline_at
            email_template_id
            footer
            cc
            configs {
              notification_finished
              notification_signed
              signature_appearance
            }
            created_at
          }
        }
      `,
        { id, document },
      );
      successResponse(
        res,
        data.updateDocument,
        'Documento atualizado com sucesso',
      );
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route POST /api/autentique/documents/:id/transfer
 * @desc  Transfere documento para outra organização/grupo
 * @body {
 *   organization_id: number (obrigatório),
 *   group_id: number (obrigatório),
 *   current_group_id: number (opcional),
 *   context: "USER" | "GROUP" | "ORGANIZATION" (opcional)
 * }
 */
router.post(
  '/documents/:id/transfer',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { organization_id, group_id, current_group_id, context } = req.body;

    if (!organization_id || !group_id) {
      return errorResponse(
        res,
        'Os campos organization_id e group_id são obrigatórios',
        400,
        'MISSING_FIELDS',
      );
    }

    try {
      const data = await gql(
        `
        mutation TransferDocument(
          $id: UUID!,
          $organization_id: Int!,
          $group_id: Int!,
          $current_group_id: Int,
          $context: ContextEnum
        ) {
          transferDocument(
            id: $id,
            organization_id: $organization_id,
            group_id: $group_id,
            current_group_id: $current_group_id,
            context: $context
          )
        }
      `,
        {
          id,
          organization_id: parseInt(organization_id),
          group_id: parseInt(group_id),
          current_group_id: current_group_id
            ? parseInt(current_group_id)
            : null,
          context: context || null,
        },
      );
      successResponse(
        res,
        { transferred: data.transferDocument },
        'Documento transferido com sucesso',
      );
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route POST /api/autentique/documents/:id/move
 * @desc  Move um documento existente para uma pasta
 * @body  { folder_id: string (UUID da pasta) }
 */
router.post(
  '/documents/:id/move',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { folder_id } = req.body;

    if (!folder_id) {
      return errorResponse(
        res,
        'O campo folder_id é obrigatório',
        400,
        'MISSING_FOLDER_ID',
      );
    }

    try {
      const data = await gql(
        `
        mutation MoveDocumentToFolder($document_id: UUID!, $folder_id: UUID!) {
          moveDocumentToFolder(document_id: $document_id, folder_id: $folder_id)
        }
      `,
        { document_id: id, folder_id },
      );
      successResponse(
        res,
        { moved: data.moveDocumentToFolder },
        'Documento movido para a pasta com sucesso',
      );
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route POST /api/autentique/documents/:id/signers
 * @desc  Adiciona um signatário a um documento já criado
 * @body  Objeto SignerInput:
 * {
 *   email?: string,
 *   name?: string,
 *   phone?: string,
 *   delivery_method?: "DELIVERY_METHOD_EMAIL" | "DELIVERY_METHOD_WHATSAPP" |
 *                     "DELIVERY_METHOD_SMS" | "DELIVERY_METHOD_LINK",
 *   action: "SIGN" | "APPROVE" | "RECOGNIZE" | "SIGN_AS_A_WITNESS" |
 *           "ACKNOWLEDGE_RECEIPT" | "ENDORSE_IN_BLACK" | "ENDORSE_IN_WHITE",
 *   configs?: { cpf?: string },
 *   security_verifications?: [{ type: "SMS" | "MANUAL" | "UPLOAD" | "LIVE" | "PF_FACIAL", verify_phone?: string }],
 *   positions?: [{ x: string, y: string, z: number, element: "SIGNATURE"|"NAME"|"INITIALS"|"DATE"|"CPF" }]
 * }
 */
router.post(
  '/documents/:id/signers',
  asyncHandler(async (req, res) => {
    const document_id = req.params.id;
    const signer = req.body;

    if (!signer.action) {
      return errorResponse(
        res,
        'O campo action é obrigatório no signatário',
        400,
        'MISSING_ACTION',
      );
    }

    const VALID_ACTIONS = [
      'SIGN',
      'APPROVE',
      'RECOGNIZE',
      'SIGN_AS_A_WITNESS',
      'ACKNOWLEDGE_RECEIPT',
      'ENDORSE_IN_BLACK',
      'ENDORSE_IN_WHITE',
    ];
    if (!VALID_ACTIONS.includes(signer.action)) {
      return errorResponse(
        res,
        `Ação inválida. Valores aceitos: ${VALID_ACTIONS.join(', ')}`,
        400,
        'INVALID_ACTION',
      );
    }

    try {
      const data = await gql(
        `
        mutation CreateSigner($document_id: UUID!, $signer: SignerInput) {
          createSigner(document_id: $document_id, signer: $signer) {
            public_id
            name
            email
            delivery_method
            action { name }
            link { id short_link }
            created_at
          }
        }
      `,
        { document_id, signer },
      );
      successResponse(
        res,
        data.createSigner,
        'Signatário adicionado com sucesso',
      );
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route DELETE /api/autentique/documents/:id/signers/:pub_id
 * @desc  Remove um signatário de um documento
 * @param id      — UUID do documento
 * @param pub_id  — public_id do signatário (obtido ao criar/listar)
 */
router.delete(
  '/documents/:id/signers/:pub_id',
  asyncHandler(async (req, res) => {
    const document_id = req.params.id;
    const public_id = req.params.pub_id;

    try {
      const data = await gql(
        `
        mutation DeleteSigner($public_id: UUID!, $document_id: UUID!) {
          deleteSigner(public_id: $public_id, document_id: $document_id)
        }
      `,
        { public_id, document_id },
      );
      successResponse(
        res,
        { deleted: data.deleteSigner },
        'Signatário removido com sucesso',
      );
    } catch (err) {
      handleError(res, err);
    }
  }),
);

/**
 * @route POST /api/autentique/folders
 * @desc  Cria uma pasta (normal, compartilhada ou subpasta)
 * @body {
 *   name: string (obrigatório),
 *   type?: "DEFAULT" | "GROUP" | "ORGANIZATION" (default: DEFAULT),
 *   parent_id?: string (UUID — se informado, cria como subpasta; máx 5 níveis)
 * }
 */
router.post(
  '/folders',
  asyncHandler(async (req, res) => {
    const { name, type, parent_id } = req.body;

    if (!name || name.trim().length < 1) {
      return errorResponse(
        res,
        'O campo name é obrigatório',
        400,
        'MISSING_NAME',
      );
    }

    const folderType = type || 'DEFAULT';
    const VALID_TYPES = ['DEFAULT', 'GROUP', 'ORGANIZATION'];
    if (!VALID_TYPES.includes(folderType)) {
      return errorResponse(
        res,
        `Tipo inválido. Valores aceitos: ${VALID_TYPES.join(', ')}`,
        400,
        'INVALID_FOLDER_TYPE',
      );
    }

    try {
      const data = await gql(
        `
        mutation CreateFolder($folder: FolderInput!, $type: FolderTypeEnum, $parent_id: UUID) {
          createFolder(folder: $folder, type: $type, parent_id: $parent_id) {
            id
            name
            slug
            context
            path
            children_counter
            created_at
            updated_at
          }
        }
      `,
        {
          folder: { name: name.trim() },
          type: folderType,
          parent_id: parent_id || null,
        },
      );
      successResponse(res, data.createFolder, 'Pasta criada com sucesso');
    } catch (err) {
      handleError(res, err);
    }
  }),
);

// =============================================================================
// TERMO DE CRÉDITO — Geração automática de PDF + envio para assinatura
// =============================================================================

// ─── Helper: detecta path do Chrome para Puppeteer ───────────────────────────
const getChromePath = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH)
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  try {
    const resolved = puppeteer.executablePath();
    if (resolved) return resolved;
  } catch {
    // ignore
  }
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
    const { fiscalNumber, phone: phoneOverride } = req.body;

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

    // ── 5. Envia para Autentique ──────────────────────────────────────────────
    const documentPayload = {
      name: `Termo de Crédito — ${cliente.name}`,
      message: `Olá ${cliente.name.split(' ')[0]}, segue o Termo de Crédito da Crosby para sua assinatura. Por favor leia o documento e assine eletronicamente.`,
      refusable: false,
      new_signature_style: true,
      ignore_cpf: false,
      configs: {
        notification_finished: true,
        notification_signed: true,
      },
    };

    const signersPayload = [
      {
        // Signatário 1: cliente
        name: cliente.name,
        phone: whatsappPhone,
        delivery_method: 'DELIVERY_METHOD_WHATSAPP',
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
      `📨 [TermoCredito] Enviando para Autentique → WhatsApp ${whatsappPhone}...`,
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

    // ── 6. Salva no banco (bluecred_contratos) ────────────────────────────────
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
      // Não bloqueia a resposta — apenas loga
      console.error(
        '⚠️ [TermoCredito] Falha ao salvar no banco:',
        dbErr.message,
      );
    }

    successResponse(
      res,
      {
        document: docCriado,
        cliente: {
          name: cliente.name,
          cpf: clean,
          whatsappPhone,
        },
      },
      `Termo de Crédito enviado para ${cliente.name} via WhatsApp (${whatsappPhone})`,
    );
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/autentique/bluecred/contratos — lista todos os contratos enviados
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/bluecred/contratos',
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase
      .from('bluecred_contratos')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    successResponse(res, data, 'Contratos Bluecred listados com sucesso');
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
