import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';

// ─── Rotas existentes ────────────────────────────────────────────────────────────────────
import chatRoutes from './routes/chat.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import financialRoutes from './routes/batidacarteira.routes.js';
import financialCredevRoutes from './routes/financialCredev.routes.js';
import catalogoRoutes from './routes/catalogo.routes.js';
import metaRoutes from './routes/meta.routes.js';
import evolutionRoutes from './routes/evolution.routes.js';
import autentiqueRoutes, { prewarmChrome } from './routes/autentique.routes.js';
import crmRoutes, { iniciarCronSyncLeadsCompras } from './routes/crm.routes.js';
import filaRoutes from './routes/fila.routes.js';
import forecastRoutes from './routes/forecast.routes.js';
import bluecardRoutes, { iniciarBluecardStatsSync } from './routes/bluecard.routes.js';
import wixRoutes from './routes/wix.routes.js';
import expedicaoShowroomRoutes from './routes/expedicaoShowroom.routes.js';
import faturamentoHistoricoRoutes from './routes/faturamentoHistorico.routes.js';
import faturamentoTransacaoRoutes from './routes/faturamentoTransacao.routes.js';
import techRoutes from './routes/tech.routes.js';
import uazapiSyncRoutes from './routes/uazapiSync.routes.js';
import monitoringRoutes from './routes/monitoring.routes.js';
import conciliacaoStoneRoutes from './routes/conciliacaoStone.routes.js';
import { iniciarCronUazapiSync } from './services/uazapiSync.js';
import { iniciarUazapiMonitor } from './services/uazapiMonitor.js';
import { initializeWhatsApp } from './config/whatsapp.js';
import { installTotvsTracker } from './services/totvsAxiosInterceptor.js';

// Instala interceptor que rastreia chamadas TOTVS (antes de qualquer rota)
installTotvsTracker();

// ─── Safety net global ─────────────────────────────────────────────────
// Evita que erros não-tratados (ex: pg.Pool 'error', websocket reconnect,
// timer rejeitado) DERRUBEM o processo Node inteiro. Em produção, queremos
// log + continuar — não crashar e perder todas as requests em vôo.
process.on('uncaughtException', (err, origin) => {
  console.error(
    `🚨 [uncaughtException] ${origin}:`,
    err?.message || err,
    err?.stack?.split('\n').slice(0, 3).join('\n') || '',
  );
});
process.on('unhandledRejection', (reason, promise) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`🚨 [unhandledRejection]`, msg);
});


// ─── Rotas TOTVS (separadas por domínio) ────────────────────────────────────────────
import authRouter from './totvsrouter/auth.js';
import fiscalRouter from './totvsrouter/fiscal.js';
import clientesRouter from './totvsrouter/clientes.js';
import cadastroClienteRouter from './totvsrouter/cadastroCliente.js';
import filiaisRouter from './totvsrouter/filiais.js';
import financeiroRouter from './totvsrouter/financeiro.js';
import estoqueRouter from './totvsrouter/estoque.js';
import painelVendasRouter from './totvsrouter/painelVendas.js';
import voucherRouter from './totvsrouter/voucher.js';
import { iniciarJobFaturamentoDiario } from './jobs/faturamento-diario.job.js';
import { iniciarJobForecastRefYoy } from './jobs/forecast-ref-yoy.job.js';
import { iniciarJobForecastWhatsapp } from './jobs/forecast-whatsapp.job.js';
import { iniciarFaturamentoHistoricoJob } from './jobs/faturamento-historico.job.js';
import { iniciarTransacaoHistoricoSync } from './jobs/transacao-historico-sync.job.js';
import { iniciarPessoasBluecredSync } from './jobs/pessoas-bluecred-sync.job.js';
import { iniciarCanalTotalsCacheJob } from './jobs/canal-totals-cache.job.js';
import { iniciarForecastPerSellerCacheJob } from './jobs/forecast-per-seller-cache.job.js';
import { iniciarPainelVendasSyncJob } from './jobs/painel-vendas-sync.job.js';
import { iniciarCronWixSync } from './jobs/wix-sync.job.js';
import {
  iniciarJobPesPessoaSync,
  syncPesPessoaDelta,
  syncPesPessoaFull,
} from './jobs/pes-pessoa-sync.job.js';
import {
  iniciarJobConversaoTemplate,
  executarConversaoTemplate,
} from './jobs/template-conversao.job.js';

// =============================================================================
// SERVER SETUP
// =============================================================================

const app = express();
const PORT = process.env.PORT || 4100;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Montar rotas TOTVS (/api/totvs/*) ───────────────────────────────────────────────────────────────────
app.use('/api/totvs', authRouter); // GET /token, POST /auth
app.use('/api/totvs', fiscalRouter); // boleto, DANFE, XML, NFs, movimentos fiscais
app.use('/api/totvs', clientesRouter); // legal-entity, individual, clientes, sync
app.use('/api/totvs', cadastroClienteRouter); // cliente/individual-customer, cliente/legal-customer
app.use('/api/totvs', filiaisRouter); // branches, franchise, multibrand
app.use('/api/totvs', financeiroRouter); // accounts-receivable, accounts-payable
app.use('/api/totvs', estoqueRouter); // best-selling-products, product-balances
app.use('/api/totvs', painelVendasRouter); // sale-panel/*, seller-panel/*
app.use('/api/totvs', voucherRouter); // vouchers/usage-enriched

// ─── Demais rotas ───────────────────────────────────────────────────────────────────────────
app.use('/api/chat', chatRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/financial', financialRoutes); // batida-carteira upload
app.use('/api/financial', financialCredevRoutes); // credev/adiantamento por franquia (TOTVS)
app.use('/api/catalogo', catalogoRoutes); // catálogo virtual
app.use('/api/meta', metaRoutes); // WhatsApp Official (Meta Graph API)
app.use('/api/evolution', evolutionRoutes); // Evolution WhatsApp conversations
app.use('/api/autentique', autentiqueRoutes); // Autentique assinatura digital (termo-credito, CRUD documentos)
app.use('/api/crm', crmRoutes); // CRM: leads (ClickUp), inst-check-bulk, msgs, roubos, IA
app.use('/api/fila', filaRoutes); // Fila da Vez (varejo) — admin + público (PIN)
app.use('/api/forecast', forecastRoutes); // Forecast — Promessa Semanal por Canal
app.use('/api/bluecard', bluecardRoutes); // BlueCard — leads da LP /lp/bluecard
app.use('/api/wix', wixRoutes); // Wix — sync de pedidos do e-commerce
app.use('/api/expedicao-showroom', expedicaoShowroomRoutes); // Expedição Showroom — controle envios
app.use('/api/faturamento-historico', faturamentoHistoricoRoutes); // Faturamento histórico diário por canal
app.use('/api/faturamento-transacao', faturamentoTransacaoRoutes); // Faturamento histórico por NF (transação)
app.use('/api/tech', techRoutes); // Tecnologia — Controle de chips, etc
app.use('/api/monitoring', monitoringRoutes); // Monitoramento consumo TOTVS
app.use('/api/conciliacao-stone', conciliacaoStoneRoutes); // Conciliação Stone (cartões)
app.use('/api/uazapi-sync', uazapiSyncRoutes); // sync diário UAzapi → Postgres

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
});

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  initializeWhatsApp();
  try {
    const { startPesPessoaScheduler } =
      await import('./utils/syncPesPessoa.js');
    startPesPessoaScheduler();
  } catch (err) {
    console.error('❌ Falha ao iniciar scheduler pes_pessoa:', err.message);
  }
  iniciarJobFaturamentoDiario();
  iniciarJobForecastRefYoy();
  iniciarJobForecastWhatsapp();
  iniciarFaturamentoHistoricoJob();
  iniciarTransacaoHistoricoSync();
  iniciarPessoasBluecredSync();
  iniciarBluecardStatsSync();
  // Pré-instala o Chrome do Puppeteer em background (pra gerar PDF do termo
  // de crédito) — evita travar a 1ª requisição esperando o download.
  prewarmChrome().catch((e) =>
    console.error('[boot] prewarmChrome falhou:', e.message),
  );
  iniciarCanalTotalsCacheJob();
  iniciarForecastPerSellerCacheJob();
  iniciarPainelVendasSyncJob();
  iniciarCronWixSync();
  iniciarCronSyncLeadsCompras();
  iniciarCronUazapiSync();
  iniciarUazapiMonitor();
  iniciarJobPesPessoaSync();
  iniciarJobConversaoTemplate();

  // Retoma campanhas WhatsApp travadas após restart (reseta processing → pending)
  (async () => {
    try {
      const { default: supabase } = await import('./config/supabase.js');
      const { count } = await supabase
        .from('message_queue')
        .update({ status: 'pending' }, { count: 'exact' })
        .in('status', ['processing', 'retrying']);
      if (count > 0) {
        console.log(`🔄 [boot] ${count} mensagens travadas resetadas pra pending — worker vai retomar`);
        // Dispara worker pra cada campanha distinta com pendentes
        const { data: campanhas } = await supabase
          .from('message_queue')
          .select('campaign_id, account_id')
          .eq('status', 'pending')
          .limit(2000);
        const seen = new Set();
        for (const m of campanhas || []) {
          if (seen.has(m.campaign_id)) continue;
          seen.add(m.campaign_id);
          const { data: account } = await supabase
            .from('whatsapp_accounts').select('*').eq('id', m.account_id).single();
          if (!account) continue;
          const { processCampaignQueue } = await import('./routes/meta.routes.js').catch(() => ({}));
          if (processCampaignQueue) {
            processCampaignQueue(m.campaign_id, account).catch((e) =>
              console.warn(`[boot resume] campaign ${m.campaign_id}: ${e.message}`),
            );
          }
        }
        if (seen.size > 0) console.log(`🚀 [boot] retomando ${seen.size} campanhas`);
      }
    } catch (e) {
      console.warn(`[boot resume] erro: ${e.message}`);
    }
  })();
});

// Endpoint manual pra disparar conversão
app.post('/api/forecast/sync-template-conversao', async (req, res) => {
  executarConversaoTemplate().catch((e) =>
    console.error('[template-conversao] manual erro:', e.message),
  );
  res.json({ success: true, message: 'Conversão de templates disparada em background' });
});

// Endpoints manuais para disparar sync de pes_pessoa
app.post('/api/forecast/sync-pes-pessoa', async (req, res) => {
  const { mode = 'delta', hoursBack = 48 } = req.body || {};
  // Não aguarda — roda em background
  if (mode === 'full') {
    syncPesPessoaFull().catch((e) => console.error('[sync-pes-pessoa full] erro:', e.message));
  } else {
    syncPesPessoaDelta(Number(hoursBack) || 48).catch((e) =>
      console.error('[sync-pes-pessoa delta] erro:', e.message),
    );
  }
  res.json({ success: true, message: `Sync pes_pessoa ${mode} disparado em background`, mode, hoursBack });
});

export default app;
