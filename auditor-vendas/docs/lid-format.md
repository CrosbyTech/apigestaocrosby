# Formato `@lid` no WhatsApp Business

## O que é

`@lid` (Linked Identifier) é o formato que o WhatsApp Cloud Business usa
quando uma conta está **vinculada a um Business Manager**. Em vez do JID
clássico `<numero>@s.whatsapp.net`, aparece como `<id-opaco>@lid`.

O ID opaco não tem relação direta com o número de telefone — é um
identificador interno do WhatsApp.

## Por que importa pra auditoria

Se você buscar por `key->>'remoteJid' LIKE '%94984356203%'` no Evolution,
**vai retornar zero resultados** mesmo o cliente tendo conversado, porque
o JID na verdade é tipo `77812241330368@lid`.

A solução é usar os campos auxiliares **normalizados**:

- `Message.msisdn_55_v2` — telefone normalizado (`5594984356203`)
- `Message.msisdn_55` — variação 1 (pode estar sem o 9: `559484356203`)
- `Message.pushName` — nome que o cliente usa no WhatsApp
- `Contact.msisdn_55` — equivalente em Contact

## Exemplo real (caso J Silva dos Reis)

| Lugar | Valor |
|---|---|
| TOTVS `phones[].number` | `94984356203` |
| pes_pessoa `telefone` | `94984356203` |
| Contact `remoteJid` (Evolution) | `559484356203@s.whatsapp.net` |
| Contact `msisdn_55` | `5594984356203` |
| Message `key->>'remoteJid'` | `77812241330368@lid` ← opaco! |
| Message `msisdn_55_v2` | `5594984356203` ← normalizado, igual ao Contact |
| Message `pushName` | `Jucelino Reis` (varia por instância) |

## Query padrão pra buscar mensagens de um número

```sql
-- Pra um cliente específico em uma instância específica
SELECT msg_ts_tz, (key->>'fromMe')::bool as from_me,
       "messageType", text_content
  FROM "Message"
 WHERE msisdn_55_v2 = '5594984356203'   -- 55 + DDD + 9 + número
   AND "instanceId" = '<uuid da instância>'
 ORDER BY msg_ts_tz ASC
```

```sql
-- Listar quais instâncias têm conversa com esse número
SELECT i.name, COUNT(*) as msgs,
       MIN(msg_ts_tz) as first, MAX(msg_ts_tz) as last
  FROM "Message" m
  LEFT JOIN "Instance" i ON i.id = m."instanceId"
 WHERE m.msisdn_55_v2 = '5594984356203'
 GROUP BY i.name
 ORDER BY msgs DESC
```

## Normalização do telefone

Telefones brasileiros podem aparecer com ou sem o "9" extra (lei do 9º
dígito). Pra cobrir todas as variantes:

```js
function normalizeBrPhone(rawPhone) {
  const d = String(rawPhone || '').replace(/\D/g, '');
  if (!d) return [];
  const variants = new Set();
  if (d.startsWith('55')) {
    variants.add(d);                  // 5594984356203
    // Tira o 9 extra (móvel): 559484356203
    if (d.length === 13 && d[4] === '9') {
      variants.add(d.slice(0, 4) + d.slice(5));
    }
    // Sem o 55:
    variants.add(d.slice(2));         // 94984356203
  } else if (d.length === 11 && d[2] === '9') {
    variants.add('55' + d);           // adiciona 55
    variants.add('55' + d.slice(0, 2) + d.slice(3));  // sem 9 extra
    variants.add(d);                  // 94984356203
  } else if (d.length === 10) {
    variants.add('55' + d);           // sem 9 (DDD + 8 dígitos)
    variants.add(d);
  }
  return [...variants];
}
```

Usar `msisdn_55_v2` evita esse trabalho — o Evolution já normaliza pro
formato canônico de 13 dígitos com 9.
