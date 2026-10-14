// ===========================================================================
// PDV Crosby — renderer (UI). Vanilla JS, sem build. Fala com o Node só via
// window.pdv.* (exposto pelo preload) para impressora / RFID / TEF.
// ===========================================================================

const $ = (s, el = document) => el.querySelector(s);
const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n) => n.toLocaleString('pt-BR');

// Shim: se abrir no navegador (pré-visualização) em vez do Electron, window.pdv
// não existe. Simulamos as mesmas respostas pra UI funcionar. Dentro do
// Electron o window.pdv REAL (preload.js) já está definido e este bloco é ignorado.
if (!window.pdv) {
  window.pdv = {
    plataforma: 'navegador (preview)', versaoElectron: '—',
    listarImpressoras: async () => ([
      { nome: 'Elgin i9 (térmica)', padrao: true }, { nome: 'Microsoft Print to PDF', padrao: false },
    ]),
    imprimirCupom: async () => ({ ok: true, motivo: null }),
    rfidConectar: async (cfg) => ({ ok: !!(cfg && cfg.host), mensagem: cfg && cfg.host ? `Conectado ao portal ${cfg.modelo||'RFID'} em ${cfg.host}:${cfg.porta}` : 'Informe o host', leituras: ['E200470012AF93', 'E200470198BC21'] }),
    tefConectar: async (cfg) => ({ ok: true, provedor: (cfg&&cfg.provedor)||'Stone', mensagem: `Pinpad ${(cfg&&cfg.provedor)||'Stone'} pronto (preview)` }),
    tefPagar: async ({ valor }) => ({ aprovado: true, nsu: '000123456', autorizacao: '654321', bandeira: 'VISA', valor }),
    lerConfig: async () => null,
    salvarConfig: async () => ({ ok: true }),
  };
}

// estado dos periféricos (só pra UI)
const perif = { impressora: '', rfid: false, tef: false };

// ----------------------------------------------------------------- LOGIN ----
$('#toggle-pass').addEventListener('click', () => {
  const inp = $('#login-pass');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('#form-login').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  if (!email) {
    $('#login-err').textContent = 'Informe o email.';
    $('#login-err').classList.remove('hidden');
    return;
  }
  const btn = $('#btn-login');
  btn.disabled = true;
  btn.textContent = 'Entrando...';
  // simula autenticação (no app real: POST /auth na API apigestaocrosby)
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Entrar';
    entrarNoApp();
  }, 650);
});

function entrarNoApp() {
  $('#tela-login').classList.add('hidden');
  $('#tela-app').classList.remove('hidden');
  $('#topbar-user').textContent = MOCK.usuario.nome;
  $('#topbar-avatar').textContent = MOCK.usuario.inicial;
  carregarConfig();
  navegar('home');
}

$('#btn-logout').addEventListener('click', () => {
  $('#tela-app').classList.add('hidden');
  $('#tela-login').classList.remove('hidden');
});

// --------------------------------------------------------------- ROTEADOR ---
const TITULOS = {
  home: 'Home',
  devolucao: 'Devolução de Mercadoria',
  ranking: 'PDV Varejo · Ranking de Faturamento',
  forecast: 'New Forecast',
  perifericos: 'Periféricos & TEF',
};
const RENDER = {
  home: renderHome,
  devolucao: renderDevolucao,
  ranking: renderRanking,
  forecast: renderForecast,
  perifericos: renderPerifericos,
};

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => navegar(btn.dataset.rota));
});

function navegar(rota) {
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.rota === rota),
  );
  $('#topbar-title').textContent = TITULOS[rota];
  $('#content').innerHTML = '';
  RENDER[rota]();
}

// ------------------------------------------------------------------ HOME ----
function renderHome() {
  const r = MOCK.ranking;
  const fatTotal = r.reduce((a, x) => a + x.fat, 0);
  const metaTotal = r.reduce((a, x) => a + x.meta, 0);
  const pecas = r.reduce((a, x) => a + x.pecas, 0);
  const devAbertas = MOCK.devolucoes.filter((d) => d.situacao === 'Aberta' || d.situacao === 'Aguardando').length;

  $('#content').innerHTML = `
    <div class="card home-hero">
      <div>
        <h1>Bem-vindo, ${MOCK.usuario.nome.split(' ')[0]}!</h1>
        <p>Você está no <b>PDV Crosby</b> · ${MOCK.usuario.loja} · HEADCOACH CROSBY</p>
      </div>
      <img src="assets/crosby-branca.png" alt="Crosby" />
    </div>

    <div class="kpi-grid">
      <div class="card kpi"><div class="label">Faturamento do mês</div><div class="value">${brl(fatTotal)}</div><div class="delta up">▲ ${((fatTotal/metaTotal-1)*100).toFixed(1)}% vs meta</div></div>
      <div class="card kpi"><div class="label">Peças vendidas</div><div class="value">${num(pecas)}</div><div class="delta up">▲ 8,3% vs mês anterior</div></div>
      <div class="card kpi"><div class="label">Ticket médio</div><div class="value">${brl(fatTotal/pecas)}</div><div class="delta up">▲ 2,1%</div></div>
      <div class="card kpi"><div class="label">Devoluções abertas</div><div class="value">${devAbertas}</div><div class="delta down">precisam de ação</div></div>
    </div>

    <div class="tiles">
      ${tile('↩','Devolução de Mercadoria','Abrir, conferir e gerar transação no TOTVS','devolucao')}
      ${tile('▦','Ranking de Faturamento','Desempenho das lojas no mês','ranking')}
      ${tile('📈','New Forecast','Previsão x realizado e projeção','forecast')}
      ${tile('⚙','Periféricos & TEF','Impressora, portal RFID e pinpad','perifericos')}
      ${tile('🧾','Nova venda (PDV)','Vender e cobrar no pinpad','perifericos')}
      ${tile('🏷️','Leitura RFID','Conferência por etiqueta','perifericos')}
    </div>`;

  document.querySelectorAll('.tile').forEach((t) =>
    t.addEventListener('click', () => navegar(t.dataset.rota)),
  );
}
function tile(ico, titulo, desc, rota) {
  return `<div class="card tile" data-rota="${rota}"><div class="tico">${ico}</div><div><h3>${titulo}</h3><p>${desc}</p></div></div>`;
}

// ------------------------------------------------------- DEVOLUÇÃO -----------
function renderDevolucao() {
  const d = MOCK.devolucoes;
  const det = MOCK.devolucaoDetalhe;
  const sitBadge = (s) => {
    const map = { 'Aberta': 'blue', 'Em análise': 'amber', 'Aguardando': 'amber', 'Concluída': 'green' };
    return `<span class="badge ${map[s] || 'gray'}">${s}</span>`;
  };
  $('#content').innerHTML = `
    <div class="page-head"><h1>Devolução de Mercadoria</h1><p>Aberturas do varejo · conferência de peças e geração da transação no TOTVS</p></div>

    <div class="toolbar">
      <input class="input" placeholder="Buscar cliente / Nº..." style="min-width:240px" />
      <select class="select"><option>Todas as situações</option><option>Aberta</option><option>Em análise</option><option>Concluída</option></select>
      <button class="btn cyan" id="btn-rfid-dev">🏷️ Conferir por RFID</button>
      <button class="btn solid">+ Nova devolução</button>
    </div>

    <div class="card" style="overflow:hidden">
      <table>
        <thead><tr>
          <th>Nº</th><th>Aberta em</th><th>Cliente</th><th>Vendedor</th><th>Tipo</th>
          <th class="num">Peças</th><th class="num">Fotos</th><th>Chamado</th><th>Situação</th><th>Transação</th>
        </tr></thead>
        <tbody>
          ${d.map((x) => `<tr>
            <td><b>#${x.n}</b></td><td>${x.aberta}</td><td>${x.cliente}</td><td>${x.vendedor}</td>
            <td><span class="badge gray">${x.tipo}</span></td>
            <td class="num">${x.pecas}</td><td class="num">${x.fotos}</td>
            <td>${x.chamado}</td><td>${sitBadge(x.situacao)}</td><td>${x.transacao}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="section-title">Conferência — Devolução #1046</div>
    <div class="card" style="padding:20px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;font-size:14px;margin-bottom:16px">
        <div><span style="color:var(--muted)">Gerada em:</span> ${det.geradaEm}</div>
        <div><span style="color:var(--muted)">Empresa:</span> ${det.empresa}</div>
        <div><span style="color:var(--muted)">Cliente:</span> ${det.cliente}</div>
        <div><span style="color:var(--muted)">Transação TOTVS:</span> <b>${det.transacaoTotvs}</b></div>
        <div style="grid-column:1/-1"><span style="color:var(--muted)">Nota do cliente:</span> ${det.notaCliente}</div>
      </div>
      <table>
        <thead><tr><th>Produto</th><th class="num">Recebidas</th><th class="num">Faltando</th><th class="num">Sobrando</th><th>TOTVS</th></tr></thead>
        <tbody>
          ${det.itens.map((i) => `<tr>
            <td>${i.produto}</td><td class="num">${i.recebidas}</td>
            <td class="num">${i.faltando}</td><td class="num">${i.sobrando}</td>
            <td><span class="badge green">${i.totvs}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  $('#btn-rfid-dev').addEventListener('click', async () => {
    const r = await window.pdv.rfidConectar(cfgAtual.rfid);
    alert(r.ok
      ? `✅ ${r.mensagem}\n\nEtiquetas lidas:\n${r.leituras.join('\n')}`
      : `⚠️ ${r.mensagem}`);
  });
}

// --------------------------------------------------------- RANKING ----------
function renderRanking() {
  const r = [...MOCK.ranking].sort((a, b) => b.fat - a.fat);
  const max = r[0].fat;
  $('#content').innerHTML = `
    <div class="page-head"><h1>PDV Varejo · Ranking de Faturamento</h1><p>${MOCK.forecast.mes} · faturamento por loja</p></div>
    <div class="toolbar">
      <select class="select"><option>Todas as UFs</option><option>RN</option><option>PE</option></select>
      <select class="select"><option>Mês corrente</option><option>Mês anterior</option></select>
      <div style="flex:1"></div>
      <button class="btn">↧ Exportar</button>
    </div>
    <div class="card" style="overflow:hidden">
      <table>
        <thead><tr>
          <th style="width:60px">#</th><th>Loja</th><th>UF</th>
          <th class="num">Faturamento</th><th class="num">Meta</th><th style="width:200px">Atingimento</th>
          <th class="num">Peças</th><th class="num">Ticket médio</th>
        </tr></thead>
        <tbody>
          ${r.map((x, i) => {
            const ating = (x.fat / x.meta) * 100;
            const g = i === 0 ? 'g1' : i === 1 ? 'g2' : i === 2 ? 'g3' : 'g0';
            return `<tr>
              <td><div class="rank-pos ${g}">${i + 1}</div></td>
              <td><b>${x.loja}</b></td>
              <td><span class="badge gray">${x.uf}</span></td>
              <td class="num"><b>${brl(x.fat)}</b></td>
              <td class="num" style="color:var(--muted)">${brl(x.meta)}</td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="bar" style="flex:1"><span style="width:${Math.min(100, (x.fat / max) * 100)}%"></span></div>
                  <span style="font-size:12.5px;font-weight:700;color:${ating >= 100 ? 'var(--green)' : 'var(--amber)'}">${ating.toFixed(0)}%</span>
                </div>
              </td>
              <td class="num">${num(x.pecas)}</td>
              <td class="num">${brl(x.ticket)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// -------------------------------------------------------- NEW FORECAST ------
function renderForecast() {
  const f = MOCK.forecast;
  const totPrev = f.linhas.reduce((a, x) => a + x.previsto, 0);
  const totReal = f.linhas.reduce((a, x) => a + x.realizado, 0);
  const totProj = f.linhas.reduce((a, x) => a + x.projecao, 0);
  $('#content').innerHTML = `
    <div class="page-head"><h1>New Forecast</h1><p>${f.mes} · previsto x realizado e projeção de fechamento</p></div>

    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="card kpi"><div class="label">Previsto (mês)</div><div class="value">${brl(totPrev)}</div></div>
      <div class="card kpi"><div class="label">Realizado até agora</div><div class="value">${brl(totReal)}</div><div class="delta ${totReal>=totPrev*0.5?'up':'down'}">${((totReal/totPrev)*100).toFixed(1)}% da previsão</div></div>
      <div class="card kpi"><div class="label">Projeção de fechamento</div><div class="value">${brl(totProj)}</div><div class="delta ${totProj>=totPrev?'up':'down'}">${totProj>=totPrev?'▲ acima':'▼ abaixo'} do previsto</div></div>
    </div>

    <div class="section-title">Por filial</div>
    <div class="card" style="overflow:hidden;margin-bottom:22px">
      <table>
        <thead><tr><th>Filial</th><th class="num">Previsto</th><th class="num">Realizado</th><th style="width:200px">Progresso</th><th class="num">Projeção</th><th>Status</th></tr></thead>
        <tbody>
          ${f.linhas.map((x) => {
            const pct = (x.realizado / x.previsto) * 100;
            const ok = x.projecao >= x.previsto;
            return `<tr>
              <td><b>${x.filial}</b></td>
              <td class="num" style="color:var(--muted)">${brl(x.previsto)}</td>
              <td class="num"><b>${brl(x.realizado)}</b></td>
              <td><div class="bar"><span style="width:${Math.min(100, pct)}%"></span></div></td>
              <td class="num">${brl(x.projecao)}</td>
              <td><span class="badge ${ok ? 'green' : 'amber'}">${ok ? 'No ritmo' : 'Atenção'}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="section-title">Participação por canal</div>
    <div class="card" style="padding:20px">
      ${f.canais.map((c) => `
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
          <div style="width:140px;font-size:14px">${c.canal}</div>
          <div class="bar" style="flex:1"><span style="width:${c.part}%"></span></div>
          <div style="width:52px;text-align:right;font-weight:700;color:var(--navy)">${c.part}%</div>
          <div style="width:120px;text-align:right;color:var(--muted);font-size:13px">${brl(c.valor)}</div>
        </div>`).join('')}
    </div>`;
}

// ----------------------------------------------------- PERIFÉRICOS & TEF ----
let cfgAtual = { impressora: '', rfid: { host: '192.168.99.202', porta: 8888, modelo: 'Chainway UR4' }, tef: { provedor: 'Stone', serie: '' } };

async function carregarConfig() {
  try {
    const c = await window.pdv.lerConfig();
    if (c) cfgAtual = { ...cfgAtual, ...c, rfid: { ...cfgAtual.rfid, ...c.rfid }, tef: { ...cfgAtual.tef, ...c.tef } };
    perif.impressora = cfgAtual.impressora || '';
    $('#d-imp').className = 'dot ' + (perif.impressora ? 'on' : 'off');
  } catch {}
}

function renderPerifericos() {
  $('#content').innerHTML = `
    <div class="page-head"><h1>Periféricos & TEF</h1><p>Configuração local desta máquina — <b>isto não existe no navegador</b>. Roda no processo Node do Electron.</p></div>
    <div class="cfg-grid">

      <div class="card cfg">
        <h3>🖨️ Impressora</h3>
        <span class="field-label">Impressora de cupom (detectadas no Windows)</span>
        <select class="select" id="sel-impressora" style="width:100%"><option>Carregando...</option></select>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn" id="btn-rec-imp">↻ Detectar</button>
          <button class="btn cyan" id="btn-teste-imp">Imprimir cupom teste</button>
        </div>
        <div class="status-line" id="st-imp">Nenhuma impressora selecionada</div>
      </div>

      <div class="card cfg">
        <h3>🏷️ Portal RFID</h3>
        <span class="field-label">Modelo</span>
        <input class="input" id="rfid-modelo" style="width:100%" value="${cfgAtual.rfid.modelo}" />
        <span class="field-label">Host / IP</span>
        <input class="input" id="rfid-host" style="width:100%" value="${cfgAtual.rfid.host}" />
        <span class="field-label">Porta</span>
        <input class="input" id="rfid-porta" style="width:100%" value="${cfgAtual.rfid.porta}" />
        <div style="margin-top:12px"><button class="btn cyan" id="btn-rfid">Conectar & testar leitura</button></div>
        <div class="status-line" id="st-rfid">Desconectado</div>
      </div>

      <div class="card cfg">
        <h3>💳 TEF / Pinpad</h3>
        <span class="field-label">Provedor</span>
        <select class="select" id="tef-prov" style="width:100%">
          <option${cfgAtual.tef.provedor==='Stone'?' selected':''}>Stone</option>
          <option${cfgAtual.tef.provedor==='SiTef'?' selected':''}>SiTef (Software Express)</option>
          <option${cfgAtual.tef.provedor==='Cielo'?' selected':''}>Cielo</option>
        </select>
        <span class="field-label">Série do pinpad</span>
        <input class="input" id="tef-serie" style="width:100%" value="${cfgAtual.tef.serie}" placeholder="opcional" />
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn cyan" id="btn-tef">Conectar</button>
          <button class="btn solid" id="btn-pagar">Cobrar R$ 150,00</button>
        </div>
        <div class="status-line" id="st-tef">Desconectado</div>
      </div>
    </div>

    <div class="foot-note">
      Plataforma: <b>${window.pdv?.plataforma || '—'}</b> · Electron <b>${window.pdv?.versaoElectron || '—'}</b>.
      A configuração fica salva nesta máquina (cada caixa tem a sua).
    </div>`;

  // ---- impressoras (REAL) ----
  const carregarImpressoras = async () => {
    const sel = $('#sel-impressora');
    const lista = await window.pdv.listarImpressoras();
    if (!lista.length) { sel.innerHTML = '<option value="">Nenhuma impressora encontrada</option>'; return; }
    sel.innerHTML = lista.map((p) =>
      `<option value="${p.nome}"${(p.nome === cfgAtual.impressora || (!cfgAtual.impressora && p.padrao)) ? ' selected' : ''}>${p.nome}${p.padrao ? ' (padrão)' : ''}</option>`,
    ).join('');
    atualizarImpressora(sel.value);
  };
  const atualizarImpressora = (nome) => {
    cfgAtual.impressora = nome;
    perif.impressora = nome;
    $('#d-imp').className = 'dot ' + (nome ? 'on' : 'off');
    $('#st-imp').textContent = nome ? `Selecionada: ${nome}` : 'Nenhuma impressora selecionada';
    $('#st-imp').classList.toggle('ok', !!nome);
    window.pdv.salvarConfig(cfgAtual);
  };
  carregarImpressoras();
  $('#btn-rec-imp').addEventListener('click', carregarImpressoras);
  $('#sel-impressora').addEventListener('change', (e) => atualizarImpressora(e.target.value));
  $('#btn-teste-imp').addEventListener('click', () => abrirModalCupom());

  // ---- RFID (simulado no protótipo) ----
  $('#btn-rfid').addEventListener('click', async () => {
    cfgAtual.rfid = { modelo: $('#rfid-modelo').value, host: $('#rfid-host').value, porta: Number($('#rfid-porta').value) };
    $('#st-rfid').textContent = 'Conectando...';
    const r = await window.pdv.rfidConectar(cfgAtual.rfid);
    perif.rfid = r.ok;
    $('#d-rfid').className = 'dot ' + (r.ok ? 'on' : 'off');
    $('#st-rfid').classList.toggle('ok', r.ok);
    $('#st-rfid').innerHTML = r.ok ? `${r.mensagem}<br>Leu: ${r.leituras.join(', ')}` : r.mensagem;
    window.pdv.salvarConfig(cfgAtual);
  });

  // ---- TEF (simulado no protótipo) ----
  $('#btn-tef').addEventListener('click', async () => {
    cfgAtual.tef = { provedor: $('#tef-prov').value, serie: $('#tef-serie').value };
    $('#st-tef').textContent = 'Conectando ao pinpad...';
    const r = await window.pdv.tefConectar(cfgAtual.tef);
    perif.tef = r.ok;
    $('#d-tef').className = 'dot ' + (r.ok ? 'on' : 'off');
    $('#st-tef').classList.toggle('ok', r.ok);
    $('#st-tef').textContent = r.mensagem;
    window.pdv.salvarConfig(cfgAtual);
  });
  $('#btn-pagar').addEventListener('click', async () => {
    if (!perif.tef) { $('#st-tef').textContent = 'Conecte o pinpad primeiro.'; return; }
    $('#st-tef').textContent = 'Aguardando cartão no pinpad...';
    const r = await window.pdv.tefPagar({ valor: 150.0 });
    $('#st-tef').classList.add('ok');
    $('#st-tef').innerHTML = `✅ APROVADO · ${r.bandeira}<br>NSU ${r.nsu} · Aut. ${r.autorizacao}`;
    abrirModalCupom(r);
  });
}

// ----------------------------------------------------- CUPOM (impressão) ----
function abrirModalCupom(tef) {
  const linhas = [
    '        CROSBY — MIDWAY MALL',
    '   CNPJ 00.000.000/0012-00  RN',
    '--------------------------------',
    ' 1x Camiseta Crosby Logo   79,90',
    ' 1x Bermuda Moletom M      70,10',
    '--------------------------------',
    ' TOTAL              R$    150,00',
    tef ? ` ${tef.bandeira}  NSU ${tef.nsu}` : ' PAGAMENTO: pinpad',
    tef ? ` AUT ${tef.autorizacao}` : '',
    '--------------------------------',
    '   Obrigado! Volte sempre :)',
  ].filter(Boolean);
  const cupomTxt = linhas.join('\n');
  const html = `<html><body style="font-family:monospace;font-size:12px;white-space:pre">${cupomTxt}</body></html>`;

  $('#modal-root').innerHTML = `
    <div class="modal-overlay" id="ov">
      <div class="modal">
        <h3>Cupom — impressão local</h3>
        <div class="cupom">${cupomTxt}</div>
        <div class="modal-actions">
          <button class="btn" id="m-cancel">Fechar</button>
          <button class="btn solid" id="m-print">🖨️ Imprimir${perif.impressora ? ' em ' + perif.impressora.slice(0, 18) : ''}</button>
        </div>
      </div>
    </div>`;
  $('#m-cancel').addEventListener('click', () => ($('#modal-root').innerHTML = ''));
  $('#ov').addEventListener('click', (e) => { if (e.target.id === 'ov') $('#modal-root').innerHTML = ''; });
  $('#m-print').addEventListener('click', async () => {
    const r = await window.pdv.imprimirCupom({ impressora: perif.impressora, html });
    const btn = $('#m-print');
    btn.textContent = r.ok ? '✅ Enviado à impressora' : '⚠️ ' + (r.motivo || 'Falha/cancelado');
    setTimeout(() => ($('#modal-root').innerHTML = ''), 1400);
  });
}
