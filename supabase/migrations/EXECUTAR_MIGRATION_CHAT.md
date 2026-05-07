# ⚡ AÇÃO NECESSÁRIA - Executar Migrations

## 🚨 IMPORTANTE: Execute ANTES de testar o sistema de chat!

### 📋 Passo a Passo Rápido

1. **Acesse o Supabase Dashboard**

   - Vá para: https://supabase.com/dashboard
   - Selecione seu projeto

2. **Abra o SQL Editor**
   - Menu lateral → **SQL Editor**
   - Clique em **New Query**

---

## 🔧 MIGRATION 1: Remover Constraint Única (OBRIGATÓRIO!)

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

**Clique em RUN** → Deve aparecer "Success. No rows returned"

---

## ✅ MIGRATION 2: Adicionar Coluna is_active

### Agora execute esta segunda migration:

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

**Clique em RUN** → Deve aparecer "Success. No rows returned"

---

## 4. **Verificar que tudo funcionou:**

```sql
-- Verificar se a constraint foi removida (deve retornar 0 linhas)
SELECT constraint_name
FROM information_schema.table_constraints
WHERE table_name = 'observacoes_despesas_totvs'
AND constraint_name = 'idx_obs_totvs_unique';

-- Verificar se a coluna is_active existe
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'observacoes_despesas_totvs'
AND column_name = 'is_active';
```

---

## 🧪 Como Testar

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

5. **Teste múltiplas observações:**
   - Adicione 2-3 observações
   - Feche e reabra o modal
   - Todas devem estar lá!

---

## 🎯 O que mudou?

### Antes:

- 1 observação por despesa
- Editar sobrescrevia a anterior
- Sem histórico

### Agora:

- ✅ Múltiplas observações por despesa
- ✅ Histórico completo preservado
- ✅ Nome do usuário em cada mensagem
- ✅ Data/hora de cada comentário
- ✅ Interface tipo chat (WhatsApp/Slack)

---

## ❓ Problemas?

### Erro: "column 'is_active' does not exist"

→ Execute a migration acima!

### Botão "Enviar" desabilitado

→ Digite algo no campo primeiro

### Observações não aparecem

→ Recarregue a página após executar a migration

---

**Documentação completa:** `SISTEMA_CHAT_OBSERVACOES_README.md`
