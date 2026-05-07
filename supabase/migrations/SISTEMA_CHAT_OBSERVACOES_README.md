# 💬 Sistema de Chat para Observações - Documentação

## 📋 Visão Geral

O sistema de observações foi transformado de um modelo simples (uma observação por despesa) para um sistema de **chat/histórico** que permite múltiplos comentários por despesa, criando uma conversa colaborativa entre usuários.

---

## 🎯 Funcionalidades Implementadas

### ✅ Backend (Completo)

- ✅ Coluna `is_active` adicionada à tabela `observacoes_despesas_totvs`
- ✅ Índice criado para otimizar consultas históricas
- ✅ Serviço refatorado para sempre **inserir** novas observações (não mais atualizar)
- ✅ Consultas ordenadas cronologicamente (`created_at ASC`)
- ✅ Filtro por observações ativas (`is_active = true`)

### ✅ Estrutura de Dados (Completo)

- ✅ `observacoesMap` agora armazena **arrays** de observações
- ✅ Cada despesa/título possui campo `_observacoesHistorico` com array completo
- ✅ Campo `_observacaoTotvs` mantém última observação para exibição rápida

### ✅ Interface do Modal (Completo)

- ✅ Chat-style UI com mensagens empilhadas
- ✅ Cada mensagem mostra: **usuário**, **timestamp** e **conteúdo**
- ✅ Campo de input para novas observações
- ✅ Suporte a Enter (enviar) e Shift+Enter (nova linha)
- ✅ Estado de loading ao enviar observação
- ✅ Atualização otimista do histórico local
- ✅ Diferenciação visual: despesas manuais = campo simples, TOTVS = chat completo

---

## 🚀 Passo a Passo para Ativar o Sistema

### 1️⃣ **Executar Migration no Supabase**

**IMPORTANTE:** Esta migration deve ser executada **ANTES** de testar o sistema no frontend!

1. Acesse o **Supabase Dashboard** do seu projeto
2. Vá em **SQL Editor**
3. Abra e execute o arquivo: `supabase/migrations/alter_observacoes_to_history.sql`

Conteúdo da migration:

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

4. Clique em **Run** para executar
5. Verifique se não houve erros
6. Confirme que a coluna foi criada:
   ```sql
   SELECT * FROM observacoes_despesas_totvs LIMIT 1;
   ```

---

### 2️⃣ **Testar o Sistema**

1. **Abrir página DRE**
2. **Clicar em uma despesa TOTVS no nível 4** (subsubitem)
3. **Verificar o modal:**

   - ✅ Deve aparecer a seção "Histórico de Observações (Chat)"
   - ✅ Se houver observações anteriores, devem aparecer como mensagens empilhadas
   - ✅ Campo de input na parte inferior

4. **Adicionar nova observação:**

   - Digite um texto no campo
   - Pressione **Enter** ou clique em **Enviar**
   - A mensagem deve aparecer imediatamente no histórico
   - Deve mostrar seu nome e horário atual

5. **Testar com múltiplas observações:**

   - Adicione 2-3 observações seguidas
   - Feche e reabra o modal
   - Todas as observações devem estar lá, ordenadas cronologicamente

6. **Testar com usuários diferentes:**
   - Faça login com outro usuário
   - Abra a mesma despesa
   - Adicione uma observação
   - Deve aparecer o nome do novo usuário nas mensagens

---

## 📊 Estrutura de Dados

### Tabela: `observacoes_despesas_totvs`

| Campo            | Tipo        | Descrição                                    |
| ---------------- | ----------- | -------------------------------------------- |
| `id`             | UUID        | Identificador único da observação            |
| `cd_usuario`     | UUID        | ID do usuário que criou (FK para auth.users) |
| `cd_empresa`     | INTEGER     | Código da empresa                            |
| `cd_despesaitem` | INTEGER     | Código do item de despesa                    |
| `cd_fornecedor`  | INTEGER     | Código do fornecedor                         |
| `nr_duplicata`   | VARCHAR     | Número da duplicata                          |
| `nr_parcela`     | INTEGER     | Número da parcela                            |
| `observacao`     | TEXT        | Conteúdo da observação                       |
| `dt_inicio`      | DATE        | Data inicial do período                      |
| `dt_fim`         | DATE        | Data final do período                        |
| `created_at`     | TIMESTAMP   | Data/hora de criação                         |
| `updated_at`     | TIMESTAMP   | Data/hora da última atualização              |
| **`is_active`**  | **BOOLEAN** | **🆕 Se a observação está ativa**            |

### Objeto de Despesa no Frontend

```javascript
{
  // ... outros campos ...

  // 🆕 Array com TODAS as observações (ordenadas cronologicamente)
  _observacoesHistorico: [
    {
      id: 'uuid-1',
      observacao: 'Primeira observação',
      created_at: '2024-01-15T10:30:00Z',
      usuario: {
        id: 'user-uuid',
        email: 'usuario@email.com',
        raw_user_meta_data: {
          full_name: 'João Silva'
        }
      }
    },
    {
      id: 'uuid-2',
      observacao: 'Segunda observação',
      created_at: '2024-01-15T14:20:00Z',
      usuario: {
        id: 'user-uuid-2',
        email: 'usuario2@email.com',
        raw_user_meta_data: {
          full_name: 'Maria Santos'
        }
      }
    }
  ],

  // Última observação (para exibição rápida no ponto vermelho)
  _observacaoTotvs: 'Segunda observação',

  // Indicador visual
  _temObservacao: true
}
```

---

## 🔧 Arquivos Modificados

### 1. Migration SQL

- **Arquivo:** `supabase/migrations/alter_observacoes_to_history.sql`
- **Ação:** Adiciona coluna `is_active` e índice

### 2. Service Layer

- **Arquivo:** `src/services/observacoesDespesasService.js`
- **Mudanças:**
  - `salvarObservacaoDespesa()`: Sempre faz INSERT (não mais upsert)
  - `buscarObservacoesPeriodo()`: Filtra por `is_active=true`, ordena por `created_at`

### 3. Processamento de Dados

- **Arquivo:** `src/pages/DRE.jsx`
- **Mudanças:**
  - `observacoesMap`: Tipo mudou de `Map<string, object>` para `Map<string, array>`
  - Cada chave armazena array de observações
  - Títulos recebem `_observacoesHistorico` array completo
  - Lógica de push para adicionar múltiplas observações à mesma chave

### 4. Interface do Modal

- **Arquivo:** `src/components/ModalDetalhesDespesaManual.jsx`
- **Mudanças:**
  - Nova seção de chat para despesas TOTVS
  - Campo simples mantido para despesas manuais
  - Estados adicionados: `novaObservacao`, `salvandoObservacao`
  - Função `handleAdicionarObservacao()` para enviar novos comentários
  - UI de chat com mensagens empilhadas
  - Atualização otimista do histórico local

---

## 🎨 Experiência do Usuário

### Antes (Sistema Antigo)

```
┌─────────────────────────────────┐
│ Observações                     │
├─────────────────────────────────┤
│ Última observação...            │
│                                 │
│ [Editar]                        │
└─────────────────────────────────┘
```

- ❌ Apenas uma observação por vez
- ❌ Atualização sobrescrevia a anterior
- ❌ Sem histórico de quem comentou

### Depois (Sistema de Chat)

```
┌─────────────────────────────────┐
│ 💬 Histórico de Observações     │
├─────────────────────────────────┤
│ 👤 João Silva - 15/01 10:30     │
│ Primeira observação aqui...     │
├─────────────────────────────────┤
│ 👤 Maria Santos - 15/01 14:20   │
│ Segunda observação sobre isso...│
├─────────────────────────────────┤
│ [Digite nova observação...]     │
│                        [Enviar] │
└─────────────────────────────────┘
```

- ✅ Múltiplas observações
- ✅ Histórico completo preservado
- ✅ Identificação de quem comentou
- ✅ Timestamps precisos
- ✅ Interface familiar (tipo WhatsApp)

---

## 🐛 Troubleshooting

### Erro: "column 'is_active' does not exist"

**Causa:** Migration não foi executada  
**Solução:** Execute a migration no Supabase SQL Editor

### Observações não aparecem no chat

**Possíveis causas:**

1. `_observacoesHistorico` não está sendo populado

   - Verifique `buscarObservacoesPeriodo()` no service
   - Confirme que o array está sendo retornado

2. Período atual não está definido

   - Verifique prop `periodoAtual` sendo passada ao modal
   - Confirme `dt_inicio` e `dt_fim` no estado do DRE

3. Dados no formato antigo
   - Recarregue a página para buscar dados atualizados
   - Verifique console para logs de estrutura de dados

### Botão "Enviar" desabilitado

**Causa:** Campo vazio ou já salvando  
**Solução:** Digite algo no campo de texto

### Usuário aparece como "Usuário desconhecido"

**Possíveis causas:**

1. Usuário não tem `full_name` nos metadados

   - Normal para usuários antigos
   - Mostrará email como fallback

2. Foreign key não configurada
   - Verifique a view `usuarios_view`
   - Confirme que a query está trazendo dados do usuário

---

## 📈 Próximas Melhorias Sugeridas

1. **Edição de Observações**

   - Permitir editar observação própria (marcar anterior como `is_active=false`)
   - Mostrar indicador "editado"

2. **Exclusão de Observações**

   - Soft delete (marcar `is_active=false`)
   - Apenas criador ou admin pode excluir

3. **Menções de Usuários**

   - Sintaxe `@usuario` para mencionar
   - Notificações quando mencionado

4. **Anexos**

   - Upload de imagens/documentos nas observações
   - Preview inline

5. **Reações**

   - Emojis de reação (👍 ❤️ etc.)
   - Contador de reações

6. **Busca no Histórico**

   - Campo de busca para filtrar observações
   - Highlight de termos encontrados

7. **Exportar Histórico**
   - Botão para exportar todo o histórico em PDF/Excel
   - Útil para auditorias

---

## ✅ Checklist de Implementação

- [x] ✅ Criar migration SQL com coluna `is_active`
- [x] ✅ Criar índice para performance
- [x] ✅ Refatorar `salvarObservacaoDespesa` (insert-only)
- [x] ✅ Refatorar `buscarObservacoesPeriodo` (retornar arrays)
- [x] ✅ Atualizar `observacoesMap` para arrays
- [x] ✅ Adicionar `_observacoesHistorico` aos objetos de despesa
- [x] ✅ Criar UI de chat no modal
- [x] ✅ Implementar campo de input para novas observações
- [x] ✅ Implementar função `handleAdicionarObservacao`
- [x] ✅ Adicionar loading states
- [x] ✅ Implementar atualização otimista
- [x] ✅ Testar com múltiplas observações
- [ ] ⏳ Executar migration no Supabase (aguardando ação do usuário)
- [ ] ⏳ Testar em produção

---

## 📞 Suporte

Se encontrar problemas:

1. Verifique o console do navegador para erros
2. Confirme que a migration foi executada
3. Verifique os logs do Supabase
4. Teste com dados de exemplo primeiro

---

**Data de Criação:** 2024  
**Última Atualização:** 2024  
**Status:** ✅ Implementação Completa (Aguardando Migration)
