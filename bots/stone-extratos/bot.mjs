// =============================================================================
// BOT STONE EXTRATOS — agente local (roda no PC do financeiro)
//
//   node bot.mjs            → agente: fica ligado, pinga o HeadCoach, pega as
//                             execuções enfileiradas pelo botão da tela e
//                             dispara sozinho no horário diário (config.json)
//   node bot.mjs --login    → abre o Chrome visível para você logar na Stone
//                             (usuário, senha, token). A sessão fica guardada.
//   node bot.mjs --agora    → roda uma execução agora (também cria o registro
//                             no HeadCoach, com log). Aceita --de=AAAA-MM-DD --ate=AAAA-MM-DD
//   node bot.mjs --mapear   → abre visível, logado, e grava em mapa/ o que o
//                             portal chama (API) e os botões/links da tela,
//                             para ajustar o roteiro de PDF no config.json
//
// Config: config.json (copie de config.example.json; token = STONE_BOT_TOKEN
// do Render). Nunca versione o config.json nem a pasta perfil-chrome/.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadCoach } from './headcoach.mjs';
import { Stone, helpers } from './stone.mjs';

const VERSAO = '1.0.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { brDe, dormir, soDigitos } = helpers;

// ─── config ──────────────────────────────────────────────────────────────────
function lerJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
const exemplo = lerJson(path.join(__dirname, 'config.example.json')) || {};
const local = lerJson(path.join(__dirname, 'config.json'));
if (!local) {
  console.error('config.json não encontrado. Copie config.example.json para config.json e cole o STONE_BOT_TOKEN.');
  process.exit(1);
}
const cfg = { ...exemplo, ...local, stone: { ...exemplo.stone, ...(local.stone || {}) }, pdf: { ...exemplo.pdf, ...(local.pdf || {}) } };
if (!cfg.token || /COLE_AQUI/.test(cfg.token)) {
  console.error('config.json: "token" vazio. Cole o STONE_BOT_TOKEN configurado no Render.');
  process.exit(1);
}

const dirs = {
  perfil: path.join(__dirname, 'perfil-chrome'),
  downloads: path.join(__dirname, 'downloads'),
  capturas: path.join(__dirname, 'capturas'),
};
const host = os.hostname();
const hc = new HeadCoach({ url: cfg.headcoachUrl, token: cfg.token, host });

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] || null;

const hojeIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const menosDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return hojeIso(d);
};
const hora = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });

// ─── log local + remoto ──────────────────────────────────────────────────────
function criarLogger(execId) {
  const fila = [];
  let enviando = false;
  const flush = async () => {
    if (enviando || !fila.length || !execId) return;
    enviando = true;
    const lote = fila.splice(0, fila.length);
    try {
      await hc.log(execId, lote);
    } catch (e) {
      console.error(`${hora()} [log remoto falhou] ${e.message}`);
    } finally {
      enviando = false;
    }
  };
  const log = (msg, nivel = 'info') => {
    const linha = { t: new Date().toISOString(), nivel, msg: String(msg) };
    const tag = { ok: '✅', erro: '❌', aviso: '⚠️ ', info: '  ' }[nivel] || '  ';
    console.log(`${hora()} ${tag} ${linha.msg}`);
    fila.push(linha);
    flush();
  };
  log.flush = async () => {
    for (let i = 0; i < 20 && (fila.length || enviando); i++) {
      await flush();
      await dormir(200);
    }
  };
  return log;
}

// ─── uma execução completa ───────────────────────────────────────────────────
async function executar(exec, { visivel = false } = {}) {
  const execId = exec.id;
  const log = criarLogger(execId);
  const de = exec.parametros?.de || menosDias(cfg.diasRetroativos ?? 3);
  const ate = exec.parametros?.ate || hojeIso();
  const resumo = { periodo: { de, ate }, contas: 0, pdfs: 0, viaApi: 0, importados: 0, falhas: 0, saldoTotal: null, saldos: [], avisos: [] };
  const stone = new Stone(cfg, dirs, log);
  let status = 'concluido';
  let erroGeral = null;

  log(`Execução #${execId} (${exec.origem}) iniciada em ${host} · período ${brDe(de)} a ${brDe(ate)} · bot v${VERSAO}`);
  try {
    await stone.abrir({ visivel });
    await stone.irParaInicio();
    if (!(await stone.sessaoOk())) {
      throw new Error('Sessão da Stone expirada: no PC do bot, rode login.bat, faça o login (usuário, senha e token) e deixe a janela fechar sozinha.');
    }
    log('Sessão OK (logado na Stone).', 'ok');

    await stone.garantirApi();
    const contas = await stone.listarContas();
    resumo.contas = contas.length;
    if (!contas.length) throw new Error('A API do portal não devolveu nenhuma conta.');
    log(`${contas.length} conta(s) Stone acessíveis: ${contas.map((c) => `${c.owner_name || '?'} (${c.account_code})`).join(' · ')}`);

    const saldos = [];
    let pdfLigado = cfg.pdf?.ativo !== false;
    for (const [i, c] of contas.entries()) {
      const rot = `[${i + 1}/${contas.length}] ${c.owner_name || ''} ${c.branch_code || ''}/${c.account_code}`;
      // saldo
      let saldo = null;
      try {
        saldo = await stone.saldo(c.id);
        const disp = saldo.balance / 100;
        saldos.push({ accountId: c.id, agencia: c.branch_code, conta: c.account_code, titular: c.owner_name, cnpj: soDigitos(c.owner_document), saldo: disp, bloqueado: saldo.blocked_balance == null ? null : saldo.blocked_balance / 100, agendado: saldo.scheduled_balance == null ? null : saldo.scheduled_balance / 100 });
        log(`${rot}: saldo R$ ${disp.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      } catch (e) {
        if (e.semPermissao) {
          // o usuário logado não enxerga essa conta no portal: não é falha do bot
          log(`${rot}: pulada — ${e.message}`, 'aviso');
          resumo.avisos.push(`${c.account_code} (${c.owner_name || ''}): sem permissão do usuário logado`);
          resumo.semPermissao = (resumo.semPermissao || 0) + 1;
          continue;
        }
        resumo.falhas += 1;
        log(`${rot}: saldo FALHOU — ${e.message}`, 'erro');
      }

      // extrato: PDF oficial pelo roteiro; se falhar, JSON da API
      let importado = false;
      if (pdfLigado) {
        try {
          const nome = `Stone_${soDigitos(c.account_code)}_${de}_${ate}.pdf`;
          const destino = path.join(dirs.downloads, nome);
          if ((cfg.pdf?.modo || 'api') === 'api') {
            // mesma chamada do botão "Baixar" do portal, sem clique nenhum
            const buf = await stone.exportarPdf(c.id, { de, ate });
            fs.writeFileSync(destino, buf);
          } else {
            // modo "roteiro": clica no portal seguindo config.json > pdf.passos
            const cnpj = soDigitos(c.owner_document);
            const cnpjFmt = cnpj.length === 14 ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : cnpj.length === 11 ? cnpj.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : cnpj;
            const vars = { de, ate, deBr: brDe(de), ateBr: brDe(ate), titular: c.owner_name || '', conta: c.account_code || '', agencia: c.branch_code || '', cnpj, cnpjFmt, contaId: c.id };
            if (contas.length > 1 && cfg.pdf?.trocarConta?.length) await stone.roteiro(cfg.pdf.trocarConta, vars, { rotulo: `${rot} trocar conta` });
            const baixado = await stone.roteiro(cfg.pdf.passos, vars, { rotulo: `${rot} PDF` });
            if (!baixado) throw new Error('roteiro terminou sem download (falta o passo esperarDownload?)');
            fs.renameSync(baixado, destino);
          }
          log(`${rot}: PDF gerado (${(fs.statSync(destino).size / 1024).toFixed(0)} KB) → enviando ao HeadCoach…`);
          const r = await hc.enviarPdf(execId, destino, { accountId: c.id, conta: c.account_code, agencia: c.branch_code, titular: c.owner_name, cnpj: soDigitos(c.owner_document), de, ate });
          if (r?.ok) {
            resumo.pdfs += 1;
            resumo.importados += 1;
            importado = true;
          } else {
            throw new Error(`HeadCoach não importou o PDF: ${r?.erro || 'motivo desconhecido'}`);
          }
        } catch (e) {
          if (e.semPermissao) {
            log(`${rot}: pulada — ${e.message}`, 'aviso');
            resumo.avisos.push(`${c.account_code} (${c.owner_name || ''}): sem permissão do usuário logado`);
            resumo.semPermissao = (resumo.semPermissao || 0) + 1;
            continue;
          }
          log(`${rot}: PDF não saiu (${e.message}) — vou mandar o extrato pela API.`, 'aviso');
          resumo.avisos.push(`${c.account_code}: PDF falhou — ${e.message}`);
          if (/não achei|download não terminou/.test(e.message)) {
            pdfLigado = false; // o roteiro de cliques não bate com o portal: não repete o erro nas outras contas
            log('Roteiro de PDF não bateu com o portal — as demais contas vão pela API nesta execução. Rode mapear.bat e ajuste config.json > pdf.passos.', 'aviso');
          }
        }
      }
      if (!importado) {
        try {
          const entradas = await stone.extrato(c.id, { de, ate });
          log(`${rot}: ${entradas.length} lançamento(s) pela API → enviando…`);
          const r = await hc.enviarExtratoJson(execId, { conta: c, entradas, saldo, periodo: { de, ate } });
          if (r?.ok) {
            resumo.viaApi += 1;
            resumo.importados += 1;
          } else {
            resumo.falhas += 1;
            log(`${rot}: importação via API FALHOU — ${r?.erro || '?'}`, 'erro');
          }
        } catch (e) {
          resumo.falhas += 1;
          log(`${rot}: extrato FALHOU — ${e.message}`, 'erro');
          await stone.capturar(`extrato-${c.account_code}`);
        }
      }
    }

    if (saldos.length) {
      const r = await hc.enviarSaldos(execId, saldos, hojeIso());
      resumo.saldoTotal = r?.total ?? saldos.reduce((a, s) => a + s.saldo, 0);
      resumo.saldos = saldos.map((s) => ({ conta: s.conta, titular: s.titular, saldo: s.saldo }));
    } else {
      log('Nenhum saldo capturado — Liberação de Pagamento NÃO foi atualizada.', 'erro');
      resumo.falhas += 1;
    }
    if (resumo.falhas) status = 'erro';
    log(`Fim: ${resumo.importados}/${resumo.contas} extrato(s) importado(s) (${resumo.pdfs} PDF, ${resumo.viaApi} via API), ${resumo.falhas} falha(s).`, resumo.falhas ? 'aviso' : 'ok');
  } catch (e) {
    status = 'erro';
    erroGeral = e.message;
    log(`ERRO: ${e.message}`, 'erro');
    await stone.capturar('erro-geral');
  } finally {
    await stone.fechar();
    await log.flush();
    try {
      await hc.finalizar(execId, { status, resumo, erro: erroGeral });
    } catch (e) {
      console.error(`${hora()} ❌ não consegui finalizar a execução no HeadCoach: ${e.message}`);
    }
  }
  return { status, resumo, erro: erroGeral };
}

// ─── modos ───────────────────────────────────────────────────────────────────
async function modoLogin() {
  const stone = new Stone(cfg, dirs, (m) => console.log(`${hora()}    ${m}`));
  await stone.abrir({ visivel: true });
  await stone.irParaInicio();
  if (await stone.sessaoOk()) {
    console.log('\n✅ Você já está logado na Stone. A sessão continua válida. Pode fechar.');
  } else {
    console.log('\n👉 Faça o login na janela do Chrome (usuário, senha e token). Esta janela fecha sozinha quando o login terminar.');
    const ok = await stone.esperarLoginManual({ timeoutMin: 15 });
    console.log(ok ? '\n✅ Login concluído! Sessão guardada em perfil-chrome/. Agora rode iniciar.bat (ou deixe o agente ligado).' : '\n❌ Tempo esgotado sem login. Rode login.bat de novo.');
    if (ok) await dormir(4000); // deixa o portal gravar os tokens
  }
  await stone.fechar();
}

async function modoMapear() {
  const stone = new Stone(cfg, dirs, (m) => console.log(`${hora()}    ${m}`));
  stone.mapear = true;
  await stone.abrir({ visivel: true });
  await stone.irParaInicio();
  if (!(await stone.sessaoOk())) {
    console.log('Sessão expirada — rode login.bat antes.');
    await stone.fechar();
    return;
  }
  const dir = path.join(__dirname, 'mapa');
  console.log('\nNavegue no portal (abra o Extrato, o Exportar, o seletor de contas…). A cada 15 s gravo um mapa em mapa/. Ctrl+C para sair.');
  for (;;) {
    try {
      await stone.garantirApi({ timeoutMs: 3000 }).catch(() => {});
      const arq = await stone.mapa(dir);
      console.log(`${hora()} mapa gravado: ${path.basename(arq)} (${stone.requisicoes.length} requisições vistas${stone.api ? `, API ${stone.api.base}` : ''})`);
    } catch (e) {
      console.log(`${hora()} mapa falhou: ${e.message}`);
    }
    await dormir(15000);
  }
}

async function modoAgora() {
  const de = opt('de');
  const ate = opt('ate');
  let exec;
  try {
    const r = await hc.criarExecucao({ origem: 'manual', de, ate });
    exec = r.execucao;
    if (r.reaproveitada) console.log(`Já havia a execução #${exec.id} ${exec.status} — vou rodar essa.`);
  } catch (e) {
    console.error(`Não consegui registrar a execução no HeadCoach: ${e.message}`);
    if (e.status === 404) console.error('→ O backend em produção ainda não tem a rota /api/stone-bot (falta fazer o deploy do apigestaocrosby).');
    if (e.status === 503) console.error('→ Falta a variável STONE_BOT_TOKEN no Render.');
    if (e.status === 401) console.error('→ O "token" do config.json não bate com o STONE_BOT_TOKEN do Render.');
    process.exitCode = 1;
    return;
  }
  // se já estava rodando em outro agente, não duplica
  if (exec.status === 'rodando') {
    console.log('Outro agente já está rodando essa execução. Acompanhe pela tela.');
    return;
  }
  const claim = await hc.proxima();
  if (!claim || claim.id !== exec.id) {
    console.log('A execução foi pega por outro agente. Acompanhe pela tela.');
    return;
  }
  const r = await executar(claim, { visivel: flag('visivel') });
  console.log(`\nResultado: ${r.status} — ${JSON.stringify(r.resumo)}`);
}

async function modoAgente() {
  console.log(`Bot Stone Extratos v${VERSAO} — agente em ${host} → ${cfg.headcoachUrl}`);
  console.log(`Horário diário: ${cfg.horarioDiario || '(desligado)'} · fila a cada ${cfg.intervaloFilaSeg || 15}s · Ctrl+C para parar\n`);
  let ultimoPing = 0;
  let ultimoAgendado = null; // AAAA-MM-DD do último disparo automático
  let sessaoOk = null;
  let ocupado = false;

  const dispararAgendado = async () => {
    if (!cfg.horarioDiario) return;
    const agora = new Date();
    const hh = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    const dia = hojeIso(agora);
    const semana = cfg.diasSemana || [0, 1, 2, 3, 4, 5, 6];
    if (hh !== cfg.horarioDiario || ultimoAgendado === dia || !semana.includes(agora.getDay())) return;
    ultimoAgendado = dia;
    try {
      const r = await hc.criarExecucao({ origem: 'agendado' });
      console.log(`${hora()} ⏰ execução diária #${r.execucao.id} enfileirada`);
    } catch (e) {
      console.error(`${hora()} ❌ não consegui enfileirar a execução diária: ${e.message}`);
    }
  };

  for (;;) {
    try {
      if (Date.now() - ultimoPing > 60000) {
        await hc.ping({ versao: VERSAO, sessaoOk, proximaAgendada: cfg.horarioDiario || null, detalhes: { pdfAtivo: cfg.pdf?.ativo !== false, diasRetroativos: cfg.diasRetroativos } });
        ultimoPing = Date.now();
      }
      await dispararAgendado();
      if (!ocupado) {
        const exec = await hc.proxima();
        if (exec) {
          ocupado = true;
          try {
            const r = await executar(exec);
            if (/Sessão da Stone expirada/.test(r.erro || '')) sessaoOk = false;
            else if (r.status === 'concluido' || r.resumo?.contas > 0) sessaoOk = true;
          } finally {
            ocupado = false;
          }
        }
      }
    } catch (e) {
      console.error(`${hora()} ❌ ${e.message}`);
    }
    await dormir((cfg.intervaloFilaSeg || 15) * 1000);
  }
}

// ─── main ────────────────────────────────────────────────────────────────────
process.on('unhandledRejection', (e) => console.error(`${hora()} ❌ unhandledRejection: ${e?.message || e}`));
if (flag('login')) await modoLogin();
else if (flag('mapear')) await modoMapear();
else if (flag('agora')) await modoAgora();
else await modoAgente();
