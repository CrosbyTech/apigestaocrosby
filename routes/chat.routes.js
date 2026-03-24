import express from 'express';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';

const router = express.Router();

// Chaves de API suportadas (em ordem de prioridade)
const getAIConfig = () => {
  // Groq (gratuito, rápido)
  if (process.env.GROQ_API_KEY) {
    return {
      provider: 'groq',
      apiKey: process.env.GROQ_API_KEY,
      apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
    };
  }

  // OpenAI (ChatGPT)
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }

  // xAI (Grok)
  if (process.env.XAI_API_KEY) {
    return {
      provider: 'xai',
      apiKey: process.env.XAI_API_KEY,
      apiUrl: 'https://api.x.ai/v1/chat/completions',
      model: process.env.XAI_MODEL || 'grok-4-latest',
    };
  }

  return null;
};

/**
 * @route POST /chat/contas-pagar
 * @desc Enviar mensagem para IA com contexto de contas a pagar
 * @access Public
 */
router.post(
  '/contas-pagar',
  asyncHandler(async (req, res) => {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return errorResponse(res, 'Mensagens inválidas ou não fornecidas', 400);
    }

    const aiConfig = getAIConfig();

    if (!aiConfig) {
      return res.status(200).json({
        choices: [
          {
            message: {
              content:
                '⚠️ **API de IA não configurada.**\n\nPara habilitar respostas inteligentes, configure uma das seguintes variáveis no servidor:\n\n' +
                '- **GROQ_API_KEY** (gratuito - recomendado) → groq.com\n' +
                '- **OPENAI_API_KEY** (ChatGPT) → platform.openai.com\n' +
                '- **XAI_API_KEY** (Grok) → x.ai\n\n' +
                'Enquanto isso, as respostas locais básicas estão funcionando normalmente.',
            },
          },
        ],
      });
    }

    try {
      console.log(
        `🤖 Chat IA [${aiConfig.provider}] - Processando mensagem...`,
      );

      const response = await fetch(aiConfig.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: aiConfig.model,
          messages,
          temperature: 0.3,
          max_tokens: 4096,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error(
          `❌ Erro ${aiConfig.provider} (${response.status}):`,
          errorData,
        );
        return res.status(200).json({
          choices: [
            {
              message: {
                content: `❌ Erro ao consultar a IA (${aiConfig.provider}): ${response.status}. Verifique sua chave de API.`,
              },
            },
          ],
        });
      }

      const data = await response.json();
      console.log(
        `✅ Chat IA [${aiConfig.provider}] - Resposta recebida com sucesso`,
      );

      res.json(data);
    } catch (error) {
      console.error('❌ Erro no chat IA:', error.message);
      return res.status(200).json({
        choices: [
          {
            message: {
              content: `❌ Erro de conexão com a IA: ${error.message}. Tente novamente.`,
            },
          },
        ],
      });
    }
  }),
);

/**
 * @route GET /chat/status
 * @desc Verificar status da configuração de IA
 * @access Public
 */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const aiConfig = getAIConfig();

    return successResponse(res, {
      configured: !!aiConfig,
      provider: aiConfig?.provider || null,
      model: aiConfig?.model || null,
    });
  }),
);

export default router;
