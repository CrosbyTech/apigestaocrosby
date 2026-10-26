// Cliente HTTP do agente → HeadCoach (/api/stone-bot/agente/*)
// Autentica com o header x-bot-token (STONE_BOT_TOKEN do Render).
import fs from 'node:fs';
import path from 'node:path';

export class HeadCoach {
  constructor({ url, token, host }) {
    this.base = String(url || '').replace(/\/+$/, '');
    this.token = token;
    this.host = host;
  }

  async req(metodo, rota, { json, form, timeoutMs = 120000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = { 'x-bot-token': this.token };
      let body;
      if (form) body = form;
      else if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
      }
      const r = await fetch(`${this.base}/api/stone-bot/agente${rota}`, { method: metodo, headers, body, signal: ctrl.signal });
      const texto = await r.text();
      let j = null;
      try {
        j = texto ? JSON.parse(texto) : null;
      } catch {
        j = null;
      }
      if (!r.ok || (j && j.success === false)) {
        const msg = j?.message || j?.error || `${r.status} ${r.statusText}`;
        const e = new Error(`HeadCoach ${metodo} ${rota}: ${msg}`);
        e.status = r.status;
        e.body = j;
        throw e;
      }
      return j?.data ?? j;
    } finally {
      clearTimeout(t);
    }
  }

  ping(info) {
    return this.req('POST', '/ping', { json: { host: this.host, ...info }, timeoutMs: 20000 });
  }

  proxima() {
    return this.req('GET', `/proxima?host=${encodeURIComponent(this.host)}`, { timeoutMs: 30000 });
  }

  criarExecucao({ origem = 'manual', de, ate } = {}) {
    return this.req('POST', '/execucoes', { json: { origem, host: this.host, de, ate }, timeoutMs: 30000 });
  }

  log(execId, linhas) {
    const lista = (Array.isArray(linhas) ? linhas : [linhas]).map((l) => (typeof l === 'string' ? { msg: l } : l));
    return this.req('POST', `/execucoes/${execId}/log`, { json: { linhas: lista }, timeoutMs: 30000 });
  }

  async enviarPdf(execId, caminho, meta = {}) {
    const form = new FormData();
    const buf = fs.readFileSync(caminho);
    form.append('arquivo', new Blob([buf], { type: 'application/pdf' }), path.basename(caminho));
    form.append('meta', JSON.stringify(meta));
    return this.req('POST', `/execucoes/${execId}/pdf`, { form, timeoutMs: 180000 });
  }

  enviarExtratoJson(execId, { conta, entradas, saldo, periodo }) {
    return this.req('POST', `/execucoes/${execId}/extrato-json`, { json: { conta, entradas, saldo, periodo }, timeoutMs: 180000 });
  }

  enviarSaldos(execId, saldos, data) {
    return this.req('POST', `/execucoes/${execId}/saldos`, { json: { saldos, data }, timeoutMs: 60000 });
  }

  finalizar(execId, { status, resumo, erro }) {
    return this.req('POST', `/execucoes/${execId}/finalizar`, { json: { status, resumo, erro }, timeoutMs: 30000 });
  }
}
