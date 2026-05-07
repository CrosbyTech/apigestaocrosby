import React, { useState, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import {
  Copy,
  Check,
  X,
  CaretDown,
  CaretRight,
  MagnifyingGlass,
  Code,
  Play,
  Spinner,
  Warning,
} from '@phosphor-icons/react';
import { API_BASE_URL } from '../config/constants';

// ==========================================
// DOCUMENTAÇÃO DAS ROTAS DE CONSULTA TOTVS
// ==========================================

const ROUTE_CATEGORIES = [
  {
    id: 'clientes',
    name: 'Dados Clientes',
    description:
      'Consultas de dados de pessoas físicas (PF) e jurídicas (PJ) na API TOTVS',
    icon: '👤',
    routes: [
      {
        name: 'Buscar PJ por Código',
        method: 'POST',
        path: '/api/totvs/legal-entity/search',
        description:
          'Busca dados completos de uma pessoa jurídica na API TOTVS pelo código da pessoa.',
        params: {
          body: {
            personCode: {
              type: 'number',
              required: true,
              description: 'Código da pessoa no TOTVS',
              placeholder: '180',
            },
          },
        },
        response: `{
  "success": true,
  "data": {
    "items": [{
      "code": 180, "name": "EMPRESA EXEMPLO LTDA", "fantasyName": "EXEMPLO",
      "cnpj": "12345678000190", "isCustomer": true, "customerStatus": "Normal",
      "phones": [...], "emails": [...], "addresses": [...]
    }],
    "hasNext": false, "total": 1
  }
}`,
      },
      {
        name: 'Buscar PJ por Nome',
        method: 'POST',
        path: '/api/totvs/legal-entity/search-by-name',
        description:
          'Busca PJs pelo nome fantasia. Percorre múltiplas páginas e filtra localmente.',
        params: {
          body: {
            fantasyName: {
              type: 'string',
              required: true,
              description: 'Nome fantasia (mín. 2 caracteres)',
              placeholder: 'EXEMPLO',
            },
            maxPages: {
              type: 'number',
              required: false,
              description: 'Máximo de páginas (default: 50)',
              placeholder: '50',
            },
          },
        },
      },
      {
        name: 'Buscar PJ por Telefone',
        method: 'POST',
        path: '/api/totvs/legal-entity/search-by-phone',
        description:
          'Busca PJ pelo número de telefone. Percorre páginas e filtra localmente.',
        params: {
          body: {
            phoneNumber: {
              type: 'string',
              required: true,
              description: 'Telefone (apenas números, mín. 8 dígitos)',
              placeholder: '85999991234',
            },
            maxPages: {
              type: 'number',
              required: false,
              description: 'Máximo de páginas (default: 30)',
              placeholder: '30',
            },
          },
        },
      },
      {
        name: 'Buscar PF por Código',
        method: 'POST',
        path: '/api/totvs/individual/search',
        description:
          'Busca dados completos de uma pessoa física na API TOTVS pelo código.',
        params: {
          body: {
            personCode: {
              type: 'number',
              required: true,
              description: 'Código da pessoa no TOTVS',
              placeholder: '500',
            },
          },
        },
      },
      {
        name: 'Buscar PF por Nome',
        method: 'POST',
        path: '/api/totvs/individual/search-by-name',
        description:
          'Busca PFs pelo nome. Percorre múltiplas páginas e filtra localmente.',
        params: {
          body: {
            name: {
              type: 'string',
              required: true,
              description: 'Nome para buscar (mín. 2 caracteres)',
              placeholder: 'FULANO',
            },
            maxPages: {
              type: 'number',
              required: false,
              description: 'Máximo de páginas (default: 50)',
              placeholder: '50',
            },
          },
        },
      },
      {
        name: 'Buscar PF por Telefone',
        method: 'POST',
        path: '/api/totvs/individual/search-by-phone',
        description: 'Busca PF pelo número de telefone na API TOTVS.',
        params: {
          body: {
            phoneNumber: {
              type: 'string',
              required: true,
              description: 'Telefone (apenas números, mín. 8 dígitos)',
              placeholder: '85999991234',
            },
          },
        },
      },
      {
        name: 'Batch Lookup (PJ + PF combinado)',
        method: 'POST',
        path: '/api/totvs/persons/batch-lookup',
        description:
          'Busca nome, fantasia, telefone e UF de múltiplas pessoas (PJ + PF em paralelo). Retorno consolidado por código.',
        params: {
          body: {
            personCodes: {
              type: 'number[]',
              required: true,
              description: 'Array de códigos de pessoa',
              placeholder: '[180, 500, 300]',
            },
          },
        },
      },
      {
        name: 'Batch Lookup PJ (cru)',
        method: 'POST',
        path: '/api/totvs/persons/legal-entities/batch-lookup',
        description:
          'Busca em lote APENAS de Pessoas Jurídicas. Retorna o array de items cru da API TOTVS (POST /person/v2/legal-entities/search).',
        params: {
          body: {
            personCodes: {
              type: 'number[]',
              required: true,
              description: 'Array de códigos de pessoa',
              placeholder: '[180, 500, 300]',
            },
            expand: {
              type: 'string',
              required: false,
              description:
                'Campos a expandir (default: phones). Ex: phones,emails,addresses,contacts,classifications',
              placeholder: 'phones,emails',
            },
          },
        },
      },
      {
        name: 'Batch Lookup PF (cru)',
        method: 'POST',
        path: '/api/totvs/persons/individuals/batch-lookup',
        description:
          'Busca em lote APENAS de Pessoas Físicas. Retorna o array de items cru da API TOTVS (POST /person/v2/individuals/search).',
        params: {
          body: {
            personCodes: {
              type: 'number[]',
              required: true,
              description: 'Array de códigos de pessoa',
              placeholder: '[180, 500, 300]',
            },
            expand: {
              type: 'string',
              required: false,
              description:
                'Campos a expandir (default: phones). Ex: phones,emails,addresses,contacts,classifications',
              placeholder: 'phones,emails',
            },
          },
        },
      },
      {
        name: 'Buscar Clientes (Supabase)',
        method: 'GET',
        path: '/api/totvs/clientes/search-name',
        description:
          'Busca clientes na tabela pes_pessoa do Supabase por nome, fantasia ou CPF/CNPJ. Retorno rápido.',
        params: {
          query: {
            nome: {
              type: 'string',
              required: false,
              description: 'Termo para buscar no nome',
              placeholder: 'EXEMPLO',
            },
            fantasia: {
              type: 'string',
              required: false,
              description: 'Termo para buscar no nome fantasia',
              placeholder: '',
            },
            cnpj: {
              type: 'string',
              required: false,
              description: 'CPF ou CNPJ',
              placeholder: '12345678000190',
            },
          },
        },
      },
      {
        name: 'Todos os Clientes (TOTVS)',
        method: 'GET',
        path: '/api/totvs/clientes/fetch-all',
        description:
          'Busca todos os clientes (PF + PJ) do TOTVS com paginação. Cache 10 min.',
        params: {
          query: {
            startDate: {
              type: 'string',
              required: false,
              description: 'Data início (YYYY-MM-DD)',
              placeholder: '2024-01-01',
            },
            endDate: {
              type: 'string',
              required: false,
              description: 'Data fim (YYYY-MM-DD)',
              placeholder: '2024-12-31',
            },
            personCode: {
              type: 'string',
              required: false,
              description: 'Código(s) (ex: 180 ou 180,200)',
              placeholder: '180',
            },
            page: {
              type: 'number',
              required: false,
              description: 'Página (default: 1)',
              placeholder: '1',
            },
            pageSize: {
              type: 'number',
              required: false,
              description: 'Itens/pág (default: 1000, máx: 5000)',
              placeholder: '100',
            },
          },
        },
      },
      {
        name: 'Clientes por Faixa de Códigos',
        method: 'GET',
        path: '/api/totvs/clientes/fetch-batch',
        description: 'Busca PF + PJ por faixa de códigos. Máx 1000 por vez.',
        params: {
          query: {
            startCode: {
              type: 'number',
              required: false,
              description: 'Código inicial (default: 1)',
              placeholder: '1',
            },
            endCode: {
              type: 'number',
              required: false,
              description: 'Código final (default: +499)',
              placeholder: '500',
            },
          },
        },
      },
      {
        name: 'Estatísticas do Cliente',
        method: 'POST',
        path: '/api/totvs/person-statistics',
        description:
          'Estatísticas financeiras/comerciais de um cliente por filial.',
        params: {
          body: {
            personCode: {
              type: 'number',
              required: true,
              description: 'Código da pessoa',
              placeholder: '180',
            },
            branchCode: {
              type: 'number',
              required: false,
              description: 'Filial (default: 1)',
              placeholder: '1',
            },
          },
        },
      },
    ],
  },
  {
    id: 'financeiro',
    name: 'Contas a Receber',
    description: 'Consultas de títulos, faturas e saldos financeiros',
    icon: '💰',
    routes: [
      {
        name: 'Contas a Receber (1 página)',
        method: 'POST',
        path: '/api/totvs/accounts-receivable/search',
        description:
          'Busca documentos de contas a receber. Retorna uma página por vez.',
        params: {
          body: {
            filter: {
              type: 'object',
              required: false,
              description: 'Filtros (ex: { customerCodeList: [180] })',
              placeholder: '{"customerCodeList": [180]}',
            },
            page: {
              type: 'number',
              required: false,
              description: 'Página (default: 1)',
              placeholder: '1',
            },
            pageSize: {
              type: 'number',
              required: false,
              description: 'Itens/pág (default: 100)',
              placeholder: '100',
            },
          },
        },
      },
      {
        name: 'Contas a Receber (todas páginas)',
        method: 'POST',
        path: '/api/totvs/accounts-receivable/search-all',
        description:
          'Busca TODAS as páginas de contas a receber automaticamente.',
        params: {
          body: {
            filter: {
              type: 'object',
              required: true,
              description: 'Filtros (ex: { customerCodeList: [180] })',
              placeholder: '{"customerCodeList": [180]}',
            },
          },
        },
      },
      {
        name: 'Contas a Receber (v3 otimizado)',
        method: 'GET',
        path: '/api/totvs/accounts-receivable/filter',
        description:
          'Rota otimizada: páginas em paralelo, lookup de nomes em batch, cache de branchCodes.',
        params: { query: {} },
      },
      {
        name: 'PMR (Prazo Médio Recebimento)',
        method: 'GET',
        path: '/api/totvs/accounts-receivable/pmr',
        description: 'Calcula o Prazo Médio de Recebimento.',
        params: { query: {} },
      },
      {
        name: 'Saldo Financeiro Franquias',
        method: 'POST',
        path: '/api/totvs/franchise-financial-balance',
        description: 'Saldo financeiro de clientes franquia.',
        params: {
          body: {
            customerCodeList: {
              type: 'number[]',
              required: true,
              description: 'Códigos dos clientes',
              placeholder: '[180, 200]',
            },
            branchCodeList: {
              type: 'number[]',
              required: false,
              description: 'Filiais',
              placeholder: '[1, 2]',
            },
            pageSize: {
              type: 'number',
              required: false,
              description: 'Itens/pág (default: 200, máx: 500)',
              placeholder: '200',
            },
          },
        },
      },
    ],
  },
  {
    id: 'contas-pagar',
    name: 'Contas a Pagar',
    description: 'Consulta de duplicatas de contas a pagar',
    icon: '💳',
    routes: [
      {
        name: 'Buscar Contas a Pagar',
        method: 'POST',
        path: '/api/totvs/accounts-payable/search',
        description: 'Busca duplicatas de contas a pagar. Paginação paralela.',
        params: {
          body: {
            dt_inicio: {
              type: 'string',
              required: true,
              description: 'Data início (YYYY-MM-DD)',
              placeholder: '2024-01-01',
            },
            dt_fim: {
              type: 'string',
              required: true,
              description: 'Data fim (YYYY-MM-DD)',
              placeholder: '2024-01-31',
            },
            branches: {
              type: 'number[]',
              required: true,
              description: 'Empresas',
              placeholder: '[1, 2, 5]',
            },
            modo: {
              type: 'string',
              required: false,
              description: 'vencimento | emissao | liquidacao',
              placeholder: 'vencimento',
            },
            situacao: {
              type: 'string',
              required: false,
              description: 'TODAS | N | C | A | D | L | Q',
              placeholder: 'N',
            },
            previsao: {
              type: 'string',
              required: false,
              description: 'TODOS | PREVISAO | REAL | CONSIGNADO',
              placeholder: 'TODOS',
            },
            supplierCodeList: {
              type: 'number[]',
              required: false,
              description: 'Fornecedores',
              placeholder: '',
            },
          },
        },
      },
    ],
  },
  {
    id: 'notas-fiscais',
    name: 'Notas Fiscais / DANFE',
    description: 'Consultas de notas fiscais, geração de DANFE e XML',
    icon: '🧾',
    routes: [
      {
        name: 'NFs (proxy direto)',
        method: 'POST',
        path: '/api/totvs/invoices-search',
        description:
          'Proxy para fiscal/v2/invoices/search. Retorna uma página.',
        params: {
          body: {
            filter: {
              type: 'object',
              required: false,
              description: 'Filtros',
              placeholder: '{"change": {}}',
            },
            page: {
              type: 'number',
              required: false,
              description: 'Página (default: 1)',
              placeholder: '1',
            },
            pageSize: {
              type: 'number',
              required: false,
              description: 'Itens/pág (default: 100)',
              placeholder: '100',
            },
          },
        },
      },
      {
        name: 'NFs otimizado (cache + paralelo)',
        method: 'POST',
        path: '/api/totvs/invoices/search',
        description:
          'Todas as NFs com pageSize 500, 10 páginas paralelas, cache 10min.',
        params: {
          body: {
            startDate: {
              type: 'string',
              required: true,
              description: 'Data início (YYYY-MM-DD)',
              placeholder: '2024-01-01',
            },
            endDate: {
              type: 'string',
              required: true,
              description: 'Data fim (YYYY-MM-DD)',
              placeholder: '2024-01-31',
            },
            branchCodeList: {
              type: 'number[]',
              required: false,
              description: 'Filiais',
              placeholder: '[1, 2, 5]',
            },
            operationType: {
              type: 'string',
              required: false,
              description: 'Tipo de operação',
              placeholder: '',
            },
            personCodeList: {
              type: 'number[]',
              required: false,
              description: 'Códigos de pessoa',
              placeholder: '',
            },
            noCache: {
              type: 'boolean',
              required: false,
              description: 'Bypass do cache',
              placeholder: 'false',
            },
          },
        },
      },
      {
        name: 'Buscar DANFE',
        method: 'POST',
        path: '/api/totvs/danfe-search',
        description: 'Gera DANFE a partir da chave XML da NF.',
        params: {
          body: {
            mainInvoiceXml: {
              type: 'string',
              required: true,
              description: 'Chave XML da NF',
              placeholder: '',
            },
            nfeDocumentType: {
              type: 'string',
              required: false,
              description: 'Tipo (default: NFeNormal)',
              placeholder: 'NFeNormal',
            },
          },
        },
      },
      {
        name: 'DANFE a partir de Invoice',
        method: 'POST',
        path: '/api/totvs/danfe-from-invoice',
        description: 'Busca NF e gera DANFE automaticamente (2 em 1).',
        params: {
          body: {
            filter: {
              type: 'object',
              required: true,
              description: 'Payload do invoices-search',
              placeholder: '{"change": {}}',
            },
          },
        },
      },
      {
        name: 'DANFE em Lote',
        method: 'POST',
        path: '/api/totvs/danfe-batch',
        description: 'Gera DANFE para múltiplas NFs de um cliente.',
        params: {
          body: {
            personCode: {
              type: 'number',
              required: true,
              description: 'Código do cliente',
              placeholder: '180',
            },
            branchCodeList: {
              type: 'number[]',
              required: false,
              description: 'Filiais',
              placeholder: '[1, 2]',
            },
            issueDates: {
              type: 'string[]',
              required: true,
              description: 'Datas de emissão',
              placeholder: '["2024-01-15", "2024-02-20"]',
            },
          },
        },
      },
      {
        name: 'XML por Chave de Acesso',
        method: 'GET',
        path: '/api/totvs/xml-contents/:accessKey',
        description: 'Retorna o conteúdo XML de uma NF pela chave de acesso.',
        params: {
          url: {
            accessKey: {
              type: 'string',
              required: true,
              description: 'Chave de acesso da NF-e',
              placeholder: '',
            },
          },
        },
      },
    ],
  },
  {
    id: 'boletos',
    name: 'Boletos',
    description: 'Geração de boletos bancários',
    icon: '🏦',
    routes: [
      {
        name: 'Gerar Boleto Bancário',
        method: 'POST',
        path: '/api/totvs/bank-slip',
        description: 'Gera boleto em base64 a partir dos dados do título.',
        params: {
          body: {
            branchCode: {
              type: 'number',
              required: true,
              description: 'Filial (máx 4 dígitos)',
              placeholder: '1',
            },
            customerCode: {
              type: 'number',
              required: false,
              description: 'Código cliente (se não informar CPF/CNPJ)',
              placeholder: '180',
            },
            customerCpfCnpj: {
              type: 'string',
              required: false,
              description: 'CPF/CNPJ (se não informar código)',
              placeholder: '',
            },
            receivableCode: {
              type: 'number',
              required: true,
              description: 'Código do título',
              placeholder: '12345',
            },
            installmentNumber: {
              type: 'number',
              required: true,
              description: 'Parcela',
              placeholder: '1',
            },
          },
        },
      },
    ],
  },
  {
    id: 'empresas',
    name: 'Empresas / Filiais',
    description: 'Consulta de empresas e filiais do TOTVS',
    icon: '🏢',
    routes: [
      {
        name: 'Listar Filiais',
        method: 'GET',
        path: '/api/totvs/branches',
        description: 'Lista empresas/filiais cadastradas no TOTVS.',
        params: {
          query: {
            branchCodePool: {
              type: 'number',
              required: false,
              description: 'Empresa base',
              placeholder: '',
            },
            page: {
              type: 'number',
              required: false,
              description: 'Página',
              placeholder: '1',
            },
            pageSize: {
              type: 'number',
              required: false,
              description: 'Itens/pág',
              placeholder: '1000',
            },
          },
        },
      },
      {
        name: 'Clientes Franquia',
        method: 'GET',
        path: '/api/totvs/franchise-clients',
        description: 'Códigos de clientes FRANQUIA. Cache 60 min.',
        params: {
          query: {
            refresh: {
              type: 'string',
              required: false,
              description: '"true" para forçar recarga',
              placeholder: '',
            },
          },
        },
      },
      {
        name: 'Clientes Multimarcas',
        method: 'GET',
        path: '/api/totvs/multibrand-clients',
        description: 'Códigos de clientes MULTIMARCAS. Cache 60 min.',
        params: {
          query: {
            refresh: {
              type: 'string',
              required: false,
              description: '"true" para forçar recarga',
              placeholder: '',
            },
          },
        },
      },
    ],
  },
  {
    id: 'faturamento',
    name: 'Faturamento / Fiscal',
    description: 'Movimentos fiscais, ranking e produtos mais vendidos',
    icon: '📊',
    routes: [
      {
        name: 'Movimentos Fiscais',
        method: 'POST',
        path: '/api/totvs/fiscal-movement/search',
        description:
          'Movimentos fiscais: ranking de faturamento por empresa e vendedor.',
        params: {
          body: {
            filter: {
              type: 'object',
              required: true,
              description:
                '{ branchCodeList, startMovementDate, endMovementDate }',
              placeholder:
                '{"branchCodeList": [1, 2], "startMovementDate": "2024-01-01T00:00:00", "endMovementDate": "2024-01-31T23:59:59"}',
            },
            page: {
              type: 'number',
              required: false,
              description: 'Página',
              placeholder: '1',
            },
            pageSize: {
              type: 'number',
              required: false,
              description: 'Itens/pág (máx: 1000)',
              placeholder: '500',
            },
          },
        },
      },
      {
        name: 'Produtos Mais Vendidos',
        method: 'POST',
        path: '/api/totvs/best-selling-products',
        description: 'Ranking de produtos mais vendidos num período.',
        params: {
          body: {
            branchs: {
              type: 'number[]',
              required: true,
              description: 'Filiais',
              placeholder: '[1, 2]',
            },
            datemin: {
              type: 'string',
              required: true,
              description: 'Data início',
              placeholder: '2024-01-01',
            },
            datemax: {
              type: 'string',
              required: true,
              description: 'Data fim',
              placeholder: '2024-01-31',
            },
          },
        },
      },
    ],
  },
  {
    id: 'painel-vendas',
    name: 'Painel de Vendas',
    description: 'Faturamento total, ranking por filial e vendedores',
    icon: '🏪',
    routes: [
      {
        name: 'Faturamento Total',
        method: 'POST',
        path: '/api/totvs/sale-panel/totals',
        description: 'Totais de faturamento para o Painel de Vendas.',
        params: {
          body: {
            filter: {
              type: 'object',
              required: true,
              description: 'Filtros de período e filiais',
              placeholder:
                '{"branchCodeList": [1], "startMovementDate": "2024-01-01T00:00:00", "endMovementDate": "2024-01-31T23:59:59"}',
            },
          },
        },
      },
      {
        name: 'Ranking por Filial',
        method: 'POST',
        path: '/api/totvs/sale-panel/ranking-faturamento',
        description: 'Ranking de faturamento por filial no período.',
        params: {
          body: {
            filter: {
              type: 'object',
              required: true,
              description: 'Filtros de período e filiais',
              placeholder:
                '{"branchCodeList": [1, 2], "startMovementDate": "2024-01-01T00:00:00", "endMovementDate": "2024-01-31T23:59:59"}',
            },
          },
        },
      },
      {
        name: 'Vendedores por Filial',
        method: 'POST',
        path: '/api/totvs/sale-panel/sellers',
        description: 'Vendedores e dados de vendas por filial.',
        params: {
          body: {
            filter: {
              type: 'object',
              required: true,
              description: 'Filtros de período e filiais',
              placeholder:
                '{"branchCodeList": [1], "startMovementDate": "2024-01-01T00:00:00", "endMovementDate": "2024-01-31T23:59:59"}',
            },
          },
        },
      },
    ],
  },
  // ═══════════════════════════════════════════════════════════════
  //  ESTOQUE  (categoria-pai com 4 subcategorias)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'estoque',
    name: 'Estoque',
    description:
      'Consultas de estoque TOTVS — Produtos, Saldos, Preços e Dados Cadastrais',
    icon: '📦',
    subcategories: [
      {
        id: 'estoque-busca',
        name: 'Busca de Produtos',
        description:
          'Consulta de dados de produtos, referências, códigos e produto por código',
        icon: '🔍',
        routes: [
          {
            name: 'Códigos de Produto (search)',
            method: 'POST',
            path: '/api/totvs/product-codes/search',
            description:
              'Retorna lista de códigos internos de produto filtrados. Paginação até 100.000 por página.',
            params: {
              body: {
                filter: {
                  type: 'object',
                  required: true,
                  description: 'ProductFilterModel — filtros de produto',
                  placeholder: '{"productCodeList": [12345, 67890]}',
                },
                page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                pageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 1000, máx 100000)',
                  placeholder: '1000',
                },
                order: {
                  type: 'string',
                  required: false,
                  description:
                    'Ordenação: productSku, referenceCode, colorCode, productSize, productCode',
                  placeholder: '-productCode',
                },
              },
            },
            response: `{
  "success": true,
  "data": {
    "count": 50, "totalPages": 1, "hasNext": false, "totalItems": 50,
    "items": [{ "productCode": 12345, "maxChangeFilterDate": "2024-01-15T10:30:00" }]
  }
}`,
          },
          {
            name: 'Dados Completos de Produto (search)',
            method: 'POST',
            path: '/api/totvs/products/search',
            description:
              'Busca dados completos de produtos: referência, cor, tamanho, barcode, classificações, fornecedores, etc.',
            params: {
              body: {
                filter: {
                  type: 'object',
                  required: true,
                  description:
                    'ProductFilterModel — productCodeList, referenceCodeList, productName, hasStock, branchInfo, etc',
                  placeholder:
                    '{"productCodeList": [12345], "branchInfo": {"branchCode": 1, "isActive": true}}',
                },
                option: {
                  type: 'object',
                  required: true,
                  description:
                    'ReferenceOptionModel — branchInfoCode (empresa base)',
                  placeholder: '{"branchInfoCode": 1}',
                },
                page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                pageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 1000)',
                  placeholder: '100',
                },
                expand: {
                  type: 'string',
                  required: false,
                  description:
                    'barCodes, classifications, additionalFields, suppliers, manufacturers, referenceCategories, referenceCodeSequences, webData, details, branchesProductBlocked, conservationInstructions',
                  placeholder: 'barCodes,classifications',
                },
                order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação',
                  placeholder: '-productCode',
                },
              },
            },
            response: `{
  "success": true,
  "data": {
    "count": 10, "totalPages": 1, "hasNext": false, "totalItems": 10,
    "items": [{
      "productCode": 12345, "productName": "CAMISETA POLO M",
      "productSku": "7891234567890", "referenceCode": "CAM001",
      "colorCode": "01", "colorDescription": "BRANCO", "sizeName": "M", "gridCode": 1,
      "barCodes": [{"barCode": "7891234567890", "isMainCode": true}],
      "classifications": [{"typeCode": 1, "typeName": "COLEÇÃO", "code": "INV24", "name": "INVERNO 2024"}]
    }]
  }
}`,
          },
          {
            name: 'Referências de Produto (search)',
            method: 'POST',
            path: '/api/totvs/product-references/search',
            description:
              'Busca dados agrupados por referência (grupo), com opção de expandir observações, barCodes, classificações, composição, fornecedores, etc.',
            params: {
              body: {
                filter: {
                  type: 'object',
                  required: true,
                  description: 'ProductFilterModel',
                  placeholder: '{"referenceCodeList": ["CAM001"]}',
                },
                option: {
                  type: 'object',
                  required: true,
                  description: 'ReferenceOptionModel — branchInfoCode',
                  placeholder: '{"branchInfoCode": 1}',
                },
                page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                pageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 1000)',
                  placeholder: '100',
                },
                expand: {
                  type: 'string',
                  required: false,
                  description:
                    'observations, details, barCodes, classifications, additionalFields, composition, suppliers, manufacturers, referenceCodeSequences, webData, webDetail, referenceCategories, measurementTableOmni, branchesProductBlocked, conservationInstructions',
                  placeholder: 'barCodes,composition,classifications',
                },
                order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação',
                  placeholder: '',
                },
              },
            },
          },
          {
            name: 'Produto por Código',
            method: 'GET',
            path: '/api/totvs/products/:code',
            description:
              'Busca dados de um produto/pack a partir de seu código. Retorna info de quantidade e lote quando aplicável.',
            params: {
              url: {
                code: {
                  type: 'string',
                  required: true,
                  description: 'Código do produto ou pack',
                  placeholder: '12345',
                },
              },
              query: {
                branchCode: {
                  type: 'number',
                  required: false,
                  description: 'Código da empresa (default 1)',
                  placeholder: '1',
                },
              },
            },
            response: `{
  "success": true,
  "data": {
    "count": 1, "totalPages": 1, "hasNext": false, "totalItems": 1,
    "items": [{
      "productCode": 12345, "productName": "CAMISETA POLO M",
      "productSku": "7891234567890", "referenceCode": "CAM001",
      "colorCode": "01", "colorDescription": "BRANCO", "sizeName": "M",
      "totalQuantity": 1, "isBatchItem": false, "isPack": false, "isRfid": false
    }]
  }
}`,
          },
        ],
      },
      {
        id: 'estoque-saldos',
        name: 'Saldos de Estoque',
        description:
          'Saldos de produtos, movimentação Kardex e saldos Omni (e-commerce)',
        icon: '📦',
        routes: [
          {
            name: 'Saldos de Estoque (Balances)',
            method: 'POST',
            path: '/api/totvs/product-balances',
            description:
              'Busca saldos de produtos por empresa/estoque. Permite expandir localizações. Retorna: estoque, pedido de venda, transação, pedido de compra, OP, planejamento.',
            params: {
              body: {
                filter: {
                  type: 'object',
                  required: true,
                  description:
                    'ProductFilterModel — productCodeList, referenceCodeList, productName, hasStock, branchStockCode, stockCode, branchInfo, classifications',
                  placeholder:
                    '{"hasStock": true, "branchStockCode": 1, "stockCode": 1}',
                },
                option: {
                  type: 'object',
                  required: true,
                  description:
                    'balances: [{branchCode, stockCodeList, isSalesOrder?, isTransaction?, isPurchaseOrder?, isProductionOrder?, isProductionPlanning?}]',
                  placeholder:
                    '{"balances": [{"branchCode": 1, "stockCodeList": [1]}]}',
                },
                page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                pageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 1000)',
                  placeholder: '100',
                },
                order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação',
                  placeholder: '',
                },
                expand: {
                  type: 'string',
                  required: false,
                  description: '"locations" para incluir localizações',
                  placeholder: 'locations',
                },
              },
            },
            response: `{
  "success": true,
  "data": {
    "data": [{
      "productCode": 12345, "productName": "CAMISETA POLO M",
      "productSku": "7891234567890", "referenceCode": "CAM001",
      "colorCode": "01", "colorDescription": "BRANCO", "sizeName": "M",
      "balances": [{
        "branchCode": 1, "stockCode": 1, "stockDescription": "Estoque",
        "stock": 150, "salesOrder": 10, "inputTransaction": 0, "outputTransaction": 5
      }]
    }],
    "total": 500, "count": 100, "totalPages": 5, "hasNext": true
  }
}`,
          },
          {
            name: 'Saldos Omni (por alteração)',
            method: 'POST',
            path: '/api/totvs/omni-changed-balances',
            description:
              'Busca saldos de produtos por alteração (integração Omni/e-commerce). Filtra por data de alteração e retorna estoque disponível.',
            params: {
              body: {
                filter: {
                  type: 'object',
                  required: false,
                  description:
                    'ProductBalanceOmniFilterModel — change: {startDate, endDate, balances, classifications}, productCodeList, hasStock',
                  placeholder:
                    '{"change": {"startDate": "2024-01-01T00:00:00", "endDate": "2024-01-31T23:59:59"}, "hasStock": true}',
                },
                option: {
                  type: 'object',
                  required: false,
                  description:
                    'isTransaction, isSalesOrder, salesOrderStatusList',
                  placeholder: '{"isSalesOrder": true}',
                },
                page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                pageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 500)',
                  placeholder: '100',
                },
              },
            },
          },
          {
            name: 'Movimentação Kardex',
            method: 'GET',
            path: '/api/totvs/kardex-movement',
            description:
              'Consulta a movimentação kardex (entradas/saídas) de um produto. Intervalo máximo de 180 dias entre data inicial e final.',
            params: {
              query: {
                ProductCode: {
                  type: 'number',
                  required: true,
                  description: 'Código do produto',
                  placeholder: '12345',
                },
                BranchCode: {
                  type: 'number',
                  required: false,
                  description: 'Código da empresa (máx 4 dígitos)',
                  placeholder: '1',
                },
                StartDate: {
                  type: 'string',
                  required: false,
                  description: 'Data início (ISO 8601)',
                  placeholder: '2024-01-01T00:00:00',
                },
                EndDate: {
                  type: 'string',
                  required: false,
                  description: 'Data fim (ISO 8601)',
                  placeholder: '2024-06-30T23:59:59',
                },
                BalanceType: {
                  type: 'number',
                  required: false,
                  description: 'Tipo de saldo (máx 3 dígitos)',
                  placeholder: '1',
                },
              },
            },
            response: `{
  "success": true,
  "data": {
    "branchCode": 1, "balanceType": 1,
    "productCode": 12345, "productName": "CAMISETA POLO M",
    "previousBalance": 100,
    "movements": [{
      "date": "2024-01-15T00:00:00", "transactionCode": 1001,
      "document": "NF-12345", "amount": 50.00,
      "inQuantity": 50, "outQuantity": 0, "balance": 150
    }]
  }
}`,
          },
        ],
      },
      {
        id: 'estoque-precos',
        name: 'Preços e Custos',
        description:
          'Consulta de preços, custos, tabelas de preço, cabeçalhos e escalas',
        icon: '💲',
        routes: [
          {
            name: 'Preços de Produto (search)',
            method: 'POST',
            path: '/api/totvs/product-prices/search',
            description:
              'Busca preços de produtos por filtro. Requer option.prices com branchCode e priceCodeList.',
            params: {
              body: {
                filter: {
                  type: 'object',
                  required: true,
                  description: 'ProductFilterModel',
                  placeholder: '{"productCodeList": [12345]}',
                },
                option: {
                  type: 'object',
                  required: true,
                  description:
                    'prices: [{branchCode, priceCodeList, isPromotionalPrice?, isScheduledPrice?}]',
                  placeholder:
                    '{"prices": [{"branchCode": 1, "priceCodeList": [1]}]}',
                },
                page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                pageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 1000)',
                  placeholder: '100',
                },
                expand: {
                  type: 'string',
                  required: false,
                  description:
                    'promotionalInformation, informationOtherPromotions',
                  placeholder: '',
                },
                order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação',
                  placeholder: '',
                },
              },
            },
            response: `{
  "success": true,
  "data": {
    "count": 5, "totalPages": 1, "hasNext": false, "totalItems": 5,
    "items": [{
      "productCode": 12345, "productName": "CAMISETA POLO M",
      "productSku": "7891234567890", "referenceCode": "CAM001",
      "prices": [{"branchCode": 1, "priceCode": 1, "priceName": "Preço Venda", "price": 89.90}]
    }]
  }
}`,
          },
          {
            name: 'Custos de Produto (search)',
            method: 'POST',
            path: '/api/totvs/product-costs/search',
            description:
              'Busca custos de produtos por filtro. Requer option.costs com branchCode e costCodeList.',
            params: {
              body: {
                filter: {
                  type: 'object',
                  required: true,
                  description: 'ProductFilterModel',
                  placeholder: '{"productCodeList": [12345]}',
                },
                option: {
                  type: 'object',
                  required: true,
                  description: 'costs: [{branchCode, costCodeList}]',
                  placeholder:
                    '{"costs": [{"branchCode": 1, "costCodeList": [1]}]}',
                },
                page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                pageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 1000)',
                  placeholder: '100',
                },
                order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação',
                  placeholder: '',
                },
              },
            },
          },
          {
            name: 'Tabela de Preço (search)',
            method: 'POST',
            path: '/api/totvs/price-tables/search',
            description:
              'Busca preços de tabela de preço. Requer option com branchCodeList e priceTableCode.',
            params: {
              body: {
                filter: {
                  type: 'object',
                  required: true,
                  description: 'ProductFilterModel',
                  placeholder: '{"productCodeList": [12345]}',
                },
                option: {
                  type: 'object',
                  required: true,
                  description: 'branchCodeList, priceTableCode',
                  placeholder:
                    '{"branchCodeList": [1, 2], "priceTableCode": 1}',
                },
                page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                pageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 1000)',
                  placeholder: '100',
                },
                order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação',
                  placeholder: '',
                },
              },
            },
          },
          {
            name: 'Cabeçalhos de Tabela de Preço',
            method: 'GET',
            path: '/api/totvs/price-tables-headers',
            description: 'Lista cabeçalhos das tabelas de preço cadastradas.',
            params: {
              query: {
                StartChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora inicial de alteração',
                  placeholder: '',
                },
                EndChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora final de alteração',
                  placeholder: '',
                },
                PriceTableCodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de tabela (separados por vírgula)',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 1000, máx 1000)',
                  placeholder: '1000',
                },
                Order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação: code, maxChangeFilterDate',
                  placeholder: '',
                },
              },
            },
          },
          {
            name: 'Escalas de Tabela de Preço',
            method: 'GET',
            path: '/api/totvs/price-table-scales',
            description: 'Lista escalas de tabela de preço.',
            params: {
              query: {
                StartChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora inicial de alteração',
                  placeholder: '',
                },
                EndChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora final de alteração',
                  placeholder: '',
                },
                ScaleCodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de escala',
                  placeholder: '',
                },
                PriceTableCodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de tabela de preço',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 1000, máx 1000)',
                  placeholder: '1000',
                },
              },
            },
          },
        ],
      },
      {
        id: 'estoque-cadastros',
        name: 'Dados Cadastrais de Produto',
        description:
          'Categorias, grades, cores, classificações, composições, lotes, unidades de medida e campos adicionais',
        icon: '📋',
        routes: [
          {
            name: 'Categorias',
            method: 'GET',
            path: '/api/totvs/categories',
            description:
              'Lista categorias e subcategorias de produtos. Tipos: 1-Categoria, 2-Subcategoria, 3-Fabricante, 4-Filtro.',
            params: {
              query: {
                StartChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora inicial',
                  placeholder: '',
                },
                EndChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora final',
                  placeholder: '',
                },
                Order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação: code, maxChangeFilterDate',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 1000, máx 1000)',
                  placeholder: '1000',
                },
              },
            },
            response: `{
  "success": true,
  "data": {
    "count": 20, "totalPages": 1, "hasNext": false, "totalItems": 20,
    "items": [
      {"code": 1, "name": "MASCULINO", "parentCategoryCode": null, "categoryType": 1},
      {"code": 10, "name": "CAMISETAS", "parentCategoryCode": 1, "categoryType": 2}
    ]
  }
}`,
          },
          {
            name: 'Grades',
            method: 'GET',
            path: '/api/totvs/grids',
            description: 'Lista grades cadastradas com opções de tamanho.',
            params: {
              query: {
                StartChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora inicial',
                  placeholder: '',
                },
                EndChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora final',
                  placeholder: '',
                },
                Order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 1000, máx 1000)',
                  placeholder: '1000',
                },
              },
            },
            response: `{
  "success": true,
  "data": {
    "count": 5, "items": [
      {"code": 1, "name": "ADULTO", "type": "TAMANHO", "grid": ["PP", "P", "M", "G", "GG", "XG"]}
    ]
  }
}`,
          },
          {
            name: 'Cores (search)',
            method: 'POST',
            path: '/api/totvs/colors/search',
            description:
              'Busca dados de cores cadastradas. Filtro por alteração, código, status.',
            params: {
              body: {
                filter: {
                  type: 'object',
                  required: false,
                  description:
                    'ColorFilterModel — change, colorCodeList, isActive, isFinishedProduct, isRawMaterial, isBulkMaterial',
                  placeholder: '{"isActive": true}',
                },
                expand: {
                  type: 'string',
                  required: false,
                  description:
                    '"additionalColorInformation" para dados adicionais',
                  placeholder: '',
                },
                page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                pageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 500)',
                  placeholder: '100',
                },
              },
            },
          },
          {
            name: 'Classificações',
            method: 'GET',
            path: '/api/totvs/classifications',
            description:
              'Lista classificações de produto por tipo (coleção, linha, marca, etc).',
            params: {
              query: {
                StartChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora inicial',
                  placeholder: '',
                },
                EndChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora final',
                  placeholder: '',
                },
                TypeCodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de tipo de classificação',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 1000, máx 1000)',
                  placeholder: '1000',
                },
              },
            },
          },
          {
            name: 'Tipos de Classificação',
            method: 'GET',
            path: '/api/totvs/classification-types',
            description:
              'Lista tipos de classificação (ex: Coleção, Marca, Linha).',
            params: {
              query: {
                StartChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora inicial',
                  placeholder: '',
                },
                EndChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora final',
                  placeholder: '',
                },
                ClassificationTypeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de tipo (max 100)',
                  placeholder: '',
                },
                IsGroup: {
                  type: 'string',
                  required: false,
                  description: 'true/false',
                  placeholder: '',
                },
                Order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 100)',
                  placeholder: '100',
                },
              },
            },
          },
          {
            name: 'Unidades de Medida',
            method: 'GET',
            path: '/api/totvs/measurement-unit',
            description: 'Lista unidades de medida (espécie) cadastradas.',
            params: {
              query: {
                StartChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora inicial',
                  placeholder: '',
                },
                EndChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora final',
                  placeholder: '',
                },
                MeasurementUnitList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de espécie (max 100)',
                  placeholder: '',
                },
                Expand: {
                  type: 'string',
                  required: false,
                  description: '"additionalVariations"',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 1000, máx 1000)',
                  placeholder: '1000',
                },
              },
            },
          },
          {
            name: 'Composições (search)',
            method: 'POST',
            path: '/api/totvs/compositions/search',
            description:
              'Busca composições de fibras de produtos. Expandir "fibers" para detalhes de fibras.',
            params: {
              body: {
                startChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora inicial alteração',
                  placeholder: '',
                },
                endChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora final alteração',
                  placeholder: '',
                },
                codeList: {
                  type: 'number[]',
                  required: false,
                  description: 'Lista de códigos de composição',
                  placeholder: '[1, 2, 3]',
                },
                description: {
                  type: 'string',
                  required: false,
                  description: 'Descrição da fibra (máx 40 chars)',
                  placeholder: '',
                },
                order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação',
                  placeholder: '',
                },
                page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                pageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 100)',
                  placeholder: '100',
                },
                expand: {
                  type: 'string',
                  required: false,
                  description: '"fibers" para detalhar fibras',
                  placeholder: 'fibers',
                },
              },
            },
          },
          {
            name: 'Composição por Grupo de Produto',
            method: 'GET',
            path: '/api/totvs/composition-group-product',
            description:
              'Consulta composição por grupo de produto. Informar ao menos um: ProductCodeList, GroupCodeList ou ReferenceCodeList.',
            params: {
              query: {
                ProductCodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de produto (max 100)',
                  placeholder: '12345',
                },
                GroupCodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de grupo (max 100)',
                  placeholder: '',
                },
                ReferenceCodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de referência (max 100)',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 100)',
                  placeholder: '100',
                },
              },
            },
          },
          {
            name: 'Composição por Produto',
            method: 'GET',
            path: '/api/totvs/composition-product',
            description:
              'Consulta composição por produto. Informar ao menos um: ProductCodeList, GroupCodeList ou ReferenceCodeList.',
            params: {
              query: {
                ProductCodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de produto (max 100)',
                  placeholder: '12345',
                },
                GroupCodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de grupo (max 100)',
                  placeholder: '',
                },
                ReferenceCodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de referência (max 100)',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 100)',
                  placeholder: '100',
                },
              },
            },
          },
          {
            name: 'Lotes (Batch search)',
            method: 'POST',
            path: '/api/totvs/batch/search',
            description:
              'Busca dados de lotes de produto. Filtra por empresa, data alteração, código, situação, saldo.',
            params: {
              body: {
                filter: {
                  type: 'object',
                  required: true,
                  description:
                    'BatchProductFilterModel — branchCode, updatedDateStart, updatedDateEnd, productCodeList, batchCodeList, hasBalance, situationsList, balanceCodeList',
                  placeholder: '{"branchCode": 1, "hasBalance": true}',
                },
                page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                pageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 1000)',
                  placeholder: '100',
                },
              },
            },
          },
          {
            name: 'Tipos de Campos Adicionais',
            method: 'GET',
            path: '/api/totvs/additional-fields-types',
            description: 'Lista tipos de campos adicionais de produto.',
            params: {
              query: {
                StartChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora inicial',
                  placeholder: '',
                },
                EndChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora final',
                  placeholder: '',
                },
                CodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos (max 100)',
                  placeholder: '',
                },
                Description: {
                  type: 'string',
                  required: false,
                  description: 'Descrição (máx 60 chars)',
                  placeholder: '',
                },
                Order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 100)',
                  placeholder: '100',
                },
              },
            },
          },
          {
            name: 'Config. Agrupador de Produto',
            method: 'GET',
            path: '/api/totvs/product-grouper-config',
            description: 'Lista configurações de agrupadores de produto.',
            params: {
              query: {
                StartChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora inicial',
                  placeholder: '',
                },
                EndChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora final',
                  placeholder: '',
                },
                GrouperCodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos de agrupador (max 100)',
                  placeholder: '',
                },
                Order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação: grouperCode, maxChangeFilterDate',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 100)',
                  placeholder: '100',
                },
              },
            },
          },
          {
            name: 'Itens de Instrução',
            method: 'GET',
            path: '/api/totvs/instruction-items',
            description:
              'Lista itens de instrução de produto. Expandir "image, globalImage" para imagens.',
            params: {
              query: {
                StartChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora inicial',
                  placeholder: '',
                },
                EndChangeDate: {
                  type: 'string',
                  required: false,
                  description: 'Data/hora final',
                  placeholder: '',
                },
                CodeList: {
                  type: 'string',
                  required: false,
                  description: 'Códigos (max 100)',
                  placeholder: '',
                },
                Description: {
                  type: 'string',
                  required: false,
                  description: 'Descrição (máx 40 chars)',
                  placeholder: '',
                },
                Order: {
                  type: 'string',
                  required: false,
                  description: 'Ordenação',
                  placeholder: '',
                },
                Expand: {
                  type: 'string',
                  required: false,
                  description: '"image, globalImage"',
                  placeholder: '',
                },
                Page: {
                  type: 'number',
                  required: false,
                  description: 'Página (default 1)',
                  placeholder: '1',
                },
                PageSize: {
                  type: 'number',
                  required: false,
                  description: 'Itens/pág (default 100, máx 100)',
                  placeholder: '100',
                },
              },
            },
          },
        ],
      },
    ], // fim subcategories
  },
  {
    id: 'vouchers',
    name: 'Vouchers',
    description: 'Consulta de vouchers',
    icon: '🎫',
    routes: [
      {
        name: 'Buscar Vouchers',
        method: 'GET',
        path: '/api/totvs/vouchers/search',
        description: 'Busca vouchers disponíveis.',
        params: { query: {} },
      },
    ],
  },
  {
    id: 'token',
    name: 'Autenticação',
    description: 'Token da API TOTVS',
    icon: '🔑',
    routes: [
      {
        name: 'Obter Token Atual',
        method: 'GET',
        path: '/api/totvs/token',
        description: 'Retorna o token TOTVS atual (renovado a cada 6 horas).',
        params: {},
      },
    ],
  },
];

// ==========================================
// CAMPOS pes_pessoa (Supabase)
// ==========================================
const PES_PESSOA_FIELDS = [
  { campo: 'code', tipo: 'number', descricao: 'Código da pessoa (PK)' },
  { campo: 'cd_empresacad', tipo: 'number', descricao: 'Empresa de cadastro' },
  { campo: 'tipo_pessoa', tipo: 'string', descricao: '"PF" ou "PJ"' },
  { campo: 'nm_pessoa', tipo: 'string', descricao: 'Nome / Razão social' },
  { campo: 'fantasy_name', tipo: 'string', descricao: 'Nome fantasia' },
  { campo: 'uf', tipo: 'string', descricao: 'Estado (UF)' },
  { campo: 'insert_date', tipo: 'string', descricao: 'Data cadastro TOTVS' },
  { campo: 'cpf', tipo: 'string', descricao: 'CPF ou CNPJ' },
  { campo: 'is_inactive', tipo: 'boolean', descricao: 'Inativo' },
  { campo: 'is_customer', tipo: 'boolean', descricao: 'É cliente' },
  { campo: 'customer_status', tipo: 'string', descricao: 'Status cliente' },
  { campo: 'telefone', tipo: 'string', descricao: 'Telefone principal' },
  { campo: 'email', tipo: 'string', descricao: 'E-mail principal' },
  { campo: 'phones', tipo: 'json[]', descricao: 'Todos os telefones' },
  { campo: 'emails', tipo: 'json[]', descricao: 'Todos os e-mails' },
  { campo: 'addresses', tipo: 'json[]', descricao: 'Endereços' },
  { campo: 'classifications', tipo: 'json[]', descricao: 'Classificações' },
  { campo: 'updated_at', tipo: 'string', descricao: 'Última sincronização' },
];

// ==========================================
// SCHEMA DE FILTRO COMUM (ProductFilterModel)
// ==========================================
const PRODUCT_FILTER_FIELDS = [
  {
    campo: 'change',
    tipo: 'object',
    descricao:
      'Filtro por alteração: { startDate, endDate, inProduct, inBranchInfo, inPrice, inStock, inBarCode, ... }',
  },
  {
    campo: 'startProductCode',
    tipo: 'number',
    descricao: 'Código interno inicial de intervalo',
  },
  {
    campo: 'endProductCode',
    tipo: 'number',
    descricao: 'Código interno final de intervalo',
  },
  {
    campo: 'productCodeList',
    tipo: 'number[]',
    descricao: 'Lista de códigos internos de produto',
  },
  {
    campo: 'referenceCodeList',
    tipo: 'string[]',
    descricao: 'Lista de códigos de referência',
  },
  {
    campo: 'productName',
    tipo: 'string',
    descricao: 'Descrição do produto (busca parcial)',
  },
  {
    campo: 'groupCodeList',
    tipo: 'string[]',
    descricao: 'Lista de códigos de grupo',
  },
  {
    campo: 'barCodeList',
    tipo: 'string[]',
    descricao: 'Lista de códigos de barra',
  },
  {
    campo: 'hasStock',
    tipo: 'boolean',
    descricao: 'Possui saldo em estoque (requer branchStockCode + stockCode)',
  },
  {
    campo: 'branchStockCode',
    tipo: 'number',
    descricao: 'Empresa para verificar saldo',
  },
  {
    campo: 'stockCode',
    tipo: 'number',
    descricao: 'Código do saldo de estoque',
  },
  {
    campo: 'hasPrice',
    tipo: 'boolean',
    descricao: 'Possui preço (requer branchPriceCodeList + priceCodeList)',
  },
  {
    campo: 'hasCost',
    tipo: 'boolean',
    descricao: 'Possui custo (requer branchCostCodeList + costCodeList)',
  },
  {
    campo: 'hasWebInfo',
    tipo: 'boolean',
    descricao: 'Possui dados de e-commerce',
  },
  {
    campo: 'branchInfo',
    tipo: 'object',
    descricao:
      '{ branchCode, isActive, isFinishedProduct, isRawMaterial, isBulkMaterial, isOwnProduction }',
  },
  {
    campo: 'classifications',
    tipo: 'object[]',
    descricao: '[{ type: number, codeList: string[] }]',
  },
  { campo: 'suppliers', tipo: 'object[]', descricao: '[{ code: number }]' },
  { campo: 'manufacturers', tipo: 'object[]', descricao: '[{ code: number }]' },
];

// ==========================================
// META DAS ROTAS DE ESTOQUE (Schema + Teste)
// ==========================================
const ESTOQUE_ROUTE_META = {
  '/api/totvs/product-codes/search': {
    filterRef: 'ProductFilterModel',
    response: [
      {
        campo: 'productCode',
        tipo: 'number',
        desc: 'Código interno do produto',
      },
      {
        campo: 'maxChangeFilterDate',
        tipo: 'datetime',
        desc: 'Data/hora da última alteração',
      },
    ],
    testFields: [
      {
        key: 'productCode',
        label: 'Cód. Produto',
        placeholder: '12345',
        required: true,
      },
    ],
  },
  '/api/totvs/products/search': {
    filterRef: 'ProductFilterModel',
    optionFields: [
      {
        campo: 'branchInfoCode',
        tipo: 'number',
        desc: 'Empresa base para dados de filial (obrigatório)',
      },
    ],
    expandOpts:
      'barCodes, classifications, additionalFields, suppliers, manufacturers, referenceCategories, referenceCodeSequences, webData, details, branchesProductBlocked, conservationInstructions',
    response: [
      { campo: 'productCode', tipo: 'number', desc: 'Código interno' },
      { campo: 'productName', tipo: 'string', desc: 'Nome do produto' },
      { campo: 'productSku', tipo: 'string', desc: 'SKU / barcode principal' },
      {
        campo: 'referenceCode',
        tipo: 'string',
        desc: 'Código de referência (grupo)',
      },
      { campo: 'colorCode', tipo: 'string', desc: 'Código da cor' },
      { campo: 'colorDescription', tipo: 'string', desc: 'Nome da cor' },
      { campo: 'sizeName', tipo: 'string', desc: 'Tamanho' },
      { campo: 'gridCode', tipo: 'number', desc: 'Código da grade' },
      { campo: 'isActive', tipo: 'boolean', desc: 'Ativo na empresa base' },
      {
        campo: 'barCodes[]',
        tipo: 'array',
        desc: 'Códigos de barra (expand: barCodes)',
      },
      {
        campo: 'classifications[]',
        tipo: 'array',
        desc: 'Classificações (expand: classifications)',
      },
      {
        campo: 'suppliers[]',
        tipo: 'array',
        desc: 'Fornecedores (expand: suppliers)',
      },
    ],
    testFields: [
      {
        key: 'branchCode',
        label: 'Empresa',
        placeholder: '1',
        defaultVal: '1',
      },
      {
        key: 'productCode',
        label: 'Cód. Produto',
        placeholder: '12345',
        required: true,
      },
      {
        key: 'expand',
        label: 'Expand',
        placeholder: 'barCodes,classifications',
      },
    ],
  },
  '/api/totvs/product-references/search': {
    filterRef: 'ProductFilterModel',
    optionFields: [
      {
        campo: 'branchInfoCode',
        tipo: 'number',
        desc: 'Empresa base (obrigatório)',
      },
    ],
    expandOpts:
      'observations, details, barCodes, classifications, additionalFields, composition, suppliers, manufacturers, referenceCodeSequences, webData, webDetail, referenceCategories, measurementTableOmni, branchesProductBlocked, conservationInstructions',
    response: [
      { campo: 'referenceCode', tipo: 'string', desc: 'Código da referência' },
      { campo: 'referenceName', tipo: 'string', desc: 'Nome da referência' },
      { campo: 'gridCode', tipo: 'number', desc: 'Código da grade' },
      { campo: 'isActive', tipo: 'boolean', desc: 'Ativo' },
      { campo: 'colors[]', tipo: 'array', desc: 'Cores disponíveis' },
      { campo: 'sizes[]', tipo: 'array', desc: 'Tamanhos disponíveis' },
    ],
    testFields: [
      {
        key: 'branchCode',
        label: 'Empresa',
        placeholder: '1',
        defaultVal: '1',
      },
      {
        key: 'referenceCode',
        label: 'Cód. Referência',
        placeholder: 'CAM001',
        required: true,
      },
      {
        key: 'expand',
        label: 'Expand',
        placeholder: 'barCodes,classifications',
      },
    ],
  },
  '/api/totvs/products/:code': {
    response: [
      { campo: 'productCode', tipo: 'number', desc: 'Código interno' },
      { campo: 'productName', tipo: 'string', desc: 'Nome do produto' },
      { campo: 'productSku', tipo: 'string', desc: 'SKU / barcode' },
      { campo: 'referenceCode', tipo: 'string', desc: 'Referência' },
      { campo: 'colorCode', tipo: 'string', desc: 'Código da cor' },
      { campo: 'colorDescription', tipo: 'string', desc: 'Nome da cor' },
      { campo: 'sizeName', tipo: 'string', desc: 'Tamanho' },
      {
        campo: 'totalQuantity',
        tipo: 'number',
        desc: 'Quantidade total (pack)',
      },
      { campo: 'isBatchItem', tipo: 'boolean', desc: 'É item de lote' },
      { campo: 'isPack', tipo: 'boolean', desc: 'É pack' },
      { campo: 'isRfid', tipo: 'boolean', desc: 'Possui RFID' },
    ],
    testFields: [
      {
        key: 'code',
        label: 'Cód. Produto',
        placeholder: '12345',
        required: true,
      },
      {
        key: 'branchCode',
        label: 'Empresa',
        placeholder: '1',
        defaultVal: '1',
      },
    ],
  },
  '/api/totvs/product-balances': {
    filterRef: 'ProductFilterModel',
    optionFields: [
      {
        campo: 'balances[].branchCode',
        tipo: 'number',
        desc: 'Código da empresa (obrigatório)',
      },
      {
        campo: 'balances[].stockCodeList',
        tipo: 'number[]',
        desc: 'Códigos de estoque (obrigatório)',
      },
      {
        campo: 'balances[].isSalesOrder',
        tipo: 'boolean',
        desc: 'Incluir pedidos de venda',
      },
      {
        campo: 'balances[].isTransaction',
        tipo: 'boolean',
        desc: 'Incluir transações',
      },
      {
        campo: 'balances[].isPurchaseOrder',
        tipo: 'boolean',
        desc: 'Incluir pedidos de compra',
      },
      {
        campo: 'balances[].isProductionOrder',
        tipo: 'boolean',
        desc: 'Incluir ordens de produção',
      },
    ],
    expandOpts: 'locations',
    response: [
      { campo: 'productCode', tipo: 'number', desc: 'Código interno' },
      { campo: 'productName', tipo: 'string', desc: 'Nome do produto' },
      { campo: 'productSku', tipo: 'string', desc: 'SKU' },
      { campo: 'referenceCode', tipo: 'string', desc: 'Referência' },
      { campo: 'colorDescription', tipo: 'string', desc: 'Nome da cor' },
      { campo: 'sizeName', tipo: 'string', desc: 'Tamanho' },
      { campo: 'balances[].branchCode', tipo: 'number', desc: 'Empresa' },
      { campo: 'balances[].stockCode', tipo: 'number', desc: 'Código estoque' },
      {
        campo: 'balances[].stockDescription',
        tipo: 'string',
        desc: 'Descrição estoque',
      },
      { campo: 'balances[].stock', tipo: 'number', desc: 'Saldo em estoque' },
      {
        campo: 'balances[].salesOrder',
        tipo: 'number',
        desc: 'Pedido de venda',
      },
      {
        campo: 'balances[].inputTransaction',
        tipo: 'number',
        desc: 'Transação entrada',
      },
      {
        campo: 'balances[].outputTransaction',
        tipo: 'number',
        desc: 'Transação saída',
      },
    ],
    testFields: [
      {
        key: 'branchCode',
        label: 'Empresa',
        placeholder: '1',
        defaultVal: '1',
        required: true,
      },
      {
        key: 'productCode',
        label: 'Cód. Produto',
        placeholder: '12345',
        required: true,
      },
    ],
  },
  '/api/totvs/omni-changed-balances': {
    response: [
      { campo: 'productCode', tipo: 'number', desc: 'Código interno' },
      { campo: 'productSku', tipo: 'string', desc: 'SKU' },
      { campo: 'branchCode', tipo: 'number', desc: 'Empresa' },
      { campo: 'stockCode', tipo: 'number', desc: 'Código estoque' },
      { campo: 'stock', tipo: 'number', desc: 'Saldo em estoque' },
      { campo: 'salesOrder', tipo: 'number', desc: 'Pedido de venda' },
      { campo: 'avaliableStock', tipo: 'number', desc: 'Estoque disponível' },
    ],
    testFields: [
      { key: 'productCode', label: 'Cód. Produto', placeholder: '12345' },
      {
        key: 'hasStock',
        label: 'Apenas com saldo',
        placeholder: 'true',
        defaultVal: 'true',
      },
    ],
  },
  '/api/totvs/kardex-movement': {
    response: [
      { campo: 'branchCode', tipo: 'number', desc: 'Empresa' },
      { campo: 'productCode', tipo: 'number', desc: 'Código do produto' },
      { campo: 'productName', tipo: 'string', desc: 'Nome do produto' },
      { campo: 'previousBalance', tipo: 'number', desc: 'Saldo anterior' },
      {
        campo: 'movements[].date',
        tipo: 'datetime',
        desc: 'Data do movimento',
      },
      {
        campo: 'movements[].transactionCode',
        tipo: 'number',
        desc: 'Código transação',
      },
      { campo: 'movements[].document', tipo: 'string', desc: 'Documento' },
      { campo: 'movements[].amount', tipo: 'number', desc: 'Valor' },
      { campo: 'movements[].inQuantity', tipo: 'number', desc: 'Qtd entrada' },
      { campo: 'movements[].outQuantity', tipo: 'number', desc: 'Qtd saída' },
      { campo: 'movements[].balance', tipo: 'number', desc: 'Saldo' },
    ],
    testFields: [
      {
        key: 'ProductCode',
        label: 'Cód. Produto',
        placeholder: '12345',
        required: true,
      },
      {
        key: 'BranchCode',
        label: 'Empresa',
        placeholder: '1',
        defaultVal: '1',
      },
    ],
  },
  '/api/totvs/product-prices/search': {
    filterRef: 'ProductFilterModel',
    optionFields: [
      {
        campo: 'prices[].branchCode',
        tipo: 'number',
        desc: 'Código da empresa (obrigatório)',
      },
      {
        campo: 'prices[].priceCodeList',
        tipo: 'number[]',
        desc: 'Códigos de preço (obrigatório)',
      },
      {
        campo: 'prices[].isPromotionalPrice',
        tipo: 'boolean',
        desc: 'Preço promocional',
      },
      {
        campo: 'prices[].isScheduledPrice',
        tipo: 'boolean',
        desc: 'Preço agendado',
      },
    ],
    expandOpts: 'promotionalInformation, informationOtherPromotions',
    response: [
      { campo: 'productCode', tipo: 'number', desc: 'Código interno' },
      { campo: 'productName', tipo: 'string', desc: 'Nome do produto' },
      { campo: 'productSku', tipo: 'string', desc: 'SKU' },
      { campo: 'referenceCode', tipo: 'string', desc: 'Referência' },
      { campo: 'prices[].branchCode', tipo: 'number', desc: 'Empresa' },
      { campo: 'prices[].priceCode', tipo: 'number', desc: 'Código do preço' },
      { campo: 'prices[].priceName', tipo: 'string', desc: 'Nome do preço' },
      { campo: 'prices[].price', tipo: 'number', desc: 'Valor' },
    ],
    testFields: [
      {
        key: 'branchCode',
        label: 'Empresa',
        placeholder: '1',
        defaultVal: '1',
        required: true,
      },
      {
        key: 'productCode',
        label: 'Cód. Produto',
        placeholder: '12345',
        required: true,
      },
    ],
  },
  '/api/totvs/product-costs/search': {
    filterRef: 'ProductFilterModel',
    optionFields: [
      {
        campo: 'costs[].branchCode',
        tipo: 'number',
        desc: 'Código da empresa (obrigatório)',
      },
      {
        campo: 'costs[].costCodeList',
        tipo: 'number[]',
        desc: 'Códigos de custo (obrigatório)',
      },
    ],
    response: [
      { campo: 'productCode', tipo: 'number', desc: 'Código interno' },
      { campo: 'productName', tipo: 'string', desc: 'Nome do produto' },
      { campo: 'costs[].branchCode', tipo: 'number', desc: 'Empresa' },
      { campo: 'costs[].costCode', tipo: 'number', desc: 'Código do custo' },
      { campo: 'costs[].costName', tipo: 'string', desc: 'Nome do custo' },
      { campo: 'costs[].cost', tipo: 'number', desc: 'Valor' },
    ],
    testFields: [
      {
        key: 'branchCode',
        label: 'Empresa',
        placeholder: '1',
        defaultVal: '1',
        required: true,
      },
      {
        key: 'productCode',
        label: 'Cód. Produto',
        placeholder: '12345',
        required: true,
      },
    ],
  },
  '/api/totvs/price-tables/search': {
    filterRef: 'ProductFilterModel',
    optionFields: [
      {
        campo: 'branchCodeList',
        tipo: 'number[]',
        desc: 'Lista de empresas (obrigatório)',
      },
      {
        campo: 'priceTableCode',
        tipo: 'number',
        desc: 'Código da tabela de preço (obrigatório)',
      },
    ],
    response: [
      { campo: 'productCode', tipo: 'number', desc: 'Código interno' },
      { campo: 'productName', tipo: 'string', desc: 'Nome do produto' },
      { campo: 'prices[]', tipo: 'array', desc: 'Preços por empresa' },
    ],
    testFields: [
      {
        key: 'branchCode',
        label: 'Empresa',
        placeholder: '1',
        defaultVal: '1',
        required: true,
      },
      {
        key: 'productCode',
        label: 'Cód. Produto',
        placeholder: '12345',
        required: true,
      },
      {
        key: 'priceTableCode',
        label: 'Cód. Tabela',
        placeholder: '1',
        defaultVal: '1',
      },
    ],
  },
  '/api/totvs/price-tables-headers': {
    response: [
      { campo: 'code', tipo: 'number', desc: 'Código da tabela' },
      { campo: 'name', tipo: 'string', desc: 'Nome da tabela' },
      { campo: 'isActive', tipo: 'boolean', desc: 'Ativa' },
      {
        campo: 'maxChangeFilterDate',
        tipo: 'datetime',
        desc: 'Última alteração',
      },
    ],
    testFields: [
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
      {
        key: 'PageSize',
        label: 'Itens/pág',
        placeholder: '100',
        defaultVal: '100',
      },
    ],
  },
  '/api/totvs/price-table-scales': {
    response: [
      { campo: 'code', tipo: 'number', desc: 'Código da escala' },
      { campo: 'priceTableCode', tipo: 'number', desc: 'Código da tabela' },
      { campo: 'name', tipo: 'string', desc: 'Nome' },
    ],
    testFields: [
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
      {
        key: 'PageSize',
        label: 'Itens/pág',
        placeholder: '100',
        defaultVal: '100',
      },
    ],
  },
  '/api/totvs/categories': {
    response: [
      { campo: 'code', tipo: 'number', desc: 'Código' },
      { campo: 'name', tipo: 'string', desc: 'Nome' },
      {
        campo: 'parentCategoryCode',
        tipo: 'number|null',
        desc: 'Categoria pai (null se raiz)',
      },
      {
        campo: 'categoryType',
        tipo: 'number',
        desc: '1=Categoria 2=Sub 3=Fabricante 4=Filtro',
      },
    ],
    testFields: [
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
      {
        key: 'PageSize',
        label: 'Itens/pág',
        placeholder: '100',
        defaultVal: '100',
      },
    ],
  },
  '/api/totvs/grids': {
    response: [
      { campo: 'code', tipo: 'number', desc: 'Código da grade' },
      { campo: 'name', tipo: 'string', desc: 'Nome' },
      { campo: 'type', tipo: 'string', desc: 'Tipo' },
      { campo: 'grid[]', tipo: 'string[]', desc: 'Tamanhos da grade' },
    ],
    testFields: [
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
      {
        key: 'PageSize',
        label: 'Itens/pág',
        placeholder: '100',
        defaultVal: '100',
      },
    ],
  },
  '/api/totvs/colors/search': {
    response: [
      { campo: 'code', tipo: 'string', desc: 'Código da cor' },
      { campo: 'name', tipo: 'string', desc: 'Nome' },
      { campo: 'isActive', tipo: 'boolean', desc: 'Ativa' },
      { campo: 'hexColor', tipo: 'string', desc: 'Cor hexadecimal' },
    ],
    testFields: [
      {
        key: 'isActive',
        label: 'Somente ativas',
        placeholder: 'true',
        defaultVal: 'true',
      },
    ],
  },
  '/api/totvs/classifications': {
    response: [
      { campo: 'typeCode', tipo: 'number', desc: 'Código do tipo' },
      { campo: 'typeName', tipo: 'string', desc: 'Nome do tipo' },
      { campo: 'code', tipo: 'string', desc: 'Código' },
      { campo: 'name', tipo: 'string', desc: 'Nome' },
    ],
    testFields: [
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
      {
        key: 'PageSize',
        label: 'Itens/pág',
        placeholder: '100',
        defaultVal: '100',
      },
    ],
  },
  '/api/totvs/classification-types': {
    response: [
      { campo: 'code', tipo: 'number', desc: 'Código do tipo' },
      { campo: 'name', tipo: 'string', desc: 'Nome' },
      { campo: 'isGroup', tipo: 'boolean', desc: 'É grupo' },
    ],
    testFields: [
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
      {
        key: 'PageSize',
        label: 'Itens/pág',
        placeholder: '100',
        defaultVal: '100',
      },
    ],
  },
  '/api/totvs/measurement-unit': {
    response: [
      { campo: 'code', tipo: 'number', desc: 'Código da espécie' },
      { campo: 'name', tipo: 'string', desc: 'Nome' },
    ],
    testFields: [
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
      {
        key: 'PageSize',
        label: 'Itens/pág',
        placeholder: '100',
        defaultVal: '100',
      },
    ],
  },
  '/api/totvs/compositions/search': {
    response: [
      { campo: 'code', tipo: 'number', desc: 'Código da composição' },
      { campo: 'description', tipo: 'string', desc: 'Descrição' },
      { campo: 'fibers[].code', tipo: 'number', desc: 'Código da fibra' },
      { campo: 'fibers[].description', tipo: 'string', desc: 'Nome da fibra' },
      { campo: 'fibers[].percentage', tipo: 'number', desc: 'Percentual (%)' },
    ],
    testFields: [
      { key: 'page', label: 'Página', placeholder: '1', defaultVal: '1' },
      {
        key: 'pageSize',
        label: 'Itens/pág',
        placeholder: '100',
        defaultVal: '100',
      },
      {
        key: 'expand',
        label: 'Expand',
        placeholder: 'fibers',
        defaultVal: 'fibers',
      },
    ],
  },
  '/api/totvs/composition-group-product': {
    response: [
      { campo: 'groupCode', tipo: 'string', desc: 'Código do grupo' },
      { campo: 'referenceCode', tipo: 'string', desc: 'Referência' },
      { campo: 'compositionCode', tipo: 'number', desc: 'Código composição' },
    ],
    testFields: [
      { key: 'ProductCodeList', label: 'Cód. Produto', placeholder: '12345' },
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
    ],
  },
  '/api/totvs/composition-product': {
    response: [
      { campo: 'productCode', tipo: 'number', desc: 'Código do produto' },
      { campo: 'referenceCode', tipo: 'string', desc: 'Referência' },
      { campo: 'compositionCode', tipo: 'number', desc: 'Código composição' },
    ],
    testFields: [
      { key: 'ProductCodeList', label: 'Cód. Produto', placeholder: '12345' },
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
    ],
  },
  '/api/totvs/batch/search': {
    response: [
      { campo: 'batchCode', tipo: 'string', desc: 'Código do lote' },
      { campo: 'productCode', tipo: 'number', desc: 'Código do produto' },
      { campo: 'situation', tipo: 'string', desc: 'Situação' },
      { campo: 'balance', tipo: 'number', desc: 'Saldo' },
      { campo: 'expirationDate', tipo: 'datetime', desc: 'Data de validade' },
    ],
    testFields: [
      {
        key: 'branchCode',
        label: 'Empresa',
        placeholder: '1',
        defaultVal: '1',
        required: true,
      },
      { key: 'productCode', label: 'Cód. Produto', placeholder: '12345' },
    ],
  },
  '/api/totvs/additional-fields-types': {
    response: [
      { campo: 'code', tipo: 'number', desc: 'Código' },
      { campo: 'description', tipo: 'string', desc: 'Descrição' },
    ],
    testFields: [
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
      {
        key: 'PageSize',
        label: 'Itens/pág',
        placeholder: '100',
        defaultVal: '100',
      },
    ],
  },
  '/api/totvs/product-grouper-config': {
    response: [
      { campo: 'grouperCode', tipo: 'number', desc: 'Código do agrupador' },
      { campo: 'name', tipo: 'string', desc: 'Nome' },
    ],
    testFields: [
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
      {
        key: 'PageSize',
        label: 'Itens/pág',
        placeholder: '100',
        defaultVal: '100',
      },
    ],
  },
  '/api/totvs/instruction-items': {
    response: [
      { campo: 'code', tipo: 'number', desc: 'Código' },
      { campo: 'description', tipo: 'string', desc: 'Descrição' },
    ],
    testFields: [
      { key: 'Page', label: 'Página', placeholder: '1', defaultVal: '1' },
      {
        key: 'PageSize',
        label: 'Itens/pág',
        placeholder: '100',
        defaultVal: '100',
      },
    ],
  },
};

function buildEstoqueTestPayload(path, values) {
  const bc = Number(values.branchCode) || 1;
  const pc = values.productCode ? Number(values.productCode) : undefined;
  switch (path) {
    case '/api/totvs/product-codes/search':
      return {
        filter: pc ? { productCodeList: [pc] } : {},
        page: 1,
        pageSize: 100,
      };
    case '/api/totvs/products/search':
      return {
        filter: pc ? { productCodeList: [pc] } : {},
        option: { branchInfoCode: bc },
        page: 1,
        pageSize: 10,
        expand: values.expand || '',
      };
    case '/api/totvs/product-references/search':
      return {
        filter: values.referenceCode
          ? { referenceCodeList: [values.referenceCode] }
          : {},
        option: { branchInfoCode: bc },
        page: 1,
        pageSize: 10,
        expand: values.expand || '',
      };
    case '/api/totvs/product-balances':
      return {
        filter: pc
          ? { productCodeList: [pc] }
          : { hasStock: true, branchStockCode: bc, stockCode: 1 },
        option: { balances: [{ branchCode: bc, stockCodeList: [1] }] },
        page: 1,
        pageSize: 100,
      };
    case '/api/totvs/omni-changed-balances':
      return {
        filter: pc
          ? { productCodeList: [pc] }
          : { hasStock: values.hasStock === 'true' },
        page: 1,
        pageSize: 100,
      };
    case '/api/totvs/product-prices/search':
      return {
        filter: pc ? { productCodeList: [pc] } : {},
        option: { prices: [{ branchCode: bc, priceCodeList: [1] }] },
        page: 1,
        pageSize: 100,
      };
    case '/api/totvs/product-costs/search':
      return {
        filter: pc ? { productCodeList: [pc] } : {},
        option: { costs: [{ branchCode: bc, costCodeList: [1] }] },
        page: 1,
        pageSize: 100,
      };
    case '/api/totvs/price-tables/search':
      return {
        filter: pc ? { productCodeList: [pc] } : {},
        option: {
          branchCodeList: [bc],
          priceTableCode: Number(values.priceTableCode) || 1,
        },
        page: 1,
        pageSize: 100,
      };
    case '/api/totvs/colors/search':
      return {
        filter: values.isActive ? { isActive: values.isActive === 'true' } : {},
        page: 1,
        pageSize: 100,
      };
    case '/api/totvs/compositions/search':
      return {
        page: Number(values.page) || 1,
        pageSize: Number(values.pageSize) || 100,
        expand: values.expand || 'fibers',
      };
    case '/api/totvs/batch/search':
      return {
        filter: {
          branchCode: bc,
          ...(pc ? { productCodeList: [pc] } : {}),
          hasBalance: true,
        },
        page: 1,
        pageSize: 100,
      };
    default:
      return {};
  }
}

// ==========================================
// UTILS
// ==========================================

function parseParamValue(value, type) {
  if (!value && value !== 0 && value !== false) return undefined;
  const str = String(value).trim();
  if (!str) return undefined;
  if (type === 'number') {
    const n = Number(str);
    return isNaN(n) ? undefined : n;
  }
  if (type === 'boolean') return str === 'true';
  if (
    type === 'number[]' ||
    type === 'string[]' ||
    type === 'object' ||
    type === 'object[]'
  ) {
    try {
      return JSON.parse(str);
    } catch {
      return undefined;
    }
  }
  return str;
}

function buildRequestUrl(route, paramValues) {
  let url = `${API_BASE_URL}${route.path}`;
  if (route.params?.url) {
    for (const [name] of Object.entries(route.params.url)) {
      const val = paramValues[name];
      if (val) url = url.replace(`:${name}`, encodeURIComponent(val));
    }
    url = url.replace(/\/:[^/]+\??/g, '');
  }
  if (route.params?.query) {
    const sp = new URLSearchParams();
    for (const [name] of Object.entries(route.params.query)) {
      const val = paramValues[name];
      if (val !== undefined && val !== '') sp.set(name, val);
    }
    const qs = sp.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

function buildRequestBody(route, paramValues) {
  if (!route.params?.body) return null;
  const body = {};
  for (const [name, info] of Object.entries(route.params.body)) {
    const val = parseParamValue(paramValues[name], info.type);
    if (val !== undefined) body[name] = val;
  }
  return Object.keys(body).length > 0 ? body : null;
}

// ==========================================
// COMPONENTES
// ==========================================

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
      title="Copiar"
    >
      {copied ? (
        <Check size={14} className="text-green-400" />
      ) : (
        <Copy size={14} />
      )}
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
  );
}

function MethodBadge({ method }) {
  const colors = {
    GET: 'bg-green-100 text-green-800 border-green-300',
    POST: 'bg-blue-100 text-blue-800 border-blue-300',
  };
  return (
    <span
      className={`px-2 py-0.5 text-xs font-bold rounded border ${colors[method] || 'bg-gray-100 text-gray-800'}`}
    >
      {method}
    </span>
  );
}

function ParamInputs({ params, values, onChange }) {
  if (!params) return null;
  const allParams = [];
  for (const [location, fields] of Object.entries(params)) {
    for (const [name, info] of Object.entries(fields)) {
      allParams.push({ location, name, ...info });
    }
  }
  if (allParams.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 font-semibold uppercase">
        Parâmetros
      </p>
      {allParams.map((p) => (
        <div key={`${p.location}-${p.name}`}>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs font-mono text-blue-700 font-semibold">
              {p.name}
            </label>
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-100 rounded text-gray-500">
              {p.location}
            </span>
            <span className="text-[10px] text-gray-400">{p.type}</span>
            {p.required && (
              <span className="text-[10px] text-red-500 font-bold">
                obrigatório
              </span>
            )}
          </div>
          {p.description && (
            <p className="text-[11px] text-gray-400 mb-1">{p.description}</p>
          )}
          {p.type === 'object' ||
          p.type === 'object[]' ||
          p.type === 'number[]' ||
          p.type === 'string[]' ? (
            <textarea
              value={values[p.name] || ''}
              onChange={(e) => onChange(p.name, e.target.value)}
              placeholder={p.placeholder || ''}
              rows={2}
              className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent bg-gray-50 resize-y"
            />
          ) : (
            <input
              type="text"
              value={values[p.name] || ''}
              onChange={(e) => onChange(p.name, e.target.value)}
              placeholder={p.placeholder || ''}
              className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent bg-gray-50"
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ResponseViewer({ response, loading, error, duration }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <Spinner size={18} className="animate-spin text-indigo-500" />
        <span className="text-sm text-gray-500">Executando consulta...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4 bg-red-50 rounded-lg border border-red-200">
        <div className="flex items-center gap-2 mb-2">
          <Warning size={16} className="text-red-500" />
          <span className="text-sm font-semibold text-red-700">Erro</span>
        </div>
        <pre className="text-xs text-red-600 whitespace-pre-wrap font-mono">
          {error}
        </pre>
      </div>
    );
  }
  if (response === null) return null;

  const jsonStr =
    typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data, null, 2);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-500 font-semibold uppercase">
            Resposta
          </p>
          <span
            className={`px-2 py-0.5 text-[10px] font-bold rounded ${
              response.status >= 200 && response.status < 300
                ? 'bg-green-100 text-green-700'
                : response.status >= 400
                  ? 'bg-red-100 text-red-700'
                  : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {response.status}
          </span>
          {duration && (
            <span className="text-[10px] text-gray-400">{duration}ms</span>
          )}
        </div>
        <CopyButton text={jsonStr} />
      </div>
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto">
        <code>{jsonStr}</code>
      </pre>
    </div>
  );
}

// ==========================================
// ESTOQUE — Schema Tab
// ==========================================
function SchemaTable({ title, color, fields, fieldKey }) {
  if (!fields || fields.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-bold text-gray-700 uppercase mb-2 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full bg-${color}-500`} />
        {title}
      </h4>
      <div className="overflow-x-auto border rounded-lg max-h-60 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0">
            <tr className={`bg-${color}-50`}>
              <th className="text-left p-2 border-b font-semibold">Campo</th>
              <th className="text-left p-2 border-b font-semibold">Tipo</th>
              {fieldKey === 'body' && (
                <th className="text-left p-2 border-b font-semibold w-14">
                  Obrig.
                </th>
              )}
              <th className="text-left p-2 border-b font-semibold">
                Descrição
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr
                key={i}
                className={`border-b border-gray-50 hover:bg-${color}-50/50`}
              >
                <td className={`p-2 font-mono text-${color}-700`}>
                  {f.campo || f[0]}
                </td>
                <td className="p-2 text-gray-500">{f.tipo || f[1]?.type}</td>
                {fieldKey === 'body' && (
                  <td className="p-2 text-center text-gray-400">
                    {f[1]?.required ? '✓' : ''}
                  </td>
                )}
                <td className="p-2 text-gray-600">
                  {f.desc || f.descricao || f[1]?.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SchemaTabContent({ route, meta }) {
  const isPost = route.method === 'POST';
  const queryParams = route.params?.query
    ? Object.entries(route.params.query)
    : [];
  const bodyParams = route.params?.body
    ? Object.entries(route.params.body)
    : [];

  return (
    <div className="px-6 py-5 space-y-6">
      {/* ProductFilterModel for POST */}
      {isPost && meta.filterRef === 'ProductFilterModel' && (
        <SchemaTable
          title="Schema do Filtro (ProductFilterModel)"
          color="blue"
          fields={PRODUCT_FILTER_FIELDS}
        />
      )}

      {/* Option fields */}
      {meta.optionFields && (
        <SchemaTable title="Option" color="purple" fields={meta.optionFields} />
      )}

      {/* Expand options */}
      {meta.expandOpts && (
        <div>
          <h4 className="text-xs font-bold text-gray-700 uppercase mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Opções de Expand
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {meta.expandOpts.split(',').map((opt, i) => (
              <span
                key={i}
                className="px-2 py-1 text-[11px] bg-amber-50 border border-amber-200 rounded-md font-mono text-amber-800"
              >
                {opt.trim()}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Body params */}
      {isPost && bodyParams.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-gray-700 uppercase mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            Parâmetros do Body
          </h4>
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-indigo-50">
                  <th className="text-left p-2 border-b font-semibold">
                    Campo
                  </th>
                  <th className="text-left p-2 border-b font-semibold">Tipo</th>
                  <th className="text-left p-2 border-b font-semibold w-14">
                    Obrig.
                  </th>
                  <th className="text-left p-2 border-b font-semibold">
                    Descrição
                  </th>
                </tr>
              </thead>
              <tbody>
                {bodyParams.map(([name, info], i) => (
                  <tr
                    key={i}
                    className="border-b border-gray-50 hover:bg-indigo-50/50"
                  >
                    <td className="p-2 font-mono text-indigo-700">{name}</td>
                    <td className="p-2 text-gray-500">{info.type}</td>
                    <td className="p-2 text-center text-gray-400">
                      {info.required ? '✓' : ''}
                    </td>
                    <td className="p-2 text-gray-600">{info.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Query params for GET */}
      {!isPost && queryParams.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-gray-700 uppercase mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            Parâmetros de Query
          </h4>
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-green-50">
                  <th className="text-left p-2 border-b font-semibold">
                    Parâmetro
                  </th>
                  <th className="text-left p-2 border-b font-semibold">Tipo</th>
                  <th className="text-left p-2 border-b font-semibold w-14">
                    Obrig.
                  </th>
                  <th className="text-left p-2 border-b font-semibold">
                    Descrição
                  </th>
                </tr>
              </thead>
              <tbody>
                {queryParams.map(([name, info], i) => (
                  <tr
                    key={i}
                    className="border-b border-gray-50 hover:bg-green-50/50"
                  >
                    <td className="p-2 font-mono text-green-700">{name}</td>
                    <td className="p-2 text-gray-500">{info.type}</td>
                    <td className="p-2 text-center text-gray-400">
                      {info.required ? '✓' : ''}
                    </td>
                    <td className="p-2 text-gray-600">{info.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* URL params */}
      {route.params?.url && (
        <div>
          <h4 className="text-xs font-bold text-gray-700 uppercase mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500" />
            Parâmetros de URL
          </h4>
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-orange-50">
                  <th className="text-left p-2 border-b font-semibold">
                    Parâmetro
                  </th>
                  <th className="text-left p-2 border-b font-semibold">Tipo</th>
                  <th className="text-left p-2 border-b font-semibold">
                    Descrição
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(route.params.url).map(([name, info], i) => (
                  <tr
                    key={i}
                    className="border-b border-gray-50 hover:bg-orange-50/50"
                  >
                    <td className="p-2 font-mono text-orange-700">:{name}</td>
                    <td className="p-2 text-gray-500">{info.type}</td>
                    <td className="p-2 text-gray-600">{info.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Response schema */}
      {meta.response && (
        <div>
          <h4 className="text-xs font-bold text-gray-700 uppercase mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Schema da Resposta
          </h4>
          <p className="text-[11px] text-gray-400 mb-2">
            Envelope:{' '}
            {
              '{ success, data: { count, totalPages, hasNext, totalItems, items: [...] } }'
            }
          </p>
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-emerald-50">
                  <th className="text-left p-2 border-b font-semibold">
                    Campo (items[])
                  </th>
                  <th className="text-left p-2 border-b font-semibold">Tipo</th>
                  <th className="text-left p-2 border-b font-semibold">
                    Descrição
                  </th>
                </tr>
              </thead>
              <tbody>
                {meta.response.map((f, i) => (
                  <tr
                    key={i}
                    className="border-b border-gray-50 hover:bg-emerald-50/50"
                  >
                    <td className="p-2 font-mono text-emerald-700">
                      {f.campo}
                    </td>
                    <td className="p-2 text-gray-500">{f.tipo}</td>
                    <td className="p-2 text-gray-600">{f.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Example response JSON */}
      {route.response && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-bold text-gray-700 uppercase flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              Exemplo de Resposta
            </h4>
            <CopyButton text={route.response} />
          </div>
          <pre className="bg-gray-900 text-gray-300 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
            <code>{route.response}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

// ==========================================
// ESTOQUE — Teste Rápido Tab
// ==========================================
function QuickTestTab({ route, meta }) {
  const [testValues, setTestValues] = useState(() => {
    const d = {};
    if (meta?.testFields)
      meta.testFields.forEach((f) => {
        if (f.defaultVal) d[f.key] = f.defaultVal;
      });
    return d;
  });
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [duration, setDuration] = useState(null);

  const handleChange = (key, value) =>
    setTestValues((prev) => ({ ...prev, [key]: value }));
  const missingReq = (meta?.testFields || []).filter(
    (f) =>
      f.required && (!testValues[f.key] || !String(testValues[f.key]).trim()),
  );

  const execute = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    setDuration(null);
    const start = performance.now();
    try {
      let url, options;
      if (route.method === 'POST') {
        const body = buildEstoqueTestPayload(route.path, testValues);
        url = `${API_BASE_URL}${route.path}`;
        options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        };
      } else {
        let path = route.path;
        const qp = {};
        for (const [key, val] of Object.entries(testValues)) {
          if (!val) continue;
          if (path.includes(`:${key}`)) {
            path = path.replace(`:${key}`, encodeURIComponent(val));
          } else {
            qp[key] = val;
          }
        }
        url = `${API_BASE_URL}${path}`;
        const qs = new URLSearchParams(qp).toString();
        if (qs) url += `?${qs}`;
        options = {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        };
      }
      const res = await fetch(url, options);
      setDuration(Math.round(performance.now() - start));
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : await res.text();
      setResponse({ status: res.status, data });
    } catch (err) {
      setDuration(Math.round(performance.now() - start));
      setError(err.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  // Build cURL preview
  let curlCmd = '';
  if (route.method === 'POST') {
    const body = buildEstoqueTestPayload(route.path, testValues);
    curlCmd = `curl -X POST "${API_BASE_URL}${route.path}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2)}'`;
  } else {
    let path = route.path;
    const qp = {};
    for (const [key, val] of Object.entries(testValues)) {
      if (!val) continue;
      if (path.includes(`:${key}`)) {
        path = path.replace(`:${key}`, encodeURIComponent(val));
      } else {
        qp[key] = val;
      }
    }
    let fullUrl = `${API_BASE_URL}${path}`;
    const qs = new URLSearchParams(qp).toString();
    if (qs) fullUrl += `?${qs}`;
    curlCmd = `curl "${fullUrl}"`;
  }

  return (
    <div className="px-6 py-5 space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(meta?.testFields || []).map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              {f.label}
              {f.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="text"
              value={testValues[f.key] || ''}
              onChange={(e) => handleChange(f.key, e.target.value)}
              placeholder={f.placeholder || ''}
              className="w-full px-3 py-2.5 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-gray-50"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={execute}
          disabled={loading || missingReq.length > 0}
          className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
            loading || missingReq.length > 0
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
          }`}
        >
          {loading ? (
            <Spinner size={16} className="animate-spin" />
          ) : (
            <Play size={16} weight="fill" />
          )}
          {loading ? 'Executando...' : 'Executar'}
        </button>
        {missingReq.length > 0 && (
          <span className="text-xs text-red-500">
            Preencha: {missingReq.map((f) => f.label).join(', ')}
          </span>
        )}
      </div>

      <details className="group">
        <summary className="text-xs text-gray-400 font-semibold uppercase cursor-pointer flex items-center gap-1">
          <CaretRight
            size={12}
            className="group-open:rotate-90 transition-transform"
          />
          cURL
        </summary>
        <div className="mt-2 flex items-start justify-between gap-2">
          <pre className="bg-gray-900 text-gray-300 p-3 rounded-lg text-[11px] overflow-x-auto whitespace-pre-wrap font-mono flex-1">
            {curlCmd}
          </pre>
          <CopyButton text={curlCmd} />
        </div>
      </details>

      <ResponseViewer
        response={response}
        loading={loading}
        error={error}
        duration={duration}
      />
    </div>
  );
}

// ==========================================
// ESTOQUE — Console com abas Schema/Teste
// ==========================================
function EstoqueRouteConsole({ route, meta, onClose }) {
  const [activeTab, setActiveTab] = useState('schema');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-white border-b px-6 pt-4 pb-0 rounded-t-xl flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <MethodBadge method={route.method} />
              <h2 className="text-lg font-bold text-gray-800">{route.name}</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>
          <div className="flex items-center gap-2 bg-gray-50 p-2.5 rounded-lg mb-3">
            <MethodBadge method={route.method} />
            <code className="text-xs font-mono text-gray-600 break-all flex-1">
              {API_BASE_URL}
              {route.path}
            </code>
            <CopyButton text={`${API_BASE_URL}${route.path}`} />
          </div>
          <p className="text-sm text-gray-500 mb-3">{route.description}</p>
          <div className="flex gap-1 -mx-6 px-6">
            {[
              { id: 'schema', label: 'Schema' },
              { id: 'teste', label: 'Teste Rápido' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'schema' && (
            <SchemaTabContent route={route} meta={meta} />
          )}
          {activeTab === 'teste' && <QuickTestTab route={route} meta={meta} />}
        </div>
      </div>
    </div>
  );
}

function RouteConsole({ route, onClose }) {
  const [paramValues, setParamValues] = useState({});
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [duration, setDuration] = useState(null);

  if (!route) return null;

  const handleParamChange = (name, value) => {
    setParamValues((prev) => ({ ...prev, [name]: value }));
  };

  const executeRequest = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    setDuration(null);
    const start = performance.now();
    try {
      const url = buildRequestUrl(route, paramValues);
      const body = buildRequestBody(route, paramValues);
      const options = {
        method: route.method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (route.method === 'POST' && body) {
        options.body = JSON.stringify(body);
      }
      const res = await fetch(url, options);
      const elapsed = Math.round(performance.now() - start);
      setDuration(elapsed);
      let data;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        data = await res.text();
      }
      setResponse({ status: res.status, data });
    } catch (err) {
      setDuration(Math.round(performance.now() - start));
      setError(err.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  const allParams = [];
  if (route.params) {
    for (const [location, fields] of Object.entries(route.params)) {
      for (const [name, info] of Object.entries(fields)) {
        allParams.push({ location, name, ...info });
      }
    }
  }
  const missingRequired = allParams
    .filter((p) => p.required)
    .filter(
      (p) => !paramValues[p.name] || String(paramValues[p.name]).trim() === '',
    );

  const curlUrl = buildRequestUrl(route, paramValues);
  const curlBody = buildRequestBody(route, paramValues);
  let curlCmd = `curl -X ${route.method} "${curlUrl}"`;
  if (route.method === 'POST' && curlBody) {
    curlCmd += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(curlBody)}'`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
          <div className="flex items-center gap-3">
            <MethodBadge method={route.method} />
            <h2 className="text-lg font-bold text-gray-800">{route.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Endpoint */}
          <div className="flex items-center gap-2 bg-gray-50 p-3 rounded-lg">
            <MethodBadge method={route.method} />
            <code className="text-sm font-mono text-gray-700 break-all flex-1">
              {API_BASE_URL}
              {route.path}
            </code>
            <CopyButton text={`${API_BASE_URL}${route.path}`} />
          </div>

          <p className="text-sm text-gray-600">{route.description}</p>

          {/* Params */}
          <ParamInputs
            params={route.params}
            values={paramValues}
            onChange={handleParamChange}
          />

          {/* Execute */}
          <div className="flex items-center gap-3">
            <button
              onClick={executeRequest}
              disabled={loading || missingRequired.length > 0}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
                loading || missingRequired.length > 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
              }`}
            >
              {loading ? (
                <Spinner size={16} className="animate-spin" />
              ) : (
                <Play size={16} weight="fill" />
              )}
              {loading ? 'Executando...' : 'Executar Consulta'}
            </button>
            {missingRequired.length > 0 && (
              <span className="text-xs text-red-500">
                Preencha: {missingRequired.map((p) => p.name).join(', ')}
              </span>
            )}
          </div>

          {/* cURL */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-gray-400 font-semibold uppercase">
                cURL
              </p>
              <CopyButton text={curlCmd} />
            </div>
            <pre className="bg-gray-900 text-gray-300 p-3 rounded-lg text-[11px] overflow-x-auto whitespace-pre-wrap font-mono">
              {curlCmd}
            </pre>
          </div>

          {/* Response */}
          <ResponseViewer
            response={response}
            loading={loading}
            error={error}
            duration={duration}
          />

          {/* Doc example */}
          {route.response && !response && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-gray-400 font-semibold uppercase">
                  Exemplo de Resposta
                </p>
                <CopyButton text={route.response} />
              </div>
              <pre className="bg-gray-800 text-gray-300 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                <code>{route.response}</code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryCard({ category, onSelectRoute }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedSubs, setExpandedSubs] = useState({});

  const isParent = !!category.subcategories;
  const totalRoutes = isParent
    ? category.subcategories.reduce((a, s) => a + s.routes.length, 0)
    : category.routes.length;

  const toggleSub = (id) =>
    setExpandedSubs((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <span className="text-2xl">{category.icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-800">{category.name}</h3>
          <p className="text-xs text-gray-500 truncate">
            {category.description}
          </p>
        </div>
        <span className="text-xs text-gray-400 mr-2">
          {totalRoutes} rota(s)
        </span>
        {expanded ? (
          <CaretDown size={18} className="text-gray-400 flex-shrink-0" />
        ) : (
          <CaretRight size={18} className="text-gray-400 flex-shrink-0" />
        )}
      </button>

      {expanded && !isParent && (
        <div className="border-t divide-y divide-gray-100">
          {category.id === 'clientes' && (
            <div className="px-5 py-3 bg-blue-50">
              <details className="group">
                <summary className="text-xs font-semibold text-blue-700 cursor-pointer flex items-center gap-1">
                  <CaretRight
                    size={12}
                    className="group-open:rotate-90 transition-transform"
                  />
                  Campos da tabela pes_pessoa (Supabase)
                </summary>
                <div className="overflow-x-auto mt-2 max-h-52 overflow-y-auto border rounded-lg bg-white">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0">
                      <tr className="bg-gray-100">
                        <th className="text-left p-2 border-b font-semibold">
                          Campo
                        </th>
                        <th className="text-left p-2 border-b font-semibold">
                          Tipo
                        </th>
                        <th className="text-left p-2 border-b font-semibold">
                          Descrição
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {PES_PESSOA_FIELDS.map((f, i) => (
                        <tr
                          key={i}
                          className="border-b border-gray-50 hover:bg-blue-50"
                        >
                          <td className="p-2 font-mono text-blue-700">
                            {f.campo}
                          </td>
                          <td className="p-2 text-gray-500">{f.tipo}</td>
                          <td className="p-2 text-gray-600">{f.descricao}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}
          {category.routes.map((route, idx) => (
            <button
              key={idx}
              onClick={() => onSelectRoute(route)}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-indigo-50 transition-colors text-left group"
            >
              <MethodBadge method={route.method} />
              <span className="text-sm font-medium text-gray-700 group-hover:text-indigo-700 flex-1 min-w-0">
                {route.name}
              </span>
              <code className="text-[11px] text-gray-400 font-mono hidden md:block truncate max-w-[250px]">
                {route.path}
              </code>
              <Play
                size={14}
                weight="fill"
                className="text-gray-300 group-hover:text-indigo-500 flex-shrink-0"
              />
            </button>
          ))}
        </div>
      )}

      {expanded && isParent && (
        <div className="border-t">
          {category.subcategories.map((sub) => {
            const subOpen = !!expandedSubs[sub.id];
            return (
              <div
                key={sub.id}
                className="border-b border-gray-100 last:border-b-0"
              >
                <button
                  onClick={() => toggleSub(sub.id)}
                  className="w-full flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <span className="text-lg">{sub.icon}</span>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-gray-700">
                      {sub.name}
                    </h4>
                    <p className="text-[11px] text-gray-400 truncate">
                      {sub.description}
                    </p>
                  </div>
                  <span className="text-[11px] text-gray-400 mr-2">
                    {sub.routes.length} rota(s)
                  </span>
                  {subOpen ? (
                    <CaretDown
                      size={14}
                      className="text-gray-400 flex-shrink-0"
                    />
                  ) : (
                    <CaretRight
                      size={14}
                      className="text-gray-400 flex-shrink-0"
                    />
                  )}
                </button>

                {subOpen && (
                  <div className="divide-y divide-gray-50 bg-gray-50/50">
                    {sub.id === 'estoque-busca' && (
                      <div className="px-6 py-2 bg-blue-50">
                        <details className="group">
                          <summary className="text-xs font-semibold text-blue-700 cursor-pointer flex items-center gap-1">
                            <CaretRight
                              size={12}
                              className="group-open:rotate-90 transition-transform"
                            />
                            ProductFilterModel — Schema de filtro comum para
                            buscas POST
                          </summary>
                          <div className="overflow-x-auto mt-2 max-h-52 overflow-y-auto border rounded-lg bg-white">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0">
                                <tr className="bg-gray-100">
                                  <th className="text-left p-2 border-b font-semibold">
                                    Campo
                                  </th>
                                  <th className="text-left p-2 border-b font-semibold">
                                    Tipo
                                  </th>
                                  <th className="text-left p-2 border-b font-semibold">
                                    Descrição
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {PRODUCT_FILTER_FIELDS.map((f, i) => (
                                  <tr
                                    key={i}
                                    className="border-b border-gray-50 hover:bg-blue-50"
                                  >
                                    <td className="p-2 font-mono text-blue-700">
                                      {f.campo}
                                    </td>
                                    <td className="p-2 text-gray-500">
                                      {f.tipo}
                                    </td>
                                    <td className="p-2 text-gray-600">
                                      {f.descricao}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      </div>
                    )}
                    {sub.routes.map((route, idx) => (
                      <button
                        key={idx}
                        onClick={() => onSelectRoute(route)}
                        className="w-full flex items-center gap-3 px-8 py-2.5 hover:bg-indigo-50 transition-colors text-left group"
                      >
                        <MethodBadge method={route.method} />
                        <span className="text-sm font-medium text-gray-700 group-hover:text-indigo-700 flex-1 min-w-0">
                          {route.name}
                        </span>
                        <code className="text-[11px] text-gray-400 font-mono hidden md:block truncate max-w-[250px]">
                          {route.path}
                        </code>
                        <Play
                          size={14}
                          weight="fill"
                          className="text-gray-300 group-hover:text-indigo-500 flex-shrink-0"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==========================================
// PÁGINA PRINCIPAL
// ==========================================

export default function ApiClaude() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRoute, setSelectedRoute] = useState(null);

  if (!user || user.role !== 'owner') {
    return (
      <div className="p-8 text-red-600 font-bold text-center">
        <Code size={48} className="mx-auto mb-4 text-red-500" />
        <p>Acesso restrito ao Proprietário.</p>
      </div>
    );
  }

  const filteredCategories = ROUTE_CATEGORIES.filter((cat) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const matchesCat =
      cat.name.toLowerCase().includes(term) ||
      cat.description.toLowerCase().includes(term);
    if (matchesCat) return true;
    if (cat.subcategories) {
      return cat.subcategories.some(
        (sub) =>
          sub.name.toLowerCase().includes(term) ||
          sub.description.toLowerCase().includes(term) ||
          sub.routes.some(
            (r) =>
              r.name.toLowerCase().includes(term) ||
              r.path.toLowerCase().includes(term),
          ),
      );
    }
    return (
      cat.routes &&
      cat.routes.some(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          r.path.toLowerCase().includes(term),
      )
    );
  });

  const totalRoutes = ROUTE_CATEGORIES.reduce((acc, c) => {
    if (c.subcategories)
      return acc + c.subcategories.reduce((a, s) => a + s.routes.length, 0);
    return acc + (c.routes ? c.routes.length : 0);
  }, 0);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <Code size={32} className="text-indigo-600" />
        <h1 className="text-2xl font-bold text-gray-800">API Console</h1>
        <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-700 border border-amber-300">
          SOMENTE CONSULTA
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Console de consulta da API TOTVS Moda — {totalRoutes} rotas em{' '}
        {ROUTE_CATEGORIES.length} categorias
      </p>

      <div className="relative mb-6">
        <MagnifyingGlass
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          placeholder="Buscar rota, categoria..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-indigo-700">
              <strong>Base URL:</strong>{' '}
              <code className="bg-indigo-100 px-1.5 py-0.5 rounded text-xs">
                {API_BASE_URL}
              </code>
            </p>
            <p className="text-xs text-indigo-600 mt-1">
              Prefixo{' '}
              <code className="bg-indigo-100 px-1 rounded">/api/totvs/</code> ·
              Token auto-gerenciado · Clique numa rota para executar
            </p>
          </div>
          <CopyButton text={API_BASE_URL} />
        </div>
      </div>

      <div className="space-y-3">
        {filteredCategories.map((cat) => (
          <CategoryCard
            key={cat.id}
            category={cat}
            onSelectRoute={(route) => setSelectedRoute(route)}
          />
        ))}
      </div>

      {filteredCategories.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <MagnifyingGlass size={48} className="mx-auto mb-3" />
          <p>Nenhuma rota encontrada para "{searchTerm}"</p>
        </div>
      )}

      {selectedRoute &&
        (ESTOQUE_ROUTE_META[selectedRoute.path] ? (
          <EstoqueRouteConsole
            route={selectedRoute}
            meta={ESTOQUE_ROUTE_META[selectedRoute.path]}
            onClose={() => setSelectedRoute(null)}
          />
        ) : (
          <RouteConsole
            route={selectedRoute}
            onClose={() => setSelectedRoute(null)}
          />
        ))}
    </div>
  );
}
