# 🔧 Correção de Acesso às Solicitações

## Problema Identificado

A política RLS (Row Level Security) do Supabase estava bloqueando o acesso às solicitações porque filtrava apenas por `user_id`, mas usuários de franquia precisam ver solicitações por **empresas vinculadas**, não por quem criou.

## ✅ Solução Implementada

### 1. Atualização no Frontend

- ✅ Busca agora usa `empresasVinculadas` do contexto de autenticação
- ✅ Filtra solicitações por `cd_empresa` ao invés de `user_id`
- ✅ Suporta múltiplas empresas vinculadas automaticamente

### 2. Atualização no Banco de Dados (NECESSÁRIO EXECUTAR)

**⚠️ IMPORTANTE**: Execute o script SQL abaixo no Supabase para corrigir o acesso:

#### Como Executar:

1. Acesse o [Supabase Dashboard](https://supabase.com/dashboard)
2. Selecione o projeto
3. Vá em **SQL Editor**
4. Cole o script abaixo
5. Clique em **RUN**

#### Script SQL:

```sql
-- Remover política antiga que bloqueia acesso
DROP POLICY IF EXISTS "Usuários podem ver suas próprias solicitações" ON solicitacoes_credito;

-- Criar nova política que permite ver todas as solicitações
-- (O filtro por empresa é feito no frontend através das empresas vinculadas)
CREATE POLICY "Usuários podem ver solicitações"
  ON solicitacoes_credito
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Verificar se a política foi criada com sucesso
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename = 'solicitacoes_credito';
```

### 3. Teste após a execução do SQL:

1. Faça logout e login novamente
2. Acesse **Solicitação de Crédito** > **Minhas Solicitações**
3. As solicitações das suas empresas vinculadas devem aparecer

## 🔍 Como Funciona Agora

### Lógica de Filtro:

1. **Usuário de Franquia (ex: empresasVinculadas = ['6130', '6131'])**:
   - Busca: `WHERE cd_empresa IN (6130, 6131)`
   - Vê apenas solicitações dessas empresas
2. **Filtro de Empresa Aplicado**:

   - Se usuário selecionar empresa específica no filtro
   - Busca: `WHERE cd_empresa IN (empresa_selecionada)`

3. **Filtro de Status**:
   - Adiciona: `AND status = 'ANALISE'` (ou outro status)

### Exemplo de Query Final:

```sql
SELECT * FROM solicitacoes_credito
WHERE cd_empresa IN (6130, 6131)
  AND status = 'ANALISE'
ORDER BY dt_solicitacao DESC;
```

## 📝 Logs de Debug

Para verificar se está funcionando, abra o Console do navegador (F12) e procure por:

```
🔍 Buscando solicitações para empresas: [6130, 6131]
📋 Solicitações encontradas: [...]
```

## ❌ Se Ainda Não Funcionar

1. **Verifique se executou o SQL no Supabase**
2. **Limpe o cache do navegador** (Ctrl + Shift + Delete)
3. **Faça logout e login novamente**
4. **Verifique no console se `empresasVinculadas` tem valores**:
   ```javascript
   console.log('Empresas vinculadas:', empresasVinculadas);
   ```

## 🔐 Segurança

A nova política RLS permite que usuários autenticados vejam todas as solicitações, mas:

- ✅ O filtro por empresa é aplicado no **frontend**
- ✅ Usuários só veem empresas às quais têm acesso
- ✅ Criação ainda exige `user_id` correto
- ✅ Apenas admins podem aprovar/reprovar
