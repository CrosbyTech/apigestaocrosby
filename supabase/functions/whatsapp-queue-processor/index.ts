import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const META_GRAPH_VERSION = Deno.env.get('META_GRAPH_VERSION') || 'v22.0';
const DEFAULT_BATCH_SIZE = Number(Deno.env.get('WA_QUEUE_BATCH_SIZE') || '80');
const DEFAULT_RATE_LIMIT = Number(Deno.env.get('WA_META_RATE_LIMIT_PER_SECOND') || '80');
const DEFAULT_DAILY_TIER_LIMIT = Number(Deno.env.get('WA_DEFAULT_DAILY_TIER_LIMIT') || '1000');
const MAX_BACKOFF_SECONDS = Number(Deno.env.get('WA_MAX_BACKOFF_SECONDS') || '1800');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function getBackoffSeconds(attempt: number) {
  const candidate = Math.min(15 * Math.pow(2, Math.max(attempt - 1, 0)), MAX_BACKOFF_SECONDS);
  return candidate;
}

async function getDailySentCount(accountId: number) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('message_queue')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .gte('sent_at', since)
    .in('status', ['sent', 'delivered', 'read', 'replied']);

  if (error) throw error;
  return count || 0;
}

async function claimRows(workerId: string, batchSize: number) {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from('message_queue')
    .select('*, whatsapp_accounts(id, name, waba_id, phone_id, access_token)')
    .in('status', ['pending', 'retrying'])
    .lte('scheduled_at', nowIso)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .is('locked_at', null)
    .order('priority', { ascending: false })
    .order('scheduled_at', { ascending: true })
    .limit(batchSize);

  if (error) throw error;
  if (!rows?.length) return [];

  const claimed: any[] = [];
  for (const row of rows) {
    const { data, error: updateError } = await supabase
      .from('message_queue')
      .update({
        status: 'processing',
        locked_by: workerId,
        locked_at: nowIso,
        processing_started_at: nowIso,
      })
      .eq('id', row.id)
      .in('status', ['pending', 'retrying'])
      .is('locked_at', null)
      .select('*, whatsapp_accounts(id, name, waba_id, phone_id, access_token)')
      .single();

    if (!updateError && data) {
      claimed.push(data);
    }
  }

  return claimed;
}

async function pauseAccountQueue(accountId: number, reason: string) {
  await supabase
    .from('message_queue')
    .update({
      status: 'paused',
      last_error: reason,
      locked_at: null,
      locked_by: null,
    })
    .eq('account_id', accountId)
    .in('status', ['pending', 'retrying', 'processing']);
}

async function markFailure(row: any, reason: string, retryable: boolean) {
  const nextAttempt = (row.attempt_count || 0) + 1;
  const exceeded = nextAttempt >= (row.max_attempts || 6);
  const status = retryable && !exceeded ? 'retrying' : 'failed';
  const nextRetryAt = retryable && !exceeded
    ? new Date(Date.now() + getBackoffSeconds(nextAttempt) * 1000).toISOString()
    : null;

  const nextErrorLog = Array.isArray(row.error_log)
    ? [...row.error_log, { at: new Date().toISOString(), message: reason }]
    : [{ at: new Date().toISOString(), message: reason }];

  await supabase
    .from('message_queue')
    .update({
      status,
      attempt_count: nextAttempt,
      next_retry_at: nextRetryAt,
      last_error: reason,
      error_log: nextErrorLog,
      locked_at: null,
      locked_by: null,
    })
    .eq('id', row.id);
}

async function markSent(row: any, providerMessageId: string) {
  await supabase
    .from('message_queue')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      provider_message_id: providerMessageId,
      last_error: null,
      locked_at: null,
      locked_by: null,
    })
    .eq('id', row.id);
}

async function sendMetaTemplateMessage(row: any) {
  const account = row.whatsapp_accounts;
  if (!account?.phone_id || !account?.access_token) {
    throw new Error('Conta WhatsApp sem phone_id ou access_token');
  }

  const response = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${account.phone_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: row.phone_number,
        type: 'template',
        template: row.template_payload,
      }),
    },
  );

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = body?.error?.message || `Meta HTTP ${response.status}`;
    const error = new Error(message);
    (error as any).status = response.status;
    (error as any).body = body;
    throw error;
  }

  return body;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const workerId = crypto.randomUUID();
    const requestBody = await req.json().catch(() => ({}));
    const batchSize = Math.min(Number(requestBody.batchSize || DEFAULT_BATCH_SIZE), DEFAULT_BATCH_SIZE);
    const rateLimitPerSecond = Math.max(Number(requestBody.rateLimitPerSecond || DEFAULT_RATE_LIMIT), 1);
    const throttleMs = Math.ceil(1000 / rateLimitPerSecond);

    const rows = await claimRows(workerId, batchSize);
    if (!rows.length) {
      return json({ success: true, processed: 0, message: 'Fila vazia' });
    }

    const results = [];

    for (const row of rows) {
      const tierLimit = row.daily_tier_limit || DEFAULT_DAILY_TIER_LIMIT;
      const dailySentCount = await getDailySentCount(row.account_id);

      if (dailySentCount >= tierLimit) {
        const reason = `Tier diário atingido para account_id=${row.account_id}: ${dailySentCount}/${tierLimit}`;
        await pauseAccountQueue(row.account_id, reason);
        results.push({ id: row.id, status: 'paused', reason });
        continue;
      }

      try {
        const body = await sendMetaTemplateMessage(row);
        const providerMessageId = body?.messages?.[0]?.id || null;
        await markSent(row, providerMessageId);
        results.push({ id: row.id, status: 'sent', providerMessageId });
      } catch (error) {
        const status = (error as any)?.status;
        const retryable = status === 429 || (status >= 500 && status < 600);
        await markFailure(row, (error as Error).message, retryable);
        results.push({ id: row.id, status: retryable ? 'retrying' : 'failed', reason: (error as Error).message });
      }

      await sleep(throttleMs);
    }

    return json({ success: true, processed: rows.length, results });
  } catch (error) {
    return json({ success: false, error: (error as Error).message }, 500);
  }
});
