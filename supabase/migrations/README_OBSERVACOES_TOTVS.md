# Migration: Observações de Despesas TOTVS

## 📋 Descrição

Esta migration cria a tabela `observacoes_despesas_totvs` para permitir que usuários adicionem observações/comentários personalizados a despesas importadas do TOTVS no módulo DRE.

## 🎯 Objetivo

Permitir anotações em despesas do TOTVS sem editar os valores originais, mantendo rastreabilidade e contexto.

## 📊 Estrutura da Tabela

```sql
observacoes_despesas_totvs
├── id (UUID, PK)
├── cd_empresa (INTEGER)
├── cd_despesaitem (INTEGER)
├── cd_fornecedor (INTEGER)
├── nr_duplicata (TEXT)
├── nr_parcela (INTEGER)
├── observacao (TEXT)
├── dt_inicio (DATE)
├── dt_fim (DATE)
├── cd_usuario (UUID, FK → auth.users)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)
```

## 🔐 Segurança (RLS)

- ✅ Row Level Security habilitado
- ✅ Usuários podem ver/criar/editar/deletar apenas suas próprias observações
- ✅ Índice único garante uma observação por despesa por período

## 🚀 Como Executar

### Opção 1: Supabase Dashboard (Recomendado)

1. Acesse o dashboard do Supabase
2. Vá em **SQL Editor**
3. Cole o conteúdo do arquivo `20251106_create_observacoes_despesas_totvs.sql`
4. Execute o script

### Opção 2: Supabase CLI

```bash
supabase db push --file supabase/migrations/20251106_create_observacoes_despesas_totvs.sql
```

### Opção 3: Linha de comando (psql)

```bash
psql -h db.XXXXXXX.supabase.co -U postgres -d postgres -f supabase/migrations/20251106_create_observacoes_despesas_totvs.sql
```

## ✅ Verificação

Após executar, verifique se a tabela foi criada:

```sql
SELECT * FROM observacoes_despesas_totvs LIMIT 1;
```

## 📝 Exemplo de Uso

```javascript
import { salvarObservacaoDespesa } from '../services/observacoesDespesasService';

await salvarObservacaoDespesa({
  cd_empresa: 1,
  cd_despesaitem: 6031,
  cd_fornecedor: 31124,
  nr_duplicata: '854',
  nr_parcela: 3,
  observacao: 'Despesa aprovada pela diretoria',
  dt_inicio: '2025-11-01',
  dt_fim: '2025-11-30',
});
```

## 🔄 Rollback

Se precisar reverter:

```sql
DROP TABLE IF EXISTS observacoes_despesas_totvs CASCADE;
DROP FUNCTION IF EXISTS update_observacoes_totvs_updated_at CASCADE;
```

## 📌 Notas

- Esta tabela complementa `despesas_manuais_dre` (para despesas criadas manualmente)
- Observações TOTVS são vinculadas ao período da DRE
- Cada despesa pode ter uma observação por período
- Observações não alteram valores importados do TOTVS
