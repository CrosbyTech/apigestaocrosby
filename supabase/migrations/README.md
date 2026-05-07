# Instruções de Migration - Sistema de Permissões

## 📋 Como executar as migrations no Supabase

### ⚠️ IMPORTANTE: Execute as migrations na ordem correta!

1. **create_get_all_users_function.sql** - Função para listar usuários
2. **create_user_page_permissions.sql** - Tabela de permissões

### Opção 1: Via Dashboard do Supabase (Recomendado)

#### Migration 1: Função get_all_users

1. Acesse o [Dashboard do Supabase](https://app.supabase.com)
2. Selecione seu projeto
3. Vá em **SQL Editor** no menu lateral
4. Clique em **New Query**
5. Copie todo o conteúdo do arquivo `create_get_all_users_function.sql`
6. Cole no editor SQL
7. Clique em **Run** ou pressione `Ctrl + Enter`
8. Aguarde a execução (deve aparecer "Success")

#### Migration 2: Tabela user_page_permissions

1. No **SQL Editor**, clique em **New Query**
2. Copie todo o conteúdo do arquivo `create_user_page_permissions.sql`
3. Cole no editor SQL
4. Clique em **Run** ou pressione `Ctrl + Enter`
5. Aguarde a execução (deve aparecer "Success")

### Opção 2: Via Supabase CLI

Se você tem o Supabase CLI instalado:

```bash
# Na raiz do projeto
supabase db push
```

Ou execute diretamente:

```bash
supabase db execute -f supabase/migrations/create_user_page_permissions.sql
```

## ✅ Verificar se as migrations foram executadas

Execute estes comandos SQL no SQL Editor para verificar:

### Verificar função get_all_users

```sql
-- Verificar se a função existe
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'get_all_users';

-- Testar a função (apenas se você for owner)
SELECT * FROM get_all_users();
```

### Verificar tabela user_page_permissions

```sql
-- Verificar se a tabela foi criada
SELECT * FROM information_schema.tables
WHERE table_name = 'user_page_permissions';

-- Verificar estrutura da tabela
\d user_page_permissions;

-- Verificar políticas RLS
SELECT * FROM pg_policies
WHERE tablename = 'user_page_permissions';
```

## 🔐 Políticas de Segurança (RLS)

A tabela possui as seguintes políticas:

1. **SELECT**: Usuários podem ver apenas suas próprias permissões
2. **INSERT**: Apenas owners podem inserir permissões
3. **UPDATE**: Apenas owners podem atualizar permissões
4. **DELETE**: Apenas owners podem deletar permissões

## 📊 Estrutura da Tabela

```sql
user_page_permissions
├── id (uuid, primary key)
├── user_id (uuid, foreign key -> auth.users)
├── page_path (text)
├── created_at (timestamp)
├── created_by (uuid, foreign key -> auth.users)
└── updated_at (timestamp)
```

## 🧪 Testar a tabela

Após executar a migration, você pode testar com:

```sql
-- Inserir uma permissão de teste (substitua USER_ID pelo ID real)
INSERT INTO user_page_permissions (user_id, page_path)
VALUES ('USER_ID_AQUI', '/dashboard-faturamento');

-- Buscar permissões
SELECT * FROM user_page_permissions;

-- Limpar teste
DELETE FROM user_page_permissions;
```

## ⚠️ Importante

- A migration cria a tabela com **Row Level Security (RLS)** habilitado
- Apenas usuários com role 'owner' podem gerenciar permissões
- A constraint `unique_user_page` garante que não haja duplicatas
- O campo `updated_at` é atualizado automaticamente via trigger

## 🔄 Rollback

Se precisar reverter as migrations:

### Reverter função get_all_users

```sql
-- Remover função
DROP FUNCTION IF EXISTS get_all_users() CASCADE;
```

### Reverter tabela user_page_permissions

```sql
-- Remover tabela e todas as dependências
DROP TABLE IF EXISTS public.user_page_permissions CASCADE;

-- Remover função do trigger
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
```
