-- Adiciona colunas pra rastrear mídia baixada localmente.
-- Mantém file_url (URL original UAzapi/CDN) E adiciona media_local_path
-- (caminho relativo dentro de backend/uploads/uazapi-media/).

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_local_path TEXT,
  ADD COLUMN IF NOT EXISTS media_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS media_mime TEXT,
  ADD COLUMN IF NOT EXISTS media_downloaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS media_download_error TEXT;

CREATE INDEX IF NOT EXISTS messages_media_path_idx
  ON messages (media_local_path)
  WHERE media_local_path IS NOT NULL;

COMMENT ON COLUMN messages.media_local_path IS 'Caminho relativo do arquivo em backend/uploads/uazapi-media/';
COMMENT ON COLUMN messages.media_size_bytes IS 'Tamanho do arquivo baixado em bytes';
COMMENT ON COLUMN messages.media_downloaded_at IS 'Quando foi baixado com sucesso';
COMMENT ON COLUMN messages.media_download_error IS 'Última mensagem de erro ao tentar baixar (se aplicável)';
