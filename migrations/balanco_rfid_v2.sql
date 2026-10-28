-- ============================================================================
-- BALANÇO RFID v2
--   • setor: na matriz (empresa 99) o estoque é dividido por setores (CREDEV,
--     SITE, EXPEDIÇÃO…) — o app pede o setor ao finalizar
--   • downloads: histórico de quem baixou o CSV e quando; depois de 48 h o
--     download exige senha de gerente/admin/owner (evita importar o mesmo
--     balanço duas vezes no TOTVS)
-- Idempotente.
-- ============================================================================

ALTER TABLE balanco_rfid_arquivos ADD COLUMN IF NOT EXISTS setor TEXT;
ALTER TABLE balanco_rfid_arquivos ADD COLUMN IF NOT EXISTS downloads JSONB NOT NULL DEFAULT '[]'::jsonb;
