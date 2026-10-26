# Bot Stone Extratos (agente local)

Baixa todo dia (e quando alguém aperta o botão no HeadCoach) os extratos das
contas Stone, importa no **Extrato Bancário** (`/fluxo-caixa-ext`) e sobe o
saldo do dia na **Liberação de Pagamento** (`saldo_bancario`, banco `STONE`).

Roda no PC do financeiro, não no servidor: a Stone exige login com token /
reCAPTCHA / biometria, então o bot **nunca digita senha** — você loga uma vez
na janela do Chrome dele e a sessão fica guardada em `perfil-chrome/`.

## Instalação (PC do financeiro)

1. Instale o Node.js LTS: https://nodejs.org
2. Copie a pasta `bots/stone-extratos` para o PC (ex.: `C:\CrosbyBotStone`)
3. Rode `instalar.bat` → cria `config.json`, baixa o Chrome do puppeteer e
   coloca o agente para iniciar com o Windows
4. Abra `config.json` e cole no campo `token` o `STONE_BOT_TOKEN` do Render
   (Settings → Environment do apigestaocrosby). O `headcoachUrl` já aponta
   para a produção.
5. Rode `login.bat`, faça o login na Stone na janela que abre (usuário, senha
   e token). Ela fecha sozinha quando terminar.
6. Rode `iniciar.bat` (ou reinicie o PC). Pronto: o agente aparece **Online**
   em Financeiro → Extrato Bancário → aba **Bot Stone**.

## Uso

| Ação | Como |
| --- | --- |
| Baixar agora | HeadCoach → Extrato Bancário → aba Bot Stone → **Baixar extratos agora** (opcionalmente com período). O log aparece ali em tempo real. |
| Todo dia de manhã | `config.json` → `horarioDiario` (padrão `07:30`), `diasSemana` (0 = domingo). O agente precisa estar ligado. |
| Quantos dias para trás | `diasRetroativos` (padrão 3). Reimportar o mesmo período substitui os lançamentos — não duplica. |
| Testar com o Chrome visível | `agora.bat` (aceita `--de=2026-10-01 --ate=2026-10-10`) |
| Sessão da Stone expirou | A aba Bot Stone mostra “sessão expirada” e o log pede: rode `login.bat` de novo. |
| Portal mudou e o PDF parou | `mapear.bat` grava em `mapa/` os botões/links e as chamadas de API que o portal faz; ajuste `config.json → pdf.passos` (ver abaixo). |

## O que o bot faz em cada execução

1. Abre o Chrome com a sessão guardada e confere se está logado.
2. Captura o `Authorization` que o próprio portal manda para a API
   (`api.openbank.stone.com.br/api/v1/...`) e, por ela, lista **todas as contas**
   acessíveis, o **saldo** de cada uma e os **lançamentos** do período.
3. Para cada conta tenta exportar o **PDF oficial** seguindo `pdf.passos`
   (roteiro de cliques por texto). Conseguiu → envia o PDF ao HeadCoach, que
   importa pelo parser do PDF e guarda o arquivo no Storage (aba Importações,
   ícone de PDF). Não conseguiu → envia os lançamentos em JSON (a importação
   fica marcada `bot·API`) e segue.
4. Envia os saldos: histórico por conta (`stone_bot_saldos`) + soma em
   `saldo_bancario.STONE` (Liberação de Pagamento).
5. Fecha o Chrome e finaliza a execução com o resumo (contas, PDFs, falhas).

Capturas de tela de erros ficam em `capturas/`; PDFs baixados em `downloads/`.

## Roteiro de PDF (`config.json → pdf`)

Lista de passos executados por conta. Placeholders: `{de}`, `{ate}` (ISO),
`{deBr}`, `{ateBr}` (dd/mm/aaaa), `{titular}`, `{conta}`, `{agencia}`, `{cnpj}`.

| Ação | Campos | O que faz |
| --- | --- | --- |
| `ir` | `url` | navega |
| `clicar` | `texto: [...]`, `exato?`, `opcional?` | clica no primeiro botão/link/menu cujo texto bate com algum da lista |
| `preencher` | `rotulo: [...]`, `valor` | preenche o input pelo placeholder / aria-label / label |
| `seletor` | `seletor` | clica num seletor CSS |
| `esperar` | `ms` | pausa |
| `esperarDownload` | — | espera o download terminar (`timeoutDownloadSeg`) |

`trocarConta` roda antes de `passos` quando há mais de uma conta. Passo com
`opcional: true` não interrompe quando falha. O roteiro que vem no
`config.example.json` é um palpite inicial: na primeira vez, rode `mapear.bat`,
abra o Extrato → Exportar no portal e ajuste os textos pelo que aparecer em
`mapa/*.json`. Enquanto o roteiro não bate, os extratos chegam pela API
(`pdf.ativo: false` desliga a tentativa de PDF de vez).

## Segurança

- O bot só lê (contas, saldo, extrato, exportação). Não há código de
  transferência/pagamento.
- `config.json` (token) e `perfil-chrome/` (sessão) estão no `.gitignore` —
  não versione e não copie para outro PC.
- O token do agente (`STONE_BOT_TOKEN`) só autoriza as rotas
  `/api/stone-bot/agente/*`.
