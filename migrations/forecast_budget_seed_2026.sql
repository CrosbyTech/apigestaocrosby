-- Seed importado da planilha FORECAST - Planejamento de buget trimestral.xlsx
-- T1 e T2 de 2026. Canais zerados (business, inbound_rafael, bazar) ficam
-- pra cadastro manual via UI.
INSERT INTO forecast_budget_trimestral
  (ano, trimestre, canal, canal_label, budget_trafego, budget_marketing, meta_faturamento)
VALUES
  (2026, 1, 'revenda', 'B2R - Revenda', 25580.43, 3803.55, 1023217.32),
  (2026, 2, 'revenda', 'B2R - Revenda', 10219.05, 1904.3, 408762.0),
  (2026, 1, 'multimarcas', 'B2M - Multimarcas', 17544.88, 2638.53, 701795.0),
  (2026, 2, 'multimarcas', 'B2M - Multimarcas', 7760.37, 2330.33, 310414.64),
  (2026, 1, 'varejo', 'B2C - Varejo', 26977.79, 4914.37, 1079111.52),
  (2026, 2, 'varejo', 'B2C - Varejo', 11577.97, 3409.59, 463118.7),
  (2026, 1, 'franquia', 'B2L - Franquia', 44117.38, 2670.69, 1764695.0),
  (2026, 2, 'franquia', 'B2L - Franquia', 7551.86, 2212.12, 302074.37),
  (2026, 1, 'inbound_david', 'B2M Inbound - David', 3049.47, 516.78, 121978.65),
  (2026, 2, 'inbound_david', 'B2M Inbound - David', 2013.83, 642.69, 80553.16),
  (2026, 1, 'business', 'B2 Business', 0, 0, 0),
  (2026, 2, 'business', 'B2 Business', 0, 0, 0),
  (2026, 1, 'inbound_rafael', 'B2M Inbound - Rafael', 0, 0, 0),
  (2026, 2, 'inbound_rafael', 'B2M Inbound - Rafael', 0, 0, 0),
  (2026, 1, 'bazar', 'Bazar', 0, 0, 0),
  (2026, 2, 'bazar', 'Bazar', 0, 0, 0)
ON CONFLICT (ano, trimestre, canal) DO UPDATE SET
  budget_trafego = EXCLUDED.budget_trafego,
  budget_marketing = EXCLUDED.budget_marketing,
  meta_faturamento = EXCLUDED.meta_faturamento,
  canal_label = EXCLUDED.canal_label;