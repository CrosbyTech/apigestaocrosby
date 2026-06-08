# Fontes de Dados — Auditor de Vendas

Inventário de onde cada informação relevante mora.

## 1. TOTVS REST API

Base: `https://www30.bhan.com.br:9443/api/totvsmoda`
Auth: OAuth2 password grant (`apitotvsmoda.bhan.com.br/.../v2/token`)
Credenciais em `.env`: `TOTVS_CLIENT_ID`, `TOTVS_USERNAME`, `TOTVS_PASSWORD`.

### NFs

`POST /fiscal/v2/invoices/search`
```json
{
  "filter": {
    "branchCodeList": [99, 2, ...],
    "operationCodeList": [7235, 7241, 9127, 200],
    "operationType": "Output",
    "startIssueDate": "2026-05-01T00:00:00",
    "endIssueDate": "2026-05-11T23:59:59"
  },
  "expand": "items",   // items[].products[] tem dealerCode
  "page": 1, "pageSize": 100
}
```

Campos críticos retornados:
- `transactionCode` — chave da NF
- `invoiceStatus`: `Issued | Canceled | Deleted`
- `issueDate`, `exitTime` — quando saiu
- `lastchangeDate` — quando foi cancelada/deletada
- `userCode` — quem fez a operação
- `personCode`, `personName`
- `items[].products[].dealerCode` — vendedor do produto (usado pra dominantDealer)

### Pessoas (clientes)

- `POST /person/v2/legal-entities/search` (PJ)
- `POST /person/v2/individuals/search` (PF)
- Filtro: `personCodeList: [...]`
- Expand: `phones, addresses, classifications`

Campos críticos:
- `insertDate` — quando o cadastro foi criado no TOTVS
- `branchInsertCode` — filial de cadastro
- `classifications[]` — `typeCode: 5 = MULTIMARCAS`, etc
- `cnpj`/`cpf`
- `customerStatus`, `isInactive`, `isCustomer`
- `phones[].number` (`94984356203`), `pushName` no WhatsApp

## 2. Supabase

URL: `https://dorztqiunewggydvkjnf.supabase.co`
Service key em `.env`.

### `pes_pessoa`
Sync diário do TOTVS persons. Schema completo:
`code, nm_pessoa, fantasy_name, tipo_pessoa, cpf, rg, customer_status,
 is_customer, is_inactive, insert_date, branch_insert_code, uf, telefone,
 email, addresses (jsonb), phones (jsonb), emails (jsonb),
 classifications (jsonb), code_activity_cnae, created_at, updated_at`

### Outras tabelas potencialmente úteis
- `notas_fiscais` — pode ter sync lag, prefira TOTVS live
- `voucher_usage` / `voucher_aplicado`
- `crm_lead_generation_calls`
- `top_clientes`
- `forecast_canal_metas` — metas mensais/semanais por canal (já criado)
- `crm_seller_metas` — metas por vendedor

## 3. UAzapi DB (`database1.crosbytech.com.br/uazapi`)

Sync diário próprio (`backend/services/uazapiSync.js`).

Tabelas:
- `instances` — 34 instâncias
- `chats` — wa_chatid, wa_name, wa_contact_name, phone, lead_name, …
- `messages` — sender, text, content (jsonb), message_timestamp, fromMe, …
- `uazapi_sync_log` — auditoria das execuções
- `uazapi_instance_status_history` — alertas de desconexão

⚠️ **NÃO confunda com Evolution**. UAzapi é não-oficial (custos baixos),
Evolution é a stack do WhatsApp Business da empresa.

## 4. Evolution DB

Dois bancos no mesmo Postgres `database1.crosbytech.com.br`:

### `evolution` (versão antiga? possivelmente legado)
Credenciais: `postgres` / `lBnKTUNsyWZNqmv` (mesmas do UAzapi).
Tem `Message`, `Contact`, `Chat`, `Instance`.

### `evolutionadm` (versão atual, 3,8M mensagens — USAR ESTE)
Credenciais read-only:
```
user:     evolution_read
password: HDDC6v9FSBXzZER3
database: evolutionadm
```

Schema relevante:

**`Instance`** — 49 instâncias
- `id` (uuid), `name`, `connectionStatus` (open|close|connecting),
  `ownerJid`, `display_name` (ex: `"David - Vend. Franquias"`)

**`Contact`** — 283K contatos
- `id`, `remoteJid` (`559484356203@s.whatsapp.net`),
  `pushName` (nome salvo, ex: `"Jucelino Reis PA New Money Encaminhado Pra David"`),
  `msisdn_55` (telefone normalizado: `5594984356203`),
  `instanceId`

**`Message`** — 3,8M mensagens
- `key` (jsonb: `{remoteJid, fromMe, id}`)
- `messageType`, `message` (jsonb com texto/mídia)
- `text_content` (texto puro extraído)
- `messageTimestamp` (epoch), `msg_ts_tz` (timestamp tz)
- `pushName`, `msisdn_55`, `msisdn_55_v2`, `instanceId`

⚠️ **JID `@lid`** (Linked Identifier) — WhatsApp Business linka contas via
`<numero>@lid` em vez de `<numero>@s.whatsapp.net`. Pra achar mensagens
de um telefone, **busque por `msisdn_55_v2`** (que normaliza ambos formatos)
ou por `pushName`.

Exemplo de query certa:
```sql
SELECT msg_ts_tz, (key->>'fromMe')::bool as fromMe, text_content
  FROM "Message"
 WHERE msisdn_55_v2 = '5594984356203'
   AND "instanceId" = '<id da instância david>'
 ORDER BY msg_ts_tz ASC
```

## 5. Meta Graph API (oficial WhatsApp Business)

Pra custos de mensagem (não pra histórico de conversa — esse vem do
Evolution/UAzapi).

`POST /api/meta/conversation-costs` no nosso backend já agrega.

## 6. Esquema de match Cliente ↔ WhatsApp

Pra mapear um `personCode` do TOTVS pra contato(s) no WhatsApp:

1. Pega `pes_pessoa.telefone` ou `phones[]` → normaliza pra `5{DDD}{numero}`
2. Procura em `evolutionadm.Contact.msisdn_55` (qualquer instância)
3. Pega o `remoteJid` retornado
4. Busca `Message WHERE msisdn_55_v2 = X AND instanceId = Y`

Pra otimizar, **construir tabela `audit_whatsapp_contact_map`**:
```sql
CREATE TABLE audit_whatsapp_contact_map (
  person_code   INTEGER NOT NULL,
  msisdn        TEXT NOT NULL,         -- 5594984356203
  instance_id   TEXT NOT NULL,
  instance_name TEXT,
  remote_jid    TEXT NOT NULL,         -- ...@s.whatsapp.net ou @lid
  push_name     TEXT,
  has_messages  BOOLEAN DEFAULT false,
  first_msg_at  TIMESTAMPTZ,
  last_msg_at   TIMESTAMPTZ,
  total_msgs    INTEGER DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (person_code, instance_id)
);
```
Atualizada por job diário cruzando pes_pessoa × evolutionadm.Contact.
