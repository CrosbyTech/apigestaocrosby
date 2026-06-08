-- Adiciona valor_bruto (VL.FAT) e credev pra refletir VL.FAT, CREDEV e Total
-- do dashboard de vendas (mesmas 3 métricas do TOTVS).
-- valor (já existente) = líquido = valor_bruto - credev
alter table faturamento_diario_canal
  add column if not exists valor_bruto numeric(14,2) default 0,
  add column if not exists credev      numeric(14,2) default 0;
