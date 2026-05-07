# 🔍 DIAGNÓSTICO: Real-time não funciona para outros usuários

## ❌ Problema

- Mensagem aparece para quem envia (✅)
- Mensagem NÃO aparece para outros usuários (❌)
- Só aparece quando recarrega a página

## 🧪 Testes para Fazer

### Teste 1: Verificar Console do Navegador

#### Usuário A (quem vai enviar):

1. Abra a despesa TOTVS
2. Abra o console (F12)
3. Procure por:

```
🟢 Configurando real-time TOTVS: { filtro: "..." }
📡 Real-time TOTVS status: SUBSCRIBED
✅ Real-time SUBSCRIBED! Canal ativo e escutando...
```

#### Usuário B (quem vai receber):

1. Abra a MESMA despesa TOTVS (mesmo fornecedor, duplicata, etc)
2. Abra o console (F12)
3. Procure pelos MESMOS logs acima
4. **IMPORTANTE**: Os dois devem ter o MESMO filtro!

### Teste 2: Comparar Filtros

**Copie e cole aqui os filtros dos dois usuários:**

Usuário A:

```
🔍 Filtro aplicado: cd_empresa=eq.X,cd_despesaitem=eq.Y,...
```

Usuário B:

```
🔍 Filtro aplicado: cd_empresa=eq.X,cd_despesaitem=eq.Y,...
```

**Os filtros DEVEM SER IDÊNTICOS!**

### Teste 3: Verificar Políticas RLS

Execute no Supabase SQL Editor:

```sql
-- Ver políticas
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'observacoes_despesas_totvs';
```

**Resultado esperado:**

```
policyname                                      | cmd    | roles
----------------------------------------------- | ------ | --------------
Usuários autenticados podem ver observações    | SELECT | authenticated
Usuários autenticados podem criar observações  | INSERT | authenticated
```

Se não tiver essas políticas, execute:

```sql
-- Criar política de SELECT
CREATE POLICY "Usuários autenticados podem ver observações"
ON public.observacoes_despesas_totvs
FOR SELECT
TO authenticated
USING (true);

-- Criar política de INSERT
CREATE POLICY "Usuários autenticados podem criar observações"
ON public.observacoes_despesas_totvs
FOR INSERT
TO authenticated
WITH CHECK (cd_usuario = auth.uid());
```

### Teste 4: Testar Real-time Manualmente

Execute no Supabase SQL Editor:

```sql
-- 1. Pegar seu UUID
SELECT id, email FROM auth.users LIMIT 5;

-- 2. Inserir observação manualmente
-- ⚠️ TROQUE os valores pelos da despesa que está aberta nos dois navegadores
INSERT INTO public.observacoes_despesas_totvs (
  cd_usuario,
  cd_empresa,
  cd_despesaitem,
  cd_fornecedor,
  nr_duplicata,
  nr_parcela,
  observacao,
  is_active
) VALUES (
  'SEU_UUID_AQUI',  -- ⚠️ Cole seu UUID aqui
  1,                -- ⚠️ cd_empresa da despesa aberta
  6018,             -- ⚠️ cd_despesaitem da despesa aberta
  76249,            -- ⚠️ cd_fornecedor da despesa aberta
  '5559',           -- ⚠️ nr_duplicata da despesa aberta
  1,                -- ⚠️ nr_parcela da despesa aberta
  '🧪 TESTE MANUAL - Se aparecer, real-time funciona!',
  true
);
```

**O que deve acontecer:**

- Se o real-time funcionar, essa mensagem deve aparecer **AUTOMATICAMENTE** nos dois navegadores!
- Se não aparecer, o problema é no Supabase/real-time, não no código

### Teste 5: Verificar Supabase Dashboard

1. Vá em **Database** > **Replication**
2. Verifique se `observacoes_despesas_totvs` está na lista
3. Se não estiver, clique em "Add table" e adicione

## 🐛 Possíveis Causas

### Causa 1: Filtro Diferente

- Os dois usuários devem estar vendo a MESMA despesa
- O filtro do real-time usa: cd_empresa, cd_despesaitem, cd_fornecedor, nr_duplicata, nr_parcela
- Se algum valor for diferente, não vai funcionar

### Causa 2: Políticas RLS Bloqueando

- Se não tiver política de SELECT, usuários não veem observações de outros
- Verificar com a query do Teste 3

### Causa 3: Real-time não habilitado no Dashboard

- Verificar no Supabase Dashboard > Database > Replication
- Tabela deve estar listada

### Causa 4: Canal não conectando

- Verificar console: deve mostrar "SUBSCRIBED"
- Se mostrar "CHANNEL_ERROR" ou "TIMED_OUT", há problema de conexão

## 📋 Checklist de Diagnóstico

Execute cada teste e marque:

- [ ] Teste 1: Console mostra "SUBSCRIBED" nos dois navegadores?
- [ ] Teste 2: Filtros são IDÊNTICOS nos dois navegadores?
- [ ] Teste 3: Políticas RLS existem e permitem SELECT/INSERT?
- [ ] Teste 4: Inserção manual aparece automaticamente?
- [ ] Teste 5: Tabela está no Replication do Dashboard?

## 🎯 Próximos Passos

1. **Execute os testes acima**
2. **Me envie:**
   - Screenshots do console dos dois navegadores
   - Resultado das queries SQL
   - Qual teste falhou

Com essas informações, vou identificar exatamente o problema! 🔍
