# Schema de Antecipações de Faturas

## 📋 Descrição

Este schema cria uma tabela no Supabase para registrar antecipações de faturas com informações completas de auditoria, incluindo dados do usuário que realizou a operação e timestamps automáticos.

## 🗄️ Estrutura da Tabela

### `antecipacoes_faturas`

**Colunas:**

| Coluna             | Tipo                     | Descrição                               |
| ------------------ | ------------------------ | --------------------------------------- |
| `id`               | UUID                     | Chave primária (gerada automaticamente) |
| `cd_cliente`       | VARCHAR(50)              | Código do cliente                       |
| `nm_cliente`       | VARCHAR(255)             | Nome do cliente                         |
| `nr_fatura`        | VARCHAR(100)             | Número da fatura                        |
| `nr_parcela`       | VARCHAR(50)              | Número da parcela                       |
| `vl_fatura`        | DECIMAL(15, 2)           | Valor da fatura                         |
| `dt_vencimento`    | DATE                     | Data de vencimento                      |
| `cd_empresa`       | VARCHAR(50)              | Código da empresa                       |
| `banco_antecipado` | VARCHAR(100)             | Nome do banco onde foi antecipada       |
| `usuario_id`       | UUID                     | ID do usuário (FK para auth.users)      |
| `usuario_email`    | VARCHAR(255)             | Email do usuário                        |
| `usuario_nome`     | VARCHAR(255)             | Nome do usuário                         |
| `created_at`       | TIMESTAMP WITH TIME ZONE | Data/hora de criação                    |
| `updated_at`       | TIMESTAMP WITH TIME ZONE | Data/hora da última atualização         |
| `observacoes`      | TEXT                     | Observações adicionais                  |

**Constraints:**

- **UNIQUE**: `(cd_cliente, nr_fatura, nr_parcela)` - Evita duplicatas da mesma fatura
- **FK**: `usuario_id` referencia `auth.users(id)` com `ON DELETE CASCADE`

## 📊 Índices

Os seguintes índices foram criados para otimização de consultas:

- `idx_antecipacoes_cd_cliente` - Busca por cliente
- `idx_antecipacoes_nr_fatura` - Busca por fatura
- `idx_antecipacoes_banco` - Filtro por banco
- `idx_antecipacoes_usuario` - Busca por usuário
- `idx_antecipacoes_created_at` - Ordenação por data (DESC)
- `idx_antecipacoes_dt_vencimento` - Filtro por vencimento

## 🔐 RLS (Row Level Security)

As seguintes políticas de segurança foram aplicadas:

### Visualização (SELECT)

- ✅ Todos os usuários autenticados podem visualizar todas as antecipações

### Inserção (INSERT)

- ✅ Usuários autenticados podem criar antecipações
- ⚠️ Validação: `auth.uid() = usuario_id`

### Atualização (UPDATE)

- ✅ Usuários podem atualizar apenas suas próprias antecipações
- ⚠️ Validação: `auth.uid() = usuario_id`

### Exclusão (DELETE)

- ✅ Usuários podem deletar apenas suas próprias antecipações
- ⚠️ Validação: `auth.uid() = usuario_id`

## 🚀 Como Executar a Migration

### Via Supabase Dashboard (Recomendado)

1. Acesse o Supabase Dashboard: https://app.supabase.com
2. Selecione seu projeto
3. Navegue até **SQL Editor**
4. Clique em **New Query**
5. Copie o conteúdo do arquivo `schema-antecipacoes.sql`
6. Cole no editor e clique em **Run** ou pressione `Ctrl + Enter`
7. Verifique se não há erros no console

### Via CLI do Supabase

```bash
# Certifique-se de estar no diretório raiz do projeto
cd /caminho/para/gestaocrosby

# Execute a migration
supabase db push database/schema-antecipacoes.sql
```

## ✅ Validação da Migration

Após executar a migration, verifique:

1. **Tabela Criada:**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'antecipacoes_faturas';
```

2. **Políticas RLS:**

```sql
SELECT * FROM pg_policies
WHERE tablename = 'antecipacoes_faturas';
```

3. **Índices:**

```sql
SELECT indexname
FROM pg_indexes
WHERE tablename = 'antecipacoes_faturas';
```

## 🔧 Trigger Automático

A tabela possui um trigger que atualiza automaticamente o campo `updated_at` sempre que um registro é modificado:

```sql
-- Trigger: trigger_update_antecipacoes_updated_at
-- Função: update_antecipacoes_updated_at()
```

## 📝 Exemplo de Uso

### Inserir uma Antecipação

```javascript
const { data, error } = await supabase.from('antecipacoes_faturas').insert({
  cd_cliente: '12345',
  nm_cliente: 'Cliente Exemplo',
  nr_fatura: 'FAT-2024-001',
  nr_parcela: '1',
  vl_fatura: 1500.0,
  dt_vencimento: '2024-12-31',
  cd_empresa: '101',
  banco_antecipado: 'Banco do Brasil',
  usuario_id: user.id,
  usuario_email: user.email,
  usuario_nome: user.user_metadata.name,
});
```

### Buscar Antecipações

```javascript
const { data, error } = await supabase
  .from('antecipacoes_faturas')
  .select('*')
  .order('created_at', { ascending: false });
```

### Atualizar Banco de Antecipação

```javascript
const { data, error } = await supabase
  .from('antecipacoes_faturas')
  .update({ banco_antecipado: 'Santander' })
  .eq('id', antecipacaoId)
  .eq('usuario_id', user.id); // RLS garante que só o dono pode atualizar
```

### Deletar Antecipação

```javascript
const { error } = await supabase
  .from('antecipacoes_faturas')
  .delete()
  .eq('id', antecipacaoId);
```

## 🔍 Queries Úteis

### Buscar Antecipações por Cliente

```javascript
const { data } = await supabase
  .from('antecipacoes_faturas')
  .select('*')
  .eq('cd_cliente', '12345');
```

### Buscar por Banco

```javascript
const { data } = await supabase
  .from('antecipacoes_faturas')
  .select('*')
  .eq('banco_antecipado', 'Banco do Brasil');
```

### Buscar Antecipações do Usuário Logado

```javascript
const { data } = await supabase
  .from('antecipacoes_faturas')
  .select('*')
  .eq('usuario_id', user.id)
  .order('created_at', { ascending: false });
```

## 🛠️ Manutenção

### Limpar Registros Antigos

```sql
-- Deletar antecipações com mais de 1 ano
DELETE FROM antecipacoes_faturas
WHERE created_at < NOW() - INTERVAL '1 year';
```

### Estatísticas de Uso

```sql
-- Total de antecipações por banco
SELECT
  banco_antecipado,
  COUNT(*) as total,
  SUM(vl_fatura) as valor_total
FROM antecipacoes_faturas
GROUP BY banco_antecipado
ORDER BY total DESC;
```

## ⚠️ Notas Importantes

1. **Backup**: Sempre faça backup antes de executar migrations em produção
2. **RLS Habilitado**: A tabela possui RLS ativo - certifique-se de que os usuários estejam autenticados
3. **Unique Constraint**: A combinação `(cd_cliente, nr_fatura, nr_parcela)` é única
4. **Cascade Delete**: Se um usuário for deletado do `auth.users`, suas antecipações também serão deletadas

## 🐛 Troubleshooting

### Erro: "new row violates row-level security policy"

- **Solução**: Verifique se o usuário está autenticado e se o `usuario_id` corresponde ao `auth.uid()`

### Erro: "duplicate key value violates unique constraint"

- **Solução**: A fatura já foi antecipada. Use `upsert` em vez de `insert`

### Erro: "permission denied for table antecipacoes_faturas"

- **Solução**: Verifique as políticas RLS ou use o service role key para operações administrativas

## 📚 Referências

- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Row Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Supabase RLS Policies](https://supabase.com/docs/guides/auth/row-level-security)
