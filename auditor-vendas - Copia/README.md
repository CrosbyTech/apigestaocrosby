# Auditor de Vendas — Crosby

Projeto pra detectar padrões anômalos em emissão de NFs (possível fraude,
manipulação de meta de abertura/faturamento, retrabalho excessivo).

## Histórico de descobertas

Investigação inicial focada em David (dealer 26) e Arthur (dealer 259) do
canal Multimarcas, período Jan-Mai 2026.

### Cenário investigado

Hipótese inicial do user: vendedores emitiriam NF, depois cancelariam
alegando "documento não assinado", pra bater meta de abertura + faturamento
sem entregar venda real.

### Caso analisado a fundo: J SILVA DOS REIS / Jucelino (PC 116809)

- 4 NFs deletadas em 20/03/2026, sequenciais, em <10min cada
- Cliente cadastrado no mesmo dia
- Nome fantasia "MTM JUCELINO" (suspeita inicial de relação com vendedor
  Jucelino dealer 288 da Crosby — descartado depois)
- Investigação cruzou: TOTVS + Supabase pes_pessoa + UAzapi DB + Evolution DB

### Conclusão: NÃO foi fraude (caso J Silva)

Encontramos a conversa completa de 454 mensagens entre David
(`6c23d656-18f0-4f25-ae92-2ec5ac57741e`) e o cliente entre 07/03 e 08/05/2026
no banco `evolutionadm`, tabela `Message`, com `key->>'remoteJid'` =
`77812241330368@lid` (formato Linked Identifier de WhatsApp Business).

As 4 NFs deletadas eram **tentativas operacionais** de fechar o valor
correto do pedido (cliente pediu mistura PIX + boleto, David ajustou
várias vezes). As 2 NFs mantidas batem exatamente com os pagamentos PIX
recebidos (R$ 389,55 + R$ 2.058,68 = R$ 2.448,23).

### Lições críticas pro auditor automatizado

1. **Não basta olhar UAzapi**. Vendedor pode ter mais de 1 instância de
   WhatsApp em sistemas diferentes (UAzapi + Evolution + Chatwoot).

2. **JID `@lid`** (Linked Identifier) é usado pelo WhatsApp Business em
   contas linked a Business — não bate com `@s.whatsapp.net`. Tem que
   buscar via `msisdn_55` ou `msisdn_55_v2` que é o telefone normalizado.

3. **Tabela `Contact.pushName`** dá o nome real do contato (não o salvo),
   incluindo notas internas ("Encaminhado Pra David", etc).

4. **Múltiplas NFs canceladas no mesmo cliente / mesmo dia / minutos de
   intervalo** NÃO é prova de fraude — pode ser ajuste de valor pra fechar
   pedido legítimo.

5. **Cadastro recente + NF cancelada** também não é prova — todo cliente
   novo é cadastrado no momento da 1ª compra.

### Sinais que continuam relevantes (não-conclusivos isoladamente)

- Cliente cadastrado no MESMO DIA da NF
- NF deletada em <10min da emissão
- Cliente nunca volta a comprar após cancelamento (cliente "fantasma")
- Padrão repetido pelo MESMO vendedor pra MÚLTIPLOS clientes
- Múltiplas NFs sequenciais valores parecidos pro mesmo cliente
- Conversa de WhatsApp ausente em TODOS os canais (UAzapi+Evolution)

Quando vários sinais combinam pra UM caso, vale investigar manualmente.

## Estrutura do projeto

```
auditor-vendas/
├── README.md                          (este arquivo)
├── scripts/                            (probes da investigação manual)
│   ├── audit-multi-cancelamentos.mjs   — todas canc/del multimarcas no período
│   ├── audit-david-arthur.mjs          — análise profunda dos 2 suspeitos
│   ├── audit-aberturas-fraud.mjs       — cruzamento cadastro × NF cancelada
│   ├── audit-refaturadas.mjs           — qtas canc foram refaturadas depois
│   ├── probe-jsilva.mjs                — histórico completo do PC 116809
│   ├── probe-116809-deep.mjs           — varredura cross-system
│   ├── probe-evolutionadm-jucelino.mjs — busca no banco evolutionadm
│   └── probe-full-conv-jucelino.mjs    — pull conversa completa via @lid
└── docs/
    ├── data-sources.md                  — onde está cada dado
    ├── lid-format.md                    — como WhatsApp Business usa @lid
    └── fraud-signals.md                  — sinais a monitorar
```

## Próximos passos do auditor

### Fase 1 — Bases (extrair sem analisar)

1. **View consolidada** `vw_audit_nfs_canceladas`:
   - Cruza TOTVS invoices (Canceled+Deleted) + pes_pessoa (data cadastro,
     filial cadastro, classificação) + dealer dominante.
   - Indexada por personCode, dealerCode, issueDate.
   - Atualizada diariamente.

2. **Tabela `audit_whatsapp_contact_map`**:
   - Mapa personCode TOTVS → JID(s) Evolution/UAzapi + instanceId.
   - Permite cross-reference rápido sem varrer 3.8M mensagens toda vez.
   - Roda 1x/dia, casa por msisdn_55 + pushName.

### Fase 2 — Score de risco (heurístico)

Para cada NF cancelada, calcular um score 0-100:

| Sinal | Peso | Descrição |
|---|---:|---|
| Cliente cadastrado no mesmo dia | 15 | insertDate == issueDate |
| Cliente cadastrado < 7d antes | 10 | |
| NF deletada em <10min | 20 | lastchangeDate - exitTime |
| NF deletada em <2h | 10 | |
| Cliente NUNCA voltou a comprar | 25 | sem NF válida após o cancel |
| Cliente com 0 outras NFs válidas | 30 | cliente "fantasma" |
| Vendedor tem outros casos similares no mês | 20 | padrão repetitivo |
| ZERO conversa WhatsApp em qualquer canal | 25 | sem rastreabilidade |
| Conversa só DEPOIS do cancelamento | 10 | follow-up tardio |

Score ≥ 70 = caso pra revisão manual.
Score ≥ 90 = alerta crítico no `crosbybot`.

### Fase 3 — Página de auditoria no Forecast

- Rota `/auditoria-vendas`
- Tabela: NF | Vendedor | Cliente | Valor | Score | Sinais | Status
- Filtros: período, vendedor, canal, score mínimo
- Drill-down: clica numa NF → vê linha do tempo completa
  (TOTVS + Evolution + UAzapi) lado a lado
- Botão "Marcar como revisado" + observação

### Fase 4 — Alerta proativo

Cron diário: scoreia todas NFs canc/del do dia anterior.
Casos com score ≥ 90 → mensagem automática via `crosbybot` (que já roda)
pro gestor de vendas com link pra revisão.

## Stack já disponível

- TOTVS REST API (`fiscal/v2/invoices/search`, `person/v2/...`)
- Supabase Postgres (`pes_pessoa`, `notas_fiscais`)
- UAzapi DB (`uazapi`): instances, chats, messages
- Evolution DB (`evolution` + `evolutionadm`): Message, Contact, Chat, Instance
  - Credenciais read-only: `evolution_read` / `HDDC6v9FSBXzZER3`
  - Host: `database1.crosbytech.com.br:5432`
- `crosbybot` UAzapi → WhatsApp alertas
