-- Adiciona coluna pro nome fantasia (mais útil pra identificar franquia/loja)
alter table expedicao_showroom
  add column if not exists person_fantasy_name text;
