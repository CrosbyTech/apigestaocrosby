# PDV Crosby — app de desktop (Electron)

PDV instalável no Windows que roda **o HeadCoach real** (o frontend React de
`gestaocrosby`) dentro do Electron, abrindo na `/home` — que, dentro do app,
mostra os atalhos do caixa (PDV Crosby, Devoluções, Configurações dos
Aparelhos, Ranking, New Forecast). A página **Configurações dos Aparelhos**
(`/tecnologia/pdv-perifericos`, `src/pages/PDVPerifericos.jsx` no frontend)
configura impressora, RFID .bat, RFID portal e TEF da máquina via `window.pdv`.
Não é uma cópia da tela: é o mesmo build do site, servido por um servidor HTTP
interno em `127.0.0.1:47321`. O que o Electron acrescenta é o que o navegador
não dá: porta serial do leitor RFID, popup de impressão livre, impressoras
locais e configuração da máquina.

## Como funciona
```
web/        -> build do HeadCoach (vite build de ../../gestaocrosby). GERADO, não versionado.
main.js     -> sobe o servidor de web/ (SPA fallback), abre a janela em /home,
               escolhe a porta serial do RFID, libera o popup de impressão, IPC de periféricos
updater.js  -> atualização automática (electron-updater): lê latest.yml ao abrir, baixa, pergunta e instala
preload.js  -> expõe window.pdv.* (impressoras, config local, atualização, stubs de TEF/UR4)
scripts/release.mjs -> npm run release: build + upload do Setup/.blockmap/latest.yml p/ o Supabase Storage
renderer/   -> protótipo estático antigo; só carrega se web/ não existir
build/      -> ícone (icon.ico / icon.png); scripts/make-icon.mjs gera a partir da logo
scripts/build-web.mjs -> roda o vite build do frontend com a API de produção fixada
```

- **Sessão**: o Supabase guarda o login no `localStorage` da origem
  `http://127.0.0.1:47321`. A porta é fixa de propósito — se mudasse, o caixa
  teria que logar de novo. Primeiro uso: cai no login e vai para `/home` com os
  atalhos; nas próximas aberturas já entra logado.
- **Atualizar versão**: o app se atualiza sozinho (`electron-updater`; ver a
  seção *Atualizar versão* abaixo). Instalar o Setup por cima também funciona
  (NSIS atualiza no lugar e preserva login/config em `%APPDATA%`).
- **API**: `scripts/build-web.mjs` força `VITE_API_BASE_URL` para
  `https://apigestaocrosby-bw2v.onrender.com`. Sem isso o `.env.local` do
  frontend embutiria `localhost:4100` e o app instalado nasceria sem backend.
  Outro backend: `PDV_API_URL=https://... npm run build:web`.
- **Leitor RFID (Web Serial)**: o hook `useRfidReader` chama
  `navigator.serial.requestPort()`. No Chrome abre um seletor; no Electron quem
  escolhe é o `main.js` (`select-serial-port`): a última porta que funcionou
  (salva em `pdv-config.json`), senão a primeira com chip CP210x (o do leitor
  .bat R9816), senão a primeira porta. Sem porta nenhuma, o hook trata como
  "cancelou".
- **Impressão**: o PDV abre `window.open('')` e depois escreve o cupom NFC-e ou
  navega para o PDF do DANFE. O `setWindowOpenHandler` deixa isso virar uma
  janela filha; só links `http(s)` externos vão para o navegador do sistema.
- **Periféricos via IPC** (`window.pdv.*`): listar impressoras e imprimir
  silencioso são REAIS; portal UR4 (rede) e TEF/pinpad seguem **simulados** até
  definirmos SDK (Stone/SiTef via `koffi` ou socket local).

## Rodar em desenvolvimento
```bash
cd pdv-electron
npm install
npm run build:web   # precisa do repo gestaocrosby em ../../gestaocrosby (ou HEADCOACH_DIR=...)
npm start
```
Com o Vite dev do frontend rodando (`npm run dev` em gestaocrosby, porta 3000),
`npm run dev` aqui abre o Electron apontando para ele, com hot reload.

## Gerar o instalador .exe
```bash
cd pdv-electron
npm run icon    # só na primeira vez / se a logo mudar
npm run dist    # = build:web + electron-builder --win nsis
```
Saída: `dist/PDV-Crosby-Setup-<versão>.exe` (instalador NSIS, escolha de pasta,
atalhos na área de trabalho e no menu Iniciar). `npm run pack` gera só a pasta
`dist/win-unpacked`.

> **Não é assinado** (sem certificado de code signing): o SmartScreen avisa
> "editor desconhecido" na primeira execução. Para tirar o aviso é preciso um
> certificado EV/OV (`build.win.certificateFile`).

### ⚠️ Erro de symlink no Windows (`Cannot create symbolic link`)
Na 1ª vez o electron-builder baixa o `winCodeSign`, que contém symlinks do
macOS (`.dylib`). Sem **Modo Desenvolvedor** (ou terminal admin) o Windows não
cria symlinks e o build falha. Em ordem de preferência:
1. **Ativar o Modo Desenvolvedor**: Configurações → Privacidade e segurança →
   Para desenvolvedores → *Modo de desenvolvedor* ON. Depois `npm run dist`.
2. Rodar o terminal **como Administrador**.
3. Contorno sem admin — extrair o cache ignorando a pasta `darwin`, direto no
   diretório definitivo (o builder extrai num temporário de nome aleatório e só
   renomeia se der certo, então é preciso criar o definitivo à mão):
   ```bash
   CACHE="$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
   node_modules/7zip-bin/win/x64/7za.exe x -snld -xr!darwin "$CACHE"/<hash>.7z -o"$CACHE/winCodeSign-2.6.0"
   ```

## Atualizar versão (auto-update)
O app instalado consulta, ao abrir e a cada 6 h, o `latest.yml` em
`build.publish.url` (package.json): o bucket **público** `pdv-updates` do
Supabase Storage do projeto principal (o mesmo de `config/supabase.js` da
API). Se houver versão mais nova, baixa o Setup em segundo plano (diferencial
pelo `.blockmap`: só os blocos que mudaram) e pergunta ao caixa:
**Atualizar agora** (fecha, instala em silêncio e reabre) ou **Depois**
(instala quando o PDV for fechado). Login e `pdv-config.json` são preservados. Sem internet ou
com o bucket fora do ar nada acontece: o app segue na versão atual.

Para publicar uma versão nova:
```bash
cd pdv-electron
# 1) bump da versão no package.json (ex.: 0.1.0 -> 0.1.1). Sem bump o caixa não atualiza.
npm version patch --no-git-tag-version
# 2) build + upload (usa a service key da API via ../config/supabase.js)
npm run release
```
`npm run release` = `npm run dist` + envio de `PDV-Crosby-Setup-<v>.exe`,
`.exe.blockmap`, uma cópia com nome fixo `PDV-Crosby-Setup.exe` (o link
"Baixar PDV Crosby (app)" do menu Tecnologia do HeadCoach, para instalar em
caixa novo) e `latest.yml` (este por último, para nenhum caixa ver uma
versão cujo .exe ainda não subiu). Para só reenviar o que já está em `dist/`:
`npm run release:skip-build`. Na primeira publicação o script cria o bucket.
Depois, commitar o bump do package.json.

- O updater **só roda no app instalado** (`app.isPackaged`); em `npm start`
  ele é ignorado.
- Log do updater: `%APPDATA%/pdv-crosby-electron/logs/main.log`.
- Instalador sem assinatura: a verificação de assinatura do Setup baixado fica
  desligada em `updater.js` (não há `publisherName` para conferir). Quando
  houver certificado, remover essa linha e definir `build.win.publisherName`.
- Testar contra outra hospedagem sem mexer no build:
  `PDV_UPDATE_URL=http://127.0.0.1:8099 "C:\...\PDV Crosby.exe"` (qualquer
  servidor estático com `latest.yml` + Setup; com suporte a `Range` o
  download diferencial funciona).
- A UI pode acompanhar por `window.pdv.atualizacao` (`estado()`,
  `verificar()`, `instalar()`, `onStatus(cb)`), status
  `verificando | atualizado | baixando (progresso %) | pronto | erro`.
- Limite de tamanho por arquivo no Supabase: plano Free = 50 MB, e o Setup tem
  ~90 MB. O projeto precisa estar no Pro (Storage → Settings → *Upload file
  size limit*). O script avisa se o upload for recusado por tamanho.

## Observações
- O app instalado e o `npm start` compartilham a pasta de dados
  (`%APPDATA%/pdv-crosby-electron`). Com os dois abertos aparecem erros de
  "Gpu Cache Creation failed" no console — inofensivos.
- `web/` e `dist/` estão no `.gitignore`; qualquer alteração no HeadCoach entra
  no app com um novo `npm run dist`.

## Ainda não incluído
- Assinatura digital do instalador (code signing).
- Integração real de TEF (pinpad) e do portal UR4 — hoje stubs em `main.js`.
- Modo offline (fila local de vendas): a UI é local, mas TOTVS/NFC-e exigem internet.
