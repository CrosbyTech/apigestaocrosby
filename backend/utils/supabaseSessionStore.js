import supabase from '../config/supabase.js';
import { logger } from './errorHandler.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const BUCKET = 'clientes-confianca';
const SESSION_PATH = 'whatsapp-session';

/**
 * Store customizado para RemoteAuth do whatsapp-web.js
 * Persiste a sessão no Supabase Storage para sobreviver a redeploys
 */
class SupabaseSessionStore {
  async sessionExists(options) {
    const filePath = `${SESSION_PATH}/${options.session}.zip`;
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list(SESSION_PATH, { search: `${options.session}.zip` });

      if (error) {
        logger.error('Erro ao verificar sessão WhatsApp:', error.message);
        return false;
      }
      return data && data.some((f) => f.name === `${options.session}.zip`);
    } catch (err) {
      logger.error('Erro ao verificar sessão WhatsApp:', err.message);
      return false;
    }
  }

  async save(options) {
    const filePath = `${SESSION_PATH}/${options.session}.zip`;
    try {
      // O wwebjs salva o zip temporário no dataPath do RemoteAuth
      const possiblePaths = [
        path.join(os.tmpdir(), `wwebjs_auth_${options.session}.zip`),
        path.join(os.tmpdir(), `RemoteAuth-${options.session}.zip`),
        path.join(
          process.cwd(),
          '.wwebjs_auth',
          `RemoteAuth-${options.session}.zip`,
        ),
      ];

      let tempPath = null;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          tempPath = p;
          break;
        }
      }

      if (!tempPath) {
        logger.warn(
          `Arquivo de sessão não encontrado em nenhum path conhecido`,
        );
        return;
      }

      logger.info(`Salvando sessão de: ${tempPath}`);
      const fileBuffer = fs.readFileSync(tempPath);

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, fileBuffer, {
          contentType: 'application/zip',
          upsert: true,
        });

      if (error) {
        logger.error('Erro ao salvar sessão WhatsApp:', error.message);
        return;
      }

      logger.info('Sessão WhatsApp salva no Supabase Storage');
    } catch (err) {
      logger.error('Erro ao salvar sessão WhatsApp:', err.message);
    }
  }

  async extract(options) {
    const filePath = `${SESSION_PATH}/${options.session}.zip`;
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .download(filePath);

      if (error) {
        logger.error('Erro ao extrair sessão WhatsApp:', error.message);
        return;
      }

      const tempPath = path.join(
        os.tmpdir(),
        `wwebjs_auth_${options.session}.zip`,
      );
      const buffer = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(tempPath, buffer);

      logger.info('Sessão WhatsApp restaurada do Supabase Storage');
    } catch (err) {
      logger.error('Erro ao extrair sessão WhatsApp:', err.message);
    }
  }

  async delete(options) {
    const filePath = `${SESSION_PATH}/${options.session}.zip`;
    try {
      const { error } = await supabase.storage.from(BUCKET).remove([filePath]);

      if (error) {
        logger.error('Erro ao deletar sessão WhatsApp:', error.message);
        return;
      }

      logger.info('Sessão WhatsApp removida do Supabase Storage');
    } catch (err) {
      logger.error('Erro ao deletar sessão WhatsApp:', err.message);
    }
  }
}

export default SupabaseSessionStore;
