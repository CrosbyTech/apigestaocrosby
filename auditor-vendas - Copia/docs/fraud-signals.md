# Sinais de Fraude — Heurística

Sinais a monitorar pra cada NF cancelada/deletada. Nenhum isolado é prova;
**combinação** é o que importa.

## Sinais "verdadeiros positivos" altos

### 🚩 S1 — Cliente "fantasma"
- Cliente cadastrado para a NF e **nunca mais** comprou nada
- Critério: `0 NFs válidas` em qualquer canal/op nos 60 dias após a cancelada
- **Peso: 30**

### 🚩 S2 — Zero conversa em qualquer canal
- Nenhuma mensagem entre vendedor e cliente em UAzapi + Evolution + Chatwoot
- Indica que NF foi emitida sem qualquer interação comercial
- **Peso: 25**
- ⚠️ Validar com `msisdn_55_v2` no Evolution (formato `@lid`)

### 🚩 S3 — Padrão repetitivo do mesmo vendedor
- Vendedor tem ≥ 3 NFs canceladas no mês com S1 + S2
- Vendedor tem ≥ 5 NFs canceladas no trimestre com características
  similares (mesmo dealer, valor próximo, cancelamento rápido)
- **Peso: 20**

## Sinais "alerta amarelo" (médios)

### ⚠️ A1 — Cancelamento muito rápido
- `lastchangeDate - exitTime < 10 min`
- **Peso: 20**
- ⚠️ Pode ser ajuste operacional legítimo (vide caso J Silva — 4 NFs
  deletadas em 5min cada eram ajustes de valor)

### ⚠️ A2 — Cliente cadastrado no mesmo dia
- `insertDate (date) == issueDate (date)` da NF
- **Peso: 10**
- ⚠️ Normal pra cliente realmente novo — cadastrar no momento da 1ª venda
  é prática padrão

### ⚠️ A3 — Conversa apenas DEPOIS do cancelamento
- 1ª mensagem WhatsApp `> cancelDate + 30 dias`
- **Peso: 10**

### ⚠️ A4 — Múltiplas NFs sequenciais mesmo cliente
- N NFs do mesmo `personCode` no mesmo dia, valores similares (±20%)
- **Peso: 10**
- ⚠️ Pode ser ajuste operacional (não fraude)

## Sinais "baixos" (informativos)

### ℹ️ I1 — Pagamento sem comprovação
- NF cancelada não tem PIX recebido nem boleto pago associado
- **Peso: 5**
- Cuidado: alguns canais (revenda) sempre pagam fatura, não NF

### ℹ️ I2 — CNAE incompatível
- `code_activity_cnae` do cliente não bate com produto vendido
- Ex: Crosby (vestuário) vendendo pra CNAE de farmácia
- **Peso: 5**

### ℹ️ I3 — Cliente em região atípica
- UF do cliente fora da área de cobertura usual do vendedor
- **Peso: 3**

## Sinais "redutores de risco" (descontam pontos)

### ✅ R1 — Cliente teve NF válida no mesmo dia
- Junto com as canceladas há outras NFs `Issued` que somam um valor
  consistente com pagamentos recebidos
- **Desconto: -25**
- Indica ajuste operacional, não fraude

### ✅ R2 — Conversa robusta antes do cancelamento
- ≥ 20 mensagens entre vendedor e cliente nos 30 dias anteriores
- **Desconto: -30**

### ✅ R3 — Pagamento confirmado por PIX/comprovante
- Histórico no WhatsApp mostra cliente enviando comprovante
- **Desconto: -20**

## Fórmula final

```
score = max(0, min(100, soma_pesos_sinais))
```

| Score | Ação |
|---|---|
| 0-30 | Verde — caso normal |
| 31-60 | Amarelo — log apenas |
| 61-85 | Laranja — pra revisão no painel |
| 86-100 | Vermelho — alerta automático pro gestor via crosbybot |

## Validação pré-implementação

Antes de ligar o sistema em produção:

1. **Calibrar pesos** rodando histórico de 6 meses e ver:
   - quantas NFs canceladas ficariam em cada bucket
   - taxa de falsos positivos esperada
   - quais sinais combinam mais frequentemente

2. **Casos conhecidos como base verdade**:
   - J SILVA DOS REIS (PC 116809) → não é fraude (score esperado < 50)
   - REGINALDO ARCANJO (PC 114231) → investigar (cliente fantasma, score > 70?)
   - MARCOS AURELIO (PC 116753) → investigar

3. **Revisão manual de 30 casos** com score alto → confirmar
   se a metodologia bate com julgamento humano.
