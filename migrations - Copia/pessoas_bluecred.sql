-- Clientes classificados como "BLUE CRED" no TOTVS
-- (typeCode=55 / typeName='TIPO CLIENTE VAREJO' / code='8' / name='BLUE CRED')
-- Populado por job diário que busca no TOTVS via /person/v2/individuals/search.
CREATE TABLE IF NOT EXISTS pessoas_bluecred (
  id BIGSERIAL PRIMARY KEY,
  person_code INTEGER NOT NULL,
  person_name TEXT,
  cpf TEXT,
  tipo_pessoa TEXT,                              -- 'PF' | 'PJ'
  classified_at TIMESTAMPTZ,                     -- quando foi classificado (insertDate ou maxChangeFilterDate)
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pbc_person_code UNIQUE (person_code)
);
CREATE INDEX IF NOT EXISTS idx_pbc_classified_at ON pessoas_bluecred (classified_at);
