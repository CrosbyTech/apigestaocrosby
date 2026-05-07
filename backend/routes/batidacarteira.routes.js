/**
 * Rotas financeiras — processamento de arquivos para Batida de Carteira
 *
 * POST /financial/batida-carteira/upload
 *   - Campo: arquivo (multipart)
 *   - Campo: banco   (string: CONFIANCA | SICREDI | SISTEMA_CONFIANCA | SISTEMA_SICREDI)
 */

import express from 'express';
import multer from 'multer';

import { processConfiancaFile } from '../utils/batidacarteira/CONFIANCA.js';
import { processSicrediFile } from '../utils/batidacarteira/SICREDI.js';
import { processSistemaConfiancaFile } from '../utils/batidacarteira/SISTEMA_CONFIANCA.js';
import { processSistemaSicrediFile } from '../utils/batidacarteira/SISTEMA_SICREDI.js';

const router = express.Router();

// Armazena o arquivo em memória (buffer) — sem gravar em disco
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

/**
 * @route POST /financial/batida-carteira/upload
 * @desc  Recebe arquivo de extrato bancário e retorna registros normalizados
 */
router.post(
  '/batida-carteira/upload',
  upload.single('arquivo'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Nenhum arquivo enviado',
        });
      }

      const banco = (req.body.banco || '').trim().toUpperCase();
      if (!banco) {
        return res.status(400).json({
          success: false,
          message: 'Campo "banco" é obrigatório',
        });
      }

      const fileBuffer = req.file.buffer;

      // Para parsers que precisam de string (CSV), decodificar em latin1 (windows-1252)
      // que é compatível com a maioria dos exports brasileiros
      const fileContentLatin1 = fileBuffer.toString('latin1');

      let result;

      switch (banco) {
        case 'CONFIANCA':
          result = processConfiancaFile(fileContentLatin1);
          break;

        case 'SICREDI':
          // Sicredi recebe o buffer para detecção de Excel vs CSV
          result = processSicrediFile(fileBuffer);
          break;

        case 'SISTEMA_CONFIANCA': {
          // Tenta UTF-8 primeiro (mais comum nos sistemas modernos)
          const utf8Content = fileBuffer.toString('utf-8');
          result = processSistemaConfiancaFile(utf8Content);
          break;
        }

        case 'SISTEMA_SICREDI': {
          const utf8Content = fileBuffer.toString('utf-8');
          result = processSistemaSicrediFile(utf8Content);
          break;
        }

        default:
          return res.status(400).json({
            success: false,
            message:
              `Banco não suportado para batida de carteira: ${banco}. ` +
              'Bancos disponíveis: CONFIANCA, SICREDI, SISTEMA_CONFIANCA, SISTEMA_SICREDI',
          });
      }

      return res.status(200).json({
        success: true,
        data: {
          registros: result.registros,
          stats: result.stats,
        },
        arquivo: {
          nomeOriginal: req.file.originalname,
          tamanho: req.file.size,
          dataUpload: new Date().toISOString(),
          banco,
        },
      });
    } catch (error) {
      console.error('❌ Erro no upload batida-carteira:', error.message);
      return res.status(500).json({
        success: false,
        message: error.message || 'Erro ao processar arquivo',
      });
    }
  },
);

export default router;
