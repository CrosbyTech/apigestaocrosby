# ERP HeadCoach — Fase 0 (fundação)

Implantada em 17/10/2026. Objetivo: deixar o HeadCoach com os cadastros do TOTVS em casa, com a "fiação" da dupla gravação pronta e a base de dados segura e versionada, **sem mudar nenhuma tela existente**. Roteiro completo em [ROADMAP-ERP-HEADCOACH.md](./ROADMAP-ERP-HEADCOACH.md).

## O que existe agora

### 1. Migrations versionadas (`migrations/erp/*.sql`)

| Arquivo | O que faz |
|---|---|
| `0001_fase0_base.sql` | `schema_migrations`, `erp_config`, `integracao_outbox(+_log)`, `erp_sync_controle`, `erp_sync_log` e as 21 tabelas `erp_*` de cadastro. RLS ligado com leitura para `authenticated`. |
| `0002_rls_legado_autenticado.sql` | Policy `headcoach_autenticado_tudo` nas tabelas que as telas antigas gravavam com a service_role no navegador (+ buckets `comprovantes_baixa`, `clientes-confianca`). |
| `0003_schema_snapshot_fn.sql` | Função `erp_schema_snapshot()` que devolve o catálogo em JSON. |

Comandos:

```bash
node scripts/erp-migrate.mjs            # aplica as pendentes
node scripts/erp-migrate.mjs --status   # lista aplicadas/pendentes
node scripts/erp-schema-snapshot.mjs    # gera docs/schema/schema.json + TABELAS.md
```

As migrations rodam pela RPC `exec_sql(query)` do Supabase principal (ela só devolve `'OK'`, por isso leituras de catálogo passam pela função `erp_schema_snapshot()`). Os SQLs devem ser idempotentes. O snapshot em `docs/schema/` é o "pg_dump --schema-only" do projeto: 301 tabelas/views e 263 funções em 17/10/2026, incluindo as ~20 tabelas que só existiam no banco.

### 2. Cadastros mestres espelhados do TOTVS (`services/erp/sync/`)

Chave natural do TOTVS mantida em todas (`code`, `produto_code+empresa`…), coluna `origem` (`totvs`|`headcoach`), `dados` com o JSON bruto, `totvs_alterado_em` como cursor.

| Entidade | Tabela(s) | Fonte TOTVS | Delta? | Volume (10/2026) |
|---|---|---|---|---|
| empresas | `erp_empresas` | `person/v2/branchesList` + `legal-entities` (IE/endereço das próprias) | full diário | 290 (20 próprias) |
| pessoas_pf / pessoas_pj | `erp_pessoas` | `person/v2/individuals|legal-entities/search` expand phones,emails,addresses,classifications | sim (`filter.change`) | 121k / 3,5k |
| representantes | `erp_representantes` | `person/v2/representatives/search` | full | 53 |
| vendedores | `erp_vendedores` (array `empresas`) | `sale-panel/v2/sellers-list/search` por empresa própria | full | 199 |
| produtos | `erp_produtos` + `erp_codigos_barras` | `product/v2/products/search` expand barCodes,classifications,suppliers | sim (`change.inProduct`) | 85,5k SKUs |
| cores / grades / unidades | `erp_cores`, `erp_grades`, `erp_unidades` | `colors/search`, `grid`, `measurement-unit` | full | 855 / 24 / 101 |
| classificacoes | `erp_classificacao_tipos` + `erp_classificacoes` | `classificationType`, `classifications` | full | 36 / 320 |
| tabelas_preco | `erp_tabelas_preco` | `price-tables-headers` | full | 42 |
| precos | `erp_precos` | `prices/search` (preço 1 = VENDA VAREJO) por empresa própria | sim (`branchPriceCodeList`) | ~86k × 20 |
| custos | `erp_custos` | `costs/search` (custo 1 = REPOSICAO, empresa 1) | full semanal | ~86k |
| precos_tabela | `erp_precos_tabela` | `price-tables/search` — só tabelas em `ERP_SYNC_TABELAS_PRECO` | full semanal | opcional |
| operacoes | `erp_operacoes` + `erp_estoques` | `general/v2/operations` expand values,balances | full | 926 |
| condicoes_pagamento | `erp_condicoes_pagamento` | `general/v2/payment-conditions` | full | 94 |
| portadores | `erp_portadores` | `accounts-receivable/v2/bearers` | full | 390 |
| despesas_centros | `erp_despesas_itens`, `erp_centros_custo` | derivado de `accounts-payable/v2/duplicates/search` (expense[]) — o TOTVS não tem endpoint de cadastro | sim (`change.inDuplicate`) | ~ |

`erp_bonus_saldo` (cashback) existe mas é alimentado sob demanda: o TOTVS só consulta por CPF.

Crons (`jobs/erp-sync.job.js`, desliga com `ERP_SYNC_ENABLED=false`): delta a cada hora (:35), dimensões pequenas 04:30, custos/preços de tabela domingo 05:00. Carga inicial manual:

```bash
node scripts/erp-carga-inicial.mjs                       # tudo, na ordem de dependência
node scripts/erp-carga-inicial.mjs produtos precos       # só algumas
node scripts/erp-carga-inicial.mjs --delta               # só o que mudou
```

Cada execução fica em `erp_sync_log`; o estado atual (totais TOTVS × HeadCoach, cursor, erro) em `erp_sync_controle`. O runner trava por entidade, usa sobreposição de 15 min no cursor e pausa `ERP_TOTVS_DELAY_MS` entre chamadas.

### 3. Fila HeadCoach → TOTVS (`services/erp/outbox.js`)

```js
import { enfileirar } from '../services/erp/outbox.js';
await enfileirar({
  operacao: 'ap.duplicata.criar',          // ver outboxHandlers.js
  payload: corpoNoFormatoTotvs,
  chave: `ap:${empresa}:${duplicata}:${parcela}`,   // idempotência
  origem_tabela: 'solicitacoes_crosby', origem_id: id, empresa,
});
```

Worker a cada minuto (`jobs/integracao-outbox.job.js`, `ERP_OUTBOX_LOTE` itens). Backoff 1m, 5m, 15m, 1h, 3h, 6h, 12h, 24h; 4xx (exceto 408/429) vira `erro` definitivo; cada tentativa fica em `integracao_outbox_log`. Handlers prontos: duplicata (criar/agrupar), baixa de título, tipo de cobrança, boleto, PIX, cliente PF/PJ, transação de venda, recebimento, bônus (consumir/conceder), vouchers e o genérico `totvs.http`. **Na fase 0 nada enfileira automaticamente** — as escritas diretas no TOTVS continuam como estavam; a fase 1 troca cada uma pelo outbox.

### 4. Modo por módulo e empresa (`services/erp/config.js`)

`erp_config(empresa NULL = global, modulo, modo)` com `modo ∈ totvs | dual | headcoach`. Uso no código: `await getModo('vendas', 95)`, `gravaNoTotvs()`, `gravaNoHeadcoach()`. Hoje tudo está em `totvs`; nenhum módulo lê a flag ainda.

### 5. API `/api/erp` (`routes/erp.routes.js`)

Exige `Authorization: Bearer <access_token da sessão Supabase>`; escrita só `admin`/`owner` (`middlewares/auth.js`). Status geral, sync (rodar/entidades/log), config, outbox (listar/reprocessar/cancelar/processar/enfileirar), migrations, consulta dos cadastros (`/cadastros/:entidade?q=`), divergências e gestão de usuários (`/admin/usuarios`, que tirou o `auth.admin` do navegador).

### 6. Tela **Administração → Integração ERP** (`/admin/integracao-erp`)

Abas: Sincronização (totais TOTVS × HeadCoach, rodar full/delta), Modos, Fila TOTVS (outbox com payload/resposta/tentativas), Cadastros (consulta das tabelas `erp_*`), Histórico, Migrations. Frontend chama o backend por `src/utils/apiAuth.js` (`apiJson`, `authHeaders`).

### 7. Segurança

- **Backend**: credenciais do TOTVS, service_role do Supabase e senha do Evolution saíram do código (`utils/totvsTokenManager.js`, `config/supabase.js`, `config/evolution.js`) e passaram a vir só do ambiente. Estão no `.env` local; **no Render precisam ser cadastradas antes do deploy** (lista em `.env.example`).
- `GET /api/totvs/token` e `POST /api/totvs/auth` exigem admin/owner logado (antes eram públicos).
- **Frontend**: `src/lib/supabase.js` não tem mais a service_role key. `supabaseAdmin` virou um proxy para o cliente autenticado do usuário (as 17 telas antigas continuam funcionando graças às policies da migration 0002). `auth.admin.*` passou para `lib/userProfiles.js` → backend. `VITE_SUPABASE_SERVICE_KEY` pode ser removida da Vercel. `src/lib/migrateUsers.js` (só usado pela página de teste AuthTest) ainda referencia `auth.admin` e vai falhar se for chamado — é código de migração antiga.

## Pendências para fechar a fase 0

1. **Rotacionar** no painel do Supabase a service_role key e trocar a senha do usuário `APINOVA` do TOTVS e do banco Evolution: os valores antigos estão no histórico do git.
2. Cadastrar no Render: `TOTVS_CLIENT_ID`, `TOTVS_CLIENT_SECRET`, `TOTVS_USERNAME`, `TOTVS_PASSWORD`, `SUPABASE_SERVICE_KEY`, `EVOLUTION_DB_PASSWORD` (e, se quiser, os `ERP_*`). Sem isso o deploy quebra.
3. Remover `VITE_SUPABASE_SERVICE_KEY` da Vercel.
4. Conferir na tela Integração ERP se as policies do storage (buckets) foram criadas; se o `exec_sql` não tiver permissão em `storage.objects`, criar pelo painel.
5. Decidir `ERP_SYNC_TABELAS_PRECO` (quais tabelas de preço espelhar) e se `precos` deve cobrir mais tipos além do 1.
6. Preencher nomes dos centros de custo em `erp_centros_custo` (o TOTVS só expõe o código).
