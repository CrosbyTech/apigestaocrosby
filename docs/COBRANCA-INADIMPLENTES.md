# Cobrança — clientes devedores para disparo externo (WhatsApp)

Rota única que devolve os clientes devedores exatamente como as telas de
inadimplência do HeadCoach os calculam, já com as correções de data/fuso,
telefone e deduplicação. Feita para outro sistema puxar a lista e disparar
mensagens de cobrança pela API do WhatsApp.

```
GET https://<backend>/api/cobranca/inadimplentes
```

## Autenticação

Defina `COBRANCA_API_TOKEN` no ambiente do backend (Render). A partir daí a
rota exige um dos dois headers:

```
x-api-key: <token>
Authorization: Bearer <token>
```

Sem a variável a rota fica aberta (o log avisa). Não deixe assim em produção.

## Parâmetros (query string)

| Parâmetro      | Valores                                          | Padrão       |
|----------------|--------------------------------------------------|--------------|
| `canal`        | `todos`, `mtm`, `revenda`, `franquias`, `bluecred` (aceita csv) | `todos` |
| `situacao`     | `todos`, `vencido` (≤ 60 dias), `inadimplente` (> 60 dias) | `todos` |
| `dias_min`     | atraso mínimo do título, em dias                 | `1`          |
| `dias_max`     | atraso máximo do título, em dias                 | sem limite   |
| `dt_inicio`    | vencimento a partir de (`YYYY-MM-DD`)            | `2024-04-01` |
| `com_telefone` | `1` = só clientes com número válido para WhatsApp | `0`         |
| `formato`      | `clientes` (agrupado) ou `titulos` (1 linha por parcela) | `clientes` |
| `refresh`      | `1` = ignora o cache de 10 minutos               | `0`          |

A primeira chamada do dia é lenta (o TOTVS é varrido em lotes; Revenda tem
cerca de 25 mil clientes). Depois disso a resposta vem do cache por 10 minutos
e os filtros acima são aplicados sobre o cache, então filtrar não custa nada.
Use `refresh=1` só quando precisar de dado novo.

## Exemplos

```bash
# Todos os devedores com telefone, agrupados por cliente
curl -H "x-api-key: $TOKEN" "https://<backend>/api/cobranca/inadimplentes?com_telefone=1"

# Só Multimarcas com mais de 30 dias, uma linha por parcela
curl -H "x-api-key: $TOKEN" "https://<backend>/api/cobranca/inadimplentes?canal=mtm&dias_min=31&formato=titulos"

# BlueCred inadimplente (> 60 dias)
curl -H "x-api-key: $TOKEN" "https://<backend>/api/cobranca/inadimplentes?canal=bluecred&situacao=inadimplente"
```

## Resposta (`formato=clientes`)

```json
{
  "success": true,
  "message": "412 cliente(s) devedor(es)",
  "data": {
    "hoje": "2026-09-16",
    "gerado_em": "2026-09-16T12:03:11.000Z",
    "cached": false,
    "dias_inadimplente": 60,
    "parametros": { "canais": ["FRANQUIAS","MTM","REVENDA","BLUECRED"], "dt_inicio": "2024-04-01", "situacao": "todos", "dias_min": 1, "dias_max": null, "com_telefone": false, "formato": "clientes" },
    "avisos": [],
    "resumo": {
      "clientes": 412, "titulos": 1380, "valor_vencido": 1234567.89, "valor_corrigido": 1301234.56,
      "com_telefone_whatsapp": 380, "sem_telefone": 32,
      "por_canal": { "MTM": { "clientes": 120, "titulos": 500, "valor_vencido": 670000.00 } }
    },
    "clientes": [
      {
        "canal": "MTM",
        "cd_cliente": 12345,
        "nm_cliente": "LOJA EXEMPLO LTDA",
        "nm_fantasia": "LOJA EXEMPLO",
        "nr_cpfcnpj": "11222333000181",
        "tipo_pessoa": "PJ",
        "ds_uf": "CE",
        "nr_telefone": "(85) 98765-4321",
        "telefone_origem": "call_center",
        "telefone_whatsapp": "5585987654321",
        "telefone_tipo": "celular",
        "representante": "WALTER",
        "situacao": "inadimplente",
        "maior_atraso_dias": 95,
        "vencimento_mais_antigo": "2026-06-13",
        "qtd_titulos": 2,
        "valor_vencido": 1500.00,
        "valor_juros": 45.10,
        "valor_multa": 30.00,
        "valor_corrigido": 1575.10,
        "titulos": [
          {
            "cd_empresa": 1, "nm_empresa": "CROSBY MATRIZ",
            "nr_fatura": 987654, "nr_parcela": 1,
            "dt_emissao": "2026-05-13", "dt_vencimento": "2026-06-13", "dias_atraso": 95,
            "vl_fatura": 750.00, "vl_juros": 25.10, "vl_multa": 15.00, "vl_desconto": 0, "vl_liquido": 790.10,
            "cd_portador": 748, "nm_portador": "SICREDI", "tp_cobranca": 0,
            "nosso_numero": "123456789", "linha_digitavel": "748...", "cd_barras": "748...", "qr_code_pix": null,
            "em_protesto": false
          }
        ]
      }
    ]
  }
}
```

Com `formato=titulos` o array vem em `data.titulos`, cada item com os campos
do cliente **e** do título na mesma linha (bom para planilha ou fila de envio).

### Campos que importam para o disparo

- `telefone_whatsapp`: já normalizado, só dígitos, com DDI 55. Vem `null`
  quando o número não é válido; use `com_telefone=1` para receber só quem dá
  para cobrar. `telefone_tipo` diz se é celular ou fixo.
- `telefone_origem`: `call_center` é o número que a equipe corrigiu à mão na
  tela do Call Center (tem prioridade); `totvs` é o cadastro.
- `em_protesto`: título já enviado à Esteira de Protesto. Normalmente não se
  cobra por WhatsApp um título que está no cartório.
- `linha_digitavel` / `cd_barras` / `qr_code_pix`: só existem quando o TOTVS
  tem o boleto registrado; podem vir `null`.
- `avisos`: se um canal ou um lote do TOTVS falhou nesta carga, aparece aqui.
  Uma lista com aviso está incompleta; trate como parcial.

## Regras aplicadas (as mesmas das telas)

| Canal     | Quem entra                                           | Filiais consideradas            |
|-----------|------------------------------------------------------|---------------------------------|
| FRANQUIAS | classificação TOTVS tipo 2/1 ou tipo 20/4            | todas                           |
| MTM       | tipo 20/2 ou tipo 5/1                                | todas                           |
| REVENDA   | tipo 7/1 ou tipo 20/3 (PJ e PF)                      | código < 5999, fora 98 e 980    |
| BLUECRED  | CPFs do crediário (contratos + compras no app)       | código < 5999, fora 98, 980 e 551 |

Um cliente que está em mais de um canal conta só no primeiro da ordem acima
(mesma precedência do Dashboard de Inadimplência).

Título: só FATURA (documento tipo 1), situação normal, em aberto, sem
pagamento, vencimento anterior a hoje no fuso de Fortaleza. Cheque, cartão e
PIX ficam de fora. Cliente 3591 (teste da integração BlueCard) nunca aparece.

## O que esta rota corrige em relação às telas

- Hoje é calculado no fuso da loja, não em UTC (as telas viram o dia às 21h).
- Vencido é decidido pela data pura, sem depender do relógio do servidor.
- Título deduplicado por empresa + fatura + parcela.
- Juros e multa vêm separados e somados em `valor_corrigido`.
- Telefone manual do Call Center sobrepõe o do TOTVS, e já sai no formato da API.
- Leituras do Supabase são paginadas (as telas param em 1000 linhas).

## Onde cada tela busca os dados (referência)

| Tela                          | Lista de clientes                | Títulos                                   | Extras                                      |
|-------------------------------|----------------------------------|-------------------------------------------|---------------------------------------------|
| Inadimplentes Multimarcas     | `GET /api/totvs/multibrand-clients` | `GET /api/totvs/accounts-receivable/filter?cd_cliente=…` | `persons/batch-lookup`, Supabase `classificacoes_inadimplentes`, `esteira_protesto` |
| Inadimplentes Revenda         | `POST /api/totvs/clients-classifications` (depois das faturas) | `accounts-receivable/filter?branches=…` | idem                                        |
| Inadimplentes Franquias       | `GET /api/totvs/franchise-clients` | `accounts-receivable/filter?cd_cliente=…` | `persons/batch-lookup`, `observacoes_inadimplentes_franquias` |
| Inadimplência BlueCred        | `GET /api/totvs/bluecred/inadimplencia` (agregado) | (interno à rota)                    | `esteira_protesto`, `solicitacoes_baixa`    |
| Call Center                   | `GET /api/totvs/multibrand-clients` | `accounts-receivable/filter` (+ `expand_invoice=1` no modo adimplente) | `call_center_contatos`, `call_center_ligacoes`, `/api/sms/*` |
| Metas / Dashboard Inadimplência | os 4 acima + `GET /api/totvs/bluecred/clientes` | `accounts-receivable/filter` em lotes de 500 | `inadimplencia_timeline`                  |

Implementação: `routes/cobranca.routes.js` (orquestração) e
`utils/cobrancaInadimplentes.js` (regras puras, cobertas por `__tests__/cobranca*.test.js`).
