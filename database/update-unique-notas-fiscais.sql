-- Atualizar constraint UNIQUE da tabela notas_fiscais
-- Antes: (branch_code, transaction_code)
-- Depois: (branch_code, transaction_code, invoice_code, issue_date, total_value)
-- Isso previne duplicatas com mesma empresa, transação, NF, data e valor

-- Remover constraint antiga
ALTER TABLE notas_fiscais
DROP CONSTRAINT IF EXISTS notas_fiscais_branch_code_transaction_code_key;

-- Criar nova constraint com mais colunas
ALTER TABLE notas_fiscais
ADD CONSTRAINT notas_fiscais_unique_registro
UNIQUE (branch_code, transaction_code, invoice_code, issue_date, total_value);
