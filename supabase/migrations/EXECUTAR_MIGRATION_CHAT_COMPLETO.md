# ⚡ AÇÃO NECESSÁRIA - Executar 3 Migrations para Sistema de Chat

## 🚨 IMPORTANTE: Execute TODAS as 3 migrations ANTES de testar!

### 📋 Passo a Passo Rápido

1. **Acesse o Supabase Dashboard**

   - Vá para: https://supabase.com/dashboard
   - Selecione seu projeto

2. **Abra o SQL Editor**
   - Menu lateral → **SQL Editor**
   - Clique em **New Query**

---

## 🔧 MIGRATION 1: Remover Constraint Única - TOTVS (OBRIGATÓRIO!)

### ⚠️ Execute PRIMEIRO esta migration:

```sql
-- Migration: Remover constraint UNIQUE para permitir múltiplas observações (sistema de chat)
-- A constraint antiga impedia que múltiplos comentários fossem criados para a mesma despesa

-- 1. Dropar a constraint UNIQUE que está impedindo múltiplas observações
ALTER TABLE public.observacoes_despesas_totvs
DROP CONSTRAINT IF EXISTS idx_obs_totvs_unique;

-- 2. Dropar índice único se existir (geralmente criado junto com a constraint)
DROP INDEX IF EXISTS public.idx_obs_totvs_unique;

-- Confirmação via comentário
COMMENT ON TABLE public.observacoes_despesas_totvs IS
'Tabela de observações de despesas TOTVS. Suporta múltiplas observações por despesa (sistema de chat). Constraint unique removida para permitir histórico de comentários.';
```

**✅ Clique em RUN** → Deve aparecer "Success. No rows returned"

---

## ✅ MIGRATION 2: Adicionar Coluna is_active - TOTVS

### Execute esta segunda migration:

```sql
-- Migration: Transformar observações em sistema de chat/histórico
-- Adiciona coluna is_active para suportar múltiplas observações por despesa

-- 1. Adicionar coluna is_active (padrão true)
ALTER TABLE observacoes_despesas_totvs
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 2. Marcar todas as observações existentes como ativas
UPDATE observacoes_despesas_totvs
SET is_active = true
WHERE is_active IS NULL;

-- 3. Criar índice para otimizar consultas de histórico
CREATE INDEX IF NOT EXISTS idx_observacoes_historico
ON observacoes_despesas_totvs(cd_empresa, cd_fornecedor, nr_duplicata, nr_parcela, is_active, created_at);

-- 4. Comentário explicativo
COMMENT ON COLUMN observacoes_despesas_totvs.is_active IS
'Indica se a observação está ativa. Permite soft delete e suporta histórico de múltiplas observações.';
```

**✅ Clique em RUN** → Deve aparecer "Success. No rows returned"

---

## 🆕 MIGRATION 3: Criar Tabela de Observações para Despesas Manuais (NOVO!)

### Execute esta terceira migration para ativar chat nas despesas manuais:

```sql
-- Migration: Criar tabela de histórico de observações para despesas manuais
-- Similar ao sistema de observações para despesas TOTVS, mas para despesas manuais

-- 1. Criar tabela de observações de despesas manuais (sistema de chat)
CREATE TABLE IF NOT EXISTS public.observacoes_despesas_manuais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cd_usuario UUID NOT NULL REFERENCES auth.users(id),
  id_despesa_manual UUID NOT NULL REFERENCES public.despesas_manuais_dre(id) ON DELETE CASCADE,
  observacao TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Criar índice para otimizar consultas de histórico
CREATE INDEX IF NOT EXISTS idx_obs_manuais_historico
ON public.observacoes_despesas_manuais(id_despesa_manual, is_active, created_at);

-- 3. Criar índice para buscar por usuário
CREATE INDEX IF NOT EXISTS idx_obs_manuais_usuario
ON public.observacoes_despesas_manuais(cd_usuario);

-- 4. Habilitar Row Level Security (RLS)
ALTER TABLE public.observacoes_despesas_manuais ENABLE ROW LEVEL SECURITY;

-- 5. Criar política para permitir SELECT para usuários autenticados
CREATE POLICY "Usuários autenticados podem ver observações de despesas manuais"
ON public.observacoes_despesas_manuais
FOR SELECT
TO authenticated
USING (true);

-- 6. Criar política para permitir INSERT para usuários autenticados
CREATE POLICY "Usuários autenticados podem criar observações de despesas manuais"
ON public.observacoes_despesas_manuais
FOR INSERT
TO authenticated
WITH CHECK (cd_usuario = auth.uid());

-- 7. Criar política para permitir UPDATE apenas do próprio comentário
CREATE POLICY "Usuários podem atualizar suas próprias observações"
ON public.observacoes_despesas_manuais
FOR UPDATE
TO authenticated
USING (cd_usuario = auth.uid())
WITH CHECK (cd_usuario = auth.uid());

-- 8. Adicionar comentários explicativos
COMMENT ON TABLE public.observacoes_despesas_manuais IS
'Histórico de observações (chat) para despesas manuais. Permite múltiplas observações por despesa com rastreamento de usuário e timestamp.';

COMMENT ON COLUMN public.observacoes_despesas_manuais.id IS
'Identificador único da observação';

COMMENT ON COLUMN public.observacoes_despesas_manuais.cd_usuario IS
'ID do usuário que criou a observação (FK para auth.users)';

COMMENT ON COLUMN public.observacoes_despesas_manuais.id_despesa_manual IS
'ID da despesa manual (FK para despesas_manuais_dre)';

COMMENT ON COLUMN public.observacoes_despesas_manuais.observacao IS
'Conteúdo da observação/comentário';

COMMENT ON COLUMN public.observacoes_despesas_manuais.is_active IS
'Indica se a observação está ativa (suporta soft delete)';

COMMENT ON COLUMN public.observacoes_despesas_manuais.created_at IS
'Data/hora de criação da observação';

COMMENT ON COLUMN public.observacoes_despesas_manuais.updated_at IS
'Data/hora da última atualização da observação';

-- 9. Migrar observações existentes do campo observacoes para a nova tabela
INSERT INTO public.observacoes_despesas_manuais (cd_usuario, id_despesa_manual, observacao, created_at, updated_at)
SELECT
  COALESCE(cd_usuario, (SELECT id FROM auth.users LIMIT 1)),
  id,
  observacoes,
  COALESCE(dt_cadastro, NOW()),
  COALESCE(dt_alteracao, dt_cadastro, NOW())
FROM public.despesas_manuais_dre
WHERE observacoes IS NOT NULL
  AND observacoes != ''
  AND ativo = true;

-- 10. Comentário sobre o campo antigo (manter por compatibilidade temporária)
COMMENT ON COLUMN public.despesas_manuais_dre.observacoes IS
'DEPRECIADO: Campo antigo de observações. Migrado para tabela observacoes_despesas_manuais. Manter por compatibilidade temporária.';
```

**✅ Clique em RUN** → Deve aparecer "Success" (pode mostrar quantidade de registros migrados)

---

## 🔴 MIGRATION 4: Habilitar Realtime para Chat em Tempo Real (OBRIGATÓRIO!)

### Execute esta quarta migration para ativar atualizações em tempo real:

```sql
-- Migration: Habilitar Realtime para observações (chat em tempo real)
-- Permite que mudanças nas tabelas sejam transmitidas em tempo real para clientes conectados

-- 1. Habilitar Realtime para observações TOTVS
ALTER PUBLICATION supabase_realtime ADD TABLE public.observacoes_despesas_totvs;

-- 2. Habilitar Realtime para observações de Despesas Manuais
ALTER PUBLICATION supabase_realtime ADD TABLE public.observacoes_despesas_manuais;

-- 3. Comentários explicativos
COMMENT ON TABLE public.observacoes_despesas_totvs IS
'Tabela de observações de despesas TOTVS. Suporta múltiplas observações por despesa (sistema de chat). REALTIME HABILITADO para atualizações em tempo real.';

COMMENT ON TABLE public.observacoes_despesas_manuais IS
'Histórico de observações (chat) para despesas manuais. Permite múltiplas observações por despesa. REALTIME HABILITADO para atualizações em tempo real.';
```

**✅ Clique em RUN** → Deve aparecer "Success. No rows returned"

⚠️ **IMPORTANTE:** Esta migration só funciona DEPOIS de executar a Migration 3 (que cria a tabela observacoes_despesas_manuais)!

---

## 5. **Verificar que tudo funcionou:**

```sql
-- Verificar se a constraint TOTVS foi removida (deve retornar 0 linhas)
SELECT constraint_name
FROM information_schema.table_constraints
WHERE table_name = 'observacoes_despesas_totvs'
AND constraint_name = 'idx_obs_totvs_unique';

-- Verificar se a coluna is_active existe em TOTVS
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'observacoes_despesas_totvs'
AND column_name = 'is_active';

-- Verificar se a tabela de observações manuais foi criada
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'observacoes_despesas_manuais';

-- Verificar quantas observações foram migradas
SELECT COUNT(*) as total_observacoes_migradas
FROM public.observacoes_despesas_manuais;

-- 🆕 Verificar se o Realtime está habilitado (deve retornar 2 linhas)
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND tablename IN ('observacoes_despesas_totvs', 'observacoes_despesas_manuais');
```

**Resultado esperado da última query:**

```
schemaname | tablename
-----------+-------------------------------
public     | observacoes_despesas_totvs
public     | observacoes_despesas_manuais
```

Se aparecerem as 2 linhas, o real-time está ✅ **ATIVO**!

---

## 🧪 Como Testar o Real-Time

### Teste de Chat em Tempo Real (2 Usuários)

1. **Abra 2 navegadores/abas diferentes** (ou use modo anônimo)
2. **Faça login com usuários diferentes** em cada aba
3. **Abra a mesma despesa** em ambas as abas
4. **No usuário 1:** Digite e envie uma observação
5. **No usuário 2:** A mensagem deve aparecer **INSTANTANEAMENTE** sem recarregar! ⚡
6. **No usuário 2:** Digite e envie outra observação
7. **No usuário 1:** A mensagem deve aparecer automaticamente! 🎉

### Sinais de que está funcionando:

✅ Mensagem aparece automaticamente sem fechar/abrir modal  
✅ Scroll automático para nova mensagem  
✅ Animação suave quando mensagem aparece  
✅ Console mostra: `✨ Nova observação recebida via real-time`  
✅ Console mostra: `📡 Real-time status: SUBSCRIBED`

### Se não funcionar:

❌ **Erro "relation does not exist"**  
→ Execute a Migration 3 primeiro!

❌ **Real-time não conecta**  
→ Execute a Migration 4 (habilitar realtime)

❌ **Mensagens não aparecem automaticamente**  
→ Verifique a query de verificação (passo 5) - deve mostrar 2 tabelas

---

## 🧪 Como Testar (Funcionalidades Gerais)

### Testar Despesas TOTVS (Sistema Original)

1. Abra a página **DRE**
2. Clique em uma **despesa TOTVS** no nível 4 (subsubitem)
3. No modal, você verá:

   - 💬 **"Histórico de Observações (Chat)"**
   - Observações anteriores como mensagens empilhadas
   - Campo para adicionar nova observação

4. **Teste adicionar observação:**
   - Digite um texto
   - Pressione **Enter** ou clique em **Enviar**
   - A mensagem deve aparecer com seu nome e horário

### Testar Despesas Manuais (NOVO!)

1. Na página **DRE**, clique em uma **despesa manual** (marcada com badge azul "✏️ DESPESA MANUAL")
2. O modal também terá:

   - 💬 **"Histórico de Observações (Chat)"**
   - Sistema de chat igual ao TOTVS
   - Histórico completo de comentários

3. **Teste adicionar observação:**

   - Digite um texto
   - Pressione **Enter** ou clique em **Enviar**
   - A mensagem deve aparecer imediatamente

4. **Teste múltiplas observações:**
   - Adicione 2-3 observações seguidas
   - Feche e reabra o modal
   - Todas devem estar lá, ordenadas cronologicamente

---

## 🎯 O que mudou?

### Antes:

- **TOTVS**: 1 observação por despesa
- **Manual**: Campo simples de texto
- Editar sobrescrevia a anterior
- Sem histórico

### Agora:

- ✅ **TOTVS e Manual**: Chat completo com múltiplas observações
- ✅ Histórico completo preservado em ambos
- ✅ Nome do usuário em cada mensagem
- ✅ Data/hora de cada comentário
- ✅ Interface unificada (WhatsApp/Slack style)
- ✅ Observações antigas migradas automaticamente

---

## ❓ Problemas?

### Erro: "column 'is_active' does not exist"

→ Execute as migrations 1 e 2!

### Erro: "relation 'observacoes_despesas_manuais' does not exist"

→ Execute a migration 3!

### Botão "Enviar" desabilitado

→ Digite algo no campo primeiro

### Observações não aparecem

→ Recarregue a página após executar as migrations

### Observações antigas das despesas manuais não aparecem

→ A migration 3 migra automaticamente. Verifique a query de verificação (passo 4)

---

**Documentação completa:** `SISTEMA_CHAT_OBSERVACOES_README.md`
