/**
 * Rotas da Automação Financeiro.
 *
 * Consumidas pela página owner "Automação Financeiro" (front) para exibir os
 * logs de disparo e permitir gatilhos manuais de teste.
 *
 *   GET  /api/automacao/boletos/envios?data=YYYY-MM-DD  → lista + resumo do dia
 *   POST /api/automacao/boletos/run?dryRun=1            → roda o planner
 *   POST /api/automacao/boletos/processar              → processa 1 item da fila
 */
import express from 'express';
import supabase from '../config/supabase.js';
import {
  planejarEnvios,
  processarFila,
  enviarBoletoTeste,
} from '../jobs/boleto-cobranca.job.js';

const router = express.Router();
const TABLE = 'automacao_boleto_envios';

// YYYY-MM-DD de hoje no fuso BRT
function hojeBRT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.BOLETO_COBRANCA_TZ || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Lista os envios de um dia + resumo agregado por status
router.get('/boletos/envios', async (req, res) => {
  const data = req.query.data || hojeBRT();
  try {
    const { data: rows, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('data_ref', data)
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('criado_em', { ascending: true });
    if (error) throw error;

    const lista = rows || [];
    const resumo = {
      total: lista.length,
      enviado: 0,
      pendente: 0,
      falha: 0,
      pulado_pago: 0,
      pulado_cancelado: 0,
      pulado_sem_telefone: 0,
      valor_total: 0,
    };
    for (const r of lista) {
      if (resumo[r.status] !== undefined) resumo[r.status] += 1;
      resumo.valor_total += Number(r.vl_fatura || 0);
    }

    res.json({ success: true, data: data, resumo, envios: lista });
  } catch (err) {
    console.error('[automacao] erro ao listar envios:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Dias que têm registros (para o seletor de data no front)
router.get('/boletos/dias', async (_req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from(TABLE)
      .select('data_ref')
      .order('data_ref', { ascending: false })
      .limit(2000);
    if (error) throw error;
    const dias = [...new Set((rows || []).map((r) => r.data_ref))];
    res.json({ success: true, dias });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Gatilho manual do planner (?dryRun=1 apenas simula, não grava)
router.post('/boletos/run', async (req, res) => {
  const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true;
  try {
    const resultado = await planejarEnvios({ dryRun });
    res.json({ success: true, dryRun, resultado });
  } catch (err) {
    console.error('[automacao] erro no run:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Processa 1 item da fila agora (teste manual do worker)
router.post('/boletos/processar', async (_req, res) => {
  try {
    await processarFila();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Envia 1 boleto de amostra AGORA para o número de teste (exige TEST_PHONE)
router.post('/boletos/testar', async (_req, res) => {
  try {
    const resultado = await enviarBoletoTeste();
    res.json({ success: resultado.ok, resultado });
  } catch (err) {
    console.error('[automacao] erro no testar:', err.message);
    // Devolve no mesmo formato de `resultado` para o front exibir a causa
    res
      .status(200)
      .json({ success: false, resultado: { ok: false, error: err.message } });
  }
});

export default router;
